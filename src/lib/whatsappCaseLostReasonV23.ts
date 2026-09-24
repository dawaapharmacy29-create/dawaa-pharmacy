export type CaseLostReasonV23 =
  | 'unavailable'
  | 'price_objection'
  | 'alternative_rejected'
  | 'not_interested'
  | null;

export type CaseLostReasonSourceV23 = {
  rawText?: string | null;
  analysisJson?: any;
};

export type CaseLostReasonResultV23 = {
  reason: CaseLostReasonV23;
  confidence: number | null;
};

const LEGACY_PRICE_RX = /(غالي|غالية|السعر عالي|السعر غالي|كتير عليا|كتير علي|أرخص|ارخص)/i;

function journeysFromSource(source: CaseLostReasonSourceV23): any[] {
  const journeys = source.analysisJson?.operational?.productJourney?.journeys;
  return Array.isArray(journeys) ? journeys : [];
}

function eventStages(journey: any): Set<string> {
  return new Set(
    Array.isArray(journey?.events)
      ? journey.events.map((event: any) => String(event?.stage || '')).filter(Boolean)
      : []
  );
}

export function deriveProposedCaseLostReasonV23(
  _caseItem: any,
  sources: CaseLostReasonSourceV23[]
): CaseLostReasonResultV23 {
  const journeys = sources.flatMap(journeysFromSource);

  // Canonical Product Journey is the source of truth. Never infer stock unavailability merely
  // because a customer's raw question contains "مش موجود؟".
  if (journeys.some((journey) => String(journey?.leakageCode || '') === 'stock_unavailable')) {
    return { reason: 'unavailable', confidence: 95 };
  }

  if (journeys.some((journey) => String(journey?.leakageCode || '') === 'price_objection')) {
    return { reason: 'price_objection', confidence: 93 };
  }

  const rejectedAlternative = journeys.some((journey) => {
    const stages = eventStages(journey);
    return stages.has('alternative_offered') && stages.has('rejected');
  });
  if (rejectedAlternative) return { reason: 'alternative_rejected', confidence: 92 };

  const explicitCustomerRejected = journeys.some((journey) =>
    String(journey?.leakageCode || '') === 'customer_rejected'
  );
  if (explicitCustomerRejected) return { reason: 'not_interested', confidence: 88 };

  // Legacy fallback is intentionally limited to price language. Stock status has no safe raw-text
  // fallback because exports mix customer questions and pharmacy replies in one blob.
  const rawText = sources.map((source) => String(source.rawText || '')).join('\n');
  if (LEGACY_PRICE_RX.test(rawText)) return { reason: 'price_objection', confidence: 72 };

  return { reason: null, confidence: null };
}
