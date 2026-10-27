// T09: push-dispatch wiring shared by event-ingest, digest-cron and vacation-cron — factored
// out of T08's policy-sync/index.ts (left untouched, see _shared/postgrest.ts's header comment
// for why). Default: LoggingPushDispatcher (writes to push_log, no network call) — swaps to
// FcmPushDispatcher only when FCM_SERVICE_ACCOUNT_JSON is set (never set in this environment).
import {
  FcmPushDispatcher,
  LoggingPushDispatcher,
  type PushDispatcher,
  type PushLogSink,
  type PushPayload,
} from '../push/dispatcher.ts';
import type { PushableDevice } from '../../../src/policySync.ts';
import {
  FCM_SERVICE_ACCOUNT_JSON,
  restGet,
  restInsert,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} from './postgrest.ts';

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

export function makeDispatcher(): PushDispatcher {
  const sink = makePushLogSink();
  if (FCM_SERVICE_ACCOUNT_JSON) {
    return new FcmPushDispatcher(FCM_SERVICE_ACCOUNT_JSON, sink);
  }
  return new LoggingPushDispatcher(sink);
}

/** Devices for one child (`childIdFilter`, e.g. `child_id=eq.<id>` or `child_id=in.(...)`) —
 * read with the service-role key: the `device` table has no anon/authenticated SELECT policy
 * for the device role (T07 RLS grants device INSERT-only on device_event, nothing else), and
 * cron-invoked callers have no forwarded caller JWT at all. */
export async function fetchDevices(childIdFilter: string): Promise<PushableDevice[]> {
  const rows = (await restGet(
    `/device?${childIdFilter}&select=id,push_token`,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as { id: string; push_token: string | null }[];
  return rows.map((r) => ({ id: r.id, pushToken: r.push_token }));
}

export async function dispatchToDevices(
  dispatcher: PushDispatcher,
  devices: PushableDevice[],
  payload: PushPayload,
): Promise<number> {
  const targets = devices.filter((d): d is PushableDevice & { pushToken: string } => !!d.pushToken);
  await Promise.all(targets.map((d) => dispatcher.send(d.id, d.pushToken as string, payload)));
  return targets.length;
}
