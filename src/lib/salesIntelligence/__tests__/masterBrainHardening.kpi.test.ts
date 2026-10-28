// KPI population regressions: a staff member's conversion is computed over every case they
// handled, not only cases already credited to them (synthetic facts only).
import { describe, expect, it } from 'vitest';
import { summarizeCanonicalWhatsappKpis, staffKpiPopulation, type CanonicalKpiCase } from '../canonicalKpiReadModel';
import { canonicalDoctorImpact } from '../canonicalKpiAdapters';

function fact(caseId: string, overrides: Partial<CanonicalKpiCase> & { outcome?: string } = {}): CanonicalKpiCase {
  const { outcome = 'open_opportunity', ...rest } = overrides;
  const sale = outcome === 'sale_proven';
  return {
    caseId,
    startedAt: '2026-10-05T10:00:00.000Z',
    branch: 'فرع شكري',
    customerId: 'cust',
    caseType: 'sales_opportunity',
    truth: {
      caseId, analysisId: 'a', pipelineVersion: 'v', availability: 'analyzed',
      outcome: { outcome, saleProofState: sale ? 'proven' : 'unknown', isSaleCountable: sale, isRevenueCountable: sale, isOrderConfirmed: sale, needsHumanReview: false, reasonCodes: [] },
      attribution: null,
      ledger: { state: sale ? 'proven' : 'not_proven', v22CaseId: null, invoiceId: null, invoiceNumber: null, revenue: sale ? 100 : null, saleAt: null, proofAnalysisId: null, proofPipelineVersion: null, reconciledAt: null, revokedAt: null, revokeReason: null },
    } as any,
    view: {} as any,
    saleCountable: sale,
    revenueCountable: sale,
    revenue: sale ? 100 : null,
    staffAttributionAvailable: true,
    creditedStaffId: null,
    creditedStaffName: null,
    participants: [],
    lost: false,
    evidenceAvailable: true,
    ...rest,
  } as CanonicalKpiCase;
}

const A = 'doctor-A';
const FACTS = [
  fact('won', { outcome: 'sale_proven', creditedStaffId: A, participants: [{ staffId: A, sender: 'A' }] }),
  fact('open-1', { participants: [{ staffId: A, sender: 'A' }] }),
  fact('open-2', { participants: [{ staffId: A, sender: 'A' }] }),
  fact('other-closer', { outcome: 'sale_proven', creditedStaffId: 'doctor-B', participants: [{ staffId: A, sender: 'A' }, { staffId: 'doctor-B', sender: 'B' }] }),
  fact('not-hers', { participants: [{ staffId: 'doctor-B', sender: 'B' }] }),
];

describe('KPI: staff population is not filtered by credit', () => {
  it('includes every case the staff member handled, excludes cases closed by another', () => {
    expect(staffKpiPopulation(FACTS, A).map((f) => f.caseId)).toEqual(['won', 'open-1', 'open-2']);
  });

  it('conversion counts unconverted handled cases in the denominator (no artificial 100%)', () => {
    const summary = summarizeCanonicalWhatsappKpis(FACTS, A);
    expect(summary.sales).toBe(1);
    expect(summary.revenue).toBe(100);
    expect(summary.conversion.eligibleCases).toBe(3);
    expect(summary.conversion.conversionRatePercent).toBe(33);
  });

  it('a proven sale with no credited closer is pending attribution, not a miss or a sale', () => {
    const facts = [...FACTS, fact('uncredited-sale', { outcome: 'sale_proven', participants: [{ staffId: A, sender: 'A' }] })];
    const summary = summarizeCanonicalWhatsappKpis(facts, A);
    expect(summary.sales).toBe(1);
    expect(summary.conversion.eligibleCases).toBe(3);
    expect(summary.conversion.pendingEvidenceCases).toBe(1);
    expect(canonicalDoctorImpact(facts, A, '2026-09-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z')?.commercial_conversations).toBeNull();
  });

  it('doctor impact reports handled commercial conversations once ownership is resolved', () => {
    const impact = canonicalDoctorImpact(FACTS, A, '2026-09-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');
    expect(impact?.commercial_conversations).toBe(3);
    expect(impact?.conversion_sale_count).toBe(1);
  });

  it('the all-staff summary is unchanged by the staff population rule', () => {
    const summary = summarizeCanonicalWhatsappKpis(FACTS);
    expect(summary.cases).toBe(5);
    expect(summary.sales).toBe(2);
  });
});
