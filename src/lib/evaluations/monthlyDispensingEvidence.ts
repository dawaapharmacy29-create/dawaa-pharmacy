export const DISPENSING_STRENGTH_MIN_AVERAGE = 8.5;
export const DISPENSING_STRENGTH_MIN_SAMPLES = 3;

type DispensingEvidenceDimension = {
  average: number;
  samples: number;
} | null | undefined;

export type DispensingStrengthEvidenceInput = {
  consultation: DispensingEvidenceDimension;
  dosage: DispensingEvidenceDimension;
  medicalErrors?: number | null;
  badAlternativeCases?: number | null;
};

/**
 * A manager score of 4/5 or 5/5 is not evidence by itself.
 * Automatic dispensing/guidance strengths require strong, repeated conversation evidence
 * for both consultation quality and dosage explanation, with no documented safety flags.
 */
export function hasStrongDispensingEvidence(input: DispensingStrengthEvidenceInput) {
  const consultation = input.consultation;
  const dosage = input.dosage;

  if (!consultation || !dosage) return false;
  if (Number(input.medicalErrors || 0) > 0) return false;
  if (Number(input.badAlternativeCases || 0) > 0) return false;

  return (
    consultation.samples >= DISPENSING_STRENGTH_MIN_SAMPLES
    && dosage.samples >= DISPENSING_STRENGTH_MIN_SAMPLES
    && consultation.average >= DISPENSING_STRENGTH_MIN_AVERAGE
    && dosage.average >= DISPENSING_STRENGTH_MIN_AVERAGE
  );
}
