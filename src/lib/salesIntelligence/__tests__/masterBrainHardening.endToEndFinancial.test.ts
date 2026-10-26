// Gate 4 — End-to-end financial safety (synthetic data only).
//
// WhatsApp text -> case segmentation -> staff/customer identity -> invoice link -> sale proof ->
// conversation evaluation -> approval -> monthly evidence -> KPI credit / payable points.
// At every step, unproven evidence or an unapproved evaluation must have no financial effect, and
// missing evidence must surface as null/pending — never as 0 or a deduction.
// (The database half of this path — payable-points guard, approval sync, Cairo cycle RPC and
// concurrency — runs on real PostgreSQL in scripts/verification/test-master-brain-native-pg.mjs.)
import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../conversationEvaluation';
import { buildCaseConversationReviewPayload } from '../conversationEvaluationPersistence';
import type { InvoiceItemEvidenceProvider } from '../saleAttributionEngine';
import {
  averageOfficialConversationScore,
  classifyConversationReview,
  isPayableConversationReview,
  selectOfficialConversationReviews,
} from '@/lib/evaluations/officialConversationReview';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';

// 26 Sep 2026, 00:30 Cairo (EEST, UTC+3) = 25 Sep 21:30 UTC. Cycle "2026-10" (26 Sep -> 25 Oct).
const RAW = `[9/26/26, 12:30:00 AM] Customer: مساء الخير عايز 2 علبة بانادول اكسترا
[9/26/26, 12:31:00 AM] You: أهلا بحضرتك، معاك د صيدلي. حضرتك تأمر بـ:
2 علبة بانادول اكسترا
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/26/26, 12:33:00 AM] Customer: تمام
[9/26/26, 12:34:00 AM] You: تم تأكيد الطلب`;

const productIndex = buildPharmacyProductIndex([{
  productId: 'p-panadol', productCode: 'PAN-EXTRA', barcode: null,
  canonicalName: 'Panadol Extra', arabicName: null, englishName: 'Panadol Extra',
  normalizedNames: ['panadol extra'], strengths: [], dosageForms: [], packSizes: [],
  category: null, manufacturer: null, price: 90, sourceTable: 'synthetic',
  qualityFlags: { hasNormalizedNameCollision: false, missingStrength: true, missingDosageForm: true, missingAnyQuantitySignal: true },
}]);

const STAFF = { id: 'staff-closer', name: 'د صيدلي', branch: 'فرع شكري', role: 'doctor' };

function run(invoiceItems: InvoiceItemEvidenceProvider, invoiceOverrides: Record<string, unknown> = {}) {
  const result = runSalesIntelligencePipeline({
    conversationId: 'e2e-source',
    rawWhatsAppExportText: RAW,
    trustedConversationStartedAt: '2026-09-25T21:30:00.000Z',
    customerIdHint: 'cust-e2e',
    customerCodeHint: '9500',
    customerNameHint: 'عميل نهائي',
    customerPhoneHint: '01000000009',
    customerIdentityStatus: 'resolved',
    branchNameRawHint: 'فرع شكري',
    staffIdBySender: { You: STAFF.id },
    resolveInvoiceCandidates: () => [{
      id: 'inv-e2e', invoice_number: '30001', customer_id: 'cust-e2e', customer_code: '9500', customer_name: 'عميل نهائي',
      customer_phone: '01000000009', branch: 'فرع شكري', invoice_datetime: '2026-09-25T21:45:00.000Z', net_amount: 180,
      staff_id: 'staff-cashier', ...invoiceOverrides,
    }],
    itemEvidenceProvider: invoiceItems,
    productIndex,
  });
  expect(result.caseAnalyses).toHaveLength(1);
  return result.caseAnalyses[0];
}

const withLines: InvoiceItemEvidenceProvider = {
  getItemsForInvoice: () => [{ productNameRaw: 'Panadol Extra', productCode: 'PAN-EXTRA', productId: 'p-panadol', quantity: 2 }],
};
const noLines: InvoiceItemEvidenceProvider = { getItemsForInvoice: () => 'unavailable' };

function automaticReview(analysis: ReturnType<typeof run>) {
  const evaluation = analyzeConversationEvaluation(analysis.caseIntelligence, null);
  return { evaluation, row: buildCaseConversationReviewPayload({ sourceId: 'e2e-source', view: analysis.caseIntelligence, evaluation, staffRow: STAFF }) as Record<string, unknown> };
}

describe('Gate 4 — end-to-end financial safety', () => {
  it('segmentation + identity: one case, case branch from the conversation, closer is the chat pharmacist', () => {
    const analysis = run(withLines);
    expect(analysis.caseIntelligence.branch.branchNameRaw).toBe('فرع شكري');
    expect(analysis.caseIntelligence.staff.participants.map((p) => p.staffId)).toEqual([STAFF.id]);
  });

  it('an unproven invoice (no line evidence) is never countable sale, revenue or staff credit', () => {
    const analysis = run(noLines);
    expect(analysis.attribution.selectedCandidate?.directInvoiceLink ?? false).toBe(false);
    expect(analysis.salesOutcome.isSaleCountable).toBe(false);
    expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
  });

  it('the invoice is proven by independent evidence even when a different employee keyed it', () => {
    const analysis = run(withLines);
    expect(analysis.attribution.selectedInvoiceId).toBe('inv-e2e');
    expect(analysis.attribution.selectedCandidate?.directInvoiceLink).toBe(true);
    expect(analysis.attribution.selectedCandidate?.staffMatch).not.toBe('same');
    // Proof is not circular: no trusted/legacy invoice was supplied; the link comes from code + name
    // + time + item/quantity evidence only.
    expect(analysis.attribution.legacyEvidenceUsed).toBe(false);
    expect(analysis.salesOutcome.saleProofState).toBe('proven');
    expect(analysis.salesOutcome.outcome).toBe('sale_proven');
    expect(analysis.salesOutcome.isSaleCountable).toBe(true);
  });

  it('the automatic evaluation has no financial effect until a manager approves it', () => {
    const { row } = automaticReview(run(withLines));
    expect(row.evaluation_kind).toBe('automatic');
    expect(row.point_impact).toBe(0);
    expect(row.doctor_points_impact).toBe(0);
    expect(classifyConversationReview(row)).toBe('automatic_unapproved');
    expect(isPayableConversationReview(row)).toBe(false);
    // The conversation is dated by its Cairo operational day: the 26th belongs to cycle 2026-10.
    expect(row.month_cycle).toBe(monthCycleFromDate('2026-09-25T21:30:00.000Z'));
    expect(row.month_cycle).toBe('2026-10');
    const monthly = selectOfficialConversationReviews([row], { startDay: '2026-09-26', endDayExclusive: '2026-10-26' });
    expect(monthly.rows).toHaveLength(0);
    expect(monthly.automaticUnapproved).toBe(1);
    expect(averageOfficialConversationScore(monthly.rows)).toBeNull(); // "under review", not 0
  });

  it('after explicit manager approval it becomes evidence in the 26 -> 25 Cairo cycle, never the previous one', () => {
    const { row, evaluation } = automaticReview(run(withLines));
    const approved = { ...row, manager_reviewed_at: '2026-09-27T10:00:00Z', manager_reviewed_by: 'manager-1' };
    expect(classifyConversationReview(approved)).toBe('official');
    const october = selectOfficialConversationReviews([approved], { startDay: '2026-09-26', endDayExclusive: '2026-10-26' });
    const september = selectOfficialConversationReviews([approved], { startDay: '2026-08-26', endDayExclusive: '2026-09-26' });
    expect(october.rows).toHaveLength(1);
    expect(september.rows).toHaveLength(0);
    expect(averageOfficialConversationScore(october.rows)).toBe(evaluation.summary.autoScore);
  });

  it('a human review with a deduction counts in the score at once, its points wait for approval', () => {
    const human = {
      conversation_date: '2026-09-25T21:30:00.000Z', final_score: 72, total_score: 72, impact_status: 'pending',
      evaluation_kind: 'واتساب', reviewer_role: 'team_dawaa_alpha', is_current: true, point_impact: -4,
    };
    const monthly = selectOfficialConversationReviews([human], { startDay: '2026-09-26', endDayExclusive: '2026-10-26' });
    expect(monthly.rows).toHaveLength(1);
    expect(monthly.pointsPendingApproval).toBe(1);
    expect(averageOfficialConversationScore(monthly.rows)).toBe(72);
    expect(isPayableConversationReview(human)).toBe(false);
    expect(isPayableConversationReview({ ...human, impact_status: 'approved' })).toBe(true);
  });
});
