import { expect, it, vi } from 'vitest';

const perf = vi.hoisted(() => {
  const rows = new Map<string, number[]>();
  const time = (stage: string, fn: () => any) => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const bucket = rows.get(stage) ?? [];
      bucket.push(performance.now() - start);
      rows.set(stage, bucket);
    }
  };
  const wrap = (actual: Record<string, any>, mapping: Record<string, string>) => {
    const next = { ...actual };
    for (const [key, stage] of Object.entries(mapping)) {
      if (typeof actual[key] === 'function') next[key] = (...args: any[]) => time(stage, () => actual[key](...args));
    }
    return next;
  };
  return {
    rows,
    time,
    wrap,
    clear() { rows.clear(); },
    sums() {
      return Object.fromEntries([...rows.entries()].map(([stage, values]) => [stage, values.reduce((a, b) => a + b, 0)]));
    },
  };
});

vi.mock('../../whatsappConversationParser', async () => perf.wrap(await vi.importActual<any>('../../whatsappConversationParser'), {
  parseWhatsAppExport: 'source_parse', splitWhatsAppSessions: 'session_split',
}));
vi.mock('../../whatsappConversationUnderstandingV32', async () => perf.wrap(await vi.importActual<any>('../../whatsappConversationUnderstandingV32'), {
  buildConversationUnderstandingV32: 'conversation_understanding',
}));
vi.mock('../conversationCaseEngine', async () => perf.wrap(await vi.importActual<any>('../conversationCaseEngine'), {
  deriveConversationCases: 'case_segmentation',
}));
vi.mock('../caseBasketEngine', async () => perf.wrap(await vi.importActual<any>('../caseBasketEngine'), {
  buildCaseBaskets: 'basket_derivation',
}));
vi.mock('../customerNeedModel', async () => perf.wrap(await vi.importActual<any>('../customerNeedModel'), {
  deriveCustomerNeedModel: 'customer_need',
}));
vi.mock('../commercialConfirmationEngine', async () => perf.wrap(await vi.importActual<any>('../commercialConfirmationEngine'), {
  deriveCommercialConfirmationState: 'commercial_confirmation',
  deriveOrderConfirmationProtocolApplicability: 'commercial_confirmation',
  assessOrderConfirmationProtocol: 'commercial_confirmation',
}));
vi.mock('../unavailableDemandEngine', async () => perf.wrap(await vi.importActual<any>('../unavailableDemandEngine'), {
  deriveUnavailableDemand: 'unavailable_demand',
}));
vi.mock('../historicalCommercialClosureEngine', async () => perf.wrap(await vi.importActual<any>('../historicalCommercialClosureEngine'), {
  deriveHistoricalCommercialClosureAssessment: 'historical_closure',
}));
vi.mock('../saleAttributionEngine', async () => perf.wrap(await vi.importActual<any>('../saleAttributionEngine'), {
  deriveSaleAttributionAssessment: 'invoice_attribution',
}));
vi.mock('../basketInvoiceMatchingEngine', async () => perf.wrap(await vi.importActual<any>('../basketInvoiceMatchingEngine'), {
  resolveActiveBasket: 'active_basket', deriveBasketInvoiceMatch: 'invoice_match',
}));
vi.mock('../financialSettlementEngine', async () => perf.wrap(await vi.importActual<any>('../financialSettlementEngine'), {
  deriveFinancialSettlementAssessment: 'financial_settlement',
}));
vi.mock('../salesIntegrityEngine', async () => perf.wrap(await vi.importActual<any>('../salesIntegrityEngine'), {
  deriveSalesIntegrityAssessment: 'sales_integrity',
}));
vi.mock('../saleProofState', async () => perf.wrap(await vi.importActual<any>('../saleProofState'), {
  deriveSaleProofState: 'sale_proof',
}));
vi.mock('../canonicalSalesOutcomeEngine', async () => perf.wrap(await vi.importActual<any>('../canonicalSalesOutcomeEngine'), {
  deriveCanonicalSalesOutcome: 'canonical_outcome',
}));
vi.mock('../commercialJourneyStateMachine', async () => perf.wrap(await vi.importActual<any>('../commercialJourneyStateMachine'), {
  deriveCommercialJourneyState: 'journey',
}));
vi.mock('../lostOpportunityEngine', async () => perf.wrap(await vi.importActual<any>('../lostOpportunityEngine'), {
  deriveLostOpportunity: 'lost_opportunity',
}));
vi.mock('../followUpOpportunityEngine', async () => perf.wrap(await vi.importActual<any>('../followUpOpportunityEngine'), {
  deriveFollowUpOpportunities: 'followup_projection',
}));
vi.mock('../caseOperationalDispositionEngine', async () => perf.wrap(await vi.importActual<any>('../caseOperationalDispositionEngine'), {
  deriveCaseOperationalDisposition: 'operational_disposition',
}));
vi.mock('../caseIntelligenceView', async () => perf.wrap(await vi.importActual<any>('../caseIntelligenceView'), {
  buildCaseIntelligenceView: 'case_view',
}));
vi.mock('../pharmacyProducts/pharmacyProductResolverV2', async () => perf.wrap(await vi.importActual<any>('../pharmacyProducts/pharmacyProductResolverV2'), {
  resolveProductMention: 'product_resolution',
}));

import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../conversationEvaluation';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';

const RAW = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة بانادول اكسترا\n[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:\n2 علبة بانادول اكسترا\nإجمالي الحساب 180 جنيه\nهل الطلب كده كامل؟\n[9/15/26, 9:02:00 AM] Customer: تمام\n[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب`;

const productIndex = buildPharmacyProductIndex([{
  productId: 'p-panadol', productCode: 'PAN-EXTRA', barcode: null,
  canonicalName: 'Panadol Extra', arabicName: null, englishName: 'Panadol Extra',
  normalizedNames: ['panadol extra'], strengths: [], dosageForms: [], packSizes: [],
  category: null, manufacturer: null, price: 90, sourceTable: 'synthetic',
  qualityFlags: { hasNormalizedNameCollision: false, missingStrength: true, missingDosageForm: true, missingAnyQuantitySignal: true },
}]);

function input() {
  return {
    conversationId: 'perf-stage-source', rawWhatsAppExportText: RAW,
    resolveInvoiceCandidates: () => [], customerIdHint: 'customer-perf', customerIdentityStatus: 'resolved' as const,
    branchNameRawHint: 'فرع شكري', productIndex,
  };
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0;
}

it('measures the real analysis engines stage-by-stage without changing runtime behavior', () => {
  for (let i = 0; i < 5; i += 1) runSalesIntelligencePipeline(input());

  const samples = new Map<string, number[]>();
  let firstColdMs = 0;
  for (let i = 0; i < 40; i += 1) {
    perf.clear();
    const start = performance.now();
    const result = runSalesIntelligencePipeline(input());
    const total = performance.now() - start;
    if (i === 0) firstColdMs = total;
    const sums = perf.sums();
    for (const [stage, value] of Object.entries(sums)) {
      const bucket = samples.get(stage) ?? [];
      bucket.push(value as number);
      samples.set(stage, bucket);
    }
    const view = result.caseAnalyses[0]?.caseIntelligence;
    expect(view).toBeTruthy();
    const evalStart = performance.now();
    analyzeConversationEvaluation(view!, null);
    const evalBucket = samples.get('evaluation_projection') ?? [];
    evalBucket.push(performance.now() - evalStart);
    samples.set('evaluation_projection', evalBucket);
    const totalBucket = samples.get('full_pipeline_total') ?? [];
    totalBucket.push(total);
    samples.set('full_pipeline_total', totalBucket);
  }

  const summary = Object.fromEntries([...samples.entries()].map(([stage, values]) => [stage, {
    samples: values.length,
    medianMs: Number(percentile(values, 0.5).toFixed(4)),
    p95Ms: Number(percentile(values, 0.95).toFixed(4)),
    maxMs: Number(Math.max(...values).toFixed(4)),
  }]));
  const top3 = [...samples.entries()]
    .filter(([stage]) => !['full_pipeline_total', 'evaluation_projection'].includes(stage))
    .map(([stage, values]) => ({ stage, medianMs: percentile(values, 0.5) }))
    .sort((a, b) => b.medianMs - a.medianMs)
    .slice(0, 3)
    .map((row) => ({ ...row, medianMs: Number(row.medianMs.toFixed(4)) }));

  const required = ['source_parse', 'session_split', 'conversation_understanding', 'case_segmentation', 'basket_derivation', 'customer_need', 'product_resolution', 'invoice_attribution', 'invoice_match', 'financial_settlement', 'sales_integrity', 'sale_proof', 'canonical_outcome', 'journey', 'lost_opportunity', 'followup_projection', 'case_view', 'evaluation_projection'];
  for (const stage of required) expect(summary[stage], `missing timing stage ${stage}`).toBeTruthy();
  console.log('ANALYSIS_STAGE_TIMING', JSON.stringify({ model: 'Node22 synthetic canonical conversation; 5 warmups + 40 measured runs; not Production latency', firstColdMs: Number(firstColdMs.toFixed(4)), top3, stages: summary }));
});
