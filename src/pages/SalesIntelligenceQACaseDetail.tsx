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
import { ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { fetchQaCaseDetail, type QaCaseDetailBundle } from '@/lib/salesIntelligence/qa/queries';
import {
  ambiguityStatusLabelFor,
  attributionLevelBadge,
  branchLabelFor,
  caseTypeLabelFor,
  failureReasonLabelFor,
  fieldMatchBadge,
  historicalClosureBadge,
  itemResolutionStatusLabelFor,
  protocolApplicabilityLabelFor,
  protocolPolicyComplianceLabelFor,
  reviewReasonLabelFor,
} from '@/lib/salesIntelligence/qa/presentation';

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

  const { persisted, conversation, transcript, liveEvidence } = bundle;
  const analysis = persisted.analysisRow;
  const attribution = persisted.attributionRow;
  const match = persisted.matchRow;
  const policyEvaluation = persisted.policyEvaluationRow;
  const activeBasket = liveEvidence?.activeBasket ?? null;
  const basketItems = activeBasket ? liveEvidence?.itemsByBasketId[activeBasket.basketId] ?? [] : [];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate('/sales-intelligence/qa')} className="dawaa-button dawaa-button--secondary">
          <ArrowRight size={16} /> رجوع للقائمة
        </button>
        <div className="dawaa-muted font-mono text-xs">{caseId}</div>
      </div>

      {/* 1. Original conversation */}
      <Section title="١. المحادثة الأصلية">
        {!conversation ? (
          <div className="dawaa-empty-state py-6 text-center">لا يوجد نص محادثة مرتبط بهذه الحالة.</div>
        ) : (
          <>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <Field label="الفرع" value={branchLabelFor(conversation.branch)} />
              <Field label="بداية المحادثة" value={formatDateTime(conversation.startedAt || '')} />
              <Field label="نهاية المحادثة" value={conversation.endedAt ? formatDateTime(conversation.endedAt) : '—'} />
            </div>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto rounded-xl border border-[var(--dawaa-theme-border)] p-3">
              {transcript.length ? transcript.map((m) => (
                <div key={m.id} className={`rounded-lg border p-2 text-sm ${m.direction === 'outbound' ? 'border-cyan-800/30 bg-cyan-950/10' : m.direction === 'system' ? 'border-slate-700 bg-slate-900/20 opacity-70' : 'border-[var(--dawaa-theme-border)]'}`}>
                  <div className="dawaa-muted mb-1 flex justify-between text-[11px]">
                    <span>{m.direction === 'outbound' ? (m.sender || 'الصيدلية') : m.direction === 'system' ? 'النظام' : 'العميل'}</span>
                    <span>{formatDateTime(m.timestamp)}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{m.text || `[${m.kind}]`}</div>
                </div>
              )) : <div className="dawaa-muted text-center text-xs">تعذّر تحليل رسائل هذه المحادثة (راجع تنسيق المصدر).</div>}
            </div>
          </>
        )}
      </Section>

      {/* 2. Case segmentation */}
      <Section title="٢. تقسيم الحالة">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="البداية" value={formatDateTime(analysis.case_started_at)} />
          <Field label="النهاية" value={analysis.case_ended_at ? formatDateTime(analysis.case_ended_at) : '—'} />
          <Field label="نوع الحالة" value={caseTypeLabelFor(analysis.case_type)} />
        </div>
        <Evidence>
          <div>ثقة تصنيف المحادثة: {analysis.evidence_snapshot?.conversationCaseConfidence?.level ?? '—'} (نسبة {analysis.evidence_snapshot?.conversationCaseConfidence?.score ?? '—'})</div>
          {analysis.evidence_snapshot?.conversationCaseConfidence?.ruleIds?.length ? (
            <div className="mt-1">القواعد: {analysis.evidence_snapshot.conversationCaseConfidence.ruleIds.join('، ')}</div>
          ) : null}
          {analysis.pipeline_warnings?.length ? (
            <div className="mt-2 text-amber-300">تحذيرات التقسيم: {analysis.pipeline_warnings.join('، ')}</div>
          ) : <div className="mt-2">لا توجد تحذيرات تقسيم.</div>}
        </Evidence>
      </Section>

      {/* 3. Basket understanding */}
      <Section title="٣. فهم السلة">
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

      {/* 4. Historical Commercial Closure */}
      <Section title="٤. الإغلاق التجاري التاريخي">
        <div className="flex items-center gap-3">
          {historicalClosureBadge(analysis.historical_closure_level)}
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
      </Section>

      {/* 5. Protocol */}
      <Section title="٥. البروتوكول">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="الانطباق" value={protocolApplicabilityLabelFor(analysis.protocol_applicability)} />
          <Field
            label="الالتزام بالسياسة"
            value={policyEvaluation ? protocolPolicyComplianceLabelFor(policyEvaluation.protocol_policy_compliance) : 'البروتوكول غير مُفعّل بعد'}
          />
        </div>
        {!policyEvaluation ? (
          <div className="dawaa-alert dawaa-alert--info text-xs">لا يوجد إعداد سياسة حالي في النظام — أي إشارة لخطوة إجرائية ناقصة أدناه دلالة على اكتمال المحادثة نفسها فقط، وليست مخالفة موظف.</div>
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
                <div className="mt-2 text-amber-300">تناقضات: {attribution.contradictions.join('، ')}</div>
              ) : null}
              {attribution.rule_ids?.length ? <div className="mt-2 dawaa-muted">القواعد: {attribution.rule_ids.join('، ')}</div> : null}
            </Evidence>
          </>
        )}
      </Section>

      {/* 7. Basket <-> Invoice */}
      <Section title="٧. مطابقة السلة والفاتورة">
        {!match ? (
          <div className="dawaa-empty-state py-4 text-center">لا يوجد تقييم مطابقة لهذه الحالة.</div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="نطاق التكامل" value={match.integrity_evaluation_scope} />
              <Field label="التطابق الكلي" value={fieldMatchBadge(match.overall_match)} />
              <Field label="تطابق الإجمالي" value={fieldMatchBadge(match.total_match)} />
              <Field label="تطابق الأصناف" value={fieldMatchBadge(match.item_match)} />
            </div>
            {!match.item_evidence_ready ? (
              <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">بيانات أصناف الفاتورة غير متاحة</div>
            ) : null}
            {!match.header_evidence_ready ? (
              <div className="dawaa-alert dawaa-alert--info mt-2 text-xs">لا يوجد إجمالي فاتورة/سلة كافٍ للمقارنة على مستوى الرأس.</div>
            ) : null}
            {match.differences?.length ? (
              <Evidence>
                <ul className="space-y-1">
                  {match.differences.map((d: any, i: number) => <li key={i}>• {d.type} — {d.key}: {String(d.before)} ← {String(d.after)} ({d.explanation})</li>)}
                </ul>
              </Evidence>
            ) : null}
          </>
        )}
      </Section>

      {/* 8. Human Review */}
      <Section title="٨. المراجعة البشرية">
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
