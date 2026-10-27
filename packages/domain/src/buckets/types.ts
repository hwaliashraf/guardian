// State shapes for the Usage Buckets engine (spec §5). Kept separate from the top-level
// packages/domain/src/types.ts (which holds policy/config shapes) since these are runtime
// session/usage state, not stored policy configuration.

export interface SessionState {
  categoryId: string;
  startedAt: string; // ISO timestamp; fixed for the lifetime of this session object
  elapsedMinutes: number;
  graceUsed: boolean; // true once the one-time +3min grace finish has been consumed
  warnings5MinFired: boolean;
  warnings1MinFired: boolean;
}

export interface BreakState {
  categoryId: string;
  startedAt: string; // ISO timestamp; when the mandatory break lock-out began
  requiredMinutes: number;
}

export interface DailyUsageState {
  date: string; // ISO date (YYYY-MM-DD), the day this usage state applies to
  perCategoryMinutesUsed: Record<string, number>;
  perCategorySessionCount: Record<string, number>;
  totalMinutesUsed: number;
}
