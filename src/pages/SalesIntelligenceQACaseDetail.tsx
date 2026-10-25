// Sales Intelligence QA Case Detail — Phase H.2.
//
// Reads persisted canonical case truth. Full reanalysis runs only after an explicit command;
// secondary conversation-evaluation evidence loads only when requested. No product search on open.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Building2, Hash, Layers3, Phone, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { getStaffSessionToken } from '@/lib/auth/staffSession';
import { fetchQaCaseDetail, type QaCaseDetailBundle } from '@/lib/salesIntelligence/qa/queries';
import { createSelectedCaseRequestGate, type SelectedCaseRequestGate } from '@/lib/salesIntelligence/qa/selectedCaseRequestGate';
import {
  confirmInvoiceThenReload,
  openSelectedCase,
  type SelectedCaseDetailSink,
} from '@/lib/salesIntelligence/qa/selectedCaseDetailFlow';
import {
  canonicalTrustedInvoiceId,
  describeCanonicalCaseSaleTruth,
  NOT_ANALYZED_LABEL,
} from '@/lib/salesIntelligence/qa/canonicalCaseTruthPresentation';
import {
  buildInvoiceConfirmationDialogText,
  confirmInvoiceCandidateAndRefresh,
  hasConfirmableInvoiceCandidate,
} from '@/lib/salesIntelligence/invoiceLinkConfirmation';
import { requestCanonicalSalesIntelligenceRefresh } from '@/lib/salesIntelligence/refresh/refreshClient';
import { WhatsAppConversationPanel } from '@/components/salesIntelligence/WhatsAppConversationPanel';
import { CaseIntelligenceWorkspace } from '@/components/salesIntelligence/CaseIntelligenceWorkspace';
import { SourceOperationsPanel } from '@/components/salesIntelligence/SourceOperationsPanel';
import { loadConversationEvaluation } from '@/lib/salesIntelligence/conversationEvaluationLoader';
import type { ConversationEvaluationResult } from '@/lib/salesIntelligence/conversationEvaluation';
import { productDisplayStateLabel } from '@/lib/salesIntelligence/qa/persistedProductTruth';
import { readCaseIntelligence } from '@/lib/salesIntelligence/qa/caseIntelligencePresentation';
import { buildCaseInvoiceCard } from '@/lib/salesIntelligence/qa/caseInvoiceCard';
import { CaseInvoiceCard } from '@/components/salesIntelligence/CaseInvoiceCard';
import { WhatsAppDeletionDialog } from '@/components/salesIntelligence/WhatsAppDeletionDialog';
import { canManageWhatsAppDeletions } from '@/lib/core/permissionSystem';
import type { WhatsAppDeletionScope } from '@/lib/salesIntelligence/operations/whatsappDeletionService';

const MATCH_DIFFERENCE_LABELS: Record<string, string> = {
  missing_item: 'صنف في المحادثة غير موجود بالفاتورة',
  extra_item: 'صنف بالفاتورة غير مذكور في المحادثة',
  quantity_mismatch: 'اختلاف الكمية',
  total_mismatch: 'اختلاف الإجمالي',
};
import {
  ambiguityStatusLabelFor,
  attributionLevelBadge,
  branchLabelFor,
  caseTypeLabelFor,
  contradictionReasonsList,
  failureReasonLabelFor,
  fieldMatchBadge,
  historicalClosureBadge,
  integrityScopeBadge,
  itemResolutionStatusLabelFor,
  protocolApplicabilityLabelFor,
  protocolPolicyComplianceLabelFor,
  reviewReasonLabelFor,
  saleProofSourceLabelFor,
  saleProofStateBadge,
  unknownProofReason,
  ruleIdLabelFor,
  pipelineWarningLabelFor,
  attributionLevelLabelFor,
  evidenceCompletenessLabelFor,
  evidenceLevelLabelFor,
  commercialConfirmationStateLabelFor,
} from '@/lib/salesIntelligence/qa/presentation';

/** Exact wording the Final Pilot Readiness spec requires wherever item-level invoice evidence is unavailable — never a paraphrase, so a reviewer never mistakes header-only evaluation for item-level proof. */
const ITEM_EVIDENCE_UNAVAILABLE_TEXT = 'بيانات أصناف الفاتورة غير متاحة حاليًا — التقييم الحالي يعتمد على بيانات رأس الفاتورة فقط';

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="dawaa-card space-y-3">
      <h2 className="dawaa-heading text-base font-black">{title}</h2>
      {children}
    </section>
  );
}

function Evidence({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="dawaa-button dawaa-button--ghost text-xs">
        {open ? 'إخفاء الأدلة' : 'لماذا؟ / عرض الأدلة'}
      </button>
      {open ? <div className="dawaa-body mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-3 text-xs leading-6">{children}</div> : null}
    </div>
  );
}

function salesOutcomeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    sale_proven: 'بيع مثبت بفاتورة موثوقة',
    order_confirmed_unproven: 'أوردر مؤكد بالشات — البيع غير مثبت',
    customer_confirmed_unproven: 'العميل وافق — الإغلاق/البيع غير مثبت',
    open_opportunity: 'فرصة بيعية مفتوحة',
    customer_rejected: 'العميل رفض',
    information_only: 'استفسار / معلومات فقط',
    needs_review: 'تحتاج مراجعة بشرية',
    unknown: 'غير محسومة',
  };
  return labels[String(value || 'unknown')] || String(value || 'غير محسومة');
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3">
      <div className="dawaa-muted text-xs">{label}</div>
      <div className="dawaa-heading mt-1 text-sm font-bold">{value ?? '—'}</div>
    </div>
  );
}

function pricingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    no_discount_observed: 'لا يوجد خصم ظاهر',
    authorized_offer_match: 'عرض ساري منفذ بالسعر الصحيح',
    offer_price_mismatch_review: 'عرض ساري لكن سعر التنفيذ يحتاج مراجعة',
    discount_needs_review: 'خصم يحتاج مراجعة الاعتماد',
    invoice_discount_review: 'خصم عام على الفاتورة يحتاج مراجعة',
    insufficient_data: 'بيانات السعر غير كافية',
  };
  return labels[status] || status;
}

function quotedPriceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    exact: 'السعر مطابق',
    near_match: 'فرق بسيط',
    mismatch_review: 'فرق سعر يحتاج مراجعة',
    not_quoted: 'لم يُذكر سعر واضح',
    insufficient_data: 'بيانات غير كافية',
  };
  return labels[status] || status;
}

function recommendationConversionLabel(status: string) {
  const labels: Record<string, string> = {
    official_sale: 'بيع رسمي مثبت',
    candidate_invoice_match: 'ظهر في فاتورة مرشحة فقط',
    accepted_waiting_official_invoice: 'العميل وافق — انتظار فاتورة رسمية',
    recommended_not_accepted: 'ترشيح بدون قبول مثبت',
    rejected: 'العميل رفض الترشيح',
    ambiguous_recommender: 'دكتور الترشيح غير محسوم',
    product_identity_unresolved: 'هوية الصنف غير محسومة',
  };
  return labels[status] || status;
}

export default function SalesIntelligenceQACaseDetail() {
  const { caseId: rawCaseId } = useParams<{ caseId: string }>();
  const caseId = rawCaseId ? decodeURIComponent(rawCaseId) : '';
  const navigate = useNavigate();
  const { checkPermission, user } = useAuth();
  // UI mirror only; dawaa_whatsapp_deletion_actor_v1 decides in the database.
  const canDelete = canManageWhatsAppDeletions(user?.role);
  const [deletionScope, setDeletionScope] = useState<WhatsAppDeletionScope | null>(null);
  const [bundle, setBundle] = useState<QaCaseDetailBundle | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [invoiceConfirming, setInvoiceConfirming] = useState(false);
  const [invoiceConfirmationMessage, setInvoiceConfirmationMessage] = useState<string | null>(null);
  const [invoiceConfirmationError, setInvoiceConfirmationError] = useState<string | null>(null);
  const [legacyAuditOpen, setLegacyAuditOpen] = useState<boolean | null>(null);
  const [evaluationRequestedFor, setEvaluationRequestedFor] = useState<string | null>(null);
  const [conversationEvaluation, setConversationEvaluation] = useState<ConversationEvaluationResult | null>(null);
  const [conversationEvaluationLoading, setConversationEvaluationLoading] = useState(false);
  const [conversationEvaluationWarning, setConversationEvaluationWarning] = useState<string | null>(null);

  // The selected case id is authoritative: every async result (load, confirm, reload) commits
  // through this gate and is dropped once the user has moved to another case or left the page.
  const gateRef = useRef<SelectedCaseRequestGate | null>(null);
  if (!gateRef.current) gateRef.current = createSelectedCaseRequestGate();
  const gate = gateRef.current;
  const sink: SelectedCaseDetailSink<QaCaseDetailBundle> = {
    setBundle,
    setError,
    setConfirmationMessage: setInvoiceConfirmationMessage,
    setConfirmationError: setInvoiceConfirmationError,
    setConfirming: setInvoiceConfirming,
  };
  const loadDetail = (id: string, signal: AbortSignal) => fetchQaCaseDetail(supabase, id, { signal });

  useEffect(() => {
    setEvaluationRequestedFor(null);
    if (!caseId) return undefined;
    // gate, sink setters and loader are stable for the component's lifetime.
    return openSelectedCase(gate, caseId, loadDetail, sink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    const currentView = readCaseIntelligence(bundle?.persisted.analysisRow);

    if (!currentView || evaluationRequestedFor !== `${caseId}:${bundle?.persisted.analysisRow.analysis_id}`) {
      setConversationEvaluation(null);
      setConversationEvaluationLoading(false);
      setConversationEvaluationWarning(null);
      return () => { cancelled = true; };
    }

    setConversationEvaluationLoading(true);
    setConversationEvaluationWarning(null);
    void loadConversationEvaluation(currentView).then((loaded) => {
      if (cancelled) return;
      setConversationEvaluation(loaded.result);
      setConversationEvaluationWarning(loaded.warning);
      setConversationEvaluationLoading(false);
    }).catch((cause) => {
      if (cancelled) return;
      setConversationEvaluation(null);
      setConversationEvaluationWarning(cause instanceof Error ? cause.message : 'تعذر بناء تحليل المحادثة.');
      setConversationEvaluationLoading(false);
    });

    return () => { cancelled = true; };
  }, [bundle, caseId, evaluationRequestedFor]);

  if (error) {
    return <div className="dawaa-alert dawaa-alert--danger text-sm font-bold" dir="rtl">{error}</div>;
  }
  if (bundle === undefined) {
    return <div className="dawaa-muted py-16 text-center" dir="rtl"><RefreshCw className="mx-auto mb-3 animate-spin" /> جاري التحميل...</div>;
  }
  if (bundle === null) {
    return <div className="dawaa-empty-state py-16 text-center" dir="rtl">لم يتم العثور على هذه الحالة.</div>;
  }

  const { persisted, conversation, sourceSnapshot, siblingCases, transcript, canonicalTruth, persistedProofEvidence, conversationReread, conversationRereadError, recommendationConversions, invoiceStaffTruth, invoiceItemFacts, catalogProductMatches } = bundle;
  const evaluationKey = `${caseId}:${persisted.analysisRow.analysis_id}`;
  const persistedAnalysis = persisted.analysisRow;
  const persistedAttribution = persisted.attributionRow;
  const persistedMatch = persisted.matchRow;
  const analysis = persistedAnalysis;
  const attribution = persistedAttribution;
  const match = persistedMatch;
  const policyEvaluation = persisted.policyEvaluationRow;
  // Case Intelligence is read from the persisted current analysis only.
  const caseIntelligence = readCaseIntelligence(persistedAnalysis);
  const showLegacyAudit = legacyAuditOpen ?? !caseIntelligence;
  const activeBasket = conversationReread?.activeBasket ?? null;
  const basketItems = conversationReread?.basketItems ?? [];
  const unresolvedItems = basketItems.filter((item) => item.resolutionStatus !== 'proven' || item.quantity === null);
  const completeness = (analysis.evidence_snapshot?.evidenceCompleteness ?? {}) as Record<string, unknown>;
  const completenessEntries = Object.entries(completeness).filter(([key]) => key !== 'overallEvidenceLevel');
  const availableEvidenceCount = completenessEntries.filter(([, value]) => value === true).length;
  const evidenceCoveragePercent = completenessEntries.length ? Math.round((availableEvidenceCount / completenessEntries.length) * 100) : 0;
  const attributionConfidencePercent = attribution?.confidence_score == null ? null : Math.round(Number(attribution.confidence_score) * 100);
  const classificationConfidencePercent = Math.round(Number(analysis.evidence_snapshot?.conversationCaseConfidence?.score ?? 0) * 100);
  const basketKnownQuantities = basketItems.filter((item) => item.quantity != null).length;
  const currentSalesOutcome = canonicalTruth.outcome;
  const canonicalTruthRows = describeCanonicalCaseSaleTruth(canonicalTruth);
  const trustedInvoiceId = canonicalTrustedInvoiceId(canonicalTruth);
  const outcomeLabel = currentSalesOutcome ? salesOutcomeLabel(currentSalesOutcome.outcome) : NOT_ANALYZED_LABEL;
  const proofStateBadge = currentSalesOutcome ? saleProofStateBadge(currentSalesOutcome.saleProofState) : NOT_ANALYZED_LABEL;
  const countableLabel = (value: boolean | undefined) => currentSalesOutcome ? (value ? 'نعم' : 'لا') : NOT_ANALYZED_LABEL;
  const priceQuotedRows = invoiceItemFacts.filter((item) => item.quotedUnitPrice != null);
  const priceExactRows = priceQuotedRows.filter((item) => item.quotedPriceStatus === 'exact' || item.quotedPriceStatus === 'near_match');
  const priceMismatchRows = priceQuotedRows.filter((item) => item.quotedPriceStatus === 'mismatch_review');
  const attributionRuleIds = Array.isArray(attribution?.rule_ids) ? attribution.rule_ids.map((value: unknown) => String(value)) : [];
  const invoiceLinkMethod = trustedInvoiceId
    ? (attributionRuleIds.includes('attribution.trusted.automatic_customer_code_name_time_items_unique') ? 'automatic' : 'explicit')
    : null;
  const quotedPriceAccuracyPercent = priceQuotedRows.length
    ? Math.round((priceExactRows.length / priceQuotedRows.length) * 100)
    : null;
  const candidateInvoice = bundle.candidateInvoice;
  const candidateInvoiceId = canonicalTruth.attribution?.selectedInvoiceId ?? null;
  const candidateInvoiceNumber = candidateInvoice?.invoiceNumber || canonicalTruth.attribution?.selectedInvoiceNumber || null;
  const invoiceAlreadyConfirmed = Boolean(conversation?.invoiceLinkConfirmed);
  const invoiceConfirmationMatchesCandidate = Boolean(
    invoiceAlreadyConfirmed &&
      conversation?.invoiceLinkConfirmedInvoiceId &&
    conversation.invoiceLinkConfirmedInvoiceId === candidateInvoiceId &&
    conversation.invoiceLinkConfirmedInvoiceNumber === candidateInvoiceNumber
  );
  const invoiceAlreadyProven = Boolean(trustedInvoiceId && trustedInvoiceId === candidateInvoiceId);
  const invoiceCard = buildCaseInvoiceCard({
    view: caseIntelligence,
    attribution: canonicalTruth.attribution
      ? {
          attributionLevel: canonicalTruth.attribution.attributionLevel,
          selectedInvoiceId: canonicalTruth.attribution.selectedInvoiceId,
          selectedInvoiceNumber: canonicalTruth.attribution.selectedInvoiceNumber,
          isOfficialForStaffEvaluation: canonicalTruth.attribution.isOfficialForStaffEvaluation,
        }
      : null,
    automaticProofRule: invoiceLinkMethod === 'automatic',
    humanLinkConfirmed: invoiceConfirmationMatchesCandidate,
    outcome: currentSalesOutcome
      ? {
          isOrderConfirmed: currentSalesOutcome.isOrderConfirmed,
          saleProofState: currentSalesOutcome.saleProofState,
          isSaleCountable: currentSalesOutcome.isSaleCountable,
          isRevenueCountable: currentSalesOutcome.isRevenueCountable,
        }
      : null,
    invoice: candidateInvoice,
    items: invoiceItemFacts,
    invoiceStaff: invoiceStaffTruth,
    source: conversation ? { branch: conversation.branch, customerId: conversation.customerId, customerCode: conversation.customerCode } : null,
    analysisCustomerId: persistedAnalysis.identity_customer_id ?? null,
  });
  const canConfirmInvoiceLink = Boolean(
    checkPermission('edit_reviews') ||
    checkPermission('approve_reviews') ||
    checkPermission('manage_conversation_evaluations')
  );
  const canConfirmCandidate = hasConfirmableInvoiceCandidate({
    sourceId: conversation?.id,
    invoiceId: candidateInvoiceId,
    invoiceNumber: candidateInvoiceNumber,
    sourceIsCanonical: sourceSnapshot.isCanonical,
    alreadyConfirmed: invoiceAlreadyConfirmed,
    alreadyConfirmedInvoiceId: conversation?.invoiceLinkConfirmedInvoiceId,
    alreadyProven: invoiceAlreadyProven,
  }) && Boolean(candidateInvoice?.id === candidateInvoiceId && canConfirmInvoiceLink);

  async function reanalyzeSelectedCase() {
    if (!canConfirmInvoiceLink || !sourceSnapshot.isCanonical || !conversation || invoiceConfirming) return;
    const token = getStaffSessionToken();
    if (!token) { setInvoiceConfirmationError('جلسة الموظف الموثقة غير متاحة.'); return; }
    const sourceId = conversation.id;
    await confirmInvoiceThenReload(gate, async () => {
      const result = await requestCanonicalSalesIntelligenceRefresh({sourceIds:[sourceId], accessToken:token});
      const failure = result.errors.map(item => item.message).join('؛ ') ||
        (result.bySource[sourceId]?.status !== 'allowed'
          ? result.bySource[sourceId]?.reason || 'تعذر إكمال التحليل القياسي.'
          : null);
      if (failure) throw new Error(failure);
      return { message: 'تمت إعادة التحليل وحفظ النتيجة القياسية.', refreshFailure: null };
    }, loadDetail, sink);
  }

  async function confirmSelectedInvoice() {
    if (!canConfirmCandidate || !conversation || !candidateInvoice || !candidateInvoiceNumber || !candidateInvoiceId) return;
    const confidence = conversation.invoiceMatchConfidence == null
      ? attributionConfidencePercent == null ? 'غير متاحة' : `${attributionConfidencePercent}٪`
      : `${Math.round(conversation.invoiceMatchConfidence * 100)}٪`;
    const reason = conversation.invoiceMatchReason || 'مرشح الإسناد الحالي في تحليل Sales Intelligence.';
    const details = buildInvoiceConfirmationDialogText({
      invoiceNumber: candidateInvoiceNumber,
      customer: `${candidateInvoice.customerName || conversation.customerName || 'غير متاح'} (${candidateInvoice.customerCode || conversation.customerCode || 'بدون كود'})`,
      branch: candidateInvoice.branch || 'غير متاح',
      staff: candidateInvoice.staffName || 'غير متاح',
      datetime: candidateInvoice.invoiceDatetime ? formatDateTime(candidateInvoice.invoiceDatetime) : 'غير متاح',
      total: candidateInvoice.total == null ? 'غير متاح' : `${candidateInvoice.total.toLocaleString('ar-EG')} ج.م`,
      confidence,
      reason,
      retryingRefresh: invoiceConfirmationMatchesCandidate,
    });
    if (!window.confirm(details)) return;

    const sessionToken = getStaffSessionToken();
    if (!sessionToken) {
      setInvoiceConfirmationError('تعذر التأكيد: جلسة الموظف الموثقة غير متاحة.');
      return;
    }

    const sourceId = conversation.id;
    const invoiceId = candidateInvoiceId;
    const invoiceNumber = candidateInvoiceNumber;
    await confirmInvoiceThenReload(
      gate,
      async () => {
        const { confirmation, refresh } = await confirmInvoiceCandidateAndRefresh(supabase, {
          sourceId,
          invoiceId,
          invoiceNumber,
        }, (id) => requestCanonicalSalesIntelligenceRefresh({
          sourceIds: [id],
          accessToken: sessionToken,
        }));
        let refreshFailure: string | null = null;
        const sourceStatus = refresh.bySource[sourceId];
        if (refresh.errors.length || sourceStatus?.status !== 'allowed') {
          refreshFailure = refresh.errors.map((item) => item.message).join('؛ ') ||
            sourceStatus?.reason ||
            'canonical_refresh_not_completed';
        }
        return {
          message: confirmation.idempotent
            ? 'رابط الفاتورة كان معتمدًا بالفعل.'
            : 'تم اعتماد رابط الفاتورة؛ قرار إثبات البيع يظل صادرًا من المحرك فقط.',
          refreshFailure,
        };
      },
      loadDetail,
      sink
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => navigate('/sales-intelligence/qa')} className="dawaa-button dawaa-button--secondary">
          <ArrowRight size={16} /> رجوع للقائمة
        </button>
        <div className="dawaa-muted max-w-full truncate font-mono text-xs" title={caseId}>{caseId}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canConfirmInvoiceLink && sourceSnapshot.isCanonical && conversation ? (
          <button type="button" className="dawaa-button dawaa-button--secondary" disabled={invoiceConfirming} onClick={() => void reanalyzeSelectedCase()}>
            {invoiceConfirming ? 'جارٍ تنفيذ الطلب...' : 'إعادة التحليل الصريحة'}
          </button>
        ) : null}
        {caseIntelligence && evaluationRequestedFor !== evaluationKey ? (
          <button type="button" className="dawaa-button dawaa-button--ghost" onClick={() => setEvaluationRequestedFor(evaluationKey)}>تحميل تفاصيل تقييم المحادثة</button>
        ) : null}
        {canDelete ? (
          <>
            <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => setDeletionScope('case')}>
              <Trash2 size={15} /> حذف هذه الحالة فقط
            </button>
            {conversation ? (
              <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => setDeletionScope('conversation')}>
                <Trash2 size={15} /> حذف المحادثة كاملةً مع كل حالاتها ({Math.max(siblingCases.length, 1).toLocaleString('ar-EG')} حالة)
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {deletionScope ? (
        <WhatsAppDeletionDialog
          scope={deletionScope}
          target={deletionScope === 'case' ? caseId : conversation!.id}
          onClose={() => setDeletionScope(null)}
          onDeleted={() => {
            setDeletionScope(null);
            navigate('/sales-intelligence/qa');
          }}
        />
      ) : null}
      {conversationRereadError ? <div className="dawaa-alert dawaa-alert--warning text-sm">{conversationRereadError}</div> : null}
      {invoiceConfirmationMessage ? <div className="dawaa-alert dawaa-alert--success text-sm">{invoiceConfirmationMessage}</div> : null}
      {invoiceConfirmationError ? <div className="dawaa-alert dawaa-alert--danger text-sm">{invoiceConfirmationError}</div> : null}

      {!sourceSnapshot.isCanonical ? (
        <div className="dawaa-alert dawaa-alert--warning text-sm leading-7">
          هذه الحالة مبنية على لقطة واتساب أقدم تم احتواؤها لاحقًا داخل نسخة أشمل من نفس المحادثة. تُعرض هنا للـAudit فقط ولا ينبغي اعتمادها كالحالة الحالية.
          {sourceSnapshot.canonicalSourceId ? <span className="ms-1 font-mono text-xs">المصدر الأحدث: {sourceSnapshot.canonicalSourceId}</span> : null}
        </div>
      ) : null}

      {conversation && sourceSnapshot.isCanonical ? (
        <SourceOperationsPanel
          sourceId={conversation.id}
          analysisKey={persistedAnalysis.analysis_id}
          permissions={{
            // Mirrors the database commands, which remain the enforcing boundary.
            canCorrect: checkPermission('approve_reviews'),
            canApprove: checkPermission('approve_reviews') || checkPermission('manage_conversation_evaluations') || checkPermission('manage_customer_requests'),
            canExecute: checkPermission('add_reviews') || checkPermission('edit_reviews') || checkPermission('manage_conversation_evaluations'),
          }}
        />
      ) : null}

      <Section title="الحقيقة البيعية المعتمدة لهذه الحالة">
        <div className="dawaa-muted text-xs leading-6">
          تُعرض القيم كما حفظها المحرك الرسمي لهذه الحالة فقط (التحليل الحالي + سجل البيع المعتمد). لا يُعاد حساب أي قرار بيعي في هذه الشاشة،
          البيع المثبت بالفاتورة مستقل عن اكتمال تأكيد السلة في المحادثة وعن إثبات استلام العميل.
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {canonicalTruthRows.map((row) => (
            <Field
              key={row.key}
              label={row.label}
              value={<span className={row.tone === 'success' ? 'dawaa-badge dawaa-badge--success' : row.tone === 'warning' ? 'dawaa-badge dawaa-badge--warning' : row.tone === 'danger' ? 'dawaa-badge dawaa-badge--danger' : ''}>{row.value}</span>}
            />
          ))}
        </div>
      </Section>

      <CaseIntelligenceWorkspace
        view={caseIntelligence}
        conversationPanel={conversation ? (
          <WhatsAppConversationPanel
            messages={transcript}
            customerName={conversation.customerName}
            customerCode={conversation.customerCode}
            customerPhone={conversation.customerPhone}
            branch={conversation.branch}
            caseStartedAt={analysis.case_started_at}
            caseEndedAt={analysis.case_ended_at}
            caseMessageIds={caseIntelligence?.interaction.messageIds ?? null}
          />
        ) : null}
        staffDisplayName={conversation?.staffId ? conversation.staffName : null}
        conversationEvaluation={evaluationRequestedFor === evaluationKey ? conversationEvaluation : null}
        conversationEvaluationRequested={evaluationRequestedFor === evaluationKey}
        conversationEvaluationLoading={evaluationRequestedFor === evaluationKey && conversationEvaluationLoading}
        conversationEvaluationWarning={evaluationRequestedFor === evaluationKey ? conversationEvaluationWarning : null}
        invoiceEvidence={{
          status: trustedInvoiceId ? 'trusted' : candidateInvoiceId ? 'candidate' : 'none',
          linkMethod: invoiceLinkMethod,
          invoiceNumber: candidateInvoiceNumber,
          invoiceCustomerName: candidateInvoice?.customerName ?? null,
          invoiceCustomerCode: candidateInvoice?.customerCode ?? null,
          invoiceBranch: candidateInvoice?.branch ?? null,
          invoiceSellerName: candidateInvoice?.staffName ?? null,
          // Read-only candidate lines stay visible as invoice evidence. The workspace
          // decides whether they are trusted; they must never fill chat/media needs.
          items: candidateInvoiceId
            ? invoiceItemFacts
                .filter((item) => item.invoiceId === candidateInvoiceId)
                .map((item) => ({
                  id: item.id,
                  productName: item.productName,
                  productCode: item.productCode,
                  quantity: item.effectiveQuantity ?? item.quantity,
                  unitName: item.unitName,
                  netLineAmount: item.netLineAmount,
                }))
            : [],
        }}
      />

      <button type="button" className="dawaa-button dawaa-button--ghost text-xs" onClick={() => setLegacyAuditOpen(!showLegacyAudit)}>
        {showLegacyAudit ? 'إخفاء التدقيق التفصيلي السابق' : 'عرض التدقيق التفصيلي السابق (متقدم)'}
      </button>

      {showLegacyAudit ? (<>
      <section className="dawaa-card">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="العميل" value={<span className="inline-flex items-center gap-2"><UserRound size={16} /> {conversation?.customerName || 'عميل غير مسمى'}</span>} />
          <Field label="كود العميل" value={<span className="inline-flex items-center gap-2"><Hash size={16} /> {conversation?.customerCode || 'غير متاح'}</span>} />
          <Field label="رقم الهاتف" value={<span className="inline-flex items-center gap-2"><Phone size={16} /> {conversation?.customerPhone || 'غير متاح'}</span>} />
          <Field label="فرع مصدر المحادثة" value={<span className="inline-flex items-center gap-2"><Building2 size={16} /> {branchLabelFor(conversation?.branch ?? null)}</span>} />
          <Field label="نوع الحالة" value={caseTypeLabelFor(analysis.case_type)} />
          <Field label="العملية البيعية" value={outcomeLabel} />
          <Field label="إثبات البيع" value={proofStateBadge} />
          <Field label="مستوى الإسناد" value={attributionLevelBadge(attribution?.attribution_level ?? analysis.attribution_level)} />
          <Field label="تقسيم المصدر" value={<span className="inline-flex items-center gap-2"><Layers3 size={16} /> {siblingCases.length > 1 ? `${siblingCases.length} أجزاء` : 'جزء واحد'}</span>} />
        </div>
      </section>

      <Section title="المراجعة الذكية الشاملة — ملخص الحالة بالكامل">
        {conversationRereadError ? (
          <div className="dawaa-alert dawaa-alert--warning mb-3 text-xs leading-6">
            حالة السلة المحفوظة ({conversationRereadError}). القيم البيعية المعروضة محفوظة ولا تتأثر بذلك.
          </div>
        ) : null}
        <div className="dawaa-alert dawaa-alert--info text-xs leading-6">
          هذا الملخص يجمع نتائج كل مسارات التحليل الحالية في مكان واحد: هوية العميل، تقسيم المحادثة، الطلب والسلة، القبول والتأكيد،
          مطابقة الأصناف، الفواتير، إثبات البيع، وما ينقصنا من أدلة. لا يتم اختراع أي معلومة غير موجودة، وأي نقطة غير محسومة تظهر بوضوح.
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">هوية العميل</div>
            <div className="dawaa-heading mt-2 font-black">{conversation?.customerName || 'غير معروف'}</div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              الكود: {conversation?.customerCode || 'غير متاح'}<br />
              الهاتف: {conversation?.customerPhone || 'غير متاح'}<br />
              فرع مصدر المحادثة: {branchLabelFor(conversation?.branch ?? null)}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">فهم المحادثة</div>
            <div className="dawaa-heading mt-2 font-black">{caseTypeLabelFor(analysis.case_type)}</div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              ثقة التصنيف: {classificationConfidencePercent}٪<br />
              عدد أجزاء نفس المحادثة: {Math.max(1, siblingCases.length)}<br />
              بداية الحالة: {formatDateTime(analysis.case_started_at)}<br />
              النهاية: {analysis.case_ended_at ? formatDateTime(analysis.case_ended_at) : 'مستمرة'}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">الطلب والسلة</div>
            <div className="dawaa-heading mt-2 font-black">{basketItems.length ? basketItems.length + ' صنف/طلب ظاهر' : 'لا توجد سلة مكتملة'}</div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              كميات محسومة: {basketKnownQuantities} من {basketItems.length}<br />
              أصناف التحليل المحفوظ: {catalogProductMatches.length}<br />
              الإجمالي المعلن: {activeBasket?.announcedTotal?.amount ?? 'غير متاح'}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">القرار الشرائي</div>
            <div className="dawaa-heading mt-2 font-black">{outcomeLabel}</div>
            <div className="dawaa-body mt-1 text-xs text-[var(--dawaa-theme-muted)]">
              حالة تأكيد الطلب: {commercialConfirmationStateLabelFor(analysis.commercial_confirmation_state)}
            </div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              مستوى الإغلاق التاريخي: {historicalClosureBadge(analysis.historical_closure_level)}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">الفاتورة والإسناد</div>
            <div className="dawaa-heading mt-2 font-black">{attribution?.selected_invoice_number ? 'فاتورة ' + attribution.selected_invoice_number : 'لا توجد فاتورة مختارة'}</div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              مستوى الإسناد: {attributionLevelLabelFor(attribution?.attribution_level ?? analysis.attribution_level)}<br />
              ثقة الإسناد: {attributionConfidencePercent == null ? 'غير متاحة' : attributionConfidencePercent + '٪'}<br />
              عدد المرشحين: {attribution?.candidate_count ?? 0} • حالات منافسة: {attribution?.competing_case_ids?.length ?? 0}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">الدكتور الحقيقي على فاتورة B-Connect</div>
            <div className="dawaa-heading mt-2 font-black">
              {invoiceStaffTruth?.canonicalStaffName || invoiceStaffTruth?.invoiceStaffNameRaw || 'غير محسوم'}
            </div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              {invoiceStaffTruth ? (
                <>
                  حالة الربط: {
                    invoiceStaffTruth.resolutionStatus === 'resolved_by_staff_id' ? 'مؤكد من Staff ID' :
                    invoiceStaffTruth.resolutionStatus === 'resolved_by_unique_name' ? 'تطابق اسم وحيد' :
                    invoiceStaffTruth.resolutionStatus === 'ambiguous_name' ? 'الاسم يطابق أكثر من موظف — ممنوع التخمين' :
                    invoiceStaffTruth.resolutionStatus === 'missing_invoice_staff' ? 'الفاتورة لا تحتوي موظفًا' :
                    'غير محسوم'
                  }<br />
                  {invoiceStaffTruth.canonicalStaffRole ? <>الدور: {invoiceStaffTruth.canonicalStaffRole}<br /></> : null}
                  {invoiceStaffTruth.canonicalStaffBranch ? <>فرع الموظف: {invoiceStaffTruth.canonicalStaffBranch}<br /></> : null}
                  أدلة الأصناف على الفاتورة: {invoiceStaffTruth.itemEvidenceAvailable ? 'متاحة' : 'غير متاحة'}
                </>
              ) : (
                <>لا يوجد Staff Attribution رسمي لهذه الحالة حتى الآن.</>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
            <div className="dawaa-muted text-xs">إثبات البيع وجودة الأدلة</div>
            <div className="mt-2">{proofStateBadge}</div>
            <div className="dawaa-body mt-2 text-xs leading-6">
              تغطية الأدلة المتاحة: {evidenceCoveragePercent}٪<br />
              {evidenceLevelLabelFor(String(completeness.overallEvidenceLevel ?? analysis.overall_evidence_level))}<br />
              بيع قابل للعد رسميًا: {countableLabel(currentSalesOutcome?.isSaleCountable)}<br />
              إيراد قابل للعد رسميًا: {countableLabel(currentSalesOutcome?.isRevenueCountable)}<br />
              مراجعة بشرية: {analysis.needs_human_review ? 'مطلوبة' : 'غير مطلوبة'}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="dawaa-heading mb-2 text-sm font-black">خريطة الأدلة — ماذا نعرف فعليًا؟</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {completenessEntries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2 text-xs">
                <span>{evidenceCompletenessLabelFor(key)}</span>
                <span className={value === true ? 'dawaa-badge dawaa-badge--success' : 'dawaa-badge dawaa-badge--warning'}>
                  {value === true ? 'متاح' : 'غير متاح'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-3 text-xs leading-6">
            <div className="mb-1 font-black text-emerald-300">النقاط المؤكدة أو المدعومة حاليًا</div>
            <div>• هوية العميل: {conversation?.customerCode && conversation?.customerPhone ? 'مرتبطة ببيانات واضحة' : 'غير مكتملة'}</div>
            <div>• تصنيف الحالة: {caseTypeLabelFor(analysis.case_type)} — {classificationConfidencePercent}٪</div>
            <div>• الفاتورة: {attribution?.selected_invoice_number ? 'مرشحة رقم ' + attribution.selected_invoice_number : 'لا توجد فاتورة مرشحة'}</div>
            <div>• الأصناف: {catalogProductMatches.length ? catalogProductMatches.length + ' صنف من التحليل المحفوظ' : 'لا توجد مطابقة كتالوج حاليًا'}</div>
          </div>

          <div className="rounded-xl border border-amber-700/30 bg-amber-950/10 p-3 text-xs leading-6">
            <div className="mb-1 font-black text-amber-300">ما الذي يمنع اليقين الكامل؟</div>
            {analysis.failure_reasons?.length ? (
              analysis.failure_reasons.map((reason: string) => <div key={reason}>• {failureReasonLabelFor(reason)}</div>)
            ) : (
              <div>لا توجد أسباب نقص أدلة مسجلة لهذه الحالة.</div>
            )}
          </div>
        </div>
      </Section>

      {/* 1. Full source conversation */}
      <Section title="١. المحادثة الأصلية — عرض واقعي كامل">
        {!conversation ? (
          <div className="dawaa-empty-state py-6 text-center">لا يوجد نص محادثة مرتبط بهذه الحالة.</div>
        ) : (
          <WhatsAppConversationPanel
            messages={transcript}
            customerName={conversation.customerName}
            customerCode={conversation.customerCode}
            customerPhone={conversation.customerPhone}
            branch={conversation.branch}
            caseStartedAt={analysis.case_started_at}
            caseEndedAt={analysis.case_ended_at}
          />
        )}
      </Section>

      {/* 2. Case segmentation */}
      <Section title="٢. تقسيم المحادثة إلى حالات">
        <div className="dawaa-alert dawaa-alert--info text-xs">
          المصدر الأصلي معروض كاملًا في الأعلى. الحدود أدناه هي تقسيم المحرك لنفس المحادثة، وليست محادثات واتساب منفصلة.
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="بداية الجزء الحالي" value={formatDateTime(analysis.case_started_at)} />
          <Field label="نهاية الجزء الحالي" value={analysis.case_ended_at ? formatDateTime(analysis.case_ended_at) : '—'} />
          <Field label="نوع الجزء" value={caseTypeLabelFor(analysis.case_type)} />
        </div>
        {siblingCases.length > 1 ? (
          <div className="mt-3">
            <div className="dawaa-muted mb-2 text-xs">أجزاء نفس المحادثة — اضغط للتنقل ومقارنة التقسيم:</div>
            <div className="flex flex-wrap gap-2">
              {siblingCases.map((sibling, index) => (
                <button
                  key={sibling.caseId}
                  type="button"
                  onClick={() => navigate(`/sales-intelligence/qa/${encodeURIComponent(sibling.caseId)}`)}
                  className={sibling.isCurrent ? 'dawaa-badge dawaa-badge--info px-3 py-2 text-xs font-black' : 'dawaa-button dawaa-button--secondary text-xs'}
                  title={sibling.caseId}
                >
                  جزء {index + 1} • {sibling.startedAt ? formatDateTime(sibling.startedAt) : 'وقت غير معروف'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="dawaa-alert dawaa-alert--success mt-3 text-xs">المحادثة لم تُقسّم إلى أكثر من حالة محفوظة.</div>
        )}
        <Evidence>
          <div>ثقة تصنيف المحادثة: {attributionLevelLabelFor(analysis.evidence_snapshot?.conversationCaseConfidence?.level ?? 'unknown')} — {Math.round(Number(analysis.evidence_snapshot?.conversationCaseConfidence?.score ?? 0) * 100)}٪</div>
          {analysis.evidence_snapshot?.conversationCaseConfidence?.ruleIds?.length ? (
            <div className="mt-1">قواعد التحليل: {analysis.evidence_snapshot.conversationCaseConfidence.ruleIds.map(ruleIdLabelFor).join('، ')}</div>
          ) : null}
          {analysis.pipeline_warnings?.length ? (
            <div className="mt-2 text-amber-300">تنبيهات التقسيم: {analysis.pipeline_warnings.map(pipelineWarningLabelFor).join('، ')}</div>
          ) : <div className="mt-2">لا توجد تحذيرات تقسيم محفوظة.</div>}
        </Evidence>
      </Section>

      {/* 3. Basket understanding (live, conversation-only re-derivation) */}
      <Section title="٣. فهم السلة — التحليل الحالي">
        <div className="dawaa-alert dawaa-alert--info text-xs">
          ملاحظة: هذا القسم يعرض ناتج محرك السلة المستخدم حاليًا في مسار التحليل، مع إبقاء أي نتائج غير محسومة واضحة للمراجع دون افتراضات.
          هذا قيد معروف، وليس خطأ إخفاء.
        </div>
        {!activeBasket || !basketItems.length ? (
          <div className="dawaa-empty-state py-4 text-center font-bold">لم يتم تكوين سلة موثوقة</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                    {['الصنف', 'الكمية', 'الحالة', 'الثقة', 'رسالة المصدر'].map((h) => <th key={h} className="p-2">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {basketItems.map((item) => (
                    <tr key={item.itemId} className="border-b border-[var(--dawaa-theme-border)]/60">
                      <td className="p-2">{item.productNameRaw}</td>
                      <td className="p-2">{item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}</td>
                      <td className="p-2">{itemResolutionStatusLabelFor(item.resolutionStatus)}</td>
                      <td className="p-2">{item.confidence?.level ? attributionLevelLabelFor(item.confidence.level) : '—'}</td>
                      <td className="dawaa-muted p-2 font-mono">{item.sourceMessageId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {activeBasket.announcedTotal ? <div className="dawaa-body mt-2 text-xs">الإجمالي المُعلن: {activeBasket.announcedTotal.amount}</div> : null}
          </>
        )}
      </Section>

      <Section title="٣.ب. مطابقة أصناف المحادثة مع كتالوج الصيدلية">
        <div className="dawaa-muted text-xs">
          هوية الأصناف من التحليل القياسي المحفوظ لهذه الحالة. الصنف غير المحسوم يحتاج مراجعة بشرية؛ الهوية وحدها لا تثبت البيع.
        </div>
        {!catalogProductMatches.length ? (
          <div className="dawaa-empty-state py-4 text-center">لا توجد هوية أصناف محفوظة لهذه الحالة. يمكن استخدام إعادة التحليل الصريحة.</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                  {['النص في المحادثة', 'الصنف القياسي', 'كود الصنف', 'المصدر', 'حالة الهوية'].map((h) => <th key={h} className="p-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {catalogProductMatches.map((match) => (
                  <tr key={match.key} className="border-b border-[var(--dawaa-theme-border)]/60">
                    <td className="max-w-[360px] p-2">{match.rawPhrase}</td>
                    <td className="p-2 font-bold">{match.productName ?? 'غير محسوم'}</td>
                    <td className="p-2 font-mono">{match.productCode ?? '—'}</td>
                    <td className="p-2">{match.source === 'persisted_need' ? 'احتياج محفوظ' : 'سلة محفوظة'}</td>
                    <td className="p-2">
                      <span className={match.state === 'CANONICAL_MATCH' ? 'dawaa-badge dawaa-badge--success' : 'dawaa-badge dawaa-badge--warning'}>
                        {productDisplayStateLabel(match.state)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 4. Quantity / references / unresolved signals (NEW) */}
      <Section title="٤. الكمية والإشارات غير المحسومة">
        <div className="dawaa-muted text-xs">
          يعرض هذا القسم أصناف السلة التي لم تصل إلى حالة «مؤكد» أو التي لم تُحسم كميتها بعد، اعتمادًا على نفس نتائج محرك السلة الحالي دون إضافة استنتاجات جديدة.
        </div>
        {!activeBasket || !unresolvedItems.length ? (
          <div className="dawaa-alert dawaa-alert--success mt-2 text-xs">لا توجد إشارات كمية/مرجعية غير محسومة في السلة الحالية.</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                  {['الصنف', 'الكمية', 'حالة الحسم', 'الثقة', 'رسالة المصدر'].map((h) => <th key={h} className="p-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {unresolvedItems.map((item) => (
                  <tr key={item.itemId} className="border-b border-[var(--dawaa-theme-border)]/60">
                    <td className="p-2">{item.productNameRaw}</td>
                    <td className="p-2">{item.quantity ?? <span className="dawaa-badge dawaa-badge--warning">غير معروفة</span>}{item.unit ? ` ${item.unit}` : ''}</td>
                    <td className="p-2">{itemResolutionStatusLabelFor(item.resolutionStatus)}</td>
                    <td className="p-2">{item.confidence?.level ? attributionLevelLabelFor(item.confidence.level) : '—'}</td>
                    <td className="dawaa-muted p-2 font-mono">{item.sourceMessageId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 5. Historical / Commercial closure (merges the previous separate closure + protocol sections) */}
      <Section title="٥. الإغلاق التاريخي والتجاري">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="الإغلاق التاريخي" value={historicalClosureBadge(analysis.historical_closure_level)} />
          <Field label="انطباق البروتوكول" value={protocolApplicabilityLabelFor(analysis.protocol_applicability)} />
        </div>
        <Evidence>
          {analysis.evidence_snapshot?.historicalClosureEvidence?.length ? (
            <ul className="space-y-1">
              {analysis.evidence_snapshot.historicalClosureEvidence.map((ev: any, i: number) => (
                <li key={i}>• {ev.description} {ev.messageIds?.length ? <span className="dawaa-muted font-mono">({ev.messageIds.join(', ')})</span> : null}</li>
              ))}
            </ul>
          ) : <div>لا توجد أدلة إغلاق تاريخي مسجّلة.</div>}
        </Evidence>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field
            label="الالتزام بالسياسة"
            value={policyEvaluation ? protocolPolicyComplianceLabelFor(policyEvaluation.protocol_policy_compliance) : 'البروتوكول غير مُفعّل بعد'}
          />
        </div>
        {!policyEvaluation ? (
          <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">لا يوجد إعداد سياسة حالي في النظام — أي إشارة لخطوة إجرائية ناقصة أدناه دلالة على اكتمال المحادثة نفسها فقط، وليست مخالفة موظف.</div>
        ) : null}
      </Section>

      {/* 6. Invoice attribution */}
      <Section title="٦. إسناد الفاتورة">
        {!attribution ? (
          <div className="dawaa-empty-state py-4 text-center">لا يوجد تقييم إسناد لهذه الحالة.</div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="الفاتورة المختارة" value={attribution.selected_invoice_number || 'لا توجد'} />
              <Field label="مستوى الإسناد" value={attributionLevelBadge(attribution.attribution_level)} />
              <Field label="رسمي لتقييم الموظف؟" value={attribution.is_official_for_staff_evaluation ? 'نعم' : 'لا'} />
              <Field label="حالة الالتباس" value={ambiguityStatusLabelFor(attribution.ambiguity_status)} />
              <Field label="عدد المرشحين" value={attribution.candidate_count} />
              <Field label="حالات منافسة" value={attribution.competing_case_ids?.length || 0} />
            </div>
            {attribution.competing_case_ids?.length ? (
              <div className="dawaa-alert dawaa-alert--warning mt-2 text-xs">
                تنافس على نفس الفاتورة مع {attribution.competing_case_ids.length} حالة أخرى.
              </div>
            ) : null}
            <Evidence>
              {attribution.primary_evidence?.length ? (
                <ul className="space-y-1">
                  {attribution.primary_evidence.map((ev: any, i: number) => (
                    <li key={i} className={ev.matched ? 'text-emerald-300' : 'text-slate-400'}>
                      {ev.matched ? '✓' : '✗'} {ev.detail} (وزن {ev.weight})
                    </li>
                  ))}
                </ul>
              ) : <div>لا توجد أدلة إسناد أولية مسجّلة.</div>}
              {attribution.contradictions?.length ? (
                <div className="mt-2 text-amber-300">تناقضات: {attribution.contradictions.map(reviewReasonLabelFor).join('، ')}</div>
              ) : null}
              {attribution.rule_ids?.length ? <div className="mt-2 dawaa-muted">قواعد التحليل: {attribution.rule_ids.map(ruleIdLabelFor).join('، ')}</div> : null}
            </Evidence>
          </>
        )}
      </Section>

      <Section title="٦.ب. الفاتورة داخل هذه الحالة">
        <CaseInvoiceCard card={invoiceCard} />
        {!attribution?.selected_invoice_id ? null : !invoiceItemFacts.length ? (
          <div className="dawaa-alert dawaa-alert--warning text-xs leading-6">
            الفاتورة موجودة، لكن بنود B-Connect لم تُستورد لهذه الفاتورة بعد. لذلك لا يمكن الحكم على الصنف أو الكمية أو السعر أو تنفيذ العرض من هذه الحالة.
          </div>
        ) : (
          <details className="mt-3">
            <summary className="dawaa-button dawaa-button--ghost cursor-pointer text-xs">تفاصيل التسعير والعروض لكل بند</summary>
            <div className="mt-3">
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <Field label="أصناف الفاتورة" value={invoiceItemFacts.length} />
              <Field label="أصناف لها سعر مذكور بالمحادثة" value={priceQuotedRows.length} />
              <Field label="دقة الأسعار المذكورة" value={quotedPriceAccuracyPercent == null ? 'غير متاحة' : `${quotedPriceAccuracyPercent}٪`} />
              <Field label="فروق سعر تحتاج مراجعة" value={priceMismatchRows.length} />
            </div>
            <div className="dawaa-alert dawaa-alert--info mb-3 text-xs leading-6">
              في تصدير B-Connect، «سعر بيع» هو إجمالي قيمة السطر قبل المرتجع وخصم الفاتورة، وليس سعر الوحدة. سعر الوحدة النهائي أدناه مشتق من صافي السطر بعد المرتجع والتسوية. <strong>B-Connect هو المرجع المالي</strong>، بينما رأس الفاتورة في التطبيق يُستخدم لهوية الفرع والدكتور والعميل والوقت. سعر الكتالوج الحالي مرجع معلوماتي فقط.
            </div>
            {invoiceItemFacts.length ? (
              <div className="mb-3 grid gap-2 sm:grid-cols-4">
                <Field
                  label="صافي B-Connect"
                  value={invoiceItemFacts[0].bconnectInvoiceNetAmount == null ? 'غير متاح' : `${invoiceItemFacts[0].bconnectInvoiceNetAmount.toFixed(2)} ج.م`}
                />
                <Field
                  label="صافي Header القديم"
                  value={invoiceItemFacts[0].headerInvoiceNetAmount == null ? 'غير متاح' : `${invoiceItemFacts[0].headerInvoiceNetAmount.toFixed(2)} ج.م`}
                />
                <Field
                  label="فرق القيمة"
                  value={invoiceItemFacts[0].financialNetDifference == null ? 'غير متاح' : `${invoiceItemFacts[0].financialNetDifference.toFixed(2)} ج.م`}
                />
                <Field
                  label="تطابق مالي"
                  value={invoiceItemFacts[0].financialNetMatch == null ? 'غير متاح' : invoiceItemFacts[0].financialNetMatch ? 'مطابق' : 'مختلف — لا يمنع ربط الهوية'}
                />
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                    {['الصنف', 'الكود', 'الكمية الأصلية', 'الكمية المباعة', 'السعر في المحادثة', 'سعر الوحدة قبل الخصم', 'سعر الوحدة النهائي', 'الفرق', 'دقة السعر', 'خصم فعلي موزع', 'صافي البند', 'مرتجع', 'الدكتور المنفذ', 'حالة العرض/الخصم'].map((h) => <th key={h} className="p-2">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {invoiceItemFacts.map((item) => (
                    <tr key={item.id} className="border-b border-[var(--dawaa-theme-border)]/60">
                      <td className="p-2 font-bold">{item.productName || '—'}</td>
                      <td className="p-2 font-mono">{item.productCode || '—'}</td>
                      <td className="p-2">{item.quantity ?? '—'}{item.unitName ? ` ${item.unitName}` : ''}</td>
                      <td className="p-2">{item.effectiveQuantity ?? '—'}{item.unitName ? ` ${item.unitName}` : ''}</td>
                      <td className="p-2">{item.quotedUnitPrice == null ? '—' : `${item.quotedUnitPrice.toFixed(2)} ج.م`}</td>
                      <td className="p-2">{item.unitPrice == null ? '—' : `${item.unitPrice.toFixed(2)} ج.م`}</td>
                      <td className="p-2">{item.effectiveUnitPrice == null ? '—' : `${item.effectiveUnitPrice.toFixed(2)} ج.م`}</td>
                      <td className="p-2">
                        {item.quotedPriceDifference == null ? '—' : `${item.quotedPriceDifference.toFixed(2)} ج.م`}
                      </td>
                      <td className="p-2">
                        <span className={item.quotedPriceStatus === 'mismatch_review' ? 'dawaa-badge dawaa-badge--warning' : item.quotedPriceStatus === 'exact' || item.quotedPriceStatus === 'near_match' ? 'dawaa-badge dawaa-badge--success' : 'dawaa-badge'}>
                          {quotedPriceStatusLabel(item.quotedPriceStatus)}
                        </span>
                      </td>
                      <td className="p-2">
                        {item.allocatedInvoiceDiscountAmount == null
                          ? '—'
                          : `${item.allocatedInvoiceDiscountAmount.toFixed(2)} ج.م`}
                      </td>
                      <td className="p-2">{item.netLineAmount == null ? '—' : `${item.netLineAmount.toFixed(2)} ج.م`}</td>
                      <td className="p-2">{item.returnedQuantity ?? 0}</td>
                      <td className="p-2">{item.staffName || item.sellerName || 'غير متاح'}</td>
                      <td className="max-w-[320px] p-2">
                        <span className={item.pricingNeedsReview ? 'dawaa-badge dawaa-badge--warning' : 'dawaa-badge dawaa-badge--success'}>
                          {pricingStatusLabel(item.pricingStatus)}
                        </span>
                        {item.matchedOfferTitle ? <div className="mt-1 text-emerald-300">العرض: {item.matchedOfferTitle}</div> : null}
                        {item.catalogCurrentPrice != null ? <div className="dawaa-muted mt-1">سعر الكتالوج الحالي: {item.catalogCurrentPrice.toFixed(2)} ج.م</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </details>
        )}
      </Section>

      <Section title="٦.ج. الترشيحات وتحولها لمبيعات فعلية">
        {!recommendationConversions.length ? (
          <div className="dawaa-empty-state py-4 text-center">
            لا يوجد ترشيح صيدلي موثق داخل نطاق هذه الـCase يمكن ربطه بالفاتورة الحالية.
          </div>
        ) : (
          <div className="space-y-2">
            {recommendationConversions.map((rec, index) => (
              <div key={`${rec.productId || rec.productCode || rec.productName}-${index}`} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold">{rec.productName}</div>
                  <span className={rec.officialSaleFromRecommendation ? 'dawaa-badge dawaa-badge--success' : rec.needsHumanReview ? 'dawaa-badge dawaa-badge--warning' : 'dawaa-badge'}>
                    {recommendationConversionLabel(rec.conversionStatus)}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-6">
                  <Field label="كود الصنف" value={rec.productCode || 'غير متاح'} />
                  <Field label="دكتور الترشيح" value={rec.recommenderName || 'غير محسوم'} />
                  <Field label="قبول العميل" value={rec.acceptedInChat ? 'نعم' : rec.rejectedInChat ? 'رفض' : 'غير مؤكد'} />
                  <Field label="الصنف في الفاتورة" value={rec.invoiceContainsProduct ? 'موجود' : 'غير مثبت'} />
                  <Field label="دكتور تنفيذ الفاتورة" value={rec.invoiceStaffName || 'غير متاح'} />
                  <Field label="قيمة البيع المرتبطة" value={rec.officialSaleFromRecommendation && rec.soldNetValue != null ? `${rec.soldNetValue.toFixed(2)} ج.م` : 'غير محتسبة رسميًا'} />
                </div>
                {rec.conversionStatus === 'candidate_invoice_match' ? (
                  <div className="mt-2 text-[11px] leading-5 text-amber-200">
                    الصنف موجود في فاتورة مرشحة، لكن الإسناد غير رسمي للتقييم؛ لذلك لا تُحسب قيمة البيع على دكتور الترشيح.
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      {candidateInvoice ? (
        <Section title="تأكيد رابط الفاتورة المرشحة">
          {invoiceAlreadyConfirmed && !invoiceConfirmationMatchesCandidate ? (
            <div className="dawaa-alert dawaa-alert--info text-sm">
              يوجد تأكيد محفوظ مسبقًا للفاتورة {conversation?.invoiceLinkConfirmedInvoiceNumber || 'بدون رقم ظاهر'}.
              {' '}التأكيد الحالي يشير إلى فاتورة مختلفة؛ لا يمكن استبداله من هذه الشاشة.
            </div>
          ) : invoiceAlreadyProven ? (
            <div className="dawaa-alert dawaa-alert--success text-sm">رابط الفاتورة موثوق بالفعل.</div>
          ) : (
            <>
              {invoiceConfirmationMatchesCandidate ? (
                <div className="dawaa-alert dawaa-alert--info text-sm">
                  رابط الفاتورة {conversation?.invoiceLinkConfirmedInvoiceNumber || candidateInvoiceNumber} محفوظ؛ يمكن إعادة محاولة التحليل دون كتابة تأكيد جديد.
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="رقم الفاتورة" value={candidateInvoice.invoiceNumber || candidateInvoiceNumber || 'غير متاح'} />
                <Field label="العميل" value={candidateInvoice.customerName || conversation?.customerName || 'غير متاح'} />
                <Field label="كود العميل" value={candidateInvoice.customerCode || conversation?.customerCode || 'غير متاح'} />
                <Field label="الفرع" value={candidateInvoice.branch || 'غير متاح'} />
                <Field label="الموظف على الفاتورة" value={candidateInvoice.staffName || 'غير متاح'} />
                <Field label="وقت الفاتورة" value={candidateInvoice.invoiceDatetime ? formatDateTime(candidateInvoice.invoiceDatetime) : 'غير متاح'} />
                <Field label="إجمالي الفاتورة" value={candidateInvoice.total == null ? 'غير متاح' : `${candidateInvoice.total.toLocaleString('ar-EG')} ج.م`} />
                <Field
                  label="ثقة / سبب المطابقة"
                  value={`${conversation?.invoiceMatchConfidence == null
                    ? attributionConfidencePercent == null ? 'غير متاحة' : `${attributionConfidencePercent}٪`
                    : `${Math.round(conversation.invoiceMatchConfidence * 100)}٪`} — ${conversation?.invoiceMatchReason || 'مرشح الإسناد الحالي في Sales Intelligence'}`}
                />
              </div>
              {canConfirmCandidate ? (
                <button
                  type="button"
                  className="dawaa-button dawaa-button--primary"
                  onClick={() => void confirmSelectedInvoice()}
                  disabled={invoiceConfirming}
                >
                  {invoiceConfirming
                    ? 'جارٍ إعادة التحليل...'
                    : invoiceConfirmationMatchesCandidate
                      ? 'إعادة محاولة تحليل الفاتورة'
                      : 'اعتماد الفاتورة لهذه الحالة'}
                </button>
              ) : (
                <div className="dawaa-muted text-xs">
                  لا يمكن اعتماد الرابط: الحالة غير canonical، أو بيانات المرشح غير مكتملة، أو لا تتوفر صلاحية المراجعة المطلوبة.
                </div>
              )}
              {invoiceConfirmationMessage ? <div className="dawaa-alert dawaa-alert--success text-sm">{invoiceConfirmationMessage}</div> : null}
              {invoiceConfirmationError ? <div className="dawaa-alert dawaa-alert--danger text-sm">{invoiceConfirmationError}</div> : null}
            </>
          )}
        </Section>
      ) : null}

      {/* 7. Sale Proof State — the state is the persisted canonical value; the explanation fields come from the persisted attribution/match rows. */}
      <Section title="٧. حالة إثبات البيع">
        <div className="flex flex-wrap items-center gap-3">
          {proofStateBadge}
          <span className="dawaa-muted text-xs">مصدر الإثبات: {saleProofSourceLabelFor(persistedProofEvidence.proofSource)}</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Field label="هل توجد فاتورة موثوقة مباشرة؟" value={trustedInvoiceId ? 'نعم' : 'لا'} />
          <Field label="الفاتورة المختارة" value={candidateInvoiceNumber || 'لا توجد'} />
          <Field label="نطاق أدلة الفاتورة" value={integrityScopeBadge(persistedProofEvidence.invoiceEvidenceScope)} />
          <Field label="أدلة الأصناف؟" value={persistedProofEvidence.itemEvidenceReady ? 'متاحة' : 'غير متاحة'} />
          <Field label="أدلة الكمية؟" value={persistedProofEvidence.quantityEvidenceReady ? 'متاحة' : 'غير متاحة'} />
          <Field label="تحتاج مراجعة بشرية؟" value={persistedProofEvidence.needsHumanReview ? 'نعم' : 'لا'} />
        </div>

        {!persistedProofEvidence.itemEvidenceReady ? (
          <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">{ITEM_EVIDENCE_UNAVAILABLE_TEXT}</div>
        ) : null}

        {currentSalesOutcome?.saleProofState === 'contradicted' ? (
          <div className="dawaa-alert dawaa-alert--danger mt-2 text-xs">
            <div className="mb-1 font-bold">سبب التناقض:</div>
            <ul className="space-y-1">
              {contradictionReasonsList(persistedProofEvidence.contradictions).map((reason, i) => <li key={i}>• {reason}</li>)}
            </ul>
          </div>
        ) : null}

        {(currentSalesOutcome?.saleProofState ?? 'unknown') === 'unknown' ? (
          <div className="dawaa-alert dawaa-alert--warning mt-2 text-xs">
            {unknownProofReason({
              candidateCount: attribution?.candidate_count ?? 0,
              attributionLevel: attribution?.attribution_level ?? analysis.attribution_level ?? 'unknown',
              rawContradictions: attribution?.contradictions ?? [],
            })}
          </div>
        ) : null}

        {persistedProofEvidence.ruleIds.length ? (
          <Evidence>
            <div className="dawaa-muted">قواعد التحليل: {persistedProofEvidence.ruleIds.map(ruleIdLabelFor).join('، ')}</div>
          </Evidence>
        ) : null}
      </Section>

      {/* 8. Basket <-> Invoice (summary only — differences moved to section 9) */}
      <Section title="٨. مطابقة السلة والفاتورة">
        {!match ? (
          <div className="dawaa-empty-state py-4 text-center">لا يوجد تقييم مطابقة لهذه الحالة.</div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="نطاق التكامل" value={integrityScopeBadge(match.integrity_evaluation_scope)} />
              <Field label="التطابق الكلي" value={fieldMatchBadge(match.overall_match)} />
              <Field label="تطابق الإجمالي" value={fieldMatchBadge(match.total_match)} />
              <Field label="تطابق الأصناف" value={fieldMatchBadge(match.item_match)} />
            </div>
            {!match.item_evidence_ready ? (
              <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">{ITEM_EVIDENCE_UNAVAILABLE_TEXT}</div>
            ) : null}
            {!match.header_evidence_ready ? (
              <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">لا يوجد إجمالي فاتورة/سلة كافٍ للمقارنة على مستوى الرأس.</div>
            ) : null}
          </>
        )}
      </Section>

      {/* 9. Integrity / contradictions (NEW, separated out from Human Review) */}
      <Section title="٩. التكامل والتناقضات">
        {persistedProofEvidence.contradictions.length ? (
          <div className="dawaa-alert dawaa-alert--danger text-xs">
            <div className="mb-1 font-bold">تناقضات إثبات البيع (Sale Proof):</div>
            <ul className="space-y-1">
              {contradictionReasonsList(persistedProofEvidence.contradictions).map((reason, i) => <li key={i}>• {reason}</li>)}
            </ul>
          </div>
        ) : (
          <div className="dawaa-alert dawaa-alert--success text-xs">لا يوجد تناقض مكتشف على مستوى إثبات البيع لهذه الحالة.</div>
        )}

        {attribution?.contradictions?.length ? (
          <div className="mt-2 text-xs">
            <div className="dawaa-muted mb-1">تناقضات إسناد خام (كما سجّلها محرك الإسناد):</div>
            <div className="text-amber-300">{contradictionReasonsList(attribution.contradictions).join('، ')}</div>
          </div>
        ) : null}

        {match?.differences?.length ? (
          <Evidence>
            <div className="dawaa-muted mb-1">فروقات السلة/الفاتورة المسجّلة:</div>
            <ul className="space-y-1">
              {match.differences.map((d: any, i: number) => <li key={i}>• {MATCH_DIFFERENCE_LABELS[d.type] || 'فرق آخر'} — {d.key === 'total' ? 'الإجمالي' : d.key}: {d.before == null ? '—' : String(d.before)} ← {d.after == null ? '—' : String(d.after)}{d.explanation ? ` (${d.explanation})` : ''}</li>)}
            </ul>
          </Evidence>
        ) : null}
      </Section>

      {/* 10. Human Review */}
      <Section title="١٠. المراجعة البشرية">
        <div className="flex items-center gap-2">
          <span className={analysis.needs_human_review ? 'dawaa-badge dawaa-badge--warning' : 'dawaa-badge dawaa-badge--success'}>
            {analysis.needs_human_review ? 'تحتاج مراجعة بشرية' : 'لا تحتاج مراجعة'}
          </span>
        </div>
        {analysis.human_review_reasons?.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {analysis.human_review_reasons.map((reason: string) => <li key={reason}>• {reviewReasonLabelFor(reason)}</li>)}
          </ul>
        ) : <div className="dawaa-muted mt-2 text-sm">لا توجد أسباب مراجعة مسجّلة.</div>}
        {analysis.failure_reasons?.length ? (
          <div className="dawaa-muted mt-3 text-xs">
            أسباب نقص الأدلة (وصفية فقط، وليست اتهامًا لأي طرف): {analysis.failure_reasons.map(failureReasonLabelFor).join('، ')}
          </div>
        ) : null}
      </Section>
      </>) : null}
    </div>
  );
}

