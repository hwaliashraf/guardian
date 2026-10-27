# Google Play — Prominent Disclosure & Permissions Declaration — DRAFT

> **This is a draft, not a submitted Play Console declaration.** It was generated to give a
> human reviewer accurate, code-traceable copy to adapt and paste into the Play Console — it is
> not legal advice and does not guarantee Play policy approval. Google's Accessibility API,
> Device Admin API, and sensitive-permissions policies change over time and are reviewed
> case-by-case by Google; a human must verify this draft against the *current* Play Console
> policy pages before submitting, and adapt the `[PLACEHOLDER]` fields to the real published app
> listing.

_Last generated: 2026-07-28 (T28), against the permissions declared in
`app/android/app/src/main/AndroidManifest.xml` as of tickets T22–T25._

## Why this document exists

Google Play's policies require apps that use the Accessibility API, `VpnService`, the Device
Admin API, or a background camera for a non-obvious purpose to show a **prominent, in-app
disclosure** of exactly what the feature does and why, before requesting the permission — and to
provide a matching justification in the Play Console's Permissions Declaration Form. Four Guardian
features trigger this requirement; each `AndroidManifest.xml` declaration has a `// see T28`
comment marking exactly where this copy applies (T22 = VpnService, T23 = Accessibility, T24 =
Device Admin, T25 = Camera foreground service).

## In-app disclosure screen copy (per feature)

This is the copy `app/src/child/onboarding/PermissionsDisclosureScreen.tsx` renders — reproduced
here so the Play Console reviewer can see exactly what the child/parent sees before any of these
permissions is requested.

### 1. Accessibility Service (T23)

> **Guardian uses Android's Accessibility Service** to see what app is currently on-screen and
> to scan on-screen text for content-filtering purposes (for example, detecting a blocked search
> term). This is **not** a general accessibility tool — Guardian is a parental-control app, and
> this permission lets it enforce the content rules a parent has configured. Guardian does not
> read passwords or private-messaging content through this permission.

**Play Console justification text (paste into the Accessibility API Declaration Form):**
> Guardian is a parental-control application. The Accessibility API is used exclusively to
> identify the foreground application and scan on-screen text against a parent-configured
> content-filter policy, and to detect YouTube video metadata for restricted-mode enforcement.
> This use falls within Play's permitted-use category for parental-control apps. The service
> does not collect or transmit arbitrary on-screen content; only category/keyword-match
> decisions and block events are logged.

### 2. VpnService — local DNS content filter (T22)

> **Guardian runs a local, on-device VPN** — not to route your traffic through any external
> server, but to filter which websites this device can reach, based on the content categories a
> parent has configured (for example, blocking adult content or gambling sites). This VPN does
> not send your browsing traffic anywhere outside this device beyond ordinary DNS resolution
> through a filtering resolver.

**Play Console justification text:**
> Guardian implements a local VPN service (`VpnService`) solely to enforce parent-configured
> DNS-level content filtering on the device. No user traffic is proxied to Guardian's own
> servers; the VPN's only function is to route DNS queries through a filtering resolver. This is
> a core, disclosed feature of a parental-control app, not incidental data collection.

### 3. Device Admin — uninstall protection (T24)

> **Guardian requests Device Administrator access** so a child cannot simply uninstall the app
> to bypass parental controls. With this permission active, uninstalling Guardian requires the
> parent's own approval (via the parent app) or removing Device Admin access first, which is
> itself logged and reported to the parent.

**Play Console justification text:**
> Device Admin API access is used exclusively for uninstall-protection, a permitted use case
> explicitly recognized by Play policy for parental-control apps. Guardian does not use Device
> Admin for password policy enforcement, remote wipe, or any purpose beyond preventing
> unauthorized removal of parental controls and reporting tamper attempts to the parent.

### 4. Camera — presence detection (T25)

> **Guardian can optionally use the front camera** to help tell whether you're actually present
> and paying attention (for example, so a video doesn't keep "watching credit" accruing while
> you've walked away). This is off by default and requires a separate opt-in. Guardian never
> saves, stores, or sends any camera image or video — it only keeps a yes/no "was a face
> detected" result for a moment, then discards the frame.

**Play Console justification text:**
> Camera access is used only for on-device, real-time presence detection (face-present
> boolean), running as a foreground service (`foregroundServiceType="camera"`) with a persistent
> user-visible notification whenever active. The feature is opt-in (default off, requiring both
> a parent-enabled policy setting and a separate on-device consent flag) and no image, video, or
> camera frame data is stored, logged, or transmitted off-device at any point.

## Data Safety form notes

`[PLACEHOLDER: this document covers the Permissions Declaration Form's justification text; the
separate Play Console "Data safety" section (what data types are collected/shared, and why) must
also be filled in — cross-reference `privacy-policy-draft.md`'s "Data we collect" section for the
data-type list, and confirm the "Data is encrypted in transit"/"Users can request data deletion"
answers match the actual Supabase/T10 implementation before submitting.]`
