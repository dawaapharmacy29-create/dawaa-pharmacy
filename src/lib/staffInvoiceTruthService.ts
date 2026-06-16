import { normalizeBranchName } from "@/lib/branch";
import { getInvoiceAmount, getInvoiceKey, pickFirst, toNumber } from "@/lib/dawaa2027";
import { normalizeRole } from "@/lib/permissionMatrix";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { selectAllPaged } from "@/lib/supabasePaged";

type Row = Record<string, unknown>;

export type StaffInvoiceTruthInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  customerName: string;
  customerCode: string;
  customerPhone: string;
  customerAddress: string;
  customerSegment: string;
  branch: string;
  sellerName: string;
  invoiceType: string;
  invoiceCategory: string;
  shift: string;
};

export type StaffInvoiceTruthCustomer = {
  key: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  segment: string;
  invoicesCount: number;
  totalSpent: number;
  avgInvoice: number;
  lastPurchase: string;
};

export type StaffInvoiceTruth = {
  staff: {
    id: string;
    name: string;
    branch: string;
    role: string;
  };
  periodStart: string;
  periodEnd: string;
  aliases: string[];
  normalizedAliases: string[];
  matchedSellerNames: string[];
  invoices: StaffInvoiceTruthInvoice[];
  summary: {
    totalSales: number;
    invoicesCount: number;
    avgInvoice: number;
    maxInvoice: StaffInvoiceTruthInvoice | null;
    minInvoice: StaffInvoiceTruthInvoice | null;
    uniqueCustomersCount: number;
    deliveryInvoicesCount: number;
    salesByDay: Array<{ date: string; sales: number; invoices: number }>;
    salesByWeek: Array<{ period: string; sales: number; invoices: number }>;
    salesByMonth: Array<{ period: string; sales: number; invoices: number }>;
    salesByShift: Array<{ shift: string; sales: number; invoices: number }>;
    salesByInvoiceType: Array<{ type: string; sales: number; invoices: number }>;
  };
  latestInvoices: StaffInvoiceTruthInvoice[];
  linkedCustomers: StaffInvoiceTruthCustomer[];
  invoiceAnalysis: {
    avgInvoice: number;
    maxInvoice: StaffInvoiceTruthInvoice | null;
    minInvoice: StaffInvoiceTruthInvoice | null;
    invoicesAboveBranchAvg: number;
    invoicesBelowBranchAvg: number;
  };
  branchComparison: {
    staffAvg: number;
    branchAvg: number;
    difference: number;
    percentDifference: number;
  };
  diagnostics: {
    sourceTable: "sales_invoices";
    salesTableAvailable: boolean;
    warnings: string[];
    errors: string[];
    invoiceRowsScanned: number;
    invoicesMatchedCount: number;
    totalMatchedSales: number;
    aliasesUsed: string[];
    normalizedAliasesUsed: string[];
    matchedSellerNames: string[];
    branchSellerNamesSample: string[];
    globalSellerNamesSample: string[];
    distinctSellerNamesInBranch: string[];
    topSellerNamesInBranch: Array<{ sellerName: string; sales: number; invoices: number }>;
    roleDetected: string;
    roleAllowedForMatching: boolean;
    suggestedAliases: string[];
  };
};

function emptyInvoiceTruth(
  staffId: string,
  staffName: string,
  staffBranch: string,
  staffRole: string,
  periodStart: string,
  periodEnd: string,
  aliases: string[],
  normalizedAliases: string[],
  errors: string[],
  warnings: string[],
  salesTableAvailable: boolean,
  invoiceRows: Row[],
  roleAllowedForMatching: boolean
): StaffInvoiceTruth {
  const sellerDiag = buildSellerDiagnostics(invoiceRows.map(invoiceFromRow), staffBranch);
  const globalSample = invoiceRows
    .map((r) => String(pickFirst(r, ["seller_name"], "") || ""))
    .filter(Boolean);
  const uniqueGlobal = [...new Set(globalSample)].slice(0, 30);

  return {
    staff: { id: staffId, name: staffName, branch: staffBranch, role: staffRole },
    periodStart,
    periodEnd,
    aliases,
    normalizedAliases,
    matchedSellerNames: [],
    invoices: [],
    summary: {
      totalSales: 0,
      invoicesCount: 0,
      avgInvoice: 0,
      maxInvoice: null,
      minInvoice: null,
      uniqueCustomersCount: 0,
      deliveryInvoicesCount: 0,
      salesByDay: [],
      salesByWeek: [],
      salesByMonth: [],
      salesByShift: [],
      salesByInvoiceType: [],
    },
    latestInvoices: [],
    linkedCustomers: [],
    invoiceAnalysis: {
      avgInvoice: 0,
      maxInvoice: null,
      minInvoice: null,
      invoicesAboveBranchAvg: 0,
      invoicesBelowBranchAvg: 0,
    },
    branchComparison: { staffAvg: 0, branchAvg: 0, difference: 0, percentDifference: 0 },
    diagnostics: {
      sourceTable: "sales_invoices",
      salesTableAvailable,
      warnings,
      errors,
      invoiceRowsScanned: invoiceRows.length,
      invoicesMatchedCount: 0,
      totalMatchedSales: 0,
      aliasesUsed: aliases,
      normalizedAliasesUsed: normalizedAliases,
      matchedSellerNames: [],
      branchSellerNamesSample: sellerDiag.distinctSellerNamesInBranch.slice(0, 20),
      globalSellerNamesSample: uniqueGlobal,
      distinctSellerNamesInBranch: sellerDiag.distinctSellerNamesInBranch,
      topSellerNamesInBranch: sellerDiag.topSellerNamesInBranch,
      roleDetected: staffRole || "غير محدد",
      roleAllowedForMatching,
      suggestedAliases: buildSuggestedAliases(staffName, sellerDiag.distinctSellerNamesInBranch),
    },
  };
}

function buildSuggestedAliases(staffName: string, branchSellerNames: string[]): string[] {
  if (!branchSellerNames.length) return [];
  const normName = normalizeArabicName(staffName);
  const suggestions: string[] = [];
  for (const sellerName of branchSellerNames) {
    const normSeller = normalizeArabicName(sellerName);
    if (
      normSeller === normName ||
      normSeller.includes(normName) ||
      normName.includes(normSeller) ||
      (normName.length > 3 && normSeller.includes(normName.slice(0, Math.floor(normName.length * 0.7))))
    ) {
      suggestions.push(sellerName);
    }
  }
  return suggestions.slice(0, 10);
}

function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function normalizeArabicName(value: unknown) {
  return String(value || "")
    .replace(/[\u064b-\u065f]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/^(?:\u0627\u0644)?(?:\u062f\u0643\u062a\u0648\u0631|\u062f\u0643\u062a\u0648\u0631\u0647|\u062f\.?|\u062f\/|dr\.?|doctor)\s*/i, "")
    .replace(/[./\\_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isNonSalesRole(role?: string | null): boolean {
  const rawRole = String(role || "").trim().toLowerCase();
  const normalized = normalizeRole(role);
  if (normalized === "delivery" || normalized === "cleaning_supervisor") return true;
  return /(?:توصيل|مندوب|دليفري|delivery|driver|rider|سائق|عامل|نظافة|cleaning|security|حارس|admin_only|it\b)/i.test(rawRole);
}

function unique(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function buildAutomaticAliases(staffName: string) {
  const name = String(staffName || "").replace(/\s+/g, " ").trim();
  const withoutPrefix = name
    .replace(/^(?:ال)?(?:دكتور|دكتوره|د\.?|د\/|dr\.?|doctor)\s*/i, "")
    .trim();
  const base = withoutPrefix || name;
  return unique([
    name,
    base,
    `د ${base}`,
    `د/ ${base}`,
    `د. ${base}`,
    `دكتور ${base}`,
    normalizeArabicName(name),
    normalizeArabicName(base),
  ]);
}

async function loadStaff(staffId: string): Promise<{ id: string; name: string; branch: string; role: string }> {
  const { data, error } = await supabase
    .from("staff")
    .select("id,name,branch,role")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw new Error(`staff query failed: ${error.message}`);
  if (!data) throw new Error(`Staff not found: ${staffId}`);
  return {
    id: String(data.id || staffId),
    name: String(data.name || ""),
    branch: normalizeBranchName(data.branch) || String(data.branch || ""),
    role: String(data.role || ""),
  };
}

async function loadDbAliases(staffId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("staff_identity_aliases")
      .select("alias_name")
      .eq("staff_id", staffId)
      .eq("active", true)
      .limit(80);
    if (error) return [];
    return ((data || []) as Row[]).map((row) => String(row.alias_name || "")).filter(Boolean);
  } catch {
    return [];
  }
}


function normalizeCustomerPhone(value: unknown, customerCode?: string) {
  let digits = String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^0-9+]/g, "");
  if (digits.startsWith("+20")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else digits = digits.replace(/\D/g, "");
  if (digits.length === 10 && /^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;
  const codeDigits = String(customerCode || "").replace(/\D/g, "");
  if (codeDigits && digits === codeDigits) return "";
  return /^01[0125]\d{8}$/.test(digits) ? digits : "";
}

function normalizeCustomerCode(value: unknown) {
  const text = String(value ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
  return /^code:/i.test(text) ? text.replace(/^code:/i, "") : text;
}

function cleanCustomerSegment(value: unknown) {
  const text = String(value ?? "").trim();
  return text && !/^[-.]$/.test(text) ? text : "غير مصنف";
}

function invoiceFromRow(row: Row): StaffInvoiceTruthInvoice {
  return {
    id: String(pickFirst(row, ["id"], "")),
    invoiceNumber: getInvoiceKey(row),
    invoiceDate: String(pickFirst(row, ["invoice_date", "sale_date", "date"], "")).slice(0, 10),
    amount: getInvoiceAmount(row),
    customerName: String(pickFirst(row, ["customer_name", "name"], "")),
    customerCode: normalizeCustomerCode(pickFirst(row, ["customer_code", "code"], "")),
    customerPhone: normalizeCustomerPhone(pickFirst(row, ["customer_phone", "phone", "mobile"], ""), String(pickFirst(row, ["customer_code", "code"], ""))),
    customerAddress: String(pickFirst(row, ["customer_address", "address", "customer_addr"], "")),
    customerSegment: cleanCustomerSegment(pickFirst(row, ["customer_segment", "segment", "classification", "customer_type"], "")),
    branch: normalizeBranchName(pickFirst(row, ["branch", "branch_name"], "")) ||
      String(pickFirst(row, ["branch", "branch_name"], "")),
    sellerName: String(pickFirst(row, ["seller_name", "doctor_name", "staff_name"], "")),
    invoiceType: String(pickFirst(row, ["invoice_type"], "")),
    invoiceCategory: String(pickFirst(row, ["invoice_category"], "")),
    shift: String(pickFirst(row, ["shift"], "")),
  };
}

function sellerMatches(row: Row, staffId: string, normalizedAliases: Set<string>): boolean {
  const idCandidates = [
    row.staff_id,
    row.employee_id,
    row.doctor_id,
    row.seller_id,
    row.pharmacist_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (staffId && idCandidates.includes(staffId)) return true;

  const rawSeller = String(pickFirst(row, ["seller_name"], ""));
  if (!rawSeller) return false;
  const normalizedSeller = normalizeArabicName(
    pickFirst(row, ["normalized_seller_name"], rawSeller)
  );
  if (!normalizedSeller) return false;
  if (normalizedAliases.has(normalizedSeller)) return true;

  // Allow fuzzy matching only for clear multi-word names. Short one-word names
  // like "اسلام" must match exactly or through an explicit alias to avoid mixing
  // doctors with delivery staff sharing the same first name.
  const sellerParts = normalizedSeller.split(" ").filter(Boolean);
  for (const alias of normalizedAliases) {
    const aliasParts = alias.split(" ").filter(Boolean);
    if (!alias || alias.length < 6 || aliasParts.length < 2 || sellerParts.length < 2) continue;
    if (normalizedSeller === alias) return true;
    if (normalizedSeller.includes(alias) || alias.includes(normalizedSeller)) return true;
  }
  return false;
}

function groupByPeriod(
  rows: Array<{ date: string; sales: number; invoices: number }>,
  period: "week" | "month"
) {
  const grouped = new Map<string, { sales: number; invoices: number }>();
  for (const row of rows) {
    const date = new Date(`${row.date}T12:00:00`);
    if (Number.isNaN(date.getTime())) continue;
    const key =
      period === "month"
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        : (() => {
            const start = new Date(date);
            start.setDate(date.getDate() - date.getDay());
            return start.toISOString().slice(0, 10);
          })();
    const current = grouped.get(key) || { sales: 0, invoices: 0 };
    current.sales += row.sales;
    current.invoices += row.invoices;
    grouped.set(key, current);
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({ period: key, ...value }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function buildSellerDiagnostics(invoices: StaffInvoiceTruthInvoice[], staffBranch: string) {
  const staffBranchNorm = normalizeBranchName(staffBranch);
  const sellerMap = new Map<string, { sellerName: string; sales: number; invoices: number }>();
  for (const invoice of invoices) {
    // Include all sellers when no branch filter, or when branches match
    if (
      staffBranchNorm &&
      invoice.branch &&
      normalizeBranchName(invoice.branch) !== staffBranchNorm
    ) {
      continue;
    }
    const sellerName = invoice.sellerName || "غير محدد";
    const current = sellerMap.get(sellerName) || { sellerName, sales: 0, invoices: 0 };
    current.sales += invoice.amount;
    current.invoices += 1;
    sellerMap.set(sellerName, current);
  }
  const sellers = [...sellerMap.values()].sort((a, b) => b.sales - a.sales);
  return {
    distinctSellerNamesInBranch: sellers.map((s) => s.sellerName),
    topSellerNamesInBranch: sellers.slice(0, 20),
  };
}

function buildSummary(invoices: StaffInvoiceTruthInvoice[]) {
  const totalSales = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const invoicesCount = invoices.length;
  const avgInvoice = invoicesCount ? totalSales / invoicesCount : 0;
  const byAmount = [...invoices].sort((a, b) => b.amount - a.amount);
  const customerKeys = new Set(
    invoices
      .map((inv) => inv.customerCode || inv.customerPhone || inv.customerName)
      .filter(Boolean)
  );

  const dayMap = new Map<string, { date: string; sales: number; invoices: number }>();
  const shiftMap = new Map<string, { shift: string; sales: number; invoices: number }>();
  const typeMap = new Map<string, { type: string; sales: number; invoices: number }>();

  for (const inv of invoices) {
    if (inv.invoiceDate) {
      const current = dayMap.get(inv.invoiceDate) || {
        date: inv.invoiceDate,
        sales: 0,
        invoices: 0,
      };
      current.sales += inv.amount;
      current.invoices += 1;
      dayMap.set(inv.invoiceDate, current);
    }
    const shift = inv.shift || "غير محدد";
    const sc = shiftMap.get(shift) || { shift, sales: 0, invoices: 0 };
    sc.sales += inv.amount;
    sc.invoices += 1;
    shiftMap.set(shift, sc);

    const type = inv.invoiceType || inv.invoiceCategory || "غير محدد";
    const tc = typeMap.get(type) || { type, sales: 0, invoices: 0 };
    tc.sales += inv.amount;
    tc.invoices += 1;
    typeMap.set(type, tc);
  }

  const salesByDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalSales,
    invoicesCount,
    avgInvoice,
    maxInvoice: byAmount[0] || null,
    minInvoice: byAmount.length ? byAmount.at(-1) || null : null,
    uniqueCustomersCount: customerKeys.size,
    deliveryInvoicesCount: invoices.filter((inv) =>
      /delivery|توصيل/i.test(inv.invoiceType)
    ).length,
    salesByDay,
    salesByWeek: groupByPeriod(salesByDay, "week"),
    salesByMonth: groupByPeriod(salesByDay, "month"),
    salesByShift: [...shiftMap.values()].sort((a, b) => b.sales - a.sales),
    salesByInvoiceType: [...typeMap.values()].sort((a, b) => b.sales - a.sales),
  };
}

function buildLinkedCustomers(invoices: StaffInvoiceTruthInvoice[]): StaffInvoiceTruthCustomer[] {
  const map = new Map<string, StaffInvoiceTruthCustomer>();
  for (const inv of invoices) {
    const key = inv.customerPhone || inv.customerCode || normalizeArabicName(inv.customerName);
    if (!key) continue;
    const current = map.get(key) || {
      key,
      name: inv.customerName || "عميل غير محدد",
      code: inv.customerCode,
      phone: inv.customerPhone,
      address: inv.customerAddress,
      segment: inv.customerSegment || "غير مصنف",
      invoicesCount: 0,
      totalSpent: 0,
      avgInvoice: 0,
      lastPurchase: "",
    };
    current.invoicesCount += 1;
    current.totalSpent += inv.amount;
    current.lastPurchase =
      inv.invoiceDate > current.lastPurchase ? inv.invoiceDate : current.lastPurchase;
    if (!current.phone && inv.customerPhone) current.phone = inv.customerPhone;
    if (!current.code && inv.customerCode) current.code = inv.customerCode;
    if (!current.address && inv.customerAddress) current.address = inv.customerAddress;
    if ((!current.segment || current.segment === "غير مصنف") && inv.customerSegment) current.segment = inv.customerSegment;
    map.set(key, current);
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      avgInvoice: c.invoicesCount ? c.totalSpent / c.invoicesCount : 0,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}

async function getBranchAverageFromInvoices(rows: Row[], staffBranch: string) {
  const branchNorm = normalizeBranchName(staffBranch);
  const amounts = rows
    .map(invoiceFromRow)
    .filter(
      (inv) =>
        !branchNorm || !inv.branch || normalizeBranchName(inv.branch) === branchNorm
    )
    .map((inv) => inv.amount)
    .filter((a) => a > 0);
  return amounts.length
    ? amounts.reduce((sum, a) => sum + a, 0) / amounts.length
    : 0;
}

async function loadInvoicesByKnownStaffIdColumns(staffId: string, periodStart: string, periodEnd: string): Promise<Row[]> {
  if (!staffId) return [];
  const candidateColumns = ["staff_id", "employee_id", "doctor_id", "seller_id", "pharmacist_id"];
  const rows: Row[] = [];

  for (const column of candidateColumns) {
    try {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("*")
        .gte("invoice_date", periodStart)
        .lt("invoice_date", dayAfter(periodEnd))
        .eq(column, staffId)
        .order("invoice_date", { ascending: false })
        .limit(12000);
      if (!error && data?.length) rows.push(...((data || []) as Row[]));
    } catch {
      // Some deployments do not have all staff-id columns; seller-name matching remains the fallback.
    }
  }

  return mergeRowsByInvoiceIdentity(rows);
}

function mergeRowsByInvoiceIdentity(rows: Row[]) {
  const map = new Map<string, Row>();
  rows.forEach((row, index) => {
    const key = [
      String(pickFirst(row, ["id"], "")),
      String(pickFirst(row, ["invoice_no", "invoice_number", "invoice_key"], "")),
      String(pickFirst(row, ["invoice_date", "sale_date", "date"], "")),
      String(pickFirst(row, ["branch", "branch_name"], "")),
    ].filter(Boolean).join("|") || `row-${index}`;
    map.set(key, row);
  });
  return [...map.values()];
}

// ─── Main export — NEVER throws, ALWAYS returns a full object ───────────────
export async function getStaffInvoiceTruth(
  staffId: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffInvoiceTruth> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 1. Load staff ──────────────────────────────────────────────────────────
  let staff = { id: staffId, name: "", branch: "", role: "" };
  try {
    staff = await loadStaff(staffId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`تعذر جلب بيانات الموظف: ${msg}`);
    // return early with minimal diagnostics
    return emptyInvoiceTruth(
      staffId, "", "", "", periodStart, periodEnd, [], [], errors, warnings, false, [], false
    );
  }

  // ── 2. Build aliases ───────────────────────────────────────────────────────
  const dbAliases = await loadDbAliases(staffId);
  const aliases = unique([...buildAutomaticAliases(staff.name), ...dbAliases]);
  const normalizedAliases = unique(aliases.map(normalizeArabicName));
  const normalizedAliasSet = new Set(normalizedAliases);

  // ── 3. Role check (warning only — do NOT block) ────────────────────────────
  const roleAllowedForMatching = !isNonSalesRole(staff.role);
  if (!roleAllowedForMatching) {
    warnings.push(
      `الدور "${staff.role}" مُصنَّف كدور غير بيعي (توصيل / عامل). لن يتم مطابقة الفواتير تلقائياً.`
    );
  }

  // ── 4. Query sales_invoices ────────────────────────────────────────────────
  if (!isSupabaseConfigured) {
    errors.push("Supabase غير مُهيأ في هذه البيئة.");
    return emptyInvoiceTruth(
      staffId, staff.name, staff.branch, staff.role,
      periodStart, periodEnd, aliases, normalizedAliases,
      errors, warnings, false, [], roleAllowedForMatching
    );
  }

  let rows: Row[] = [];
  let diagnosticRows: Row[] = [];
  let salesTableAvailable = false;

  try {
    // Fast path: fetch only invoices whose seller_name resembles one of the staff aliases.
    // This makes the staff profile much faster and fixes cases where the old full scan timed out.
    const ilikeAliases = unique(
      aliases.flatMap((alias) => {
        const raw = String(alias || "").replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
        const normalizedWords = normalizeArabicName(alias).split(" ").filter((part) => part.length >= 3);
        const lastWord = normalizedWords.at(-1) || "";
        return [raw, ...normalizedWords, lastWord].filter((part) => part.length >= 3);
      }).slice(0, 16)
    );
    const aliasOr = ilikeAliases.map((alias) => `seller_name.ilike.%${alias}%`).join(",");

    if (aliasOr) {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("*")
        .gte("invoice_date", periodStart)
        .lt("invoice_date", dayAfter(periodEnd))
        .or(aliasOr)
        .order("invoice_date", { ascending: false })
        .limit(12000);
      if (error) throw error;
      rows = (data || []) as Row[];
      diagnosticRows = rows;
      salesTableAvailable = true;
    }

    const idMatchedRows = await loadInvoicesByKnownStaffIdColumns(staff.id, periodStart, periodEnd);
    if (idMatchedRows.length) {
      rows = mergeRowsByInvoiceIdentity([...idMatchedRows, ...rows]);
      diagnosticRows = mergeRowsByInvoiceIdentity([...idMatchedRows, ...diagnosticRows]);
      salesTableAvailable = true;
    }

    // If no matching rows were found, fetch a small period sample for diagnostics only.
    if (!rows.length) {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("*")
        .gte("invoice_date", periodStart)
        .lt("invoice_date", dayAfter(periodEnd))
        .order("invoice_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      diagnosticRows = (data || []) as Row[];
      rows = diagnosticRows;
      salesTableAvailable = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`المسار السريع للفواتير فشل، سيتم استخدام المسح الكامل: ${msg}`);
    try {
      const result = await selectAllPaged<Row>({
        table: "sales_invoices",
        select: "*",
        chunkSize: 1000,
        maxRows: 50000,
        orderBy: "invoice_date",
        ascending: false,
        filters: (query) => query.gte("invoice_date", periodStart).lt("invoice_date", dayAfter(periodEnd)),
      });

      if (result.error) {
        errors.push(`استعلام sales_invoices فشل: ${result.error.message}`);
      } else {
        rows = result.data || [];
        diagnosticRows = rows;
        salesTableAvailable = true;
        if (result.truncated) {
          warnings.push("تم الوصول للحد الأقصى لقراءة الفواتير 50000 صف. راجع الفترة أو زد الحد لو احتجت.");
        }
      }
    } catch (fullErr) {
      const fullMsg = fullErr instanceof Error ? fullErr.message : String(fullErr);
      errors.push(`خطأ غير متوقع في جلب الفواتير: ${fullMsg}`);
    }
  }

  // Even if rows=[], build diagnostics with seller names sample
  if (!salesTableAvailable) {
    return emptyInvoiceTruth(
      staffId, staff.name, staff.branch, staff.role,
      periodStart, periodEnd, aliases, normalizedAliases,
      errors, warnings, false, [], roleAllowedForMatching
    );
  }

  // ── 5. Match invoices ──────────────────────────────────────────────────────
  const matchedRows = roleAllowedForMatching
    ? rows.filter((row) => sellerMatches(row, staff.id, normalizedAliasSet))
    : [];

  if (roleAllowedForMatching && matchedRows.length === 0 && rows.length > 0) {
    warnings.push(
      `لم يتم العثور على فواتير مطابقة للموظف "${staff.name}" خلال الفترة ${periodStart} إلى ${periodEnd}. ` +
      `تم فحص ${rows.length} فاتورة. تحقق من أسماء البائعين أدناه.`
    );
  }

  const invoices = matchedRows
    .map(invoiceFromRow)
    .sort(
      (a, b) =>
        b.invoiceDate.localeCompare(a.invoiceDate) ||
        b.invoiceNumber.localeCompare(a.invoiceNumber)
    );

  // ── 6. Build analytics ────────────────────────────────────────────────────
  const branchAverage = await getBranchAverageFromInvoices(rows, staff.branch).catch(() => 0);
  const summary = buildSummary(invoices);
  const linkedCustomers = buildLinkedCustomers(invoices);
  const matchedSellerNames = unique(invoices.map((inv) => inv.sellerName));
  const sellerDiag = buildSellerDiagnostics(rows.map(invoiceFromRow), staff.branch);

  // Global sample (up to 30 distinct seller names across all branches)
  const globalSample = [
    ...new Set(rows.map((r) => String(pickFirst(r, ["seller_name"], "") || "")).filter(Boolean)),
  ].slice(0, 30);

  // Branch-level warning
  if (staff.branch && sellerDiag.distinctSellerNamesInBranch.length === 0 && rows.length > 0) {
    warnings.push(
      `فلتر الفرع "${staff.branch}" قد يمنع ظهور أسماء البائعين — جرب عرض كل الفروع.`
    );
  }

  return {
    staff,
    periodStart,
    periodEnd,
    aliases,
    normalizedAliases,
    matchedSellerNames,
    invoices,
    summary,
    latestInvoices: invoices.slice(0, 30),
    linkedCustomers,
    invoiceAnalysis: {
      avgInvoice: summary.avgInvoice,
      maxInvoice: summary.maxInvoice,
      minInvoice: summary.minInvoice,
      invoicesAboveBranchAvg: branchAverage
        ? invoices.filter((inv) => inv.amount > branchAverage).length
        : 0,
      invoicesBelowBranchAvg: branchAverage
        ? invoices.filter((inv) => inv.amount < branchAverage).length
        : 0,
    },
    branchComparison: {
      staffAvg: summary.avgInvoice,
      branchAvg: branchAverage,
      difference: branchAverage > 0 ? summary.avgInvoice - branchAverage : 0,
      percentDifference:
        branchAverage > 0
          ? ((summary.avgInvoice - branchAverage) / branchAverage) * 100
          : 0,
    },
    diagnostics: {
      sourceTable: "sales_invoices",
      salesTableAvailable,
      warnings,
      errors,
      invoiceRowsScanned: rows.length,
      invoicesMatchedCount: invoices.length,
      totalMatchedSales: summary.totalSales,
      aliasesUsed: aliases,
      normalizedAliasesUsed: normalizedAliases,
      matchedSellerNames,
      branchSellerNamesSample: sellerDiag.distinctSellerNamesInBranch.slice(0, 20),
      globalSellerNamesSample: globalSample,
      distinctSellerNamesInBranch: sellerDiag.distinctSellerNamesInBranch,
      topSellerNamesInBranch: sellerDiag.topSellerNamesInBranch,
      roleDetected: staff.role || "غير محدد",
      roleAllowedForMatching,
      suggestedAliases: buildSuggestedAliases(
        staff.name,
        sellerDiag.distinctSellerNamesInBranch
      ),
    },
  };
}
