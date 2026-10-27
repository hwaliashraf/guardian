import type { DeviceEvent, Geofence } from '../../../domain/src/types';
import { buildGeofencePushPayload, evaluateGeofences, getLocationHistory } from '../geofence';

function geofence(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 'gf-1',
    childId: 'child-1',
    name: 'Home',
    lat: 40.0,
    lng: -73.0,
    radiusMeters: 100,
    alertOnEnter: true,
    alertOnLeave: true,
    ...overrides,
  };
}

const INSIDE_POINT = { lat: 40.0, lng: -73.0 }; // exact center, always inside
const FAR_POINT = { lat: 41.0, lng: -74.0 }; // ~140km away, always outside

describe('evaluateGeofences', () => {
  it('enter case: point newly inside a geofence not previously inside', () => {
    const result = evaluateGeofences([geofence()], INSIDE_POINT, new Set());
    expect(result).toEqual({ entered: ['gf-1'], left: [] });
  });

  it('leave case: point newly outside a geofence previously inside', () => {
    const result = evaluateGeofences([geofence()], FAR_POINT, new Set(['gf-1']));
    expect(result).toEqual({ entered: [], left: ['gf-1'] });
  });

  it('no-change case: still inside stays inside, no transition reported', () => {
    const result = evaluateGeofences([geofence()], INSIDE_POINT, new Set(['gf-1']));
    expect(result).toEqual({ entered: [], left: [] });
  });

  it('no-change case: still outside stays outside, no transition reported', () => {
    const result = evaluateGeofences([geofence()], FAR_POINT, new Set());
    expect(result).toEqual({ entered: [], left: [] });
  });

  it('a point exactly on the radius boundary counts as inside', () => {
    // For two points on the same meridian (dLng = 0), the haversine formula this module uses
    // reduces exactly to `distance = EARTH_RADIUS_METERS * dLatRadians` (no approximation) — so
    // a radius of exactly `EARTH_RADIUS_METERS * radians(1deg)` puts a point 1 degree of
    // latitude away exactly on the boundary, genuinely exercising the `<=` (not `<`) comparison.
    const EARTH_RADIUS_METERS = 6371000;
    const oneDegreeInMeters = EARTH_RADIUS_METERS * (Math.PI / 180);
    const gf = geofence({ lat: 0, lng: 0, radiusMeters: oneDegreeInMeters });
    const onBoundary = { lat: 1, lng: 0 };
    const result = evaluateGeofences([gf], onBoundary, new Set());
    expect(result.entered).toEqual(['gf-1']);

    // Sanity: 1 meter further out is genuinely outside.
    const justOutside = evaluateGeofences([geofence({ lat: 0, lng: 0, radiusMeters: oneDegreeInMeters - 1 })], onBoundary, new Set());
    expect(justOutside.entered).toEqual([]);
  });

  it('evaluates multiple geofences independently in one call', () => {
    const near = geofence({ id: 'gf-near', lat: 40.0, lng: -73.0, radiusMeters: 100 });
    const far = geofence({ id: 'gf-far', lat: 41.0, lng: -74.0, radiusMeters: 100 });
    const result = evaluateGeofences([near, far], INSIDE_POINT, new Set(['gf-far']));
    expect(result.entered).toEqual(['gf-near']);
    expect(result.left).toEqual(['gf-far']);
  });

  it('empty geofence list produces no transitions', () => {
    expect(evaluateGeofences([], INSIDE_POINT, new Set())).toEqual({ entered: [], left: [] });
  });
});

describe('buildGeofencePushPayload', () => {
  it('builds a high-priority enter payload carrying childId/geofenceId', () => {
    const payload = buildGeofencePushPayload(geofence(), 'enter');
    expect(payload.priority).toBe('high');
    expect(payload.data).toEqual({ type: 'geofence_enter', childId: 'child-1', geofenceId: 'gf-1' });
  });

  it('builds a high-priority leave payload', () => {
    const payload = buildGeofencePushPayload(geofence(), 'leave');
    expect(payload.data.type).toBe('geofence_leave');
  });
});

let nextId = 1;
function event(overrides: Partial<DeviceEvent> = {}): DeviceEvent {
  return {
    id: `event-${nextId++}`,
    deviceId: 'device-1',
    childId: 'child-1',
    type: 'location_update',
    payload: { lat: 40.0, lng: -73.0 },
    occurredAt: '2026-07-16T12:00:00.000Z',
    ...overrides,
  };
}

describe('getLocationHistory', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  it('includes location_update events for the given child within the trailing window', () => {
    const events = [event({ id: 'e1', occurredAt: '2026-07-15T00:00:00.000Z' })];
    expect(getLocationHistory(events, 'child-1', 30, now).map((e) => e.id)).toEqual(['e1']);
  });

  it('excludes events for a different child', () => {
    const events = [event({ childId: 'child-2' })];
    expect(getLocationHistory(events, 'child-1', 30, now)).toEqual([]);
  });

  it('excludes non-location_update event types', () => {
    const events = [event({ type: 'app_usage' })];
    expect(getLocationHistory(events, 'child-1', 30, now)).toEqual([]);
  });

  it('caps the range correctly: an event exactly at the 30-day cutoff is included', () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const events = [event({ id: 'e-at-cutoff', occurredAt: cutoff })];
    expect(getLocationHistory(events, 'child-1', 30, now).map((e) => e.id)).toEqual(['e-at-cutoff']);
  });

  it('caps the range correctly: an event 1ms older than the 30-day cutoff is excluded', () => {
    const tooOld = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1).toISOString();
    const events = [event({ id: 'e-too-old', occurredAt: tooOld })];
    expect(getLocationHistory(events, 'child-1', 30, now)).toEqual([]);
  });

  it('sorts newest-first', () => {
    const events = [
      event({ id: 'older', occurredAt: '2026-07-10T00:00:00.000Z' }),
      event({ id: 'newer', occurredAt: '2026-07-15T00:00:00.000Z' }),
    ];
    expect(getLocationHistory(events, 'child-1', 30, now).map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('respects a custom days window (e.g. 7 days)', () => {
    const events = [
      event({ id: 'recent', occurredAt: '2026-07-15T00:00:00.000Z' }),
      event({ id: 'old', occurredAt: '2026-07-01T00:00:00.000Z' }),
    ];
    expect(getLocationHistory(events, 'child-1', 7, now).map((e) => e.id)).toEqual(['recent']);
  });
});
