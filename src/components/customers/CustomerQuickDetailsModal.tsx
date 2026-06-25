import { useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, MessageSquare, Phone, X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { supabase } from '@/lib/supabase';
import {
  getCustomerDetails,
  normalizeCustomerMetric,
  type CustomerDetails,
  type CustomerMetric,
} from '@/lib/api/customers';
import { formatCurrency } from '@/lib/utils';
import { normalizeBranchName } from '@/lib/branch';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { cashbackStatusLabel, cashbackSummaryLine } from '@/lib/api/customerLoyalty';
import { getCustomerServiceLiveMetrics } from '@/lib/customerServiceCustomerMetrics';

type Props = {
  customerId?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  branch?: string | null;
  fallbackMetric?: Partial<CustomerMetric> | Record<string, unknown> | null;
  onClose: () => void;
};

const SUMMARY_FIELDS =
  'final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status';

type LivePurchaseStats = {
  currentMonthCount: number;
  previousMonthCount: number;
  averageMonthlyCount: number;
  status: string;
  recommendation: string;
};

function startOfMonth(offset = 0) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + offset, 1).toISOString().slice(0, 10);
}

function endOfMonth(offset = 0) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + offset + 1, 0).toISOString().slice(0, 10);
}

function frequencyStatus(current: number, previous: number) {
  if (current === 0 && previous >= 2) return 'بدون مشتريات هذا الشهر';
  if (previous >= 2 && current * 2 <= previous) return 'انخفاض واضح في الشراء';
  if (current > previous && previous > 0) return 'نشاطه في تحسن';
  if (current > 0) return 'نشط';
  return 'يحتاج متابعة';
}

function frequencyRecommendation(status: string) {
  if (status === 'بدون مشتريات هذا الشهر')
    return 'يفضل التواصل مع العميل وتذكيره باحتياجاته الشهرية أو عرض خدمة تجهيز الطلب.';
  if (status === 'انخفاض واضح في الشراء')
    return 'راجع سبب انخفاض الشراء، واقترح عرضًا مناسبًا أو بديلًا متاحًا.';
  if (status === 'نشاطه في تحسن')
    return 'استثمر العلاقة مع العميل وقدّم متابعة دورية للحفاظ على التحسن.';
  if (status === 'نشط') return 'استمر في دعم العميل وسجل أي احتياج متكرر.';
  return 'تابع العميل وسجل نتيجة التواصل.';
}

async function loadLivePurchaseStats(customer: CustomerMetric): Promise<LivePurchaseStats | null> {
  const clauses = [
    customer.customer_code ? `customer_code.eq.${customer.customer_code}` : '',
    customer.customer_phone ? `customer_phone.eq.${customer.customer_phone}` : '',
    customer.customer_name ? `customer_name.eq.${customer.customer_name}` : '',
  ]
    .filter(Boolean)
    .join(',');
  if (!clauses) return null;

  const currentStart = startOfMonth(0);
  const currentEnd = endOfMonth(0);
  const previousStart = startOfMonth(-1);
  const previousEnd = endOfMonth(-1);

  const [current, previous, all] = await Promise.all([
    supabase
      .from('sales_invoices')
      .select('id', { count: 'exact', head: true })
      .or(clauses)
      .gte('invoice_date', currentStart)
      .lte('invoice_date', currentEnd),
    supabase
      .from('sales_invoices')
      .select('id', { count: 'exact', head: true })
      .or(clauses)
      .gte('invoice_date', previousStart)
      .lte('invoice_date', previousEnd),
    supabase.from('sales_invoices').select('invoice_date').or(clauses).limit(5000),
  ]);

  if (current.error || previous.error) return null;
  const currentCount = Number(current.count || 0);
  const previousCount = Number(previous.count || 0);
  const months = new Set(
    (all.data || []).map((row: any) => String(row.invoice_date || '').slice(0, 7)).filter(Boolean)
  );
  const totalRows = (all.data || []).length;
  const avg = months.size
    ? Math.round((totalRows / months.size) * 10) / 10
    : Math.round(((currentCount + previousCount) / 2) * 10) / 10;
  const status = frequencyStatus(currentCount, previousCount);
  return {
    currentMonthCount: currentCount,
    previousMonthCount: previousCount,
    averageMonthlyCount: avg,
    status,
    recommendation: frequencyRecommendation(status),
  };
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('ar-EG');
}

function safeLocalId(prefix: string) {
  try {
    return crypto.randomUUID();
  } catch {
    return `${prefix}-${Date.now()}`;
  }
}

function fallbackMetric(input: Props): CustomerMetric {
  const fallback = (input.fallbackMetric || {}) as Record<string, any>;
  return {
    id: input.customerId || input.customerCode || input.customerPhone || input.customerName || safeLocalId('customer'),
    final_customer_key: input.customerCode || input.customerPhone || null,
    customer_id: input.customerId || fallback.customer_id || null,
    customer_code: input.customerCode || null,
    customer_name: input.customerName || 'عميل بدون اسم',
    customer_phone: input.customerPhone || null,
    phone: input.customerPhone || null,
    name: input.customerName || 'عميل بدون اسم',
    branch: normalizeBranchName(input.branch),
    invoices_count: Number(fallback.invoices_count || fallback.total_invoices || 0),
    total_spent: Number(fallback.total_spent || fallback.total_purchases || 0),
    total_purchases: Number(fallback.total_purchases || fallback.total_spent || 0),
    avg_invoice: Number(fallback.avg_invoice || 0),
    first_purchase: fallback.first_purchase || null,
    last_purchase: fallback.last_purchase || null,
    active_months: Number(fallback.active_months || 0),
    avg_monthly: Number(fallback.avg_monthly || 0),
    segment: String(fallback.segment || fallback.type || 'غير محدد'),
    type: String(fallback.type || fallback.segment || 'غير محدد'),
    customer_status: String(fallback.customer_status || fallback.status || fallback.retention_status || 'غير محدد'),
    status: String(fallback.status || fallback.customer_status || 'غير محدد'),
    retention_status: String(fallback.retention_status || fallback.customer_status || 'غير محدد'),
  };
}

async function loadCustomerMetric(input: Props): Promise<CustomerMetric> {
  const clauses: string[] = [];
  if (input.customerId) clauses.push(`customer_id.eq.${input.customerId}`);
  if (input.customerCode) clauses.push(`customer_code.eq.${input.customerCode}`);
  if (input.customerPhone) clauses.push(`customer_phone.eq.${input.customerPhone}`);
  if (input.customerName) clauses.push(`customer_name.eq.${input.customerName}`);

  if (!clauses.length) return fallbackMetric(input);

  const { data, error } = await supabase
    .from('customer_metrics_summary')
    .select(SUMMARY_FIELDS)
    .or(clauses.join(','))
    .order('avg_monthly', { ascending: false, nullsFirst: false })
    .limit(1);

  if (error || !data?.length) return fallbackMetric(input);
  return normalizeCustomerMetric((data[0] || {}) as Record<string, unknown>);
}

async function enrichMetricFromInvoices(metric: CustomerMetric): Promise<CustomerMetric> {
  const live = await getCustomerServiceLiveMetrics({
    customer_id: metric.customer_id || metric.id,
    customer_code: metric.customer_code,
    customer_phone: metric.customer_phone || metric.phone,
    customer_name: metric.customer_name || metric.name,
    branch: metric.branch,
  });
  if (!live) return metric;
  const next: CustomerMetric = {
    ...metric,
    total_spent: live.total_spent > 0 ? live.total_spent : metric.total_spent,
    total_purchases: live.total_spent > 0 ? live.total_spent : metric.total_purchases,
    invoices_count: live.invoices_count > 0 ? live.invoices_count : metric.invoices_count,
    avg_invoice: live.avg_invoice > 0 ? live.avg_invoice : metric.avg_invoice,
    avg_monthly: live.avg_monthly > 0 ? live.avg_monthly : metric.avg_monthly,
    first_purchase: live.first_purchase || metric.first_purchase,
    last_purchase: live.last_purchase || metric.last_purchase,
    active_months: metric.active_months || 0,
    segment: live.segment || metric.segment,
    type: live.segment || metric.type,
    customer_status: live.customer_status || metric.customer_status,
    status: live.customer_status || metric.status,
    branch: live.branch_last_purchase || live.branch || metric.branch,
  };
  if (import.meta.env.DEV) {
    console.debug('[CustomerQuickDetailsModal] live metrics', {
      customer_code: next.customer_code,
      customer_phone: next.customer_phone || next.phone,
      customer_name: next.customer_name || next.name,
      matched_by: live.matched_by,
      invoices_matched_count: live.invoices_matched_count,
      source: live.source,
    });
  }
  return next;
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface-2)] p-3">
      <div className="text-xs font-bold text-[var(--theme-muted)]">{label}</div>
      <div className="mt-1 text-lg font-black text-[var(--theme-heading)]">{value}</div>
    </div>
  );
}

export default function CustomerQuickDetailsModal(props: Props) {
  const [customer, setCustomer] = useState<CustomerMetric | null>(null);
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<LivePurchaseStats | null>(null);

  useEscapeKey(props.onClose, true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const metric = await enrichMetricFromInvoices(await loadCustomerMetric(props));
        if (!active) return;
        setCustomer(metric);
        const [result, stats] = await Promise.all([
          getCustomerDetails(metric).catch((err) => {
            if (import.meta.env.DEV) console.warn('[CustomerQuickDetailsModal] getCustomerDetails failed', err);
            return null;
          }),
          loadLivePurchaseStats(metric).catch(() => null),
        ]);
        if (!active) return;
        setDetails(result);
        setLiveStats(stats);
        if (!result && !stats) {
          setError(null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل العميل');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [props.branch, props.customerId, props.customerCode, props.customerName, props.customerPhone, JSON.stringify(props.fallbackMetric || {})]);

  const displayPhone = useMemo(() => {
    return (
      details?.whatsappPhone ||
      details?.phoneAlt ||
      customer?.customer_phone ||
      props.customerPhone ||
      ''
    );
  }, [customer?.customer_phone, details?.phoneAlt, details?.whatsappPhone, props.customerPhone]);

  const waLink = useMemo(() => {
    if (!displayPhone) return '';
    const name = customer?.customer_name || props.customerName || 'حضرتك';
    return generateWhatsAppLink(displayPhone, `السلام عليكم أ/ ${name}`);
  }, [customer?.customer_name, displayPhone, props.customerName]);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-panel max-w-6xl" onClick={(event) => event.stopPropagation()} dir="rtl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] p-5 text-[var(--theme-text)]">
          <div>
            <div className="flex items-center gap-2 text-[var(--theme-muted)]">
              <Eye size={18} />
              <span className="text-xs font-black">تفاصيل العميل الكاملة</span>
            </div>
            <div className="mt-2 text-2xl font-black text-[var(--theme-heading)]">
              {customer?.customer_name || props.customerName || 'عميل بدون اسم'}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--theme-muted)]">
              <span className="inline-flex items-center gap-1">
                <Phone size={14} /> {displayPhone || 'بدون رقم'}
              </span>
              <span>كود {customer?.customer_code || props.customerCode || 'بدون كود'}</span>
              <span>{normalizeBranchName(customer?.branch || props.branch)}</span>
              {liveStats?.status || details?.purchaseFrequencyStatus ? (
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-black text-teal-700">
                  {liveStats?.status || details?.purchaseFrequencyStatus}
                </span>
              ) : null}
            </div>
          </div>
          <div className="dawaa-action-stack flex flex-wrap gap-2">
            {waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="btn-primary inline-flex items-center gap-2"
              >
                <MessageSquare size={16} /> واتساب
              </a>
            ) : null}
            <button
              type="button"
              onClick={props.onClose}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <X size={16} /> إغلاق
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm font-black text-[var(--theme-muted)]">
            <Loader2 className="h-5 w-5 animate-spin text-teal-600" /> جاري تحميل التفاصيل...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm font-black text-red-600">{error}</div>
        ) : customer ? (
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricBox label="إجمالي المشتريات" value={formatCurrency(customer.total_spent)} />
              <MetricBox label="متوسط شهري" value={formatCurrency(customer.avg_monthly)} />
              <MetricBox label="متوسط الفاتورة" value={formatCurrency(customer.avg_invoice)} />
              <MetricBox label="عدد الفواتير" value={String(customer.invoices_count || 0)} />
              <MetricBox label="أول شراء" value={formatDate(customer.first_purchase)} />
              <MetricBox label="آخر شراء" value={formatDate(customer.last_purchase)} />
              <MetricBox label="أشهر النشاط" value={String(customer.active_months || 0)} />
              <MetricBox
                label="التصنيف / الحالة"
                value={`${customer.segment || '-'} · ${customer.customer_status || '-'}`}
              />
            </div>

            {details?.purchaseAnalysis || liveStats ? (
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface-2)] p-4">
                <div className="mb-3 text-sm font-black text-[var(--theme-heading)]">
                  تحليل تكرار الشراء من الفواتير المباشرة
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricBox
                    label="عدد مرات الشراء الشهر الحالي"
                    value={String(
                      liveStats?.currentMonthCount ??
                        details?.purchaseAnalysis?.purchaseCountCurrentMonth ??
                        0
                    )}
                  />
                  <MetricBox
                    label="عدد مرات الشراء الشهر السابق"
                    value={String(
                      liveStats?.previousMonthCount ??
                        details?.purchaseAnalysis?.purchaseCountPreviousMonth ??
                        0
                    )}
                  />
                  <MetricBox
                    label="متوسط مرات الشراء شهريًا"
                    value={String(
                      liveStats?.averageMonthlyCount ??
                        details?.purchaseAnalysis?.averageMonthlyPurchaseCount ??
                        0
                    )}
                  />
                  <MetricBox
                    label="حالة التكرار"
                    value={
                      liveStats?.status ||
                      details?.purchaseAnalysis?.purchaseFrequencyStatus ||
                      'غير محدد'
                    }
                  />
                </div>
                <div className="mt-3 rounded-2xl bg-teal-600/10 p-3 text-sm font-black text-teal-700 dark:text-teal-100">
                  التوصية:{' '}
                  {liveStats?.recommendation ||
                    details?.purchaseAnalysis?.recommendation ||
                    details?.purchaseFrequencyRecommendation ||
                    'استمر في دعم العميل.'}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border-2 border-emerald-300/70 bg-[var(--theme-surface)] p-4 shadow-sm">
                <div className="mb-2 font-black text-emerald-900">نقاط العميل / الكاش باك</div>
                <div className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-[var(--theme-text)]">
                  {cashbackSummaryLine(details?.cashback || null)}
                </div>
                {details?.cashback ? (
                  <div className="mt-3 grid gap-2 text-xs font-bold text-[var(--theme-text)] sm:grid-cols-2">
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      إجمالي مشتريات الدورة: {formatCurrency(details.cashback.total_spent)}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      النسبة: {details.cashback.cashback_rate}%
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      المستخدم: {formatCurrency(details.cashback.redeemed_value)}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      القادم: {details.cashback.next_calculation_date || 'غير محدد'}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      الحالة: {cashbackStatusLabel(details.cashback.status)}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      تحديث بي كونكت:{' '}
                      {details.cashback.bconnect_updated_at
                        ? formatDate(details.cashback.bconnect_updated_at)
                        : 'لم يتم'}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-muted)]">
                    لا توجد دورة كاش باك محسوبة لهذا العميل حاليًا.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border-2 border-sky-300/70 bg-[var(--theme-surface)] p-4 shadow-sm">
                <div className="mb-2 font-black text-sky-900">الرسالة الترحيبية وتكويد العميل</div>
                {details?.welcomeStatus ? (
                  <div className="grid gap-2 text-xs font-bold text-[var(--theme-text)] sm:grid-cols-2">
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      المسؤول: {details.welcomeStatus.assigned_to_name || 'غير محدد'}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      الحالة: {details.welcomeStatus.status || 'غير محدد'}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      تم تكويده على الهاتف:{' '}
                      {details.welcomeStatus.coded_on_phone_at ? 'نعم' : 'لم يتم'}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      تم إرسال الترحيب:{' '}
                      {details.welcomeStatus.welcome_message_sent_at ? 'نعم' : 'لم يتم'}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      رد العميل: {details.welcomeStatus.customer_replied_at ? 'نعم' : 'لم يرد'}
                    </div>
                    <div className="rounded-xl bg-[var(--theme-surface-2)] p-2">
                      ملاحظات: {details.welcomeStatus.notes || '-'}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-text)]">
                    لا توجد مهمة ترحيب مفتوحة لهذا العميل.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 xl:col-span-2">
                <div className="mb-3 font-black text-[var(--theme-heading)]">السجل الزمني للعميل</div>
                {details?.followups?.length || details?.invoices?.length ? (
                  <div className="grid gap-2">
                    {(details?.followups || []).slice(0, 5).map((followup) => (
                      <div key={`followup-${followup.id}`} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-text)]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[var(--theme-heading)]">متابعة خدمة العملاء</span>
                          <span className="text-xs text-[var(--theme-muted)]">{formatDate(followup.followup_date || followup.created_at)}</span>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                          <span>أنشأها: {(followup as any).created_by_name || 'غير متاح'}</span>
                          <span>تواصل: {followup.responsible_name || followup.assigned_to || 'غير متاح'}</span>
                          <span>النتيجة: {followup.followup_result || followup.status || 'غير متاح'}</span>
                          <span>التأجيل: {(followup as any).postponed_until ? formatDate((followup as any).postponed_until) : 'غير متاح'}</span>
                          <span>الإغلاق: {(followup as any).closed_at ? formatDate((followup as any).closed_at) : 'غير متاح'}</span>
                          <span>المحادثة: {(followup as any).quality_rating || (followup as any).review_score || 'غير متاح'}</span>
                        </div>
                        <div className="mt-2 text-xs text-[var(--theme-muted)]">
                          الملاحظات: {followup.notes || followup.followup_result || 'غير متاح'}
                        </div>
                      </div>
                    ))}
                    {(details?.invoices || []).slice(0, 3).map((invoice, index) => (
                      <div key={`invoice-timeline-${invoice.invoice_number || index}`} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-950">
                        شراء / فاتورة {invoice.invoice_number || 'غير متاح'} · {formatDate(invoice.invoice_date)} · {formatCurrency(invoice.amount)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-muted)]">
                    لا توجد أحداث كافية لبناء timeline لهذا العميل.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4">
                <div className="mb-3 font-black text-[var(--theme-heading)]">آخر الفواتير</div>
                {details?.invoices?.length ? (
                  <div className="space-y-2">
                    {details.invoices.slice(0, 6).map((invoice, index) => (
                      <div
                        key={`${invoice.invoice_number || index}`}
                        className="grid grid-cols-[1.2fr_1fr_.8fr] gap-2 rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-text)]"
                      >
                        <div>
                          <div className="text-[var(--theme-heading)]">
                            فاتورة {invoice.invoice_number || '-'}
                          </div>
                          <div className="text-xs text-[var(--theme-muted)]">
                            {invoice.seller_name || 'بدون دكتور'}
                          </div>
                        </div>
                        <div>{formatDate(invoice.invoice_date)}</div>
                        <div className="text-left text-emerald-700">
                          {formatCurrency(invoice.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-muted)]">
                    لا توجد فواتير معروضة.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4">
                <div className="mb-3 font-black text-[var(--theme-heading)]">
                  آخر المتابعات والملاحظات
                </div>
                {details?.followups?.length ? (
                  <div className="space-y-2">
                    {details.followups.slice(0, 6).map((followup) => (
                      <div
                        key={followup.id}
                        className="rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-text)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[var(--theme-heading)]">
                            {followup.responsible_name || followup.assigned_to || 'غير محدد'}
                          </span>
                          <span className="rounded-full bg-white px-2 py-1 text-xs">
                            {followup.status || 'معلق'}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--theme-muted)]">
                          {formatDate(followup.followup_date || followup.created_at)}
                        </div>
                        <div className="mt-2 whitespace-pre-line text-sm">
                          {followup.followup_result || followup.notes || 'لا توجد ملاحظات'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--theme-surface-2)] p-3 text-sm font-bold text-[var(--theme-muted)]">
                    لا توجد متابعات معروضة.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
