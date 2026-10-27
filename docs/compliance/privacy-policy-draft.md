# Guardian Privacy Policy — DRAFT

> **This is a draft, not a published or legally-reviewed document.** It was generated to give a
> human/legal reviewer a complete, accurate starting point — every factual claim below is
> traceable to a specific implemented ticket (cited inline) so it can be checked against the
> actual running code, not just plausible-sounding boilerplate. Before this is published or
> relied on for COPPA/GDPR-K/App Store/Play Store review:
> - A qualified privacy/child-data attorney must review it against your actual legal entity,
>   jurisdiction(s) of operation, and current COPPA/GDPR-K/CCPA/UK-GDPR obligations.
> - Every `[PLACEHOLDER]` must be filled in with real company/contact information.
> - It must be kept in sync with the product as features change — this draft describes the
>   system as implemented through ticket T27.

_Last generated: 2026-07-28 (T28). [PLACEHOLDER: publish date]._

## Who this policy covers

Guardian is a parental-control app. A **parent** (the account holder) installs a companion app
on their own device and pairs one or more **child** devices to their family account. This policy
describes what Guardian collects from both the parent's and the child's devices, and how a
parent can review, control, and delete that data.

## Data we collect

- **Family/child/device registry**: parent account email, family membership, each paired
  child's profile (name, birthdate — used only to derive an age tier for content-filter
  presets, see `deriveAgeTier`), and each paired device's identity (device id, platform,
  push-notification token).
- **Policy settings**: the screen-time limits, schedules, content-filter categories/custom
  domain lists, app-blocking rules, and presence-detection settings a parent configures for
  each child.
- **Event logs**: app usage duration (which category of app was used and for how long — not
  which specific website/app content within it beyond category/domain), block attempts
  (domain/category blocked, not full browsing history), search queries and YouTube views
  **only when a parent has enabled that specific monitoring feature**, new-app-install alerts,
  and presence-detection triggers (a level and a timestamp — see the camera section below for
  what "presence-detection trigger" does and does not contain).
- **Location** (optional, family map / geofencing) — only collected if a parent explicitly
  enables the locator feature for a device; a family that never turns this on has zero location
  data collected.

## Data we explicitly do NOT collect or store

- **Camera frames or images are never stored, transmitted, or persisted.** Guardian's
  presence-detection feature (see the dedicated section below) processes camera frames
  on-device, in memory, one frame at a time, and discards each frame immediately after deriving
  a single yes/no ("is a face present") signal. No frame, image, or video is ever written to
  disk, uploaded, or logged.
- **Images submitted to the on-device NSFW image classifier are not persisted.** The classifier
  runs entirely on-device (TensorFlow Lite) and returns a classification result only; the
  source image is never uploaded to Guardian's servers or retained after classification.
- **We do not monitor message content.** Guardian does not read, store, or analyze the content
  of text messages, chat apps, or social media posts. Social-media/messaging conversation
  monitoring is explicitly out of scope for this version of the product.
- **We do not perform system-wide ad inspection or full browsing history capture** beyond the
  block-attempt/category logging described above.

## Verified parental consent (COPPA / GDPR-K)

Before a family account or any child profile is created, the signing-up parent must
affirmatively accept a verified-parental-consent flow. The signup endpoint rejects account
creation outright — creating zero database rows — unless consent is explicitly accepted; this is
enforced in code, not just policy (`parental_consent_accepted_at` is set at the moment of
consent and is a required part of account creation).

`[PLACEHOLDER: describe your chosen COPPA-compliant verification method in detail —
e.g. credit-card micro-charge, signed consent form, knowledge-based verification — the current
implementation records a consent flag/timestamp but the human-facing verification *mechanism*
itself (how you confirm the person consenting is really the child's parent) needs to be
specified by the legal reviewer/product owner and described here.]`

## Data deletion on account close

A parent can close their family account, which cascades a full delete of that family's data:
every child profile, device, policy, event log, and pairing code tied to the family is removed
from our database immediately.

**Known gap, disclosed rather than hidden**: the underlying authentication record (the parent's
login credential) is not automatically deleted as part of this cascade in the current
implementation — `[PLACEHOLDER: either fix this before publishing this policy, or describe the
separate account-deletion request process a parent must use to remove their login credential
too]`.

## Camera-based presence detection — plain-language explanation

Guardian offers an optional, off-by-default feature that uses a child device's front camera to
help detect whether the child is actually present and paying attention (as opposed to, for
example, propping the device up and walking away while a video keeps playing). We're describing
exactly how this works because we think privacy-conscious parents deserve to know the mechanics,
not just a permission prompt:

1. **Opt-in required, twice over.** This feature only runs if BOTH the parent has enabled it in
   the child's policy AND the feature has a separate on-device opt-in flag; if either is off,
   the camera is never activated. The default for both is off.
2. **A persistent notification is always shown** while the camera is active — there is no silent
   background camera use.
3. **Only a single boolean per check is ever kept**: "was a face detected, yes or no." The
   camera frame used to answer that question exists only in memory for the instant it's being
   analyzed and is discarded immediately after. No image, video, or camera data of any kind is
   ever saved, logged, or sent anywhere.
4. **Nothing about the camera signal ever leaves the device** — there is no network call
   involving camera data anywhere in this feature's implementation.
5. This signal is combined with other on-device signals (screen touches, motion) to decide
   whether to show a "Still watching?" prompt or pause a session — it is never used for any
   other purpose (e.g. it is not facial recognition, it does not identify who is present, only
   whether *a* face is present).

## Third parties

`[PLACEHOLDER: list any actual third-party processors — Supabase (database/auth hosting),
push-notification providers (FCM/APNs), any DNS resolver operator for the content-filtering
feature — with links to their own privacy policies, once those vendor relationships are
finalized.]`

## Contact

`[PLACEHOLDER: company name, mailing address, privacy contact email — required for COPPA/GDPR-K
compliance.]`
