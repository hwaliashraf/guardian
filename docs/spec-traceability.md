# Spec Traceability — T30 Integration Verification

Maps `project_spec_parental_app.md` (v0.1) §3.1–§3.8, §4, §5, §6 to the code that implements
each bullet, with an honest verification status per bullet:

- **tested-and-passing** — automated test exists and passes, or live end-to-end verification was
  performed against a real local instance (documented in `LEDGER.md`).
- **written-but-environment-unverified** — real, complete code exists but this build environment
  lacks the toolchain to compile/run it (no JVM, no Apple entitlement, etc. — see `SETUP.md`).
- **partial** — some of the bullet is built and verified; the rest is documented below as missing
  or unverified.
- **not built** — no code implements this bullet at all.

Read this alongside three cross-cutting findings that explain *why* several bullets below are
partial or missing, rather than repeating the same root cause bullet by bullet:

## Cross-cutting finding 1: T20 was never executed

`tickets/T20.md` ("Parent tamper-alerts & tier/paywall UI") exists as a ticket file but has **no
corresponding `### T20` entry in `LEDGER.md`** — confirmed by `grep "^### T" LEDGER.md` (jumps
T19 → T21) and by `last_ticket.md`'s history. No `PaywallScreen.tsx`, no tamper-alerts feed
screen, no PIN-protected-settings gate, and no `TamperPolicy.autoLockUntilRestored` enforcement
exist anywhere in `app/` (confirmed by `find`/`grep` — zero matches). This is a **decomposition
execution gap**, not a code defect: the ticket was written, depended-on by T21+ (T14's `Paywall`
route stub explicitly says "T20 must build..."), and simply never ran. It is the direct or
indirect cause of every "not built" status below under §3.7 and part of §3.8.

## Cross-cutting finding 2: every native→JS bridge event is unconsumed

T22 (`guardianBlockAttempt`/`guardianTamperDetected`), T23 (`guardianYouTubeView`/
`guardianPresenceTick`/`guardianTamperDetected`), T24 (`guardianSessionWarning`/
`guardianTamperDetected`), T25 (presence ticks) all emit real RN bridge events from real Kotlin
code. **Zero of them are consumed anywhere in `app/src`** — confirmed:
`grep -rn "NativeEventEmitter\|DeviceEventEmitter" app/src` returns nothing, and
`app/src/child/dashboard/useLocalBucketEngine.ts` (the one place that would plausibly listen)
hardcodes `level1Still: false`, `level2FaceSamples: []` and derives everything else in pure JS.
Each individual ticket flagged its *own* event as an accepted, isolated gap ("no JS listener
consumes this yet"); taken together across five tickets, this means **the entire native-signal
pipeline is disconnected from the app** — every "written-but-environment-unverified" native
module below is also, independently, not wired to anything that would use its output even once
compiled. This is a distinct problem from the environment-compilation gap and needs its own
follow-up ticket (a JS-side event-merge layer), not just a JDK install.

## Cross-cutting finding 3: no family ever has a real `Subscription` row

T10's signup handler never creates a `subscription` row (T12's LEDGER entry flags this
explicitly). No ticket provisions one at signup or upgrade — that was T20's job (see finding 1).
Consequence: **every family in a real deployment is permanently `tier: 'free'`**, so every
Standard/Premium-gated feature below is unreachable in practice regardless of its own
implementation status, until a human either builds T20 or manually inserts a `subscription` row.

---

## §3.1 Screen time management

| Bullet | Files | Status |
|---|---|---|
| Daily/weekly limits per child | `packages/domain/src/buckets/engine.ts` (`BucketEngine.startSession`, T03), `app/src/parent/policy/ScreenTimeScreen.tsx` (T13) | tested-and-passing (`packages/domain/src/__tests__/integration.fullLifecycle.test.ts`, T30, new — full start→cap lifecycle) |
| "per device or aggregated across devices" | — | **not built** — `DailyUsageState` is per-child, single-device-local (spec §7's own offline-first design); no multi-device aggregation mechanism is ever invoked (see cross-cutting note on `reconcileOffline` below, §5) |
| Per-app-category time limits | `BucketPolicy.perCategory` (T02), `BucketsScreen.tsx` (T14) | tested-and-passing |
| Per-app time limits | `ScreenTimePolicy.perApp` (T02), gated backend-side as `per_app_limits` (T08) | **partial** — backend gate exists and is tested, but **no UI ever writes `perApp`** — confirmed: `ScreenTimeScreen.tsx`'s own comment states "perApp is preserved untouched — this screen doesn't edit per-app limits." Spec explicitly calls this out as a differentiator vs. Mobicip; it has no UI surface. |
| Schedules/routines (homework/bedtime/mealtime/school), separate weekday/weekend | `SchedulePolicy`/`RoutineType` (T02), `isWithinAllowedWindow` (T05), `SchedulesScreen.tsx` (T13) | tested-and-passing (weekday/weekend via separate `SchedulePolicy` rows, per T05's documented convention) |
| Vacation mode with auto-restore | `VacationMode` (T02), `shouldAutoRestore` (T05), `vacation-cron` edge function (T09), `VacationModeScreen.tsx` (T13) | tested-and-passing (T09: live-verified idempotent restore); **real cron scheduling itself is written-but-environment-unverified** — no deployed Supabase project exists here to actually fire `pg_cron` (SETUP.md documents the exact `cron.schedule` SQL) |
| Instant pause, one-tap all devices | `Policy.instantPause` (T02), `POST /policy-sync/instant-pause` (T08), `DashboardScreen.tsx` "Pause All Devices" (T12) | tested-and-passing (T08/T12 both live-verified end-to-end against a real local Supabase instance) |

## §3.2 Content filtering

| Bullet | Files | Status |
|---|---|---|
| DNS + browser filtering, 30+ categories | `CONTENT_CATEGORIES` (32 entries, T15), `dnsDecision.ts` (T22) + `DnsDecision.kt` (T22), `contentBlockerRules.ts` (T26) + Safari extension (T26), `ContentFilterScreen.tsx` (T15) | **partial** — TS decision logic and UI are tested-and-passing; the Kotlin/Swift mirrors are written-but-environment-unverified (no JVM/Xcode-project-build here); Android's Layer-1 VPN has the severe TCP-passthrough limitation noted under §4 below |
| Age-based presets | `getAgeBasedPreset` (T15), `deriveAgeTier` (T02) | tested-and-passing |
| Whitelist-only mode | `ContentFilterPolicy.whitelistOnly` (T02), enforced in `dnsDecision.ts` + `contentBlockerRules.ts` (T22/T26), UI toggle (T15) | tested-and-passing |
| Custom allow/block domains + keywords | Same files as above | tested-and-passing |
| SafeSearch on Google/Bing/DuckDuckGo + YouTube Restricted | `dnsDecision.ts`'s `safeSearchRewriteFor` (T22) | **partial** — Google and Bing are implemented and tested; **DuckDuckGo is explicitly NOT implemented** — `dnsDecision.ts`'s own comment: "DuckDuckGo's safe-search is a URL query parameter... intentionally NOT handled here (out of scope for a domain-name-only decision function)." Spec names DuckDuckGo explicitly; this is a real, documented (not hidden) gap. YouTube Restricted Mode CNAME rewrite is implemented and tested. |

## §3.3 App management

| Bullet | Files | Status |
|---|---|---|
| Block/allow installed apps | `AppRulePolicy` (T02), `AppManagementScreen.tsx` (T16) | tested-and-passing (UI); **backend gate missing** — see seam check 2 below (`app_blocker` is UI-gated only, `detectGatedFeatureTouches` never inspects `update.appRules`) |
| Preemptive block by store rating (17+/Mature default) | `blockByStoreRating` (T02/T16 UI) | **partial** — UI default and toggle are tested; **functionally inert on real devices** — T24's LEDGER RISK: Android's `PackageManager` has no store-rating API at all, `storeRating` is always `null` from real device data, and no manual-override UI was ever built (confirmed: `AppManagementScreen.tsx` treats `storeRating` as display-only) |
| New-app-install alerts | `new_install` payload contract (T16), `InstallAlertsScreen.tsx` (T16), `PackageAddedReceiver.kt` (T24) | **partial** — UI tested-and-passing; native producer is written-but-environment-unverified; contract honored exactly per T24's LEDGER cross-check |

## §3.4 Location

| Bullet | Files | Status |
|---|---|---|
| Real-time GPS on family map, two-way sharing | `location_update` payload contract (T17), `FamilyMapScreen.tsx` (T17) | **partial, and materially incomplete** — the consumer side (map UI, backend geofence evaluation) is tested-and-passing, but **no native code anywhere reports real GPS location** — no ticket (T17 itself explicitly deferred this to "T21/T24 territory," and neither built it) ever wires `Geolocation`/native GPS into a `location_update` post. `FamilyMapScreen` also only renders a static placeholder list (`FallbackMapProvider`, T17's documented swap point) pending a Maps API key, not real map rendering. |
| Geofences enter/leave alerts, 30-day history | `evaluateGeofences` (T17), `GeofenceEditorScreen.tsx` (T17), `getLocationHistory` (T17), `LocationHistoryScreen.tsx` (T17) | tested-and-passing for the evaluation logic and UI (T17: live end-to-end verified via curl, including idempotency); **30-day auto-deletion is explicitly not built** (T17's own "Not verified... noted as a data-retention-job follow-up") — history currently grows unbounded |

## §3.5 Monitoring & reports

| Bullet | Files | Status |
|---|---|---|
| Activity timeline: app usage, blocked attempts, searches | `ActivityTimelineScreen.tsx` (T18), `TIMELINE_EVENT_TYPES` | tested-and-passing |
| "browsing history" | — | **not built by design, not a ticket failure** — Phase-0 decision (LEDGER.md): "Chrome + DNS only. No bundled in-app browser this pass" — there is no in-app browser to capture page-level browsing history from; only `search_query`/`block_attempt` events exist |
| YouTube video history | `useYouTubeHistory.ts` (T18), `GuardianAccessibilityService.kt`'s YouTube capture (T23) | **partial** — payload contract verified to match exactly field-for-field (`{title, url, watchedAt}`, seam check 3 below); UI is tested-and-passing against the contract; **the native emission never reaches it** — same bridge-disconnection gap as cross-cutting finding 2 (`guardianYouTubeView` has zero JS listeners) |
| Weekly digest | `buildWeeklyDigest` (T09), `WeeklyDigestScreen.tsx` (T18), `digest-cron` (T09) | tested-and-passing (T09: live-verified); real scheduled firing is written-but-environment-unverified (no deployed project, same as vacation-cron above) |
| Social media monitoring (v2) | — | **out of scope by design** — spec itself defers this; Phase-0 decision confirms |

## §3.6 Child dashboard & collaboration

| Bullet | Files | Status |
|---|---|---|
| Child sees remaining time/buckets/schedules | `ChildDashboardScreen.tsx`, `useLocalBucketEngine.ts` (T21) | tested-and-passing (pure-JS approximation; correct against the real, unmodified `BucketEngine`/`evaluatePresence`) |
| Child requests extra time/unblock/schedule change | `RequestScreen.tsx` (T19/T21), `requests` edge function (T19) | tested-and-passing — T19 live-verified all three request types end-to-end including a reviewer-caught double-resolve race fix |
| "Parent approves/denies from a push notification" | `PushDispatcher`/`event-ingest` push dispatch (T08/T09) | **partial** — the backend *sends* the push (tested, live-verified dispatch + `push_log` rows); **nothing on the client ever registers for push or handles a tap** — confirmed: zero matches for FCM registration (`messaging().getToken`, `@react-native-firebase`, etc.) anywhere in `app/src`; `device.push_token` is therefore never populated by a real device, and T08's SETUP.md section already flags this as unbuilt. A parent cannot actually receive/tap the push this flow assumes. |

## §3.7 Tamper resistance

| Bullet | Files | Status |
|---|---|---|
| Uninstall protection + instant parent alert | `GuardianDeviceAdminReceiver.kt` (T24) | **partial** — native event emission (`uninstall_attempt`/`service_disabled`) is written-but-environment-unverified and contract-correct; **"instant parent alert" has no UI to land on** — this is T20's tamper-alerts feed screen, never built (cross-cutting finding 1) |
| Alert if VPN/accessibility/location off; optional auto-lock | `BypassPrevention.kt` (T22), `GuardianAccessibilityService.onUnbind` (T23) | **partial/not built** — the alert-emission signals exist (unverified-env); **`TamperPolicy.autoLockUntilRestored` is a data field with zero enforcing code anywhere** — no code path reads it and calls `UsageModule.lockDevice()` in response to a tamper event; this wiring was T20's explicit scope (`tickets/T20.md` line 28: "toggle row wired to `TamperPolicy.autoLockUntilRestored` and `pinRequired`") and never happened |
| PIN-protected settings on child device | `TamperPolicy.pinRequired` (T02, field only) | **not built** — no PIN-entry gate exists anywhere in `app/src/child`; this was T20's scope, never executed |

## §3.8 Accounts & tiers

| Bullet | Files | Status |
|---|---|---|
| Free/Standard/Premium feature table | `TIER_FEATURES`/`TIER_DEVICE_LIMIT` (T06) | tested-and-passing (43 tests, spot-checked against the spec table) |
| Enforcement of the table | see **Seam check 2** below | **partial, with real confirmed gaps** — several Standard-tier features have no backend gate at all, and (cross-cutting finding 3) no family can ever actually reach a paid tier in the first place since no `Subscription` row provisioning exists |

---

## §4 VPN Adult/Ad Shield

| Layer | Files | Status |
|---|---|---|
| Layer 1 — DNS filtering | `dnsDecision.ts` (T22, tested), `GuardianVpnService.kt`/`BlocklistLoader.kt`/`DnsDecision.kt` (T22) | **partial, with a severe documented limitation**: T22's own LEDGER entry states the VPN routes ALL traffic through the TUN but **does not implement TCP passthrough at all** — literal quote: "enabling this VPN breaks essentially all real HTTPS/web traffic on a device... **A human must resolve this before this service is ever enabled on a real device.**" This is the headline differentiator of the entire product and is not usable as built. |
| Layer 2 — in-browser ML image scanning | `NsfwClassifier.kt` (T25) | **not functionally built** — no bundled browser exists (Phase-0 decision), so there is no image source ever wired to the classifier; `NsfwModule.classifyImageUri` is a standalone, unintegrated share-intent hook per its own doc comment. No `.tflite` model ships either (binary asset, human must source it — SETUP.md documents this). |
| Layer 3 — accessibility text heuristics | `matchAdKeywords`/`textHeuristic.ts` (T23, tested), `AdKeywords.kt`/`GuardianAccessibilityService.kt`/`BlockOverlayView.kt` (T23) | written-but-environment-unverified (Kotlin), tested (TS decision logic) |
| Layer 4 — bypass prevention | `BypassPrevention.kt` (T22) | written-but-environment-unverified; documented limitations: DNS answers always synthesized as `TYPE=A` regardless of query type, IPv6 packets pass through completely unfiltered |
| KPIs (<0.5% adult-ad impressions, <10ms DNS latency, <3%/day battery) | — | **not measured** — no test harness exists for any of these three product-level metrics; the closest measured number is policy-*push* latency (`dbWriteAndDispatchMs` ~12–24ms, T08 live-verified), a different metric entirely |

## §5 Usage Buckets

| Rule | Files | Status |
|---|---|---|
| 4 counters (daily total, max session, mandatory break, session count) | `BucketEngine` (T03) | tested-and-passing — 27 unit tests (T03) + 19 native-port-spec cross-check assertions (T24) + 2 new full-lifecycle integration tests (T30, this ticket) |
| Short break doesn't reset session clock | `startSession`'s break-window read (T03) | tested-and-passing (T30's new integration test explicitly reproduces two consecutive early-restart attempts and confirms the break window is never pushed back) |
| 5-min/1-min warnings, grace finish | `tick`/`requestGraceFinish` (T03) | tested-and-passing |
| Per-category bucket overrides | `BucketPolicy.perCategory` (T03/T14) | tested-and-passing |
| "Buckets compose with schedules: a session cannot cross into bedtime" | `isWithinAllowedWindow` (T05) | **partial** — this predicate gates `startSession` (entry only, tested via T05's `integration.buckets-schedules.test.ts`); **`tick()` never re-checks the schedule window mid-session** — a session started before a bedtime boundary is not cut off when bedtime begins, only prevented from *starting* during it. Confirmed by reading `engine.ts`'s `tick(now: Date)` signature — it takes no schedule/window parameter at all. |
| Child dashboard transparency | `ChildDashboardScreen.tsx` (T21) | tested-and-passing |
| Multi-device sync, offline reconcile | `BucketEngine.reconcileOffline` (T03) | **written-but-never-invoked** — the method is real and unit-tested in isolation (including a reviewer-caught invariant bug, fixed), but has **zero real callers anywhere in the codebase**: `grep -rn "reconcileOffline"` outside its own test file finds exactly one hit, a *comment* in `useLocalBucketEngine.ts` noting the real sync path is "T08/T09's territory, already built" — which is not accurate; no edge function or client hook ever calls it. Multi-device reconciliation is designed and tested in isolation but not wired into any real reconnect flow. |

## §6 Presence / Attention Detection

| Level | Files | Status |
|---|---|---|
| Level 0 — media/interaction heuristics | `evaluatePresence` (T04, tested), `useLocalBucketEngine.ts` JS approximation (T21, tested) | tested-and-passing as a **JS-only approximation** on both platforms — this is the one presence level that genuinely works today without any native code, since it only needs touch events and a foreground app category, both available in JS |
| Level 1 — device motion | `MotionMonitor.kt` (T25) | **written but never reachable** — Kotlin exists (unverified-env); `useLocalBucketEngine.ts` hardcodes `level1Still: false` unconditionally (cross-cutting finding 2) |
| Level 2 — camera presence | `CameraPresenceService.kt`/`FaceWindow.kt`/`CameraOptIn.kt` (T25) | **written but never reachable, and never reachable by a user either** — Kotlin exists with reviewer-verified privacy guardrails (unverified-env); `useLocalBucketEngine.ts` hardcodes `level2FaceSamples: []`; **and separately, no on-device opt-in toggle screen exists anywhere in `app/src`** (confirmed by grep — T25's own LEDGER RISK: "no camera opt-in screen exists anywhere in app/src/child," never closed by any later ticket) — even a human bypassing the JS gap could not turn this on via the app UI today |
| Parent-configurable policy (levels/thresholds/onTrigger) | `PresencePolicy` (T02, type only) | **not built at all** — this is the single largest UI gap found in this pass: **no ticket in the entire T01–T29 sequence was ever assigned to build a parent-facing presence-detection settings screen** (confirmed: `grep -l -i "presence" tickets/*.md` matches no ticket whose scope is a presence config UI). Spec's own headline differentiator #3 has zero parent-facing configuration surface. |
| Refund mechanic | `BucketEngine.refundMinutes` + `evaluatePresence`'s `minutesToRefund` (T03/T04) | tested-and-passing in isolation; never triggered in a real flow since Levels 1–2 never reach the engine (same gap as above) |
| Privacy guardrails (opt-in, notification, on-device-only, boolean-only, in privacy policy) | `CameraPresenceService.kt` (T25, reviewer-verified code-level facts), `privacy-policy-draft.md`'s camera section (T28) | tested/verified where checkable — genuinely done well: T25's reviewer independently confirmed boolean-only persistence, zero network calls, notification-before-bind, and fail-closed defaults at the code level; T28's privacy policy draft accurately restates exactly these facts (cross-checked in this pass, no overclaim found) |
| iOS: Levels 0–1 only | — | **not built at all** — no ticket ever assigned iOS presence detection; `app/ios/Guardian/` contains only `DNSFilter/` (T26) and `ScreenTime/` (T27) — no `Presence/` directory, no motion-monitoring Swift file anywhere. iOS currently has *zero* presence detection, not even Level 0. |

---

## Seam checks (ticket Requirement 3)

### 1. `BucketEngine` full lifecycle, policy shaped like the real UI produces

New test: `packages/domain/src/__tests__/integration.fullLifecycle.test.ts` (T30). Built against
the exact `BucketPolicy`/`ScreenTimePolicy` object shape `BucketsScreen.tsx`/`ScreenTimeScreen.tsx`
actually save (full `{default, perCategory}` / `{dailyLimitMinutes, weeklyLimitMinutes, perApp,
perCategory}`). Exercises: start → 5-min warning → 1-min warning → grace finish → tick past the
grace-extended cap → end (verifies `updatedDailyUsage`/`break` shape) → an early-restart attempt
2 minutes into the mandatory break is refused (`mandatory_break_active`, correct remaining
minutes) → a second early attempt confirms the break window is never pushed back → a restart
attempt once the break has genuinely elapsed succeeds with a **fresh** session. Plus a second
test confirming daily-limit exhaustion blocks a new session outright. **Result: PASS** — 2/2
tests, run against the real, unmodified `BucketEngine` (`npx jest ... integration.fullLifecycle`
→ 2 passed).

### 2. `TIER_FEATURES` gating: backend (T08) vs. UI (T14/T16/T17/T20)

Every `Feature` from `packages/domain/src/tiers/features.ts`, cross-referenced against
`detectGatedFeatureTouches` (`packages/backend/src/policySync.ts`) and every `hasFeature`/
`assertFeature` call site (`grep -rn "hasFeature\|assertFeature" app/src packages/backend/src`):

| Feature | Tier | Backend gate | UI gate | Verdict |
|---|---|---|---|---|
| `website_blocker` | free | n/a (correctly ungated) | n/a (correctly ungated) | OK |
| `instant_pause` | free | n/a | n/a | OK |
| `app_blocker` | standard | **missing** | `AppManagementScreen.tsx` ✓ | **gap** — `detectGatedFeatureTouches` never inspects `update.appRules` at all; a Free-tier family can set `appRules` via a direct API call with zero server-side rejection |
| `schedules` | standard | **missing** | **missing** | **gap, both sides** — `SchedulesScreen.tsx` has no `hasFeature` call; T13's own LEDGER already flagged the backend half |
| `screen_time` | standard | **missing** (only the unrelated `perApp` subset is gated, under `per_app_limits`) | **missing** | **gap, both sides** — `ScreenTimeScreen.tsx` has no `hasFeature` call |
| `locator` | standard | **structurally impossible today** | `FamilyMapScreen`/`GeofenceEditorScreen`/`LocationHistoryScreen` ✓ | **gap** — T17 built geofence CRUD as direct `supabase-js` against the `geofence` table (RLS scoped to family ownership only, never checks `subscription.tier`); there is no code path through which a tier check could even happen server-side today |
| `vpn_shield` | premium | `contentFilter.safeSearchEnforced`/`youtubeRestrictedMode` ✓ | **missing** | **gap** — `ContentFilterScreen.tsx` has no `hasFeature`/upsell gate for these two fields; a Free-tier parent can toggle them in the UI and only discovers the block via `usePolicy`'s generic inline-403-after-save path (same fallback T13 already documented for `schedules`/`vacation`, not a proactive upsell like `BucketsScreen`/`AppManagementScreen` show) |
| `usage_buckets` | premium | ✓ | `BucketsScreen.tsx` ✓ | OK, matches |
| `presence_detection` | premium | `presence.levelNEnabled` ✓ | **no screen exists** | **gap** — see §6 above; nothing ever sets this field from the UI at all |
| `per_app_limits` | premium | `screenTime.perApp` non-empty ✓ | **no UI ever writes `perApp`** | **gap** — backend gate exists for a field nothing ever sets (see §3.1 above) |
| `priority_support` | premium | n/a (non-technical) | n/a | OK |

**Verdict: real, confirmed decomposition gaps** — of 11 features, 5 have a genuine backend-vs-UI
mismatch (`app_blocker`, `schedules`, `screen_time`, `locator`, `vpn_shield`), and 2 more are
backend-gated for a UI surface that doesn't exist (`presence_detection`, `per_app_limits`). Only
`usage_buckets` has full, matching, tested coverage on both sides.

### 3. `youtube_view` payload contract: T18 (documented) vs. T23 (produced)

T18 (`app/src/parent/reports/useYouTubeHistory.ts`): `{ title: string; url: string; watchedAt:
string }`. T23 (`AccessibilityModule.emitYouTubeView(title, url, watchedAtIso)` →
`map.putString("title"/"url"/"watchedAt", ...)`, called from
`GuardianAccessibilityService.kt`'s `attemptYouTubeCapture`): identical three field names, same
types, same order of definition. **Verdict: PASS, exact match** — verified by reading both files
directly, not by trusting either ticket's LEDGER prose. Caveat (see cross-cutting finding 2):
the contract match is real, but the event this contract describes never reaches the JS layer
that would consume it — `grep -rn "guardianYouTubeView" app/src` returns nothing.

### 4. `RISK:`/limitation notes from T23, T24, T25, T27 — current status

| Ticket | Risk/limitation | Status |
|---|---|---|
| T23 | No package→content-category mapping (`foregroundAppCategory` is a 2-way `video_streaming`/`other` fallback) | **still open** — reconfirmed present in T24/T25 too, never resolved |
| T23 | `level0Idle` uses a hardcoded 2-minute native placeholder, not the real policy threshold | **still open**, but low-impact — T21's JS-side `level0Idle` (the actually-used path) reads the real policy correctly; this only affects the never-consumed native duplicate |
| T23 | `guardianPresenceTick` unconsumed by any JS code; 3-option orchestrator decision requested | **still open** — none of options (a)/(b)/(c) from T23's ledger were taken; see cross-cutting finding 2 |
| T24 | Same package→category gap, bigger impact (native usage tracked under one synthetic category, no real per-category enforcement) | **still open** |
| T24 | `storeRating` always `null` (no PackageManager API), no manual-override UI | **still open** — confirmed, `AppManagementScreen.tsx` still treats it as display-only |
| T24 | No policy-sync bridge into the native loop (`UsageAccountant.policy` hardcoded placeholder) | **still open** — `UsageAccountant.updatePolicy()` exists but is never called from anywhere |
| T24 | Weekly cap cannot be enforced natively (`SessionStore` is one-day only) | **still open** |
| T24 | T05's schedule engine not ported/wired into the native loop | **still open** |
| T25 | Presence-sample merge point unresolved (same 3-option decision as T23, restated) | **still open** |
| T25 | No camera opt-in screen anywhere in `app/src/child` | **still open** — confirmed by grep, not built by T28 (which built the *disclosure* screen, a different, Play-policy-driven requirement, not the on-device consent toggle) or any later ticket |
| T25 | "Game category is foreground" gating approximation (same package→category gap) | **still open** |
| T25 | No `.tflite` NSFW model ships (binary asset, human must source it) | **still open**, human action documented in `SETUP.md` |
| T27 | `.child` vs `.individual` `FamilyControlsMember` authorization mode unconfirmed | **still open**, explicitly deferred to real-device testing (both `ScreenTimeAuthorization.swift` and `apple-entitlement-application-draft.md`, T28, restate this) |
| T27 | No `FamilyActivityPicker` UI (parent app/site selection for iOS shielding) | **still open** — no later ticket built it |
| T27 | `SchedulePolicy.daysOfWeek` not enforced by `DeviceActivitySchedule` (no day-of-week field in Apple's API) | **still open**, platform-level constraint, documented |
| T27 | Content-category shielding has no cross-taxonomy mapping to Apple's `ActivityCategoryToken` | **still open**, same class of gap as Android's package→category mapping, mirrored on iOS |

**Verdict**: of 16 tracked risk/limitation notes across these 4 tickets, **zero have been
resolved by any later ticket** — every one is still exactly as open as when it was first flagged.
None were silently dropped (all are still traceable in their origin ticket's LEDGER entry), but
none were picked up either.

---

## Environment/verification honesty audit (Requirement 4)

Every `unverified`/`Not verified`/`no JVM`/`swiftc -typecheck`-class claim found via
`grep -n "UNVERIFIED\|BLOCKED\|unverified\|no JVM\|Not verified" LEDGER.md` was cross-checked
against `SETUP.md` for a corresponding actionable section:

| Unverified claim | Ticket | SETUP.md section |
|---|---|---|
| No JVM/Gradle → Kotlin never compiled (T22–T25) | T22–T25 | "Java / Android SDK" ✓ |
| No Apple Developer account/entitlement → Swift compiles but can't authorize at runtime | T26/T27 | "Apple Developer account & FamilyControls entitlement" ✓ |
| No CocoaPods/Xcode project membership → Swift files not in any target | T26/T27 | "Xcode / CocoaPods" (incl. T27's dual-target-membership gotcha, added post-review) ✓ |
| No `.tflite` model binary | T25 | "TFLite NSFW model" ✓ |
| No Firebase account → `FcmPushDispatcher` never exercised | T08 | "FCM / push credentials" ✓ |
| No Maps API key → no real interactive map | T17 | "Maps provider" ✓ |
| Device-JWT RLS `42501` bug (`event-ingest`/`requests` INSERT) | T09/T19 | "Device-pairing JWT secret" ✓ (documents the exact symptom, not just a generic pointer) |
| No adb/device/emulator | Phase-0 | "Android device/emulator" ✓ (filled in by T29, was the one remaining `TBD`) |
| No deployed Supabase project → cron scheduling unverified | T09 | "Scheduled cron jobs" ✓ |

**No process gap found**: every genuine environment-blocked/unverified claim in the ledger has a
corresponding, accurate `SETUP.md` section — this was true before this ticket (T29 already
closed the one remaining `TBD`) and remains true now. **Distinct from this**: the T20-absence and
native-bridge-disconnection findings above are *decomposition/wiring* gaps, not *environment*
gaps — `SETUP.md` documents how to set up toolchains, not which tickets never ran or which events
nobody subscribed to; those need a follow-up ticket, not a `SETUP.md` entry, and are reported
above instead.

Also found and fixed directly (small doc correction, in-scope per this ticket's "small doc/
SETUP.md corrections are fine to make directly" allowance): `SETUP.md`'s "Supabase CLI / project"
section never told a human to actually connect the RN app to the local instance (`app/.env` from
`app/.env.example`) — added.

---

## Full test suite (Requirement 1)

`npm install && npm run lint && npm run typecheck && npm test --workspaces --if-present` — all
green. Full output:

```
npm run lint    → eslint . --ext .ts,.tsx  → exit 0, no output
npm run typecheck → backend/domain/app tsc -p tsconfig.json --noEmit, all exit 0
root npx tsc -p tsconfig.base.json --noEmit → exit 0

npm test --workspaces --if-present:
  @guardian/backend  Test Suites: 7 passed, 7 total   Tests: 82 passed, 82 total
  @guardian/domain    Test Suites: 12 passed, 12 total  Tests: 169 passed, 169 total  (was 167; +2, this ticket's new integration.fullLifecycle.test.ts)
  app                 Test Suites: 20 passed, 20 total  Tests: 85 passed, 85 total
```

`npm audit`: 33 vulnerabilities reported (7 moderate, 26 high) in transitive dependencies —
flagged here as a finding per this ticket's "report, don't fix" scope; not triaged or patched by
this ticket (no CVE-level investigation performed, out of scope for an integration-verification
pass; a future ticket should run `npm audit` and triage).

`npx jest --listTests` (root, domain+backend multi-project config) — 18 files, one per module
built across T02–T27, cross-checked against Requirement 4's named list:

```
packages/backend/src/__tests__/eventIngest.test.ts
packages/domain/src/ios/__tests__/contentBlockerRules.test.ts        (content-blocker rules)
packages/domain/src/buckets/__tests__/engine.test.ts                 (bucket engine)
packages/backend/src/__tests__/policySync.test.ts
packages/domain/src/tiers/__tests__/gate.test.ts                     (tier gating)
packages/backend/src/__tests__/pairing.test.ts
packages/domain/src/buckets/__tests__/nativePortSpec.test.ts         (native-port spec)
packages/backend/src/__tests__/digest.test.ts
packages/domain/src/__tests__/integration.buckets-schedules.test.ts
packages/domain/src/__tests__/integration.fullLifecycle.test.ts      (T30, new)
packages/domain/src/contentCategories.test.ts                        (content categories)
packages/backend/src/__tests__/geofence.test.ts                      (geofence evaluator — lives in packages/backend, not domain; ticket's Requirement 4 text mislabels its workspace, but it is present and tested)
packages/domain/src/vpn/__tests__/textHeuristic.test.ts              (text-heuristic decision port)
packages/domain/src/vpn/__tests__/dnsDecision.test.ts                (VPN decision port)
packages/domain/src/schedules/__tests__/engine.test.ts               (schedule engine)
packages/domain/src/presence/__tests__/evaluator.test.ts             (presence evaluator)
packages/backend/src/__tests__/vacationCron.test.ts
packages/domain/src/ageTier.test.ts
packages/backend/src/__tests__/requests.test.ts
```

Every module Requirement 4 names is present and tested; nothing is orphaned from the root Jest
config.

---

## Final verdict

**Genuinely done and verified**: the entire `packages/domain` pure-logic layer (bucket engine,
presence evaluator, schedule engine, tier gating, content categories, VPN/text-heuristic decision
ports, content-blocker rules) and `packages/backend`'s edge functions, live-verified end-to-end
against a real local Supabase instance repeatedly across T07–T19 — this is the strongest, most
trustworthy layer of the whole build. The parent-facing config UI (T12–T18) is real, tested, and
(where checkable) live-verified against the backend. The compliance documentation (T28) is
accurate and honest about its own gaps.

**Written-but-environment-unverified**: all Android Kotlin (T22–T25) and iOS Swift (T26–T27)
native code — real, complete, never compiled (no JVM here) or built into an Xcode target (no
Apple entitlement/CocoaPods project here). `SETUP.md` gives a human a complete, accurate path to
finish this.

**Not built at all**: T20's entire scope (paywall/billing provisioning, tamper-alerts UI,
PIN-protected settings, auto-lock enforcement) — a decomposition execution gap, not a code
defect. Per-app time limits UI. Parent-facing presence-detection settings UI (spec's own
headline differentiator #3 has no configuration surface at all). iOS presence detection (Levels
0–1) — never assigned to any ticket. Push-notification receipt/registration on the client. Real
GPS location reporting from any device. 30-day location-history auto-deletion. Layer 2 (in-browser
NSFW scanning) has no image source to scan, by design (no bundled browser this pass).

**Structurally broken as shipped, not just unverified**: Layer 1's `VpnService` drops all TCP
traffic while active — enabling it on a real device breaks the device's internet access
entirely, per T22's own LEDGER admission. This is the headline feature of the entire product and
cannot be turned on as currently built.

**Systemic gap spanning 5 tickets**: every native→JS bridge event (T22–T25) is emitted but never
consumed — the whole native-signal pipeline (block attempts, tamper detection, presence ticks,
session warnings, YouTube views) is disconnected from the app that would act on it, independent
of whether the native code itself ever compiles.

This ticket's own scope is `docs/spec-traceability.md` + the new integration test + small
SETUP.md corrections; per its explicit "Out of scope" instruction, none of the gaps above were
fixed here — they are reported for the orchestrator to schedule as follow-up tickets (starting,
most obviously, with T20 itself, and a new ticket for the native-bridge-event JS consumer layer).
