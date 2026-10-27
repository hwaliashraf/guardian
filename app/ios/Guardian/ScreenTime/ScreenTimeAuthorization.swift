import Foundation
import FamilyControls

// Requires the `com.apple.developer.family-controls` entitlement, an Apple Developer Program
// membership, and (for now) a TestFlight/development provisioning profile with the entitlement
// approved by Apple. Without it, `requestAuthorization` will throw at runtime even though this
// file compiles.

/// Wraps `AuthorizationCenter.shared` (FamilyControls) for Guardian's screen-time integration.
///
/// **Design decision — `.child`, not `.individual` (RISK: flagged for human confirmation once
/// testable against a real entitlement/device)**: `FamilyControlsMember` (iOS 16+,
/// `requestAuthorization(for:)`) offers exactly two modes. `.individual` matches Apple's
/// "single self-managed adult" story (e.g. a person restricting their own device). `.child`
/// matches Family Sharing's parent-managed-child-account model — the authorization is granted
/// by/visible to the family organizer, not just the device's own user. Guardian's product model
/// (spec: install Guardian ON the child's own device, a parent manages it remotely from their
/// own device/account) is a managed-by-someone-else relationship, closer to `.child` than to
/// `.individual`'s self-managed framing. Chosen: `.child`.
///
/// This has **not** been exercised against a real device/entitlement/Family Sharing setup in
/// this environment (no Apple Developer account here — see SETUP.md). `.child` mode's real
/// prerequisite is that the child's Apple ID sits inside the parent's Family Sharing group; if
/// Guardian's actual onboarding/account model doesn't guarantee that pairing,
/// `requestAuthorization(for: .child)` may simply fail authorization at runtime even with a
/// valid entitlement, and `.individual` could turn out to be the mode that actually works for
/// this product's account model. A human must confirm this the first time real
/// entitlement+device testing is possible, before this choice is treated as settled.
final class ScreenTimeAuthorization {
    enum AuthorizationError: Error {
        case requestFailed(Error)
    }

    private let center: AuthorizationCenter

    init(center: AuthorizationCenter = .shared) {
        self.center = center
    }

    func requestAuthorization(completion: @escaping (Result<Void, AuthorizationError>) -> Void) {
        Task {
            do {
                try await center.requestAuthorization(for: .child)
                completion(.success(()))
            } catch {
                completion(.failure(.requestFailed(error)))
            }
        }
    }

    var status: AuthorizationStatus {
        center.authorizationStatus
    }
}
