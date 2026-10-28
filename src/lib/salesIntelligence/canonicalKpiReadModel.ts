// The reporting extension of canonicalCaseTruth: project persisted facts, never run engines.
import { readCanonicalCaseSaleTruth, type CanonicalCaseSaleTruth } from './qa/canonicalCaseTruth';
import { readCaseIntelligence } from './qa/caseIntelligencePresentation';
import { deriveCanonicalSalesConversion } from './canonicalConversionV1';
import type { CaseIntelligenceView, CaseType } from './types';

type Row = Record<string, any>;
export interface CanonicalKpiCase {
  caseId: string;
  startedAt: string;
  branch: string | null;
  customerId: string | null;
  caseType: CaseType;
  truth: CanonicalCaseSaleTruth;
  view: CaseIntelligenceView | null;
  saleCountable: boolean;
  revenueCountable: boolean;
  revenue: number | null;
  staffAttributionAvailable: boolean;
  creditedStaffId: string | null;
  creditedStaffName: string | null;
  participants: Array<{ staffId: string | null; sender: string }>;
  lost: boolean;
  evidenceAvailable: boolean;
}
export interface CanonicalKpiScope {
  start: string;
  endExclusive: string;
  branch?: string;
  staffId?: string;
}

export function projectCanonicalKpiCase(
  analysis: Row,
  envelope: Row,
  v22: Row | null,
  attribution: Row | null = null
): CanonicalKpiCase {
  const caseId = String(analysis.case_id);
  const truth = readCanonicalCaseSaleTruth({
    caseId,
    analysisRow: analysis,
    attributionRow: attribution,
    linkedV22CaseId: envelope.source_case_id_v22 ?? null,
    v22Row: v22,
  });
  const candidate = readCaseIntelligence(analysis);
  const view = candidate?.caseId === caseId ? candidate : null;
  const closers = (view?.staff?.facts ?? []).filter(
    (f) => f.fact === 'confirmed_order' && f.staffId
  );
  const ids = new Set(closers.map((f) => f.staffId));
  // A seller, reviewer, receiver, participant or followup assignee is not the conversation closer.
  const creditedStaffId =
    ids.size === 1 && truth.attribution?.isOfficialForStaffEvaluation ? closers[0].staffId : null;
  const saleCountable =
    truth.outcome?.outcome === 'sale_proven' && truth.outcome.isSaleCountable === true;
  const revenueCountable = truth.outcome?.isRevenueCountable === true;
  // Preserve canonicalCaseTruth's case-owned proof contract; the proof's analysis id is audit provenance.
  const ledgerCurrent = truth.ledger.state === 'proven';
  return {
    caseId,
    startedAt: analysis.case_started_at,
    branch: analysis.identity_branch_name_raw ?? null,
    customerId: analysis.identity_customer_id ?? null,
    caseType: analysis.case_type,
    truth,
    view,
    saleCountable,
    revenueCountable,
    revenue: revenueCountable && ledgerCurrent ? truth.ledger.revenue : null,
    staffAttributionAvailable: truth.attribution != null,
    creditedStaffId,
    creditedStaffName: creditedStaffId ? closers[0].staffSender : null,
    participants: (view?.staff?.participants ?? []).map((p) => ({
      staffId: p.staffId,
      sender: p.sender,
    })),
    lost: view?.lostOpportunity?.state === 'lost',
    evidenceAvailable: Boolean(analysis.identity_customer_id || analysis.identity_customer_phone),
  };
}

/** All queries are bounded and batched. No N+1, fallback views, legacy flags or invoice-name joins. */
export async function loadCanonicalWhatsappKpis(
  client: any,
  scope: CanonicalKpiScope
): Promise<CanonicalKpiCase[]> {
  const pageSize = 500,
    maximum = 10000;
  const analyses: Row[] = [];
  for (let offset = 0; offset < maximum; offset += pageSize) {
    let query = client
      .from('sales_intelligence_current_case_analyses')
      .select(
        'analysis_id,case_id,pipeline_version,case_type,case_started_at,identity_branch_name_raw,identity_customer_id,identity_customer_phone,evidence_snapshot'
      )
      .gte('case_started_at', scope.start)
      .lt('case_started_at', scope.endExclusive)
      .order('case_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (scope.branch && scope.branch !== 'all')
      query = query.eq('identity_branch_name_raw', scope.branch);
    const { data, error } = await query;
    if (error) throw error;
    analyses.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
    if (offset + pageSize >= maximum)
      throw new Error('canonical_kpi_window_too_large: ضيّق الفترة المختارة');
  }
  const envelopes: Row[] = [];
  const attributions: Row[] = [];
  const ledgers: Row[] = [];
  // URL/key batches stay bounded even for a wide reporting window.
  for (let offset = 0; offset < analyses.length; offset += 200) {
    const batch = analyses.slice(offset, offset + 200);
    const { data, error } = await client
      .from('sales_intelligence_cases')
      .select('case_id,source_case_id_v22')
      .in(
        'case_id',
        batch.map((a) => a.case_id)
      )
      .limit(200);
    if (error) throw error;
    envelopes.push(...(data ?? []));
    const attributed = await client
      .from('sales_intelligence_current_attributions')
      .select(
        'analysis_id,case_id,is_official_for_staff_evaluation,attribution_level,selected_invoice_id,selected_invoice_number'
      )
      .in(
        'analysis_id',
        batch.map((a) => a.analysis_id)
      )
      .limit(200);
    if (attributed.error) throw attributed.error;
    attributions.push(...(attributed.data ?? []));
  }
  const linkedIds = [...new Set(envelopes.map((e) => e.source_case_id_v22).filter(Boolean))];
  for (let offset = 0; offset < linkedIds.length; offset += 200) {
    const { data, error } = await client
      .from('whatsapp_customer_cases_v22')
      .select(
        'id,verified_invoice_id,verified_invoice_number,verified_revenue,verified_sale_at,canonical_sale_proof:case_json->canonicalSaleProof'
      )
      .in('id', linkedIds.slice(offset, offset + 200))
      .limit(200);
    if (error) throw error;
    ledgers.push(...(data ?? []));
  }
  const byCase = new Map(envelopes.map((e) => [e.case_id, e]));
  const byLedger = new Map(ledgers.map((l) => [String(l.id), l]));
  const byAnalysis = new Map(attributions.map((a) => [a.analysis_id, a]));
  const seen = new Set<string>();
  const facts = analyses
    .map((a) =>
      projectCanonicalKpiCase(
        a,
        byCase.get(a.case_id) ?? {},
        byLedger.get(String(byCase.get(a.case_id)?.source_case_id_v22)) ?? null,
        byAnalysis.get(a.analysis_id) ?? null
      )
    )
    .filter((f) => {
      if (seen.has(f.caseId)) throw new Error('duplicate_current_canonical_case');
      seen.add(f.caseId);
      return true;
    });
  // Staff filtering follows persisted contribution evidence, never the invoice seller or a name.
  return scope.staffId
    ? facts.filter(
        (f) =>
          f.creditedStaffId === scope.staffId ||
          f.participants.some((p) => p.staffId === scope.staffId)
      )
    : facts;
}

/**
 * A staff member's KPI POPULATION is every case they handled (credited closer or persisted
 * participant), not only the cases already credited to them. Filtering the population by credit
 * removed every unconverted case and made any staff conversion ~100%. Sales and revenue still
 * count only cases credited to this staff member; a proven sale credited to nobody yet is pending
 * attribution (left out of the denominator), and a case credited to another closer is theirs.
 */
export function staffKpiPopulation(facts: CanonicalKpiCase[], staffId: string) {
  return facts.filter(
    (f) =>
      f.creditedStaffId === staffId ||
      (f.creditedStaffId == null && f.participants.some((p) => p.staffId === staffId))
  );
}

export function summarizeCanonicalWhatsappKpis(facts: CanonicalKpiCase[], staffId?: string) {
  const visible = staffId ? staffKpiPopulation(facts, staffId) : facts;
  const credited = (f: CanonicalKpiCase) => !staffId || f.creditedStaffId === staffId;
  const countable = visible.filter((f) => f.saleCountable && credited(f));
  const revenueFacts = visible.filter((f) => f.revenueCountable && credited(f));
  const unknownRevenue = revenueFacts.filter((f) => f.revenue == null).length;
  const knownRevenue = revenueFacts.reduce((sum, f) => sum + (f.revenue ?? 0), 0);
  const conversion = deriveCanonicalSalesConversion(
    visible.map((f) => ({
      caseId: f.caseId,
      caseType: f.caseType,
      outcome:
        f.saleCountable && credited(f)
          ? 'sale_proven'
          : f.truth.outcome?.outcome === 'sale_proven'
            ? 'needs_review'
            : (f.truth.outcome?.outcome ?? 'unknown'),
      // A proven sale not (yet) credited to this staff member is pending attribution, not a miss.
      invoiceEvidenceAvailable:
        f.evidenceAvailable && f.truth.outcome != null && !(f.saleCountable && !credited(f)),
    }))
  );
  return {
    cases: visible.length,
    sales: countable.length,
    revenue: unknownRevenue ? null : knownRevenue,
    knownRevenue,
    unknownRevenue,
    invoiceEvidence: visible.filter((f) => f.truth.ledger.state === 'proven').length,
    lost: visible.filter((f) => f.lost).length,
    unknown: visible.filter((f) => !f.truth.outcome || !f.view).length,
    uncreditedSales: facts.filter((f) => f.saleCountable && !f.creditedStaffId).length,
    conversion,
  };
}

/** Compatibility projection for the existing dashboard cards, not a second source of business truth. */
export function canonicalStaffTruthRows(facts: CanonicalKpiCase[]) {
  return facts.map((f) => ({
    case_id: f.caseId,
    invoice_datetime: f.startedAt,
    invoice_branch: f.branch,
    invoice_amount: f.revenue,
    canonical_staff_id: f.creditedStaffId,
    canonical_staff_name: f.creditedStaffName,
    canonical_staff_role: null,
    canonical_staff_branch: f.branch,
    canonical_staff_is_active: null,
    staff_resolution_status: f.creditedStaffId ? 'persisted_conversation_closer' : 'unresolved',
    is_staff_resolved: Boolean(f.creditedStaffId),
    item_evidence_available: null,
    canonical_outcome_available: f.truth.outcome != null,
    is_sale_countable: f.saleCountable,
    is_revenue_countable: f.revenueCountable,
  }));
}
