// T09: vacation-cron edge function (Deno runtime). Intended to run on a scheduled Supabase
// cron (see supabase/config.toml's [functions.vacation-cron] comment + SETUP.md's "Scheduled
// cron jobs" section for the pg_cron/pg_net wiring a deployed project needs — not verified
// running on a live schedule here, per the ticket's "Out of scope" note; same as digest-cron).
//
// Loads every child's ACTIVE (latest-version) Policy, calls ../../../domain/src/schedules/
// vacation.ts's shouldAutoRestore (T05, via ../../../src/vacationCron.ts's
// selectVacationsToRestore — pure, no I/O, covered by
// packages/backend/src/__tests__/vacationCron.test.ts under Jest), and for any that should
// restore: flips vacation.enabled off, bumps version (reuses T08's buildNextPolicyVersion via
// vacationCron.ts — not duplicated), inserts the new policy row, and dispatches a push.
//
// No forwarded caller identity (cron-invoked) — service-role key throughout, same as
// digest-cron; contrast policy-sync/event-ingest, which forward a real caller's JWT.
import type { Policy } from '../../../../domain/src/types.ts';
import { buildVacationRestorePushPayload, buildVacationRestoreUpdate, selectVacationsToRestore } from '../../../src/vacationCron.ts';
import {
  json,
  PostgrestError,
  restGet,
  restInsert,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} from '../_shared/postgrest.ts';
import { dispatchToDevices, fetchDevices, makeDispatcher } from '../_shared/push.ts';

// Mirrors policy-sync/index.ts's row<->domain mapping (T08) — not imported from there since
// that file doesn't export it (private to its own module) and this ticket doesn't touch T08's
// already-verified file; see LEDGER.md's T09 entry.
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

/** Every policy row, latest version first per child (client-side reduction — this cron runs
 * infrequently, correctness over a fancier `DISTINCT ON` PostgREST query). */
async function fetchLatestPolicyPerChild(): Promise<Policy[]> {
  const rows = (await restGet(
    '/policy?select=*&order=child_id.asc,version.desc',
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as PolicyRow[];
  const latestByChild = new Map<string, PolicyRow>();
  for (const row of rows) {
    if (!latestByChild.has(row.child_id)) latestByChild.set(row.child_id, row);
  }
  return [...latestByChild.values()].map(rowToPolicy);
}

async function handleVacationRun() {
  const now = new Date();
  const activePolicies = await fetchLatestPolicyPerChild();
  const toRestore = selectVacationsToRestore(activePolicies, now);

  let devicesNotified = 0;
  for (const current of toRestore) {
    const next = buildVacationRestoreUpdate(current);
    await restInsert('/policy', policyToInsertRow(next, current.childId), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY);

    const devices = await fetchDevices(`child_id=eq.${current.childId}`);
    const dispatcher = makeDispatcher();
    devicesNotified += await dispatchToDevices(dispatcher, devices, buildVacationRestorePushPayload(current.childId));
  }

  return json({ restoredCount: toRestore.length, devicesNotified });
}

Deno.serve(async () => {
  try {
    return await handleVacationRun();
  } catch (err) {
    if (err instanceof PostgrestError) {
      return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
