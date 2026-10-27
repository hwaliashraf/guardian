import { deriveAgeTier } from './ageTier';

describe('deriveAgeTier', () => {
  const asOf = new Date('2026-07-10T00:00:00.000Z');

  it('classifies under-8 as young', () => {
    expect(deriveAgeTier('2020-01-01', asOf)).toBe('young'); // age 6
    expect(deriveAgeTier('2018-07-11', asOf)).toBe('young'); // age 7, birthday tomorrow
  });

  it('classifies 8-12 as preteen', () => {
    expect(deriveAgeTier('2018-07-10', asOf)).toBe('preteen'); // exactly 8 today
    expect(deriveAgeTier('2014-01-01', asOf)).toBe('preteen'); // age 12
  });

  it('classifies 13+ as teen', () => {
    expect(deriveAgeTier('2013-07-10', asOf)).toBe('teen'); // exactly 13 today
    expect(deriveAgeTier('2000-01-01', asOf)).toBe('teen'); // age 26
  });

  it('handles a birthday that has not occurred yet this year', () => {
    // Turns 13 on 2026-12-01; as of July, still 12 -> preteen.
    expect(deriveAgeTier('2013-12-01', asOf)).toBe('preteen');
  });

  it('defaults asOf to now when not provided', () => {
    const result = deriveAgeTier('2000-01-01');
    expect(result).toBe('teen');
  });
});
