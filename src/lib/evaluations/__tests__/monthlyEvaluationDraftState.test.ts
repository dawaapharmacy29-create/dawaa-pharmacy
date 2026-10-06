import { describe, expect, it } from 'vitest';
import { monthlyEvaluationDraftFingerprint } from '@/lib/evaluations/monthlyEvaluationDraftState';

const base = {
  sections: [{ key: 'discipline', score: 3, notes: 'ملاحظة' }],
  strengthsText: 'نقطة قوة',
  developmentText: 'خطة تطوير',
  managerNotes: '',
  activeGates: [] as string[],
};

describe('monthly evaluation dirty fingerprint', () => {
  it('changes when a score, note, feedback, manager note, or critical gate changes', () => {
    const fingerprint = monthlyEvaluationDraftFingerprint(base);
    expect(monthlyEvaluationDraftFingerprint({ ...base, sections: [{ ...base.sections[0], score: 4 }] })).not.toBe(fingerprint);
    expect(monthlyEvaluationDraftFingerprint({ ...base, sections: [{ ...base.sections[0], notes: 'ملاحظة أخرى' }] })).not.toBe(fingerprint);
    expect(monthlyEvaluationDraftFingerprint({ ...base, strengthsText: 'قوة أخرى' })).not.toBe(fingerprint);
    expect(monthlyEvaluationDraftFingerprint({ ...base, developmentText: 'خطة أخرى' })).not.toBe(fingerprint);
    expect(monthlyEvaluationDraftFingerprint({ ...base, managerNotes: 'سبب موثق' })).not.toBe(fingerprint);
    expect(monthlyEvaluationDraftFingerprint({ ...base, activeGates: ['medical_error'] })).not.toBe(fingerprint);
  });

  it('ignores feedback line whitespace that is normalized by save', () => {
    expect(monthlyEvaluationDraftFingerprint({ ...base, strengthsText: '  نقطة قوة  \n\n' }))
      .toBe(monthlyEvaluationDraftFingerprint(base));
  });

  it('does not become dirty only because section or gate ordering changed', () => {
    const state = {
      ...base,
      sections: [
        { key: 'sales_quality', score: 4, notes: '' },
        { key: 'discipline', score: 3, notes: 'ملاحظة' },
      ],
      activeGates: ['b', 'a'],
    };
    expect(monthlyEvaluationDraftFingerprint(state)).toBe(monthlyEvaluationDraftFingerprint({
      ...state,
      sections: [...state.sections].reverse(),
      activeGates: ['a', 'b'],
    }));
  });
});
