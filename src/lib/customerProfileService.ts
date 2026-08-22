import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  getBestCustomerPhone,
  isPseudoCustomer,
  isUuidLike,
  isValidEgyptPhone,
  normalizeCustomerSegment,
  normalizeCustomerStatus,
} from '@/lib/customerAnalyticsService';
import { normalizeBranchName } from '@/lib/branch';
import { getInvoiceKey } from '@/lib/dawaa2027';
import { fetchCustomerInvoiceHistory } from '@/lib/readModels/customerInvoiceHistoryReadModel';
import type {
  CustomerMetric,
  CustomerFollowupSummary,
  CustomerInvoiceSummary,
  PurchaseAnalysis,
} from '@/lib/api/customers';

type Row = Record<string, unknown>;

export type CustomerFullProfileParams = {
  customer_code?: string | null;
  customer_id?: string | null;
  final_customer_key?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  signal?: AbortSignal;
  forceRefresh?: boolean;
};

export type CustomerProfileNotes = {
  customerNotes: string | null;
  whatsappNotes: string | null;
  serviceNotes: string | null;
  teamNotes: string | null;
  handlingNotes: string | null;
  notes: string | null;
  address: string | null;
  phoneAlt: string | null;
  whatsappPhone: string | null;
};

export type MonthlyPurchaseTrendRow = {
  month: string;
  invoicesCount: number;
  netTotal: number;
  avgInvoice: number;
};

export type CustomerProfileMatchBy = 'code' | 'phone' | 'phoneTail' | 'name' | 'mixed' | 'none';

export type CustomerProfileInvoiceSource =
  | 'sales_invoices'
  | 'customer_metrics_summary'
  | 'mixed';

export type CustomerProfileDataHealth = {
  hasMetrics: boolean;
  hasCustomerRecord: boolean;
  hasValidPhone: boolean;
  isPseudoCustomer: boolean;
  invoicesLoaded: boolean;
  followupsLoaded: boolean;
  missingCustomerCode: boolean;
  matchedBy?: CustomerProfileMatchBy;
  invoicesMatchedCount?: number;
  invoiceSourceUsed?: CustomerProfileInvoiceSource;
  metricsFallbackUsed?: boolean;
  branchMostFrequent?: string | null;
  branchHighestValue?: string | null;
  branchLastPurchase?: string | null;
};

export type CustomerFullProfile = {
  profile: Row | null;
  metrics: CustomerMetric | null;
  flags: Record<string, boolean> | null;
  notes: CustomerProfileNotes;
  latestInvoices: CustomerInvoiceSummary[];
  latestFollowups: CustomerFollowupSummary[];
  monthlyPurchaseTrend: MonthlyPurchaseTrendRow[];
  purchaseAnalysis: PurchaseAnalysis | null;
  recommendations: string[];
  dataHealth: CustomerProfileDataHealth;
  errorsBySection: Record<string, string>;
  displayPhone: string | null;
};

const profileCache = new Map<string, CustomerFullProfile>();

export function normalizeCustomerCode(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw || isUuidLike(raw)) return '';
  return raw.replace(/^code:/i, '').trim();
}

export function normalizeCustomerKey(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizePhone(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase().startsWith('code:')) return '';
  return raw
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^\d]/g, '')
    .replace(/^0020/, '0')
    .replace(/^20(?=1\d{9}$)/, '0');
}

export function safeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function formatCurrencyEGP(value: unknown) {
  return `${safeNumber(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} جنيه`;
}

export function formatDateArabic(value: unknown) {
  if (!value) return 'غير محدد';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString('ar-EG');
}

function friendlyError(message: unknown) {
  const value = String(message || '').toLowerCase();
  if (value.includes('timeout')) return 'استغرق تحميل هذا الجزء وقتًا طويلًا';
  if (value.includes('does not exist') || value.includes('not found'))
    return 'مصدر هذا الجزء غير متاح';
  if (value.includes('permission denied')) return 'لا توجد صلاحية لقراءة هذا الجزء';
  return 'تعذر تحميل هذا الجزء الآن';
}

function readFirst(row: Row | null | undefined, keys: string[], fallback: unknown = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function withAbort<T>(query: T, signal?: AbortSignal): T {
  const maybe = query as any;
  if (signal && maybe && typeof maybe.abortSignal === 'function') return maybe.abortSignal(signal);
  return query;
}

function sanitizeIlikeValue(value: string) {
  return value.replace(/[,%.]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[%_]/g, '');
}

function resolveMatchParams(
  params: CustomerFullProfileParams,
  metrics?: CustomerMetric | null,
  profile?: Row | null
) {
  const code = normalizeCustomerCode(
    params.customer_code || metrics?.customer_code || profile?.customer_code
  );
  const phone = normalizePhone(
    params.customer_phone ||
      metrics?.customer_phone ||
      profile?.customer_phone ||
      profile?.phone ||
      profile?.whatsapp_phone ||
      profile?.phone_alt
  );
  const customerId = normalizeCustomerKey(
    params.customer_id || metrics?.customer_id || profile?.id
  );
  const name = sanitizeIlikeValue(
    normalizeCustomerKey(params.customer_name || metrics?.customer_name || profile?.name)
  );
  const phoneTail = phone.length >= 10 ? phone.slice(-10) : '';
  return { code, phone, phoneTail, customerId, name };
}

function cacheKey(params: CustomerFullProfileParams) {
  return (
    [
      normalizeCustomerCode(params.customer_code),
      normalizeCustomerKey(params.customer_id),
      normalizeCustomerKey(params.final_customer_key),
      normalizePhone(params.customer_phone),
      normalizeCustomerKey(params.customer_name),
    ]
      .filter(Boolean)
      .join('|') || 'unknown'
  );
}

function metricsOrClauses(params: CustomerFullProfileParams) {
  const { code, phone, phoneTail, customerId, name } = resolveMatchParams(params);
  const finalKey = normalizeCustomerKey(params.final_customer_key);
  return [
    code ? `customer_code.eq.${code}` : '',
    finalKey ? `final_customer_key.eq.${finalKey}` : '',
    customerId && isUuidLike(customerId) ? `customer_id.eq.${customerId}` : '',
    phone ? `customer_phone.eq.${phone}` : '',
    phoneTail ? `customer_phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `customer_name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function customerOrClauses(params: CustomerFullProfileParams, metrics?: CustomerMetric | null) {
  const { code, phone, phoneTail, customerId, name } = resolveMatchParams(params, metrics);
  return [
    code ? `customer_code.eq.${code}` : '',
    customerId && isUuidLike(customerId) ? `id.eq.${customerId}` : '',
    phone ? `phone.eq.${phone}` : '',
    phone ? `customer_phone.eq.${phone}` : '',
    phone ? `whatsapp_phone.eq.${phone}` : '',
    phone ? `phone_alt.eq.${phone}` : '',
    phoneTail ? `phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function activityOrClauses(
  params: CustomerFullProfileParams,
  metrics?: CustomerMetric | null,
  profile?: Row | null
) {
  const { code, phone, phoneTail, customerId, name } = resolveMatchParams(params, metrics, profile);
  return [
    customerId && isUuidLike(customerId) ? `customer_id.eq.${customerId}` : '',
    code ? `customer_code.eq.${code}` : '',
    phone ? `customer_phone.eq.${phone}` : '',
    phone ? `phone.eq.${phone}` : '',
    phoneTail ? `customer_phone.ilike.%${phoneTail}%` : '',
    phoneTail ? `phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `customer_name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function normalizeMetric(row: Row | null): CustomerMetric | null {
  if (!row) return null;
  const totalSpent = safeNumber(readFirst(row, ['total_spent'], 0));
  const avgMonthly = safeNumber(readFirst(row, ['avg_monthly'], 0));
  const firstPurchase = readFirst(row, ['first_purchase'], null) as string | null;
  const lastPurchase = readFirst(row, ['last_purchase'], null) as string | null;
  const invoicesCount = safeNumber(readFirst(row, ['invoices_count'], 0));
  const segment = normalizeCustomerSegment(
    readFirst(row, ['segment'], null),
    totalSpent,
    avgMonthly
  );
  const status =
    invoicesCount <= 0 || !lastPurchase
      ? 'بدون شراء'
      : normalizeCustomerStatus(
          readFirst(row, ['customer_status'], null),
          lastPurchase,
          firstPurchase
        );
  const finalKey = readFirst(row, ['final_customer_key'], null) as string | null;
  const customerId = readFirst(row, ['customer_id'], null) as string | null;
  const customerCode = readFirst(row, ['customer_code'], null) as string | null;
  const phone = readFirst(row, ['customer_phone'], null) as string | null;
  const name = readFirst(row, ['customer_name'], null) as string | null;
  return {
    id: String(finalKey || customerId || customerCode || phone || name || 'unknown'),
    final_customer_key: finalKey,
    customer_id: customerId,
    customer_code: customerCode,
    customer_name: name,
    customer_phone: phone,
    phone,
    name,
    branch: normalizeBranchName(readFirst(row, ['branch'], null)),
    invoices_count: invoicesCount,
    total_spent: totalSpent,
    total_purchases: totalSpent,
    avg_invoice: safeNumber(readFirst(row, ['avg_invoice'], 0)),
    first_purchase: firstPurchase,
    last_purchase: lastPurchase,
    active_months: safeNumber(readFirst(row, ['active_months'], 0)),
    avg_monthly: avgMonthly,
    segment,
    type: segment,
    customer_status: status,
    status,
    retention_status: status,
  };
}

function invoiceDate(row: Row) {
  return String(readFirst(row, ['invoice_date', 'sale_date', 'date'], '') || '').slice(0, 10);
}

function invoiceAmount(row: Row) {
  return safeNumber(readFirst(row, ['amount'], 0));
}

function invoiceBranch(row: Row) {
  return normalizeBranchName(readFirst(row, ['branch'], null));
}

function mapInvoice(row: Row): CustomerInvoiceSummary {
  return {
    invoice_number: getInvoiceKey(row) || String(readFirst(row, ['invoice_key'], '') || '') || null,
    invoice_date: invoiceDate(row) || null,
    amount: invoiceAmount(row),
    seller_name: readFirst(row, ['seller_name'], null) as string | null,
    branch: invoiceBranch(row),
  };
}

function mapFollowup(row: Row): CustomerFollowupSummary {
  return {
    id: String(readFirst(row, ['id'], crypto.randomUUID())),
    status: readFirst(row, ['followup_status', 'status', 'contact_status'], null) as string | null,
    assigned_to: readFirst(row, ['assigned_to', 'assigned_doctor'], null) as string | null,
    responsible_name: readFirst(row, ['responsible_name'], null) as string | null,
    notes: readFirst(row, ['followup_notes', 'notes'], null) as string | null,
    followup_result: readFirst(row, ['followup_result', 'contact_result'], null) as string | null,
    created_at: readFirst(row, ['created_at'], null) as string | null,
    followup_date: readFirst(row, ['followup_datetime', 'followup_date', 'date'], null) as
      | string
      | null,
    completed_at: readFirst(row, ['completed_at'], null) as string | null,
  };
}

function buildTrend(rows: Row[]): MonthlyPurchaseTrendRow[] {
  const byMonth = new Map<string, { invoicesCount: number; netTotal: number }>();
  for (const row of rows) {
    const month = invoiceDate(row).slice(0, 7);
    if (!month) continue;
    const current = byMonth.get(month) || { invoicesCount: 0, netTotal: 0 };
    current.invoicesCount += 1;
    current.netTotal += invoiceAmount(row);
    byMonth.set(month, current);
  }
  return [...byMonth.entries()]
    .map(([month, value]) => ({
      month,
      invoicesCount: value.invoicesCount,
      netTotal: value.netTotal,
      avgInvoice: value.invoicesCount ? value.netTotal / value.invoicesCount : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function buildPurchaseAnalysis(
  rows: MonthlyPurchaseTrendRow[],
  today = new Date()
): PurchaseAnalysis | null {
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const previousDate = new Date(today);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const current = byMonth.get(currentKey)?.invoicesCount || 0;
  const previous = byMonth.get(previousKey)?.invoicesCount || 0;
  const activeRows = rows.filter((row) => row.invoicesCount > 0);
  const average = activeRows.length
    ? Math.round(activeRows.reduce((sum, row) => sum + row.invoicesCount, 0) / activeRows.length)
    : 0;

  let status = 'طبيعي';
  if (current === 0 && previous >= 2) status = 'توقف عن الشراء';
  else if (previous >= 2 && current * 2 <= previous) status = 'انخفض الشراء';
  else if (current === 0 && previous === 1) status = 'يحتاج متابعة';
  else if (current === 0) status = 'بدون مشتريات هذا الشهر';

  const recommendation =
    status === 'توقف عن الشراء'
      ? 'تابع العميل فورًا لاستعادة الشراء، وراجع آخر صنف أو خدمة كان يطلبها.'
      : status === 'انخفض الشراء'
        ? 'راجع سبب انخفاض الشراء وحدد متابعة قريبة مع عرض مناسب للعميل.'
        : status === 'يحتاج متابعة'
          ? 'اتصل بالعميل لتأكيد احتياجاته وتشجيعه على الشراء القادم.'
          : 'استمر في المتابعة الهادئة مع تسجيل نتيجة واضحة لكل تواصل.';

  return {
    purchaseCountCurrentMonth: current,
    purchaseCountPreviousMonth: previous,
    averageMonthlyPurchaseCount: average,
    purchaseFrequencyStatus: status,
    recommendation,
  };
}

function buildNotes(profile: Row | null): CustomerProfileNotes {
  return {
    customerNotes: readFirst(profile, ['customer_notes'], null) as string | null,
    whatsappNotes: readFirst(profile, ['whatsapp_notes'], null) as string | null,
    serviceNotes: readFirst(profile, ['service_notes'], null) as string | null,
    teamNotes: readFirst(profile, ['team_notes'], null) as string | null,
    handlingNotes: readFirst(profile, ['handling_notes'], null) as string | null,
    notes: readFirst(profile, ['notes'], null) as string | null,
    address: readFirst(profile, ['address'], null) as string | null,
    phoneAlt: readFirst(profile, ['phone_alt'], null) as string | null,
    whatsappPhone: readFirst(profile, ['whatsapp_phone'], null) as string | null,
  };
}

function buildRecommendations(
  metric: CustomerMetric | null,
  profile: Row | null,
  displayPhone: string | null
) {
  const flags = (readFirst(profile, ['customer_flags'], null) || {}) as Record<string, boolean>;
  const items: string[] = [];
  if (!displayPhone) items.push('العميل بدون رقم صحيح، ابدأ باستكمال بيانات التواصل.');
  if (metric?.segment === 'مهم جدًا') items.push('ابدأ برسالة تقدير لأن العميل مهم جدًا.');
  if (metric?.customer_status === 'متوقف') items.push('العميل متوقف، اسأله بلطف عن سبب التوقف.');
  if (metric?.customer_status === 'مهدد بالتوقف')
    items.push('العميل مهدد بالتوقف، حدد متابعة قريبة ولا تتركه يسقط.');
  if (flags.no_delivery) items.push('لا تضف توصيل لهذا العميل.');
  if (flags.no_substitutes) items.push('لا تقترح بدائل إلا بعد موافقة العميل.');
  if (flags.price_sensitive) items.push('وضح السعر والقيمة قبل عرض الاختيارات.');
  if (flags.prefers_call) items.push('يفضل الاتصال بدل واتساب.');
  if (flags.needs_manager || flags.complains_often)
    items.push('راجع آخر شكوى أو ملاحظة قبل التواصل.');
  if (!items.length) items.push('متابعة عادية مع تسجيل نتيجة واضحة وتحديد خطوة قادمة.');
  return items.slice(0, 5);
}

function buildInvoiceMetric(
  rows: Row[],
  params: CustomerFullProfileParams,
  existing: CustomerMetric | null,
  profile: Row | null
) {
  let totalSpent = 0;
  let firstPurchase: string | null = null;
  let lastPurchase: string | null = null;
  const months = new Set<string>();
  const branchCounts = new Map<string, number>();
  const branchTotals = new Map<string, number>();
  const datedBranches: Array<{ date: string; branch: string | null }> = [];

  for (const row of rows) {
    const amount = invoiceAmount(row);
    const date = invoiceDate(row);
    const branch = invoiceBranch(row);
    totalSpent += amount;
    if (date) {
      if (!firstPurchase || date < firstPurchase) firstPurchase = date;
      if (!lastPurchase || date > lastPurchase) lastPurchase = date;
      months.add(date.slice(0, 7));
      datedBranches.push({ date, branch });
    }
    if (branch) {
      branchCounts.set(branch, (branchCounts.get(branch) || 0) + 1);
      branchTotals.set(branch, (branchTotals.get(branch) || 0) + amount);
    }
  }

  const branchMostFrequent = [...branchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const branchHighestValue = [...branchTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const branchLastPurchase = [...datedBranches].sort((a, b) => b.date.localeCompare(a.date))[0]?.branch || null;
  const activeMonths = months.size;
  const avgMonthly = activeMonths ? totalSpent / activeMonths : 0;
  const count = rows.length;
  const code = normalizeCustomerCode(params.customer_code || existing?.customer_code || profile?.customer_code);
  const phone = normalizePhone(
    params.customer_phone || existing?.customer_phone || profile?.phone || profile?.whatsapp_phone
  );
  const customerId = normalizeCustomerKey(params.customer_id || existing?.customer_id || profile?.id);
  const name = normalizeCustomerKey(params.customer_name || existing?.customer_name || profile?.name);
  const segment = normalizeCustomerSegment(existing?.segment ?? null, totalSpent, avgMonthly);
  const status = count && lastPurchase
    ? normalizeCustomerStatus(existing?.customer_status ?? null, lastPurchase, firstPurchase)
    : 'بدون شراء';

  const metric: CustomerMetric = {
    id: String(existing?.final_customer_key || customerId || code || phone || name || 'unknown'),
    final_customer_key: existing?.final_customer_key || null,
    customer_id: customerId || null,
    customer_code: code || null,
    customer_name: name || null,
    customer_phone: phone || null,
    phone: phone || null,
    name: name || null,
    branch: branchMostFrequent || existing?.branch || normalizeBranchName(profile?.branch),
    invoices_count: count,
    total_spent: totalSpent,
    total_purchases: totalSpent,
    avg_invoice: count ? totalSpent / count : 0,
    first_purchase: firstPurchase,
    last_purchase: lastPurchase,
    active_months: activeMonths,
    avg_monthly: avgMonthly,
    segment,
    type: segment,
    customer_status: status,
    status,
    retention_status: status,
  };
  return { metric, branchMostFrequent, branchHighestValue, branchLastPurchase };
}

function resolveFinalMetrics(summary: CustomerMetric | null, invoiceMetric: CustomerMetric | null) {
  if (!invoiceMetric || invoiceMetric.invoices_count === 0) {
    return {
      metrics: summary,
      metricsFallbackUsed: false,
      invoiceSourceUsed: summary ? ('customer_metrics_summary' as const) : ('sales_invoices' as const),
    };
  }
  if (!summary || (summary.invoices_count === 0 && summary.total_spent === 0)) {
    return {
      metrics: invoiceMetric,
      metricsFallbackUsed: true,
      invoiceSourceUsed: 'sales_invoices' as const,
    };
  }

  const shouldPatch =
    !summary.last_purchase ||
    invoiceMetric.invoices_count > summary.invoices_count ||
    invoiceMetric.total_spent > summary.total_spent;
  if (!shouldPatch) {
    return {
      metrics: summary,
      metricsFallbackUsed: false,
      invoiceSourceUsed: 'customer_metrics_summary' as const,
    };
  }

  const invoicesCount = Math.max(summary.invoices_count, invoiceMetric.invoices_count);
  const totalSpent = Math.max(summary.total_spent, invoiceMetric.total_spent);
  const merged: CustomerMetric = {
    ...summary,
    invoices_count: invoicesCount,
    total_spent: totalSpent,
    total_purchases: totalSpent,
    avg_invoice: invoicesCount ? totalSpent / invoicesCount : summary.avg_invoice,
    first_purchase: summary.first_purchase || invoiceMetric.first_purchase,
    last_purchase: summary.last_purchase || invoiceMetric.last_purchase,
    active_months: Math.max(summary.active_months, invoiceMetric.active_months),
    avg_monthly: Math.max(summary.avg_monthly, invoiceMetric.avg_monthly),
    branch: summary.branch || invoiceMetric.branch,
  };
  return { metrics: merged, metricsFallbackUsed: true, invoiceSourceUsed: 'mixed' as const };
}

async function safeSection<T>(
  section: string,
  task: () => Promise<T>,
  errorsBySection: Record<string, string>,
  fallback: T
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorsBySection[section] = friendlyError(message);
    if (import.meta.env.DEV) console.warn(`[customerProfileService.${section}]`, error);
    return fallback;
  }
}

function matchedBy(params: CustomerFullProfileParams, metrics: CustomerMetric | null, profile: Row | null): CustomerProfileMatchBy {
  const match = resolveMatchParams(params, metrics, profile);
  if (match.code) return 'code';
  if (match.phone) return 'phone';
  if (match.phoneTail) return 'phoneTail';
  if (match.name) return 'name';
  return 'none';
}

export async function getCustomerFullProfile(
  params: CustomerFullProfileParams
): Promise<CustomerFullProfile> {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');

  const key = cacheKey(params);
  if (!params.forceRefresh && profileCache.has(key)) return profileCache.get(key)!;

  const errorsBySection: Record<string, string> = {};
  const metricsClauses = metricsOrClauses(params);
  const metrics = await safeSection(
    'metrics',
    async () => {
      if (!metricsClauses) return null;
      const { data, error } = await withAbort(
        supabase
          .from('customer_metrics_summary')
          .select(
            'final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status'
          )
          .or(metricsClauses)
          .limit(1),
        params.signal
      );
      if (error) throw error;
      return normalizeMetric((data?.[0] ?? null) as Row | null);
    },
    errorsBySection,
    null
  );

  const profileClauses = customerOrClauses(params, metrics);
  const profile = await safeSection(
    'profile',
    async () => {
      if (!profileClauses) return null;
      const { data, error } = await withAbort(
        supabase
          .from('customers')
          .select(
            'id,customer_code,customer_phone,name,phone,whatsapp_phone,phone_alt,address,notes,customer_notes,whatsapp_notes,service_notes,team_notes,handling_notes,customer_flags,branch'
          )
          .or(profileClauses)
          .limit(1),
        params.signal
      );
      if (error) throw error;
      return (data?.[0] ?? null) as Row | null;
    },
    errorsBySection,
    null
  );

  const identity = resolveMatchParams(params, metrics, profile);
  const invoiceRows = await safeSection(
    'invoiceHistory',
    () =>
      fetchCustomerInvoiceHistory(
        {
          customerCode: identity.code || null,
          customerPhone: identity.phone || null,
          customerName: identity.name || null,
        },
        { limit: 2000, signal: params.signal }
      ),
    errorsBySection,
    [] as Row[]
  );

  const activityClauses = activityOrClauses(params, metrics, profile);
  const latestFollowups = await safeSection(
    'latestFollowups',
    async () => {
      if (!activityClauses) return [];
      const { data, error } = await withAbort(
        supabase
          .from('daily_followups')
          .select(
            'id,status,followup_status,assigned_to,assigned_doctor,responsible_name,notes,followup_notes,followup_result,contact_result,created_at,followup_date,followup_datetime,date,completed_at,contact_status'
          )
          .or(activityClauses)
          .order('created_at', { ascending: false })
          .limit(10),
        params.signal
      );
      if (error) throw error;
      return ((data ?? []) as Row[]).map(mapFollowup);
    },
    errorsBySection,
    [] as CustomerFollowupSummary[]
  );

  const invoiceBuilt = invoiceRows.length
    ? buildInvoiceMetric(invoiceRows, params, metrics, profile)
    : null;
  const resolved = resolveFinalMetrics(metrics, invoiceBuilt?.metric || null);
  const trendRows = buildTrend(invoiceRows);
  const latestInvoices = [...invoiceRows]
    .sort((a, b) => invoiceDate(b).localeCompare(invoiceDate(a)))
    .slice(0, 20)
    .map(mapInvoice);

  const displayPhone = getBestCustomerPhone(
    {
      customer_code: resolved.metrics?.customer_code || params.customer_code || null,
      customer_phone: params.customer_phone || resolved.metrics?.customer_phone || null,
      phone: params.customer_phone || null,
    },
    resolved.metrics,
    profile
      ? {
          whatsapp_phone: readFirst(profile, ['whatsapp_phone'], null) as string | null,
          phone: readFirst(profile, ['phone'], null) as string | null,
          phone_alt: readFirst(profile, ['phone_alt'], null) as string | null,
          customer_phone: readFirst(profile, ['customer_phone'], null) as string | null,
        }
      : null
  );
  const flags = (readFirst(profile, ['customer_flags'], null) || null) as Record<string, boolean> | null;

  errorsBySection.salesInvoicesDebug = `source=dawaa_customer_invoice_stats_view | matched=${invoiceRows.length} | identity=${matchedBy(params, metrics, profile)}`;
  errorsBySection.fallbackScanUsed = 'false';

  const result: CustomerFullProfile = {
    profile,
    metrics: resolved.metrics,
    flags,
    notes: buildNotes(profile),
    latestInvoices,
    latestFollowups,
    monthlyPurchaseTrend: trendRows,
    purchaseAnalysis: buildPurchaseAnalysis(trendRows),
    recommendations: buildRecommendations(resolved.metrics, profile, displayPhone),
    dataHealth: {
      hasMetrics: Boolean(resolved.metrics),
      hasCustomerRecord: Boolean(profile),
      hasValidPhone: Boolean(
        displayPhone &&
          isValidEgyptPhone(displayPhone, resolved.metrics?.customer_code || params.customer_code)
      ),
      isPseudoCustomer: isPseudoCustomer({
        customer_name:
          resolved.metrics?.customer_name || (profile?.name as string | null) || params.customer_name,
        customer_phone: displayPhone,
        phone: displayPhone,
        customer_id: resolved.metrics?.customer_id || (profile?.id as string | null),
        customer_code: resolved.metrics?.customer_code || params.customer_code,
      }),
      invoicesLoaded: invoiceRows.length > 0,
      followupsLoaded: !errorsBySection.latestFollowups,
      missingCustomerCode: !normalizeCustomerCode(
        resolved.metrics?.customer_code || params.customer_code || profile?.customer_code
      ),
      matchedBy: matchedBy(params, metrics, profile),
      invoicesMatchedCount: invoiceRows.length,
      invoiceSourceUsed: resolved.invoiceSourceUsed,
      metricsFallbackUsed: resolved.metricsFallbackUsed,
      branchMostFrequent: invoiceBuilt?.branchMostFrequent || resolved.metrics?.branch || null,
      branchHighestValue: invoiceBuilt?.branchHighestValue || null,
      branchLastPurchase: invoiceBuilt?.branchLastPurchase || null,
    },
    errorsBySection,
    displayPhone,
  };

  profileCache.set(key, result);
  return result;
}

export function clearCustomerProfileCache() {
  profileCache.clear();
}
