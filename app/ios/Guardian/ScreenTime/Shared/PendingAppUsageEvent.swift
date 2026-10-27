import Foundation

/// Shared between the main `app` target and the `GuardianDeviceActivityMonitor` extension
/// target — **this file's Xcode target membership must include BOTH targets** (App extension
/// targets and the main app target compile as separate Swift modules; a type defined in only
/// one is invisible to the other even though they run in the same process family and share an
/// App Group). See SETUP.md's "Xcode / CocoaPods" section for the manual Xcode step this
/// environment cannot perform headlessly (no project-file editor available without the Xcode
/// GUI). `ScreenTimeModule.swift` (main app) and `DeviceActivityMonitorExtension.swift`
/// (extension) both reference this exact type by name — keep it here, not duplicated, so the
/// two can never drift apart.
struct PendingAppUsageEvent: Codable {
    let activityName: String
    let eventName: String
    let occurredAt: Date
}

/// Shared App Group identifiers/keys both targets need to agree on byte-for-byte. Also target
/// membership: BOTH the main app and `GuardianDeviceActivityMonitor`.
enum ScreenTimeAppGroup {
    static let identifier = "group.com.guardian.app"
    static let pendingEventsDefaultsKey = "guardianPendingAppUsageEvents"
    static let darwinNotificationName = "com.guardian.screenTime.eventPending" as CFString
}
