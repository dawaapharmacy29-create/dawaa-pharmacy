import { describe, expect, it } from 'vitest';
import {
  classifySampleQuality,
  deriveLostReasonCodes,
  detectCommercialFrictionFactsV26,
  detectDeepJourneyStages,
  evaluateMedicalHardGate,
  summarizeResponseMetrics,
} from '../whatsappDeepConversationIntelligenceV26';

describe('whatsappDeepConversationIntelligenceV26', () => {
  it('calculates response percentiles and unanswered turns', () => {
    const result = summarizeResponseMetrics([
      { response_latency_seconds: 60, no_response: false },
      { response_latency_seconds: 120, no_response: false },
      { response_latency_seconds: 600, no_response: false },
      { response_latency_seconds: 1200, no_response: false },
      { response_latency_seconds: null, no_response: true },
    ]);
    expect(result.count).toBe(4);
    expect(result.averageSeconds).toBe(495);
    expect(result.medianSeconds).toBe(120);
    expect(result.p90Seconds).toBe(1200);
    expect(result.p95Seconds).toBe(1200);
    expect(result.over10Minutes).toBe(1);
    expect(result.unanswered).toBe(1);
  });

  it('keeps doctor sample quality conservative', () => {
    expect(classifySampleQuality(2).quality).toBe('insufficient');
    expect(classifySampleQuality(7).quality).toBe('limited');
    expect(classifySampleQuality(19).quality).toBe('usable');
    expect(classifySampleQuality(20).quality).toBe('strong');
  });

  it('detects consultation, objection and upsell with evidence', () => {
    const result = detectDeepJourneyStages([
      { id: 'm1', direction: 'inbound', text: 'الطفل عنده كحة والدواء مناسب؟' },
      { id: 'm2', direction: 'inbound', text: 'بس السعر غالي شوية' },
      { id: 'm3', direction: 'outbound', text: 'تحب نضيف معاه المنتج المكمل؟' },
    ]);
    expect(result.find((x) => x.stage === 'consultation')?.detected).toBe(true);
    expect(result.find((x) => x.stage === 'objection')?.evidenceMessageIds).toContain('m2');
    expect(result.find((x) => x.stage === 'upsell')?.evidenceMessageIds).toContain('m3');
  });

  it('forces pharmacist review for medical hard-gate triggers', () => {
    const result = evaluateMedicalHardGate([
      { text: 'طفل عمره 5 سنين' },
      { text: 'ياخد 5 مل مرتين يوميا' },
    ]);
    expect(result.blocked).toBe(true);
    expect(result.requiresPharmacistReview).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('returns explicit lost-sale reason codes instead of one generic loss flag', () => {
    const result = deriveLostReasonCodes({
      stockout: true,
      alternativeOffered: false,
      priceObjection: true,
      sold: false,
      followupPromised: true,
      followupCompleted: false,
      upsellDetected: false,
      salesEligible: true,
      p90ResponseSeconds: 900,
      unanswered: 1,
    });
    expect(result).toContain('stockout_dead_end');
    expect(result).toContain('price_objection_unhandled');
    expect(result).toContain('no_close');
    expect(result).toContain('no_followup');
    expect(result).toContain('slow_response');
    expect(result).toContain('unanswered_customer');
  });
  it('does not infer stockout from a customer availability question', () => {
    const facts = detectCommercialFrictionFactsV26([
      { direction: 'inbound', text: 'الصنف مش موجود عندكم؟' },
      { direction: 'outbound', text: 'هراجع لحضرتك يا فندم' },
    ]);
    expect(facts.stockout).toBe(false);
  });

  it('detects stockout only from pharmacy-side evidence', () => {
    const facts = detectCommercialFrictionFactsV26([
      { direction: 'inbound', text: 'الصنف موجود؟' },
      { direction: 'outbound', text: 'للأسف مش موجود حاليا' },
    ]);
    expect(facts.stockout).toBe(true);
  });

  it('keeps price objection customer-side and alternative offer pharmacy-side', () => {
    const facts = detectCommercialFrictionFactsV26([
      { direction: 'outbound', text: 'ممكن أرشح لحضرتك بديل' },
      { direction: 'inbound', text: 'السعر غالي شوية' },
    ]);
    expect(facts.alternativeOffered).toBe(true);
    expect(facts.priceObjection).toBe(true);
  });

  it('labels chat closure separately from invoice-proven sale semantics', () => {
    const facts = detectCommercialFrictionFactsV26([
      { direction: 'outbound', text: 'تم تأكيد الأوردر وجاري الإرسال' },
    ]);
    expect(facts.chatClosed).toBe(true);
  });

});
