import DeviceActivity
import Foundation

/// Principal class for the `GuardianDeviceActivityMonitor` extension target
/// (`NSExtensionPointIdentifier: com.apple.deviceactivity.monitor-extension` in this target's
/// Info.plist, per `ManagedSettingsController`'s `startDailyLimitMonitoring`/
/// `startScheduleMonitoring` registrations). Runs in a separate, system-managed process — NOT
/// the main app — so it has no access to the app's RN bridge, auth/pairing state, or JS runtime
/// at all. It can only: (a) mutate `ManagedSettingsStore` directly (same process family/App
/// Group as the main app), and (b) hand data back to the main app indirectly, via the shared
/// App Group container + a Darwin notification to wake up `ScreenTimeModule` if the app is
/// running.
///
/// **Reporting convention matches Android's established precedent exactly (T22-T24's
/// `sendEvent`/`emitTamperEvent`/`emitSessionWarning`) — a documented, not new, gap**: this
/// extension emits only the raw fields it actually has (`activityName`, `eventName`,
/// `occurredAt`), NOT a full `DeviceEvent` (T02: `{id, deviceId, childId, type, payload,
/// occurredAt}`) — it has no `deviceId`/`childId`, exactly like Android's Kotlin modules never
/// emit a full `DeviceEvent` either (see e.g. `UsageModule.emitSessionWarning`, which sends only
/// `minutesRemaining`). `ScreenTimeModule` (main app, same App Group) drains this queue and
/// forwards the raw fields to JS as `guardianAppUsageEvent`; wrapping into a real `DeviceEvent`
/// (adding `id`/`deviceId`/`childId`) and posting through T09's `event-ingest` is JS-side work,
/// not yet built on either platform (same already-accepted class of gap T22-T24's LEDGER entries
/// flag: "no JS listener consumes this yet").
/// Uses `PendingAppUsageEvent`/`ScreenTimeAppGroup` from `Shared/PendingAppUsageEvent.swift` —
/// that file's Xcode target membership must include this extension target (see its own doc
/// comment; app extensions compile as a separate Swift module from the main app, so a
/// same-directory `.swift` file is NOT automatically visible here without explicit membership).
final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        enqueueAppUsageEvent(activityName: activity.rawValue, eventName: event.rawValue)
    }

    /// A schedule window (e.g. a `SchedulePolicy` bedtime row, via
    /// `ManagedSettingsController.startScheduleMonitoring`) starting/ending. **Not wired to
    /// actually apply/clear a shield here** — see `startScheduleMonitoring`'s doc comment on the
    /// `daysOfWeek` gap this callback would need to resolve first. This ticket wires the
    /// event-reporting path end-to-end (see `eventDidReachThreshold` above) but leaves
    /// schedule-window shield toggling as a documented follow-up, not silently dropped.
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
    }

    private func enqueueAppUsageEvent(activityName: String, eventName: String) {
        guard let defaults = UserDefaults(suiteName: ScreenTimeAppGroup.identifier) else { return }
        var pending: [PendingAppUsageEvent] = []
        if let data = defaults.data(forKey: ScreenTimeAppGroup.pendingEventsDefaultsKey),
           let decoded = try? PropertyListDecoder().decode([PendingAppUsageEvent].self, from: data) {
            pending = decoded
        }
        pending.append(PendingAppUsageEvent(activityName: activityName, eventName: eventName, occurredAt: Date()))
        if let encoded = try? PropertyListEncoder().encode(pending) {
            defaults.set(encoded, forKey: ScreenTimeAppGroup.pendingEventsDefaultsKey)
        }
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(ScreenTimeAppGroup.darwinNotificationName),
            nil,
            nil,
            true
        )
    }
}
