import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewResult } from '@/lib/whatsappSmartReviewResult';

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

export default function SmartConversationReviewRebuild() {
  const [fileName, setFileName] = useState('');
  const [sessions, setSessions] = useState<WhatsAppConversationSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState('');

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions.at(-1) || null,
    [sessions, selectedSessionId],
  );

  const review = useMemo(
    () => selectedSession ? buildSmartConversationReviewResult(selectedSession) : null,
    [selectedSession],
  );

  const visibleStaff = useMemo(() => {
    if (!review) return [];
    if (!selectedStaff) return review.staffSummaries;
    return review.staffSummaries.filter((item) => `${item.staffName}::${item.role}` === selectedStaff);
  }, [review, selectedStaff]);

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
      setSelectedStaff('');
      toast.success(`تمت قراءة ${messages.length} رسالة داخل ${parsedSessions.length} جلسة`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة الملف');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black text-cyan-300">SMART REVIEW • REBUILD</div>
            <h1 className="mt-1 text-2xl font-black text-white">مراجعة المحادثات الذكية</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
              نسخة نظيفة للمراجعة فقط: تقسيم الجلسات، تحديد المسؤول المؤكد، سرعة الرد داخل ملكيته، الرحلة، النتيجة والدليل. لا يوجد اعتماد نقاط أو خصم تلقائي.
            </p>
          </div>
          <label className="cursor-pointer rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">
            {loading ? 'جاري القراءة…' : 'رفع محادثة ZIP / TXT / MD'}
            <input className="hidden" type="file" accept=".zip,.txt,.md" disabled={loading} onChange={(event) => onFile(event.target.files?.[0])} />
          </label>
        </div>
        {fileName ? <div className="mt-3 text-xs text-slate-400">الملف: <b className="text-white">{fileName}</b></div> : null}
      </section>

      {!selectedSession ? (
        <section className="dawaa-card p-8 text-center text-slate-400">ارفع محادثة لبدء المراجعة.</section>
      ) : (
        <>
          <section className="dawaa-card p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-slate-400">الجلسة
                <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" value={selectedSession.id} onChange={(e) => { setSelectedSessionId(e.target.value); setSelectedStaff(''); }}>
                  {sessions.map((session, index) => <option key={session.id} value={session.id}>جلسة {index + 1} — {fmt(session.startedAt)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-400">المسؤول
                <select className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)}>
                  <option value="">كل المسؤولين المؤكدين</option>
                  {review?.staffSummaries.map((item) => <option key={`${item.staffName}::${item.role}`} value={`${item.staffName}::${item.role}`}>{item.staffName} — {item.role === 'customer_service' ? 'خدمة العملاء' : 'صيدلي'}</option>)}
                </select>
              </label>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-xs text-slate-500">الفترة</div>
                <div className="mt-1 text-sm font-bold text-white">{fmt(selectedSession.startedAt)}</div>
                <div className="text-xs text-slate-400">إلى {fmt(selectedSession.endedAt)}</div>
              </div>
              <div className={`rounded-xl border p-3 ${review?.safeForOfficialScoring ? 'border-emerald-700/50 bg-emerald-950/20' : 'border-amber-700/50 bg-amber-950/20'}`}>
                <div className="text-xs text-slate-400">حالة الأمان</div>
                <div className="mt-1 text-sm font-black text-white">{review?.safeForOfficialScoring ? 'صالحة للمراجعة المنظمة' : 'تحتاج مراجعة بشرية'}</div>
                <div className="text-xs text-slate-400">بدون اعتماد درجات تلقائي</div>
              </div>
            </div>
          </section>

          {review?.blockingReasons.length ? (
            <section className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-4">
              <div className="font-black text-amber-200">موانع الاعتماد التلقائي</div>
              <div className="mt-2 space-y-1 text-sm text-amber-100/80">{review.blockingReasons.map((reason) => <div key={reason}>• {reason}</div>)}</div>
            </section>
          ) : null}

          <section className="space-y-4">
            {visibleStaff.map((item) => (
              <article key={`${item.staffName}-${item.startedAt.toISOString()}`} className="dawaa-card dawaa-card--raised overflow-hidden">
                <div className="border-b border-slate-800 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-black text-white">{item.staffName}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.role === 'customer_service' ? 'خدمة العملاء' : 'صيدلي'} • {fmt(item.startedAt)} → {fmt(item.endedAt)}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${item.requiresHumanReview ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{item.requiresHumanReview ? 'مراجعة بشرية' : 'لا توجد مشكلة مؤكدة'}</span>
                  </div>
                </div>

                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">نوع المرحلة</div><div className="mt-1 font-black text-white">{item.primaryTypes.map((x) => stageLabels[x]).join(' + ') || 'غير محدد'}</div></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">آخر نية</div><div className="mt-1 font-black text-white">{stageLabels[item.finalIntent]}</div></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">النتيجة</div><div className="mt-1 font-black text-white">{outcomeLabels[item.outcome]}</div></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">أطول انتظار داخل الملكية</div><div className="mt-1 font-black text-white">{fmtDuration(item.maxResponseSeconds)}</div></div>
                </div>

                <div className="grid gap-4 px-4 pb-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 p-3">
                    <div className="text-sm font-black text-white">رحلة المرحلة</div>
                    <div className="mt-2 flex flex-wrap gap-2">{item.journey.length ? item.journey.map((x) => <span key={x} className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200">{stageLabels[x]}</span>) : <span className="text-xs text-slate-500">لا توجد مراحل مؤكدة</span>}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 p-3">
                    <div className="text-sm font-black text-white">الردود</div>
                    <div className="mt-2 text-xs leading-6 text-slate-300">أدوار رد: <b>{item.responseTurnCount}</b> • بدون رد: <b>{item.unansweredTurns}</b> • أبطأ من 10 دقائق: <b>{item.slowResponseTurns}</b></div>
                  </div>
                  <div className="rounded-xl border border-slate-800 p-3">
                    <div className="text-sm font-black text-white">بنود تستحق المراجعة</div>
                    <div className="mt-2 flex flex-wrap gap-2">{item.suggestedReviewCriteria.length ? item.suggestedReviewCriteria.map((x) => <span key={x} className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">{x}</span>) : <span className="text-xs text-slate-500">لا يوجد بند مقترح</span>}</div>
                  </div>
                </div>

                {item.reviewReasons.length ? <div className="mx-4 mb-4 rounded-xl border border-amber-800/40 bg-amber-950/20 p-3"><div className="text-sm font-black text-amber-200">لماذا تحتاج مراجعة؟</div><div className="mt-2 space-y-1 text-xs leading-6 text-amber-100/80">{item.reviewReasons.map((reason) => <div key={reason}>• {reason}</div>)}</div></div> : null}

                <details className="border-t border-slate-800 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-black text-slate-200">إظهار الأدلة والرسائل المرتبطة</summary>
                  <div className="mt-3 space-y-2">
                    {selectedSession.messages.filter((m) => item.messageIds.includes(m.id)).map((message) => (
                      <div key={message.id} className={`rounded-xl border p-3 text-sm ${message.direction === 'outbound' ? 'border-cyan-900/40 bg-cyan-950/20' : 'border-slate-800 bg-slate-950/40'}`}>
                        <div className="mb-1 flex justify-between gap-3 text-[11px] text-slate-500"><span>{message.direction === 'outbound' ? item.staffName : 'العميل'}</span><span>{fmt(message.timestamp)}</span></div>
                        <div className="whitespace-pre-wrap leading-7 text-slate-200">{message.text || `[${message.kind}]`}</div>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </section>

          {review?.handoffs.length ? (
            <section className="dawaa-card p-4">
              <div className="text-sm font-black text-white">التحويلات المؤكدة</div>
              <div className="mt-3 flex flex-wrap gap-2">{review.handoffs.map((handoff, index) => <span key={`${handoff.evidenceMessageId}-${index}`} className="rounded-full bg-slate-800 px-3 py-1.5 text-xs text-slate-200">{handoff.from || 'غير مسند'} → {handoff.to} • {fmt(handoff.at)}</span>)}</div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
