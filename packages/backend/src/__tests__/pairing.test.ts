import {
  generatePairingCode,
  pairingCodeExpiresAt,
  validatePairingCode,
  PAIRING_CODE_TTL_MINUTES,
  type PairingCodeRecord,
} from '../pairing';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function baseRecord(overrides: Partial<PairingCodeRecord> = {}): PairingCodeRecord {
  return {
    code: '123456',
    childId: 'child-1',
    expiresAt: pairingCodeExpiresAt(NOW),
    consumedAt: null,
    ...overrides,
  };
}

describe('generatePairingCode', () => {
  it('returns a 6-digit zero-padded numeric string', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generatePairingCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('is not deterministic across calls (sanity check, not a statistical proof)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generatePairingCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('pairingCodeExpiresAt', () => {
  it('defaults to now + 10 minutes', () => {
    expect(PAIRING_CODE_TTL_MINUTES).toBe(10);
    expect(pairingCodeExpiresAt(NOW)).toBe('2026-07-15T12:10:00.000Z');
  });

  it('honors a custom TTL', () => {
    expect(pairingCodeExpiresAt(NOW, 5)).toBe('2026-07-15T12:05:00.000Z');
  });
});

describe('validatePairingCode', () => {
  it('accepts a fresh, unconsumed, unexpired record', () => {
    const record = baseRecord();
    expect(validatePairingCode(record, NOW)).toEqual({ valid: true });
  });

  it('rejects with not_found when no record matched the submitted code', () => {
    expect(validatePairingCode(null, NOW)).toEqual({ valid: false, reason: 'not_found' });
  });

  it('rejects an expired code', () => {
    const record = baseRecord({ expiresAt: '2026-07-15T11:59:59.000Z' });
    expect(validatePairingCode(record, NOW)).toEqual({ valid: false, reason: 'expired' });
  });

  it('treats the exact expiry instant as already expired (inclusive boundary)', () => {
    const record = baseRecord({ expiresAt: NOW.toISOString() });
    expect(validatePairingCode(record, NOW)).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects an already-consumed code (one-time use)', () => {
    const record = baseRecord({ consumedAt: '2026-07-15T11:55:00.000Z' });
    expect(validatePairingCode(record, NOW)).toEqual({ valid: false, reason: 'consumed' });
  });

  it('consumed takes precedence over expired when both are true', () => {
    const record = baseRecord({
      expiresAt: '2026-07-15T11:50:00.000Z',
      consumedAt: '2026-07-15T11:55:00.000Z',
    });
    expect(validatePairingCode(record, NOW)).toEqual({ valid: false, reason: 'consumed' });
  });
});
