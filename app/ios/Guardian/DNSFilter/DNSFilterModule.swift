import Foundation
import NetworkExtension
import React

/// React Native bridge exposing `DNSFilterManager` to JS. The class itself is exported via
/// `@objc(DNSFilterModule)`; the companion `DNSFilterModule.m` file's `RCT_EXTERN_MODULE`/
/// `RCT_EXTERN_METHOD` macros are what actually register it with RN's bridge (the standard
/// pattern for a Swift-authored RN native module — `RCT_EXPORT_MODULE` itself is an
/// Objective-C-only macro, unusable directly from Swift). Requires
/// `Guardian-Bridging-Header.h` wired into the app target's `SWIFT_OBJC_BRIDGING_HEADER` build
/// setting so `DNSFilterModule.m` can see this class's generated Objective-C interface — see
/// SETUP.md's "Xcode / CocoaPods" section for the manual Xcode step this environment cannot
/// perform itself (no Xcode project-file editor available headlessly).
///
/// Mirrors Android's `VpnModule.kt` (T22) surface shape (`installProfile`/`removeProfile`/
/// `isActive`, each Promise-based) so the app/'s TypeScript native-module wrapper can share one
/// interface across platforms even though the underlying enforcement mechanism differs (a DNS
/// Settings profile here vs. a local `VpnService` there — see `DNSFilterManager`'s doc comment).
@objc(DNSFilterModule)
final class DNSFilterModule: NSObject {
    /// Guardian's DoH resolver. TODO(SETUP.md): replace with the real deployed resolver URL once
    /// one is provisioned — no such deployment exists in this build environment.
    private let manager = DNSFilterManager(resolverURL: URL(string: "https://dns.guardian.example/dns-query")!)

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(installProfile:rejecter:)
    func installProfile(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        manager.installProfile { result in
            switch result {
            case .success:
                resolve(true)
            case .failure(let error):
                reject("DNS_FILTER_INSTALL_FAILED", String(describing: error), error as NSError)
            }
        }
    }

    @objc(removeProfile:rejecter:)
    func removeProfile(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        manager.removeProfile { result in
            switch result {
            case .success:
                resolve(true)
            case .failure(let error):
                reject("DNS_FILTER_REMOVE_FAILED", String(describing: error), error as NSError)
            }
        }
    }

    @objc(isActive:rejecter:)
    func isActive(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        manager.isActive { active in
            resolve(active)
        }
    }
}
