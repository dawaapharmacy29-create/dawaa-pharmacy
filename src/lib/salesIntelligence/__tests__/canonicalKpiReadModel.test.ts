import { describe, it, expect } from 'vitest';
import {
  loadCanonicalWhatsappKpis,
  projectCanonicalKpiCase,
  summarizeCanonicalWhatsappKpis,
} from '../canonicalKpiReadModel';
import { canonicalOpportunityProjection, canonicalDoctorImpact } from '../canonicalKpiAdapters';
import { createInMemorySupabase } from '../qa/__tests__/inMemorySupabase.testkit';
import { mapSaleState } from '../../whatsappConversationJourneyClassifier';
import { buildUnifiedConversationIntelligence } from '../../whatsappUnifiedIntelligenceV4';
import { parseWhatsAppExport, splitWhatsAppSessions } from '../../whatsappConversationParser';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { aggregateImpactEvidence } from '../../evaluations/doctorPerformanceIntelligenceService';

function fixture(id: string, overrides: Record<string, any> = {}) {
  const view = {
    version: 'case-intelligence-v3',
    caseId: id,
    staff: {
      participants: [{ staffId: 'doctor-A', sender: 'Doctor A' }],
      facts: [
        {
          fact: 'confirmed_order',
          staffId: 'doctor-A',
          staffSender: 'Doctor A',
          messageId: 'close',
        },
      ],
    },
    need: { products: [] },
    lostOpportunity: { state: 'open', reason: null },
    followUp: { opportunities: [] },
    interaction: { caseType: 'sales_opportunity' },
  };
  const analysis = {
    case_id: id,
    analysis_id: `a-${id}`,
    case_started_at: '2026-09-27T10:00:00Z',
    case_type: 'sales_opportunity',
    identity_customer_id: 'customer',
    identity_branch_name_raw: 'شكري',
    evidence_snapshot: {
      caseIntelligence: view,
      canonicalSalesOutcome: {
        caseId: id,
        outcome: 'sale_proven',
        saleProofState: 'proven',
        isSaleCountable: true,
        isRevenueCountable: true,
      },
    },
  };
  const envelope = { case_id: id, source_case_id_v22: `v-${id}` };
  const ledger = {
    id: `v-${id}`,
    verified_invoice_id: `invoice-${id}`,
    verified_revenue: 100,
    case_json: { canonicalSaleProof: { state: 'proven', salesCaseId: id, analysisId: `a-${id}` } },
  };
  const attribution = {
    case_id: id,
    analysis_id: `a-${id}`,
    is_official_for_staff_evaluation: true,
  };
  Object.assign(analysis, overrides);
  return { analysis, envelope, ledger, attribution, view };
}
const project = (x: ReturnType<typeof fixture>) =>
  projectCanonicalKpiCase(x.analysis, x.envelope, x.ledger, x.attribution);
const scope = { start: '2026-09-26T00:00:00Z', endExclusive: '2026-10-26T00:00:00Z' };

describe('one official WhatsApp KPI truth', () => {
  it('invoice proof alone never creates a conversation sale or revenue', () => {
    const x = fixture('proof');
    Object.assign(x.analysis.evidence_snapshot.canonicalSalesOutcome, {
      outcome: 'needs_review',
      isSaleCountable: false,
      isRevenueCountable: false,
    });
    const s = summarizeCanonicalWhatsappKpis([project(x)]);
    expect(s.sales).toBe(0);
    expect(s.revenue).toBe(0);
    expect(s.invoiceEvidence).toBe(1);
  });
  it('legacy match status, amount, reviewer and seller do not independently create credit', () => {
    const x = fixture('legacy', {
      invoice_match_status: 'verified',
      matched_invoice_value: 999,
      reviewer_id: 'doctor-A',
      staff_id: 'doctor-A',
      evidence_snapshot: {},
    });
    const f = project(x);
    expect(f.saleCountable).toBe(false);
    expect(f.creditedStaffId).toBeNull();
    expect(f.revenue).toBeNull();
  });
  it('sale and revenue flags remain independent', () => {
    const x = fixture('sale-only');
    x.analysis.evidence_snapshot.canonicalSalesOutcome.isRevenueCountable = false;
    expect(summarizeCanonicalWhatsappKpis([project(x)]).sales).toBe(1);
    expect(summarizeCanonicalWhatsappKpis([project(x)]).revenue).toBe(0);
  });
  it('uncertain or multi-staff attribution cannot create staff credit', () => {
    const x = fixture('multi');
    x.view.staff.facts.push({
      ...x.view.staff.facts[0],
      staffId: 'doctor-B',
      staffSender: 'Doctor B',
    });
    expect(project(x).creditedStaffId).toBeNull();
    const y = fixture('not-official');
    y.attribution.is_official_for_staff_evaluation = false;
    expect(project(y).creditedStaffId).toBeNull();
    expect(project(y).saleCountable).toBe(true);
  });
  it('a hidden invoice ledger does not change sale truth; unknown revenue is not zero', () => {
    const x = fixture('hidden');
    const visible = project(x);
    const restricted = projectCanonicalKpiCase(x.analysis, x.envelope, null, x.attribution);
    expect(restricted.saleCountable).toBe(visible.saleCountable);
    expect(summarizeCanonicalWhatsappKpis([restricted]).revenue).toBeNull();
    expect(summarizeCanonicalWhatsappKpis([restricted]).unknownRevenue).toBe(1);
  });
  it('a foreign or revoked proof cannot contribute revenue', () => {
    for (const patch of [{ salesCaseId: 'other' }, { state: 'revoked' }]) {
      const x = fixture('current');
      Object.assign(x.ledger.case_json.canonicalSaleProof, patch);
      expect(project(x).revenue).toBeNull();
    }
  });
  it('preserves the existing canonical case-owned proof when its audit analysis id is older', () => {
    const x = fixture('same-case');
    x.ledger.case_json.canonicalSaleProof.analysisId = 'older-analysis';
    expect(project(x).revenue).toBe(100);
  });
  it('no invoice, no response, unresolved product and recoverable cases are not losses', () => {
    const x = fixture('open');
    x.view.lostOpportunity.state = 'recoverable';
    expect(canonicalOpportunityProjection([project(x)]).leakage).toEqual([]);
    x.view.lostOpportunity.state = 'lost';
    x.view.lostOpportunity.reason = 'customer_final_decline' as any;
    const lost = canonicalOpportunityProjection([project(x)]).leakage;
    expect(lost[0].cases_count).toBe(1);
    expect(lost[0].staff_attributed_cases).toBe(0);
  });
  it('conversion keeps eligible/checkable canonical opportunities, with evidence gaps pending', () => {
    const won = fixture('won');
    const open = fixture('open');
    Object.assign(open.analysis.evidence_snapshot.canonicalSalesOutcome, {
      outcome: 'open_opportunity',
      isSaleCountable: false,
      isRevenueCountable: false,
    });
    const pending = project({
      ...open,
      analysis: { ...open.analysis, case_id: 'pending', identity_customer_id: null },
    } as any);
    const s = summarizeCanonicalWhatsappKpis([project(won), project(open), pending]);
    expect(s.conversion.provenSales).toBe(1);
    expect(s.conversion.eligibleCases).toBe(2);
    expect(s.conversion.conversionRatePercent).toBe(50);
    expect(s.conversion.pendingEvidenceCases).toBe(1);
  });
  it('does not infer a weak employee conversion/penalty from unresolved participants', () => {
    const x = fixture('uncertain');
    x.view.staff.facts = [];
    const impact = canonicalDoctorImpact([project(x)], 'doctor-A', scope.start, scope.endExclusive);
    expect(impact?.commercial_conversations).toBeNull();
    expect(impact?.sale_leakage_count).toBeNull();
    expect(impact?.verified_sale_conversations).toBe(0);
  });
  it('hidden attribution is unavailable, not a zero employee sale or penalty', () => {
    const x = fixture('restricted');
    const f = projectCanonicalKpiCase(x.analysis, x.envelope, x.ledger, null);
    expect(f.saleCountable).toBe(true);
    expect(
      canonicalDoctorImpact([f], 'doctor-A', scope.start, scope.endExclusive)
        ?.verified_sale_conversations
    ).toBeNull();
  });
  it('conversion numerator is restricted to the same eligible population as its denominator', () => {
    const won = fixture('won');
    const other = fixture('noncommercial');
    other.analysis.case_type = 'complaint';
    const impact = canonicalDoctorImpact(
      [project(won), project(other)],
      'doctor-A',
      scope.start,
      scope.endExclusive
    )!;
    expect(impact.verified_sale_conversations).toBe(2);
    expect(impact.conversion_sale_count).toBe(1);
    expect(aggregateImpactEvidence([impact], true).verifiedConversionRate).toBe(100);
  });
  it('documents deterministic before/after counts instead of forcing canonical equal to legacy', () => {
    const won = fixture('won');
    const weak = fixture('weak');
    Object.assign(weak.analysis.evidence_snapshot.canonicalSalesOutcome, {
      outcome: 'needs_review',
      isSaleCountable: false,
      isRevenueCountable: false,
    });
    const other = fixture('other');
    other.view.staff.facts = [];
    const facts = [project(won), project(weak), project(other)];
    const canonical = summarizeCanonicalWhatsappKpis(facts);
    const legacyRows = [won, weak, other].map((x) => ({
      ...x.analysis,
      invoice_match_status: 'verified',
      matched_invoice_value: 100,
      commercial_eligible: true,
      staff_id: 'doctor-A',
      invoice_present: x.analysis.case_id !== 'weak',
    }));
    const legacy = {
      sales: legacyRows.filter((r) => r.invoice_match_status === 'verified').length,
      revenue: legacyRows
        .filter((r) => r.invoice_match_status === 'verified')
        .reduce((sum, r) => sum + r.matched_invoice_value, 0),
      conversion:
        (legacyRows.filter((r) => r.commercial_eligible).length / legacyRows.length) * 100,
      staffCredit: legacyRows.filter(
        (r) => r.staff_id === 'doctor-A' && r.invoice_match_status === 'verified'
      ).length,
      missed: legacyRows.filter((r) => r.commercial_eligible && !r.invoice_present).length,
    };
    expect(canonical.sales).toBe(2);
    expect(canonical.revenue).toBe(200);
    expect(canonical.conversion.conversionRatePercent).toBe(67);
    expect(summarizeCanonicalWhatsappKpis(facts, 'doctor-A').sales).toBe(1);
    expect(canonical.lost).toBe(0);
    console.log(
      'KPI_FIXTURE_COMPARISON',
      JSON.stringify({
        legacy,
        canonical: {
          sales: canonical.sales,
          revenue: canonical.revenue,
          conversion: canonical.conversion.conversionRatePercent,
          staffCredit: 1,
          missed: canonical.lost,
        },
      })
    );
  });
});

describe('bounded canonical KPI I/O', () => {
  it('loads many cases/staff in four batch reads, never one query per employee', async () => {
    const records = Array.from({ length: 100 }, (_, i) => fixture(String(i)));
    const client = createInMemorySupabase({
      sales_intelligence_current_case_analyses: records.map((x) => x.analysis),
      sales_intelligence_cases: records.map((x) => x.envelope),
      sales_intelligence_current_attributions: records.map((x) => x.attribution),
      whatsapp_customer_cases_v22: records.map((x) => x.ledger),
    });
    const facts = await loadCanonicalWhatsappKpis(client, scope);
    expect(facts).toHaveLength(100);
    expect(client.reads).toHaveLength(4);
    expect(client.reads).not.toContain('whatsapp_review_sources');
    expect(client.reads).not.toContain('sales_invoices');
  });
  it('a failed read is explicit, never successful empty performance', async () => {
    const client = {
      from: () => ({
        select() {
          return this;
        },
        gte() {
          return this;
        },
        lt() {
          return this;
        },
        order() {
          return this;
        },
        range() {
          return Promise.resolve({ error: new Error('permission denied'), data: null });
        },
      }),
    };
    await expect(loadCanonicalWhatsappKpis(client, scope)).rejects.toThrow('permission denied');
  });
});

describe('V4 false-positive retirement matrix', () => {
  it.each([
    'تمام شكراً',
    'وصل تمام',
    'شكراً',
    'تمام',
    'ماشي',
    'جزاك الله خير',
    'المشكلة اتحلت شكراً',
    'متأخر جدا',
    'جرعة الدواء كام؟',
    'الصنف غير متوفر',
    'لا مش عايز البديل',
    'هستنى لما تتابع',
  ])('%s is not a sale without canonical evidence', (reply) => {
    const raw = `[9/24/26, 9:00:00 AM] You: بنعتذر عن تأخير الطلب وهنتابع مع الفريق\n[9/24/26, 9:01:00 AM] Customer: ${reply}`;
    const session = splitWhatsAppSessions(parseWhatsAppExport(raw), 120)[0];
    const legacy = buildUnifiedConversationIntelligence(session);
    expect(legacy.chatSuggestedSold).toBe(false);
    expect(mapSaleState(legacy, { status: 'not_found' })).toBe('no_verified_invoice');
    const canonical = runSalesIntelligencePipeline({
      conversationId: 'polite',
      rawWhatsAppExportText: raw,
      resolveInvoiceCandidates: () => [],
    });
    expect(
      canonical.caseAnalyses.some(
        (a) => a.salesOutcome.isSaleCountable || a.salesOutcome.isRevenueCountable
      )
    ).toBe(false);
  });
});
