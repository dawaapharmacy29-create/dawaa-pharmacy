/* eslint-disable no-useless-escape */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearInvoiceCache } from '@/lib/invoiceCache';
import {
  Download,
  FileText,
  Headphones,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  TrendingUp,
  Users,
  Wallet,
  CalendarDays,
  BarChart3,
  ClipboardList,
  Clock3,
  AlertTriangle,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadDashboardCache, saveDashboardCache, clearDashboardCache } from '@/lib/dashboard/dashboardOptimizations';
/* recharts will be dynamically imported inside the component to reduce initial bundle size */
import { supabase } from '@/lib/supabase';
import { formatCycleDate, getCurrentCycle, getPreviousCycle, getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { normalizeBranchName } from '@/lib/branch';
import { useAuth } from '@/hooks/useAuth';
import { getDashboardBranchOverride, isDoctorRole, isManagerRole } from '@/lib/security/userDataScope';
import { normalizeRole } from '@/lib/core/permissionSystem';
import {
  type DailyChartMetric,
  type DailyChartRow,
} from '@/components/dashboard/DailySalesChart';
import MonthlySalesChart from '@/components/dashboard/MonthlySalesChart';
import { BranchesManagerExceptionsPanel } from '@/components/evaluations/BranchesManagerExceptionsPanel';
import { ManagerLiveIncentiveCard } from '@/components/evaluations/ManagerLiveIncentiveCard';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';
import { DAYS_AR } from '@/lib/constants';
import { isCurrentlyOnShift } from '@/lib/utils';
import { fetchCurrentShiftPresence } from '@/lib/attendance/currentShiftPresenceService';
import {
  getStaffIncentiveSummaryForCycle,
  type StaffCycleIncentive,
} from '@/lib/staffIncentiveService';
import {
  DASHBOARD_ALL_BRANCHES,
  dashboardInvoiceAmount,
  fetchDashboardSalesTruth,
  fetchMonthlySalesFromTruth,
  type DashboardSalesReconciliation,
} from '@/lib/dashboard/dashboardTruthService';
import { resolveStaffLink, getStaffNavigationTarget, staffProfilePath } from '@/lib/staff/staffIdentityResolver';
import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';
import {
  avgReview,
  getDoctorCompetitionMetrics,
  normalizeDoctorName,
  MIN_AVG_INVOICE_THRESHOLD,
  type DoctorCompetitionMetrics,
  type DoctorCompetitionScore,
} from '@/lib/doctorCompetitionMetrics';
import { loadAppDataHealthSummary, summarizeDataHealth, type DataHealthIssue } from '@/lib/dataHealth/appDataHealthService';
import { summarizeTeamTasks, type EmployeeTaskSummary } from '@/lib/employeeDailyTasks';

const ALL_BRANCHES = DASHBOARD_ALL_BRANCHES;
const COLORS = ['var(--dawaa-chart-series-1)', 'var(--dawaa-chart-series-2)', 'var(--dawaa-chart-series-3)', 'var(--dawaa-chart-series-4)', 'var(--dawaa-chart-series-5)', 'var(--dawaa-chart-series-6)'];
type SalesSummary = {
  invoices_count?: number | string | null;
  sales_total?: number | string | null;
  avg_invoice?: number | string | null;
  linked_invoices?: number | string | null;
  unregistered_customer_invoices?: number | string | null;
  linked_sales?: number | string | null;
  unregistered_customer_sales?: number | string | null;
  customer_link_rate_percent?: number | string | null;
  linked_customers?: number | string | null;
};

type DailySales = {
  sale_date?: string | null;
  branch?: string | null;
  daily_sales?: number | string | null;
  invoices_count?: number | string | null;
};

type MonthlySales = {
  month_start?: string | null;
  month_label?: string | null;
  branch?: string | null;
  sales_total?: number | string | null;
  invoices_count?: number | string | null;
  avg_invoice?: number | string | null;
};

type BranchDistribution = {
  branch?: string | null;
  sales_total?: number | string | null;
  invoices_count?: number | string | null;
  avg_invoice?: number | string | null;
  linked_customers?: number | string | null;
};

type SavedBranchTargetRow = { branch_name?: string | null; branch?: string | null; target_amount?: number | string | null };

type TargetRow = {
  branch?: string | null;
  target_amount?: number | string | null;
  sales_total?: number | string | null;
  invoices_count?: number | string | null;
  avg_invoice?: number | string | null;
  achievement_percent?: number | string | null;
  projected_sales?: number | string | null;
  projected_achievement_percent?: number | string | null;
  remaining_amount?: number | string | null;
  cash_sales?: number | string | null;
  delivery_sales?: number | string | null;
  manager_advice?: string | null;
  target_source?: 'saved' | 'default' | 'unavailable';
};

type DoctorSales = {
  doctor_name?: string | null;
  branch?: string | null;
  sales_total?: number | string | null;
  invoices_count?: number | string | null;
  avg_invoice?: number | string | null;
};

type StaffDirectoryRow = {
  id?: string | null;
  staff_id?: string | null;
  name?: string | null;
  staff_name?: string | null;
  role?: string | null;
  branch?: string | null;
  status?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
};

type ShiftScheduleRow = {
  staff_id?: string | null;
  staff_name?: string | null;
  branch?: string | null;
  day_name?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  is_off?: boolean | null;
};

type ShiftNowRow = StaffDirectoryRow & {
  shift_start?: string | null;
  shift_end?: string | null;
};

type InvoiceRow = {
  id?: string | number | null;
  invoice_no?: string | number | null;
  invoice_number?: string | number | null;
  invoice_date?: string | null;
  branch?: string | null;
  amount?: number | string | null;
  net_amount?: number | string | null;
  discounted_amount?: number | string | null;
  gross_amount?: number | string | null;
  customer_code?: string | number | null;
  customer_name?: string | null;
  seller_name?: string | null;
};

type DashboardState = {
  summary: SalesSummary | null;
  dailySales: DailySales[];
  monthlySales: MonthlySales[];
  branchDistribution: BranchDistribution[];
  targets: TargetRow[];
  doctorSales: DoctorSales[];
  staffDirectory: StaffDirectoryRow[];
  onShiftNow: ShiftNowRow[];
  incentiveSummary: StaffCycleIncentive[];
  recentInvoices: InvoiceRow[];
  salesReconciliation: DashboardSalesReconciliation | null;
  loadedAt: string | null;
  errors: string[];
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, digits = 0) {
  return n(value).toLocaleString('ar-EG', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function count(value: unknown) {
  return n(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function pct(value: unknown, digits = 1) {
  return `${n(value).toLocaleString('ar-EG', { maximumFractionDigits: digits })}%`;
}

function branchName(branch?: string | null) {
  return normalizeBranchName(branch || '') || 'غير محدد';
}

function staffName(row: StaffDirectoryRow | ShiftNowRow) {
  return String(row.name || row.staff_name || '').trim();
}

function staffId(row: StaffDirectoryRow | ShiftNowRow) {
  return String(row.id || row.staff_id || '').trim();
}

type GroupedShiftMember = ShiftNowRow & { shifts: Array<{ start: string | null; end: string | null }> };

// نفس الشخص ممكن يظهر أكتر من مرة في بيانات الشيفت الحالي (شيفت مقسّم لفترتين
// في نفس اليوم، أو مصدرين مختلفين رجّعوا نفس الموظف). بنجمعهم في كارت واحد بدل
// ما نعرض الشخص نفسه مكرر — الأولوية للـstaffId كمفتاح، والاسم بعد التطبيع
// (normalizeDoctorName بيشيل بادئات زي "د/"، "دكتور"، "الدكتور") كـfallback بس.
function groupShiftMembers(rows: ShiftNowRow[]): GroupedShiftMember[] {
  const map = new Map<string, GroupedShiftMember>();
  for (const row of rows) {
    const id = staffId(row);
    const branch = branchName(row.branch);
    const key = id ? `id:${id}|${branch}` : `name:${normalizeDoctorName(staffName(row))}|${branch}`;
    const shift = { start: row.shift_start || null, end: row.shift_end || null };
    const existing = map.get(key);
    if (existing) {
      const isDuplicate = existing.shifts.some((s) => s.start === shift.start && s.end === shift.end);
      if (!isDuplicate) existing.shifts.push(shift);
    } else {
      map.set(key, { ...row, shifts: [shift] });
    }
  }
  return [...map.values()];
}

function formatShiftRange(shift: { start: string | null; end: string | null }) {
  if (!shift.start && !shift.end) return 'غير محدد';
  return `${shift.start || '--:--'} → ${shift.end || '--:--'}`;
}

// نعزل نص وقت الشيفت في اتجاه LTR عشان السهم والأرقام ميتقلبوش بصريًا وسط
// سياق RTL — ده اللي كان بيخلي ترتيب الوقتين يبان مربك.
function ShiftTimeRange({ shift, className = '' }: { shift: { start: string | null; end: string | null }; className?: string }) {
  return (
    <span dir="ltr" className={className}>
      {formatShiftRange(shift)}
    </span>
  );
}

function staffNameMatches(memberName: unknown, targetName: unknown) {
  const member = staffLookupKey(memberName);
  const target = staffLookupKey(targetName);
  if (!member || !target) return false;
  return member === target || member.includes(target) || target.includes(member);
}

function isActiveStaff(row: StaffDirectoryRow) {
  const status = normalizeText(row.status);
  return (
    row.active !== false &&
    row.is_active !== false &&
    !status.includes('موقوف') &&
    !status.includes('inactive')
  );
}

function roleGroup(role: unknown) {
  const normalized = normalizeText(role);
  if (normalized.includes('مساعد') || normalized.includes('assistant')) return 'assistant';
  if (
    normalized.includes('توصيل') ||
    normalized.includes('دليفري') ||
    normalized.includes('delivery')
  )
    return 'delivery';
  if (
    normalized.includes('صيد') ||
    normalized.includes('دكتور') ||
    normalized.includes('doctor') ||
    normalized.includes('pharmacist')
  )
    return 'doctor';
  return 'other';
}

function safeDate(value?: string | null) {
  const raw = String(value || '').slice(0, 10);
  if (!raw) return 'غير محدد';
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
}

function dateRangeDays(start: string, end: string) {
  const days: string[] = [];
  const startDate = new Date(`${String(start || '').slice(0, 10)}T12:00:00`);
  const endDate = new Date(`${String(end || '').slice(0, 10)}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return days;
  }
  const current = new Date(startDate);
  while (current <= endDate && days.length < 45) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    days.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function shortAxisDate(value: unknown) {
  const raw = String(value || '').slice(0, 10);
  if (!raw) return '';
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw.slice(5);
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });
}

function compactChartValue(value: unknown) {
  const parsed = n(value);
  if (Math.abs(parsed) >= 1000) return `${Math.round(parsed / 1000).toLocaleString('ar-EG')}k`;
  return parsed.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function safeDateTime(value?: string | null) {
  if (!value) return 'لم يتم التحديث';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'لم يتم التحديث';
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\.\/\\()\[\]{}:_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function staffLookupKey(value: unknown) {
  return normalizeText(value)
    .replace(/^(د|دكتور|الدكتور)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function invoiceAmount(row: InvoiceRow) {
  return dashboardInvoiceAmount(row);
}

function invoiceDate(row: InvoiceRow) {
  return String(row.invoice_date || '').slice(0, 10);
}

function invoiceIdentityKey(row: InvoiceRow) {
  return String(row.invoice_no ?? row.invoice_number ?? row.id ?? '').trim();
}

function isLinkedInvoice(row: InvoiceRow) {
  const code = String(row.customer_code ?? '').trim();
  const name = normalizeText(row.customer_name);
  return Boolean(
    code &&
    !['0', 'null', 'NULL', '-'].includes(code) &&
    !name.includes('عميل غير مسجل') &&
    !name.includes('غير مسجل')
  );
}

function isDoctorName(name: unknown) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  const blocked = [
    'احمد البطل',
    'احمد وجيه',
    'محمد حافظ',
    'محمود',
    'مدحت',
    'مصطفي',
    'مصطفى',
    'يوسف عصام',
    'اسلام',
    'حسين',
    'محمد سالم',
    'محمد شماته',
    'يوسف عيد',
    'يوسف ماهر',
  ];
  if (blocked.some((item) => normalized === normalizeText(item))) return false;
  if (normalized.includes('دليفري') || normalized.includes('مندوب') || normalized.includes('توصيل'))
    return false;
  return true;
}

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') return [data as T];
  return [];
}

type SupabaseQueryResult<T> = { data: T | null; error: { message?: string } | null };

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise).then(resolve).catch(reject).finally(() => window.clearTimeout(timeoutId));
  });
}

// محاولة واحدة إضافية صامتة قبل ما نعتبر القسم فاشل فعلًا — أغلب "الأعطال" اللي
// بتظهر بين الحين والتاني مجرد بطء لحظي في الشبكة أو RPC، مش فشل حقيقي، وده بيمتصها
// بدل ما يوصل للمستخدم كرسالة خطأ من الأساس.
async function withSingleRetry<T>(run: () => Promise<T>, delayMs = 1200): Promise<T> {
  try {
    return await run();
  } catch (firstError) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    try {
      return await run();
    } catch {
      throw firstError;
    }
  }
}

async function rpcRows<T>(
  names: string[],
  params: Record<string, unknown> | undefined,
  label: string,
  errors: string[]
): Promise<T[]> {
  for (const name of names) {
    let attempts = 0;
    while (attempts < 2) {
      try {
        const { data, error } = await withTimeout<SupabaseQueryResult<unknown>>(
          supabase.rpc(name, params) as PromiseLike<SupabaseQueryResult<unknown>>,
          7000,
          `${label}:${name}`
        );
        if (error) {
          attempts += 1;
          console.error(`[RPC ERROR] ${label} -> ${name} attempt=${attempts}:`, error.message || error);
          errors.push(`${label} ${name}: ${error.message || String(error)}`);
          if (attempts < 2) await new Promise((r) => setTimeout(r, 300 * attempts));
          continue;
        }
        const rowsData = rows<T>(data);
        if (rowsData.length) return rowsData;
        break;
      } catch (err) {
        attempts += 1;
        console.error(`[RPC EXCEPTION] ${label} -> ${name} attempt=${attempts}:`, err);
        errors.push(`${label} ${name}: ${err instanceof Error ? err.message : String(err)}`);
        if (attempts < 2) await new Promise((r) => setTimeout(r, 300 * attempts));
      }
    }
  }
  return [];
}

function buildFallback(invoices: InvoiceRow[]) {
  const invoiceRows = invoices.filter((row) => invoiceAmount(row) > 0 && invoiceDate(row));
  const sales = invoiceRows.reduce((sum, row) => sum + invoiceAmount(row), 0);
  const linked = invoiceRows.filter(isLinkedInvoice);
  const invoiceKeys = new Set(invoiceRows.map(invoiceIdentityKey).filter(Boolean));
  const linkedInvoiceKeys = new Set(linked.map(invoiceIdentityKey).filter(Boolean));
  const unlinkedInvoiceKeys = new Set(
    invoiceRows
      .filter((row) => !isLinkedInvoice(row))
      .map(invoiceIdentityKey)
      .filter(Boolean)
  );
  const daysMap = new Map<string, DailySales>();
  const dayInvoiceKeys = new Map<string, Set<string>>();
  const branchMap = new Map<string, BranchDistribution>();
  const branchInvoiceKeys = new Map<string, Set<string>>();
  const doctorMap = new Map<string, DoctorSales>();
  const doctorInvoiceKeys = new Map<string, Set<string>>();
  const monthMap = new Map<string, MonthlySales>();
  const monthInvoiceKeys = new Map<string, Set<string>>();

  for (const row of invoiceRows) {
    const day = invoiceDate(row);
    const branch = branchName(row.branch);
    const amount = invoiceAmount(row);
    const key = invoiceIdentityKey(row);
    const dailyKey = `${day}__${branch}`;
    const daily = daysMap.get(dailyKey) || {
      sale_date: day,
      branch,
      daily_sales: 0,
      invoices_count: 0,
    };
    daily.daily_sales = n(daily.daily_sales) + amount;
    if (!dayInvoiceKeys.has(dailyKey)) dayInvoiceKeys.set(dailyKey, new Set());
    if (key) dayInvoiceKeys.get(dailyKey)?.add(key);
    daily.invoices_count = dayInvoiceKeys.get(dailyKey)?.size || 0;
    daysMap.set(dailyKey, daily);

    const branchRow = branchMap.get(branch) || {
      branch,
      sales_total: 0,
      invoices_count: 0,
      avg_invoice: 0,
      linked_customers: 0,
    };
    branchRow.sales_total = n(branchRow.sales_total) + amount;
    if (!branchInvoiceKeys.has(branch)) branchInvoiceKeys.set(branch, new Set());
    if (key) branchInvoiceKeys.get(branch)?.add(key);
    branchRow.invoices_count = branchInvoiceKeys.get(branch)?.size || 0;
    branchMap.set(branch, branchRow);

    const month = day.slice(0, 7);
    if (month) {
      const monthKey = `${month}__${branch}`;
      const monthRow = monthMap.get(monthKey) || {
        month_start: `${month}-01`,
        month_label: month,
        branch,
        sales_total: 0,
        invoices_count: 0,
        avg_invoice: 0,
      };
      monthRow.sales_total = n(monthRow.sales_total) + amount;
      if (!monthInvoiceKeys.has(monthKey)) monthInvoiceKeys.set(monthKey, new Set());
      if (key) monthInvoiceKeys.get(monthKey)?.add(key);
      monthRow.invoices_count = monthInvoiceKeys.get(monthKey)?.size || 0;
      monthMap.set(monthKey, monthRow);
    }

    if (isDoctorName(row.seller_name)) {
      const doctor = String(row.seller_name || '').trim();
      const doctorKey = `${doctor}__${branch}`;
      const doctorRow = doctorMap.get(doctorKey) || {
        doctor_name: doctor,
        branch,
        sales_total: 0,
        invoices_count: 0,
        avg_invoice: 0,
      };
      doctorRow.sales_total = n(doctorRow.sales_total) + amount;
      if (!doctorInvoiceKeys.has(doctorKey)) doctorInvoiceKeys.set(doctorKey, new Set());
      if (key) doctorInvoiceKeys.get(doctorKey)?.add(key);
      doctorRow.invoices_count = doctorInvoiceKeys.get(doctorKey)?.size || 0;
      doctorMap.set(doctorKey, doctorRow);
    }
  }

  const customersByBranch = new Map<string, Set<string>>();
  linked.forEach((row) => {
    const branch = branchName(row.branch);
    if (!customersByBranch.has(branch)) customersByBranch.set(branch, new Set());
    customersByBranch.get(branch)?.add(String(row.customer_code || '').trim());
  });

  const branchDistribution = [...branchMap.values()].map((row) => ({
    ...row,
    avg_invoice: n(row.invoices_count) ? n(row.sales_total) / n(row.invoices_count) : 0,
    linked_customers: customersByBranch.get(String(row.branch))?.size || 0,
  }));

  const doctorSales = [...doctorMap.values()].map((row) => ({
    ...row,
    avg_invoice: n(row.invoices_count) ? n(row.sales_total) / n(row.invoices_count) : 0,
  }));

  const monthlySales = [...monthMap.values()].map((row) => ({
    ...row,
    avg_invoice: n(row.invoices_count) ? n(row.sales_total) / n(row.invoices_count) : 0,
  }));

  return {
    summary: {
      invoices_count: invoiceKeys.size,
      sales_total: sales,
      avg_invoice: invoiceKeys.size ? sales / invoiceKeys.size : 0,
      linked_invoices: linkedInvoiceKeys.size,
      unregistered_customer_invoices: unlinkedInvoiceKeys.size,
      linked_sales: linked.reduce((sum, row) => sum + invoiceAmount(row), 0),
      unregistered_customer_sales: invoiceRows
        .filter((row) => !isLinkedInvoice(row))
        .reduce((sum, row) => sum + invoiceAmount(row), 0),
      customer_link_rate_percent: invoiceKeys.size
        ? (linkedInvoiceKeys.size / invoiceKeys.size) * 100
        : 0,
      linked_customers: new Set(linked.map((row) => String(row.customer_code || '').trim())).size,
    },
    dailySales: [...daysMap.values()].sort((a, b) =>
      String(a.sale_date).localeCompare(String(b.sale_date))
    ),
    branchDistribution: branchDistribution.sort((a, b) => n(b.sales_total) - n(a.sales_total)),
    doctorSales: doctorSales.sort((a, b) => n(b.sales_total) - n(a.sales_total)).slice(0, 30),
    monthlySales: monthlySales
      .sort((a, b) => String(a.month_start).localeCompare(String(b.month_start)))
      .slice(-5),
  };
}

function createTargets(
  branches: BranchDistribution[],
  daysCount: number,
  startDate: string,
  endDate: string,
  savedTargets: SavedBranchTargetRow[] = [],
  savedTargetsUnavailable = false
): TargetRow[] {
  // Documented fallback for branches with no row yet in branch_sales_targets.
  // Never used to paper over a failed/timed-out read of branch_sales_targets:
  // in that case target_source is marked 'unavailable' below instead, so the
  // UI can show a real "couldn't load" state rather than a valid-looking number.
  const targetDefaults: Record<string, number> = {
    'فرع الشامي': 1200000,
    'فرع شكري': 1550000,
  };

  return branches.map((row) => {
    const branch = branchName(row.branch);
    const savedTarget = savedTargets.find((item) => branchName(item.branch_name || item.branch) === branch);
    const hasSavedTarget = n(savedTarget?.target_amount) > 0;
    const targetSource: TargetRow['target_source'] = hasSavedTarget
      ? 'saved'
      : savedTargetsUnavailable
        ? 'unavailable'
        : 'default';
    const target = hasSavedTarget
      ? n(savedTarget?.target_amount)
      : savedTargetsUnavailable
        ? null
        : targetDefaults[branch] || Math.max(n(row.sales_total) * 1.25, 1);
    const achieved = n(row.sales_total);
    const projected = daysCount > 0 ? (achieved / daysCount) * 31 : achieved;
    const percent = target ? (achieved / target) * 100 : null;
    return {
      branch,
      target_amount: target,
      target_source: targetSource,
      sales_total: achieved,
      invoices_count: row.invoices_count,
      avg_invoice: row.avg_invoice,
      achievement_percent: percent,
      projected_sales: projected,
      projected_achievement_percent: target ? (projected / target) * 100 : null,
      remaining_amount: target ? Math.max(0, target - achieved) : null,
      cash_sales: null,
      delivery_sales: null,
      manager_advice:
        target === null
          ? 'تعذر تحميل تارجت الفرع، جاري إعادة المحاولة.'
          : percent !== null && percent >= 90
            ? 'حافظ على نفس معدل التشغيل اليومي.'
            : 'راجع العملاء المتوقفين، متوسط الفاتورة، والعروض اليومية.',
    };
  });
}

function Panel({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`dawaa-card dawaa-card--raised rounded-3xl ${className}`}
    >
      {children}
    </section>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="dawaa-title text-xl">{title}</h2>
        {subtitle ? <p className="dawaa-caption mt-1 text-xs font-bold">{subtitle}</p> : null}
      </div>
      {icon ? <div className="dawaa-icon-tile p-3">{icon}</div> : null}
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'cyan',
  onClick,
  actionLabel,
  onAction,
  showAction = false,
  loading = false,
  stale = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  tone?: 'cyan' | 'green' | 'amber' | 'blue' | 'purple' | 'red';
  onClick?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  showAction?: boolean;
  /** أول تحميل لسه شغال ومفيش رقم اتعرض قبل كده — نعرض skeleton بدل نص "..." */
  loading?: boolean;
  /** الرقم المعروض قديم (آخر تحميل ناجح) بسبب فشل مؤقت في محاولة تحديث لاحقة */
  stale?: boolean;
}) {
  const toneClass = {
    cyan: 'dawaa-badge--info',
    green: 'dawaa-badge--success',
    amber: 'dawaa-badge--warning',
    blue: 'dawaa-badge--info',
    purple: 'dawaa-badge--info',
    red: 'dawaa-badge--danger',
  }[tone];

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={`dawaa-card dawaa-card--interactive relative overflow-hidden p-5 ${onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--dawaa-theme-focus)]' : ''}`}
    >
      <div className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-[var(--dawaa-theme-soft)] blur-2xl" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-text)]">
            {title}
            {stale ? (
              <span
                title="آخر بيانات ناجحة — جاري محاولة التحديث"
                className="h-1.5 w-1.5 rounded-full bg-[var(--dawaa-status-warning-bg)]"
              />
            ) : null}
          </p>
          {loading ? (
            <div className="mt-3 h-8 w-28 animate-pulse rounded-lg bg-[var(--dawaa-theme-soft)]" />
          ) : (
            <p className="mt-3 text-3xl font-black tracking-tight text-[var(--dawaa-theme-heading)]">{value}</p>
          )}
          <p className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{subtitle}</p>
        </div>
        <div className={`dawaa-icon-tile p-3 ${toneClass}`}>{icon}</div>
      </div>
      {showAction && onAction ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
          className="mt-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-black text-[var(--dawaa-theme-primary-strong)] hover:bg-[var(--dawaa-theme-accent-soft)]"
        >
          {actionLabel || 'إعادة تحميل القسم'}
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  label,
  error,
  onRetry,
}: {
  label: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  // لو القسم فاضل بسبب فشل تحميل حقيقي (مش لأنه فعلاً مفيش بيانات)، لازم نوضح
  // ده للمستخدم بدل رسالة "لا توجد بيانات" المضللة، ونديله زرار يعيد تحميل نفس القسم.
  if (error) {
    return (
      <div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.04] p-4 text-center">
        <span className="text-sm font-black text-[var(--dawaa-status-danger-text)]">تعذر تحميل البيانات</span>
        <span className="text-xs font-bold text-[var(--dawaa-status-danger-text)]/70">قد يكون الاتصال بطيء، جرّب إعادة المحاولة.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-black text-[var(--dawaa-status-danger-text)] hover:bg-[var(--dawaa-status-danger-bg)]"
          >
            إعادة المحاولة
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-56 items-center justify-center rounded-2xl border border-dashed border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] text-sm font-black text-[var(--dawaa-theme-muted)]">
      {label}
    </div>
  );
}

function MiniBox({
  label,
  value,
  tone = 'cyan',
}: {
  label: string;
  value: string;
  tone?: 'cyan' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const classes = {
    cyan: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary-strong)]',
    green: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]',
    amber: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
    red: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]',
    blue: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]',
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs font-black text-[var(--dawaa-theme-text)]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value}</p>
    </div>
  );
}

function StaffAccountsHealthPanel() {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; active: number | null; disabled: number | null }>({
    status: 'loading',
    active: null,
    disabled: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading' }));
    supabase
      .rpc('get_dashboard_staff_ops_summary_v171')
      .then((result: any) => {
        if (cancelled) return;
        if (result.error) throw result.error;
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        setState({
          status: 'ready',
          active: row?.active_accounts == null ? null : Number(row.active_accounts),
          disabled: row?.disabled_accounts == null ? null : Number(row.disabled_accounts),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[ExecutiveDashboard2027] staff accounts health failed', error);
        setState({ status: 'error', active: null, disabled: null });
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <Panel className="p-5">
      <SectionTitle
        title="حالة حسابات الفريق"
        subtitle="حسابات نشطة/مقفولة من السجل المعتمد لهوية الموظفين"
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <MiniBox label="حسابات نشطة" value={state.status === 'ready' && state.active != null ? count(state.active) : '—'} tone="green" />
        <MiniBox label="حسابات مقفولة" value={state.status === 'ready' && state.disabled != null ? count(state.disabled) : '—'} tone="red" />
      </div>
      {state.status === 'error' ? (
        <p className="mt-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">تعذر تحميل حالة الحسابات الآن — القيمة (—) وليست صفرًا.</p>
      ) : null}
    </Panel>
  );
}


const PAYMENT_TYPE_ORDER = ['كاش', 'توصيل منزلى', 'آجل', 'غير محدد'];
const PAYMENT_TYPE_TONE: Record<string, 'cyan' | 'green' | 'amber' | 'red' | 'blue'> = {
  'كاش': 'green',
  'توصيل منزلى': 'blue',
  'آجل': 'amber',
  'غير محدد': 'red',
};

type PaymentTypeRow = {
  invoice_type: string;
  invoice_count: number;
  total_value: number;
  avg_invoice: number;
  pct_of_value: number;
  pct_of_count: number;
};

function PaymentTypeBreakdownCards({
  startDate,
  endDate,
  scopedBranch,
}: {
  startDate: string;
  endDate: string;
  scopedBranch: string;
}) {
  const [rows, setRows] = useState<PaymentTypeRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    const branchParam =
      !scopedBranch || scopedBranch === ALL_BRANCHES ? 'ALL' : scopedBranch;
    supabase
      .rpc('get_sales_payment_type_breakdown', {
        p_start: startDate,
        p_end: endDate,
        p_branch: branchParam,
      })
      .then(({ data, error: rpcError }: { data: PaymentTypeRow[] | null; error: unknown }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(true);
          return;
        }
        setRows((data as PaymentTypeRow[]) || []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, scopedBranch]);

  if (error) return null;

  const ordered = rows
    ? [...rows].sort(
        (a, b) => PAYMENT_TYPE_ORDER.indexOf(a.invoice_type) - PAYMENT_TYPE_ORDER.indexOf(b.invoice_type)
      )
    : PAYMENT_TYPE_ORDER.map((t) => ({
        invoice_type: t,
        invoice_count: 0,
        total_value: 0,
        avg_invoice: 0,
        pct_of_value: 0,
        pct_of_count: 0,
      }));

  return (
    <div className="mb-3 grid gap-3 md:grid-cols-4">
      {ordered.map((row) => (
        <div
          key={row.invoice_type}
          className={`rounded-2xl border p-4 ${
            {
              cyan: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary-strong)]',
              green: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]',
              amber: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
              red: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]',
              blue: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]',
            }[PAYMENT_TYPE_TONE[row.invoice_type] || 'cyan']
          } ${rows === null ? 'animate-pulse' : ''}`}
        >
          <p className="text-xs font-black text-[var(--dawaa-theme-text)]">{row.invoice_type}</p>
          <p className="mt-2 text-xl font-black text-[var(--dawaa-theme-heading)]">
            {rows === null ? '—' : `${money(row.total_value)} ج.م`}
          </p>
          <p className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
            {rows === null
              ? ''
              : `${row.invoice_count.toLocaleString('ar-EG')} فاتورة (${row.pct_of_count}%) · ${row.pct_of_value}% من القيمة`}
          </p>
          <p className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
            {rows === null ? '' : `متوسط الفاتورة: ${money(row.avg_invoice)} ج.م`}
          </p>
        </div>
      ))}
    </div>
  );
}

function HealthSummaryBox({
  label,
  value,
  tone = 'cyan',
}: {
  label: string;
  value: string;
  tone?: 'cyan' | 'green' | 'amber' | 'red';
}) {
  const classes = {
    cyan: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] shadow-cyan-950/20',
    green: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] shadow-emerald-950/20',
    amber: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] shadow-amber-950/20',
    red: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] shadow-rose-950/20',
  }[tone];
  return (
    <div className={`rounded-3xl border p-5 shadow-lg ${classes}`}>
      <p className="text-sm font-black text-[var(--dawaa-theme-text)]">{label}</p>
      <p className="mt-4 text-4xl font-black tracking-tight text-[var(--dawaa-theme-heading)] drop-shadow-sm">{value}</p>
    </div>
  );
}

function roleHomePath(user: { role?: unknown } | null | undefined): string {
  if (isDoctorRole(user as any)) return '/doctor-dashboard';
  const role = normalizeRole(user?.role);
  if (role === 'delivery') return '/delivery';
  if (role === 'cleaning_supervisor') return '/branch-cleaning';
  if (role === 'inventory_assistant') return '/inventory-counts';
  if (role === 'customer_service' || role === 'customer_service_manager') return '/customer-service-dashboard';
  if (['general_manager','executive_manager','branches_manager','branch_manager'].includes(role)) return '/';
  return '/schedule';
}

export default function ExecutiveDashboard2027() {
  const { user, checkPermission } = useAuth();
  const navigate = useNavigate();
  const currentCycle = useMemo(() => getCurrentCycle(), []);
  const previousCycle = useMemo(() => getPreviousCycle(), []);
  const canViewExecutive =
    isManagerRole(user) ||
    checkPermission('view_executive_dashboard') ||
    checkPermission('view_branch_dashboard');
  const role = normalizeRole(user?.role);
  const redirectPath = roleHomePath(user);
  useEffect(() => {
    if (!canViewExecutive) navigate(redirectPath, { replace: true });
  }, [canViewExecutive, navigate, redirectPath]);
  useEffect(() => {
    if (normalizeRole(user?.role) === 'customer_service_manager') {
      navigate('/customer-service-dashboard', { replace: true });
      return;
    }
    if (canViewExecutive) return;
    if (isDoctorRole(user)) { navigate('/doctor-dashboard', { replace: true }); return; }
    const role = normalizeRole(user?.role);
    if (role === 'delivery') { navigate('/delivery', { replace: true }); return; }
    if (role === 'cleaning_supervisor') { navigate('/branch-cleaning', { replace: true }); return; }
    if (role === 'inventory_assistant') { navigate('/inventory-counts', { replace: true }); return; }
    navigate('/time-off', { replace: true });
  }, [canViewExecutive, navigate, user]);
  const [startDate, setStartDate] = useState(() => formatCycleDate(currentCycle.start));
  const [endDate, setEndDate] = useState(() => formatCycleDate(currentCycle.end));
  const [branch, setBranch] = useState(() => {
    const overrideBranch = getDashboardBranchOverride(user as any);
    const branchValue = effectiveBranchFilter(user, overrideBranch, ALL_BRANCHES) || ALL_BRANCHES;
    return normalizeBranchName(branchValue) || ALL_BRANCHES;
  });
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dailyChartMetric, setDailyChartMetric] = useState<DailyChartMetric>('sales');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoadTimedOut, setInitialLoadTimedOut] = useState(false);
  // Per-section loading / error / loadedAt
  const [salesKPILoading, setSalesKPILoading] = useState(false);
  const [salesKPIError, setSalesKPIError] = useState<string | null>(null);
  const [salesKPILoadedAt, setSalesKPILoadedAt] = useState<string | null>(null);
  const [salesKPITimedOut, setSalesKPITimedOut] = useState(false);

  // قسم "تحليل آخر 5 شهور" له fetch/loading/error/retry مستقل تمامًا عن باقي
  // مؤشرات المبيعات، عشان فشل أو بطء فيه ميوقفش أو يوهم بفشل بقية الداشبورد.
  const [monthlyTrend, setMonthlyTrend] = useState<
    Array<{ month_start: string; month_label: string; branch: string; sales_total: number; invoices_count: number; avg_invoice: number }>
  >([]);
  const [monthlyTrendLoading, setMonthlyTrendLoading] = useState(false);
  const [monthlyTrendError, setMonthlyTrendError] = useState<string | null>(null);
  const [monthlyTrendLoadedAt, setMonthlyTrendLoadedAt] = useState<string | null>(null);
  const [monthlyTrendTimedOut, setMonthlyTrendTimedOut] = useState(false);
  const [monthlyTrendRetryToken, setMonthlyTrendRetryToken] = useState(0);

  const [customerServiceLoading, setCustomerServiceLoading] = useState(false);
  const [customerServiceError, setCustomerServiceError] = useState<string | null>(null);
  const [customerServiceLoadedAt, setCustomerServiceLoadedAt] = useState<string | null>(null);
  const [customerServiceTimedOut, setCustomerServiceTimedOut] = useState(false);

  const [incentivesLoading, setIncentivesLoading] = useState(false);
  const [incentivesError, setIncentivesError] = useState<string | null>(null);
  const [incentivesLoadedAt, setIncentivesLoadedAt] = useState<string | null>(null);
  const [incentivesTimedOut, setIncentivesTimedOut] = useState(false);

  const [dailyTasksLoading, setDailyTasksLoading] = useState(false);
  const [dailyTasksError, setDailyTasksError] = useState<string | null>(null);
  const [dailyTasksLoadedAt, setDailyTasksLoadedAt] = useState<string | null>(null);
  const [dailyTasksTimedOut, setDailyTasksTimedOut] = useState(false);

  const [staffAttendanceLoading, setStaffAttendanceLoading] = useState(false);
  const [staffAttendanceError, setStaffAttendanceError] = useState<string | null>(null);
  const [staffAttendanceLoadedAt, setStaffAttendanceLoadedAt] = useState<string | null>(null);
  const [staffAttendanceTimedOut, setStaffAttendanceTimedOut] = useState(false);

  // branchPerformance depends on salesKPIs results
  const [branchPerformanceLoading, setBranchPerformanceLoading] = useState(false);
  const [branchPerformanceError, setBranchPerformanceError] = useState<string | null>(null);
  const [branchPerformanceLoadedAt, setBranchPerformanceLoadedAt] = useState<string | null>(null);
  const [inventoryOperationsLoading, setInventoryOperationsLoading] = useState(false);
  const [inventoryOperationsError, setInventoryOperationsError] = useState<string | null>(null);
  const [inventoryOperationsLoadedAt, setInventoryOperationsLoadedAt] = useState<string | null>(null);
  const [inventoryOperationsTimedOut, setInventoryOperationsTimedOut] = useState(false);
  const [doctorCompetition, setDoctorCompetition] = useState<DoctorCompetitionMetrics | null>(null);
  const [doctorCompetitionLoading, setDoctorCompetitionLoading] = useState(false);
  const [competitionsLoading, setCompetitionsLoading] = useState(false);
  const [doctorCompetitionError, setDoctorCompetitionError] = useState<string | null>(null);
  const [doctorCompetitionLoadedAt, setDoctorCompetitionLoadedAt] = useState<string | null>(null);
  // زيادة الرقم ده بس تعيد تشغيل query مسابقة الدكاترة لوحدها، من غير أي تأثير
  // على باقي أقسام لوحة القيادة ومن غير إعادة تحميل الصفحة.
  const [doctorCompetitionRetryToken, setDoctorCompetitionRetryToken] = useState(0);
  const [dataHealthIssues, setDataHealthIssues] = useState<DataHealthIssue[]>([]);
  const [dataHealthLoading, setDataHealthLoading] = useState(false);
  const [dataHealthTimedOut, setDataHealthTimedOut] = useState(false);
  const [dataHealthError, setDataHealthError] = useState<string | null>(null);
  const [dataHealthRetryToken, setDataHealthRetryToken] = useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [teamTaskSummary, setTeamTaskSummary] = useState<EmployeeTaskSummary | null>(null);
  const [teamTaskIssue, setTeamTaskIssue] = useState<string | null>(null);
  const loadIdRef = useRef(0);
  const lastGoodDoctorCompetitionRef = useRef<DoctorCompetitionMetrics | null>(null);
  const noCacheRef = useRef(false);
  const [state, setState] = useState<DashboardState>({
    summary: null,
    dailySales: [],
    monthlySales: [],
    branchDistribution: [],
    targets: [],
    doctorSales: [],
    staffDirectory: [],
    onShiftNow: [],
    incentiveSummary: [],
    recentInvoices: [],
    salesReconciliation: null,
    loadedAt: null,
    errors: [],
  });

  // المهلة البصرية دي لازم تفضل أعلى من أطول مهلة withTimeout حقيقية للقسم نفسه —
  // لو كانت أقصر، الواجهة هتعلن "تعذر التحميل" والطلب لسه شغال فعليًا وممكن ينجح
  // بعد ثانيتين، وده بالظبط سبب ظهور رسالة خطأ "بدون سبب حقيقي" بين الحين والتاني.
  function useSectionTimeout(
    loading: boolean,
    loadedAt: string | null,
    onTimeout: (value: boolean) => void,
    thresholdMs = 7000
  ) {
    useEffect(() => {
      if (!loading || loadedAt) {
        onTimeout(false);
        return;
      }
      const timer = window.setTimeout(() => onTimeout(true), thresholdMs);
      return () => window.clearTimeout(timer);
    }, [loading, loadedAt, onTimeout, thresholdMs]);
  }

  useSectionTimeout(salesKPILoading, salesKPILoadedAt, setSalesKPITimedOut, 26000);
  useSectionTimeout(monthlyTrendLoading, monthlyTrendLoadedAt, setMonthlyTrendTimedOut, 17000);
  useSectionTimeout(customerServiceLoading, customerServiceLoadedAt, setCustomerServiceTimedOut);
  useSectionTimeout(incentivesLoading, incentivesLoadedAt, setIncentivesTimedOut);
  useSectionTimeout(dailyTasksLoading, dailyTasksLoadedAt, setDailyTasksTimedOut, 9000);
  useSectionTimeout(staffAttendanceLoading, staffAttendanceLoadedAt, setStaffAttendanceTimedOut, 9000);
  useSectionTimeout(inventoryOperationsLoading, inventoryOperationsLoadedAt, setInventoryOperationsTimedOut);
  useSectionTimeout(dataHealthLoading, null, setDataHealthTimedOut, 14000);

  function getSectionValue<T>({
    value,
    loading,
    error,
    loadedAt,
    timedOut = false,
    fallback = '...',
  }: {
    value: T;
    loading: boolean;
    error: string | null;
    loadedAt: string | null;
    timedOut?: boolean;
    fallback?: string;
  }): T | string {
    // لو القسم نجح مرة واحدة قبل كده، نفضّل نعرض آخر رقم صحيح بدل ما نمسحه برسالة
    // خطأ بسبب فشل مؤقت في محاولة تحديث لاحقة — رقم قديم صح أفضل من رقم مختفي، وزرار
    // إعادة المحاولة على الكارت لسه ظاهر عادي لو فيه خطأ حالي.
    if (loadedAt) return value;
    if (error || timedOut) return 'تعذر التحميل';
    if (loading) return fallback;
    return value;
  }

  const canAllBranches = canSeeAllBranches(user?.role);
  const scopedBranch = effectiveBranchFilter(user, branch, ALL_BRANCHES) || ALL_BRANCHES;
  const effectiveBranchLabel = normalizeBranchName(scopedBranch || ALL_BRANCHES) || ALL_BRANCHES;

  const [R, setR] = useState<any>(null);
  useEffect(() => {
    let mounted = true;
    import('recharts').then((m) => {
      if (mounted) setR(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const BarChart = R?.BarChart ?? ((props: any) => <div className="h-56 rounded-2xl bg-slate-100 animate-pulse" />);
  const LineChart = R?.LineChart ?? BarChart;
  const ComposedChart = R?.ComposedChart ?? BarChart;
  const PieChart = R?.PieChart ?? ((props: any) => <div className="h-56 rounded-2xl bg-slate-100 animate-pulse" />);
  const ResponsiveContainer = R?.ResponsiveContainer ?? (({ children }: any) => <div>{children}</div>);
  const XAxis = R?.XAxis ?? ((props: any) => null);
  const YAxis = R?.YAxis ?? ((props: any) => null);
  const Tooltip = R?.Tooltip ?? ((props: any) => null);
  const CartesianGrid = R?.CartesianGrid ?? ((props: any) => null);
  const Bar = R?.Bar ?? ((props: any) => null);
  const Cell = R?.Cell ?? ((props: any) => null);
  const Legend = R?.Legend ?? ((props: any) => null);
  const Line = R?.Line ?? ((props: any) => null);
  const Area = R?.Area ?? ((props: any) => null);
  const FunnelChart = R?.FunnelChart ?? ((props: any) => <div className="h-56 rounded-2xl bg-slate-100 animate-pulse" />);
  const Funnel = R?.Funnel ?? ((props: any) => null);
  const Pie = R?.Pie ?? ((props: any) => null);
  const LabelList = R?.LabelList ?? ((props: any) => null);

  useEffect(() => {
    const next = effectiveBranchFilter(user, branch, ALL_BRANCHES);
    if (!canAllBranches && next && branch !== next) setBranch(next);
  }, [branch, canAllBranches, user]);

  useEffect(() => {
    let mounted = true;
    setDoctorCompetitionLoading(true);
    const doctorCompetitionParams =
      startDate === formatCycleDate(currentCycle.start) && endDate === formatCycleDate(currentCycle.end)
        ? { period: 'cycle' as const }
        : { period: 'custom' as const, customStart: startDate, customEnd: endDate };

    withSingleRetry(() =>
      withTimeout(
        getDoctorCompetitionMetrics({
          ...doctorCompetitionParams,
          branch: scopedBranch === ALL_BRANCHES ? null : scopedBranch,
          userBranch: user?.branch,
          canSeeAllBranches: canAllBranches,
        }),
        20000,
        'doctor-competition'
      )
    )
      .then((metrics) => {
        if (!mounted) return;
        if (metrics.rows.length) {
          lastGoodDoctorCompetitionRef.current = metrics;
          setDoctorCompetition(metrics);
        } else if (lastGoodDoctorCompetitionRef.current) {
          setDoctorCompetition(lastGoodDoctorCompetitionRef.current);
        } else {
          setDoctorCompetition(metrics);
        }
        setDoctorCompetitionError(null);
        setDoctorCompetitionLoadedAt(new Date().toISOString());
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('[ExecutiveDashboard2027] doctor competition metrics failed', error);
        if (mounted && lastGoodDoctorCompetitionRef.current) {
          setDoctorCompetition(lastGoodDoctorCompetitionRef.current);
        }
        setDoctorCompetitionError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (mounted) setDoctorCompetitionLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canAllBranches, scopedBranch, startDate, endDate, user?.branch, doctorCompetitionRetryToken]);

  useEffect(() => {
    let mounted = true;
    setMonthlyTrendLoading(true);
    setMonthlyTrendError(null);
    withSingleRetry(() =>
      withTimeout(fetchMonthlySalesFromTruth(endDate, scopedBranch || ALL_BRANCHES, 5), 15000, 'monthly-trend')
    )
      .then((rows) => {
        if (!mounted) return;
        setMonthlyTrend(rows as typeof monthlyTrend);
        setMonthlyTrendError(null);
        setMonthlyTrendLoadedAt(new Date().toISOString());
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('[ExecutiveDashboard2027] monthly trend fetch failed', error);
        if (!mounted) return;
        setMonthlyTrendError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (mounted) setMonthlyTrendLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [endDate, scopedBranch, monthlyTrendRetryToken]);

  useEffect(() => {
    if (!diagnosticsOpen) return;
    let mounted = true;
    setDataHealthLoading(true);
    setDataHealthError(null);
    // مهلة 7 ثواني كانت أقل من التكلفة الحقيقية المقاسة لـget_app_data_health_v2 وقت
    // انتهاء صلاحية الكاش الداخلي (cache TTL دقيقتين): قياس مباشر عبر EXPLAIN ANALYZE
    // أظهر ~8.4-10.5 ثانية على cache miss مقابل ~12ms على cache hit. المهلة هنا بقت
    // مبنية على الرقم الحقيقي المقاس (مش تخمين) مع هامش أمان، والمسار العادي (cache
    // hit) لسه سريع جدًا زي ما هو.
    withTimeout(loadAppDataHealthSummary(), 12000, 'data-health')
      .then((issues) => {
        if (!mounted) return;
        setDataHealthIssues(issues);
        setDataHealthError(null);
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('[ExecutiveDashboard2027] data health failed', error);
        // مهم: لازم نفرّق بين "فحصنا فعلاً ومفيش مشاكل" و"الفحص نفسه فشل" — قبل كده كان
        // أي فشل في التحميل بيمسح القائمة ويظهر "كل شيء سليم" باللون الأخضر، يعني
        // بيخفي المشكلة الحقيقية بدل ما يبلّغ عنها.
        if (mounted) setDataHealthError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (mounted) setDataHealthLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [dataHealthRetryToken, diagnosticsOpen]);

  useEffect(() => {
    let mounted = true;
    setDailyTasksLoading(true);
    setDailyTasksError(null);
    withTimeout(summarizeTeamTasks(new Date().toISOString().slice(0, 10), scopedBranch, user), 12000, 'daily-tasks')
      .then((result) => {
        if (!mounted) return;
        setTeamTaskSummary(result.summary);
        setTeamTaskIssue(result.error);
        setDailyTasksLoadedAt(new Date().toISOString());
      })
      .catch((error) => {
        if (mounted) setTeamTaskIssue(error instanceof Error ? error.message : 'تعذر تحميل مهام الفريق');
        setDailyTasksError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (mounted) setDailyTasksLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [scopedBranch, user?.id, user?.role, user?.branch]);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    const cachedState = loadDashboardCache(scopedBranch || ALL_BRANCHES, {
      start: startDate,
      end: endDate,
    }, user?.role);

    setLoading(true);
    setInitialLoadTimedOut(false);
    setLoadError(null);
    const errors: string[] = [];

    void (async () => {
      // prepare section flags
      setSalesKPILoading(true);
      setSalesKPIError(null);
      setCustomerServiceLoading(true);
      setCustomerServiceError(null);
      setIncentivesLoading(true);
      setIncentivesError(null);
      setStaffAttendanceLoading(true);
      setStaffAttendanceError(null);
      setInventoryOperationsLoading(true);
      setInventoryOperationsError(null);
      setInventoryOperationsLoadedAt(null);
      // Customer-service analytics live in /customer-service. Avoid duplicate Supabase work here.
      setCustomerServiceLoading(false);
      setCustomerServiceLoadedAt(new Date().toISOString());

      // ensure inventory section is marked as loaded for static operations cards
      setInventoryOperationsLoadedAt(new Date().toISOString());
      setInventoryOperationsLoading(false);

      // SALES KPIs block (main heavy)
    let salesTruth: any = { summary: {}, dailySales: [], branchDistribution: [], doctorSales: [], monthlySales: [], recentInvoices: [], reconciliation: {} };
    try {
      try {
        const noCache = noCacheRef.current;
        noCacheRef.current = false;
        salesTruth = await withSingleRetry(() =>
          withTimeout(
            fetchDashboardSalesTruth({
              startDate,
              endDate,
              branch: scopedBranch || ALL_BRANCHES,
              errors,
              noCache,
            }),
            20000,
            'sales-truth'
          )
        );
        // apply sales truth to state incrementally
        const summary = salesTruth.summary;
        const effectiveDailySales = salesTruth.dailySales;
        const effectiveBranchDistribution = salesTruth.branchDistribution;
        const effectiveDoctorSales = salesTruth.doctorSales;
        const effectiveMonthlySales = salesTruth.monthlySales;
        const recentInvoices = salesTruth.recentInvoices as InvoiceRow[];
        const salesReconciliation = salesTruth.reconciliation;
        const daysCount = new Set(
          (effectiveDailySales || []).map((row: any) => String(row.sale_date || '').slice(0, 10)).filter(Boolean)
        ).size || 1;
        let savedTargetRows: SavedBranchTargetRow[] = [];
        let savedTargetsUnavailable = false;
        try {
          const targetResult = await withTimeout<SupabaseQueryResult<SavedBranchTargetRow[]>>(
            supabase.from('branch_sales_targets').select('*').limit(100) as PromiseLike<SupabaseQueryResult<SavedBranchTargetRow[]>>,
            5000,
            'branch-sales-targets'
          );
          if (!targetResult.error) savedTargetRows = targetResult.data || [];
          else {
            savedTargetsUnavailable = true;
            errors.push('branch_sales_targets: ' + (targetResult.error.message || 'تعذر تحميل التارجت'));
          }
        } catch (targetError) {
          savedTargetsUnavailable = true;
          errors.push('branch_sales_targets: ' + (targetError instanceof Error ? targetError.message : String(targetError)));
        }
        const targets = createTargets(effectiveBranchDistribution, daysCount, startDate, endDate, savedTargetRows, savedTargetsUnavailable);
        setState((prev) => ({
          ...prev,
          summary,
          dailySales: effectiveDailySales,
          monthlySales: effectiveMonthlySales,
          branchDistribution: effectiveBranchDistribution,
          targets,
          doctorSales: effectiveDoctorSales,
          recentInvoices,
          salesReconciliation,
        }));
        setSalesKPILoadedAt(new Date().toISOString());
      } catch (e) {
        console.error('[Dashboard] sales KPIs fetch failed', e);
        setSalesKPIError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      setSalesKPILoading(false);
    }
      // Detailed incentive ledger belongs to the points/incentives workspace.
      setIncentivesLoading(false);
      setIncentivesLoadedAt(new Date().toISOString());

      // STAFF ATTENDANCE block (staff directory, schedules, presence)
      try {
      setStaffAttendanceLoading(true);
      try {
        // التلات queries دول مستقلين تمامًا عن بعض (جداول/مصادر مختلفة، وميحتاجش
        // نتيجة أي واحد فيهم عشان نبدأ التاني) — بنشغّلهم بالتوازي بدل التتابع
        // عشان زمن الانتظار الكلي يبقى أقرب لأبطأ واحد فيهم مش مجموعهم.
        const [staffResult, scheduleResult, presenceResult] = await Promise.all([
          withTimeout<{
            data: StaffDirectoryRow[] | null;
            error: { message?: string } | null;
          }>(
            readStaffDirectory().then((rows) => ({
              data: rows.slice(0, 700).map((row) => ({
                id: row.id,
                name: row.name,
                role: row.role,
                branch: row.branch,
                status: row.status,
                active: row.active,
                is_active: row.active,
              })) as StaffDirectoryRow[],
              error: null,
            })),
            7000,
            'staff-directory'
          ),
          withTimeout<{
            data: ShiftScheduleRow[] | null;
            error: { message?: string } | null;
          }>(
            supabase
              .from('shift_schedules')
              .select('staff_id,staff_name,branch,day_name,shift_start,shift_end,is_off')
              .limit(1200) as PromiseLike<{
                data: ShiftScheduleRow[] | null;
                error: { message?: string } | null;
              }>,
            7000,
            'shift-schedules'
          ),
          withTimeout<{
            doctors: Array<{ id: string; name: string; role: string; branch: string; attendance_status?: string; shift_start?: string; shift_end?: string }>;
            assistants: Array<{ id: string; name: string; role: string; branch: string; attendance_status?: string; shift_start?: string; shift_end?: string }>;
            delivery: Array<{ id: string; name: string; role: string; branch: string; attendance_status?: string; shift_start?: string; shift_end?: string }>;
            error?: { message?: string } | null;
          }>(fetchCurrentShiftPresence() as PromiseLike<{
            doctors: Array<{ id: string; name: string; role: string; branch: string; attendance_status?: string; shift_start?: string; shift_end?: string }>;
            assistants: Array<{ id: string; name: string; role: string; branch: string; attendance_status?: string; shift_start?: string; shift_end?: string }>;
            delivery: Array<{ id: string; name: string; role: string; branch: string; attendance_status?: string; shift_start?: string; shift_end?: string }>;
            error?: { message?: string } | null;
          }>, 7000, 'shift-presence'),
        ]);
        if (staffResult.error) errors.push(`staff: ${staffResult.error.message}`);
        if (scheduleResult.error) errors.push(`shift_schedules: ${scheduleResult.error.message}`);
        if (presenceResult && 'error' in presenceResult && presenceResult.error) {
          errors.push(`current presence: ${presenceResult.error.message}`);
        }

        const staffDirectory = ((staffResult.data || []) as StaffDirectoryRow[]).filter(isActiveStaff);
        const scheduleRows = (scheduleResult.data || []) as ShiftScheduleRow[];
        const todayName = DAYS_AR[new Date().getDay()];
        const scheduleByKey = new Map<string, ShiftScheduleRow>();
        for (const row of scheduleRows) {
          if (row.is_off) continue;
          if (String(row.day_name || '') !== todayName) continue;
          const rBranch = branchName(row.branch);
          const idKey = `id:${String(row.staff_id || '')}|${rBranch}`;
          const nameKey = `name:${String(row.staff_name || '').trim()}|${rBranch}`;
          if (!scheduleByKey.has(idKey)) scheduleByKey.set(idKey, row);
          if (!scheduleByKey.has(nameKey)) scheduleByKey.set(nameKey, row);
        }
        const scheduledToday = staffDirectory
          .map((member) => {
            const name = staffName(member);
            const memberBranch = branchName(member.branch);
            const idKey = `id:${staffId(member)}|${memberBranch}`;
            const nameKey = `name:${name}|${memberBranch}`;
            const schedule = scheduleByKey.get(idKey) || scheduleByKey.get(nameKey);
            if (!schedule?.shift_start || !schedule?.shift_end) return null;
            if (scopedBranch !== ALL_BRANCHES && memberBranch !== scopedBranch) return null;
            return { ...member, shift_start: schedule.shift_start, shift_end: schedule.shift_end };
          })
          .filter(Boolean) as ShiftNowRow[];
        const onShiftNow = scheduledToday.filter((member) =>
          isCurrentlyOnShift(member.shift_start || '', member.shift_end || '')
        );
        const currentPresence = presenceResult && typeof presenceResult === 'object' && 'doctors' in presenceResult
          ? presenceResult
          : { doctors: [], assistants: [], delivery: [] };
        const presenceRows = [
          ...currentPresence.doctors,
          ...currentPresence.assistants,
          ...currentPresence.delivery,
        ]
          .filter((person) => scopedBranch === ALL_BRANCHES || branchName(person.branch) === scopedBranch)
          .map((person) => ({
            id: person.id,
            staff_id: person.id,
            name: person.name,
            staff_name: person.name,
            role: person.role,
            branch: person.branch,
            status: person.attendance_status,
            active: true,
            is_active: true,
            shift_start: person.shift_start,
            shift_end: person.shift_end,
          })) as ShiftNowRow[];
        const effectiveOnShiftNow = presenceRows.length ? presenceRows : onShiftNow.length ? onShiftNow : scheduledToday;
        setState((prev) => ({ ...prev, staffDirectory, onShiftNow: effectiveOnShiftNow }));
        setStaffAttendanceLoadedAt(new Date().toISOString());
      } catch (e) {
        console.error('[Dashboard] staff attendance fetch failed', e);
        setStaffAttendanceError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      setStaffAttendanceLoading(false);
    }

      // ensure branch performance computed after sales KPIs
      try {
      setBranchPerformanceLoading(true);
      if (!salesKPILoading) {
        // compute branchPerformance from state.targets
        setBranchPerformanceLoadedAt(new Date().toISOString());
      }
    } catch (e) {
      setBranchPerformanceError(String(e instanceof Error ? e.message : e));
    } finally {
      setBranchPerformanceLoading(false);
    }

      // finalize: save cache and set global loadedAt
      try {
      const finalLoadedAt = new Date().toISOString();
      setState((prev) => ({ ...prev, loadedAt: finalLoadedAt }));
      try {
        saveDashboardCache(
          { ...state, loadedAt: finalLoadedAt },
          scopedBranch || ALL_BRANCHES,
          { start: startDate, end: endDate },
          user?.role
        );
      } catch (e) {
        // ignore cache save errors
      }
    } catch (e) {
      // ignore
    }
      setLoading(false);
    })();
  }, [currentCycle, endDate, scopedBranch, startDate]);

  const reloadDashboard = useCallback(() => {
    noCacheRef.current = true;
    clearInvoiceCache();
    clearDashboardCache();
    void load();
    setMonthlyTrendRetryToken((token) => token + 1);
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    void load();
  }, [load, user?.id]);

  useEffect(() => {
    if (!loading || state.loadedAt || state.summary) return;
    const id = window.setTimeout(() => setInitialLoadTimedOut(true), 7000);
    return () => window.clearTimeout(id);
  }, [loading, state.loadedAt, state.summary]);

  const branchOptions = useMemo(() => {
    const fromData = [
      ...state.branchDistribution.map((r) => branchName(r.branch)),
      ...state.targets.map((r) => branchName(r.branch)),
    ].filter((b) => b !== 'غير محدد');
    const unique = [...new Set([...fromData, 'فرع شكري', 'فرع الشامي'])];
    return canAllBranches ? [ALL_BRANCHES, ...unique] : [branchName(user?.branch || '')];
  }, [canAllBranches, state.branchDistribution, state.targets, user?.branch]);

  const branchScopeLabel = canAllBranches
    ? `نطاق العرض: ${effectiveBranchLabel === ALL_BRANCHES ? 'كل الفروع' : effectiveBranchLabel}`
    : `نطاق العرض: فرع ${branchName(user?.branch || '')}`;

  const summary = state.summary || {};
  // customerService/staffOps summaries are never populated by any fetch path
  // (see ROLE_DASHBOARD_TRUTH_REVIEW note) — removed along with the fake
  // panels that used them, rather than kept as unused dead reads.
  const dashboardQuery = useMemo(() => {
    const query = new URLSearchParams({
      start: startDate,
      end: endDate,
      branch: scopedBranch || ALL_BRANCHES,
    });
    return query.toString();
  }, [endDate, scopedBranch, startDate]);

  const dailyChart = useMemo(() => {
    const emptyDay = (day: string): DailyChartRow & { date: string; hasData: boolean } => ({
      date: day,
      label: safeDate(day),
      totalSales: 0,
      totalInvoices: 0,
      totalAverage: 0,
      shokrySales: 0,
      shokryInvoices: 0,
      shokryAverage: 0,
      shamySales: 0,
      shamyInvoices: 0,
      shamyAverage: 0,
      hasData: false,
    });

    const map = new Map<string, DailyChartRow & { date: string; hasData: boolean }>();
    dateRangeDays(startDate, endDate).forEach((day) => map.set(day, emptyDay(day)));

    state.dailySales.forEach((row) => {
      const day = String(row.sale_date || '').slice(0, 10);
      if (!day) return;
      const branch = branchName(row.branch);
      const current = map.get(day) || emptyDay(day);
      const sales = n(row.daily_sales);
      const invoices = n(row.invoices_count);
      current.hasData = true;
      current.totalSales = n(current.totalSales) + sales;
      current.totalInvoices = n(current.totalInvoices) + invoices;
      current.totalAverage = n(current.totalInvoices)
        ? n(current.totalSales) / n(current.totalInvoices)
        : 0;

      const normalizedBranch = normalizeBranchName(branch);
      const isShokry = normalizedBranch.includes('شكري');
      const isShamy = normalizedBranch.includes('الشامي');
      if (isShokry) {
        current.shokrySales = n(current.shokrySales) + sales;
        current.shokryInvoices = n(current.shokryInvoices) + invoices;
        current.shokryAverage = n(current.shokryInvoices)
          ? n(current.shokrySales) / n(current.shokryInvoices)
          : 0;
      }
      if (isShamy) {
        current.shamySales = n(current.shamySales) + sales;
        current.shamyInvoices = n(current.shamyInvoices) + invoices;
        current.shamyAverage = n(current.shamyInvoices)
          ? n(current.shamySales) / n(current.shamyInvoices)
          : 0;
      }
      map.set(day, current);
    });
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [endDate, startDate, state.dailySales]);

  const chartDataDays = useMemo(() => dailyChart.filter((row) => row.hasData), [dailyChart]);
  const dailyChartKeys = useMemo(() => {
    if (dailyChartMetric === 'invoices') {
      return {
        total: 'totalInvoices',
        shokry: 'shokryInvoices',
        shamy: 'shamyInvoices',
        suffix: 'فاتورة',
        title: 'عدد الفواتير اليومي',
      };
    }
    if (dailyChartMetric === 'average') {
      return {
        total: 'totalAverage',
        shokry: 'shokryAverage',
        shamy: 'shamyAverage',
        suffix: 'جنيه',
        title: 'متوسط الفاتورة اليومي',
      };
    }
    return {
      total: 'totalSales',
      shokry: 'shokrySales',
      shamy: 'shamySales',
      suffix: 'جنيه',
      title: 'صافي المبيعات اليومي',
    };
  }, [dailyChartMetric]);

  const monthlyChart = useMemo(() => {
    const monthName = new Intl.DateTimeFormat('ar-EG', { month: 'short', year: 'numeric' });
    const map = new Map<string, Record<string, unknown>>();
    monthlyTrend.forEach((row) => {
      const raw = String(row.month_start || '').slice(0, 10);
      const d = new Date(`${raw || '2026-01-01'}T12:00:00`);
      const current = map.get(raw) || {
        month_start: raw,
        label: Number.isNaN(d.getTime()) ? row.month_label || raw : monthName.format(d),
      };
      const branch = branchName(row.branch);
      current.sales_total = n(current.sales_total) + n(row.sales_total);
      current.invoices_count = n(current.invoices_count) + n(row.invoices_count);
      current.avg_invoice = n(current.invoices_count)
        ? n(current.sales_total) / n(current.invoices_count)
        : 0;
      current[branch] = n(current[branch]) + n(row.sales_total);
      map.set(raw, current);
    });
    return [...map.values()].sort((a, b) =>
      String(a.month_start).localeCompare(String(b.month_start))
    );
  }, [monthlyTrend]);

  const activeDaysCount = dailyChart.length || 1;

  const lowDoctors = useMemo(() => [...state.doctorSales].slice(-6).reverse(), [state.doctorSales]);
  const doctorsByBranch = useMemo(() => {
    const map = new Map<string, DoctorSales[]>();
    state.doctorSales.forEach((row) => {
      const key = branchName(row.branch);
      map.set(key, [...(map.get(key) || []), row]);
    });
    return map;
  }, [state.doctorSales]);

  const recentBranchPerformance = useMemo(() => {
    const map = new Map<
      string,
      {
        total: number;
        invoices: number;
        topInvoice: number;
        days: Map<string, { sales: number; invoices: number }>;
        doctors: Map<string, { sales: number; invoices: number; days: Map<string, number> }>;
      }
    >();

    state.recentInvoices.forEach((row) => {
      const day = String(row.invoice_date || '').slice(0, 10);
      const branch = branchName(row.branch);
      const amount = dashboardInvoiceAmount(row);
      if (!day || amount <= 0) return;
      const bucket = map.get(branch) || {
        total: 0,
        invoices: 0,
        topInvoice: 0,
        days: new Map(),
        doctors: new Map(),
      };
      bucket.total += amount;
      bucket.invoices += 1;
      bucket.topInvoice = Math.max(bucket.topInvoice, amount);

      const dayBucket = bucket.days.get(day) || { sales: 0, invoices: 0 };
      dayBucket.sales += amount;
      dayBucket.invoices += 1;
      bucket.days.set(day, dayBucket);

      const doctorName = String(row.seller_name || 'غير محدد').trim() || 'غير محدد';
      const doctorBucket = bucket.doctors.get(doctorName) || {
        sales: 0,
        invoices: 0,
        days: new Map<string, number>(),
      };
      doctorBucket.sales += amount;
      doctorBucket.invoices += 1;
      doctorBucket.days.set(day, n(doctorBucket.days.get(day)) + amount);
      bucket.doctors.set(doctorName, doctorBucket);
      map.set(branch, bucket);
    });

    return map;
  }, [state.recentInvoices]);

  const navigateToStaff = useCallback(
    async (name: unknown, branchValue?: unknown) => {
      const syncResult = resolveStaffLink(name, branchValue, state.staffDirectory);
      if (!syncResult.isFallback) {
        navigate(syncResult.route);
        return;
      }
      // لم يُعثر عليه في القاموس المحلي — جرّب البحث السريع في Supabase
      const asyncResult = await getStaffNavigationTarget(String(name || ''));
      navigate(asyncResult.route);
    },
    [navigate, state.staffDirectory]
  );

  const groupedOnShiftNow = useMemo(() => groupShiftMembers(state.onShiftNow), [state.onShiftNow]);
  const onShiftDoctors = useMemo(
    () => groupedOnShiftNow.filter((member) => roleGroup(member.role) === 'doctor'),
    [groupedOnShiftNow]
  );
  const onShiftAssistants = useMemo(
    () => groupedOnShiftNow.filter((member) => roleGroup(member.role) === 'assistant'),
    [groupedOnShiftNow]
  );
  const onShiftDelivery = useMemo(
    () => groupedOnShiftNow.filter((member) => roleGroup(member.role) === 'delivery'),
    [groupedOnShiftNow]
  );
  const onShiftByBranch = useMemo(() => {
    const map = new Map<string, GroupedShiftMember[]>();
    groupedOnShiftNow.forEach((member) => {
      const key = branchName(member.branch);
      map.set(key, [...(map.get(key) || []), member]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [groupedOnShiftNow]);
  const branchPerformance = useMemo(() => {
    return state.targets
      .map((target) => {
        const branch = branchName(target.branch);
        const doctors = (doctorsByBranch.get(branch) || []).slice(0, 12);
        const bestDoctor = doctors[0];
        return { target, branch, doctors, bestDoctor };
      })
      .sort((a, b) => branchName(a.target.branch).localeCompare(branchName(b.target.branch), 'ar'));
  }, [doctorsByBranch, state.targets]);
  const incentiveRows = useMemo(() => {
    if (state.incentiveSummary.length) {
      return [...state.incentiveSummary]
        .sort((a, b) => b.incentiveValue - a.incentiveValue || b.finalPoints - a.finalPoints)
        .slice(0, 10);
    }
    return [];
  }, [state.incentiveSummary]);

  const navCards = [
    {
      id: 'branch-performance',
      title: 'أداء الفروع',
      value: getSectionValue({
        value: `${branchPerformance.length || 0} فرع`,
        loading: branchPerformanceLoading,
        error: branchPerformanceError,
        loadedAt: branchPerformanceLoadedAt,
      }),
      tone: 'cyan' as const,
    },
    {
      id: 'doctor-competitions',
      title: 'مسابقة الدكاترة',
      value: doctorCompetitionLoading ? 'تحميل' : doctorCompetitionError ? 'مراجعة' : 'Top 5',
      tone: 'amber' as const,
    },
  ];

  if (!canViewExecutive) {
    return (
      <div dir="rtl" className="flex min-h-[60vh] items-center justify-center bg-[var(--dawaa-theme-bg)] p-6 text-[var(--dawaa-theme-text)]">
        <div className="max-w-md rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-6 text-center shadow-2xl">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[var(--dawaa-theme-primary-strong)]" />
          <h1 className="dawaa-title text-xl">هذه اللوحة مخصصة للإدارة</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-[var(--dawaa-theme-text)]">
            سيتم توجيهك إلى لوحة الدكتور المناسبة لصلاحياتك.
          </p>
          <button
            type="button"
            onClick={() => {
              const role = normalizeRole(user?.role);
              if (isDoctorRole(user)) return navigate('/doctor-dashboard');
              if (role === 'customer_service_manager') return navigate('/customer-service-dashboard');
              if (role === 'delivery') return navigate('/delivery');
              if (role === 'cleaning_supervisor') return navigate('/branch-cleaning');
              if (role === 'inventory_assistant') return navigate('/inventory-counts');
              return navigate('/time-off');
            }}
            className="mt-5 rounded-xl bg-[var(--dawaa-theme-accent-soft)] px-5 py-2 text-sm font-black text-[var(--dawaa-theme-heading)] hover:bg-[var(--dawaa-theme-accent-soft)]"
          >
            الانتقال الآن
          </button>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="executive-dashboard-page dawaa-page min-h-screen">
      <main className="relative mx-auto max-w-[1920px] space-y-4 px-5 py-5">
        {initialLoadTimedOut && loading && !state.loadedAt ? (
          <Panel className="border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-black text-[var(--dawaa-status-warning-text)]">تعذر تحميل بيانات لوحة القيادة بسرعة</h2>
                <p className="mt-1 text-sm font-bold text-[var(--dawaa-status-warning-text)]/80">
                  تم عرض الصفحة بالبيانات المتاحة، وستظهر أخطاء الأقسام داخل كل قسم عند الحاجة.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    noCacheRef.current = true;
                    void load();
                  }}
                  className="rounded-xl bg-[var(--dawaa-status-warning-bg)] px-4 py-2 text-sm font-black text-[var(--dawaa-theme-heading)] hover:bg-[var(--dawaa-status-warning-bg)]"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/diagnostics')}
                  className="rounded-xl border border-[var(--dawaa-status-warning-border)] px-4 py-2 text-sm font-black text-[var(--dawaa-status-warning-text)] hover:bg-[var(--dawaa-status-warning-bg)]"
                >
                  فتح التشخيص
                </button>
              </div>
            </div>
          </Panel>
        ) : null}

        {['branch_manager', 'branches_manager'].includes(role) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <BranchesManagerExceptionsPanel branchScope={scopedBranch === ALL_BRANCHES ? null : scopedBranch} />
            <ManagerLiveIncentiveCard
              evaluationType={role === 'branches_manager' ? 'branches_manager' : 'branch_manager'}
              staffId={user?.staffId || user?.id}
              branch={role === 'branches_manager' ? null : (scopedBranch === ALL_BRANCHES ? user?.branch || null : scopedBranch)}
            />
          </div>
        )}

        <Panel className="p-5">
          <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr] xl:items-center">
            <div className="order-2 xl:order-1">
              <button
                type="button"
                onClick={() => setFiltersOpen((value) => !value)}
                className="mb-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-4 py-3 text-sm font-black text-[var(--dawaa-theme-primary-strong)] xl:hidden"
              >
                <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> الفلاتر والفترة والفرع</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className={`${filtersOpen ? 'grid' : 'hidden'} gap-3 md:grid-cols-2 xl:grid xl:grid-cols-6`}>
              <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-4 py-3 text-sm font-black text-[var(--dawaa-theme-primary-strong)] hover:bg-[var(--dawaa-theme-accent-soft)]">
                <Download className="h-4 w-4" />
                تصدير
              </button>
              <button
                onClick={() => {
                  noCacheRef.current = true;
                  clearInvoiceCache();
                  clearDashboardCache();
                  void load();
                }}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[var(--dawaa-theme-accent-soft)] px-4 py-3 text-sm font-black text-[var(--dawaa-theme-primary-strong)] ring-1 ring-[var(--dawaa-theme-accent-border)] hover:bg-[var(--dawaa-theme-accent-soft)] disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                تحديث
              </button>
              <div className="relative xl:col-span-2">
                <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--dawaa-theme-muted)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="بحث سريع عن عميل، فاتورة، منتج..."
                  className="w-full rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] py-3 pr-11 pl-4 text-sm font-bold text-[var(--dawaa-theme-heading)] outline-none focus:border-[var(--dawaa-theme-accent-border)]"
                />
              </div>
              <select
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-sm font-bold text-[var(--dawaa-theme-heading)] outline-none focus:border-[var(--dawaa-theme-accent-border)]"
              >
                {branchOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => navigate('/analytics#branch-targets')}
                className="rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-4 py-3 text-sm font-black text-[var(--dawaa-status-success-text)] hover:bg-[var(--dawaa-status-success-bg)]"
              >
                تعديل تارجت الفروع
              </button>
              <button
                onClick={() => {
                  setStartDate(formatCycleDate(currentCycle.start));
                  setEndDate(formatCycleDate(currentCycle.end));
                }}
                className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-sm font-black text-[var(--dawaa-theme-text)] hover:border-[var(--dawaa-theme-accent-border)]"
              >
                الدورة الحالية
              </button>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-sm font-bold text-[var(--dawaa-theme-heading)] outline-none focus:border-[var(--dawaa-theme-accent-border)]"
              />
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-sm font-bold text-[var(--dawaa-theme-heading)] outline-none focus:border-[var(--dawaa-theme-accent-border)]"
              />
              <button
                onClick={() => {
                  setStartDate(formatCycleDate(previousCycle.start));
                  setEndDate(formatCycleDate(previousCycle.end));
                }}
                className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-sm font-black text-[var(--dawaa-theme-text)] hover:border-[var(--dawaa-theme-accent-border)]"
              >
                السابقة
              </button>
              <div className="xl:col-span-3 flex items-center gap-2 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-xs font-bold text-[var(--dawaa-theme-text)]">
                <CalendarDays className="h-4 w-4 text-[var(--dawaa-theme-primary-strong)]" />
                الفترة: {startDate} إلى {endDate}
              </div>
              <div className="xl:col-span-3 grid gap-2">
                <div className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                  آخر تحديث: {safeDateTime(state.loadedAt)}
                </div>
                <div className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-xs font-bold text-[var(--dawaa-theme-primary-strong)]">
                  {branchScopeLabel}
                </div>
              </div>
            </div>
            </div>

            <div className="order-1 text-right xl:order-2">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-4 py-1 text-xs font-black text-[var(--dawaa-theme-primary-strong)]">
                <Sparkles className="h-4 w-4" />
                Dawaa Pharmacy 2027
              </div>
              <h1 className="text-4xl font-black leading-tight tracking-tight text-[var(--dawaa-theme-heading)] md:text-5xl">
                مركز القيادة التشغيلي
              </h1>
              <p className="mt-2 text-sm font-semibold text-[var(--dawaa-theme-text)]">
                لوحة قيادة تنفيذية شاملة للمبيعات، الفروع، الموظفين، خدمة العملاء، والتشغيل.
              </p>
            </div>
          </div>
        </Panel>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {navCards.map((card) => (
            <KpiCard
              key={card.id}
              title={card.title}
              value={card.value}
              subtitle="اضغط للانتقال داخل الداشبورد"
              icon={<BarChart3 className="h-6 w-6" />}
              tone={card.tone}
              onClick={() =>
                document
                  .getElementById(card.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            />
          ))}
        </section>

        <Panel className="p-5">
          <SectionTitle
            title="مهام الفريق اليوم"
            subtitle="ملخص مهام التشغيل اليومية حسب الدور والفرع والحالة"
            icon={<ClipboardList className="h-5 w-5" />}
          />
          {teamTaskSummary && teamTaskSummary.total > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <button onClick={() => navigate('/employee-operating-system')} className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] p-4 text-right hover:bg-[var(--dawaa-theme-accent-soft)]">
                <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">إجمالي المهام</div>
                <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{count(teamTaskSummary.total)}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=completed')} className="rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-4 text-right hover:bg-[var(--dawaa-status-success-bg)]">
                <div className="text-xs font-black text-[var(--dawaa-status-success-text)]">مكتمل</div>
                <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{count(teamTaskSummary.completed)}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=late')} className="rounded-2xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 text-right hover:bg-[var(--dawaa-status-danger-bg)]">
                <div className="text-xs font-black text-[var(--dawaa-status-danger-text)]">متأخر</div>
                <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{count(teamTaskSummary.late)}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=pending')} className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 text-right hover:bg-[var(--dawaa-status-warning-bg)]">
                <div className="text-xs font-black text-[var(--dawaa-status-warning-text)]">يحتاج تدخل</div>
                <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{count(teamTaskSummary.needsIntervention)}</div>
              </button>
              <button onClick={() => navigate(teamTaskSummary.topLateRole ? `/employee-operating-system?role=${encodeURIComponent(teamTaskSummary.topLateRole)}` : '/employee-operating-system?status=late')} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 text-right hover:bg-[var(--dawaa-theme-surface)]">
                <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">أعلى دور متأخر</div>
                <div className="mt-2 truncate text-lg font-black text-[var(--dawaa-theme-heading)]">{teamTaskSummary.topLateRole || 'لا يوجد'}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=completed')} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 text-right hover:bg-[var(--dawaa-theme-surface)]">
                <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">أفضل التزام اليوم</div>
                <div className="mt-2 truncate text-lg font-black text-[var(--dawaa-theme-heading)]">{teamTaskSummary.bestCommitment || 'لا يوجد'}</div>
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-6 text-center">
              <div className="font-black text-[var(--dawaa-theme-heading)]">لم يتم إنشاء مهام اليوم بعد</div>
              <p className="mt-2 text-sm font-bold text-[var(--dawaa-theme-muted)]">{teamTaskIssue || 'افتح صفحة مهام الفريق لإنشاء مهام اليوم حسب الدور.'}</p>
              <button onClick={() => navigate('/employee-operating-system')} className="mt-4 rounded-2xl bg-[var(--dawaa-theme-accent-soft)] px-5 py-2 text-sm font-black text-[var(--dawaa-theme-heading)]">
                فتح مهام الفريق
              </button>
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <SectionTitle
            title="الموجودون الآن"
            subtitle="عرض واحد ذكي للحضور الحالي حسب الدور والفرع — التفاصيل الكاملة في صفحة الحضور"
            icon={<Clock3 className="h-5 w-5" />}
          />
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniBox label="إجمالي الموجودين" value={count(groupedOnShiftNow.length)} tone="cyan" />
            <MiniBox label="صيادلة" value={count(onShiftDoctors.length)} tone="green" />
            <MiniBox label="مساعدون" value={count(onShiftAssistants.length)} tone="blue" />
            <MiniBox label="دليفري" value={count(onShiftDelivery.length)} tone="amber" />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {[
              { label: 'الدكاترة والصيادلة', rows: onShiftDoctors, tone: 'cyan' },
              { label: 'مساعدو الصيدلي', rows: onShiftAssistants, tone: 'emerald' },
              { label: 'الدليفري', rows: onShiftDelivery, tone: 'amber' },
            ].map((group) => (
              <div key={group.label} className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-black text-[var(--dawaa-theme-heading)]">{group.label}</h3>
                  <span className="rounded-full bg-[var(--dawaa-theme-accent-soft)] px-3 py-1 text-xs font-black text-[var(--dawaa-theme-primary-strong)]">{count(group.rows.length)}</span>
                </div>
                <div className="space-y-2">
                  {group.rows.length ? group.rows.slice(0, 12).map((member) => (
                    <button
                      key={`${staffId(member)}-${staffName(member)}-${branchName(member.branch)}`}
                      onClick={() => void navigateToStaff(staffName(member), member.branch)}
                      className="w-full rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-right text-xs hover:bg-[var(--dawaa-theme-accent-soft)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <b className="block text-[var(--dawaa-theme-heading)]">{roleGroup(member.role) === 'doctor' ? normalizeDoctorName(staffName(member)) : staffName(member)}</b>
                          <span className="text-[var(--dawaa-theme-muted)]">{branchName(member.branch)} · {String(member.role || 'فريق')}</span>
                        </div>
                        <span className="text-[var(--dawaa-theme-primary-strong)]">
                          {member.shifts.map((shift, index) => (
                            <span key={index}>{index > 0 ? '، ' : ''}<ShiftTimeRange shift={shift} /></span>
                          ))}
                        </span>
                      </div>
                    </button>
                  )) : (
                    <p className="rounded-xl bg-[var(--dawaa-theme-surface)] p-4 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا يوجد أحد حاليًا.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <StaffAccountsHealthPanel />

        {!!state.errors.length && (
          <div className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-5 py-3 text-sm font-bold text-[var(--dawaa-status-warning-text)]">
            لم يتم تحميل مصدر الداشبورد v171 بالكامل. راجع رسائل Console وشغّل ملف دعم v17.1 ثم أعد
            النشر بدون كاش.
          </div>
        )}

        {diagnosticsOpen && canAllBranches && state.salesReconciliation && (
          <Panel
            className={`p-4 ${state.salesReconciliation.difference > 1 ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]' : 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'}`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-[var(--dawaa-theme-primary-strong)]">
                  Sales Data Reconciliation
                </div>
                <h3 className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">
                  صحة بيانات المبيعات من sales_invoices_live
                </h3>
                {state.salesReconciliation.difference > 1 ? (
                  <p className="mt-1 text-sm font-black text-[var(--dawaa-status-danger-text)]">
                    يوجد اختلاف بين الداشبورد ومصدر الفواتير
                  </p>
                ) : (
                  <p className="mt-1 text-sm font-bold text-[var(--dawaa-status-success-text)]">
                    الأرقام متطابقة مع معادلة SQL الداخلية.
                  </p>
                )}
              </div>
              <div className="grid gap-2 text-xs font-bold text-[var(--dawaa-theme-text)] md:grid-cols-4 xl:grid-cols-8">
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  dashboardTotal
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">{money(state.salesReconciliation.dashboardTotal, 2)}</b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  sqlEquivalentTotal
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">
                    {money(state.salesReconciliation.sqlEquivalentTotal, 2)}
                  </b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  difference
                  <br />
                  <b
                    className={
                      state.salesReconciliation.difference > 1 ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-status-success-text)]'
                    }
                  >
                    {money(state.salesReconciliation.difference, 2)}
                  </b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  invoicesCount
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">{count(state.salesReconciliation.invoicesCount)}</b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  rowsRead
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">{count(state.salesReconciliation.rowsRead)}</b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  period
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">
                    {state.salesReconciliation.selectedStartDate} /{' '}
                    {state.salesReconciliation.selectedEndDate}
                  </b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  branches
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">
                    {state.salesReconciliation.branchesIncluded.join('، ') || 'لا يوجد'}
                  </b>
                </span>
                <span className="rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2">
                  missing
                  <br />
                  <b className="text-[var(--dawaa-theme-heading)]">
                    فرع {count(state.salesReconciliation.missingBranchCount)} · دكتور{' '}
                    {count(state.salesReconciliation.missingDoctorCount)} · رقم{' '}
                    {count(state.salesReconciliation.missingInvoiceKeyCount)}
                  </b>
                </span>
              </div>
            </div>
          </Panel>
        )}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            title="صافي مبيعات الفترة"
            value={getSectionValue({
              value: `${money(summary.sales_total)} جنيه`,
              loading: salesKPILoading,
              error: salesKPIError,
              loadedAt: salesKPILoadedAt,
              timedOut: salesKPITimedOut,
            })}
            subtitle="عن الفترة المختارة"
            icon={<Wallet className="h-6 w-6" />}
            tone="amber"
            onClick={() => navigate(`/analytics?${dashboardQuery}`)}
            showAction={Boolean(salesKPIError || salesKPITimedOut)}
            onAction={reloadDashboard}
            loading={salesKPILoading && !salesKPILoadedAt}
            stale={Boolean((salesKPIError || salesKPITimedOut) && salesKPILoadedAt)}
          />
          <KpiCard
            title="عدد الفواتير"
            value={getSectionValue({
              value: count(summary.invoices_count),
              loading: salesKPILoading,
              error: salesKPIError,
              loadedAt: salesKPILoadedAt,
              timedOut: salesKPITimedOut,
            })}
            subtitle="كل الفواتير داخل الفترة"
            icon={<FileText className="h-6 w-6" />}
            tone="green"
            onClick={() => navigate(`/invoice-import?${dashboardQuery}`)}
            showAction={Boolean(salesKPIError || salesKPITimedOut)}
            onAction={reloadDashboard}
            loading={salesKPILoading && !salesKPILoadedAt}
            stale={Boolean((salesKPIError || salesKPITimedOut) && salesKPILoadedAt)}
          />
          <KpiCard
            title="متوسط الفاتورة"
            value={getSectionValue({
              value: `${money(summary.avg_invoice, 2)} جنيه`,
              loading: salesKPILoading,
              error: salesKPIError,
              loadedAt: salesKPILoadedAt,
              timedOut: salesKPITimedOut,
            })}
            subtitle="قيمة الفاتورة"
            icon={<ClipboardList className="h-6 w-6" />}
            tone="cyan"
            onClick={() => navigate(`/analytics?metric=avg-invoice&${dashboardQuery}`)}
            showAction={Boolean(salesKPIError || salesKPITimedOut)}
            onAction={reloadDashboard}
            loading={salesKPILoading && !salesKPILoadedAt}
            stale={Boolean((salesKPIError || salesKPITimedOut) && salesKPILoadedAt)}
          />
          <KpiCard
            title="العملاء المشترين"
            value={getSectionValue({
              value: count(summary.linked_customers),
              loading: salesKPILoading,
              error: salesKPIError,
              loadedAt: salesKPILoadedAt,
              timedOut: salesKPITimedOut,
            })}
            subtitle="عملاء لهم كود"
            icon={<Users className="h-6 w-6" />}
            tone="blue"
            onClick={() => navigate(`/customers?${dashboardQuery}`)}
            showAction={Boolean(salesKPIError || salesKPITimedOut)}
            onAction={reloadDashboard}
            loading={salesKPILoading && !salesKPILoadedAt}
            stale={Boolean((salesKPIError || salesKPITimedOut) && salesKPILoadedAt)}
          />
          <KpiCard
            title="نسبة ربط العملاء"
            value={getSectionValue({
              value: pct(summary.customer_link_rate_percent),
              loading: salesKPILoading,
              error: salesKPIError,
              loadedAt: salesKPILoadedAt,
              timedOut: salesKPITimedOut,
            })}
            subtitle={`${count(summary.linked_invoices)} فاتورة مرتبطة`}
            icon={<ShieldCheck className="h-6 w-6" />}
            tone="purple"
            onClick={() => navigate(`/customer-data-review?${dashboardQuery}`)}
            showAction={Boolean(salesKPIError || salesKPITimedOut)}
            onAction={reloadDashboard}
            loading={salesKPILoading && !salesKPILoadedAt}
            stale={Boolean((salesKPIError || salesKPITimedOut) && salesKPILoadedAt)}
          />
          <KpiCard
            title="الفواتير غير المسجلة"
            value={getSectionValue({
              value: count(summary.unregistered_customer_invoices),
              loading: salesKPILoading,
              error: salesKPIError,
              loadedAt: salesKPILoadedAt,
              timedOut: salesKPITimedOut,
            })}
            subtitle={`${money(summary.unregistered_customer_sales)} جنيه`}
            icon={<FileText className="h-6 w-6" />}
            tone="red"
            onClick={() => navigate(`/customer-data-review?status=unregistered&${dashboardQuery}`)}
            showAction={Boolean(salesKPIError || salesKPITimedOut)}
            onAction={reloadDashboard}
            loading={salesKPILoading && !salesKPILoadedAt}
            stale={Boolean((salesKPIError || salesKPITimedOut) && salesKPILoadedAt)}
          />
        </section>

        <DashboardDoctorCompetitionPanel
          metrics={doctorCompetition}
          loading={doctorCompetitionLoading}
          error={doctorCompetitionError}
          onNavigate={(focus) => navigate(`/doctor-competition?period=cycle&focus=${focus}`)}
          onRetry={() => setDoctorCompetitionRetryToken((token) => token + 1)}
        />

        <Panel className="p-4">
          <button
            type="button"
            onClick={() => setDiagnosticsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 text-right hover:bg-[var(--dawaa-theme-accent-soft)]"
          >
            <div>
              <div className="font-black text-[var(--dawaa-theme-heading)]">التشخيص وصحة البيانات</div>
              <div className="dawaa-caption mt-1 text-xs font-bold">مخفي افتراضيًا — افتحه فقط عند المراجعة الفنية</div>
            </div>
            <div className="flex items-center gap-2">
              {dataHealthError || dataHealthIssues.length ? (
                <span className="rounded-full bg-[var(--dawaa-status-warning-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{dataHealthError ? 'تعذر الفحص' : `${dataHealthIssues.length} مؤشر`}</span>
              ) : null}
              <span className="text-[var(--dawaa-theme-primary-strong)]">{diagnosticsOpen ? 'إخفاء' : 'عرض'}</span>
            </div>
          </button>
          {diagnosticsOpen ? (
            <div className="mt-4 space-y-4">
              <DashboardDataHealthPanel
                issues={dataHealthIssues}
                loading={dataHealthLoading}
                error={dataHealthError}
                onNavigate={(route) => navigate(route)}
                onRetry={() => setDataHealthRetryToken((token) => token + 1)}
              />
              <div className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4">
                <SectionTitle title="تشخيص تحميل الداشبورد" subtitle="حالة الأقسام الأساسية" icon={<AlertTriangle className="h-5 w-5" />} />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {[
                    { key: 'sales', label: 'sales', state: salesKPILoading ? 'loading' : salesKPIError || salesKPITimedOut ? 'error' : salesKPILoadedAt ? 'loaded' : 'loading' },
                    { key: 'staff', label: 'staff', state: staffAttendanceLoading ? 'loading' : staffAttendanceError || staffAttendanceTimedOut ? 'error' : staffAttendanceLoadedAt ? 'loaded' : 'loading' },
                    { key: 'dailyTasks', label: 'dailyTasks', state: dailyTasksLoading ? 'loading' : dailyTasksError || dailyTasksTimedOut ? 'error' : dailyTasksLoadedAt ? 'loaded' : 'loading' },
                    { key: 'competition', label: 'competition', state: doctorCompetitionLoading ? 'loading' : doctorCompetitionError ? 'error' : doctorCompetitionLoadedAt ? 'loaded' : 'loading' },
                    { key: 'health', label: 'health', state: dataHealthLoading ? 'loading' : dataHealthError ? 'error' : 'loaded' },
                  ].map((item) => (
                    <div key={item.key} className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4">
                      <div className="text-sm font-black text-[var(--dawaa-theme-heading)]">{item.label}</div>
                      <div className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-[var(--dawaa-theme-muted)]">{item.state}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <SectionTitle
              title="أداء الفروع اليومي خلال الدورة"
              subtitle="إجمالي اليوم مقارنة بفرع شكري وفرع الشامي لكل يوم"
              icon={<TrendingUp className="h-5 w-5" />}
            />
            <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-1.5">
              {(
                [
                  ['sales', 'المبيعات'],
                  ['average', 'متوسط الفاتورة'],
                  ['invoices', 'عدد الفواتير'],
                ] as Array<[DailyChartMetric, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDailyChartMetric(value)}
                  className={`rounded-xl px-4 py-2 text-xs font-black transition ${dailyChartMetric === value ? 'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary-strong)] ring-1 ring-[var(--dawaa-theme-accent-border)]' : 'text-[var(--dawaa-theme-muted)] hover:bg-[var(--dawaa-theme-surface-2)] hover:text-[var(--dawaa-theme-heading)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3 grid gap-3 md:grid-cols-3">
            <MiniBox
              label="إجمالي الفترة على الرسم"
              value={`${money(dailyChart.reduce((sum, row) => sum + n(row.totalSales), 0))} جنيه`}
              tone="cyan"
            />
            <MiniBox
              label="فرع شكري"
              value={`${money(dailyChart.reduce((sum, row) => sum + n(row.shokrySales), 0))} جنيه`}
              tone="green"
            />
            <MiniBox
              label="فرع الشامي"
              value={`${money(dailyChart.reduce((sum, row) => sum + n(row.shamySales), 0))} جنيه`}
              tone="blue"
            />
          </div>
          <PaymentTypeBreakdownCards startDate={startDate} endDate={endDate} scopedBranch={scopedBranch} />
          <div className="h-[380px] rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-3">
            {dailyChart.length && chartDataDays.length ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[var(--dawaa-theme-muted)]">
                    جارٍ تحميل الرسم...
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyChart} margin={{ top: 18, right: 12, left: 10, bottom: 26 }}>
                    <defs>
                      <linearGradient id="dsGradShokry" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
                        <stop offset="100%" stopColor="#0891b2" stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id="dsGradShamy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a78bfa" stopOpacity={1} />
                        <stop offset="100%" stopColor="#6d28d9" stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id="dsGradTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortAxisDate}
                      tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 700 }}
                      angle={-20}
                      textAnchor="end"
                      height={52}
                      axisLine={{ stroke: 'rgba(148,163,184,0.2)' }}
                      tickLine={false}
                      interval={Math.max(0, Math.floor(dailyChart.length / 10))}
                    />
                    <YAxis
                      tickFormatter={compactChartValue}
                      tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 700 }}
                      width={58}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                      formatter={(value: unknown, name: unknown) => [
                        `${n(value).toLocaleString('ar-EG', { maximumFractionDigits: dailyChartMetric === 'average' ? 2 : 0 })} ${dailyChartKeys.suffix}`,
                        name,
                      ]}
                      labelFormatter={(label: unknown) => `اليوم: ${safeDate(String(label))}`}
                      contentStyle={{
                        background: 'rgba(15, 23, 42, 0.96)',
                        border: '1px solid rgba(45, 212, 191, 0.3)',
                        borderRadius: 16,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                        color: '#f8fafc',
                        direction: 'rtl',
                        textAlign: 'right',
                        fontWeight: 800,
                      }}
                    />
                    <Legend
                      wrapperStyle={{ color: '#e2e8f0', fontWeight: 800, paddingTop: 8 }}
                      iconType="circle"
                    />
                    <Bar dataKey={dailyChartKeys.shokry} name="فرع شكري" fill="url(#dsGradShokry)" radius={[8, 8, 0, 0]} maxBarSize={26} animationDuration={600} />
                    <Bar dataKey={dailyChartKeys.shamy} name="فرع الشامي" fill="url(#dsGradShamy)" radius={[8, 8, 0, 0]} maxBarSize={26} animationDuration={600} />
                    <Area
                      type="monotone"
                      dataKey={dailyChartKeys.total}
                      fill="url(#dsGradTotal)"
                      stroke="none"
                      legendType="none"
                      isAnimationActive={false}
                      tooltipType="none"
                    />
                    <Line
                      type="monotone"
                      dataKey={dailyChartKeys.total}
                      name="إجمالي اليوم"
                      stroke="#34d399"
                      strokeWidth={3}
                      dot={{ r: 3, fill: '#34d399', strokeWidth: 0 }}
                      activeDot={{ r: 7, fill: '#34d399', stroke: '#0f172a', strokeWidth: 2 }}
                      animationDuration={700}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </Suspense>
            ) : dailyChart.length ? (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-6 text-center text-sm font-bold leading-7 text-[var(--dawaa-theme-text)]">
                لا توجد مبيعات فعلية داخل الفترة المختارة حتى الآن. تم تجهيز أيام الدورة كلها على الرسم، وستظهر القيم فور وجود فواتير.
              </div>
            ) : (
              <EmptyState
                label="لا توجد بيانات مبيعات يومية بعد"
                error={Boolean(salesKPIError || salesKPITimedOut)}
                onRetry={reloadDashboard}
              />
            )}
          </div>
          <p className="mt-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            الرسم يعرض كل أيام الفترة المختارة، والأيام بدون فواتير تظهر بصفر حتى لا يختفي اتجاه الدورة.
          </p>
        </Panel>

        <Panel className="p-5">
          <SectionTitle
            title="تحليل آخر 5 شهور"
            subtitle="مقارنة شهرية واسعة للمبيعات وعدد الفواتير"
            icon={<BarChart3 className="h-5 w-5" />}
          />
          <div className="h-[320px]">
            {monthlyTrendLoading && !monthlyTrendLoadedAt ? (
              <div className="h-full animate-pulse rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]" />
            ) : (monthlyTrendError || monthlyTrendTimedOut) && !monthlyChart.length ? (
              <EmptyState
                label="لا توجد بيانات كافية لآخر 5 شهور"
                error
                onRetry={() => setMonthlyTrendRetryToken((token) => token + 1)}
              />
            ) : monthlyChart.length ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[var(--dawaa-theme-muted)]">
                    جارٍ تحميل الرسم...
                  </div>
                }
              >
                <MonthlySalesChart data={monthlyChart} />
              </Suspense>
            ) : (
              <EmptyState label="لا توجد بيانات كافية لآخر 5 شهور" />
            )}
          </div>
          {monthlyTrendError && monthlyChart.length ? (
            <p className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.06] px-3 py-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
              <span>تعذر تحديث بيانات آخر 5 شهور (البيانات المعروضة قد تكون قديمة).</span>
              <button
                type="button"
                onClick={() => setMonthlyTrendRetryToken((token) => token + 1)}
                className="rounded-lg border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] px-2 py-1 font-black text-[var(--dawaa-status-danger-text)] hover:bg-[var(--dawaa-status-danger-bg)]"
              >
                إعادة المحاولة
              </button>
            </p>
          ) : null}
        </Panel>

        <section className="grid gap-4 xl:grid-cols-12">
          <Panel id="branch-performance" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle
              title="تحليل أداء كل فرع"
              subtitle="التارجت، المحقق، المتوقع، متوسط الشيفت اليومي، وأداء كل دكتور داخل الفرع"
              icon={<Target className="h-5 w-5" />}
            />
            <div className="space-y-4">
              {state.targets.length ? (
                state.targets.map((target) => {
                  const achievementUnknown = target.target_amount === null;
                  const achievement = n(target.achievement_percent);
                  const branchLabel = branchName(target.branch);
                  const branchDoctors = (doctorsByBranch.get(branchLabel) || []).slice(0, 12);
                  const bestDoctor = branchDoctors[0];
                  const recent = recentBranchPerformance.get(branchLabel);
                  const recentDays = recent
                    ? [...recent.days.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-5)
                    : [];
                  const recentDoctors = recent
                    ? [...recent.doctors.entries()]
                        .sort((a, b) => b[1].sales - a[1].sales)
                        .slice(0, 6)
                    : [];
                  return (
                    <div
                      key={branchLabel}
                      className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">
                          {branchName(target.branch)}
                        </h3>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-black ${achievementUnknown ? 'bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : achievement >= 90 ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : achievement >= 65 ? 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' : 'bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'}`}
                        >
                          {achievementUnknown ? 'غير متاح' : pct(achievement)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs font-bold text-[var(--dawaa-theme-text)] md:grid-cols-4">
                        <span>
                          التارجت
                          {target.target_source === 'unavailable' ? (
                            <span className="ms-1 rounded-full bg-[var(--dawaa-status-danger-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">
                              غير متاح الآن
                            </span>
                          ) : target.target_source === 'default' ? (
                            <span className="ms-1 rounded-full bg-[var(--dawaa-status-warning-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">
                              افتراضي
                            </span>
                          ) : null}
                          <br />
                          <b className="text-[var(--dawaa-theme-heading)]">
                            {target.target_amount === null ? '—' : money(target.target_amount)}
                          </b>
                        </span>
                        <span>
                          المحقق
                          <br />
                          <b className="text-[var(--dawaa-status-success-text)]">{money(target.sales_total)}</b>
                        </span>
                        <span>
                          المتوقع
                          <br />
                          <b className="text-[var(--dawaa-status-info-text)]">{money(target.projected_sales)}</b>
                        </span>
                        <span>
                          المتبقي
                          <br />
                          <b className="text-[var(--dawaa-status-warning-text)]">
                            {target.remaining_amount === null ? '—' : money(target.remaining_amount)}
                          </b>
                        </span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--dawaa-theme-surface-2)]">
                        {achievementUnknown ? (
                          <div className="h-full w-full animate-pulse rounded-full bg-[var(--dawaa-status-danger-bg)] opacity-40" />
                        ) : (
                          <div
                            className="h-full rounded-full bg-gradient-to-l "
                            style={{ width: `${Math.min(100, Math.max(0, achievement))}%` }}
                          />
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                        <span>
                          متوسط الشيفت اليومي:{' '}
                          <b className="text-[var(--dawaa-theme-heading)]">
                            {money(n(target.sales_total) / Math.max(1, activeDaysCount))}
                          </b>
                        </span>
                        <span>
                          متوسط الفاتورة:{' '}
                          <b className="text-[var(--dawaa-theme-heading)]">{money(target.avg_invoice, 2)}</b>
                        </span>
                        <span>
                          عدد الفواتير: <b className="text-[var(--dawaa-theme-heading)]">{count(target.invoices_count)}</b>
                        </span>
                        <span>
                          نسبة متوقعة:{' '}
                          <b className="text-[var(--dawaa-theme-heading)]">{pct(target.projected_achievement_percent)}</b>
                        </span>
                      </div>
                      <div className="mt-4 rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-3 text-xs font-bold text-[var(--dawaa-theme-text)]">
                        أفضل دكتور حاليا:{' '}
                        <b className="text-[var(--dawaa-theme-heading)]">{bestDoctor?.doctor_name || 'غير محدد'}</b>
                        {bestDoctor ? (
                          <span className="text-[var(--dawaa-status-success-text)]">
                            {' '}
                            · {money(bestDoctor.sales_total)} جنيه ·{' '}
                            {count(bestDoctor.invoices_count)} فاتورة
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-3 py-2 text-right text-xs font-black text-[var(--dawaa-theme-primary-strong)]">
                          <span>#</span>
                          <span>الدكتور</span>
                          <span>المبيعات</span>
                          <span>متوسط الفاتورة</span>
                          <span>عدد الفواتير</span>
                        </div>
                        {branchDoctors.map((doctor, index) => (
                          <button
                            key={`${doctor.doctor_name}-${index}`}
                            onClick={() => void navigateToStaff(doctor.doctor_name, doctor.branch)}
                            className="grid w-full grid-cols-[auto_1fr_auto_auto_auto] gap-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-right text-xs hover:bg-[var(--dawaa-theme-accent-soft)]"
                          >
                            <span className="font-black text-[var(--dawaa-theme-primary-strong)]">{index + 1}</span>
                            <span className="font-black text-[var(--dawaa-theme-heading)]">
                              {doctor.doctor_name || 'غير محدد'}
                            </span>
                            <span className="text-[var(--dawaa-status-success-text)]">
                              {money(doctor.sales_total)} جنيه
                            </span>
                            <span className="text-[var(--dawaa-status-info-text)]">
                              {money(doctor.avg_invoice, 2)} متوسط
                            </span>
                            <span className="text-[var(--dawaa-theme-text)]">
                              {count(doctor.invoices_count)} فاتورة
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h4 className="text-sm font-black text-[var(--dawaa-theme-heading)]">تحليل آخر 5 أيام</h4>
                          <span className="rounded-full bg-[var(--dawaa-status-info-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-info-text)]">
                            {recent ? `${money(recent.total)} جنيه` : 'لا توجد بيانات'}
                          </span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <MiniBox
                            label="مبيعات آخر 5 أيام"
                            value={recent ? `${money(recent.total)} جنيه` : '0 جنيه'}
                            tone="cyan"
                          />
                          <MiniBox
                            label="عدد الفواتير"
                            value={recent ? count(recent.invoices) : '0'}
                            tone="blue"
                          />
                          <MiniBox
                            label="أهم فاتورة"
                            value={recent ? `${money(recent.topInvoice)} جنيه` : '0 جنيه'}
                            tone="green"
                          />
                        </div>
                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
                          <div className="rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-3">
                            <p className="mb-2 text-xs font-black text-[var(--dawaa-theme-primary-strong)]">
                              المبيعات اليومية
                            </p>
                            <div className="space-y-2">
                              {recentDays.length ? (
                                recentDays.map(([day, row]) => (
                                  <div
                                    key={day}
                                    className="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-bold"
                                  >
                                    <span className="text-[var(--dawaa-theme-heading)]">{safeDate(day)}</span>
                                    <span className="text-[var(--dawaa-status-success-text)]">
                                      {money(row.sales)} جنيه
                                    </span>
                                    <span className="text-[var(--dawaa-theme-text)]">
                                      {count(row.invoices)} فاتورة
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-lg bg-[var(--dawaa-theme-surface)] p-3 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">
                                  لا توجد فواتير آخر 5 أيام
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-3">
                            <p className="mb-2 text-xs font-black text-[var(--dawaa-theme-primary-strong)]">
                              أداء الدكاترة آخر 5 أيام
                            </p>
                            <div className="space-y-2">
                              {recentDoctors.length ? (
                                recentDoctors.map(([doctorName, row], index) => (
                                  <button
                                    key={`${branchLabel}-${doctorName}`}
                                    onClick={() => void navigateToStaff(doctorName, branchLabel)}
                                    className="grid w-full grid-cols-[auto_1fr_auto_auto] gap-2 rounded-lg bg-[var(--dawaa-theme-surface)] px-3 py-2 text-right text-xs font-bold hover:bg-[var(--dawaa-theme-accent-soft)]"
                                  >
                                    <span className="text-[var(--dawaa-theme-primary-strong)]">{index + 1}</span>
                                    <span className="text-[var(--dawaa-theme-heading)]">{doctorName}</span>
                                    <span className="text-[var(--dawaa-status-success-text)]">
                                      {money(row.sales)} جنيه
                                    </span>
                                    <span className="text-[var(--dawaa-theme-text)]">
                                      {count(row.invoices)} فاتورة
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <p className="rounded-lg bg-[var(--dawaa-theme-surface)] p-3 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">
                                  لا توجد بيانات دكاترة آخر 5 أيام
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs font-bold text-[var(--dawaa-theme-primary-strong)]">
                        {target.manager_advice}
                      </p>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  label="لا توجد بيانات تارجت"
                  error={Boolean(salesKPIError || salesKPITimedOut)}
                  onRetry={reloadDashboard}
                />
              )}
            </div>
          </Panel>
        </section>

        <Panel className="p-5">
          <SectionTitle
            title="الأداء الأقل يحتاج متابعة"
            subtitle="أقل 6 دكاترة مبيعات في الفترة المختارة"
            icon={<AlertTriangle className="h-5 w-5" />}
          />
          <div className="space-y-2">
            {lowDoctors.length ? (
              lowDoctors.slice(0, 5).map((row, index) => (
                <button
                  key={`${row.doctor_name}-${index}`}
                  onClick={() => void navigateToStaff(row.doctor_name, row.branch)}
                  className="grid w-full grid-cols-[1fr_auto_auto] gap-2 rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2 text-right text-xs hover:bg-[var(--dawaa-theme-accent-soft)]"
                >
                  <span className="font-black text-[var(--dawaa-theme-heading)]">{row.doctor_name || 'غير محدد'}</span>
                  <span className="text-[var(--dawaa-theme-text)]">{count(row.invoices_count)} فاتورة</span>
                  <span className="text-[var(--dawaa-status-warning-text)]">{money(row.sales_total)}</span>
                </button>
              ))
            ) : (
              <p className="text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات</p>
            )}
          </div>
        </Panel>
      </main>
    </div>
  );
}

function DashboardDoctorCompetitionPanel({
  metrics,
  loading,
  error,
  onNavigate,
  onRetry,
}: {
  metrics: DoctorCompetitionMetrics | null;
  loading: boolean;
  error?: string | null;
  onNavigate: (focus: 'sales' | 'average_invoice' | 'incentive' | 'reviews' | 'overall') => void;
  onRetry: () => void;
}) {
  const [showFullRanking, setShowFullRanking] = useState(false);
  const winners = metrics?.winners;
  const topRows = metrics?.eligibleRows.length ? metrics.eligibleRows.slice(0, 5) : metrics?.rows.slice(0, 5) || [];
  const hasRows = topRows.length > 0;
  const stagnantDisabled = metrics ? !metrics.metadata.stagnantEnabled : false;
  // فشل فعلي (query/timeout) لكن معانا بيانات قديمة صالحة نعرضها — نظهر شريط تنبيه
  // مضغوط فوق البيانات المعروضة بدل ما نمسح القسم بالكامل ونجبر المستخدم يعمل Refresh.
  const showStaleWarning = Boolean(error) && hasRows;
  return (
    <Panel id="doctor-competitions" className="p-5">
      <SectionTitle
        title="مسابقات الدكاترة"
        subtitle={metrics ? `الفترة: من ${metrics.range.start} إلى ${metrics.range.end}` : 'ملخص مباشر من sales_invoices والتقييمات والمتابعات'}
        icon={<Trophy className="h-5 w-5" />}
      />
      {showStaleWarning ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
          <span>البيانات المعروضة من آخر تحميل ناجح — تعذر تحديثها الآن.</span>
          <button type="button" onClick={onRetry} className="rounded-lg border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-1 font-black text-[var(--dawaa-status-warning-text)] hover:bg-[var(--dawaa-status-warning-bg)]">
            إعادة المحاولة
          </button>
        </div>
      ) : null}
      {loading && !metrics ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-busy="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]" />
          ))}
        </div>
      ) : !hasRows && error ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--dawaa-status-danger-border)] bg-red-950/20 px-4 py-6 text-center">
          <AlertTriangle className="h-6 w-6 text-[var(--dawaa-status-danger-text)]" />
          <p className="text-sm font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل مسابقة الدكاترة الآن.</p>
          <p className="max-w-md text-xs text-[var(--dawaa-status-danger-text)]/70">{error.slice(0, 160)}</p>
          <button type="button" onClick={onRetry} className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-4 py-2 text-xs font-black text-[var(--dawaa-status-danger-text)] hover:bg-[var(--dawaa-status-danger-bg)]">
            إعادة محاولة تحميل القسم
          </button>
        </div>
      ) : !hasRows ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-4 py-6 text-center text-sm font-black text-[var(--dawaa-theme-muted)]">
          <Trophy className="h-6 w-6 text-[var(--dawaa-theme-muted)]" />
          لا توجد بيانات كافية للمسابقة في الفترة الحالية
        </div>
      ) : hasRows ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <DoctorWinnerCard
              title="بطل المبيعات"
              row={winners?.sales}
              value={
                winners?.sales && winners.sales.totalSales > 0
                  ? `${money(winners.sales.totalSales)} جنيه`
                  : metrics?.rows.length
                    ? 'لا يوجد بطل مبيعات مؤهل'
                    : 'لا توجد بيانات كافية'
              }
              detail={
                winners?.sales
                  ? `${count(winners.sales.invoices)} فاتورة · متوسط ${money(winners.sales.avgInvoice)} جنيه`
                  : metrics?.rows.length
                    ? metrics?.metadata.noWinnersReasons.join(' · ') || 'لا يوجد بطل مبيعات مؤهل'
                    : 'لا توجد بيانات كافية'
              }
              onClick={() => onNavigate('sales')}
            />
            <DoctorWinnerCard
              title="بطل متوسط الفاتورة"
              row={winners?.avgInvoice || winners?.averageInvoice}
              value={winners?.avgInvoice || winners?.averageInvoice ? `${money((winners.avgInvoice || winners.averageInvoice)!.avgInvoice)} جنيه` : `يتطلب ${MIN_AVG_INVOICE_THRESHOLD} فاتورة`}
              detail={winners?.averageInvoice ? `${count(winners.averageInvoice.invoices)} فاتورة مؤهلة` : 'لا توجد بيانات كافية للحد الأدنى'}
              onClick={() => onNavigate('average_invoice')}
            />
            <DoctorWinnerCard
              title="بطل الرواكد واللستة"
              row={stagnantDisabled ? null : winners?.stagnant || winners?.incentive}
              value={stagnantDisabled ? 'الرواكد غير مفعلة' : winners?.stagnant || winners?.incentive ? `${money((winners.stagnant || winners.incentive)!.incentiveValue)} جنيه` : 'لا توجد بيانات رواكد كافية'}
              detail={stagnantDisabled ? 'لا تدخل الرواكد في التقييم الشامل حاليًا' : winners?.stagnant || winners?.incentive ? `${count((winners.stagnant || winners.incentive)!.stagnantItems)} رواكد · ${count((winners.stagnant || winners.incentive)!.listItems)} لستة` : 'لا توجد بيانات رواكد كافية'}
              onClick={() => onNavigate('incentive')}
              trophy={stagnantDisabled ? false : Boolean(winners?.stagnant || winners?.incentive)}
            />
            <DoctorWinnerCard
              title="بطل تقييم المحادثات"
              row={winners?.conversation || winners?.reviews}
              value={winners?.conversation || winners?.reviews ? `${avgReview((winners.conversation || winners.reviews)!).toFixed(1)}/100` : 'لا توجد تقييمات كافية'}
              detail={winners?.conversation || winners?.reviews ? `${count((winners.conversation || winners.reviews)!.reviewCount)} تقييم · ${count((winners.conversation || winners.reviews)!.excellentReviews)} ممتاز` : 'لا توجد بيانات تقييم كافية'}
              onClick={() => onNavigate('reviews')}
            />
            <DoctorWinnerCard
              title="البطل الشامل"
              row={winners?.overall}
              value={winners?.overall ? `${winners.overall.overallScore.toFixed(1)} نقطة` : 'لا توجد بيانات كافية'}
              detail={stagnantDisabled ? 'المبيعات · المتوسط · التقييم · الخدمة، والرواكد غير مفعلة' : 'المبيعات 30% · المتوسط 20% · الرواكد 20% · التقييم 20% · الخدمة 10%'}
              onClick={() => onNavigate('overall')}
            />
          </div>
          <div className="mt-4 space-y-2">
            {topRows.map((row, index) => (
              <button
                type="button"
                key={`${row.staffId || row.name}-${row.branch}-${index}`}
                onClick={() => onNavigate('overall')}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2.5 text-right hover:bg-[var(--dawaa-theme-accent-soft)]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--dawaa-theme-accent-soft)] text-xs font-black text-[var(--dawaa-theme-primary-strong)]">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-black text-[var(--dawaa-theme-heading)]">{row.name}</span>
                  <span className="block text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{row.branch} · {count(row.invoices)} فاتورة · متوسط {row.avgInvoiceEligible ? `${money(row.avgInvoice)} ج` : 'غير كافٍ'}{row.reviewCount ? ` · تقييم ${avgReview(row).toFixed(1)}/100` : ''}</span>
                </span>
                <span className="text-left">
                  <span className="block text-sm font-black text-[var(--dawaa-status-success-text)]">{money(row.totalSales)} ج</span>
                  <span className="block text-[10px] font-bold text-[var(--dawaa-status-warning-text)]">{row.overallScore.toFixed(1)} نقطة</span>
                </span>
              </button>
            ))}
          </div>
          {(metrics?.eligibleRows.length || metrics?.rows.length || 0) > topRows.length ? (
            <button
              type="button"
              onClick={() => setShowFullRanking((value) => !value)}
              className="mt-3 w-full rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] py-2 text-xs font-black text-[var(--dawaa-theme-primary-strong)] hover:bg-[var(--dawaa-theme-accent-soft)]"
            >
              {showFullRanking ? 'إخفاء الترتيب الكامل' : 'عرض الترتيب الكامل'}
            </button>
          ) : null}
          {showFullRanking ? (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-accent-border)]">
              <table className="w-full min-w-[860px] text-right text-sm">
                <thead className="bg-gradient-to-l from-slate-950 via-slate-900 text-[var(--dawaa-theme-text)] shadow-[inset_0_-1px_0_rgba(103,232,249,0.22)]">
                  <tr className="border-b border-[var(--dawaa-theme-accent-border)]">
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">الترتيب</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">الدكتور</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">الفرع</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">المبيعات</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">الفواتير</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">متوسط الفاتورة</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">تقييم المحادثات</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">المتابعات المكتملة</th>
                    <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-[var(--dawaa-theme-text)]">النقاط الشاملة</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics?.eligibleRows.length ? metrics.eligibleRows : metrics?.rows || []).map((row, index) => (
                    <tr
                      key={`${row.staffId || row.name}-${row.branch}-${index}`}
                      onClick={() => onNavigate('overall')}
                      className="cursor-pointer border-t border-[var(--dawaa-theme-accent-border)] hover:bg-[var(--dawaa-theme-accent-soft)]"
                    >
                      <td className="p-3 font-black text-[var(--dawaa-theme-primary-strong)]">{index + 1}</td>
                      <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{row.name}</td>
                      <td className="p-3 text-[var(--dawaa-theme-text)]">{row.branch}</td>
                      <td className="p-3 text-[var(--dawaa-status-success-text)]">{money(row.totalSales)} جنيه</td>
                      <td className="p-3">{count(row.invoices)}</td>
                      <td className="p-3">{row.avgInvoiceEligible ? `${money(row.avgInvoice)} جنيه` : 'عدد فواتير غير كافٍ'}</td>
                      <td className="p-3">{row.reviewCount ? `${avgReview(row).toFixed(1)}/100` : 'غير متاح'}</td>
                      <td className="p-3">{count(row.completedFollowups)}</td>
                      <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.overallScore.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}

function DoctorWinnerCard({
  title,
  row,
  value,
  detail,
  onClick,
  trophy = true,
}: {
  title: string;
  row?: DoctorCompetitionScore | null;
  value: string;
  detail: string;
  onClick: () => void;
  trophy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 text-right transition hover:-translate-y-0.5 hover:border-[var(--dawaa-status-warning-border)]"
    >
      <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-status-warning-text)]">
        {trophy ? <Trophy className="h-4 w-4" /> : <PackageSearch className="h-4 w-4" />} {title}
      </div>
      <div className="mt-3 text-xl font-black text-[var(--dawaa-theme-heading)]">{row?.name || 'لا يوجد'}</div>
      <div className="dawaa-caption mt-1 text-xs font-bold">{row?.branch || 'بيانات غير كافية'}</div>
      <div className="mt-3 rounded-xl bg-[var(--dawaa-theme-surface)] px-3 py-2 text-sm font-black text-[var(--dawaa-status-warning-text)]">{value}</div>
      <p className="mt-2 min-h-10 text-xs leading-5 text-[var(--dawaa-theme-text)]">{detail}</p>
    </button>
  );
}

function DashboardDataHealthPanel({
  issues,
  loading,
  error,
  onNavigate,
  onRetry,
}: {
  issues: DataHealthIssue[];
  loading: boolean;
  error?: string | null;
  onNavigate: (route: string) => void;
  onRetry: () => void;
}) {
  const summary = summarizeDataHealth(issues);
  const actionable = issues
    .filter((issue) => issue.severity !== 'info' || (issue.count || 0) > 0)
    .sort((a, b) => {
      const rank = { danger: 3, warning: 2, info: 1 };
      return rank[b.severity] - rank[a.severity] || (b.count || 0) - (a.count || 0);
    })
    .slice(0, 8);

  return (
    <Panel id="dashboard-data-health" className="p-5">
      <div className="mb-5 flex items-start justify-between gap-4 rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-gradient-to-l via-slate-950/20 to-transparent p-4">
        <div>
          <h2 className="text-2xl font-black text-[var(--dawaa-theme-heading)] drop-shadow-sm">صحة البيانات</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-[var(--dawaa-theme-primary-strong)]/85">
            مؤشرات مختصرة وواضحة على الفواتير والعملاء والحسابات التي تحتاج مراجعة قبل التقارير.
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--dawaa-theme-accent-soft)] p-3 text-[var(--dawaa-theme-primary-strong)] ring-1 ring-[var(--dawaa-theme-accent-border)]">
          <ShieldCheck className="h-5 w-5" />
        </div>
      </div>
      {error ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
          <span>تعذر فحص صحة البيانات الآن — النتيجة الظاهرة قد تكون قديمة أو غير مكتملة، ومش معناها إن كل حاجة سليمة فعلًا.</span>
          <button type="button" onClick={onRetry} className="rounded-lg border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-1 font-black text-[var(--dawaa-status-danger-text)] hover:bg-[var(--dawaa-status-danger-bg)]">
            إعادة المحاولة
          </button>
        </div>
      ) : null}
      {loading && !issues.length ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <HealthSummaryBox label="بنود تحتاج مراجعة" value={count(summary.actionableCount)} tone={summary.status === 'ready' ? 'green' : 'amber'} />
            <HealthSummaryBox label="تحذيرات عالية" value={count(summary.dangerCount)} tone={summary.dangerCount ? 'red' : 'green'} />
            <HealthSummaryBox label="تحذيرات متوسطة" value={count(summary.warningCount)} tone={summary.warningCount ? 'amber' : 'green'} />
            <HealthSummaryBox label="سجلات متأثرة" value={count(summary.totalRecords)} tone="cyan" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {actionable.length ? (
              actionable.map((issue) => {
                const route = issue.affectedPages[0] || '/data-health';
                return (
                  <button
                    key={issue.key}
                    type="button"
                    onClick={() => onNavigate(route)}
                    className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 text-right transition hover:border-[var(--dawaa-theme-accent-border)] hover:bg-[var(--dawaa-theme-accent-soft)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-[var(--dawaa-theme-heading)]">{issue.label}</span>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-black ${issue.severity === 'danger' ? 'bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : issue.severity === 'warning' ? 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' : 'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary-strong)]'}`}>
                        {issue.source}
                      </span>
                    </div>
                    <div className="mt-3 text-2xl font-black text-[var(--dawaa-theme-heading)]">{issue.count === null ? 'غير متاح' : count(issue.count)}</div>
                    <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-[var(--dawaa-theme-text)]">{issue.error ? 'لا توجد بيانات كافية أو المصدر غير متاح حاليا.' : issue.suggestedFix}</p>
                  </button>
                );
              })
            ) : error ? (
              <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 text-sm font-bold text-[var(--dawaa-theme-muted)] md:col-span-2 xl:col-span-4">
                لا يمكن تأكيد حالة صحة البيانات حاليًا بسبب فشل الفحص أعلاه.
              </div>
            ) : (
              <div className="rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-4 text-sm font-bold text-[var(--dawaa-status-success-text)] md:col-span-2 xl:col-span-4">
                لا توجد بنود حرجة ظاهرة في ملخص صحة البيانات.
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
