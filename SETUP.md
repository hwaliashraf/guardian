# Guardian — Environment Setup

This file lists exact steps to finish setting up anything this build could not fully
verify in its original build environment. Filled in incrementally per ticket.

## Quick start

The minimal sequence to get everything that's actually verifiable without native toolchains
(JDK/Android SDK, Xcode/CocoaPods) or vendor accounts (Firebase, Google Maps, Apple Developer)
running locally — this is exactly what `.github/workflows/ci.yml` (repo root, T29) automates:

```sh
npm install
npm run typecheck  # root tsc + each workspace's own tsc -p tsconfig.json --noEmit
npm run lint        # eslint . --ext .ts,.tsx, repo-wide
npm test            # fans out to packages/domain, packages/backend, app (Jest)
```

If Docker is installed and running, also stand up the local Supabase stack (needed for anything
beyond `packages/backend`'s pure-logic unit tests — e.g. re-running T07's `scripts/smoke.ts`):

```sh
cd packages/backend
supabase start
supabase db reset
cd ../..
```

Everything below this section is what's still missing for the parts `npm install`/`npm
test`/`supabase start` can't cover on their own — native Android/iOS builds, vendor credentials,
and the Apple entitlement — organized one section per gap, filled in by the ticket that hit it.

## Node / npm

Verified in build environment:
- `node -v` → `v24.18.0`
- `npm -v` → `11.16.0`

## Java / Android SDK (for native Android modules + Gradle builds)

No Java runtime exists in this build environment (`java -version` fails) — T22's
`GuardianVpnService`/`BlocklistLoader`/`BypassPrevention`/`VpnModule` Kotlin files (Layer 1 DNS
filter, spec §4) are written as real, complete implementations but have **never been
compiled or run** here. To build/run them:

1. Install a JDK — e.g. `brew install --cask temurin` (Java 17 LTS is the current standard for
   the modern Android Gradle Plugin this project's `app/android/build.gradle` uses).
2. Install Android SDK platform-tools + a platform + build-tools via `sdkmanager` (the SDK dir
   already exists at `~/Library/Android/sdk`, confirmed in this project's Phase-0 environment
   probe — see LEDGER.md) or via Android Studio's SDK Manager.
3. `cd app/android && ./gradlew assembleDebug` to build; `adb install` + a device/emulator to run.

**Known gap to resolve before this actually compiles into the running app**: the RN-CLI-generated
Android project's package/namespace is `com.app` (T11's `init` default, from the `app/` directory
name), but T22's Kotlin files live under `com.guardian.vpn` per the ticket's literal path — a
human doing the real build should either rename the app's package to `com.guardian` (matching the
product name) or otherwise reconcile the namespace mismatch; `com.guardian.vpn.VpnPackage` is
already registered in `MainApplication.kt` (package `com.app`) and Kotlin doesn't require the
package name to match the directory/app namespace, so this is very likely to compile as-is, but
has not been verified.

Also requires: `androidx.work:work-runtime-ktx:2.9.1` (added to `app/android/app/build.gradle`
for `BlocklistRefreshWorker.kt`'s daily job — ticket-mandated, unverified) resolving from Google's
Maven repo at build time, and network access at runtime to the three blocklist source URLs cited
in `BlocklistLoader.kt`.

## TFLite NSFW model (Layer 2, spec §4/§2.2, T25)

`NsfwClassifier.kt` is a real, complete TFLite `Interpreter` wrapper, but **no `.tflite` model
file ships in this repo** — a real NSFW classifier model is a binary asset this build environment
cannot download or train, and T25's ticket explicitly forbids fabricating a fake/placeholder model
file. A human must complete this step before `NsfwModule.classifyImageUri` can do anything but
throw:

1. Source an existing open-source NSFW TFLite classifier. Spec §2.2 points at "open NSFW models"
   generically; the concrete project this build's `NsfwClassifier.kt` is written against is
   **[GantMan/nsfw_model](https://github.com/GantMan/nsfw_model)** (MIT-licensed, ships a
   `mobilenet_v2_140_224` Keras model with a documented TFLite conversion path and a fixed 5-class
   output order `[drawings, hentai, neutral, porn, sexy]`). Yahoo's original
   [open_nsfw](https://github.com/yahoo/open_nsfw) (Caffe) is the older reference implementation
   several community TFLite conversions (including forks of the above) derive from, if a different
   conversion is preferred instead.
2. Convert to TFLite if not already (GantMan/nsfw_model ships conversion instructions/scripts in
   its own repo) and drop the resulting file at exactly:
   `app/android/app/src/main/assets/nsfw_classifier.tflite`
3. **If a different open NSFW TFLite conversion is sourced instead of GantMan/nsfw_model**, update
   `NsfwClassifier.kt`'s `INPUT_SIZE`/`INPUT_CHANNELS`/`OUTPUT_CLASS_ORDER` constants (and the
   pixel-normalization in `bitmapToInputBuffer`) to match that model's actual documented
   input/output contract — this wrapper cannot self-detect a mismatched shape/normalization/class
   order and will silently produce meaningless scores against the wrong model.
4. Also requires: `org.tensorflow:tensorflow-lite:2.14.0`, `com.google.mlkit:face-detection:16.1.6`,
   and `androidx.camera:camera-core`/`camera-camera2`/`camera-lifecycle:1.3.4` (all added to
   `app/android/app/build.gradle` for T25 — ticket-mandated, unverified) resolving from Google's/
   Maven Central's repos at build time.

## Android device/emulator (for on-device verification)

No adb, physical device, or emulator exists in this build environment (Phase-0 environment
probe, LEDGER.md: "Android SDK dir exists... but no `adb`, no device/emulator") — none of
T22-T25's Kotlin has ever been installed or run on anything. Once the "Java / Android SDK"
section above is done (JDK + SDK platform-tools installed) and `./gradlew assembleDebug`
produces an APK, a human needs either:

- **A physical device**: enable Developer Options (Settings → About phone → tap "Build number"
  7 times), then enable USB debugging (Settings → Developer options), connect via USB, accept
  the "Allow USB debugging?" prompt on the device, and confirm it's visible with `adb devices`
  (from the SDK's `platform-tools` dir). This is the only way to test T25's Camera
  presence-detection feature meaningfully (emulators generally lack a usable front camera feed).
- **An emulator (AVD)**: via Android Studio's Device Manager ("Create device"), or headlessly
  via the command-line tools: `sdkmanager "system-images;android-34;google_apis;arm64-v8a"`
  (pick an API level matching `app/android/build.gradle`'s `compileSdkVersion`), then
  `avdmanager create avd -n guardian-test -k "system-images;android-34;google_apis;arm64-v8a"`,
  then `emulator -avd guardian-test`. Note: T22's `GuardianVpnService` (a real `VpnService`) and
  T24's Device Admin API generally work on an emulator; T25's camera-based presence detection
  does not have a reliable camera feed on most emulator images.

Once a device/emulator is visible in `adb devices`: `adb install
app/android/app/build/outputs/apk/debug/app-debug.apk` to sideload the built APK (no Play Store
listing exists yet), then grant the special-access permissions manually the first time (VPN
consent dialog on first `VpnModule.startVpn()` call, Accessibility Service via Settings →
Accessibility, Usage Access via `Settings.ACTION_USAGE_ACCESS_SETTINGS` per
`UsageAccountant.hasUsageAccess()`'s doc comment, Device Admin activation prompt) — none of
these can be granted via `adb install` alone.

## Docker (for local Supabase dev)

Verified in build environment (T07): `docker -v` → `Docker version 28.3.2`. The daemon was not
running by default; started it with `open -a Docker` (macOS) and polled `docker ps` until it
responded (took ~5s this run). If `docker ps` still fails after ~90s of polling, open Docker
Desktop manually from Applications and wait for it to report "running", then retry.

## Supabase CLI / project

Installed via `brew install supabase/tap/supabase` (verified: `supabase --version` →
`2.109.1`). Project lives at `packages/backend/supabase/` (CLI layout: `config.toml`,
`migrations/0001_init.sql`, `migrations/0002_rls.sql`).

To stand the local stack up and re-run T07's smoke test from scratch:

```sh
cd packages/backend
supabase start                 # prints ANON_KEY / SERVICE_ROLE_KEY / API_URL etc.
supabase db reset              # (re)applies all migrations from scratch
SUPABASE_SERVICE_ROLE_KEY=<paste SERVICE_ROLE_KEY from `supabase start`/`supabase status`> \
  npx tsx scripts/smoke.ts     # run from repo root, or `npm run smoke -w packages/backend`
```

Verified this run: `supabase start` succeeded (pulled images, applied both migrations with no
errors), `supabase db reset` re-applied cleanly, and `npx tsx packages/backend/scripts/smoke.ts`
printed `SMOKE TEST PASSED` (inserted+read back Family → Parent → Child → Device → Policy →
DeviceEvent → ChildRequest via the service-role key, plus a parent-scoped `select` on `policy`
that would have caught the infinite-recursion RLS bug fixed post-review — see LEDGER.md's T07
entry). A manual anon-key sanity check (`select * from family` / `select * from policy` with no
auth) returned empty result sets, confirming RLS is active and default-deny for unauthenticated
requests.

To stop the local stack when done: `supabase stop` (from `packages/backend`).

**Connecting the RN app (`app/`) to this instance** (T30 addition — found missing during the
final integration pass: this step existed nowhere in this file, even though `app/.env.example`
has existed since T11): `cp app/.env.example app/.env`, then replace `SUPABASE_ANON_KEY` with the
real `ANON_KEY` value `supabase start`/`supabase status` printed above (the example file's
`SUPABASE_URL=http://localhost:54321` default already matches the CLI's fixed local API URL, no
edit needed for local dev — only for a deployed project). `app/.env` is gitignored (never
committed) and read at build/bundle time via the `react-native-dotenv` babel plugin
(`app/src/supabaseClient.ts` imports `{ SUPABASE_URL, SUPABASE_ANON_KEY } from '@env'`) — without
it, the built app has no backend to talk to at all.

## FCM / push credentials (for real policy-push delivery)

No Firebase/FCM project credentials exist in this build environment (no Firebase account — see
LEDGER.md Phase 0). `packages/backend/supabase/functions/push/dispatcher.ts` (T08) ships two
`PushDispatcher` implementations:
- `LoggingPushDispatcher` (default, always available) — writes a row to the `push_log` table
  instead of a real network call. This is what `policy-sync`'s edge function uses and what T08
  actually verifies end-to-end.
- `FcmPushDispatcher` — written for real against the FCM HTTP v1 API (OAuth2 service-account
  bearer token + `POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`), but
  never exercised in this environment. `packages/backend/supabase/functions/policy-sync/index.ts`
  automatically switches to it whenever the `FCM_SERVICE_ACCOUNT_JSON` env var is set — no code
  change needed, just the steps below.

To switch a deployment over to real FCM delivery, a human needs to:

1. Create (or reuse) a Firebase project at https://console.firebase.google.com — enable **Cloud
   Messaging** for it (Project settings → Cloud Messaging tab; the legacy server-key API is
   deprecated, this ticket's dispatcher uses the newer **HTTP v1 API**, which needs a service
   account, not a server key).
2. Generate a service-account key: Firebase console → Project settings → **Service accounts** →
   "Generate new private key". This downloads a JSON file
   (`{project_id, client_email, private_key, ...}`) — treat it as a secret, never commit it.
3. Set the entire JSON file's contents (as a single-line string) as the `FCM_SERVICE_ACCOUNT_JSON`
   env var for the edge function:
   - **Local dev** (`supabase functions serve`): pass `--env-file <path>` pointing at a `.env`
     file containing `FCM_SERVICE_ACCOUNT_JSON='<paste the JSON here>'` (do not commit this file
     — it is already covered by `supabase/.gitignore`'s standard ignore patterns for `.env`).
   - **Deployed project**: `supabase secrets set --project-ref <ref> FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"`,
     then redeploy the function (`supabase functions deploy policy-sync`).
4. Populate `device.push_token` for each device (the FCM registration token the child app's FCM
   SDK obtains on-device and should PATCH/PUT back to its own `device` row) — **this ticket does
   not build that registration flow**; `device.push_token` (added in
   `migrations/0003_push_log.sql`) is nullable and devices without one are silently skipped at
   dispatch time. Wiring up the child app's FCM SDK registration call is a follow-up ticket.

No code changes are required to activate `FcmPushDispatcher` once the env var is set — only
`LoggingPushDispatcher` (the default, no-credentials-needed path) has been run against a real
local Supabase instance in this build.

## Device-pairing JWT secret (auth-flows function, T10)

`packages/backend/supabase/functions/auth-flows/index.ts`'s `pair-device` handler mints a
device-scoped credential (HS256 JWT, `role: authenticated` + custom `device_id` claim, reusing
T07's documented RLS assumption exactly — see `0002_rls.sql`'s top comment) signed with a
`JWT_SECRET` env var.

**Not named `SUPABASE_JWT_SECRET`**: the Supabase CLI's `--env-file` (and `secrets set`) silently
refuse any user-supplied env var starting with the reserved `SUPABASE_` prefix (confirmed
empirically: `supabase functions serve --env-file ...` printed `Env name cannot start with
SUPABASE_, skipping: SUPABASE_JWT_SECRET` and the var was never set). `JWT_SECRET` matches the
key name `supabase status`/`supabase start` itself prints for the project's signing secret.

- **Local dev**: create a `.env` file (already covered by `supabase/.gitignore`'s `.env` pattern,
  added in T08) containing `JWT_SECRET=<paste the "JWT_SECRET" value from \`supabase status\`>`,
  then `supabase functions serve --env-file <path>`.
- **Deployed project**: `supabase secrets set --project-ref <ref> JWT_SECRET=<project JWT
  secret>`, then `supabase functions deploy auth-flows`. Note a deployed project may use
  asymmetric (ES256/JWKS) signing keys instead of a single shared HS256 secret — if so, this
  mint-with-shared-secret approach needs revisiting before deploy (see the RISK note below).

Verified this run (local, HS256 shared secret): a full signup → children → pairing-code →
pair-device round trip produced a working device JWT that `supabase functions serve` accepted
(no 401), and it correctly evaluated `WITH CHECK` logic when independently tested — **but see the
carried-forward RISK below**, the actual `device_event` INSERT through PostgREST still fails.

**RISK carried forward from T09, reproduced again here with the real minting function (not a
hand-minted test artifact)**: a device JWT minted by `pair-device` (`role: authenticated`,
`device_id: <uuid>`, HS256-signed with the local `JWT_SECRET`) is rejected by PostgREST on the
real `POST /device_event` insert path with `42501 new row violates row-level security policy for
table "device_event"`, even though the exact same claim shape was independently confirmed correct
via a `psql` `SET LOCAL request.jwt.claims` simulation (T09) and a debug RPC through the real
PostgREST request path (T09). The signed-in parent's own session token from GoTrue is `ES256`
(asymmetric), not `HS256` — worth checking as a first lead whether local PostgREST's JWT
verification/role-claim propagation behaves differently for a hand-signed `HS256` token than for
a GoTrue-issued `ES256` one, but this needs a dedicated, unbounded investigation (not another
feature ticket) per T09's original flag. Until resolved, no device has ever successfully written
its own `device_event` row through this repo's real RLS path — `event-ingest` (T09) and
`auth-flows` (T10) are both only verified end-to-end via the service-role key.

## Manual verification: family-close cascade delete (T10)

Verified this run (local Supabase, real HTTP call — see LEDGER.md's T10 entry for full command
transcript): signed up a parent, created a child, paired a device, then called `DELETE
/functions/v1/auth-flows/family` with the parent's JWT, then confirmed via `psql` that
`family`/`parent`/`child`/`device`/`pairing_code` row counts for that family all dropped to 0
(the `auth.users` row deliberately remains — the ticket's literal ask was deleting the `Family`
row + its cascade, not the parent's own Supabase Auth identity; see LEDGER.md's T10 entry's
"Noticed, not touched" for the reasoning). To re-verify by hand against any environment with a
family already created:

```sh
# Row counts before:
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
  select 'family' t, count(*) from public.family where id = '<familyId>'
  union all select 'parent', count(*) from public.parent where family_id = '<familyId>'
  union all select 'child', count(*) from public.child where family_id = '<familyId>'
  union all select 'device', count(*) from public.device
    where child_id in (select id from public.child where family_id = '<familyId>');
"
# Delete (as the family's own parent):
curl -X DELETE http://127.0.0.1:54321/functions/v1/auth-flows/family \
  -H "Authorization: Bearer <parent access_token>" -H "apikey: <anon key>"
# Re-run the row-count query above — every row should now be 0.
```

## Scheduled cron jobs (digest-cron, vacation-cron)

`digest-cron` and `vacation-cron` (T09) are written as normal Supabase Edge Functions but are
meant to run on a schedule, not be called directly by an app. This CLI version
(`supabase --version` → `2.109.1`) has no native "schedule" field for edge functions in
`config.toml` (confirmed via `supabase functions --help` — only
list/delete/download/deploy/new/serve subcommands exist). The functions themselves are real and
unit-tested (`packages/backend/src/digest.ts` / `vacationCron.ts`, both covered by Jest), but
**actually firing on a schedule has not been verified in this environment** — it requires a
deployed Supabase project (no cloud account exists here — see LEDGER.md Phase 0).

Once a project is deployed, a human needs to:

1. Deploy both functions: `supabase functions deploy digest-cron` and
   `supabase functions deploy vacation-cron`.
2. Enable the `pg_cron` and `pg_net` extensions on the project's Postgres (Dashboard → Database →
   Extensions, or `create extension if not exists pg_cron; create extension if not exists pg_net;`
   via the SQL editor).
3. Schedule each function with `cron.schedule`, calling its deployed URL via `net.http_post` with
   the project's service-role key as the bearer (the function itself only ever uses the
   service-role key internally — see each function's own header comment):

   ```sql
   select cron.schedule(
     'weekly-digest',
     '0 6 * * 1', -- every Monday 06:00 UTC
     $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/digest-cron',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <service-role key>',
         'Content-Type', 'application/json'
       )
     );
     $$
   );

   select cron.schedule(
     'vacation-auto-restore',
     '5 0 * * *', -- daily 00:05 UTC
     $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/vacation-cron',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <service-role key>',
         'Content-Type', 'application/json'
       )
     );
     $$
   );
   ```

To manually exercise either function locally instead (what this ticket's own verification used):
`supabase functions serve` then `curl -X POST http://127.0.0.1:54321/functions/v1/digest-cron -H "Authorization: Bearer <service-role key>"` (optionally `?weekStart=YYYY-MM-DD` to target a
specific week) / same for `vacation-cron`.

## Maps provider (real interactive map for the locator feature, T17)

No Google Maps/Mapbox API key exists in this build environment (no vendor account — same class
of gap as FCM above). `app/src/parent/location/MapProvider.tsx` (T17) defines a swappable
`MapProvider` interface (`ComponentType<{ pins: MapPin[] }>`, `MapPin = {id, label, lat, lng}`)
so `FamilyMapScreen`/`GeofenceEditorScreen` are real and testable today without a key:
- `FallbackMapProvider` (default, always available) — renders `pins` as a plain list under a
  static placeholder view, no native map rendering. This is what `ActiveMapProvider` currently
  points at.
- Real interactive rendering is not implemented — only this swap point is.

To switch to a real interactive map, a human needs to:

1. Create a Google Cloud project and enable the **Maps SDK for Android** and **Maps SDK for
   iOS** (https://console.cloud.google.com/google/maps-apis) — generate an API key restricted to
   those two SDKs.
2. Add the key as an env var read at build time the same way `SUPABASE_URL`/`SUPABASE_ANON_KEY`
   already are (`app/.env`, `react-native-dotenv`, see the Supabase CLI section above) —
   `GOOGLE_MAPS_API_KEY`. Android additionally needs it in `android/app/src/main/AndroidManifest.xml`
   under a `com.google.android.geo.API_KEY` `<meta-data>` tag (standard `react-native-maps`
   Android setup); iOS needs it passed to `GMSServices.provideAPIKey(...)` in `AppDelegate`.
3. `npm install react-native-maps -w app` (the most idiomatic RN choice for this SDK) and native
   linking (pod install for iOS; Android is autolinked).
4. Write a new `MapProvider` component with the same `MapProviderProps` shape
   (`{ pins: MapPin[] }`) backed by `react-native-maps`' `<MapView>`/`<Marker>`, and point
   `ActiveMapProvider` in `MapProvider.tsx` at it — no other file needs to change, since every
   consumer (`FamilyMapScreen`, `GeofenceEditorScreen`) only ever imports `ActiveMapProvider`.

## Apple Developer account & FamilyControls entitlement (for iOS native modules)

No Apple Developer Program account exists in this build environment (no account = no
entitlement application possible, and it's an identity/business decision, not a coding task —
see T27's `human_gate: true`). `app/ios/Guardian/ScreenTime/` (T27) is written as real, complete
Swift against the public `FamilyControls`/`ManagedSettings`/`DeviceActivity` API surface — this
compiles/typechecks without the entitlement (verified: `xcrun swiftc -typecheck`, see T27's
LEDGER entry), but `AuthorizationCenter.requestAuthorization` will throw at **runtime** without
it. A human needs to:

1. Enroll in the Apple Developer Program ($99/yr) if not already enrolled.
2. Submit Apple's `com.apple.developer.family-controls` entitlement request form with a business
   justification — **T28 drafts this application's content** (compliance artifact), but only the
   human can actually submit it via Apple's developer portal with their own account. Apple states
   this takes **weeks of lead time** (spec §8) — start this well before any real device testing
   is needed.
3. Once approved: add the entitlement to the main app target AND the `GuardianDeviceActivityMonitor`
   extension target's entitlements/provisioning profile in Xcode (Signing & Capabilities), same
   manual-Xcode-step caveat as the "Xcode / CocoaPods" section above (App Groups capability).
4. Confirm the `.child` vs `.individual` `FamilyControlsMember` authorization-mode choice
   (`ScreenTimeAuthorization.swift`) actually authorizes against Guardian's real account/pairing
   model, once real device testing is possible — flagged as an explicit RISK in that file and in
   T27's LEDGER entry, not yet verifiable in this environment.

Until this entitlement exists, `app/ios/Guardian/ScreenTime/*` cannot be exercised beyond
`swiftc -typecheck` — same class of gap as the FamilyControls/ManagedSettings/DeviceActivity
frameworks themselves being unusable at runtime without it.

## Xcode / CocoaPods (for iOS builds)

This build environment has Xcode 15.4 (`xcodebuild -version`) and the iOS/iPhoneSimulator SDKs,
but no CocoaPods run has ever happened here (no `app/ios/Pods/`, no `.xcworkspace`) and no
project-file editing was done headlessly — Xcode's `.pbxproj` format isn't hand-edited safely
without the Xcode GUI or `xcodeproj`/`xcodegen` tooling, neither installed here. T26 (iOS DNS
filter + Safari Content Blocker) added real, complete Swift source under
`app/ios/Guardian/DNSFilter/` and `app/ios/Guardian/DNSFilter/GuardianContentBlocker/`, but these
files are **not yet members of any Xcode target** — a human with Xcode needs to:

1. `cd app/ios && pod install` (generates `app.xcworkspace`; requires Ruby/CocoaPods, not present
   in this environment either — `gem install cocoapods` or `brew install cocoapods` first).
2. Open `app.xcworkspace` in Xcode. Add the existing `app/ios/Guardian/DNSFilter/` folder
   (`DNSFilterManager.swift`, `DNSFilterModule.swift`, `DNSFilterModule.m`) to the main `app`
   target ("Add Files to app…", uncheck "copy items" since they're already on disk in the repo).
3. Set the main `app` target's Build Settings → **Swift Compiler - General → Objective-C
   Bridging Header** to `Guardian/DNSFilter/Guardian-Bridging-Header.h`.
4. File → New → Target… → **Safari Extension → Content Blocker Extension**, name it
   `GuardianContentBlocker`. Xcode scaffolds a new target/folder — delete its generated
   `ContentBlockerRequestHandler.swift`/`Info.plist`/`ContentBlockerRequestHandler.entitlements`
   and instead add the ones already written under
   `app/ios/Guardian/DNSFilter/GuardianContentBlocker/` (same folder name) to that new target.
5. Add the **App Groups** capability (`group.com.guardian.app`, matching
   `GuardianContentBlocker.entitlements`) to BOTH the main `app` target and the
   `GuardianContentBlocker` extension target in Xcode's Signing & Capabilities tab — this
   requires an Apple Developer account (see the section above / T27), since App Groups is a
   provisioning-profile-backed capability, not something Xcode can fake for a personal team in
   every case.
6. Build: `xcodebuild -workspace app.xcworkspace -scheme app -sdk iphonesimulator -configuration
   Debug build` (simulator build needs no signing; a device build needs the entitlement/profile
   from step 5 and T27's process).

Until steps 2–6 happen, `DNSFilterManager.swift`/`ContentBlockerRequestHandler.swift` typecheck
standalone (`xcrun swiftc -typecheck`, verified — see T26's LEDGER entry) but are not compiled
into any app binary; `DNSFilterModule.swift`/`DNSFilterModule.m` additionally require the
Pods-installed `React` module and can only be verified by the full `xcodebuild` in step 6.

**T27 (FamilyControls/ManagedSettings/DeviceActivity) adds the same kind of manual step, plus
one cross-target gotcha** — after step 2 above, also:

7. Add `app/ios/Guardian/ScreenTime/ScreenTimeAuthorization.swift`,
   `ManagedSettingsController.swift`, `ScreenTimeModule.swift`, `ScreenTimeModule.m` to the main
   `app` target (same "Add Files to app…" step as T26's DNSFilter/ files).
8. File → New → Target… → **Device Activity Monitor Extension**, name it
   `GuardianDeviceActivityMonitor`. Delete Xcode's generated principal-class/Info.plist/
   entitlements files for that new target and add the ones already written under
   `app/ios/Guardian/ScreenTime/GuardianDeviceActivityMonitor/` instead (same swap-in pattern as
   T26's `GuardianContentBlocker` step 4).
9. **`app/ios/Guardian/ScreenTime/Shared/PendingAppUsageEvent.swift` must be added to BOTH the
   main `app` target and the `GuardianDeviceActivityMonitor` target's membership** (check both
   boxes in Xcode's File Inspector, or drag it onto both targets) — a reviewer caught that this
   file's `PendingAppUsageEvent`/`ScreenTimeAppGroup` types are referenced from files in both
   targets, and app extension targets compile as a **separate Swift module** from the main app,
   so a type defined in only one target is invisible to the other even though they share an App
   Group at runtime. Forgetting this step produces `cannot find 'PendingAppUsageEvent' in scope`
   at build time in whichever target you didn't add it to.
10. Add the **App Groups** capability (`group.com.guardian.app`) to the `GuardianDeviceActivityMonitor`
    target too (same as `GuardianContentBlocker` in step 5 above), plus the
    `com.apple.developer.family-controls` entitlement to the main `app` target once available
    (see the "Apple Developer account & FamilyControls entitlement" section above).
