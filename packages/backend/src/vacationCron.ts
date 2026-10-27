// T09: pure vacation-auto-restore selection logic. No I/O — importable by both the Jest suite
// (packages/backend/src/__tests__/vacationCron.test.ts) and the Deno edge function
// (packages/backend/supabase/functions/vacation-cron/index.ts), same dual-runtime pattern T08
// established for policySync.ts (see that file's header comment for the full rationale).
//
// Reuses T05's `shouldAutoRestore` pure predicate (imported directly by relative path, bypassing
// the packages/domain barrel — same reasoning as policySync.ts's tiers/gate.ts import: the
// barrel transitively pulls in zod via schemas.ts, which Deno can't resolve without an import
// map) and T08's `buildNextPolicyVersion` (the ticket's own explicit ask: "reuses T08's
// policy-write-and-notify path — import its pure module rather than duplicating logic"). As a
// direct, minimal, mechanical, behavior-preserving consequence (same class of edit T08 made to
// tiers/gate.ts and tiers/features.ts), `packages/domain/src/schedules/vacation.ts`'s own
// internal `'../types'` import was given an explicit `.ts` extension — it was not previously
// imported outside packages/domain's own Node/Jest world, so it never needed Deno-resolvable
// imports until now. T05's test suite was re-verified unchanged after this edit (see LEDGER.md).
import type { Policy } from '../../domain/src/types.ts';
import { shouldAutoRestore } from '../../domain/src/schedules/vacation.ts';
import { buildNextPolicyVersion, type PushDispatchPayload } from './policySync.ts';

/** Every `Policy` (already resolved to each child's active/latest version) whose vacation mode
 * has an end date that has passed relative to `now` — these are the ones that should auto-restore. */
export function selectVacationsToRestore(policies: Policy[], now: Date): Policy[] {
  return policies.filter((policy) => shouldAutoRestore(policy.vacation, now));
}

/** Flips vacation.enabled off and bumps version, leaving every other field untouched — reuses
 * T08's `buildNextPolicyVersion` rather than duplicating the version-bump/merge logic. */
export function buildVacationRestoreUpdate(current: Policy): Policy {
  return buildNextPolicyVersion(current, { vacation: { ...current.vacation, enabled: false } });
}

export function buildVacationRestorePushPayload(childId: string): PushDispatchPayload {
  return {
    title: 'Vacation mode ended',
    body: "Your family's vacation mode has ended — normal rules are back in effect.",
    data: { type: 'vacation_restored', childId },
    priority: 'normal',
  };
}
