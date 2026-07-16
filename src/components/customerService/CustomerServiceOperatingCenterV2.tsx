import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  calculateFollowupStats,
  fetchCustomerServiceFollowups,
  fetchCustomerServiceInsightPools,
  fetchFollowupPerformanceSummary,
  generateTodayFollowupsSmartReport,
  recommendedAction,
  riskLevel,
  type CustomerServiceInsightPools,
  type FollowupPerformanceRow,
  type FollowupRow,
  type FollowupStats,
} from '@/lib/api/customerServiceCommandCenter';
import { normalizeBranchName } from '@/lib/branch';
import { CustomerFlagChips } from '@/lib/customerDisplay';
import { formatCurrency } from '@/lib/utils';
import FollowupResultModal from '@/components/customerService/FollowupResultModal';

const ALL = 'الكل';
const EMPTY_STATS: FollowupStats = {
  totalToday: 0,
  completed: 0,
  noAnswer: 0,
  postponed: 0,
  overdue: 0,
  needsManager: 0,
  purchaseAfterCount: 0,
  purchaseAfterAmount: 0,
};
const EMPTY_POOLS: CustomerServiceInsightPools = {
  important: [],
  reduced: [],
  stopped60: [],
  strong: [],
  source: '',
  warnings: [],
};

type WorkRow = FollowupRow;
type ViewMode = 'queue' | 'important' | 'reduced' | 'stopped60';

function text(value: unknown, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function phoneOf(row?: WorkRow | null) {
  if (!row) return '';
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}

function statusOf(row: WorkRow) {
  return text(row.followup_status || row.status || row.contact_status, 'معلق');
}

function totalSpent(row: WorkRow) {
  return Number(row.customer_metrics?.total_spent || row.total_spent || 0) || 0;
}

function avgMonthly(row: WorkRow) {
  return Number(row.customer_metrics?.avg_monthly || 0) || 0;
}

function invoicesCount(row: WorkRow) {
  return Number(row.customer_metrics?.invoices_count || 0) || 0;
}

function customerStatus(row: WorkRow) {
  return text(row.customer_metrics?.customer_status || row.customer_status, 'غير محدد');
}

function segment(row: WorkRow) {
  return text(row.customer_metrics?.segment || row.segment || row.classification, 'غير مصنف');
}

function dueAt(row: WorkRow) {
  return row.followup_datetime || row.followup_date || row.next_followup_date || row.date || row.created_at || null;
}

function isDone(row: WorkRow) {
  return Boolean(row.completed_at) || /تم|completed|closed|done/i.test(statusOf(row));
}

function isOverdue(row: WorkRow) {
  const due = dueAt(row);
  return Boolean(due && !isDone(row) && new Date(due).getTime() < Date.now());
}

function branchLabel(value?: string | null) {
  return normalizeBranchName(value || '') || text(value, 'غير محدد');
}

function makeWhatsappLink(phone: string) {
  const cleaned = phone.replace(/\D/g, '');
  if (!cleaned) return '';
  const normalized = cleaned.startsWith('20') ? cleaned : cleaned.startsWith('0') ? `2${cleaned}` : cleaned;
  return `https://wa.me/${normalized}`;
}

function priorityClass(priority?: string | null) {
  const raw = text(priority).toLowerCase();
  if (/عاجل|urgent|critical/.test(raw)) return 'border-red-400/40 bg-red-500/10 text-red-100';
  if (/مهم|high/.test(raw)) return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
  return 'border-slate-600 bg-slate-800/50 text-slate-200';
}

function statusClass(row: WorkRow) {
  if (isDone(row)) return 'border-teal-400/40 bg-teal-500/10 text-teal-100';
  if (isOverdue(row)) return 'border-red-400/40 bg-red-500/10 text-red-100';
  if (/لم يرد|no_answer/i.test(statusOf(row))) return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
  return 'border-sky-400/40 bg-sky-500/10 text-sky-100';
}

function summarizePerformance(rows: FollowupPerformanceRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.assigned += row.assigned;
      acc.completed += row.completed;
      acc.overdue += row.overdue;
      acc.recovered += row.recoveredCustomers;
      acc.sales += row.purchaseAfterAmount;
      return acc;
    },
    { assigned: 0, completed: 0, overdue: 0, recovered: 0, sales: 0 }
  );
}

export default function CustomerServiceOperatingCenterV2() {
  const { user } = useAuth();
  const canSeeAll = ['general_manager', 'executive_manager', 'branches_manager', 'customer_service_manager'].includes(
    String(user?.role || '')
  );
  const [branch, setBranch] = useState(canSeeAll ? ALL : branchLabel(user?.branch));
  const [status, setStatus] = useState(ALL);
  const [responsible, setResponsible] = useState(ALL);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('queue');
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [stats, setStats] = useState<FollowupStats>(EMPTY_STATS);
  const [pools, setPools] = useState<CustomerServiceInsightPools>(EMPTY_POOLS);
  const [performance, setPerformance] = useState<FollowupPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WorkRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const branchFilter = branch === ALL ? undefined : branch;
      const [loadedRows, loadedPools, loadedPerformance] = await Promise.all([
        fetchCustomerServiceFollowups({
          branch: branchFilter,
          status,
          responsible,
          search,
          limit: 250,
        }),
        fetchCustomerServiceInsightPools(branchFilter),
        fetchFollowupPerformanceSummary(branchFilter),
      ]);
      setRows(loadedRows);
      setStats(calculateFollowupStats(loadedRows));
      setPools(loadedPools);
      setPerformance((loadedPerformance || []) as FollowupPerformanceRow[]);
    } catch (loadError) {
      console.error('[customer-service-center] load failed', loadError);
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مركز خدمة العملاء.');
      setRows([]);
      setStats(EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }, [branch, responsible, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const responsibleOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => text(row.responsible_name || row.assigned_to || row.assigned_doctor)).filter(Boolean))),
    [rows]
  );

  const visibleRows = useMemo(() => {
    if (viewMode === 'important') return pools.important;
    if (viewMode === 'reduced') return pools.reduced;
    if (viewMode === 'stopped60') return pools.stopped60;
    return rows;
  }, [pools, rows, viewMode]);

  const performanceTotals = useMemo(() => summarizePerformance(performance), [performance]);

  const generate = async () => {
    setGenerating(true);
    try {
      const report = await generateTodayFollowupsSmartReport(
        branch === ALL ? undefined : branch,
        user?.name || null
      );
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: report.created_count ? 'success' : 'info',
            message: report.created_count
              ? `تم إنشاء ${report.created_count} متابعة ذكية جديدة.`
              : 'لم يتم إنشاء متابعات جديدة لأن العملاء لديهم متابعات مفتوحة أو لا توجد بيانات صالحة.',
          },
        })
      );
      await load();
    } catch (generateError) {
      console.error('[customer-service-center] generation failed', generateError);
      window.dispatchEvent(
        new CustomEvent('toast', { detail: { type: 'error', message: 'تعذر إنشاء المتابعات الذكية.' } })
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-l from-teal-500/10 via-slate-950 to-sky-500/10 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-teal-300">
              <Sparkles size={22} />
              <span className="font-black">مركز تشغيل خدمة العملاء</span>
            </div>
            <h1 className="mt-2 text-3xl font-black text-white">قائمة المتابعات ونتائج التواصل</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
              قائمة موحدة للمتابعات اليومية والسريعة والمجدولة، مع بيانات العميل والنتيجة وفرص الاسترجاع.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void generate()} disabled={generating} className="btn-primary disabled:opacity-50">
              <Sparkles className={`ml-1 inline h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
              إنشاء القائمة الذكية
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary disabled:opacity-50">
              <RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat icon={UserRound} label="إجمالي المتابعات" value={stats.totalToday} />
        <Stat icon={CheckCircle2} label="تم التواصل" value={stats.completed} />
        <Stat icon={Phone} label="لم يرد" value={stats.noAnswer} />
        <Stat icon={Clock3} label="متأخرة" value={stats.overdue} />
        <Stat icon={AlertTriangle} label="تحتاج مدير" value={stats.needsManager} />
        <Stat icon={BarChart3} label="مبيعات بعد المتابعة" value={formatCurrency(stats.purchaseAfterAmount)} />
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {canSeeAll ? (
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option value={ALL}>كل الفروع</option>
              <option value="فرع الشامي">فرع الشامي</option>
              <option value="فرع شكري">فرع شكري</option>
            </select>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 font-bold text-slate-200">
              {branch}
            </div>
          )}
          <select className="input-dark" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value={ALL}>كل الحالات</option>
            <option value="معلق">معلقة</option>
            <option value="تم">تم التواصل</option>
            <option value="لم يرد">لم يرد</option>
            <option value="مؤجل">مؤجلة</option>
            <option value="متأخرة">متأخرة</option>
            <option value="يحتاج مدير">تحتاج مدير</option>
          </select>
          <select className="input-dark" value={responsible} onChange={(event) => setResponsible(event.target.value)}>
            <option value={ALL}>كل المسؤولين</option>
            {responsibleOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <label className="relative xl:col-span-2">
            <Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-500" />
            <input
              className="input-dark pr-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="اسم العميل أو الكود أو الهاتف"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ModeButton active={viewMode === 'queue'} onClick={() => setViewMode('queue')} title="قائمة المتابعات" count={rows.length} />
        <ModeButton active={viewMode === 'important'} onClick={() => setViewMode('important')} title="العملاء المهمون" count={pools.important.length} />
        <ModeButton active={viewMode === 'reduced'} onClick={() => setViewMode('reduced')} title="قللوا التعامل" count={pools.reduced.length} />
        <ModeButton active={viewMode === 'stopped60'} onClick={() => setViewMode('stopped60')} title="متوقفون أكثر من شهرين" count={pools.stopped60.length} />
      </section>

      {error ? <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-red-100">{error}</div> : null}
      {pools.warnings.length ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          {pools.warnings.join(' · ')}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-black text-white">{viewMode === 'queue' ? 'المتابعات الحالية' : 'فرص المتابعة الذكية'}</h2>
            <p className="mt-1 text-sm text-slate-400">اضغط على أي عميل لتسجيل النتيجة أو استكمال التفاصيل.</p>
          </div>
          <div className="text-sm font-black text-teal-200">{visibleRows.length} عميل</div>
        </div>

        {loading ? <div className="mt-6 text-slate-300">جارٍ تحميل المتابعات…</div> : null}
        {!loading && !visibleRows.length ? (
          <div className="mt-6 rounded-2xl border border-slate-700 p-8 text-center text-slate-400">لا توجد متابعات مطابقة.</div>
        ) : null}
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {visibleRows.map((row) => {
            const phone = phoneOf(row);
            const whatsappLink = makeWhatsappLink(phone);
            return (
              <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-white">{row.customer_name || row.name || 'عميل غير محدد'}</h3>
                      <span className={`rounded-full border px-2 py-1 text-xs font-black ${priorityClass(row.priority)}`}>{row.priority || 'عادي'}</span>
                      <span className={`rounded-full border px-2 py-1 text-xs font-black ${statusClass(row)}`}>{statusOf(row)}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      الكود: {row.customer_code || 'غير مسجل'} · الفرع: {branchLabel(row.branch)}
                    </div>
                    <div className="mt-1 text-sm text-slate-300">الهاتف: {phone || 'غير مسجل'}</div>
                    <CustomerFlagChips row={row} className="mt-2" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-slate-400">
                      <span>التصنيف: {segment(row)}</span>
                      <span>الحالة الشرائية: {customerStatus(row)}</span>
                      <span>إجمالي المشتريات: {formatCurrency(totalSpent(row))}</span>
                      <span>متوسط شهري: {formatCurrency(avgMonthly(row))}</span>
                      <span>عدد الفواتير: {invoicesCount(row)}</span>
                      <span>موعد المتابعة: {formatDate(dueAt(row))}</span>
                    </div>
                    <div className="mt-3 rounded-xl bg-slate-900 p-3 text-sm leading-6 text-slate-200">
                      <b className="text-white">سبب المتابعة:</b> {row.followup_reason || row.request_details || recommendedAction(row)}
                    </div>
                    {row.followup_result || row.contact_result ? (
                      <div className="mt-2 rounded-xl bg-sky-500/10 p-3 text-sm text-sky-100">
                        <b>آخر نتيجة:</b> {row.followup_result || row.contact_result}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                    {whatsappLink ? (
                      <a href={whatsappLink} target="_blank" rel="noreferrer" className="btn-secondary">
                        <MessageCircle className="ml-1 inline h-4 w-4" /> واتساب
                      </a>
                    ) : null}
                    {phone ? (
                      <a href={`tel:${phone}`} className="btn-secondary"><Phone className="ml-1 inline h-4 w-4" /> اتصال</a>
                    ) : null}
                    <button type="button" onClick={() => setSelected(row)} className="btn-primary">تسجيل النتيجة</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <h2 className="text-2xl font-black text-white">ملخص أداء خدمة العملاء</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat icon={UserRound} label="تم إسنادها" value={performanceTotals.assigned} />
          <Stat icon={CheckCircle2} label="تم إنجازها" value={performanceTotals.completed} />
          <Stat icon={Clock3} label="متأخرة" value={performanceTotals.overdue} />
          <Stat icon={Sparkles} label="عملاء مسترجعون" value={performanceTotals.recovered} />
          <Stat icon={BarChart3} label="مبيعات مسترجعة" value={formatCurrency(performanceTotals.sales)} />
        </div>
      </section>

      <FollowupResultModal
        open={Boolean(selected)}
        followup={selected}
        onClose={() => setSelected(null)}
        onSaved={() => {
          setSelected(null);
          void load();
        }}
      />
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4">
      <Icon className="text-teal-300" size={19} />
      <div className="mt-2 text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function ModeButton({ active, onClick, title, count }: { active: boolean; onClick: () => void; title: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-right transition ${active ? 'border-teal-400 bg-teal-500/15 text-teal-100' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-teal-400/40'}`}
    >
      <div className="font-black">{title}</div>
      <div className="mt-1 text-2xl font-black">{count}</div>
    </button>
  );
}
