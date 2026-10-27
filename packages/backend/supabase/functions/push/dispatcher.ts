// T08: PushDispatcher interface + two implementations.
//
// Deno-runtime file (Supabase Edge Functions) — deliberately has ZERO external module
// specifiers (no 'npm:'/'jsr:' imports, no bare package names) so `supabase functions serve`
// never needs network access or an import map to load it; only Deno/Web built-ins
// (fetch/crypto/btoa/atob) plus this repo's own relative TS files are used. Excluded from the
// Node/tsc + ESLint pipeline that governs the rest of the monorepo — see
// packages/backend/tsconfig.json / root tsconfig.base.json / eslint.config.mjs, and the LEDGER
// T08 entry for why (Deno globals + module resolution are a different universe from
// Node/ts-jest/bundler-mode tsc).

export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
  priority: 'high' | 'normal';
}

// `send`'s literal ticket signature is `send(deviceToken, payload)`; this interface adds a
// leading `deviceId` param — a minimal necessary addition (same category as T03's
// `weeklyMinutesUsed` / T04's `deviceId`/`childId` additions, both documented in LEDGER.md)
// because `push_log` (0003_push_log.sql) has a mandatory `device_id` FK column, and a push
// device *token* is not the same value as our internal `device.id` — a dispatcher can't log
// which device it notified without being told the device's id directly.
export interface PushDispatcher {
  send(deviceId: string, deviceToken: string, payload: PushPayload): Promise<void>;
}

// Minimal structural dependency each dispatcher needs to record a push_log row — deliberately
// NOT a `@supabase/supabase-js` client type (keeps this file free of any external import; the
// edge function wires in a tiny fetch-based implementation, see policy-sync/index.ts).
export interface PushLogSink {
  logDispatch(deviceId: string, payload: PushPayload, dispatcher: 'logging' | 'fcm'): Promise<void>;
}

// --- Default dispatcher: writes to push_log instead of a real network call --------------------
// No FCM/APNs project credentials exist in this environment (no Firebase account — see
// LEDGER.md Phase 0). This is the default, wired in by policy-sync/index.ts whenever
// FCM_SERVICE_ACCOUNT_JSON is not set.
export class LoggingPushDispatcher implements PushDispatcher {
  constructor(private readonly sink: PushLogSink) {}

  async send(deviceId: string, _deviceToken: string, payload: PushPayload): Promise<void> {
    await this.sink.logDispatch(deviceId, payload, 'logging');
  }
}

// --- Real dispatcher: FCM HTTP v1 API -----------------------------------------------------
// Written for real against FCM's HTTP v1 API shape (OAuth2 service-account bearer token +
// POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send), gated behind
// FCM_SERVICE_ACCOUNT_JSON which is never set in this environment — see SETUP.md's
// "FCM / push credentials" section for exactly what a human needs to obtain to switch to this
// dispatcher, and the "Out of scope" note in the T08 ticket: real delivery is NOT verified here.
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export class FcmPushDispatcher implements PushDispatcher {
  private readonly serviceAccount: FcmServiceAccount;
  private readonly sink: PushLogSink;
  private readonly fetchImpl: typeof fetch;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(serviceAccountJson: string, sink: PushLogSink, fetchImpl: typeof fetch = fetch) {
    this.serviceAccount = JSON.parse(serviceAccountJson) as FcmServiceAccount;
    this.sink = sink;
    this.fetchImpl = fetchImpl;
  }

  async send(deviceId: string, deviceToken: string, payload: PushPayload): Promise<void> {
    const accessToken = await this.getAccessToken();
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
            // High-priority delivery per spec §7 ("Policy push latency target: <10s ... FCM
            // high-priority").
            android: { priority: payload.priority === 'high' ? 'high' : 'normal' },
            apns: { headers: { 'apns-priority': payload.priority === 'high' ? '10' : '5' } },
          },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`FcmPushDispatcher: FCM send failed (${res.status}): ${await res.text()}`);
    }
    await this.sink.logDispatch(deviceId, payload, 'fcm');
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.accessToken;
    }

    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = await signRs256(unsigned, this.serviceAccount.private_key);
    const assertion = `${unsigned}.${signature}`;

    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      throw new Error(`FcmPushDispatcher: OAuth2 token exchange failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { accessToken: json.access_token, expiresAt: now + json.expires_in };
    return json.access_token;
  }
}

// --- WebCrypto helpers (RS256 JWT signing for the Google service-account OAuth2 flow) --------

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signRs256(data: string, pkcs8Pem: string): Promise<string> {
  const key = await importPkcs8PrivateKey(pkcs8Pem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(data),
  );
  return base64url(new Uint8Array(signature));
}

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}
