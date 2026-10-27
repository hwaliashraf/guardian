// T19: requests edge function (Deno runtime).
//   POST /requests             — child creates a ChildRequest, dispatches a push to the child's
//                                 own registered devices (spec §3.6's "approves/denies from a
//                                 push notification" framing — see push-target reconciliation
//                                 note below).
//   POST /requests/:id/resolve — parent approves/denies; on approve, applies the type-specific
//                                 policy/usage mutation (see ../../../src/requests.ts).
//
// Thin HTTP wrapper: all decision logic (push payload shape, per-type approve mutations) lives
// in ../../../src/requests.ts (plain TS, no I/O, covered by
// packages/backend/src/__tests__/requests.test.ts under Jest), same split T08/T09 established.
//
// Two Postgres roles, two different reasons (least-privilege, same rationale as event-ingest):
//   - POST /requests is called by the CHILD DEVICE: its own forwarded JWT + anon key for the
//     child_request INSERT (T07 RLS: child_request_insert_device is INSERT-only, child_id must
//     match the JWT's own device_id->child_id claim).
//   - POST /requests/:id/resolve is called by the PARENT: their own forwarded JWT + anon key for
//     the child_request SELECT/UPDATE (T07 RLS: child_request_select_parent/_update_parent,
//     family-scoped) and, for unblock/schedule_change, the policy SELECT/INSERT (T07's existing
//     parent-scoped policy policies, same as T08's policy-sync).
//   - service-role key ONLY for device.push_token reads (no anon/authenticated SELECT policy on
//     `device` for either role) and push_log inserts (no anon/authenticated policy by design).
import type { ChildRequest, Policy, RequestType } from '../../../../domain/src/types.ts';
import type { DailyUsageState } from '../../../../domain/src/buckets/types.ts';
import {
  buildExtraTimeGrant,
  buildRequestCreatedPushPayload,
  buildScheduleChangePolicyUpdate,
  buildUnblockPolicyUpdate,
  type ExtraTimeRequestPayload,
  type ScheduleChangeRequestPayload,
  type UnblockRequestPayload,
} from '../../../src/requests.ts';
import { buildNextPolicyVersion } from '../../../src/policySync.ts';
import {
  json,
  PostgrestError,
  restGet,
  restInsert,
  restPatch,
  SUPABASE_ANON_KEY,
} from '../_shared/postgrest.ts';
import { dispatchToDevices, fetchDevices, makeDispatcher } from '../_shared/push.ts';

// --- Row <-> domain ChildRequest mapping -------------------------------------------------------

interface ChildRequestRow {
  id: string;
  child_id: string;
  type: RequestType;
  payload: Record<string, unknown>;
  status: ChildRequest['status'];
  created_at: string;
  resolved_at: string | null;
}

function rowToChildRequest(row: ChildRequestRow): ChildRequest {
  return {
    id: row.id,
    childId: row.child_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

async function fetchChildRequest(id: string, apikey: string, bearer: string): Promise<ChildRequest | null> {
  const rows = (await restGet(`/child_request?id=eq.${id}`, apikey, bearer)) as ChildRequestRow[];
  return rows.length > 0 ? rowToChildRequest(rows[0]) : null;
}

// --- Row <-> domain Policy mapping (own copy, T09's precedent: T08's policy-sync/index.ts is
// left untouched rather than refactored to share this — see that file's own inline copy) -------

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

async function fetchLatestPolicy(childId: string, apikey: string, bearer: string): Promise<Policy | null> {
  const rows = (await restGet(
    `/policy?child_id=eq.${childId}&order=version.desc&limit=1`,
    apikey,
    bearer,
  )) as PolicyRow[];
  return rows.length > 0 ? rowToPolicy(rows[0]) : null;
}

// --- Route handlers --------------------------------------------------------------------------

interface CreateRequestBody {
  childId: string;
  type: RequestType;
  payload: Record<string, unknown>;
}

async function handleCreateRequest(bearer: string, body: CreateRequestBody) {
  if (!body.childId || !body.type || !body.payload) {
    return json({ error: 'childId, type and payload are required' }, 400);
  }

  const inserted = (await restInsert(
    '/child_request',
    { child_id: body.childId, type: body.type, payload: body.payload },
    SUPABASE_ANON_KEY,
    bearer,
  )) as ChildRequestRow[];
  const request = rowToChildRequest(inserted[0]);

  const devices = await fetchDevices(`child_id=eq.${request.childId}`);
  const dispatcher = makeDispatcher();
  const devicesNotified = await dispatchToDevices(dispatcher, devices, buildRequestCreatedPushPayload(request));

  return json({ request, devicesNotified });
}

async function handleResolveRequest(id: string, bearer: string, approve: boolean) {
  // Atomic claim: a single conditional UPDATE flips status only if it's still 'pending' — same
  // pattern auth-flows/index.ts uses for pairing-code claims (see that file's handlePairDevice
  // comment). This, not a prior SELECT, is what enforces "resolve exactly once" under
  // concurrency/double-tap: two simultaneous resolve calls on the same id race on this one
  // UPDATE, only one can match+return a row, so only one ever reaches the mutation below. Doing
  // this FIRST (not last) also guarantees a second call — approve then deny, or deny then
  // approve — can never re-run or reverse an already-applied mutation, since it's rejected
  // before the mutation branch is even reached.
  const claimed = (await restPatch(
    `/child_request?id=eq.${id}&status=eq.pending`,
    { status: approve ? 'approved' : 'denied', resolved_at: new Date().toISOString() },
    SUPABASE_ANON_KEY,
    bearer,
  )) as ChildRequestRow[];
  if (claimed.length === 0) {
    const existing = await fetchChildRequest(id, SUPABASE_ANON_KEY, bearer);
    return json(
      { error: existing ? `request ${id} was already resolved` : `no request found for id ${id}` },
      existing ? 409 : 404,
    );
  }
  const request = rowToChildRequest(claimed[0]);

  let dailyUsage: DailyUsageState | undefined;
  let policy: Policy | undefined;

  if (approve) {
    if (request.type === 'extra_time') {
      dailyUsage = buildExtraTimeGrant(request.payload as unknown as ExtraTimeRequestPayload);
    } else {
      const current = await fetchLatestPolicy(request.childId, SUPABASE_ANON_KEY, bearer);
      if (!current) return json({ error: `no active policy exists for child ${request.childId}` }, 404);

      const update =
        request.type === 'unblock'
          ? buildUnblockPolicyUpdate(current, request.payload as unknown as UnblockRequestPayload)
          : buildScheduleChangePolicyUpdate(current, request.payload as unknown as ScheduleChangeRequestPayload);

      const next = buildNextPolicyVersion(current, update);
      const insertedPolicy = (await restInsert(
        '/policy',
        policyToInsertRow(next, request.childId),
        SUPABASE_ANON_KEY,
        bearer,
      )) as PolicyRow[];
      policy = rowToPolicy(insertedPolicy[0]);
    }
  }

  return json({ request, ...(dailyUsage ? { dailyUsage } : {}), ...(policy ? { policy } : {}) });
}

// --- Router ------------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean); // drop empty segments

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization header' }, 401);
  const bearer = authHeader.replace(/^Bearer\s+/i, '');

  try {
    if (req.method === 'POST' && segments[segments.length - 1] === 'resolve' && segments.length >= 3) {
      const id = segments[segments.length - 2];
      const body = (await req.json()) as { approve: boolean };
      if (typeof body.approve !== 'boolean') return json({ error: 'approve (boolean) is required' }, 400);
      return await handleResolveRequest(id, bearer, body.approve);
    }
    if (req.method === 'POST' && segments[segments.length - 1] === 'requests') {
      const body = (await req.json()) as CreateRequestBody;
      return await handleCreateRequest(bearer, body);
    }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof PostgrestError) {
      return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
