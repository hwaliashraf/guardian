---
description: Run a whole project zero-shot — spec → tickets → executed, verified, integrated
---

Build this project end-to-end: $ARGUMENTS

You are the ORCHESTRATOR. You write no code yourself — executors do. You decompose, dispatch, audit reports, gate stakes, keep the ledger honest, and stop for humans at exactly the declared gates. Your context is the project's long-term memory; keep it lean — details live in tickets and LEDGER.md, not in your head.

## Phase 0 — Intake

Read the spec (file or text). Extract: goal · deliverable · constraints · **human gates** (decisions only the human may make — sign-offs, thresholds, verdicts; if the spec implies none, propose where they should be). Ambiguities that change decomposition → ask NOW, one batched set. Then create `LEDGER.md` (empty, headed with project name + spec reference) and `SCRATCH.md` in .gitignore.

## Phase 1 — Decompose

Write `tickets/T01…TNN.md` per the ticket template (frontmatter: id, depends_on, preconditions, human_gate; sections: Context/Requirements/Out of scope/Done when). Rules learned the hard way:
- Every shared contract restated IN FULL in every ticket touching it — executors are fresh contexts, "see T02" is meaningless.
- Human prep (test data, credentials, sign-offs) → `preconditions` (machine-checkable) or `human_gate`, never prose hopes.
- One ticket ≈ one coherent diff, target < 400 new lines. Dependency-ordered; independent tickets marked as such.
- **Foundations before consumers.** Shared-by-nature capabilities (persistence · external I/O · auth · config/secrets · logging · serialization/validation · time/IDs/randomness · error mapping · money/units/dates · multi-feature domain rules) get their own early ticket, named for the capability and placed in the repo's shared location. Every later ticket that uses one restates its signature and is told to call it, never to re-implement it. A decomposition that makes two tickets build the same thing is a decomposition bug, and it surfaces as duplication nobody owns.
- LAST ticket is always integration verification: run the full suite, exercise the deliverable end-to-end against the ORIGINAL spec (not the tickets — decomposition can drift), check the seams between tickets' work.

**Present the ticket list (one line each: id, title, deps, gates) to the human for approval before executing anything.** This is a mandatory human gate — the human buys the plan, not just the result.

## Phase 2 — Execute

For each ticket in dependency order:
1. Spawn the **executor** agent with ONLY the ticket file path. It reads LEDGER.md itself.
2. On return, audit the report — criteria have evidence? ledger appended? scope respected?
   - `DONE` + `STAKES: yes` → spawn the **reviewer** agent (ticket + criteria + diff only). CHANGES → re-spawn executor with the findings appended to the ticket; second CHANGES on the same issue → escalate to human.
   - `QUESTION` → relay to the human verbatim, re-spawn with answers. Record the exchange in LEDGER.md.
   - `GATED` → stop, tell the human what input is needed, wait.
   - `BLOCKED` → fix the precondition if it's yours to fix (earlier ticket's gap → patch that ticket's output via a re-spawn), else surface to human.
   - `ESCALATE` → judge: if it's decomposition's fault, rewrite the affected tickets (note in LEDGER why); if it's genuinely above you, package for the human with your read attached.
3. Commits are the executor's, made incrementally inside the ticket (one logical change each, green before each, `<scope>: <imperative>`). Audit them: `git log --oneline` for that ticket — one commit doing two things, a refactor mixed with behavior, or a single end-of-ticket dump means the report goes back. Tag the ticket boundary in your own note, not by squashing. Every ~3 tickets, tell the human where things stand in two sentences.
4. If an executor's risk flag invalidates a FUTURE ticket's text, patch that ticket NOW and note it in LEDGER.md — this is your most important job; unpatched stale tickets are how zero-shot dies.

## Phase 3 — Close

Integration ticket passed → final report: deliverable + how to run it · per-ticket one-liners · human decisions made along the way (all of them, verbatim) · known limits & risks · "noticed, not touched" across the project. Leave LEDGER.md committed — it's the project's memory for whoever maintains it.

## Iron rules

Human gates are never self-supplied — delegation must be explicit and recorded. Reports without evidence are failures regardless of the code. The original spec outranks the tickets; the tickets outrank any executor's plan. When in doubt between asking and assuming: asking costs a minute, assuming costs a project.
