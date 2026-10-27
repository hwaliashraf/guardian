---
id: BUG-001
title: "CI: lint-typecheck-test fails at the Test step — app/.env doesn't exist on a fresh checkout"
discovered: 2026-07-29
status: fixed (2026-07-29, commit 714c09b)
severity: high (CI is red on every push/PR)
run: https://github.com/hwaliashraf/guardian/actions/runs/30464832562
job: https://github.com/hwaliashraf/guardian/actions/runs/30464832562/job/90619846884
commit: ff9f3f091ac0e5b8e183f6977fd4e403516c9d12
---

# BUG-001 — CI Test step fails: `app/.env` missing on a fresh checkout

## Error

`Guardian CI` / `lint-typecheck-test` — steps `Install dependencies`, `Lint`, and `Typecheck`
all passed; step `Test` failed, exit code 1.

`gh`/API access to the raw log text was unavailable in this environment (`gh` isn't installed,
and `GET /repos/.../actions/jobs/{id}/logs` returned `403 Must have admin rights to Repository`
for an unauthenticated request even though the repo is public) — the job/step **statuses** were
readable via the unauthenticated Actions API
(`GET /repos/hwaliashraf/guardian/actions/runs/30464832562/jobs`), which is how the failing step
was identified before reproducing the actual error locally (see Investigation).

Reproduced locally (fresh clone, `npm ci`, `npm test --workspaces --if-present` — the exact
sequence `.github/workflows/ci.yml` runs):

```
FAIL src/navigation/__tests__/RootNavigator.test.tsx
  ● Test suite failed to run

    Jest encountered an unexpected token
    ...
    SyntaxError: .../app/src/supabaseClient.ts: "SUPABASE_ANON_KEY" is not defined in .env
      1 | import { createClient } from '@supabase/supabase-js';
    > 2 | import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@env';
        |          ^^^^^^^^^^^^^^^^^
      3 |
      4 | // Thin wrapper around @supabase/supabase-js ...

      at PluginPass.ImportDeclaration (../node_modules/react-native-dotenv/index.js:137:53)
      ...
      at Object.require (src/navigation/__tests__/RootNavigator.test.tsx:2:1)

Test Suites: 20 failed, 2 passed, 22 total
Tests:       5 passed, 5 total
```

20 of the `app` workspace's 22 test suites fail to even parse/transform — every file that
transitively imports `app/src/supabaseClient.ts` (which is most of the parent/child screens,
since they import hooks that import the Supabase client).

## Investigation

- `npm ci`, `Lint`, and `Typecheck` all pass — this is purely a `Test`-step failure, and only in
  the `app` workspace (`packages/domain` and `packages/backend`'s suites are unaffected, since
  neither imports `app/src/supabaseClient.ts`).
- `app/src/supabaseClient.ts` reads `SUPABASE_URL`/`SUPABASE_ANON_KEY` from the `@env` module,
  which is resolved at build/transform time by the `react-native-dotenv` babel plugin
  (`app/babel.config.js`) from a real `app/.env` file on disk.
- `app/.env` is (correctly) listed in `.gitignore` — it's the kind of file that should never be
  committed (in a real deployment it would carry a real project's `SUPABASE_ANON_KEY`, not the
  placeholder this template ships). `app/.env.example` *is* committed, and `SETUP.md`'s "Quick
  start" / "Supabase CLI / project" sections both document `cp app/.env.example app/.env` as a
  manual local-dev setup step.
- **Root cause**: nothing before the `Test` step in `.github/workflows/ci.yml` creates
  `app/.env`. A human running the documented local setup always has this file (created once,
  gitignored, persists on disk); a fresh CI checkout never does. `react-native-dotenv` treats a
  named import from `@env` that can't be resolved from a real `.env` file as a hard babel-parse
  error, not a runtime `undefined` — so this doesn't fail gracefully, it fails to transform the
  file at all, which is why the failure looks like a syntax error rather than a missing-env-var
  runtime error.
- **Confirmed by reproduction**: `cp app/.env.example app/.env` then re-running the identical
  `npm test --workspaces --if-present` command → all three workspaces pass (backend 82/82,
  domain 169/169, app 92/92 — exact match to what's verified locally in normal dev use, and to
  what was verified before this repo was pushed). This isolates the fix to exactly the missing
  file; nothing else needed changing.
- This is a **CI-setup gap, not a test-correctness bug** — the tests themselves (and the app
  code) are fine; the placeholder values in `app/.env.example` are sufficient for lint/typecheck/
  test (nothing in the suite makes a real network call to Supabase — see `LEDGER.md`'s repeated
  "these are pure decision-logic tests, no I/O" notes for `packages/backend`, and `app`'s screen
  tests all mock their data hooks, e.g. `jest.mock('../usePolicy')`). A real `SUPABASE_ANON_KEY`
  is never required for this workflow to pass.

## Solution

Add a step to `.github/workflows/ci.yml`, before `Test` (after `Install dependencies` is fine,
since it doesn't depend on install; must be before `Test`, since that's the step that needs it —
`Typecheck`/`Lint` don't transform `app/`'s babel-processed source the way Jest does, so they
don't need this):

```yaml
      - name: Create app/.env for CI (placeholder values — no test makes a real Supabase call)
        run: cp app/.env.example app/.env

      - name: Test
        run: npm test --workspaces --if-present
```

No other change is needed. Verified locally (fresh clone, `npm ci`, this exact step, then the
existing `Test` step) — all 336 tests pass, matching the pre-push baseline exactly.

**Applied** (commit `714c09b`, via the `/ticket` pipeline): added the `Create app/.env for CI`
step to `.github/workflows/ci.yml` exactly as above. Re-verified by cloning the fixed commit
into a fresh, isolated directory and replicating every CI step in order (`npm ci` → `Lint` →
`Typecheck` → `Create app/.env for CI` → `Test`) — all pass, matching the known-good baseline
exactly (backend 82/82, domain 169/169, app 92/92).
