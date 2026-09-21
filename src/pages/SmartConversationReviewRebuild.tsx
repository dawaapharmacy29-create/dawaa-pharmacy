import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewResult } from '@/lib/whatsappSmartReviewResult';
import { buildSmartQuickDecision } from '@/lib/whatsappSmartReviewDecision';
import { runSmartReviewPipeline } from '@/lib/whatsappSmartReviewPipeline';
import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';

const stageLabels: Record<string, string> = {
  customer_service_followup: 'متابعة خدمة عملاء',
  product_request: 'طلب / استفسار عن صنف',
  pharmacist_consultation: 'استشارة صيدلية',
  complaint_or_service_issue: 'شكوى / ملاحظة خدمة',
  order_confirmation: 'تأكيد طلب',
  service_recovery: 'معالجة / اعتذار عن مشكلة',
  unknown: 'غير محدد',
};

const outcomeLabels: Record<string, string> = {
  open: 'محادثة مفتوحة',
  order_requested_unverified: 'طلب موجود - البيع غير مؤكد',
  invoice_verified_sale: 'بيع مؤكد بفاتورة',
  service_issue_open: 'مشكلة خدمة مفتوحة',
  service_issue_recovered: 'تمت معالجة مشكلة الخدمة',
  closed_no_sale: 'أغلقت بدون بيع',
  needs_review: 'تحتاج مراجعة',
};

const decisionLabels = {
  clear: 'سليمة بالكامل',
  issue: 'فيها ملاحظة',
  detailed_review: 'تحتاج مراجعة تفصيلية',
};

const criteriaLabels: Record<string, string> = {
  first_response_speed: 'سرعة الرد', understanding: 'فهم الطلب', order_delay_handling: 'متابعة تأخير الأوردر',
  angry_customer: 'التعامل مع الشكوى', sales_closing: 'إغلاق البيع', order_confirmation: 'تأكيد الطلب',
  consultation_quality: 'جودة الاستشارة', dosage_explanation: 'الجرعة وطريقة الاستخدام', unavailable_items: 'النواقص والبدائل',
};

function fmt(date: Date) {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function fmtDuration(seconds: number | null) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds} ث`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} س${rest ? ` ${rest} د` : ''}`;
}

function parseStaffKey(value: string) {
  if (!value) return null;
  const [staffName, role] = value.split('::');
  return staffName && role ? { staffName, role: role as SmartStaffRole } : null;
}

export default function SmartConversationReviewRebuild() {
  const [fileName, setFileName] = useState('');
  const [sessions, setSessions] = useState<WhatsAppConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedStaffKey, setSelectedStaffKey] = useState('');
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [contextMessages, setContextMessages] = useState(2);
  const [loading, setLoading] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions.at(-1) || null,
    [sessions, selectedSessionId],
  );
  const baseReview = useMemo(() => selectedSession ? buildSmartConversationReviewResult(selectedSession) : null, [selectedSession]);
  const selectedStaff = useMemo(() => parseStaffKey(selectedStaffKey), [selectedStaffKey]);

  const pipeline = useMemo(() => {
    if (!selectedSession || !selectedStaff) return null;
    return runSmartReviewPipeline(selectedSession, {
      staffName: selectedStaff.staffName,
      role: selectedStaff.role,
      from: fromValue ? new Date(fromValue) : null,
      to: toValue ? new Date(toValue) : null,
      contextMessages,
    });
  }, [selectedSession, selectedStaff, fromValue, toValue, contextMessages]);

  const activeReview = selectedStaff ? pipeline?.review || null : baseReview;
  const decision = useMemo(() => {
    if (selectedStaff) return pipeline?.decision || null;
    return baseReview ? buildSmartQuickDecision(baseReview) : null;
  }, [selectedStaff, pipeline, baseReview]);
  const visibleStaff = activeReview?.staffSummaries || [];

  async function onFile(file?: File) {
    if (!file) return;
    setLoading(true);
    try {
      const read = await readWhatsAppExportFile(file);
      const messages = parseWhatsAppExport(read.text);
      if (!messages.length) throw new Error('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
      const parsedSessions = splitWhatsAppSessions(messages, 120);
      if (!parsedSessions.length) throw new Error('لم يتم تكوين جلسات قابلة للمراجعة.');
      setFileName(file.name);
      setSessions(parsedSessions);
      setSelectedSessionId(parsedSessions.at(-1)?.id || '');
      setSelectedStaffKey(''); setFromValue(''); setToValue('');
      toast.success(`تمت قراءة ${messages.length} رسالة داخل ${parsedSessions.length} جلسة`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة الملف');
    } finally { setLoading(false); }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black text-cyan-300">SMART REVIEW • SAFE REBUILD</div>
            <h1 className="mt-1 text-2xl font-black text-white">مراجعة المحادثات الذكية</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">رفع المحادثة ← اختيار المسؤول والفترة ← تحليل الجزء المملوك له فقط ← قرار سريع مع الدليل. لا درجات ولا خصم تلقائي.</p>
          </div>
          <label className="cursor-pointer rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">
            {loading ? 'جاري القراءة…' : 'رفع ZIP / TXT / MD'}
            <input className="hidden" type="file" accept=".zip,.txt,.md" disabled={loading} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
        {fileName ? <div className="mt-3 text-xs text-slate-400">الملف: <b className="text-white">{fileName}</b></div> : null}
      </section>

      {!selectedSession ? <section className="dawaa-card p-8 text-center text-slate-400">ارفع محادثة لبدء المراجعة.</section> : <>
        <section className="dawaa-card p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-xs text-slate-400">الجلسة
              <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" value={selectedSession.id} onChange={(e) => { setSelectedSessionId(e.target.value); setSelectedStaffKey(''); setFromValue(''); setToValue(''); }}>
                {sessions.map((session, index) => <option key={session.id} value={session.id}>جلسة {index + 1} — {fmt(session.startedAt)}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">المسؤول المؤكد
              <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" value={selectedStaffKey} onChange={(e) => { setSelectedStaffKey(e.target.value); setFromValue(''); setToValue(''); }}>
                <option value="">عرض عام — بدون Scope</option>
                {baseReview?.staffSummaries.map((item) => <option key={`${item.staffName}::${item.role}`} value={`${item.staffName}::${item.role}`}>{item.staffName} — {item.role === 'customer_service' ? 'خدمة العملاء' : 'صيدلي'}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">من
              <input type="datetime-local" disabled={!selectedStaff} value={fromValue} onChange={(e) => setFromValue(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-40" />
            </label>
            <label className="text-xs text-slate-400">إلى
              <input type="datetime-local" disabled={!selectedStaff} value={toValue} onChange={(e) => setToValue(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-40" />
            </label>
            <label className="text-xs text-slate-400">رسائل سياق قبل/بعد
              <select disabled={!selectedStaff} value={contextMessages} onChange={(e) => setContextMessages(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white disabled:opacity-40">
                {[0,1,2,3,5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          {selectedStaff && pipeline ? <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-slate-900 px-3 py-1">داخل التقييم: {pipeline.scope.scopedMessageCount}</span>
            <span className="rounded-full bg-slate-900 px-3 py-1">سياق فقط: {pipeline.scope.contextMessageCount}</span>
            <span className="rounded-full bg-slate-900 px-3 py-1">إجمالي الجلسة: {pipeline.scope.originalMessageCount}</span>
          </div> : null}
        </section>

        {decision ? <section className={`rounded-2xl border p-4 ${decision.decision === 'clear' ? 'border-emerald-700/50 bg-emerald-950/20' : decision.decision === 'issue' ? 'border-amber-700/50 bg-amber-950/20' : 'border-rose-800/50 bg-rose-950/20'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-xs text-slate-400">قرار المراجعة الذكي</div><div className="mt-1 text-xl font-black text-white">{decisionLabels[decision.decision]}</div></div>
            <div className="text-xs text-slate-300">{decision.safeToQuickApprove ? 'يمكن الاعتماد السريع بعد تأكيد المراجع' : 'لا يتم اعتماد أي درجة تلقائيًا'}</div>
          </div>
          {decision.reasons.length ? <div className="mt-3 space-y-1 text-sm text-slate-200">{decision.reasons.map((reason) => <div key={reason}>• {reason}</div>)}</div> : null}
          {decision.affectedCriteria.length ? <div className="mt-3 flex flex-wrap gap-2">{decision.affectedCriteria.map((item) => <span key={item} className="rounded-full bg-black/20 px-2.5 py-1 text-xs text-white">{criteriaLabels[item] || item}</span>)}</div> : null}
        </section> : null}

        {selectedStaff && pipeline && !pipeline.scope.valid ? <section className="rounded-2xl border border-rose-800/50 bg-rose-950/20 p-4 text-sm text-rose-100">{pipeline.scope.blockingReasons.map((reason) => <div key={reason}>• {reason}</div>)}</section> : null}

        <section className="space-y-4">
          {visibleStaff.map((item) => <article key={`${item.staffName}-${item.startedAt.toISOString()}`} className="dawaa-card dawaa-card--raised overflow-hidden">
            <div className="border-b border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-xl font-black text-white">{item.staffName}</div><div className="mt-1 text-xs text-slate-400">{item.role === 'customer_service' ? 'خدمة العملاء' : 'صيدلي'} • {fmt(item.startedAt)} → {fmt(item.endedAt)}</div></div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${item.requiresHumanReview ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{item.requiresHumanReview ? 'تحتاج مراجعة' : 'لا توجد مشكلة مؤكدة'}</span>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">نوع المرحلة</div><div className="mt-1 font-black text-white">{item.primaryTypes.map((x) => stageLabels[x]).join(' + ') || 'غير محدد'}</div></div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">آخر نية</div><div className="mt-1 font-black text-white">{stageLabels[item.finalIntent]}</div></div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">النتيجة</div><div className="mt-1 font-black text-white">{outcomeLabels[item.outcome]}</div></div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">أطول انتظار محسوب</div><div className="mt-1 font-black text-white">{fmtDuration(item.maxResponseSeconds)}</div></div>
            </div>
            <div className="grid gap-4 px-4 pb-4 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-800 p-3"><div className="text-sm font-black text-white">رحلة المرحلة</div><div className="mt-2 flex flex-wrap gap-2">{item.journey.length ? item.journey.map((x) => <span key={x} className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200">{stageLabels[x]}</span>) : <span className="text-xs text-slate-500">لا توجد مراحل مؤكدة</span>}</div></div>
              <div className="rounded-xl border border-slate-800 p-3"><div className="text-sm font-black text-white">الردود</div><div className="mt-2 text-xs leading-6 text-slate-300">أدوار رد: <b>{item.responseTurnCount}</b> • بدون رد: <b>{item.unansweredTurns}</b> • أبطأ من 10 دقائق: <b>{item.slowResponseTurns}</b></div></div>
              <div className="rounded-xl border border-slate-800 p-3"><div className="text-sm font-black text-white">بنود تستحق المراجعة</div><div className="mt-2 flex flex-wrap gap-2">{item.suggestedReviewCriteria.length ? item.suggestedReviewCriteria.map((x) => <span key={x} className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">{criteriaLabels[x] || x}</span>) : <span className="text-xs text-slate-500">لا يوجد بند مقترح</span>}</div></div>
            </div>
          </article>)}
        </section>

        {selectedStaff && pipeline?.scope.displayMessages.length ? <section className="dawaa-card p-4">
          <div className="font-black text-white">المحادثة داخل النطاق + السياق</div>
          <div className="mt-3 space-y-2">{pipeline.scope.displayMessages.map((message) => {
            const contextOnly = pipeline.scope.contextMessageIds.includes(message.id);
            return <div key={message.id} className={`rounded-xl border p-3 ${contextOnly ? 'border-dashed border-slate-700 bg-slate-950/20 opacity-70' : message.direction === 'outbound' ? 'border-cyan-900/40 bg-cyan-950/20' : 'border-slate-800 bg-slate-950/40'}`}>
              <div className="mb-1 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span>{contextOnly ? 'سياق فقط — لا يدخل في التقييم' : message.direction === 'outbound' ? selectedStaff.staffName : 'العميل'}</span><span>{fmt(message.timestamp)}</span></div>
              <div className="whitespace-pre-wrap text-sm leading-7 text-slate-200">{message.text || `[${message.kind}]`}</div>
            </div>;
          })}</div>
        </section> : null}
      </>}
    </div>
  );
}
