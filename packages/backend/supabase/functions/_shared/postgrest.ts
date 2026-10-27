// T09: PostgREST client + HTTP response plumbing shared by event-ingest, digest-cron and
// vacation-cron (3 new functions all needing the same fetch()-based PostgREST calls T08's
// policy-sync/index.ts already established). `_shared/` is Supabase's own convention for a
// functions subfolder that is imported code, not a deployable function itself.
//
// policy-sync/index.ts (T08, already DONE/verified) is deliberately left with its own inline
// copies of this same plumbing rather than being refactored to import from here — this ticket
// doesn't require touching already-verified T08 code, and doing so would risk regressing it for
// no requirement of this ticket. See LEDGER.md's T09 entry.
//
// Deno-runtime file — zero external module specifiers, only Deno/Web built-ins (fetch) plus
// relative TS files, same constraint as every other file under supabase/functions/. Excluded
// from the Node/tsc pipeline (packages/backend/tsconfig.json), still linted by ESLint.

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Unset in this environment (no Firebase account — see LEDGER.md Phase 0); see SETUP.md's
// "FCM / push credentials" section for what a human needs to obtain to set this for real.
export const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export class PostgrestError extends Error {
  constructor(
    method: string,
    path: string,
    readonly status: number,
    body: string,
  ) {
    super(`${method} ${path} failed (${status}): ${body}`);
  }
}

export async function restGet(path: string, apikey: string, bearer: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey, Authorization: `Bearer ${bearer}` },
  });
  const text = await res.text();
  if (!res.ok) throw new PostgrestError('GET', path, res.status, text);
  return text ? JSON.parse(text) : [];
}

export async function restInsert(
  path: string,
  body: unknown,
  apikey: string,
  bearer: string,
): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PostgrestError('POST', path, res.status, text);
  return text ? JSON.parse(text) : [];
}

// T10: PATCH/DELETE added alongside GET/POST above — same fetch()-based PostgREST client, no new
// runtime dependency. `restPatch` is used for conditional updates (e.g. auth-flows/index.ts's
// atomic pairing-code claim); a request matching zero rows is NOT an error at the HTTP layer
// (PostgREST returns 200 with an empty array), so callers that need to detect "matched nothing"
// check the returned array's length themselves rather than relying on a thrown error.
export async function restPatch(
  path: string,
  body: unknown,
  apikey: string,
  bearer: string,
): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PostgrestError('PATCH', path, res.status, text);
  return text ? JSON.parse(text) : [];
}

export async function restDelete(path: string, apikey: string, bearer: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      Prefer: 'return=representation',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new PostgrestError('DELETE', path, res.status, text);
  return text ? JSON.parse(text) : [];
}
