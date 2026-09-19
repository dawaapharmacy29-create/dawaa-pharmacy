import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, FolderOpen, Image as ImageIcon, Loader2, Mic, RefreshCw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  connectLocalWhatsAppFolder,
  getUnprocessedWhatsAppExports,
  markLocalWhatsAppFileFailed,
  markLocalWhatsAppFileProcessed,
  queryLocalWhatsAppFolderPermission,
  restoreLocalWhatsAppFolder,
  supportsLocalWhatsAppInbox,
  resetLocalWhatsAppProcessedLedger,
} from '@/lib/localWhatsAppInbox';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewResult } from '@/lib/whatsappSmartReviewResult';
import { runSmartReviewPipeline, type SmartReviewPipelineResult } from '@/lib/whatsappSmartReviewPipeline';
import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';
import type { SmartQuickDecisionResult } from '@/lib/whatsappSmartReviewDecision';
import {
  buildConversationReviewSnapshot,
  writePendingConversationReviewTransfer,
  type ConversationReviewSnapshot,
} from '@/lib/conversationReviewTranscript';
import {
  buildSmartReviewActionPlan,
  writeSmartCustomerRequestTransfer,
  writeSmartFollowupTransfer,
  type SmartReviewActionPlan,
} from '@/lib/whatsappSmartReviewActions';

type StaffRun = {
  sessionId: string;
  customerName: string | null;
  staffName: string;
  role: SmartStaffRole;
  decision: SmartQuickDecisionResult['decision'];
  safe: boolean;
  reasons: string[];
  criteria: string[];
  intelligence: ReturnType<typeof runSmartReviewPipeline>['intelligence'];
  /** Cross-check مستقل (V6/Journey) — عرض فقط، ما بيأثرش على decision/reasons/safe فوق. */
  journeyCrossCheck: SmartReviewPipelineResult['journeyCrossCheck'];
  snapshot: ConversationReviewSnapshot;
  actions: SmartReviewActionPlan;
};

type FileRun = {
  fileName: string;
  at: string;
  messages: number;
  sessions: number;
  staffRuns: StaffRun[];
  errors: string[];
};

const INTERVAL_MS = 60_000;

function decisionLabel(value: string) {
  if (value === 'clear') return 'سليمة';
  if (value === 'issue') return 'ملاحظة';
  return 'مراجعة تفصيلية';
}

function roleLabel(role: SmartStaffRole) {
  if (role === 'customer_service') return 'خدمة العملاء';
  if (role === 'pharmacist') return 'صيدلي';
  return 'غير محدد';
}

function opportunityLabel(value: string) {
  if (value === 'handled_well') return 'تم التعامل جيدًا';
  if (value === 'partial') return 'تعامل جزئي';
  if (value === 'missed') return 'فرصة ضائعة';
  if (value === 'needs_review') return 'تحتاج مراجعة';
  return value;
}

function isVoiceMessage(kind: string, text: string) {
  return kind === 'voice' || /voice message omitted|audio omitted/i.test(text);
}

function isImageMessage(kind: string, text: string) {
  return kind === 'image' || /image omitted|photo omitted/i.test(text);
}

function messageBody(kind: string, text: string) {
  if (isVoiceMessage(kind, text)) {
    return (
      <div className="flex min-w-[220px] items-center gap-3 py-1">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><Mic size={17} /></div>
        <div className="flex flex-1 items-center gap-1">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} className="h-1 rounded-full bg-current opacity-50" style={{ width: index % 4 === 0 ? 10 : 5 }} />
          ))}
        </div>
        <span className="text-[11px] opacity-70">رسالة صوتية</span>
      </div>
    );
  }
  if (isImageMessage(kind, text)) {
    return (
      <div className="flex min-w-[220px] items-center gap-3 py-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10"><ImageIcon size={17} /></div>
        <div>
          <div className="font-bold">صورة</div>
          <div className="text-[11px] opacity-70">المحتوى غير متاح داخل تصدير واتساب</div>
        </div>
      </div>
    );
  }
  if (kind === 'document' || /document omitted/i.test(text)) {
    return (
      <div className="flex min-w-[220px] items-center gap-3 py-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10"><FileText size={17} /></div>
        <div>
          <div className="font-bold">ملف مرفق</div>
          <div className="text-[11px] opacity-70">غير متاح داخل التصدير النصي</div>
        </div>
      </div>
    );
  }
  return <div className="whitespace-pre-wrap break-words text-[14px] leading-7">{text || `[${kind}]`}</div>;
}

export default function WhatsAppSmartFolderWatcher() {
  const navigate = useNavigate();
  const handleRef = useRef<any>(null);
  const scanningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [selected, setSelected] = useState<StaffRun | null>(null);
  const [conversationView, setConversationView] = useState<'whatsapp' | 'review'>('whatsapp');

  const analyzeFile = useCallback(async (file: File): Promise<FileRun> => {
    const read = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(read.text);
    if (!messages.length) throw new Error('لم يتم التعرف على رسائل WhatsApp داخل الملف');
    const sessions = splitWhatsAppSessions(messages, 120);
    const staffRuns: StaffRun[] = [];

    for (const session of sessions) {
      const base = buildSmartConversationReviewResult(session);
      for (const staff of base.staffSummaries) {
        const result = runSmartReviewPipeline(session, {
          staffName: staff.staffName,
          role: staff.role,
          contextMessages: 2,
        });
        if (!result.scope.scoredSession) continue;

        const snapshot = buildConversationReviewSnapshot({
          session,
          displayMessages: result.scope.displayMessages,
          scoredMessageIds: result.scope.inScopeMessageIds,
          contextMessageIds: result.scope.contextMessageIds,
          evidenceMessageIds: result.decision.evidenceMessageIds,
          staffName: staff.staffName,
          staffRole: staff.role,
          sourceFileName: file.name,
          decision: result.decision,
        });

        const actions = buildSmartReviewActionPlan({
          intelligence: result.intelligence,
          staffName: staff.staffName,
          fallbackCustomerName: session.customerName || null,
        });

        staffRuns.push({
          sessionId: session.id,
          customerName: session.customerName || null,
          staffName: staff.staffName,
          role: staff.role,
          decision: result.decision.decision,
          safe: result.decision.safeToQuickApprove,
          reasons: result.decision.reasons,
          criteria: result.decision.affectedCriteria,
          intelligence: result.intelligence,
          journeyCrossCheck: result.journeyCrossCheck,
          snapshot,
          actions,
        });
      }
    }

    return {
      fileName: file.name,
      at: new Date().toLocaleString('ar-EG'),
      messages: messages.length,
      sessions: sessions.length,
      staffRuns,
      errors: [],
    };
  }, []);

  const scanOnce = useCallback(async () => {
    if (!handleRef.current || scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const candidates = await getUnprocessedWhatsAppExports(handleRef.current, 10);
      if (!candidates.length) {
        toast.message('لا توجد ملفات جديدة في الفولدر');
        return;
      }
      for (const candidate of candidates) {
        try {
          const result = await analyzeFile(candidate.file);
          markLocalWhatsAppFileProcessed(candidate.key);
          setRuns((current) => [result, ...current].slice(0, 30));
          toast.success(`تم تحليل ${candidate.name}: ${result.sessions} جلسة / ${result.staffRuns.length} مسؤول`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'خطأ غير معروف';
          markLocalWhatsAppFileFailed(candidate.key, reason);
          setRuns((current) => [{
            fileName: candidate.name,
            at: new Date().toLocaleString('ar-EG'),
            messages: 0,
            sessions: 0,
            staffRuns: [],
            errors: [reason],
          }, ...current].slice(0, 30));
        }
      }
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [analyzeFile]);

  useEffect(() => {
    void (async () => {
      const handle = await restoreLocalWhatsAppFolder();
      if (!handle) return;
      if (await queryLocalWhatsAppFolderPermission(handle, false) !== 'granted') return;
      handleRef.current = handle;
      setConnected(true);
    })();
  }, []);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void scanOnce();
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, scanOnce]);

  async function reanalyzeExisting() {
    resetLocalWhatsAppProcessedLedger();
    setRuns([]);
    toast.success('تمت إعادة تهيئة سجل الملفات — هنعيد تحليل الملفات الموجودة في الفولدر');
    await scanOnce();
  }

  async function connect() {
    try {
      const handle = await connectLocalWhatsAppFolder();
      handleRef.current = handle;
      setConnected(true);
      toast.success('تم ربط فولدر محادثات واتساب');
      void scanOnce();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر ربط الفولدر');
    }
  }

  function openOfficialReview(item: StaffRun) {
    writePendingConversationReviewTransfer(item.snapshot);
    navigate('/reviews?mode=new&fromSmart=1');
  }

  function openCustomerRequest(item: StaffRun) {
    if (!item.actions.customerRequest) return;
    writeSmartCustomerRequestTransfer(item.actions.customerRequest);
    navigate('/customer-requests?createFromSmart=1');
  }

  function openFollowup(item: StaffRun) {
    if (!item.actions.followup) return;
    writeSmartFollowupTransfer(item.actions.followup);
    navigate('/customer-service?quickFollowup=1');
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black text-cyan-300">SMART REVIEW • FOLDER WATCHER</div>
            <h1 className="mt-1 text-2xl font-black text-white">التقاط محادثات واتساب تلقائيًا</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
              اربط فولدر التصدير مرة واحدة. أي ZIP/TXT/MD جديد يتم التقاطه وتحليله بالمحرك الذكي الجديد كل دقيقة.
              اضغط على أي مسؤول لفتح المحادثة والأدلة والفرص ثم إنشاء Draft للتقييم الرسمي.
            </p>
          </div>
          {!supportsLocalWhatsAppInbox() ? (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
              استخدم Chrome أو Edge على كمبيوتر الصيدلية لربط فولدر محلي.
            </div>
          ) : !connected ? (
            <button type="button" onClick={() => void connect()} className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">
              <span className="inline-flex items-center gap-2"><FolderOpen size={16} /> ربط فولدر التصدير</span>
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={scanning} onClick={() => void scanOnce()} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                <span className="inline-flex items-center gap-2">{scanning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} فحص الآن</span>
              </button>
              <button type="button" disabled={scanning} onClick={() => void reanalyzeExisting()} className="rounded-xl border border-cyan-700/60 bg-cyan-950/20 px-4 py-2.5 text-sm font-black text-cyan-100 disabled:opacity-50">
                إعادة تحليل الملفات الموجودة
              </button>
            </div>
          )}
        </div>
        {connected ? <div className="mt-3 text-xs font-bold text-emerald-300">الفولدر متصل — فحص تلقائي كل دقيقة أثناء فتح التطبيق.</div> : null}
      </section>

      <section className="space-y-3">
        {!runs.length ? <div className="dawaa-card p-8 text-center text-slate-400">لسه مفيش ملفات جديدة تم تحليلها في هذه الجلسة. لو الملفات موجودة من اختبار سابق استخدم زر «إعادة تحليل الملفات الموجودة».</div> : null}
        {runs.map((run, runIndex) => (
          <article key={`${run.fileName}-${run.at}-${runIndex}`} className="dawaa-card overflow-hidden">
            <div className="border-b border-slate-800 p-4">
              <div className="font-black text-white">{run.fileName}</div>
              <div className="mt-1 text-xs text-slate-400">{run.at} • {run.messages} رسالة • {run.sessions} جلسة • {run.staffRuns.length} مسؤول</div>
            </div>
            {run.errors.length ? <div className="p-4 text-sm text-rose-200">{run.errors.map((error) => <div key={error}>• {error}</div>)}</div> : (
              <div className="grid gap-3 p-4 lg:grid-cols-2">
                {run.staffRuns.map((item, index) => (
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    key={`${item.sessionId}-${item.staffName}-${item.role}-${index}`}
                    className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4 text-right transition hover:border-cyan-700/60 hover:bg-cyan-950/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-black text-white">{item.staffName}</div>
                        <div className="text-xs text-slate-500">{roleLabel(item.role)} • {item.customerName || 'عميل غير محدد'}</div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${item.decision === 'clear' ? 'bg-emerald-500/15 text-emerald-200' : item.decision === 'issue' ? 'bg-amber-500/15 text-amber-200' : 'bg-rose-500/15 text-rose-200'}`}>
                        {decisionLabel(item.decision)}
                      </span>
                    </div>
                    <div className="mt-3 text-xs leading-6 text-slate-300">
                      <div>النية: <b className="text-white">{item.intelligence?.primaryIntent || 'غير محدد'}</b></div>
                      <div>فرص البيع: <b className="text-white">{item.intelligence?.salesOpportunities.length || 0}</b></div>
                      <div>متابعة مقترحة: <b className="text-white">{item.intelligence?.followup.detected ? 'نعم' : 'لا'}</b></div>
                      <div>طلب عميل: <b className="text-white">{item.intelligence?.customerRequest.detected ? 'نعم' : 'لا'}</b></div>
                    </div>
                    {item.reasons.length ? <div className="mt-3 space-y-1 text-xs text-amber-100">{item.reasons.slice(0, 3).map((reason) => <div key={reason}>• {reason}</div>)}</div> : null}
                    <div className="mt-3 inline-flex items-center gap-1 text-xs font-black text-cyan-300">فتح التفاصيل <ArrowLeft size={13} /></div>
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm md:p-6" onClick={() => setSelected(null)}>
          <div className="mx-auto max-w-5xl rounded-3xl border border-slate-700 bg-[#111c2b] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 rounded-t-3xl border-b border-slate-700 bg-[#111c2b]/95 p-4 backdrop-blur">
              <div>
                <div className="text-xl font-black text-white">{selected.staffName}</div>
                <div className="mt-1 text-xs text-slate-400">{roleLabel(selected.role)} • {selected.customerName || 'عميل غير محدد'} • {decisionLabel(selected.decision)}</div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 p-2 text-slate-300"><X size={18} /></button>
            </div>

            <div className="space-y-4 p-4">
              <section className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-xs text-slate-500">النية الأساسية</div><div className="mt-1 font-black text-white">{selected.intelligence?.primaryIntent || 'غير محدد'}</div></div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-xs text-slate-500">فرص البيع</div><div className="mt-1 font-black text-white">{selected.intelligence?.salesOpportunities.length || 0}</div></div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-xs text-slate-500">وضوح الاستشارة</div><div className="mt-1 font-black text-white">{selected.intelligence?.consultationCommunication || 'غير منطبق'}</div></div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-xs text-slate-500">الاعتماد السريع</div><div className="mt-1 font-black text-white">{selected.safe ? 'ممكن بعد مراجعة بشرية' : 'غير مسموح'}</div></div>
              </section>

              <section className="rounded-2xl border border-sky-800/50 bg-sky-950/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-black text-sky-200">Cross-check (V6/Journey)</span>
                  <span className="text-[11px] font-bold text-slate-500">مصدر مستقل — لا يؤثر على القرار أو الأسباب أعلاه</span>
                </div>
                <div className="mt-2 font-black text-white">{selected.journeyCrossCheck.journeyLabel}</div>
                <div className="mt-1 text-xs text-slate-400">
                  intent: {selected.journeyCrossCheck.checkinDetected ? 'checkin detected' : 'no checkin'}
                  {selected.journeyCrossCheck.checkinDetected
                    ? ` • طلب بعد المتابعة: ${selected.journeyCrossCheck.requestAfterCheckin ? 'نعم' : 'لا'} • استشارة بعد المتابعة: ${selected.journeyCrossCheck.consultationAfterCheckin ? 'نعم' : 'لا'}`
                    : ''}
                </div>
                <div className="mt-1 text-xs text-slate-400">{selected.journeyCrossCheck.saleStateLabel}</div>
              </section>

              {selected.reasons.length ? (
                <section className="rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4">
                  <div className="font-black text-amber-100">أسباب القرار</div>
                  <div className="mt-2 space-y-1 text-sm text-amber-50">{selected.reasons.map((reason) => <div key={reason}>• {reason}</div>)}</div>
                </section>
              ) : null}

              {selected.intelligence?.salesOpportunities.length ? (
                <section className="rounded-2xl border border-slate-800 p-4">
                  <div className="font-black text-white">فرص البيع</div>
                  <div className="mt-3 space-y-2">
                    {selected.intelligence.salesOpportunities.map((opportunity, index) => (
                      <div key={`${opportunity.triggerMessageId}-${index}`} className="rounded-xl bg-slate-950/30 p-3 text-sm">
                        <div className="font-black text-cyan-200">{opportunityLabel(opportunity.handling)}</div>
                        <div className="mt-1 text-slate-300">{opportunity.reason}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="overflow-hidden rounded-2xl border border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/35 p-4">
                  <div>
                    <div>
  <div className="flex items-center gap-2">
    <div className="font-black text-white">المحادثة والأدلة</div>
    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-slate-950">واجهة واتساب الجديدة V2</span>
  </div>
</div>
                    <div className="mt-1 text-xs text-slate-500">{selected.snapshot.messages.length} رسالة داخل النطاق والسياق</div>
                  </div>
                  <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900 p-1 text-xs font-black">
                    <button
                      type="button"
                      onClick={() => setConversationView('whatsapp')}
                      className={`rounded-lg px-3 py-1.5 ${conversationView === 'whatsapp' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}
                    >
                      عرض واتساب
                    </button>
                    <button
                      type="button"
                      onClick={() => setConversationView('review')}
                      className={`rounded-lg px-3 py-1.5 ${conversationView === 'review' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300'}`}
                    >
                      عرض تحليلي
                    </button>
                  </div>
                </div>

                {conversationView === 'whatsapp' ? (
                  <div
                    className="max-h-[58vh] overflow-y-auto p-4 md:p-5"
                    data-whatsapp-view-version="v2"
                    style={{
                      backgroundColor: '#0b141a',
                      backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,.025) 0 1px, transparent 1px), radial-gradient(circle at 75% 75%, rgba(255,255,255,.018) 0 1px, transparent 1px)',
                      backgroundSize: '28px 28px',
                    }}
                  >
                    <div className="mx-auto max-w-3xl space-y-2" dir="rtl">
                      {selected.snapshot.messages.map((message) => {
                        const inbound = message.direction === 'inbound';
                        const context = message.scope === 'context';
                        return (
                          <div
                            key={message.id}
                            className={`flex ${inbound ? 'justify-start' : 'justify-end'} ${context ? 'opacity-60' : ''}`}
                          >
                            <div className={`max-w-[86%] md:max-w-[74%] ${inbound ? 'items-start' : 'items-end'} flex flex-col`}>
                              <div
                                className={`relative rounded-2xl px-3.5 py-2.5 shadow-sm ${
                                  inbound ? 'bg-[#202c33] text-slate-100 rounded-tl-sm' : 'bg-[#005c4b] text-white rounded-tr-sm'
                                } ${message.evidence ? 'ring-2 ring-cyan-400/80 ring-offset-2 ring-offset-[#0b141a]' : ''}`}
                              >
                                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold opacity-80">
                                  <span>{inbound ? 'العميل' : selected.staffName}</span>
                                  {message.evidence ? <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-cyan-100">دليل</span> : null}
                                  {context ? <span className="rounded bg-white/10 px-1.5 py-0.5">سياق فقط</span> : null}
                                </div>
                                {messageBody(message.kind, message.text)}
                                <div className="mt-1 text-left text-[10px] opacity-60">
                                  {new Date(message.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                              {context ? <div className="mt-1 text-[10px] text-slate-500">لا تدخل هذه الرسالة في التقييم</div> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="max-h-[58vh] space-y-2 overflow-y-auto bg-slate-950/20 p-4">
                    {selected.snapshot.messages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-xl border p-3 ${message.evidence ? 'border-cyan-500/60 bg-cyan-950/20' : message.scope === 'context' ? 'border-dashed border-slate-700 bg-slate-950/20 opacity-70' : 'border-slate-800 bg-slate-950/35'}`}
                      >
                        <div className="mb-1 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
                          <span>{message.direction === 'inbound' ? 'العميل' : selected.staffName}{message.scope === 'context' ? ' • سياق فقط' : ''}{message.evidence ? ' • دليل' : ''}</span>
                          <span>{new Date(message.timestamp).toLocaleString('ar-EG')}</span>
                        </div>
                        <div className="text-slate-200">{messageBody(message.kind, message.text)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                <button type="button" onClick={() => openOfficialReview(selected)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">
                  <FileText size={16} /> إنشاء Draft تقييم رسمي
                </button>
                {selected.actions.followup ? (
                  <button type="button" onClick={() => openFollowup(selected)} className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 px-4 py-2.5 text-sm font-black text-emerald-100">
                    فتح متابعة للعميل
                  </button>
                ) : null}
                {selected.actions.customerRequest ? (
                  <button type="button" onClick={() => openCustomerRequest(selected)} className="rounded-xl border border-amber-700/60 bg-amber-950/30 px-4 py-2.5 text-sm font-black text-amber-100">
                    تأكيد وتسجيل طلب العميل
                  </button>
                ) : null}
                <div className="w-full text-xs leading-6 text-slate-500">
                  لا يتم اعتماد درجة أو تسجيل متابعة/طلب تلقائيًا. كل زر يفتح المسار الرسمي للمراجعة والتأكيد.
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
