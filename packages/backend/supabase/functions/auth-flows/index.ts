// T10: auth-flows edge function (Deno runtime).
//   POST   /auth-flows/signup        — creates the parent's Supabase Auth user + Family + Parent
//                                       row, gated on an explicit `consentAccepted: true` (spec
//                                       §8 COPPA/GDPR-K "verified parental consent flow at
//                                       signup").
//   POST   /auth-flows/children      — parent creates a Child under their own family.
//   POST   /auth-flows/pairing-code  — parent requests a 6-digit code for a childId.
//   POST   /auth-flows/pair-device   — child app redeems a code, becomes a registered Device,
//                                       receives a device-scoped credential.
//   DELETE /auth-flows/family        — account close: deletes Family, relies on 0001_init.sql's
//                                       ON DELETE CASCADE for child/device/policy/device_event/
//                                       child_request/parent (data-minimization requirement).
//
// Pure decision logic (pairing-code generation/expiry/consumption) lives in
// ../../../src/pairing.ts, covered by packages/backend/src/__tests__/pairing.test.ts under Jest
// — same thin-HTTP-wrapper split T08/T09 established for policySync.ts/eventIngest.ts. Uses
// _shared/postgrest.ts (T09) for DB I/O rather than duplicating it inline (this is a brand-new
// function, unlike policy-sync which predates that extraction and was left alone to avoid
// regressing already-verified code — see LEDGER.md's T09 entry).
//
// RISK (design decision this ticket had to make — spec §7 mentions child devices "pair to a
// family via some registration flow" but does not specify the mechanic): short-lived 6-digit
// pairing code, scoped to one Child, 10-minute TTL, one-time use. A parent generates it from the
// parent app; a child device redeems it within the TTL to become a registered Device and receive
// a device-scoped credential. Flagged here (and in LEDGER.md) for human/product review, not
// silently assumed — an alternative (e.g. QR-code deep link, SMS-based pairing) may be preferred
// but none was specified.
//
// Device-credential shape reuses T07's own documented RLS assumption EXACTLY (0002_rls.sql's top
// comment): role `authenticated`, custom claim `device_id` = the new device's `public.device.id`,
// HS256-signed with the project's JWT secret (`JWT_SECRET`, see SETUP.md) — no new claim
// shape invented. No `@supabase/supabase-js` import here (matches T08/T09's "zero external module
// specifiers in edge functions" convention) — the one Supabase Auth Admin API call this ticket
// needs (creating the parent's auth user) is a plain fetch to GoTrue's REST endpoint instead.
//
// RISK (not blocking, no ticket-specified value): the minted device credential's `exp` is set far
// in the future (1 year) because no device-credential refresh flow exists yet to renew a
// shorter-lived one — a follow-up ticket building device-side re-authentication should revisit
// this.
import type { Platform } from '../../../../domain/src/types.ts';
import {
  generatePairingCode,
  pairingCodeExpiresAt,
  validatePairingCode,
  type PairingCodeRecord,
} from '../../../src/pairing.ts';
import {
  json,
  PostgrestError,
  restDelete,
  restGet,
  restInsert,
  restPatch,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from '../_shared/postgrest.ts';

// NOT named SUPABASE_JWT_SECRET: the Supabase CLI's `--env-file` (and `secrets set`) refuse any
// user-supplied env var whose name starts with the reserved `SUPABASE_` prefix (confirmed
// empirically — `supabase functions serve --env-file ...` silently skips it with "Env name
// cannot start with SUPABASE_, skipping"). `JWT_SECRET` matches the name `supabase status`
// itself prints for the project's signing secret.
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? '';
const DEVICE_CREDENTIAL_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year — see header comment RISK.

// --- Supabase Auth Admin (GoTrue REST, not supabase-js — see file header) -------------------

async function adminCreateUser(email: string, password: string): Promise<{ id: string; email: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    // email_confirm: true — same pattern T07's scripts/smoke.ts already established for creating
    // a usable parent auth user in one synchronous call (no separate email-confirmation-link
    // step to wait on before the Family/Parent rows can be provisioned below).
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const text = await res.text();
  if (!res.ok) throw new PostgrestError('POST', '/auth/v1/admin/users', res.status, text);
  const parsed = JSON.parse(text) as { id: string; email: string };
  return { id: parsed.id, email: parsed.email };
}

// --- WebCrypto HS256 JWT signing (device credential) -----------------------------------------

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signHs256(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64url(new Uint8Array(signature));
}

async function mintDeviceCredential(
  deviceId: string,
  childId: string,
): Promise<{ token: string; expiresAt: string }> {
  if (!JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is not set — cannot mint a device credential. See SETUP.md.',
    );
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + DEVICE_CREDENTIAL_TTL_SECONDS;
  const header = { alg: 'HS256', typ: 'JWT' };
  // Claim shape reuses T07's documented assumption exactly: `role: authenticated` + custom
  // `device_id` claim (0002_rls.sql's `current_device_id()` reads `auth.jwt() ->> 'device_id'`).
  // `sub`/`child_id`/`iat`/`exp` are standard JWT hygiene, not read by any RLS policy.
  const claims = {
    role: 'authenticated',
    device_id: deviceId,
    sub: deviceId,
    child_id: childId,
    iat: nowSeconds,
    exp: expSeconds,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = await signHs256(unsigned, JWT_SECRET);
  return { token: `${unsigned}.${signature}`, expiresAt: new Date(expSeconds * 1000).toISOString() };
}

// --- Route handlers ----------------------------------------------------------------------------

interface SignupBody {
  email?: string;
  password?: string;
  consentAccepted?: boolean;
  familyName?: string;
}

async function handleSignup(body: SignupBody) {
  const { email, password, consentAccepted, familyName } = body;
  if (!email || !password) {
    return json({ error: 'email and password are required' }, 400);
  }
  // The verified-parental-consent gate itself: reject BEFORE creating anything (no orphaned auth
  // user, no Family/Parent rows) unless consentAccepted is literally `true`.
  if (consentAccepted !== true) {
    return json({ error: 'consentAccepted must be true to complete signup' }, 400);
  }

  // RISK (not blocking, flagged per reviewer request): if the family or parent insert below
  // throws, the auth user created here is NOT rolled back — this ticket does not implement
  // saga/compensating-transaction cleanup, so a failure between these two steps leaves an
  // orphaned, real `auth.users` row with no corresponding Family/Parent. Narrow window (both
  // inserts are simple, same-request calls), but a real gap; a follow-up ticket adding retry/
  // idempotency to signup should account for it.
  const authUser = await adminCreateUser(email, password);

  // Service-role key, not the new user's own bearer: admin.createUser doesn't return a session
  // token, so no forwardable JWT exists yet for this brand-new user (same chicken-and-egg
  // T07's 0002_rls.sql documented for the family_insert/parent_insert "any authenticated user"
  // policies — those RLS policies exist for a client-driven onboarding path, this service-role
  // path is the alternative this ticket actually builds).
  const [family] = (await restInsert(
    '/family',
    { name: familyName ?? 'My Family' },
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as { id: string; name: string }[];

  const parentalConsentAcceptedAt = new Date().toISOString();
  const [parent] = (await restInsert(
    '/parent',
    {
      id: authUser.id,
      family_id: family.id,
      email: authUser.email,
      parental_consent_accepted_at: parentalConsentAcceptedAt,
    },
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as { id: string }[];

  return json(
    {
      familyId: family.id,
      parentId: parent.id,
      email: authUser.email,
      parentalConsentAcceptedAt,
    },
    201,
  );
}

interface CreateChildBody {
  name?: string;
  birthdate?: string;
}

async function handleCreateChild(bearer: string, body: CreateChildBody) {
  const { name, birthdate } = body;
  if (!name || !birthdate) {
    return json({ error: 'name and birthdate are required' }, 400);
  }

  // RLS-scoped read (parent_select: `id = auth.uid()`) resolves the calling parent's own
  // family_id — the caller never supplies it directly.
  const parents = (await restGet('/parent?select=family_id', SUPABASE_ANON_KEY, bearer)) as {
    family_id: string;
  }[];
  if (parents.length === 0) {
    return json({ error: 'no parent record found for the authenticated user' }, 404);
  }

  const [child] = (await restInsert(
    '/child',
    { family_id: parents[0].family_id, name, birthdate },
    SUPABASE_ANON_KEY,
    bearer,
  )) as { id: string; family_id: string; name: string; birthdate: string }[];

  return json(
    { id: child.id, familyId: child.family_id, name: child.name, birthdate: child.birthdate },
    201,
  );
}

interface PairingCodeBody {
  childId?: string;
}

interface PairingCodeRow {
  code: string;
  child_id: string;
  expires_at: string;
  consumed_at: string | null;
}

function rowToPairingRecord(row: PairingCodeRow): PairingCodeRecord {
  return { code: row.code, childId: row.child_id, expiresAt: row.expires_at, consumedAt: row.consumed_at };
}

async function handlePairingCode(bearer: string, body: PairingCodeBody) {
  const { childId } = body;
  if (!childId) return json({ error: 'childId is required' }, 400);

  // Confirms the calling parent actually owns this child (RLS-scoped read) — a parent requesting
  // a code for another family's child gets a 404, not a leak of that child's existence.
  const children = (await restGet(
    `/child?id=eq.${encodeURIComponent(childId)}&select=id`,
    SUPABASE_ANON_KEY,
    bearer,
  )) as {
    id: string;
  }[];
  if (children.length === 0) return json({ error: `child ${childId} not found` }, 404);

  const now = new Date();
  // Retries ONLY on the rare 6-digit collision against another currently-active code (guarded by
  // 0005_pairing.sql's partial unique index on (code) WHERE consumed_at IS NULL — PostgREST
  // surfaces a uniqueness violation as HTTP 409). Any other failure (malformed request, RLS
  // rejection, network error, etc.) rethrows immediately on the first attempt — retrying those
  // would silently mask a real error behind up to 2 extra wasted round-trips.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generatePairingCode();
    const expiresAt = pairingCodeExpiresAt(now);
    try {
      const [row] = (await restInsert(
        '/pairing_code',
        { code, child_id: childId, expires_at: expiresAt },
        SUPABASE_ANON_KEY,
        bearer,
      )) as PairingCodeRow[];
      return json({ code: row.code, childId: row.child_id, expiresAt: row.expires_at }, 201);
    } catch (err) {
      if (!(err instanceof PostgrestError) || err.status !== 409) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('failed to generate a unique pairing code');
}

interface PairDeviceBody {
  code?: string;
  platform?: Platform;
  deviceName?: string;
}

async function handlePairDevice(body: PairDeviceBody) {
  const { code, platform, deviceName } = body;
  if (!code || !platform || !deviceName) {
    return json({ error: 'code, platform and deviceName are required' }, 400);
  }

  const nowIso = new Date().toISOString();
  // Atomic claim: a single conditional UPDATE flips consumed_at only if the code is still
  // unconsumed AND unexpired. This — not validatePairingCode below — is what actually enforces
  // one-time-use under concurrency: two simultaneous pair-device calls submitting the same code
  // race on this one UPDATE; only one can match+return a row, so only one ever proceeds to
  // create a Device row.
  const claimed = (await restPatch(
    `/pairing_code?code=eq.${encodeURIComponent(code)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}`,
    { consumed_at: nowIso },
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as PairingCodeRow[];

  if (claimed.length === 0) {
    // Best-effort reason classification for the error message only (pure src/pairing.ts logic,
    // covered by pairing.test.ts) — the atomic claim above already enforced the real rule.
    const existing = (await restGet(
      `/pairing_code?code=eq.${encodeURIComponent(code)}&order=expires_at.desc&limit=1`,
      SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY,
    )) as PairingCodeRow[];
    const record = existing[0] ? rowToPairingRecord(existing[0]) : null;
    const validation = validatePairingCode(record, new Date());
    const reason = validation.valid ? 'consumed' : validation.reason; // lost a concurrent race
    return json({ error: `pairing code rejected: ${reason}` }, 400);
  }

  const record = rowToPairingRecord(claimed[0]);
  const [device] = (await restInsert(
    '/device',
    { child_id: record.childId, platform, name: deviceName },
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as { id: string; child_id: string; platform: string; name: string }[];

  const credential = await mintDeviceCredential(device.id, device.child_id);

  return json({
    deviceId: device.id,
    childId: device.child_id,
    deviceToken: credential.token,
    deviceTokenExpiresAt: credential.expiresAt,
  });
}

async function handleFamilyDelete(bearer: string) {
  const parents = (await restGet('/parent?select=family_id', SUPABASE_ANON_KEY, bearer)) as {
    family_id: string;
  }[];
  if (parents.length === 0) {
    return json({ error: 'no parent record found for the authenticated user' }, 404);
  }
  const familyId = parents[0].family_id;
  // ON DELETE CASCADE (0001_init.sql) removes every parent/child/device/policy/device_event/
  // child_request row scoped to this family — see SETUP.md / LEDGER.md's T10 entry for the
  // verification command run against this cascade.
  await restDelete(`/family?id=eq.${encodeURIComponent(familyId)}`, SUPABASE_ANON_KEY, bearer);
  return json({ deleted: true, familyId });
}

// --- Router --------------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];

  try {
    // signup / pair-device have no parent/device identity yet — they run entirely on the
    // service-role key internally, same "no caller identity to forward" precedent as
    // digest-cron/vacation-cron (T09). The Supabase platform's own verify_jwt gate (config.toml)
    // still requires SOME valid signed JWT bearer (e.g. the anon key) on every call.
    if (req.method === 'POST' && last === 'signup') {
      return await handleSignup((await req.json()) as SignupBody);
    }
    if (req.method === 'POST' && last === 'pair-device') {
      return await handlePairDevice((await req.json()) as PairDeviceBody);
    }

    // Every other route needs the calling parent's own forwarded JWT for RLS-scoped reads/writes.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing Authorization header' }, 401);
    const bearer = authHeader.replace(/^Bearer\s+/i, '');

    if (req.method === 'POST' && last === 'children') {
      return await handleCreateChild(bearer, (await req.json()) as CreateChildBody);
    }
    if (req.method === 'POST' && last === 'pairing-code') {
      return await handlePairingCode(bearer, (await req.json()) as PairingCodeBody);
    }
    if (req.method === 'DELETE' && last === 'family') {
      return await handleFamilyDelete(bearer);
    }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof PostgrestError) {
      return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
