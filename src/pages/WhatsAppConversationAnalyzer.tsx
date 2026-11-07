import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileArchive,
  Gauge,
  MessageSquareText,
  PackageSearch,
  ShieldAlert,
  ShoppingCart,
  Upload,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  parseWhatsAppExport,
  splitWhatsAppSessions,
  type WhatsAppConversationSession,
} from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';
import {
  buildSessionEvidence,
  buildSmartSessions,
  buildWholeConversationOverview,
  type EvidenceItem,
  type SmartSessionKind,
  type SmartSessionView,
} from '@/lib/whatsappConversationIntelligence';
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
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-black ${
        active
          ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
          : 'border-slate-700 bg-slate-900/50 text-slate-500'
      }`}
    >
      {children}
    </span>
  );
}

const sessionKindLabel: Record<SmartSessionKind, string> = {
  customer_conversation: 'جلسة عميل',
  pharmacy_followup: 'متابعة من الصيدلية',
  customer_ping: 'رسالة عميل بلا رد',
  mixed: 'جلسة غير مكتملة',
};

const responsibilityLabel: Record<EvidenceItem['responsibility'], string> = {
  doctor: 'الدكتور',
  delivery: 'الدليفري',
  stock: 'المخزون',
  system: 'النظام',
  customer: 'العميل',
  unknown: 'تحتاج مراجعة',
};

function SessionCard({
  item,
  active,
  onClick,
}: {
  item: SmartSessionView;
  active: boolean;
  onClick: () => void;
}) {
  const { session } = item;
  const signals = extractConversationSignals(session);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-3 text-right transition ${
        active
          ? 'border-cyan-400/50 bg-cyan-500/10'
          : 'border-slate-700 bg-slate-950/35 hover:border-slate-500'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-black text-white">{item.customerName || 'عميل غير محدد'}</div>
          <div className="mt-1 text-xs text-slate-400">{formatDate(session.startedAt)}</div>
        </div>
        <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-black text-slate-200">
          {session.messages.length} رسالة
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className={item.kind === 'pharmacy_followup' ? 'text-violet-300' : 'text-cyan-300'}>
          {sessionKindLabel[item.kind]}
        </span>
        {session.outboundStaffNames.length ? (
          <span className="text-emerald-300">• د: {session.outboundStaffNames.join('، ')}</span>
        ) : (
          <span className="text-amber-300">• الدكتور غير مكتشف</span>
        )}
        {signals.complaintOrEscalationDetected ? (
          <span className="text-rose-300">• شكوى/تصعيد محتمل</span>
        ) : null}
        {signals.mediaCount ? <span className="text-violet-300">• ميديا {signals.mediaCount}</span> : null}
      </div>
    </button>
  );
}

function StatCard({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-2 text-xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

function EvidenceCard({ item, onOpen }: { item: EvidenceItem; onOpen: () => void }) {
  const tone =
    item.type === 'critical'
      ? 'border-rose-400/35 bg-rose-500/10'
      : item.type === 'warning'
        ? 'border-amber-400/30 bg-amber-500/10'
        : item.type === 'positive'
          ? 'border-emerald-400/30 bg-emerald-500/10'
          : 'border-cyan-400/25 bg-cyan-500/10';
  return (
    <button type="button" onClick={onOpen} className={`w-full rounded-2xl border p-3 text-right transition hover:brightness-110 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-black text-white">{item.label}</div>
          <div className="mt-1 text-xs leading-6 text-slate-300">{item.detail}</div>
        </div>
        <span className="shrink-0 rounded-lg bg-slate-950/50 px-2 py-1 text-[10px] font-black text-slate-200">
          ثقة {item.confidence}%
        </span>
      </div>
      <div className="mt-2 text-[11px] text-slate-400">
        المسؤول المحتمل: <b className="text-slate-200">{responsibilityLabel[item.responsibility]}</b>
        {item.messageIds.length ? ' • اضغط للانتقال للدليل' : ''}
      </div>
    </button>
  );
}

export default function WhatsAppConversationAnalyzer() {
  const [fileName, setFileName] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [sessions, setSessions] = useState<WhatsAppConversationSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);

  const smartModel = useMemo(
    () => buildSmartSessions(sessions, sourceFileName || fileName),
    [sessions, sourceFileName, fileName]
  );
  const smartSessions = smartModel.sessions;
  const selectedItem =
    smartSessions.find((item) => item.session.id === selectedId)
    || smartSessions.find((item) => item.session.id === smartModel.preferredSessionId)
    || smartSessions[0]
    || null;
  const selected = selectedItem?.session || null;
  const signals = useMemo(() => (selected ? extractConversationSignals(selected) : null), [selected]);
  const evidence = useMemo(() => (selected ? buildSessionEvidence(selected) : []), [selected]);
  const overview = useMemo(
    () => buildWholeConversationOverview(smartSessions, smartModel.identity),
    [smartSessions, smartModel.identity]
  );

  const jumpToMessage = (messageId?: string) => {
    if (!messageId) return;
    const node = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (node instanceof HTMLElement) {
      node.animate(
        [
          { outline: '0 solid rgba(34,211,238,0)' },
          { outline: '3px solid rgba(34,211,238,.75)' },
          { outline: '0 solid rgba(34,211,238,0)' },
        ],
        { duration: 1400 }
      );
    }
  };

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const source = await readWhatsAppExportFile(file);
      const messages = parseWhatsAppExport(source.text);
      if (!messages.length) throw new Error('لم يتم التعرف على أي رسائل WhatsApp داخل الملف.');
      const parsedSessions = splitWhatsAppSessions(messages, 120);
      const built = buildSmartSessions(parsedSessions, source.sourceFileName);
      setSourceFileName(source.sourceFileName);
      setFileName(source.innerFileName ? `${source.sourceFileName} → ${source.innerFileName}` : source.sourceFileName);
      setSessions(parsedSessions);
      setSelectedId(built.preferredSessionId || '');
      toast.success(`تم تحليل ${messages.length} رسالة وتقسيمها إلى ${parsedSessions.length} جلسة`);
    } catch (error) {
      setFileName('');
      setSourceFileName('');
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
            <div className="flex items-center gap-2 text-cyan-200">
              <MessageSquareText size={22} />
              <span className="text-xs font-black">مختبر تجريبي — بدون حفظ أو خصم نقاط</span>
            </div>
            <h1 className="mt-2 text-2xl font-black text-white">محلل محادثات واتساب الذكي</h1>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-slate-300">
              التحليل يجمع بين مستوى المحادثة كلها ومستوى كل جلسة: هوية العميل، تبديل الدكاترة، سرعة الرد، الشكوى، البيع، الدليفري، المتابعة والدليل الذي بُني عليه كل حكم.
            </p>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-5 py-3 font-black text-cyan-100 hover:bg-cyan-500/15">
            <Upload size={18} /> {loading ? 'جاري القراءة...' : 'رفع محادثة'}
            <input
              type="file"
              className="hidden"
              accept=".zip,.txt,.md,text/plain,application/zip"
              disabled={loading}
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </label>
        </div>
        {fileName ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            <FileArchive size={15} />{fileName}
          </div>
        ) : null}
      </section>

      {!selected ? (
        <section className="dawaa-card dawaa-card--soft p-10 text-center">
          <Upload className="mx-auto text-slate-500" size={36} />
          <div className="mt-3 font-black text-white">ابدأ برفع ملف محادثة حقيقي</div>
          <div className="mt-2 text-sm text-slate-400">لن يتم إنشاء تقييم أو نقاط تلقائيًا في هذه المرحلة.</div>
        </section>
      ) : (
        <>
          <section className="dawaa-card dawaa-card--raised p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black text-cyan-200">ملخص المحادثة بالكامل</div>
                <div className="mt-1 text-xl font-black text-white">
                  {overview.customerName || 'عميل غير محدد'}
                  {overview.customerCode ? <span className="mr-2 text-sm text-slate-400">#{overview.customerCode}</span> : null}
                </div>
              </div>
              <div className="text-xs text-slate-400">ثقة الأدلة المتوسطة: <b className="text-emerald-200">{overview.averageConfidence}%</b></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard label="كل الجلسات" value={overview.totalSessions} tone="text-cyan-200" />
              <StatCard label="جلسات فعلية" value={overview.meaningfulSessions} tone="text-emerald-200" />
              <StatCard label="إجمالي الرسائل" value={overview.totalMessages} />
              <StatCard label="جلسات شكوى" value={overview.complaintSessions} tone="text-rose-200" />
              <StatCard label="جلسات نية بيع" value={overview.saleIntentSessions} tone="text-amber-200" />
              <StatCard label="متابعات من الصيدلية" value={overview.followupSessions} tone="text-violet-200" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300">
                الدكاترة المكتشفون: <b className="text-emerald-200">{overview.staffNames.join('، ') || 'لم يتم التعرف'}</b>
              </span>
              <span className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300">جلسات دليفري: {overview.deliverySessions}</span>
              <span className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300">ميديا: {overview.mediaCount}</span>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="dawaa-card dawaa-card--soft space-y-2 p-3 xl:max-h-[900px] xl:overflow-y-auto">
              <div className="px-1 pb-2 text-sm font-black text-white">الجلسات المكتشفة ({smartSessions.length})</div>
              {smartSessions.map((item) => (
                <SessionCard
                  key={item.session.id}
                  item={item}
                  active={item.session.id === selected.id}
                  onClick={() => setSelectedId(item.session.id)}
                />
              ))}
            </aside>

            <main className="space-y-4">
              {selectedItem?.kind !== 'customer_conversation' ? (
                <section className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4 text-sm leading-7 text-violet-100">
                  <b>{sessionKindLabel[selectedItem?.kind || 'mixed']}:</b>{' '}
                  هذه الجلسة ليست محادثة عميل كاملة، لذلك لا نعامل عدم وجود «أول رد» فيها كخطأ. التحليل الزمني الكامل يطبق فقط عندما يكون هناك تبادل فعلي بين العميل والصيدلية.
                </section>
              ) : null}

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <StatCard label="أول رد" value={formatDuration(signals?.firstResponseSeconds ?? null)} tone="text-cyan-200" />
                <StatCard label="متوسط وسيط الرد" value={formatDuration(signals?.medianResponseSeconds ?? null)} tone="text-sky-200" />
                <StatCard label="أطول انتظار" value={formatDuration(signals?.longestCustomerWaitSeconds ?? null)} tone="text-amber-200" />
                <StatCard label="انتظار > 5د" value={signals?.waitsOver5Minutes ?? 0} tone="text-amber-200" />
                <StatCard label="انتظار > 10د" value={signals?.waitsOver10Minutes ?? 0} tone="text-rose-200" />
                <StatCard label="رسائل بلا رد" value={signals?.unansweredInboundCount ?? 0} tone="text-rose-200" />
              </section>

              <section className="dawaa-card dawaa-card--soft p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-black text-white">
                      <UserRound size={17} />{selected.customerName || overview.customerName || 'عميل غير محدد'}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{formatDate(selected.startedAt)} ← {formatDate(selected.endedAt)}</div>
                  </div>
                  <div className="text-xs text-slate-300">
                    الدكتور/الدكاترة: <b className="text-emerald-200">{selected.outboundStaffNames.join('، ') || 'لم يتم التعرف'}</b>
                  </div>
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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-black text-white"><ShieldAlert size={17} />تقرير الأدلة</div>
                    <div className="mt-1 text-xs text-slate-400">كل حكم قابل للرجوع للرسالة الأصلية، ولا يوجد خصم تلقائي.</div>
                  </div>
                  <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{evidence.length} ملاحظة</span>
                </div>
                {evidence.length ? (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {evidence.map((item) => (
                      <EvidenceCard key={item.id} item={item} onOpen={() => jumpToMessage(item.messageIds[0])} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                    لا توجد ملاحظات نصية قوية في هذه الجلسة حتى الآن. هذا لا يعني اعتمادها تلقائيًا كسليمة.
                  </div>
                )}
              </section>

              <section className="dawaa-card dawaa-card--raised p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div className="font-black text-white">Timeline المحادثة</div>
                  <div className="flex items-center gap-1 text-xs text-slate-400"><Clock3 size={14} />{selected.messages.length} رسالة</div>
                </div>
                <div className="max-h-[680px] space-y-2 overflow-y-auto rounded-2xl bg-slate-950/45 p-3">
                  {selected.messages.map((message) => {
                    const outgoing = message.direction === 'outbound';
                    const relatedEvidence = evidence.filter((item) => item.messageIds.includes(message.id));
                    const hasCritical = relatedEvidence.some((item) => item.type === 'critical');
                    const hasWarning = relatedEvidence.some((item) => item.type === 'warning');
                    const hasPositive = relatedEvidence.some((item) => item.type === 'positive');
                    const evidenceBorder = hasCritical
                      ? 'ring-2 ring-rose-400/55'
                      : hasWarning
                        ? 'ring-2 ring-amber-400/45'
                        : hasPositive
                          ? 'ring-2 ring-emerald-400/35'
                          : '';
                    return (
                      <div key={message.id} data-message-id={message.id} className={`flex ${outgoing ? 'justify-start' : 'justify-end'}`}>
                        <div
                          className={`max-w-[88%] rounded-2xl border px-3 py-2 ${evidenceBorder} ${
                            outgoing
                              ? 'border-emerald-400/20 bg-emerald-500/10'
                              : 'border-cyan-400/20 bg-cyan-500/10'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                            <b className={outgoing ? 'text-emerald-200' : 'text-cyan-200'}>{message.sender}</b>
                            <span>{message.timestamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span>{message.kind !== 'text' ? `• ${message.kind}` : ''}</span>
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-100">{message.text || '—'}</div>
                          {relatedEvidence.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {relatedEvidence.map((item) => (
                                <span key={item.id} className="rounded-full bg-slate-950/50 px-2 py-0.5 text-[10px] font-bold text-slate-200">
                                  {item.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="dawaa-card dawaa-card--soft p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="flex items-start gap-2"><ShoppingCart className="mt-1 text-amber-300" size={17} /><div><b className="text-white">البيع</b><div className="mt-1 text-xs leading-6 text-slate-400">نفصل نية الشراء عن البيع المؤكد، وربط الفاتورة هيكون مرحلة مستقلة.</div></div></div>
                  <div className="flex items-start gap-2"><PackageSearch className="mt-1 text-violet-300" size={17} /><div><b className="text-white">سبب المشكلة</b><div className="mt-1 text-xs leading-6 text-slate-400">التقرير يبدأ يفرق بين دكتور ودليفري ومخزون ونظام بدل خصم موحد.</div></div></div>
                  <div className="flex items-start gap-2"><Gauge className="mt-1 text-cyan-300" size={17} /><div><b className="text-white">الثقة</b><div className="mt-1 text-xs leading-6 text-slate-400">الميديا أو نقص السياق يقلل الثقة بدل ما الذكاء يفترض محتوى غير موجود.</div></div></div>
                </div>
              </section>

              <section className="dawaa-card dawaa-card--soft p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-1 shrink-0 text-emerald-300" size={18} />
                  <div>
                    <div className="font-black text-white">الخطوة التالية</div>
                    <p className="mt-1 text-sm leading-7 text-slate-300">
                      بعد تثبيت هوية العميل والجلسات والدليل، هنربط كل استنتاج ببنود التقييم الـ19 مع اقتراح وConfidence، ثم ننقل النتيجة لنموذج التقييم للمراجعة البشرية فقط.
                    </p>
                  </div>
                </div>
              </section>
            </main>
          </div>
        </>
      )}
    </div>
  );
}
