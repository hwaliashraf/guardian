import type { VacationMode } from '../types.ts';

/**
 * Pure helper for a caller (backend cron, T09) to decide when to flip a family's
 * `VacationMode.enabled` back to `false` and persist it. Returns `true` only when vacation
 * mode is currently enabled AND has an `endDate` that has already passed relative to `now`.
 * A `null` `endDate` never auto-restores (there is no expiry to check).
 *
 * This ticket only provides the pure predicate; actually persisting the resulting write is
 * out of scope here (see T05's "Out of scope").
 */
export function shouldAutoRestore(vacation: VacationMode, now: Date): boolean {
  return vacation.enabled && vacation.endDate !== null && new Date(vacation.endDate).getTime() <= now.getTime();
}
