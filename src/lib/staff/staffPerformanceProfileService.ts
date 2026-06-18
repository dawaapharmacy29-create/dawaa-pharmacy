import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentCycle, type PharmacyCycle } from "@/lib/pharmacy-cycle";
import { getStaffCycleIncentive, type StaffCycleIncentive } from "@/lib/staffIncentiveService";
import { normalizeStaffName } from "@/lib/staffIdentityService";
import { staffRowIsActive } from "@/lib/staffActiveFilter";
import { PermissionPolicyService, type PermissionPolicyStatus } from "@/lib/permissionPolicyService";
import { STAFF_DETAIL_SECTION_TIMEOUT_MS, type StaffBaseProfile } from "@/lib/staffDetailLoader";
import { getStaffCycleInvoices } from "@/lib/staffSalesService";
import { getStaffInvoiceTruth, type StaffInvoiceTruth } from "@/lib/staffInvoiceTruthService";
import { generateStaffRecommendations as generateRecommendations, type StaffRecommendation } from "./staffPerformanceRecommendations";

type Row = Record<string, unknown>;

function isCompletedFollowup(row: Row) {
  return Boolean(row.status === "completed" || row.followup_status === "completed" || row.completed || row.is_completed);
}

function isMissedFollowup(row: Row) {
  return Boolean(row.status === "missed" || row.followup_status === "missed" || row.missed || row.is_missed || row.overdue);
}

export interface StaffPerformanceProfileParams {
  staffId: string;
  cycleStart?: string;
  cycleEnd?: string;
  quarterStart?: string;
  quarterEnd?: string;
  branchFilter?: string;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export interface StaffIdentity {
  primaryStaffId: string;
  activeStaffId: string;
  displayName: string;
  branch: string;
  role: string;
  aliases: string[];
  normalizedNames: string[];
  inactiveDuplicateIds: string[];
  rawSellerNames: string[];
  warnings: string[];
}

export interface StaffDataHealth {
  hasSales: boolean;
  hasInvoices: boolean;
  hasCustomers: boolean;
  hasStagnant: boolean;
  hasList: boolean;
  hasSchedule: boolean;
  hasAttendance: boolean;
  hasReviews: boolean;
  hasFollowups: boolean;
  salesLinked: boolean;
  invoicesLinked: boolean;
  customersLinked: boolean;
  unresolvedSellerNames: string[];
  duplicateStaff: boolean;
  missingStaffIdInSales: number;
  missingStaffIdInIncentives: number;
  missingCustomerInInvoices: number;
  missingClassification: number;
  warnings: string[];
}

export interface StaffSalesMetrics {
  cycleNetSales: number;
  cycleInvoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
  deliveryInvoices: number;
  branchContribution: number;
  salesGrowthVsPreviousCycle: number;
  salesGrowthVsPreviousMonth: number;
  bestDay: string | null;
  weakestDay: string | null;
  topShift: string | null;
  topInvoice: { invoiceNumber: string; amount: number; date: string; customer?: string } | null;
  minInvoice?: { invoiceNumber: string; amount: number; date: string; customer?: string } | null;
  latestInvoices: Array<{ invoiceNumber: string; date: string; amount: number; customer: string; customerCode?: string; customerPhone?: string; customerAddress?: string; customerSegment?: string; branch?: string; sellerName?: string }>;
  monthlyTrend: Array<{ month: string; sales: number; invoices: number; avgInvoice: number }>;
  weeklyDistribution: Array<{ week: string; sales: number; invoices: number }>;
  shiftDistribution: Array<{ shift: string; sales: number; invoices: number }>;
  invoiceTypeDistribution: Array<{ type: string; sales: number; invoices: number }>;
  branchComparison: { staffAvg: number; branchAvg: number; difference: number; percentDifference: number };
  sourceUsed?: "staff_id" | "seller_name" | "invoices_fallback" | "none";
  aliasesUsed?: string[];
  rawSellerNamesMatched?: string[];
  dataHealthWarnings?: string[];
  invoiceDiagnostics?: StaffInvoiceTruth["diagnostics"];
}

export interface StaffCustomerMetrics {
  topCustomers: Array<{ name: string; phone: string; code?: string; address?: string; segment: string; invoicesCount: number; totalSpent: number; avgInvoice?: number; lastPurchase: string; lastDoctorInteraction: string }>;
  customersNeedingFollowup: Array<{ name: string; phone: string; reason: string; lastPurchase: string; expectedAction: string }>;
  repeatCustomers: Array<{ name: string; repeatCount: number; trend: string }>;
  lostOrDecliningCustomers: Array<{ name: string; previousAvgMonthly: number; currentAvgMonthly: number; declinePercent: number }>;
  customersReturnedAfterFollowup: Array<{ name: string; followupDate: string; purchaseAfterFollowup: string; amount: number }>;
  newCustomers: number;
  customersWithComplaints: number;
  customersWithMissingPhone: number;
  customersNeedingFollowupCount: number;
  customersWithHighMonthlyAverage: number;
  customersSensitiveToPrice: number;
  customersWhoDislikeAlternatives: number;
  customersWhoShouldNotReceiveDeliveryFee: number;
  monthlyCustomerTrend: Array<{ month: string; customerCount: number }>;
  segmentDistribution: Array<{ segment: string; count: number; percentage: number }>;
  newVsRepeatTrend: Array<{ month: string; newCustomers: number; repeatCustomers: number }>;
  top10CustomersChart: Array<{ name: string; amount: number }>;
}

export interface StaffStagnantListMetrics {
  assignedStagnantItems: number;
  stagnantTargetQuantity: number;
  stagnantSoldQuantity: number;
  stagnantRemainingQuantity: number;
  stagnantCompletionPercent: number;
  stagnantCashRewards: number;
  stagnantWarnings: string[];
  stagnantMissedTargets: string[];
  assignedListItems: number;
  listTargetQuantity: number;
  listSoldQuantity: number;
  listRemainingQuantity: number;
  listCompletionPercent: number;
  listCashRewards: number;
  listWarnings: string[];
  stagnantProgress: Array<{ target: number; sold: number; remaining: number }>;
  listProgress: Array<{ target: number; sold: number; remaining: number }>;
  monthlyCashRewards: Array<{ month: string; rewards: number }>;
  topRemainingItems: Array<{ name: string; remaining: number; expiryDate: string }>;
  itemsNearExpiry: Array<{ name: string; remaining: number; expiryDate: string; daysUntilExpiry: number }>;
}

export interface StaffAttendanceMetrics {
  scheduledDays: number;
  attendedDays: number;
  absences: number;
  delays: number;
  delaysOver20Minutes: number;
  permissionsUsed: number;
  freePermissionsRemaining: number;
  unauthorizedAbsences: number;
  scheduleExceptions: number;
  attendanceCompliance: number;
  delayTrend: Array<{ date: string; delayMinutes: number }>;
  permissionsUsage: Array<{ date: string; reason: string }>;
}

export interface StaffCustomerServiceMetrics {
  followupsAssigned: number;
  followupsCompleted: number;
  followupsMissed: number;
  complaintCount: number;
  resolvedComplaints: number;
  conversationEvaluationAverage: number;
  missingCustomerClassification: number;
  missingInvoiceClassification: number;
  bothClassificationsMissing: number;
  poorClassificationQuality: number;
  missingImportantNotes: number;
  customersWithoutValidPhoneHandled: number;
  followupResults: Array<{ assigned: number; completed: number; missed: number }>;
  classificationQuality: Array<{ metric: string; score: number }>;
  complaintsAndResolutions: Array<{ date: string; complaint: string; resolved: boolean }>;
  conversationsAndEvaluations: Array<{ date: string; score: number }>;
}

export interface StaffQuarterlyMetrics {
  quarterlyScore: number;
  baseQuarterlyIncentive: number;
  quarterlyCashRewards: number;
  quarterlyCashDeductions: number;
  quarterlyFinalValue: number;
  rankInBranch: number;
  rankAcrossPharmacy: number;
  scoreBreakdown: {
    salesGrowth: number;
    avgInvoice: number;
    customers: number;
    listItems: number;
    stagnantInventory: number;
    registrationQuality: number;
  };
  weeklySalesTrend: Array<{ week: string; sales: number }>;
  branchComparison: { staffScore: number; branchAverage: number; difference: number };
  rewardsAndDeductions: Array<{ type: string; amount: number; date: string }>;
}

export interface StaffCharts {
  salesMonthlyTrend: Array<{ month: string; sales: number }>;
  invoicesMonthlyTrend: Array<{ month: string; invoices: number }>;
  avgInvoiceMonthlyTrend: Array<{ month: string; avgInvoice: number }>;
  pointsEvolution: Array<{ cycle: string; points: number }>;
  deductionsEvolution: Array<{ cycle: string; deductions: number }>;
  cashRewardsEvolution: Array<{ cycle: string; rewards: number }>;
  netPayoutMonthly: Array<{ month: string; payout: number }>;
  quarterlyScoreComponents: Array<{ component: string; score: number }>;
  attendanceCompliance: Array<{ date: string; compliance: number }>;
  delayTrend: Array<{ date: string; delayMinutes: number }>;
  permissionsUsage: Array<{ date: string; reason: string }>;
}


export interface StaffPerformanceProfile {
  staff: StaffBaseProfile;
  identity: StaffIdentity;
  dataHealth: StaffDataHealth;
  monthlyIncentive: StaffCycleIncentive | null;
  cashRewards: number;
  quarterlyIncentive: StaffQuarterlyMetrics | null;
  sales: StaffSalesMetrics | null;
  customers: StaffCustomerMetrics | null;
  followups: Row[];
  customerService: StaffCustomerServiceMetrics | null;
  stagnantMedicines: StaffStagnantListMetrics | null;
  listItems: StaffStagnantListMetrics | null;
  inventory: unknown;
  attendance: StaffAttendanceMetrics | null;
  permissions: PermissionPolicyStatus | null;
  schedule: Row[];
  tasks: unknown;
  charts: StaffCharts;
  recommendations: StaffRecommendation[];
  sources: string[];
  lastUpdated: string;
  errorsBySection: Record<string, string>;
}

const CACHE = new Map<string, { data: StaffPerformanceProfile; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearStaffPerformanceProfileCache() {
  CACHE.clear();
}

function getCacheKey(params: StaffPerformanceProfileParams): string {
  return `${params.staffId}:${params.cycleStart || ''}:${params.cycleEnd || ''}:${params.quarterStart || ''}:${params.quarterEnd || ''}:${params.branchFilter || ''}`;
}

export async function loadStaffPerformanceProfile(params: StaffPerformanceProfileParams): Promise<StaffPerformanceProfile> {
  const cacheKey = getCacheKey(params);
  const cached = CACHE.get(cacheKey);
  if (!params.forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (!isSupabaseConfigured) {
    throw new Error("Supabase not configured");
  }

  const cycle = getCurrentCycle();
  const cycleStart = params.cycleStart || cycle.start.toISOString().slice(0, 10);
  const cycleEnd = params.cycleEnd || cycle.end.toISOString().slice(0, 10);
  const quarterStart = params.quarterStart || cycleStart;
  const quarterEnd = params.quarterEnd || cycleEnd;

  const errorsBySection: Record<string, string> = {};
  const sources: string[] = [];

  // Load base staff profile
  let staff: StaffBaseProfile | null = null;
  try {
    const { data, error } = await supabase
      .from("staff")
      .select("id,name,branch,role,active,is_active,status,created_at,points,max_points")
      .eq("id", params.staffId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      staff = {
        id: String(data.id),
        name: String(data.name || ""),
        branch: String(data.branch || "غير محدد"),
        role: String(data.role || ""),
        is_active: staffRowIsActive(data as StaffBaseProfile),
        created_at: (data.created_at as string) || null,
        points: data.points as number | null,
        max_points: data.max_points as number | null,
        active: data.active as boolean | null,
        status: (data.status as string) || null,
      };
      sources.push("staff");
    }
  } catch (error) {
    errorsBySection.staff = error instanceof Error ? error.message : String(error);
  }

  if (!staff) {
    throw new Error("Staff not found");
  }

  // Resolve staff identity
  const identity = await resolveStaffIdentity(staff);

  // Load monthly incentive
  let monthlyIncentive: StaffCycleIncentive | null = null;
  try {
    monthlyIncentive = await getStaffCycleIncentive({
      staffId: params.staffId,
      staffName: staff.name,
      branch: staff.branch,
      cycleStart,
      cycleEnd,
    });
    sources.push("employee_transactions");
  } catch (error) {
    errorsBySection.incentive = error instanceof Error ? error.message : String(error);
  }

  let invoiceTruth: StaffInvoiceTruth | null = null;
  try {
    // getStaffInvoiceTruth never throws — it returns a full object even on errors
    invoiceTruth = await getStaffInvoiceTruth(params.staffId, cycleStart, cycleEnd);
    sources.push("sales_invoices");
    if (invoiceTruth.diagnostics.errors.length > 0) {
      errorsBySection.invoice_truth = invoiceTruth.diagnostics.errors.join("; ");
    }
  } catch (error) {
    // Fallback: should not reach here, but safety net
    const msg = error instanceof Error ? error.message : String(error);
    errorsBySection.invoice_truth = msg;
  }

  // Staff profile and dashboard now both use sales_invoices + seller aliases as source of truth.
  // sales is ALWAYS built if invoiceTruth exists — even if invoices=[]
  let sales: StaffSalesMetrics | null = null;
  try {
    if (invoiceTruth) {
      sales = loadStaffSalesMetrics(invoiceTruth);
    }
  } catch (error) {
    errorsBySection.sales = error instanceof Error ? error.message : String(error);
  }

  // Load customer data
  let customers: StaffCustomerMetrics | null = null;
  try {
    customers = invoiceTruth ? loadStaffCustomerMetrics(invoiceTruth) : null;
  } catch (error) {
    errorsBySection.customers = error instanceof Error ? error.message : String(error);
  }

  // Load stagnant/list data
  let stagnantMedicines: StaffStagnantListMetrics | null = null;
  let listItems: StaffStagnantListMetrics | null = null;
  try {
    const stagnantListData = await loadStaffStagnantListMetrics(params.staffId, identity, cycleStart, cycleEnd, params.signal);
    stagnantMedicines = stagnantListData.stagnant;
    listItems = stagnantListData.list;
    sources.push("stagnant_medicines", "stagnant_medicine_dispenses", "incentive_medicines", "incentive_medicine_sales");
  } catch (error) {
    errorsBySection.stagnant_list = error instanceof Error ? error.message : String(error);
  }

  // Load attendance/permissions
  let attendance: StaffAttendanceMetrics | null = null;
  let permissions: PermissionPolicyStatus | null = null;
  let schedule: Row[] = [];
  try {
    [attendance, permissions, schedule] = await Promise.all([
      loadStaffAttendanceMetrics(staff, identity, cycleStart, cycleEnd, params.signal),
      PermissionPolicyService.getPermissionPolicyStatus(params.staffId, cycleStart, cycleEnd),
      loadStaffSchedule(staff, identity, cycleStart, cycleEnd, params.signal),
    ]);
    sources.push("staff_schedule", "shift_schedules", "shift_exceptions");
  } catch (error) {
    errorsBySection.attendance = error instanceof Error ? error.message : String(error);
  }

  // Load customer service metrics
  let customerService: StaffCustomerServiceMetrics | null = null;
  try {
    customerService = await loadStaffCustomerServiceMetrics(params.staffId, identity, cycleStart, cycleEnd, params.signal);
    sources.push("daily_followups", "conversation_sales_reviews", "sales_invoices");
  } catch (error) {
    errorsBySection.customer_service = error instanceof Error ? error.message : String(error);
  }

  // Load quarterly performance
  let quarterlyIncentive: StaffQuarterlyMetrics | null = null;
  try {
    quarterlyIncentive = await loadStaffQuarterlyMetrics(params.staffId, identity, quarterStart, quarterEnd, params.signal);
    sources.push("sales_invoices", "employee_transactions");
  } catch (error) {
    errorsBySection.quarterly = error instanceof Error ? error.message : String(error);
  }

  // Load followups
  let followups: Row[] = [];
  try {
    followups = await loadStaffFollowups(params.staffId, identity, cycleStart, cycleEnd, params.signal);
    sources.push("daily_followups");
  } catch (error) {
    errorsBySection.followups = error instanceof Error ? error.message : String(error);
  }

  // Calculate data health
  const dataHealth = calculateStaffDataHealth(staff, identity, sales, customers, attendance, errorsBySection);

  // Generate recommendations
  const recommendations = generateRecommendations({
    staff,
    identity,
    dataHealth,
    monthlyIncentive,
    sales,
    customers,
    stagnantMedicines,
    listItems,
    customerService,
    attendance,
    quarterlyIncentive,
  });

  // Generate charts
  const charts = generateStaffCharts({
    sales,
    monthlyIncentive,
    quarterlyIncentive,
    attendance,
    customerService,
  });

  const profile: StaffPerformanceProfile = {
    staff,
    identity,
    dataHealth,
    monthlyIncentive,
    cashRewards: monthlyIncentive?.quarterlyCashRewards || 0,
    quarterlyIncentive,
    sales,
    customers,
    followups,
    customerService,
    stagnantMedicines,
    listItems,
    inventory: null,
    attendance,
    permissions,
    schedule,
    tasks: null,
    charts,
    recommendations,
    sources,
    lastUpdated: new Date().toISOString(),
    errorsBySection,
  };

  CACHE.set(cacheKey, { data: profile, timestamp: Date.now() });
  return profile;
}

async function resolveStaffIdentity(staff: StaffBaseProfile): Promise<StaffIdentity> {
  const warnings: string[] = [];
  const aliases: string[] = [];
  const normalizedNames: string[] = [];
  const inactiveDuplicateIds: string[] = [];
  const rawSellerNames: string[] = [];

  // Get normalized name
  const normalized = normalizeStaffName(staff.name);
  normalizedNames.push(normalized);

  // Fetch aliases from staff_identity_aliases if table exists
  try {
    const { data: aliasData, error: aliasError } = await supabase
      .from("staff_identity_aliases")
      .select("alias_name")
      .eq("staff_id", staff.id)
      .limit(50);
    
    if (!aliasError && aliasData) {
      const aliasList = (aliasData as Row[]).map((r) => String(r.alias_name || ""));
      aliases.push(...aliasList);
      aliasList.forEach((alias) => {
        const normalizedAlias = normalizeStaffName(alias);
        if (normalizedAlias && !normalizedNames.includes(normalizedAlias)) {
          normalizedNames.push(normalizedAlias);
        }
      });
    }
  } catch (error) {
    // Table might not exist, ignore
  }

  // Check for inactive duplicates
  if (!staff.is_active) {
    try {
      const { data: sameNameStaff } = await supabase
        .from("staff")
        .select("id,name,branch,role,active,is_active")
        .neq("id", staff.id)
        .eq("branch", staff.branch)
        .limit(80);
      
      if (sameNameStaff) {
        const activeMatch = (sameNameStaff as Row[]).find((row) => {
          if (!staffRowIsActive(row as StaffBaseProfile)) return false;
          return normalizeStaffName(String(row.name || "")) === normalized;
        });
        
        if (activeMatch) {
          warnings.push(`هذا الموظف غير نشط. يوجد موظف نشط بنفس الاسم: ${activeMatch.name}`);
          inactiveDuplicateIds.push(String(activeMatch.id));
        }
      }
    } catch (error) {
      // Ignore errors in duplicate check
    }
  }

  // Fetch raw seller names from sales_invoices
  try {
    const { data: invoiceNames } = await supabase
      .from("sales_invoices")
      .select("seller_name")
      .ilike("seller_name", `%${staff.name}%`)
      .limit(100);
    
    if (invoiceNames) {
      const uniqueNames = new Set((invoiceNames as Row[]).map((r) => String(r.seller_name || "")));
      rawSellerNames.push(...Array.from(uniqueNames));
      
      // Check if any names don't match exactly
      const mismatchedNames = Array.from(uniqueNames).filter((name) => {
        const nameNorm = normalizeStaffName(name);
        return !normalizedNames.includes(nameNorm);
      });
      
      if (mismatchedNames.length > 0) {
        warnings.push(`يوجد أسماء في الفواتير غير مربوطة تمامًا: ${mismatchedNames.slice(0, 3).join(", ")}`);
      }
    }
  } catch (error) {
    // Ignore errors in seller name check
  }

  return {
    primaryStaffId: staff.id,
    activeStaffId: staff.is_active ? staff.id : (inactiveDuplicateIds[0] || staff.id),
    displayName: staff.name,
    branch: staff.branch,
    role: staff.role,
    aliases,
    normalizedNames,
    inactiveDuplicateIds,
    rawSellerNames,
    warnings,
  };
}

function toProfileInvoice(invoice: StaffInvoiceTruth["latestInvoices"][number]) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    amount: invoice.amount,
    customer: invoice.customerName || "عميل غير محدد",
    customerCode: invoice.customerCode,
    customerPhone: invoice.customerPhone,
    customerAddress: invoice.customerAddress,
    customerSegment: invoice.customerSegment,
    branch: invoice.branch,
    sellerName: invoice.sellerName,
  };
}

function loadStaffSalesMetrics(invoiceTruth: StaffInvoiceTruth): StaffSalesMetrics {
  const bestDay = [...invoiceTruth.summary.salesByDay].sort((a, b) => b.sales - a.sales)[0]?.date || null;
  const weakestDay = [...invoiceTruth.summary.salesByDay].filter((day) => day.sales > 0).sort((a, b) => a.sales - b.sales)[0]?.date || null;
  const topShift = invoiceTruth.summary.salesByShift[0]?.shift || null;
  const topInvoice = invoiceTruth.summary.maxInvoice
    ? {
        invoiceNumber: invoiceTruth.summary.maxInvoice.invoiceNumber,
        amount: invoiceTruth.summary.maxInvoice.amount,
        date: invoiceTruth.summary.maxInvoice.invoiceDate,
        customer: invoiceTruth.summary.maxInvoice.customerName,
      }
    : null;
  const minInvoice = invoiceTruth.summary.minInvoice
    ? {
        invoiceNumber: invoiceTruth.summary.minInvoice.invoiceNumber,
        amount: invoiceTruth.summary.minInvoice.amount,
        date: invoiceTruth.summary.minInvoice.invoiceDate,
        customer: invoiceTruth.summary.minInvoice.customerName,
      }
    : null;

  const salesMetrics: StaffSalesMetrics = {
    cycleNetSales: invoiceTruth.summary.totalSales,
    cycleInvoicesCount: invoiceTruth.summary.invoicesCount,
    avgInvoice: invoiceTruth.summary.avgInvoice,
    uniqueCustomers: invoiceTruth.summary.uniqueCustomersCount,
    deliveryInvoices: invoiceTruth.summary.deliveryInvoicesCount,
    branchContribution: 0,
    salesGrowthVsPreviousCycle: 0,
    salesGrowthVsPreviousMonth: 0,
    bestDay,
    weakestDay,
    topShift,
    topInvoice,
    minInvoice,
    latestInvoices: invoiceTruth.latestInvoices.map(toProfileInvoice),
    monthlyTrend: invoiceTruth.summary.salesByMonth.map((month) => ({
      month: month.period,
      sales: month.sales,
      invoices: month.invoices,
      avgInvoice: month.invoices > 0 ? month.sales / month.invoices : 0,
    })),
    weeklyDistribution: invoiceTruth.summary.salesByWeek.map((week) => ({ week: week.period, sales: week.sales, invoices: week.invoices })),
    shiftDistribution: invoiceTruth.summary.salesByShift,
    invoiceTypeDistribution: invoiceTruth.summary.salesByInvoiceType,
    branchComparison: invoiceTruth.branchComparison,
    sourceUsed: "invoices_fallback",
    aliasesUsed: invoiceTruth.aliases,
    rawSellerNamesMatched: invoiceTruth.matchedSellerNames,
    dataHealthWarnings: invoiceTruth.diagnostics.warnings,
    invoiceDiagnostics: invoiceTruth.diagnostics,
  };

  return salesMetrics;
}

function dateDaysBefore(baseDate: string, days: number) {
  const base = new Date(`${baseDate || new Date().toISOString().slice(0, 10)}T12:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() - days);
  return base.toISOString().slice(0, 10);
}

function loadStaffCustomerMetrics(invoiceTruth: StaffInvoiceTruth): StaffCustomerMetrics | null {
  try {
    const topCustomers = invoiceTruth.linkedCustomers.slice(0, 30).map((customer) => ({
      name: customer.name || "عميل غير محدد",
      phone: customer.phone || "بدون هاتف",
      code: customer.code,
      address: customer.address,
      segment: customer.segment || "غير مصنف",
      invoicesCount: customer.invoicesCount,
      totalSpent: customer.totalSpent,
      avgInvoice: customer.avgInvoice,
      lastPurchase: customer.lastPurchase,
      lastDoctorInteraction: customer.lastPurchase,
    }));

    const followupThreshold = dateDaysBefore(invoiceTruth.periodEnd, 10);
    const totalCustomerSales = topCustomers.reduce((sum, customer) => sum + customer.totalSpent, 0);
    const averageCustomerValue = topCustomers.length ? totalCustomerSales / topCustomers.length : 0;
    const customersNeedingFollowup = topCustomers
      .filter((customer) => {
        const missingPhone = !customer.phone || customer.phone === "بدون هاتف";
        const stalePurchase = Boolean(customer.lastPurchase && followupThreshold && customer.lastPurchase <= followupThreshold);
        const importantCustomer = customer.totalSpent >= Math.max(averageCustomerValue, 1000);
        return missingPhone || stalePurchase || importantCustomer;
      })
      .slice(0, 12)
      .map((customer) => ({
        name: customer.name,
        phone: customer.phone,
        reason: !customer.phone || customer.phone === "بدون هاتف"
          ? "رقم الهاتف غير مكتمل"
          : customer.lastPurchase <= followupThreshold
            ? "آخر شراء قديم داخل الدورة"
            : "عميل مهم يحتاج تثبيت العلاقة",
        lastPurchase: customer.lastPurchase,
        expectedAction: "متابعة العميل وتسجيل نتيجة واضحة",
      }));

    const repeatCustomers = topCustomers
      .filter((customer) => customer.invoicesCount > 1)
      .map((customer) => ({ name: customer.name, repeatCount: customer.invoicesCount, trend: "repeat" }));
    const monthMap = new Map<string, { customerKeys: Set<string>; newCustomers: number; repeatCustomers: number }>();
    invoiceTruth.invoices.forEach((invoice) => {
      const month = (invoice.invoiceDate || "").slice(0, 7) || invoiceTruth.periodStart.slice(0, 7);
      const key = invoice.customerCode || invoice.customerPhone || invoice.customerName || invoice.invoiceNumber;
      const customer = invoiceTruth.linkedCustomers.find((item) => item.key === (invoice.customerPhone || invoice.customerCode || invoice.customerName));
      const current = monthMap.get(month) || { customerKeys: new Set<string>(), newCustomers: 0, repeatCustomers: 0 };
      if (key) current.customerKeys.add(key);
      if ((customer?.invoicesCount || 1) <= 1) current.newCustomers += 1;
      else current.repeatCustomers += 1;
      monthMap.set(month, current);
    });
    const monthlyCustomerTrend = [...monthMap.entries()]
      .map(([month, stats]) => ({ month, customerCount: stats.customerKeys.size }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const newVsRepeatTrend = [...monthMap.entries()]
      .map(([month, stats]) => ({ month, newCustomers: stats.newCustomers, repeatCustomers: stats.repeatCustomers }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const segmentCounts = new Map<string, number>();
    topCustomers.forEach((customer) => {
      const segment = customer.segment || "غير مصنف";
      segmentCounts.set(segment, (segmentCounts.get(segment) || 0) + 1);
    });
    const segmentDistribution = [...segmentCounts.entries()]
      .map(([segment, count]) => ({
        segment,
        count,
        percentage: topCustomers.length ? (count / topCustomers.length) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      topCustomers,
      customersNeedingFollowup,
      repeatCustomers,
      lostOrDecliningCustomers: [],
      customersReturnedAfterFollowup: [],
      newCustomers: topCustomers.filter((customer) => customer.invoicesCount <= 1).length,
      customersWithComplaints: 0,
        customersWithMissingPhone: topCustomers.filter((customer) => !customer.phone || customer.phone === "بدون هاتف").length,
      customersNeedingFollowupCount: customersNeedingFollowup.length,
      customersWithHighMonthlyAverage: topCustomers.filter((customer) => customer.totalSpent >= Math.max(averageCustomerValue, 1000)).length,
      customersSensitiveToPrice: 0,
      customersWhoDislikeAlternatives: 0,
      customersWhoShouldNotReceiveDeliveryFee: 0,
      monthlyCustomerTrend,
      segmentDistribution,
      newVsRepeatTrend,
      top10CustomersChart: topCustomers.slice(0, 10).map((c) => ({ name: c.name, amount: c.totalSpent })),
    };
  } catch (error) {
    console.error("Error loading staff customer metrics:", error);
    return null;
  }
}

async function loadStaffStagnantListMetrics(
  staffId: string,
  identity: StaffIdentity,
  cycleStart: string,
  cycleEnd: string,
  signal?: AbortSignal
): Promise<{ stagnant: StaffStagnantListMetrics; list: StaffStagnantListMetrics }> {
  try {
    // Load stagnant medicines by staff_id and responsible_doctor_name
    const [stagnantsById, stagnantsByName] = await Promise.all([
      supabase.from("stagnant_medicines").select("*").eq("responsible_doctor_id", staffId).limit(200),
      supabase.from("stagnant_medicines").select("*").eq("responsible_doctor_name", identity.displayName).limit(200),
    ]);

    const stagnantMap = new Map<string, Row>();
    for (const row of [...(stagnantsById.data || []), ...(stagnantsByName.data || [])]) {
      const id = String((row as Row).id || "");
      if (id) stagnantMap.set(id, row as Row);
    }

    // Load stagnant dispenses for the cycle
    const { data: stagnantDispenses } = await supabase
      .from("stagnant_medicine_dispenses")
      .select("*")
      .eq("staff_id", staffId)
      .gte("created_at", cycleStart)
      .lt("created_at", cycleEnd)
      .limit(300);

    // Calculate stagnant metrics
    const stagnantRows = Array.from(stagnantMap.values());
    const stagnantTargetQuantity = stagnantRows.reduce((sum, row) => sum + (Number(row.total_quantity) || 0), 0);
    const stagnantSoldQuantity = (stagnantDispenses || []).reduce((sum, row) => sum + (Number((row as Row).quantity) || 0), 0);
    const stagnantRemainingQuantity = stagnantTargetQuantity - stagnantSoldQuantity;
    const stagnantCompletionPercent = stagnantTargetQuantity > 0 ? (stagnantSoldQuantity / stagnantTargetQuantity) * 100 : 0;
    
    // Calculate stagnant cash rewards from dispenses
    const stagnantCashRewards = (stagnantDispenses || []).reduce((sum, row) => {
      const incentive = Number((row as Row).incentive_amount) || 0;
      return sum + incentive;
    }, 0);

    // Stagnant warnings
    const stagnantWarnings: string[] = [];
    if (stagnantCompletionPercent < 50) {
      stagnantWarnings.push(`الرواكد المخصصة لم تتحرك بالشكل المطلوب (${stagnantCompletionPercent.toFixed(0)}% فقط)`);
    }
    if (stagnantRemainingQuantity > 0) {
      stagnantWarnings.push(`يوجد ${stagnantRemainingQuantity} وحدة رواكد متبقية`);
    }

    // Stagnant progress
    const stagnantProgress = stagnantRows.map((row) => ({
      target: Number(row.total_quantity) || 0,
      sold: (stagnantDispenses || []).filter((d) => String((d as Row).medicine_id) === String(row.id)).reduce((sum, d) => sum + (Number((d as Row).quantity) || 0), 0),
      remaining: (Number(row.total_quantity) || 0) - (stagnantDispenses || []).filter((d) => String((d as Row).medicine_id) === String(row.id)).reduce((sum, d) => sum + (Number((d as Row).quantity) || 0), 0),
    }));

    // Top remaining items
    const topRemainingItems = stagnantRows
      .map((row) => ({
        name: String(row.medicine_name || row.product_name || ""),
        remaining: (Number(row.total_quantity) || 0) - (stagnantDispenses || []).filter((d) => String((d as Row).medicine_id) === String(row.id)).reduce((sum, d) => sum + (Number((d as Row).quantity) || 0), 0),
        expiryDate: String(row.expiry_date || row.nearest_expiry_date || ""),
      }))
      .filter((item) => item.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining)
      .slice(0, 10);

    // Items near expiry
    const itemsNearExpiry = stagnantRows
      .map((row) => {
        const expiryDate = new Date(String(row.expiry_date || row.nearest_expiry_date || ""));
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const remaining = (Number(row.total_quantity) || 0) - (stagnantDispenses || []).filter((d) => String((d as Row).medicine_id) === String(row.id)).reduce((sum, d) => sum + (Number((d as Row).quantity) || 0), 0);
        return {
          name: String(row.medicine_name || row.product_name || ""),
          remaining,
          expiryDate: String(row.expiry_date || row.nearest_expiry_date || ""),
          daysUntilExpiry,
        };
      })
      .filter((item) => item.remaining > 0 && item.daysUntilExpiry <= 30)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
      .slice(0, 10);

    // Load list items (incentive_medicines)
    const [listById, listByName] = await Promise.all([
      supabase.from("incentive_medicines").select("*").eq("doctor_id", staffId).limit(200),
      supabase.from("incentive_medicines").select("*").eq("responsible_doctor", identity.displayName).limit(200),
    ]);

    const listMap = new Map<string, Row>();
    for (const row of [...(listById.data || []), ...(listByName.data || [])]) {
      const id = String((row as Row).id || "");
      if (id) listMap.set(id, row as Row);
    }

    // Load list sales for the cycle
    const { data: listSales } = await supabase
      .from("incentive_medicine_sales")
      .select("*")
      .eq("staff_id", staffId)
      .gte("created_at", cycleStart)
      .lt("created_at", cycleEnd)
      .limit(300);

    // Calculate list metrics
    const listRows = Array.from(listMap.values());
    const listTargetQuantity = listRows.reduce((sum, row) => sum + (Number(row.target_min_percent ? (Number(row.current_quantity) || 0) * (Number(row.target_min_percent) / 100) : row.current_quantity) || 0), 0);
    const listSoldQuantity = (listSales || []).reduce((sum, row) => sum + (Number((row as Row).quantity) || 0), 0);
    const listRemainingQuantity = listTargetQuantity - listSoldQuantity;
    const listCompletionPercent = listTargetQuantity > 0 ? (listSoldQuantity / listTargetQuantity) * 100 : 0;
    
    // Calculate list cash rewards from sales
    const listCashRewards = (listSales || []).reduce((sum, row) => {
      const incentive = Number((row as Row).incentive_amount) || 0;
      return sum + incentive;
    }, 0);

    // List warnings
    const listWarnings: string[] = [];
    if (listCompletionPercent < 50) {
      listWarnings.push(`أصناف اللستة لم تتحرك بالشكل المطلوب (${listCompletionPercent.toFixed(0)}% فقط)`);
    }
    if (listRemainingQuantity > 0) {
      listWarnings.push(`يوجد ${listRemainingQuantity} وحدة من اللستة متبقية`);
    }

    // List progress
    const listProgress = listRows.map((row) => {
      const target = Number(row.target_min_percent ? (Number(row.current_quantity) || 0) * (Number(row.target_min_percent) / 100) : row.current_quantity) || 0;
      const sold = (listSales || []).filter((s) => String((s as Row).medicine_id) === String(row.id)).reduce((sum, s) => sum + (Number((s as Row).quantity) || 0), 0);
      return {
        target,
        sold,
        remaining: target - sold,
      };
    });

    // Monthly cash rewards (placeholder - needs historical data)
    const monthlyCashRewards: Array<{ month: string; rewards: number }> = [];

    return {
      stagnant: {
        assignedStagnantItems: stagnantRows.length,
        stagnantTargetQuantity,
        stagnantSoldQuantity,
        stagnantRemainingQuantity,
        stagnantCompletionPercent,
        stagnantCashRewards,
        stagnantWarnings,
        stagnantMissedTargets: stagnantRows.filter((row) => {
          const sold = (stagnantDispenses || []).filter((d) => String((d as Row).medicine_id) === String(row.id)).reduce((sum, d) => sum + (Number((d as Row).quantity) || 0), 0);
          const target = Number(row.total_quantity) || 0;
          return sold < target * 0.5;
        }).map((row) => String(row.medicine_name || row.product_name || "")),
        assignedListItems: 0,
        listTargetQuantity: 0,
        listSoldQuantity: 0,
        listRemainingQuantity: 0,
        listCompletionPercent: 0,
        listCashRewards: 0,
        listWarnings: [],
        stagnantProgress,
        listProgress: [],
        monthlyCashRewards,
        topRemainingItems,
        itemsNearExpiry,
      },
      list: {
        assignedStagnantItems: 0,
        stagnantTargetQuantity: 0,
        stagnantSoldQuantity: 0,
        stagnantRemainingQuantity: 0,
        stagnantCompletionPercent: 0,
        stagnantCashRewards: 0,
        stagnantWarnings: [],
        stagnantMissedTargets: [],
        assignedListItems: listRows.length,
        listTargetQuantity,
        listSoldQuantity,
        listRemainingQuantity,
        listCompletionPercent,
        listCashRewards,
        listWarnings,
        stagnantProgress: [],
        listProgress,
        monthlyCashRewards,
        topRemainingItems: [],
        itemsNearExpiry: [],
      },
    };
  } catch (error) {
    return {
      stagnant: {
        assignedStagnantItems: 0,
        stagnantTargetQuantity: 0,
        stagnantSoldQuantity: 0,
        stagnantRemainingQuantity: 0,
        stagnantCompletionPercent: 0,
        stagnantCashRewards: 0,
        stagnantWarnings: [],
        stagnantMissedTargets: [],
        assignedListItems: 0,
        listTargetQuantity: 0,
        listSoldQuantity: 0,
        listRemainingQuantity: 0,
        listCompletionPercent: 0,
        listCashRewards: 0,
        listWarnings: [],
        stagnantProgress: [],
        listProgress: [],
        monthlyCashRewards: [],
        topRemainingItems: [],
        itemsNearExpiry: [],
      },
      list: {
        assignedStagnantItems: 0,
        stagnantTargetQuantity: 0,
        stagnantSoldQuantity: 0,
        stagnantRemainingQuantity: 0,
        stagnantCompletionPercent: 0,
        stagnantCashRewards: 0,
        stagnantWarnings: [],
        stagnantMissedTargets: [],
        assignedListItems: 0,
        listTargetQuantity: 0,
        listSoldQuantity: 0,
        listRemainingQuantity: 0,
        listCompletionPercent: 0,
        listCashRewards: 0,
        listWarnings: [],
        stagnantProgress: [],
        listProgress: [],
        monthlyCashRewards: [],
        topRemainingItems: [],
        itemsNearExpiry: [],
      },
    };
  }
}

async function loadOptionalTableRows(table: string, limit = 1000): Promise<Row[]> {
  try {
    const { data, error } = await supabase.from(table).select("*").limit(limit);
    if (error || !data) return [];
    return data as Row[];
  } catch {
    return [];
  }
}

function valueAsDate(row: Row): string {
  return String(row.date || row.attendance_date || row.shift_date || row.work_date || row.day_date || row.request_date || row.start_date || row.created_at || "").slice(0, 10);
}

function inPeriod(date: string, start: string, end: string) {
  if (!date) return true; // weekly templates have no concrete date; keep them as schedule evidence
  return date >= start && date <= end;
}

function rowMatchesStaff(row: Row, staff: StaffBaseProfile, identity: StaffIdentity) {
  const idCandidates = [row.staff_id, row.employee_id, row.doctor_id, row.user_id, row.rider_id].map((v) => String(v || "").trim());
  if (idCandidates.includes(staff.id)) return true;

  const aliases = new Set([staff.name, identity.displayName, ...identity.aliases, ...identity.rawSellerNames].map((v) => normalizeStaffName(String(v || ""))).filter(Boolean));
  const nameCandidates = [
    row.staff_name,
    row.employee_name,
    row.doctor_name,
    row.name,
    row.member_name,
    row.user_name,
    row.rider_name,
  ].map((v) => normalizeStaffName(String(v || ""))).filter(Boolean);
  return nameCandidates.some((name) => aliases.has(name));
}


function followupMatchesStaff(row: Row, staffId: string, identity: StaffIdentity) {
  const idCandidates = [
    row.staff_id,
    row.employee_id,
    row.doctor_id,
    row.user_id,
    row.assigned_staff_id,
    row.assigned_doctor_id,
    row.responsible_staff_id,
    row.requested_by_staff_id,
    row.created_by_staff_id,
    row.followup_by_staff_id,
  ].map((v) => String(v || "").trim()).filter(Boolean);
  if (idCandidates.includes(staffId) || idCandidates.includes(identity.primaryStaffId) || idCandidates.includes(identity.activeStaffId)) return true;

  const aliases = new Set([
    identity.displayName,
    ...identity.aliases,
    ...identity.rawSellerNames,
    ...identity.normalizedNames,
  ].map((v) => normalizeStaffName(String(v || ""))).filter(Boolean));

  const nameCandidates = [
    row.staff_name,
    row.employee_name,
    row.doctor_name,
    row.assigned_staff_name,
    row.assigned_doctor_name,
    row.responsible_name,
    row.responsible_staff,
    row.requested_by,
    row.requested_by_name,
    row.created_by,
    row.created_by_name,
    row.followup_by,
    row.followup_by_name,
    row.seller_name,
    row.pharmacist_name,
  ].map((v) => normalizeStaffName(String(v || ""))).filter(Boolean);

  return nameCandidates.some((name) => aliases.has(name));
}

function isOffRow(row: Row) {
  const status = String(row.status || row.shift_status || row.type || row.kind || "").toLowerCase();
  return Boolean(row.is_day_off || row.is_off || row.day_off || status.includes("off") || status.includes("اجاز") || status.includes("إجاز") || status.includes("راحة"));
}

function isPresentRow(row: Row) {
  const status = String(row.status || row.attendance_status || "").toLowerCase();
  return Boolean(status.includes("present") || status.includes("حاضر") || row.check_in_time || row.check_in || row.clock_in || row.arrival_time);
}

function isAbsentRow(row: Row) {
  const status = String(row.status || row.attendance_status || "").toLowerCase();
  return Boolean(status.includes("absent") || status.includes("غائب") || status.includes("غياب"));
}

function timeToMinutes(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

async function loadStaffAttendanceMetrics(
  staff: StaffBaseProfile,
  identity: StaffIdentity,
  cycleStart: string,
  cycleEnd: string,
  signal?: AbortSignal
): Promise<StaffAttendanceMetrics | null> {
  void signal;
  try {
    const scheduleTables = ["shift_schedules", "staff_schedule", "staff_schedules", "schedule"];
    const attendanceTables = ["staff_attendance", "attendance", "shift_attendance"];
    const permissionTables = ["staff_permissions", "permission_requests", "leave_requests", "time_off", "exceptional_leaves", "vacations"];

    const scheduleRowsNested = await Promise.all(scheduleTables.map((table) => loadOptionalTableRows(table, 1200)));
    const scheduleData = scheduleRowsNested
      .flat()
      .filter((row) => rowMatchesStaff(row, staff, identity))
      .filter((row) => inPeriod(valueAsDate(row), cycleStart, cycleEnd));

    const attendanceRowsNested = await Promise.all(attendanceTables.map((table) => loadOptionalTableRows(table, 1200)));
    const attendanceData = attendanceRowsNested
      .flat()
      .filter((row) => rowMatchesStaff(row, staff, identity))
      .filter((row) => inPeriod(valueAsDate(row), cycleStart, cycleEnd));

    const permissionRowsNested = await Promise.all(permissionTables.map((table) => loadOptionalTableRows(table, 1200)));
    const permissionData = permissionRowsNested
      .flat()
      .filter((row) => rowMatchesStaff(row, staff, identity))
      .filter((row) => inPeriod(valueAsDate(row), cycleStart, cycleEnd));

    const scheduledRows = scheduleData.filter((row) => !isOffRow(row));
    const offRows = scheduleData.filter(isOffRow);
    const scheduledDays = scheduledRows.length;
    const attendedDays = attendanceData.filter(isPresentRow).length;
    const recordedAbsences = attendanceData.filter(isAbsentRow).length;

    const permissionDates = new Set(permissionData.map(valueAsDate).filter(Boolean));
    const attendanceDates = new Set(attendanceData.filter(isPresentRow).map(valueAsDate).filter(Boolean));
    const derivedAbsences = scheduledRows.filter((row) => {
      const date = valueAsDate(row);
      return date && !attendanceDates.has(date) && !permissionDates.has(date);
    }).length;
    const absences = Math.max(recordedAbsences, derivedAbsences);

    const delayRows = attendanceData.filter((row) => {
      const checkIn = timeToMinutes(row.check_in_time || row.check_in || row.clock_in || row.arrival_time);
      const scheduledStart = timeToMinutes(row.scheduled_start_time || row.shift_start || row.start_time || row.from_time || row.from);
      if (checkIn === null || scheduledStart === null) return false;
      return checkIn - scheduledStart > 5;
    });
    const delays = delayRows.length;
    const delaysOver20Minutes = delayRows.filter((row) => {
      const checkIn = timeToMinutes(row.check_in_time || row.check_in || row.clock_in || row.arrival_time) || 0;
      const scheduledStart = timeToMinutes(row.scheduled_start_time || row.shift_start || row.start_time || row.from_time || row.from) || 0;
      return checkIn - scheduledStart > 20;
    }).length;

    const permissionsUsed = permissionData.length;
    const freePermissionsRemaining = Math.max(0, 3 - permissionsUsed);
    const unauthorizedAbsences = Math.max(0, absences - permissionsUsed);
    const scheduleExceptions = offRows.length;
    const attendanceCompliance = scheduledDays > 0
      ? Math.max(0, Math.min(100, ((attendedDays + Math.min(permissionsUsed, absences)) / scheduledDays) * 100 - delaysOver20Minutes * 2))
      : attendanceData.length > 0 ? 100 : 0;

    const delayTrend = delayRows
      .map((row) => {
        const checkIn = timeToMinutes(row.check_in_time || row.check_in || row.clock_in || row.arrival_time) || 0;
        const scheduledStart = timeToMinutes(row.scheduled_start_time || row.shift_start || row.start_time || row.from_time || row.from) || 0;
        return { date: valueAsDate(row), delayMinutes: Math.max(0, checkIn - scheduledStart) };
      })
      .filter((row) => row.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const permissionsUsage = permissionData.map((row) => ({
      date: valueAsDate(row),
      reason: String(row.reason || row.notes || row.type || row.kind || row.status || "إذن/إجازة"),
    }));

    return {
      scheduledDays,
      attendedDays,
      absences,
      delays,
      delaysOver20Minutes,
      permissionsUsed,
      freePermissionsRemaining,
      unauthorizedAbsences,
      scheduleExceptions,
      attendanceCompliance,
      delayTrend,
      permissionsUsage,
    };
  } catch (error) {
    return {
      scheduledDays: 0,
      attendedDays: 0,
      absences: 0,
      delays: 0,
      delaysOver20Minutes: 0,
      permissionsUsed: 0,
      freePermissionsRemaining: 3,
      unauthorizedAbsences: 0,
      scheduleExceptions: 0,
      attendanceCompliance: 0,
      delayTrend: [],
      permissionsUsage: [],
    };
  }
}

async function loadStaffSchedule(
  staff: StaffBaseProfile,
  identity: StaffIdentity,
  cycleStart: string,
  cycleEnd: string,
  signal?: AbortSignal
): Promise<Row[]> {
  void signal;
  const tables = ["shift_schedules", "staff_schedule", "staff_schedules", "schedule"];
  const allRows = (await Promise.all(tables.map((table) => loadOptionalTableRows(table, 1200)))).flat();
  return allRows
    .filter((row) => rowMatchesStaff(row, staff, identity))
    .filter((row) => inPeriod(valueAsDate(row), cycleStart, cycleEnd))
    .slice(0, 200);
}

async function loadStaffCustomerServiceMetrics(
  staffId: string,
  identity: StaffIdentity,
  cycleStart: string,
  cycleEnd: string,
  signal?: AbortSignal
): Promise<StaffCustomerServiceMetrics | null> {
  try {
    // Load followup data
    const { data: followupData } = await supabase
      .from("daily_followups")
      .select("*")
      .gte("created_at", cycleStart)
      .lte("created_at", cycleEnd)
      .limit(1000);
    const staffFollowups = ((followupData || []) as Row[]).filter((row) => followupMatchesStaff(row, staffId, identity));

    const followupsAssigned = staffFollowups.length;
    const followupsCompleted = staffFollowups.filter((row) => isCompletedFollowup(row)).length;
    const followupsMissed = staffFollowups.filter((row) => isMissedFollowup(row)).length;

    // Load conversation reviews
    const { data: reviewData } = await supabase
      .from("conversation_sales_reviews")
      .select("*")
      .eq("staff_id", staffId)
      .gte("created_at", cycleStart)
      .lte("created_at", cycleEnd)
      .limit(200);

    const complaintCount = (reviewData || []).filter((row) => row.has_complaint || row.complaint_flag).length;
    const resolvedComplaints = (reviewData || []).filter((row) => row.has_complaint && row.complaint_resolved).length;

    // Calculate average conversation evaluation score
    const scoredReviews = (reviewData || []).filter((row) => row.final_score != null);
    const conversationEvaluationAverage = scoredReviews.length > 0
      ? scoredReviews.reduce((sum, row) => sum + (Number(row.final_score) || 0), 0) / scoredReviews.length
      : 0;

    // Load invoices for classification quality check
    const invoiceData = await getStaffCycleInvoices(
      staffId,
      identity.displayName,
      identity.branch,
      cycleStart,
      cycleEnd,
      5000
    );

    const missingCustomerClassification = (invoiceData || []).filter((row) => !row.customerSegment && !row.customerType).length;
    const missingInvoiceClassification = (invoiceData || []).filter((row) => !row.invoiceType && !row.invoiceCategory).length;
    const bothClassificationsMissing = (invoiceData || []).filter((row) => 
      !row.customerSegment && !row.customerType && !row.invoiceType && !row.invoiceCategory
    ).length;

    // Poor classification quality (generic classifications like "other" or "general")
    const poorClassificationQuality = (invoiceData || []).filter((row) => {
      const customerSeg = String(row.customerSegment || row.customerType || "").toLowerCase();
      const invoiceCat = String(row.invoiceType || row.invoiceCategory || "").toLowerCase();
      return customerSeg === "other" || customerSeg === "general" || invoiceCat === "other" || invoiceCat === "general";
    }).length;

    // Missing important notes
    const missingImportantNotes = (reviewData || []).filter((row) => !row.reviewer_notes && !row.notes).length;

    // Customers without valid phone handled
    const customersWithoutValidPhoneHandled = (invoiceData || []).filter((row) => {
      const phone = String(row.customerPhone || "");
      return phone.length < 10 || phone === "0000000000" || phone === "1111111111";
    }).length;

    // Build followup results (aggregated by month)
    const followupResultsMap = new Map<string, { assigned: number; completed: number; missed: number }>();
    staffFollowups.forEach((row) => {
      const month = String(row.created_at || "").slice(0, 7);
      const existing = followupResultsMap.get(month) || { assigned: 0, completed: 0, missed: 0 };
      existing.assigned++;
      if (isCompletedFollowup(row)) existing.completed++;
      if (isMissedFollowup(row)) existing.missed++;
      followupResultsMap.set(month, existing);
    });
    const followupResults = Array.from(followupResultsMap.entries()).map(([month, stats]) => ({
      assigned: stats.assigned,
      completed: stats.completed,
      missed: stats.missed,
    }));

    // Build classification quality (metrics and scores)
    const classificationQuality = [
      { metric: "تصنيف العميل", score: invoiceData ? 100 - (missingCustomerClassification / (invoiceData.length || 1)) * 100 : 0 },
      { metric: "تصنيف الفاتورة", score: invoiceData ? 100 - (missingInvoiceClassification / (invoiceData.length || 1)) * 100 : 0 },
      { metric: "جودة التصنيف", score: invoiceData ? 100 - (poorClassificationQuality / (invoiceData.length || 1)) * 100 : 0 },
    ];

    // Build complaints and resolutions
    const complaintsAndResolutions = (reviewData || [])
      .filter((row) => row.has_complaint || row.complaint_flag)
      .map((row) => ({
        date: String(row.conversation_date || row.created_at || ""),
        complaint: String(row.complaint_type || row.main_negative_reason || "شكوى عامة"),
        resolved: Boolean(row.complaint_resolved),
      }));

    // Build conversations and evaluations
    const conversationsAndEvaluations = (reviewData || []).map((row) => ({
      date: String(row.conversation_date || row.created_at || ""),
      score: Number(row.final_score || 0),
    }));

    return {
      followupsAssigned,
      followupsCompleted,
      followupsMissed,
      complaintCount,
      resolvedComplaints,
      conversationEvaluationAverage,
      missingCustomerClassification,
      missingInvoiceClassification,
      bothClassificationsMissing,
      poorClassificationQuality,
      missingImportantNotes,
      customersWithoutValidPhoneHandled,
      followupResults,
      classificationQuality,
      complaintsAndResolutions,
      conversationsAndEvaluations,
    };
  } catch (error) {
    return null;
  }
}

async function loadStaffQuarterlyMetrics(
  staffId: string,
  identity: StaffIdentity,
  quarterStart: string,
  quarterEnd: string,
  signal?: AbortSignal
): Promise<StaffQuarterlyMetrics | null> {
  try {
    // Load quarterly incentive summary for the quarter
    const staffInvoices = await getStaffCycleInvoices(
      staffId,
      identity.displayName,
      identity.branch,
      quarterStart,
      quarterEnd,
      5000
    );

    const sales = staffInvoices.reduce((sum, row) => sum + row.netTotal, 0);
    const invoicesCount = staffInvoices.length;
    const avgInvoice = invoicesCount > 0 ? sales / invoicesCount : 0;
    const customersCount = new Set(staffInvoices.map((r) => String(r.customerName || r.customerCode || ""))).size;

    // Load list sales for the quarter
    const { data: listSales } = await supabase
      .from("doctor_incentive_sales")
      .select("*")
      .gte("created_at", quarterStart)
      .lte("created_at", quarterEnd)
      .limit(5000);

    const staffListSales = (listSales || []).filter((row) => {
      const rowStaffId = String(row.staff_id || row.doctor_id || "");
      const rowStaffName = String(row.staff_name || row.doctor_name || "");
      return rowStaffId === staffId || identity.normalizedNames.some((norm) => normalizeStaffName(rowStaffName) === norm);
    });

    const achievedQty = staffListSales.reduce((sum, row) => sum + (Number(row.quantity || row.qty || 0)), 0);

    // Load targets
    const { data: targets } = await supabase
      .from("doctor_incentive_targets")
      .select("*")
      .limit(5000);

    const staffTargets = (targets || []).filter((row) => {
      const rowStaffId = String(row.staff_id || "");
      const rowStaffName = String(row.staff_name || row.doctor_name || row.responsible_doctor || "");
      return rowStaffId === staffId || identity.normalizedNames.some((norm) => normalizeStaffName(rowStaffName) === norm);
    });

    const targetQty = staffTargets.reduce((sum, row) => sum + (Number(row.target_quantity || row.quantity_target || 0)), 0);

    // Load stagnant dispenses
    const { data: stagnantDispenses } = await supabase
      .from("stagnant_medicine_dispenses")
      .select("*")
      .gte("created_at", quarterStart)
      .lte("created_at", quarterEnd)
      .limit(5000);

    const staffStagnantDispenses = (stagnantDispenses || []).filter((row) => {
      const rowStaffId = String(row.staff_id || row.doctor_id || "");
      const rowStaffName = String(row.staff_name || row.doctor_name || row.responsible_doctor_name || "");
      return rowStaffId === staffId || identity.normalizedNames.some((norm) => normalizeStaffName(rowStaffName) === norm);
    });

    const stagnantCount = staffStagnantDispenses.length;

    // Load transactions for quarterly cash rewards/deductions
    const { data: transactions } = await supabase
      .from("employee_transactions")
      .select("*")
      .gte("created_at", quarterStart)
      .lte("created_at", quarterEnd)
      .limit(5000);

    const staffTransactions = (transactions || []).filter((row) => {
      const rowStaffId = String(row.staff_id || row.employee_id || "");
      const rowStaffName = String(row.employee_name || "");
      return rowStaffId === staffId || identity.normalizedNames.some((norm) => normalizeStaffName(rowStaffName) === norm);
    });

    // Calculate quarterly cash rewards (stagnant/list)
    const quarterlyCashRewards = staffTransactions.reduce((sum, t) => {
      const delta = Number(t.points_delta || t.points || 0);
      if (delta <= 0) return sum;
      
      const meta = (t.metadata as Record<string, unknown>) || {};
      const text = [
        t.source_type, t.source, t.source_module, t.reason, t.description, t.title, t.manager_note,
        meta.source_type, meta.source, meta.source_module, meta.rule_code, meta.impact_type, meta.category
      ].map((v) => String(v || "").toLowerCase()).join(" ");
      
      const isStagnantOrList = /(stagnant|stagnant_medicine|incentive_medicine|list_item|list_items|medicine_sales|راكد|رواكد|لسته|لستة|اصناف اللسته|أصناف اللستة|صنف حافز|صرف لست)/i.test(text);
      const isExplicitMonthly = /(monthly_exceptional_reward|monthly_points|نقاط شهريه|نقاط شهرية)/i.test(text);
      
      if (isStagnantOrList && !isExplicitMonthly) {
        const moneyAmount = Number(meta.money_amount || meta.reward_amount || meta.total_incentive || 0);
        return sum + (moneyAmount > 0 ? moneyAmount : delta);
      }
      return sum;
    }, 0);

    // Calculate quarterly cash deductions
    const quarterlyCashDeductions = staffTransactions.reduce((sum, t) => {
      const delta = Number(t.points_delta || t.points || 0);
      if (delta >= 0) return sum;
      
      const meta = (t.metadata as Record<string, unknown>) || {};
      const text = [
        t.source_type, t.source, t.source_module, t.reason, t.description, t.title, t.manager_note,
        meta.source_type, meta.source, meta.source_module, meta.rule_code, meta.impact_type, meta.category
      ].map((v) => String(v || "").toLowerCase()).join(" ");
      
      const isQuarterlyDeduction = /(quarterly_money_deduction|quarterly_deduction|خصم ربع سنوي)/i.test(text);
      
      if (isQuarterlyDeduction) {
        const moneyAmount = Number(meta.money_amount || meta.money_delta || 0);
        return sum + (moneyAmount > 0 ? moneyAmount : Math.abs(delta));
      }
      return sum;
    }, 0);

    // Calculate score breakdown (simplified version)
    const scoreSales = Math.min(25, Math.round((sales / 100000) * 25)); // Assuming 100k as max
    const scoreAvg = Math.min(20, Math.round((avgInvoice / 1000) * 20)); // Assuming 1000 as max
    const scoreCustomers = Math.min(20, Math.round((customersCount / 50) * 20)); // Assuming 50 as max
    const listRatio = targetQty ? Math.min(1, achievedQty / targetQty) : 0;
    const scoreList = Math.round(listRatio * 15);
    const scoreStock = Math.min(10, stagnantCount * 2);
    const dataQuality = staffInvoices.filter((i) => Boolean(i.customerCode || i.customerName)).length / (invoicesCount || 1);
    const scoreQuality = Math.max(0, Math.round(dataQuality * 10));
    
    const quarterlyScore = scoreSales + scoreAvg + scoreCustomers + scoreList + scoreStock + scoreQuality;
    const baseQuarterlyIncentive = 2000;
    const quarterlyFinalValue = baseQuarterlyIncentive + quarterlyCashRewards - quarterlyCashDeductions;

    // Weekly sales trend
    const weeklySalesMap = new Map<string, number>();
    staffInvoices.forEach((invoice) => {
      const date = new Date(String(invoice.invoiceDate || ""));
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().slice(0, 10);
      weeklySalesMap.set(weekKey, (weeklySalesMap.get(weekKey) || 0) + invoice.netTotal);
    });

    const weeklySalesTrend = Array.from(weeklySalesMap.entries())
      .map(([week, sales]) => ({ week, sales }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Rewards and deductions breakdown
    const rewardsAndDeductions: Array<{ type: string; amount: number; date: string }> = [];
    staffTransactions.forEach((t) => {
      const delta = Number(t.points_delta || t.points || 0);
      const meta = (t.metadata as Record<string, unknown>) || {};
      const text = [
        t.source_type, t.source, t.source_module, t.reason, t.description, t.title, t.manager_note,
        meta.source_type, meta.source, meta.source_module, meta.rule_code, meta.impact_type, meta.category
      ].map((v) => String(v || "").toLowerCase()).join(" ");
      
      const isStagnantOrList = /(stagnant|stagnant_medicine|incentive_medicine|list_item|list_items|medicine_sales|راكد|رواكد|لسته|لستة|اصناف اللسته|أصناف اللستة|صنف حافز|صرف لست)/i.test(text);
      const isQuarterlyDeduction = /(quarterly_money_deduction|quarterly_deduction|خصم ربع سنوي)/i.test(text);
      
      if (delta > 0 && isStagnantOrList) {
        const moneyAmount = Number(meta.money_amount || meta.reward_amount || meta.total_incentive || 0);
        rewardsAndDeductions.push({
          type: "مكافأة رواكد/لستة",
          amount: moneyAmount > 0 ? moneyAmount : delta,
          date: String(t.created_at || ""),
        });
      } else if (delta < 0 && isQuarterlyDeduction) {
        const moneyAmount = Number(meta.money_amount || meta.money_delta || 0);
        rewardsAndDeductions.push({
          type: "خصم ربع سنوي",
          amount: -(moneyAmount > 0 ? moneyAmount : Math.abs(delta)),
          date: String(t.created_at || ""),
        });
      }
    });

    return {
      quarterlyScore,
      baseQuarterlyIncentive,
      quarterlyCashRewards,
      quarterlyCashDeductions,
      quarterlyFinalValue,
      rankInBranch: 0, // Would need to load all staff in branch to calculate
      rankAcrossPharmacy: 0, // Would need to load all staff to calculate
      scoreBreakdown: {
        salesGrowth: scoreSales,
        avgInvoice: scoreAvg,
        customers: scoreCustomers,
        listItems: scoreList,
        stagnantInventory: scoreStock,
        registrationQuality: scoreQuality,
      },
      weeklySalesTrend,
      branchComparison: { staffScore: quarterlyScore, branchAverage: 0, difference: 0 },
      rewardsAndDeductions,
    };
  } catch (error) {
    return null;
  }
}

async function loadStaffFollowups(
  staffId: string,
  identity: StaffIdentity,
  cycleStart: string,
  cycleEnd: string,
  signal?: AbortSignal
): Promise<Row[]> {
  const { data, error } = await supabase
    .from("daily_followups")
    .select("*")
    .gte("created_at", cycleStart)
    .lte("created_at", cycleEnd)
    .limit(1000);
  
  if (error) throw error;
  return ((data || []) as Row[]).filter((row) => followupMatchesStaff(row, staffId, identity));
}

function calculateStaffDataHealth(
  staff: StaffBaseProfile,
  identity: StaffIdentity,
  sales: StaffSalesMetrics | null,
  customers: StaffCustomerMetrics | null,
  attendance: StaffAttendanceMetrics | null,
  errors: Record<string, string>
): StaffDataHealth {
  const warnings: string[] = [];
  
  if (identity.warnings.length > 0) {
    warnings.push(...identity.warnings);
  }
  if (sales?.dataHealthWarnings?.length) {
    warnings.push(...sales.dataHealthWarnings);
  }
  
  if (!sales || sales.cycleInvoicesCount === 0) {
    if (identity.rawSellerNames.length > 0) {
      warnings.push(`اسم الدكتور في الفواتير غير مربوط بالموظف. الأسماء الموجودة: ${identity.rawSellerNames.slice(0, 3).join(", ")}`);
    }
  }
  
  if (identity.inactiveDuplicateIds.length > 0) {
    warnings.push(`يوجد موظف مكرر بنفس الاسم`);
  }
  
  Object.entries(errors).forEach(([section, error]) => {
    if (error) {
      warnings.push(`خطأ في تحميل ${section}: ${error}`);
    }
  });

  return {
    hasSales: sales !== null && sales.cycleNetSales > 0,
    hasInvoices: sales !== null && sales.cycleInvoicesCount > 0,
    hasCustomers: customers !== null && customers.topCustomers.length > 0,
    hasStagnant: false,
    hasList: false,
    hasSchedule: false,
    hasAttendance: attendance !== null,
    hasReviews: false,
    hasFollowups: false,
    salesLinked: sales !== null && sales.cycleInvoicesCount > 0,
    invoicesLinked: sales !== null && sales.cycleInvoicesCount > 0,
    customersLinked: customers !== null && customers.topCustomers.length > 0,
    unresolvedSellerNames: sales?.invoiceDiagnostics?.invoicesMatchedCount
      ? []
      : (sales?.invoiceDiagnostics?.distinctSellerNamesInBranch || identity.rawSellerNames).filter((name) => normalizeStaffName(name) !== identity.normalizedNames[0]),
    duplicateStaff: identity.inactiveDuplicateIds.length > 0,
    missingStaffIdInSales: 0,
    missingStaffIdInIncentives: 0,
    missingCustomerInInvoices: 0,
    missingClassification: 0,
    warnings,
  };
}

function generateStaffCharts(data: {
  sales: StaffSalesMetrics | null;
  monthlyIncentive: StaffCycleIncentive | null;
  quarterlyIncentive: StaffQuarterlyMetrics | null;
  attendance: StaffAttendanceMetrics | null;
  customerService: StaffCustomerServiceMetrics | null;
}): StaffCharts {
  return {
    salesMonthlyTrend: data.sales?.monthlyTrend || [],
    invoicesMonthlyTrend: data.sales?.monthlyTrend || [],
    avgInvoiceMonthlyTrend: data.sales?.monthlyTrend || [],
    pointsEvolution: [],
    deductionsEvolution: [],
    cashRewardsEvolution: [],
    netPayoutMonthly: [],
    quarterlyScoreComponents: data.quarterlyIncentive ? [
      { component: "نمو المبيعات", score: data.quarterlyIncentive.scoreBreakdown.salesGrowth },
      { component: "متوسط الفاتورة", score: data.quarterlyIncentive.scoreBreakdown.avgInvoice },
      { component: "العملاء", score: data.quarterlyIncentive.scoreBreakdown.customers },
      { component: "أصناف اللستة", score: data.quarterlyIncentive.scoreBreakdown.listItems },
      { component: "الرواكد", score: data.quarterlyIncentive.scoreBreakdown.stagnantInventory },
      { component: "جودة التسجيل", score: data.quarterlyIncentive.scoreBreakdown.registrationQuality },
    ] : [],
    attendanceCompliance: [],
    delayTrend: data.attendance?.delayTrend || [],
    permissionsUsage: data.attendance?.permissionsUsage || [],
  };
}
