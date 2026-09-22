// Sales Intelligence Phase F — Sales Integrity Engine.
//
// A REASONING layer over Phase A-E.1's already-established facts — this module NEVER re-derives
// conversation understanding, basket state, attribution, or invoice matching. It only detects
// OPERATIONAL INCONSISTENCIES across that already-computed evidence chain, and never assigns
// blame: no field or value produced here ever names a responsible employee. `involvedStaffIds`
// (per exception) is a plain traceability list — see its own doc comment in types.ts.
//
// Pure functions only — no Supabase calls, no database writes, no lifecycle/admin workflow.
// Every exception this module produces has status 'open'; nothing else exists yet.
import type {
  BasketInvoiceMatch,
  CommercialConfirmationAssessment,
  ConfidenceAssessment,
  DifferenceExplanationKind,
  EvidenceRef,
  IntegrityEvaluationScope,
  OrderConfirmationProtocolApplicability,
  OrderConfirmationProtocolAssessment,
  ProtocolPolicyComplianceState,
  SaleAttributionAssessment,
  SalesIntegrityAssessment,
  SalesIntegrityException,
  SalesIntegrityExceptionType,
  SalesIntegritySeverity,
  SalesIntegrityStage,
} from './types';

// ---------------------------------------------------------------------------
// Input contract — everything this engine needs, ALREADY resolved by Phases A-E.1. This engine
// does not re-derive any of it; it only reasons over it.
// ---------------------------------------------------------------------------

export interface SalesIntegrityInput {
  caseId: string;
  commercialConfirmation: CommercialConfirmationAssessment;
  protocolAssessment: OrderConfirmationProtocolAssessment;
  attribution: SaleAttributionAssessment;
  basketInvoiceMatch: BasketInvoiceMatch;
  /**
   * An explicit, caller-CONFIRMED invoice status fact (e.g. already verified against a real
   * status column) — never inferred here from ambiguous free-text. Null when no reliable status
   * data exists; per §3 of the Phase F spec, "cancelled/returned invoice IF status data exists."
   */
  invoiceStatusHint?: 'cancelled' | 'returned' | null;
  /** Plain traceability (e.g. Phase B StaffContribution.staffId values) — see involvedStaffIds's own doc comment. NEVER a fault list. */
  knownStaffIds?: string[];
  /**
   * Phase G.1 — the case's own segmented ConversationCase.endedAt, used ONLY to compare against
   * protocolPolicyEffectiveAt below. Never a coarse conversation-level timestamp — see the Phase G
   * pipeline's own timing discipline.
   */
  caseEndedAt?: string | null;
  /**
   * Phase G.1 — see ProtocolPolicyComplianceState's own doc comment for the full 3-way semantics:
   * OMITTED (undefined) preserves this engine's exact pre-G.1 behavior (protocol exceptions fire
   * whenever applicable+non-compliant, with no enforcement-date concept at all) — every pre-G.1
   * caller/test keeps working unchanged. Explicit `null` means "the caller has opted into
   * effective-date semantics, but no policy date is configured yet" -> nothing is enforced yet. An
   * ISO date string means the policy took effect at that moment; NEVER hard-coded by this engine.
   */
  protocolPolicyEffectiveAt?: string | null;
}

// ---------------------------------------------------------------------------
// Canonical stage order — used only to compute the earliest-observable-break stage. Mirrors the
// natural evidence-chain sequence; 'fulfillment_handoff' is future-proofed for a later Order
// layer this codebase does not populate yet.
// ---------------------------------------------------------------------------
const STAGE_ORDER: Record<SalesIntegrityStage, number> = {
  conversation: 0,
  basket_confirmation: 1,
  fulfillment_handoff: 2,
  attribution: 3,
  invoice_header: 4,
  invoice_items: 5,
  delivery: 6,
  unknown: 99,
};

const SEVERITY_ORDER: Record<SalesIntegritySeverity, number> = { info: 0, review: 1, high_priority: 2 };

function assessment(level: ConfidenceAssessment['level'], score: number, ruleIds: string[], evidence: EvidenceRef[]): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

function ref(sourceTable: string, sourceId: string, description: string): EvidenceRef {
  return { sourceTable, sourceId, description };
}

interface ExceptionDraft {
  type: SalesIntegrityExceptionType;
  stage: SalesIntegrityStage;
  severity: SalesIntegritySeverity;
  summary: string;
  fact: string;
  interpretation: string;
  sourceEvidence: EvidenceRef[];
  ruleIds: string[];
  basketVersion?: number | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  expectedValue?: string | number | null;
  observedValue?: string | number | null;
  difference?: number | null;
  differencePercentage?: number | null;
  explained?: boolean;
  explanationKind?: DifferenceExplanationKind | null;
  confidence: ConfidenceAssessment;
  integrityEvaluationScope: IntegrityEvaluationScope;
  needsHumanReview?: boolean;
  involvedStaffIds?: string[];
}

// ---------------------------------------------------------------------------
// Phase G.1 — protocol applicability + policy-enforcement gate. A real Phase G real-data finding
// drove this: feeding every case (including price-only inquiries and bare acknowledgements) through
// protocol compliance produced 55/55 real cases flagged for a "missing final total" that was never
// a genuine staff omission — see deriveOrderConfirmationProtocolApplicability's own doc comment in
// commercialConfirmationEngine.ts for the full reasoning. This function is the single place that
// turns (applicability, protocolCompliant, timing, an optional policy effective date) into one
// state — used BOTH to gate exception emission below AND exposed on the final assessment.
// ---------------------------------------------------------------------------

export function deriveProtocolPolicyComplianceState(params: {
  applicability: OrderConfirmationProtocolApplicability;
  protocolCompliant: boolean;
  caseEndedAt: string | null;
  protocolPolicyEffectiveAt: string | null | undefined;
}): ProtocolPolicyComplianceState {
  const { applicability, protocolCompliant, caseEndedAt, protocolPolicyEffectiveAt } = params;

  if (applicability === 'not_applicable') return 'not_applicable';
  if (applicability === 'not_reached') return 'not_reached';
  if (applicability === 'unknown') return 'unknown';

  // applicability === 'applicable' from here on.
  if (protocolPolicyEffectiveAt === undefined) {
    // Caller did not opt into effective-date semantics — preserve this engine's exact pre-G.1
    // behavior: always enforced once applicable.
    return protocolCompliant ? 'compliant' : 'non_compliant';
  }
  if (protocolPolicyEffectiveAt === null) {
    // Caller explicitly opted in, but no policy date is configured yet anywhere -> nothing is
    // enforced yet for ANY case, regardless of its own timing.
    return 'not_enforced';
  }
  if (!caseEndedAt) return 'unknown'; // opted in, but no comparable case timestamp — never guess.
  const caseMs = new Date(caseEndedAt).getTime();
  const effMs = new Date(protocolPolicyEffectiveAt).getTime();
  if (!Number.isFinite(caseMs) || !Number.isFinite(effMs)) return 'unknown';
  if (caseMs < effMs) return 'not_enforced';
  return protocolCompliant ? 'compliant' : 'non_compliant';
}

// ---------------------------------------------------------------------------
// Detection: conversation / protocol exceptions. NEVER treats protocolCompliant=false as proof of
// a commercial problem — these are process facts only, entirely separate from header/item facts
// (see detectHeaderExceptions/detectItemExceptions, which are gated on real total/item EVIDENCE,
// never on protocol compliance).
// ---------------------------------------------------------------------------

function detectProtocolExceptions(
  input: SalesIntegrityInput,
  scope: IntegrityEvaluationScope,
  policyState: ProtocolPolicyComplianceState
): ExceptionDraft[] {
  const { protocolAssessment, commercialConfirmation } = input;
  const drafts: ExceptionDraft[] = [];

  // basket_modified_after_confirmation is a BASKET-VERSIONING fact, not a protocol-policy
  // violation — it can only ever be true once an earlier version WAS genuinely confirmed, which
  // itself implies applicability was already 'applicable'. Left ungated by policyState/applicability
  // on purpose (see the Phase G.1 report's own reasoning).
  if (commercialConfirmation.modificationAfterConfirmation && commercialConfirmation.currentState !== 'commercial_confirmation_complete') {
    drafts.push({
      type: 'basket_modified_after_confirmation',
      stage: 'basket_confirmation',
      severity: 'review',
      summary: 'تم تعديل السلة بعد تأكيد سابق ولم تصل المحادثة لتأكيد كامل جديد بعد.',
      fact: 'إصدار سابق من السلة كان مؤكدًا من العميل، ثم حدث تعديل، والحالة التجارية الحالية ليست "مكتملة التأكيد".',
      interpretation: 'قد تكون المحادثة لا تزال جارية أو توقفت بعد التعديل — ليست بالضرورة مشكلة في البيع.',
      sourceEvidence: [],
      ruleIds: ['integrity.protocol.basket_modified_after_confirmation'],
      confidence: assessment('strongly_inferred', 0.7, ['integrity.protocol.basket_modified_after_confirmation'], []),
      integrityEvaluationScope: scope,
      needsHumanReview: true,
    });
  }

  // Phase G.1: the 3 step-specific/generic protocol exceptions below are gated on this case being
  // BOTH genuinely applicable AND genuinely enforced — never a staff violation for a case that
  // never reached an order-closing stage, and never a violation of a policy that did not yet exist
  // for this case's own timing (see deriveProtocolPolicyComplianceState above).
  if (policyState !== 'non_compliant') return drafts;

  if (!protocolAssessment.protocolCompliant) {
    const missing = protocolAssessment.missingProtocolSteps;
    if (missing.includes('announced_total')) {
      drafts.push({
        type: 'final_total_missing',
        stage: 'basket_confirmation',
        severity: 'review',
        summary: 'لم يُعلن الموظف إجمالي حساب صريح لهذه السلة.',
        fact: 'لا يوجد AnnouncedTotal مسجَّل لإصدار السلة الحالي.',
        interpretation: 'خطوة إجرائية ناقصة في بروتوكول التأكيد — لا تعني بالضرورة وجود خطأ في البيع نفسه.',
        sourceEvidence: [],
        ruleIds: ['integrity.protocol.final_total_missing'],
        confidence: assessment('proven', 0.9, ['integrity.protocol.final_total_missing'], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true,
      });
    }
    if (missing.includes('staff_final_confirmation')) {
      drafts.push({
        type: 'staff_final_confirmation_missing',
        stage: 'basket_confirmation',
        severity: 'review',
        summary: 'لا يوجد تأكيد نهائي من الموظف بعد قبول العميل.',
        fact: 'لا يوجد StaffFinalConfirmationEvent مسجَّل لإصدار السلة الحالي رغم تأكيد العميل.',
        interpretation: 'خطوة إجرائية ناقصة — قد يكون البيع قد تم فعليًا دون توثيق هذه الخطوة تحديدًا.',
        sourceEvidence: [],
        ruleIds: ['integrity.protocol.staff_final_confirmation_missing'],
        confidence: assessment('proven', 0.9, ['integrity.protocol.staff_final_confirmation_missing'], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true,
      });
    }
    const otherMissing = missing.filter((s) => s !== 'announced_total' && s !== 'staff_final_confirmation');
    if (otherMissing.length > 0) {
      drafts.push({
        type: 'confirmation_protocol_incomplete',
        stage: 'basket_confirmation',
        severity: 'review',
        summary: `خطوات ناقصة في بروتوكول التأكيد: ${otherMissing.join(', ')}.`,
        fact: `missingProtocolSteps تحتوي على: ${otherMissing.join(', ')}.`,
        interpretation: 'بروتوكول التأكيد لم يكتمل بالكامل وفق الخطوات المعيارية الأربع.',
        sourceEvidence: [],
        ruleIds: ['integrity.protocol.confirmation_protocol_incomplete'],
        confidence: assessment('proven', 0.85, ['integrity.protocol.confirmation_protocol_incomplete'], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true,
      });
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Detection: attribution exceptions. Distinguishes "no candidate at all" from "a candidate exists
// but is weak/ambiguous" — never collapsed into one generic fact, per §9.
// ---------------------------------------------------------------------------

function detectAttributionExceptions(input: SalesIntegrityInput, scope: IntegrityEvaluationScope): ExceptionDraft[] {
  const { attribution, commercialConfirmation } = input;
  const drafts: ExceptionDraft[] = [];
  const candidate = attribution.selectedCandidate;

  if (commercialConfirmation.currentState === 'commercial_confirmation_complete') {
    if (attribution.candidateCount === 0) {
      drafts.push({
        type: 'confirmed_case_without_attributed_invoice',
        stage: 'attribution',
        severity: 'high_priority',
        summary: 'محادثة مكتملة التأكيد التجاري بدون أي فاتورة مرشحة إطلاقًا.',
        fact: 'candidateCount = 0 رغم أن الحالة التجارية commercial_confirmation_complete.',
        interpretation: 'لا يوجد سجل تجاري (فاتورة) تم العثور عليه لهذه المحادثة — لا يثبت هذا عدم حدوث البيع، فقط أنه لم يُعثر على دليل فاتورة.',
        sourceEvidence: [],
        ruleIds: ['integrity.attribution.commercial_record_not_found'],
        confidence: assessment('strongly_inferred', 0.75, ['integrity.attribution.commercial_record_not_found'], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true,
      });
    } else if (attribution.contradictions.includes('ambiguous_multiple_candidates')) {
      drafts.push({
        type: 'ambiguous_invoice_attribution',
        stage: 'attribution',
        severity: 'review',
        summary: 'أكثر من فاتورة مرشحة بنفس القوة التقريبية — لم يتم الترجيح تلقائيًا.',
        fact: `candidateCount = ${attribution.candidateCount}، وأعلى مرشحين متقاربان في الدرجة والمستوى.`,
        interpretation: 'يحتاج قرار بشري لتحديد الفاتورة الصحيحة — لا يوجد ترجيح آلي آمن.',
        sourceEvidence: [],
        ruleIds: ['integrity.attribution.ambiguous_invoice_attribution'],
        confidence: assessment('weakly_inferred', 0.4, ['integrity.attribution.ambiguous_invoice_attribution'], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true,
      });
    } else if (attribution.attributionLevel === 'weakly_inferred' || attribution.attributionLevel === 'unknown') {
      drafts.push({
        type: 'confirmed_case_without_attributed_invoice',
        stage: 'attribution',
        severity: 'review',
        summary: 'يوجد مرشح فاتورة، لكن الثقة في الربط غير كافية لاعتماده رسميًا.',
        fact: `attributionLevel = ${attribution.attributionLevel} (candidateCount = ${attribution.candidateCount}).`,
        interpretation: 'مرشح محتمل موجود لكنه غير موثوق بدرجة كافية — لا يُعتمد كربط رسمي.',
        sourceEvidence: [],
        ruleIds: ['integrity.attribution.invoice_attribution_not_reliable'],
        confidence: assessment('weakly_inferred', 0.35, ['integrity.attribution.invoice_attribution_not_reliable'], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true,
      });
    }
  }

  if (candidate) {
    if (candidate.identityConflict !== 'none') {
      drafts.push({
        type: 'identity_conflict',
        stage: 'attribution',
        severity: 'review',
        summary: 'تعارض في هوية العميل بين المحادثة والفاتورة المرشحة.',
        fact: 'الهاتف متطابق لكن معرف العميل الأساسي مختلف بين المحادثة والفاتورة.',
        interpretation: 'يتطلب مراجعة بشرية لتحديد أي هوية عميل صحيحة — لا تخمين آلي.',
        sourceEvidence: [],
        ruleIds: ['integrity.attribution.identity_conflict'],
        confidence: assessment('weakly_inferred', 0.4, ['integrity.attribution.identity_conflict'], []),
        integrityEvaluationScope: scope,
        invoiceId: attribution.selectedInvoiceId,
        invoiceNumber: attribution.selectedInvoiceNumber,
        needsHumanReview: true,
      });
    }
    if (candidate.branchMatch === 'mismatch') {
      drafts.push({
        type: 'branch_conflict',
        stage: 'attribution',
        severity: 'review',
        summary: 'فرع الفاتورة المرشحة يختلف عن فرع المحادثة المعروف.',
        fact: `branchMatch = mismatch للفاتورة المرشحة ${attribution.selectedInvoiceNumber ?? attribution.selectedInvoiceId}.`,
        interpretation: 'قد يكون العميل اشترى من فرع آخر، أو أن الربط بالفاتورة غير صحيح.',
        sourceEvidence: [],
        ruleIds: ['integrity.attribution.branch_conflict'],
        confidence: assessment('weakly_inferred', 0.4, ['integrity.attribution.branch_conflict'], []),
        integrityEvaluationScope: scope,
        invoiceId: attribution.selectedInvoiceId,
        invoiceNumber: attribution.selectedInvoiceNumber,
        needsHumanReview: true,
      });
    }
  }

  if (attribution.competingCaseIds.length > 0) {
    drafts.push({
      type: 'competing_case_attribution',
      stage: 'attribution',
      severity: 'review',
      summary: 'نفس الفاتورة مرتبطة بحالة محادثة أخرى بشكل مستقل.',
      fact: `competingCaseIds: ${attribution.competingCaseIds.join(', ')}.`,
      interpretation: 'تعارض على مستوى الفاتورة بين حالتين — لم يتم حله تلقائيًا، ولا يُفترض حصرية بدون معلومات كافية.',
      sourceEvidence: [],
      ruleIds: ['integrity.attribution.competing_case_attribution'],
      confidence: assessment('weakly_inferred', 0.4, ['integrity.attribution.competing_case_attribution'], []),
      integrityEvaluationScope: scope,
      invoiceId: attribution.selectedInvoiceId,
      invoiceNumber: attribution.selectedInvoiceNumber,
      needsHumanReview: true,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Detection: header-level invoice exceptions. Gated STRICTLY on real total evidence
// (basketInvoiceMatch.headerEvidenceReady) — never on protocol compliance (§8).
// ---------------------------------------------------------------------------

function detectHeaderExceptions(input: SalesIntegrityInput, scope: IntegrityEvaluationScope): ExceptionDraft[] {
  const { basketInvoiceMatch, invoiceStatusHint, attribution } = input;
  const drafts: ExceptionDraft[] = [];

  if (invoiceStatusHint === 'cancelled') {
    drafts.push({
      type: 'cancelled_invoice_linked_to_case',
      stage: 'invoice_header',
      severity: 'high_priority',
      summary: 'الفاتورة المرتبطة بهذه المحادثة ملغاة.',
      fact: 'invoiceStatusHint = cancelled (حقيقة مؤكدة من المستدعي، وليست تخمينًا).',
      interpretation: 'محادثة مؤكدة تجاريًا مرتبطة بفاتورة ملغاة — يستحق مراجعة عاجلة.',
      sourceEvidence: [],
      ruleIds: ['integrity.header.cancelled_invoice_linked_to_case'],
      confidence: assessment('proven', 0.95, ['integrity.header.cancelled_invoice_linked_to_case'], []),
      integrityEvaluationScope: scope,
      invoiceId: basketInvoiceMatch.invoiceId ?? attribution.selectedInvoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber ?? attribution.selectedInvoiceNumber,
      needsHumanReview: true,
    });
  } else if (invoiceStatusHint === 'returned') {
    drafts.push({
      type: 'returned_invoice_linked_to_case',
      stage: 'invoice_header',
      severity: 'high_priority',
      summary: 'الفاتورة المرتبطة بهذه المحادثة مرتجعة.',
      fact: 'invoiceStatusHint = returned (حقيقة مؤكدة من المستدعي، وليست تخمينًا).',
      interpretation: 'محادثة مؤكدة تجاريًا مرتبطة بفاتورة تم إرجاعها — يستحق مراجعة عاجلة.',
      sourceEvidence: [],
      ruleIds: ['integrity.header.returned_invoice_linked_to_case'],
      confidence: assessment('proven', 0.95, ['integrity.header.returned_invoice_linked_to_case'], []),
      integrityEvaluationScope: scope,
      invoiceId: basketInvoiceMatch.invoiceId ?? attribution.selectedInvoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber ?? attribution.selectedInvoiceNumber,
      needsHumanReview: true,
    });
  }

  if (basketInvoiceMatch.headerEvidenceReady && basketInvoiceMatch.totalMatch === 'mismatch') {
    const totalFact = basketInvoiceMatch.differences.find((d) => d.type === 'total_mismatch');
    const explainedDiff = basketInvoiceMatch.differences.find((d) => d.type === 'explained_difference');
    const unexplainedDiff = basketInvoiceMatch.differences.find((d) => d.type === 'unexplained_difference');
    const explained = Boolean(explainedDiff);

    const basketAmount = typeof totalFact?.before === 'number' ? totalFact.before : null;
    const invoiceAmount = typeof totalFact?.after === 'number' ? totalFact.after : null;
    const difference = basketAmount != null && invoiceAmount != null ? invoiceAmount - basketAmount : null;
    const differencePercentage = difference != null && basketAmount ? (difference / basketAmount) * 100 : null;

    drafts.push({
      // Rule §10/§12: ONE canonical root exception for the total gap — the raw fact and its
      // explanation status are carried as fields on it, never as separate duplicate exceptions.
      type: explained ? 'confirmed_total_invoice_mismatch' : 'unexplained_total_difference',
      stage: 'invoice_header',
      severity: explained ? 'info' : 'high_priority',
      summary: explained
        ? 'إجمالي الفاتورة يختلف عن إجمالي السلة المؤكدة، لكن الفرق موثَّق ومُفسَّر.'
        : 'إجمالي الفاتورة يختلف عن إجمالي السلة المؤكدة بدون تفسير موثَّق.',
      fact: `إجمالي السلة = ${basketAmount ?? 'غير معروف'}، إجمالي الفاتورة = ${invoiceAmount ?? 'غير معروف'}.`,
      interpretation: explained
        ? 'الفرق مفسَّر بدليل موثق (رسوم توصيل/خصم/كاش باك/تعديل موثق) — للتدقيق فقط، ليس تنبيهًا عاجلاً.'
        : 'فرق مالي حقيقي غير مفسَّر — يستحق مراجعة.',
      sourceEvidence: [...(totalFact?.evidence ?? []), ...(explainedDiff?.evidence ?? unexplainedDiff?.evidence ?? [])],
      ruleIds: [explained ? 'integrity.header.total_mismatch.explained' : 'integrity.header.total_mismatch.unexplained'],
      confidence: assessment(
        explained ? 'strongly_inferred' : 'proven',
        explained ? 0.75 : 0.85,
        [explained ? 'integrity.header.total_mismatch.explained' : 'integrity.header.total_mismatch.unexplained'],
        []
      ),
      integrityEvaluationScope: scope,
      basketVersion: basketInvoiceMatch.basketVersion,
      invoiceId: basketInvoiceMatch.invoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber,
      expectedValue: basketAmount,
      observedValue: invoiceAmount,
      difference,
      differencePercentage,
      explained,
      explanationKind: explainedDiff?.explanation ?? null,
      needsHumanReview: !explained,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Detection: item-level exceptions. Only ever produced when
// integrityEvaluationScope === 'header_and_items' — see §11. Directly reflects
// basketInvoiceMatch.differences, which already gates identity resolution (Phase E.1) —
// never re-derived here.
// ---------------------------------------------------------------------------

function detectItemExceptions(input: SalesIntegrityInput, scope: IntegrityEvaluationScope): ExceptionDraft[] {
  const { basketInvoiceMatch } = input;
  if (scope !== 'header_and_items') return [];

  const drafts: ExceptionDraft[] = [];

  basketInvoiceMatch.differences.forEach((d) => {
    if (d.type === 'missing_item') {
      drafts.push({
        type: 'confirmed_item_missing_from_invoice',
        stage: 'invoice_items',
        severity: 'review',
        summary: `الصنف "${d.key}" مؤكد في السلة ولم يظهر في بنود الفاتورة.`,
        fact: `before(الكمية في السلة) = ${d.before}, after(في الفاتورة) = غير موجود.`,
        interpretation: 'غياب صنف مؤكد عن بنود الفاتورة — يستحق تدقيقًا تشغيليًا، وليس اتهامًا لأي طرف.',
        sourceEvidence: d.evidence,
        ruleIds: ['integrity.items.confirmed_item_missing_from_invoice'],
        confidence: d.confidence,
        integrityEvaluationScope: scope,
        basketVersion: basketInvoiceMatch.basketVersion,
        invoiceId: basketInvoiceMatch.invoiceId,
        invoiceNumber: basketInvoiceMatch.invoiceNumber,
        expectedValue: d.before,
        observedValue: d.after,
        needsHumanReview: true,
      });
    } else if (d.type === 'extra_item') {
      drafts.push({
        type: 'extra_invoice_item',
        stage: 'invoice_items',
        severity: 'review',
        summary: `الصنف "${d.key}" موجود في الفاتورة ولم يكن جزءًا من السلة المؤكدة.`,
        fact: `before(في السلة) = غير موجود, after(الكمية في الفاتورة) = ${d.after}.`,
        interpretation: 'صنف إضافي غير مُفسَّر بتعديل موثَّق في المحادثة — يستحق تدقيقًا تشغيليًا.',
        sourceEvidence: d.evidence,
        ruleIds: ['integrity.items.extra_invoice_item'],
        confidence: d.confidence,
        integrityEvaluationScope: scope,
        basketVersion: basketInvoiceMatch.basketVersion,
        invoiceId: basketInvoiceMatch.invoiceId,
        invoiceNumber: basketInvoiceMatch.invoiceNumber,
        expectedValue: d.before,
        observedValue: d.after,
        needsHumanReview: true,
      });
    } else if (d.type === 'quantity_mismatch') {
      const before = typeof d.before === 'number' ? d.before : null;
      const after = typeof d.after === 'number' ? d.after : null;
      drafts.push({
        type: 'confirmed_quantity_mismatch',
        stage: 'invoice_items',
        severity: 'review',
        summary: `كمية الصنف "${d.key}" في الفاتورة تختلف عن الكمية المؤكدة في السلة.`,
        fact: `الكمية في السلة = ${before}, الكمية في الفاتورة = ${after}.`,
        interpretation: 'فرق في الكمية على مستوى صنف محدد الهوية — يستحق تدقيقًا تشغيليًا.',
        sourceEvidence: d.evidence,
        ruleIds: ['integrity.items.confirmed_quantity_mismatch'],
        confidence: d.confidence,
        integrityEvaluationScope: scope,
        basketVersion: basketInvoiceMatch.basketVersion,
        invoiceId: basketInvoiceMatch.invoiceId,
        invoiceNumber: basketInvoiceMatch.invoiceNumber,
        expectedValue: before,
        observedValue: after,
        difference: before != null && after != null ? after - before : null,
        needsHumanReview: true,
      });
    }
  });

  if (basketInvoiceMatch.humanReviewReasons.includes('ambiguous_product_alias')) {
    drafts.push({
      type: 'product_identity_conflict',
      stage: 'invoice_items',
      severity: 'review',
      summary: 'تعارض في هوية أحد المنتجات بين بنود السلة وبنود الفاتورة.',
      fact: 'أكثر من بند فاتورة يتطابق نصيًا مع نفس اسم المنتج المؤكد — لم يتم اختيار أحدها تلقائيًا.',
      interpretation: 'يتطلب مراجعة بشرية لتحديد البند الصحيح — لا تخمين آلي.',
      sourceEvidence: [],
      ruleIds: ['integrity.items.product_identity_conflict'],
      confidence: assessment('weakly_inferred', 0.4, ['integrity.items.product_identity_conflict'], []),
      integrityEvaluationScope: scope,
      basketVersion: basketInvoiceMatch.basketVersion,
      invoiceId: basketInvoiceMatch.invoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber,
      needsHumanReview: true,
    });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The single entry point. Consumes only ALREADY-COMPUTED Phase A-E.1 outputs — never re-derives
 * conversation understanding, basket state, attribution, or invoice matching. Returns
 * `exceptions: []` for a healthy flow; missing OPTIONAL evidence (e.g. no item data) is reported
 * via `canEvaluateItemIntegrity`/`integrityEvaluationScope`, never manufactured into a false
 * exception (§15).
 */
export function deriveSalesIntegrityAssessment(input: SalesIntegrityInput): SalesIntegrityAssessment {
  const { caseId, commercialConfirmation, protocolAssessment, attribution, basketInvoiceMatch, knownStaffIds = [] } = input;
  const scope = basketInvoiceMatch.integrityEvaluationScope;

  // Undefined applicability (every pre-G.1 caller/test) defaults to 'applicable' — preserves exact
  // prior behavior for anything that never opted into the Phase G.1 applicability model.
  const applicability: OrderConfirmationProtocolApplicability = protocolAssessment.applicability ?? 'applicable';
  const policyState = deriveProtocolPolicyComplianceState({
    applicability,
    protocolCompliant: protocolAssessment.protocolCompliant,
    caseEndedAt: input.caseEndedAt ?? null,
    protocolPolicyEffectiveAt: input.protocolPolicyEffectiveAt,
  });

  const drafts: ExceptionDraft[] = [
    ...detectProtocolExceptions(input, scope, policyState),
    ...detectAttributionExceptions(input, scope),
    ...detectHeaderExceptions(input, scope),
    ...detectItemExceptions(input, scope),
  ];

  const exceptions: SalesIntegrityException[] = drafts.map((d, index) => ({
    exceptionId: `${caseId}:exception:${index}:${d.type}`,
    caseId,
    type: d.type,
    stage: d.stage,
    severity: d.severity,
    status: 'open',
    summary: d.summary,
    fact: d.fact,
    interpretation: d.interpretation,
    sourceEvidence: d.sourceEvidence,
    ruleIds: d.ruleIds,
    basketVersion: d.basketVersion ?? null,
    invoiceId: d.invoiceId ?? null,
    invoiceNumber: d.invoiceNumber ?? null,
    expectedValue: d.expectedValue ?? null,
    observedValue: d.observedValue ?? null,
    difference: d.difference ?? null,
    differencePercentage: d.differencePercentage ?? null,
    explained: d.explained ?? false,
    explanationKind: d.explanationKind ?? null,
    confidence: d.confidence,
    integrityEvaluationScope: d.integrityEvaluationScope,
    needsHumanReview: d.needsHumanReview ?? false,
    involvedStaffIds: d.involvedStaffIds ?? knownStaffIds,
  }));

  const highestSeverity =
    exceptions.length === 0
      ? null
      : exceptions.reduce<SalesIntegritySeverity>(
          (acc, e) => (SEVERITY_ORDER[e.severity] > SEVERITY_ORDER[acc] ? e.severity : acc),
          'info'
        );

  const earliestBreakStage =
    exceptions.length === 0
      ? null
      : exceptions.reduce<SalesIntegrityStage>(
          (acc, e) => (STAGE_ORDER[e.stage] < STAGE_ORDER[acc] ? e.stage : acc),
          exceptions[0].stage
        );

  const humanReviewReasons = Array.from(
    new Set([
      ...commercialConfirmation.humanReviewReasons,
      ...attribution.humanReviewReasons,
      ...basketInvoiceMatch.humanReviewReasons,
      ...exceptions.filter((e) => e.needsHumanReview).map((e) => e.type as string),
    ])
  );

  const needsHumanReview =
    commercialConfirmation.needsHumanReview ||
    attribution.needsHumanReview ||
    basketInvoiceMatch.needsHumanReview ||
    exceptions.some((e) => e.needsHumanReview);

  const primaryEvidence = exceptions.flatMap((e) => e.sourceEvidence);
  const ruleIds = exceptions.length > 0 ? exceptions.flatMap((e) => e.ruleIds) : ['integrity.assessment.clean'];

  return {
    caseId,
    integrityEvaluationScope: scope,
    commercialState: commercialConfirmation.currentState,
    protocolCompliant: protocolAssessment.protocolCompliant,
    attributionLevel: attribution.attributionLevel,
    basketInvoiceOverallMatch: basketInvoiceMatch.overallMatch,
    exceptions,
    highestSeverity,
    exceptionCount: exceptions.length,
    earliestBreakStage,
    needsHumanReview,
    humanReviewReasons,
    primaryEvidence,
    ruleIds,
    canEvaluateHeaderIntegrity: basketInvoiceMatch.headerEvidenceReady,
    canEvaluateItemIntegrity: basketInvoiceMatch.itemEvidenceReady,
    canEvaluateFulfillmentIntegrity: false,
    protocolPolicyCompliance: policyState,
  };
}
