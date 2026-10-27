---
description: Run the full ticket pipeline — understand, plan, implement, verify
---

Execute this ticket through the pipeline: $ARGUMENTS

Your value is discipline, not brilliance. Never skip a stage; thin is allowed, absent is not.

## 0 · Triage (no tools)
Classify: **T1** trivial (one-line, obvious location) / **T2** standard (bounded, ≤5 files) / **T3** complex (cross-cutting, ambiguous). State class + why. Unsure → higher class. T1: stages 1–2 become one sentence each; verify stays full.

## 1 · Understand — no code changes allowed
0. **Preconditions & ledger:** if the ticket has a `preconditions:` block, verify each one NOW (they're commands or file checks). Any unmet → STOP, report which, do nothing else. If `LEDGER.md` exists in repo root, read it — contracts, decisions, and risk flags from prior tickets bind you like the ticket itself.
1. Restate the ticket in one paragraph: what, for whom, why.
2. Locate relevant code (grep/glob first, read matched regions only). Bugs: find the **root cause**, state the chain trigger → mechanism → symptom.
3. List unknowns. Resolvable by reading code → resolve now. Needs human judgment (behavior choice, product intent, destructive ops) → **STOP and ask**, one batched question set. Never guess silently.
   **Human-gate rule:** if the ticket is blocked on something only the human may do (a sign-off, a verdict, an approval), STOP and ask. Proceed only on explicit delegation — and record the exchange (question + answer) in the final report. Mid-run human decisions that don't appear in the report make the audit trail lie.
4. Write numbered acceptance criteria to `SCRATCH.md` — each must be *checkable* (a command, an observable behavior, or a fact about the diff). Criteria are frozen; only the human changes them.

## 2 · Plan + pre-verification
1. 2–3 candidate approaches, one line each. Pick the smallest diff satisfying all criteria; say why others lose.
2. **Seam check** (before choosing where code goes): search the repo for every capability this ticket needs, by *what it does* — not by the name you'd give it. For each: reuse it · extend it (parameterize the difference) · or state why neither is possible. Anything on the shared-by-nature list (persistence · external I/O · auth · config/secrets · logging · serialization/validation · time/IDs/randomness · error mapping · money/units/dates · multi-feature domain rules) is built in the repo's shared location at first use, named for the capability. Name the module that owns this change and what it may touch.
3. **Commit plan:** the ordered list of commit subjects you will produce, each one logical change, each buildable alone (move/rename → behavior → tests → docs). One commit for the whole ticket is a plan only when the ticket is genuinely one change.
4. **Before coding**, write the verification plan: exact commands (tests/lint/typecheck/build) + edge cases you'll check by reading the diff.
5. >5 files or auth/payments/migrations/concurrency territory → note "stakes review will apply."
6. Append plan (seam + commits + verification) to SCRATCH.md.

## 3 · Implement
Match repo conventions (find an example first). Smallest diff. Unrelated debt → SCRATCH.md "Noticed, not touched," don't fix. Run the fastest relevant check after each coherent unit — fail fast. No stubs presented as done.
Names carry the explanation: no comment describing *what* code does — rename or split instead. A *why* comment only when it names an external cause (ticket ref, spec clause, measured result, upstream defect). Never fork a near-copy of something that exists; extend it. Pre-existing duplication you notice → "Noticed, not touched," not a refactor.
Commit as planned in stage 2, one logical change at a time, checks green before each. Stage explicit paths, never `git add -A`. Plan changed mid-run → the report says so.

## 4 · Verify — hostile mode
You are now a reviewer who believes this diff is wrong.
1. Re-read the **original ticket** + SCRATCH.md criteria (not your plan — plans drift, tickets are truth).
2. Run every verification command. A failing check is never "unrelated" until proven.
3. Read the full diff line by line: empty/null/huge/concurrent inputs? other callers?
4. **Design check** — each answer needs a diff line or command behind it: no *what*-comment added · no logic an existing util already covers · nothing on the shared-by-nature list written locally instead of in the shared location · no unrelated responsibility added to a file · no module reached into another's internals · no abstraction with a single caller · external-input loops have a stated expected size.
5. **Commit check** — `git log --oneline <base>..HEAD` matches the stage-2 plan; each commit is one logical change; no commit mixes refactor with behavior; each builds (spot-check the riskiest with a checkout or reasoned diff read).
6. Check off each criterion: `#N: PASS — <evidence>`. Any FAIL → back to stage 3.
7. Feeling a pull toward "should work" / "mostly done" → that's a FAIL signal, not a report line.
8. **Stakes gate** — spawn the `reviewer` agent (fresh context: ticket + criteria + diff only) if ANY: diff >150 lines or >5 files · touches auth/payments/migrations/public API/concurrency · unresolved uncertainty · class T3. CHANGES verdict loops to stage 3 once; second CHANGES on same issue → escalate.

## 5 · Report (short)
What changed + why (2–4 sentences) · criteria checklist with evidence · `commits:` the `git log --oneline` list, plus any deviation from the stage-2 commit plan · reuse note: what you reused or extended, and anything new you put in a shared location · **human decisions obtained mid-run (question + answer, verbatim)** · NOT done + why · risks · "Noticed, not touched." Clear SCRATCH.md.
**Ledger append:** add to `LEDGER.md` under `## <ticket-id>`: contracts created/changed (signatures, formats, config keys) · decisions downstream tickets must honor · risk flags for future tickets · delegations received. Terse — the ledger is read by every future session; every word costs forever.

## Escalate instead of continuing when ANY:
architecture decision constraining >3 modules · same criterion failed twice · criteria can't be made checkable · security/data-loss sensitive beyond the ticket's stated scope · you'd be inventing domain patterns the codebase doesn't demonstrate.
Escalation is a structured handoff, never a raw ticket: `trigger / understood / attempted (with evidence) / decision needed (with options)`.
