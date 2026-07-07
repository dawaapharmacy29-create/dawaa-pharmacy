import { useMemo, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { CommandHeader } from '@/components/command/CommandUI';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { formatCycleDate, getCurrentCycle, getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import { canViewAllBranches, getScopedBranch } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';

type ReportType =
  | 'customer_stopped'
  | 'staff_payroll'
  | 'daily_sales'
  | 'shortages_summary'
  | 'top_customers'
  | 'reviews_summary'
  | 'whatsapp_performance'
  | 'doctor_performance'
  | 'stagnant_list'
  | 'points_incentives'
  | 'monthly_comprehensive';

const ALL_BRANCHES = 'كل الفروع';

const REPORTS: { type: ReportType; label: string; icon: string; desc: string }[] = [
  { type: 'customer_stopped', label: 'العملاء المتوقفين', icon: '👥', desc: 'عملاء لم يشتروا منذ فترة طويلة' },
  { type: 'staff_payroll', label: 'الرواتب والحوافز', icon: '💰', desc: 'رواتب + بونص + خصومات لكل موظف' },
  { type: 'daily_sales', label: 'المبيعات اليومي', icon: '📊', desc: 'مبيعات يومية حسب الفرع' },
  { type: 'shortages_summary', label: 'النواقص', icon: '📦', desc: 'أدوية ناقصة حسب الفرع' },
  { type: 'top_customers', label: 'أفضل العملاء', icon: '⭐', desc: 'أعلى العملاء مبيعاً' },
  { type: 'reviews_summary', label: 'تقييمات المحادثات', icon: '💬', desc: 'ملخص تقييمات المحادثات' },
  { type: 'whatsapp_performance', label: 'أداء الواتساب', icon: '📱', desc: 'جودة المحادثات والمبيعات المرتبطة' },
  { type: 'doctor_performance', label: 'أداء الدكاترة', icon: '🩺', desc: 'مبيعات ومتوسط فاتورة لكل دكتور' },
  { type: 'stagnant_list', label: 'الرواكد واللستة', icon: '🧪', desc: 'ملخص الرواكد واللستة' },
  { type: 'points_incentives', label: 'الحوافز والنقاط', icon: '🏆', desc: 'حركة النقاط والحوافز' },
  { type: 'monthly_comprehensive', label: 'تقرير شهري شامل', icon: '📋', desc: 'ملخص شامل للدورة الحالية' },
];

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function formatReportFileName(type: ReportType, branch: string, start: string, end: string) {
  const labelMap: Record<ReportType, string> = {
    customer_stopped: 'تقرير_العملاء_المتوقفين',
    staff_payroll: 'تقرير_الرواتب_والحوافز',
    daily_sales: 'تقرير_المبيعات_اليومي',
    shortages_summary: 'تقرير_النواقص',
    top_customers: 'تقرير_أفضل_العملاء',
    reviews_summary: 'تقرير_تقييمات_المحادثات',
    whatsapp_performance: 'تقرير_أداء_الواتساب',
    doctor_performance: 'تقرير_أداء_الدكاترة',
    stagnant_list: 'تقرير_الرواكد_واللستة',
    points_incentives: 'تقرير_الحوافز_والنقاط',
    monthly_comprehensive: 'تقرير_شهري_شامل',
  };
  const branchPart =
    branch === ALL_BRANCHES ? 'كل_الفروع' : safeFilePart(normalizeBranchName(branch) || branch);
  if (start && end && start !== end) {
    return `${labelMap[type]}_${branchPart}_${start}_${end}.xlsx`;
  }
  return `${labelMap[type]}_${branchPart}_${end || start || new Date().toISOString().slice(0, 10)}.xlsx`;
}

function downloadXlsx(rows: Record<string, unknown>[], sheetName: string, filename: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename);
}

async function fetchReportRows(
  type: ReportType,
  branch: string,
  startDate: string,
  endDate: string,
  staffFilter: string
): Promise<Record<string, unknown>[]> {
  const scopedBranch = branch === ALL_BRANCHES ? undefined : normalizeBranchName(branch);

  if (type === 'daily_sales' || type === 'doctor_performance' || type === 'monthly_comprehensive') {
    const summary = await loadSalesAnalyticsSummary({
      startDate,
      endDate,
      branch: scopedBranch,
      doctor: staffFilter !== 'الكل' ? staffFilter : undefined,
    });
    if (type === 'daily_sales') {
      return summary.dailyTrend.map((row) => ({
        التاريخ: row.date,
        المبيعات: row.netSales,
        عدد_الفواتير: row.invoicesCount,
        متوسط_الفاتورة: row.avgInvoice,
        عملاء_فريدون: row.uniqueCustomers,
      }));
    }
    if (type === 'doctor_performance') {
      return summary.doctorRows.map((row) => ({
        الدكتور: row.doctor,
        الفرع: row.branch,
        المبيعات: row.netSales,
        عدد_الفواتير: row.invoicesCount,
        متوسط_الفاتورة: row.avgInvoice,
        عملاء_فريدون: row.uniqueCustomers,
      }));
    }
    return [
      {
        من: startDate,
        إلى: endDate,
        الفرع: branch,
        إجمالي_المبيعات: summary.kpis.netSales,
        عدد_الفواتير: summary.kpis.invoicesCount,
        متوسط_الفاتورة: summary.kpis.avgInvoice,
        عملاء_فريدون: summary.kpis.uniqueCustomers,
        أيام_نشطة: summary.kpis.activeDays,
      },
      ...summary.branchRows.map((row) => ({
        الفرع: row.branch,
        المبيعات: row.netSales,
        عدد_الفواتير: row.invoicesCount,
        متوسط_الفاتورة: row.avgInvoice,
        الحصة: row.share,
      })),
    ];
  }

  if (type === 'customer_stopped') {
    const { data, error } = await supabase
      .from('customer_metrics')
      .select('customer_name,phone,branch,last_invoice_date,total_invoices_count')
      .lt('last_invoice_date', startDate)
      .order('last_invoice_date', { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(row.branch) === scopedBranch)
      .map((row) => ({
        العميل: row.customer_name,
        الهاتف: row.phone,
        الفرع: row.branch,
        آخر_فاتورة: row.last_invoice_date,
        عدد_الفواتير: row.total_invoices_count,
      }));
  }

  if (type === 'staff_payroll') {
    const { data, error } = await supabase.from('staff_payroll_summary').select('*').limit(500);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => row as Record<string, unknown>);
  }

  if (type === 'shortages_summary') {
    const { data, error } = await supabase.from('medicine_shortages').select('*').limit(500);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => row as Record<string, unknown>);
  }

  if (type === 'top_customers') {
    const { data, error } = await supabase
      .from('customer_metrics')
      .select('customer_name,phone,branch,total_sales,total_invoices_count,last_invoice_date')
      .order('total_sales', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(row.branch) === scopedBranch)
      .map((row) => ({
        العميل: row.customer_name,
        الهاتف: row.phone,
        الفرع: row.branch,
        إجمالي_المبيعات: row.total_sales,
        عدد_الفواتير: row.total_invoices_count,
        آخر_فاتورة: row.last_invoice_date,
      }));
  }

  if (type === 'reviews_summary' || type === 'whatsapp_performance') {
    let query = supabase
      .from('conversation_sales_reviews')
      .select('*')
      .gte('review_date', startDate)
      .lte('review_date', endDate)
      .limit(3000);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data || []).filter(
      (row) => !scopedBranch || normalizeBranchName(String(row.branch || row.branch_name || '')) === scopedBranch
    );
    const grouped = new Map<string, { count: number; total: number; excellent: number; weak: number; sales: number }>();
    for (const row of rows) {
      const name = String(row.doctor_name || row.staff_name || row.employee_name || 'غير محدد');
      const score = Number(row.score || row.total_score || row.final_score || 0);
      const current = grouped.get(name) || { count: 0, total: 0, excellent: 0, weak: 0, sales: 0 };
      current.count += 1;
      current.total += Number.isFinite(score) ? score : 0;
      if (score >= 85) current.excellent += 1;
      if (score > 0 && score < 60) current.weak += 1;
      current.sales += Number(row.generated_sales || row.sales_value || 0);
      grouped.set(name, current);
    }
    return [...grouped.entries()].map(([name, stats]) => ({
      الدكتور: name,
      عدد_المراجعات: stats.count,
      متوسط_الدرجة: stats.count ? Math.round(stats.total / stats.count) : 0,
      ممتازة: stats.excellent,
      ضعيفة: stats.weak,
      مبيعات_مولدة: stats.sales,
    }));
  }

  if (type === 'stagnant_list') {
    const stagnant = await supabase.from('stagnant_medicines').select('*').limit(500);
    const incentive = await supabase.from('incentive_medicines').select('*').eq('active', true).limit(500);
    if (stagnant.error) throw new Error(stagnant.error.message);
    const stagnantRows = (stagnant.data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => ({ النوع: 'راكد', ...(row as Record<string, unknown>) }));
    const incentiveRows =
      incentive.error || !incentive.data
        ? []
        : incentive.data
            .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
            .map((row) => ({ النوع: 'لستة', ...(row as Record<string, unknown>) }));
    return [...stagnantRows, ...incentiveRows];
  }

  if (type === 'points_incentives') {
    const { data, error } = await supabase
      .from('employee_transactions')
      .select('*')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .limit(3000);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => ({
        التاريخ: String(row.created_at || '').slice(0, 10),
        الموظف: row.employee_name || row.staff_name,
        الفرع: row.branch,
        النقاط: row.points_delta ?? row.points,
        السبب: row.reason || row.description,
        المصدر: row.source || row.source_module,
        الحالة: row.status,
      }));
  }

  return [];
}

export default function ReportsCenter() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const canAllBranches = canViewAllBranches(user);
  const defaultBranch = getScopedBranch(user, ALL_BRANCHES, ALL_BRANCHES);
  const [loading, setLoading] = useState<ReportType | null>(null);
  const [branch, setBranch] = useState(canAllBranches ? ALL_BRANCHES : defaultBranch);
  const [startDate, setStartDate] = useState(formatCycleDate(cycle.start));
  const [endDate, setEndDate] = useState(formatCycleDate(cycle.end));
  const [staffFilter, setStaffFilter] = useState('الكل');
  const [useCurrentCycle, setUseCurrentCycle] = useState(true);

  const branchOptions = useMemo(() => {
    if (canAllBranches) return [ALL_BRANCHES, ...BRANCHES];
    return [defaultBranch].filter(Boolean);
  }, [canAllBranches, defaultBranch]);

  function applyCycleRange() {
    const range = getPharmacyCycleRange(new Date());
    setStartDate(range.start);
    setEndDate(range.end);
    setUseCurrentCycle(true);
  }

  async function handleGenerate(type: ReportType) {
    setLoading(type);
    try {
      const rows = await fetchReportRows(type, branch, startDate, endDate, staffFilter);
      if (!rows.length) {
        toast.error('لا توجد بيانات للفترة المحددة');
        return;
      }
      const filename = formatReportFileName(type, branch, startDate, endDate);
      downloadXlsx(rows, 'التقرير', filename);
      toast.success('تم تنزيل التقرير');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'خطأ غير معروف';
      toast.error(`تعذر إنشاء التقرير: ${reason}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <CommandHeader title="مركز التقارير" subtitle="تصدير تقارير Excel جاهزة للطباعة والمشاركة" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-300 space-y-1">
            <span>من تاريخ</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setUseCurrentCycle(false);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>إلى تاريخ</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setUseCurrentCycle(false);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>الفرع</span>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              {branchOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-300 space-y-1">
            <span>الموظف/الدكتور</span>
            <input
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              placeholder="الكل"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="button"
            onClick={applyCycleRange}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${useCurrentCycle ? 'bg-teal-600 text-white' : 'border border-slate-700 text-slate-200'}`}
          >
            الدورة 26 → 25
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <div
            key={report.type}
            className="rounded-2xl border border-slate-700 bg-slate-800/50 p-5 hover:border-teal-500/50 transition"
          >
            <div className="mb-3 flex items-start justify-between">
              <span className="text-3xl">{report.icon}</span>
              <FileText size={16} className="text-slate-500" />
            </div>
            <h3 className="font-black text-white">{report.label}</h3>
            <p className="mt-1 text-xs text-slate-400">{report.desc}</p>
            <button
              onClick={() => void handleGenerate(report.type)}
              disabled={loading === report.type}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-black text-white transition hover:bg-teal-500 disabled:opacity-50"
            >
              {loading === report.type ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> جاري الإنشاء...
                </>
              ) : (
                <>
                  <Download size={15} /> تنزيل Excel
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
