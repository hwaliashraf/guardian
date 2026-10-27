// T17: pure geofence evaluation + location-history math. No I/O — importable by both the Jest
// suite (packages/backend/src/__tests__/geofence.test.ts) and the Deno edge function
// (packages/backend/supabase/functions/event-ingest/index.ts), same dual-runtime pattern T08
// established for policySync.ts (see that file's header comment for the full rationale).
import type { DeviceEvent, Geofence } from '../../domain/src/types.ts';
import type { PushDispatchPayload } from './policySync.ts';

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two lat/lng points, in meters.
function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceEvaluation {
  entered: string[]; // geofence ids newly inside `point`
  left: string[]; // geofence ids newly outside `point`
}

/**
 * Compares `point` against every geofence's boundary and diffs against `previouslyInside` (the
 * caller's own record of which geofence ids the child was inside as of the last evaluation) to
 * produce the enter/leave transitions. A point exactly on the boundary (distance === radius)
 * counts as inside (`<=`), matching the intuitive "on the fence line = inside" reading.
 */
export function evaluateGeofences(
  geofences: Geofence[],
  point: { lat: number; lng: number },
  previouslyInside: Set<string>,
): GeofenceEvaluation {
  const entered: string[] = [];
  const left: string[] = [];

  for (const geofence of geofences) {
    const distance = haversineDistanceMeters(point, { lat: geofence.lat, lng: geofence.lng });
    const isInside = distance <= geofence.radiusMeters;
    const wasInside = previouslyInside.has(geofence.id);

    if (isInside && !wasInside) entered.push(geofence.id);
    else if (!isInside && wasInside) left.push(geofence.id);
  }

  return { entered, left };
}

export function buildGeofencePushPayload(geofence: Geofence, kind: 'enter' | 'leave'): PushDispatchPayload {
  return {
    title: kind === 'enter' ? `Entered ${geofence.name}` : `Left ${geofence.name}`,
    body:
      kind === 'enter'
        ? `Your child's device entered the "${geofence.name}" area.`
        : `Your child's device left the "${geofence.name}" area.`,
    data: { type: `geofence_${kind}`, childId: geofence.childId, geofenceId: geofence.id },
    priority: 'high',
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Filters `events` to `location_update` rows for `childId` within the trailing `days`-day
 * window ending at `now` (inclusive lower bound), sorted newest-first — same "caller passes an
 * unfiltered, possibly multi-child event list; this function owns the filtering contract" shape
 * as `digest.ts`'s `buildWeeklyDigest`. Deletion of rows older than the window is a separate
 * data-retention job, out of this ticket's scope (see LEDGER.md/SETUP.md).
 */
export function getLocationHistory(events: DeviceEvent[], childId: string, days = 30, now: Date = new Date()): DeviceEvent[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return events
    .filter((e) => e.childId === childId && e.type === 'location_update' && new Date(e.occurredAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}
