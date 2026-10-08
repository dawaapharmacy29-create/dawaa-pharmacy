import { describe, expect, it } from 'vitest';
import {
  deriveDoctorPerformanceActions,
  describeSourceError,
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
    workedHours: 1, salesPerHour: 1, invoicesPerHour: 1, customersPerHour: 1, conversations: 1, convertedConversations: 1, conversionRate: 100,
    coverage: 'available', confidence: 'high', coverageReason: '', comparisonEligible: true, comparisonMode: 'full_cycle', comparisonReason: '',
    comparisonSnapshot: null, salesIdentity: 'canonical', salesSourceAvailable: true, attendanceSourceAvailable: true, conversationSourceAvailable: true,
    salesEvidenceCount: 1, attendanceEvidenceCount: 1, conversationEvidenceCount: 1, customerImpact: impact, diagnoses,
  };
}

describe('doctor performance eye source errors', () => {
  it('keeps no error as null so available sources are not flagged', () => {
    expect(describeSourceError(null, 'المبيعات')).toBe(null);
  });

  it('names a statement timeout explicitly instead of a vague unavailable label', () => {
    expect(describeSourceError({ code: '57014', message: 'canceling statement due to statement timeout' }, 'المبيعات')).toContain('57014');
    expect(describeSourceError({ code: '57014', message: 'canceling statement due to statement timeout' }, 'المبيعات')).toContain('انتهت مهلة');
  });

  it('distinguishes a scope denial from an outage', () => {
    expect(describeSourceError({ code: '42501', message: 'staff_sales_branch_scope_denied' }, 'المبيعات')).toContain('staff_sales_branch_scope_denied');
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
