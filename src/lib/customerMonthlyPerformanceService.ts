import { supabase } from '@/lib/supabase';

export type CustomerMonthlyRow = {
  customer_code: string | null;
  customer_name: string | null;
  phone: string | null;
  branch: string;
  sales_amount: number;
  invoice_count: number;
  avg_invoice: number;
  current_segment: string;
  previous_segment: string;
  previous_month_sales: number;
  sales_change_amount: number;
  sales_change_pct: number | null;
  customer_state: string;
  last_purchase_date: string | null;
  month_2_ago_sales: number;
  month_3_ago_sales: number;
  expected_to_date_sales?: number;
  projected_period_sales?: number;
  period_progress_pct?: number;
};

export type MonthlyPerformanceSummary = {
  rows: CustomerMonthlyRow[];
  newCount: number;
  reactivatedCount: number;
  lostCount: number; // مختفي هذا الشهر
  strongDeclineCount: number;
  declineCount: number;
  strongGrowthCount: number;
  growthCount: number;
  stableCount: number;
  netCustomerGrowth: number; // جديد + مستعاد - مختفي
  totalSales: number;
  previousTotalSales: number;
  revenueAtRisk: number; // فجوة المبيعات الفعلية مقابل المتوقع حتى اليوم
  needsAttention: CustomerMonthlyRow[];
  improving: CustomerMonthlyRow[];
  periodProgress: {
    isPartial: boolean;
    elapsedDays: number;
    totalDays: number;
    progressPct: number;
  };
};

const GENERIC_CUSTOMER_NAMES = ['عميل الصيدلية', 'عميل نقدي', 'عميل عابر', 'كاش', 'عميل'];
const DAY_MS = 24 * 60 * 60 * 1000;

function isGenericCustomer(name: string | null): boolean {
  if (!name) return false;
  return GENERIC_CUSTOMER_NAMES.some((g) => name.trim() === g);
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function localTodayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function periodProgress(periodStart: string, periodEnd: string) {
  const start = parseDateOnly(periodStart);
  const end = parseDateOnly(periodEnd);
  const today = localTodayDateOnly();
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);

  const isCurrentPartialPeriod = today >= start && today < end;
  const effectiveEnd = today < start ? start : today > end ? end : today;
  const elapsedDays = isCurrentPartialPeriod
    ? Math.max(1, Math.round((effectiveEnd.getTime() - start.getTime()) / DAY_MS) + 1)
    : totalDays;
  const ratio = Math.min(1, Math.max(1 / totalDays, elapsedDays / totalDays));

  return {
    isPartial: isCurrentPartialPeriod,
    elapsedDays,
    totalDays,
    ratio,
    progressPct: Math.round(ratio * 1000) / 10,
  };
}

function classifyProgressAwareRow(row: CustomerMonthlyRow, ratio: number, isPartial: boolean): CustomerMonthlyRow {
  if (!isPartial) {
    return {
      ...row,
      expected_to_date_sales: Number(row.previous_month_sales || 0),
      projected_period_sales: Number(row.sales_amount || 0),
      period_progress_pct: 100,
    };
  }

  const current = Number(row.sales_amount || 0);
  const previousFull = Number(row.previous_month_sales || 0);
  const expectedToDate = previousFull * ratio;
  const projected = ratio > 0 ? current / ratio : current;

  // الجديد والمستعاد لهما معنى مستقل عن مقارنة سرعة الإنفاق، فلا نكسر تصنيفهما.
  if (row.customer_state === 'جديد' || row.customer_state === 'مستعاد' || previousFull <= 0) {
    return {
      ...row,
      expected_to_date_sales: expectedToDate,
      projected_period_sales: projected,
      period_progress_pct: Math.round(ratio * 1000) / 10,
    };
  }

  const paceChangeAmount = current - expectedToDate;
  const paceChangePct = expectedToDate > 0 ? (paceChangeAmount / expectedToDate) * 100 : null;

  let customerState = row.customer_state;
  if (current <= 0 && previousFull > 0) {
    customerState = 'مختفي هذا الشهر';
  } else if (paceChangePct !== null) {
    if (paceChangePct <= -30) customerState = 'تراجع قوي';
    else if (paceChangePct <= -10) customerState = 'تراجع';
    else if (paceChangePct >= 30) customerState = 'نمو قوي';
    else if (paceChangePct >= 10) customerState = 'نمو';
    else customerState = 'مستقر';
  }

  return {
    ...row,
    sales_change_amount: paceChangeAmount,
    sales_change_pct: paceChangePct === null ? null : Math.round(paceChangePct * 10) / 10,
    customer_state: customerState,
    expected_to_date_sales: expectedToDate,
    projected_period_sales: projected,
    period_progress_pct: Math.round(ratio * 1000) / 10,
  };
}

export async function fetchMonthlyCustomerPerformance(
  branch: string | null,
  periodStart: string,
  periodEnd: string,
  prevPeriodStart: string,
  prevPeriodEnd: string,
  mode: 'cycle' | 'calendar' = 'cycle'
): Promise<MonthlyPerformanceSummary & { computedAt: string | null; fromCache: boolean }> {
  const cacheResult = await supabase
    .from('customer_monthly_performance_snapshots')
    .select('rows, computed_at')
    .eq('mode', mode)
    .eq('period_start', periodStart)
    .filter('branch', branch === null ? 'is' : 'eq', branch)
    .maybeSingle();

  let rows: CustomerMonthlyRow[];
  let computedAt: string | null = null;
  let fromCache = false;

  if (cacheResult.data?.rows) {
    rows = cacheResult.data.rows as CustomerMonthlyRow[];
    computedAt = cacheResult.data.computed_at;
    fromCache = true;
  } else {
    const { data, error } = await supabase.rpc('calculate_customer_monthly_performance', {
      p_branch: branch,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_prev_period_start: prevPeriodStart,
      p_prev_period_end: prevPeriodEnd,
    });
    if (error) throw new Error(error.message);
    rows = (data || []) as CustomerMonthlyRow[];
  }

  const progress = periodProgress(periodStart, periodEnd);
  // أهم تعديل: في الدورة/الشهر الجاري لا نقارن 15-20 يومًا بتوتال دورة سابقة كاملة.
  // نحول السابقة إلى "المتوقع حتى نفس اليوم" ثم نقيس سرعة العميل بالنسبة لهذا المتوقع.
  rows = rows.map((row) => classifyProgressAwareRow(row, progress.ratio, progress.isPartial));

  const count = (state: string) => rows.filter((r) => r.customer_state === state).length;
  const totalSales = rows.reduce((sum, r) => sum + (Number(r.sales_amount) || 0), 0);
  const previousTotalSales = rows.reduce(
    (sum, r) => sum + (Number(r.expected_to_date_sales ?? r.previous_month_sales) || 0),
    0
  );
  const revenueAtRisk = rows
    .filter((r) => r.customer_state === 'تراجع قوي' || r.customer_state === 'مختفي هذا الشهر')
    .reduce((sum, r) => {
      const expected = Number(r.expected_to_date_sales ?? r.previous_month_sales) || 0;
      const current = Number(r.sales_amount) || 0;
      return sum + Math.max(0, expected - current);
    }, 0);

  const importantSegments = ['مهم', 'مهم جدًا'];
  const needsAttention = rows
    .filter(
      (r) =>
        !isGenericCustomer(r.customer_name) &&
        importantSegments.includes(r.previous_segment) &&
        (r.customer_state === 'تراجع قوي' || r.customer_state === 'مختفي هذا الشهر')
    )
    .sort((a, b) => {
      const gapA = Math.max(0, Number(a.expected_to_date_sales || 0) - Number(a.sales_amount || 0));
      const gapB = Math.max(0, Number(b.expected_to_date_sales || 0) - Number(b.sales_amount || 0));
      return gapB - gapA;
    });

  const growthStates = ['نمو قوي', 'نمو', 'مستعاد'];
  const importantNow = ['مهم', 'مهم جدًا'];
  const improving = rows
    .filter(
      (r) =>
        !isGenericCustomer(r.customer_name) &&
        growthStates.includes(r.customer_state) &&
        (importantSegments.includes(r.previous_segment) || importantNow.includes(r.current_segment))
    )
    .sort((a, b) => (Number(b.sales_change_amount) || 0) - (Number(a.sales_change_amount) || 0));

  return {
    rows,
    newCount: count('جديد'),
    reactivatedCount: count('مستعاد'),
    lostCount: count('مختفي هذا الشهر'),
    strongDeclineCount: count('تراجع قوي'),
    declineCount: count('تراجع'),
    strongGrowthCount: count('نمو قوي'),
    growthCount: count('نمو'),
    stableCount: count('مستقر'),
    netCustomerGrowth: count('جديد') + count('مستعاد') - count('مختفي هذا الشهر'),
    totalSales,
    previousTotalSales,
    revenueAtRisk,
    needsAttention,
    improving,
    computedAt,
    fromCache,
    periodProgress: {
      isPartial: progress.isPartial,
      elapsedDays: progress.elapsedDays,
      totalDays: progress.totalDays,
      progressPct: progress.progressPct,
    },
  };
}
