import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  MessageSquare,
  Phone,
  Search,
  Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import {
  ALL_FILTER,
  getCustomerDetails,
  getCustomerMonthlyAnalytics,
  getCustomers,
  getCustomerStats,
  saveCustomerProfileNotes,
  createCustomerManualFollowup,
  createCustomerPersonalOffer,
  type CustomerDetails,
  type CustomerMetric,
  type CustomerMonthlyAnalytics,
  type CustomerStats,
} from '@/lib/api/customers';
import { formatCurrency, formatDate } from '@/lib/utils';
import { cashbackStatusLabel, cashbackSummaryLine } from '@/lib/api/customerLoyalty';
import { whatsappLink } from '@/lib/whatsapp';
import { BRANCHES } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';
import {
  CUSTOMER_FLAGS,
  getActiveCustomerFlags,
  hasCustomerFlag,
  toggleCustomerFlag,
  mergeCustomerFlags,
  parseCustomerFlags,
  getFlagBadgeStyle,
  getSeverityBadgeStyle,
  getInactiveFlagButtonStyle,
  sortFlagsByPriority,
} from '@/lib/customerFlags';
import { CustomerFlagsBadges } from '@/components/CustomerFlagsBadges';
import { logActivity } from '@/lib/activityLog';
import { useAuth } from '@/hooks/useAuth';
import { getBestCustomerPhone } from '@/lib/customerAnalyticsService';

const PAGE_SIZE = 30;

const EMPTY_STATS: CustomerStats = {
  total: 0,
  summaryTotal: 0,
  veryImportant: 0,
  important: 0,
  medium: 0,
  normal: 0,
  newC: 0,
  active: 0,
  atRisk: 0,
  stopped: 0,
  noPurchase: 0,
  vip: 0,
  loyal: 0,
};

const SEGMENT_OPTIONS = ['مهم جدًا', 'مهم', 'متوسط', 'عادي'];
const STATUS_OPTIONS = ['جديد', 'نشط', 'مهدد بالتوقف', 'متوقف', 'بدون شراء'];

function bestCustomerPhone(customer: CustomerMetric, details?: CustomerDetails | null) {
  return getBestCustomerPhone(
    {
      customer_phone: customer.customer_phone,
      phone: customer.phone,
      customer_code: customer.customer_code,
    },
    customer,
    details
      ? {
          whatsapp_phone: details.whatsappPhone,
          phone_alt: details.phoneAlt,
          customer_phone: customer.customer_phone,
          phone: customer.phone,
        }
      : null
  );
}

function customerFlagLabelsForDetails(flags: Record<string, boolean> | null | undefined) {
  return getActiveCustomerFlags(flags || {}).map((flag) => flag.label);
}

function CustomerPhoneCell({ customer }: { customer: CustomerMetric }) {
  const phone = bestCustomerPhone(customer);
  if (!phone) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-black text-slate-500">بدون رقم</span>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
          رقم غير صالح
        </span>
      </div>
    );
  }
  return <span className="num font-bold text-slate-800">{phone}</span>;
}

export default function Customers() {
  const { user } = useAuth();
  const [urlParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(ALL_FILTER);
  const [segmentFilter, setSegmentFilter] = useState(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [loyaltyFilter, setLoyaltyFilter] = useState(() => urlParams.get('loyalty') || '');
  const [minPurchaseFilter, setMinPurchaseFilter] = useState(
    () => Number(urlParams.get('min_purchase') || '') || undefined
  );
  const [maxPurchaseFilter, setMaxPurchaseFilter] = useState(
    () => Number(urlParams.get('max_purchase') || '') || undefined
  );
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<CustomerMetric[]>([]);
  const [stats, setStats] = useState<CustomerStats>(EMPTY_STATS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [monthlyAnalytics, setMonthlyAnalytics] = useState<CustomerMonthlyAnalytics | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerMetric | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(search.replace(/\s+/g, ' ').trim()),
      450
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    branchFilter,
    segmentFilter,
    statusFilter,
    minPurchaseFilter,
    maxPurchaseFilter,
  ]);

  useEffect(() => {
    const loyalty = urlParams.get('loyalty') || '';
    setLoyaltyFilter(loyalty);
    setMinPurchaseFilter(Number(urlParams.get('min_purchase') || '') || undefined);
    setMaxPurchaseFilter(Number(urlParams.get('max_purchase') || '') || undefined);
  }, [urlParams]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const stats = await getCustomerStats();
      if (import.meta.env.DEV) {
        console.log('[Customers.loadStats] Result:', stats);
      }
      setStats(stats);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'تعذر تحميل إحصائيات العملاء';
      if (import.meta.env.DEV) {
        console.error('[Customers.loadStats] Error:', errorMsg);
      }
      setError(errorMsg);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadMonthlyAnalytics = useCallback(async () => {
    setMonthlyLoading(true);
    try {
      const result = await getCustomerMonthlyAnalytics(6);
      setMonthlyAnalytics(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تحميل تطور العملاء الشهري';
      setMonthlyAnalytics({
        rows: [],
        source: 'customers + customer_metrics_summary',
        warnings: [message],
      });
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (customers.length) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      if (import.meta.env.DEV) {
        console.log('[Customers.loadCustomers]', {
          search: debouncedSearch,
          branch: branchFilter,
          segment: segmentFilter,
          status: statusFilter,
          page,
        });
      }

      const result = await getCustomers({
        search: debouncedSearch,
        branch: branchFilter,
        type: segmentFilter,
        status: statusFilter,
        minTotal: minPurchaseFilter,
        maxTotal: maxPurchaseFilter,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });

      if (requestId !== requestIdRef.current) return;

      if (import.meta.env.DEV) {
        console.log('[Customers.loadCustomers] Result:', {
          customersLength: result.customers.length,
          count: result.count,
        });
      }

      setCustomers(result.customers);
      setTotalCount(result.count);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const source = err instanceof Error ? err.message : 'غير معروف';
      const errorMsg = `تعذر تحميل ملخصات العملاء: ${source}`;
      if (import.meta.env.DEV) {
        console.error('[Customers.loadCustomers] Error:', source);
      }
      setCustomers([]);
      setTotalCount(0);
      setError(errorMsg);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    branchFilter,
    customers.length,
    debouncedSearch,
    page,
    segmentFilter,
    statusFilter,
    minPurchaseFilter,
    maxPurchaseFilter,
  ]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadMonthlyAnalytics();
  }, [loadMonthlyAnalytics]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(page * PAGE_SIZE, totalCount);

  const cards = useMemo(
    () => [
      {
        label: 'إجمالي العملاء المسجلين',
        value: stats.total,
        type: ALL_FILTER,
        status: ALL_FILTER,
        tone: 'slate' as const,
      },
      {
        label: 'عملاء لهم مشتريات',
        value: stats.summaryTotal,
        type: ALL_FILTER,
        status: ALL_FILTER,
        tone: 'teal' as const,
      },
      {
        label: 'مهم جدًا',
        value: stats.veryImportant,
        type: 'مهم جدًا',
        status: ALL_FILTER,
        tone: 'violet' as const,
      },
      {
        label: 'مهم',
        value: stats.important,
        type: 'مهم',
        status: ALL_FILTER,
        tone: 'amber' as const,
      },
      {
        label: 'متوسط',
        value: stats.medium,
        type: 'متوسط',
        status: ALL_FILTER,
        tone: 'blue' as const,
      },
      {
        label: 'عادي',
        value: stats.normal,
        type: 'عادي',
        status: ALL_FILTER,
        tone: 'slate' as const,
      },
      { label: 'جديد', value: stats.newC, type: ALL_FILTER, status: 'جديد', tone: 'teal' as const },
      {
        label: 'نشط',
        value: stats.active,
        type: ALL_FILTER,
        status: 'نشط',
        tone: 'emerald' as const,
      },
      {
        label: 'مهدد بالتوقف',
        value: stats.atRisk,
        type: ALL_FILTER,
        status: 'مهدد بالتوقف',
        tone: 'amber' as const,
      },
      {
        label: 'متوقف',
        value: stats.stopped,
        type: ALL_FILTER,
        status: 'متوقف',
        tone: 'red' as const,
      },
      {
        label: 'بدون شراء',
        value: stats.noPurchase,
        type: ALL_FILTER,
        status: 'بدون شراء',
        tone: 'blue' as const,
      },
      {
        label: 'عملاء دائمين 6+ شهور',
        value: stats.loyal,
        type: ALL_FILTER,
        status: ALL_FILTER,
        tone: 'emerald' as const,
      },
    ],
    [stats]
  );

  const applyCardFilter = (type: string, status: string) => {
    setSegmentFilter(type);
    setStatusFilter(status);
  };

  const exportFilteredCustomers = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const exportLimit = 500;
      const pageSize = 100;
      const allCustomers: CustomerMetric[] = [];

      for (let offset = 0; offset < exportLimit; offset += pageSize) {
        const result = await getCustomers({
          search: debouncedSearch,
          branch: branchFilter,
          type: segmentFilter,
          status: statusFilter,
          limit: pageSize,
          offset,
        });
        allCustomers.push(...result.customers);
        if (result.customers.length < pageSize || allCustomers.length >= result.count) break;
      }

      const rows = await Promise.all(
        allCustomers.slice(0, exportLimit).map(async (customer) => {
          try {
            const details = await getCustomerDetails(customer, 20);
            return { customer, details, error: '' };
          } catch (error) {
            return {
              customer,
              details: null,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      const customersSheet = rows.map(({ customer, details, error }) => ({
        'كود العميل': customer.customer_code || '',
        'اسم العميل': customer.customer_name || '',
        الهاتف: bestCustomerPhone(customer, details) || '',
        الفرع: normalizeBranchName(customer.branch) || '',
        التصنيف: customer.segment || '',
        الحالة: customer.customer_status || '',
        'إجمالي المشتريات': customer.total_spent || 0,
        'متوسط الفاتورة': customer.avg_invoice || 0,
        'متوسط شهري': customer.avg_monthly || 0,
        'عدد الفواتير': customer.invoices_count || 0,
        'أول شراء': customer.first_purchase || '',
        'آخر شراء': customer.last_purchase || '',
        'أشهر النشاط': customer.active_months || 0,
        'ملاحظات العميل': details?.customerNotes || '',
        'ملاحظات واتساب': details?.whatsappNotes || '',
        'ملاحظات الخدمة': details?.serviceNotes || '',
        'ملاحظات الفريق': details?.teamNotes || '',
        'طريقة التعامل': details?.handlingNotes || '',
        العنوان: details?.address || '',
        'هاتف إضافي': details?.phoneAlt || '',
        واتساب: details?.whatsappPhone || '',
        'علامات العميل': details?.customerFlags?.join(', ') || '',
        'حالة تكرار الشراء': details?.purchaseFrequencyStatus || '',
        'توصية المتابعة':
          details?.purchaseFrequencyRecommendation ||
          details?.purchaseAnalysis?.recommendation ||
          '',
        'آخر تقرير متابعة': details?.lastFollowupReport || '',
        'خطأ تحميل التفاصيل': error,
      }));

      const followupsSheet = rows.flatMap(({ customer, details }) =>
        (details?.followups || []).map((followup) => ({
          'كود العميل': customer.customer_code || '',
          'اسم العميل': customer.customer_name || '',
          الهاتف: bestCustomerPhone(customer, details) || '',
          'تاريخ المتابعة': followup.followup_date || followup.created_at || '',
          الحالة: followup.status || '',
          المسؤول: followup.responsible_name || followup.assigned_to || '',
          النتيجة: followup.followup_result || '',
          الملاحظات: followup.notes || '',
          'تاريخ الإغلاق': followup.completed_at || '',
        }))
      );

      const invoicesSheet = rows.flatMap(({ customer, details }) =>
        (details?.invoices || []).map((invoice) => ({
          'كود العميل': customer.customer_code || '',
          'اسم العميل': customer.customer_name || '',
          الهاتف: bestCustomerPhone(customer, details) || '',
          'رقم الفاتورة': invoice.invoice_number || '',
          'تاريخ الفاتورة': invoice.invoice_date || '',
          القيمة: invoice.amount || 0,
          الدكتور: invoice.seller_name || '',
          الفرع: invoice.branch || '',
        }))
      );

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(customersSheet), 'customers');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(followupsSheet), 'followups');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(invoicesSheet), 'invoices');

      const labelParts = [segmentFilter, statusFilter, branchFilter].filter(
        (value) => value && value !== ALL_FILTER
      );
      const fileLabel = labelParts.length ? labelParts.join('-') : 'all-customers';
      XLSX.writeFile(
        workbook,
        `dawaa-customers-${fileLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      toast.success(`تم تصدير ${customersSheet.length.toLocaleString('ar-EG')} عميل`);
    } catch (error) {
      toast.error(`تعذر تصدير العملاء: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="customers-page space-y-5" dir="rtl">
      <section className="dawaa-hero">
        <div>
          <span className="dawaa-brand-chip">customer_metrics_summary</span>
          <h1 className="mt-3 text-2xl font-black text-slate-950">العملاء</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            تصنيف سريع ودقيق من ملخصات العملاء بدون تحميل كل الفواتير
          </p>
        </div>
        <button
          type="button"
          onClick={exportFilteredCustomers}
          disabled={exporting || loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-teal-200 bg-white px-4 py-3 text-sm font-black text-teal-800 shadow-sm transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
          title="تصدير العملاء حسب الفلاتر الحالية"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          تصدير Excel
        </button>
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-black text-teal-800">
          {refreshing
            ? 'جاري تحديث النتائج...'
            : `${showingFrom}-${showingTo} من ${totalCount} في ملخص المشترين`}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-black text-slate-600">إجمالي العملاء المسجلين</div>
          <div className="num mt-2 text-3xl font-black text-slate-950">
            {statsLoading ? '...' : stats.total.toLocaleString('ar-EG')}
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            كل العملاء الموجودين في جدول العملاء.
          </div>
        </div>
        <div className="rounded-2xl border-2 border-teal-300 bg-white p-4 shadow-sm shadow-sm">
          <div className="text-sm font-black text-teal-700">عملاء لهم مشتريات في الملخص</div>
          <div className="num mt-2 text-3xl font-black text-teal-900">
            {statsLoading ? '...' : stats.summaryTotal.toLocaleString('ar-EG')}
          </div>
          <div className="mt-1 text-xs font-semibold text-teal-700/80">
            هذا الرقم مصدره customer_metrics_summary، لذلك قد يكون أقل من إجمالي المسجلين.
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
        {cards.map((card) => (
          <CustomerStatCard
            key={card.label}
            label={card.label}
            value={statsLoading ? '...' : card.value}
            tone={card.tone}
            active={segmentFilter === card.type && statusFilter === card.status}
            onClick={() => applyCardFilter(card.type, card.status)}
          />
        ))}
      </section>

      {loyaltyFilter && (
        <section className="rounded-2xl border border-teal-500/30 bg-teal-500/10 p-4 text-sm font-bold text-teal-100">
          يتم الآن عرض عملاء مستوى <span className="font-black">{loyaltyFilter}</span>
          {minPurchaseFilter ? <span> — من {formatCurrency(minPurchaseFilter)}</span> : null}
          {maxPurchaseFilter ? <span> إلى {formatCurrency(maxPurchaseFilter)}</span> : null}
          <button
            type="button"
            onClick={() => {
              setLoyaltyFilter('');
              setMinPurchaseFilter(undefined);
              setMaxPurchaseFilter(undefined);
              window.history.replaceState(null, '', '/customers');
            }}
            className="mr-3 rounded-xl border border-teal-300/40 px-3 py-1 text-xs font-black"
          >
            إلغاء فلتر الولاء
          </button>
        </section>
      )}

      <section className="dawaa-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_190px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالكود، الاسم، الهاتف... مثال: احمد* أو *ا*س*لا*م أو 010*"
              dir="rtl"
              className="dawaa-input w-full pl-12 pr-4"
            />
            {refreshing && (
              <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-teal-600" />
            )}
          </div>
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            className="dawaa-input w-full"
          >
            <option value={ALL_FILTER}>كل الفروع</option>
            {BRANCHES.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <select
            value={segmentFilter}
            onChange={(event) => setSegmentFilter(event.target.value)}
            className="dawaa-input w-full"
          >
            <option value={ALL_FILTER}>كل التصنيفات</option>
            {SEGMENT_OPTIONS.map((segment) => (
              <option key={segment} value={segment}>
                {segment}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="dawaa-input w-full"
          >
            <option value={ALL_FILTER}>كل الحالات</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </section>

      <CustomerMonthlyAnalyticsPanel data={monthlyAnalytics} loading={monthlyLoading} />

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-black">تعذر تحميل بيانات العملاء</div>
              <div className="mt-1">{error}</div>
            </div>
          </div>
        </div>
      )}

      <section className="dawaa-panel overflow-hidden p-0">
        {loading ? (
          <LoadingRows />
        ) : customers.length ? (
          <>
            <div className="customers-mobile-list p-3">
              {customers.map((customer) => (
                <CustomerResponsiveCard
                  key={customer.id}
                  customer={customer}
                  onOpen={() => setSelected(customer)}
                />
              ))}
            </div>

            <div className="customers-desktop-table overflow-x-auto">
              <table className="dawaa-table min-w-[1120px]">
                <thead>
                  <tr>
                    <th>كود العميل</th>
                    <th>اسم العميل</th>
                    <th>الهاتف</th>
                    <th>الفرع</th>
                    <th>التصنيف</th>
                    <th>الحالة</th>
                    <th>إجمالي المشتريات</th>
                    <th>متوسط شهري</th>
                    <th>متوسط الفاتورة</th>
                    <th>عدد الفواتير</th>
                    <th>أول شراء</th>
                    <th>آخر شراء</th>
                    <th>أشهر النشاط</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(customer)}
                    >
                      <td className="font-bold text-[var(--theme-muted)]">
                        {customer.customer_code || 'بدون كود'}
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-sm font-black text-teal-100">
                            {(customer.customer_name || 'ع')[0]}
                          </div>
                          <span className="font-black text-[var(--theme-heading)]">
                            {customer.customer_name || 'عميل بدون اسم'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <CustomerPhoneCell customer={customer} />
                      </td>
                      <td>{normalizeBranchName(customer.branch)}</td>
                      <td>
                        <SegmentBadge segment={customer.segment} />
                      </td>
                      <td>
                        <StatusBadge status={customer.customer_status} />
                      </td>
                      <td className="font-black text-teal-500 num">
                        {formatCurrency(customer.total_spent)}
                      </td>
                      <td className="font-bold text-[var(--theme-heading)] num">
                        {formatCurrency(customer.avg_monthly)}
                      </td>
                      <td className="num">{formatCurrency(customer.avg_invoice)}</td>
                      <td className="num">{customer.invoices_count}</td>
                      <td>
                        {customer.first_purchase ? formatDate(customer.first_purchase) : 'غير محدد'}
                      </td>
                      <td>
                        {customer.last_purchase ? formatDate(customer.last_purchase) : 'غير محدد'}
                      </td>
                      <td className="num">{customer.active_months}</td>
                      <td>
                        <button
                          type="button"
                          className="rounded-xl p-2 text-[var(--theme-muted)] hover:bg-teal-500/15 hover:text-teal-300"
                          title="عرض التفاصيل"
                        >
                          <Eye size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              onPageChange={setPage}
            />
          </>
        ) : (
          <div className="py-14 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <div className="font-black text-[var(--theme-heading)]">لا توجد نتائج مطابقة</div>
            <div className="mt-1 text-sm text-[var(--theme-muted)]">
              جرّب تغيير البحث أو الفلاتر
            </div>
          </div>
        )}
      </section>

      {selected && (
        <CustomerDetailsModal customer={selected} user={user} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function CustomerResponsiveCard({
  customer,
  onOpen,
}: {
  customer: CustomerMetric;
  onOpen: () => void;
}) {
  const displayPhone = customer.customer_phone || customer.phone || '';
  return (
    <article className="customer-responsive-card" onClick={onOpen}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-lg font-black text-teal-200">
            {(customer.customer_name || 'ع')[0]}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-black text-[var(--theme-heading)]">
              {customer.customer_name || 'عميل بدون اسم'}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-[var(--theme-muted)]">
              <span>كود: {customer.customer_code || 'بدون كود'}</span>
              <span>{normalizeBranchName(customer.branch)}</span>
              <span>{displayPhone || 'بدون رقم'}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="rounded-xl border border-teal-300/50 bg-teal-500/15 p-2 text-teal-100"
          title="عرض التفاصيل"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <Eye size={17} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SegmentBadge segment={customer.segment} />
        <StatusBadge status={customer.customer_status} />
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-1 text-xs font-black text-[var(--theme-muted)]">
          العلامات داخل التفاصيل
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <CustomerMiniStat label="إجمالي المشتريات" value={formatCurrency(customer.total_spent)} />
        <CustomerMiniStat label="متوسط شهري" value={formatCurrency(customer.avg_monthly)} />
        <CustomerMiniStat label="متوسط الفاتورة" value={formatCurrency(customer.avg_invoice)} />
        <CustomerMiniStat label="عدد الفواتير" value={String(customer.invoices_count || 0)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-[var(--theme-muted)] md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          أول شراء:{' '}
          <span className="text-[var(--theme-heading)]">
            {customer.first_purchase ? formatDate(customer.first_purchase) : 'غير محدد'}
          </span>
        </div>
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          آخر شراء:{' '}
          <span className="text-[var(--theme-heading)]">
            {customer.last_purchase ? formatDate(customer.last_purchase) : 'غير محدد'}
          </span>
        </div>
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          أشهر النشاط:{' '}
          <span className="text-[var(--theme-heading)]">{customer.active_months || 0}</span>
        </div>
      </div>
    </article>
  );
}

function CustomerMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
      <div className="text-[11px] font-bold text-[var(--theme-muted)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--theme-heading)]">{value}</div>
    </div>
  );
}

function CustomerStatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: ReactNode;
  tone: 'slate' | 'violet' | 'amber' | 'blue' | 'teal' | 'emerald' | 'red';
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    slate: 'text-slate-800 bg-white border-slate-200',
    violet: 'text-violet-700 bg-violet-50 border-violet-200',
    amber: 'text-amber-700 bg-amber-50 border-amber-200',
    blue: 'text-blue-700 bg-blue-50 border-blue-200',
    teal: 'text-teal-700 bg-teal-50 border-teal-200',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    red: 'text-red-700 bg-red-50 border-red-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[122px] rounded-2xl border p-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]} ${active ? 'ring-2 ring-teal-300' : ''}`}
    >
      <div className="num text-2xl font-black leading-none">{value}</div>
      <div className="mt-2 min-h-[42px] break-words text-xs font-black leading-5 text-current">
        {label}
      </div>
    </button>
  );
}

function numberOrZero(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function CustomerMonthlyAnalyticsPanel({
  data,
  loading,
}: {
  data: CustomerMonthlyAnalytics | null;
  loading: boolean;
}) {
  const rows = data?.rows || [];
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const latestRegistered = numberOrZero(latest?.registeredCustomers);
  const previousRegistered = numberOrZero(previous?.registeredCustomers);
  const growth =
    previousRegistered > 0
      ? Math.round(((latestRegistered - previousRegistered) / previousRegistered) * 100)
      : null;

  return (
    <section className="dawaa-panel space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">تطور العملاء شهريًا</h2>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            العملاء المتسجلين كل شهر وتطور التصنيفات، باستعلامات عد فقط بدون تحميل كل العملاء أو
            الفواتير.
          </p>
        </div>
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-black text-teal-800">
          {loading
            ? 'جاري التحليل...'
            : `آخر شهر: ${latestRegistered.toLocaleString('ar-EG')} عميل`}
          {growth !== null && !loading ? (
            <span className="ms-2 text-xs">
              ({growth >= 0 ? '+' : ''}
              {growth}%)
            </span>
          ) : null}
        </div>
      </div>

      {data?.warnings?.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          {data.warnings[0]}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 font-black text-slate-900">العملاء المتسجلين كل شهر</div>
          <div className="h-[260px]">
            {loading ? (
              <div className="h-full animate-pulse rounded-2xl bg-slate-100" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value) => [Number(value).toLocaleString('ar-EG'), 'عملاء مسجلين']}
                  />
                  <Line
                    type="monotone"
                    dataKey="registeredCustomers"
                    name="عملاء مسجلين"
                    stroke="#0f766e"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 font-black text-slate-900">تطور تصنيفات العملاء</div>
          <div className="h-[260px]">
            {loading ? (
              <div className="h-full animate-pulse rounded-2xl bg-slate-100" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value, name) => [Number(value).toLocaleString('ar-EG'), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="veryImportant" name="مهم جدًا" stackId="segments" fill="#8b5cf6" />
                  <Bar dataKey="important" name="مهم" stackId="segments" fill="#f59e0b" />
                  <Bar dataKey="medium" name="متوسط" stackId="segments" fill="#3b82f6" />
                  <Bar
                    dataKey="normal"
                    name="عادي"
                    stackId="segments"
                    fill="#64748b"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MiniCustomerTrendCard label="إجمالي المسجلين في آخر شهر" value={latestRegistered} />
        <MiniCustomerTrendCard
          label="عملاء لهم أول شراء في آخر شهر"
          value={numberOrZero(latest?.purchasedCustomers)}
        />
        <MiniCustomerTrendCard
          label="مهم ومهم جدًا في آخر شهر"
          value={numberOrZero(latest?.veryImportant) + numberOrZero(latest?.important)}
        />
      </div>

      <div className="text-xs font-semibold text-slate-500">
        المصدر: {data?.source || 'customers + customer_metrics_summary'}
      </div>
    </section>
  );
}

function MiniCustomerTrendCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4">
      <div className="num text-2xl font-black text-teal-800">{value.toLocaleString('ar-EG')}</div>
      <div className="mt-1 text-sm font-black text-slate-700">{label}</div>
    </div>
  );
}

function SegmentBadge({ segment }: { segment: string }) {
  const className =
    {
      'مهم جدًا': 'border-violet-200 bg-violet-50 text-violet-700',
      مهم: 'border-amber-200 bg-amber-50 text-amber-700',
      متوسط: 'border-blue-200 bg-blue-50 text-blue-700',
      عادي: 'border-slate-200 bg-slate-50 text-slate-600',
    }[segment] || 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>
      {segment || 'عادي'}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    {
      جديد: 'border-blue-200 bg-blue-50 text-blue-700',
      نشط: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      'مهدد بالتوقف': 'border-amber-200 bg-amber-50 text-amber-700',
      متوقف: 'border-red-200 bg-red-50 text-red-700',
      'بدون شراء': 'border-slate-200 bg-slate-50 text-slate-600',
    }[status] || 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>
      {status || 'غير محدد'}
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  totalCount,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
      <span>إجمالي النتائج: {totalCount}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary px-3 py-2"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronRight size={16} />
        </button>
        <span className="rounded-xl bg-white px-3 py-2 shadow-sm">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary px-3 py-2"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}

function CustomerDetailsModal({
  customer,
  user,
  onClose,
}: {
  customer: CustomerMetric;
  user: any;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerNotes: '',
    whatsappNotes: '',
    serviceNotes: '',
    teamNotes: '',
    handlingNotes: '',
    address: '',
    phoneAlt: '',
    whatsappPhone: '',
  });
  const [customerFlags, setCustomerFlags] = useState<Record<string, boolean>>({});
  const [reminderForm, setReminderForm] = useState({
    title: 'طلب متابعة عميل',
    note: '',
    dueDate: '',
    followupDatetime: '',
    invoiceNumber: '',
    priority: 'مهم',
    reason: 'تقدير عميل مهم',
    preferredContactMethod: 'أي طريقة',
    personalityNote: '',
    requestedBy: user?.name || user?.email || '',
  });
  const [offerForm, setOfferForm] = useState({
    title: 'عرض خاص للعميل',
    description: '',
    offerValue: '',
    endDate: '',
  });
  const [showFollowupRequest, setShowFollowupRequest] = useState(false);
  const [alertSaving, setAlertSaving] = useState(false);
  const displayPhone = bestCustomerPhone(customer, details);
  const wa = displayPhone
    ? whatsappLink(displayPhone, `السلام عليكم ${customer.customer_name || ''}`.trim())
    : null;

  useEffect(() => {
    const nextFollowup = new Date();
    nextFollowup.setDate(nextFollowup.getDate() + 1);
    nextFollowup.setHours(12, 0, 0, 0);
    const localIso = new Date(nextFollowup.getTime() - nextFollowup.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setReminderForm((current) => ({
      ...current,
      title: `طلب متابعة ${customer.customer_name || 'عميل'}`,
      dueDate: localIso.slice(0, 10),
      followupDatetime: localIso,
      priority: 'مهم',
      reason: customer.segment === 'مهم جدًا' ? 'تقدير عميل مهم' : 'عميل محتاج متابعة',
      requestedBy: user?.name || user?.email || current.requestedBy,
    }));
    setShowFollowupRequest(false);
    let active = true;
    setLoading(true);
    setError(null);
    getCustomerDetails(customer)
      .then((result) => {
        if (active) {
          setDetails(result);
          // Parse customer flags from the details
          const parsedFlags = parseCustomerFlags(result.customerFlags as any);
          setCustomerFlags(parsedFlags);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل العميل');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer]);

  useEffect(() => {
    if (!details) return;
    setForm({
      customerNotes: details.customerNotes || '',
      whatsappNotes: details.whatsappNotes || '',
      serviceNotes: details.serviceNotes || '',
      teamNotes: details.teamNotes || '',
      handlingNotes: details.handlingNotes || '',
      address: details.address || '',
      phoneAlt: details.phoneAlt || '',
      whatsappPhone: details.whatsappPhone || '',
    });
  }, [details]);

  const saveProfile = async () => {
    setSaveError(null);
    setSaveLoading(true);
    try {
      const updated = await saveCustomerProfileNotes(customer, {
        customer_notes: form.customerNotes || null,
        whatsapp_notes: form.whatsappNotes || null,
        service_notes: form.serviceNotes || null,
        team_notes: form.teamNotes || null,
        handling_notes: form.handlingNotes || null,
        address: form.address || null,
        phone_alt: form.phoneAlt || null,
        whatsapp_phone: form.whatsappPhone || null,
        flags: customerFlags,
      });

      setDetails((current) =>
        current
          ? {
              ...current,
              customerNotes: updated.customer_notes || updated.notes || form.customerNotes || null,
              whatsappNotes: updated.whatsapp_notes || null,
              serviceNotes: updated.service_notes || null,
              teamNotes: updated.team_notes || null,
              handlingNotes: updated.handling_notes || null,
              address: updated.address || null,
              phoneAlt: updated.phone_alt || null,
              whatsappPhone: updated.whatsapp_phone || null,
              customerFlags: parseCustomerFlags(updated.customer_flags as any),
            }
          : current
      );
      setEditing(false);
      toast.success('تم حفظ ملاحظات العميل');

      // Log activity
      try {
        await logActivity({
          action: 'update_customer_notes',
          module: 'customers',
          target_type: 'customer',
          target_id:
            customer.customer_code || customer.customer_id || customer.customer_phone || undefined,
          details: {
            customer_name: customer.customer_name,
            customer_code: customer.customer_code,
            changed_fields: {
              notes: !!form.customerNotes,
              whatsapp_notes: !!form.whatsappNotes,
              service_notes: !!form.serviceNotes,
              team_notes: !!form.teamNotes,
              handling_notes: !!form.handlingNotes,
              flags: Object.values(customerFlags).filter((v) => v).length,
            },
          },
          route_path: '/customers',
          user_id: user?.id,
          user_name: user?.name,
          user_role: user?.role,
        });
      } catch (logError) {
        console.warn('[CustomerDetailsModal.saveProfile] Activity log failed:', logError);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'تعذر حفظ ملاحظات العميل');
      console.error('[CustomerDetailsModal.saveProfile] Error:', err);
    } finally {
      setSaveLoading(false);
    }
  };

  useEscapeKey(onClose, true);

  const toggleFlag = (key: string) => {
    setCustomerFlags((current) => toggleCustomerFlag(current, key));
  };

  const saveManualReminder = async () => {
    if ((!reminderForm.dueDate && !reminderForm.followupDatetime) || !reminderForm.title.trim()) {
      toast.error('اكتب عنوان المتابعة وتاريخها');
      return;
    }
    setAlertSaving(true);
    try {
      await createCustomerManualFollowup(customer, {
        title: reminderForm.title.trim(),
        note: reminderForm.note.trim() || null,
        due_date: reminderForm.followupDatetime
          ? reminderForm.followupDatetime.slice(0, 10)
          : reminderForm.dueDate,
        followup_datetime: reminderForm.followupDatetime
          ? new Date(reminderForm.followupDatetime).toISOString()
          : null,
        priority: reminderForm.priority,
        source_invoice_number: reminderForm.invoiceNumber.trim() || null,
        assigned_to: customer.branch?.includes('شامي')
          ? 'د ضحى'
          : customer.branch?.includes('شكري')
            ? 'د دنيا'
            : user?.name || user?.email || null,
        responsible_name: customer.branch?.includes('شامي')
          ? 'د ضحى'
          : customer.branch?.includes('شكري')
            ? 'د دنيا'
            : user?.name || user?.email || null,
        branch: customer.branch || null,
        request_type: 'doctor_requested_followup',
        requested_by: reminderForm.requestedBy || user?.name || user?.email || null,
        preferred_contact_method: reminderForm.preferredContactMethod,
        personality_note: reminderForm.personalityNote.trim() || null,
        reason: reminderForm.reason,
        request_details: [
          `سبب المتابعة: ${reminderForm.reason}`,
          `طريقة التواصل المفضلة: ${reminderForm.preferredContactMethod}`,
          reminderForm.personalityNote.trim()
            ? `ملاحظة شخصية: ${reminderForm.personalityNote.trim()}`
            : '',
          reminderForm.note.trim() ? `ملاحظات: ${reminderForm.note.trim()}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        created_by: user?.id || null,
        created_by_name: reminderForm.requestedBy || user?.name || user?.email || null,
      });
      const refreshed = await getCustomerDetails(customer);
      setDetails(refreshed);
      setShowFollowupRequest(false);
      setReminderForm({
        title: 'طلب متابعة عميل',
        note: '',
        dueDate: '',
        followupDatetime: '',
        invoiceNumber: '',
        priority: 'مهم',
        reason: 'تقدير عميل مهم',
        preferredContactMethod: 'أي طريقة',
        personalityNote: '',
        requestedBy: user?.name || user?.email || '',
      });
      toast.success('تم إرسال طلب المتابعة لخدمة العملاء');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ التنبيه');
    } finally {
      setAlertSaving(false);
    }
  };

  const savePersonalOffer = async () => {
    if (!offerForm.title.trim()) {
      toast.error('اكتب عنوان العرض');
      return;
    }
    setAlertSaving(true);
    try {
      await createCustomerPersonalOffer(customer, {
        title: offerForm.title.trim(),
        description: offerForm.description.trim() || null,
        offer_value: offerForm.offerValue.trim() || null,
        end_date: offerForm.endDate || null,
        created_by: user?.id || null,
        created_by_name: user?.name || user?.email || null,
      });
      const refreshed = await getCustomerDetails(customer);
      setDetails(refreshed);
      setOfferForm({ title: 'عرض خاص للعميل', description: '', offerValue: '', endDate: '' });
      toast.success('تم حفظ العرض الخاص للعميل');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ العرض');
    } finally {
      setAlertSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-6xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <div className="text-2xl font-black text-slate-950">
              {customer.customer_name || 'عميل بدون اسم'}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
              <Phone size={14} />
              <span>{displayPhone || 'بدون رقم'}</span>
              {!displayPhone ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">
                  رقم غير صالح
                </span>
              ) : null}
              <span>كود {customer.customer_code || 'بدون كود'}</span>
              <span>{normalizeBranchName(customer.branch)}</span>
              {details?.isPseudoCustomer ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">
                  عميل غير موثوق
                </span>
              ) : null}
              {details?.purchaseFrequencyStatus ? (
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-black text-teal-700">
                  {details.purchaseFrequencyStatus}
                </span>
              ) : null}
            </div>
          </div>
          <div className="dawaa-action-stack flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const p = new URLSearchParams();
                if (customer.customer_code) p.set('code', customer.customer_code);
                if (customer.customer_id) p.set('id', customer.customer_id);
                if (customer.customer_phone || customer.phone)
                  p.set('phone', customer.customer_phone || customer.phone || '');
                if (customer.customer_name || customer.name)
                  p.set('name', customer.customer_name || customer.name || '');
                onClose();
                navigate(`/customer-360?${p.toString()}`);
              }}
              className="btn-secondary inline-flex items-center gap-2 border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100"
              title="فتح الملف الشامل 360° للعميل"
            >
              <ExternalLink size={16} /> ملف 360°
            </button>
            <button
              type="button"
              onClick={() => setShowFollowupRequest((current) => !current)}
              className="btn-secondary inline-flex items-center gap-2 border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
              title="إرسال طلب متابعة لهذا العميل إلى صفحة خدمة العملاء"
            >
              <CalendarClock size={16} /> إضافة طلب متابعة
            </button>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex items-center gap-2"
              >
                <MessageSquare size={16} /> واتساب
              </a>
            )}
            <button type="button" onClick={onClose} className="btn-secondary">
              إغلاق
            </button>
          </div>
        </div>

        {showFollowupRequest && (
          <div
            className="mx-5 mt-5 rounded-3xl border-2 border-teal-300 bg-teal-950/5 p-4 shadow-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-base font-black text-slate-950">طلب متابعة خدمة عملاء</div>
                <div className="mt-1 text-xs font-bold text-slate-500">
                  نفس تفاصيل صفحة خدمة العملاء والمتابعات، لكن جاهزة لهذا العميل مباشرة.
                </div>
              </div>
              <div className="dawaa-action-stack flex flex-wrap gap-2">
                <span className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-black text-teal-700">
                  {customer.customer_code ? `كود ${customer.customer_code}` : 'بدون كود'}
                </span>
                <span className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-black text-teal-700">
                  {normalizeBranchName(customer.branch)}
                </span>
                <span className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-black text-teal-700">
                  المسؤول:{' '}
                  {customer.branch?.includes('شامي')
                    ? 'د ضحى'
                    : customer.branch?.includes('شكري')
                      ? 'د دنيا'
                      : 'خدمة العملاء'}
                </span>
              </div>
            </div>

            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="font-black text-slate-950">
                {customer.customer_name || 'عميل بدون اسم'}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                <span>هاتف: {displayPhone || 'بدون رقم صحيح'}</span>
                <span>التصنيف: {customer.segment}</span>
                <span>الحالة: {customer.customer_status}</span>
                <span>متوسط شهري: {formatCurrency(customer.avg_monthly)}</span>
              </div>
              <div className="dawaa-action-stack mt-2 flex flex-wrap gap-2">
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    واتساب مباشر
                  </a>
                ) : null}
                {displayPhone ? (
                  <a href={`tel:${displayPhone}`} className="btn-secondary px-3 py-2 text-xs">
                    اتصال مباشر
                  </a>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <label className="text-xs font-black text-slate-600">عنوان الطلب</label>
                <input
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.title}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, title: event.target.value })
                  }
                  placeholder="مثال: متابعة عميل مهم بخصوص انخفاض الشراء"
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">الطبيب/الموظف الطالب</label>
                <input
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.requestedBy}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, requestedBy: event.target.value })
                  }
                  placeholder="اسم الطالب"
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">الأولوية</label>
                <select
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.priority}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, priority: event.target.value })
                  }
                >
                  <option value="عادي">عادي</option>
                  <option value="مهم">مهم</option>
                  <option value="عاجل">عاجل</option>
                  <option value="مهم جدًا">مهم جدًا</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">سبب المتابعة</label>
                <select
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.reason}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, reason: event.target.value })
                  }
                >
                  {[
                    'تقدير عميل مهم',
                    'عميل محتاج متابعة',
                    'شكوى',
                    'صنف ناقص',
                    'طلب خاص',
                    'استكمال بيانات',
                    'متابعة بعد زيارة الفرع',
                    'أخرى',
                  ].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">طريقة التواصل المفضلة</label>
                <select
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.preferredContactMethod}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, preferredContactMethod: event.target.value })
                  }
                >
                  {['واتساب', 'اتصال', 'أي طريقة'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">موعد المتابعة</label>
                <input
                  type="datetime-local"
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.followupDatetime}
                  onChange={(event) =>
                    setReminderForm({
                      ...reminderForm,
                      followupDatetime: event.target.value,
                      dueDate: event.target.value.slice(0, 10),
                    })
                  }
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">ملاحظة شخصية</label>
                <input
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.personalityNote}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, personalityNote: event.target.value })
                  }
                  placeholder="حساس للسعر، لا يحب البدائل..."
                />
              </div>
              <div>
                <label className="text-xs font-black text-slate-600">رقم فاتورة إن وجد</label>
                <input
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.invoiceNumber}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, invoiceNumber: event.target.value })
                  }
                  placeholder="اختياري"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="text-xs font-black text-slate-600">ملاحظات</label>
                <textarea
                  rows={4}
                  className="dawaa-input mt-2 w-full"
                  value={reminderForm.note}
                  onChange={(event) =>
                    setReminderForm({ ...reminderForm, note: event.target.value })
                  }
                  placeholder="اكتب المطلوب بوضوح: سبب المتابعة، آخر مشكلة، العرض المناسب، طريقة التواصل المفضلة..."
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="dawaa-button-primary px-4 py-2"
                onClick={saveManualReminder}
                disabled={alertSaving}
              >
                {alertSaving ? 'جاري الإرسال...' : 'إرسال طلب المتابعة'}
              </button>
              <button
                type="button"
                className="btn-secondary px-4 py-2"
                onClick={() => setShowFollowupRequest(false)}
                disabled={alertSaving}
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="إجمالي المشتريات" value={formatCurrency(customer.total_spent)} />
          <Metric label="متوسط شهري" value={formatCurrency(customer.avg_monthly)} />
          <Metric label="متوسط الفاتورة" value={formatCurrency(customer.avg_invoice)} />
          <Metric label="عدد الفواتير" value={String(customer.invoices_count)} />
          <Metric
            label="أول شراء"
            value={customer.first_purchase ? formatDate(customer.first_purchase) : 'غير محدد'}
          />
          <Metric
            label="آخر شراء"
            value={customer.last_purchase ? formatDate(customer.last_purchase) : 'غير محدد'}
          />
          <Metric label="أشهر النشاط" value={String(customer.active_months)} />
          <Metric
            label="التصنيف والحالة"
            value={`${customer.segment} · ${customer.customer_status}`}
          />
        </div>

        {details?.purchaseAnalysis && (
          <div className="mx-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-black text-slate-950">تحليل تكرار الشراء</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="عدد مرات الشراء الشهر الحالي"
                value={String(details.purchaseAnalysis.purchaseCountCurrentMonth)}
              />
              <Metric
                label="عدد مرات الشراء الشهر السابق"
                value={String(details.purchaseAnalysis.purchaseCountPreviousMonth)}
              />
              <Metric
                label="متوسط مرات الشراء شهريًا"
                value={String(details.purchaseAnalysis.averageMonthlyPurchaseCount)}
              />
              <Metric
                label="حالة التكرار"
                value={details.purchaseAnalysis.purchaseFrequencyStatus}
              />
            </div>
            <div className="mt-3 rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold leading-6 text-teal-800">
              التوصية: {details.purchaseAnalysis.recommendation}
            </div>
          </div>
        )}

        {details && (
          <div className="mx-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 font-black text-slate-950">علامات وملاحظات العميل</div>
                <div className="text-xs text-slate-500">
                  علامات مهمة وملاحظات يدوية للتعامل مع العميل.
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary px-3 py-2"
                onClick={() => setEditing((current) => !current)}
              >
                {editing ? 'إلغاء' : 'تعديل'}
              </button>
            </div>

            {/* Subsection A: علامات مهمة */}
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-3 text-xs font-bold text-slate-500">علامات مهمة</div>
              {editing ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {CUSTOMER_FLAGS.map((flag) => (
                    <button
                      key={flag.key}
                      type="button"
                      onClick={() => toggleFlag(flag.key)}
                      className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                        customerFlags[flag.key]
                          ? getFlagBadgeStyle(flag)
                          : getInactiveFlagButtonStyle()
                      }`}
                    >
                      {flag.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="dawaa-action-stack flex flex-wrap gap-2">
                  {sortFlagsByPriority(getActiveCustomerFlags(customerFlags)).map((flag) => (
                    <span
                      key={flag.key}
                      className={`rounded-full border px-3 py-1 text-xs font-black ${getFlagBadgeStyle(flag)}`}
                    >
                      {flag.label}
                    </span>
                  ))}
                  {Object.values(customerFlags).filter((v) => v).length === 0 && (
                    <span className="text-xs text-slate-400">لا توجد علامات مفعلة</span>
                  )}
                </div>
              )}
            </div>

            {/* Subsection B: الملاحظات اليدوية */}
            <div className="mt-3 rounded-2xl border-2 border-teal-300 bg-white p-4 shadow-sm ring-1 ring-teal-100">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs font-black text-teal-800">الملاحظات اليدوية الثابتة</div>
                <span className="rounded-full border border-teal-200 bg-white px-2 py-1 text-[11px] font-black text-teal-700">
                  محفوظة على ملف العميل
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="text-xs font-bold text-slate-500">ملاحظات عامة</div>
                  {editing ? (
                    <textarea
                      rows={3}
                      value={form.customerNotes}
                      onChange={(e) => setForm({ ...form, customerNotes: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 whitespace-pre-line text-slate-700">
                      {details.customerNotes || 'لا توجد ملاحظات'}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">ملاحظات واتساب</div>
                  {editing ? (
                    <textarea
                      rows={3}
                      value={form.whatsappNotes}
                      onChange={(e) => setForm({ ...form, whatsappNotes: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 whitespace-pre-line text-slate-700">
                      {details.whatsappNotes || 'لا توجد'}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">ملاحظات خدمة العملاء</div>
                  {editing ? (
                    <textarea
                      rows={2}
                      value={form.serviceNotes}
                      onChange={(e) => setForm({ ...form, serviceNotes: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 whitespace-pre-line text-slate-700">
                      {details.serviceNotes || 'لا توجد'}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">ملاحظات الفريق</div>
                  {editing ? (
                    <textarea
                      rows={2}
                      value={form.teamNotes}
                      onChange={(e) => setForm({ ...form, teamNotes: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 whitespace-pre-line text-slate-700">
                      {details.teamNotes || 'لا توجد'}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">تعليمات التعامل</div>
                  {editing ? (
                    <textarea
                      rows={2}
                      value={form.handlingNotes}
                      onChange={(e) => setForm({ ...form, handlingNotes: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 whitespace-pre-line text-slate-700">
                      {details.handlingNotes || 'لا توجد'}
                    </div>
                  )}
                </div>
              </div>

              {/* Additional contact info */}
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <div>
                  <div className="text-xs font-bold text-slate-500">العنوان</div>
                  {editing ? (
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 text-slate-700">{details.address || 'غير محدد'}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">هاتف إضافي</div>
                  {editing ? (
                    <input
                      type="text"
                      value={form.phoneAlt}
                      onChange={(e) => setForm({ ...form, phoneAlt: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 text-slate-700">{details.phoneAlt || 'غير محدد'}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">واتساب إضافي</div>
                  {editing ? (
                    <input
                      type="text"
                      value={form.whatsappPhone}
                      onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })}
                      className="dawaa-input mt-2 w-full"
                    />
                  ) : (
                    <div className="mt-2 text-slate-700">{details.whatsappPhone || 'غير محدد'}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border-2 border-emerald-300 bg-white p-4 shadow-sm">
                <div className="mb-2 font-black text-emerald-900">
                  نقاط العميل / الكاش باك الربع سنوي
                </div>
                <div className="rounded-xl bg-white p-3 text-sm font-bold text-slate-700">
                  {cashbackSummaryLine(details.cashback)}
                </div>
                {details.cashback ? (
                  <div className="mt-3 grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-2">
                    <div className="rounded-xl bg-white p-2">
                      مسحوبات الدورة: {formatCurrency(details.cashback.total_spent)}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      النسبة: {details.cashback.cashback_rate}%
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      المستخدم: {formatCurrency(details.cashback.redeemed_value)}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      القادم: {details.cashback.next_calculation_date || 'غير محدد'}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      الحالة: {cashbackStatusLabel(details.cashback.status)}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      تحديث بي كونكت:{' '}
                      {details.cashback.bconnect_updated_at
                        ? formatDate(details.cashback.bconnect_updated_at)
                        : 'لم يتم'}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs font-bold text-emerald-700">
                    سيتم إنشاء دورة كاش باك تلقائيًا عند تشغيل SQL واحتساب الدورة.
                  </div>
                )}
              </div>
              <div className="rounded-2xl border-2 border-sky-300 bg-white p-4 shadow-sm">
                <div className="mb-2 font-black text-sky-900">الرسالة الترحيبية وتكويد العميل</div>
                {details.welcomeStatus ? (
                  <div className="grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-2">
                    <div className="rounded-xl bg-white p-2">
                      المسؤول: {details.welcomeStatus.assigned_to_name || 'غير محدد'}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      الحالة: {details.welcomeStatus.status}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      تم تكويده على الهاتف:{' '}
                      {details.welcomeStatus.coded_on_phone_at ? 'نعم' : 'لم يتم'}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      تم إرسال الترحيب:{' '}
                      {details.welcomeStatus.welcome_message_sent_at ? 'نعم' : 'لم يتم'}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      رد العميل: {details.welcomeStatus.customer_replied_at ? 'نعم' : 'لم يرد'}
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      ملاحظات: {details.welcomeStatus.notes || '-'}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-white p-3 text-sm font-bold text-slate-700">
                    لا توجد مهمة ترحيب مفتوحة لهذا العميل.
                  </div>
                )}
              </div>
            </div>

            {details.invoiceClassifications?.length ? (
              <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-4">
                <div className="mb-3 font-black text-purple-900">سجل تصنيف الفواتير والعميل</div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {details.invoiceClassifications.map((item, index) => (
                    <div
                      key={`${item.invoice_number}-${index}`}
                      className="rounded-xl border border-purple-100 bg-white p-3 text-xs font-bold text-slate-700"
                    >
                      <div className="text-sm font-black text-slate-900">
                        فاتورة {item.invoice_number || '-'}
                      </div>
                      <div>التصنيف: {item.category || 'غير مصنف'}</div>
                      <div>تصنيف العميل: {item.customer_segment || 'غير محدد'}</div>
                      <div>الدكتور: {item.seller_name || '-'}</div>
                      <div>{item.invoice_date ? formatDate(item.invoice_date) : 'بدون تاريخ'}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border-2 border-teal-300 bg-white p-4 shadow-sm">
              <div className="mb-3 font-black text-teal-900">تنبيهات علاجية وعروض خاصة للعميل</div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-white bg-white/80 p-3">
                  <div className="text-sm font-black text-slate-900">تنبيه متابعة يدوي</div>
                  <div className="mt-2 grid gap-2">
                    <input
                      className="dawaa-input"
                      value={reminderForm.title}
                      onChange={(e) => setReminderForm({ ...reminderForm, title: e.target.value })}
                      placeholder="مثال: علاج شهري يوم 25"
                    />
                    <input
                      className="dawaa-input"
                      type="date"
                      value={reminderForm.dueDate}
                      onChange={(e) =>
                        setReminderForm({ ...reminderForm, dueDate: e.target.value })
                      }
                    />
                    <input
                      className="dawaa-input"
                      value={reminderForm.invoiceNumber}
                      onChange={(e) =>
                        setReminderForm({ ...reminderForm, invoiceNumber: e.target.value })
                      }
                      placeholder="رقم الفاتورة المرتبط إن وجد"
                    />
                    <textarea
                      className="dawaa-input"
                      rows={2}
                      value={reminderForm.note}
                      onChange={(e) => setReminderForm({ ...reminderForm, note: e.target.value })}
                      placeholder="ملاحظة المتابعة: العلاج هيخلص يوم 10 / يتابع يوم 25..."
                    />
                    <button
                      type="button"
                      className="dawaa-button-primary px-4 py-2"
                      onClick={saveManualReminder}
                      disabled={alertSaving}
                    >
                      حفظ تنبيه المتابعة
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border border-white bg-white/80 p-3">
                  <div className="text-sm font-black text-slate-900">عرض خاص يظهر للفريق</div>
                  <div className="mt-2 grid gap-2">
                    <input
                      className="dawaa-input"
                      value={offerForm.title}
                      onChange={(e) => setOfferForm({ ...offerForm, title: e.target.value })}
                      placeholder="مثال: خصم خاص لعميل مهم"
                    />
                    <input
                      className="dawaa-input"
                      value={offerForm.offerValue}
                      onChange={(e) => setOfferForm({ ...offerForm, offerValue: e.target.value })}
                      placeholder="قيمة العرض أو تفاصيله المختصرة"
                    />
                    <input
                      className="dawaa-input"
                      type="date"
                      value={offerForm.endDate}
                      onChange={(e) => setOfferForm({ ...offerForm, endDate: e.target.value })}
                    />
                    <textarea
                      className="dawaa-input"
                      rows={2}
                      value={offerForm.description}
                      onChange={(e) => setOfferForm({ ...offerForm, description: e.target.value })}
                      placeholder="وصف العرض أو سبب ظهوره للدكتور وخدمة العملاء"
                    />
                    <button
                      type="button"
                      className="dawaa-button-primary px-4 py-2"
                      onClick={savePersonalOffer}
                      disabled={alertSaving}
                    >
                      حفظ العرض الخاص
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(details.activeAlerts || []).map((alert) => (
                  <div
                    key={`${alert.alert_type}-${alert.id}`}
                    className="rounded-xl border border-teal-300 bg-white p-3 text-sm"
                  >
                    <div className="font-black text-teal-900">
                      {alert.alert_type === 'offer' ? 'عرض خاص' : 'تنبيه متابعة'}: {alert.title}
                    </div>
                    <div className="text-slate-600">{alert.description || 'بدون تفاصيل'}</div>
                    <div className="mt-1 text-xs font-bold text-slate-500">
                      الاستحقاق: {alert.due_date || '-'}{' '}
                      {alert.end_date ? `حتى ${alert.end_date}` : ''}
                    </div>
                  </div>
                ))}
                {!(details.activeAlerts || []).length && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                    لا توجد تنبيهات أو عروض نشطة لهذا العميل.
                  </div>
                )}
              </div>
            </div>

            {details.isPseudoCustomer && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                تنبيه: هذا العميل يبدو كعميل غير مسجل أو بياناته غير مكتملة. راجع رقم الهاتف والبريد
                قبل المتابعة.
              </div>
            )}

            {saveError && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {saveError}
              </div>
            )}

            {editing && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="dawaa-button-primary px-4 py-2"
                  onClick={saveProfile}
                  disabled={saveLoading}
                >
                  {saveLoading ? 'جاري الحفظ...' : 'حفظ ملاحظات العميل'}
                </button>
                <button
                  type="button"
                  className="btn-secondary px-4 py-2"
                  onClick={() => setEditing(false)}
                  disabled={saveLoading}
                >
                  إلغاء
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mx-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div className="crm-card">
            <h3 className="mb-3 text-base font-black text-slate-950">آخر المتابعات</h3>
            {loading ? (
              <LoaderLine />
            ) : details?.followups.length ? (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {details.followups.map((followup) => (
                  <div
                    key={followup.id}
                    className="rounded-2xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={followup.status || 'متابعة'} />
                      <span className="text-xs font-bold text-slate-400">
                        {followup.created_at ? formatDate(followup.created_at) : 'غير محدد'}
                      </span>
                    </div>
                    <div className="mt-2 whitespace-pre-line text-sm text-slate-600">
                      {followup.followup_result || followup.notes || 'بدون ملاحظات'}
                    </div>
                    <div className="mt-2 text-xs font-bold text-slate-500">
                      المسؤول: {followup.responsible_name || followup.assigned_to || 'غير محدد'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="لا توجد متابعات مسجلة لهذا العميل" />
            )}
          </div>

          <div className="crm-card">
            <h3 className="mb-3 text-base font-black text-slate-950">آخر الفواتير</h3>
            {loading ? (
              <LoaderLine />
            ) : details?.invoices.length ? (
              <div className="max-h-72 overflow-auto">
                <table className="dawaa-table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>رقم الفاتورة</th>
                      <th>التاريخ</th>
                      <th>القيمة</th>
                      <th>الدكتور</th>
                      <th>الفرع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.invoices.map((invoice, index) => (
                      <tr key={`${invoice.invoice_number}-${index}`}>
                        <td>{invoice.invoice_number || '-'}</td>
                        <td>{invoice.invoice_date ? formatDate(invoice.invoice_date) : '-'}</td>
                        <td className="font-black text-teal-700">
                          {formatCurrency(invoice.amount)}
                        </td>
                        <td>{invoice.seller_name || '-'}</td>
                        <td>{invoice.branch || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="لا توجد فواتير مرتبطة بهذا العميل" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function LoaderLine() {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-teal-600" /> جاري التحميل...
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">
      {text}
    </div>
  );
}
