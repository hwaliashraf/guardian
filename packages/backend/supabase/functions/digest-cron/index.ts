// T09: digest-cron edge function (Deno runtime). Intended to run on a weekly Supabase cron
// schedule — see supabase/config.toml's [functions.digest-cron] comment and SETUP.md's
// "Scheduled cron jobs" section for the exact pg_cron/pg_net wiring a deployed project needs
// (this CLI version has no native config.toml cron field for edge functions — confirmed via
// `supabase functions --help`; scheduling is a deployed-project/SQL concern, not verified here
// per the ticket's own "Out of scope" note).
//
// For each child: queries the past week's device_event rows, calls
// ../../../src/digest.ts's buildWeeklyDigest (pure, no I/O — covered by
// packages/backend/src/__tests__/digest.test.ts under Jest), dispatches one push, and logs a
// `digest` row (0004_digest.sql).
//
// No forwarded caller identity — this function is invoked by a scheduled job, not a specific
// parent/device, so it uses the service-role key throughout (same as vacation-cron; contrast
// policy-sync/event-ingest, which forward a real caller's JWT for RLS-enforced reads/writes).
import type { DeviceEvent } from '../../../../domain/src/types.ts';
import { buildWeeklyDigest, buildWeeklyDigestPushPayload } from '../../../src/digest.ts';
import {
  json,
  PostgrestError,
  restGet,
  restInsert,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} from '../_shared/postgrest.ts';
import { dispatchToDevices, fetchDevices, makeDispatcher } from '../_shared/push.ts';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface DeviceEventRow {
  id: string;
  device_id: string;
  child_id: string;
  type: DeviceEvent['type'];
  payload: Record<string, unknown>;
  occurred_at: string;
}

function rowToDeviceEvent(row: DeviceEventRow): DeviceEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    childId: row.child_id,
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}

/** Defaults to the most recently completed 7-day window ending at today's UTC midnight; a
 * `?weekStart=YYYY-MM-DD` query param overrides it (used for manual/verification invocation —
 * a live pg_cron schedule would omit it and always get "last week"). */
function resolveWeekStart(url: URL): Date {
  const override = url.searchParams.get('weekStart');
  if (override) return new Date(`${override}T00:00:00.000Z`);
  const todayMidnightUtc = new Date();
  todayMidnightUtc.setUTCHours(0, 0, 0, 0);
  return new Date(todayMidnightUtc.getTime() - WEEK_MS);
}

async function runDigestForChild(childId: string, weekStart: Date, weekEnd: Date): Promise<boolean> {
  const rows = (await restGet(
    `/device_event?child_id=eq.${childId}&occurred_at=gte.${weekStart.toISOString()}&occurred_at=lt.${weekEnd.toISOString()}`,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as DeviceEventRow[];
  const events = rows.map(rowToDeviceEvent);

  const summary = buildWeeklyDigest(events, childId, weekStart);
  await restInsert(
    '/digest',
    { child_id: childId, week_start: weekStart.toISOString().slice(0, 10), summary },
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  );

  const devices = await fetchDevices(`child_id=eq.${childId}`);
  const dispatcher = makeDispatcher();
  await dispatchToDevices(dispatcher, devices, buildWeeklyDigestPushPayload(childId, weekStart));
  return true;
}

async function handleDigestRun(url: URL) {
  const weekStart = resolveWeekStart(url);
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);

  const children = (await restGet('/child?select=id', SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)) as {
    id: string;
  }[];

  let digestsSent = 0;
  for (const child of children) {
    await runDigestForChild(child.id, weekStart, weekEnd);
    digestsSent += 1;
  }

  return json({ digestsSent, weekStart: weekStart.toISOString().slice(0, 10) });
}

Deno.serve(async (req: Request) => {
  try {
    return await handleDigestRun(new URL(req.url));
  } catch (err) {
    if (err instanceof PostgrestError) {
      return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
