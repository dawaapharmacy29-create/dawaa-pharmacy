import { supabase } from '@/lib/supabase';
import { filterActiveStaffRows } from '@/lib/staffActiveFilter';
import {
  formatMoney,
  normalizeArabicName,
  quarterlyPillars2027,
} from '@/lib/dawaa2027';
import { matchStaffName } from '@/lib/dawaa2027Data';
import { isApprovedPointRecord, pointRecordDelta, recordBelongsToStaff } from '@/lib/pointsLedger';
import {
  calculateQuarterlyIncentive,
  getQuarterRange,
  QUARTERLY_BASE_BONUS_EGP,
} from '@/lib/incentives/incentiveRulesEngine';

type Row = Record<string, unknown>;

export type QuarterlyStaffIncentiveRow = {
  id: string;
  name: string;
  branch: string | null;
  sales: number;
  invoices: number;
  avgInvoice: number;
  customersCount: number;
  targetQty: number;
  achievedQty: number;
  stagnantCount: number;
  dataQuality: number;
  deductionsCount: number;
  scoreSales: number;
  scoreAvg: number;
  scoreCustomers: number;
  scoreList: number;
  scoreStock: number;
  scoreQuality: number;
  score: number;
  quarterlyFinalValue: number;
  quarterlyMoneyRewards: number;
  quarterlyMoneyDeductions: number;
  topCustomer?: [string, number];
};

export type QuarterlyIncentiveSummary = {
  quarter: ReturnType<typeof getQuarterRange>;
  baseValue: number;
  pillars: typeof quarterlyPillars2027;
  rows: QuarterlyStaffIncentiveRow[];
  sourceBreakdown: string[];
  warnings: string[];
};

function sameBranch(left: unknown, right: unknown) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  return !a || !b || a === b;
}

function findSalesMetric(metrics: Row[], doctor: Row) {
  const staffId = String(doctor.id || '');
  const exact = metrics.find((metric) => String(metric.staff_id || '') === staffId);
  if (exact) return exact;
  return metrics.find(
    (metric) =>
      sameBranch(metric.branch, doctor.branch) &&
      matchStaffName(metric, doctor, ['doctor_name'])
  );
}

export async function loadQuarterlyIncentiveSummary(
  date = new Date()
): Promise<QuarterlyIncentiveSummary> {
  const quarter = getQuarterRange(date);
  const start = quarter.start.toISOString();
  const end = quarter.end.toISOString();
  const [staffRes, salesMetricsRes, targetsRes, listSalesRes, stagnantRes, txRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id,name,role,branch,active,is_active,status')
      .eq('active', true)
      .limit(500),
    supabase.rpc('get_quarterly_staff_sales_metrics_v1', {
      p_start: start.slice(0, 10),
      p_end: end.slice(0, 10),
    }),
    supabase.from('doctor_incentive_targets').select('*').limit(5000),
    supabase
      .from('doctor_incentive_sales')
      .select('*')
      .gte('created_at', start)
      .lte('created_at', end)
      .limit(5000),
    supabase
      .from('stagnant_medicine_dispenses')
      .select('*')
      .gte('created_at', start)
      .lte('created_at', end)
      .limit(5000),
    supabase
      .from('employee_transactions')
      .select('*')
      .gte('created_at', start)
      .lte('created_at', end)
      .limit(5000),
  ]);

  const warnings = [staffRes, salesMetricsRes, targetsRes, listSalesRes, stagnantRes, txRes]
    .filter((res) => res.error)
    .map((res) => res.error?.message || 'تعذر تحميل مصدر بيانات');
  const staff = filterActiveStaffRows((staffRes.data || []) as Row[]) as Row[];
  const salesMetrics = (salesMetricsRes.data || []) as Row[];
  const targets = (targetsRes.data || []) as Row[];
  const listSales = (listSalesRes.data || []) as Row[];
  const stagnantDispenses = (stagnantRes.data || []) as Row[];
  const transactions = (txRes.data || []) as Row[];

  const staffDoctors = staff.filter(
    (s) =>
      /صيدلي|صيدلاني|دكتور|doctor|pharmacist/i.test(String(s.role || '')) ||
      String(s.name || '').includes('د')
  );
  const doctors = staffDoctors.length ? staffDoctors : staff;

  const rawRows = doctors
    .map((doctor) => {
      const metric = findSalesMetric(salesMetrics, doctor);
      const sales = Number(metric?.sales || 0);
      const invoiceCount = Number(metric?.invoices || 0);
      const customersCount = Number(metric?.customers_count || 0);
      const dataQuality = Number(metric?.data_quality || 0);
      const topCustomerName = String(metric?.top_customer_name || '').trim();
      const topCustomerValue = Number(metric?.top_customer_value || 0);
      const targetRows = targets.filter(
        (target) =>
          String(target.staff_id || '') === String(doctor.id || '') ||
          matchStaffName(target, doctor, ['staff_name', 'doctor_name', 'responsible_doctor'])
      );
      const salesRows = listSales.filter(
        (sale) =>
          String(sale.staff_id || sale.doctor_id || '') === String(doctor.id || '') ||
          matchStaffName(sale, doctor, ['staff_name', 'doctor_name', 'responsible_doctor'])
      );
      const targetQty = targetRows.reduce(
        (sum, row) => sum + Number(row.target_quantity || row.quantity_target || 0),
        0
      );
      const achievedQty = salesRows.reduce(
        (sum, row) => sum + Number(row.quantity || row.qty || 0),
        0
      );
      const stagnantRows = stagnantDispenses.filter(
        (row) =>
          String(row.staff_id || row.doctor_id || '') === String(doctor.id || '') ||
          matchStaffName(row, doctor, ['staff_name', 'doctor_name', 'responsible_doctor_name'])
      );
      const deductions = transactions.filter(
        (t) =>
          isApprovedPointRecord(t) && pointRecordDelta(t) < 0 && recordBelongsToStaff(t, doctor)
      );
      const topCustomer: [string, number] | undefined =
        topCustomerName && topCustomerValue > 0 ? [topCustomerName, topCustomerValue] : undefined;
      return {
        id: String(doctor.id || normalizeArabicName(String(doctor.name || ''))),
        name: String(doctor.name || 'غير محدد'),
        branch: String(doctor.branch || '') || null,
        sales,
        invoices: invoiceCount,
        avgInvoice: invoiceCount ? sales / invoiceCount : 0,
        customersCount,
        targetQty,
        achievedQty,
        stagnantCount: stagnantRows.length,
        dataQuality,
        deductionsCount: deductions.length,
        topCustomer,
      };
    })
    .filter((row) => row.invoices || row.targetQty || row.stagnantCount);

  const maxSales = Math.max(1, ...rawRows.map((r) => r.sales));
  const maxAvg = Math.max(1, ...rawRows.map((r) => r.avgInvoice));
  const maxCustomers = Math.max(1, ...rawRows.map((r) => r.customersCount));
  const rows = rawRows
    .map((r) => {
      const listRatio = r.targetQty ? Math.min(1, r.achievedQty / r.targetQty) : 0;
      const scoreSales = Math.min(25, Math.round((r.sales / maxSales) * 25));
      const scoreAvg = Math.min(20, Math.round((r.avgInvoice / maxAvg) * 20));
      const scoreCustomers = Math.min(20, Math.round((r.customersCount / maxCustomers) * 20));
      const scoreList = Math.round(listRatio * 15);
      const scoreStock = Math.min(10, r.stagnantCount * 2);
      const scoreQuality = Math.max(
        0,
        Math.round(r.dataQuality * 10) - Math.min(5, r.deductionsCount)
      );
      const score = scoreSales + scoreAvg + scoreCustomers + scoreList + scoreStock + scoreQuality;

      const doctorTransactions = transactions.filter(
        (t) => isApprovedPointRecord(t) && recordBelongsToStaff(t, r)
      );
      const quarterlyMoneyRewards = doctorTransactions
        .filter((t) => pointRecordDelta(t) > 0)
        .reduce((sum, t) => {
          const meta = (t.metadata as Record<string, unknown>) || {};
          const moneyAmount = Number(
            meta.money_amount || meta.reward_amount || meta.total_incentive || 0
          );
          const text = [
            t.source_type,
            t.source,
            t.source_module,
            t.reason,
            t.description,
            t.title,
            t.manager_note,
            meta.source_type,
            meta.source,
            meta.source_module,
            meta.rule_code,
            meta.impact_type,
            meta.category,
          ]
            .map((v) => String(v || '').toLowerCase())
            .join(' ');
          const isStagnantOrList =
            /(stagnant|stagnant_medicine|incentive_medicine|list_item|list_items|medicine_sales|راكد|رواكد|لسته|لستة|اصناف اللسته|أصناف اللستة|صنف حافز|صرف لست)/i.test(
              text
            );
          const isExplicitMonthly =
            /(monthly_exceptional_reward|monthly_points|نقاط شهريه|نقاط شهرية)/i.test(text);
          return (
            sum +
            (isStagnantOrList && !isExplicitMonthly
              ? moneyAmount > 0
                ? moneyAmount
                : Math.abs(pointRecordDelta(t))
              : 0)
          );
        }, 0);

      const quarterlyMoneyDeductions = doctorTransactions
        .filter((t) => pointRecordDelta(t) < 0)
        .reduce((sum, t) => {
          const meta = (t.metadata as Record<string, unknown>) || {};
          const moneyAmount = Number(meta.money_amount || meta.money_delta || 0);
          const text = [
            t.source_type,
            t.source,
            t.source_module,
            t.reason,
            t.description,
            t.title,
            t.manager_note,
            meta.source_type,
            meta.source,
            meta.source_module,
            meta.rule_code,
            meta.impact_type,
            meta.category,
          ]
            .map((v) => String(v || '').toLowerCase())
            .join(' ');
          const isQuarterlyDeduction =
            /(quarterly_money_deduction|quarterly_deduction|خصم ربع سنوي)/i.test(text);
          return (
            sum +
            (isQuarterlyDeduction
              ? moneyAmount > 0
                ? moneyAmount
                : Math.abs(pointRecordDelta(t))
              : 0)
          );
        }, 0);

      const quarterlyFinalValue = Math.round(
        calculateQuarterlyIncentive({
          approvedQuarterlyRewards: quarterlyMoneyRewards,
          approvedQuarterlyDeductions: quarterlyMoneyDeductions,
          baseValue: QUARTERLY_BASE_BONUS_EGP,
        }).quarterlyFinalValue
      );

      return {
        ...r,
        scoreSales,
        scoreAvg,
        scoreCustomers,
        scoreList,
        scoreStock,
        scoreQuality,
        score,
        quarterlyFinalValue,
        quarterlyMoneyRewards,
        quarterlyMoneyDeductions,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    quarter,
    baseValue: QUARTERLY_BASE_BONUS_EGP,
    pillars: quarterlyPillars2027,
    rows,
    sourceBreakdown: [
      'staff',
      'get_quarterly_staff_sales_metrics_v1',
      'doctor_incentive_targets',
      'doctor_incentive_sales',
      'stagnant_medicine_dispenses',
      'employee_transactions',
    ],
    warnings: warnings.map((warning) => `تحذير مصدر: ${warning}`),
  };
}

export function formatQuarterlyValue(value: number) {
  return formatMoney(value);
}
