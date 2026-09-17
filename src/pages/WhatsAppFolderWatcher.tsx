import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FolderOpen, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import {
  supportsLocalWhatsAppInbox,
  connectLocalWhatsAppFolder,
  restoreLocalWhatsAppFolder,
  queryLocalWhatsAppFolderPermission,
  getUnprocessedWhatsAppExports,
  markLocalWhatsAppFileProcessed,
  markLocalWhatsAppFileFailed,
  type LocalInboxCandidate,
} from '@/lib/localWhatsAppInbox';
import { ingestWhatsAppExportFile, type IngestOneFileResult } from '@/lib/whatsappAutoIngestPipeline';

const SCAN_INTERVAL_MS = 60_000;

export default function WhatsAppFolderWatcher() {
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState<(IngestOneFileResult & { at: string })[]>([]);
  const handleRef = useRef<any>(null);

  const scanOnce = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle || scanning) return;
    setScanning(true);
    try {
      const candidates: LocalInboxCandidate[] = await getUnprocessedWhatsAppExports(handle, 10);
      for (const candidate of candidates) {
        try {
          const result = await ingestWhatsAppExportFile(candidate.file);
          markLocalWhatsAppFileProcessed(candidate.key);
          setLog((prev) => [{ ...result, at: new Date().toLocaleTimeString('ar-EG') }, ...prev].slice(0, 50));
          if (result.errors.length) toast.warning(`${candidate.name}: ${result.errors[0]}`);
          else toast.success(`تم تحليل ${candidate.name} — ${result.sessionsSaved} محادثة جديدة، ${result.followupsCreated} طلب متابعة`);
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'خطأ غير معروف';
          markLocalWhatsAppFileFailed(candidate.key, reason);
          toast.error(`فشل تحليل ${candidate.name}: ${reason}`);
        }
      }
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  useEffect(() => {
    (async () => {
      const handle = await restoreLocalWhatsAppFolder();
      if (handle && (await queryLocalWhatsAppFolderPermission(handle, false)) === 'granted') {
        handleRef.current = handle;
        setConnected(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => { if (!document.hidden) void scanOnce(); }, SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [connected, scanOnce]);

  async function connect() {
    try {
      const handle = await connectLocalWhatsAppFolder();
      handleRef.current = handle;
      setConnected(true);
      toast.success('تم ربط الفولدر — النظام هيراقبه تلقائيًا كل دقيقة');
      void scanOnce();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر ربط الفولدر');
    }
  }

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">المراقبة التلقائية لمحادثات الواتساب</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">
          اربط فولدر تصدير محادثات الواتساب على كمبيوتر الصيدلية مرة واحدة — أي ملف جديد هيتحلل تلقائيًا (تقييم كامل + اكتشاف فرص متابعة) من غير ما تعمل حاجة تانية.
        </p>

        {!supportsLocalWhatsAppInbox() ? (
          <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
            المتصفح الحالي مش بيدعم الربط المباشر بفولدر — لازم تستخدم Chrome أو Edge على نفس كمبيوتر الصيدلية.
          </div>
        ) : !connected ? (
          <button onClick={() => void connect()} className="btn-primary mt-3 flex items-center gap-2"><FolderOpen size={16} /> اختيار فولدر تصدير الواتساب</button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-3 py-1.5 text-xs font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={14} /> الفولدر متصل — بيتراقب كل دقيقة</span>
            <button disabled={scanning} onClick={() => void scanOnce()} className="btn-secondary flex items-center gap-1.5 text-xs">{scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} فحص الآن</button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="mb-2 font-black text-[var(--dawaa-theme-heading)]">سجل آخر عمليات التحليل</h3>
        {!log.length ? <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لسه مفيش ملفات اتحللت في هذه الجلسة.</p> : (
          <div className="space-y-2">
            {log.map((item, i) => (
              <div key={i} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-[var(--dawaa-theme-heading)]">{item.fileName}</span>
                  <span className="font-bold text-[var(--dawaa-theme-muted)]">{item.at}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 font-bold text-[var(--dawaa-theme-muted)]">
                  <span>محادثات: {item.sessionsFound}</span>
                  <span className="text-emerald-400">جديدة: {item.sessionsSaved}</span>
                  <span>مكررة: {item.sessionsDuplicate}</span>
                  <span className="text-sky-400">طلبات متابعة: {item.followupsCreated}</span>
                </div>
                {item.errors.map((err, j) => <div key={j} className="mt-1 flex items-center gap-1 text-[var(--dawaa-status-danger-text)]"><XCircle size={12} /> {err}</div>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
