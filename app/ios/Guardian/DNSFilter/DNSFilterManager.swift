import Foundation
import NetworkExtension

/// Wraps `NEDNSSettingsManager` to install/remove a system-wide DNS Settings profile that routes
/// every DNS query through Guardian's DoH resolver.
///
/// **Platform capability gap, spec-acknowledged (spec §2.1's "reduced companion set"), not a
/// bug**: `NEDNSSettingsManager` only lets iOS specify *which* DNS server to use — unlike
/// Android's `VpnService`-based `GuardianVpnService.kt` (T22), which owns a TUN interface and can
/// inspect/rewrite individual packets, iOS has no equivalent local packet-level hook available to
/// a normal (non-`NEPacketTunnelProvider`) app. The category/domain/keyword decision table that
/// `packages/domain/src/vpn/dnsDecision.ts` specifies (and `DnsDecision.kt` mirrors for Android)
/// is therefore NOT evaluated locally on iOS at all — it must be evaluated **server-side, by the
/// DoH resolver itself** (or by a locally-run DoH resolver process, if Guardian ever ships one),
/// keyed off the same `ContentFilterPolicy` the family's `policy-sync` edge function (T08)
/// already syncs. This manager's only job is telling iOS to send all system DNS traffic to that
/// resolver; it never sees or decides on individual domains itself.
final class DNSFilterManager {
    enum DNSFilterError: Error {
        /// `NEDNSSettingsManager` is unavailable on this OS/device (should not happen on iOS 14+,
        /// the ticket's stated minimum).
        case notSupported
        case saveFailed(Error)
        case removeFailed(Error)
        case loadFailed(Error)
    }

    /// Guardian's DNS-over-HTTPS resolver endpoint, e.g. "https://dns.guardian.example/dns-query".
    /// Must itself enforce the family's active `ContentFilterPolicy` server-side — see the
    /// type-level doc comment above. Injected (not hardcoded) so `SETUP.md` can document
    /// pointing this at a real deployed resolver once one exists.
    private let resolverURL: URL
    private let settingsManager: NEDNSSettingsManager

    init(resolverURL: URL, settingsManager: NEDNSSettingsManager = NEDNSSettingsManager.shared()) {
        self.resolverURL = resolverURL
        self.settingsManager = settingsManager
    }

    /// Installs (or updates, if already installed) the DNS Settings profile. The user must
    /// approve the resulting system prompt the first time; `saveToPreferences` surfaces that as
    /// an error on the completion handler if declined, not a silent no-op.
    ///
    /// Loads current preferences first (same as `isActive`, below) before mutating/saving: per
    /// Apple's documented `NEDNSSettingsManagerErrorConfigurationStale` ("The DNS settings
    /// manager needs to be loaded"), `saveToPreferences` can fail if the manager's local state
    /// is stale relative to what's on disk — this matters here specifically because
    /// `installProfile` is a re-entrant "update if already installed" call, exactly the repeat
    /// scenario the staleness guard protects against.
    func installProfile(completion: @escaping (Result<Void, DNSFilterError>) -> Void) {
        settingsManager.loadFromPreferences { [weak self] _ in
            guard let self else { return }
            let dnsSettings = NEDNSOverHTTPSSettings(servers: [])
            dnsSettings.serverURL = self.resolverURL
            self.settingsManager.dnsSettings = dnsSettings
            self.settingsManager.saveToPreferences { error in
                if let error {
                    completion(.failure(.saveFailed(error)))
                } else {
                    completion(.success(()))
                }
            }
        }
    }

    /// Removes the DNS Settings profile, restoring the device's normal DNS resolution.
    func removeProfile(completion: @escaping (Result<Void, DNSFilterError>) -> Void) {
        settingsManager.removeFromPreferences { error in
            if let error {
                completion(.failure(.removeFailed(error)))
            } else {
                completion(.success(()))
            }
        }
    }

    /// Reports whether the profile is currently installed AND enabled (the user can disable a
    /// saved profile from Settings without Guardian removing it, so `dnsSettings != nil` alone
    /// is not sufficient — matches `isEnabled`'s own doc: "must be enabled by the user in
    /// Settings").
    func isActive(completion: @escaping (Bool) -> Void) {
        settingsManager.loadFromPreferences { [weak self] error in
            guard let self, error == nil else {
                completion(false)
                return
            }
            completion(self.settingsManager.isEnabled && self.settingsManager.dnsSettings != nil)
        }
    }
}
