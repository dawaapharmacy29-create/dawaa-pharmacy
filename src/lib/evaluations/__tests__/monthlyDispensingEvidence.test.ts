import { describe, expect, it } from 'vitest';
import {
  DISPENSING_STRENGTH_MIN_AVERAGE,
  DISPENSING_STRENGTH_MIN_SAMPLES,
  hasStrongDispensingEvidence,
} from '@/lib/evaluations/monthlyDispensingEvidence';

describe('monthly dispensing strength evidence gate', () => {
  it('does not treat a strong manager rating as enough when conversation evidence is only acceptable', () => {
    expect(hasStrongDispensingEvidence({
      consultation: { average: 8.4, samples: 5 },
      dosage: { average: 9.2, samples: 5 },
      medicalErrors: 0,
      badAlternativeCases: 0,
    })).toBe(false);
  });

  it('requires a sufficient sample for both consultation and dosage evidence', () => {
    expect(hasStrongDispensingEvidence({
      consultation: { average: 9.1, samples: DISPENSING_STRENGTH_MIN_SAMPLES - 1 },
      dosage: { average: 9.4, samples: 6 },
      medicalErrors: 0,
      badAlternativeCases: 0,
    })).toBe(false);
  });

  it('rejects documented medical or bad-alternative safety flags', () => {
    const strongDimensions = {
      consultation: { average: 9.1, samples: 4 },
      dosage: { average: 9.3, samples: 4 },
    };

    expect(hasStrongDispensingEvidence({
      ...strongDimensions,
      medicalErrors: 1,
      badAlternativeCases: 0,
    })).toBe(false);

    expect(hasStrongDispensingEvidence({
      ...strongDimensions,
      medicalErrors: 0,
      badAlternativeCases: 1,
    })).toBe(false);
  });

  it('accepts dispensing guidance strength only when both evidence dimensions are strong and repeated', () => {
    expect(hasStrongDispensingEvidence({
      consultation: { average: DISPENSING_STRENGTH_MIN_AVERAGE, samples: DISPENSING_STRENGTH_MIN_SAMPLES },
      dosage: { average: 9.2, samples: 5 },
      medicalErrors: 0,
      badAlternativeCases: 0,
    })).toBe(true);
  });
});
