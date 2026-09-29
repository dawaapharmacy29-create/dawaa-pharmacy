import { useMemo, useState } from 'react';
import { snapshotFromReviewRow, parseConversationReviewSnapshot, type ConversationReviewSnapshot } from '@/lib/conversationReviewTranscript';

type Props = {
  snapshot?: unknown;
  reviewRow?: Record<string, unknown> | null;
  title?: string;
  defaultOpen?: boolean;
};

const decisionLabel: Record<string, string> = {
  clear: 'سليمة بالكامل',
  issue: 'فيها ملاحظة',
  detailed_review: 'تحتاج مراجعة تفصيلية',
};

function fmt(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function timingDuration(seconds?: number | null) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds} ث`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

function resolveSnapshot(props: Props): ConversationReviewSnapshot | null {
  if (props.reviewRow) return snapshotFromReviewRow(props.reviewRow);
  return parseConversationReviewSnapshot(props.snapshot);
}

const delayResponsibilityLabel: Record<string, string> = {
  staff_response: 'زمن رد',
  pharmacy_operations: 'تجهيز/تنفيذ داخلي',
  delivery: 'التوصيل/المندوب',
  shared_handoff: 'تسليم المسؤولية بين أكثر من موظف',
  customer_or_unknown: 'بيانات/تأكيد من العميل',
};

export default function ConversationReviewTranscriptCard(props: Props) {
  const snapshot = useMemo(() => resolveSnapshot(props), [props.snapshot, props.reviewRow]);
  const [showContext, setShowContext] = useState(true);
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const [viewMode, setViewMode] = useState<'focused' | 'full'>('focused');

  if (!snapshot) return null;
  const hasFullCase = Boolean(snapshot.fullCaseMessages?.length && snapshot.fullCaseMessages.length > snapshot.messages.length);
  // الرحلة كاملة تفضل Audit فقط — لا تدخل افتراضيًا في عرض/تقييم الموظف الحالي.
  const activeMessages = viewMode === 'full' && hasFullCase ? snapshot.fullCaseMessages! : snapshot.messages;
  const visible = activeMessages.filter((message) => showContext || message.scope === 'scored');
  const scoredCount = snapshot.messages.filter((message) => message.scope === 'scored').length;
  const contextCount = snapshot.messages.length - scoredCount;

  const evaluationV2 = snapshot.smartIntelligence?.evaluationV2;
  const staffTiming = snapshot.smartIntelligence?.staffTimingV28;

  return (
    <section dir="rtl" className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-white">{props.title || 'تفاصيل المحادثة محل التقييم'}</div>
          <div className="mt-1 text-xs leading-6 text-slate-400">
            {snapshot.staffName} • {snapshot.staffRole === 'customer_service' ? 'خدمة العملاء' : 'صيدلي'} • {snapshot.sourceFileName || 'ملف WhatsApp'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-cyan-100">داخل التقييم {scoredCount}</span>
          {contextCount ? <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">سياق {contextCount}</span> : null}
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">{decisionLabel[snapshot.decision.value] || snapshot.decision.value}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
        <div className="rounded-xl bg-slate-950/35 p-3"><span className="text-slate-500">من:</span><div className="mt-1 font-bold text-white">{fmt(snapshot.scope.from)}</div></div>
        <div className="rounded-xl bg-slate-950/35 p-3"><span className="text-slate-500">إلى:</span><div className="mt-1 font-bold text-white">{fmt(snapshot.scope.to)}</div></div>
        <div className="rounded-xl bg-slate-950/35 p-3"><span className="text-slate-500">العميل:</span><div className="mt-1 font-bold text-white">{snapshot.customerName || 'غير محدد'}</div></div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-200">
          {open ? 'إخفاء المحادثة' : 'إظهار المحادثة'}
        </button>
        {contextCount ? <button type="button" onClick={() => setShowContext((value) => !value)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-300">
          {showContext ? 'إخفاء رسائل السياق' : 'إظهار رسائل السياق'}
        </button> : null}
        {hasFullCase ? (
          <div className="mr-auto flex items-center gap-1 rounded-lg border border-slate-700 p-1 text-xs">
            <button type="button" onClick={() => setViewMode('focused')} className={`rounded-md px-2.5 py-1.5 font-black ${viewMode === 'focused' ? 'bg-cyan-500 text-white' : 'text-slate-300'}`}>
              المحادثة المركزة ({snapshot.messages.length})
            </button>
            <button type="button" onClick={() => setViewMode('full')} className={`rounded-md px-2.5 py-1.5 font-black ${viewMode === 'full' ? 'bg-slate-700 text-white' : 'text-slate-300'}`}>
              الرحلة كاملة ({snapshot.fullCaseMessages!.length})
            </button>
          </div>
        ) : null}
      </div>
      {viewMode === 'full' ? <div className="mt-2 text-[11px] text-amber-200/80">عرض توثيقي (Audit) لكل رسائل رحلة العميل — لا يدخل في تقييم الموظف الحالي، والدرجة والبنود محسوبة على المحادثة المركزة فقط.</div> : null}

      {open ? <div className="mt-4 space-y-2">
        {visible.map((message) => {
          const isOtherStaff = message.direction === 'outbound' && message.sender && message.sender !== snapshot.staffName;
          return (
          <div key={message.id} className={`rounded-xl border p-3 ${message.scope === 'context' ? 'border-slate-800 bg-slate-950/25 opacity-70' : message.direction === 'outbound' ? 'border-cyan-800/40 bg-cyan-950/20' : 'border-slate-700 bg-slate-950/45'}`}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex flex-wrap items-center gap-2">
                <span>{message.direction === 'outbound' ? (message.sender || snapshot.staffName) : message.direction === 'inbound' ? 'العميل' : 'النظام'}</span>
                {isOtherStaff ? <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-200">موظف آخر — لا يدخل في تقييم {snapshot.staffName}</span> : null}
                {message.scope === 'context' ? <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">سياق فقط — لا يدخل في التقييم</span> : null}
                {message.evidence ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-200">دليل مرتبط بالتحليل</span> : null}
              </div>
              <span>{fmt(message.timestamp)}</span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-100">{message.text || `[${message.kind}]`}</div>
          </div>
          );
        })}
        {!visible.length ? <div className="rounded-xl border border-slate-800 p-4 text-center text-sm text-slate-500">لا توجد رسائل محفوظة داخل هذا التقييم.</div> : null}
      </div> : null}

      {snapshot.decision.reasons.length ? <div className="mt-4 rounded-xl border border-amber-700/30 bg-amber-950/15 p-3 text-xs leading-6 text-amber-100/85">
        <div className="font-black text-amber-200">لماذا تم توجيه المراجعة؟</div>
        {snapshot.decision.reasons.map((reason) => <div key={reason}>• {reason}</div>)}
      </div> : null}

      {snapshot.smartIntelligence?.delayAttributionV29?.detected ? (
        <div className="mt-4 rounded-xl border border-orange-700/30 bg-orange-950/15 p-3 text-xs leading-6 text-orange-100/85">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-black text-orange-200">سبب التأخير/المشكلة (لا يُحتسب تلقائيًا على أي موظف)</div>
            <span>ثقة {snapshot.smartIntelligence.delayAttributionV29.confidence}%</span>
          </div>
          <div className="mt-1">{snapshot.smartIntelligence.delayAttributionV29.label} — {delayResponsibilityLabel[snapshot.smartIntelligence.delayAttributionV29.caseResponsibility] || snapshot.smartIntelligence.delayAttributionV29.caseResponsibility}</div>
          {snapshot.smartIntelligence.delayAttributionV29.responsibleStaffName ? (
            <div className="mt-1">المسؤول المرصود: <b>{snapshot.smartIntelligence.delayAttributionV29.responsibleStaffName}</b>{snapshot.smartIntelligence.delayAttributionV29.responsibleRole ? ` — ${snapshot.smartIntelligence.delayAttributionV29.responsibleRole}` : ''}</div>
          ) : null}
          {snapshot.smartIntelligence.delayAttributionV29.reasons.map((reason) => <div key={reason}>• {reason}</div>)}
          {snapshot.smartIntelligence.delayAttributionV29.trainingFocus ? (
            <div className="mt-2 font-bold">توصية تدريبية: {snapshot.smartIntelligence.delayAttributionV29.trainingFocus}</div>
          ) : null}
        </div>
      ) : null}

      {evaluationV2 || staffTiming ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {evaluationV2 ? (
            <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-3 text-xs leading-6 text-emerald-100/85">
              <div className="font-black text-emerald-200">نتيجة البيع ومتابعة الفرص</div>
              <div className="mt-1">{evaluationV2.sale.label} — ثقة {evaluationV2.sale.confidence}%{evaluationV2.sale.invoiceNumber ? ` (فاتورة ${evaluationV2.sale.invoiceNumber})` : ''}</div>
              {evaluationV2.orderCompleteness.applicable ? (
                <div className="mt-1">اكتمال بيانات الأوردر: {evaluationV2.orderCompleteness.confirmedCount}/{evaluationV2.orderCompleteness.requiredCount}{evaluationV2.orderCompleteness.missingCritical.length ? ` — الناقص: ${evaluationV2.orderCompleteness.missingCritical.join('، ')}` : ''}</div>
              ) : null}
              {evaluationV2.followups.length ? (
                <div className="mt-2">
                  <div className="font-bold text-emerald-200">فرص متابعة مقترحة:</div>
                  {evaluationV2.followups.map((item) => <div key={item.type}>• {item.label} ({item.timingLabel})</div>)}
                </div>
              ) : <div className="mt-2 text-slate-400">لا توجد فرصة متابعة إضافية واضحة.</div>}
            </div>
          ) : null}

          {staffTiming ? (
            <div className="rounded-xl border border-sky-700/30 bg-sky-950/10 p-3 text-xs leading-6 text-sky-100/85">
              <div className="font-black text-sky-200">توقيت الموظف الحالي (لا يشمل تأخير موظف آخر)</div>
              <div className="mt-1">أول رد: {timingDuration(staffTiming.responseSummary.firstResponseSeconds)} • متوسط الرد: {timingDuration(staffTiming.responseSummary.medianResponseSeconds)}</div>
              <div className="mt-1">طلب العميل → أول رد: {timingDuration(staffTiming.orderTimeline.requestToFirstResponseSeconds)}</div>
              <div className="mt-1">طلب العميل → تأكيد الأوردر: {timingDuration(staffTiming.orderTimeline.requestToConfirmationSeconds)}</div>
              {staffTiming.orderTimeline.delayOrProblemAt ? (
                <div className="mt-1">ظهور المشكلة → المعالجة: {timingDuration(staffTiming.orderTimeline.problemToRecoverySeconds)}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
