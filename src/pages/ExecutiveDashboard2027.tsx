import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearInvoiceCache } from "@/lib/invoiceCache";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Headphones,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from "@/lib/pharmacy-cycle";
import { normalizeBranchName } from "@/lib/branch";
import { useAuth } from "@/hooks/useAuth";
import DailySalesChart from "@/components/dashboard/DailySalesChart";
import MonthlySalesChart from "@/components/dashboard/MonthlySalesChart";
import { canSeeAllBranches, effectiveBranchFilter } from "@/lib/security/permissionScopes";
import { DAYS_AR } from "@/lib/constants";
import { isCurrentlyOnShift } from "@/lib/utils";
import { fetchCurrentShiftPresence } from "@/lib/attendance/currentShiftPresenceService";
import { getStaffIncentiveSummaryForCycle, type StaffCycleIncentive } from "@/lib/staffIncentiveService";
import {
  DASHBOARD_ALL_BRANCHES,
  dashboardInvoiceAmount,
  fetchDashboardSalesTruth,
  type DashboardSalesReconciliation,
} from "@/lib/dashboard/dashboardTruthService";
import { resolveStaffLink, getStaffNavigationTarget } from "@/lib/staff/staffIdentityResolver";

const ALL_BRANCHES = DASHBOARD_ALL_BRANCHES;
const COLORS = ["#2dd4bf", "#38bdf8", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444"];
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
  return n(value).toLocaleString("ar-EG", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function count(value: unknown) {
  return n(value).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
}

function pct(value: unknown, digits = 1) {
  return `${n(value).toLocaleString("ar-EG", { maximumFractionDigits: digits })}%`;
}

function branchName(branch?: string | null) {
  return normalizeBranchName(branch || "") || "غير محدد";
}

function staffName(row: StaffDirectoryRow | ShiftNowRow) {
  return String(row.name || row.staff_name || "").trim();
}

function staffId(row: StaffDirectoryRow | ShiftNowRow) {
  return String(row.id || row.staff_id || "").trim();
}

function staffNameMatches(memberName: unknown, targetName: unknown) {
  const member = staffLookupKey(memberName);
  const target = staffLookupKey(targetName);
  if (!member || !target) return false;
  return member === target || member.includes(target) || target.includes(member);
}

function isActiveStaff(row: StaffDirectoryRow) {
  const status = normalizeText(row.status);
  return row.active !== false && row.is_active !== false && !status.includes("موقوف") && !status.includes("inactive");
}

function roleGroup(role: unknown) {
  const normalized = normalizeText(role);
  if (normalized.includes("توصيل") || normalized.includes("دليفري") || normalized.includes("delivery")) return "delivery";
  if (normalized.includes("صيد") || normalized.includes("دكتور") || normalized.includes("doctor") || normalized.includes("pharmacist")) return "doctor";
  return "other";
}

function safeDate(value?: string | null) {
  const raw = String(value || "").slice(0, 10);
  if (!raw) return "غير محدد";
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function safeDateTime(value?: string | null) {
  if (!value) return "لم يتم التحديث";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "لم يتم التحديث";
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\.\/\\()\[\]{}:_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function staffLookupKey(value: unknown) {
  return normalizeText(value)
    .replace(/^(د|دكتور|الدكتور)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function invoiceAmount(row: InvoiceRow) {
  return dashboardInvoiceAmount(row);
}

function invoiceDate(row: InvoiceRow) {
  return String(row.invoice_date || "").slice(0, 10);
}

function invoiceIdentityKey(row: InvoiceRow) {
  return String(row.invoice_no ?? row.invoice_number ?? row.id ?? "").trim();
}

function isLinkedInvoice(row: InvoiceRow) {
  const code = String(row.customer_code ?? "").trim();
  const name = normalizeText(row.customer_name);
  return Boolean(code && !["0", "null", "NULL", "-"].includes(code) && !name.includes("عميل غير مسجل") && !name.includes("غير مسجل"));
}

function isDoctorName(name: unknown) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  const blocked = ["احمد البطل", "احمد وجيه", "محمد حافظ", "محمود", "مدحت", "مصطفي", "مصطفى", "يوسف عصام", "اسلام", "حسين", "محمد سالم", "محمد شماته", "يوسف عيد", "يوسف ماهر"];
  if (blocked.some((item) => normalized === normalizeText(item))) return false;
  if (normalized.includes("دليفري") || normalized.includes("مندوب") || normalized.includes("توصيل")) return false;
  return true;
}

function rows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") return [data as T];
  return [];
}

async function rpcRows<T>(names: string[], params: Record<string, unknown> | undefined, label: string, errors: string[]): Promise<T[]> {
  for (const name of names) {
    const { data, error } = await supabase.rpc(name, params);
    if (error) {
      errors.push(`${label}: ${error.message}`);
      continue;
    }
    const rowsData = rows<T>(data);
    if (rowsData.length) return rowsData;
  }
  return [];
}

async function fetchFollowupsForDashboard(startDate: string, endDate: string, branch: string, errors: string[]): Promise<FollowupDashboardRow[]> {
  const allRows: FollowupDashboardRow[] = [];
  const pageSize = 1000;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = supabase
      .from("daily_followups")
      .select("*")
      .gte("followup_date", startDate)
      .lte("followup_date", endDate)
      .order("followup_date", { ascending: true })
      .range(from, to);

    if (branch !== ALL_BRANCHES) query = query.eq("branch", branch);

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
  return String(row.responsible_name || row.assigned_to || row.assigned_doctor || "غير محدد").trim() || "غير محدد";
}

function followupIsDone(row: FollowupDashboardRow) {
  const status = normalizeText(row.followup_status || row.status || row.contact_status);
  return Boolean(row.completed_at || status.includes("تم") || status.includes("مكتمل") || status.includes("closed") || status.includes("done") || status.includes("complete"));
}

function followupNeedsManager(row: FollowupDashboardRow) {
  const status = normalizeText(`${row.followup_status || ""} ${row.status || ""} ${row.contact_status || ""}`);
  return Boolean(row.needs_manager || status.includes("مدير") || status.includes("manager"));
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
    current.completion_percent = n(current.assigned_followups) ? (n(current.completed_today) / n(current.assigned_followups)) * 100 : 0;
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
  const unlinkedInvoiceKeys = new Set(invoiceRows.filter((row) => !isLinkedInvoice(row)).map(invoiceIdentityKey).filter(Boolean));
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
    const daily = daysMap.get(dailyKey) || { sale_date: day, branch, daily_sales: 0, invoices_count: 0 };
    daily.daily_sales = n(daily.daily_sales) + amount;
    if (!dayInvoiceKeys.has(dailyKey)) dayInvoiceKeys.set(dailyKey, new Set());
    if (key) dayInvoiceKeys.get(dailyKey)?.add(key);
    daily.invoices_count = dayInvoiceKeys.get(dailyKey)?.size || 0;
    daysMap.set(dailyKey, daily);

    const branchRow = branchMap.get(branch) || { branch, sales_total: 0, invoices_count: 0, avg_invoice: 0, linked_customers: 0 };
    branchRow.sales_total = n(branchRow.sales_total) + amount;
    if (!branchInvoiceKeys.has(branch)) branchInvoiceKeys.set(branch, new Set());
    if (key) branchInvoiceKeys.get(branch)?.add(key);
    branchRow.invoices_count = branchInvoiceKeys.get(branch)?.size || 0;
    branchMap.set(branch, branchRow);

    const month = day.slice(0, 7);
    if (month) {
      const monthKey = `${month}__${branch}`;
      const monthRow = monthMap.get(monthKey) || { month_start: `${month}-01`, month_label: month, branch, sales_total: 0, invoices_count: 0, avg_invoice: 0 };
      monthRow.sales_total = n(monthRow.sales_total) + amount;
      if (!monthInvoiceKeys.has(monthKey)) monthInvoiceKeys.set(monthKey, new Set());
      if (key) monthInvoiceKeys.get(monthKey)?.add(key);
      monthRow.invoices_count = monthInvoiceKeys.get(monthKey)?.size || 0;
      monthMap.set(monthKey, monthRow);
    }

    if (isDoctorName(row.seller_name)) {
      const doctor = String(row.seller_name || "").trim();
      const doctorKey = `${doctor}__${branch}`;
      const doctorRow = doctorMap.get(doctorKey) || { doctor_name: doctor, branch, sales_total: 0, invoices_count: 0, avg_invoice: 0, estimated_points: 0, incentive_value: 0 };
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
    customersByBranch.get(branch)?.add(String(row.customer_code || "").trim());
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
      unregistered_customer_sales: invoiceRows.filter((row) => !isLinkedInvoice(row)).reduce((sum, row) => sum + invoiceAmount(row), 0),
      customer_link_rate_percent: invoiceKeys.size ? (linkedInvoiceKeys.size / invoiceKeys.size) * 100 : 0,
      linked_customers: new Set(linked.map((row) => String(row.customer_code || "").trim())).size,
    },
    dailySales: [...daysMap.values()].sort((a, b) => String(a.sale_date).localeCompare(String(b.sale_date))),
    branchDistribution: branchDistribution.sort((a, b) => n(b.sales_total) - n(a.sales_total)),
    doctorSales: doctorSales.sort((a, b) => n(b.sales_total) - n(a.sales_total)).slice(0, 30),
    monthlySales: monthlySales.sort((a, b) => String(a.month_start).localeCompare(String(b.month_start))).slice(-5),
  };
}

function createTargets(branches: BranchDistribution[], daysCount: number, startDate: string, endDate: string): TargetRow[] {
  const targetDefaults: Record<string, number> = {
    "فرع الشامي": 1000000,
    "فرع شكري": 1500000,
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
      manager_advice: percent >= 90 ? "حافظ على نفس معدل التشغيل اليومي." : "راجع العملاء المتوقفين، متوسط الفاتورة، والعروض اليومية.",
    };
  });
}

function Panel({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`rounded-3xl border border-cyan-300/10 bg-[#0b1d31]/85 shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur ${className}`}>{children}</section>;
}

function SectionTitle({ icon, title, subtitle }: { icon?: React.ReactNode; title: string; subtitle?: string }) {
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

function KpiCard({ title, value, subtitle, icon, tone = "cyan", onClick }: { title: string; value: string; subtitle: string; icon: React.ReactNode; tone?: "cyan" | "green" | "amber" | "blue" | "purple" | "red"; onClick?: () => void }) {
  const toneClass = {
    cyan: "from-cyan-500/12 to-cyan-400/5 border-cyan-300/22",
    green: "from-emerald-500/12 to-emerald-400/5 border-emerald-300/22",
    amber: "from-amber-500/15 to-amber-400/5 border-amber-300/25",
    blue: "from-sky-500/12 to-sky-400/5 border-sky-300/22",
    purple: "from-violet-500/12 to-violet-400/5 border-violet-300/22",
    red: "from-red-500/12 to-red-400/5 border-red-300/22",
  }[tone];

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br ${toneClass} p-5 transition ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:border-cyan-200/45 focus:outline-none focus:ring-2 focus:ring-cyan-300/50" : ""}`}
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

function MiniBox({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "green" | "amber" | "red" | "blue" }) {
  const classes = {
    cyan: "border-cyan-400/20 bg-cyan-500/10 text-cyan-100",
    green: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-400/20 bg-amber-500/10 text-amber-100",
    red: "border-red-400/20 bg-red-500/10 text-red-100",
    blue: "border-sky-400/20 bg-sky-500/10 text-sky-100",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs font-black text-slate-300">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

export default function ExecutiveDashboard2027() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentCycle = useMemo(() => getCurrentCycle(), []);
  const previousCycle = useMemo(() => getPreviousCycle(), []);
  const [startDate, setStartDate] = useState(() => formatCycleDate(currentCycle.start));
  const [endDate, setEndDate] = useState(() => formatCycleDate(currentCycle.end));
  const [branch, setBranch] = useState(() => effectiveBranchFilter(user, ALL_BRANCHES, ALL_BRANCHES) || ALL_BRANCHES);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const loadIdRef = useRef(0);
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

  const canAllBranches = canSeeAllBranches(user);
  const scopedBranch = effectiveBranchFilter(user, branch, ALL_BRANCHES) || ALL_BRANCHES;

  useEffect(() => {
    const next = effectiveBranchFilter(user, branch, ALL_BRANCHES);
    if (!canAllBranches && next && branch !== next) setBranch(next);
  }, [branch, canAllBranches, user]);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    const errors: string[] = [];
    try {
      const branchParams = { p_branch: scopedBranch || ALL_BRANCHES };

      const [
        customerServiceRows,
        customerServiceOwners,
        staffOpsRows,
      ] = await Promise.all([
        rpcRows<CustomerServiceSummary>(["get_dashboard_customer_service_summary_v171"], branchParams, "customer service", errors),
        rpcRows<CustomerServiceOwner>(["get_dashboard_customer_service_by_responsible_v171"], branchParams, "customer service owners", errors),
        rpcRows<StaffOps>(["get_dashboard_staff_ops_summary_v171"], undefined, "staff operations", errors),
      ]);

      const noCache = noCacheRef.current;
      noCacheRef.current = false;

      // ⚡ كل الـ requests في وقت واحد — parallel كامل
      const [salesTruth, staffResult, scheduleResult, currentPresence] = await Promise.all([
        fetchDashboardSalesTruth({
          startDate,
          endDate,
          branch: scopedBranch || ALL_BRANCHES,
          errors,
          noCache,
        }),
        supabase.from("staff").select("id,staff_id,name,staff_name,role,branch,status,active,is_active").limit(700),
        supabase.from("shift_schedules").select("staff_id,staff_name,branch,day_name,shift_start,shift_end,is_off").limit(1200),
        fetchCurrentShiftPresence(),
      ]);

      const summary = salesTruth.summary;
      const effectiveDailySales = salesTruth.dailySales;
      const effectiveBranchDistribution = salesTruth.branchDistribution;
      const effectiveDoctorSales = salesTruth.doctorSales;
      const effectiveMonthlySales = salesTruth.monthlySales;
      const recentInvoices = salesTruth.recentInvoices as InvoiceRow[];
      const salesReconciliation = salesTruth.reconciliation;
      const followupRows = !customerServiceRows.length || !customerServiceOwners.length
        ? await fetchFollowupsForDashboard(startDate, endDate, scopedBranch || ALL_BRANCHES, errors)
        : [];
      const effectiveCustomerServiceRows = customerServiceRows.length ? customerServiceRows : (followupRows.length ? [buildCustomerServiceSummaryFallback(followupRows)] : []);
      const effectiveCustomerServiceOwners = customerServiceOwners.length ? customerServiceOwners : buildCustomerServiceOwnersFallback(followupRows);
      const daysCount = new Set(effectiveDailySales.map((row) => String(row.sale_date || "").slice(0, 10)).filter(Boolean)).size || 1;
      const targets = createTargets(effectiveBranchDistribution, daysCount, startDate, endDate);
      if (staffResult.error) errors.push(`staff directory: ${staffResult.error.message}`);
      if (scheduleResult.error) errors.push(`shift schedules: ${scheduleResult.error.message}`);
      const staffDirectory = ((staffResult.data || []) as StaffDirectoryRow[]).filter(isActiveStaff);
      const scheduleRows = (scheduleResult.data || []) as ShiftScheduleRow[];
      const todayName = DAYS_AR[new Date().getDay()];
      const scheduledToday = staffDirectory
        .map((member) => {
          const name = staffName(member);
          const memberBranch = branchName(member.branch);
          const schedule = scheduleRows.find((row) => {
            const sameStaff = String(row.staff_id || "") === staffId(member) || String(row.staff_name || "").trim() === name;
            return sameStaff && branchName(row.branch) === memberBranch && String(row.day_name || "") === todayName && !row.is_off;
          });
          if (!schedule?.shift_start || !schedule?.shift_end) return null;
          if (scopedBranch !== ALL_BRANCHES && memberBranch !== scopedBranch) return null;
          return { ...member, shift_start: schedule.shift_start, shift_end: schedule.shift_end };
        })
        .filter(Boolean) as ShiftNowRow[];
      const onShiftNow = scheduledToday.filter((member) => isCurrentlyOnShift(member.shift_start || "", member.shift_end || ""));
      const presenceRows = [...currentPresence.doctors, ...currentPresence.assistants, ...currentPresence.delivery]
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
      const effectiveOnShiftNow = presenceRows.length ? presenceRows : (onShiftNow.length ? onShiftNow : scheduledToday);
      let incentiveSummary: StaffCycleIncentive[] = [];
      try {
        incentiveSummary = await getStaffIncentiveSummaryForCycle({
          cycle: currentCycle,
          branch: scopedBranch === ALL_BRANCHES ? null : scopedBranch,
        });
      } catch (error) {
        errors.push(`incentive summary: ${error instanceof Error ? error.message : "تعذر تحميل الحوافز"}`);
      }

      if (loadIdRef.current !== loadId) return;
      setState({
        summary,
        dailySales: effectiveDailySales,
        monthlySales: effectiveMonthlySales,
        branchDistribution: effectiveBranchDistribution,
        targets,
        doctorSales: effectiveDoctorSales,
        customerService: effectiveCustomerServiceRows[0] || null,
        customerServiceOwners: effectiveCustomerServiceOwners,
        staffOps: staffOpsRows[0] || null,
        staffDirectory,
        onShiftNow: effectiveOnShiftNow,
        incentiveSummary,
        recentInvoices,
        salesReconciliation,
        loadedAt: new Date().toISOString(),
        errors: salesTruth.sourceRows.length ? [] : errors,
      });
      return;
    } catch (error) {
      if (loadIdRef.current !== loadId) return;
      console.error("[Dashboard RPC failed]", "dashboard-load", { startDate, endDate, branch: scopedBranch }, error);
      setState((previous) => ({
        ...previous,
        loadedAt: new Date().toISOString(),
        errors: [`مصدر الداشبورد v171: ${error instanceof Error ? error.message : "خطأ غير معروف"}`],
      }));
    } finally {
      setLoading(false);
    }
  }, [currentCycle, endDate, scopedBranch, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const branchOptions = useMemo(() => {
    const fromData = [...state.branchDistribution.map((r) => branchName(r.branch)), ...state.targets.map((r) => branchName(r.branch))].filter((b) => b !== "غير محدد");
    const unique = [...new Set([...fromData, "فرع شكري", "فرع الشامي"])];
    return canAllBranches ? [ALL_BRANCHES, ...unique] : [branchName(user?.branch || "")];
  }, [canAllBranches, state.branchDistribution, state.targets, user?.branch]);

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
    const map = new Map<string, Record<string, unknown>>();
    state.dailySales.forEach((row) => {
      const day = String(row.sale_date || "").slice(0, 10);
      if (!day) return;
      const branch = branchName(row.branch);
      const current = map.get(day) || { date: day, label: safeDate(day), total: 0 };
      current.total = n(current.total) + n(row.daily_sales);
      current[branch] = n(current[branch]) + n(row.daily_sales);
      map.set(day, current);
    });
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [state.dailySales]);

  const monthlyChart = useMemo(() => {
    const monthName = new Intl.DateTimeFormat("ar-EG", { month: "short", year: "numeric" });
    const map = new Map<string, Record<string, unknown>>();
    state.monthlySales.forEach((row) => {
      const raw = String(row.month_start || "").slice(0, 10);
      const d = new Date(`${raw || "2026-01-01"}T12:00:00`);
      const current = map.get(raw) || {
        month_start: raw,
        label: Number.isNaN(d.getTime()) ? row.month_label || raw : monthName.format(d),
      };
      const branch = branchName(row.branch);
      current.sales_total = n(current.sales_total) + n(row.sales_total);
      current.invoices_count = n(current.invoices_count) + n(row.invoices_count);
      current.avg_invoice = n(current.invoices_count) ? n(current.sales_total) / n(current.invoices_count) : 0;
      current[branch] = n(current[branch]) + n(row.sales_total);
      map.set(raw, current);
    });
    return [...map.values()].sort((a, b) => String(a.month_start).localeCompare(String(b.month_start)));
  }, [state.monthlySales]);

  const branchPie = useMemo(() => state.branchDistribution.map((row) => ({ name: branchName(row.branch), value: n(row.sales_total), invoices: n(row.invoices_count) })), [state.branchDistribution]);
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
    const map = new Map<string, {
      total: number;
      invoices: number;
      topInvoice: number;
      days: Map<string, { sales: number; invoices: number }>;
      doctors: Map<string, { sales: number; invoices: number; days: Map<string, number> }>;
    }>();

    state.recentInvoices.forEach((row) => {
      const day = String(row.invoice_date || "").slice(0, 10);
      const branch = branchName(row.branch);
      const amount = dashboardInvoiceAmount(row);
      if (!day || amount <= 0) return;
      const bucket = map.get(branch) || { total: 0, invoices: 0, topInvoice: 0, days: new Map(), doctors: new Map() };
      bucket.total += amount;
      bucket.invoices += 1;
      bucket.topInvoice = Math.max(bucket.topInvoice, amount);

      const dayBucket = bucket.days.get(day) || { sales: 0, invoices: 0 };
      dayBucket.sales += amount;
      dayBucket.invoices += 1;
      bucket.days.set(day, dayBucket);

      const doctorName = String(row.seller_name || "غير محدد").trim() || "غير محدد";
      const doctorBucket = bucket.doctors.get(doctorName) || { sales: 0, invoices: 0, days: new Map<string, number>() };
      doctorBucket.sales += amount;
      doctorBucket.invoices += 1;
      doctorBucket.days.set(day, n(doctorBucket.days.get(day)) + amount);
      bucket.doctors.set(doctorName, doctorBucket);
      map.set(branch, bucket);
    });

    return map;
  }, [state.recentInvoices]);
  const funnelData = [
    { name: "المتابعات المفتوحة", value: Math.max(n(service.open_followups), 1), fill: "#2dd4bf" },
    { name: "قيد المعالجة", value: Math.max(Math.round(n(service.open_followups) * 0.68), 1), fill: "#38bdf8" },
    { name: "تحتاج مدير", value: Math.max(n(service.needs_manager), 1), fill: "#8b5cf6" },
    { name: "مكتملة اليوم", value: Math.max(n(service.completed_today), 1), fill: "#22c55e" },
  ];

  const serviceOwners = useMemo(() => {
    const preferred = ["ضحى", "د ضحى", "د/ ضحى", "دنيا", "د دنيا", "د/ دنيا"];
    return [...state.customerServiceOwners]
      .sort((a, b) => {
        const aName = String(a.responsible_name || "");
        const bName = String(b.responsible_name || "");
        const aPreferred = preferred.some((name) => aName.includes(name)) ? 0 : 1;
        const bPreferred = preferred.some((name) => bName.includes(name)) ? 0 : 1;
        return aPreferred - bPreferred || n(b.assigned_followups) - n(a.assigned_followups);
      })
      .slice(0, 6);
  }, [state.customerServiceOwners]);
  const serviceOwnerChart = useMemo(() => serviceOwners.map((owner) => ({
    name: String(owner.responsible_name || "غير محدد"),
    assigned: n(owner.assigned_followups),
    completed: n(owner.completed_today),
    manager: n(owner.needs_manager),
  })), [serviceOwners]);

  const serviceOwnersByBranch = useMemo(() => {
    const map = new Map<string, CustomerServiceOwner[]>();
    state.customerServiceOwners.forEach((owner) => {
      const key = branchName(owner.branch);
      map.set(key, [...(map.get(key) || []), owner]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }, [state.customerServiceOwners]);

  const navigateToStaff = useCallback(async (name: unknown, branchValue?: unknown) => {
    const syncResult = resolveStaffLink(name, branchValue, state.staffDirectory);
    if (!syncResult.isFallback) {
      navigate(syncResult.route);
      return;
    }
    // لم يُعثر عليه في القاموس المحلي — جرّب البحث السريع في Supabase
    const asyncResult = await getStaffNavigationTarget(String(name || ""));
    navigate(asyncResult.route);
  }, [navigate, state.staffDirectory]);

  const onShiftDoctors = useMemo(() => state.onShiftNow.filter((member) => roleGroup(member.role) === "doctor"), [state.onShiftNow]);
  const onShiftDelivery = useMemo(() => state.onShiftNow.filter((member) => roleGroup(member.role) === "delivery"), [state.onShiftNow]);
  const onShiftByBranch = useMemo(() => {
    const map = new Map<string, ShiftNowRow[]>();
    state.onShiftNow.forEach((member) => {
      const key = branchName(member.branch);
      map.set(key, [...(map.get(key) || []), member]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  }, [state.onShiftNow]);
  const branchPerformance = useMemo(() => {
    return state.targets
      .map((target) => {
        const branch = branchName(target.branch);
        const doctors = (doctorsByBranch.get(branch) || []).slice(0, 12);
        const bestDoctor = doctors[0];
        return { target, branch, doctors, bestDoctor };
      })
      .sort((a, b) => branchName(a.target.branch).localeCompare(branchName(b.target.branch), "ar"));
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
    { id: "branch-performance", title: "أداء الفروع", value: `${branchPerformance.length || 0} فرع`, tone: "cyan" as const },
    { id: "customer-service-analysis", title: "خدمة العملاء", value: count(service.open_followups), tone: "green" as const },
    { id: "operations-quality", title: "التشغيل والجرد", value: "متابعة", tone: "blue" as const },
    { id: "stagnant-list-analysis", title: "الرواكد واللستة", value: "تحليل", tone: "amber" as const },
    { id: "incentives-analysis", title: "الحوافز والنقاط", value: count(topDoctors.length), tone: "purple" as const },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-[#06131f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(45,212,191,0.14),transparent_25%),radial-gradient(circle_at_82%_0%,rgba(56,189,248,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0),rgba(2,6,23,0.82))]" />
      <main className="relative mx-auto max-w-[1920px] space-y-4 px-5 py-5">
        <Panel className="p-5">
          <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr] xl:items-center">
            <div className="order-2 grid gap-3 md:grid-cols-2 xl:order-1 xl:grid-cols-6">
              <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-3 text-sm font-black text-cyan-50 hover:bg-cyan-500/25">
                <Download className="h-4 w-4" />
                تصدير
              </button>
              <button onClick={() => { noCacheRef.current = true; clearInvoiceCache(); void load(); }} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500/20 px-4 py-3 text-sm font-black text-cyan-100 ring-1 ring-cyan-300/30 hover:bg-cyan-500/30 disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                تحديث
              </button>
              <div className="relative xl:col-span-2">
                <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث سريع عن عميل، فاتورة، منتج..." className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pr-11 pl-4 text-sm font-bold text-white outline-none focus:border-cyan-400" />
              </div>
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400">
                {branchOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <button onClick={() => { setStartDate(formatCycleDate(currentCycle.start)); setEndDate(formatCycleDate(currentCycle.end)); }} className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-black text-slate-200 hover:border-cyan-300/40">الدورة الحالية</button>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
              <button onClick={() => { setStartDate(formatCycleDate(previousCycle.start)); setEndDate(formatCycleDate(previousCycle.end)); }} className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm font-black text-slate-200 hover:border-cyan-300/40">السابقة</button>
              <div className="xl:col-span-3 flex items-center gap-2 rounded-2xl border border-cyan-300/10 bg-slate-950/45 px-4 py-3 text-xs font-bold text-slate-300">
                <CalendarDays className="h-4 w-4 text-cyan-300" />
                الفترة: {startDate} إلى {endDate}
              </div>
              <div className="xl:col-span-3 rounded-2xl border border-cyan-300/10 bg-slate-950/45 px-4 py-3 text-xs font-bold text-slate-400">
                آخر تحديث: {safeDateTime(state.loadedAt)}
              </div>
            </div>

            <div className="order-1 text-right xl:order-2">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-4 py-1 text-xs font-black text-cyan-200">
                <Sparkles className="h-4 w-4" />
                Dawaa Pharmacy 2027
              </div>
              <h1 className="text-4xl font-black leading-tight tracking-tight text-white md:text-5xl">مركز القيادة التشغيلي</h1>
              <p className="mt-2 text-sm font-semibold text-slate-300">لوحة قيادة تنفيذية شاملة للمبيعات، الفروع، الموظفين، خدمة العملاء، والتشغيل.</p>
              <div className="mt-5 flex flex-wrap justify-start gap-2 xl:justify-end">
                {["المبيعات", "الموظفين", "خدمة العملاء", "الفروع", "التشغيل"].map((tab, index) => (
                  <button key={tab} className={`rounded-2xl border px-5 py-2 text-sm font-black transition ${index === 0 ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100" : "border-slate-700/70 bg-slate-900/50 text-slate-300 hover:border-cyan-400/30"}`}>
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
              onClick={() => document.getElementById(card.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          ))}
        </section>

        <Panel className="p-5">
          <SectionTitle title="الموجودون حاليا في الشيفت" subtitle="حسب جدول الشيفتات الحالي، مع فصل الصيادلة عن الدليفري لمنع خلط المبيعات" icon={<Clock3 className="h-5 w-5" />} />
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-black text-white">الدكاترة والصيادلة</h3>
                <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">{count(onShiftDoctors.length)}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {onShiftDoctors.length ? onShiftDoctors.slice(0, 10).map((member) => (
                  <button key={`${staffId(member)}-${staffName(member)}`} onClick={() => void navigateToStaff(staffName(member), member.branch)} className="rounded-xl border border-cyan-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-cyan-400/10">
                    <b className="block text-white">{staffName(member)}</b>
                    <span className="text-slate-400">{branchName(member.branch)} · {member.shift_start || "-"} - {member.shift_end || "-"}</span>
                  </button>
                )) : <p className="rounded-xl border border-cyan-300/10 bg-slate-900/70 p-4 text-center text-xs font-bold text-slate-400">لا توجد بيانات شيفت حالية.</p>}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-300/10 bg-slate-950/45 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-black text-white">الدليفري</h3>
                <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-100">{count(onShiftDelivery.length)}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {onShiftDelivery.length ? onShiftDelivery.slice(0, 10).map((member) => (
                  <button key={`${staffId(member)}-${staffName(member)}`} onClick={() => void navigateToStaff(staffName(member), member.branch)} className="rounded-xl border border-amber-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-amber-400/10">
                    <b className="block text-white">{staffName(member)}</b>
                    <span className="text-slate-400">{branchName(member.branch)} · {member.shift_start || "-"} - {member.shift_end || "-"}</span>
                  </button>
                )) : <p className="rounded-xl border border-amber-300/10 bg-slate-900/70 p-4 text-center text-xs font-bold text-slate-400">لا توجد بيانات دليفري حالية.</p>}
              </div>
            </div>
          </div>
        </Panel>

        {!!state.errors.length && (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-100">
            لم يتم تحميل مصدر الداشبورد v171 بالكامل. راجع رسائل Console وشغّل ملف دعم v17.1 ثم أعد النشر بدون كاش.
          </div>
        )}

        {canAllBranches && state.salesReconciliation && (
          <Panel className={`p-4 ${state.salesReconciliation.difference > 1 ? "border-red-300/40 bg-red-500/10" : "border-emerald-300/20 bg-emerald-500/5"}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-cyan-200">Sales Data Reconciliation</div>
                <h3 className="mt-1 text-lg font-black text-white">صحة بيانات المبيعات من sales_invoices_live</h3>
                {state.salesReconciliation.difference > 1 ? (
                  <p className="mt-1 text-sm font-black text-red-200">يوجد اختلاف بين الداشبورد ومصدر الفواتير</p>
                ) : (
                  <p className="mt-1 text-sm font-bold text-emerald-200">الأرقام متطابقة مع معادلة SQL الداخلية.</p>
                )}
              </div>
              <div className="grid gap-2 text-xs font-bold text-slate-200 md:grid-cols-4 xl:grid-cols-8">
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">dashboardTotal<br /><b className="text-white">{money(state.salesReconciliation.dashboardTotal, 2)}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">sqlEquivalentTotal<br /><b className="text-white">{money(state.salesReconciliation.sqlEquivalentTotal, 2)}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">difference<br /><b className={state.salesReconciliation.difference > 1 ? "text-red-200" : "text-emerald-200"}>{money(state.salesReconciliation.difference, 2)}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">invoicesCount<br /><b className="text-white">{count(state.salesReconciliation.invoicesCount)}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">rowsRead<br /><b className="text-white">{count(state.salesReconciliation.rowsRead)}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">period<br /><b className="text-white">{state.salesReconciliation.selectedStartDate} / {state.salesReconciliation.selectedEndDate}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">branches<br /><b className="text-white">{state.salesReconciliation.branchesIncluded.join("، ") || "لا يوجد"}</b></span>
                <span className="rounded-xl bg-slate-950/55 px-3 py-2">missing<br /><b className="text-white">فرع {count(state.salesReconciliation.missingBranchCount)} · دكتور {count(state.salesReconciliation.missingDoctorCount)} · رقم {count(state.salesReconciliation.missingInvoiceKeyCount)}</b></span>
              </div>
            </div>
          </Panel>
        )}

        {loading && !state.loadedAt ? (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6" aria-busy="true" aria-label="جارٍ تحميل مؤشرات الأداء">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="relative overflow-hidden rounded-3xl border border-slate-700/50 bg-slate-800/40 p-5 animate-pulse">
                <div className="mb-3 h-3 w-16 rounded-full bg-slate-700/70" />
                <div className="mb-2 h-7 w-28 rounded-xl bg-slate-700/70" />
                <div className="h-2.5 w-20 rounded-full bg-slate-700/50" />
              </div>
            ))}
          </section>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <KpiCard title="صافي مبيعات الفترة" value={`${money(summary.sales_total)} جنيه`} subtitle="عن الفترة المختارة" icon={<Wallet className="h-6 w-6" />} tone="amber" onClick={() => navigate(`/analytics?${dashboardQuery}`)} />
            <KpiCard title="عدد الفواتير" value={count(summary.invoices_count)} subtitle="كل الفواتير داخل الفترة" icon={<FileText className="h-6 w-6" />} tone="green" onClick={() => navigate(`/invoice-import?${dashboardQuery}`)} />
            <KpiCard title="متوسط الفاتورة" value={`${money(summary.avg_invoice, 2)} جنيه`} subtitle="قيمة الفاتورة" icon={<ClipboardList className="h-6 w-6" />} tone="cyan" onClick={() => navigate(`/analytics?metric=avg-invoice&${dashboardQuery}`)} />
            <KpiCard title="العملاء المشترين" value={count(summary.linked_customers)} subtitle="عملاء لهم كود" icon={<Users className="h-6 w-6" />} tone="blue" onClick={() => navigate(`/customers?${dashboardQuery}`)} />
            <KpiCard title="نسبة ربط العملاء" value={pct(summary.customer_link_rate_percent)} subtitle={`${count(summary.linked_invoices)} فاتورة مرتبطة`} icon={<ShieldCheck className="h-6 w-6" />} tone="purple" onClick={() => navigate(`/customer-data-review?${dashboardQuery}`)} />
            <KpiCard title="الفواتير غير المسجلة" value={count(summary.unregistered_customer_invoices)} subtitle={`${money(summary.unregistered_customer_sales)} جنيه`} icon={<FileText className="h-6 w-6" />} tone="red" onClick={() => navigate(`/customer-data-review?status=unregistered&${dashboardQuery}`)} />
          </section>
        )}

        <Panel className="p-5">
          <SectionTitle title="اتجاه المبيعات اليومية خلال الدورة" subtitle="رسم كامل بعرض الصفحة لمتابعة كل أيام الشهر" icon={<TrendingUp className="h-5 w-5" />} />
            <div className="h-[360px]">
              {dailyChart.length ? (
                <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-400">جارٍ تحميل الرسم...</div>}>
                  <DailySalesChart data={dailyChart} />
                </Suspense>
              ) : <EmptyState label="لا توجد بيانات مبيعات يومية بعد" />}
            </div>
        </Panel>

        <Panel className="p-5">
          <SectionTitle title="تحليل آخر 5 شهور" subtitle="مقارنة شهرية واسعة للمبيعات وعدد الفواتير" icon={<BarChart3 className="h-5 w-5" />} />
          <div className="h-[320px]">
            {monthlyChart.length ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-400">جارٍ تحميل الرسم...</div>}>
                <MonthlySalesChart data={monthlyChart} />
              </Suspense>
            ) : <EmptyState label="لا توجد بيانات كافية لآخر 5 شهور" />}
          </div>
        </Panel>

        <section className="grid gap-4 xl:grid-cols-12">
          <Panel className="hidden">
            <SectionTitle title="توزيع المبيعات حسب الفروع" icon={<BarChart3 className="h-5 w-5" />} />
            <div className="h-[300px]">
              {branchPie.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={branchPie} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={3}>
                      {branchPie.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value) => `${money(value)} جنيه`} contentStyle={{ background: "#0f172a", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 16, color: "#fff" }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyState label="لا توجد بيانات فروع" />}
            </div>
          </Panel>

          <Panel className="hidden">
            <SectionTitle title="أعلى الدكاترة في المبيعات" subtitle="اضغط على أي دكتور لفتح صفحة الفريق والبحث عنه" icon={<Users className="h-5 w-5" />} />
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
                  {topDoctors.length ? topDoctors.map((row, index) => (
                    <tr key={`${row.doctor_name}-${row.branch}-${index}`} onClick={() => void navigateToStaff(row.doctor_name, row.branch)} className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8">
                      <td className="p-3 font-black text-cyan-200">{index + 1}</td>
                      <td className="p-3 font-black text-white">{row.doctor_name || "غير محدد"}</td>
                      <td className="p-3 text-slate-300">{branchName(row.branch)}</td>
                      <td className="p-3 text-emerald-200">{money(row.sales_total)}</td>
                      <td className="p-3 text-slate-200">{count(row.invoices_count)}</td>
                      <td className="p-3 text-slate-200">{money(row.avg_invoice, 2)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">لا توجد بيانات دكاترة بعد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel id="branch-performance" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle title="تحليل أداء كل فرع" subtitle="التارجت، المحقق، المتوقع، متوسط الشيفت اليومي، وأداء كل دكتور داخل الفرع" icon={<Target className="h-5 w-5" />} />
            <div className="space-y-4">
              {state.targets.length ? state.targets.map((target) => {
                const achievement = n(target.achievement_percent);
                const branchLabel = branchName(target.branch);
                const branchDoctors = (doctorsByBranch.get(branchLabel) || []).slice(0, 12);
                const bestDoctor = branchDoctors[0];
                const recent = recentBranchPerformance.get(branchLabel);
                const recentDays = recent ? [...recent.days.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-5) : [];
                const recentDoctors = recent ? [...recent.doctors.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 6) : [];
                return (
                  <div key={branchLabel} className="rounded-2xl border border-cyan-300/10 bg-slate-950/50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-lg font-black text-white">{branchName(target.branch)}</h3>
                      <span className={`rounded-full px-3 py-1 text-sm font-black ${achievement >= 90 ? "bg-emerald-500/20 text-emerald-200" : achievement >= 65 ? "bg-amber-500/20 text-amber-200" : "bg-red-500/20 text-red-200"}`}>{pct(achievement)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs font-bold text-slate-300 md:grid-cols-4">
                      <span>التارجت<br /><b className="text-white">{money(target.target_amount)}</b></span>
                      <span>المحقق<br /><b className="text-emerald-200">{money(target.sales_total)}</b></span>
                      <span>المتوقع<br /><b className="text-sky-200">{money(target.projected_sales)}</b></span>
                      <span>المتبقي<br /><b className="text-amber-200">{money(target.remaining_amount)}</b></span>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-emerald-400" style={{ width: `${Math.min(100, Math.max(0, achievement))}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-400">
                      <span>متوسط الشيفت اليومي: <b className="text-white">{money(n(target.sales_total) / Math.max(1, activeDaysCount))}</b></span>
                      <span>متوسط الفاتورة: <b className="text-white">{money(target.avg_invoice, 2)}</b></span>
                      <span>عدد الفواتير: <b className="text-white">{count(target.invoices_count)}</b></span>
                      <span>نسبة متوقعة: <b className="text-white">{pct(target.projected_achievement_percent)}</b></span>
                    </div>
                    <div className="mt-4 rounded-2xl border border-emerald-300/10 bg-emerald-400/5 p-3 text-xs font-bold text-slate-300">
                      أفضل دكتور حاليا: <b className="text-white">{bestDoctor?.doctor_name || "غير محدد"}</b>
                      {bestDoctor ? <span className="text-emerald-200"> · {money(bestDoctor.sales_total)} جنيه · {count(bestDoctor.invoices_count)} فاتورة</span> : null}
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
                        <button key={`${doctor.doctor_name}-${index}`} onClick={() => void navigateToStaff(doctor.doctor_name, doctor.branch)} className="grid w-full grid-cols-[auto_1fr_auto_auto_auto] gap-3 rounded-xl border border-cyan-300/10 bg-slate-900/70 px-3 py-2 text-right text-xs hover:bg-cyan-400/10">
                          <span className="font-black text-cyan-200">{index + 1}</span>
                          <span className="font-black text-white">{doctor.doctor_name || "غير محدد"}</span>
                          <span className="text-emerald-200">{money(doctor.sales_total)} جنيه</span>
                          <span className="text-sky-200">{money(doctor.avg_invoice, 2)} متوسط</span>
                          <span className="text-slate-300">{count(doctor.invoices_count)} فاتورة</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 rounded-2xl border border-sky-300/10 bg-sky-400/5 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h4 className="text-sm font-black text-white">تحليل آخر 5 أيام</h4>
                        <span className="rounded-full bg-sky-400/10 px-3 py-1 text-xs font-black text-sky-100">{recent ? `${money(recent.total)} جنيه` : "لا توجد بيانات"}</span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <MiniBox label="مبيعات آخر 5 أيام" value={recent ? `${money(recent.total)} جنيه` : "0 جنيه"} tone="cyan" />
                        <MiniBox label="عدد الفواتير" value={recent ? count(recent.invoices) : "0"} tone="blue" />
                        <MiniBox label="أهم فاتورة" value={recent ? `${money(recent.topInvoice)} جنيه` : "0 جنيه"} tone="green" />
                      </div>
                      <div className="mt-3 grid gap-3 xl:grid-cols-2">
                        <div className="rounded-xl border border-cyan-300/10 bg-slate-950/50 p-3">
                          <p className="mb-2 text-xs font-black text-cyan-100">المبيعات اليومية</p>
                          <div className="space-y-2">
                            {recentDays.length ? recentDays.map(([day, row]) => (
                              <div key={day} className="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-xs font-bold">
                                <span className="text-white">{safeDate(day)}</span>
                                <span className="text-emerald-200">{money(row.sales)} جنيه</span>
                                <span className="text-slate-300">{count(row.invoices)} فاتورة</span>
                              </div>
                            )) : <p className="rounded-lg bg-slate-900/70 p-3 text-center text-xs font-bold text-slate-500">لا توجد فواتير آخر 5 أيام</p>}
                          </div>
                        </div>
                        <div className="rounded-xl border border-cyan-300/10 bg-slate-950/50 p-3">
                          <p className="mb-2 text-xs font-black text-cyan-100">أداء الدكاترة آخر 5 أيام</p>
                          <div className="space-y-2">
                            {recentDoctors.length ? recentDoctors.map(([doctorName, row], index) => (
                              <button key={`${branchLabel}-${doctorName}`} onClick={() => void navigateToStaff(doctorName, branchLabel)} className="grid w-full grid-cols-[auto_1fr_auto_auto] gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-right text-xs font-bold hover:bg-cyan-400/10">
                                <span className="text-cyan-200">{index + 1}</span>
                                <span className="text-white">{doctorName}</span>
                                <span className="text-emerald-200">{money(row.sales)} جنيه</span>
                                <span className="text-slate-300">{count(row.invoices)} فاتورة</span>
                              </button>
                            )) : <p className="rounded-lg bg-slate-900/70 p-3 text-center text-xs font-bold text-slate-500">لا توجد بيانات دكاترة آخر 5 أيام</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs font-bold text-cyan-100">{target.manager_advice}</p>
                  </div>
                );
              }) : <EmptyState label="لا توجد بيانات تارجت" />}
            </div>
          </Panel>
        </section>

        <Panel id="operations-quality" className="p-5 scroll-mt-24">
          <SectionTitle title="التشغيل والمخزون والجودة" subtitle="تقسيم تنفيذي للنظافة، الجرد، المستلزمات، طلبات العملاء، الرواكد واللستة" icon={<PackageSearch className="h-5 w-5" />} />
          <div className="grid gap-4 xl:grid-cols-2">
            <KpiCard title="أداء النظافة" value="متابعة الفروع" subtitle="اضغط لفتح مراجعة النظافة" icon={<ShieldCheck className="h-6 w-6" />} tone="cyan" onClick={() => navigate("/branch-cleaning")} />
            <KpiCard title="أداء الجرد" value="مراجعة العد" subtitle="اضغط لفتح الجرد والفروقات" icon={<ClipboardList className="h-6 w-6" />} tone="blue" onClick={() => navigate("/inventory-counts")} />
            <KpiCard title="أداء المستلزمات" value="طلبات التشغيل" subtitle="اضغط لفتح المستلزمات" icon={<PackageSearch className="h-6 w-6" />} tone="purple" onClick={() => navigate("/supplies")} />
            <KpiCard title="طلبات العملاء" value={count(service.open_followups)} subtitle="اضغط لفتح مركز خدمة العملاء" icon={<Headphones className="h-6 w-6" />} tone="green" onClick={() => navigate("/customer-service")} />
          </div>
          <div id="stagnant-list-analysis" className="mt-4 grid gap-4 xl:grid-cols-2 scroll-mt-24">
            <div className="rounded-3xl border border-amber-300/15 bg-amber-400/8 p-5">
              <SectionTitle title="تحليل الرواكد" subtitle="الأصناف الراكدة والدكاترة الأكثر مساهمة في تحريكها" icon={<PackageSearch className="h-5 w-5" />} />
              <p className="text-sm font-bold text-slate-300">افتح صفحة الرواكد لمراجعة الأصناف، آخر حركة، والدكتور المسؤول عن التحريك.</p>
              <button onClick={() => navigate("/stagnant-medicines")} className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-5 py-3 text-sm font-black text-amber-100 hover:bg-amber-400/20">فتح تحليل الرواكد</button>
            </div>
            <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/8 p-5">
              <SectionTitle title="تحليل اللستة والحوافز" subtitle="الأصناف المحفزة وأثرها على نقاط الدكاترة" icon={<Sparkles className="h-5 w-5" />} />
              <p className="text-sm font-bold text-slate-300">افتح صفحة اللستة لمراجعة مبيعات الأصناف المحفزة وربطها بالحوافز.</p>
              <button onClick={() => navigate("/incentive-medicines")} className="mt-4 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-5 py-3 text-sm font-black text-emerald-100 hover:bg-emerald-400/20">فتح تحليل اللستة</button>
            </div>
          </div>
        </Panel>

        <section className="grid gap-4 xl:grid-cols-12">
          <Panel id="customer-service-analysis" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle title="عمليات خدمة العملاء" subtitle="المتابعات المفتوحة والنتائج اليومية حسب المسؤولة والفرع" icon={<Headphones className="h-5 w-5" />} />
            <div className="grid grid-cols-2 gap-3">
              <MiniBox label="المتابعات المفتوحة" value={count(service.open_followups)} tone="cyan" />
              <MiniBox label="المكتملة اليوم" value={count(service.completed_today)} tone="green" />
              <MiniBox label="تحتاج مدير" value={count(service.needs_manager)} tone="amber" />
              <MiniBox label="متوسط الاستجابة" value={service.avg_response_hours == null ? "غير محدد" : `${n(service.avg_response_hours)} س`} tone="blue" />
            </div>
            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              {serviceOwnersByBranch.length ? serviceOwnersByBranch.map(([branchLabel, owners]) => {
                const assigned = owners.reduce((sum, owner) => sum + n(owner.assigned_followups), 0);
                const completed = owners.reduce((sum, owner) => sum + n(owner.completed_today), 0);
                const manager = owners.reduce((sum, owner) => sum + n(owner.needs_manager), 0);
                const bestOwner = [...owners].sort((a, b) => n(b.completion_percent) - n(a.completion_percent))[0];
                const percent = assigned ? (completed / assigned) * 100 : n(bestOwner?.completion_percent);
                return (
                  <div key={branchLabel} className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-black text-white">{branchLabel}</h3>
                        <p className="mt-1 text-xs font-bold text-slate-400">المسؤولة الأقوى: {bestOwner?.responsible_name || "غير محدد"}</p>
                      </div>
                      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100">{pct(percent)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <MiniBox label="مسند" value={count(assigned)} tone="cyan" />
                      <MiniBox label="مكتمل" value={count(completed)} tone="green" />
                      <MiniBox label="يحتاج مدير" value={count(manager)} tone="amber" />
                    </div>
                    <div className="mt-3 space-y-2">
                      {owners.map((owner) => (
                        <button key={`${branchLabel}-${owner.responsible_name}`} onClick={() => navigate(`/customer-service?responsible=${encodeURIComponent(String(owner.responsible_name || ""))}&branch=${encodeURIComponent(branchLabel)}`)} className="grid w-full grid-cols-[1fr_auto_auto_auto] gap-2 rounded-xl border border-cyan-300/10 bg-slate-900/70 px-3 py-2 text-right text-xs font-bold hover:bg-cyan-400/10">
                          <span className="font-black text-white">{owner.responsible_name || "غير محدد"}</span>
                          <span className="text-cyan-200">{count(owner.assigned_followups)} مسند</span>
                          <span className="text-emerald-200">{count(owner.completed_today)} مكتمل</span>
                          <span className="text-amber-200">{count(owner.needs_manager)} مدير</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }) : <div className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-5 text-center text-sm font-bold text-slate-400 xl:col-span-2">لا توجد بيانات خدمة عملاء موزعة حسب الفروع بعد.</div>}
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-2 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-3">
                <h3 className="text-sm font-black text-white">توزيع المتابعات على الفريق</h3>
                {serviceOwners.length ? serviceOwners.map((owner, index) => {
                  const assigned = n(owner.assigned_followups);
                  const completed = n(owner.completed_today);
                  const percent = n(owner.completion_percent);
                  const ownerBranch = branchName(owner.branch);
                  const ownerName = String(owner.responsible_name || "غير محدد");
                  return (
                    <button
                      key={`${ownerName}-${ownerBranch}-${index}`}
                      onClick={() => navigate(`/customer-service?responsible=${encodeURIComponent(ownerName)}&branch=${encodeURIComponent(ownerBranch)}`)}
                      className="w-full rounded-xl border border-cyan-300/10 bg-slate-900/75 p-3 text-right transition hover:bg-cyan-400/10"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-white">{ownerName}</p>
                          <p className="mt-1 text-xs font-bold text-slate-400">{ownerBranch}</p>
                        </div>
                        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">{pct(percent)}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-300">
                        <span>مسند<br /><b className="text-white">{count(assigned)}</b></span>
                        <span>مكتمل<br /><b className="text-emerald-200">{count(completed)}</b></span>
                        <span>مدير<br /><b className="text-amber-200">{count(owner.needs_manager)}</b></span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-gradient-to-l from-cyan-300 to-emerald-400" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                      </div>
                    </button>
                  );
                }) : <p className="rounded-xl border border-cyan-300/10 bg-slate-900/70 p-4 text-center text-xs font-bold text-slate-400">لا توجد بيانات مسؤولي خدمة عملاء بعد تشغيل ملف الدعم.</p>}
              </div>
              <div className="h-64">
                {serviceOwnerChart.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serviceOwnerChart} margin={{ top: 10, right: 12, left: 12, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 16, color: "#fff" }} />
                      <Legend />
                      <Bar dataKey="assigned" name="مسند" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="completed" name="مكتمل" fill="#2dd4bf" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="manager" name="مدير" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState label="لا توجد بيانات كافية لرسم أداء خدمة العملاء" />}
              </div>
            </div>
          </Panel>

          <Panel className="hidden">
            <SectionTitle title="أداء الموظفين التشغيلي" subtitle="حضور، أذونات، وتنبيهات" icon={<ShieldCheck className="h-5 w-5" />} />
            <div className="grid grid-cols-2 gap-3">
              <MiniBox label="الحسابات النشطة" value={count(staff.active_accounts)} tone="green" />
              <MiniBox label="الحسابات المقفولة" value={count(staff.disabled_accounts)} tone="red" />
              <MiniBox label="أذونات معلقة" value={count(staff.pending_time_off)} tone="amber" />
              <MiniBox label="غياب اليوم" value={count(staff.absences_today)} tone="blue" />
            </div>
            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
              <h3 className="mb-3 text-sm font-black text-white">الأداء الأقل يحتاج متابعة</h3>
              <div className="space-y-2">
                {lowDoctors.length ? lowDoctors.slice(0, 5).map((row, index) => (
                  <button key={`${row.doctor_name}-${index}`} onClick={() => void navigateToStaff(row.doctor_name, row.branch)} className="grid w-full grid-cols-[1fr_auto_auto] gap-2 rounded-xl bg-slate-900/80 px-3 py-2 text-right text-xs hover:bg-cyan-400/10">
                    <span className="font-black text-white">{row.doctor_name || "غير محدد"}</span>
                    <span className="text-slate-300">{count(row.invoices_count)} فاتورة</span>
                    <span className="text-amber-200">{money(row.sales_total)}</span>
                  </button>
                )) : <p className="text-center text-xs font-bold text-slate-500">لا توجد بيانات</p>}
              </div>
            </div>
          </Panel>

          <Panel id="incentives-analysis" className="xl:col-span-12 p-5 scroll-mt-24">
            <SectionTitle title="النقاط والحوافز" subtitle="مرتبط فعليا بسجل النقاط والحوافز داخل التطبيق" icon={<Sparkles className="h-5 w-5" />} />
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
                  {incentiveRows.length ? incentiveRows.map((row, index) => (
                    <tr
                      key={`${row.staff.id || row.staff.name}-points-${index}`}
                      onClick={() => void (row.staff.id ? navigate(`/staff/${encodeURIComponent(String(row.staff.id))}`) : navigateToStaff(row.staff.name, (row.staff as { branch?: unknown }).branch))}
                      className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8"
                    >
                      <td className="p-3 font-black text-white">{row.staff.name || "غير محدد"}</td>
                      <td className="p-3 text-cyan-200">{count(row.finalPoints)}</td>
                      <td className="p-3 text-emerald-200">{money(row.incentiveValue)} جنيه</td>
                    </tr>
                  )) : topDoctors.slice(0, 8).map((row, index) => {
                    const points = n(row.estimated_points) || Math.round(n(row.sales_total) / 1000);
                    return (
                      <tr key={`${row.doctor_name}-points-${index}`} onClick={() => void navigateToStaff(row.doctor_name, row.branch)} className="cursor-pointer border-t border-cyan-300/10 hover:bg-cyan-400/8">
                        <td className="p-3 font-black text-white">{row.doctor_name || "غير محدد"}</td>
                        <td className="p-3 text-cyan-200">{count(points)}</td>
                        <td className="p-3 text-emerald-200">{money(n(row.incentive_value) || points * 3)} جنيه</td>
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
            <SectionTitle title="عمليات خدمة العملاء" subtitle="المتابعات المفتوحة والنتائج اليومية" icon={<Headphones className="h-5 w-5" />} />
            <div className="grid grid-cols-2 gap-3">
              <MiniBox label="المتابعات المفتوحة" value={count(service.open_followups)} tone="cyan" />
              <MiniBox label="المكتملة اليوم" value={count(service.completed_today)} tone="green" />
              <MiniBox label="تحتاج مدير" value={count(service.needs_manager)} tone="amber" />
              <MiniBox label="متوسط الاستجابة" value={service.avg_response_hours == null ? "غير محدد" : `${n(service.avg_response_hours)} س`} tone="blue" />
            </div>
            <div className="mt-5 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 16, color: "#fff" }} />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" fill="#cbd5e1" stroke="none" dataKey="name" />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel className="xl:col-span-4 p-5">
            <SectionTitle title="أداء الموظفين التشغيلي" subtitle="حضور، أذونات، وتنبيهات" icon={<ShieldCheck className="h-5 w-5" />} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MiniBox label="الحسابات النشطة" value={count(staff.active_accounts)} tone="green" />
              <MiniBox label="الحسابات المقفولة" value={count(staff.disabled_accounts)} tone="red" />
              <MiniBox label="أذونات معلقة" value={count(staff.pending_time_off)} tone="amber" />
              <MiniBox label="غياب اليوم" value={count(staff.absences_today)} tone="blue" />
            </div>
            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
              <h3 className="mb-3 text-sm font-black text-white">الأداء الأقل يحتاج متابعة</h3>
              <div className="space-y-2">
                {lowDoctors.length ? lowDoctors.slice(0, 5).map((row, index) => (
                  <button key={`${row.doctor_name}-${index}`} onClick={() => void navigateToStaff(row.doctor_name, row.branch)} className="grid w-full grid-cols-[1fr_auto_auto] gap-2 rounded-xl bg-slate-900/80 px-3 py-2 text-right text-xs hover:bg-cyan-400/10">
                    <span className="font-black text-white">{row.doctor_name || "غير محدد"}</span>
                    <span className="text-slate-300">{count(row.invoices_count)} فاتورة</span>
                    <span className="text-amber-200">{money(row.sales_total)}</span>
                  </button>
                )) : <p className="text-center text-xs font-bold text-slate-500">لا توجد بيانات</p>}
              </div>
            </div>
          </Panel>

          <Panel className="xl:col-span-4 p-5">
            <SectionTitle title="النقاط والحوافز" subtitle="ترتيب تقديري لحين ربط Ledger الحوافز النهائي" icon={<Sparkles className="h-5 w-5" />} />
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
                      <tr key={`${row.doctor_name}-points-${index}`} className="border-t border-cyan-300/10">
                        <td className="p-3 font-black text-white">{row.doctor_name || "غير محدد"}</td>
                        <td className="p-3 text-cyan-200">{count(points)}</td>
                        <td className="p-3 text-emerald-200">{money(n(row.incentive_value) || points * 3)} جنيه</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <Panel className="p-5">
          <SectionTitle title="جدول الحضور والموجودين في الشيفت" subtitle="تفصيل حسب كل فرع مع فصل الدور ووقت الشيفت الحالي" icon={<Clock3 className="h-5 w-5" />} />
          <div className="grid gap-4 xl:grid-cols-2">
            {onShiftByBranch.length ? onShiftByBranch.map(([branchLabel, members]) => (
              <div key={branchLabel} className="rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-black text-white">{branchLabel}</h3>
                  <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">{count(members.length)} على الشيفت</span>
                </div>
                <div className="space-y-2">
                  {members.map((member) => (
                    <button key={`${staffId(member)}-${staffName(member)}`} onClick={() => void navigateToStaff(staffName(member), member.branch)} className="grid w-full grid-cols-[1fr_auto_auto] gap-3 rounded-xl border border-cyan-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-cyan-400/10">
                      <span className="font-black text-white">{staffName(member)}</span>
                      <span className="text-slate-300">{roleGroup(member.role) === "delivery" ? "دليفري" : roleGroup(member.role) === "doctor" ? "دكتور" : String(member.role || "فريق")}</span>
                      <span className="text-cyan-200">{member.shift_start || "-"} - {member.shift_end || "-"}</span>
                    </button>
                  ))}
                </div>
              </div>
            )) : <EmptyState label="لا توجد بيانات حضور أو شيفت حالية" />}
          </div>
        </Panel>

        <Panel className="hidden">
          <SectionTitle title="المهام التشغيلية الحرجة" subtitle="بنود تحتاج قرار سريع من الإدارة" icon={<AlertTriangle className="h-5 w-5" />} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <CriticalItem title="فواتير بدون ربط عميل" value={`${count(summary.unregistered_customer_invoices)} فاتورة`} />
            <CriticalItem title="خطر عدم تحقيق التارجت" value="راجع الفروع يوميًا" danger />
            <CriticalItem title="تنبيهات المخزون" value="راجع الأصناف الحرجة" />
            <CriticalItem title="متابعات تحتاج مدير" value={`${count(service.needs_manager)} متابعة`} />
          </div>
        </Panel>
      </main>
    </div>
  );
}

function CriticalItem({ title, value, danger = false }: { title: string; value: string; danger?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-2xl border p-4 ${danger ? "border-red-400/25 bg-red-500/10" : "border-cyan-300/10 bg-slate-900/60"}`}>
      <div>
        <p className="font-black text-white">{title}</p>
        <p className="mt-1 text-sm font-bold text-slate-300">{value}</p>
      </div>
      <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/10">معالجة الآن</button>
    </div>
  );
}
