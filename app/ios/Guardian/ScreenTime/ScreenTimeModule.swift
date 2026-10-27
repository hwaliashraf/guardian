import Foundation
import FamilyControls
import React

/// React Native bridge exposing FamilyControls/ManagedSettings/DeviceActivity screen-time
/// enforcement to JS. Companion `ScreenTimeModule.m` registers it (`RCT_EXTERN_MODULE`) — same
/// Swift-authored-RN-module pattern as T26's `DNSFilterModule.swift`/`.m`; reuses T26's
/// `Guardian-Bridging-Header.h` (already wired into the app target's
/// `SWIFT_OBJC_BRIDGING_HEADER` build setting per SETUP.md — no second bridging header needed).
///
/// Also drains `GuardianDeviceActivityMonitor`'s pending-event queue (App Group-shared) and
/// forwards it to JS as an `RCTEventEmitter` event — see that extension's doc comment for why
/// the emitted payload is raw (`activityName`/`eventName`/`occurredAt`, not a full `DeviceEvent`)
/// and why that matches Android's already-established precedent.
///
/// Uses `PendingAppUsageEvent`/`ScreenTimeAppGroup` from `Shared/PendingAppUsageEvent.swift` —
/// that file's Xcode target membership must include the main `app` target (see its own doc
/// comment).
@objc(ScreenTimeModule)
final class ScreenTimeModule: RCTEventEmitter {
    private static let jsEventName = "guardianAppUsageEvent"

    private let authorization = ScreenTimeAuthorization()
    private let controller = ManagedSettingsController()
    private var hasListeners = false

    @objc override class func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! { [Self.jsEventName] }

    /// RN calls this once the first JS listener attaches — registering the Darwin observer only
    /// while someone's actually listening (rather than in `init`, whose override contract for an
    /// Objective-C base class like `RCTEventEmitter` can't be typechecked in this environment
    /// anyway — see SETUP.md) avoids doing background work with nothing to deliver it to.
    override func startObserving() {
        hasListeners = true
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                Unmanaged<ScreenTimeModule>.fromOpaque(observer).takeUnretainedValue().drainPendingEvents()
            },
            ScreenTimeAppGroup.darwinNotificationName,
            nil,
            .deliverImmediately
        )
        drainPendingEvents() // catch anything the extension queued before JS attached a listener
    }

    override func stopObserving() {
        hasListeners = false
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(ScreenTimeAppGroup.darwinNotificationName),
            nil
        )
    }

    @objc(requestAuthorization:rejecter:)
    func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        authorization.requestAuthorization { result in
            switch result {
            case .success:
                resolve(true)
            case .failure(let error):
                reject("SCREEN_TIME_AUTH_FAILED", String(describing: error), error as NSError)
            }
        }
    }

    @objc(getAuthorizationStatus:rejecter:)
    func getAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(Self.statusString(authorization.status))
    }

    /// `policy` is the JS bridge's `NSDictionary` form of a subset of T02's `Policy` — this
    /// module reads only the fields it can actually act on (`appRules.blockedApps`,
    /// `screenTime.dailyLimitMinutes`, `schedules[].{id,startTime,endTime}`) rather than
    /// requiring the whole `Policy` shape — same "minimal necessary subset" precedent as
    /// Android's `UsageAccountant`/`GuardianVpnService` (T22/T24).
    ///
    /// Requires a `FamilyActivitySelection` to already be persisted in the shared App Group
    /// (via a native picker screen not built by this ticket — see
    /// `ManagedSettingsController`'s doc comment) — rejects with `SCREEN_TIME_NO_SELECTION`
    /// otherwise rather than silently no-op-ing.
    @objc(applyPolicy:resolver:rejecter:)
    func applyPolicy(_ policy: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let selection = Self.loadSelection() else {
            reject(
                "SCREEN_TIME_NO_SELECTION",
                "No FamilyActivitySelection has been persisted yet — the parent must complete the app/site picker first.",
                nil
            )
            return
        }

        let blockedApps = (policy["appRules"] as? NSDictionary)?["blockedApps"] as? [Any] ?? []
        controller.applyShielding(blockedApps: blockedApps.map { "\($0)" }, selection: selection)

        do {
            if let dailyLimitMinutes = (policy["screenTime"] as? NSDictionary)?["dailyLimitMinutes"] as? Int {
                try controller.startDailyLimitMonitoring(dailyLimitMinutes: dailyLimitMinutes, selection: selection)
            }
            if let scheduleDicts = policy["schedules"] as? [NSDictionary] {
                let windows = scheduleDicts.compactMap { dict -> ScheduleWindow? in
                    guard let id = dict["id"] as? String,
                          let startTime = dict["startTime"] as? String,
                          let endTime = dict["endTime"] as? String else {
                        return nil
                    }
                    return ScheduleWindow(id: id, startTime: startTime, endTime: endTime)
                }
                try controller.startScheduleMonitoring(schedules: windows, selection: selection)
            }
        } catch {
            reject("SCREEN_TIME_MONITOR_FAILED", String(describing: error), error as NSError)
            return
        }

        resolve(true)
    }

    private func drainPendingEvents() {
        guard hasListeners,
              let defaults = UserDefaults(suiteName: ScreenTimeAppGroup.identifier),
              let data = defaults.data(forKey: ScreenTimeAppGroup.pendingEventsDefaultsKey),
              let pending = try? PropertyListDecoder().decode([PendingAppUsageEvent].self, from: data),
              !pending.isEmpty else {
            return
        }
        let isoFormatter = ISO8601DateFormatter()
        for event in pending {
            sendEvent(
                withName: Self.jsEventName,
                body: [
                    "activityName": event.activityName,
                    "eventName": event.eventName,
                    "occurredAt": isoFormatter.string(from: event.occurredAt),
                ]
            )
        }
        defaults.removeObject(forKey: ScreenTimeAppGroup.pendingEventsDefaultsKey)
    }

    private static func loadSelection() -> FamilyActivitySelection? {
        guard let defaults = UserDefaults(suiteName: ScreenTimeAppGroup.identifier),
              let data = defaults.data(forKey: "guardianFamilyActivitySelection") else {
            return nil
        }
        return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    private static func statusString(_ status: AuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .approved: return "approved"
        @unknown default: return "unknown"
        }
    }
}
