// T10: pure pairing-code generation + expiry/consumption logic. No I/O — importable by both the
// Jest suite (packages/backend/src/__tests__/pairing.test.ts) and the Deno edge function
// (packages/backend/supabase/functions/auth-flows/index.ts), same dual-runtime-pure-module
// pattern T08/T09 established (see policySync.ts's header comment for the full rationale).
//
// Uses the Web Crypto `crypto.getRandomValues` global (NOT Node's `crypto`/`node:crypto`
// module) deliberately: importing the Node builtin breaks the root `npx tsc -p
// tsconfig.base.json --noEmit` sweep (TS2591 — that config has no `"types": ["node"]`; same
// constraint T04/T07 documented for `node:crypto`/bare `process`). `crypto.getRandomValues` is a
// Web Standard global available under both ts-jest/Node and Deno with zero import statement, and
// was empirically confirmed to typecheck under the root sweep too — so, unlike T04's `event.id`
// workaround, this gets a real CSPRNG rather than a `Math.random()` fallback.

export const PAIRING_CODE_TTL_MINUTES = 10;

export interface PairingCodeRecord {
  code: string;
  childId: string;
  expiresAt: string; // ISO
  consumedAt: string | null;
}

/**
 * 6-digit numeric code, zero-padded. Modulo bias from `% 1_000_000` is negligible for a
 * human-facing OTP-style code (not a cryptographic key) that is already bounded by a 10-minute
 * TTL and one-time consumption; the DB layer additionally enforces uniqueness among
 * simultaneously-active codes (see 0005_pairing.sql's partial unique index).
 */
export function generatePairingCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

export function pairingCodeExpiresAt(
  now: Date,
  ttlMinutes: number = PAIRING_CODE_TTL_MINUTES,
): string {
  return new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
}

export type PairingCodeRejectionReason = 'not_found' | 'expired' | 'consumed';
export type PairingCodeValidation = { valid: true } | { valid: false; reason: PairingCodeRejectionReason };

/**
 * Pure validation only — does not mutate `record` or touch the DB. Callers fetch the row
 * themselves (or pass `null` when no row matched the submitted code at all) and are responsible
 * for persisting consumption; see auth-flows/index.ts's pair-device handler for the atomic
 * DB-level claim that actually enforces one-time-use under concurrency (this function alone
 * cannot, since it never reads or writes the database).
 */
export function validatePairingCode(
  record: PairingCodeRecord | null,
  now: Date,
): PairingCodeValidation {
  if (!record) return { valid: false, reason: 'not_found' };
  if (record.consumedAt !== null) return { valid: false, reason: 'consumed' };
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true };
}
