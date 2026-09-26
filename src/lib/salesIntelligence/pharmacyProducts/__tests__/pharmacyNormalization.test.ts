import { describe, it, expect } from 'vitest';
import { normalizeBaseText, normalizePharmacyText, extractStrengths, extractPackSizes, extractDosageForms } from '../pharmacyNormalization';

describe('normalizeBaseText', () => {
  it('unifies Arabic letter variants', () => {
    expect(normalizeBaseText('أحمد إبراهيم آدم')).toBe('احمد ابراهيم ادم');
    expect(normalizeBaseText('صيدليه')).toBe('صيدليه');
    expect(normalizeBaseText('صيدلية')).toBe('صيدليه');
  });

  it('converts Arabic-Indic digits to Western digits', () => {
    expect(normalizeBaseText('زوركال٢٠')).toBe('زوركال 20');
    expect(normalizeBaseText('٣ علب')).toBe('3 علب');
  });

  it('lowercases and collapses punctuation/whitespace', () => {
    expect(normalizeBaseText('Zurcal-20/mg')).toBe('zurcal 20 mg');
    expect(normalizeBaseText('  Corega   Cream  ')).toBe('corega cream');
  });

  it('removes tashkeel', () => {
    expect(normalizeBaseText('قُرص')).toBe('قرص');
  });
});

describe('cross-form comparability (user-specified examples)', () => {
  it('makes زوركال 20 / Zurcal 20 / زوركال٢٠ / zurcal 20 mg all normalize predictably', () => {
    // The Arabic and English spellings are DIFFERENT scripts on purpose (this normalizer does not
    // transliterate — see the module's own scope note), but the Arabic-digit and spacing variants
    // of the SAME script+name collapse to the same normalized text, and the strength (20) survives
    // in every one of them, in both scripts.
    expect(normalizeBaseText('زوركال 20')).toBe(normalizeBaseText('زوركال٢٠'));
    expect(normalizeBaseText('Zurcal 20')).toBe('zurcal 20');
    expect(normalizeBaseText('zurcal 20 mg')).toBe('zurcal 20 mg');
    expect(normalizeBaseText('زوركال 20')).toContain('20');
  });

  it('never collapses Zurcal 20 and Zurcal 40 into the same normalized text', () => {
    expect(normalizeBaseText('Zurcal 20')).not.toBe(normalizeBaseText('Zurcal 40'));
  });
});

describe('extractStrengths', () => {
  it('extracts a simple mg strength', () => {
    expect(extractStrengths('zurcal 20 mg')).toEqual([{ value: 20, unit: 'mg' }]);
  });

  it('extracts Arabic unit synonyms', () => {
    expect(extractStrengths('كولشيسين 1 مجم')).toEqual([{ value: 1, unit: 'mg' }]);
  });

  it('extracts multiple strengths from a combo product', () => {
    expect(extractStrengths('suvreza 20 10 mg 30 tab')).toEqual([{ value: 10, unit: 'mg' }]);
  });

  it('does not treat a pack-size digit as a strength', () => {
    expect(extractStrengths('centrum women 30 tab')).toEqual([]);
  });

  it('does not false-positive on a substring inside a longer Arabic word', () => {
    // "مجموعه" contains no unit token as a standalone word — must not match "جم" mid-word.
    expect(extractStrengths('مجموعه كلاري')).toEqual([]);
  });
});

describe('extractPackSizes', () => {
  it('extracts an English pack size', () => {
    expect(extractPackSizes('renagel 800mg 180 tabs')).toEqual([{ count: 180, unitWord: 'tabs' }]);
  });

  it('extracts an Arabic pack size', () => {
    expect(extractPackSizes('30 قرص')).toEqual([{ count: 30, unitWord: 'قرص' }]);
  });
});

describe('extractDosageForms', () => {
  it('detects an English form keyword', () => {
    expect(extractDosageForms('esmopump 40 mg 14 tab')).toEqual(['tablet']);
  });

  it('detects an Arabic form keyword', () => {
    expect(extractDosageForms('كريم كوريغا')).toEqual(['cream']);
  });

  it('detects multiple forms when genuinely present', () => {
    const forms = extractDosageForms('spray 650 كبسول 375 30 كبسوله');
    expect(forms).toContain('spray');
    expect(forms).toContain('capsule');
  });

  it('returns empty when no dosage-form keyword is present', () => {
    expect(extractDosageForms('خيط اسنان')).toEqual([]);
  });
});

describe('normalizePharmacyText (integration)', () => {
  it('bundles normalized text with strength/form/pack facts, never dropping strength', () => {
    const result = normalizePharmacyText('Zurcal 40 mg 28 tab');
    expect(result.normalized).toBe('zurcal 40 mg 28 tab');
    expect(result.strengths).toEqual([{ value: 40, unit: 'mg' }]);
    expect(result.dosageForms).toEqual(['tablet']);
    expect(result.packSizes).toEqual([{ count: 28, unitWord: 'tab' }]);
    expect(result.raw).toBe('Zurcal 40 mg 28 tab');
  });
});
