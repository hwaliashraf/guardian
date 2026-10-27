import { CONTENT_CATEGORIES, getAgeBasedPreset } from './contentCategories';

describe('CONTENT_CATEGORIES', () => {
  test('has at least 30 entries', () => {
    expect(CONTENT_CATEGORIES.length).toBeGreaterThanOrEqual(30);
  });

  test('has no duplicate ids', () => {
    const ids = CONTENT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('covers every spec-named example (adult, porn, violence, gambling, advertisements, social, games)', () => {
    const ids = new Set(CONTENT_CATEGORIES.map((c) => c.id));
    expect(ids.has('adult')).toBe(true);
    expect(ids.has('pornography')).toBe(true);
    expect(ids.has('violence')).toBe(true);
    expect(ids.has('gambling')).toBe(true);
    expect(ids.has('advertisements')).toBe(true);
    expect(ids.has('social_media')).toBe(true);
    expect(ids.has('gaming')).toBe(true);
  });

  test('every entry has a non-empty id and label', () => {
    for (const category of CONTENT_CATEGORIES) {
      expect(category.id.length).toBeGreaterThan(0);
      expect(category.label.length).toBeGreaterThan(0);
    }
  });
});

describe('getAgeBasedPreset', () => {
  test('blocks every category listed in defaultBlockedFor for the given tier', () => {
    const preset = getAgeBasedPreset('young');
    for (const category of CONTENT_CATEGORIES) {
      expect(preset[category.id]).toBe(category.defaultBlockedFor.includes('young') ? 'block' : 'allow');
    }
  });

  test('always-safety-critical categories are blocked at every tier', () => {
    for (const tier of ['young', 'preteen', 'teen'] as const) {
      const preset = getAgeBasedPreset(tier);
      expect(preset.pornography).toBe('block');
      expect(preset.drugs).toBe('block');
      expect(preset.malware_phishing).toBe('block');
    }
  });

  test('teen preset allows ordinary browsing categories blocked for young', () => {
    const young = getAgeBasedPreset('young');
    const teen = getAgeBasedPreset('teen');
    expect(young.social_media).toBe('block');
    expect(teen.social_media).toBe('allow');
  });

  test('preset covers exactly the CONTENT_CATEGORIES id set, no more, no less', () => {
    const preset = getAgeBasedPreset('preteen');
    expect(Object.keys(preset).sort()).toEqual(CONTENT_CATEGORIES.map((c) => c.id).sort());
  });
});
