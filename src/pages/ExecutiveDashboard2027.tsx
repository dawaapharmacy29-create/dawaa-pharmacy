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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadDashboardCache, saveDashboardCache, clearDashboardCache } from '@/lib/dashboard/dashboardOptimizations';
/* recharts will be dynamically imported inside the component to reduce initial bundle size */
import { supabase } from '@/lib/supabase';
import { formatCycleDate, getCurrentCycle, getPreviousCycle, getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { normalizeBranchName } from '@/lib/branch';
import { useAuth } from '@/hooks/useAuth';
import { getDashboardBranchOverride, isDoctorRole, isManagerRole } from '@/lib/security/userDataScope';
import {
  type DailyChartMetric,
  type DailyChartRow,
} from '@/components/dashboard/DailySalesChart';
import MonthlySalesChart from '@/components/dashboard/MonthlySalesChart';
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
  type DashboardSalesReconciliation,
} from '@/lib/dashboard/dashboardTruthService';
import { resolveStaffLink, getStaffNavigationTarget, staffProfilePath } from '@/lib/staff/staffIdentityResolver';
import {
  avgReview,
  getDoctorCompetitionMetrics,
  MIN_AVG_INVOICE_THRESHOLD,
  type DoctorCompetitionMetrics,
  type DoctorCompetitionScore,
} from '@/lib/doctorCompetitionMetrics';
import { loadAppDataHealthSummary, summarizeDataHealth, type DataHealthIssue } from '@/lib/dataHealth/appDataHealthService';
import { summarizeTeamTasks, type EmployeeTaskSummary } from '@/lib/employeeDailyTasks';

const ALL_BRANCHES = DASHBOARD_ALL_BRANCHES;
const COLORS = ['#2dd4bf', '#38bdf8', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444'];
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
};

type DoctorSales = {
  doctor_name?: string | null;
  branch?: string | null;
  sales_total?: number | string | null;
  invoices_count?: number | string | null;
  avg_invoice?: number | string | null;
  estimated_points?: number | string | null;
  incentive_value?: number | string | null;
};

type CustomerServiceSummary = {
  open_followups?: number | string | null;
  completed_today?: number | string | null;
  needs_manager?: number | string | null;
  avg_response_hours?: number | string | null;
  unregistered_customer_invoices?: number | string | null;
};

type CustomerServiceOwner = {
  responsible_name?: string | null;
  branch?: string | null;
  assigned_followups?: number | string | null;
  completed_today?: number | string | null;
  needs_manager?: number | string | null;
  completion_percent?: number | string | null;
};

type StaffOps = {
  active_accounts?: number | string | null;
  disabled_accounts?: number | string | null;
  pending_time_off?: number | string | null;
  absences_today?: number | string | null;
  late_today?: number | string | null;
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

type FollowupDashboardRow = {
  branch?: string | null;
  responsible_name?: string | null;
  assigned_to?: string | null;
  assigned_doctor?: string | null;
  followup_status?: string | null;
  status?: string | null;
  contact_status?: string | null;
  needs_manager?: boolean | null;
  completed_at?: string | null;
  followup_date?: string | null;
  date?: string | null;
  created_at?: string | null;
};

type DashboardState = {
  summary: SalesSummary | null;
  dailySales: DailySales[];
  monthlySales: MonthlySales[];
  branchDistribution: BranchDistribution[];
  targets: TargetRow[];
  doctorSales: DoctorSales[];
  customerService: CustomerServiceSummary | null;
  customerServiceOwners: CustomerServiceOwner[];
  staffOps: StaffOps | null;
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

async function rpcRows<T>(
  names: string[],
  params: Record<string, unknown> | undefined,
  label: string,
  errors: string[]
): Promise<T[]> {
  for (const name of names) {
    let attempts = 0;
    while (attempts < 3) {
      try {
        const { data, error } = await supabase.rpc(name, params);
        if (error) {
          attempts += 1;
          console.error(`[RPC ERROR] ${label} -> ${name} attempt=${attempts}:`, error.message || error);
          errors.push(`${label} ${name}: ${error.message || String(error)}`);
          if (attempts < 3) await new Promise((r) => setTimeout(r, 300 * attempts));
          continue;
        }
        const rowsData = rows<T>(data);
        if (rowsData.length) return rowsData;
        break;
      } catch (err) {
        attempts += 1;
        console.error(`[RPC EXCEPTION] ${label} -> ${name} attempt=${attempts}:`, err);
        errors.push(`${label} ${name}: ${err instanceof Error ? err.message : String(err)}`);
        if (attempts < 3) await new Promise((r) => setTimeout(r, 300 * attempts));
      }
    }
  }
  return [];
}

async function fetchFollowupsForDashboard(
  startDate: string,
  endDate: string,
  branch: string,
  errors: string[]
): Promise<FollowupDashboardRow[]> {
  const allRows: FollowupDashboardRow[] = [];
  const pageSize = 500;
  const maxPages = 4;

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = supabase
      .from('daily_followups')
      .select(
        'branch,responsible_name,assigned_to,assigned_doctor,followup_status,status,contact_status,needs_manager,completed_at,followup_date,date,created_at'
      )
      .gte('followup_date', startDate)
      .lte('followup_date', endDate)
      .order('followup_date', { ascending: true })
      .range(from, to);

    if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);

    const { data, error } = await query;
    if (error) {
      errors.push(`daily_followups: ${error.message}`);
      break;
    }

    const batch = (data || []) as FollowupDashboardRow[];
    allRows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return allRows;
}

function followupResponsible(row: FollowupDashboardRow) {
  return (
    String(row.responsible_name || row.assigned_to || row.assigned_doctor || 'غير محدد').trim() ||
    'غير محدد'
  );
}

function followupIsDone(row: FollowupDashboardRow) {
  const status = normalizeText(row.followup_status || row.status || row.contact_status);
  return Boolean(
    row.completed_at ||
    status.includes('تم') ||
    status.includes('مكتمل') ||
    status.includes('closed') ||
    status.includes('done') ||
    status.includes('complete')
  );
}

function followupNeedsManager(row: FollowupDashboardRow) {
  const status = normalizeText(
    `${row.followup_status || ''} ${row.status || ''} ${row.contact_status || ''}`
  );
  return Boolean(row.needs_manager || status.includes('مدير') || status.includes('manager'));
}

function buildCustomerServiceOwnersFallback(rows: FollowupDashboardRow[]): CustomerServiceOwner[] {
  const map = new Map<string, CustomerServiceOwner>();
  rows.forEach((row) => {
    const branch = branchName(row.branch);
    const responsible = followupResponsible(row);
    const key = `${branch}__${responsible}`;
    const current = map.get(key) || {
      branch,
      responsible_name: responsible,
      assigned_followups: 0,
      completed_today: 0,
      needs_manager: 0,
      completion_percent: 0,
    };
    current.assigned_followups = n(current.assigned_followups) + 1;
    if (followupIsDone(row)) current.completed_today = n(current.completed_today) + 1;
    if (followupNeedsManager(row)) current.needs_manager = n(current.needs_manager) + 1;
    current.completion_percent = n(current.assigned_followups)
      ? (n(current.completed_today) / n(current.assigned_followups)) * 100
      : 0;
    map.set(key, current);
  });

  return [...map.values()].sort((a, b) => n(b.assigned_followups) - n(a.assigned_followups));
}

function buildCustomerServiceSummaryFallback(rows: FollowupDashboardRow[]): CustomerServiceSummary {
  const completed = rows.filter(followupIsDone).length;
  const needsManager = rows.filter(followupNeedsManager).length;
  return {
    open_followups: Math.max(0, rows.length - completed),
    completed_today: completed,
    needs_manager: needsManager,
    avg_response_hours: null,
  };
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
        estimated_points: 0,
        incentive_value: 0,
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

  const doctorSales = [...doctorMap.values()].map((row) => {
    const points = Math.round(n(row.sales_total) / 1000);
    return {
      ...row,
      avg_invoice: n(row.invoices_count) ? n(row.sales_total) / n(row.invoices_count) : 0,
      estimated_points: points,
      incentive_value: points * 3,
    };
  });

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
  endDate: string
): TargetRow[] {
  const targetDefaults: Record<string, number> = {
    'فرع الشامي': 1000000,
    'فرع شكري': 1500000,
  };

  return branches.map((row) => {
    const branch = branchName(row.branch);
    const target = targetDefaults[branch] || Math.max(n(row.sales_total) * 1.25, 1);
    const achieved = n(row.sales_total);
    const projected = daysCount > 0 ? (achieved / daysCount) * 31 : achieved;
    const percent = target ? (achieved / target) * 100 : 0;
    return {
      branch,
      target_amount: target,
      sales_total: achieved,
      invoices_count: row.invoices_count,
      avg_invoice: row.avg_invoice,
      achievement_percent: percent,
      projected_sales: projected,
      projected_achievement_percent: target ? (projected / target) * 100 : 0,
      remaining_amount: Math.max(0, target - achieved),
      cash_sales: null,
      delivery_sales: null,
      manager_advice:
        percent >= 90
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
      className={`card rounded-3xl border border-cyan-300/10 bg-[#0b1d31]/85 shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur ${className}`}
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
        <h2 className="text-xl font-black text-white">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs font-bold text-slate-400">{subtitle}</p> : null}
      </div>
      {icon ? <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-200">{icon}</div> : null}
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
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  tone?: 'cyan' | 'green' | 'amber' | 'blue' | 'purple' | 'red';
  onClick?: () => void;
}) {
  const toneClass = {
    cyan: 'from-cyan-500/12 to-cyan-400/5 border-cyan-300/22',
    green: 'from-emerald-500/12 to-emerald-400/5 border-emerald-300/22',
    amber: 'from-amber-500/15 to-amber-400/5 border-amber-300/25',
    blue: 'from-sky-500/12 to-sky-400/5 border-sky-300/22',
    purple: 'from-violet-500/12 to-violet-400/5 border-violet-300/22',
    red: 'from-red-500/12 to-red-400/5 border-red-300/22',
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
      className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br ${toneClass} p-5 transition ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:border-cyan-200/45 focus:outline-none focus:ring-2 focus:ring-cyan-300/50' : ''}`}
    >
      <div className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-white/5 blur-2xl" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black text-slate-300">{title}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p>
          <p className="mt-2 text-xs font-bold text-emerald-300">{subtitle}</p>
        </div>
        <div className="rounded-2xl bg-slate-950/55 p-3 text-cyan-200">{icon}</div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-56 items-center justify-center rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/30 text-sm font-black text-slate-500">
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
    cyan: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100',
    green: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
    amber: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
    red: 'border-red-400/20 bg-red-500/10 text-red-100',
    blue: 'border-sky-400/20 bg-sky-500/10 text-sky-100',
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs font-black text-slate-300">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
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
    cyan: 'border-cyan-300/25 bg-cyan-400/12 shadow-cyan-950/20',
    green: 'border-emerald-300/25 bg-emerald-400/12 shadow-emerald-950/20',
    amber: 'border-amber-300/35 bg-amber-400/14 shadow-amber-950/20',
    red: 'border-rose-300/35 bg-rose-400/14 shadow-rose-950/20',
  }[tone];
  return (
    <div className={`rounded-3xl border p-5 shadow-lg ${classes}`}>
      <p className="text-sm font-black text-slate-100">{label}</p>
      <p className="mt-4 text-4xl font-black tracking-tight text-white drop-shadow-sm">{value}</p>
    </div>
  );
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
  const [startDate, setStartDate] = useState(() => formatCycleDate(currentCycle.start));
  const [endDate, setEndDate] = useState(() => formatCycleDate(currentCycle.end));
  const [branch, setBranch] = useState(() => {
    const overrideBranch = getDashboardBranchOverride(user as any);
    const branchValue = effectiveBranchFilter(user, overrideBranch, ALL_BRANCHES) || ALL_BRANCHES;
    return normalizeBranchName(branchValue) || ALL_BRANCHES;
  });
  const [search, setSearch] = useState('');
  const [dailyChartMetric, setDailyChartMetric] = useState<DailyChartMetric>('sales');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoadTimedOut, setInitialLoadTimedOut] = useState(false);
  // Per-section loading / error / loadedAt
  const [salesKPILoading, setSalesKPILoading] = useState(false);
  const [salesKPIError, setSalesKPIError] = useState<string | null>(null);
  const [salesKPILoadedAt, setSalesKPILoadedAt] = useState<string | null>(null);

  const [customerServiceLoading, setCustomerServiceLoading] = useState(false);
  const [customerServiceError, setCustomerServiceError] = useState<string | null>(null);
  const [customerServiceLoadedAt, setCustomerServiceLoadedAt] = useState<string | null>(null);

  const [incentivesLoading, setIncentivesLoading] = useState(false);
  const [incentivesError, setIncentivesError] = useState<string | null>(null);
  const [incentivesLoadedAt, setIncentivesLoadedAt] = useState<string | null>(null);

  const [dailyTasksLoading, setDailyTasksLoading] = useState(false);
  const [dailyTasksError, setDailyTasksError] = useState<string | null>(null);
  const [dailyTasksLoadedAt, setDailyTasksLoadedAt] = useState<string | null>(null);

  const [staffAttendanceLoading, setStaffAttendanceLoading] = useState(false);
  const [staffAttendanceError, setStaffAttendanceError] = useState<string | null>(null);
  const [staffAttendanceLoadedAt, setStaffAttendanceLoadedAt] = useState<string | null>(null);

  // branchPerformance depends on salesKPIs results
  const [branchPerformanceLoading, setBranchPerformanceLoading] = useState(false);
  const [branchPerformanceError, setBranchPerformanceError] = useState<string | null>(null);
  const [branchPerformanceLoadedAt, setBranchPerformanceLoadedAt] = useState<string | null>(null);
  const [inventoryOperationsLoading, setInventoryOperationsLoading] = useState(false);
  const [inventoryOperationsError, setInventoryOperationsError] = useState<string | null>(null);
  const [inventoryOperationsLoadedAt, setInventoryOperationsLoadedAt] = useState<string | null>(null);
  const [doctorCompetition, setDoctorCompetition] = useState<DoctorCompetitionMetrics | null>(null);
  const [doctorCompetitionLoading, setDoctorCompetitionLoading] = useState(false);
  const [competitionsLoading, setCompetitionsLoading] = useState(false);
  const [doctorCompetitionError, setDoctorCompetitionError] = useState<string | null>(null);
  const [doctorCompetitionLoadedAt, setDoctorCompetitionLoadedAt] = useState<string | null>(null);
  const [dataHealthIssues, setDataHealthIssues] = useState<DataHealthIssue[]>([]);
  const [dataHealthLoading, setDataHealthLoading] = useState(false);
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
    customerService: null,
    customerServiceOwners: [],
    staffOps: null,
    staffDirectory: [],
    onShiftNow: [],
    incentiveSummary: [],
    recentInvoices: [],
    salesReconciliation: null,
    loadedAt: null,
    errors: [],
  });

  function getSectionValue<T>({
    value,
    loading,
    error,
    loadedAt,
    fallback = '...',
  }: {
    value: T;
    loading: boolean;
    error: string | null;
    loadedAt: string | null;
    fallback?: string;
  }): T | string {
    if (error) return 'تعذر تحميل البيانات';
    if (loading && !loadedAt) return fallback;
    if (!loadedAt) return fallback;
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

    getDoctorCompetitionMetrics({
      ...doctorCompetitionParams,
      branch: scopedBranch === ALL_BRANCHES ? null : scopedBranch,
      userBranch: user?.branch,
      canSeeAllBranches: canAllBranches,
    })
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
  }, [canAllBranches, scopedBranch, startDate, endDate, user?.branch]);

  useEffect(() => {
    let mounted = true;
    setDataHealthLoading(true);
    loadAppDataHealthSummary()
      .then((issues) => {
        if (mounted) setDataHealthIssues(issues);
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('[ExecutiveDashboard2027] data health failed', error);
        if (mounted) setDataHealthIssues([]);
      })
      .finally(() => {
        if (mounted) setDataHealthLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setDailyTasksLoading(true);
    setDailyTasksError(null);
    summarizeTeamTasks(new Date().toISOString().slice(0, 10), scopedBranch, user)
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

    // orchestrate independent section fetches
    setLoading(true);
    setInitialLoadTimedOut(false);
    setLoadError(null);
    const errors: string[] = [];

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

    // CUSTOMER SERVICE block
    let customerServiceRows: CustomerServiceSummary[] = [];
    let customerServiceOwners: CustomerServiceOwner[] = [];
    let staffOpsRows: StaffOps[] = [];
    try {
      const branchParams = { p_branch: scopedBranch || ALL_BRANCHES };
      try {
        customerServiceRows = await rpcRows<CustomerServiceSummary>(
          ['get_dashboard_customer_service_summary_v171'],
          branchParams,
          'customer service',
          errors
        );
      } catch (e) {
        customerServiceRows = [];
        console.error('[Dashboard] customer service fetch failed', e);
        setCustomerServiceError(String(e instanceof Error ? e.message : e));
      }
      try {
        customerServiceOwners = await rpcRows<CustomerServiceOwner>(
          ['get_dashboard_customer_service_by_responsible_v171'],
          branchParams,
          'customer service owners',
          errors
        );
      } catch (e) {
        customerServiceOwners = [];
        console.error('[Dashboard] customer service owners fetch failed', e);
        setCustomerServiceError((prev) => prev ? prev + ' | owners failed' : String(e instanceof Error ? e.message : e));
      }
      try {
        staffOpsRows = await rpcRows<StaffOps>(
          ['get_dashboard_staff_ops_summary_v171'],
          undefined,
          'staff operations',
          errors
        );
      } catch (e) {
        staffOpsRows = [];
        console.error('[Dashboard] staff ops fetch failed', e);
      }
      setCustomerServiceLoadedAt(new Date().toISOString());
    } finally {
      // update state for customer service section
      const effectiveCustomerServiceRows = customerServiceRows.length ? customerServiceRows : [];
      const effectiveCustomerServiceOwners = customerServiceOwners.length ? customerServiceOwners : [];
      setState((prev) => ({
        ...prev,
        customerService: effectiveCustomerServiceRows[0] || null,
        customerServiceOwners: effectiveCustomerServiceOwners,
        staffOps: staffOpsRows[0] || null,
      }));
      setCustomerServiceLoading(false);
    }

    // ensure inventory section is marked as loaded for static operations cards
    setInventoryOperationsLoadedAt(new Date().toISOString());
    setInventoryOperationsLoading(false);

    // SALES KPIs block (main heavy)
    let salesTruth: any = { summary: {}, dailySales: [], branchDistribution: [], doctorSales: [], monthlySales: [], recentInvoices: [], reconciliation: {} };
    try {
      try {
        const noCache = noCacheRef.current;
        noCacheRef.current = false;
        salesTruth = await fetchDashboardSalesTruth({
          startDate,
          endDate,
          branch: scopedBranch || ALL_BRANCHES,
          errors,
          noCache,
        });
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
        const targets = createTargets(effectiveBranchDistribution, daysCount, startDate, endDate);
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

    // INCENTIVES block
    try {
      setIncentivesLoading(true);
      try {
        const incentiveSettled = await getStaffIncentiveSummaryForCycle({
          cycle: currentCycle,
          branch: scopedBranch === ALL_BRANCHES ? null : scopedBranch,
        }).then(
          (data) => ({ ok: true as const, data }),
          (error: unknown) => ({ ok: false as const, error })
        );
        if (incentiveSettled.ok) {
          setState((prev) => ({ ...prev, incentiveSummary: incentiveSettled.data }));
          setIncentivesLoadedAt(new Date().toISOString());
        } else {
          const err = 'error' in incentiveSettled ? incentiveSettled.error : null;
          setIncentivesError(err instanceof Error ? err.message : String(err));
        }
      } catch (e) {
        console.error('[Dashboard] incentives fetch failed', e);
        setIncentivesError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      setIncentivesLoading(false);
    }

    // STAFF ATTENDANCE block (staff directory, schedules, presence)
    try {
      setStaffAttendanceLoading(true);
      try {
        const [staffResult, scheduleResult, presenceResult] = await Promise.allSettled([
          supabase
            .from('staff')
            .select('id,staff_id,name,staff_name,role,branch,status,active,is_active')
            .limit(700),
          supabase
            .from('shift_schedules')
            .select('staff_id,staff_name,branch,day_name,shift_start,shift_end,is_off')
            .limit(1200),
          fetchCurrentShiftPresence(),
        ]);
        if (staffResult.status === 'rejected') errors.push(`staff: ${staffResult.reason instanceof Error ? staffResult.reason.message : String(staffResult.reason)}`);
        if (scheduleResult.status === 'rejected') errors.push(`shift_schedules: ${scheduleResult.reason instanceof Error ? scheduleResult.reason.message : String(scheduleResult.reason)}`);
        if (presenceResult.status === 'rejected') errors.push(`current presence: ${presenceResult.reason instanceof Error ? presenceResult.reason.message : String(presenceResult.reason)}`);
        if (staffResult.status === 'fulfilled' && staffResult.value.error) errors.push(`staff: ${staffResult.value.error.message}`);
        if (scheduleResult.status === 'fulfilled' && scheduleResult.value.error) errors.push(`shift_schedules: ${scheduleResult.value.error.message}`);

        const staffDirectory = (staffResult.status === 'fulfilled' ? ((staffResult.value.data || []) as StaffDirectoryRow[]) : []).filter(isActiveStaff);
        const scheduleRows = scheduleResult.status === 'fulfilled' ? ((scheduleResult.value.data || []) as ShiftScheduleRow[]) : [];
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
        const currentPresence =
          presenceResult.status === 'fulfilled'
            ? presenceResult.value
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
  }, [currentCycle, endDate, scopedBranch, startDate]);

  useEffect(() => {
    if (!user?.id) return;
    void load();
  }, [load, user?.id]);

  useEffect(() => {
    if (!loading || state.loadedAt || state.summary) return;
    const id = window.setTimeout(() => setInitialLoadTimedOut(true), 8000);
    return () => window.clearTimeout(id);
  }, [loading, state.loadedAt, state.summary]);

  const showInitialSkeleton = loading && !initialLoadTimedOut && !state.loadedAt && !state.summary;

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
  const service = state.customerService || {};
  const staff = state.staffOps || {};
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
    state.monthlySales.forEach((row) => {
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
  }, [state.monthlySales]);

  const branchPie = useMemo(
    () =>
      state.branchDistribution.map((row) => ({
        name: branchName(row.branch),
        value: n(row.sales_total),
        invoices: n(row.invoices_count),
      })),
    [state.branchDistribution]
  );
  const activeDaysCount = dailyChart.length || 1;

  const topDoctors = useMemo(() => state.doctorSales.slice(0, 12), [state.doctorSales]);
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
  const funnelData = [
    { name: 'المتابعات المفتوحة', value: Math.max(n(service.open_followups), 1), fill: '#2dd4bf' },
    {
      name: 'قيد المعالجة',
      value: Math.max(Math.round(n(service.open_followups) * 0.68), 1),
      fill: '#38bdf8',
    },
    { name: 'تحتاج مدير', value: Math.max(n(service.needs_manager), 1), fill: '#8b5cf6' },
    { name: 'مكتملة اليوم', value: Math.max(n(service.completed_today), 1), fill: '#22c55e' },
  ];

  const serviceOwners = useMemo(() => {
    const preferred = ['ضحى', 'د ضحى', 'د/ ضحى', 'دنيا', 'د دنيا', 'د/ دنيا'];
    return [...state.customerServiceOwners]
      .sort((a, b) => {
        const aName = String(a.responsible_name || '');
        const bName = String(b.responsible_name || '');
        const aPreferred = preferred.some((name) => aName.includes(name)) ? 0 : 1;
        const bPreferred = preferred.some((name) => bName.includes(name)) ? 0 : 1;
        return aPreferred - bPreferred || n(b.assigned_followups) - n(a.assigned_followups);
      })
      .slice(0, 6);
  }, [state.customerServiceOwners]);
  const serviceOwnerChart = useMemo(
    () =>
      serviceOwners.map((owner) => ({
        name: String(owner.responsible_name || 'غير محدد'),
        assigned: n(owner.assigned_followups),
        completed: n(owner.completed_today),
        manager: n(owner.needs_manager),
      })),
    [serviceOwners]
  );

  const serviceOwnersByBranch = useMemo(() => {
    const map = new Map<string, CustomerServiceOwner[]>();
    state.customerServiceOwners.forEach((owner) => {
      const key = branchName(owner.branch);
      map.set(key, [...(map.get(key) || []), owner]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [state.customerServiceOwners]);

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

  const onShiftDoctors = useMemo(
    () => state.onShiftNow.filter((member) => roleGroup(member.role) === 'doctor'),
    [state.onShiftNow]
  );
  const onShiftDelivery = useMemo(
    () => state.onShiftNow.filter((member) => roleGroup(member.role) === 'delivery'),
    [state.onShiftNow]
  );
  const onShiftByBranch = useMemo(() => {
    const map = new Map<string, ShiftNowRow[]>();
    state.onShiftNow.forEach((member) => {
      const key = branchName(member.branch);
      map.set(key, [...(map.get(key) || []), member]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [state.onShiftNow]);
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
      id: 'customer-service-analysis',
      title: 'خدمة العملاء',
      value: getSectionValue({
        value: count(service.open_followups),
        loading: customerServiceLoading,
        error: customerServiceError,
        loadedAt: customerServiceLoadedAt,
      }),
      tone: 'green' as const,
    },
    {
      id: 'operations-quality',
      title: 'التشغيل والجرد',
      value: getSectionValue({
        value: 'متابعة',
        loading: inventoryOperationsLoading,
        error: inventoryOperationsError,
        loadedAt: inventoryOperationsLoadedAt,
      }),
      tone: 'blue' as const,
    },
    {
      id: 'stagnant-list-analysis',
      title: 'الرواكد واللستة',
      value: 'تحليل',
      tone: 'amber' as const,
    },
    {
      id: 'incentives-analysis',
      title: 'الحوافز والنقاط',
      value: getSectionValue({
        value: count(topDoctors.length),
        loading: incentivesLoading,
        error: incentivesError,
        loadedAt: incentivesLoadedAt,
      }),
      tone: 'purple' as const,
    },
  ];

  if (!canViewExecutive) {
    return (
      <div dir="rtl" className="flex min-h-[60vh] items-center justify-center bg-[#06131f] p-6 text-slate-100">
        <div className="max-w-md rounded-3xl border border-cyan-300/15 bg-slate-900/80 p-6 text-center shadow-2xl">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-cyan-300" />
          <h1 className="text-xl font-black text-white">هذه اللوحة مخصصة للإدارة</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-300">
            سيتم توجيهك إلى لوحة الدكتور المناسبة لصلاحياتك.
          </p>
          <button
            type="button"
            onClick={() => navigate(isDoctorRole(user) ? '/doctor-dashboard' : '/')}
            className="mt-5 rounded-xl bg-cyan-500 px-5 py-2 text-sm font-black text-slate-950 hover:bg-cyan-400"
          >
            الانتقال الآن
          </button>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="executive-dashboard-page min-h-screen bg-[#06131f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(45,212,191,0.14),transparent_25%),radial-gradient(circle_at_82%_0%,rgba(56,189,248,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0),rgba(2,6,23,0.82))]" />
      <main className="relative mx-auto max-w-[1920px] space-y-4 px-5 py-5">
        {initialLoadTimedOut && loading && !state.loadedAt ? (
          <Panel className="border-amber-300/25 bg-amber-500/10 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-black text-amber-100">تعذر تحميل بيانات لوحة القيادة بسرعة</h2>
                <p className="mt-1 text-sm font-bold text-amber-50/80">
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
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-amber-200"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/diagnostics')}
                  className="rounded-xl border border-amber-200/40 px-4 py-2 text-sm font-black text-amber-50 hover:bg-amber-200/10"
                >
                  فتح التشخيص
                </button>
              </div>
            </div>
          </Panel>
        ) : null}
        <Panel className="p-5">
          <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr] xl:items-center">
            <div className="order-2 grid gap-3 md:grid-cols-2 xl:order-1 xl:grid-cols-6">
              <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-3 text-sm font-black text-cyan-50 hover:bg-cyan-500/25">
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
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500/20 px-4 py-3 text-sm font-black text-cyan-100 ring-1 ring-cyan-300/30 hover:bg-cyan-500/30 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                تحديث
              </button>
              <div className="relative xl:col-span-2">
                <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="بحث سريع عن عميل، فاتورة، منتج..."
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pr-11 pl-4 text-sm font-bold text-white outline-none focus:border-cyan-400"
                />
              </div>
              <select
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
              >
                {branchOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setStartDate(formatCycleDate(currentCycle.start));
                  setEndDate(formatCycleDate(currentCycle.end));
                }}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-black text-slate-200 hover:border-cyan-300/40"
              >
                الدورة الحالية
              </button>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
              />
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400"
              />
              <button
                onClick={() => {
                  setStartDate(formatCycleDate(previousCycle.start));
                  setEndDate(formatCycleDate(previousCycle.end));
                }}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-black text-slate-200 hover:border-cyan-300/40"
              >
                السابقة
              </button>
              <div className="xl:col-span-3 flex items-center gap-2 rounded-2xl border border-cyan-300/10 bg-slate-950/45 px-4 py-3 text-xs font-bold text-slate-300">
                <CalendarDays className="h-4 w-4 text-cyan-300" />
                الفترة: {startDate} إلى {endDate}
              </div>
              <div className="xl:col-span-3 grid gap-2">
                <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 px-4 py-3 text-xs font-bold text-slate-400">
                  آخر تحديث: {safeDateTime(state.loadedAt)}
                </div>
                <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 px-4 py-3 text-xs font-bold text-cyan-200">
                  {branchScopeLabel}
                </div>
              </div>
            </div>

            <div className="order-1 text-right xl:order-2">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-4 py-1 text-xs font-black text-cyan-200">
                <Sparkles className="h-4 w-4" />
                Dawaa Pharmacy 2027
              </div>
              <h1 className="text-4xl font-black leading-tight tracking-tight text-white md:text-5xl">
                مركز القيادة التشغيلي
              </h1>
              <p className="mt-2 text-sm font-semibold text-slate-300">
                لوحة قيادة تنفيذية شاملة للمبيعات، الفروع، الموظفين، خدمة العملاء، والتشغيل.
              </p>
              <div className="mt-5 flex flex-wrap justify-start gap-2 xl:justify-end">
                {['المبيعات', 'الموظفين', 'خدمة العملاء', 'الفروع', 'التشغيل'].map((tab, index) => (
                  <button
                    key={tab}
                    className={`rounded-2xl border px-5 py-2 text-sm font-black transition ${index === 0 ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-100' : 'border-slate-700/70 bg-slate-900/50 text-slate-300 hover:border-cyan-400/30'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
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
              <button onClick={() => navigate('/employee-operating-system')} className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4 text-right hover:bg-cyan-400/15">
                <div className="text-xs font-black text-cyan-100">إجمالي المهام</div>
                <div className="mt-2 text-2xl font-black text-white">{count(teamTaskSummary.total)}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=completed')} className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-right hover:bg-emerald-400/15">
                <div className="text-xs font-black text-emerald-100">مكتمل</div>
                <div className="mt-2 text-2xl font-black text-white">{count(teamTaskSummary.completed)}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=late')} className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-right hover:bg-rose-400/15">
                <div className="text-xs font-black text-rose-100">متأخر</div>
                <div className="mt-2 text-2xl font-black text-white">{count(teamTaskSummary.late)}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=pending')} className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-right hover:bg-amber-400/15">
                <div className="text-xs font-black text-amber-100">يحتاج تدخل</div>
                <div className="mt-2 text-2xl font-black text-white">{count(teamTaskSummary.needsIntervention)}</div>
              </button>
              <button onClick={() => navigate(teamTaskSummary.topLateRole ? `/employee-operating-system?role=${encodeURIComponent(teamTaskSummary.topLateRole)}` : '/employee-operating-system?status=late')} className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4 text-right hover:bg-slate-900">
                <div className="text-xs font-black text-slate-400">أعلى دور متأخر</div>
                <div className="mt-2 truncate text-lg font-black text-white">{teamTaskSummary.topLateRole || 'لا يوجد'}</div>
              </button>
              <button onClick={() => navigate('/employee-operating-system?status=completed')} className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4 text-right hover:bg-slate-900">
                <div className="text-xs font-black text-slate-400">أفضل التزام اليوم</div>
                <div className="mt-2 truncate text-lg font-black text-white">{teamTaskSummary.bestCommitment || 'لا يوجد'}</div>
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-6 text-center">
              <div className="font-black text-white">لم يتم إنشاء مهام اليوم بعد</div>
              <p className="mt-2 text-sm font-bold text-slate-400">{teamTaskIssue || 'افتح صفحة مهام الفريق لإنشاء مهام اليوم حسب الدور.'}</p>
              <button onClick={() => navigate('/employee-operating-system')} className="mt-4 rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-black text-slate-950">
                فتح مهام الفريق
              </button>
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <SectionTitle
            title="الموجودون حاليا في الشيفت"
            subtitle="حسب جدول الشيفتات الحالي، مع فصل الصيادلة عن الدليفري لمنع خلط المبيعات"
            icon={<Clock3 className="h-5 w-5" />}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-black text-white">الدكاترة والصيادلة</h3>
                <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">
                  {count(onShiftDoctors.length)}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {onShiftDoctors.length ? (
                  onShiftDoctors.slice(0, 10).map((member) => (
                    <button
                      key={`${staffId(member)}-${staffName(member)}`}
                      onClick={() => void navigateToStaff(staffName(member), member.branch)}
                      className="rounded-xl border border-cyan-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-cyan-400/10"
                    >
                      <b className="block text-white">{staffName(member)}</b>
                      <span className="text-slate-400">
                        {branchName(member.branch)} · {member.shift_start || '-'} -{' '}
                        {member.shift_end || '-'}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="rounded-xl border border-cyan-300/10 bg-slate-900/70 p-4 text-center text-xs font-bold text-slate-400">
                    لا توجد بيانات شيفت حالية.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-300/10 bg-slate-950/45 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-black text-white">الدليفري</h3>
                <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-100">
                  {count(onShiftDelivery.length)}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {onShiftDelivery.length ? (
                  onShiftDelivery.slice(0, 10).map((member) => (
                    <button
                      key={`${staffId(member)}-${staffName(member)}`}
                      onClick={() => void navigateToStaff(staffName(member), member.branch)}
                      className="rounded-xl border border-amber-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-amber-400/10"
                    >
                      <b className="block text-white">{staffName(member)}</b>
                      <span className="text-slate-400">
                        {branchName(member.branch)} · {member.shift_start || '-'} -{' '}
                        {member.shift_end || '-'}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="rounded-xl border border-amber-300/10 bg-slate-900/70 p-4 text-center text-xs font-bold text-slate-400">
                    لا توجد بيانات دليفري حالية.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Panel>

        {!!state.errors.length && (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-100">
            لم يتم تحميل مصدر الداشبورد v171 بالكامل. راجع رسائل Console وشغّل ملف دعم v17.1 ثم أعد
            النشر بدون كاش.
          </div>
        )}

        {canAllBranches && state.salesReconciliation && (
          <Panel
            className={`p-4 ${state.salesReconciliation.difference > 1 ? 'border-red-300/40 bg-red-500/10' : 'border-emerald-300/20 bg-emerald-500/5'}`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-cyan-200">
                  Sales Data Reconciliation
                </div>
                <h3 className="mt-1 text-lg font-black text-white">
                  صحة بيانات المبيعات من sales_invoices_live
                </h3>
                {state.salesReconciliation.difference > 1 ? (
                  <p className="mt-1 text-sm font-black text-red-200">
                    يوجد اختلاف بين الداشبورد ومصدر الفواتير
                  </p>
                ) : (
                  <p className="mt-1 text-sm font-bold text-emerald-200">
                    الأرقام متطابقة مع معادلة SQL الداخلية.
                  </p>
                )}
              </div>
              <div className="grid gap-2 text-xs font-bold text-slate-200 md:grid-cols-4 xl:grid-cols-8">
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  dashboardTotal
                  <br />
                  <b className="text-white">{money(state.salesReconciliation.dashboardTotal, 2)}</b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  sqlEquivalentTotal
                  <br />
                  <b className="text-white">
                    {money(state.salesReconciliation.sqlEquivalentTotal, 2)}
                  </b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  difference
                  <br />
                  <b
                    className={
                      state.salesReconciliation.difference > 1 ? 'text-red-200' : 'text-emerald-200'
                    }
                  >
                    {money(state.salesReconciliation.difference, 2)}
                  </b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  invoicesCount
                  <br />
                  <b className="text-white">{count(state.salesReconciliation.invoicesCount)}</b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  rowsRead
                  <br />
                  <b className="text-white">{count(state.salesReconciliation.rowsRead)}</b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  period
                  <br />
                  <b className="text-white">
                    {state.salesReconciliation.selectedStartDate} /{' '}
                    {state.salesReconciliation.selectedEndDate}
                  </b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  branches
                  <br />
                  <b className="text-white">
                    {state.salesReconciliation.branchesIncluded.join('، ') || 'لا يوجد'}
                  </b>
                </span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">
                  missing
                  <br />
                  <b className="text-white">
                    فرع {count(state.salesReconciliation.missingBranchCount)} · دكتور{' '}
                    {count(state.salesReconciliation.missingDoctorCount)} · رقم{' '}
                    {count(state.salesReconciliation.missingInvoiceKeyCount)}
                  </b>
                </span>
              </div>
            </div>
          </Panel>
        )}

        {loading && !state.loadedAt ? (
          <section
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
            aria-busy="true"
            aria-label="جارٍ تحميل مؤشرات الأداء"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="relative overflow-hidden rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5 animate-pulse"
              >
                <div className="mb-3 h-3 w-16 rounded-full bg-slate-700/70" />
                <div className="mb-2 h-7 w-28 rounded-xl bg-slate-700/70" />
                <div className="h-2.5 w-20 rounded-full bg-slate-700/50" />
              </div>
            ))}
          </section>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              title="صافي مبيعات الفترة"
              value={getSectionValue({
                value: `${money(summary.sales_total)} جنيه`,
                loading: salesKPILoading,
                error: salesKPIError,
                loadedAt: salesKPILoadedAt,
              })}
              subtitle="عن الفترة المختارة"
              icon={<Wallet className="h-6 w-6" />}
              tone="amber"
              onClick={() => navigate(`/analytics?${dashboardQuery}`)}
            />
            <KpiCard
              title="عدد الفواتير"
              value={getSectionValue({
                value: count(summary.invoices_count),
                loading: salesKPILoading,
                error: salesKPIError,
                loadedAt: salesKPILoadedAt,
              })}
              subtitle="كل الفواتير داخل الفترة"
              icon={<FileText className="h-6 w-6" />}
              tone="green"
              onClick={() => navigate(`/invoice-import?${dashboardQuery}`)}
            />
            <KpiCard
              title="متوسط الفاتورة"
              value={getSectionValue({
                value: `${money(summary.avg_invoice, 2)} جنيه`,
                loading: salesKPILoading,
                error: salesKPIError,
                loadedAt: salesKPILoadedAt,
              })}
              subtitle="قيمة الفاتورة"
              icon={<ClipboardList className="h-6 w-6" />}
              tone="cyan"
              onClick={() => navigate(`/analytics?metric=avg-invoice&${dashboardQuery}`)}
            />
            <KpiCard
              title="العملاء المشترين"
              value={getSectionValue({
                value: count(summary.linked_customers),
                loading: salesKPILoading,
                error: salesKPIError,
                loadedAt: salesKPILoadedAt,
              })}
              subtitle="عملاء لهم كود"
              icon={<Users className="h-6 w-6" />}
              tone="blue"
              onClick={() => navigate(`/customers?${dashboardQuery}`)}
            />
            <KpiCard
              title="نسبة ربط العملاء"
              value={getSectionValue({
                value: pct(summary.customer_link_rate_percent),
                loading: salesKPILoading,
                error: salesKPIError,
                loadedAt: salesKPILoadedAt,
              })}
              subtitle={`${count(summary.linked_invoices)} فاتورة مرتبطة`}
              icon={<ShieldCheck className="h-6 w-6" />}
              tone="purple"
              onClick={() => navigate(`/customer-data-review?${dashboardQuery}`)}
            />
            <KpiCard
              title="الفواتير غير المسجلة"
              value={getSectionValue({
                value: count(summary.unregistered_customer_invoices),
                loading: salesKPILoading,
                error: salesKPIError,
                loadedAt: salesKPILoadedAt,
              })}
              subtitle={`${money(summary.unregistered_customer_sales)} جنيه`}
              icon={<FileText className="h-6 w-6" />}
              tone="red"
              onClick={() =>
                navigate(`/customer-data-review?status=unregistered&${dashboardQuery}`)
              }
            />
          </section>
        )}

        <DashboardDoctorCompetitionPanel
          metrics={doctorCompetition}
          loading={doctorCompetitionLoading}
          onNavigate={(focus) => navigate(`/doctor-competition?period=cycle&focus=${focus}`)}
        />

        <DashboardDataHealthPanel
          issues={dataHealthIssues}
          loading={dataHealthLoading}
          onNavigate={(route) => navigate(route)}
        />

        <Panel className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <SectionTitle
              title="أداء الفروع اليومي خلال الدورة"
              subtitle="إجمالي اليوم مقارنة بفرع شكري وفرع الشامي لكل يوم"
              icon={<TrendingUp className="h-5 w-5" />}
            />
            <div className="flex flex-wrap gap-2 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-1.5">
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
                  className={`rounded-xl px-4 py-2 text-xs font-black transition ${dailyChartMetric === value ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-300/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
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
          <div className="h-[380px] rounded-3xl border border-cyan-300/10 bg-slate-950/25 p-3">
            {dailyChart.length && chartDataDays.length ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-slate-400">
                    جارٍ تحميل الرسم...
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyChart} margin={{ top: 18, right: 12, left: 10, bottom: 26 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortAxisDate}
                      tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 700 }}
                      angle={-20}
                      textAnchor="end"
                      height={52}
                      interval={Math.max(0, Math.floor(dailyChart.length / 10))}
                    />
                    <YAxis
                      tickFormatter={compactChartValue}
                      tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 700 }}
                      width={58}
                    />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [
                        `${n(value).toLocaleString('ar-EG', { maximumFractionDigits: dailyChartMetric === 'average' ? 2 : 0 })} ${dailyChartKeys.suffix}`,
                        name,
                      ]}
                      labelFormatter={(label: unknown) => `اليوم: ${safeDate(String(label))}`}
                      contentStyle={{
                        background: 'rgba(15, 23, 42, 0.96)',
                        border: '1px solid rgba(45, 212, 191, 0.25)',
                        borderRadius: 16,
                        color: '#f8fafc',
                        direction: 'rtl',
                        textAlign: 'right',
                        fontWeight: 800,
                      }}
                    />
                    <Legend wrapperStyle={{ color: '#e2e8f0', fontWeight: 800, paddingTop: 8 }} />
                    <Bar dataKey={dailyChartKeys.shokry} name="فرع شكري" fill="#22d3ee" radius={[8, 8, 0, 0]} maxBarSize={30} />
                    <Bar dataKey={dailyChartKeys.shamy} name="فرع الشامي" fill="#8b5cf6" radius={[8, 8, 0, 0]} maxBarSize={30} />
                    <Line
                      type="monotone"
                      dataKey={dailyChartKeys.total}
                      name="إجمالي اليوم"
                      stroke="#34d399"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      activeDot={{ r: 6 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </Suspense>
            ) : dailyChart.length ? (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/25 p-6 text-center text-sm font-bold leading-7 text-slate-300">
                لا توجد مبيعات فعلية داخل الفترة المختارة حتى الآن. تم تجهيز أيام الدورة كلها على الرسم، وستظهر القيم فور وجود فواتير.
              </div>
            ) : (
              <EmptyState label="لا توجد بيانات مبيعات يومية بعد" />
            )}
          </div>
          <p className="mt-3 text-xs font-bold text-slate-400">
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
            {monthlyChart.length ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-slate-400">
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
        </Panel>

        <section className="grid gap-4 xl:grid-cols-12">
          <Panel className="hidden">
            <SectionTitle
              title="توزيع المبيعات حسب الفروع"
              icon={<BarChart3 className="h-5 w-5" />}
            />
            <div className="h-[300px]">
              {branchPie.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={branchPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={110}
                      paddingAngle={3}
                    >
                      {branchPie.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => `${money(value)} جنيه`}
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid rgba(45,212,191,0.25)',
                        borderRadius: 16,
                        color: '#fff',
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState label="لا توجد بيانات فروع" />
              )}
            </div>
          </Panel>

          <Panel className="hidden">
            <SectionTitle
              title="أعلى الدكاترة في المبيعات"
              subtitle="اضغط على أي دكتور لفتح صفحة الفريق والبحث عنه"
              icon={<Users className="h-5 w-5" />}
            />
            <div className="max-h-[340px] overflow-auto rounded-2xl border border-cyan-300/10">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 bg-slate-950/90 text-xs text-slate-400">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">الموظف</th>
                    <th className="p-3">الفرع</th>
                    <th className="p-3">المبيعات</th>
                    <th className="p-3">الفواتير</th>
                    <th className="p-3">متوسط الفاتورة</th>
                  </tr>
                </thead>
                <tbody>
                  {topDoctors.length ? (
                    topDoctors.map((row, index) => (
                      <tr
                        key={`${row.doctor_name}-${row.branch}-${index}`}
                        onClick={() => void navigateToStaff(row.doctor_name, row.branch)}
                        className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8"
                      >
                        <td className="p-3 font-black text-cyan-200">{index + 1}</td>
                        <td className="p-3 font-black text-white">
                          {row.doctor_name || 'غير محدد'}
                        </td>
                        <td className="p-3 text-slate-300">{branchName(row.branch)}</td>
                        <td className="p-3 text-emerald-200">{money(row.sales_total)}</td>
                        <td className="p-3 text-slate-200">{count(row.invoices_count)}</td>
                        <td className="p-3 text-slate-200">{money(row.avg_invoice, 2)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        لا توجد بيانات دكاترة بعد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel id="branch-performance" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle
              title="تحليل أداء كل فرع"
              subtitle="التارجت، المحقق، المتوقع، متوسط الشيفت اليومي، وأداء كل دكتور داخل الفرع"
              icon={<Target className="h-5 w-5" />}
            />
            <div className="space-y-4">
              {state.targets.length ? (
                state.targets.map((target) => {
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
                      className="rounded-2xl border border-cyan-300/10 bg-slate-950/50 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-lg font-black text-white">
                          {branchName(target.branch)}
                        </h3>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-black ${achievement >= 90 ? 'bg-emerald-500/20 text-emerald-200' : achievement >= 65 ? 'bg-amber-500/20 text-amber-200' : 'bg-red-500/20 text-red-200'}`}
                        >
                          {pct(achievement)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs font-bold text-slate-300 md:grid-cols-4">
                        <span>
                          التارجت
                          <br />
                          <b className="text-white">{money(target.target_amount)}</b>
                        </span>
                        <span>
                          المحقق
                          <br />
                          <b className="text-emerald-200">{money(target.sales_total)}</b>
                        </span>
                        <span>
                          المتوقع
                          <br />
                          <b className="text-sky-200">{money(target.projected_sales)}</b>
                        </span>
                        <span>
                          المتبقي
                          <br />
                          <b className="text-amber-200">{money(target.remaining_amount)}</b>
                        </span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-emerald-400"
                          style={{ width: `${Math.min(100, Math.max(0, achievement))}%` }}
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-400">
                        <span>
                          متوسط الشيفت اليومي:{' '}
                          <b className="text-white">
                            {money(n(target.sales_total) / Math.max(1, activeDaysCount))}
                          </b>
                        </span>
                        <span>
                          متوسط الفاتورة:{' '}
                          <b className="text-white">{money(target.avg_invoice, 2)}</b>
                        </span>
                        <span>
                          عدد الفواتير: <b className="text-white">{count(target.invoices_count)}</b>
                        </span>
                        <span>
                          نسبة متوقعة:{' '}
                          <b className="text-white">{pct(target.projected_achievement_percent)}</b>
                        </span>
                      </div>
                      <div className="mt-4 rounded-2xl border border-emerald-300/10 bg-emerald-400/5 p-3 text-xs font-bold text-slate-300">
                        أفضل دكتور حاليا:{' '}
                        <b className="text-white">{bestDoctor?.doctor_name || 'غير محدد'}</b>
                        {bestDoctor ? (
                          <span className="text-emerald-200">
                            {' '}
                            · {money(bestDoctor.sales_total)} جنيه ·{' '}
                            {count(bestDoctor.invoices_count)} فاتورة
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 rounded-xl border border-cyan-300/10 bg-cyan-400/10 px-3 py-2 text-right text-xs font-black text-cyan-100">
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
                            className="grid w-full grid-cols-[auto_1fr_auto_auto_auto] gap-3 rounded-xl border border-cyan-300/10 bg-slate-900/70 px-3 py-2 text-right text-xs hover:bg-cyan-400/10"
                          >
                            <span className="font-black text-cyan-200">{index + 1}</span>
                            <span className="font-black text-white">
                              {doctor.doctor_name || 'غير محدد'}
                            </span>
                            <span className="text-emerald-200">
                              {money(doctor.sales_total)} جنيه
                            </span>
                            <span className="text-sky-200">
                              {money(doctor.avg_invoice, 2)} متوسط
                            </span>
                            <span className="text-slate-300">
                              {count(doctor.invoices_count)} فاتورة
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 rounded-2xl border border-sky-300/10 bg-sky-400/5 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h4 className="text-sm font-black text-white">تحليل آخر 5 أيام</h4>
                          <span className="rounded-full bg-sky-400/10 px-3 py-1 text-xs font-black text-sky-100">
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
                          <div className="rounded-xl border border-cyan-300/10 bg-slate-950/50 p-3">
                            <p className="mb-2 text-xs font-black text-cyan-100">
                              المبيعات اليومية
                            </p>
                            <div className="space-y-2">
                              {recentDays.length ? (
                                recentDays.map(([day, row]) => (
                                  <div
                                    key={day}
                                    className="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-xs font-bold"
                                  >
                                    <span className="text-white">{safeDate(day)}</span>
                                    <span className="text-emerald-200">
                                      {money(row.sales)} جنيه
                                    </span>
                                    <span className="text-slate-300">
                                      {count(row.invoices)} فاتورة
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-lg bg-slate-900/70 p-3 text-center text-xs font-bold text-slate-500">
                                  لا توجد فواتير آخر 5 أيام
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="rounded-xl border border-cyan-300/10 bg-slate-950/50 p-3">
                            <p className="mb-2 text-xs font-black text-cyan-100">
                              أداء الدكاترة آخر 5 أيام
                            </p>
                            <div className="space-y-2">
                              {recentDoctors.length ? (
                                recentDoctors.map(([doctorName, row], index) => (
                                  <button
                                    key={`${branchLabel}-${doctorName}`}
                                    onClick={() => void navigateToStaff(doctorName, branchLabel)}
                                    className="grid w-full grid-cols-[auto_1fr_auto_auto] gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-right text-xs font-bold hover:bg-cyan-400/10"
                                  >
                                    <span className="text-cyan-200">{index + 1}</span>
                                    <span className="text-white">{doctorName}</span>
                                    <span className="text-emerald-200">
                                      {money(row.sales)} جنيه
                                    </span>
                                    <span className="text-slate-300">
                                      {count(row.invoices)} فاتورة
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <p className="rounded-lg bg-slate-900/70 p-3 text-center text-xs font-bold text-slate-500">
                                  لا توجد بيانات دكاترة آخر 5 أيام
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs font-bold text-cyan-100">
                        {target.manager_advice}
                      </p>
                    </div>
                  );
                })
              ) : (
                <EmptyState label="لا توجد بيانات تارجت" />
              )}
            </div>
          </Panel>
        </section>

        <Panel id="operations-quality" className="p-5 scroll-mt-24">
          <SectionTitle
            title="التشغيل والمخزون والجودة"
            subtitle="تقسيم تنفيذي للنظافة، الجرد، المستلزمات، طلبات العملاء، الرواكد واللستة"
            icon={<PackageSearch className="h-5 w-5" />}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <KpiCard
              title="أداء النظافة"
              value="متابعة الفروع"
              subtitle="اضغط لفتح مراجعة النظافة"
              icon={<ShieldCheck className="h-6 w-6" />}
              tone="cyan"
              onClick={() => navigate('/branch-cleaning')}
            />
            <KpiCard
              title="أداء الجرد"
              value="مراجعة العد"
              subtitle="اضغط لفتح الجرد والفروقات"
              icon={<ClipboardList className="h-6 w-6" />}
              tone="blue"
              onClick={() => navigate('/inventory-counts')}
            />
            <KpiCard
              title="أداء المستلزمات"
              value="طلبات التشغيل"
              subtitle="اضغط لفتح المستلزمات"
              icon={<PackageSearch className="h-6 w-6" />}
              tone="purple"
              onClick={() => navigate('/supplies')}
            />
            <KpiCard
              title="طلبات العملاء"
              value={getSectionValue({
                value: count(service.open_followups),
                loading: customerServiceLoading,
                error: customerServiceError,
                loadedAt: customerServiceLoadedAt,
              })}
              subtitle="اضغط لفتح مركز خدمة العملاء"
              icon={<Headphones className="h-6 w-6" />}
              tone="green"
              onClick={() => navigate('/customer-service')}
            />
          </div>
          <div id="stagnant-list-analysis" className="mt-4 grid gap-4 xl:grid-cols-2 scroll-mt-24">
            <div className="rounded-3xl border border-amber-300/15 bg-amber-400/8 p-5">
              <SectionTitle
                title="تحليل الرواكد"
                subtitle="الأصناف الراكدة والدكاترة الأكثر مساهمة في تحريكها"
                icon={<PackageSearch className="h-5 w-5" />}
              />
              <p className="text-sm font-bold text-slate-300">
                افتح صفحة الرواكد لمراجعة الأصناف، آخر حركة، والدكتور المسؤول عن التحريك.
              </p>
              <button
                onClick={() => navigate('/stagnant-medicines')}
                className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-5 py-3 text-sm font-black text-amber-100 hover:bg-amber-400/20"
              >
                فتح تحليل الرواكد
              </button>
            </div>
            <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/8 p-5">
              <SectionTitle
                title="تحليل اللستة والحوافز"
                subtitle="الأصناف المحفزة وأثرها على نقاط الدكاترة"
                icon={<Sparkles className="h-5 w-5" />}
              />
              <p className="text-sm font-bold text-slate-300">
                افتح صفحة اللستة لمراجعة مبيعات الأصناف المحفزة وربطها بالحوافز.
              </p>
              <button
                onClick={() => navigate('/incentive-medicines')}
                className="mt-4 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-5 py-3 text-sm font-black text-emerald-100 hover:bg-emerald-400/20"
              >
                فتح تحليل اللستة
              </button>
            </div>
          </div>
        </Panel>

        <section className="grid gap-4 xl:grid-cols-12">
          <Panel id="customer-service-analysis" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle
              title="عمليات خدمة العملاء"
              subtitle="المتابعات المفتوحة والنتائج اليومية حسب المسؤولة والفرع"
              icon={<Headphones className="h-5 w-5" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <MiniBox
                label="المتابعات المفتوحة"
                value={count(service.open_followups)}
                tone="cyan"
              />
              <MiniBox label="المكتملة اليوم" value={count(service.completed_today)} tone="green" />
              <MiniBox label="تحتاج مدير" value={count(service.needs_manager)} tone="amber" />
              <MiniBox
                label="متوسط الاستجابة"
                value={
                  service.avg_response_hours == null
                    ? 'غير محدد'
                    : `${n(service.avg_response_hours)} س`
                }
                tone="blue"
              />
            </div>
            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              {serviceOwnersByBranch.length ? (
                serviceOwnersByBranch.map(([branchLabel, owners]) => {
                  const assigned = owners.reduce(
                    (sum, owner) => sum + n(owner.assigned_followups),
                    0
                  );
                  const completed = owners.reduce(
                    (sum, owner) => sum + n(owner.completed_today),
                    0
                  );
                  const manager = owners.reduce((sum, owner) => sum + n(owner.needs_manager), 0);
                  const bestOwner = [...owners].sort(
                    (a, b) => n(b.completion_percent) - n(a.completion_percent)
                  )[0];
                  const percent = assigned
                    ? (completed / assigned) * 100
                    : n(bestOwner?.completion_percent);
                  return (
                    <div
                      key={branchLabel}
                      className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black text-white">{branchLabel}</h3>
                          <p className="mt-1 text-xs font-bold text-slate-400">
                            المسؤولة الأقوى: {bestOwner?.responsible_name || 'غير محدد'}
                          </p>
                        </div>
                        <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100">
                          {pct(percent)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniBox label="مسند" value={count(assigned)} tone="cyan" />
                        <MiniBox label="مكتمل" value={count(completed)} tone="green" />
                        <MiniBox label="يحتاج مدير" value={count(manager)} tone="amber" />
                      </div>
                      <div className="mt-3 space-y-2">
                        {owners.map((owner) => (
                          <button
                            key={`${branchLabel}-${owner.responsible_name}`}
                            onClick={() =>
                              navigate(
                                `/customer-service?responsible=${encodeURIComponent(String(owner.responsible_name || ''))}&branch=${encodeURIComponent(branchLabel)}`
                              )
                            }
                            className="grid w-full grid-cols-[1fr_auto_auto_auto] gap-2 rounded-xl border border-cyan-300/10 bg-slate-900/70 px-3 py-2 text-right text-xs font-bold hover:bg-cyan-400/10"
                          >
                            <span className="font-black text-white">
                              {owner.responsible_name || 'غير محدد'}
                            </span>
                            <span className="text-cyan-200">
                              {count(owner.assigned_followups)} مسند
                            </span>
                            <span className="text-emerald-200">
                              {count(owner.completed_today)} مكتمل
                            </span>
                            <span className="text-amber-200">
                              {count(owner.needs_manager)} مدير
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-5 text-center text-sm font-bold text-slate-400 xl:col-span-2">
                  لا توجد بيانات خدمة عملاء موزعة حسب الفروع بعد.
                </div>
              )}
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-2 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-3">
                <h3 className="text-sm font-black text-white">توزيع المتابعات على الفريق</h3>
                {serviceOwners.length ? (
                  serviceOwners.map((owner, index) => {
                    const assigned = n(owner.assigned_followups);
                    const completed = n(owner.completed_today);
                    const percent = n(owner.completion_percent);
                    const ownerBranch = branchName(owner.branch);
                    const ownerName = String(owner.responsible_name || 'غير محدد');
                    return (
                      <button
                        key={`${ownerName}-${ownerBranch}-${index}`}
                        onClick={() =>
                          navigate(
                            `/customer-service?responsible=${encodeURIComponent(ownerName)}&branch=${encodeURIComponent(ownerBranch)}`
                          )
                        }
                        className="w-full rounded-xl border border-cyan-300/10 bg-slate-900/75 p-3 text-right transition hover:bg-cyan-400/10"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-white">{ownerName}</p>
                            <p className="mt-1 text-xs font-bold text-slate-400">{ownerBranch}</p>
                          </div>
                          <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">
                            {pct(percent)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-300">
                          <span>
                            مسند
                            <br />
                            <b className="text-white">{count(assigned)}</b>
                          </span>
                          <span>
                            مكتمل
                            <br />
                            <b className="text-emerald-200">{count(completed)}</b>
                          </span>
                          <span>
                            مدير
                            <br />
                            <b className="text-amber-200">{count(owner.needs_manager)}</b>
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-emerald-400"
                            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                          />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-xl border border-cyan-300/10 bg-slate-900/70 p-4 text-center text-xs font-bold text-slate-400">
                    لا توجد بيانات مسؤولي خدمة عملاء بعد تشغيل ملف الدعم.
                  </p>
                )}
              </div>
              <div className="h-64">
                {serviceOwnerChart.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={serviceOwnerChart}
                      margin={{ top: 10, right: 12, left: 12, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0f172a',
                          border: '1px solid rgba(45,212,191,0.25)',
                          borderRadius: 16,
                          color: '#fff',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="assigned" name="مسند" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="completed" name="مكتمل" fill="#2dd4bf" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="manager" name="مدير" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState label="لا توجد بيانات كافية لرسم أداء خدمة العملاء" />
                )}
              </div>
            </div>
          </Panel>

          <Panel className="hidden">
            <SectionTitle
              title="أداء الموظفين التشغيلي"
              subtitle="حضور، أذونات، وتنبيهات"
              icon={<ShieldCheck className="h-5 w-5" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <MiniBox label="الحسابات النشطة" value={count(staff.active_accounts)} tone="green" />
              <MiniBox
                label="الحسابات المقفولة"
                value={count(staff.disabled_accounts)}
                tone="red"
              />
              <MiniBox label="أذونات معلقة" value={count(staff.pending_time_off)} tone="amber" />
              <MiniBox label="غياب اليوم" value={count(staff.absences_today)} tone="blue" />
            </div>
            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
              <h3 className="mb-3 text-sm font-black text-white">الأداء الأقل يحتاج متابعة</h3>
              <div className="space-y-2">
                {lowDoctors.length ? (
                  lowDoctors.slice(0, 5).map((row, index) => (
                    <button
                      key={`${row.doctor_name}-${index}`}
                      onClick={() => void navigateToStaff(row.doctor_name, row.branch)}
                      className="grid w-full grid-cols-[1fr_auto_auto] gap-2 rounded-xl bg-slate-900/80 px-3 py-2 text-right text-xs hover:bg-cyan-400/10"
                    >
                      <span className="font-black text-white">{row.doctor_name || 'غير محدد'}</span>
                      <span className="text-slate-300">{count(row.invoices_count)} فاتورة</span>
                      <span className="text-amber-200">{money(row.sales_total)}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-center text-xs font-bold text-slate-500">لا توجد بيانات</p>
                )}
              </div>
            </div>
          </Panel>

          <Panel id="incentives-analysis" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle
              title="النقاط والحوافز"
              subtitle="مرتبط فعليا بسجل النقاط والحوافز داخل التطبيق"
              icon={<Sparkles className="h-5 w-5" />}
            />
            <div className="max-h-[520px] overflow-auto rounded-2xl border border-cyan-300/10">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 bg-slate-950/90 text-xs text-slate-400">
                  <tr>
                    <th className="p-3">الموظف</th>
                    <th className="p-3">النقاط</th>
                    <th className="p-3">قيمة الحافز</th>
                  </tr>
                </thead>
                <tbody>
                  {incentiveRows.length
                    ? incentiveRows.map((row, index) => (
                        <tr
                          key={`${row.staff.id || row.staff.name}-points-${index}`}
                          onClick={() =>
                            void (row.staff.id
                              ? navigate(staffProfilePath(row.staff))
                              : navigateToStaff(
                                  row.staff.name,
                                  (row.staff as { branch?: unknown }).branch
                                ))
                          }
                          className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8"
                        >
                          <td className="p-3 font-black text-white">
                            {row.staff.name || 'غير محدد'}
                          </td>
                          <td className="p-3 text-cyan-200">{count(row.finalPoints)}</td>
                          <td className="p-3 text-emerald-200">{money(row.incentiveValue)} جنيه</td>
                        </tr>
                      ))
                    : topDoctors.slice(0, 8).map((row, index) => {
                        const points =
                          n(row.estimated_points) || Math.round(n(row.sales_total) / 1000);
                        return (
                          <tr
                            key={`${row.doctor_name}-points-${index}`}
                            onClick={() => void navigateToStaff(row.doctor_name, row.branch)}
                            className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8"
                          >
                            <td className="p-3 font-black text-white">
                              {row.doctor_name || 'غير محدد'}
                            </td>
                            <td className="p-3 text-cyan-200">{count(points)}</td>
                            <td className="p-3 text-emerald-200">
                              {money(n(row.incentive_value) || points * 3)} جنيه
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <section className="hidden">
          <Panel className="xl:col-span-4 p-5">
            <SectionTitle
              title="عمليات خدمة العملاء"
              subtitle="المتابعات المفتوحة والنتائج اليومية"
              icon={<Headphones className="h-5 w-5" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <MiniBox
                label="المتابعات المفتوحة"
                value={count(service.open_followups)}
                tone="cyan"
              />
              <MiniBox label="المكتملة اليوم" value={count(service.completed_today)} tone="green" />
              <MiniBox label="تحتاج مدير" value={count(service.needs_manager)} tone="amber" />
              <MiniBox
                label="متوسط الاستجابة"
                value={
                  service.avg_response_hours == null
                    ? 'غير محدد'
                    : `${n(service.avg_response_hours)} س`
                }
                tone="blue"
              />
            </div>
            <div className="mt-5 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(45,212,191,0.25)',
                      borderRadius: 16,
                      color: '#fff',
                    }}
                  />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" fill="#cbd5e1" stroke="none" dataKey="name" />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="xl:col-span-4 p-5">
            <SectionTitle
              title="أداء الموظفين التشغيلي"
              subtitle="حضور، أذونات، وتنبيهات"
              icon={<ShieldCheck className="h-5 w-5" />}
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MiniBox label="الحسابات النشطة" value={count(staff.active_accounts)} tone="green" />
              <MiniBox
                label="الحسابات المقفولة"
                value={count(staff.disabled_accounts)}
                tone="red"
              />
              <MiniBox label="أذونات معلقة" value={count(staff.pending_time_off)} tone="amber" />
              <MiniBox label="غياب اليوم" value={count(staff.absences_today)} tone="blue" />
            </div>
            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
              <h3 className="mb-3 text-sm font-black text-white">الأداء الأقل يحتاج متابعة</h3>
              <div className="space-y-2">
                {lowDoctors.length ? (
                  lowDoctors.slice(0, 5).map((row, index) => (
                    <button
                      key={`${row.doctor_name}-${index}`}
                      onClick={() => void navigateToStaff(row.doctor_name, row.branch)}
                      className="grid w-full grid-cols-[1fr_auto_auto] gap-2 rounded-xl bg-slate-900/80 px-3 py-2 text-right text-xs hover:bg-cyan-400/10"
                    >
                      <span className="font-black text-white">{row.doctor_name || 'غير محدد'}</span>
                      <span className="text-slate-300">{count(row.invoices_count)} فاتورة</span>
                      <span className="text-amber-200">{money(row.sales_total)}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-center text-xs font-bold text-slate-500">لا توجد بيانات</p>
                )}
              </div>
            </div>
          </Panel>

          <Panel className="xl:col-span-4 p-5">
            <SectionTitle
              title="النقاط والحوافز"
              subtitle="ترتيب تقديري لحين ربط Ledger الحوافز النهائي"
              icon={<Sparkles className="h-5 w-5" />}
            />
            <div className="max-h-80 overflow-auto rounded-2xl border border-cyan-300/10">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 bg-slate-950/90 text-xs text-slate-400">
                  <tr>
                    <th className="p-3">الموظف</th>
                    <th className="p-3">النقاط</th>
                    <th className="p-3">قيمة تقديرية</th>
                  </tr>
                </thead>
                <tbody>
                  {topDoctors.slice(0, 8).map((row, index) => {
                    const points = n(row.estimated_points) || Math.round(n(row.sales_total) / 1000);
                    return (
                      <tr
                        key={`${row.doctor_name}-points-${index}`}
                        className="border-t border-cyan-300/10"
                      >
                        <td className="p-3 font-black text-white">
                          {row.doctor_name || 'غير محدد'}
                        </td>
                        <td className="p-3 text-cyan-200">{count(points)}</td>
                        <td className="p-3 text-emerald-200">
                          {money(n(row.incentive_value) || points * 3)} جنيه
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <Panel className="p-5">
          <SectionTitle
            title="جدول الحضور والموجودين في الشيفت"
            subtitle="تفصيل حسب كل فرع مع فصل الدور ووقت الشيفت الحالي"
            icon={<Clock3 className="h-5 w-5" />}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {onShiftByBranch.length ? (
              onShiftByBranch.map(([branchLabel, members]) => (
                <div
                  key={branchLabel}
                  className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-black text-white">{branchLabel}</h3>
                    <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">
                      {count(members.length)} على الشيفت
                    </span>
                  </div>
                  <div className="space-y-2">
                    {members.map((member) => (
                      <button
                        key={`${staffId(member)}-${staffName(member)}`}
                        onClick={() => void navigateToStaff(staffName(member), member.branch)}
                        className="grid w-full grid-cols-[1fr_auto_auto] gap-3 rounded-xl border border-cyan-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-cyan-400/10"
                      >
                        <span className="font-black text-white">{staffName(member)}</span>
                        <span className="text-slate-300">
                          {roleGroup(member.role) === 'delivery'
                            ? 'دليفري'
                            : roleGroup(member.role) === 'doctor'
                              ? 'دكتور'
                              : String(member.role || 'فريق')}
                        </span>
                        <span className="text-cyan-200">
                          {member.shift_start || '-'} - {member.shift_end || '-'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState label="لا توجد بيانات حضور أو شيفت حالية" />
            )}
          </div>
        </Panel>

        <Panel className="hidden">
          <SectionTitle
            title="المهام التشغيلية الحرجة"
            subtitle="بنود تحتاج قرار سريع من الإدارة"
            icon={<AlertTriangle className="h-5 w-5" />}
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <CriticalItem
              title="فواتير بدون ربط عميل"
              value={`${count(summary.unregistered_customer_invoices)} فاتورة`}
            />
            <CriticalItem title="خطر عدم تحقيق التارجت" value="راجع الفروع يوميًا" danger />
            <CriticalItem title="تنبيهات المخزون" value="راجع الأصناف الحرجة" />
            <CriticalItem
              title="متابعات تحتاج مدير"
              value={`${count(service.needs_manager)} متابعة`}
            />
          </div>
        </Panel>
      </main>
    </div>
  );
}

function DashboardDoctorCompetitionPanel({
  metrics,
  loading,
  onNavigate,
}: {
  metrics: DoctorCompetitionMetrics | null;
  loading: boolean;
  onNavigate: (focus: 'sales' | 'average_invoice' | 'incentive' | 'reviews' | 'overall') => void;
}) {
  const winners = metrics?.winners;
  const topRows = metrics?.eligibleRows.length ? metrics.eligibleRows.slice(0, 5) : metrics?.rows.slice(0, 5) || [];
  const hasRows = topRows.length > 0;
  const stagnantDisabled = metrics ? !metrics.metadata.stagnantEnabled : false;
  return (
    <Panel id="doctor-competitions" className="p-5">
      <SectionTitle
        title="مسابقات الدكاترة"
        subtitle={metrics ? `الفترة: من ${metrics.range.start} إلى ${metrics.range.end}` : 'ملخص مباشر من sales_invoices والتقييمات والمتابعات'}
        icon={<Trophy className="h-5 w-5" />}
      />
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-busy="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl border border-slate-700/60 bg-slate-800/40" />
          ))}
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
          <div className="mt-4 overflow-hidden rounded-2xl border border-cyan-300/10">
            <table className="w-full min-w-[860px] text-right text-sm">
              <thead className="bg-gradient-to-l from-slate-950 via-slate-900 to-cyan-950/80 text-slate-50 shadow-[inset_0_-1px_0_rgba(103,232,249,0.22)]">
                <tr className="border-b border-cyan-300/20">
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">الترتيب</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">الدكتور</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">الفرع</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">المبيعات</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">الفواتير</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">متوسط الفاتورة</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">تقييم المحادثات</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">المتابعات المكتملة</th>
                  <th className="px-4 py-3 text-right text-xs font-black tracking-wide text-slate-50">النقاط الشاملة</th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((row, index) => (
                  <tr
                    key={`${row.name}-${row.branch}-${index}`}
                    onClick={() => onNavigate('overall')}
                    className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8"
                  >
                    <td className="p-3 font-black text-cyan-200">{index + 1}</td>
                    <td className="p-3 font-black text-white">{row.name}</td>
                    <td className="p-3 text-slate-300">{row.branch}</td>
                    <td className="p-3 text-emerald-200">{money(row.totalSales)} جنيه</td>
                    <td className="p-3">{count(row.invoices)}</td>
                    <td className="p-3">{row.avgInvoiceEligible ? `${money(row.avgInvoice)} جنيه` : 'عدد فواتير غير كافٍ'}</td>
                    <td className="p-3">{row.reviewCount ? `${avgReview(row).toFixed(1)}/100` : 'غير متاح'}</td>
                    <td className="p-3">{count(row.completedFollowups)}</td>
                    <td className="p-3 font-black text-amber-200">{row.overallScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState label="لا توجد بيانات كافية لمسابقات الدكاترة في الفترة الحالية" />
      )}
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
      className="rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4 text-right transition hover:-translate-y-0.5 hover:border-amber-200/50"
    >
      <div className="flex items-center gap-2 text-xs font-black text-amber-200">
        {trophy ? <Trophy className="h-4 w-4" /> : <PackageSearch className="h-4 w-4" />} {title}
      </div>
      <div className="mt-3 text-xl font-black text-white">{row?.name || 'لا يوجد'}</div>
      <div className="mt-1 text-xs font-bold text-slate-400">{row?.branch || 'بيانات غير كافية'}</div>
      <div className="mt-3 rounded-xl bg-slate-950/55 px-3 py-2 text-sm font-black text-amber-100">{value}</div>
      <p className="mt-2 min-h-10 text-xs leading-5 text-slate-300">{detail}</p>
    </button>
  );
}

function DashboardDataHealthPanel({
  issues,
  loading,
  onNavigate,
}: {
  issues: DataHealthIssue[];
  loading: boolean;
  onNavigate: (route: string) => void;
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
      <div className="mb-5 flex items-start justify-between gap-4 rounded-3xl border border-cyan-300/10 bg-gradient-to-l from-cyan-400/10 via-slate-950/20 to-transparent p-4">
        <div>
          <h2 className="text-2xl font-black text-white drop-shadow-sm">صحة البيانات</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-cyan-50/85">
            مؤشرات مختصرة وواضحة على الفواتير والعملاء والحسابات التي تحتاج مراجعة قبل التقارير.
          </p>
        </div>
        <div className="rounded-2xl bg-cyan-300/15 p-3 text-cyan-100 ring-1 ring-cyan-200/20">
          <ShieldCheck className="h-5 w-5" />
        </div>
      </div>
      {loading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl border border-slate-700/60 bg-slate-800/40" />
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
                    className="rounded-2xl border border-cyan-300/15 bg-slate-950/55 p-4 text-right transition hover:border-cyan-200/35 hover:bg-cyan-400/10"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-white">{issue.label}</span>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-black ${issue.severity === 'danger' ? 'bg-red-500/15 text-red-200' : issue.severity === 'warning' ? 'bg-amber-500/15 text-amber-200' : 'bg-cyan-500/15 text-cyan-200'}`}>
                        {issue.source}
                      </span>
                    </div>
                    <div className="mt-3 text-2xl font-black text-white">{issue.count === null ? 'غير متاح' : count(issue.count)}</div>
                    <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-300">{issue.error ? 'لا توجد بيانات كافية أو المصدر غير متاح حاليا.' : issue.suggestedFix}</p>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-emerald-300/15 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-100 md:col-span-2 xl:col-span-4">
                لا توجد بنود حرجة ظاهرة في ملخص صحة البيانات.
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function CriticalItem({
  title,
  value,
  danger = false,
}: {
  title: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-2xl border p-4 ${danger ? 'border-red-400/25 bg-red-500/10' : 'border-cyan-300/10 bg-slate-900/60'}`}
    >
      <div>
        <p className="font-black text-white">{title}</p>
        <p className="mt-1 text-sm font-bold text-slate-300">{value}</p>
      </div>
      <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10">
        معالجة الآن
      </button>
    </div>
  );
}
