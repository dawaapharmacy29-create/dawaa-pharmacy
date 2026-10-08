import { describe, expect, it } from 'vitest';
import { describeSourceProblem } from '@/lib/evaluations/decisionSourceState';
import { cairoDayOf } from '@/lib/time/cairoDateBoundary';
import {
  deriveDoctorPerformanceActions,
  sourceStateOf,
  diagnoseMonth,
  aggregateImpactEvidence,
  type DoctorPerformanceDiagnosis,
  type DoctorPerformanceMonth,
} from '@/lib/evaluations/doctorPerformanceIntelligenceService';

const impact = {
  available: true, commercialConversations: 12, verifiedSaleConversations: 2, verifiedRevenue: 900, verifiedConversionRate: 16.7,
  followupsNeeded: 4, complaints: 0, saleLeakage: 3, unavailableProducts: 1, acceptedProducts: 0,
};

function month(diagnoses: DoctorPerformanceDiagnosis[]): DoctorPerformanceMonth {
  return {
    cycleLabel: '2026-10', displayLabel: '', sales: 1, invoices: 1, customers: 1, averageInvoice: 1,
    workedHours: 1, salesPerHour: 1, invoicesPerHour: 1, customersPerHour: 1, conversations: 1, convertedConversations: 1, conversionRate: 100, conversionRecorded: 1, unverifiedConversions: 0, attendanceDetail: null, hoursComplete: true, hoursNote: null, salesDays: 30, salesPresentDays: 20,
    coverage: 'available', confidence: 'high', coverageReason: '', comparisonEligible: true, comparisonMode: 'full_cycle', comparisonReason: '',
    comparisonSnapshot: null, salesIdentity: 'canonical', salesSourceAvailable: true, attendanceSourceAvailable: true, conversationSourceAvailable: true,
    salesEvidenceCount: 1, attendanceEvidenceCount: 1, conversationEvidenceCount: 1, customerImpact: impact, diagnoses,
  };
}

describe('doctor performance eye source states', () => {
  const quiet = { warn: () => undefined, error: () => undefined };
  it('keeps an available source free of any reason or diagnostic', () => {
    expect(sourceStateOf(null)).toEqual({ state: 'available', reason: null, diagnostic: null });
  });

  it('names a statement timeout in plain language and keeps the code only in the diagnostic', () => {
    const s = sourceStateOf(describeSourceProblem({ code: '57014', message: 'canceling statement due to statement timeout' }, 'المبيعات', 'sales', quiet));
    expect(s.state).toBe('failed');
    expect(s.reason).toContain('انتهت مهلة');
    expect(s.reason.includes('57014')).toBe(false);
    expect(s.diagnostic.code).toBe('57014');
  });

  it('distinguishes a scope denial from an outage without echoing the SQL message', () => {
    const s = sourceStateOf(describeSourceProblem({ code: '42501', message: 'staff_sales_branch_scope_denied' }, 'المبيعات', 'sales', quiet));
    expect(s.reason).toContain('صلاحية');
    expect(s.reason.includes('staff_sales_branch_scope_denied')).toBe(false);
    expect(s.diagnostic.message).toBe('staff_sales_branch_scope_denied');
  });

  it('separates a not-yet-enabled endpoint and a loaded source with too little evidence', () => {
    expect(sourceStateOf(describeSourceProblem({ code: 'PGRST202', message: 'Could not find the function' }, 'المحادثات', 'conversations', quiet)).state).toBe('not_enabled');
    expect(sourceStateOf(null, 'لا توجد بيانات أثر عملاء لهذه الفترة بعد.').state).toBe('insufficient');
  });
});

describe('doctor performance eye actions', () => {
  it('derives no action without a diagnosis that calls for one', () => {
    expect(deriveDoctorPerformanceActions(month([{ kind: 'data_quality', severity: 'positive', title: 'ok', detail: '', evidence: [] }])).length).toBe(0);
  });

  it('orders problems first, links drill-down focus, and caps the list', () => {
    const actions = deriveDoctorPerformanceActions(month([
      { kind: 'customer_impact', severity: 'positive', title: 'a', detail: '', evidence: [] },
      { kind: 'customer_impact', severity: 'watch', title: 'b', detail: '', evidence: [] },
      { kind: 'conversion', severity: 'attention', title: 'c', detail: '', evidence: [] },
      { kind: 'opportunity', severity: 'attention', title: 'd', detail: '', evidence: [] },
      { kind: 'efficiency', severity: 'attention', title: 'e', detail: '', evidence: [] },
      { kind: 'sales_trend', severity: 'attention', title: 'f', detail: '', evidence: [] },
    ]));
    expect(actions.length).toBe(4);
    expect(actions[0].focus).toBe('conversion');
    expect(actions[0].owner).toBe('doctor');
    expect(actions[1].focus).toBe('opportunity');
  });

  it('asks to restore sources before judging when evidence is blocked', () => {
    const actions = deriveDoctorPerformanceActions(month([{ kind: 'data_quality', severity: 'watch', title: 'x', detail: '', evidence: [] }]));
    expect(actions.length).toBe(1);
    expect(actions[0].owner).toBe('manager');
  });
});


describe('customer impact evidence is not fabricated from missing cycle rows', () => {
  it('does not turn a successful empty lookup into zero sales or zero complaints', () => {
    const result = aggregateImpactEvidence([], true);
    expect(result.available).toBe(false);
    expect(result.commercialConversations).toBeNull();
    expect(result.verifiedSaleConversations).toBeNull();
    expect(result.complaints).toBeNull();
  });

  it('preserves genuine zero counts when a canonical cycle row exists', () => {
    const result = aggregateImpactEvidence([{ commercial_conversations: 0, verified_sale_conversations: 0, complaint_conversations: 0 }], true);
    expect(result.available).toBe(true);
    expect(result.commercialConversations).toBe(0);
    expect(result.complaints).toBe(0);
  });
});

describe('doctor performance eye — Cairo days and fair claims (final review)', () => {
  it('buckets conversation timestamps on the Cairo calendar day, not UTC', () => {
    // 01:30 Cairo on 26 Oct is still 25 Oct in UTC; it belongs to the cycle starting 26 Oct.
    expect(cairoDayOf('2026-10-25T22:30:00Z')).toBe('2026-10-26');
    expect(cairoDayOf('2026-10-25T20:30:00Z')).toBe('2026-10-25');
    expect(cairoDayOf('2026-10-26')).toBe('2026-10-26');
    expect(cairoDayOf(null)).toBe(null);
    expect(cairoDayOf('not a date')).toBe(null);
  });

  it('claims "no negative signal" only after a fair comparison with complete customer-impact evidence', () => {
    const calm = { ...impact, commercialConversations: 2, verifiedConversionRate: 60, saleLeakage: 0, unavailableProducts: 0, acceptedProducts: 0 };
    const cur = { ...month([]), customerImpact: calm };
    const NO_SIGNAL = 'لا توجد إشارة سلبية قوية';
    expect(diagnoseMonth(cur, null).some(d => d.title === NO_SIGNAL)).toBe(false);
    expect(diagnoseMonth(cur, { ...month([]), comparisonEligible: false }).some(d => d.title === NO_SIGNAL)).toBe(false);
    expect(diagnoseMonth({ ...cur, customerImpact: { ...calm, available: false } }, month([])).some(d => d.title === NO_SIGNAL)).toBe(false);
    expect(diagnoseMonth(cur, { ...month([]), customerImpact: calm }).some(d => d.title === NO_SIGNAL)).toBe(true);
  });
});
