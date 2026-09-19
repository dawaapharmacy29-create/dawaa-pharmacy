import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { aggregateBestMessages } from '@/lib/whatsappExperiments/smartConversationIntelligence';
import { buildUnifiedExperimentAnalytics } from '@/lib/whatsappExperiments/unifiedAnalytics';
import type {
  ExperimentApproach,
  ExperimentFileLogEntry,
  ExperimentRunMode,
  SmartConversationIntelligenceResult,
} from '@/lib/whatsappExperiments/types';


const SALE_STATE_TONE: Record<string, string> = {
  invoice_verified_sale: 'text-emerald-300',
  probable_sale: 'text-amber-300',
  chat_sale_signal: 'text-sky-300',
  no_verified_invoice: 'text-slate-400',
};

function SmartIntelligencePanel({ results }: { results: SmartConversationIntelligenceResult[] }) {
  if (!results.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-[11px] font-black text-sky-300">التحليل الذكي الموحّد — قراءة فقط ولا يغيّر نتيجة A/B</div>
      {results.map((r, i) => (
        <div key={i} className="rounded-lg border border-sky-400/20 bg-sky-500/5 p-3 text-[11px] text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-black text-sky-200">{r.journey.journeyLabel}</span>
            <span className={`rounded-full bg-black/20 px-2 py-0.5 font-black ${SALE_STATE_TONE[r.journey.saleState] || 'text-slate-400'}`}>
              {r.journey.saleStateLabel}
            </span>
          </div>
          <div className="mt-1 text-slate-500">
            intent: {r.primaryIntent} · initiator: {r.initiator} · outcome: {r.operationalOutcome}
          </div>
          <div className="mt-1 text-slate-400">
            العميل: {r.customer.customer ? `${r.customer.customer.name} (${r.customer.customer.code || 'بدون كود'})` : 'غير معروف'} ·
            {' '}الفرع: {r.customer.customer?.branch || r.branchHint || '-'} · ثقة التعرّف: {Math.round(r.customer.confidence * 100)}%
          </div>
          {r.customer.strategy === 'ambiguous' ? (
            <div className="mt-1 text-amber-300">⚠ تطابق عميل غير محسوم — يحتاج مراجعة بشرية.</div>
          ) : null}
          {r.purchaseHistory ? (
            <div className="mt-1 text-slate-400">
              {r.purchaseHistory.fetchError
                ? `تعذرت قراءة تاريخ المشتريات: ${r.purchaseHistory.fetchError}`
                : `المشتريات: ${r.purchaseHistory.totalPurchases ?? '-'} · إجمالي الإنفاق: ${r.purchaseHistory.totalSpent ?? '-'} · متوسط شهري: ${r.purchaseHistory.avgMonthly ?? '-'} · آخر شراء: ${r.purchaseHistory.lastPurchaseAt || '-'}`}
            </div>
          ) : null}
          <div className="mt-1 text-slate-400">
            مطابقة الفاتورة: {r.invoiceVerification.status}
            {r.invoiceVerification.revenue ? ` · القيمة: ${r.invoiceVerification.revenue}` : ''}
          </div>
          {r.staffEffort.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[11px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-right font-bold">الموظف</th>
                    <th className="text-right font-bold">رسائل</th>
                    <th className="text-right font-bold">Bursts</th>
                    <th className="text-right font-bold">تم الرد</th>
                    <th className="text-right font-bold">Burst Reply Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {r.staffEffort.map((s, j) => (
                    <tr key={j} className="border-t border-[var(--dawaa-theme-border)]">
                      <td className="py-1">{s.staffName}</td>
                      <td>{s.outboundMessages}</td>
                      <td>{s.burstCount}</td>
                      <td>{s.repliedBursts}</td>
                      <td className="font-black text-emerald-300">{s.burstReplyRatePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BestMessagesPanel({ log }: { log: ExperimentFileLogEntry[] }) {
  const best = useMemo(
    () => aggregateBestMessages(log.flatMap((entry) => entry.smartIntelligence?.flatMap((s) => s.messageEffectiveness) || [])),
    [log]
  );
  if (!best.length) return null;
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <h3 className="mb-1 font-black text-[var(--dawaa-theme-heading)]">أفضل الرسائل — مؤشر استكشافي</h3>
      <p className="mb-3 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
        القياس على مستوى نمط الرسالة والـburst، والنتائج قليلة العينة تظل أولية وليست حكم أداء.
      </p>
      <div className="space-y-2">
        {best.map((m, i) => (
          <div key={i} className="rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-black text-emerald-300">{m.replyRate}% رد</span>
              <span className="text-slate-400">أُرسلت {m.sentCount} مرة · اترد عليها {m.repliedCount}</span>
              {m.sampleSizeLabel === 'preliminary' ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-black text-amber-300">بيانات أولية</span>
              ) : null}
            </div>
            <div className="mt-1 text-slate-300">{m.displayText}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


function UnifiedAnalyticsPanel({ log }: { log: ExperimentFileLogEntry[] }) {
  const results = useMemo(() => log.flatMap((entry) => entry.smartIntelligence || []), [log]);
  const analytics = useMemo(() => buildUnifiedExperimentAnalytics(results), [results]);
  if (!results.length) return null;

  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-black text-[var(--dawaa-theme-heading)]">التحليل التشغيلي الموحّد</h3>
          <p className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
            البيع المؤكد لا يُحسب إلا من Invoice Verification، والمحادثات غير التجارية لا تدخل مقام التحويل.
          </p>
        </div>
        <div className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300">
          Verified conversion: {analytics.verifiedConversionRate ?? '-'}%
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryTile label="المحادثات" value={analytics.totalConversations} />
        <SummaryTile label="فرص تجارية" value={analytics.commercialChats} tone="text-sky-300" />
        <SummaryTile label="بيع مؤكد" value={analytics.verifiedSales} tone="text-emerald-300" />
        <SummaryTile label="بيع مرجح" value={analytics.probableSales} tone="text-amber-300" />
        <SummaryTile label="إشارة بيع فقط" value={analytics.chatSaleSignals} tone="text-violet-300" />
        <SummaryTile label="بدون فاتورة مؤكدة" value={analytics.noVerifiedInvoice} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
          <div className="font-black text-[var(--dawaa-theme-heading)]">مقارنة الدورة</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-black/10 p-2">
              <div className="text-[10px] text-slate-500">الحالية</div>
              <div className="font-black">{analytics.currentCycle.label}</div>
              <div className="mt-1 text-slate-400">
                {analytics.currentCycle.verifiedSales}/{analytics.currentCycle.commercialChats} بيع مؤكد · {analytics.currentCycle.verifiedConversionRate ?? '-'}%
              </div>
            </div>
            <div className="rounded-lg bg-black/10 p-2">
              <div className="text-[10px] text-slate-500">السابقة</div>
              <div className="font-black">{analytics.previousCycle.label}</div>
              <div className="mt-1 text-slate-400">
                {analytics.previousCycle.verifiedSales}/{analytics.previousCycle.commercialChats} بيع مؤكد · {analytics.previousCycle.verifiedConversionRate ?? '-'}%
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            التغير: {analytics.verifiedConversionChangePp == null ? '-' : String(analytics.verifiedConversionChangePp) + ' نقطة مئوية'}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
          <div className="font-black text-[var(--dawaa-theme-heading)]">الفروع — بيانات التجربة الحالية</div>
          <div className="mt-2 space-y-1">
            {analytics.byBranch.slice(0, 6).map((row) => (
              <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/10 p-2">
                <span className="font-black">{row.label}</span>
                <span className="text-slate-400">
                  {row.conversations} محادثة · {row.verifiedSales}/{row.commercialChats} بيع مؤكد · {row.verifiedConversionRate ?? '-'}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {analytics.byStaff.length ? (
        <div className="mt-3 overflow-x-auto">
          <div className="mb-1 text-xs font-black text-[var(--dawaa-theme-heading)]">مشاركة الموظفين</div>
          <table className="w-full min-w-[620px] text-[11px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-right">الموظف</th>
                <th className="text-right">محادثات شارك فيها</th>
                <th className="text-right">فرص تجارية</th>
                <th className="text-right">بيع مؤكد داخل المحادثات</th>
                <th className="text-right">Burst Reply Rate</th>
              </tr>
            </thead>
            <tbody>
              {analytics.byStaff.slice(0, 10).map((row) => (
                <tr key={row.key} className="border-t border-[var(--dawaa-theme-border)]">
                  <td className="py-1 font-bold">{row.label}</td>
                  <td>{row.conversations}</td>
                  <td>{row.commercialChats}</td>
                  <td>{row.verifiedSales}</td>
                  <td>{row.burstReplyRate == null ? '-' : String(row.burstReplyRate) + '%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-slate-500">
            مشاركة الموظف لا تعني Attribution نهائي للبيع لو المحادثة شارك فيها أكثر من شخص.
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
            accept=".zip,.txt,.md,application/zip,application/x-zip-compressed,text/plain,text/markdown"
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
            {liveRunEnabled ? 'رفع ZIP / TXT / Markdown وتشغيل Live' : 'رفع ZIP / TXT / Markdown ومعاينة آمنة'}
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
          يمكن رفع تصدير واتساب ZIP مباشرة؛ النظام يفك الضغط محليًا ويختار chat.txt تلقائيًا (ثم chat.md عند الحاجة). زر "مسح النتائج" يمسح سجل العرض المحلي فقط. في Dry Run لا توجد أي كتابة دائمة أصلًا.
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

      <UnifiedAnalyticsPanel log={log} />

      <BestMessagesPanel log={log} />

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
                <SmartIntelligencePanel results={entry.smartIntelligence || []} />
                {(entry.smartIntelligenceErrors || []).map((err, j) => (
                  <div key={`smart-${j}`} className="mt-1 flex items-center gap-1 text-amber-300">
                    <AlertTriangle size={12} /> Smart Intelligence: {err}
                  </div>
                ))}
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
