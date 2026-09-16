import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileUp,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import {
  fetchMonthlyCustomerPerformance,
  type CustomerMonthlyRow,
  type MonthlyPerformanceSummary,
} from '@/lib/customerMonthlyPerformanceService';
import { BRANCHES } from '@/lib/constants';
import {
  normalizeWatchlistRows,
  replaceCustomerWatchlist,
} from '@/lib/customerService/customerCohortIntelligenceService';
import CustomerQuickDetailsModal from '@/components/customers/CustomerQuickDetailsModal';
import {
  EmptyState,
  KpiCard,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';

type PeriodMode = 'cycle' | 'calendar';
type CohortKey = 'new' | 'reactivated' | 'lost' | 'strongDecline' | 'decline' | 'risk';

const ALL_BRANCHES_VALUE = 'كل الفروع';
const COHORT_PAGE_SIZE = 50;

function calendarMonthRange(date: Date): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function previousPeriod(mode: PeriodMode, start: string): { start: string; end: string } {
  const d = new Date(start);
  if (mode === 'cycle') {
    d.setDate(d.getDate() - 1);
    return getPharmacyCycleRange(d);
  }
  d.setDate(0);
  return calendarMonthRange(d);
}

function fmtMoney(n: number) {
  return Math.round(Number(n) || 0).toLocaleString('ar-EG') + ' ج.م';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSearch(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

const STATE_TOKEN: Record<string, string> = {
  جديد: 'var(--dawaa-status-success-text)',
  مستعاد: 'var(--dawaa-theme-primary-strong)',
  'نمو قوي': 'var(--dawaa-status-success-text)',
  نمو: 'var(--dawaa-status-success-text)',
  مستقر: 'var(--dawaa-status-info-text)',
  تراجع: 'var(--dawaa-status-warning-text)',
  'تراجع قوي': 'var(--dawaa-status-danger-text)',
  'مختفي هذا الشهر': 'var(--dawaa-status-danger-text)',
};

const COHORT_META: Record<
  CohortKey,
  {
    title: string;
    subtitle: string;
    tone: 'green' | 'cyan' | 'amber' | 'red';
  }
> = {
  new: {
    title: 'العملاء الجدد',
    subtitle: 'أول تعامل لهم كان داخل الفترة المختارة.',
    tone: 'green',
  },
  reactivated: {
    title: 'العملاء المستعادين',
    subtitle: 'عادوا للشراء بعد فترة توقف.',
    tone: 'cyan',
  },
  lost: {
    title: 'العملاء المختفين',
    subtitle: 'كان لهم شراء في الفترة السابقة ولم يظهر شراء في الفترة الحالية.',
    tone: 'red',
  },
  strongDecline: {
    title: 'العملاء المتراجعون بقوة',
    subtitle: 'انخفاض واضح في سرعة أو قيمة مشترياتهم مقارنة بالفترة السابقة.',
    tone: 'amber',
  },
  decline: {
    title: 'العملاء الذين قللوا مشترياتهم',
    subtitle: 'تراجع مبكر يحتاج متابعة قبل أن يتحول إلى تراجع قوي.',
    tone: 'amber',
  },
  risk: {
    title: 'العملاء المهددون',
    subtitle: 'قائمة موحدة للعملاء المختفين والمتراجعين بقوة لبدء الاسترجاع والمتابعة.',
    tone: 'red',
  },
};

function isCohortRow(row: CustomerMonthlyRow, cohort: CohortKey) {
  if (cohort === 'new') return row.customer_state === 'جديد';
  if (cohort === 'reactivated') return row.customer_state === 'مستعاد';
  if (cohort === 'lost') return row.customer_state === 'مختفي هذا الشهر';
  if (cohort === 'strongDecline') return row.customer_state === 'تراجع قوي';
  if (cohort === 'decline') return row.customer_state === 'تراجع';
  return row.customer_state === 'مختفي هذا الشهر' || row.customer_state === 'تراجع قوي';
}

function rowRiskGap(row: CustomerMonthlyRow) {
  const expected = Number(row.expected_to_date_sales ?? row.previous_month_sales) || 0;
  const current = Number(row.sales_amount) || 0;
  return Math.max(0, expected - current);
}

function sortCohortRows(rows: CustomerMonthlyRow[], cohort: CohortKey) {
  return [...rows].sort((a, b) => {
    if (cohort === 'lost' || cohort === 'strongDecline' || cohort === 'decline' || cohort === 'risk') {
      return rowRiskGap(b) - rowRiskGap(a);
    }
    return Number(b.sales_amount || 0) - Number(a.sales_amount || 0);
  });
}

function followupPlan(row: CustomerMonthlyRow) {
  switch (row.customer_state) {
    case 'جديد':
      return {
        priority: 'متوسطة',
        reason: 'عميل جديد',
        action: 'ترحيب + التأكد من رضا العميل عن أول تجربة + تثبيت التعامل',
        channel: 'واتساب / اتصال',
      };
    case 'مستعاد':
      return {
        priority: 'عالية',
        reason: 'عميل عاد بعد توقف',
        action: 'شكر على العودة + معرفة سبب التوقف السابق + الحفاظ على استمرار التعامل',
        channel: 'اتصال / واتساب',
      };
    case 'مختفي هذا الشهر':
      return {
        priority: 'عاجلة',
        reason: 'توقف عن الشراء في الفترة الحالية',
        action: 'استرجاع عاجل + معرفة سبب الانقطاع + عرض المساعدة أو توفير الاحتياج',
        channel: 'اتصال ثم واتساب',
      };
    case 'تراجع قوي':
      return {
        priority: 'عاجلة',
        reason: 'انخفاض قوي في المشتريات',
        action: 'فهم سبب التراجع + مراجعة احتياجات العميل + محاولة استعادة معدل الشراء السابق',
        channel: 'اتصال',
      };
    case 'تراجع':
      return {
        priority: 'عالية',
        reason: 'انخفاض في المشتريات',
        action: 'متابعة مبكرة + فهم السبب + منع انتقال العميل إلى تراجع قوي',
        channel: 'واتساب / اتصال',
      };
    default:
      return {
        priority: 'عادية',
        reason: row.customer_state || 'متابعة دورية',
        action: 'متابعة رضا العميل واحتياجاته القادمة',
        channel: 'واتساب',
      };
  }
}

function followupUrl(c: CustomerMonthlyRow) {
  const params = new URLSearchParams({ quickFollowup: '1' });
  if (c.customer_code) params.set('code', c.customer_code);
  if (c.customer_name) params.set('name', c.customer_name);
  if (c.phone) params.set('phone', c.phone);
  try {
    sessionStorage.setItem(
      'dawaa_pending_followup_customer',
      JSON.stringify({
        code: c.customer_code || '',
        name: c.customer_name || '',
        phone: c.phone || '',
      })
    );
  } catch {
    // الرابط نفسه يظل fallback لو sessionStorage غير متاح.
  }
  return `/customer-service?${params.toString()}`;
}

const STATE_FILTER_OPTIONS = ['الكل', 'تراجع قوي', 'مختفي هذا الشهر', 'تراجع'];

export default function CustomerMonthlyPerformance() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canSeeAllBranches = canViewAllBranches(user);
  const [mode, setMode] = useState<PeriodMode>('cycle');
  const [refDate, setRefDate] = useState<string>(() => todayStr());
  const [stateFilter, setStateFilter] = useState<string>('الكل');
  const [listTab, setListTab] = useState<'declining' | 'improving'>('declining');
  const [branch, setBranch] = useState<string>(() =>
    canSeeAllBranches ? ALL_BRANCHES_VALUE : user?.branch || BRANCHES?.[0] || 'فرع شكري'
  );
  const [summary, setSummary] = useState<
    (MonthlyPerformanceSummary & { computedAt: string | null; fromCache: boolean }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [watchlistMessage, setWatchlistMessage] = useState('');
  const [uploadingWatchlist, setUploadingWatchlist] = useState(false);
  const [detailsCustomer, setDetailsCustomer] = useState<CustomerMonthlyRow | null>(null);
  const [activeCohort, setActiveCohort] = useState<CohortKey | null>(null);
  const [cohortSearch, setCohortSearch] = useState('');
  const [cohortPage, setCohortPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const period = useMemo(
    () =>
      mode === 'cycle'
        ? getPharmacyCycleRange(new Date(refDate))
        : calendarMonthRange(new Date(refDate)),
    [mode, refDate]
  );
  const prevPeriod = useMemo(() => previousPeriod(mode, period.start), [mode, period.start]);
  const isCurrentPeriod = refDate === todayStr();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchMonthlyCustomerPerformance(
        branch === ALL_BRANCHES_VALUE ? null : branch,
        period.start,
        period.end,
        prevPeriod.start,
        prevPeriod.end,
        mode
      );
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, mode, refDate]);

  useEffect(() => {
    setCohortPage(1);
  }, [activeCohort, cohortSearch]);

  const salesChangePct =
    summary && summary.previousTotalSales > 0
      ?
          Math.round(
            ((summary.totalSales - summary.previousTotalSales) / summary.previousTotalSales) * 1000
          ) / 10
      : null;

  const cohortRows = useMemo(() => {
    if (!summary || !activeCohort) return [];
    const query = normalizeSearch(cohortSearch);
    const rows = summary.rows.filter((row) => isCohortRow(row, activeCohort));
    const filtered = query
      ? rows.filter((row) =>
          [row.customer_name, row.customer_code, row.phone, row.branch, row.current_segment, row.previous_segment]
            .map(normalizeSearch)
            .some((value) => value.includes(query))
        )
      : rows;
    return sortCohortRows(filtered, activeCohort);
  }, [summary, activeCohort, cohortSearch]);

  const cohortTotalPages = Math.max(1, Math.ceil(cohortRows.length / COHORT_PAGE_SIZE));
  const visibleCohortRows = cohortRows.slice(
    (cohortPage - 1) * COHORT_PAGE_SIZE,
    cohortPage * COHORT_PAGE_SIZE
  );

  const cohortCounts = useMemo(() => {
    if (!summary) return null;
    const count = (cohort: CohortKey) => summary.rows.filter((row) => isCohortRow(row, cohort)).length;
    return {
      new: count('new'),
      reactivated: count('reactivated'),
      lost: count('lost'),
      strongDecline: count('strongDecline'),
      decline: count('decline'),
      risk: count('risk'),
    };
  }, [summary]);

  const openCohort = (cohort: CohortKey) => {
    setActiveCohort(cohort);
    setCohortSearch('');
    setCohortPage(1);
    window.setTimeout(() => {
      document.getElementById('customer-cohort-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const uploadWatchlist = async (file: File) => {
    if (branch === ALL_BRANCHES_VALUE) {
      setWatchlistMessage('اختاري فرعًا محددًا قبل رفع قائمة أهم 20 عميل.');
      return;
    }
    setUploadingWatchlist(true);
    setWatchlistMessage('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = normalizeWatchlistRows(
        XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      );
      if (!rows.length) {
        throw new Error(
          'لم يتم العثور على عمود كود العميل. استخدمي: كود العميل، اسم العميل، الهاتف، ملاحظة.'
        );
      }
      const saved = await replaceCustomerWatchlist(branch, rows);
      setWatchlistMessage(`تم اعتماد قائمة مراقبة من ${saved} عميل لفرع ${branch}.`);
    } catch (uploadError) {
      setWatchlistMessage(
        uploadError instanceof Error ? uploadError.message : 'تعذر رفع قائمة المراقبة'
      );
    } finally {
      setUploadingWatchlist(false);
    }
  };

  const exportRowsToExcel = async (
    rows: CustomerMonthlyRow[],
    cohort: CohortKey | 'all',
    fileLabel: string
  ) => {
    if (!rows.length || exporting) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const details = rows.map((row, index) => ({
        '#': index + 1,
        'اسم العميل': row.customer_name || '',
        'كود العميل': row.customer_code || '',
        الهاتف: row.phone || '',
        الفرع: row.branch || '',
        'حالة العميل': row.customer_state || '',
        'التصنيف السابق': row.previous_segment || '',
        'التصنيف الحالي': row.current_segment || '',
        'قبل 3 فترات': Number(row.month_3_ago_sales || 0),
        'قبل فترتين': Number(row.month_2_ago_sales || 0),
        'الفترة السابقة': Number(row.previous_month_sales || 0),
        'الفترة الحالية': Number(row.sales_amount || 0),
        'الفرق عن المتوقع حتى اليوم': Number(row.sales_change_amount || 0),
        'نسبة التغير %': row.sales_change_pct ?? '',
        'الإيراد المعرض للخطر': rowRiskGap(row),
        'عدد فواتير الفترة الحالية': Number(row.invoice_count || 0),
        'متوسط الفاتورة': Number(row.avg_invoice || 0),
        'آخر شراء': row.last_purchase_date || '',
      }));

      const followup = rows.map((row, index) => {
        const plan = followupPlan(row);
        return {
          '#': index + 1,
          'اسم العميل': row.customer_name || '',
          'كود العميل': row.customer_code || '',
          الهاتف: row.phone || '',
          الفرع: row.branch || '',
          'حالة العميل': row.customer_state || '',
          الأولوية: plan.priority,
          'سبب المتابعة': plan.reason,
          'الإجراء المقترح': plan.action,
          'قناة التواصل المقترحة': plan.channel,
          'آخر شراء': row.last_purchase_date || '',
          'مشتريات الفترة الحالية': Number(row.sales_amount || 0),
          'مشتريات الفترة السابقة': Number(row.previous_month_sales || 0),
          'الإيراد المعرض للخطر': rowRiskGap(row),
          'تمت المتابعة؟': '',
          'تم الرد؟': '',
          'نتيجة التواصل': '',
          'ملخص المتابعة': '',
          'تم إنشاء طلب؟': '',
          'قيمة الطلب': '',
          'يحتاج متابعة أخرى؟': '',
          'موعد المتابعة القادمة': '',
          'مسؤول المتابعة': '',
          'ملاحظات': '',
        };
      });

      const summarySheet = [
        { البيان: 'نوع القائمة', القيمة: cohort === 'all' ? 'كل فئات العملاء' : fileLabel },
        { البيان: 'الفرع', القيمة: branch },
        { البيان: 'نوع الفترة', القيمة: mode === 'cycle' ? 'دورة دواء 26-25' : 'الشهر الميلادي' },
        { البيان: 'بداية الفترة', القيمة: period.start },
        { البيان: 'نهاية الفترة', القيمة: period.end },
        { البيان: 'بداية الفترة السابقة', القيمة: prevPeriod.start },
        { البيان: 'نهاية الفترة السابقة', القيمة: prevPeriod.end },
        { البيان: 'عدد العملاء', القيمة: rows.length },
        { البيان: 'إجمالي مشتريات القائمة', القيمة: rows.reduce((sum, row) => sum + Number(row.sales_amount || 0), 0) },
        { البيان: 'إجمالي الإيراد المعرض للخطر', القيمة: rows.reduce((sum, row) => sum + rowRiskGap(row), 0) },
        { البيان: 'تاريخ التصدير', القيمة: new Date().toLocaleString('ar-EG') },
      ];

      const summaryWs = XLSX.utils.json_to_sheet(summarySheet);
      const detailsWs = XLSX.utils.json_to_sheet(details);
      const followupWs = XLSX.utils.json_to_sheet(followup);
      detailsWs['!autofilter'] = { ref: detailsWs['!ref'] || 'A1:R1' };
      followupWs['!autofilter'] = { ref: followupWs['!ref'] || 'A1:X1' };
      detailsWs['!freeze'] = { xSplit: 0, ySplit: 1 } as never;
      followupWs['!freeze'] = { xSplit: 0, ySplit: 1 } as never;

      XLSX.utils.book_append_sheet(workbook, summaryWs, 'ملخص');
      XLSX.utils.book_append_sheet(workbook, detailsWs, 'تفاصيل العملاء');
      XLSX.utils.book_append_sheet(workbook, followupWs, 'خطة المتابعة');

      const safeBranch = branch.replace(/\s+/g, '-');
      const safeLabel = fileLabel.replace(/\s+/g, '-');
      XLSX.writeFile(
        workbook,
        `اداء-العملاء-${safeLabel}-${safeBranch}-${period.start}-${period.end}.xlsx`
      );
    } finally {
      setExporting(false);
    }
  };

  const exportActiveCohort = () => {
    if (!activeCohort || !summary) return;
    const rows = sortCohortRows(
      summary.rows.filter((row) => isCohortRow(row, activeCohort)),
      activeCohort
    );
    void exportRowsToExcel(rows, activeCohort, COHORT_META[activeCohort].title);
  };

  const exportAllCohorts = () => {
    if (!summary) return;
    const rows = summary.rows.filter((row) =>
      ['جديد', 'مستعاد', 'مختفي هذا الشهر', 'تراجع قوي', 'تراجع'].includes(row.customer_state)
    );
    void exportRowsToExcel(rows, 'all', 'كل-الفئات');
  };

  return (
    <div dir="rtl" className="space-y-4 p-4 md:p-6">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="dawaa-icon-tile p-3">
              <Users style={{ color: 'var(--dawaa-theme-primary-strong)' }} />
            </div>
            <div>
              <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                أداء العملاء الشهري
              </h1>
              <p className="text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                كسبنا كام عميل، فقدنا كام، مين محتاج متابعة النهاردة — في أقل من دقيقة.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportAllCohorts}
              className="btn-secondary flex items-center gap-2 text-xs"
              disabled={!summary || exporting}
            >
              <Download size={14} /> {exporting ? 'جاري التصدير...' : 'تصدير كل قوائم المتابعة'}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="btn-secondary flex items-center gap-2 text-xs"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div
            className="flex overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--dawaa-theme-border)' }}
          >
            <button
              type="button"
              onClick={() => setMode('cycle')}
              className="px-4 py-2 text-sm font-bold"
              style={
                mode === 'cycle'
                  ? {
                      background: 'var(--dawaa-theme-primary)',
                      color: 'var(--dawaa-theme-primary-text)',
                    }
                  : { color: 'var(--dawaa-theme-muted)' }
              }
            >
              دورة دواء 26-25
            </button>
            <button
              type="button"
              onClick={() => setMode('calendar')}
              className="px-4 py-2 text-sm font-bold"
              style={
                mode === 'calendar'
                  ? {
                      background: 'var(--dawaa-theme-primary)',
                      color: 'var(--dawaa-theme-primary-text)',
                    }
                  : { color: 'var(--dawaa-theme-muted)' }
              }
            >
              الشهر الميلادي
            </button>
          </div>
          {canSeeAllBranches ? (
            <select className="input-dark w-auto" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value={ALL_BRANCHES_VALUE}>{ALL_BRANCHES_VALUE}</option>
              {(BRANCHES || ['فرع شكري', 'فرع الشامي']).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          ) : (
            <span
              className="rounded-xl border px-4 py-2 text-sm font-bold"
              style={{
                borderColor: 'var(--dawaa-theme-border)',
                background: 'var(--dawaa-theme-soft)',
                color: 'var(--dawaa-theme-heading)',
              }}
            >
              {branch}
            </span>
          )}
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="input-dark w-auto"
              value={refDate}
              max={todayStr()}
              onChange={(e) => setRefDate(e.target.value || todayStr())}
            />
            {!isCurrentPeriod && (
              <button type="button" onClick={() => setRefDate(todayStr())} className="btn-secondary text-xs">
                الفترة الحالية
              </button>
            )}
          </div>
          <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            {period.start} إلى {period.end} — مقارنة بـ {prevPeriod.start} إلى {prevPeriod.end}
          </span>
          {summary?.computedAt && (
            <span
              className="rounded-full px-3 py-1 text-xs font-black"
              style={{
                background: 'var(--dawaa-theme-accent-soft)',
                color: 'var(--dawaa-theme-primary-strong)',
              }}
            >
              آخر تحديث:{' '}
              {new Date(summary.computedAt).toLocaleString('ar-EG', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          <label
            className={`btn-secondary flex cursor-pointer items-center gap-2 text-xs ${
              branch === ALL_BRANCHES_VALUE || uploadingWatchlist
                ? 'pointer-events-none opacity-50'
                : ''
            }`}
          >
            <FileUp size={14} /> {uploadingWatchlist ? 'جاري رفع القائمة...' : 'رفع أهم 20 عميل'}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.xls,.csv"
              disabled={branch === ALL_BRANCHES_VALUE || uploadingWatchlist}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadWatchlist(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        {watchlistMessage ? (
          <p
            className="mt-3 rounded-xl border p-3 text-xs font-bold"
            style={
              watchlistMessage.startsWith('تم اعتماد')
                ? {
                    borderColor: 'var(--dawaa-status-success-border)',
                    background: 'var(--dawaa-status-success-bg)',
                    color: 'var(--dawaa-status-success-text)',
                  }
                : {
                    borderColor: 'var(--dawaa-status-warning-border)',
                    background: 'var(--dawaa-status-warning-bg)',
                    color: 'var(--dawaa-status-warning-text)',
                  }
            }
          >
            {watchlistMessage}
          </p>
        ) : null}
        {error && (
          <p className="mt-3 text-sm font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>
            {error}
          </p>
        )}
      </Panel>

      {loading ? (
        <Panel className="p-8 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          جارٍ التحميل...
          {!isCurrentPeriod && ' (فترة تاريخية مش مخزّنة، ممكن تاخد لحد 10-15 ثانية)'}
        </Panel>
      ) : null}

      {summary && !loading && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="عملاء جدد"
              value={String(summary.newCount)}
              subtitle="اضغط لعرض كل العملاء وتاريخ مشترياتهم"
              icon={<UserPlus size={20} />}
              tone="green"
              onClick={() => openCohort('new')}
            />
            <KpiCard
              title="عملاء مستعادين"
              value={String(summary.reactivatedCount)}
              subtitle="اضغط لعرض العملاء العائدين بعد التوقف"
              icon={<UserCheck size={20} />}
              tone="cyan"
              onClick={() => openCohort('reactivated')}
            />
            <KpiCard
              title="اختفوا تمامًا"
              value={String(summary.lostCount)}
              subtitle="اضغط لبدء قائمة الاسترجاع والمتابعة"
              icon={<UserX size={20} />}
              tone="red"
              onClick={() => openCohort('lost')}
            />
            <KpiCard
              title="تراجعوا بقوة"
              value={String(summary.strongDeclineCount)}
              subtitle="اضغط لمعرفة من قلل مشترياته وتفاصيل 3 فترات"
              icon={<TrendingDown size={20} />}
              tone="amber"
              onClick={() => openCohort('strongDecline')}
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MiniBox
              label="صافي نمو العملاء (جدد + مستعادين - مختفين)"
              value={`${summary.netCustomerGrowth >= 0 ? '+' : ''}${summary.netCustomerGrowth}`}
              tone={summary.netCustomerGrowth >= 0 ? 'green' : 'red'}
            />
            <div
              className="rounded-2xl border p-4"
              style={{
                borderColor: 'var(--dawaa-theme-accent-border)',
                background: 'var(--dawaa-theme-accent-soft)',
              }}
            >
              <p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-text)' }}>
                إجمالي المبيعات (مقارنة بالفترة السابقة)
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {fmtMoney(summary.totalSales)}
                </span>
                {salesChangePct !== null && (
                  <span
                    className="flex items-center gap-1 text-xs font-black"
                    style={{
                      color:
                        salesChangePct >= 0
                          ? 'var(--dawaa-status-success-text)'
                          : 'var(--dawaa-status-danger-text)',
                    }}
                  >
                    {salesChangePct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {salesChangePct}%
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openCohort('risk')}
              className="rounded-2xl border p-4 text-right transition hover:-translate-y-0.5"
              style={{
                borderColor: 'var(--dawaa-status-danger-border)',
                background: 'var(--dawaa-status-danger-bg)',
              }}
            >
              <p
                className="flex items-center gap-2 text-xs font-black"
                style={{ color: 'var(--dawaa-status-danger-text)' }}
              >
                <AlertTriangle size={14} /> إيراد معرّض للخطر
              </p>
              <p
                className="mt-2 text-2xl font-black"
                style={{ color: 'var(--dawaa-status-danger-text)' }}
              >
                {fmtMoney(summary.revenueAtRisk)}
              </p>
              <p
                className="mt-1 text-[11px] font-bold"
                style={{ color: 'var(--dawaa-status-danger-text)' }}
              >
                من {cohortCounts?.risk || 0} عميل مهدد — اضغط لعرضهم
              </p>
            </button>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openCohort('decline')} className="btn-secondary text-xs">
              قللوا مشترياتهم ({cohortCounts?.decline || 0})
            </button>
            <button type="button" onClick={() => openCohort('risk')} className="btn-secondary text-xs">
              كل العملاء المهددين ({cohortCounts?.risk || 0})
            </button>
          </div>

          {activeCohort && (
            <Panel id="customer-cohort-details" className="space-y-4 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {COHORT_META[activeCohort].title}
                    </h2>
                    <span
                      className="rounded-full px-3 py-1 text-xs font-black"
                      style={{
                        background: 'var(--dawaa-theme-soft)',
                        color: 'var(--dawaa-theme-primary-strong)',
                      }}
                    >
                      {cohortRows.length} عميل
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                    {COHORT_META[activeCohort].subtitle} كل صف يعرض آخر 3 فترات بالإضافة للفترة الحالية.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={exportActiveCohort}
                    className="btn-secondary flex items-center gap-2 text-xs"
                    disabled={exporting || !cohortRows.length}
                  >
                    <Download size={14} /> تصدير Excel + خطة متابعة
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCohort(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border"
                    style={{
                      borderColor: 'var(--dawaa-theme-border)',
                      color: 'var(--dawaa-theme-muted)',
                    }}
                    aria-label="إغلاق تفاصيل الفئة"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ['new', 'جدد'],
                    ['reactivated', 'مستعادين'],
                    ['lost', 'مختفين'],
                    ['strongDecline', 'تراجع قوي'],
                    ['decline', 'قللوا مشترياتهم'],
                    ['risk', 'مهددين'],
                  ] as Array<[CohortKey, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => openCohort(key)}
                    className="rounded-xl border px-3 py-2 text-xs font-black"
                    style={
                      activeCohort === key
                        ? {
                            borderColor: 'var(--dawaa-theme-accent-border)',
                            background: 'var(--dawaa-theme-accent-soft)',
                            color: 'var(--dawaa-theme-primary-strong)',
                          }
                        : {
                            borderColor: 'var(--dawaa-theme-border)',
                            background: 'var(--dawaa-theme-surface)',
                            color: 'var(--dawaa-theme-muted)',
                          }
                    }
                  >
                    {label} ({cohortCounts?.[key] || 0})
                  </button>
                ))}
              </div>

              <div className="relative max-w-xl">
                <Search
                  size={16}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--dawaa-theme-muted)' }}
                />
                <input
                  value={cohortSearch}
                  onChange={(event) => setCohortSearch(event.target.value)}
                  className="input-dark w-full pr-10"
                  placeholder="بحث بالاسم أو الكود أو الهاتف أو الفرع..."
                />
              </div>

              {cohortRows.length === 0 ? (
                <EmptyState label="لا توجد بيانات مطابقة داخل هذه الفئة." />
              ) : (
                <>
                  <div
                    className="overflow-x-auto rounded-2xl border"
                    style={{ borderColor: 'var(--dawaa-theme-border)' }}
                  >
                    <table className="min-w-[1250px] w-full text-sm">
                      <thead>
                        <tr className="text-right text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          <th className="p-2 font-bold">العميل</th>
                          <th className="p-2 font-bold">الهاتف</th>
                          <th className="p-2 font-bold">قبل 3 فترات</th>
                          <th className="p-2 font-bold">قبل فترتين</th>
                          <th className="p-2 font-bold">الفترة السابقة</th>
                          <th className="p-2 font-bold">الفترة الحالية</th>
                          <th className="p-2 font-bold">التغير</th>
                          <th className="p-2 font-bold">آخر شراء</th>
                          <th className="p-2 font-bold">خطة المتابعة</th>
                          <th className="p-2 font-bold">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCohortRows.map((c, i) => {
                          const plan = followupPlan(c);
                          return (
                            <tr
                              key={`${c.customer_code || c.phone || c.customer_name}-${i}`}
                              className="border-t"
                              style={{ borderColor: 'var(--dawaa-theme-border)' }}
                            >
                              <td className="p-2 align-top">
                                <div className="font-bold" style={{ color: 'var(--dawaa-theme-heading)' }}>
                                  {c.customer_name || 'غير معروف'}
                                </div>
                                <div className="mt-1 text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                  {c.customer_code ? `كود ${c.customer_code}` : 'بدون كود'} · {c.branch}
                                  <br />
                                  {c.previous_segment || '—'} ← {c.current_segment || '—'}
                                </div>
                              </td>
                              <td className="p-2 align-top" style={{ color: 'var(--dawaa-theme-text)' }}>
                                {c.phone || '—'}
                              </td>
                              <td className="p-2 align-top" style={{ color: 'var(--dawaa-theme-text)' }}>
                                {fmtMoney(c.month_3_ago_sales)}
                              </td>
                              <td className="p-2 align-top" style={{ color: 'var(--dawaa-theme-text)' }}>
                                {fmtMoney(c.month_2_ago_sales)}
                              </td>
                              <td className="p-2 align-top" style={{ color: 'var(--dawaa-theme-text)' }}>
                                {fmtMoney(c.previous_month_sales)}
                              </td>
                              <td className="p-2 align-top font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                                {fmtMoney(c.sales_amount)}
                                <div className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                  {c.invoice_count || 0} فاتورة · متوسط {fmtMoney(c.avg_invoice)}
                                </div>
                              </td>
                              <td className="p-2 align-top">
                                <span
                                  className="text-xs font-black"
                                  style={{ color: STATE_TOKEN[c.customer_state] || 'var(--dawaa-theme-text)' }}
                                >
                                  {c.customer_state}
                                </span>
                                {c.sales_change_pct !== null && c.sales_change_pct !== undefined && (
                                  <div className="mt-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                    {c.sales_change_pct > 0 ? '+' : ''}{c.sales_change_pct}%
                                  </div>
                                )}
                                {rowRiskGap(c) > 0 && (
                                  <div
                                    className="mt-1 text-[11px] font-black"
                                    style={{ color: 'var(--dawaa-status-danger-text)' }}
                                  >
                                    فجوة {fmtMoney(rowRiskGap(c))}
                                  </div>
                                )}
                              </td>
                              <td className="p-2 align-top" style={{ color: 'var(--dawaa-theme-text)' }}>
                                {c.last_purchase_date || '—'}
                              </td>
                              <td className="max-w-[280px] p-2 align-top">
                                <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                                  {plan.priority} · {plan.reason}
                                </div>
                                <div className="mt-1 text-[11px] leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                  {plan.action}
                                </div>
                              </td>
                              <td className="p-2 align-top">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setDetailsCustomer(c)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                                    style={{
                                      borderColor: 'var(--dawaa-theme-accent-border)',
                                      background: 'var(--dawaa-theme-accent-soft)',
                                      color: 'var(--dawaa-theme-primary-strong)',
                                    }}
                                    aria-label={`عرض تفاصيل العميل ${c.customer_name || ''}`}
                                    title="عرض تفاصيل العميل"
                                  >
                                    <Eye size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => navigate(followupUrl(c))}
                                    className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-black"
                                    style={{
                                      background: 'var(--dawaa-theme-primary)',
                                      color: 'var(--dawaa-theme-primary-text)',
                                    }}
                                  >
                                    متابعة الآن
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                      عرض {(cohortPage - 1) * COHORT_PAGE_SIZE + 1}–
                      {Math.min(cohortPage * COHORT_PAGE_SIZE, cohortRows.length)} من {cohortRows.length} عميل
                    </span>
                    {cohortTotalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary inline-flex items-center gap-1 text-xs"
                          disabled={cohortPage <= 1}
                          onClick={() => setCohortPage((page) => Math.max(1, page - 1))}
                        >
                          <ChevronRight size={14} /> السابق
                        </button>
                        <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                          {cohortPage} / {cohortTotalPages}
                        </span>
                        <button
                          type="button"
                          className="btn-secondary inline-flex items-center gap-1 text-xs"
                          disabled={cohortPage >= cohortTotalPages}
                          onClick={() => setCohortPage((page) => Math.min(cohortTotalPages, page + 1))}
                        >
                          التالي <ChevronLeft size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Panel>
          )}

          <div
            className="flex w-fit overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--dawaa-theme-border)' }}
          >
            <button
              type="button"
              onClick={() => setListTab('declining')}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
              style={
                listTab === 'declining'
                  ? {
                      background: 'var(--dawaa-status-danger-bg)',
                      color: 'var(--dawaa-status-danger-text)',
                    }
                  : { color: 'var(--dawaa-theme-muted)' }
              }
            >
              <TrendingDown size={16} /> العملاء المتراجعين ({summary.needsAttention.length})
            </button>
            <button
              type="button"
              onClick={() => setListTab('improving')}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
              style={
                listTab === 'improving'
                  ? {
                      background: 'var(--dawaa-status-success-bg)',
                      color: 'var(--dawaa-status-success-text)',
                    }
                  : { color: 'var(--dawaa-theme-muted)' }
              }
            >
              <TrendingUp size={16} /> العملاء المتحسنين ({summary.improving.length})
            </button>
          </div>

          {listTab === 'declining' && (
            <Panel className="space-y-3 p-4">
              <SectionTitle
                title={`عملاء يحتاجون متابعتك النهاردة (${
                  summary.needsAttention.filter(
                    (c) => stateFilter === 'الكل' || c.customer_state === stateFilter
                  ).length
                })`}
                icon={<TrendingDown size={18} />}
              />
              <div className="-mt-2 mb-1 flex items-center gap-2">
                <select
                  className="input-dark w-auto text-xs"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                >
                  {STATE_FILTER_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s === 'الكل' ? 'كل الحالات' : s}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                  مرتبون حسب قيمة الخطر
                </span>
              </div>
              {(() => {
                const filtered = summary.needsAttention.filter(
                  (c) => stateFilter === 'الكل' || c.customer_state === stateFilter
                );
                return filtered.length === 0 ? (
                  <EmptyState label="مفيش عملاء مطابقين للفلتر ده دلوقتي 🎉" />
                ) : (
                  <div
                    className="overflow-x-auto rounded-2xl border"
                    style={{ borderColor: 'var(--dawaa-theme-border)' }}
                  >
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-right text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          <th className="p-2 font-bold">العميل</th>
                          <th className="p-2 font-bold">قبل 3 شهور</th>
                          <th className="p-2 font-bold">قبل شهرين</th>
                          <th className="p-2 font-bold">الشهر السابق</th>
                          <th className="p-2 font-bold">الشهر الحالي</th>
                          <th className="p-2 font-bold">الحالة</th>
                          <th className="p-2 font-bold">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, 30).map((c, i) => (
                          <tr
                            key={`${c.customer_code}-${i}`}
                            className="border-t"
                            style={{ borderColor: 'var(--dawaa-theme-border)' }}
                          >
                            <td className="p-2">
                              <div className="font-bold" style={{ color: 'var(--dawaa-theme-heading)' }}>
                                {c.customer_name || 'غير معروف'}
                              </div>
                              <div className="text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                ({c.previous_segment}) · آخر شراء: {c.last_purchase_date || '—'}
                                {branch === ALL_BRANCHES_VALUE && (
                                  <span style={{ color: 'var(--dawaa-theme-primary-strong)' }}> · {c.branch}</span>
                                )}
                                {c.customer_code && <span> · كود {c.customer_code}</span>}
                              </div>
                            </td>
                            <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {fmtMoney(c.month_3_ago_sales)}
                            </td>
                            <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {fmtMoney(c.month_2_ago_sales)}
                            </td>
                            <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {fmtMoney(c.previous_month_sales)}
                            </td>
                            <td className="p-2" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {fmtMoney(c.sales_amount)}
                            </td>
                            <td className="p-2">
                              <span
                                className="text-xs font-black"
                                style={{ color: STATE_TOKEN[c.customer_state] || 'var(--dawaa-theme-text)' }}
                              >
                                {c.customer_state}
                              </span>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDetailsCustomer(c)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                                  style={{
                                    borderColor: 'var(--dawaa-theme-accent-border)',
                                    background: 'var(--dawaa-theme-accent-soft)',
                                    color: 'var(--dawaa-theme-primary-strong)',
                                  }}
                                  aria-label={`عرض تفاصيل العميل ${c.customer_name || ''}`}
                                  title="عرض تفاصيل العميل"
                                >
                                  <Eye size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => navigate(followupUrl(c))}
                                  className="rounded-lg px-3 py-1.5 text-xs font-black"
                                  style={{
                                    background: 'var(--dawaa-theme-primary)',
                                    color: 'var(--dawaa-theme-primary-text)',
                                  }}
                                >
                                  متابعة الآن
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </Panel>
          )}

          {listTab === 'improving' && (
            <Panel className="space-y-3 p-4">
              <SectionTitle
                title={`عملاء متحسنين محتاجين شكر واهتمام (${summary.improving.length})`}
                subtitle="مرتبون حسب أعلى زيادة في المبيعات"
                icon={<TrendingUp size={18} />}
              />
              {summary.improving.length === 0 ? (
                <EmptyState label="مفيش عملاء مهمين بيتحسنوا بشكل ملحوظ في الفترة دي دلوقتي." />
              ) : (
                <div className="space-y-2">
                  {summary.improving.slice(0, 30).map((c, i) => (
                    <div
                      key={`${c.customer_code}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
                      style={{
                        borderColor: 'var(--dawaa-status-success-border)',
                        background: 'var(--dawaa-status-success-bg)',
                      }}
                    >
                      <div>
                        <div className="font-bold" style={{ color: 'var(--dawaa-theme-heading)' }}>
                          {c.customer_name || 'غير معروف'}{' '}
                          <span className="text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            ({c.current_segment})
                          </span>
                        </div>
                        <div className="text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          آخر شراء: {c.last_purchase_date || '—'} · دلوقتي بيصرف {fmtMoney(c.sales_amount)}
                          {c.sales_change_amount > 0 && (
                            <span style={{ color: 'var(--dawaa-status-success-text)' }}>
                              {' '}(+{fmtMoney(c.sales_change_amount)})
                            </span>
                          )}
                          {branch === ALL_BRANCHES_VALUE && (
                            <span style={{ color: 'var(--dawaa-theme-primary-strong)' }}> · {c.branch}</span>
                          )}
                          {c.customer_code && <span> · كود {c.customer_code}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className="text-sm font-black"
                          style={{ color: STATE_TOKEN[c.customer_state] || 'var(--dawaa-theme-text)' }}
                        >
                          {c.customer_state}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDetailsCustomer(c)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                          style={{
                            borderColor: 'var(--dawaa-status-success-border)',
                            background: 'var(--dawaa-theme-surface)',
                            color: 'var(--dawaa-status-success-text)',
                          }}
                          aria-label={`عرض تفاصيل العميل ${c.customer_name || ''}`}
                          title="عرض تفاصيل العميل"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(followupUrl(c))}
                          className="rounded-lg px-3 py-1.5 text-xs font-black"
                          style={{
                            background: 'var(--dawaa-status-success-text)',
                            color: 'var(--dawaa-theme-primary-text)',
                          }}
                        >
                          اتصال شكر
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </>
      )}

      {detailsCustomer && (
        <CustomerQuickDetailsModal
          customerCode={detailsCustomer.customer_code}
          customerPhone={detailsCustomer.phone}
          customerName={detailsCustomer.customer_name}
          branch={detailsCustomer.branch || (branch === ALL_BRANCHES_VALUE ? null : branch)}
          fallbackMetric={{
            invoices_count: detailsCustomer.invoice_count,
            total_spent: detailsCustomer.sales_amount,
            total_purchases: detailsCustomer.sales_amount,
            avg_invoice: detailsCustomer.avg_invoice,
            last_purchase: detailsCustomer.last_purchase_date,
            segment: detailsCustomer.current_segment || detailsCustomer.previous_segment,
            type: detailsCustomer.current_segment || detailsCustomer.previous_segment,
            customer_status: detailsCustomer.customer_state,
            status: detailsCustomer.customer_state,
          }}
          onClose={() => setDetailsCustomer(null)}
        />
      )}
    </div>
  );
}
