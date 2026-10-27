# Guardian — Parental Control App

Cross-platform (Android + iOS) parental control app. Monorepo: shared domain logic
(`packages/domain`), Supabase backend (`packages/backend`), React Native app (`app`), and native
Android (Kotlin) / iOS (Swift) modules under `app/android` / `app/ios`.

Full spec: [`project_spec_parental_app.md`](./project_spec_parental_app.md). Build history and
every design decision: [`LEDGER.md`](./LEDGER.md). Environment setup: [`SETUP.md`](./SETUP.md).
Spec-vs-implementation audit: [`docs/spec-traceability.md`](./docs/spec-traceability.md).

## 1. Problem

Parents of children aged ~5–16 need a way to manage screen time, filter content, and stay aware
of what's happening on their kids' devices — without the two failure modes most parental-control
apps fall into:

- **Screen time as a single daily number is easy to game.** A child can burn an entire day's
  allowance in one unbroken sitting, and a flat timer doesn't stop a game or video from running
  unattended while the child has actually walked away.
- **Content filtering that's easy to defeat or full of gaps.** DNS-only filtering misses in-app
  content; accessibility-only filtering misses browser traffic; neither alone catches adult ad
  networks embedded in otherwise-safe apps.

The benchmark competitor is Mobicip. The goal is full feature parity with it (screen time,
content filtering, app management, location, monitoring, tamper resistance, tiered
subscriptions) plus three differentiators Mobicip doesn't do well:

1. **Layered VPN adult/ad shield** — DNS filtering + in-browser ML image scanning +
   accessibility-based text heuristics + bypass prevention, so no single layer is a single point
   of failure.
2. **Usage buckets** — screen time governed by session-length caps and mandatory breaks, not
   just a daily total, so a child can't spend the whole allowance in one sitting.
3. **Presence/attention detection** — a signal ladder (touch/interaction → device motion →
   optional camera face-detection) that pauses the timer and locks the screen when a child walks
   away from a running app, and refunds the abandoned minutes back to their bucket.

## 2. Solution

**Architecture** (spec §7): a React Native app (parent + child roles in one codebase, swapped at
runtime) talks to a Supabase backend (auth, family/device registry, policy sync, event ingest,
push dispatch) and to native platform modules that do the actual on-device enforcement —
offline-first by design, so blocking/bucket logic never depends on a live network connection.

```
 Parent App (RN) ──┐
                   ├── Supabase (Auth, Policy DB, Event ingest, Push)
 Child App (RN) ───┘        │
   │  native layer          └── Blocklist pipeline (StevenBlack + OISD + HaGeZi, merged)
   ├── VpnService (Android, DNS filter)                    NEDNSSettingsManager (iOS)
   ├── AccessibilityService (Android, foreground app / text heuristics / anti-tamper)
   ├── UsageStats + Bucket engine (local, offline-capable)
   ├── Device Admin (Android, uninstall protection)         FamilyControls (iOS, screen time)
   └── Presence service (input/motion/CameraX+MLKit, Android only)
```

**What's actually built**, by layer:

- `packages/domain` — every piece of enforcement/policy logic as pure, unit-tested TypeScript:
  the usage-buckets engine, the presence signal-ladder evaluator, the schedules engine, tier
  gating, the content-category list, the VPN DNS-decision and Layer-3 text-heuristic decision
  tables, iOS Safari content-blocker rule generation. This is the most heavily tested, most
  trustworthy layer of the codebase (169 tests) and doubles as the executable spec that the
  native Kotlin/Swift is hand-ported against.
- `packages/backend` — Supabase Postgres schema + RLS policies, and edge functions for
  auth/pairing, policy sync + push dispatch, event ingestion, weekly digests, vacation
  auto-restore, geofencing, and the child request/parent-approve flow.
- `app/src` — the React Native UI: parent-side config screens for every policy surface (screen
  time, schedules, vacation mode, usage buckets, content filtering, app management, location/
  geofencing, reports, tamper alerts, tier/paywall), plus the child-side dashboard and request
  flow.
- `app/android` — Kotlin native modules for all five Android-side enforcement mechanisms listed
  in the diagram above.
- `app/ios` — Swift native modules for the reduced iOS "companion" scope: DNS profile + Safari
  content blocker, and FamilyControls/ManagedSettings/DeviceActivity screen-time enforcement.

**What's real vs. what's environment-blocked**: this was built in an environment with no JDK/
Android SDK, no Apple Developer account, and no deployed cloud project — so all Kotlin/Swift is
real, complete code that has never been compiled, and several backend flows are unit-tested but
not live-verified against a deployed instance. Everything in `packages/domain` and
`packages/backend` that *could* be verified locally (Supabase running in Docker) was, repeatedly,
end-to-end. See `docs/spec-traceability.md` for the full, honest breakdown of what's tested, what's
written-but-unverified, and what's genuinely missing.

## 3. How to run

Requires Node.js (built against v24.18.0) and npm.

```sh
npm install
npm run typecheck   # root tsc + each workspace's own tsc -p tsconfig.json --noEmit
npm run lint        # eslint . --ext .ts,.tsx, repo-wide
npm test            # fans out to packages/domain, packages/backend, app (Jest)
```

To also exercise the backend against a real local instance (requires Docker):

```sh
cd packages/backend
supabase start
supabase db reset
cd ../..
```

Connect the RN app to it: `cp app/.env.example app/.env`, then fill in `SUPABASE_ANON_KEY` with
the value `supabase start`/`supabase status` printed.

To build/run the native Android or iOS apps, or to wire up push notifications, maps, the NSFW
model, or the Apple FamilyControls entitlement — **see [`SETUP.md`](./SETUP.md)**, which has a
dedicated, step-by-step section for each of these (none of them are needed for the commands
above). CI runs the same lint/typecheck/test commands on every push — see
`../../.github/workflows/ci.yml` at the repo root (this project lives inside a larger monorepo;
GitHub Actions requires workflows at the true repo root, not this directory).

## 4. Assumptions

Decisions made where the spec left a choice open, or where the build environment forced a
substitution (full reasoning for each is in `LEDGER.md`'s "Phase 0" section and the relevant
ticket entries):

- **Backend: Supabase**, not Firebase — Postgres + RLS gives row-level policy enforcement and a
  local dev loop (Docker) without needing a cloud account.
- **Blocklist sourcing: free curated open lists** (StevenBlack + OISD + HaGeZi merged), not a
  paid commercial feed — no vendor budget/approval was given, and a new paid dependency is an
  escalation decision, not a default.
- **Safe browser: Chrome + DNS only, no bundled in-app browser** — the Layer-2 NSFW image
  scanner ships as a standalone, callable on-device classifier rather than a full browser
  product. Consequence: it has no image source wired into it yet (see Future TODOs).
- **VPN adult-ad shield stays Premium-only** — matches spec's tier table literally; no free-tier
  DNS-filter acquisition hook was built.
- **Presence-triggered pauses notify the parent on every trigger**, not digest-only.
- **Social media conversation monitoring is out of scope** — the spec itself defers this to v2.
- **Windows/macOS/Chromebook are out of scope** — the spec defers these to v2; only Android
  (full) and iOS (reduced companion set) were built.
- **Pairing mechanism**: a parent-generated 6-digit code, 10-minute TTL, redeemed by the child
  device — the spec asked for "some registration flow" without specifying the mechanic.
- **iOS presence detection: not attempted** — the spec scopes iOS to "Levels 0–1 only, no
  background camera," but no ticket in the build plan was ever assigned to build it; iOS
  currently has zero presence-detection code (Android has it, but see the bridge-event gap
  below).

## 5. Future TODOs

In priority order — the first two are the most consequential, both surfaced by a full
integration-verification pass (`docs/spec-traceability.md`) after the initial 30-ticket build:

1. **Wire the native→JS event bridge.** Every native Android module (VPN block attempts, tamper
   detection, presence ticks, session warnings, YouTube-view capture) emits a correctly-shaped
   React Native bridge event — and none of them are consumed anywhere in the app. This is a
   single, well-scoped follow-up (a JS-side listener/merge layer) that would unlock presence
   Levels 1–2, real tamper alerts, and YouTube history all at once.
2. **Fix Layer 1's VPN**: it currently drops all TCP traffic while active, which breaks a
   device's internet access entirely. This is the product's namesake feature and needs a real
   fix (either a proper TCP passthrough/NAT layer, or switching to DNS-only TUN routing) before
   it can be enabled on a real device.
3. **Close the backend/UI tier-gating gaps.** Five of eleven gated features have a mismatch
   between what the UI enforces and what the backend (`policy-sync`) enforces — most notably,
   `schedules` and `screen_time` currently have no backend gate at all, so they're unrestricted
   for every tier regardless of the UI's upsell screens.
4. **Provision a real `Subscription` row at signup/upgrade.** No family can currently reach a
   paid tier in practice — signup never creates one, and the paywall's "Contact us" action is
   intentionally a placeholder (no payment processor is integrated yet).
5. **Build the missing config UI**: per-app time limits (the backend gate exists; no screen ever
   sets it) and presence-detection settings (spec's own headline differentiator #3 currently has
   no parent-facing configuration screen anywhere).
6. **Real GPS reporting and push-notification receipt on the client** — the backend/UI consumer
   side for both location updates and push notifications is built and tested, but no native code
   reports real GPS coordinates, and no client-side FCM registration/notification-tap handling
   exists yet.
7. **Finish native verification** once a JDK/Android SDK, an Apple Developer account +
   FamilyControls entitlement, and a deployed Supabase project are available — see `SETUP.md`
   for the exact steps for each.
8. **Data-retention job** for 30-day location-history auto-deletion (not built; history currently
   grows unbounded), and a triage pass on `npm audit`'s 33 flagged transitive-dependency
   vulnerabilities.
