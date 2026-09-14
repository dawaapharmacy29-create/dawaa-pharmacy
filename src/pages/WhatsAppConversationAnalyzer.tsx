import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileArchive, MessageSquareText, Upload, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';

function formatDate(value: Date) {
  return value.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return 'غير محسوب';
  if (seconds < 60) return `${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} د ${rest} ث` : `${minutes} دقيقة`;
}

function SignalBadge({ active, children }: { active: boolean; children: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${active ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 bg-slate-900/50 text-slate-500'}`}>
      {children}
    </span>
  );
}

function SessionCard({ session, active, onClick }: { session: WhatsAppConversationSession; active: boolean; onClick: () => void }) {
  const signals = extractConversationSignals(session);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-3 text-right transition ${active ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-slate-700 bg-slate-950/35 hover:border-slate-500'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-black text-white">{session.customerName || 'عميل غير محدد'}</div>
          <div className="mt-1 text-xs text-slate-400">{formatDate(session.startedAt)}</div>
        </div>
        <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-black text-slate-200">{session.messages.length} رسالة</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {session.outboundStaffNames.length ? <span className="text-emerald-300">د: {session.outboundStaffNames.join('، ')}</span> : <span className="text-amber-300">الدكتور غير مكتشف</span>}
        {signals.complaintOrEscalationDetected ? <span className="text-rose-300">• شكوى/تصعيد محتمل</span> : null}
        {signals.mediaCount ? <span className="text-violet-300">• ميديا {signals.mediaCount}</span> : null}
      </div>
    </button>
  );
}

export default function WhatsAppConversationAnalyzer() {
  const [fileName, setFileName] = useState('');
  const [sessions, setSessions] = useState<WhatsAppConversationSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = sessions.find((session) => session.id === selectedId) || sessions[0] || null;
  const signals = useMemo(() => (selected ? extractConversationSignals(selected) : null), [selected]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const source = await readWhatsAppExportFile(file);
      const messages = parseWhatsAppExport(source.text);
      if (!messages.length) throw new Error('لم يتم التعرف على أي رسائل WhatsApp داخل الملف.');
      const parsedSessions = splitWhatsAppSessions(messages, 120);
      setFileName(source.innerFileName ? `${source.sourceFileName} → ${source.innerFileName}` : source.sourceFileName);
      setSessions(parsedSessions);
      setSelectedId(parsedSessions[0]?.id || '');
      toast.success(`تم تحليل ${messages.length} رسالة وتقسيمها إلى ${parsedSessions.length} جلسة`);
    } catch (error) {
      setFileName('');
      setSessions([]);
      setSelectedId('');
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف المحادثة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-5">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-200"><MessageSquareText size={22} /><span className="text-xs font-black">مختبر تجريبي — بدون حفظ أو خصم نقاط</span></div>
            <h1 className="mt-2 text-2xl font-black text-white">محلل محادثات واتساب الذكي</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">ارفع Export واتساب بصيغة ZIP أو TXT. التحليل الأولي يتم محليًا في المتصفح: تقسيم الجلسات، تحديد الدكتور، حساب أزمنة الرد واكتشاف إشارات البيع والمتابعة والشكوى والتوصيل.</p>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-5 py-3 font-black text-cyan-100 hover:bg-cyan-500/15">
            <Upload size={18} /> {loading ? 'جاري القراءة...' : 'رفع محادثة'}
            <input type="file" className="hidden" accept=".zip,.txt,.md,text/plain,application/zip" disabled={loading} onChange={(e) => void handleFile(e.target.files?.[0])} />
          </label>
        </div>
        {fileName ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"><FileArchive size={15} />{fileName}</div> : null}
      </section>

      {!selected ? (
        <section className="dawaa-card dawaa-card--soft p-10 text-center">
          <Upload className="mx-auto text-slate-500" size={36} />
          <div className="mt-3 font-black text-white">ابدأ برفع ملف محادثة حقيقي</div>
          <div className="mt-2 text-sm text-slate-400">لن يتم إنشاء تقييم أو نقاط تلقائيًا في هذه المرحلة.</div>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="dawaa-card dawaa-card--soft space-y-2 p-3 xl:max-h-[760px] xl:overflow-y-auto">
            <div className="px-1 pb-2 text-sm font-black text-white">الجلسات المكتشفة ({sessions.length})</div>
            {sessions.map((session) => <SessionCard key={session.id} session={session} active={session.id === selected.id} onClick={() => setSelectedId(session.id)} />)}
          </aside>

          <main className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">أول رد</div><div className="mt-2 text-xl font-black text-cyan-200">{formatDuration(signals?.firstResponseSeconds ?? null)}</div></div>
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">أطول انتظار</div><div className="mt-2 text-xl font-black text-amber-200">{formatDuration(signals?.longestCustomerWaitSeconds ?? null)}</div></div>
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">رسائل بلا رد لاحق</div><div className="mt-2 text-xl font-black text-rose-200">{signals?.unansweredInboundCount ?? 0}</div></div>
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">ثقة الأدلة النصية</div><div className="mt-2 text-xl font-black text-emerald-200">{signals?.deterministicConfidence ?? 0}%</div></div>
            </section>

            <section className="dawaa-card dawaa-card--soft p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-black text-white"><UserRound size={17} />{selected.customerName || 'عميل غير محدد'}</div>
                  <div className="mt-1 text-xs text-slate-400">{formatDate(selected.startedAt)} ← {formatDate(selected.endedAt)}</div>
                </div>
                <div className="text-xs text-slate-300">الدكتور/الدكاترة: <b className="text-emerald-200">{selected.outboundStaffNames.join('، ') || 'لم يتم التعرف'}</b></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <SignalBadge active={Boolean(signals?.greetingDetected)}>ترحيب</SignalBadge>
                <SignalBadge active={Boolean(signals?.saleIntentDetected)}>نية بيع</SignalBadge>
                <SignalBadge active={Boolean(signals?.deliveryIntentDetected)}>توصيل</SignalBadge>
                <SignalBadge active={Boolean(signals?.followupPromiseDetected)}>وعد متابعة</SignalBadge>
                <SignalBadge active={Boolean(signals?.complaintOrEscalationDetected)}>شكوى/تصعيد</SignalBadge>
                <SignalBadge active={Boolean(signals?.apologyDetected)}>اعتذار</SignalBadge>
                <SignalBadge active={Boolean(signals?.closingDetected)}>إغلاق محادثة</SignalBadge>
                <SignalBadge active={Boolean(signals?.repeatedCustomerNudgeDetected)}>استعجال متكرر</SignalBadge>
              </div>
              {signals?.mediaCount ? (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs leading-6 text-amber-100">
                  <AlertTriangle className="mt-0.5 shrink-0" size={16} /> يوجد {signals.mediaCount} عنصر ميديا ({signals.missingEvidence.join('، ')}). لن يفترض النظام محتواها، وده يقلل الثقة لحد ما نضيف تحليل الصوت/الصور.
                </div>
              ) : null}
            </section>

            <section className="dawaa-card dawaa-card--raised p-4">
              <div className="mb-4 flex items-center justify-between"><div className="font-black text-white">Timeline المحادثة</div><div className="flex items-center gap-1 text-xs text-slate-400"><Clock3 size={14} />{selected.messages.length} رسالة</div></div>
              <div className="max-h-[620px] space-y-2 overflow-y-auto rounded-2xl bg-slate-950/45 p-3">
                {selected.messages.map((message) => {
                  const outgoing = message.direction === 'outbound';
                  return (
                    <div key={message.id} className={`flex ${outgoing ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[88%] rounded-2xl border px-3 py-2 ${outgoing ? 'border-emerald-400/20 bg-emerald-500/10' : 'border-cyan-400/20 bg-cyan-500/10'}`}>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400"><b className={outgoing ? 'text-emerald-200' : 'text-cyan-200'}>{message.sender}</b><span>{message.timestamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span>{message.kind !== 'text' ? `• ${message.kind}` : ''}</span></div>
                        <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-100">{message.text || '—'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="dawaa-card dawaa-card--soft p-4">
              <div className="flex items-start gap-3"><CheckCircle2 className="mt-1 shrink-0 text-emerald-300" size={18} /><div><div className="font-black text-white">المرحلة التالية</div><p className="mt-1 text-sm leading-7 text-slate-300">هنضيف طبقة اقتراح البنود الـ19 مع Confidence ودليل لكل حكم، ثم زر «نقل إلى نموذج التقييم» للمراجعة البشرية فقط. لن يتم حفظ أو خصم أي نقاط تلقائيًا.</p></div></div>
            </section>
          </main>
        </div>
      )}
    </div>
  );
}
