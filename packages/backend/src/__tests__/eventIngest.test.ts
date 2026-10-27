import type { DeviceEvent } from '../../../domain/src/types';
import {
  buildEventAlertPushPayload,
  dispatchEventAlerts,
  shouldDispatchImmediately,
  type PushableDevice,
  type PushSender,
} from '../eventIngest';

let nextId = 1;
function event(overrides: Partial<DeviceEvent> = {}): DeviceEvent {
  return {
    id: `event-${nextId++}`,
    deviceId: 'device-1',
    childId: 'child-1',
    type: 'app_usage',
    payload: {},
    occurredAt: '2026-07-07T12:00:00.000Z',
    ...overrides,
  };
}

function fakeDispatcher(): PushSender & { calls: { deviceId: string; deviceToken: string }[] } {
  const calls: { deviceId: string; deviceToken: string }[] = [];
  return {
    calls,
    async send(deviceId, deviceToken) {
      calls.push({ deviceId, deviceToken });
    },
  };
}

describe('shouldDispatchImmediately', () => {
  it('is true for presence_trigger and both tamper event types', () => {
    expect(shouldDispatchImmediately('presence_trigger')).toBe(true);
    expect(shouldDispatchImmediately('uninstall_attempt')).toBe(true);
    expect(shouldDispatchImmediately('service_disabled')).toBe(true);
  });

  it('is false for ordinary usage/browsing event types', () => {
    expect(shouldDispatchImmediately('app_usage')).toBe(false);
    expect(shouldDispatchImmediately('block_attempt')).toBe(false);
    expect(shouldDispatchImmediately('search_query')).toBe(false);
    expect(shouldDispatchImmediately('youtube_view')).toBe(false);
    expect(shouldDispatchImmediately('new_install')).toBe(false);
    expect(shouldDispatchImmediately('location_update')).toBe(false);
    expect(shouldDispatchImmediately('geofence_enter')).toBe(false);
    expect(shouldDispatchImmediately('geofence_leave')).toBe(false);
  });
});

describe('buildEventAlertPushPayload', () => {
  it('builds a high-priority presence_trigger payload carrying childId/deviceId', () => {
    const payload = buildEventAlertPushPayload(event({ type: 'presence_trigger' }));
    expect(payload.priority).toBe('high');
    expect(payload.data).toEqual({ type: 'presence_trigger', childId: 'child-1', deviceId: 'device-1' });
  });

  it('builds a high-priority tamper payload for uninstall_attempt and service_disabled', () => {
    expect(buildEventAlertPushPayload(event({ type: 'uninstall_attempt' })).priority).toBe('high');
    expect(buildEventAlertPushPayload(event({ type: 'service_disabled' })).priority).toBe('high');
    expect(buildEventAlertPushPayload(event({ type: 'uninstall_attempt' })).data.type).toBe('uninstall_attempt');
    expect(buildEventAlertPushPayload(event({ type: 'service_disabled' })).data.type).toBe('service_disabled');
  });
});

describe('dispatchEventAlerts', () => {
  const devices: PushableDevice[] = [
    { id: 'd1', pushToken: 'token-1' },
    { id: 'd2', pushToken: null },
  ];

  it('calls PushDispatcher.send for a presence_trigger event, once per device with a token', async () => {
    const dispatcher = fakeDispatcher();
    const count = await dispatchEventAlerts([event({ type: 'presence_trigger' })], devices, dispatcher);
    expect(count).toBe(1);
    expect(dispatcher.calls).toEqual([{ deviceId: 'd1', deviceToken: 'token-1' }]);
  });

  it('calls PushDispatcher.send for uninstall_attempt and service_disabled events', async () => {
    const dispatcher = fakeDispatcher();
    const count = await dispatchEventAlerts(
      [event({ type: 'uninstall_attempt' }), event({ type: 'service_disabled' })],
      devices,
      dispatcher,
    );
    expect(count).toBe(2);
    expect(dispatcher.calls).toHaveLength(2);
  });

  it('does NOT call PushDispatcher.send for an ordinary app_usage event', async () => {
    const dispatcher = fakeDispatcher();
    const count = await dispatchEventAlerts([event({ type: 'app_usage' })], devices, dispatcher);
    expect(count).toBe(0);
    expect(dispatcher.calls).toEqual([]);
  });

  it('mixed batch dispatches only for the qualifying events', async () => {
    const dispatcher = fakeDispatcher();
    const count = await dispatchEventAlerts(
      [event({ type: 'app_usage' }), event({ type: 'presence_trigger' }), event({ type: 'search_query' })],
      devices,
      dispatcher,
    );
    expect(count).toBe(1);
  });
});
