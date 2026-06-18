import { supabase } from '@/lib/supabase';
import { filterActiveStaffRows } from '@/lib/staffActiveFilter';
import {
  formatMoney,
  getInvoiceAmount,
  getInvoiceDoctor,
  normalizeArabicName,
  quarterlyPillars2027,
} from '@/lib/dawaa2027';
import { matchStaffInvoice, matchStaffName } from '@/lib/dawaa2027Data';
import { isApprovedPointRecord, pointRecordDelta, recordBelongsToStaff } from '@/lib/pointsLedger';
import {
  calculateQuarterlyIncentive,
  getQuarterRange,
  QUARTERLY_BASE_BONUS_EGP,
} from '@/lib/incentives/incentiveRulesEngine';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';

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

export async function loadQuarterlyIncentiveSummary(
  date = new Date()
): Promise<QuarterlyIncentiveSummary> {
  const quarter = getQuarterRange(date);
  const start = quarter.start.toISOString();
  const end = quarter.end.toISOString();
  const invoiceWarnings: string[] = [];
  const [staffRes, invoices, targetsRes, listSalesRes, stagnantRes, txRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id,name,role,branch,active,is_active,status')
      .eq('active', true)
      .limit(500),
    fetchSalesInvoicesPagedSafe({
      startDate: start.slice(0, 10),
      endDate: end.slice(0, 10),
      branch: 'كل الفروع',
      errors: invoiceWarnings,
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

  const warnings = [staffRes, targetsRes, listSalesRes, stagnantRes, txRes]
    .filter((res) => res.error)
    .map((res) => res.error?.message || 'تعذر تحميل مصدر بيانات');
  const staff = filterActiveStaffRows((staffRes.data || []) as Row[]) as Row[];
  warnings.push(...invoiceWarnings);
  const invoiceRows = (invoices || []) as Row[];
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
      const doctorInvoices = invoiceRows.filter((invoice) => matchStaffInvoice(invoice, doctor));
      const sales = doctorInvoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);
      const invoiceCount = doctorInvoices.length;
      const customerValues = new Map<string, number>();
      doctorInvoices.forEach((invoice) => {
        const customer = String(invoice.customer_name || invoice.customer_code || 'عميل غير محدد');
        customerValues.set(
          customer,
          (customerValues.get(customer) || 0) + getInvoiceAmount(invoice)
        );
      });
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
      const dataQualityInvoices = doctorInvoices.filter(
        (invoice) =>
          Boolean(invoice.customer_code || invoice.customer_name) &&
          Boolean(getInvoiceDoctor(invoice))
      ).length;
      const deductions = transactions.filter(
        (t) =>
          isApprovedPointRecord(t) && pointRecordDelta(t) < 0 && recordBelongsToStaff(t, doctor)
      );
      const topCustomer = [...customerValues.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        id: String(doctor.id || normalizeArabicName(String(doctor.name || ''))),
        name: String(doctor.name || 'غير محدد'),
        branch: String(doctor.branch || '') || null,
        sales,
        invoices: invoiceCount,
        avgInvoice: invoiceCount ? sales / invoiceCount : 0,
        customersCount: customerValues.size,
        targetQty,
        achievedQty,
        stagnantCount: stagnantRows.length,
        dataQuality: invoiceCount ? dataQualityInvoices / invoiceCount : 0,
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

      // Calculate quarterly money rewards from stagnant/list items
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
          // Check if this is a stagnant/list cash reward
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

      // Calculate quarterly money deductions
      const quarterlyMoneyDeductions = doctorTransactions
        .filter((t) => pointRecordDelta(t) < 0)
        .reduce((sum, t) => {
          const meta = (t.metadata as Record<string, unknown>) || {};
          const moneyAmount = Number(meta.money_amount || meta.money_delta || 0);
          // Check if this is a quarterly money deduction
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

      // Calculate quarterly final value: base 2000 + money rewards - money deductions
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
      'sales_invoices date-limited',
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
