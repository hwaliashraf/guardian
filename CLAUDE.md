# Working rules (loaded every session — kept minimal on purpose)

For any ticket/task, run the `/ticket` pipeline. Small requests still get its verify stage.

## Standards (non-negotiable)

- Repo convention beats your preference. Find an in-repo example before inventing a pattern.
- Smallest diff that satisfies the requirement. No drive-by refactors, speculative abstraction, or unrequested features.
- Errors: handle at boundaries, propagate with context. Never swallow.
- New deps are an escalation decision, not a convenience.
- New behavior gets a test in the repo's style; bug fixes get a test that fails without the fix.
- No TODO/stub code presented as done. Unfinished work is reported, not hidden.
- No secrets in code/logs; parameterize queries; validate at trust boundaries.

## Design

- **One implementation per objective.** Before writing a function, search for the capability by *what it does*, not by what you'd name it. Exists → call it. Exists but doesn't fit → extend it, parameterize the difference; never fork a near-copy. Two functions serving one objective is a defect — different names, different signatures, and different modules do not make it two objectives.
- **Shared-by-nature code is built shared at first use** — no rule-of-three for: data/persistence access · external I/O (HTTP, filesystem, queues, shell) · auth & permissions · config & secrets access · logging/telemetry · serialization & schema validation · time, IDs, randomness · error types & mapping · money/units/date math · any domain rule more than one feature will ask about. First use goes in the repo's shared location, named for the capability (`formatCurrency`), not for the caller (`formatCartTotal`). Nobody reaches around it afterward: no raw query beside the repository layer, no bare `fetch` beside the client.
- **Shape is not duplication.** Blocks that merely look alike stay duplicated until the third, and then only if they share an objective. A one-caller helper extracted from a loop is not reuse; wrapping a single call site "for later" is not reuse.
- **The test, when it's unclear:** would a second feature need *this exact behavior*, or just something shaped like it? Exact behavior → build it shared now. Shaped like it → leave it duplicated.
- **Name is the doc.** Intention-revealing names, one responsibility per unit, early returns over nesting. The urge to write an explanatory comment is a design signal: rename or split instead.
- **Comments:** never *what*. A *why* comment is allowed only when it names an external cause — a ticket/bug reference, a spec clause, a measured result, a known upstream defect. Repo-conventional docstrings on public APIs stay. No TODOs, no commented-out code.
- **Boundaries.** New behavior goes in the module that owns the concern; a file about to gain a second unrelated responsibility gets split instead. Cross-module calls use declared entry points, never internals.
- **Stated limits.** Anything iterating over external input states its expected size in the report. O(n²) over unbounded input is a defect, not a tradeoff.
- **Pre-existing duplication** goes to "Noticed, not touched" plus a LEDGER risk flag; you fix it only if the ticket already touches that code. If making a shared capability fit requires a signature change across >3 modules, escalate — that is not a ticket-time decision.
- **Precedence:** requirement > repo convention > these rules > your taste. Smallest diff beats architecture you weren't asked for — except on the shared-by-nature list, where first use builds the seam.

## Commits

- One logical change per commit. If the subject needs an "and", it is two commits.
- Every commit builds and passes what was green before it. No knowingly broken intermediate states.
- Commit at each coherent unit, not once at the end: move/rename → behavior → tests → docs. Refactor and behavior change never share a commit.
- Subject: `<scope>: <imperative, ≤72 chars>`. Body only when the *why* isn't visible in the diff.
- Stage explicit paths. Never `git add -A` — unrelated working-tree drift stays out of the commit.
- Commit at the cadence the ticket or pipeline sets, or when asked. Never push, amend, or rebase anything the human may have seen without permission.

## Economy

- Search → skim → read narrowly. Never whole-file reads to find one function. Never re-read what's in context.
- Surgical edits, never full-file regeneration for small changes.
- Terse plans and reports. No preamble, no restating inputs.

## Honesty

Done = evidence (command output or diff line) per claim. "Should work" is banned. Report uncertainty as uncertainty — an honest "unverified" is success; hidden doubt is the worst failure.
