import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';
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

type StaffRun = {
  sessionId: string;
  customerName: string | null;
  staffName: string;
  role: string;
  decision: string;
  safe: boolean;
  reasons: string[];
  criteria: string[];
  intelligence: ReturnType<typeof runSmartReviewPipeline>['intelligence'];
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

export default function WhatsAppSmartFolderWatcher() {
  const handleRef = useRef<any>(null);
  const scanningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [runs, setRuns] = useState<FileRun[]>([]);

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

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black text-cyan-300">SMART REVIEW • FOLDER WATCHER</div>
            <h1 className="mt-1 text-2xl font-black text-white">التقاط محادثات واتساب تلقائيًا</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
              اربط فولدر التصدير مرة واحدة. أي ZIP/TXT/MD جديد يتم التقاطه وتحليله بالمحرك الذكي الجديد كل دقيقة.
              هذه الصفحة تحليل تجريبي فقط ولا تسجل نقاط أو خصومات تلقائيًا.
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
                  <div key={`${item.sessionId}-${item.staffName}-${item.role}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-black text-white">{item.staffName}</div>
                        <div className="text-xs text-slate-500">{item.role === 'customer_service' ? 'خدمة العملاء' : 'صيدلي'} • {item.customerName || 'عميل غير محدد'}</div>
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
                    {item.reasons.length ? <div className="mt-3 space-y-1 text-xs text-amber-100">{item.reasons.slice(0, 4).map((reason) => <div key={reason}>• {reason}</div>)}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
