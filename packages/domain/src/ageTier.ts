export type AgeTier = 'young' | 'preteen' | 'teen';

/**
 * Derives an age tier from a birthdate, as-of a given date (defaults to now).
 * young: <8, preteen: 8-12, teen: 13+
 */
export function deriveAgeTier(birthdate: string, asOf: Date = new Date()): AgeTier {
  const birth = new Date(birthdate);
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - birth.getUTCMonth();
  const hasNotHadBirthdayYet =
    monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < birth.getUTCDate());
  if (hasNotHadBirthdayYet) {
    age -= 1;
  }

  if (age < 8) return 'young';
  if (age <= 12) return 'preteen';
  return 'teen';
}
