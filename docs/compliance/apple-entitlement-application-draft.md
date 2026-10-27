# Apple `com.apple.developer.family-controls` Entitlement Request — DRAFT

> **This is a draft, not a submitted application.** It was generated to give the human who owns
> the Apple Developer account a ready-to-paste starting point for Apple's entitlement request
> form — it is not legal advice and does not guarantee Apple's approval. Apple reviews these
> requests manually and may ask follow-up questions or request changes; a human must adapt this
> text to match the actual published app and submit it themselves.

_Last generated: 2026-07-28 (T28), against the FamilyControls/ManagedSettings/DeviceActivity
integration built in T27._

## Business justification text (paste into Apple's entitlement request form)

> **App name**: Guardian `[PLACEHOLDER: confirm final App Store product name]`
>
> **What the app does**: Guardian is a parental-control application. A parent installs a
> companion app on their own device and pairs it with their child's iOS device. The parent
> configures screen-time limits, app-blocking rules, and content filtering; the child's device
> enforces those settings locally.
>
> **Why the FamilyControls entitlement is needed**: `FamilyControls`/`ManagedSettings`/
> `DeviceActivity` is the only Apple-sanctioned mechanism for a third-party app to enforce
> parent-configured screen-time limits and app shielding on iOS — there is no public API to
> block or time-limit other apps without it. Specifically, Guardian uses:
> - `AuthorizationCenter` to obtain parental authorization for the child's device.
> - `ManagedSettingsStore.shield` to block access to apps/websites the parent has selected via
>   the system `FamilyActivityPicker` (Guardian never attempts to identify apps by bundle
>   identifier directly — only through the user-facing picker Apple provides, matching Apple's
>   own privacy-preserving design for this API).
> - `DeviceActivityCenter`/`DeviceActivityMonitor` to enforce a daily screen-time cap and
>   scheduled block windows (e.g. bedtime) chosen by the parent.
>
> **How this complies with Apple's parental-control app guidelines**: Guardian is built
> specifically as a parental-control app (App Store Review Guideline 5.6/Family/Parental
> Controls category), not a general productivity or "focus mode" app repurposing this
> entitlement. All shielding/monitoring is configured by the parent, from the parent's own
> device/account, and is visible to the child (this is not covert/stalkerware behavior — the
> app's presence and its active restrictions are disclosed on the device being managed).
>
> **Authorization mode**: Guardian requests `.child`-mode authorization (Family Sharing-based),
> matching the product's model of a parent managing a child's own device.
> `[PLACEHOLDER/RISK — flagged in T27's LEDGER entry: this has not been verified against a real
> entitlement/Family Sharing setup yet; if `.child` mode does not actually authorize under
> Guardian's real account-linking model, `.individual` mode is the fallback and this paragraph
> needs updating before submission.]`

## Checklist — what only the human can do from here

This ticket (T28) drafts the content above; it cannot submit anything. The human who owns (or
will create) the Apple Developer account needs to:

- [ ] **(a) Enroll in the Apple Developer Program** ($99/year) if not already enrolled, using
      the real legal entity that will own this app on the App Store.
- [ ] **(b) Submit this entitlement request** via Apple's developer portal, using the
      business-justification text above (adapted/filled in as needed) — this is a manual web
      form Apple provides to enrolled developers, not an API.
- [ ] **(c) Wait for approval.** Apple states this can take **weeks of lead time** (spec §8) —
      start this well before any real device testing or App Store submission deadline.
- [ ] **(d) Once approved, generate a provisioning profile** (development and/or distribution)
      that includes the approved `com.apple.developer.family-controls` entitlement, via Xcode or
      the Apple Developer portal.
- [ ] **(e) Flip on the FamilyControls capability in Xcode** for the `app/ios` target's Signing
      & Capabilities tab, and re-download/select the new provisioning profile — T27's Swift code
      (`app/ios/Guardian/ScreenTime/`) is already written against the public API surface and
      requires no code changes once this is done; see `SETUP.md`'s "Apple Developer account &
      FamilyControls entitlement" and "Xcode / CocoaPods" sections for the exact manual Xcode
      steps (target creation, dual-membership for the shared `Shared/PendingAppUsageEvent.swift`
      file, App Groups capability) this entitlement unblocks.
