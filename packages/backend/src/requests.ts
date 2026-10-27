// T19: pure decision logic for the child-request / parent-approve flow. No I/O — importable by
// both the Jest suite (packages/backend/src/__tests__/requests.test.ts) and the Deno edge
// function (packages/backend/supabase/functions/requests/index.ts), same dual-runtime split T08
// established for policySync.ts (see that file's header comment for the full rationale). Imports
// reach packages/domain's SOURCE directly by relative `.ts`-extensioned path (not the
// '@guardian/domain' specifier, not the barrel) for the same Deno-resolvability reason —
// `buckets/engine.ts`/`buckets/types.ts`/`types.ts` have zero external deps, same as T08's
// `tiers/gate.ts`/`tiers/features.ts`.
import type {
  AppRulePolicy,
  ChildRequest,
  ContentFilterPolicy,
  Policy,
  RequestType,
  SchedulePolicy,
} from '../../domain/src/types.ts';
import { applyApprovedExtraTime } from '../../domain/src/buckets/engine.ts';
import type { DailyUsageState } from '../../domain/src/buckets/types.ts';
import type { PushDispatchPayload } from './policySync.ts';

// --- Request payload shapes -------------------------------------------------------------------
// `ChildRequest.payload` is untyped (`Record<string, unknown>` — T02). No prior ticket defines
// its shape per `RequestType`; these are this ticket's own interpretation (same documented-
// convention class as T09's `DeviceEvent.payload` conventions in digest.ts).

export interface ExtraTimeRequestPayload {
  categoryId: string;
  minutes: number;
  /**
   * The requesting device's own current `DailyUsageState` snapshot for the day. There is no
   * backend `daily_usage` table anywhere in this schema — by design, not an oversight: T21's own
   * ticket text establishes that all `BucketEngine`/`DailyUsageState` state is device-local,
   * offline-first (spec §7); the backend never persists a running usage total. Approval mutates
   * *this* child-supplied snapshot via `applyApprovedExtraTime` and returns the result to the
   * resolving parent's client; propagating the grant back down to the requesting device for it
   * to apply to its own local state is a future ticket's concern (T07's LEDGER entry already
   * flags the matching gap — no device-scoped SELECT on `child_request` yet for a device to read
   * back its own request's resolution).
   */
  currentDailyUsage: DailyUsageState;
}

export interface UnblockRequestPayload {
  scope: 'app' | 'domain';
  target: string;
}

export interface ScheduleChangeRequestPayload {
  schedule: SchedulePolicy;
}

// --- Request creation ----------------------------------------------------------------------

const REQUEST_TYPE_BODY: Record<RequestType, string> = {
  extra_time: 'Your child requested extra screen time.',
  unblock: 'Your child requested to unblock a site or app.',
  schedule_change: 'Your child requested a schedule change.',
};

// "Push to parent devices" (spec §3.6) reconciliation — same as T08/T09's LEDGER entries: no
// parent-owned device/push-token concept exists anywhere in this schema (Device is always
// childId-scoped), so this targets the child's own registered devices with a push token, same
// set every prior push-dispatching ticket uses.
export function buildRequestCreatedPushPayload(
  request: Pick<ChildRequest, 'id' | 'childId' | 'type'>,
): PushDispatchPayload {
  return {
    title: 'New request from your child',
    body: REQUEST_TYPE_BODY[request.type],
    data: {
      type: 'child_request',
      requestId: request.id,
      childId: request.childId,
      requestType: request.type,
    },
    priority: 'high',
  };
}

// --- Approve mutations -----------------------------------------------------------------------

/** Grants the requested minutes back against the device-supplied usage snapshot (see
 * `ExtraTimeRequestPayload.currentDailyUsage` above for why this isn't backend-persisted). */
export function buildExtraTimeGrant(payload: ExtraTimeRequestPayload): DailyUsageState {
  return applyApprovedExtraTime(payload.currentDailyUsage, payload.categoryId, payload.minutes);
}

/**
 * Moves `payload.target` from blocked to allowed on the relevant sub-policy — mutual exclusivity
 * (never present in both lists at once), same convention T16's `InstallAlertsScreen` established
 * for the reverse (block) direction. `scope: 'app'` touches `AppRulePolicy`; `scope: 'domain'`
 * touches `ContentFilterPolicy`'s custom domain lists.
 */
export function buildUnblockPolicyUpdate(
  current: Policy,
  payload: UnblockRequestPayload,
): Partial<Pick<Policy, 'appRules' | 'contentFilter'>> {
  if (payload.scope === 'app') {
    const appRules: AppRulePolicy = {
      ...current.appRules,
      blockedApps: current.appRules.blockedApps.filter((id) => id !== payload.target),
      allowedApps: current.appRules.allowedApps.includes(payload.target)
        ? current.appRules.allowedApps
        : [...current.appRules.allowedApps, payload.target],
    };
    return { appRules };
  }
  const contentFilter: ContentFilterPolicy = {
    ...current.contentFilter,
    customBlockDomains: current.contentFilter.customBlockDomains.filter((d) => d !== payload.target),
    customAllowDomains: current.contentFilter.customAllowDomains.includes(payload.target)
      ? current.contentFilter.customAllowDomains
      : [...current.contentFilter.customAllowDomains, payload.target],
  };
  return { contentFilter };
}

/**
 * Upserts `payload.schedule` into `current.schedules` by id (replace if an entry with that id
 * already exists, else append) — the child-supplied `SchedulePolicy.id` is expected to follow
 * the same `sch_<ts><rand>` scheme `app/src/parent/policy/SchedulesScreen.tsx` already uses for
 * parent-created entries.
 */
export function buildScheduleChangePolicyUpdate(
  current: Policy,
  payload: ScheduleChangeRequestPayload,
): Partial<Pick<Policy, 'schedules'>> {
  const exists = current.schedules.some((s) => s.id === payload.schedule.id);
  const schedules = exists
    ? current.schedules.map((s) => (s.id === payload.schedule.id ? payload.schedule : s))
    : [...current.schedules, payload.schedule];
  return { schedules };
}
