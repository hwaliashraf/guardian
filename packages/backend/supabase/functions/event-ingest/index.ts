// T09: event-ingest edge function (Deno runtime).
//   POST /event-ingest — body is one DeviceEvent or an array of DeviceEvents from a child
//   device; inserts into device_event. presence_trigger/uninstall_attempt/service_disabled
//   events additionally trigger an immediate push dispatch (spec §3.7 tamper alerts + the
//   Phase-0 presence-trigger decision, both real-time — see LEDGER.md).
//
// Thin HTTP wrapper: dispatch-decision logic lives in ../../../src/eventIngest.ts (plain TS,
// no I/O, covered by packages/backend/src/__tests__/eventIngest.test.ts under Jest), same split
// T08 established for policy-sync/index.ts + src/policySync.ts.
//
// Two Postgres roles, two different reasons (least-privilege, same rationale as policy-sync):
//   - the calling DEVICE's own forwarded JWT (Authorization header) + anon key, for the
//     device_event INSERT — T07's RLS grants the device role exactly this (INSERT-only,
//     device_id/child_id must match the JWT's own claims), so this path stays RLS-enforced
//     rather than a blanket service-role bypass.
//   - the service-role key for everything else this function needs: reading `device.push_token`
//     to know who to dispatch to (T07's RLS gives the device role NO select policy on `device`
//     at all) and writing `push_log` (no anon/authenticated policy on it by design, same as T08).
//
// T17: `location_update` events additionally trigger server-side geofence evaluation
// (../../../src/geofence.ts's evaluateGeofences, pure). The resulting geofence_enter/leave
// device_event rows are system-derived (not literally reported by the device), so — same
// service-role rationale as push_log/digest — they're written with the service-role key, not
// the forwarded device JWT.
import type { DeviceEvent, EventType, Geofence } from '../../../../domain/src/types.ts';
import { dispatchEventAlerts, type PushSender } from '../../../src/eventIngest.ts';
import { buildGeofencePushPayload, evaluateGeofences } from '../../../src/geofence.ts';
import {
  json,
  PostgrestError,
  restGet,
  restInsert,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} from '../_shared/postgrest.ts';
import { fetchDevices, makeDispatcher } from '../_shared/push.ts';
import type { PushDispatcher } from '../push/dispatcher.ts';

interface DeviceEventInput {
  deviceId: string;
  childId: string;
  type: EventType;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

interface DeviceEventRow {
  id: string;
  device_id: string;
  child_id: string;
  type: EventType;
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

interface GeofenceRow {
  id: string;
  child_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  alert_on_enter: boolean;
  alert_on_leave: boolean;
}

function rowToGeofence(row: GeofenceRow): Geofence {
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    radiusMeters: row.radius_meters,
    alertOnEnter: row.alert_on_enter,
    alertOnLeave: row.alert_on_leave,
  };
}

// The child's current in/out state has no persisted table (evaluateGeofences takes it as a
// plain input) — derived from the latest geofence_enter/geofence_leave device_event row per
// geofence id, newest-first so the first row seen per geofenceId is authoritative.
async function loadPreviouslyInside(childId: string): Promise<Set<string>> {
  const rows = (await restGet(
    `/device_event?child_id=eq.${childId}&type=in.(geofence_enter,geofence_leave)&order=occurred_at.desc&select=type,payload`,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as { type: EventType; payload: Record<string, unknown> }[];

  const seen = new Set<string>();
  const inside = new Set<string>();
  for (const row of rows) {
    const geofenceId = typeof row.payload.geofenceId === 'string' ? row.payload.geofenceId : null;
    if (!geofenceId || seen.has(geofenceId)) continue;
    seen.add(geofenceId);
    if (row.type === 'geofence_enter') inside.add(geofenceId);
  }
  return inside;
}

// Evaluates every location_update event for one child (in insertion order, so within-batch
// enter->leave sequences update `previouslyInside` incrementally instead of only looking at the
// first event), inserting the resulting geofence_enter/leave rows and dispatching a push per
// transition whose geofence has that alert flag on. Returns the count of pushes dispatched.
async function evaluateAndDispatchGeofences(
  childId: string,
  locationEvents: DeviceEvent[],
  devices: { id: string; pushToken: string | null }[],
  dispatcher: PushDispatcher,
): Promise<number> {
  if (locationEvents.length === 0) return 0;

  const geofenceRows = (await restGet(
    `/geofence?child_id=eq.${childId}`,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
  )) as GeofenceRow[];
  if (geofenceRows.length === 0) return 0;
  const geofences = geofenceRows.map(rowToGeofence);
  const geofenceById = new Map(geofences.map((g) => [g.id, g]));

  const previouslyInside = await loadPreviouslyInside(childId);
  const targets = devices.filter((d): d is { id: string; pushToken: string } => !!d.pushToken);

  let dispatched = 0;
  for (const locEvent of locationEvents) {
    const lat = typeof locEvent.payload.lat === 'number' ? locEvent.payload.lat : null;
    const lng = typeof locEvent.payload.lng === 'number' ? locEvent.payload.lng : null;
    if (lat === null || lng === null) continue;

    const { entered, left } = evaluateGeofences(geofences, { lat, lng }, previouslyInside);

    for (const geofenceId of entered) previouslyInside.add(geofenceId);
    for (const geofenceId of left) previouslyInside.delete(geofenceId);

    const transitions: { geofenceId: string; kind: 'enter' | 'leave' }[] = [
      ...entered.map((geofenceId) => ({ geofenceId, kind: 'enter' as const })),
      ...left.map((geofenceId) => ({ geofenceId, kind: 'leave' as const })),
    ];
    if (transitions.length === 0) continue;

    await restInsert(
      '/device_event',
      transitions.map(({ geofenceId, kind }) => ({
        device_id: locEvent.deviceId,
        child_id: childId,
        type: kind === 'enter' ? 'geofence_enter' : 'geofence_leave',
        payload: { geofenceId },
        occurred_at: locEvent.occurredAt,
      })),
      SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY,
    );

    for (const { geofenceId, kind } of transitions) {
      const geofence = geofenceById.get(geofenceId);
      if (!geofence) continue;
      if ((kind === 'enter' && !geofence.alertOnEnter) || (kind === 'leave' && !geofence.alertOnLeave)) continue;
      const payload = buildGeofencePushPayload(geofence, kind);
      await Promise.all(targets.map((d) => dispatcher.send(d.id, d.pushToken, payload)));
      dispatched += targets.length;
    }
  }

  return dispatched;
}

function inputToInsertRow(input: DeviceEventInput): Record<string, unknown> {
  return {
    device_id: input.deviceId,
    child_id: input.childId,
    type: input.type,
    payload: input.payload,
    ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
  };
}

async function handleIngest(bearer: string, body: unknown) {
  const inputs = (Array.isArray(body) ? body : [body]) as DeviceEventInput[];
  if (inputs.length === 0) {
    return json({ error: 'at least one DeviceEvent is required' }, 400);
  }

  const inserted = (await restInsert(
    '/device_event',
    inputs.map(inputToInsertRow),
    SUPABASE_ANON_KEY,
    bearer,
  )) as DeviceEventRow[];
  const events = inserted.map(rowToDeviceEvent);

  const dispatcher = makeDispatcher();
  const sender: PushSender = { send: (deviceId, deviceToken, payload) => dispatcher.send(deviceId, deviceToken, payload) };

  let devicesNotified = 0;
  const childIds = [...new Set(events.map((e) => e.childId))];
  for (const childId of childIds) {
    const childEvents = events.filter((e) => e.childId === childId);
    const devices = await fetchDevices(`child_id=eq.${childId}`);
    devicesNotified += await dispatchEventAlerts(childEvents, devices, sender);

    const locationEvents = childEvents.filter((e) => e.type === 'location_update');
    devicesNotified += await evaluateAndDispatchGeofences(childId, locationEvents, devices, dispatcher);
  }

  return json({ inserted: events.length, devicesNotified });
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization header' }, 401);
  const bearer = authHeader.replace(/^Bearer\s+/i, '');

  try {
    if (req.method === 'POST') {
      const body = await req.json();
      return await handleIngest(bearer, body);
    }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof PostgrestError) {
      return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
