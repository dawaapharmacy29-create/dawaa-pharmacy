// Sales Intelligence QA Case Detail — Phase H.2.
//
// READ ONLY. Shows the full reasoning chain for one case, in the order a human auditor would want
// to check it: original conversation -> segmentation -> basket -> historical closure -> protocol ->
// invoice attribution -> basket/invoice matching -> human review. Every section reads either the
// PERSISTED row (source of truth for what was saved) or the live, in-memory conversation-only
// re-derivation (source of truth for basket item detail, which was never persisted — see
// src/lib/salesIntelligence/qa/queries.ts's module comment). Never both blended into one claim.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Building2, Hash, Layers3, Phone, RefreshCw, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { fetchQaCaseDetail, type QaCaseDetailBundle } from '@/lib/salesIntelligence/qa/queries';
import { WhatsAppConversationPanel } from '@/components/salesIntelligence/WhatsAppConversationPanel';
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
  productMatchLabelFor,
  attributionLevelLabelFor,
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3">
      <div className="dawaa-muted text-xs">{label}</div>
      <div className="dawaa-heading mt-1 text-sm font-bold">{value ?? '—'}</div>
    </div>
  );
}

export default function SalesIntelligenceQACaseDetail() {
  const { caseId: rawCaseId } = useParams<{ caseId: string }>();
  const caseId = rawCaseId ? decodeURIComponent(rawCaseId) : '';
  const navigate = useNavigate();
  const [bundle, setBundle] = useState<QaCaseDetailBundle | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBundle(undefined);
      setError(null);
      try {
        const result = await fetchQaCaseDetail(supabase, caseId);
        if (!cancelled) setBundle(result);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'تعذر تحميل تفاصيل الحالة.');
      }
    }
    if (caseId) void load();
  }, [caseId]);

  if (error) {
    return <div className="dawaa-alert dawaa-alert--danger text-sm font-bold" dir="rtl">{error}</div>;
  }
  if (bundle === undefined) {
    return <div className="dawaa-muted py-16 text-center" dir="rtl"><RefreshCw className="mx-auto mb-3 animate-spin" /> جاري التحميل...</div>;
  }
  if (bundle === null) {
    return <div className="dawaa-empty-state py-16 text-center" dir="rtl">لم يتم العثور على هذه الحالة.</div>;
  }

  const { persisted, conversation, siblingCases, transcript, liveEvidence, saleProof, catalogProductMatches } = bundle;
  const analysis = persisted.analysisRow;
  const attribution = persisted.attributionRow;
  const match = persisted.matchRow;
  const policyEvaluation = persisted.policyEvaluationRow;
  const activeBasket = liveEvidence?.activeBasket ?? null;
  const basketItems = activeBasket ? liveEvidence?.itemsByBasketId[activeBasket.basketId] ?? [] : [];
  const unresolvedItems = basketItems.filter((item) => item.resolutionStatus !== 'proven' || item.quantity === null);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => navigate('/sales-intelligence/qa')} className="dawaa-button dawaa-button--secondary">
          <ArrowRight size={16} /> رجوع للقائمة
        </button>
        <div className="dawaa-muted max-w-full truncate font-mono text-xs" title={caseId}>{caseId}</div>
      </div>

      <section className="dawaa-card">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="العميل" value={<span className="inline-flex items-center gap-2"><UserRound size={16} /> {conversation?.customerName || 'عميل غير مسمى'}</span>} />
          <Field label="كود العميل" value={<span className="inline-flex items-center gap-2"><Hash size={16} /> {conversation?.customerCode || 'غير متاح'}</span>} />
          <Field label="رقم الهاتف" value={<span className="inline-flex items-center gap-2"><Phone size={16} /> {conversation?.customerPhone || 'غير متاح'}</span>} />
          <Field label="الفرع" value={<span className="inline-flex items-center gap-2"><Building2 size={16} /> {branchLabelFor(conversation?.branch ?? analysis.identity_branch_name_raw)}</span>} />
          <Field label="نوع الحالة" value={caseTypeLabelFor(analysis.case_type)} />
          <Field label="إثبات البيع" value={saleProofStateBadge(saleProof.state)} />
          <Field label="مستوى الإسناد" value={attributionLevelBadge(attribution?.attribution_level ?? analysis.attribution_level)} />
          <Field label="تقسيم المصدر" value={<span className="inline-flex items-center gap-2"><Layers3 size={16} /> {siblingCases.length > 1 ? `${siblingCases.length} أجزاء` : 'جزء واحد'}</span>} />
        </div>
      </section>

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
          <div>ثقة تصنيف المحادثة: {attributionLevelLabelFor(analysis.evidence_snapshot?.conversationCaseConfidence?.level ?? 'unknown')} (الدرجة {analysis.evidence_snapshot?.conversationCaseConfidence?.score ?? '—'})</div>
          {analysis.evidence_snapshot?.conversationCaseConfidence?.ruleIds?.length ? (
            <div className="mt-1">القواعد: {analysis.evidence_snapshot.conversationCaseConfidence.ruleIds.join('، ')}</div>
          ) : null}
          {analysis.pipeline_warnings?.length ? (
            <div className="mt-2 text-amber-300">تحذيرات التقسيم: {analysis.pipeline_warnings.join('، ')}</div>
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
                      <td className="p-2">{item.confidence?.level ?? '—'}</td>
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
          مطابقة قراءة فقط مع جدول المنتجات الفعلي. النتيجة هنا مرشح كتالوج وليست إثبات بيع؛ التأكيد النهائي سيعتمد على بيانات الفاتورة وبنودها عند توفرها.
        </div>
        {!catalogProductMatches.length ? (
          <div className="dawaa-empty-state py-4 text-center">لم يظهر تطابق كتالوج من النص المتاح لهذه الحالة.</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                  {['النص في المحادثة', 'الصنف الفعلي', 'كود الصنف', 'السعر الحالي', 'قوة المطابقة'].map((h) => <th key={h} className="p-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {catalogProductMatches.map((match) => (
                  <tr key={`${match.sourceMessageId}:${match.productId}`} className="border-b border-[var(--dawaa-theme-border)]/60">
                    <td className="max-w-[360px] p-2">{match.rawPhrase}</td>
                    <td className="p-2 font-bold">{match.productName}</td>
                    <td className="p-2 font-mono">{match.productCode}</td>
                    <td className="p-2">{match.price == null ? '—' : `${match.price} ج.م`}</td>
                    <td className="p-2">
                      <span className={match.score >= 68 ? 'dawaa-badge dawaa-badge--success' : 'dawaa-badge dawaa-badge--warning'}>
                        {productMatchLabelFor(match.label)} • {match.score}%
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
                    <td className="p-2">{item.confidence?.level ?? '—'}</td>
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

      {/* 7. Sale Proof State (NEW) — always from PERSISTED rows via deriveSaleProofStateFromPersisted(), never liveEvidence. */}
      <Section title="٧. حالة إثبات البيع">
        <div className="flex flex-wrap items-center gap-3">
          {saleProofStateBadge(saleProof.state)}
          <span className="dawaa-muted text-xs">مصدر الإثبات: {saleProofSourceLabelFor(saleProof.proofSource)}</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Field label="هل توجد فاتورة موثوقة مباشرة؟" value={saleProof.trustedInvoiceId ? 'نعم' : 'لا'} />
          <Field label="الفاتورة المختارة" value={saleProof.selectedInvoiceNumber || 'لا توجد'} />
          <Field label="نطاق أدلة الفاتورة" value={integrityScopeBadge(saleProof.invoiceEvidenceScope)} />
          <Field label="أدلة الأصناف؟" value={saleProof.itemEvidenceReady ? 'متاحة' : 'غير متاحة'} />
          <Field label="أدلة الكمية؟" value={saleProof.quantityEvidenceReady ? 'متاحة' : 'غير متاحة'} />
          <Field label="تحتاج مراجعة بشرية؟" value={saleProof.needsHumanReview ? 'نعم' : 'لا'} />
        </div>

        {!saleProof.itemEvidenceReady ? (
          <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">{ITEM_EVIDENCE_UNAVAILABLE_TEXT}</div>
        ) : null}

        {saleProof.state === 'contradicted' ? (
          <div className="dawaa-alert dawaa-alert--danger mt-2 text-xs">
            <div className="mb-1 font-bold">سبب التناقض:</div>
            <ul className="space-y-1">
              {contradictionReasonsList(saleProof.contradictions).map((reason, i) => <li key={i}>• {reason}</li>)}
            </ul>
          </div>
        ) : null}

        {saleProof.state === 'unknown' ? (
          <div className="dawaa-alert dawaa-alert--warning mt-2 text-xs">
            {unknownProofReason({
              candidateCount: attribution?.candidate_count ?? 0,
              attributionLevel: attribution?.attribution_level ?? analysis.attribution_level ?? 'unknown',
              rawContradictions: attribution?.contradictions ?? [],
            })}
          </div>
        ) : null}

        {saleProof.ruleIds.length ? (
          <Evidence>
            <div className="dawaa-muted">قواعد التحليل: {saleProof.ruleIds.map(ruleIdLabelFor).join('، ')}</div>
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
        {saleProof.contradictions.length ? (
          <div className="dawaa-alert dawaa-alert--danger text-xs">
            <div className="mb-1 font-bold">تناقضات إثبات البيع (Sale Proof):</div>
            <ul className="space-y-1">
              {contradictionReasonsList(saleProof.contradictions).map((reason, i) => <li key={i}>• {reason}</li>)}
            </ul>
          </div>
        ) : (
          <div className="dawaa-alert dawaa-alert--success text-xs">لا يوجد تناقض مكتشف على مستوى إثبات البيع لهذه الحالة.</div>
        )}

        {attribution?.contradictions?.length ? (
          <div className="mt-2 text-xs">
            <div className="dawaa-muted mb-1">تناقضات إسناد خام (كما سجّلها محرك الإسناد):</div>
            <div className="text-amber-300">{attribution.contradictions.join('، ')}</div>
          </div>
        ) : null}

        {match?.differences?.length ? (
          <Evidence>
            <div className="dawaa-muted mb-1">فروقات السلة/الفاتورة المسجّلة:</div>
            <ul className="space-y-1">
              {match.differences.map((d: any, i: number) => <li key={i}>• {d.type} — {d.key}: {String(d.before)} ← {String(d.after)} ({d.explanation})</li>)}
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
    </div>
  );
}
