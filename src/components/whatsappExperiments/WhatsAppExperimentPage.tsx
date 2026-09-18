import { useCallback, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  FolderOpen,
  PlayCircle,
  Trash2,
  Loader2,
  XCircle,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import {
  supportsLocalWhatsAppInbox,
  restoreLocalWhatsAppFolder,
  queryLocalWhatsAppFolderPermission,
  getUnprocessedWhatsAppExports,
  type LocalInboxCandidate,
} from '@/lib/localWhatsAppInbox';
import type {
  ExperimentApproach,
  ExperimentFileLogEntry,
  ExperimentRunMode,
} from '@/lib/whatsappExperiments/types';

export interface ExperimentInfoBox {
  name: string;
  whatItDoes: string;
  whatItSaves: string;
  createsOfficialReview: boolean;
  addsPoints: boolean;
  needsHumanReview: boolean;
}

const APPROACH_STYLES: Record<ExperimentApproach, { badge: string; ring: string; label: string }> = {
  A: { badge: 'bg-violet-500/15 text-violet-200 border-violet-400/30', ring: 'border-violet-400/30', label: 'Approach A' },
  B: { badge: 'bg-teal-500/15 text-teal-200 border-teal-400/30', ring: 'border-teal-400/30', label: 'Approach B' },
  hybrid: { badge: 'bg-amber-500/15 text-amber-200 border-amber-400/30', ring: 'border-amber-400/30', label: 'Hybrid A+B' },
};

function YesNo({ value, yesLabel, noLabel }: { value: boolean; yesLabel: string; noLabel: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${value ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>
      {value ? yesLabel : noLabel}
    </span>
  );
}

function InfoBoxCard({ info }: { info: ExperimentInfoBox }) {
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <h2 className="font-black text-[var(--dawaa-theme-heading)]">{info.name}</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--dawaa-theme-muted)]">{info.whatItDoes}</p>
      <p className="mt-2 text-xs leading-6 text-[var(--dawaa-theme-muted)]">
        <span className="font-black text-[var(--dawaa-theme-heading)]">بيحفظ في القاعدة: </span>
        {info.whatItSaves}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="text-[var(--dawaa-theme-muted)]">تقييم رسمي؟</span>
        <YesNo value={info.createsOfficialReview} yesLabel="نعم" noLabel="لا" />
        <span className="mr-3 text-[var(--dawaa-theme-muted)]">نقاط؟</span>
        <YesNo value={info.addsPoints} yesLabel="نعم (pending)" noLabel="لا" />
        <span className="mr-3 text-[var(--dawaa-theme-muted)]">محتاج مراجعة بشرية؟</span>
        <YesNo value={info.needsHumanReview} yesLabel="نعم" noLabel="لا" />
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-black/10 p-2.5 text-center">
      <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className={`mt-0.5 text-lg font-black ${tone}`}>{value}</div>
    </div>
  );
}

export interface WhatsAppExperimentPageProps {
  approach: ExperimentApproach;
  pageTitle: string;
  description: string;
  info: ExperimentInfoBox;
  onRunFile: (file: File, mode: ExperimentRunMode) => Promise<ExperimentFileLogEntry>;
  renderDetails: (entry: ExperimentFileLogEntry) => ReactNode;
  warningNote?: string;
}

export default function WhatsAppExperimentPage({
  approach,
  pageTitle,
  description,
  info,
  onRunFile,
  renderDetails,
  warningNote,
}: WhatsAppExperimentPageProps) {
  const styles = APPROACH_STYLES[approach];
  const [running, setRunning] = useState(false);
  const [liveRunEnabled, setLiveRunEnabled] = useState(false);
  const [log, setLog] = useState<ExperimentFileLogEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runMode: ExperimentRunMode = liveRunEnabled ? 'live' : 'dry-run';

  const runFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || running) return;
      setRunning(true);
      try {
        for (const file of files) {
          try {
            const entry = await onRunFile(file, runMode);
            setLog((prev) => [entry, ...prev].slice(0, 50));
            if (entry.errors.length) toast.warning(`${file.name}: ${entry.errors[0]}`);
            else if (entry.runMode === 'dry-run') toast.success(`تمت المعاينة الآمنة لـ ${styles.label} على ${file.name}`);
            else toast.success(`تم تشغيل Live لـ ${styles.label} على ${file.name}`);
          } catch (e) {
            toast.error(e instanceof Error ? `${file.name}: ${e.message}` : `فشل تشغيل ${file.name}`);
          }
        }
      } finally {
        setRunning(false);
      }
    },
    [onRunFile, runMode, running, styles.label]
  );

  async function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await runFiles(files);
  }

  async function pickFromConnectedFolder() {
    if (!supportsLocalWhatsAppInbox()) {
      toast.error('المتصفح الحالي لا يدعم الربط بفولدر محلي.');
      return;
    }
    const handle = await restoreLocalWhatsAppFolder();
    if (!handle) {
      toast.error('مفيش فولدر متصل — اربطه الأول من صفحة "المراقبة التلقائية للفولدر".');
      return;
    }
    const permission = await queryLocalWhatsAppFolderPermission(handle, true);
    if (permission !== 'granted') {
      toast.error('تعذر الوصول للفولدر المتصل.');
      return;
    }
    const candidates: LocalInboxCandidate[] = await getUnprocessedWhatsAppExports(handle, 25);
    if (!candidates.length) {
      toast.info('مفيش ملفات جديدة في الفولدر المتصل.');
      return;
    }
    await runFiles(candidates.map((c) => c.file));
  }

  const totals = log.reduce(
    (acc, entry) => ({
      files: acc.files + 1,
      previewed: acc.previewed + entry.counts.previewed,
      created: acc.created + entry.counts.created,
      skipped: acc.skipped + entry.counts.skipped,
      duplicates: acc.duplicates + entry.counts.duplicates,
      failed: acc.failed + entry.counts.failed,
      pointsFailed: acc.pointsFailed + entry.counts.pointsFailed,
      durationMs: acc.durationMs + entry.durationMs,
    }),
    { files: 0, previewed: 0, created: 0, skipped: 0, duplicates: 0, failed: 0, pointsFailed: 0, durationMs: 0 }
  );

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className={`rounded-2xl border-2 ${styles.ring} dawaa-surface p-4 shadow-sm`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-black ${styles.badge}`}>{styles.label}</span>
          <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">{pageTitle}</h1>
        </div>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">{description}</p>

        <div className={`mt-3 rounded-xl border p-3 text-xs font-black ${
          liveRunEnabled
            ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
            : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
        }`}>
          <div className="flex items-center gap-2">
            {liveRunEnabled ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
            <span>
              {liveRunEnabled
                ? 'LIVE RUN — التشغيل القادم قد يكتب بيانات حقيقية في قاعدة الإنتاج'
                : 'وضع المعاينة الآمن — لا يتم حفظ أي بيانات أو نقاط أو إشعارات'}
            </span>
          </div>
        </div>

        {warningNote ? (
          <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
            {warningNote}
          </div>
        ) : null}
      </div>

      <InfoBoxCard info={info} />

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-black text-[var(--dawaa-theme-heading)]">وضع التشغيل</h3>
            <p className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
              Dry Run هو الافتراضي. تفعيل Live لا يشغّل أي شيء وحده؛ التنفيذ يحصل فقط من زر التشغيل.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2">
            <input
              type="checkbox"
              checked={liveRunEnabled}
              disabled={running}
              onChange={(e) => setLiveRunEnabled(e.target.checked)}
            />
            <span className={`text-xs font-black ${liveRunEnabled ? 'text-rose-300' : 'text-emerald-300'}`}>
              السماح بالاختبار الفعلي
            </span>
          </label>
        </div>
        {liveRunEnabled ? (
          <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">
            تحذير: التشغيل الفعلي قد ينشئ صفوفًا حقيقية، تقييمات رسمية، points pending أو side effects حسب الطريقة المختارة.
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="mb-3 font-black text-[var(--dawaa-theme-heading)]">منطقة الاختبار</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain"
            multiple
            className="hidden"
            onChange={(e) => void handleFileInput(e)}
          />
          <button
            disabled={running}
            onClick={() => fileInputRef.current?.click()}
            className={`${liveRunEnabled ? 'btn-danger' : 'btn-primary'} flex items-center gap-2 text-sm disabled:opacity-50`}
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            {liveRunEnabled ? 'رفع وتشغيل Live' : 'رفع TXT / Markdown ومعاينة آمنة'}
          </button>
          {supportsLocalWhatsAppInbox() ? (
            <button
              disabled={running}
              onClick={() => void pickFromConnectedFolder()}
              className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-50"
            >
              <FolderOpen size={14} /> اختيار من الفولدر المتصل
            </button>
          ) : null}
          <button
            disabled={running || !log.length}
            onClick={() => setLog([])}
            className="flex items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2 text-xs font-black text-[var(--dawaa-theme-muted)] hover:text-[var(--dawaa-theme-heading)] disabled:opacity-40"
          >
            <Trash2 size={14} /> مسح نتائج التجربة الحالية
          </button>
        </div>
        <p className="mt-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
          زر "مسح النتائج" يمسح سجل العرض المحلي فقط. في Dry Run لا توجد أي كتابة دائمة أصلًا.
        </p>

        {log.length ? (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <SummaryTile label="ملفات" value={totals.files} />
            <SummaryTile label="Previewed" value={totals.previewed} tone="text-sky-300" />
            <SummaryTile label="Created" value={totals.created} tone="text-emerald-400" />
            <SummaryTile label="Skipped" value={totals.skipped} />
            <SummaryTile label="Duplicates" value={totals.duplicates} tone="text-violet-300" />
            <SummaryTile label="Failed" value={totals.failed} tone="text-rose-400" />
            <SummaryTile label="Points Failed" value={totals.pointsFailed} tone="text-amber-400" />
            <SummaryTile label="زمن التنفيذ" value={`${Math.round(totals.durationMs)}ms`} />
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="mb-2 font-black text-[var(--dawaa-theme-heading)]">سجل التشغيل</h3>
        {!log.length ? (
          <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لسه مفيش تجارب اتشغلت في هذه الجلسة.</p>
        ) : (
          <div className="space-y-3">
            {log.map((entry, i) => (
              <div key={i} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-[var(--dawaa-theme-heading)]">{entry.fileName}</span>
                  <span className="font-bold text-[var(--dawaa-theme-muted)]">
                    {entry.runMode === 'dry-run' ? 'DRY RUN' : 'LIVE'} · {entry.at} · {Math.round(entry.durationMs)}ms · {entry.counts.sessionsFound} جلسة
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 font-bold text-[var(--dawaa-theme-muted)]">
                  {entry.counts.previewed > 0 ? <span className="text-sky-300">Previewed: {entry.counts.previewed}</span> : null}
                  <span className="text-emerald-400">Created: {entry.counts.created}</span>
                  <span>Skipped: {entry.counts.skipped}</span>
                  <span className="text-violet-300">Duplicates: {entry.counts.duplicates}</span>
                  <span className="text-rose-400">Failed: {entry.counts.failed}</span>
                  {entry.counts.pointsFailed > 0 ? <span className="text-amber-400">Points Failed: {entry.counts.pointsFailed}</span> : null}
                </div>
                {renderDetails(entry)}
                {entry.errors.map((err, j) => (
                  <div key={j} className="mt-1 flex items-center gap-1 text-[var(--dawaa-status-danger-text)]">
                    <XCircle size={12} /> {err}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
