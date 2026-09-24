import { describe, expect, it } from 'vitest';
import { deriveProposedCaseLostReasonV23 } from '@/lib/whatsappCaseLostReasonV23';

describe('WhatsApp case lost reason V23', () => {
  it('never treats a raw customer question "مش موجود عندكم؟" as stock unavailability', () => {
    const result = deriveProposedCaseLostReasonV23({}, [
      { rawText: 'Customer: الصنف مش موجود عندكم؟\nYou: هراجع لحضرتك' },
    ]);
    expect(result.reason).toBeNull();
  });

  it('uses canonical product journey stock evidence for unavailable', () => {
    const result = deriveProposedCaseLostReasonV23({}, [{
      analysisJson: {
        operational: {
          productJourney: {
            journeys: [{ leakageCode: 'stock_unavailable', events: [{ stage: 'unavailable' }] }],
          },
        },
      },
    }]);
    expect(result.reason).toBe('unavailable');
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it('distinguishes rejection of an offered alternative from generic customer rejection', () => {
    const result = deriveProposedCaseLostReasonV23({}, [{
      analysisJson: {
        operational: {
          productJourney: {
            journeys: [{
              leakageCode: 'customer_rejected',
              events: [{ stage: 'alternative_offered' }, { stage: 'rejected' }],
            }],
          },
        },
      },
    }]);
    expect(result.reason).toBe('alternative_rejected');
  });

  it('uses canonical price objection when available', () => {
    const result = deriveProposedCaseLostReasonV23({}, [{
      analysisJson: {
        operational: {
          productJourney: {
            journeys: [{ leakageCode: 'price_objection', events: [{ stage: 'rejected' }] }],
          },
        },
      },
    }]);
    expect(result.reason).toBe('price_objection');
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it('keeps a conservative legacy price fallback without inventing stock status', () => {
    const result = deriveProposedCaseLostReasonV23({}, [
      { rawText: 'Customer: السعر غالي شوية' },
    ]);
    expect(result.reason).toBe('price_objection');
    expect(result.confidence).toBeLessThan(90);
  });
});
