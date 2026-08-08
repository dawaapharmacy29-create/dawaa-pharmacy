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
  revenueAtRisk: number; // مبيعات آخر فترة للعملاء اللي دلوقتي متراجعين بقوة أو مختفيين
  needsAttention: CustomerMonthlyRow[]; // مهم/مهم جدًا + تراجع قوي/مختفي — الأولوية
  improving: CustomerMonthlyRow[]; // مهم/مهم جدًا (أو أي حد) بينمو أو اترقّى — عشان نشكرهم ونستثمر فيهم
};

export async function fetchMonthlyCustomerPerformance(
  branch: string | null,
  periodStart: string,
  periodEnd: string,
  prevPeriodStart: string,
  prevPeriodEnd: string
): Promise<MonthlyPerformanceSummary> {
  const { data, error } = await supabase.rpc('calculate_customer_monthly_performance', {
    p_branch: branch,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_prev_period_start: prevPeriodStart,
    p_prev_period_end: prevPeriodEnd,
  });
  if (error) throw new Error(error.message);
  const rows = (data || []) as CustomerMonthlyRow[];

  const count = (state: string) => rows.filter((r) => r.customer_state === state).length;
  const totalSales = rows.reduce((sum, r) => sum + (Number(r.sales_amount) || 0), 0);
  const previousTotalSales = rows.reduce((sum, r) => sum + (Number(r.previous_month_sales) || 0), 0);
  const revenueAtRisk = rows
    .filter((r) => r.customer_state === 'تراجع قوي' || r.customer_state === 'مختفي هذا الشهر')
    .reduce((sum, r) => sum + (Number(r.previous_month_sales) || 0), 0);

  const importantSegments = ['مهم', 'مهم جدًا'];
  const needsAttention = rows
    .filter(
      (r) =>
        importantSegments.includes(r.previous_segment) &&
        (r.customer_state === 'تراجع قوي' || r.customer_state === 'مختفي هذا الشهر')
    )
    .sort((a, b) => (Number(b.previous_month_sales) || 0) - (Number(a.previous_month_sales) || 0));

  // العملاء المتحسنين: نمو قوي/نمو/مستعاد — الأولوية لمن كان مهم أو مهم جدًا أصلًا
  // أو بقى مهم/مهم جدًا دلوقتي (ترقّى لفئة أعلى)، عشان دول أصحاب أكبر أثر مالي فعلي.
  const growthStates = ['نمو قوي', 'نمو', 'مستعاد'];
  const importantNow = ['مهم', 'مهم جدًا'];
  const improving = rows
    .filter(
      (r) =>
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
  };
}
