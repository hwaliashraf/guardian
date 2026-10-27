# LEDGER — Guardian (Parental Control App)

Spec: `project_spec_parental_app.md` (v0.1, July 2026)
Orchestration started: 2026-07-10

## Phase 0 — Intake decisions (human-approved)

1. **Build scope**: "Whole shebang" — write real, full code across the entire spec (RN app,
   Supabase backend, Android native modules, iOS native modules), including tests wherever
   the code can actually be exercised in this environment. Where the environment lacks what's
   needed to build/run/verify (no Java runtime → no Gradle/Android build; no adb/device/emulator;
   no Apple Developer account or FamilyControls entitlement; no provisioned Supabase cloud
   project), the code is still written for real (not stubbed) but its verification status is
   reported honestly as unverified, with exact setup steps for the human to finish verification
   later. Environment probe (2026-07-10): Node v24.18.0/npm 11.16.0 present; **no Java** (`java -version`
   fails); Android SDK dir exists at `~/Library/Android/sdk` but **no `adb`, no device/emulator**;
   Xcode 15.4 present but **no Apple Developer account/entitlement**; **no Firebase/Supabase CLI
   or account**.
2. **Backend**: Supabase (Postgres). Local dev/test via Supabase CLI + Docker — no cloud account
   required for this pass.
3. **Safe browser**: Chrome + DNS only. No bundled in-app browser this pass. Layer-2 NSFW image
   scanning ships as a callable on-device ML module/hook (TFLite), not a full browser product.
4. **Presence-trigger parent notifications**: real-time push on every trigger (not digest-only).
5. **Free-tier VPN scope**: Premium-only, exactly as spec's section 3.8 table states. No free
   DNS-adult-filter acquisition hook this pass.
6. **Blocklist sourcing** (orchestrator decision, not escalated — build-vs-buy, not product):
   free curated open lists (StevenBlack + OISD + HaGeZi merged), not a paid commercial feed.
   Reason: CLAUDE.md treats new paid vendor deps as an escalation decision; no budget/vendor
   approval was requested or given, so the free/open default is the safe choice. Flagged in
   final report as swappable later if a commercial feed is desired.
7. **Social media conversation monitoring**: out of scope (spec already defers this to v2).
8. Windows/macOS/Chromebook platforms: out of scope (spec defers to v2).

## Ticket log

### T01 — Monorepo scaffold & tooling

- Created root `package.json` (npm workspaces: `packages/*`, `app`; `lint`/`typecheck`/`test`
  scripts fan out via `npm run <script> --workspaces --if-present`), `tsconfig.base.json`,
  `eslint.config.mjs` (flat config, typescript-eslint recommended + eslint-config-prettier),
  `.prettierrc.json`, `jest.config.js` (multi-project, `ts-jest` preset, matches
  `packages/*/src/**/*.test.ts`), `.editorconfig`, `SETUP.md` (skeleton + Node/npm versions
  filled in), and empty dirs `packages/domain/src`, `packages/backend`, `app` with `.gitkeep`.
- **Dependency pin decision**: pinned `typescript` to `6.0.3` (not registry `latest` 7.0.2).
  `typescript-eslint@8.63.0` requires `typescript >=4.8.4 <6.1.0` and `ts-jest@29.4.11` requires
  `typescript >=4.3 <7` — no version of either tool supports TS 7 yet as of this build's
  registry snapshot (2026-07-10), so installing `typescript@latest` would break `npm install`
  (ERESOLVE) or the eslint/jest toolchain. 6.0.3 is the newest release satisfying both peer
  ranges. Future tickets should re-check this pin before bumping TypeScript.
- **tsconfig.base.json quirk**: added `"references": []` (not `"files": []`) so that
  `npx tsc -p tsconfig.base.json --noEmit` succeeds with zero source files on disk — TS7 errors
  (TS18002/TS18003) on an empty/unmatched `files`/`include` unless the config declares
  `references` (verified empirically). `references` is not inherited via `extends`, so
  workspace tsconfigs extending this base are unaffected.
- **eslint.config.mjs quirk**: flat config in ESLint 10 ignores the legacy `--ext` CLI flag and
  lints all matched files by default (including root `*.config.js`), so a dedicated
  `languageOptions.globals` block (module/require/process/__dirname) was added for
  `*.config.js`/`*.config.cjs` to avoid `no-undef` on CommonJS globals.
- Verified: `npm install` (0 vulnerabilities, only benign deprecation/allow-scripts warnings),
  `npx eslint . --ext .ts,.tsx` (exit 0), `npx jest --listTests` (exit 0, empty list),
  `npx tsc -p tsconfig.base.json --noEmit` (exit 0).

### T02 — Shared domain types & contracts (packages/domain)

- Created `packages/domain` workspace: `package.json` (name `@guardian/domain`, deps: `zod
  ^4.4.3` only — no RN/Supabase), `tsconfig.json` (extends root `tsconfig.base.json`, `outDir:
  dist`, `rootDir: src`, `declaration: true`, excludes `*.test.ts` from build output), `src/
  types.ts` (every interface/type from the ticket, verbatim field names/types), `src/schemas.ts`
  (zod schema mirroring each type, exported as `<Name>Schema`), `src/ageTier.ts`
  (`deriveAgeTier(birthdate, asOf?)` — young <8, preteen 8–12, teen 13+, handles not-yet-had-
  birthday-this-year), `src/ageTier.test.ts` (5 unit tests), `src/index.ts` barrel.
- **zod v4, not v3**: registry's `latest` at build time (2026-07-10) is `zod@4.4.3`. Used the
  v4 two-arg `z.record(keySchema, valueSchema)` form (v3's single-arg form is
  deprecated/changed in v4) — flagged here since later tickets writing zod schemas against
  `packages/domain` types should match this v4 API, not v3 examples found online.
- **Root `tsconfig.base.json` regression fix**: adding real `.ts` files under `packages/
  domain/src` broke `npx tsc -p tsconfig.base.json --noEmit` (T01's Done-when criterion,
  still required by T02) — with no explicit `include`, TS's default include swept up the new
  workspace source files (missing `types: ["jest"]`, etc.), producing errors. Added `"include":
  []` to `tsconfig.base.json` (kept T01's `"references": []`) so the base config compiles zero
  files regardless of what real files later tickets add elsewhere in the repo; workspace
  tsconfigs override `include` (arrays don't merge across `extends`) so they're unaffected.
  Future tickets adding new workspaces should re-verify this root check after adding files.
- **`jest.config.js` "domain" project fix**: the placeholder multi-project config from T01
  used `preset: 'ts-jest'` with no explicit tsconfig path; ts-jest resolves tsconfig relative
  to the jest project's `rootDir` (repo root, which has no `tsconfig.json`, only
  `tsconfig.base.json`), so it silently fell back to bare default compiler options (missing
  jest ambient types → `Cannot find name 'describe'` etc.) regardless of `packages/domain/
  tsconfig.json`. Fixed by scoping `testMatch` to `packages/domain/src/**/*.test.ts` and
  setting `transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/packages/domain/
  tsconfig.json' }] }` explicitly (also avoids the deprecated `globals['ts-jest']` config
  style). Later tickets adding new workspaces with tests will need their own project entry
  with the same explicit-tsconfig pattern.
- Added `dist/` and `build/` to root `.gitignore` (build output from the new `build` script
  was previously untracked-but-not-ignored).
- Verified: `npm run build -w packages/domain` (exit 0, emits `dist/*.js`+`.d.ts`),
  `npm test -w packages/domain` (5/5 tests pass), `npx tsc -p tsconfig.base.json --noEmit`
  (exit 0), `npx eslint . --ext .ts,.tsx` (exit 0), `npx jest --listTests` (lists
  `packages/domain/src/ageTier.test.ts`), root `npm run typecheck`/`npm run test` fan-out
  both pass.

**Review-fix (post-DONE)**: the earlier `"include": []` fix on `tsconfig.base.json` made the
root `npx tsc -p tsconfig.base.json --noEmit` check compile zero files permanently (silently
exits 0 regardless of real type errors anywhere in the monorepo) — a reviewer caught this
since T03/T04 reuse the same check verbatim. Fixed by removing the `"include": []` override
and adding `"**/*.test.ts"` to the existing `"exclude"` list (kept `node_modules`, `dist`,
`build`, and T01's `"references": []`). Verified with a deliberate injected type error in
`packages/domain/src/types.ts` (`const __deliberateTypeError: number = "not-a-number";`):
check now correctly fails (`error TS2322: Type 'string' is not assignable to type 'number'`,
exit 2); reverted and confirmed exit 0 again. Root `npm run typecheck` and `npx eslint . --ext
.ts,.tsx` re-verified clean after the fix. **Note for future tickets**: the root tsc check now
actually typechecks every `.ts` file in the repo except tests/node_modules/dist/build — any
new workspace source with type errors will correctly fail this check going forward.

### T03 — Usage Buckets engine (packages/domain)

- Added `packages/domain/src/buckets/`: `types.ts` (`SessionState`, `BreakState`,
  `DailyUsageState`, verbatim per ticket), `engine.ts` (pure `BucketEngine` class —
  `startSession`, `tick`, `requestGraceFinish`, `endSession`, `refundMinutes`,
  `reconcileOffline`, all pure transforms, no mutation of `this`), `index.ts` barrel, and
  `__tests__/engine.test.ts` (26 tests). Re-exported from `packages/domain/src/index.ts` (added
  `export * from './buckets';`) so consumers can `import { BucketEngine } from
  '@guardian/domain'`.
- **Contract addition beyond the ticket's literal constructor list**: `BucketEngine`'s
  constructor takes an extra optional `weeklyMinutesUsed: number = 0` parameter. The ticket
  requires `startSession` to refuse on "daily/weekly total already exhausted," but
  `DailyUsageState` (as specified) only tracks a single day — there is no weekly-aggregate
  state type anywhere in scope yet. This param is the minimal necessary addition to make the
  weekly check implementable; **future tickets (T04/T07/T08, backend) must supply this by
  summing the week's persisted `DailyUsageState` rows** — no new persisted weekly-state shape
  was invented, this is purely an engine-input.
- **Mandatory-break design decision (flagged as the one genuinely ambiguous rule in the
  ticket)**: spec text says a break shorter than mandatory "does not reset the session clock —
  resuming early continues accruing against the same session, it does not grant a fresh full
  session," while the same ticket's `startSession` bullet separately says it must flatly
  *refuse* while an active mandatory break hasn't elapsed. These two readings are in tension
  (refusing early resume vs. letting it continue accruing on the same session). Chosen
  interpretation, documented inline in `engine.ts`: `startSession` refuses outright whenever
  `now` is still within the original `BreakState.startedAt + requiredMinutes` window; this
  refusal check is a pure read of the *original* break window and is never mutated/extended by
  repeated early attempts (so the break's own clock can't be reset by spamming attempts), and a
  session is only ever granted — always a **fresh** one (`elapsedMinutes: 0`) — once the full
  break has genuinely elapsed. **Risk**: if the product intent was instead for early-resume
  attempts to be *allowed* and literally continue accruing on the *same* (not fresh) session
  object, this would need revisiting before T04/T07/T08/T14 build against this contract — flagged
  for reviewer/human confirmation.
- **`reconcileOffline` conservative merge** (per ticket's explicit ask to document this design
  choice): additive sum of both snapshots' `perCategoryMinutesUsed`/`totalMinutesUsed`
  (never `max()`), each independently capped at `ScreenTimePolicy.dailyLimitMinutes` — additive
  is deliberately the conservative direction for a parental-control product (assumes more usage
  happened, never less; never grants back time or double-subtracts below zero).
  `perCategorySessionCount` is additive, uncapped (no per-session-count ceiling given).
  Mismatched `date` between the two snapshots throws (trust-boundary validation).
- Verified: `npm test -w packages/domain` — 2 suites, 26 tests, all passing. `npx tsc -p
  tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit 0. `npm run build -w
  packages/domain` exit 0 (emits `dist/buckets/*.js`+`.d.ts`).

**Orchestrator resolution of the mandatory-break risk above (no T03 rework needed):** rereading
`engine.ts`, `tick()` computes `elapsedMinutes` as continuous wall-clock time since
`session.startedAt` regardless of any intervening idle/locked period — so a brief pause already
"does not reset the session clock" by construction, *as long as the caller never calls
`endSession` for it*. `endSession`'s break-active refusal (the executor's literal reading) is
the correct behavior for the OTHER case the spec describes — the forced lockout after a session
hits its cap ("at the cap, the device locks... minimum lock-out before a new session can
start"). There is no real contradiction in the engine; the risk is entirely a **caller
contract**: T21 and T24 (the only two tickets that will ever call `BucketEngine.endSession`)
must be explicit that `endSession` is called ONLY when `tick()` reports `mustEnd: true` (cap
reached) or another affirmatively-classified qualifying break — never on trivial pauses (screen
lock, app backgrounded briefly, phone in pocket) — otherwise a 2-minute pause would wrongly
trigger a full mandatory-break lockout, which is exactly the bug the spec's "doesn't earn a
fresh 45" line warns against. Patched into T21.md and T24.md directly (see their "Caller
contract" additions) rather than reworking already-tested, correct engine code.

### T04 — Presence/attention signal-ladder policy logic (packages/domain)

- Added `packages/domain/src/presence/`: `types.ts` (`PresenceSignalSample`,
  `PresenceDecision` — reuses `DeviceEvent`/`EventType` from T02; `'presence_trigger'` was
  already in T02's `EventType` union, no T02 change needed), `evaluator.ts`
  (`evaluatePresence` — pure, no I/O/timers), `index.ts` barrel, `__tests__/evaluator.test.ts`
  (12 tests). Re-exported via `packages/domain/src/index.ts` (`export * from './presence';`).
- **Two documented deviations from the ticket's literal spec** (same category as T03's
  documented `weeklyMinutesUsed` addition — minimal necessary addition to make an
  under-specified contract implementable, not scope creep):
  1. **Signature**: added `deviceId: string, childId: string` params after
     `sessionStartedAt` (ticket's literal signature was 3-arg). The required `event` field
     (a full `DeviceEvent`) has mandatory `id`/`childId`/`deviceId`, and nothing else in the
     ticket's 3-arg signature supplies them. `event.id` is generated by a small dependency-free
     helper (`Date.now().toString(36)` + `Math.random().toString(36)`) — **not**
     `crypto.randomUUID()`: that node-builtin import breaks root `npx tsc -p
     tsconfig.base.json --noEmit` (`TS2591: Cannot find name 'node:crypto'` — reproduced with
     both `'node:crypto'` and bare `'crypto'` imports; root `tsconfig.base.json` has no
     `"types"` array so Node's ambient module augmentations aren't resolved there, unlike
     `packages/domain/tsconfig.json` which explicitly sets `"types": ["jest","node"]`).
     Avoided touching the shared root tsconfig for this; flagged here in case a future ticket
     needs a real Node builtin from `packages/domain` and has to actually fix this properly.
  2. **Level 0 trigger condition**: Context prose mentions an `audioFocusActive` input to
     distinguish video-watching, but the literal `PresenceSignalSample` field list (Requirements
     #1) has no such field. Resolved as: Level 0 triggers on `level0Idle && stillPromptTimedOut`
     — `level0Idle` is treated as already fully-derived by upstream native code (which is
     responsible for any audio/video-aware threshold adjustment before setting it), and
     `stillPromptTimedOut` is the universal final abandonment-confirmation gate. Does not
     invent a field the type contract doesn't have. Flagged for reviewer/T25 confirmation.
- Level 2 (face detection): triggers only when the **last two** entries of
  `level2FaceSamples` are both `false`; arrays shorter than 2 never trigger.
- Refund minutes = `max(0, elapsedSessionMinutes - policy.thresholdMinutes[level])`, applied
  uniformly across all 3 levels (idle tail only, never the attentive time before the
  threshold), and zeroed out entirely when `policy.refundAbandonedMinutes` is `false`. Does not
  itself call `BucketEngine.refundMinutes` (T03) — returns `minutesToRefund` for the caller to
  pass through, matching the pure/no-I-O contract of this evaluator (same division of labor as
  T03's engine methods returning state fragments for callers to persist).
- On simultaneous multi-level triggers, lowest-numbered level wins for `level`/`event.payload`;
  `action` always resolves to the single global `policy.onTrigger`.
- Verified: `npm test -w packages/domain` — 3 suites, **39** tests, all passing (was 27; +12
  new). `npx tsc -p tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit 0.
  `npm run build -w packages/domain` exit 0.

**Review-fix (post-DONE): Level 0/video-gating bug.** A reviewer found the previously-documented
Level 0 condition (`level0Idle && stillPromptTimedOut`, unconditionally) wrongly made the
"Still watching?" prompt-timeout a mandatory gate for *every* foreground app, not just video —
so a game left idle past threshold with no audio/video playing could never trigger Level 0
(prompt only ever fires for video-type content), breaking the spec's lead scenario. **Fix**
(`evaluator.ts`): Level 0 now triggers on `level0Idle && (!VIDEO_LIKE_CATEGORIES.has(
foregroundAppCategory) || stillPromptTimedOut)` — idle alone triggers for non-video categories
(base rule, any watched app); video-like categories still require the prompt to time out first
(legitimate no-touch during playback). Added a local `VIDEO_LIKE_CATEGORIES = new Set([
'video_streaming', 'video', 'youtube'])` constant in `evaluator.ts` since the canonical
content-category id list doesn't exist yet (built in T15).
**RISK carried forward: T15 (or a later ticket) must reconcile its final content-category id
list against `VIDEO_LIKE_CATEGORIES` in `presence/evaluator.ts`** — if T15's ids don't match
this placeholder set, Level 0's video-gating will silently misclassify categories.
Test fix: `'idle alone without the prompt timing out does not trigger'` was locking in the bug
— renamed/refined to assert this only for a **video** category (`video_streaming`); added new
test `'idle alone DOES trigger for a non-video category (games) with no prompt involved'`.
Verified: `npm test -w packages/domain` — 3 suites, **40** tests, all passing (was 39; +1 new).
`npx tsc -p tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit 0. No other
part of `evaluator.ts` touched (refund math, lowest-level-wins, deviceId/childId signature all
unchanged).

**Review-fix (post-DONE): `reconcileOffline` internal-consistency bug.** A reviewer found
`reconcileOffline` broke its own invariant (`sum(perCategoryMinutesUsed) === totalMinutesUsed`,
which every other method preserves) once 2+ categories are involved, because it clamped
`totalMinutesUsed` and each `perCategoryMinutesUsed[c]` against `dailyLimitMinutes`
**independently**. Repro: two `{ totalMinutesUsed: 200, perCategoryMinutesUsed: { games: 100,
education: 100 } }` snapshots, `dailyLimit: 240` → merged to `{ totalMinutesUsed: 240,
perCategoryMinutesUsed: { games: 200, education: 200 } }` (sum 400 ≫ reported total 240).
**Fix** (`engine.ts`, `reconcileOffline`): compute the additive total and additive per-category
sums uncapped first; when the additive total exceeds `dailyLimitMinutes`, scale every
category's summed minutes down by the same factor (`dailyLimitMinutes / additiveTotal`) so
`sum(perCategoryMinutesUsed) === totalMinutesUsed` holds exactly after clamping, instead of
clamping each field independently. Docstring updated to state the invariant explicitly. Added
regression test `'multi-category merge stays internally consistent...'` in
`__tests__/engine.test.ts` reproducing the exact reviewer case (`games`+`education`, 200+200,
limit 240) asserting the merged per-category minutes sum to the merged total (120+120=240),
matching the ticket's original "offline reconcile does not double-count" done-when criterion
which the prior single-category-only test suite hadn't actually exercised for >1 category.
Verified: `npm test -w packages/domain` — 2 suites, **27** tests, all passing (was 26). `npx tsc
-p tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit 0. No other method
touched; `startSession`/`tick`/`requestGraceFinish`/`endSession`/`refundMinutes` and the prior
26 tests unchanged.

### T05 — Schedules & routines engine (packages/domain)

- Added `packages/domain/src/schedules/`: `engine.ts` (`isWithinAllowedWindow(schedules,
  vacation, categoryId, at)`, exact 4-arg signature per ticket Requirements #1, plus internal
  `isActiveAt`/`combineDateAndTime` helpers), `vacation.ts` (`shouldAutoRestore(vacation,
  now)`), `index.ts` barrel, `__tests__/engine.test.ts` (11 tests). Re-exported via
  `packages/domain/src/index.ts` (added `export * from './schedules';`). Also added
  `packages/domain/src/__tests__/integration.buckets-schedules.test.ts` (3 tests) per the
  ticket's done-when criterion.
- **Weekday/weekend sleep-time convention** (documented in `isActiveAt`'s docstring and here
  per the ticket's explicit ask): modeled as two separate `bedtime`-type `SchedulePolicy` rows
  with different `daysOfWeek` sets (e.g. Mon-Thu vs Fri-Sat) — no special-cased "weekend"
  branch in the engine; each row is evaluated independently and composed via
  most-restrictive-wins.
- **Vacation semantics for a `null` `endDate`**: the ticket only states the bypass rule for
  "`vacation.endDate` is in the future"; the type (`VacationMode.endDate: string | null`)
  allows `null`. Chose: `enabled: true` + `endDate: null` bypasses indefinitely (no expiry to
  check yet) rather than treating `null` as already-expired — matches `shouldAutoRestore`,
  which also only auto-restores when there IS a passed `endDate` (`null` never auto-restores).
  Flagged here since T09 (or whichever ticket sets vacation mode) should always supply a
  concrete `endDate` per spec's "Vacation mode with an end date" — `null` is a defensive
  default, not the expected product path.
- **Signature reconciliation (not an escalation — resolved by reading T03's actual code)**: the
  ticket's prose claims `isWithinAllowedWindow`'s 4-arg signature is "the exact function
  signature T03 expects as its injected predicate," but `BucketEngine.startSession`'s actual
  injected param (unchanged since T03) is 2-arg: `(categoryId: string, atTime: Date) =>
  boolean`. Implemented the ticket's literal 4-arg signature (also explicitly spelled out in
  Requirements #1) as-is; the integration test wires it into `BucketEngine.startSession`
  unmodified via a 2-arg adapter closure that partially applies `schedules`/`vacation` at the
  call site. `BucketEngine`'s source was not touched.
- Midnight-crossing windows: `isActiveAt` checks window instances anchored to both `at`'s own
  calendar day and the day before it (a window starting the prior day, e.g. bedtime
  21:00-07:00, can still be "active" after local midnight) — all times use local `Date`
  methods (`getDay`/`setHours`), matching the "HH:mm local" contract on `SchedulePolicy`.
- Verified: `npm test -w packages/domain` — 5 suites, **54** tests, all passing (was 40; +14:
  11 schedules engine tests + 3 integration tests). `npx tsc -p tsconfig.base.json --noEmit`
  exit 0. `npx eslint . --ext .ts,.tsx` exit 0. Root `npm run typecheck --workspaces
  --if-present` and `npm run test --workspaces --if-present` both pass. No other module
  touched (buckets/presence/ageTier/schemas/types untouched, confirmed by diff).

### T06 — Tier gating logic (packages/domain)

- Added `packages/domain/src/tiers/`: `features.ts` (`Feature` union — 11 gated capabilities
  verbatim from spec §3.8; `TIER_FEATURES` written out in full per tier, literally repeating
  the lower tier's list rather than computing it via spread/merge, per the ticket's explicit
  audit-ability ask; `TIER_DEVICE_LIMIT = { free: 1, standard: 10, premium: 20 }`), `gate.ts`
  (`hasFeature`, `assertFeature` throwing `FeatureGatedError extends Error` with
  `{ feature, requiredTier }` — `requiredTier` computed as the lowest tier (free→standard→
  premium order) whose `TIER_FEATURES` list contains the feature, `canAddDevice`), `index.ts`
  barrel, `__tests__/gate.test.ts` (43 tests: one per feature×tier pairing (33) + explicit
  spec-boundary tests + assertFeature error-shape tests + device-limit boundary tests at
  1/10/20). Re-exported via `packages/domain/src/index.ts` (`export * from './tiers';`).
- **Ambiguity resolved without escalation**: `canAddDevice(subscription, currentDeviceCount)`
  enforces the cap via `TIER_DEVICE_LIMIT[subscription.tier]`, **not** the stored
  `Subscription.deviceLimit` field (T02) — confirmed by reading T12.md/T20.md, both of which
  reference `TIER_DEVICE_LIMIT[tier]` directly as the display/source-of-truth value. The
  stored `deviceLimit` field is a persisted convenience elsewhere and is not read by this gate.
- TIER_FEATURES mapping (for spot-check against spec §3.8):
  - free: website_blocker, instant_pause
  - standard: free's 2 + app_blocker, schedules, screen_time, locator
  - premium: standard's 6 + vpn_shield, usage_buckets, presence_detection, per_app_limits,
    priority_support
- Verified: `npm test -w packages/domain` — 6 suites, **97** tests, all passing (was 54; +43).
  `npx tsc -p tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit 0 (no
  output). `npm run build -w packages/domain` exit 0. Root `npm run typecheck --workspaces
  --if-present` exit 0. Diff scoped to new `packages/domain/src/tiers/` dir + one added barrel
  export line in `packages/domain/src/index.ts`; no other module touched.

### T07 — Supabase schema, migrations & RLS (packages/backend)

- Docker daemon was unreachable at task start; started it (`open -a Docker`, polled `docker ps`)
  and it came up in ~5s — no environment blocker this ticket. Installed Supabase CLI via `brew
  install supabase/tap/supabase` (2.109.1). Ran `supabase init` in `packages/backend/` (standard
  CLI layout: `supabase/config.toml`, `project_id = "guardian-backend"`).
- `packages/backend/supabase/migrations/0001_init.sql`: all 7 tables from T02's `types.ts`
  (`family`, `parent`, `child`, `device`, `subscription`, `policy`, `device_event`,
  `child_request`), uuid PKs (`gen_random_uuid()` via `pgcrypto`), `NOT NULL` on required
  fields, FKs with `on delete cascade` for every family/child-scoped row, `CHECK` constraints on
  `platform`, `tier`, `status` (ticket's 3 explicit examples) plus `device_event.type` and
  `child_request.type` (same enum-like-column rationale, not explicitly listed but directly
  derived from T02's `EventType`/`RequestType` unions — flagged here as a minor beyond-the-letter
  addition). Indexes: `device_event(child_id, occurred_at)`, unique `policy(child_id, version)`,
  `child_request(child_id, status)` (all 3 ticket-specified) plus FK-column indexes
  (`parent.family_id`, `child.family_id`, `device.child_id`) added for the RLS subqueries'
  join performance.
  - **GRANT statements were required and are not in the ticket's literal text**: this Supabase
    CLI version's local default (`config.toml`'s `api.auto_expose_new_tables` comment) no longer
    auto-exposes new tables to `anon`/`authenticated`/`service_role` — confirmed empirically
    (`service_role` insert failed with `permission denied for table family` before adding
    `grant select, insert, update, delete on all tables in schema public to anon, authenticated,
    service_role` + a matching `alter default privileges` for future migrations' tables). Table
    grants don't weaken RLS: RLS still filters rows for `anon`/`authenticated`; `service_role`
    bypasses RLS but was still blocked by the missing table-level GRANT until this was added.
- `packages/backend/supabase/migrations/0002_rls.sql`: RLS enabled on all 7 tables.
  **Auth-model assumption (documented in the file's top comment; flagged here as a RISK for
  human/product review, not applied silently)**: (1) `public.parent.id` IS the Supabase Auth
  user id — enforced via `alter table parent add constraint ... foreign key (id) references
  auth.users(id)`; a parent signs up through Supabase Auth then inserts their own `parent` row
  with `id = auth.uid()`. (2) Child devices are not Supabase Auth users; each paired device is
  issued a scoped JWT carrying a custom `device_id` claim (read via `auth.jwt() ->>
  'device_id'`), minted by a future pairing edge function (T08/T09) — **this mechanism is a
  policy-level assumption only, unverified end-to-end since T07 doesn't build that minting
  function**. (3) `service_role` bypasses RLS entirely (Supabase built-in, not a policy here).
  Helper functions `current_parent_family_ids()`, `current_parent_child_ids()`,
  `current_device_id()`, `current_device_child_id()` (all `security definer` except the JWT-claim
  reader) keep policies DRY and avoid RLS self-recursion on the `parent`/`child`/`device` tables.
  Parent policies: full SELECT/INSERT/UPDATE scoped to family membership (via
  `current_parent_family_ids()`/`current_parent_child_ids()` subqueries) on all 7 tables, plus a
  `family` INSERT-anyone-authenticated exception for onboarding (creating the very first family
  with no prior membership) and a `parent` INSERT-self-only exception (same onboarding
  chicken-and-egg). Device policies: `policy` table gets a device-scoped SELECT limited to that
  device's own child AND the row with the highest `version` for that `child_id` (interpreted as
  "active" — the domain model has no explicit `is_active` field); `device_event` and
  `child_request` get device-scoped INSERT-only (`device_id`/`child_id` must match the JWT
  claim's own device/child) — **no UPDATE/SELECT policy exists for the device role on any
  table**, so a device cannot write `Policy` or read another child's/family's data, matching the
  ticket's requirement.
  - **RISK carried forward**: `child_request` has no device-scoped SELECT, so a child device
    cannot currently read back the resolution (`approved`/`denied`) of its own submitted
    requests under RLS alone — flagged as a follow-up for whichever ticket builds the
    child-app request UI (likely needs either a narrow device-scoped SELECT policy or a
    push/realtime notification path instead).
- `packages/backend/package.json` (`@guardian/backend`): `@supabase/supabase-js@^2.110.2` dep,
  `tsx@^4.23.0` devDep (added per the ticket's explicit `npx tsx .../smoke.ts` command — a new
  dep, but ticket-mandated, not a convenience add). `test` script wired to the same
  `jest --config ../../jest.config.js --selectProjects <name>` pattern T02 established for
  `domain`, with `--passWithNoTests` added (no `.test.ts` files exist yet in this ticket; T08/
  T09/T10/T17/T19 will add real suites under `packages/backend/src/__tests__/` per their own
  ticket text) so root `npm run test --workspaces --if-present` stays green. Added a matching
  `backend` project entry to root `jest.config.js` (same explicit-tsconfig-path pattern as
  `domain`, per T02's LEDGER note that ts-jest needs this spelled out). Added
  `packages/backend/tsconfig.json` (extends root base, `types: ["jest","node"]`,
  `include: ["src","scripts","supabase/functions"]` — `src`/`supabase/functions` don't exist yet
  but later tickets add them there). Removed `packages/backend/.gitkeep` (real files now exist,
  matching `domain`'s precedent).
  - **`process`-global constraint (same class of issue T04 hit with `crypto`)**: bare `process`
    in `scripts/smoke.ts` fails root `npx tsc -p tsconfig.base.json --noEmit` with TS2591,
    reproduced empirically — that check applies `tsconfig.base.json`'s own compilerOptions (no
    `"types": ["node"]`) to every `.ts` file in the repo regardless of any nested workspace
    tsconfig, since `"references": []` means nested tsconfigs are never consulted by that
    specific root sweep. Worked around (without touching the shared root tsconfig) by reading
    env through `(globalThis as unknown as { process?: NodeProcessLike }).process` with a small
    local interface — typechecks under both the root sweep and `packages/backend`'s own
    `tsconfig.json`, and still resolves to the real Node `process` at runtime under `tsx`.
    Flagged here per T04's precedent for whichever future ticket wants to actually fix this
    root-tsconfig gap properly instead of working around it file-by-file.
- `packages/backend/scripts/smoke.ts`: inserts Family → (creates a real `auth.users` row via
  `supabase.auth.admin.createUser` since `parent.id` FKs to it, per the auth-model assumption
  above) → Parent → Child → Device → Policy → DeviceEvent → ChildRequest, then reads the whole
  chain back via a single nested `select` from `family` and asserts exactly one row at every
  level, using the service-role key (explicitly not an RLS parent-vs-parent test, per the
  ticket).
- **Verification: VERIFIED WITH REAL OUTPUT (Docker came up; no environment blocker)**.
  `supabase start` (pulled images, applied both migrations with zero errors) → `supabase db
  reset` (clean re-apply) → `SUPABASE_SERVICE_ROLE_KEY=<local dev key> npx tsx
  packages/backend/scripts/smoke.ts` → printed `SMOKE TEST PASSED` with the full inserted +
  read-back chain in the output (7 rows, 1-each, nested select confirms referential integrity).
  Additionally ran a manual anon-key sanity check (unauthenticated `select * from family` /
  `select * from policy`) — both returned empty result sets, confirming RLS is enabled and
  default-deny for unauthenticated requests (not the full pgTAP parent-vs-parent suite the
  ticket allows deferring "if time permits" — that remains a follow-up). `SETUP.md` updated
  (Docker + Supabase CLI/project sections) with the exact commands regardless, per the ticket's
  ask. Root `npx tsc -p tsconfig.base.json --noEmit` exit 0, `npx eslint . --ext .ts,.tsx` exit 0,
  `npm run test --workspaces --if-present` exit 0 (backend: 0 tests, pass-with-no-tests; domain:
  97/97), `npm run typecheck --workspaces --if-present` exit 0.
- Local Supabase stack left running (`supabase stop` documented in `SETUP.md` for later); T08
  depends on this migration set and can reuse the same running instance.

**Post-review fix (same ticket, addressed before DONE):** a reviewer found `policy_select_device`
in `0002_rls.sql` caused infinite recursion on `SELECT` from `public.policy` for everyone
(parents included) — its USING clause embedded a raw correlated subquery against
`public.policy` itself (max-version lookup) instead of routing through a `security definer`
function like every other cross-table lookup in the file. Fixed by adding
`public.policy_max_version(p_child_id uuid)` (`security definer`, same pattern as
`current_parent_family_ids`/`current_parent_child_ids`/`current_device_child_id`) and rewriting
`policy_select_device`'s USING clause to call it instead of the inline subquery — landed in the
migration file itself (`0001_init.sql` unchanged, `0002_rls.sql` updated), not just applied to
the live container. Re-verified: `supabase db reset` + `SUPABASE_SERVICE_ROLE_KEY=<local dev
key> npx tsx packages/backend/scripts/smoke.ts` → `SMOKE TEST PASSED`. Added a regression check
to `scripts/smoke.ts`: after the service-role chain insert, signs in as the parent (via a new
anon-key client + `auth.signInWithPassword`, using a password now set on the smoke test's
`auth.admin.createUser` call) and asserts `select id, child_id, version from policy where
child_id = eq(child.id)` returns exactly the expected 1 row with no error — this is the exact
query shape that previously errored with `infinite recursion detected in policy for relation
"policy"`. Confirmed the check is a real regression test, not vacuous: temporarily reverted
`policy_select_device` to the old inline-subquery form, ran `supabase db reset` +
`scripts/smoke.ts` again, and got `SMOKE TEST FAILED: ... infinite recursion detected in policy
for relation "policy"` at the new assertion (exact expected failure mode) — then restored the
fix and re-ran to green. Root `npx tsc -p tsconfig.base.json --noEmit` exit 0, `npx eslint . --ext
.ts,.tsx` exit 0. `SETUP.md`'s Supabase CLI/project section updated to note the regression check
now included in the smoke script's verified-output description.

### T08 — Policy sync + push dispatch edge functions (packages/backend)

- **`policy` is append-only/versioned, not update-in-place** (discovered by reading T07's own
  schema, not assumed): `0001_init.sql`'s `unique index policy_child_id_version_idx on
  public.policy (child_id, version)` means "increments Policy.version, persists" = INSERT a
  brand-new row with `version = current.version + 1`, never `UPDATE` the existing row — matches
  `policy_select_device`'s RLS policy (T07), which already treats "active" as
  `version = policy_max_version(child_id)`. Both `PUT /policy-sync/:childId` and
  `POST /policy-sync/instant-pause` insert new rows accordingly.
- **`packages/backend/src/policySync.ts`** — pure decision logic (no I/O), covered by
  **20 tests** in `packages/backend/src/__tests__/policySync.test.ts` (all passing):
  `detectGatedFeatureTouches`/`assertPolicyUpdateAllowed` (gated-feature rejection with correct
  `{feature, requiredTier}`, ungated updates never throw on any tier), `buildNextPolicyVersion`/
  `buildInstantPausePolicy` (version +1, all untouched fields preserved, instant-pause flips
  every family device), `devicesToNotify` (skips devices with no push token yet, one dispatch
  target per device with a token). Imports reach directly into `packages/domain/src/tiers/
  {gate,features}.ts` and `types.ts` by relative path (not the `@guardian/domain` package
  specifier, not the barrel) — this was the key design decision for a working Deno bundle for
  the edge function; see the dual-runtime note below.
- **Sub-policy → `Feature` gating map — reconciled against T02's actual types (not the ticket's
  literal prose), documented in `policySync.ts`**:
  - `buckets` touched at all → `usage_buckets` (as literally stated).
  - `presence.levelNEnabled` set **true** for any level → `presence_detection` (gates only on
    *enabling*, never on touching/disabling — a family that never had premium shouldn't be
    blocked from turning presence detection back *off*).
  - Ticket says `"appRules per-app limits → per_app_limits"`, but `AppRulePolicy` (T02) has no
    numeric per-app field at all (`blockedApps`/`allowedApps`/`blockByStoreRating` only) — the
    actual numeric "per-app limits" field is `ScreenTimePolicy.perApp: Record<string, number>`.
    Gated `screenTime.perApp` non-empty → `per_app_limits` instead (same reconciliation pattern
    as T05's documented signature reconciliation).
  - Ticket says `"contentFilter VPN-shield-specific fields → vpn_shield"` but `ContentFilterPolicy`
    has no field literally named for VPN. Per spec §4 Layer 1 ("force-routes SafeSearch CNAMEs"
    — enforced, network-level filtering only the VPN shield can guarantee), interpreted
    `safeSearchEnforced`/`youtubeRestrictedMode` set **true** as the VPN-shield-specific fields;
    the basic block/allow domain/keyword lists remain covered by the free-tier `website_blocker`
    feature (unchanged, ungated). **Flagged for reviewer/product confirmation** — this is the one
    genuinely ambiguous mapping in the ticket, same risk category as prior tickets' documented
    interpretation calls.
- **`PushDispatcher.send` signature has 3 params, not the ticket's literal 2** (`send(deviceId,
  deviceToken, payload)`, not `send(deviceToken, payload)`) — minimal necessary addition (same
  class as T03's `weeklyMinutesUsed`/T04's `deviceId`/`childId`): `push_log` (this ticket's own
  migration) has a mandatory `device_id` FK column, and a push *token* is not the same value as
  our internal `device.id` — no dispatcher could log which device it notified without being told
  the id directly.
- **`device.push_token` column added** (migration `0003_push_log.sql`, alongside `push_log`
  itself) — neither T02's `Device` type nor T07's `device` table had anywhere to store a push
  token; nullable (devices without one yet are skipped at dispatch, not an error). Deliberately
  **not** added to `packages/domain`'s `Device` type (out of this ticket's package scope) —
  `packages/backend/src/policySync.ts` defines its own narrow `PushableDevice` shape instead.
  `push_log` gets RLS enabled with **no** anon/authenticated policies (default-deny, same pattern
  as every other T07 table) — it's written only by the edge function via the service-role key
  (system audit trail, not a parent- or device-owned resource); table-level GRANTs already cover
  it via T07's `alter default privileges`.
- **`packages/backend/supabase/functions/push/dispatcher.ts`**: `PushDispatcher` interface +
  `PushLogSink` (minimal structural dependency, not a `@supabase/supabase-js` client type) +
  `LoggingPushDispatcher` (default, writes `push_log`) + `FcmPushDispatcher` (real FCM HTTP v1
  API: RS256-signs a Google service-account JWT via WebCrypto, exchanges it for an OAuth2 access
  token, POSTs to `fcm.googleapis.com/v1/projects/{id}/messages:send` with Android/APNs
  high-priority headers per spec §7) — gated behind `FCM_SERVICE_ACCOUNT_JSON`, never set in this
  environment, so **never exercised for real** (out of scope per the ticket).
- **`packages/backend/supabase/functions/policy-sync/index.ts`**: thin HTTP wrapper —
  `PUT /policy-sync/:childId` and `POST /policy-sync/instant-pause`, both routed by one
  `Deno.serve` handler. Does DB I/O via a small **hand-rolled `fetch()`-based PostgREST client**
  (`restGet`/`restInsert`), not `@supabase/supabase-js` — see the dual-runtime note below for why.
  Uses **two Postgres roles for two different reasons** (least-privilege, not convenience): the
  caller's own forwarded parent JWT + anon key for every read/write that should go through RLS
  (T07's existing parent-scoped `policy`/`device`/`child`/`subscription` policies already allow
  exactly what's needed — reusing them keeps RLS meaningful as defense-in-depth instead of a
  blanket service-role bypass), and the service-role key **only** for `push_log` inserts (no
  RLS policy grants that to a parent). `FeatureGatedError` → HTTP 403 with `{error, feature,
  requiredTier}`; unmapped child/no-policy-yet → 404; PostgREST errors passed through with their
  status.
- **Dual-runtime import problem (Node/Jest vs. Deno) — the core engineering problem this ticket
  had to solve, not previously encountered by any prior ticket**: the ticket explicitly asks for
  one pure module "importable by both the edge function and" Jest. Node/ts-jest (moduleResolution
  `bundler`) resolves extensionless relative imports; Deno (real, via `supabase functions serve`
  — Docker's `supabase_edge_runtime` container, empirically confirmed, not simulated) requires
  explicit `.ts` extensions on relative imports and cannot resolve the bare `@guardian/domain`
  npm-workspace specifier or `zod` (pulled in transitively by domain's barrel `index.ts`) without
  an import map + network access. Tried and rejected: Deno's `"unstable": ["sloppy-imports"]`
  deno.json flag (to allow extensionless resolution) — empirically does **not** work under
  Supabase's embedded edge-runtime (confirmed by direct test, still errored). **Solution actually
  used**: (1) `policySync.ts` and the edge function import `packages/domain/src/tiers/
  {gate,features}.ts` and `types.ts` **directly by relative path with explicit `.ts` extensions**
  (bypassing the barrel and its `zod` dependency entirely — `gate.ts`/`features.ts`/`types.ts`
  have zero external deps); (2) added `"allowImportingTsExtensions": true` to the **shared root
  `tsconfig.base.json`** (empirically verified this does not break `ts-jest`'s diagnostics despite
  requiring `noEmit`/`emitDeclarationOnly` — both root's `--noEmit` CLI flag and each workspace's
  own `tsc -p ... --noEmit` script already satisfy that); (3) as a direct, minimal, mechanical,
  **behavior-preserving** consequence, added explicit `.ts` extensions to `packages/domain/src/
  tiers/gate.ts`'s and `features.ts`'s own two internal relative imports (their only imports) —
  this is a T06-authored file touched by T08; re-verified T06's entire test suite (97/97) and
  typecheck still pass unchanged after the edit, confirmed purely mechanical; (4) excluded
  `**/supabase/functions/**` from the Node/tsc + ESLint pipeline entirely, in both root
  `tsconfig.base.json`'s `exclude` and `packages/backend/tsconfig.json`'s `include`/`exclude`
  (removed `outDir: dist`, which was never used by any backend script and was the source of a
  `TS6059` rootDir violation once cross-package relative imports were introduced) — Deno/edge
  globals (`Deno`, `fetch`, `crypto`, `btoa`/`atob`, `performance`) are a fundamentally different
  type-checking universe from Node/bundler-mode tsc, matching how real-world Supabase monorepos
  conventionally structure this (separate `deno.json`, VSCode `deno.enablePaths`, tsconfig
  `exclude`) — confirmed empirically that ESLint's flat config still lints `supabase/functions/
  **.ts` files correctly regardless (deliberately verified with an injected unused-var, caught
  and then removed) since ESLint has no separate exclusion of that path (only tsc does).
  **Net result**: the exact same `policySync.ts` (and the exact same `gate.ts`/`features.ts`
  from T06) is loaded and actually executed by both Jest (Node) and the real Deno edge-runtime —
  zero source duplication, confirmed both ways empirically (see verification below), not "should
  work."
- Removed the CLI-scaffolded `supabase functions new hello-test` example (and its stray
  `[functions.hello-test]` `config.toml` block, which was blocking `supabase functions serve`
  entirely with an `ENOENT` on the deleted directory) — was only ever meant as a one-off
  reference for the current CLI's function-scaffold shape (`withSupabase` helper, `deno.json`
  import-map pattern), not part of this ticket's deliverable.
- **Verification — Docker/Supabase local instance was up (T07's outcome), so this was
  end-to-end verified, not deferred**:
  - `npm test -w packages/backend`: **20/20 passing** (full output: `Test Suites: 1 passed, 1
    total. Tests: 20 passed, 20 total.`).
  - Cross-check against T06's `TIER_FEATURES` (`packages/domain/src/tiers/features.ts`):
    `usage_buckets`/`presence_detection`/`per_app_limits`/`vpn_shield` are all premium-only
    (absent from `free`'s and `standard`'s lists) — the four gated mappings above match exactly;
    spot-checked via the `standard`-tier rejection tests (all 4 assert `requiredTier: 'premium'`).
  - Root `npx tsc -p tsconfig.base.json --noEmit` exit 0; `npm run typecheck --workspaces
    --if-present` exit 0 (both `backend` and `domain`); `npx eslint . --ext .ts,.tsx` exit 0
    (repo-wide, including `supabase/functions/**`, deliberately verified it's actually being
    linted, not silently skipped).
  - `supabase db reset` applied `0001`→`0003` cleanly; re-ran T07's own `scripts/smoke.ts` after
    the new migration — still `SMOKE TEST PASSED` (push_token/push_log additions don't regress
    T07).
  - **Real end-to-end edge-function invocation** via `supabase functions serve policy-sync` +
    `curl` against a real seeded fixture (family/parent/child/device/subscription, parent signed
    in for a real JWT):
    - Ungated update (`schedules`) on a `standard`-tier family → `HTTP 200`, `version` bumped
      1→2, response included `devicesNotified: 1`, `dbWriteAndDispatchMs: 23.79` (well under the
      spec §7 <10s budget — this number is the actual measured local-dev latency, not an
      estimate).
    - Gated update (`buckets`) on the same `standard`-tier family → `HTTP 403`,
      `{"error":"Feature \"usage_buckets\" requires the \"premium\" tier or higher",
      "feature":"usage_buckets","requiredTier":"premium"}`.
    - `POST /policy-sync/instant-pause` → `HTTP 200`, `{"childrenPaused":1,"devicesNotified":1,
      "dbWriteAndDispatchMs":11.36}`.
    - Confirmed directly in Postgres (`psql`): `policy` table now has 3 rows for the one child
      (`version` 1→2→3, `instant_pause` true only on the last), and `push_log` has exactly 2 rows
      (one per dispatch call, `dispatcher='logging'`), each with the exact payload shape
      `buildPolicyUpdatePushPayload`/`buildInstantPausePushPayload` construct — confirms "push
      dispatched exactly once per device" end-to-end, not just at the unit level.
  - **Not verified** (explicitly out of scope per the ticket): real `FcmPushDispatcher` delivery
    — no Firebase account exists in this environment; the class is written for real against the
    FCM HTTP v1 API shape but its `fetch()` calls have never actually executed.
- `SETUP.md`: new "FCM / push credentials" section — exact steps (Firebase project → enable
  Cloud Messaging → generate service-account JSON → set `FCM_SERVICE_ACCOUNT_JSON` via
  `--env-file` locally or `supabase secrets set` when deployed) plus an explicit callout that
  `device.push_token` population (the child app's FCM SDK registration flow) is **not** built by
  this ticket — flagged as a follow-up. Added `.env` to `packages/backend/supabase/.gitignore`
  (needed for the new `--env-file` step; the existing patterns only covered `.env.local`/
  `.env.*.local`/`.env.keys`, not bare `.env`).
- **RISK carried forward**: the VPN-shield content-filter field mapping
  (`safeSearchEnforced`/`youtubeRestrictedMode`) is this ticket's own interpretation of
  ambiguous ticket prose (see above) — needs reviewer/product confirmation before any later
  ticket builds against it as settled. Also: `device.push_token` has no registration flow yet
  (child app side, likely T21/T24 territory) — until then, every real device is silently
  never-notified (push_token stays null) even though `LoggingPushDispatcher`/`FcmPushDispatcher`
  themselves are fully correct.
- **Review-fix follow-up (post-DONE)**: a reviewer found `allowImportingTsExtensions: true` on
  the shared root `tsconfig.base.json` broke `npm run build -w packages/domain` (`TS5096`,
  emitting build with no `--noEmit`/`emitDeclarationOnly`/`rewriteRelativeImportExtensions` set).
  Applied the reviewer's specified fix — added `"rewriteRelativeImportExtensions": true` to
  `packages/domain/tsconfig.json`'s `compilerOptions` — which fixed the build (verified: `npm run
  build -w packages/domain` exit 0, `dist/tiers/gate.js` now correctly imports `./features.js`
  not `./features.ts`). **However**, applying that fix alone regressed `npm test -w
  packages/domain` from 97/97 to 54/97 (one whole suite, `tiers/__tests__/gate.test.ts`, failed
  to run: `Cannot find module './features.js' from 'packages/domain/src/tiers/gate.ts'`) —
  `rewriteRelativeImportExtensions` makes ts-jest's transform emit a `.js`-suffixed `require()`
  for the `.ts`-suffixed source import, which Jest's Node resolver then can't find on disk (only
  `features.ts` exists). This regression was not caught by the reviewer's stated verification and
  is not what "verified working by the reviewer" in the ticket claimed. Fixed by adding a
  `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` to the `domain` project block in the root
  `jest.config.js` (the standard, documented ts-jest workaround for this exact
  allowImportingTsExtensions+rewriteRelativeImportExtensions interaction) — strips the rewritten
  `.js` suffix so Jest falls back to its normal extension resolution and finds `features.ts`.
  Confirmed all three gates green after both changes: `npm run build -w packages/domain` (exit
  0), `npm test -w packages/domain` (97/97), `npm test -w packages/backend` (20/20, includes
  `policySync.test.ts`). Also re-confirmed root `npx tsc -p tsconfig.base.json --noEmit`,
  `npm run typecheck --workspaces --if-present` (backend + domain), and `npx eslint . --ext
  .ts,.tsx` are all still exit 0 (repo-wide gates from T08's original verification, re-checked
  since this touched shared config).

### T09 — Event ingestion + weekly digest + vacation auto-restore (packages/backend)

- **New pure modules** (dual-runtime, `.ts`-extensioned relative imports into
  `packages/domain/src`, same T08-established pattern — importable by both Jest and Deno):
  `src/digest.ts` (`buildWeeklyDigest`, `buildWeeklyDigestPushPayload`; 10 tests),
  `src/eventIngest.ts` (`shouldDispatchImmediately`, `buildEventAlertPushPayload`,
  `dispatchEventAlerts`; 8 tests), `src/vacationCron.ts` (`selectVacationsToRestore`,
  `buildVacationRestoreUpdate` — reuses T08's `buildNextPolicyVersion`, not duplicated;
  `buildVacationRestorePushPayload`; 8 tests) — 26 new tests total, 46/46 combined with the
  existing 20 (`policySync.test.ts`, unchanged).
- **Mechanical Deno-compat fix carried into a T05 file**: `packages/domain/src/schedules/
  vacation.ts`'s own `'../types'` import was never Deno-resolvable (T05 predates T08's
  dual-runtime discovery) — needed once `vacationCron.ts` imports `shouldAutoRestore` directly
  (bypassing the domain barrel, same reasoning as T08's `tiers/gate.ts` import). Added `.ts`
  extension, same class of edit T08 made to `tiers/gate.ts`/`features.ts`. T05's suite
  re-verified unchanged (97/97 domain tests).
- **"Child's parent devices" reconciliation**: ticket prose has no basis in the schema — `Device`
  is always `childId`-scoped, `Parent` has no device/push-token field anywhere (T02/T07). T08
  already established that a dispatched push means the child's own registered devices with a
  push token; T09 reuses that same set for presence/tamper alerts, the weekly digest, and
  vacation-restore notices — there is nothing else to target. **RISK carried forward**: a real
  "notify the parent's own phone" push needs a parent-device pairing model this repo doesn't
  have yet.
- **`DeviceEvent.payload` field conventions** (untyped `Record<string,unknown>`, T02) — this
  ticket's own interpretation, documented in `digest.ts`: `app_usage` payload may carry
  `categoryId` (matches the buckets engine's convention, T03), absent → `'uncategorized'`;
  `block_attempt` payload carries `domain`. `scripts/smoke.ts`'s pre-existing `app_usage` example
  (`{appId, minutes}`, no category) still round-trips fine — falls into `'uncategorized'`.
- **Cron mechanism reconciliation**: this Supabase CLI (2.109.1) has no native "schedule" field
  for edge functions in `config.toml` (confirmed via `supabase functions --help` — only
  list/delete/download/deploy/new/serve). Real mechanism is `pg_cron`+`pg_net` SQL against a
  deployed project. Per the ticket's own "Out of scope" (defers live-cron verification to a
  deployed project): documented the intended schedule as comments beside each function's
  `config.toml` block + exact `cron.schedule(...)` SQL in `SETUP.md`'s new "Scheduled cron jobs"
  section. No live `cron.schedule` migration shipped.
- **RLS-role split**: `event-ingest` forwards the calling device's own JWT+anon key for the
  `device_event` INSERT (T07 RLS: device role is INSERT-only there, least-privilege, matches
  T08's philosophy), but uses the service-role key for `device.push_token` reads (T07 RLS: device
  role has **no** SELECT policy on `device` at all) and `push_log` writes (no anon/authenticated
  policy by design, same as T08). `digest-cron`/`vacation-cron` are cron-invoked with no caller
  identity — service-role key throughout for everything.
- **Shared edge-function plumbing extracted, T08's file untouched**: `functions/_shared/
  postgrest.ts` (restGet/restInsert/PostgrestError/json/env constants) and `functions/_shared/
  push.ts` (makeDispatcher/fetchDevices/dispatchToDevices) — factored out for the 3 new
  functions only. `policy-sync/index.ts` (T08, already DONE) deliberately keeps its own inline
  copies rather than being refactored to import from here — not required by this ticket, zero
  regression risk to already-verified T08 code. Confirmed unchanged: `git diff` shows no edits
  to `policy-sync/index.ts`.
- **`migrations/0004_digest.sql`**: `digest {id, child_id, week_start, summary jsonb, sent_at}`,
  unique on `(child_id, week_start)`. RLS: parent-scoped SELECT only (reuses T07's
  `current_parent_child_ids()` helper); no parent/device write policy — only `digest-cron` writes
  it, via service-role key, same default-deny-except-service-role pattern as `push_log` (T08).
- **`event-ingest/index.ts`**: `POST /event-ingest`, body = one or more `DeviceEvent`s (no `id`).
  Inserts all into `device_event`; `presence_trigger`/`uninstall_attempt`/`service_disabled`
  additionally dispatch immediately per-event (grouped by `childId` to fetch devices once each).
- **`digest-cron/index.ts`**: for every child, queries the past week's `device_event` rows
  (`weekStart` defaults to the last completed UTC week; `?weekStart=YYYY-MM-DD` overrides for
  manual/verification invocation), calls `buildWeeklyDigest`, inserts a `digest` row, dispatches
  one push.
- **`vacation-cron/index.ts`**: fetches every policy row ordered `child_id,version.desc` and
  reduces client-side to one (the latest/active) row per child — correctness over a fancier
  PostgREST `DISTINCT ON` query, this cron runs infrequently. Calls `selectVacationsToRestore`,
  and for each match: inserts the version-bumped restore row (append-only, never UPDATE, same
  convention T08 established) + dispatches a push.
- **Verification — real local Supabase instance (Docker started fresh this session; `supabase
  db reset` applied `0001`→`0004` cleanly)**:
  - `npm test -w packages/backend`: **46/46 passing** (26 new: digest 10, eventIngest 8,
    vacationCron 8 — plus existing 20 unchanged). `npm test -w packages/domain`: **97/97**
    unchanged (confirms the `vacation.ts` extension edit is behavior-preserving).
  - Root `npx tsc -p tsconfig.base.json --noEmit` exit 0; `npx eslint . --ext .ts,.tsx` exit 0
    (repo-wide); `npm run typecheck --workspaces --if-present` exit 0 (backend + domain).
    Deliberately re-verified ESLint actually lints the new `_shared/postgrest.ts` (injected an
    unused var, confirmed it's caught, then removed it — same check T08 did).
  - Re-ran T07's `scripts/smoke.ts` after `db reset` — still `SMOKE TEST PASSED` (0004 migration
    doesn't regress T07).
  - `supabase functions serve` loaded all 4 functions cleanly (policy-sync + 3 new — confirms
    the Deno import graph, including the new `_shared/` files, resolves with zero import-map/
    network needs, same constraint T08 established).
  - **Real end-to-end edge-function invocation** via `curl` against the seeded smoke-test
    family/child/device (service-role bearer — see RLS caveat below): `event-ingest` with a
    3-event batch (`app_usage`, `presence_trigger`, `uninstall_attempt`) → `{"inserted":3,
    "devicesNotified":2}`; confirmed directly in Postgres: all 3 rows in `device_event`, exactly
    2 `push_log` rows (one each for `presence_trigger`/`uninstall_attempt`, none for
    `app_usage`). `digest-cron?weekStart=2026-07-13` → `{"digestsSent":1,...}`; confirmed
    `digest` row's `summary` = `{"totalsByCategory":{"games":20,"uncategorized":10},
    "blockAttemptCount":0,"topBlockedDomains":[],"youtubeViewCount":0}` — exactly matches the
    inserted events (T07's original smoke-test `app_usage` event with no `categoryId` correctly
    fell into `uncategorized:10`); plus a `weekly_digest` push logged. Set an expired vacation on
    the seeded policy → `vacation-cron` → `{"restoredCount":1,"devicesNotified":1}`; confirmed a
    new `policy` version with `vacation.enabled:false` (endDate preserved) + a `vacation_restored`
    push logged; **re-ran vacation-cron immediately after → `{"restoredCount":0,
    "devicesNotified":0}`**, confirming idempotency (not re-restoring an already-restored policy).
  - **NOT verified: the device-JWT-authenticated RLS path for `event-ingest`'s own
    `device_event` INSERT.** Hand-minted an HS256 JWT (`role:authenticated`, `device_id:<uuid>`,
    signed with the local dev `JWT_SECRET`) to test the real device-caller path (T07's own
    documented, pre-existing gap: "this mechanism is a policy-level assumption only, unverified
    end-to-end since T07 doesn't build [a device-JWT-minting] function"). The RLS logic itself
    was independently confirmed **correct** two ways — a `psql` simulation of the exact
    `SET LOCAL role/request.jwt.claims` context succeeded, and a temporary debug RPC through the
    real PostgREST request path resolved `current_device_id()`/`current_device_child_id()` and
    the literal `WITH CHECK` boolean to `true` — yet the actual `INSERT` through PostgREST still
    returned `42501` every time. Root cause not found (not a logic bug in 0002_rls.sql, which
    this ticket doesn't modify); spent bounded time isolating it, then fell back to service-role
    bearer (bypasses RLS) to verify the edge function's own logic for real instead. All
    temporary debug objects (trigger/functions) were dropped afterward; DB left in its
    post-verification state (a device now has `push_token='test-token-t09'`, the smoke-test
    child's policy is at version 2 with vacation restored — harmless local dev-only state, not
    part of any migration). **Flagged as a follow-up for whichever ticket finally builds the
    device-pairing/JWT-minting flow**: re-verify `event-ingest`'s device-scoped INSERT against a
    real minted device JWT once that mechanism exists, and get to the bottom of the PostgREST
    discrepancy above (worth a fresh, unbounded investigation on its own, not folded into a
    feature ticket).
  - Docker/local Supabase stack left running (same precedent as T07/T08).
- **Repo-config discovery (unrelated to this ticket's own diff, flagged for the human)**: the
  git repo root is `/Users/aliashraf/life-os` (not `parental-app` itself), and its root
  `.gitignore` has a bare `projects` line (added in the most recent commit, `a5885b97 "11 july
  day end"`, 2026-07-12 — after T08 was committed) that blanket-excludes the entire `projects/`
  tree. Pre-existing tracked files (T01-T08's work) are unaffected (git doesn't retroactively
  untrack committed files), but **every new file this ticket added is currently untracked *and*
  gitignored** — a plain `git add -A` / `git status` from the repo root silently won't pick them
  up; committing them needs `git add -f` per path (or a `.gitignore` fix) until a human decides
  which. Not touched here — a shared-repo-wide `.gitignore` change is outside this ticket's scope
  and affects the monorepo's other projects (`cockpit`, `edgebook`) too.

### T10 — Auth, family/device registry & verified-parental-consent flow (packages/backend)

- **RISK: pairing-code design decision** (spec §7 says child devices "pair to a family via some
  registration flow" without specifying the mechanic — this ticket had to design one). Chosen:
  parent-authenticated `POST /pairing-code` (RLS-scoped insert, 6-digit code, 10-minute TTL,
  scoped to one `Child`); child device redeems it via `POST /pair-device` (no identity yet —
  service-role key) which atomically claims the code (single conditional `PATCH ... WHERE
  consumed_at IS NULL AND expires_at > now()`, verified race-free under concurrent redemption —
  see reviewer's 10-way concurrent test below), creates the `Device` row, and mints a device
  credential. Flagged for human/product review, not silently assumed — an alternative (QR-code
  deep link, SMS) may be preferred but none was specified.
- **`packages/backend/supabase/migrations/0005_pairing.sql`**: `parent.parental_consent_accepted_at`
  (nullable at the column level only because Postgres can't express "not-null-from-insert-time",
  the signup handler never inserts a `parent` row without it) + `pairing_code {id, code, child_id,
  expires_at, consumed_at}` with RLS (parent insert/select scoped via `current_parent_child_ids()`,
  no device-role policy — the device has no credential yet at redemption time) + a partial unique
  index on `(code) WHERE consumed_at IS NULL` (guards against two simultaneously-active codes
  colliding) + a new `family_delete` RLS policy (T07 never defined one — needed for account
  close).
- **`packages/backend/src/pairing.ts`** — pure code generation + expiry/consumption logic,
  covered by **10 tests** in `__tests__/pairing.test.ts` (TTL expiry incl. inclusive boundary,
  one-time-use/consumed rejection, not-found rejection, consumed-takes-precedence-over-expired).
  Uses the WebCrypto `crypto.getRandomValues` global (not `node:crypto`) — empirically confirmed
  this typechecks under the root `npx tsc -p tsconfig.base.json --noEmit` sweep (no `"types":
  ["node"]` there), unlike T04/T07's documented `node:crypto`/bare-`process` TS2591 constraint —
  so pairing-code generation gets a real CSPRNG, not T04's `Math.random()` fallback.
- **`supabase/functions/auth-flows/index.ts`**: `POST /signup`, `POST /children`, `POST
  /pairing-code`, `POST /pair-device`, `DELETE /family`. Thin HTTP wrapper over `pairing.ts`
  (same T08-established split); reuses `_shared/postgrest.ts` (T09) rather than duplicating
  inline (this is a brand-new function, not one predating the extraction — unlike policy-sync,
  which was deliberately left alone). Extended `_shared/postgrest.ts` with `restPatch`/
  `restDelete` (previously only `restGet`/`restInsert` existed).
  - **Signup**: `admin.createUser` via a raw `fetch()` to GoTrue's admin REST API
    (`/auth/v1/admin/users`, `email_confirm: true` — same pattern T07's `scripts/smoke.ts`
    established), NOT `@supabase/supabase-js` (matches T08/T09's "zero external module
    specifiers in edge functions" convention). `consentAccepted !== true` is rejected before
    anything is created (verified: 0 `auth.users`/`family`/`parent` rows on rejection). Family +
    Parent rows inserted via the service-role key (admin.createUser returns no session token, so
    no forwardable JWT exists yet for the brand-new user — same chicken-and-egg T07's
    `0002_rls.sql` documented for the "any authenticated user" onboarding policies, which this
    service-role path is the alternative to). **RISK (reviewer-flagged, not fixed — no
    saga/compensating-transaction logic exists)**: if the Family or Parent insert throws after
    `adminCreateUser` succeeds, the auth user is not rolled back, leaving an orphaned
    `auth.users` row.
  - **Device credential**: HS256 JWT minted via WebCrypto (`crypto.subtle.importKey`/`.sign`,
    same `base64url` pattern as T08's `dispatcher.ts` RS256 helper, no shared extraction — single
    consumer). Claim shape reuses T07's `0002_rls.sql`-documented assumption EXACTLY: `role:
    authenticated` + `device_id`; no new shape invented (`sub`/`child_id`/`iat`/`exp` are
    standard hygiene, not read by any RLS policy). Signing secret env var is named `JWT_SECRET`,
    **not** `SUPABASE_JWT_SECRET` — the Supabase CLI's `--env-file`/`secrets set` silently refuse
    any user env var prefixed `SUPABASE_` (discovered empirically: `supabase functions serve
    --env-file ...` printed "Env name cannot start with SUPABASE_, skipping" and never set it).
    **RISK, no ticket-specified value**: credential `exp` set 1 year out — no refresh-token flow
    exists yet to renew a shorter-lived one.
  - `config.toml`: added `[functions.auth-flows]` (same shape as the pre-existing
    `[functions.policy-sync]` block).
- **RISK carried forward from T09, reproduced again with the real minting function (not a
  hand-minted test artifact)**: a device JWT minted by `pair-device` is rejected by PostgREST on
  the real `POST /device_event` insert with `42501 new row violates row-level security policy`,
  even though the identical claim shape independently checks out via `psql` simulation and a
  debug RPC (T09's isolation work). The signed-in parent's own GoTrue session token is `ES256`
  (asymmetric); worth checking first whether local PostgREST's JWT verification/role-claim
  propagation differs for a hand-signed `HS256` token vs. a GoTrue-issued `ES256` one — but this
  needs a dedicated, unbounded investigation (T09's original flag stands), not another feature
  ticket. Documented in `SETUP.md`'s new "Device-pairing JWT secret" section. Until resolved, no
  device has ever successfully written its own `device_event` row through the real RLS path in
  this repo — only via the service-role key.
- **Reviewer fix (pre-DONE)**: `handlePairingCode`'s retry loop (guards the rare 6-digit
  uniqueness collision) originally caught and retried on *any* `restInsert` failure, not just the
  intended 409 uniqueness violation — a malformed request or genuine RLS rejection would have
  been silently retried twice before surfacing. Fixed: rethrows immediately unless
  `err instanceof PostgrestError && err.status === 409`. Also added `encodeURIComponent` around
  `childId`/`familyId` in two PostgREST path interpolations (`pair-device`'s `code` path already
  had it; matches existing `policy-sync/index.ts` convention elsewhere, RLS backstops any
  injection regardless) and a RISK comment on signup's orphaned-auth-user gap (see above).
- **Verification — real local Supabase instance (`supabase db reset` applied `0001`→`0005`
  cleanly)**:
  - `npm test -w packages/backend`: **56/56 passing** (10 new: `pairing.test.ts`; 46 prior
    unchanged). `npm test -w packages/domain`: **97/97** unchanged. Root `npx tsc -p
    tsconfig.base.json --noEmit` exit 0; `npx eslint . --ext .ts,.tsx` exit 0 (repo-wide); `npm
    run typecheck --workspaces --if-present` exit 0 (backend + domain).
  - Re-ran T07's `scripts/smoke.ts` after `db reset` — still `SMOKE TEST PASSED` (0005 migration
    doesn't regress T07).
  - **Real end-to-end edge-function invocation** via `supabase functions serve auth-flows` +
    `curl`: consent rejection (`consentAccepted: false` and omitted both → 400, 0 rows created,
    confirmed via `psql`); successful signup (201, `parental_consent_accepted_at` persisted,
    confirmed via `psql`); parent sign-in → `POST /children` (201); `POST /pairing-code` for a
    non-owned child → 404 (no leak); `POST /pairing-code` for the owned child → 201 with a
    6-digit code; `POST /pair-device` with a wrong code → 400 `not_found`; with the correct code
    → 200 with a minted device JWT; replaying the same code → 400 `consumed` (one-time-use
    confirmed); `DELETE /family` (as the owning parent) → 200, then `psql` confirmed
    `family`/`parent`/`child`/`device`/`pairing_code` row counts for that family all dropped to 0
    (`auth.users` row deliberately left — see "Noticed, not touched" below). Bounded
    re-verification of the device-JWT → `event-ingest` RLS path reproduced T09's `42501` (see
    RISK above).
  - **Reviewer's independent live verification** (fresh context, same local instance): full
    signup→children→pairing-code→pair-device flow, cross-family isolation (404 on another
    family's child; family-delete scoped to caller's own family only), cascade-delete row counts,
    and a **10-way concurrent `pair-device` race against the same code** (exactly 1 device row
    created, 9 rejected `consumed`) — confirms the atomic-claim PATCH is actually race-free, not
    just race-free "by construction" in theory.
  - Docker/local Supabase stack left running (same precedent as T07/T08/T09); `supabase functions
    serve` stopped after verification (dev-only foreground process, unlike the DB containers).
- **Noticed, not touched**: orphaned `auth.users` rows after family delete (parent's own Supabase
  Auth identity, not child data — the ticket's literal ask was deleting the `Family` row +
  cascade). Real identity verification beyond email confirmation (ticket's explicit
  out-of-scope). `child_request`'s missing device-scoped SELECT (T07's own carried-forward RISK,
  untouched — out of this ticket's scope).

### T11 — React Native app shell, navigation & Supabase client wiring (app/)

- **Network fallback path used: Path 1** (network reachable — confirmed via `curl -sI
  https://registry.npmjs.org/react-native` → HTTP 200). Ran `npx
  @react-native-community/cli@latest init app --directory app --skip-install --skip-git-init
  --pm npm` after removing the placeholder `app/.gitkeep` (empty file; same precedent as
  T02/T07 removing `.gitkeep` once real files land — the CLI's `init` refuses a pre-existing
  non-empty-looking target without `--replace-directory`, which the auto-mode classifier
  correctly blocked as destructive against an unknown-content directory). Generated a bare RN
  0.86.0 / React 19.2.3 project. No `SETUP.md` follow-up command needed (that's only required
  for path 2).
- **Dependency reconciliation against root-pinned tooling** (same class of decision as T01's
  TypeScript pin): the RN CLI's generated `app/package.json` shipped its own `eslint@^8.19.0` +
  `@react-native/eslint-config` (legacy `.eslintrc.js`) + `prettier@2.8.8` + `typescript@^5.8.3`,
  all older/duplicate versions of tooling the root already pins (`eslint@10.6.0` flat config,
  `prettier@3.9.5`, `typescript@6.0.3`). Removed `app`'s own eslint/prettier deps and the
  generated `.eslintrc.js`/`.prettierrc.js` entirely — repo convention (T01-T10) is a single
  root flat `eslint.config.mjs` governing every workspace; a second legacy-format config would
  be dead weight under ESLint 10's flat mode (confirmed empirically: flat mode never reads
  `.eslintrc.js` once `eslint.config.mjs` exists). Pinned `app`'s own `typescript` devDependency
  to root's `6.0.3` (avoids two compiler versions silently diverging). Kept RN's own
  `jest`/`react-test-renderer`/added `@react-native/jest-preset` (root's ts-jest multi-project
  setup can't run RN component tests — fundamentally different transform/runtime, same class of
  exception as T08's Deno edge-functions split) — `app/` gets its own self-contained
  `jest.config.js`, `npm test -w app` runs it via `app/package.json`'s own `test` script rather
  than routing through root `jest.config.js`'s `--selectProjects` pattern that `domain`/`backend`
  use.
- **`app/tsconfig.json`** uses TS 5+ array `extends`: `["@react-native/typescript-config",
  "../tsconfig.base.json"]` (root's base last so it wins on overlap) — satisfies the ticket's
  literal "extends root tsconfig.base.json" while still inheriting RN's required JSX/lib
  settings. **Root `tsconfig.base.json` change**: added `"app/**"` to `exclude` (same precedent
  as T08's `**/supabase/functions/**` exclusion) — without it, the root's repo-wide `npx tsc -p
  tsconfig.base.json --noEmit` sweep would try to compile `app/**/*.tsx` under Node-oriented
  compiler options with no JSX/RN ambient types and break a previously-passing, still-required
  check. Verified root sweep still exit 0 after the exclusion; `app` gets its own `typecheck`
  script (`tsc -p tsconfig.json --noEmit`, wired into `npm run typecheck --workspaces
  --if-present` via the standard workspace fan-out).
- **Root `eslint.config.mjs` fix (pre-existing latent gap, not previously surfaced)**: the
  `*.config.js`/`*.config.cjs` CommonJS-globals block T01 added used unprefixed globs, which in
  flat config only match root-level files — `app/babel.config.js`/`jest.config.js`/
  `metro.config.js` (nested in a workspace subdirectory) were invisible to that block and failed
  `no-undef` on `module`/`require`/`__dirname`. Fixed by adding `**/` prefixes
  (`**/*.config.js`, `**/*.config.cjs`) plus a new `**/jest.setup.js` pattern (for the
  AsyncStorage jest mock's `jest.mock(...)`/`require(...)` — added a `jest: 'readonly'` global
  and turned off `@typescript-eslint/no-require-imports` for these three glob patterns only, not
  repo-wide). Verified repo-wide `npx eslint . --ext .ts,.tsx` still exit 0 after the fix, and
  confirmed it wasn't silently no-op-ing (the nested config files errored before the fix, then
  passed after).
- **Env var mechanism: `.env` via `react-native-dotenv`, not `react-native-config`** — a babel
  plugin (`app/babel.config.js`), zero native Android/iOS project edits required, matching the
  ticket's own fallback-2 spirit ("app/src must not depend on native project files existing")
  even though path 1 succeeded and native dirs do exist; smaller diff either way.
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` declared in `app/src/env.d.ts` (ambient `@env` module) and
  read by `app/src/supabaseClient.ts`; `app/.env.example` documents the shape (local dev default
  `SUPABASE_URL=http://localhost:54321`, matching the Supabase CLI's fixed local API URL);
  `app/.env` (gitignored) is the real local file. **Runtime-verified**, not just typechecked: a
  throwaway jest test importing `{ SUPABASE_URL, SUPABASE_ANON_KEY } from '@env'` and asserting
  the actual values confirmed the babel transform resolves for real, then was deleted (not part
  of the deliverable).
- **`src/navigation/RootNavigator.tsx`**: role persisted to AsyncStorage under key
  `guardian.role`; unhydrated state shows a spinner, then swaps between `ParentNavigator`,
  `ChildNavigator`, or `RoleSelectionScreen` inside one `NavigationContainer` — the same
  swap-the-navigator-tree-on-app-state pattern React Navigation's own auth-flow guide
  recommends, not a from-scratch router. **Reviewer-fix (pre-DONE)**: the `AsyncStorage.getItem`/
  `setItem` calls originally had no `.catch()` — a storage failure surfaced as an unhandled
  promise rejection instead of degrading safely to role-selection. Fixed: both now `.catch()`
  with a `console.warn`; `getItem`'s existing `.finally()` still unconditionally hydrates so the
  UI never hangs. Re-verified after the fix: typecheck/eslint/test all still green.
- **`src/navigation/{ParentNavigator,ChildNavigator}.tsx`**: each exports an array of `{name,
  component}` (`parentScreens`/`childScreens`) that the navigator's JSX maps into
  `<Stack.Screen>` elements — documented in-file as the append pattern T12+ (parent) / T21
  (child) must use (`screens.push({ name, component })` before the navigator renders, plus
  extending the exported `*StackParamList` type), rather than editing the `<Stack.Navigator>`
  JSX directly. **Reviewer independently verified this actually works at runtime** (not just
  typechecks) by pushing an extra entry and rendering the navigator via
  `@testing-library/react-native`.
- **`src/auth/{useSignUp,usePairDevice}.ts`**: signatures match the ticket's literal
  `useSignUp(consentAccepted)` / `usePairDevice(code)` (the single business parameter bound at
  hook-call time; the returned action function takes the rest). Request/response shapes
  cross-checked field-by-field against T10's actual `auth-flows` edge function
  (`POST /auth-flows/signup` → `{familyId,parentId,email,parentalConsentAcceptedAt}`;
  `POST /auth-flows/pair-device` → `{deviceId,childId,deviceToken,deviceTokenExpiresAt}`) — no
  contract drift. `apikey`/`Authorization: Bearer <anon key>` headers sent on both (no parent/
  device identity exists yet at signup/pair-device time, matching T10's own router comment that
  these two routes run entirely on service-role/anon internally). Client-side validation
  (`src/auth/validation.ts`: email format, password length ≥8, 6-digit pairing code) runs before
  any network call; the edge function still independently re-validates everything server-side
  (never trusts the client alone).
- **Verified**: `npm run typecheck -w app` exit 0; root `npx tsc -p tsconfig.base.json --noEmit`
  exit 0 (app excluded, unaffected); `npm run typecheck --workspaces --if-present` exit 0
  (backend + domain + app); `npx eslint . --ext .ts,.tsx` exit 0 repo-wide; `npx eslint app/src
  --ext .ts,.tsx` exit 0 (the ticket's exact literal done-when command); `npm test -w app` —
  1/1 passing (`RootNavigator` smoke test: role-selection shows both "I'm a parent" and "I'm on
  my child's device" options); `npm run test --workspaces --if-present` — domain 97/97 + backend
  56/56 unchanged, app 1/1 — confirms zero regression to prior tickets' work from the shared
  `tsconfig.base.json`/`eslint.config.mjs` edits.
- **Reviewer's independent verification** (fresh context, stakes gate: diff spans a new ~30-file
  workspace + 2 shared root config files, stakes: high, T3): re-ran every check above directly
  rather than trusting the report; additionally wrote and ran two throwaway probe tests — one
  confirming the `parentScreens`/`childScreens` array-append pattern mounts correctly under a
  real `NavigationContainer` (not just a type-level claim), one that caught finding #1 below by
  mocking `AsyncStorage.getItem` to reject and observing the unhandled-rejection failure.
  Verdict: CHANGES (2 blocking findings), both fixed before DONE:
  1. `RootNavigator.tsx`'s missing `AsyncStorage` error handling (see above, fixed).
  2. `SCRATCH.md`'s "Noticed, not touched" section and this LEDGER.md entry were still
     placeholders at review time — filled in (this entry + SCRATCH.md's push-notification/
     error-state/audit/gitignore notes).
- **RISK carried forward from T09/T10, reproduced again**: unchanged — no new information from
  this ticket. Device credential minting/RLS device-write path is still unverified end-to-end
  (T09/T10's own flagged gap); this ticket's `usePairDevice` hook calls the real endpoint but
  has never been exercised against a live Supabase instance (no `supabase start` run this
  ticket — pure typecheck/lint/jest verification, no edge-function integration test, matching
  the ticket's own scope: screen *content* beyond role-selection/login/pairing stubs is T12+).
- **Repo-config carried forward (T09's original finding, reproduced)**: every new `app/` file
  this ticket added is on disk but untracked+gitignored by the repo root's bare `projects`
  `.gitignore` line — not touched here, same "outside this ticket's scope" call T09/T10 made.

### T12 — Parent dashboard: family/device list & instant pause (app/src/parent/dashboard/)

- **New contract: `app` now consumes `@guardian/domain` via the real npm-workspace package
  specifier** (`import { TIER_DEVICE_LIMIT, type Tier } from '@guardian/domain'`), not T08's
  relative-source-import precedent (that was Deno-runtime-specific, documented as such — app/ is
  Metro/Node, the normal npm-workspace case). This requires `packages/domain/dist/*` to exist,
  which nothing previously built automatically on install (backend never needed it). **Root
  `package.json` change**: added `"prepare": "npm run build -w packages/domain"` — runs on every
  `npm install`, so `dist/` is always fresh. Future tickets adding new `app/` (or any Node/RN)
  consumers of `@guardian/domain` can rely on this; anything importing `packages/domain/src/*`
  by relative path directly (Deno edge functions) is unaffected.
- **`app/src/parent/dashboard/useFamily.ts`**: one PostgREST-embedded `select` on `family` (→
  nested `child` → nested `device`, single round trip) + a separate `subscription` query (kept
  separate rather than also embedding — a `family`↔`subscription` embed's cardinality via a
  PK/FK one-to-one wasn't worth guessing when a second plain query is unambiguous). Row→domain
  mapping is manual snake_case→camelCase (same class of mapper as T08's `rowToPolicy`). **Tier
  defaults to `'free'` only when the subscription row is legitimately absent** (no Subscription
  row is ever created by T10's signup handler) — a query *error* still throws/surfaces, never
  silently downgrades to `'free'` (reviewer explicitly verified this distinction holds).
- **`app/src/parent/dashboard/useInstantPause.ts`** calls T08's exact `POST
  {FUNCTIONS_URL}/policy-sync/instant-pause`, body `{ familyId }`, parent's own session token
  (`supabase.auth.getSession()`) as bearer + anon apikey — same convention T11's
  `useSignUp`/`usePairDevice` established. **Real end-to-end verified** (local Supabase was
  already running from a prior session): reset DB, ran T07's `scripts/smoke.ts` to seed a real
  family/child/device chain, manually inserted a `subscription` row (no ticket seeds one yet —
  flagged above), signed in as the parent, ran the exact embedded `useFamily` query via curl
  (correct nested shape, field names matched the mapper exactly) and the exact instant-pause
  request via curl against a live `supabase functions serve policy-sync` — got `HTTP 200
  {"childrenPaused":1,"devicesNotified":0,"dbWriteAndDispatchMs":13.7}`, then confirmed via a
  service-role query that the child's policy row actually bumped to version 2 with
  `instant_pause:true`. `devicesNotified:0` because the seeded device has no `push_token` (T08's
  own documented gap, unchanged). Functions-serve process killed after verification; local DB
  left in that post-verification seeded/paused state (harmless local dev-only state, same
  precedent T09/T10 established).
- **`DashboardScreen.tsx`**: one card per child (name, `devices.length / TIER_DEVICE_LIMIT[tier]`,
  a literal em-dash "Remaining time today" placeholder — T14/T21 wire the real value, never
  fabricated here), one "Pause All Devices" button gated behind RN's built-in `Alert.alert`
  confirmation (no new dependency). Registered on `ParentNavigator` by swapping the existing
  `parentScreens` 'Dashboard' entry's `component` (T11's array-append pattern — not a JSX edit);
  T11's stub `app/src/screens/parent/DashboardScreen.tsx` deleted (superseded).
- **Reviewer fix (pre-DONE)**: `useInstantPause.pauseAll` rethrows after recording the error in
  hook state (deliberate, so the promise chain still fails for any future caller that wants to
  `await`+`catch`), but `DashboardScreen.tsx`'s confirm handler discarded the returned promise
  (`void pauseAll(...)`) — every real pause failure was therefore an **unhandled promise
  rejection**, reproduced by the reviewer with a throwaway rejecting-mock test. Fixed:
  `pauseAll(familyId).catch(() => {})` (error already reaches the UI via `pauseError` state, so
  the catch is a no-op beyond preventing the unhandled rejection). Added two regression tests
  (confirm-flow-with-rejection, `pauseError`-renders). Re-verified: `npm test -w app` 7/7 (was
  5/5), typecheck/eslint unchanged clean.
- **Verified**: `npm run typecheck -w app` exit 0; root `npx tsc -p tsconfig.base.json --noEmit`
  exit 0; `npm run typecheck --workspaces --if-present` exit 0 (backend+domain+app); `npx eslint
  . --ext .ts,.tsx` exit 0; `npx eslint app/src --ext .ts,.tsx` exit 0 (ticket's literal
  command); `npm test -w app` 7/7; `npm run test --workspaces --if-present` — domain 97/97 +
  backend 56/56 unchanged, app 7/7. Live end-to-end Supabase verification described above.
- **RISK carried forward**: no `Subscription` row exists for a family until someone creates one
  (T10's signup handler never does) — dashboard degrades to `'free'`/1-device-limit display
  until a future ticket (billing/tier-selection, likely T20 territory) actually provisions a
  real Subscription row at signup or upgrade time. `devicesNotified:0` on instant-pause remains
  because no device ever gets a `push_token` yet (T08's original gap, still open, likely T21's
  device-pairing/registration flow closes it).

### T13 — Parent policy config UI: screen time & schedules editor (app/src/parent/policy/)

- **New contract: `usePolicy(childId)`** (`app/src/parent/policy/usePolicy.ts`) — reused
  verbatim by T14/T15/T16 per their tickets: `{policy, loading, saving, error, save, refetch}`.
  `save(update: PolicyUpdate)` optimistically applies `update` to local state, PUTs T08's exact
  `PUT /policy-sync/:childId`, rolls back + sets `error` (plain string, server's message as-is
  — includes `FeatureGatedError`'s full text on a 403) on any failure. `PolicyUpdate` is
  redefined locally as `Partial<Omit<Policy, 'id'|'childId'|'version'>>` (same shape as
  `packages/backend/src/policySync.ts`'s own type) rather than imported — that module is
  Deno-edge-function-oriented and reaches `packages/domain` by relative path; app/ consumes
  `@guardian/domain` as a normal npm-workspace package (T12's precedent), so the two shouldn't
  share an import graph over one type alias.
- **Screens registered on `ParentNavigator`**: `ScreenTime`/`Schedules`/`VacationMode`, each
  with a `{childId: string}` route param (`ParentStackParamList` extended accordingly). No
  ticket yet wires "tap a child card on Dashboard -> navigate here with childId" — T13's own
  ticket text (unlike T12's) didn't require nav-flow wiring, so it wasn't invented. **Flag for
  whichever future ticket needs a child-detail hub**: these three screens are real and tested
  but currently unreachable from the running app's UI, reachable only via
  `navigation.navigate('ScreenTime', {childId})` called from code that doesn't exist yet.
- **Reviewer-flagged nit (non-blocking, left as-is)**: `parentScreens`'s `ScreenConfig.component:
  ComponentType` (T11) has no generic parameter, so registering a screen that requires
  `route`/`navigation` props (all three of this ticket's screens) needs an `as ComponentType`
  cast that erases the prop-type check — Login/Dashboard (T11/T12) never needed this since they
  take no props. No runtime bug (names are correctly matched today), but the array-append
  pattern now has zero static protection against a future ticket registering a mismatched
  `name`/`component` pair. Worth a typed-registration follow-up before many more param-taking
  screens are added (T14 already will be one).
- **RISK carried forward, not fixed here (pre-existing, T08's gap)**: T08's
  `detectGatedFeatureTouches` never gates `schedules` or `vacation` writes, even though
  `schedules` is a Standard+ feature per T06's `TIER_FEATURES`. `SchedulesScreen`/
  `VacationModeScreen` therefore never actually receive a 403 from a Free-tier family today —
  the ticket's "shows the gated-403 error inline" requirement is implemented (any 403 renders
  inline via `usePolicy`'s `error`) but is currently unexercised by real traffic through these
  two screens. `ScreenTimeScreen`'s own `dailyLimitMinutes`/`weeklyLimitMinutes`/`perCategory`
  fields are likewise ungated (only `screenTime.perApp`, which this screen doesn't touch,
  triggers `per_app_limits`).
- **No date/time-picker dependency added**: `SchedulesScreen`'s start/end time fields and
  `VacationModeScreen`'s end-date field are plain `TextInput`s (`HH:mm`/`YYYY-MM-DD` free text),
  not native pickers — no picker library exists anywhere in `app/`'s deps and adding one is an
  escalation per CLAUDE.md's "new dep is an escalation decision," not this ticket's call to
  make unilaterally. Flag for T14/T17 (buckets/location UI, similarly time-heavy) if a picker
  library is ever added, this screen's fields are the natural first follow-up to swap over.
- **Repo-config carried forward (T09/T11/T12's original finding, reproduced)**: every file this
  ticket added under `app/src/parent/policy/` (and the `ParentNavigator.tsx` edit) is on disk
  but untracked+gitignored by the repo root's bare `projects` `.gitignore` line — not touched
  here, same "outside this ticket's scope" call three prior tickets made.
- **Verified**: `npm test -w app` — 21/21 passing (was 7; +14: 5 ScreenTimeScreen + 3
  SchedulesScreen (round-trip add/edit/remove, category+day-toggle, two-bedtime-entries) + 6
  VacationModeScreen). `npm run typecheck -w app` exit 0. `npx eslint app/src --ext .ts,.tsx`
  exit 0. Root `npx tsc -p tsconfig.base.json --noEmit` exit 0 (app still excluded, confirmed no
  regression). Full workspace fan-out: domain 97/97, backend 56/56, app 21/21, all typecheck
  exit 0 — zero regression to prior tickets.
- **Reviewer's independent verification** (fresh context, stakes gate: 8 files / ~1000+ lines,
  `stakes: medium` per ticket frontmatter): re-ran every check above directly; wrote and ran a
  throwaway harness (not committed) directly exercising `usePolicy`'s real `save()` rollback
  logic (network-throw, missing-session, gated-403 paths) since all three screen tests mock
  `usePolicy` away (same convention T12 established for `useFamily`/`useInstantPause` — the
  hook's own I/O logic is never unit-tested directly in this repo's convention, only its
  callers' payload-shaping via mocks); confirmed rollback + inline error surfacing all correct.
  Verdict: APPROVE, zero blocking findings.

### T14 — Parent Usage Buckets config UI (app/src/parent/buckets/)

- **`BucketsScreen.tsx`**: reuses T13's `usePolicy(childId)` unchanged (buckets editor read/
  save) and T12's `useFamily()` unchanged (tier check only — no new hook written; `tier` is
  family-wide, not child-specific, so a dedicated hook would just duplicate `useFamily`).
  Gate: `!hasFeature(tier, 'usage_buckets')` (premium-only, T06) renders an upsell card instead
  of the editor. Save always sends the **full** `{default, perCategory}` `buckets` object (not
  a partial merge) — safe because `Policy.buckets` is a single top-level field with no other
  writer anywhere in the app (confirmed by grep) or the domain/backend layers; unlike T13's
  `screenTime.perApp`, there's nothing else to accidentally clobber.
- **New contract: type-only `Paywall: undefined` route** added to `ParentStackParamList`
  (`app/src/navigation/ParentNavigator.tsx`) — **not** registered in the runtime `parentScreens`
  array (no component exists yet). This exists solely so `navigation.navigate('Paywall')`
  typechecks in `BucketsScreen`'s upsell CTA today. **T20 must**: build
  `app/src/parent/billing/PaywallScreen.tsx` per its own ticket text and push
  `{ name: 'Paywall', component: PaywallScreen }` into `parentScreens` — at that point this
  route resolves for real, no other change needed on T14's side. Confirmed (via
  `@react-navigation/core`'s `defaultOnUnhandledAction`) that navigating to an unregistered
  route name never throws — dev-mode `console.error` only, prod no-ops — so tapping the upsell
  CTA before T20 ships is a silent no-op, not a crash. Same route name (`'Paywall'`) will be
  needed by T16/T17's upsell cards too, per T20's own ticket text ("every gated screen's upsell
  card (T14, T16, T17) links here") — future tickets should reuse this exact key, not invent a
  new one.
- **`Buckets` screen registered on `ParentNavigator`** (`{childId: string}` route param), same
  append-pattern precedent T13 established (ticket text didn't require it, same as T13 — done
  for consistency, otherwise the screen is unreachable dead code).
- **Validation**: mandatory break must be `> 0` whenever max session length is `> 0`, checked
  per row (including the non-removable `default` row) — blocks Save with inline errors, both
  per-row (`{prefix}-error`) and page-level (`buckets-validation-error`). Reviewer-noted nit
  (not fixed, matches T13's own established `Number(x) || 0` coercion pattern exactly): a
  non-numeric or negative value in a numeric field silently coerces to `0` rather than showing
  a format error — `keyboardType="number-pad"` restricts normal on-device input but this isn't
  defended in the JS logic against paste/hardware-keyboard input. Same class of gap as every
  other numeric field in T13's screens; not introduced fresh here.
- **No configurable grace-finish minutes field** — deliberately just a boolean `Switch`
  (`graceFinishEnabled`), matching `BucketCategoryConfig`'s actual shape and the ticket's
  explicit "do not add a configurable minutes field, that would be scope creep" instruction.
- **Verified**: `npm test -w app` — 27/27 passing (was 21; +6: upsell-for-non-premium,
  upsell-CTA-navigates-to-Paywall, full-editor-for-premium, override
  add/edit/remove-round-trips-into-save-payload, validation-blocks-zero-break, fixing-the-row-
  unblocks-save). `npm run typecheck -w app` exit 0. `npx eslint app/src --ext .ts,.tsx` exit
  0. Root `npx tsc -p tsconfig.base.json --noEmit` exit 0. Full workspace fan-out: domain
  97/97, backend 56/56, app 27/27 — zero regression.
- **Reviewer's independent verification** (fresh context, stakes gate: ticket's own
  `stakes: high` frontmatter): re-ran every check directly; independently confirmed the
  shallow-merge safety of the full-buckets-object save, confirmed `usage_buckets` is
  premium-only in `TIER_FEATURES`, confirmed server-side gating on `buckets` touches in
  `policySync.ts`, and confirmed via `@react-navigation/core` source that an unregistered
  `Paywall` route navigate is a safe no-op (not a crash) in both dev and prod. Verdict:
  APPROVE, zero blocking findings.
### T15 — Content category list & content-filtering config UI (packages/domain + app/src/parent/contentFilter/)

- **New contract: `packages/domain/src/contentCategories.ts`** — `CONTENT_CATEGORIES` (32
  unique `{id, label, defaultBlockedFor: AgeTier[]}` entries, exported via the domain barrel)
  is now the canonical id list every ticket touching `ContentFilterPolicy.categories` must use.
  `getAgeBasedPreset(ageTier): Record<string,'block'|'allow'>` derives per-tier defaults
  directly from it — spot-check against spec: `pornography`/`drugs`/`malware_phishing` etc.
  blocked at every tier; `gaming`/`video_streaming`/`news`/`education`/`search_engines`/
  `productivity`/`job_search` never blocked by default; `social_media`/`messaging`/`shopping`/
  `forums_chat` blocked only for `young`. Full list + rationale in the file itself.
- **T04 reconciliation** (per this ticket's explicit requirement 0): `packages/domain/src/
  presence/evaluator.ts`'s `VIDEO_LIKE_CATEGORIES` placeholder (`'video_streaming'`/`'video'`/
  `'youtube'` — only the first was ever a real id) now derives from `CONTENT_CATEGORIES` by
  filter (`new Set(CONTENT_CATEGORIES.filter(c => c.id === 'video_streaming').map(c => c.id))`)
  instead of being re-hardcoded — can't silently drift from the canonical list again. Existing
  behavioral tests in `evaluator.test.ts` unchanged/still pass; added one asserting the
  reconciled id is a real `CONTENT_CATEGORIES` entry.
- **`ContentFilterScreen.tsx`**: reuses `usePolicy` (T13, read/save) and `useFamily` (T12,
  child birthdate lookup only — same reuse-not-duplicate pattern as T14's `tier` lookup). Full
  `contentFilter` object saved on every edit (single top-level `Policy` field, no other writer
  anywhere in the app/domain/backend — confirmed by grep, same safety reasoning as T14's
  `buckets`). Age preset applied only when `categories` is empty (never clobbers an
  already-configured policy). Whitelist-only mode: banner + `disabled={whitelistOnly}` on every
  category cell (RN's `disabled` genuinely suppresses `onPress`) — does **not** force-write
  every category to `'block'` in the saved payload; `whitelistOnly` is a distinct policy field
  the native enforcement layer (T22/T26, out of scope here) reads as a global override, so
  mutating `categories` to fake that would destroy the parent's per-category choices the moment
  whitelist mode is turned back off.
- **Screen registered on `ParentNavigator`** (`ContentFilter: {childId: string}`), same
  append-pattern precedent as T13/T14.
- **Bug found and fixed during self-review (verified by the reviewer independently, not just
  claimed)**: `ContentFilterScreen.tsx`'s policy-sync `useEffect` originally depended on
  `[policy]` only but read `childBirthdate` (from the separately-loading `useFamily()`) inside.
  Since the two hooks resolve independently, if `policy` became non-null before
  `childBirthdate` did, the effect fired once, found no birthdate, left `categories` empty, and
  then **never re-fired** once birthdate later resolved (not in the dep array) — permanently
  skipping the age-preset seed. Fixed by adding `childBirthdate` to the effect's deps. Safe to
  re-run on that dep changing: the whole interactive form is gated behind `familyLoading ||
  policyLoading`, so by the time a user can touch any field both hooks have already resolved
  and `childBirthdate` never changes again — no risk of clobbering in-progress edits. Added a
  regression test (`ContentFilterScreen.test.tsx`, "applies the age preset even when useFamily
  resolves after usePolicy") using RTL's `rerender` to simulate the race; confirmed by both
  self-review and the reviewer that it fails without the fix (`{}` payload) and passes with it.
- **Verified**: `npm test -w packages/domain` — 106/106 (was 97; +9: 8 `contentCategories`
  tests + 1 evaluator reconciliation test). `npm test -w app` — 34/34 (was 27; +7
  `ContentFilterScreen` tests). `npx tsc -p tsconfig.base.json --noEmit` exit 0 (repo-wide,
  domain is git-tracked and fully checked, app still excluded per T11's precedent). `npx eslint
  . --ext .ts,.tsx` exit 0. Full workspace fan-out: domain 106/106, backend 56/56 unchanged,
  app 34/34 — zero regression. `packages/domain` rebuilt (`npm run build -w packages/domain`)
  so `app/`'s `@guardian/domain` package-specifier import picks up the new exports — same
  `prepare` script T12 wired in, re-confirmed still sufficient.
- **Reviewer's independent verification** (fresh context, stakes gate: 8 files, diff well over
  150 lines): re-ran every check directly; independently reproduced the race-condition bug by
  reverting the fix and re-running the regression test before restoring it; confirmed no other
  consumer of `VIDEO_LIKE_CATEGORIES`/`ContentFilterPolicy.categories` exists that this change
  could silently break; confirmed `disabled={whitelistOnly}` genuinely suppresses `onPress` at
  the RN level, not just visually. Verdict: APPROVE, zero blocking findings. Two non-blocking nits (the `as ComponentType` cast
  above, and a `handleSave` null-guard consistency gap in `VacationModeScreen.tsx` fixed
  immediately after review, re-verified 21/21 + typecheck + eslint clean).

### T16 — Parent app management UI (app/src/parent/appManagement/)

- **New contract: `InstalledApp` type** added to `packages/domain/src/types.ts`
  (`{appId: string, name: string, storeRating: string | null}`) — T02 didn't anticipate this.
  Matching `InstalledAppSchema` added to `schemas.ts` (repo convention: every domain type gets a
  mirroring zod schema, T02's original precedent). This is the shape a real device reports an
  installed app in.
- **New contract: `new_install` `DeviceEvent.payload` shape** — no prior ticket defines this;
  T24 (native install-detection, not yet built) explicitly says its future
  `PackageAddedReceiver.kt` "feeds T16's InstallAlertsScreen, already built," meaning **T16 sets
  this contract, T24 must conform to it later**, not the reverse (same forward-contract pattern
  as T14's `Paywall` route). Assumed/documented shape: `{appId, name, storeRating}`, identical
  to `InstalledApp` — T24 must emit exactly these three fields from the real Android
  `ACTION_PACKAGE_ADDED` data.
- **`useInstalledApps(childId)`** (`app/src/parent/appManagement/useInstalledApps.ts`):
  `{apps, loading, error, refetch}`, backed by a static 7-app fixture — no real Android device
  paired in this environment (LEDGER Phase 0). Documented swap point for T24
  (`InstalledAppsModule.kt`'s native bridge or a `device_event`-sourced query) — no consumer of
  this hook needs to change when swapped, same shape either way.
- **`useInstallAlerts(childId)`** (`app/src/parent/appManagement/useInstallAlerts.ts`): real
  supabase-js query against `device_event`, server-side filtered (`type=eq.new_install`) and
  ordered (`occurred_at.desc`) — RLS's `device_event_select_parent` (T07) scopes reads to the
  signed-in parent's own family. First app/ consumer of this table.
- **`AppManagementScreen.tsx`**: gated behind `hasFeature(tier, 'app_blocker')` (Standard+),
  upsell card reuses T14's exact pattern/CTA (`navigation.navigate('Paywall')`, same
  type-only-forward-declared route). Store-rating default (`['17+','Mature']`) applied only
  when `blockByStoreRating` is empty (mirrors T15's "preset only when unconfigured" pattern) —
  covered by both a positive and negative test. Full `appRules` object saved on every edit
  (single top-level `Policy` field, no other writer anywhere — confirmed by grep, same safety
  reasoning as T14's `buckets`/T15's `contentFilter`).
- **Mutual exclusivity (ticket's explicit "enforce this in the save logic" ask)**: every
  installed app is always classified into exactly one of `blockedApps`/`allowedApps` (binary
  toggle, no three-state "unset" — a deliberate scope call, see SCRATCH's rejected-alternatives;
  the three-state question of how `blockByStoreRating` interacts with an explicit `allowedApps`
  override is native-enforcement territory, out of scope here). `handleSave` preserves
  blocked/allowed entries for apps not currently shown (e.g. previously blocked apps no longer
  in the installed-app list) so nothing outside the visible list is silently dropped. **Added a
  defensive final guard** (found during self-review, not originally planned): `allowedApps` is
  filtered against the final `blockedApps` set before saving, so even a pre-existing
  inconsistent policy (an id already in both lists — pre-T16 state or a manual DB edit) can
  never round-trip back out inconsistent; blocked always wins. Regression test constructs
  exactly that fixture and confirms the guard fires.
- **Screens registered on `ParentNavigator`** (`AppManagement`/`InstallAlerts`, both
  `{childId: string}`), same append-pattern precedent as T13-T15.
- **Verified**: `npm test -w app` — 45/45 passing (was 34; +11: 7 `AppManagementScreen` tests +
  4 `InstallAlertsScreen` tests). `npm run typecheck -w app` exit 0. `npx eslint . --ext
  .ts,.tsx` exit 0 (repo-wide, domain touched). Root `npx tsc -p tsconfig.base.json --noEmit`
  exit 0. Full workspace fan-out: domain 106/106 unchanged, backend 56/56 unchanged, app 45/45
  — zero regression. `packages/domain` rebuilt so `app/`'s `@guardian/domain` import picks up
  `InstalledApp`.
- **Reviewer's independent verification** (fresh context, stakes gate: 10 files, diff well over
  150 lines): re-ran every check directly; hand-traced the mutual-exclusivity guard across every
  code path (new-vs-preserved, the defensive de-dupe) and confirmed no collision is possible;
  confirmed the sync `useEffect`'s dependency array (`[policy, installedApps]`) does **not**
  repeat T15's independently-loading-hooks race bug; confirmed `useInstallAlerts`'s query is
  genuinely server-side filtered/ordered, not client-side; confirmed no other consumer of
  `AppRulePolicy`/`Policy.appRules` exists that the full-object save could clobber. First-pass
  verdict was CHANGES solely because this LEDGER entry didn't exist yet at review time (review
  runs before the pipeline's own report/ledger stage) — no code or test defect found; entry
  added immediately after, closing that gap.

### T17 — Location & geofencing (packages/backend + app/)

- **New contract: `Geofence`/`GeofenceSchema`** added to `packages/domain` (`types.ts`/
  `schemas.ts`) — same class of gap as T16's `InstalledApp` addition; no prior ticket defined
  this shape. `{id, childId, name, lat, lng, radiusMeters, alertOnEnter, alertOnLeave}`.
- **New contract: `location_update` `DeviceEvent.payload` shape** — `{lat: number, lng: number}`.
  No prior ticket defined this; established here and consumed identically by
  `packages/backend/src/geofence.ts`, `event-ingest/index.ts`, and the frontend's
  `useChildLocations.ts`/`useLocationHistory.ts`. Any future native location-reporting code
  (T21/T24 territory) must emit exactly these two fields.
- **`packages/backend/supabase/migrations/0006_geofence.sql`**: `geofence` table, full parent
  CRUD RLS (select/insert/update/delete) scoped via T07's `current_parent_child_ids()` helper,
  delete-policy shape copied from T10's `family_delete` precedent (`0005_pairing.sql`). No
  device-role policy — evaluation is server-side only (service-role key), a device never reads
  or writes this table.
- **`packages/backend/src/geofence.ts`**: pure `evaluateGeofences(geofences, point,
  previouslyInside)` (haversine, `<=` counts as inside) and pure `getLocationHistory(events,
  childId, days=30, now)` (trailing-window filter+sort), same dual-runtime "no I/O" pattern as
  T09's `digest.ts`. **`getLocationHistory` has no runtime caller** — the frontend's
  `useLocationHistory.ts` reimplements equivalent filtering directly via a live supabase-js
  query instead (that Deno-oriented backend module isn't importable from `app/`, same boundary
  T12 already established for `policySync.ts`). Reviewer confirmed this split is an acceptable
  architectural choice, not a defect, but flagged for awareness — a future ticket wiring a real
  location-history edge function should reuse this helper rather than re-deriving the logic a
  third time.
- **`previouslyInside` state has no persisted table** — `event-ingest/index.ts` derives it by
  querying the latest `geofence_enter`/`geofence_leave` `device_event` row per `geofenceId`
  (newest-first, first-seen-per-id wins), then updates it in-memory across a batch's
  `location_update` events in insertion order (so an enter→leave→enter sequence within one
  batch is evaluated correctly, not just the first event). Resulting transition rows are
  inserted with the **service-role key**, not the forwarding device JWT (system-derived, not
  literally device-reported — same rationale as `push_log`/`digest`).
- **Frontend geofence CRUD is direct supabase-js against the `geofence` table** (RLS-enforced),
  not an edge function — no gating/versioning logic like `policy` has that would require one.
  First `app/` consumer to *write* a standalone table directly (`useFamily`/`usePolicy` only
  ever read that way before).
- **`app/src/parent/location/MapProvider.tsx`**: swappable `MapProvider` interface
  (`ComponentType<{pins: MapPin[]}>`) + `FallbackMapProvider` (plain list + static placeholder,
  no real map). `ActiveMapProvider` is the documented swap point — `FamilyMapScreen`/
  `GeofenceEditorScreen` only ever import `ActiveMapProvider`, never the fallback directly, so a
  future `react-native-maps` swap needs zero consumer changes. `SETUP.md`'s new "Maps provider"
  section documents the exact key/library.
- **GeofenceEditorScreen's "center point picked from the fallback view"**: since the fallback
  has no tap gesture, implemented as plain numeric lat/lng text fields (no auto-pick from a
  child's last known location). Reviewer judged this an acceptable, non-cop-out interpretation
  given the explicit "not a real interactive map" scope boundary.
- **Review-fix (pre-DONE, two rounds)**: first review round found `GeofenceEditorScreen`'s save
  path had no client-side validation at all (a blank/garbage lat/lng silently created a
  Null-Island or NaN geofence that would never evaluate, with no parent-visible feedback) —
  fixed by adding an `isFormValid` predicate mirroring `BucketsScreen.tsx`'s established
  `isRowValid`/`allValid` pattern, disabling Save and showing a validation message when invalid.
  Second review round found that first fix was itself incomplete: `Number('')` evaluates to `0`
  (not `NaN`), so an untouched/blank lat or lng field still passed the range check and silently
  saved `{lat:0, lng:0}` — fixed by adding an explicit non-empty-string guard on
  lat/lng/radiusMeters *before* the `Number()` coercion. Both fixes are covered by regression
  tests that were confirmed to fail without their respective fix (reverted-and-reran each time).
  Reviewer independently reproduced both the original bugs and the fixes from scratch (not just
  trusting the diff), including adversarial edge cases beyond the coordinator's own tests
  (whitespace-only input, explicit legitimate `lat=0,lng=0`). Final verdict: APPROVE.
- **Verification — real local Supabase instance (already running from a prior session)**:
  `supabase db reset` applied `0001`→`0006` cleanly; re-ran T07's `scripts/smoke.ts` — still
  `SMOKE TEST PASSED` (0006 doesn't regress T07). Real end-to-end edge-function invocation via
  `curl` against the seeded smoke-test child/device with a real geofence row inserted: a
  `location_update` inside the geofence → `{"inserted":1,"devicesNotified":1}`, confirmed a
  `geofence_enter` `device_event` row + one `push_log` row (`"Entered Home"`); a subsequent
  `location_update` far outside → `{"inserted":1,"devicesNotified":1}`, confirmed
  `geofence_leave` + `"Left Home"` push; **re-sending the identical far location a third time →
  `{"inserted":1,"devicesNotified":0}`**, confirming idempotency (no-change produces no
  duplicate alert). Parent-JWT RLS also verified directly (not just service-role): signed-in
  parent could SELECT/INSERT/UPDATE/DELETE their own child's `geofence` rows; unauthenticated
  anon SELECT returned `[]` (default-deny). `npm test -w packages/backend` 72/72, `npm test -w
  app` 55/55, `npm test -w packages/domain` 106/106 (all unchanged outside this ticket's own
  additions). Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck --workspaces
  --if-present`, `npx eslint . --ext .ts,.tsx` all clean.
- **Not verified**: real interactive map rendering (no Maps API key in this environment, out of
  scope per the ticket — swap point only). Location-history auto-deletion after 30 days (out of
  scope per the ticket, noted as a data-retention-job follow-up).
- **Repo-config note (unrelated to this ticket's own diff, same gap T09 already flagged)**: the
  git repo root is `/Users/aliashraf/life-os`, whose root `.gitignore` has a bare `projects`
  line gitignoring this entire project tree except files committed before that line was added
  — every file this ticket added (and, per T09's note, everything since) is untracked *and*
  gitignored. Not touched here (shared-repo-wide `.gitignore` fix is outside this ticket's
  scope and affects other projects in the monorepo too).

### T18 — Monitoring & reports UI (app/)

- **`youtube_view` `DeviceEvent.payload` contract (this ticket's own addition, per the ticket's
  explicit ask to state it plainly for T24 to carry forward)**: `{ title: string; url: string;
  watchedAt: string }`. T24's Android accessibility-based YouTube capture must emit exactly
  these three fields. Documented in `app/src/parent/reports/useYouTubeHistory.ts`'s header
  comment; rows missing `title`/`url` are skipped defensively (not rendered, not an error).
- **No tier gating** on any of the 3 new screens (`ActivityTimelineScreen`/`YouTubeHistoryScreen`/
  `WeeklyDigestScreen`) — confirmed `packages/domain/src/tiers/features.ts`'s `Feature` union has
  no reports/monitoring/timeline entry, unlike T14-T17. Reviewer independently confirmed this
  reading is correct.
- **`DigestSummary` redefined locally** in `app/src/parent/reports/useLatestDigest.ts` rather than
  imported from `packages/backend/src/digest.ts` (Deno-edge-function-oriented, not importable
  from `app/`, same boundary T12/T17 already established). Reviewer confirmed the redefinition
  matches the real interface field-for-field — future tickets changing `DigestSummary`'s shape in
  `digest.ts` must update this copy too (no compiler link between them).
- **`useActivityTimeline`'s pagination**: fetches `PAGE_SIZE+1` (21) rows via
  `.range(offset, offset+PAGE_SIZE)` and slices, giving an exact `hasMore` (avoids the
  off-by-one false-negative of `returned.length === PAGE_SIZE` at an exact-multiple boundary).
  `PAGE_SIZE = 20`, defined in `useActivityTimeline.ts`.
- Timeline scope is exactly `app_usage`/`block_attempt`/`search_query`/`youtube_view`
  (`TIMELINE_EVENT_TYPES`) — deliberately excludes `location_update`/`geofence_*`/
  `presence_trigger`/`new_install`/`uninstall_attempt`/`service_disabled` (other screens'
  territory).
- 3 screens registered on `ParentNavigator` (`ActivityTimeline`/`YouTubeHistory`/`WeeklyDigest`,
  all `{childId: string}`), same append-pattern precedent as T13-T17. No dashboard entry point
  added — consistent with every other parent config/report screen in this repo (none are linked
  from `DashboardScreen`, not a T18-specific gap, confirmed by reviewer).
- **Verified**: `npm test -w app` — 15 suites, **64/64** passing (was 55; +9: 4 timeline + 2
  YouTube + 3 digest). Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck
  --workspaces --if-present`, `npx eslint . --ext .ts,.tsx` all clean. No backend/migration
  changes this ticket (display-only, per its own scope).
- **Reviewer's independent verification** (stakes gate: 10 files): hand-verified the pagination
  range math for both an exact-PAGE_SIZE and a PAGE_SIZE+1 total-row scenario, confirmed
  `DigestSummary` field-for-field match against the real backend type, confirmed timeline filter
  types are a strict subset of the full `EventType` union. Verdict: APPROVE, first pass, no
  findings above nit level.

### T19 — Child request / parent approve flow (packages/domain + packages/backend + app/)

- **`packages/domain/src/buckets/engine.ts` addition (T03's file, touched by this ticket)**:
  `applyApprovedExtraTime(dailyUsage, categoryId, minutes): DailyUsageState` — free function (not
  a `BucketEngine` method), mirrors `refundMinutes`'s floor-at-0 decrement shape exactly. Also
  added `.ts` extensions to this file's own two internal relative imports (`../types`, `./types`)
  — same mechanical, behavior-preserving fix T08 made to `tiers/gate.ts`/`features.ts` and T09
  made to `schedules/vacation.ts`, needed so `packages/backend/src/requests.ts` can import this
  file directly (bypassing the domain barrel/zod) for both Jest and Deno. Re-verified T03's full
  suite unregressed (109/109 domain tests total after this ticket's additions).
- **No `daily_usage` table exists anywhere in this schema — confirmed by grep, and this is
  deliberate, not a gap this ticket should fix**: T21's own ticket text (child dashboard)
  establishes that all `BucketEngine`/`DailyUsageState` runtime state is device-local/
  offline-first (spec §7) and never backend-persisted. So `ExtraTimeRequestPayload` requires the
  child device to include its OWN current `DailyUsageState` snapshot
  (`{categoryId, minutes, currentDailyUsage}`); `POST /requests/:id/resolve` calls
  `applyApprovedExtraTime` against that snapshot and returns the mutated result in the response
  (`dailyUsage` field) — not persisted server-side. **RISK carried forward, same class as T07's
  "no device-scoped SELECT on child_request" flag**: nothing yet propagates this grant back down
  to the requesting device for it to apply to its own local state — that's T21's territory
  (device-side consumption of resolved requests), not built here. Within this ticket's own scope,
  the computed grant is NOT discarded: `app/src/parent/requests/useRequests.ts`'s
  `extraTimeGrants` map captures it and `RequestsInboxScreen.tsx` displays the post-grant minutes
  in the resolved-request history row (reviewer-flagged in a first pass — computing the value and
  never showing/using it anywhere would have been an inert no-op; fixed by wiring it into the
  frontend rather than deferring the whole thing).
- **Payload shape decisions** (`ChildRequest.payload` is untyped `Record<string,unknown>` per
  T02 — no prior ticket defines a convention per `RequestType`, same class of ticket-level
  interpretation as T09's `DeviceEvent.payload` conventions, documented in
  `packages/backend/src/requests.ts`): `extra_time: {categoryId, minutes, currentDailyUsage}`;
  `unblock: {scope: 'app'|'domain', target}` (approve moves target from blocked→allowed on
  `AppRulePolicy` or `ContentFilterPolicy`'s custom domain lists, mutual exclusivity); `
  schedule_change: {schedule: SchedulePolicy}` (approve upserts by `schedule.id` into
  `policy.schedules` — replace if id matches, else append; child-supplied id expected to follow
  the same `sch_<ts><rand>` scheme `SchedulesScreen.tsx` already uses).
- **Push target reconciliation** (reused, not re-decided): no parent-owned device/push-token
  concept exists anywhere in this schema (T09's LEDGER entry). "Push to parent devices" (spec
  §3.6) = the child's own registered devices with a push token, same set every prior
  push-dispatching ticket (T08/T09) uses.
- **No new migration**: `child_request` table + all 4 RLS policies
  (`child_request_select_parent`/`_insert_parent`/`_update_parent`/`_insert_device`) already
  existed from T07, which had already anticipated this exact flow. `POST /requests` uses the
  child device's own forwarded JWT + anon key (device INSERT-only policy); `POST
  /requests/:id/resolve` uses the parent's own forwarded JWT + anon key (parent SELECT/UPDATE +
  the existing parent-scoped `policy` SELECT/INSERT policies, same as T08's policy-sync);
  service-role key only for `device.push_token` reads and `push_log` inserts (same T08/T09
  pattern). New edge function (`packages/backend/supabase/functions/requests/index.ts`) uses
  `_shared/postgrest.ts` + `_shared/push.ts` (T09's current-best-practice template) and its own
  local `PolicyRow`/`rowToPolicy`/`policyToInsertRow` copy (T09's precedent: `policy-sync/
  index.ts`, T08's already-verified file, is left untouched rather than refactored to share this).
- **Post-review fix: atomic-claim guard on resolve.** First-pass `handleResolveRequest` fetched
  the request, applied the mutation if `approve`, and only then unconditionally PATCHed
  `status`/`resolved_at` with no `status=eq.pending` filter — a reviewer (fresh context, stakes
  gate: 9 files) found this let a request be resolved twice (e.g. approve then deny on the same
  id flips `status` to `'denied'` without reverting the already-applied policy row/usage grant,
  violating "deny leaves policy/usage untouched" whenever deny isn't the *first* resolution;
  repeat-approve also creates duplicate `policy` version rows). Fixed by doing the status flip as
  a single atomic conditional `PATCH .../child_request?id=eq.<id>&status=eq.pending` **first**,
  before any mutation — same pattern `auth-flows/index.ts`'s `handlePairDevice` already
  established for pairing-code claims (T10). Zero rows returned → 409 (already resolved) or 404
  (never existed), mutation branch never reached. Re-verified end-to-end: approve an extra_time
  request (real parent JWT) → 200 with the grant; immediately call resolve again with
  `approve:false` on the same id → 409 `"request ... was already resolved"`, DB confirms `status`
  stayed `'approved'` (not corrupted to `'denied'`). Same residual edge case `auth-flows.ts`
  already accepts (claim succeeds, then the mutation step fails on a genuinely broken
  precondition like "no policy exists for this child") is left as-is — no DB transactions are
  available over PostgREST's HTTP API in this stack, so this is the established, accepted
  tradeoff, not a new gap.
- **Verification — real local Supabase instance (already running from prior tickets; `supabase
  db reset` re-applied `0001`→`0006` cleanly)**:
  - `npm test -w packages/domain` (109/109), `npm test -w packages/backend` (82/82), `npm test -w
    app` (70/70) — all new tests pass, zero regression to prior suites.
  - Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck --workspaces --if-present`
    (domain+backend+app), `npx eslint . --ext .ts,.tsx` (repo-wide) all clean.
  - `supabase functions serve` loaded all 6 functions (including the new `requests`) with zero
    import-graph errors, confirming Deno resolution of the new `.ts`-extensioned cross-package
    imports (same T08-established dual-runtime pattern).
  - **Real end-to-end edge-function invocation** via `curl` against a live seeded family/child/
    device, using a REAL parent JWT (`auth.signInWithPassword`, same T07/T09 pattern) for every
    resolve call: created and approved one request of each type — extra_time (`dailyUsage.
    totalMinutesUsed` 90→70, `perCategoryMinutesUsed.games` 60→40, exact expected decrement),
    unblock (`domain` scope: `games.example.com` moved `customBlockDomains`→`customAllowDomains`
    in a new `policy` version 2 row), schedule_change (new `SchedulePolicy` appended in `policy`
    version 3) — plus one deny (status→`'denied'`, confirmed via direct DB query that `policy`
    stayed at exactly 3 rows, no 4th version inserted). Request creation confirmed
    `devicesNotified:1` (push dispatch fired for real, `push_log` write confirmed).
  - Double-resolve race fix verified end-to-end (see above).
  - **Not verified** (same pre-existing, already-flagged gap as T09's `event-ingest`): the real
    device-JWT-authenticated path for `POST /requests`' `child_request` INSERT — used the
    service-role bearer as a stand-in (bypasses RLS) for this call only, same fallback T09's
    LEDGER entry used, since minting a real device JWT remains unresolved (T09's own carried-
    forward RISK, not this ticket's to fix). The parent-JWT-authenticated resolve path (the
    ticket's actual approve/deny flow) was fully verified with a real signed-in session, not a
    fallback.
- **Repo-config note (pre-existing, not touched)**: every new file this ticket added is
  untracked *and* gitignored, same root-`.gitignore`-`projects`-line issue every ticket since T09
  has hit and left alone (out of this ticket's scope, affects other unrelated projects in the
  monorepo). `git diff`/`git status` will not show these files.

### T21 — Child dashboard UI (app/src/child/dashboard/)

- Added `app/src/child/dashboard/`: `useLocalBucketEngine.ts` (the JS-side ticking baseline),
  `ChildDashboardScreen.tsx`, `StillWatchingPrompt.tsx`, `RequestScreen.tsx`, `__tests__/*` (13
  new tests: 5 hook, 5 dashboard screen, 3 request screen). Registered `Dashboard`/`Request` on
  `ChildNavigator.tsx` (append pattern, T11's precedent); deleted the superseded
  `app/src/screens/child/DashboardScreen.tsx` stub (T12's precedent for swapping a stub).
- **Engines wired without modification to T03/T04/T05's actual behavior** — confirmed by a
  reviewer (fresh context, stakes gate: T3, diff >150 lines/>5 files): `BucketEngine`
  (`startSession`/`tick`/`endSession`/`refundMinutes`), `evaluatePresence`, and
  `isWithinAllowedWindow` are called with their real, unmodified signatures. Two small, additive,
  behavior-preserving **exports** were added (not signature/logic changes to any existing
  function): `isVideoLikeCategory(categoryId)` in `presence/evaluator.ts` (exposes the same
  `VIDEO_LIKE_CATEGORIES` check `evaluatePresence` already used internally, so the hook can decide
  whether to show the Still-Watching modal without a second, drift-prone copy of that set) and
  widening `isActiveAt` in `schedules/engine.ts` from module-private to exported (same body, only
  visibility changed) so the dashboard's plain-language schedule message reuses T05's own
  midnight-crossing window logic instead of re-deriving it.
- **Caller contract honored**: `BucketEngine.endSession` has exactly one call site in the hook,
  gated by `tick(now).mustEnd === true` — never called for the Still-Watching timeout, activity
  loss, or any other trivial pause (those only call `refundMinutes`, per Requirement #4).
- **`useLocalBucketEngine(policy, initialUsage, categoryId, identity)`** — `categoryId`/`identity`
  ({deviceId, childId, deviceToken}) are minimal necessary additions beyond the ticket's literal
  2-arg signature (same documented class as T03's `weeklyMinutesUsed`/T04's `deviceId`/`childId`):
  nothing else in scope supplies which category the baseline timer runs for, or what
  device/child/bearer to post `DeviceEvent`s and `POST /requests` calls as — no device-JWT
  persistence mechanism exists yet (T11's `PairDeviceScreen` is still a stub, out of this
  ticket's scope to build).
- **Idle (Level 0) presence is a pure-JS approximation**: a `recordActivity()` callback (wired to
  root-view touches) resets a `lastActivityAt` ref, compared against
  `policy.presence.thresholdMinutes.level0` each tick; resets again whenever a fresh session
  starts (so the idle clock and `evaluatePresence`'s own `minutesSince(sessionStartedAt, now)`
  refund math track the same instant, not two independently-drifting clocks). Level 1
  (motion)/Level 2 (camera) always pass `false`/`[]` — no native sensors in this environment
  (T25); they can never spuriously trigger until T24/T25 supply real signals.
- **No live "fetch my Policy" wiring for the child device exists yet** — T12-T20 never built one
  (this is the first child-side ticket). `ChildDashboardScreen`/`RequestScreen` accept
  policy/initialUsage/categoryId/identity via `ChildStackParamList` route params — same "real,
  tested, but not yet reachable from a built navigation flow" precedent T13 established for
  several `ParentNavigator` screens. **RISK carried forward, not fixed here**: nothing currently
  calls `navigation.navigate('Dashboard', {...})` with real paired-device data; that's T11's
  `PairDeviceScreen` stub's territory (unbuilt) or T24's.
- **RequestScreen's pending list is session-local only** (requests created this app session,
  held in React state) — T07's carried-forward RISK (no device-scoped SELECT policy on
  `child_request`) means the child app cannot read back a request's resolution across restarts;
  fixing that needs a backend/RLS migration, outside this ticket's `app/`-only scope. Documented,
  not silently worked around. Payload shapes (`extra_time`/`unblock`/`schedule_change`) match
  T19's `packages/backend/src/requests.ts` field-for-field (reviewer cross-checked).
- **Verified**: `npm test -w app` — 19 suites, 83 tests (was 70; +13), including the required
  cross-engine integration test (`useLocalBucketEngine.test.ts`'s "Still-Watching timeout
  triggers a presence pause+refund end-to-end through the hook"). `npm test -w packages/domain`
  109/109 unchanged-behavior (2 additive exports only). `npm test -w packages/backend` 82/82
  unchanged. Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck --workspaces
  --if-present`, `npx eslint . --ext .ts,.tsx` all clean. Independently re-verified by a reviewer
  (fresh context) — APPROVE, one non-blocking nit (this LEDGER entry was initially missing,
  added).
- **Repo-config note (reproduced, not touched)**: every new file this ticket added is untracked
  *and* gitignored, same root-`.gitignore`-`projects`-line issue every ticket since T09 has hit.

### T22 — Android native: VpnService DNS filter + blocklist pipeline

- **Environment reality (stated plainly, per the ticket's own instruction)**: no JVM/Gradle in
  this build environment — every Kotlin file below is real, complete, non-stub code, but has
  **never been compiled or run**. Only `packages/domain/src/vpn/dnsDecision.ts` (+ Jest tests) is
  independently verified.
- **New contract: `packages/domain/src/vpn/dnsDecision.ts`** — `resolveDnsAction(domain, policy,
  blocklist): DnsAction`, precedence `customBlockDomains > whitelistOnly-gate >
  customAllowDomains > customBlockKeywords > category-blocklist(T15 CONTENT_CATEGORIES ids) >
  default-allow`, with SafeSearch (google.com/bing.com)/YouTube-restricted-mode CNAME rewriting
  layered only on an ALLOW result. Barrel-exported (`export * from './vpn'` added to
  `packages/domain/src/index.ts`). **This is the verifiable spec of `GuardianVpnService.kt`'s
  Kotlin-side `DnsDecision.kt` object — the two must be kept in sync by hand; nothing enforces
  that automatically across the TS/Kotlin boundary.** Verified: `npm test -w packages/domain` —
  127/127 (was 109; +18 new `dnsDecision.test.ts` tests).
- **Kotlin tree**: `app/android/app/src/main/kotlin/com/guardian/vpn/` — `GuardianVpnService.kt`
  (VpnService, TUN packet loop), `DnsWireFormat.kt` (hand-rolled DNS/IPv4/UDP wire-format parsing,
  no external lib dep), `DnsDecision.kt` (mirrors dnsDecision.ts), `BlocklistLoader.kt`
  (downloads/merges StevenBlack+OISD+HaGeZi, **flat file persistence, not Room** — avoids a
  KSP/annotation-processor Gradle setup this environment can't verify compiles; documented in the
  file itself), `BlocklistRefreshWorker.kt` (daily `WorkManager` job — scheduled from
  `VpnModule.startVpn()`), `BypassPrevention.kt` (Layer 4: known-VPN-app detection, private-DNS
  override detection, DoH/DoT resolver-IP blocklist, tamper `DeviceEvent` emission),
  `VpnModule.kt` (RN bridge: `startVpn`/`stopVpn`/`isActive`/`refreshBlocklist`), `VpnPackage.kt`
  (not in the ticket's literal file list — minimal necessary addition, registers `VpnModule` with
  RN; without it the module is unreachable dead code). Registered in `MainApplication.kt`.
- **Package-namespace mismatch (RISK, documented in SETUP.md, not silently worked around)**: the
  ticket's literal path is `com.guardian.vpn`, but T11's RN-CLI-generated Android app namespace is
  `com.app` (directory-name default, not yet renamed to match the product). Kotlin/Java don't
  require a class's package to match the app's own namespace, so `MainApplication.kt` (package
  `com.app`) importing/registering `com.guardian.vpn.VpnPackage` is ordinary and expected to work
  — but this has never been compiled, so treat it as unverified-but-likely-fine, not confirmed.
- **`build.gradle` new dependency**: `androidx.work:work-runtime-ktx:2.9.1` — ticket-mandated (the
  literal "daily WorkManager job" requirement), not a convenience add.
- **KNOWN REAL LIMITATION, stated plainly (the packet loop's biggest scope gap)**: the VPN routes
  ALL device traffic through the TUN (`addRoute("0.0.0.0", 0)`), required so `BypassPrevention`'s
  DoH/DoT-resolver-IP blocklist can see and drop those connections (both TCP and UDP/QUIC
  variants) at the TUN layer. Non-DNS UDP traffic gets a best-effort passthrough (one
  protected-socket round-trip per packet, not a persistent NAT session — documented tradeoff).
  **TCP is NOT passed through at all — every TCP connection is dropped while this service is
  active**, i.e. as currently written, enabling this VPN breaks essentially all real HTTPS/web
  traffic on a device. A real fix needs either (a) a genuine user-space TCP NAT/proxy (a
  tun2socks-scale subsystem, disproportionate for one ticket to build unverifiably), or (b)
  switching to DNS-only TUN routing (only route the fake DNS server address, not 0.0.0.0/0) plus a
  different mechanism for Requirement 3's DoH/DoT interception (e.g. periodic connectivity
  heuristics instead of TUN-layer packet inspection). **A human must resolve this before this
  service is ever enabled on a real device.**
- **Other documented, non-blocking Kotlin limitations**: DNS answers are always synthesized as
  TYPE=A regardless of the original query's QTYPE (AAAA queries get a type-mismatched answer);
  IPv6 packets pass through `handlePacket` untouched (return immediately, no IPv6 filtering).
- **Reviewer's independent review (fresh context, stakes gate: T3, stakes: high, large diff)**:
  first pass verdict **CHANGES** — 3 confirmed bugs, all fixed before this entry:
  1. `BlocklistRefreshWorker.schedule()` was written but never called anywhere (Requirement 2's
     "daily WorkManager job" was dead code) — fixed: called from `VpnModule.startVpn()`.
  2. This LEDGER entry didn't exist yet at first review (blocking per this repo's own convention)
     — added now.
  3. `GuardianVpnService.onRevoke()` and `onDestroy()` both independently emitted a tamper
     `DeviceEvent` for the same VPN-permission-revoke (Android's default `onRevoke()` triggers
     `stopSelf()` -> `onDestroy()` shortly after) — fixed with a `revokedByUser` flag so
     `onDestroy()` recognizes an already-reported revoke and doesn't double-emit.
  Also fixed on the same pass (reviewer-flagged, non-blocking but addressed): UDP-based DoH/DoT
  bypass (e.g. DoH-over-QUIC on UDP/443) wasn't checked against `KNOWN_DOH_DOT_IPS` at all (only
  the TCP branch was) — added the same check to the UDP path; blocklist flat-file load moved off
  the main thread (`onStartCommand`) onto the packet-loop worker thread.
- **Verified (TS side only — see environment-reality note above)**: `npm test -w packages/domain`
  127/127. Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck --workspaces
  --if-present`, `npx eslint . --ext .ts,.tsx` all clean. `npm test -w packages/backend` 82/82 and
  `npm test -w app` 83/83 unchanged (zero regression — this ticket never touched those
  workspaces' source).
- **`SETUP.md`**: "## Java / Android SDK" section filled in with the ticket's exact 3 setup steps,
  plus the package-namespace-mismatch note and the WorkManager-dependency/network-access
  prerequisites.
- **Repo-config note (reproduced, not touched)**: every new file this ticket added (all of
  `app/android/app/src/main/kotlin/com/guardian/vpn/`, `packages/domain/src/vpn/`) is untracked
  *and* gitignored, same root-`.gitignore`-`projects`-line issue every ticket since T09 has hit.

### T23 — Android native: AccessibilityService (foreground app, text heuristics, YouTube capture, tamper signal)

- **Environment reality (same as T22, stated plainly)**: no JVM/Gradle in this build environment —
  every Kotlin file below is real, complete, non-stub code, but has **never been compiled or
  run**. Only `packages/domain/src/vpn/textHeuristic.ts` (+ Jest tests) is independently verified.
- **New contract: `packages/domain/src/vpn/textHeuristic.ts`** — `matchAdKeywords(visibleText,
  patterns): AdKeywordMatch | null`, first-pattern-list-order-wins scan, case-insensitive,
  malformed-regex-tolerant (skips rather than throws). **Location decision**: placed in `vpn/`
  (the ticket's other offered option was a new `tamper/` module) — `vpn/` already establishes
  "one pure decision-logic module per native decision-maker, mirrored by hand in Kotlin"
  (`dnsDecision.ts`/`DnsDecision.kt`); ad-keyword text matching is the same class of
  content-decision logic, just Layer 3 instead of Layer 1 — a `tamper/` module would be a worse
  fit (keyword-ad matching isn't tamper-detection, that's the separate `service_disabled` signal
  this same ticket emits). Barrel-exported (`vpn/index.ts`). **This is the verifiable spec of
  `AdKeywords.kt`'s `match()` — kept in sync by hand, nothing enforces that automatically across
  the Kotlin/TypeScript boundary.** Verified: `npm test -w packages/domain` — 136/136 (was 127;
  +9 new `textHeuristic.test.ts` tests).
- **Kotlin tree**: `app/android/app/src/main/kotlin/com/guardian/accessibility/` —
  `GuardianAccessibilityService.kt` (the service itself), `AdKeywords.kt` (starter
  tunable/extensible keyword list + `match()`, consolidated data+decision in one file since the
  ticket's literal file list names no separate decision-object file for this service, unlike
  T22's `DnsDecision.kt`/`BlocklistLoader.kt` split), `BlockOverlayView.kt` (system-alert-window
  block overlay, `TYPE_APPLICATION_OVERLAY`, `Settings.canDrawOverlays()`-gated, 8s auto-hide
  safety net), `ForegroundAppTracker.kt` (shared IPC singleton, see below),
  `AccessibilityModule.kt` + `AccessibilityPackage.kt` (RN bridge — **not in the ticket's literal
  file list, same "minimal necessary addition" class as T22's `VpnPackage.kt`**: without it,
  `GuardianAccessibilityService` has no way to hand its detections to JS at all). Registered in
  `MainApplication.kt` (`AccessibilityPackage()` added alongside T22's `VpnPackage()`).
- **IPC mechanism for foreground-package-name (Requirement 1's explicit ask, feeds T24's future
  usage accounting)**: a shared in-process **singleton object** (`ForegroundAppTracker`, same
  pattern class as `VpnModule`'s companion-object `instance`), not `LocalBroadcastManager` (the
  ticket's other offered option) — that API is officially deprecated, and both this service and
  T24's future component run in the same app process, so no cross-process broadcast is needed.
  **T24 should read `ForegroundAppTracker.currentPackageName`/`lastForegroundChangeAtMs`/
  `lastInputActivityAtMs` directly.**
- **Lifecycle-callback interpretation (documented reconciliation against Android's actual
  platform semantics, not the ticket's literal wording)**: the ticket's Requirement 3 names
  "`onInterrupt()`/service-disabled callbacks" as the tamper signal. Per Android's documented
  `AccessibilityService` contract, `onInterrupt()` fires during completely normal operation (the
  system asking the service to stop giving feedback momentarily) and is never followed by
  teardown — treating it as a disable signal would produce false-positive tamper events during
  ordinary use. Implemented `onInterrupt()` as a required-by-the-abstract-class no-op and used
  `onUnbind()` (this service's `VpnService.onRevoke()` analogue) as the real disable-detection
  point instead, guarded by a `tamperReported` flag against double-emission — same class of fix
  as T22's reviewer-caught `revokedByUser` guard on `GuardianVpnService`. Reset on
  `onServiceConnected()` so a disable after a later reconnect is still detectable.
- **`youtube_view` payload contract honored exactly** (`{title, url, watchedAt}`, restated from
  T18): best-effort title extraction via a starter/tunable `viewIdResourceName` candidate list
  (documented version-fragile — YouTube's internal ids aren't public API); **never fabricates a
  fake `watch?v=` URL** — if no literal video id is found in visible text, `url` falls back to a
  genuinely working YouTube search-results link for the extracted title rather than an invented
  watch URL that would silently look correct and be wrong; if no title node is found at all, the
  event is skipped entirely for that scan rather than emitting an empty/placeholder title.
- **Presence bridge event is honestly partial**: `AccessibilityModule.emitPresenceTick` /
  `PartialPresenceSample` fill only `level0Idle`/`foregroundAppCategory`/`now` — verified by the
  reviewer to fabricate nothing beyond those 3 fields. Two flagged approximations, both
  documented in `GuardianAccessibilityService.kt`'s `emitPresenceTick()`:
  1. `level0Idle` uses a hardcoded native-side placeholder idle threshold (2 minutes), not the
     real parent-configured `PresencePolicy.thresholdMinutes.level0` — this native layer has no
     policy-sync mechanism in this ticket's scope. T21's own JS-side `level0Idle` (which does read
     the real policy) remains the authoritative source; this native field is an approximation
     only, distinct from the RISK below.
  2. `foregroundAppCategory` is a coarse 2-way fallback (`"video_streaming"` for known YouTube
     package ids, `"other"` for everything else) — **confirmed by grep: no package-name ->
     content-category mapping exists anywhere in this repo.** Full mapping is out of scope
     (T16/T26 territory); this covers the one distinction `evaluator.ts`'s Level-0 video-gating
     actually branches on (`VIDEO_LIKE_CATEGORIES`).
  3. Audio-activity signal sourced from `AudioManager.isMusicActive()` (non-invasive polling),
     not the ticket-named `OnAudioFocusChangeListener` — a documented interpretation call:
     actually requesting focus (even transient) would itself interrupt/duck the very audio this
     signal is trying to passively observe, self-defeating for a "don't interfere" presence
     heuristic. `isMusicActive()` is the correct passive signal source.
- **RISK carried forward, per this ticket's own explicit ask to flag it**: `app/src/child/
  dashboard/useLocalBucketEngine.ts` (T21, already built) constructs its own complete
  `PresenceSignalSample` every tick purely in JS (`level1Still`/`level2FaceSamples` hardcoded
  `false`/`[]`, `level0Idle` from a JS touch ref, `foregroundAppCategory` from the bucket's own
  configured category) and has **zero `NativeEventEmitter`/`DeviceEventEmitter` subscriptions of
  any kind** (confirmed by grep, independently re-confirmed by the reviewer). This ticket's new
  `guardianPresenceTick` bridge event is therefore consumed by nobody today — same
  already-accepted gap class as T22's `guardianBlockAttempt`/`guardianTamperDetected`, which are
  likewise unconsumed by any JS code in this repo as of this ticket. **Orchestrator decision
  needed**: (a) a small T21 patch adds a native-event listener + a `mergePartialPresenceSample`
  merge function, (b) defer to T24 (already depends on T23, needs `ForegroundAppTracker` too, a
  natural place to wire the full native presence pipeline), or (c) log as an open gap for a later
  integration-verification pass. This ticket's own scope (native Kotlin + the ported TS decision
  logic) is complete either way — the gap is purely in a downstream consumer this ticket doesn't
  own.
- **Reviewer's independent review (fresh context, stakes gate: T3, stakes: high, >5 files, git
  diff empty due to the pre-existing gitignore issue so the reviewer was given the exact file list
  directly)**: first pass verdict **CHANGES** — one blocking finding (this LEDGER entry didn't
  exist yet, fixed by adding it now) plus two non-blocking nits, both fixed on the same pass: (1)
  a defined-but-never-wired `audioFocusChangeListener` property was dead code — deleted, its
  rationale folded into `emitPresenceTick()`'s doc comment instead of living in unreachable code;
  (2) an early-planning-doc name (`guardianPresenceSignal` in `SCRATCH.md`) didn't match the
  shipped event name (`guardianPresenceTick`) — planning-doc drift only, nothing external
  referenced either name yet, noted here for T24/T25 to use the real shipped name. Reviewer
  independently verified: no `AccessibilityNodeInfo` use-after-recycle (I had caught and fixed one
  such bug myself before review — `collectVisibleText` was recycling `root`, which
  `attemptYouTubeCapture`/`findYouTubeTitle` then reused; fixed by moving `root`'s single recycle
  into `runScanPipeline`'s `finally` block, verified correct by the reviewer), the partial-sample
  claim is honest (no fabricated fields), the `youtube_view` contract is followed exactly, the
  tamper double-emit guard is correctly shaped, and the RISK note about T21 is factually accurate
  (independently re-confirmed by grep).
- **Verified (TS side only — see environment-reality note above)**: `npm test -w packages/domain`
  136/136. Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck --workspaces
  --if-present`, `npx eslint . --ext .ts,.tsx` all clean. `npm test -w packages/backend` 82/82 and
  `npm test -w app` 83/83 unchanged (zero regression — this ticket never touched those
  workspaces' source).
- **`SETUP.md`**: no duplicate section added, per the ticket's explicit instruction — T22's "Java
  / Android SDK" section already covers the Java/SDK setup steps this ticket's Kotlin also needs.
- **Repo-config note (reproduced, not touched)**: every new file this ticket added (all of
  `app/android/app/src/main/kotlin/com/guardian/accessibility/`,
  `packages/domain/src/vpn/textHeuristic.ts`(+tests)) is untracked *and* gitignored, same
  root-`.gitignore`-`projects`-line issue every ticket since T09 has hit.

### T24 — Android native: Device Admin, UsageStatsManager & local enforcement

- **Environment reality (same as T22/T23)**: no JVM/Gradle — every Kotlin file below is real,
  complete, non-stub code, never compiled or run. Only `packages/domain/src/buckets/
  nativePortSpec.test.ts` is independently verified.
- **New contract: `packages/domain/src/buckets/__tests__/nativePortSpec.test.ts`** — 19
  doc-as-test assertions against the REAL `BucketEngine` (not a re-implementation), one per rule
  named in the ticket (daily/weekly caps, max session length + category override, mandatory
  break + short-pause-doesn't-reset, session count cap, 5-min/1-min warnings, one-time +3min
  grace, category-default fallback, endSession fold, refundMinutes floor-at-0). This is the
  canonical cross-check that `NativeBucketEngine.kt`'s restated rule table didn't drift from T03.
  Verified: `npm test -w packages/domain` — **155/155** (was 136; +19).
- **Kotlin tree**: `app/android/app/src/main/kotlin/com/guardian/deviceadmin/` —
  `GuardianDeviceAdminReceiver.kt`; `app/android/app/src/main/kotlin/com/guardian/usage/` —
  `NativeBucketEngine.kt` (full port of `startSession`/`tick`/`requestGraceFinish`/`endSession`/
  `refundMinutes`; `reconcileOffline`/`applyApprovedExtraTime` deliberately NOT ported, out of
  scope — no multi-device/parent-approval driver exists on this native loop), `UsageAccountant.kt`
  (installed-apps query + the polling enforcement loop + `SessionStore` — SharedPreferences/JSON
  persistence, same avoid-Room/KSP rationale as T22's `BlocklistLoader.kt`),
  `InstalledAppsModule.kt` + `UsageModule.kt` + `UsagePackage.kt` (RN bridge — `UsagePackage.kt`
  **not in the ticket's literal file list, same "minimal necessary addition" class as T22/T23's
  `VpnPackage.kt`/`AccessibilityPackage.kt`**), `PackageAddedReceiver.kt`. Registered in
  `MainApplication.kt` (`UsagePackage()` added alongside T22/T23's packages).
- **`NativeBucketEngine.kt`'s rule table verified rule-by-rule against `nativePortSpec.test.ts`**
  (all 19 assertions pass against the real TS engine, confirming the restated rules themselves are
  correct — the Kotlin *implementation* of them remains unverified per the environment-reality
  note). Kotlin typing note: TS's single `number` maps to `Double` for time/minute-derived
  quantities, `Int` for count/config quantities — a Kotlin-specific choice, not a behavior change.
- **Lifecycle-callback interpretation (documented reconciliation against Android's actual
  `DeviceAdminReceiver` contract, same class of check T23 did for `onInterrupt`/`onUnbind`)**:
  `onDisableRequested()` (still-preventable attempt, warning string shown) -> `uninstall_attempt`;
  `onDisabled()` (admin actually torn down, nothing left to prevent) -> `service_disabled`.
- **`new_install` `DeviceEvent.payload` contract honored exactly** (`{appId, name, storeRating}`,
  T16's forward-set contract) — `PackageAddedReceiver.kt` filters `EXTRA_REPLACING` (update, not a
  genuinely new install) before emitting.
- **RISK — package-name -> content-category mapping still doesn't exist (same gap T23 hit for
  `foregroundAppCategory`, confirmed again by grep)**: `NativeBucketEngine` needs a `categoryId`
  to resolve `BucketPolicy.perCategory`. Since the native loop cannot determine a real content
  category for an arbitrary foreground package, **all native on-device usage is tracked under one
  synthetic category id (`UsageAccountant.DEFAULT_CATEGORY_ID`)**, which has no `perCategory`
  override, so `resolveCategoryConfig` always falls through to `policy.default` — native
  enforcement today is one global per-device cap, not per-category caps, until a real mapping
  exists (T16/T26 territory). Materially bigger than T23's version of this gap since it affects
  real enforcement, not just a presence heuristic.
- **RISK — store-rating limitation, called out explicitly per the ticket's own ask**: Android's
  `PackageManager` has no public API for Play Store content ratings at all — `storeRating` is
  therefore always `null` from `UsageAccountant.getInstalledApps`/`PackageAddedReceiver`. The
  ticket's described fallback ("a manual per-app rating field the parent can set in T16's UI")
  **does not exist** — confirmed by reading `AppManagementScreen.tsx`/`useInstalledApps.ts`/
  `InstallAlertsScreen.tsx`, all three treat `storeRating` as display-only (`?? 'Unrated'`), no
  manual-entry UI. `AppRulePolicy.blockByStoreRating` filtering is therefore non-functional
  against real on-device data until either a rating source or a manual override UI is built
  (T16/T26 territory, out of this ticket's scope).
- **RISK — no policy-sync bridge into this native loop**: same already-accepted gap as T22's
  `GuardianVpnService.updatePolicy()` (confirmed by reading `VpnModule.kt` in full — it exposes no
  `@ReactMethod` for policy updates either). `UsageAccountant.policy`/`screenTime` are hardcoded
  placeholder defaults (45min session / 15min break / 180min daily / 1260min weekly, no
  `maxSessionsPerDay`). `UsageAccountant.updatePolicy()` is provided, mirroring
  `GuardianVpnService.updatePolicy`'s shape, for a future ticket to wire up — not new scope,
  matching existing precedent.
- **RISK — weekly cap cannot be enforced**: no multi-day persistence exists in this ticket's scope
  (`SessionStore` holds one day's `DailyUsageState` only), so `weeklyMinutesUsed` is always passed
  as `0.0`. The rule is ported and correct (verified by `nativePortSpec.test.ts`); this loop can
  never actually trigger it.
- **RISK — T05's schedules engine is NOT ported/wired**: `isWithinAllowedWindow` is a hardcoded
  always-true placeholder in `UsageAccountant`'s driving loop — only T03's bucket engine was asked
  to be ported by this ticket; schedule-window enforcement is not native yet.
- **`pollOnce` design**: `queryForegroundPackage` (requires `PACKAGE_USAGE_STATS`, special
  app-op access, `UsageAccountant.hasUsageAccess()`-gated) decides whether a NEW session starts
  (real usage evidence required); once running, ticking does NOT re-check foreground presence —
  `tick()`'s elapsed is continuous wall-clock by construction, matching the caller contract
  exactly (a brief foreground-detection gap never resets/ends a session, only `mustEnd` does).
  Already-over-cap refusals (`daily_limit_exhausted`/`weekly_limit_exhausted`) with no session to
  end trigger an immediate lock rather than silently waiting.
- **Reviewer's independent review (fresh context, stakes gate: T3, stakes: high, >5 files, git
  diff empty due to the pre-existing gitignore issue, exact file list given directly — same
  process T23 used)**: first pass verdict **CHANGES** — 2 confirmed findings, both fixed:
  1. **Ticket Requirement 2 explicitly asks for `NativeBucketEngine` unit tests as real Kotlin
     tests, distinct from and additional to `nativePortSpec.test.ts`** — none existed. Fixed:
     added `app/android/app/src/test/kotlin/com/guardian/usage/NativeBucketEngineTest.kt` (plain
     JVM JUnit4 tests, no Android-framework dependency needed since `NativeBucketEngine` has
     none — 18 tests, one-for-one mirroring `nativePortSpec.test.ts`'s rule coverage), and added
     `testImplementation "junit:junit:4.13.2"` to `app/android/app/build.gradle` (ticket-mandated
     new dep, not a convenience add — same class as T22's `work-runtime-ktx` addition). Exposed
     `NativeBucketEngine.isoOf(epochMs)` publicly (was inlined twice in `startSession`/
     `endSession`) so the test file can build fixture timestamps without duplicating the date
     format string. Same environment-reality caveat as every other Kotlin file here: written for
     real, never actually run (no JVM/Gradle).
  2. **`tick()`'s `fire5MinWarning`/`fire1MinWarning` were computed but silently discarded** by
     `UsageAccountant.pollOnce` — no RN event emitted, unlike T21's JS equivalent
     (`useLocalBucketEngine`) which surfaces both to the child UI. Fixed: `pollOnce` now calls a
     new `UsageModule.emitSessionWarning(minutesRemaining)` (RN event `guardianSessionWarning`,
     `{minutesRemaining: 5 | 1}`) on either flag. No JS listener consumes this yet — same
     already-accepted class of gap as T22/T23's other unconsumed bridge events (see T23's RISK
     note on `useLocalBucketEngine`), not blocking, just newly emitted.
  Also fixed on the same pass (reviewer-flagged nit, non-blocking): `pollOnce`'s `mustEnd` branch
  previously wrote `SessionStore.saveSession()` then immediately overwrote it with
  `clearSession()` a few lines later — restructured into an if/else so the session is only
  persisted on the non-ending path.
- **Verified (TS side only — see environment-reality note above)**: `npm test -w packages/domain`
  155/155. Root `npx tsc -p tsconfig.base.json --noEmit`, `npm run typecheck --workspaces
  --if-present`, `npx eslint . --ext .ts,.tsx` all clean. `npm test -w packages/backend` 82/82 and
  `npm test -w app` 83/83 unchanged (zero regression — this ticket never touched those
  workspaces' source).
- **`SETUP.md`**: no duplicate section added, per the ticket's explicit instruction — T22's "Java
  / Android SDK" section already covers the Java/SDK setup steps this ticket's Kotlin also needs.
- **Noticed, not touched**: `reconcileOffline`/`applyApprovedExtraTime` not ported (see above);
  `UsageModule.getUsageToday()` returns only `{date, totalMinutesUsed}` (no ticket-mandated
  payload shape existed to match).
- **Repo-config note (reproduced, not touched)**: every new file this ticket added (all of
  `app/android/app/src/main/kotlin/com/guardian/deviceadmin/`,
  `app/android/app/src/main/kotlin/com/guardian/usage/`,
  `app/android/app/src/test/kotlin/com/guardian/usage/`,
  `packages/domain/src/buckets/__tests__/nativePortSpec.test.ts`) is untracked *and* gitignored,
  same root-`.gitignore`-`projects`-line issue every ticket since T09 has hit.

### T25 — Android native: CameraX presence detection (Level 1/2) + TFLite NSFW classifier

- **Environment reality (same as T22/T23/T24)**: no JVM/Gradle — every Kotlin file below is real,
  complete, non-stub code, never compiled or run. This ticket makes zero `packages/domain` changes
  (confirmed: `npm test -w packages/domain` unchanged at 155/155).
- **Kotlin tree**: `app/android/app/src/main/kotlin/com/guardian/presence/` —
  `MotionMonitor.kt` (Level 1: accelerometer+gyroscope stillness), `CameraPresenceService.kt`
  (Level 2: CameraX front-camera foreground service + ML Kit `FaceDetector`), `FaceWindow.kt`
  (bounded rolling boolean window feeding `level2FaceSamples`), `CameraOptIn.kt` (SharedPreferences
  opt-in flag), `PresencePolicyGate.kt` (in-memory `level2Enabled`/interval snapshot, fail-closed
  default `false`), `PresenceModule.kt` + `PresencePackage.kt` (RN bridge — not in the ticket's
  literal file list, same "minimal necessary addition" class as T22/T23/T24's own `Package`
  files). `app/android/app/src/main/kotlin/com/guardian/nsfw/` — `NsfwClassifier.kt` (TFLite
  `Interpreter` wrapper), `NsfwModule.kt` + `NsfwPackage.kt` (RN bridge). Registered in
  `MainApplication.kt` (`PresencePackage()`/`NsfwPackage()` added alongside T22/T23/T24's).
- **`ForegroundAppTracker.categoryFor(packageName): String`** (new function on T23's existing
  shared singleton, `com/guardian/accessibility/ForegroundAppTracker.kt`): the
  `"video_streaming"`/`"other"` heuristic and its `YOUTUBE_PACKAGE_IDS` set were moved here from
  `GuardianAccessibilityService`'s private companion (that service's `isKnownYouTubePackage` now
  delegates to it, behavior-preserving) so `MotionMonitor` and `GuardianAccessibilityService` share
  one source of truth instead of duplicating the list — avoids the drift class `evaluator.ts`'s
  `VIDEO_LIKE_CATEGORIES`/`isVideoLikeCategory` doc comment already guards against.
- **Privacy guardrail checklist (spec §6, literal code-level facts, independently reviewer-verified
  after one fix — see below)**: (1) boolean-only result persisted/logged —
  `FaceWindow.append(Boolean)` is the only state `CameraPresenceService` retains across ticks; no
  `Bitmap`/`ImageProxy`/`InputImage` field ever exists outside `onFrame()`'s own stack frame. (2)
  no network call ever made with camera data — confirmed by inspection, zero network
  imports/usage anywhere in `nsfw`/`presence`. (3) persistent (`setOngoing(true)`) notification
  shown before any camera bind. (4) feature gated off unless `PresencePolicyGate.level2Enabled`
  (default `false`, fail-closed) AND `CameraOptIn.isOptedIn` — checked in `onStartCommand` **before**
  `startForeground`/camera bind on every path.
- **Reviewer's independent review (fresh context, stakes gate: T3, stakes: high, >5 files, git
  diff empty due to the pre-existing gitignore issue, exact file list given directly — same
  process T22/T23/T24 used)**: first pass verdict **CHANGES** — one blocking finding:
  `CameraPresenceService.capture()` called `ProcessCameraProvider.getInstance().addListener(...)`
  on `cameraExecutor` (a background thread) instead of the main thread, and the analyzer's
  `provider.unbindAll()` call was likewise off-main — both `bindToLifecycle`/`unbindAll` are
  CameraX's own documented `@MainThread`-only APIs, so every tick would have thrown, been silently
  swallowed by the surrounding `try`/`catch`, and left Level 2 permanently non-functional (dead
  code presented as working). **Fixed**: `providerFuture.addListener` now uses
  `ContextCompat.getMainExecutor(applicationContext)`; the analyzer's `unbindAll()` call is
  dispatched via that same main executor. Frame processing (`onFrame`/ML Kit) still runs on
  `cameraExecutor`. Also fixed on the same pass (non-blocking nit): `NsfwClassifier.classify`
  didn't recycle the `Bitmap.createScaledBitmap` result — fixed with a `finally` block, guarded
  (`if (resized !== bitmap)`) since that API returns the source bitmap unchanged, not a copy, when
  it's already 224×224 (naive unconditional recycle would have recycled the caller-owned original).
  Second pass (same reviewer, fresh read of the fix): **PASS** — main-thread dispatch confirmed
  correct for `provider.get()`/`unbindAll()`/`bindToLifecycle()`, analyzer processing correctly
  left on `cameraExecutor`, no deadlock risk, no new regressions.
- **RISK — presence-sample merge point remains unresolved (T23 left it ambiguous, T24 did not
  resolve it either)**: T21's `useLocalBucketEngine.ts` still has zero
  `NativeEventEmitter`/`DeviceEventEmitter` subscriptions of any kind (confirmed by grep — no
  matches for `guardianPresenceTick`/`guardianSessionWarning` anywhere in `app/src`). This
  ticket's `PresenceModule` reuses T23's `"guardianPresenceTick"` event name (not a new one) for
  its own partial emissions (`emitLevel1Still` carries only `level1Still`;
  `emitLevel2FaceSamples` carries only `level2FaceSamples`/`now`) — same "partial sample, one
  event name, JS merges" pattern T23 established. **Orchestrator decision still needed** (same
  three options T23 offered): (a) a T21 patch adds a listener + merge function, (b) a future
  ticket owns the full native->JS presence pipeline, or (c) remains a logged open gap. This
  ticket's own scope (native Kotlin + RN bridge) is complete regardless.
- **RISK — no camera opt-in screen exists anywhere in `app/src/child`** (confirmed by grep — zero
  opt-in/setup-flow matches). `PresenceModule.setCameraOptIn`/`isCameraOptedIn` are exposed via the
  RN bridge for a future screen to call; until one exists, the flag can only be flipped by a human
  calling the bridge method directly. Per this ticket's explicit "Out of scope" instruction, no new
  RN screen was added.
- **RISK — "game category is foreground" gating is an approximation, same class as T23's/T24's
  already-flagged package->category-mapping gap**: no real package-name -> content-category
  mapping exists anywhere in this repo (reconfirmed by grep). `MotionMonitor` gates stillness
  detection on `ForegroundAppTracker.categoryFor(pkg) != "video_streaming"` (i.e. "not known
  video/YouTube") as the closest available stand-in for "a game-like app is foreground" — the
  domain model's real `'gaming'` category id (`contentCategories.ts`) has no package mapping to
  it. Full mapping is out of scope (T16/T26 territory, same as T23/T24's version of this gap).
- **NSFW model — no `.tflite` binary ships in this repo** (cannot be downloaded/trained in this
  environment; ticket forbids fabricating a placeholder). `NsfwClassifier.kt`'s
  `INPUT_SIZE`/`INPUT_CHANNELS`/`OUTPUT_CLASS_ORDER` constants and `[0,1]`-normalized
  preprocessing are documented as matching **GantMan/nsfw_model**'s `mobilenet_v2_140_224` TFLite
  conversion specifically (spec §2.2's "open NSFW models" pointer) — named concretely in
  `SETUP.md`'s new "TFLite NSFW model" section, along with the exact expected asset path
  (`app/android/app/src/main/assets/nsfw_classifier.tflite`) and the caveat that sourcing a
  different conversion requires updating those constants to match its actual contract.
- **`NsfwModule.classifyImageUri`**: no bundled browser exists this pass (Phase-0 decision), so
  there's no automatic in-page image scanning to wire into — documented in-file as a
  share-intent/manual "scan this image" integration point (or a future browser-extension hook),
  matching the ticket's literal instruction not to invent that integration here.
- **`SETUP.md`**: new "TFLite NSFW model" section added (ticket-mandated, distinct from T22's
  "Java/Android SDK" section — this one covers the model-sourcing step, not JDK/SDK setup).
- **Repo-config note (reproduced, not touched)**: every new file this ticket added (all of
  `app/android/app/src/main/kotlin/com/guardian/presence/`,
  `app/android/app/src/main/kotlin/com/guardian/nsfw/`) is untracked *and* gitignored, same
  root-`.gitignore`-`projects`-line issue every ticket since T09 has hit.

### T26 — iOS native: DNS filtering (NEDNSSettingsManager) + Safari Content Blocker

- **Environment reality (same class as T22-T25, better than Android's)**: Xcode 15.4 is
  installed, so plain `swiftc -typecheck` against the bundled iPhoneSimulator17.5 SDK is real
  partial verification (no entitlement/device needed) — unlike Android's Kotlin files, which have
  never been touched by any compiler this build. `DNSFilterManager.swift` and
  `GuardianContentBlocker/ContentBlockerRequestHandler.swift` typecheck cleanly standalone (both
  only need Foundation/NetworkExtension, present in the bare SDK). `DNSFilterModule.swift` fails
  standalone with exactly `error: no such module 'React'` (needs the Pods-installed project) —
  confirmed via a stubbed-typealias re-run that this is the *only* error, i.e. the rest of the
  file's logic (Promise resolve/reject wiring, `DNSFilterManager` usage, `@objc` selectors
  matching `DNSFilterModule.m`'s `RCT_EXTERN_METHOD` declarations) is sound.
- **`app/ios/Guardian/DNSFilter/DNSFilterManager.swift`**: wraps `NEDNSSettingsManager`
  (`installProfile`/`removeProfile`/`isActive`), verified against the real SDK headers
  (`NEDNSSettingsManager.h`/`NEDNSSettings.h`) for exact API shape (`.shared()`,
  `NEDNSOverHTTPSSettings.serverURL`, `saveToPreferences`/`removeFromPreferences`/
  `loadFromPreferences`, `.isEnabled`). Documents explicitly (per the ticket's ask) that iOS has
  no packet-level filtering hook like Android's `VpnService` — `NEDNSSettingsManager` only picks
  *which* DNS server the device uses, so the actual category/domain decision table
  (`dnsDecision.ts`/`DnsDecision.kt`, T22) is NOT evaluated locally on iOS at all; it must run
  **server-side, inside the DoH resolver** this manager points the device at. Intentional,
  spec-acknowledged platform gap (spec §2.1), not a bug.
- **New contract: `packages/domain/src/ios/contentBlockerRules.ts`** —
  `buildContentBlockerRules(policy: ContentFilterPolicy): object[]`, barrel-exported
  (`export * from './ios'` added to `packages/domain/src/index.ts`). Same
  "verifiable-spec-of-native-logic" role T22's `dnsDecision.ts` plays for Android, but **narrower
  by necessity**: a Safari content blocker is a static declarative WebKit ruleset with no
  per-query callback, and this function's ticket-mandated single-arg signature (`policy` only, no
  blocklist/domain→category index) makes category-level blocking impossible to express here —
  documented explicitly in the file's header as an intentional scope boundary, not an oversight.
  Only `customBlockDomains`/`customBlockKeywords`/`whitelistOnly`+`customAllowDomains` are
  translated into WebKit trigger/action rules. Precedence mirrors `dnsDecision.ts`'s table as
  closely as a static ruleset allows: explicit `customBlockDomains` always wins (even under
  whitelist-only or if the same domain is also in `customAllowDomains` — filtered out of the
  `ignore-previous-rules` exception list in both whitelist-only and normal mode); whitelist-only
  emits a block-all (`.*`) rule then per-allow-domain `ignore-previous-rules` exceptions;
  non-whitelist mode emits keyword-block rules then allow-domain exceptions after them (so an
  allow entry can override a keyword match). **Documented deviation**: content-blocker
  `url-filter` matches the whole request URL, not just the hostname, so `customBlockKeywords`
  here is broader than `dnsDecision.ts`'s domain-only substring match — flagged in the file, not
  silently different. No SafeSearch/YouTube-rewrite here (a content blocker can't rewrite a DNS
  answer) — that stays `DNSFilterManager`/DoH-resolver territory.
- **`GuardianContentBlocker/` extension target structure**: `ContentBlockerRequestHandler.swift`
  (reads `contentBlockerRules.json` from a shared App Group container the host app writes
  whenever policy syncs, falling back to a bundled empty-array JSON on first launch before any
  sync has happened — a content blocker extension can't do its own network I/O), `Info.plist`
  (`NSExtensionPointIdentifier: com.apple.Safari.content-blocker`, `NSExtensionPrincipalClass`
  pointing at the handler class), `GuardianContentBlocker.entitlements` (App Groups,
  `group.com.guardian.app` — same group id the main app target's entitlements must also carry,
  noted in both the file and SETUP.md; requires the Apple Developer account T27 handles).
- **`DNSFilterModule.swift` + `DNSFilterModule.m` + `Guardian-Bridging-Header.h`**: standard
  Swift-authored-RN-module pattern (`@objc(DNSFilterModule)` class, `RCT_EXTERN_MODULE`/
  `RCT_EXTERN_METHOD` in a companion `.m` file — `RCT_EXPORT_MODULE` itself is Objective-C-only,
  unusable directly from Swift). Method surface (`installProfile`/`removeProfile`/`isActive`,
  each Promise-based) deliberately mirrors Android's `VpnModule.kt` (T22) shape so the app/'s TS
  wrapper can share one interface across platforms despite the differing enforcement mechanism.
  Bridging header wiring into the app target's `SWIFT_OBJC_BRIDGING_HEADER` build setting is a
  manual Xcode step (no project-file editor available headlessly) — documented in SETUP.md.
- **Reviewer's independent verification (fresh context, stakes gate: T3, 11 new/changed files,
  native/unverifiable-beyond-typecheck)**: first-pass verdict **CHANGES** — 1 confirmed bug, fixed
  before this entry: `DNSFilterManager.installProfile` set `dnsSettings`/called
  `saveToPreferences` without first calling `loadFromPreferences`, unlike the file's own
  `isActive` method which correctly loads first — per Apple's own documented
  `NEDNSSettingsManagerErrorConfigurationStale` ("needs to be loaded"), a stale-state
  `saveToPreferences` call can fail, and `installProfile`'s own doc comment claims "install (or
  update, if already installed)," exactly the repeat-call scenario the staleness guard protects
  against. Not catchable by `swiftc -typecheck` (a runtime API-contract issue, not a type error).
  **Fix**: wrapped the mutate+save body in a `loadFromPreferences` completion first (load error
  intentionally ignored — a fresh/never-configured profile "failing" to load is harmless; only
  the stale-state risk on a subsequent save matters). Re-verified: `swiftc -typecheck` on the
  fixed file still exit 0. No other file needed changes; reviewer independently re-ran
  `npm test -w packages/domain` (167/167), root `npx tsc -p tsconfig.base.json --noEmit`, and
  `npx eslint . --ext .ts,.tsx` (all clean), cross-checked the real SDK headers for API-shape
  correctness, hand-verified the content-blocker precedence table including empty/whitespace-entry
  filtering (no accidental catch-all `url-filter`), and confirmed the domain barrel's new export
  collides with no existing name.
- **Verified**: `npm test -w packages/domain` — 167/167 (was 154; +13 new `contentBlockerRules`
  tests). Root `npx tsc -p tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit
  0 (repo-wide). `npm test -w app` 83/83 and `npm test -w packages/backend` 82/82 unchanged (zero
  regression — this ticket never touched those workspaces' source). `xcrun swiftc -typecheck`:
  `DNSFilterManager.swift` exit 0 (no output), `GuardianContentBlocker/
  ContentBlockerRequestHandler.swift` exit 0 (no output), `DNSFilterModule.swift` exit 1
  (`error: no such module 'React'`, expected — needs the full Xcode/Pods project; isolated and
  confirmed no other error present). `DNSFilterModule.m` is Objective-C, not typecheckable by
  `swiftc`; needs the same full Xcode/Pods project.
- **`SETUP.md`**: "## Xcode / CocoaPods (for iOS builds)" section filled in (was `TBD`) — exact
  manual steps (pod install, add DNSFilter files to the app target, set the bridging header build
  setting, create the `GuardianContentBlocker` extension target via Xcode's Safari Content
  Blocker template and swap in this ticket's files, add the App Groups capability to both
  targets, `xcodebuild` build command) since no Xcode project-file editor exists in this
  environment to do this programmatically.
- **Repo-config note (reproduced, not touched)**: every new file under `app/ios/Guardian/` is
  untracked *and* gitignored, same root-`.gitignore`-`projects`-line issue every ticket since T09
  has hit (confirmed via `git check-ignore -v app/ios/Guardian`). `packages/domain/src/ios/*` and
  the `SETUP.md`/`packages/domain/src/index.ts` edits are normal tracked-repo changes, unaffected.
- **RISK carried forward**: `DNSFilterManager`'s `resolverURL` is a placeholder
  (`https://dns.guardian.example/dns-query`) — no real DoH resolver is deployed in this
  environment; whichever future ticket stands one up (and makes it actually enforce
  `ContentFilterPolicy` server-side) must wire the real URL in here. App Group provisioning
  (`group.com.guardian.app`) needs the Apple Developer account T27 handles before either target
  can actually build with entitlements for a real device.

### T27 — iOS native: FamilyControls/ManagedSettings/DeviceActivity screen time

- **`human_gate: true` handling — no STOP, reasoning recorded (per pipeline's human-gate rule)**:
  the gate refers to Apple's entitlement APPLICATION (human's own Developer Program account +
  Apple's request form) — the ticket itself explicitly scopes that out ("that's T28... plus a
  real human action outside any ticket") and pre-authorizes writing the real Swift integration
  regardless. The one open design call (`.individual` vs `.child`) is pre-resolved by the
  ticket's own instruction to choose `.child` and document it for later human confirmation, not
  to stop and ask now. No blocking question was needed; proceeded.
- **`app/ios/Guardian/ScreenTime/ScreenTimeAuthorization.swift`**: wraps
  `AuthorizationCenter.shared.requestAuthorization(for:)`. Chose `.child` (not `.individual`) —
  reasoned in the file's required comment block, flagged as `RISK:` for human confirmation once
  a real entitlement/device/Family-Sharing setup exists (this product's account model may not
  actually satisfy `.child` mode's Family-Sharing prerequisite — untestable here). Contains the
  ticket's required verbatim entitlement-warning comment block.
- **New contract: `packages/domain`... none — this ticket is pure native Swift**, no TS contract
  added (unlike T26). `ManagedSettingsController.swift` translates `AppRulePolicy`/
  `ScreenTimePolicy`/`SchedulePolicy` (T02) into `ManagedSettingsStore`/`DeviceActivityCenter`
  primitives, with two platform gaps verified against the real SDK `.swiftinterface` files (not
  assumed) and documented, not hidden:
  1. **`ApplicationToken`/`WebDomainToken` have no public initializer at all** (`Token<T>`, opaque;
     `WebDomain.init(domain:)` exists but leaves `.token` nil) — confirmed by reading
     `ManagedSettings.swiftinterface` directly. `AppRulePolicy.blockedApps`'s bundle-id strings
     **cannot be mechanically translated into shielding** the way Android's `BlocklistLoader.kt`
     translates domains into DNS rules. Real source of truth is a `FamilyActivitySelection` the
     parent must choose via a native `FamilyActivityPicker` — **not built by this ticket** (out
     of the RN-bridge-module scope; `ScreenTimeModule`'s 3 required methods have no
     picker-presentation method). `blockedApps.isEmpty` is used only as the on/off switch for
     whichever selection was already persisted. **RISK for whichever future ticket builds the
     picker UI.**
  2. **`DeviceActivitySchedule` has no day-of-week field** (only `intervalStart`/`intervalEnd`/
     `repeats`/`warningTime`, confirmed from `DeviceActivity.swiftinterface`) — unlike
     `SchedulePolicy.daysOfWeek` (T05's per-weekday-row convention). A `repeats: true` schedule
     fires every day regardless of `daysOfWeek`; correctly restricting to specific weekdays
     needs `intervalDidStart`/`intervalDidEnd` to self-check `Calendar` against the original
     `daysOfWeek` — **not wired in this ticket**, `RISK` documented in
     `startScheduleMonitoring`'s doc comment and in `DeviceActivityMonitorExtension.swift`.
  Content-category shielding (`ContentFilterPolicy.categories`) intentionally NOT wired to
  `store.shield.applicationCategories`/`webDomainCategories` either — those take Apple's OWN
  `ActivityCategoryToken` taxonomy (App Store categories, same picker-only-token constraint), not
  Guardian's `contentCategories.ts` (T15) id space; no mapping exists between the two. iOS
  category filtering already happens at the DNS layer (T26).
- **`GuardianDeviceActivityMonitor/` extension target**: `DeviceActivityMonitorExtension.swift`
  (principal class, `eventDidReachThreshold` enqueues a raw event + Darwin-notifies the main
  app; `intervalDidStart`/`intervalDidEnd` overridden but not yet wired to shield toggling — see
  gap 2 above), `Info.plist` (`NSExtensionPointIdentifier: com.apple.deviceactivity.monitor-
  extension`), `GuardianDeviceActivityMonitor.entitlements` (App Groups,
  `group.com.guardian.app`, same group T26's content blocker uses).
- **Event-reporting convention matches Android's established precedent exactly (T22-T24's
  `sendEvent`/`emitTamperEvent`/`emitSessionWarning`), not a new gap**: the extension emits only
  raw fields it actually has (`activityName`/`eventName`/`occurredAt`), never a full `DeviceEvent`
  (no `deviceId`/`childId` available inside an extension process) — `ScreenTimeModule` (main app)
  forwards these raw fields to JS as `guardianAppUsageEvent`; wrapping into a real `DeviceEvent`
  and posting through T09's `event-ingest` remains JS-side work, unbuilt on both platforms alike.
- **`ScreenTimeModule.swift` + `.m` + reused `Guardian-Bridging-Header.h`** (T26's, no second
  bridging header needed): `requestAuthorization()`/`applyPolicy(policy)`/
  `getAuthorizationStatus()` exposed via `RCT_EXTERN_MODULE`. Subclasses `RCTEventEmitter` (not
  plain `NSObject`, unlike T26's `DNSFilterModule`) since it also emits events —
  `requiresMainQueueSetup` uses `override class func` (not `static func`; `static` can't override
  an Objective-C class method import). Darwin-notification observer registered/unregistered in
  `startObserving`/`stopObserving` (RN's own listener-attach/detach lifecycle hooks) rather than a
  custom `init()`, avoiding an unverifiable override-contract guess against `RCTEventEmitter`'s
  real (unavailable-here) header. `applyPolicy` reads only the minimal subset of `Policy` it acts
  on (`appRules.blockedApps`, `screenTime.dailyLimitMinutes`, `schedules[].{id,startTime,
  endTime}`) via guarded/optional-chained `NSDictionary` parsing — same "minimal necessary
  subset" precedent as Android's `UsageAccountant`/`GuardianVpnService` (T22/T24), never
  force-unwraps on malformed JS input.
- **Reviewer's independent verification (fresh context, stakes gate: T3, stakes: high, >5 files,
  human_gate: true)**: first pass verdict **CHANGES** — 1 confirmed bug, fixed before this entry:
  `PendingAppUsageEvent` (the Codable queue-record struct) was defined once, inside
  `DeviceActivityMonitorExtension.swift` (extension-target file), but referenced directly from
  `ScreenTimeModule.swift` (main-app-target file) — app extension targets compile as a
  **separate Swift module** from the main app, so this would fail with `cannot find
  'PendingAppUsageEvent' in scope` in a real Xcode build despite both files typechecking in
  isolation. Reviewer reproduced this concretely by combined-compiling the actual main-app-target
  files together. **Fix**: extracted `PendingAppUsageEvent` + a new `ScreenTimeAppGroup` enum
  (consolidating the 3 previously-duplicated App-Group string constants) into
  `app/ios/Guardian/ScreenTime/Shared/PendingAppUsageEvent.swift`, documented as requiring
  **dual Xcode target membership** (both `app` and `GuardianDeviceActivityMonitor`) — SETUP.md's
  Xcode/CocoaPods section extended (steps 7-10) with the exact manual step and the exact error
  message a human would hit if they forget it. Re-verified: `DeviceActivityMonitorExtension.swift`
  now correctly FAILS standalone (needs the shared file, expected) but passes combined with
  `Shared/PendingAppUsageEvent.swift`in one compilation unit (simulating same-target compilation);
  `ScreenTimeModule.swift` combined the same way fails with only `no such module 'React'`, same
  as before the fix. Reviewer independently confirmed no leftover duplicate constant/struct
  definitions remain (single source of truth) and re-ran the TS-side zero-regression checks.
  Second pass verdict: **APPROVE**.
- **Verified**: `xcrun swiftc -typecheck` (SDK: iPhoneSimulator17.5) —
  `ScreenTimeAuthorization.swift` exit 0 (standalone, no output);
  `ManagedSettingsController.swift` exit 0 (standalone, no output);
  `Shared/PendingAppUsageEvent.swift` exit 0 (standalone, no output);
  `GuardianDeviceActivityMonitor/DeviceActivityMonitorExtension.swift` exit 0 **when compiled
  together with `Shared/PendingAppUsageEvent.swift`** (same-target simulation; fails alone with
  `cannot find ... in scope`, expected post-extraction, needs the full Xcode target);
  `ScreenTimeModule.swift` exit 1, `error: no such module 'React'` only (needs the full
  Xcode/Pods project, same class of gap as T26's `DNSFilterModule.swift`) — isolated and
  confirmed via a stubbed `RCTEventEmitter`/`RCTPromiseResolveBlock`/`RCTPromiseRejectBlock` that
  no other error is hidden behind it, including the `override class func requiresMainQueueSetup`
  and `CFNotificationCenterAddObserver` C-callback/`Unmanaged` pointer code. `ScreenTimeModule.m`
  is Objective-C, not typecheckable by `swiftc`, needs the same full Xcode/Pods project.
  Zero TS-side impact (no `packages/domain`/`app`/`packages/backend` source touched): `npm test
  -w packages/domain` 167/167 unchanged, root `npx tsc -p tsconfig.base.json --noEmit` exit 0,
  `npx eslint . --ext .ts,.tsx` exit 0, `npm test -w app` 83/83 and `npm test -w packages/backend`
  82/82 unchanged.
- **`SETUP.md`**: filled in "Apple Developer account & FamilyControls entitlement" section (was
  `TBD`) — entitlement application process pointing at T28 for the drafted content, the human
  action being outside any ticket's scope; extended the "Xcode / CocoaPods" section (steps 7-10)
  with T27's target-creation/dual-membership steps.
- **Report reiterates human_gate explicitly (ticket's Done-when #3)**: obtaining the
  `com.apple.developer.family-controls` entitlement is a real human action (Apple Developer
  Program account + Apple's entitlement request form with business justification) outside this
  pipeline entirely — T28 drafts the application's written content, but only the human can
  enroll/submit it via their own account. This ticket's code is real and complete regardless, and
  compiles/typechecks without the entitlement (confirmed above); only *runtime* authorization is
  gated on it.
- **RISK carried forward (ticket's Done-when #4, restated)**: `.child` vs `.individual`
  authorization mode (`ScreenTimeAuthorization.swift`) is UNCONFIRMED against a real
  entitlement/device — a human must verify `.child` actually authorizes under Guardian's real
  account/pairing model the first time real testing is possible, and switch to `.individual` if
  not. Additional RISKs carried forward: no `FamilyActivityPicker` UI exists yet (blocking real
  app/site selection — future ticket); `SchedulePolicy.daysOfWeek` is not enforced by
  `DeviceActivitySchedule` (documented gap, needs monitor-extension-side weekday filtering);
  content-category shielding has no cross-taxonomy mapping to Apple's `ActivityCategoryToken`
  (DNS-layer T26 remains the iOS category-enforcement mechanism).
- **Repo-config note (reproduced, not touched)**: every new file under
  `app/ios/Guardian/ScreenTime/` is untracked *and* gitignored, same root-`.gitignore`-
  `projects`-line issue every ticket since T09 has hit.

### T28 — Compliance artifacts (COPPA/GDPR-K, Play disclosure, Apple entitlement draft, privacy policy)

- **`human_gate: true` handling — no STOP, reasoning recorded (same pattern as T26/T27)**: the
  gate is about the OUTPUTS (drafts requiring human/legal review before use, submission, or
  publication), not about whether the ticket's well-specified writing/coding task itself needed
  a blocking question. No product/behavior unknown existed; proceeded, reiterating the gate
  below per Done-when #3.
- **`docs/compliance/` (4 drafts, each with a prominent draft/human-review disclaimer at top,
  each stating it is not legal advice)**:
  - `privacy-policy-draft.md` — data collected/not-collected, COPPA/GDPR-K consent (T10),
    deletion-on-close (T10). Deliberately **does not overclaim** T10's cascade delete: states
    plainly that the `auth.users` login record is NOT deleted by the cascade (T10's own
    documented gap), rather than writing a privacy policy that would be factually false against
    the actual implementation. Dedicated camera section states exactly T25's reviewer-verified
    facts (boolean-only, no frame persisted, zero network calls, opt-in, persistent
    notification) — no aspirational/inaccurate claims (e.g. no false "encrypted"/"processed
    securely off-device" language for data that is simply never transmitted at all).
  - `play-store-disclosure.md` — in-app disclosure copy + Play Console permissions-declaration
    justification text for all 4 named features (T22 VpnService, T23 Accessibility, T24 Device
    Admin, T25 Camera) — this is the copy the 5 `// see T28` markers in
    `AndroidManifest.xml`/`strings.xml` (left by T22-T25) were waiting on. **Those manifest/
    strings.xml files were deliberately NOT edited** — wiring the copy into the native resource
    files was not requested by this ticket's Requirements (re-read: only Requirement 5's RN
    screen is "real product code" per the ticket's own text); the markers remain unresolved,
    correctly, for a future ticket to consume this doc.
  - `apple-entitlement-application-draft.md` — business-justification text for T27's
    FamilyControls entitlement + the exact 5-item (a-e) human checklist the ticket specifies
    (enroll → submit → wait weeks → provisioning profile → flip on Xcode capability), explicitly
    flagging T27's `.child`-vs-`.individual` RISK inline since it directly affects what the
    submitted justification should say.
  - `coppa-gdprk-checklist.md` — maps every named requirement to its implementing ticket/file;
    honestly notes the new disclosure screen isn't yet wired into a real permission-request flow
    (see below), not silently presented as fully closed.
- **New contract: `app/src/child/onboarding/PermissionsDisclosureScreen.tsx`** — renders all 4
  permission disclosures (copy is a faithful condensation of `play-store-disclosure.md`'s in-app
  copy — reviewer cross-checked all 4 blurbs side by side, no factual drift; keep the two in
  sync by hand if either changes, same class of dual-source-of-truth discipline as T22's
  `dnsDecision.ts`/`DnsDecision.kt`). Registered on `ChildNavigator.tsx`
  (`app/src/navigation/ChildNavigator.tsx`): added `PermissionsDisclosure: undefined` to
  `ChildStackParamList`, added to the `childScreens` array, and **changed
  `Stack.Navigator`'s `initialRouteName` from `"PairDevice"` to `"PermissionsDisclosure"`** —
  this is now the first screen shown; its "Continue" button navigates to `PairDevice`. Reviewer
  confirmed this reorder breaks nothing (`RootNavigator.tsx`/its test never assert `PairDevice`
  is the initial child screen).
- **RISK, documented not hidden (same as `coppa-gdprk-checklist.md`'s own table entry)**: no
  ticket has yet built the actual JS→native calls that would request Accessibility/VpnService/
  Device Admin/Camera permissions (confirmed by grep — zero matches for
  `VpnModule`/`AccessibilityModule`/`UsageModule`/`PresenceModule` anywhere in `app/src`), and
  `PairDeviceScreen.tsx` itself remains T11's unbuilt stub. So "shown before any of the
  Android-permission-requesting flows" is satisfied by navigation *position* (first screen in
  the stack) but not yet by an actual reachable end-to-end request flow — same "real, tested,
  but not yet reachable from a built flow" precedent T13/T21/T25 already established repeatedly.
  Future ticket building real permission-request call sites must ensure they only fire after
  this screen, not bypass it.
- **Test-writing gotcha hit and fixed during implementation (worth restating for future
  tickets)**: this repo's RTL convention requires `await render(...)`, not plain `render(...)` —
  omitting `await` fails at the first `screen.getByTestId(...)` call with "render function has
  not been called" (RTL's global `screen` singleton isn't populated synchronously). Confirmed
  against every existing screen test file's convention before fixing.
- **Verified**: `npm test -w app` — **85/85** (was 83; +2: `PermissionsDisclosureScreen.test.tsx`
  — renders-all-4-disclosures test + Continue-navigates-to-PairDevice test, both real assertions
  on rendered text/testIDs, not vacuous). `npm test -w packages/domain` 167/167 unchanged, `npm
  test -w packages/backend` 82/82 unchanged (this ticket touches no domain/backend source). Root
  `npx tsc -p tsconfig.base.json --noEmit` exit 0, `npm run typecheck -w app` exit 0, `npx eslint
  . --ext .ts,.tsx` exit 0.
- **Reviewer's independent verification (fresh context, stakes gate: 7 files)**: first-pass
  verdict **APPROVE**, no blocking findings — independently re-read all 4 docs in full,
  cross-checked the privacy-policy-draft's T10/T25 claims against those tickets' actual
  reviewer-verified LEDGER facts, confirmed `AndroidManifest.xml`/`strings.xml` untouched (mtime
  sweep), confirmed no other file outside the listed 7 was touched, re-ran the full test/
  typecheck/lint suite independently.
- **Report reiterates human_gate explicitly (ticket's Done-when #3)**: entitlement submission to
  Apple, the Play Console permissions/data-safety declaration, and legal review of the privacy
  policy before publication are all real-world actions only the human can perform — this
  ticket's documents are drafts to review/adapt/submit, not submitted filings.
- **Repo-config note (reproduced, not touched)**: `docs/compliance/` and
  `app/src/child/onboarding/` are untracked *and* gitignored — same root-`.gitignore`-
  `projects`-line issue every ticket since T09 has hit (the whole repo sits under a path
  containing the literal `projects` component, so `.gitignore:11`'s bare `projects` pattern
  matches the entire tree, not just `app/`; confirmed via `git check-ignore -v docs/compliance
  app/src/child/onboarding`).

### T29 — CI workflow + SETUP.md consolidation

- **SETUP.md sanity-check (Requirement 1)**: read all 383 original lines top to bottom. Exactly
  one literal `TBD` remained: "## Android device/emulator (for on-device verification)". Traced
  ownership before filling it (per the ticket's explicit ask to name whose gap this was): this
  heading was part of **T01's original skeleton** (`tickets/T01.md`'s exact placeholder list),
  and every later Android ticket (checked T22) explicitly scoped its own SETUP.md instruction to
  its own section only ("add exact setup steps to SETUP.md (## Java / Android SDK)" — never this
  one) — an unclaimed gap from the skeleton itself, not any single ticket's oversight. Filled
  with real content: physical-device (Developer Options/USB debugging) vs. AVD-emulator
  (`sdkmanager`/`avdmanager`/`emulator` CLI or Android Studio) setup, `adb devices`/`adb install`,
  and a note that T25's camera feature needs a physical device (most emulator images lack a
  usable front-camera feed).
- **Two found-and-fixed gaps beyond the literal TBD, both directly load-bearing for Requirement
  3's CI workflow correctness, not scope creep**:
  1. Root `package.json`'s `"lint"` script (`"npm run lint --workspaces --if-present"`,
     T01-authored) was a **silent no-op** — confirmed empirically (`npm run lint` prints nothing,
     exits 0) because no workspace defines its own `lint` script; every ticket since T01 has
     actually verified linting via a direct `npx eslint . --ext .ts,.tsx` call, never through
     `npm run lint`. Had this shipped unfixed, the new CI workflow's `npm run lint` step (the
     ticket's literal Requirement 3 command) would have passed unconditionally without ever
     linting anything. **Fixed**: changed the script body to `eslint . --ext .ts,.tsx` (one
     line). Verified: `npm run lint` now actually invokes eslint, exit 0, clean.
  2. `SETUP.md`'s "Xcode / CocoaPods" section (T27's addition, step 10) said "see the ... section
     **below**" referring to "Apple Developer account & FamilyControls entitlement" — that
     section is actually *above* it in the file. One-word fix.
- **`## Quick start` section added** (top of `SETUP.md`, before `## Node / npm`): `npm install` →
  `npm run typecheck` → `npm run lint` → `npm test`, plus the conditional `supabase start &&
  supabase db reset` step — explicitly framed as "exactly what `.github/workflows/ci.yml`
  automates" so the two stay conceptually in sync.
- **New: `/Users/aliashraf/life-os/.github/workflows/ci.yml`** (repo root, NOT
  `projects/parental-app/`) — **this is the first CI workflow anywhere in the `life-os`
  monorepo** (confirmed via `find` — no prior `.github/workflows/` existed anywhere in the tree).
  Location is a hard technical constraint, not an invented convention: the actual git repository
  root is `/Users/aliashraf/life-os` (`git rev-parse --show-toplevel`), not
  `projects/parental-app` — GitHub Actions requires workflow files under
  `<repo-root>/.github/workflows/` to be recognized at all. Path-filtered to
  `projects/parental-app/**` (+ the workflow file itself), every step scoped via
  `defaults.run.working-directory: projects/parental-app`. Runs exactly the ticket's literal
  command list: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test --workspaces
  --if-present` (the last one verified empirically to correctly fan out to all 3 workspaces —
  backend 7 suites/domain 11 suites/app 20 suites, all ran). Deliberately excludes native
  Android/iOS builds — explicit comment in the workflow file explains why (JDK+Android SDK or
  Xcode+CocoaPods provisioning is real additional CI setup, not built by this ticket). **No git
  remote is configured for `life-os`** (checked: `git remote -v` empty) — this workflow will not
  actually execute anywhere until the repo is pushed to GitHub; it exists and is syntactically
  valid, unverified as a live CI run (matches this whole project's "written for real, verification
  status reported honestly" convention from LEDGER.md's Phase-0 decision).
- **Requirement 4 (domain module coverage cross-check)**: `npx jest --listTests` (root,
  domain+backend multi-project config) — 18 files, one per named module: bucket engine
  (`buckets/__tests__/engine.test.ts`) + native-port spec
  (`buckets/__tests__/nativePortSpec.test.ts`), presence evaluator
  (`presence/__tests__/evaluator.test.ts`), schedule engine
  (`schedules/__tests__/engine.test.ts` — also covers `vacation.ts`'s `shouldAutoRestore`,
  confirmed by grep), tier gating (`tiers/__tests__/gate.test.ts` — also exercises
  `features.ts`'s `TIER_FEATURES`), content categories (`contentCategories.test.ts`), VPN/
  text-heuristic decision ports (`vpn/__tests__/dnsDecision.test.ts` +
  `vpn/__tests__/textHeuristic.test.ts`), content-blocker rules
  (`ios/__tests__/contentBlockerRules.test.ts`), plus `ageTier.test.ts` and
  `__tests__/integration.buckets-schedules.test.ts`, plus 7 `packages/backend/src/__tests__/*`
  files. **Correction to the ticket's own wording**: Requirement 4 lists "geofence evaluator" as
  a `packages/domain` module, but it actually lives in `packages/backend/src/geofence.ts` (T17)
  — confirmed by `find`, no `packages/domain/src/**/geofence*` exists. It IS tested
  (`packages/backend/src/__tests__/geofence.test.ts`, present in the same `--listTests` output)
  and correctly registered — nothing orphaned, just filed under the other workspace than the
  ticket's text implies. Every module the root Jest multi-project config is supposed to pick up
  (`packages/*/src/**/*.test.ts`) is present; nothing accidentally excluded.
- **Stakes-gate decision (documented, not skipped silently)**: final diff was 3 files
  (`package.json` 1 line, `SETUP.md` +~55 net lines, `ci.yml` 52 new lines — ~108 lines total),
  none of the pipeline's mandatory reviewer triggers fired (not >5 files, not >150 lines, no
  auth/payments/migrations/concurrency territory, not T3, no unresolved uncertainty) — reviewer
  not spawned; verified everything directly instead (every command in this entry was actually
  run, not assumed).
- **Verified**: `npm run lint` (now real) exit 0. Root `npx tsc -p tsconfig.base.json --noEmit`
  exit 0. `npm run typecheck` (workspace fan-out: backend/domain/app) all exit 0. `npm test` (full
  fan-out) — domain 167/167, backend 82/82, app 85/85, all unchanged (this ticket touches no
  product/test source). YAML validity: Python's `yaml` module wasn't installed in this
  environment, used Ruby's stdlib `YAML.load_file` as the ticket's explicitly-allowed "or
  equivalent" — `VALID YAML` confirmed, no parse errors.
- **Repo-config note**: `.github/workflows/ci.yml` is the one file this ticket added OUTSIDE
  `projects/parental-app/` (at the true git root) — unaffected by the `projects`-path-component
  `.gitignore` rule every other ticket has hit, since it doesn't live under any `projects/`
  ancestor path itself. `SETUP.md`/`package.json` are normal tracked root-level project files,
  also unaffected (same as every prior ticket's edits to those two files).

### T30 — Integration verification (LAST — verify against the original spec)

- **New: `docs/spec-traceability.md`** — the primary deliverable: every bullet in spec §3.1-§3.8,
  §4, §5, §6 mapped to implementing file(s) + verification status
  (tested-and-passing / written-but-environment-unverified / partial / not built). Full detail
  lives in that file, not duplicated here; this entry records only the headline findings, each
  independently reviewer-verified against the actual repo state (fresh context, not trusting
  prior tickets' LEDGER prose) before being accepted as fact.
- **Finding 1 — T20 was never executed.** `tickets/T20.md` (paywall/billing provisioning,
  tamper-alerts feed UI, PIN-protected settings, `TamperPolicy.autoLockUntilRestored`
  enforcement) exists as a ticket file but has no `### T20` LEDGER entry — confirmed:
  `grep "^### T" LEDGER.md` jumps T19→T21; zero `Paywall`/tamper-alert/PIN-gate files exist
  anywhere in `app/src`. This is the root cause of every "not built" status under spec §3.7 and
  the reason **no family in a real deployment can ever reach a paid tier** — T10's signup never
  provisions a `Subscription` row (T12's original RISK), and T20 was the ticket that would have
  closed that loop. **Orchestrator action needed: schedule T20.**
- **Finding 2 — every native→JS RN bridge event (T22-T25) is unconsumed, project-wide.**
  `guardianBlockAttempt`/`guardianTamperDetected`/`guardianYouTubeView`/`guardianPresenceTick`/
  `guardianSessionWarning` are all real, correctly-shaped events emitted by real (if
  environment-unverified) Kotlin — confirmed zero matches for
  `NativeEventEmitter`/`DeviceEventEmitter` anywhere in `app/src`;
  `useLocalBucketEngine.ts` hardcodes `level1Still: false`/`level2FaceSamples: []`
  unconditionally. Each origin ticket flagged its own event as an isolated accepted gap; taken
  together this means presence Levels 1-2, tamper alerts, YouTube history, and session warnings
  are all structurally disconnected from the app regardless of native-compile status.
  **Orchestrator action needed: a new ticket for the JS-side native-event consumer/merge layer.**
- **Finding 3 — `TIER_FEATURES` (T06) backend/UI gating has 5 of 11 features mismatched**
  (seam check, `packages/backend/src/policySync.ts`'s `detectGatedFeatureTouches` vs. every
  `hasFeature`/`assertFeature` call site, grep-verified): `app_blocker`/`schedules`/
  `screen_time`/`locator` have a UI gate with no (or, for `locator`, no *possible*, since T17
  built geofence CRUD as direct `supabase-js` bypassing policy-sync) backend enforcement;
  `vpn_shield` has a backend gate (`contentFilter.safeSearchEnforced`/`youtubeRestrictedMode`)
  but `ContentFilterScreen.tsx` has no UI gate/upsell. Only `usage_buckets` fully matches on both
  sides. `presence_detection`/`per_app_limits` are backend-gated for UI surfaces that don't exist
  at all (see Finding 4).
- **Finding 4 — spec's own headline differentiator #3 (presence detection) has zero
  parent-facing configuration UI, and was never assigned to any ticket.** Confirmed: no
  `PresencePolicy`/`level0Enabled`/`level1Enabled`/`level2Enabled` write-usage anywhere in
  `app/src` outside test fixtures; no `tickets/*.md` file's actual scope is a presence-settings
  screen. Also confirmed: **iOS has zero presence-detection code at all** (`app/ios/Guardian/`
  contains only `DNSFilter/` and `ScreenTime/`, no `Presence/`) — never assigned to any ticket
  either, unlike Android where the code exists (T25) but is unreachable per Finding 2.
- **Finding 5 — Layer 1 VPN (T22) breaks real device internet access as built**, reproduced from
  T22's own LEDGER entry (not new information, but re-surfaced here as the single most severe
  functional gap against spec §4, the product's namesake differentiator): TCP is entirely dropped
  while the VPN is active — "enabling this VPN breaks essentially all real HTTPS/web traffic on a
  device." T22's own entry already states "a human must resolve this before this service is ever
  enabled on a real device" — restated here as unresolved, still true.
- **Finding 6 — `BucketEngine.reconcileOffline` (T03) has zero real callers anywhere** — the only
  hit outside its own test file is a *comment* in `useLocalBucketEngine.ts` (incorrectly
  asserting the real sync path is "already built" elsewhere) — spec §5's "offline devices
  reconcile on reconnect" is implemented and unit-tested in isolation but never wired into any
  actual reconnect flow.
- **Full seam-check-4 status table** (every `RISK:`/limitation note from T23/T24/T25/T27, one
  line each) is in `docs/spec-traceability.md` — **zero of 16 tracked notes have been resolved by
  any later ticket**; none were silently dropped (all still traceable to their origin entry), all
  remain exactly as open as first flagged.
- **New test: `packages/domain/src/__tests__/integration.fullLifecycle.test.ts`** (seam check 1)
  — exercises the real, unmodified `BucketEngine` end-to-end (start → 5min/1min warnings → grace
  → grace-extended cap → end → break → two early-restart attempts confirming the break window is
  never pushed back → fresh restart once the break genuinely elapses; plus a daily-limit-
  exhaustion test), built against the exact `BucketPolicy`/`ScreenTimePolicy` shape
  `BucketsScreen.tsx`/`ScreenTimeScreen.tsx` actually save. Caught and fixed one real lint error
  during implementation (unused `SessionState` import).
- **Seam check 3 (`youtube_view` payload)**: PASS, exact field-name/order match verified by
  reading both `useYouTubeHistory.ts` (T18) and `AccessibilityModule.kt`'s `emitYouTubeView`
  (T23) directly — but the contract match is moot in practice per Finding 2 (the event carrying
  it is never consumed).
- **Environment/verification honesty audit (Requirement 4)**: every UNVERIFIED/BLOCKED-class
  claim found via grep across `LEDGER.md` has a corresponding, accurate `SETUP.md` section — no
  process gap found here (this is a genuine "checked and clean" result, not a skipped audit).
  Explicitly distinguished from Findings 1-2 above: those are decomposition/wiring gaps, not
  environment-setup gaps — `SETUP.md` was never the right place for them.
- **Small SETUP.md fix made directly** (ticket explicitly permits this): the "Supabase CLI /
  project" section never told a human to actually connect the RN app to a local instance
  (`cp app/.env.example app/.env` + real `ANON_KEY`) — added, cross-checked against
  `app/.env.example`'s real content and `app/src/supabaseClient.ts`'s actual `@env` import.
- **`npm audit`**: 33 vulnerabilities (7 moderate, 26 high) in transitive dependencies — flagged,
  not triaged/patched (no CVE-level investigation performed, out of scope for this pass).
- **Verified (Requirement 1, full output in `docs/spec-traceability.md`)**: `npm install`,
  `npm run lint` (exit 0), root `npx tsc -p tsconfig.base.json --noEmit` (exit 0), `npm run
  typecheck --workspaces --if-present` (backend/domain/app all exit 0), `npm test --workspaces
  --if-present` — backend 82/82, domain **169/169** (was 167; +2, this ticket's new test),
  app 85/85. `npx jest --listTests` (root) — 19 files (was 18; +1), every module Requirement 4
  names present and tested.
- **Reviewer's independent verification (fresh context, stakes gate: T3, `stakes: high` per
  ticket frontmatter — mandatory regardless of diff size)**: independently re-derived and
  confirmed every headline claim (A-I) above from the actual repo state — re-ran the full test
  suite (exact number match), re-ran the new integration test directly, re-read every file cited
  as evidence, confirmed spec coverage is complete (a `## §X` heading exists for every named
  section), confirmed the SETUP.md edit's accuracy, and confirmed (via `find ... -newermt`) that
  no unrelated code was fixed/built beyond this ticket's own stated scope (T20, the native
  bridge, perApp/presence UI were all correctly left untouched, reported not patched). First-pass
  verdict **CHANGES** — one blocking finding: this LEDGER entry didn't exist yet at review time
  (review runs before the pipeline's own report/ledger stage, same non-issue class T16/T21
  already hit) — added now, closing that gap. No code or documentation defect found; every
  headline claim independently checked out as accurate, not exaggerated, not fabricated.
- **Final verdict (Requirement 5's own ask, restated plainly)**: the `packages/domain` pure-logic
  layer and `packages/backend` edge functions are genuinely done and live-verified — the
  strongest, most trustworthy layer of the build. Parent-facing config UI (T12-T18) is real,
  tested, and live-verified where checkable. All Android/iOS native code (T22-T27) is real and
  complete but environment-unverified (no JVM/Apple entitlement here — `SETUP.md` gives a
  complete human path to finish verification). Not built at all: T20's entire scope, per-app
  limits UI, presence-detection settings UI, iOS presence detection, push-notification client
  registration, real GPS reporting, 30-day location auto-deletion. Structurally broken as
  shipped (not just unverified): Layer 1's VPN drops all TCP traffic while active. Systemic,
  cross-cutting gap: the native-signal pipeline (5 tickets' worth of bridge events) is
  disconnected from the app end to end.

### T20 — Parent tamper-alerts & tier/paywall UI (app/) — executed out of sequence, after T30

- **Why this appears here, not between T19 and T21**: T20 was originally skipped entirely
  (confirmed by T30's integration-verification pass — no `### T20` entry existed anywhere in
  this file, `last_ticket.md`'s history jumped T19→T21). Run now, after T30, at the user's
  explicit request following that audit finding. Appended chronologically (matching actual
  execution order, same principle every prior entry in this file follows), not inserted
  out-of-place at its ticket-number position.
- **New: `app/src/parent/tamper/useTamperAlerts.ts` + `TamperAlertsScreen.tsx`** — same
  established pattern as T16's `useInstallAlerts.ts`/`InstallAlertsScreen.tsx` (server-side
  `.in('type', ['uninstall_attempt','service_disabled'])`-filtered, `occurred_at desc`-ordered
  `device_event` feed, RLS-scoped via T07's `device_event_select_parent`), plus a
  `usePolicy`-backed toggle section for `TamperPolicy.autoLockUntilRestored`/`pinRequired`. Save
  spreads the existing `policy.tamper` object before overriding the two toggled fields
  (`{ tamper: { ...policy.tamper, autoLockUntilRestored, pinRequired } }`) — reviewer explicitly
  checked this doesn't silently zero `alertOnUninstallAttempt`/`alertOnServiceDisabled` (the
  exact class of partial-object-save bug T13/T14 warn about elsewhere in this codebase); a
  regression test asserts the full 4-field payload.
- **New: `app/src/parent/billing/PaywallScreen.tsx`** — 3-tier table `.map()`'d directly over
  T06's real `TIER_FEATURES`/`TIER_DEVICE_LIMIT` exports (reviewer-confirmed: zero hand-copied
  `Feature` literal strings anywhere outside a `FEATURE_LABEL: Record<Feature, string>` display
  map, which TS exhaustiveness forces to stay complete if the `Feature` union ever grows) — so
  the table structurally cannot drift from the actual gating logic. "Contact us to upgrade" is a
  bare `Alert.alert(...)` placeholder, no network/payment SDK call, explicitly commented as such.
- **Screen takes no props at all** (not `NativeStackScreenProps`-typed) — matches this repo's
  established convention for a route with no meaningful params (`Login`/`Dashboard`/
  `RequestsInbox`'s precedent, confirmed by reading those files), registered in `parentScreens`
  without an `as ComponentType` cast. Hit and fixed a real lint error during implementation:
  initially typed `Props` just so the test could pass fake `route`/`navigation` (matching every
  *other* screen test's convention) — this repo's eslint config has no `argsIgnorePattern` for
  underscore-prefixed unused args, so an unused `_props: Props` parameter failed
  `@typescript-eslint/no-unused-vars`. Fixed by reverting to genuinely parameterless (matching
  Login/Dashboard, not the route-param screens) and simplifying the test to `render(<PaywallScreen
  />)` with no props — the more correct fix, not a workaround.
- **`ParentNavigator.tsx`**: added `TamperAlerts: { childId: string }` route + `parentScreens`
  entry; `Paywall`'s pre-existing **type-only** forward declaration (T14, `Paywall: undefined`)
  now has a real registered screen. **Zero changes needed to the 3 files that already called
  `navigation.navigate('Paywall')`** (`BucketsScreen.tsx`/`AppManagementScreen.tsx`/
  `FamilyMapScreen.tsx`, T14/T16/T17) — confirmed unchanged (mtimes predate this diff), they now
  resolve to a real screen exactly as T14's original forward-contract comment promised.
- **Reviewer's independent verification (fresh context, stakes gate: 6 files, ~450 lines)**:
  first-pass verdict **APPROVE**, no findings — independently confirmed the server-side filter
  query, the full-payload toggle-save (the one bug class explicitly probed for), zero
  hand-copied Feature lists in `PaywallScreen.tsx`, the inert placeholder CTA, correct
  `ParentNavigator` registration (including the parameterless-vs-cast distinction), and that no
  file outside this ticket's own 6 was touched. Re-ran every verification command directly.
- **Verified**: `npm test -w app` — 22 suites, **92/92** (was 20 suites/85; +2 suites/+7 tests:
  4 `TamperAlertsScreen` tests + 3 `PaywallScreen` tests). `npm run typecheck -w app` exit 0.
  Root `npx tsc -p tsconfig.base.json --noEmit` exit 0. `npx eslint . --ext .ts,.tsx` exit 0
  (repo-wide). Full workspace fan-out: domain 169/169 unchanged, backend 82/82 unchanged — zero
  regression (this ticket touches no domain/backend source).
- **Out of scope, correctly left untouched** (per the ticket's own instruction): real payment/
  subscription processing; the native `service_disabled`/`uninstall_attempt` producers
  (T22-T24, already built) — display + policy-toggle only, as specified.
- **Still open (not this ticket's scope, restated from T30's traceability doc)**: no
  `Subscription` row is ever provisioned at signup (T12's original RISK) — so even with a real
  Paywall UI, no family can actually reach a paid tier without a human manually inserting a
  `subscription` row or a future billing-integration ticket closing that loop. `docs/
  spec-traceability.md` should be re-read with this ticket's completion in mind but was not
  regenerated by this ticket (that's T30's artifact, not re-run here).
- **Repo-config note (reproduced, not touched)**: every new file this ticket added is untracked
  *and* gitignored, same root-`.gitignore`-`projects`-line issue every ticket since T09 has hit.

