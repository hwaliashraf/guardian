// T08: policy-sync edge function (Deno runtime).
//   PUT  /policy-sync/:childId       — partial Policy update, gated + versioned + push-dispatched
//   POST /policy-sync/instant-pause  — { familyId }, pauses every child's policy + every device
//
// Thin HTTP wrapper: all decision logic (feature gating, version bump, push payload shape,
// "who gets notified") lives in ../../src/policySync.ts (plain TS, no I/O, covered by
// packages/backend/src/__tests__/policySync.test.ts under Jest). This file only does I/O
// (reading the request, talking to Postgres via PostgREST, calling the PushDispatcher) and
// HTTP response shaping.
//
// DB access uses plain `fetch()` against PostgREST (`${SUPABASE_URL}/rest/v1/...`) instead of
// `@supabase/supabase-js`, deliberately — this keeps the function's entire import graph to
// local relative TS files (this file, push/dispatcher.ts, and the pure src/policySync.ts ->
// packages/domain/src/tiers/{gate,features,types}.ts chain), all resolvable by Deno with zero
// 'npm:'/'jsr:' specifiers and zero network access needed to *load* the function — only the
// real Postgres/PostgREST calls it makes at request time need the network (loopback, already
// required for the function to do anything useful).
//
// Two Postgres roles are used for two different reasons (least-privilege, not just convenience):
//   - the CALLER's own forwarded JWT (Authorization header) + the project's anon key, for every
//     read/write that should go through RLS (0002_rls.sql's parent-scoped policies already
//     allow a parent to select/insert `policy` and select `device` rows for their own family —
//     reusing that instead of a service-role bypass keeps RLS meaningful as defense-in-depth).
//   - the service-role key, ONLY for push_log inserts (0003_push_log.sql has no
//     anon/authenticated policy on that table by design — it's a system audit trail, not a
//     parent- or device-owned resource).
import {
  assertPolicyUpdateAllowed,
  buildInstantPausePolicy,
  buildInstantPausePushPayload,
  buildNextPolicyVersion,
  buildPolicyUpdatePushPayload,
  devicesToNotify,
  type PolicyUpdate,
  type PushableDevice,
} from '../../../src/policySync.ts';
import type { Policy, Tier } from '../../../../domain/src/types.ts';
import { FeatureGatedError } from '../../../../domain/src/tiers/gate.ts';
import {
  FcmPushDispatcher,
  LoggingPushDispatcher,
  type PushDispatcher,
  type PushLogSink,
  type PushPayload,
} from '../push/dispatcher.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Unset in this environment (no Firebase account — see LEDGER.md Phase 0); see SETUP.md's
// "FCM / push credentials" section for what a human needs to obtain to set this for real.
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- Minimal PostgREST client (no supabase-js — see file header) --------------------------

class PostgrestError extends Error {
  constructor(
    method: string,
    path: string,
    readonly status: number,
    body: string,
  ) {
    super(`${method} ${path} failed (${status}): ${body}`);
  }
}

async function restGet(path: string, apikey: string, bearer: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey, Authorization: `Bearer ${bearer}` },
  });
  const text = await res.text();
  if (!res.ok) throw new PostgrestError('GET', path, res.status, text);
  return text ? JSON.parse(text) : [];
}

async function restInsert(
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

// --- Row <-> domain Policy mapping (mirrors scripts/smoke.ts's insert shape, T07) ----------

interface PolicyRow {
  id: string;
  child_id: string;
  version: number;
  screen_time: Policy['screenTime'];
  buckets: Policy['buckets'];
  schedules: Policy['schedules'];
  vacation: Policy['vacation'];
  content_filter: Policy['contentFilter'];
  app_rules: Policy['appRules'];
  presence: Policy['presence'];
  tamper: Policy['tamper'];
  instant_pause: boolean;
}

function rowToPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    childId: row.child_id,
    version: row.version,
    screenTime: row.screen_time,
    buckets: row.buckets,
    schedules: row.schedules,
    vacation: row.vacation,
    contentFilter: row.content_filter,
    appRules: row.app_rules,
    presence: row.presence,
    tamper: row.tamper,
    instantPause: row.instant_pause,
  };
}

function policyToInsertRow(policy: Policy, childId: string): Record<string, unknown> {
  return {
    child_id: childId,
    version: policy.version,
    screen_time: policy.screenTime,
    buckets: policy.buckets,
    schedules: policy.schedules,
    vacation: policy.vacation,
    content_filter: policy.contentFilter,
    app_rules: policy.appRules,
    presence: policy.presence,
    tamper: policy.tamper,
    instant_pause: policy.instantPause,
  };
}

async function fetchLatestPolicy(
  childId: string,
  apikey: string,
  bearer: string,
): Promise<Policy | null> {
  const rows = (await restGet(
    `/policy?child_id=eq.${childId}&order=version.desc&limit=1`,
    apikey,
    bearer,
  )) as PolicyRow[];
  return rows.length > 0 ? rowToPolicy(rows[0]) : null;
}

async function fetchFamilyTier(childId: string, apikey: string, bearer: string): Promise<Tier> {
  const children = (await restGet(`/child?id=eq.${childId}&select=family_id`, apikey, bearer)) as {
    family_id: string;
  }[];
  if (children.length === 0) throw new PostgrestError('GET', '/child', 404, 'child not found');
  const subs = (await restGet(
    `/subscription?family_id=eq.${children[0].family_id}&select=tier`,
    apikey,
    bearer,
  )) as { tier: Tier }[];
  if (subs.length === 0) {
    throw new PostgrestError('GET', '/subscription', 404, 'no subscription for family');
  }
  return subs[0].tier;
}

async function fetchDevices(
  childIdFilter: string,
  apikey: string,
  bearer: string,
): Promise<PushableDevice[]> {
  const rows = (await restGet(
    `/device?${childIdFilter}&select=id,push_token`,
    apikey,
    bearer,
  )) as { id: string; push_token: string | null }[];
  return rows.map((r) => ({ id: r.id, pushToken: r.push_token }));
}

// --- Push dispatcher wiring -----------------------------------------------------------------
// Default: LoggingPushDispatcher (writes to push_log, no network call) — what this ticket
// actually verifies. Swaps to FcmPushDispatcher only when FCM_SERVICE_ACCOUNT_JSON is set
// (never set in this environment — see SETUP.md's "FCM / push credentials" section).

function makePushLogSink(): PushLogSink {
  return {
    async logDispatch(deviceId, payload, dispatcher) {
      await restInsert(
        '/push_log',
        { device_id: deviceId, payload, dispatcher },
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
      );
    },
  };
}

function makeDispatcher(): PushDispatcher {
  const sink = makePushLogSink();
  if (FCM_SERVICE_ACCOUNT_JSON) {
    return new FcmPushDispatcher(FCM_SERVICE_ACCOUNT_JSON, sink);
  }
  return new LoggingPushDispatcher(sink);
}

async function dispatchToDevices(
  dispatcher: PushDispatcher,
  devices: PushableDevice[],
  payload: PushPayload,
): Promise<number> {
  const targets = devicesToNotify(devices);
  await Promise.all(targets.map((d) => dispatcher.send(d.id, d.pushToken as string, payload)));
  return targets.length;
}

// --- Route handlers --------------------------------------------------------------------------

async function handlePolicyUpdate(childId: string, bearer: string, update: PolicyUpdate) {
  const startedAt = performance.now();
  const tier = await fetchFamilyTier(childId, SUPABASE_ANON_KEY, bearer);
  assertPolicyUpdateAllowed(tier, update); // throws FeatureGatedError -> caught by the router

  const current = await fetchLatestPolicy(childId, SUPABASE_ANON_KEY, bearer);
  if (!current) {
    return json({ error: `no active policy exists for child ${childId}` }, 404);
  }

  const next = buildNextPolicyVersion(current, update);
  const inserted = (await restInsert(
    '/policy',
    policyToInsertRow(next, childId),
    SUPABASE_ANON_KEY,
    bearer,
  )) as PolicyRow[];
  const persisted = rowToPolicy(inserted[0]);

  const devices = await fetchDevices(`child_id=eq.${childId}`, SUPABASE_ANON_KEY, bearer);
  const dispatcher = makeDispatcher();
  const notified = await dispatchToDevices(
    dispatcher,
    devices,
    buildPolicyUpdatePushPayload(persisted),
  );

  const dbWriteAndDispatchMs = performance.now() - startedAt;
  return json({
    policy: persisted,
    devicesNotified: notified,
    dbWriteAndDispatchMs,
  });
}

async function handleInstantPause(familyId: string, bearer: string) {
  const startedAt = performance.now();
  const children = (await restGet(
    `/child?family_id=eq.${familyId}&select=id`,
    SUPABASE_ANON_KEY,
    bearer,
  )) as { id: string }[];

  const updatedPolicies: Policy[] = [];
  for (const child of children) {
    const current = await fetchLatestPolicy(child.id, SUPABASE_ANON_KEY, bearer);
    if (!current) continue; // no policy yet for this child — nothing to pause
    const next = buildInstantPausePolicy(current);
    const inserted = (await restInsert(
      '/policy',
      policyToInsertRow(next, child.id),
      SUPABASE_ANON_KEY,
      bearer,
    )) as PolicyRow[];
    updatedPolicies.push(rowToPolicy(inserted[0]));
  }

  const childIds = children.map((c) => c.id);
  const devices =
    childIds.length > 0
      ? await fetchDevices(`child_id=in.(${childIds.join(',')})`, SUPABASE_ANON_KEY, bearer)
      : [];
  const dispatcher = makeDispatcher();
  const notified = await dispatchToDevices(dispatcher, devices, buildInstantPausePushPayload());

  const dbWriteAndDispatchMs = performance.now() - startedAt;
  return json({
    childrenPaused: updatedPolicies.length,
    devicesNotified: notified,
    dbWriteAndDispatchMs,
  });
}

// --- Router ------------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean); // drop empty segments
  const last = segments[segments.length - 1];

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization header' }, 401);
  const bearer = authHeader.replace(/^Bearer\s+/i, '');

  try {
    if (req.method === 'PUT' && last && last !== 'policy-sync') {
      const update = (await req.json()) as PolicyUpdate;
      return await handlePolicyUpdate(last, bearer, update);
    }
    if (req.method === 'POST' && last === 'instant-pause') {
      const body = (await req.json()) as { familyId: string };
      if (!body.familyId) return json({ error: 'familyId is required' }, 400);
      return await handleInstantPause(body.familyId, bearer);
    }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof FeatureGatedError) {
      return json(
        { error: err.message, feature: err.feature, requiredTier: err.requiredTier },
        403,
      );
    }
    if (err instanceof PostgrestError) {
      return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
