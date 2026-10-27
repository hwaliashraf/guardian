import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity

/// Translates Guardian's cross-platform policy shapes (T02) into Apple's ManagedSettings/
/// DeviceActivity primitives.
///
/// **Platform capability gap, verified against the real SDK interfaces (not assumed)**:
/// `AppRulePolicy.blockedApps`/`ContentFilterPolicy.customBlockDomains` (T02) are plain
/// bundle-identifier/domain strings — the same convention Android's `BlocklistLoader`/
/// `UsageAccountant` (T22/T24) use. But `ManagedSettingsStore.shield.applications`/`.webDomains`
/// require `Set<ApplicationToken>`/`Set<WebDomainToken>`, and neither token type has any public
/// initializer that accepts a bundle id or domain string — confirmed by reading
/// `ManagedSettings.swiftinterface` directly: `ApplicationToken`/`WebDomainToken` are both
/// `Token<T>` (opaque, `Codable`/`Hashable`, no public init at all); `WebDomain.init(domain:)`
/// exists but leaves that `WebDomain`'s `.token` `nil` (only a system-provided `WebDomain` has a
/// real token) — so it cannot populate `store.shield.webDomains` either. This is Apple's
/// intentional privacy design: these opaque tokens are ONLY ever obtainable from the user/parent
/// picking apps/sites in a system `FamilyActivityPicker` (FamilyControls, SwiftUI-only); no app
/// can enumerate or address another app's identity directly by bundle id.
///
/// Consequence: `AppRulePolicy.blockedApps`'s bundle-id strings **cannot be mechanically
/// translated into shielding** the way Android's `BlocklistLoader.kt` mechanically translates
/// blocklist domains into DNS rules. The real source of truth for WHICH apps/sites get shielded
/// on iOS is a `FamilyActivitySelection` the parent previously chose via a native
/// `FamilyActivityPicker` screen — **not built by this ticket** (a SwiftUI picker UI is outside
/// this ticket's RN-bridge-module scope; `ScreenTimeModule`'s 3 required methods are
/// `requestAuthorization`/`applyPolicy`/`getAuthorizationStatus`, no picker-presentation method).
/// `blockedApps`/`customBlockDomains` being non-empty is therefore used here only as the on/off
/// switch for whether the parent's already-chosen selection is currently shielded, never as the
/// selection's source. **RISK, flagged for whichever future ticket builds the picker UI.**
struct ManagedSettingsController {
    /// Single named store for all of Guardian's shielding, distinguishing it from any other
    /// app-defined store the system might have (iOS 16+ supports multiple named stores;
    /// `.default` would also work but a dedicated name makes debugging/clearing unambiguous).
    private static let storeName = ManagedSettingsStore.Name("guardian")
    static let dailyLimitActivityName = DeviceActivityName("com.guardian.screenTime.dailyLimit")
    static let dailyLimitEventName = DeviceActivityEvent.Name("dailyLimitReached")

    private let store: ManagedSettingsStore
    private let activityCenter: DeviceActivityCenter

    init(
        store: ManagedSettingsStore = ManagedSettingsStore(named: ManagedSettingsController.storeName),
        activityCenter: DeviceActivityCenter = DeviceActivityCenter()
    ) {
        self.store = store
        self.activityCenter = activityCenter
    }

    /// Applies (or clears) app/site shielding. `selection` is the parent's most recently
    /// persisted `FamilyActivityPicker` result — see the type-level doc comment for why this
    /// can't be derived from `blockedApps` bundle-id strings alone; `blockedApps.isEmpty` is
    /// used purely as the on/off switch for the already-chosen selection.
    ///
    /// Content-category shielding (`ContentFilterPolicy.categories`) is intentionally NOT wired
    /// to `store.shield.applicationCategories`/`webDomainCategories` here — those take
    /// ManagedSettings' OWN `ActivityCategoryToken` (Apple's App Store category taxonomy, itself
    /// only obtainable via the same picker), not Guardian's `contentCategories.ts` (T15) id
    /// space; there is no mapping between the two taxonomies. iOS category-level filtering
    /// already happens at the DNS layer (T26's `DNSFilterManager`, server-side DoH resolver).
    func applyShielding(blockedApps: [String], selection: FamilyActivitySelection) {
        if blockedApps.isEmpty {
            store.shield.applications = nil
            store.shield.webDomains = nil
        } else {
            store.shield.applications = selection.applicationTokens
            store.shield.webDomains = selection.webDomainTokens
        }
    }

    /// Starts monitoring the family's daily screen-time cap (`ScreenTimePolicy.dailyLimitMinutes`,
    /// T02). `DeviceActivityEvent`'s `threshold` fires `eventDidReachThreshold` (handled by
    /// `GuardianDeviceActivityMonitor`'s extension target) once cumulative usage of the selected
    /// apps/sites crosses it within the schedule's daily interval — this is the only signal
    /// DeviceActivity gives back (a one-shot threshold-crossing callback per interval, not a
    /// live per-minute stream), so one `DeviceActivityEvent` maps directly to one daily cap.
    func startDailyLimitMonitoring(dailyLimitMinutes: Int, selection: FamilyActivitySelection) throws {
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
        )
        let dailyLimitEvent = DeviceActivityEvent(
            applications: selection.applicationTokens,
            webDomains: selection.webDomainTokens,
            threshold: DateComponents(minute: dailyLimitMinutes)
        )
        try activityCenter.startMonitoring(
            Self.dailyLimitActivityName,
            during: schedule,
            events: [Self.dailyLimitEventName: dailyLimitEvent]
        )
    }

    /// Starts monitoring per-schedule windows (`SchedulePolicy`, T02 — e.g. bedtime) as their
    /// own `DeviceActivitySchedule`s, one `DeviceActivityName` per schedule row (keyed by
    /// `schedule.id` so `stopScheduleMonitoring` can target the same set later).
    ///
    /// **Documented platform gap**: `DeviceActivitySchedule` (confirmed from
    /// `DeviceActivity.swiftinterface`) has only `intervalStart`/`intervalEnd`/`repeats`/
    /// `warningTime` — there is no day-of-week field at all, unlike `SchedulePolicy.daysOfWeek`
    /// (T02/T05's weekday-scoped-rows convention, e.g. separate Mon-Thu vs Fri-Sat bedtime
    /// rows). A `repeats: true` schedule here fires **every day** at the given start/end
    /// time-of-day, regardless of `daysOfWeek`. Correctly restricting to specific weekdays
    /// requires the monitor extension's `intervalDidStart`/`intervalDidEnd` callbacks to
    /// self-check `Calendar.current.component(.weekday, from: Date())` against the original
    /// `SchedulePolicy.daysOfWeek` before actually applying/clearing a shield — **not wired in
    /// this ticket** (the extension only reports the interval boundary event today; see
    /// `GuardianDeviceActivityMonitor`'s doc comment). Flagged as a RISK, not silently dropped.
    func startScheduleMonitoring(schedules: [ScheduleWindow], selection: FamilyActivitySelection) throws {
        for schedule in schedules {
            guard let start = Self.parseTimeOfDay(schedule.startTime),
                  let end = Self.parseTimeOfDay(schedule.endTime) else {
                continue
            }
            let activitySchedule = DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: true)
            try activityCenter.startMonitoring(DeviceActivityName(schedule.id), during: activitySchedule)
        }
    }

    func stopScheduleMonitoring(scheduleIds: [String]) {
        activityCenter.stopMonitoring(scheduleIds.map { DeviceActivityName($0) })
    }

    func stopAllMonitoring() {
        activityCenter.stopMonitoring()
    }

    /// Parses T02's `"HH:mm"` local-time convention (same format `packages/domain/src/
    /// schedules/engine.ts` expects) into `DateComponents(hour:minute:)`.
    private static func parseTimeOfDay(_ value: String) -> DateComponents? {
        let parts = value.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else {
            return nil
        }
        return DateComponents(hour: hour, minute: minute)
    }
}

/// Minimal necessary subset of `SchedulePolicy` (T02) this controller actually acts on — only
/// the two fields `DeviceActivitySchedule` can express (see `startScheduleMonitoring`'s doc
/// comment for the `daysOfWeek` gap). Not a full port of `SchedulePolicy` (that would falsely
/// imply `type`/`allowedCategories` are also honored here, which they are not).
struct ScheduleWindow {
    let id: String
    let startTime: String
    let endTime: String
}
