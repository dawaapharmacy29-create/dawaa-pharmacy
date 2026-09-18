import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
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
} from '@/lib/localWhatsAppInbox';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewResult } from '@/lib/whatsappSmartReviewResult';
import { runSmartReviewPipeline } from '@/lib/whatsappSmartReviewPipeline';
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

export default function WhatsAppSmartFolderWatcher() {
  const navigate = useNavigate();
  const handleRef = useRef<any>(null);
  const scanningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [selected, setSelected] = useState<StaffRun | null>(null);

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
            <button type="button" disabled={scanning} onClick={() => void scanOnce()} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
              <span className="inline-flex items-center gap-2">{scanning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} فحص الآن</span>
            </button>
          )}
        </div>
        {connected ? <div className="mt-3 text-xs font-bold text-emerald-300">الفولدر متصل — فحص تلقائي كل دقيقة أثناء فتح التطبيق.</div> : null}
      </section>

      <section className="space-y-3">
        {!runs.length ? <div className="dawaa-card p-8 text-center text-slate-400">لسه مفيش ملفات جديدة تم تحليلها في هذه الجلسة.</div> : null}
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

              <section className="rounded-2xl border border-slate-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-white">المحادثة والأدلة</div>
                  <div className="text-xs text-slate-500">{selected.snapshot.messages.length} رسالة داخل النطاق والسياق</div>
                </div>
                <div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto pl-1">
                  {selected.snapshot.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`rounded-xl border p-3 ${message.evidence ? 'border-cyan-500/60 bg-cyan-950/20' : message.scope === 'context' ? 'border-dashed border-slate-700 bg-slate-950/20 opacity-70' : 'border-slate-800 bg-slate-950/35'}`}
                    >
                      <div className="mb-1 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
                        <span>{message.direction === 'inbound' ? 'العميل' : selected.staffName}{message.scope === 'context' ? ' • سياق فقط' : ''}{message.evidence ? ' • دليل' : ''}</span>
                        <span>{new Date(message.timestamp).toLocaleString('ar-EG')}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-200">{message.text || `[${message.kind}]`}</div>
                    </div>
                  ))}
                </div>
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
