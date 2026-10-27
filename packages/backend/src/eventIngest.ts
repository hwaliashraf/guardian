// T09: pure event-ingest dispatch-decision logic. No I/O — importable by both the Jest suite
// (packages/backend/src/__tests__/eventIngest.test.ts) and the Deno edge function
// (packages/backend/supabase/functions/event-ingest/index.ts), same dual-runtime pattern T08
// established for policySync.ts (see that file's header comment for the full rationale).
import type { DeviceEvent, EventType } from '../../domain/src/types.ts';
import { devicesToNotify, type PushableDevice, type PushDispatchPayload } from './policySync.ts';

export type { PushableDevice, PushDispatchPayload };

// Minimal structural dependency this module needs to dispatch a push — deliberately not
// `supabase/functions/push/dispatcher.ts`'s `PushDispatcher` (that file is Deno-only, per its
// own header comment; policySync.ts already established the pattern of this src/ package
// defining its own narrow, structurally-compatible interface instead of importing it).
export interface PushSender {
  send(deviceId: string, deviceToken: string, payload: PushDispatchPayload): Promise<void>;
}

// Spec §3.7 tamper alerts (uninstall_attempt/service_disabled) and the Phase-0 presence-trigger
// decision (LEDGER.md) are both real-time, independent of the weekly digest — every other event
// type rides the digest-only path (T09 requirement #1).
const IMMEDIATE_DISPATCH_TYPES: ReadonlySet<EventType> = new Set([
  'presence_trigger',
  'uninstall_attempt',
  'service_disabled',
]);

export function shouldDispatchImmediately(type: EventType): boolean {
  return IMMEDIATE_DISPATCH_TYPES.has(type);
}

export function buildEventAlertPushPayload(event: DeviceEvent): PushDispatchPayload {
  if (event.type === 'presence_trigger') {
    return {
      title: 'Presence check-in',
      body: "Your child's device flagged a presence trigger.",
      data: { type: 'presence_trigger', childId: event.childId, deviceId: event.deviceId },
      priority: 'high',
    };
  }
  return {
    title: 'Tamper alert',
    body:
      event.type === 'uninstall_attempt'
        ? 'An uninstall attempt was detected on a monitored device.'
        : 'Guardian was disabled on a monitored device.',
    data: { type: event.type, childId: event.childId, deviceId: event.deviceId },
    priority: 'high',
  };
}

/**
 * Dispatches an alert push for every event in `events` that qualifies for immediate dispatch
 * (see `shouldDispatchImmediately`), to every device in `devices` that has a push token.
 * `dispatcher` is injected (dependency inversion, same style as policySync.ts's pure builders)
 * so this is fully unit-testable with a fake sender — no network/DB access here.
 *
 * "Which devices" reconciliation (documented per LEDGER.md T09 entry): the ticket's prose says
 * "the child's parent devices", but neither T02's `Parent` type nor T07's schema has any
 * parent-owned device/push-token concept — `device` is always child_id-scoped. T08 already
 * established that a dispatched push targets the child's own registered devices with a push
 * token; this reuses that same set (there is nothing else to dispatch to).
 */
export async function dispatchEventAlerts(
  events: DeviceEvent[],
  devices: PushableDevice[],
  dispatcher: PushSender,
): Promise<number> {
  const alertEvents = events.filter((e) => shouldDispatchImmediately(e.type));
  if (alertEvents.length === 0) return 0;

  const targets = devicesToNotify(devices);
  let dispatchCount = 0;
  for (const event of alertEvents) {
    const payload = buildEventAlertPushPayload(event);
    await Promise.all(targets.map((d) => dispatcher.send(d.id, d.pushToken as string, payload)));
    dispatchCount += targets.length;
  }
  return dispatchCount;
}
