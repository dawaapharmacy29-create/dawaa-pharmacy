import { normalizeBranchName } from '@/lib/branch';
import { getInvoiceAmount, getInvoiceKey, pickFirst } from '@/lib/dawaa2027';
import { normalizeRole } from '@/lib/permissionMatrix';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type Row = Record<string, unknown>;

const SYSTEM_GENERIC_CUSTOMER_CODES = new Set(['54', '4902', '20', '12820', '10', '170', '5']);

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
    sourceTable: 'sales_invoices';
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

type StaffRow = StaffInvoiceTruth['staff'];
type SellerDiagnostic = { sellerName: string; sales: number; invoices: number };
type StaffInvoiceReadPayload = {
  staff?: { id?: unknown; name?: unknown; branch?: unknown; role?: unknown } | null;
  rows?: Row[] | null;
  matchedCount?: unknown;
  matchedSales?: unknown;
  branchAverage?: unknown;
  branchInvoicesCount?: unknown;
  sellerDiagnostics?: Array<Record<string, unknown>> | null;
  globalSellerNames?: unknown[] | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSystemGenericInvoice(row: Row) {
  return SYSTEM_GENERIC_CUSTOMER_CODES.has(String(row.customer_code ?? '').trim());
}

export function normalizeArabicName(value: unknown) {
  return String(value || '')
    .replace(/[\u064b-\u065f]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(
      /^(?:\u0627\u0644)?(?:\u062f\u0643\u062a\u0648\u0631|\u062f\u0643\u062a\u0648\u0631\u0647|\u062f\.?|\u062f\/|dr\.?|doctor)\s*/i,
      ''
    )
    .replace(/[./\\_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildAutomaticAliases(staffName: string) {
  const name = String(staffName || '').replace(/\s+/g, ' ').trim();
  const withoutPrefix = name
    .replace(/^(?:ال)?(?:دكتور|دكتوره|د\.?|د\/|dr\.?|doctor)\s*/i, '')
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

function isNonSalesRole(role?: string | null): boolean {
  const rawRole = String(role || '').trim().toLowerCase();
  const normalized = normalizeRole(role);
  if (normalized === 'delivery' || normalized === 'cleaning_supervisor') return true;
  return /(?:توصيل|مندوب|دليفري|delivery|driver|rider|سائق|عامل|نظافة|cleaning|security|حارس|admin_only|it\b)/i.test(
    rawRole
  );
}

async function loadStaff(staffId: string): Promise<StaffRow> {
  const { data, error } = await supabase
    .from('staff')
    .select('id,name,branch,role')
    .eq('id', staffId)
    .maybeSingle();
  if (error) throw new Error(`staff query failed: ${error.message}`);
  if (!data) throw new Error(`Staff not found: ${staffId}`);
  return {
    id: String(data.id || staffId),
    name: String(data.name || ''),
    branch: normalizeBranchName(data.branch) || String(data.branch || ''),
    role: String(data.role || ''),
  };
}

async function loadDbAliases(staffId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('staff_identity_aliases')
      .select('alias_name')
      .eq('staff_id', staffId)
      .eq('active', true)
      .limit(80);
    if (error) return [];
    return ((data || []) as Row[]).map((row) => String(row.alias_name || '')).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeCustomerPhone(value: unknown, customerCode?: string) {
  let digits = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^0-9+]/g, '');
  if (digits.startsWith('+20')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else digits = digits.replace(/\D/g, '');
  if (digits.length === 10 && /^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;
  const codeDigits = String(customerCode || '').replace(/\D/g, '');
  if (codeDigits && digits === codeDigits) return '';
  return /^01[0125]\d{8}$/.test(digits) ? digits : '';
}

function normalizeCustomerCode(value: unknown) {
  const text = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .trim();
  return /^code:/i.test(text) ? text.replace(/^code:/i, '') : text;
}

function cleanCustomerSegment(value: unknown) {
  const text = String(value ?? '').trim();
  return text && !/^[-.]$/.test(text) ? text : 'غير مصنف';
}

function invoiceFromRow(row: Row): StaffInvoiceTruthInvoice {
  const rawCode = String(pickFirst(row, ['customer_code', 'code'], ''));
  return {
    id: String(pickFirst(row, ['id'], '')),
    invoiceNumber: getInvoiceKey(row),
    invoiceDate: String(pickFirst(row, ['invoice_date', 'sale_date', 'date'], '')).slice(0, 10),
    amount: getInvoiceAmount(row),
    customerName: String(pickFirst(row, ['customer_name', 'name'], '')),
    customerCode: normalizeCustomerCode(rawCode),
    customerPhone: normalizeCustomerPhone(
      pickFirst(row, ['customer_phone', 'phone', 'mobile'], ''),
      rawCode
    ),
    customerAddress: String(pickFirst(row, ['customer_address', 'address', 'customer_addr'], '')),
    customerSegment: cleanCustomerSegment(
      pickFirst(row, ['customer_segment', 'segment', 'classification', 'customer_type'], '')
    ),
    branch:
      normalizeBranchName(pickFirst(row, ['branch', 'branch_name'], '')) ||
      String(pickFirst(row, ['branch', 'branch_name'], '')),
    sellerName: String(pickFirst(row, ['seller_name', 'doctor_name', 'staff_name'], '')),
    invoiceType: String(pickFirst(row, ['invoice_type'], '')),
    invoiceCategory: String(pickFirst(row, ['invoice_category'], '')),
    shift: String(pickFirst(row, ['shift'], '')),
  };
}

function groupByPeriod(
  rows: Array<{ date: string; sales: number; invoices: number }>,
  period: 'week' | 'month'
) {
  const grouped = new Map<string, { sales: number; invoices: number }>();
  for (const row of rows) {
    const date = new Date(`${row.date}T12:00:00`);
    if (Number.isNaN(date.getTime())) continue;
    const key =
      period === 'month'
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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

function buildSummary(invoices: StaffInvoiceTruthInvoice[]): StaffInvoiceTruth['summary'] {
  const totalSales = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const invoicesCount = invoices.length;
  const byAmount = [...invoices].sort((a, b) => b.amount - a.amount);
  const customerKeys = new Set(
    invoices
      .map((invoice) => invoice.customerCode || invoice.customerPhone || invoice.customerName)
      .filter(Boolean)
  );
  const dayMap = new Map<string, { date: string; sales: number; invoices: number }>();
  const shiftMap = new Map<string, { shift: string; sales: number; invoices: number }>();
  const typeMap = new Map<string, { type: string; sales: number; invoices: number }>();

  for (const invoice of invoices) {
    if (invoice.invoiceDate) {
      const day = dayMap.get(invoice.invoiceDate) || {
        date: invoice.invoiceDate,
        sales: 0,
        invoices: 0,
      };
      day.sales += invoice.amount;
      day.invoices += 1;
      dayMap.set(invoice.invoiceDate, day);
    }
    const shift = invoice.shift || 'غير محدد';
    const shiftValue = shiftMap.get(shift) || { shift, sales: 0, invoices: 0 };
    shiftValue.sales += invoice.amount;
    shiftValue.invoices += 1;
    shiftMap.set(shift, shiftValue);

    const type = invoice.invoiceType || invoice.invoiceCategory || 'غير محدد';
    const typeValue = typeMap.get(type) || { type, sales: 0, invoices: 0 };
    typeValue.sales += invoice.amount;
    typeValue.invoices += 1;
    typeMap.set(type, typeValue);
  }

  const salesByDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    totalSales,
    invoicesCount,
    avgInvoice: invoicesCount ? totalSales / invoicesCount : 0,
    maxInvoice: byAmount[0] || null,
    minInvoice: byAmount.length ? byAmount.at(-1) || null : null,
    uniqueCustomersCount: customerKeys.size,
    deliveryInvoicesCount: invoices.filter((invoice) => /delivery|توصيل/i.test(invoice.invoiceType))
      .length,
    salesByDay,
    salesByWeek: groupByPeriod(salesByDay, 'week'),
    salesByMonth: groupByPeriod(salesByDay, 'month'),
    salesByShift: [...shiftMap.values()].sort((a, b) => b.sales - a.sales),
    salesByInvoiceType: [...typeMap.values()].sort((a, b) => b.sales - a.sales),
  };
}

function buildLinkedCustomers(invoices: StaffInvoiceTruthInvoice[]): StaffInvoiceTruthCustomer[] {
  const map = new Map<string, StaffInvoiceTruthCustomer>();
  for (const invoice of invoices) {
    const key = invoice.customerPhone || invoice.customerCode || normalizeArabicName(invoice.customerName);
    if (!key) continue;
    const current = map.get(key) || {
      key,
      name: invoice.customerName || 'عميل غير محدد',
      code: invoice.customerCode,
      phone: invoice.customerPhone,
      address: invoice.customerAddress,
      segment: invoice.customerSegment || 'غير مصنف',
      invoicesCount: 0,
      totalSpent: 0,
      avgInvoice: 0,
      lastPurchase: '',
    };
    current.invoicesCount += 1;
    current.totalSpent += invoice.amount;
    current.lastPurchase =
      invoice.invoiceDate > current.lastPurchase ? invoice.invoiceDate : current.lastPurchase;
    if (!current.phone && invoice.customerPhone) current.phone = invoice.customerPhone;
    if (!current.code && invoice.customerCode) current.code = invoice.customerCode;
    if (!current.address && invoice.customerAddress) current.address = invoice.customerAddress;
    if ((!current.segment || current.segment === 'غير مصنف') && invoice.customerSegment) {
      current.segment = invoice.customerSegment;
    }
    map.set(key, current);
  }
  return [...map.values()]
    .map((customer) => ({
      ...customer,
      avgInvoice: customer.invoicesCount ? customer.totalSpent / customer.invoicesCount : 0,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}

function normalizeSellerDiagnostics(value: StaffInvoiceReadPayload['sellerDiagnostics']): SellerDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      sellerName: String(row.sellerName ?? row.seller_name ?? 'غير محدد'),
      sales: numberValue(row.sales),
      invoices: numberValue(row.invoices),
    }))
    .filter((row) => row.sellerName)
    .sort((a, b) => b.sales - a.sales);
}

function buildSuggestedAliases(staffName: string, branchSellerNames: string[]) {
  if (!branchSellerNames.length) return [];
  const normalizedStaff = normalizeArabicName(staffName);
  return branchSellerNames
    .filter((sellerName) => {
      const normalizedSeller = normalizeArabicName(sellerName);
      return (
        normalizedSeller === normalizedStaff ||
        normalizedSeller.includes(normalizedStaff) ||
        normalizedStaff.includes(normalizedSeller) ||
        (normalizedStaff.length > 3 &&
          normalizedSeller.includes(normalizedStaff.slice(0, Math.floor(normalizedStaff.length * 0.7))))
      );
    })
    .slice(0, 10);
}

function emptyTruth(
  staffId: string,
  periodStart: string,
  periodEnd: string,
  errors: string[],
  warnings: string[],
  staff?: StaffRow | null,
  aliases: string[] = []
): StaffInvoiceTruth {
  const safeStaff = staff || { id: staffId, name: '', branch: '', role: '' };
  const normalizedAliases = unique(aliases.map(normalizeArabicName));
  const summary = buildSummary([]);
  return {
    staff: safeStaff,
    periodStart,
    periodEnd,
    aliases,
    normalizedAliases,
    matchedSellerNames: [],
    invoices: [],
    summary,
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
      sourceTable: 'sales_invoices',
      salesTableAvailable: false,
      warnings,
      errors,
      invoiceRowsScanned: 0,
      invoicesMatchedCount: 0,
      totalMatchedSales: 0,
      aliasesUsed: aliases,
      normalizedAliasesUsed: normalizedAliases,
      matchedSellerNames: [],
      branchSellerNamesSample: [],
      globalSellerNamesSample: [],
      distinctSellerNamesInBranch: [],
      topSellerNamesInBranch: [],
      roleDetected: safeStaff.role || 'غير محدد',
      roleAllowedForMatching: !isNonSalesRole(safeStaff.role),
      suggestedAliases: [],
    },
  };
}

function normalizeReadPayload(data: unknown): StaffInvoiceReadPayload {
  if (Array.isArray(data)) return (data[0] || {}) as StaffInvoiceReadPayload;
  return (data || {}) as StaffInvoiceReadPayload;
}

export async function getStaffInvoiceTruth(
  staffId: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffInvoiceTruth> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isSupabaseConfigured) {
    return emptyTruth(
      staffId,
      periodStart,
      periodEnd,
      ['Supabase غير مُهيأ في هذه البيئة.'],
      warnings
    );
  }

  let staff: StaffRow;
  try {
    staff = await loadStaff(staffId);
  } catch (error) {
    errors.push(`تعذر جلب بيانات الموظف: ${error instanceof Error ? error.message : String(error)}`);
    return emptyTruth(staffId, periodStart, periodEnd, errors, warnings);
  }

  const dbAliases = await loadDbAliases(staff.id);
  const aliases = unique([...buildAutomaticAliases(staff.name), ...dbAliases]);
  const normalizedAliases = unique(aliases.map(normalizeArabicName));
  const roleAllowedForMatching = !isNonSalesRole(staff.role);

  if (!roleAllowedForMatching) {
    warnings.push(
      `الدور "${staff.role}" مُصنَّف كدور غير بيعي (توصيل / عامل). لن يتم احتساب فواتير له تلقائياً.`
    );
  }

  let payload: StaffInvoiceReadPayload;
  try {
    const { data, error } = await supabase.rpc('get_staff_invoice_truth_read_v1', {
      p_staff_id: staff.id,
      p_start: periodStart,
      p_end: periodEnd,
    });
    if (error) throw error;
    payload = normalizeReadPayload(data);
  } catch (error) {
    errors.push(
      `تعذر تحميل مصدر فواتير الموظف الموحّد: ${error instanceof Error ? error.message : String(error)}`
    );
    return emptyTruth(staffId, periodStart, periodEnd, errors, warnings, staff, aliases);
  }

  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const invoiceRows = roleAllowedForMatching
    ? rawRows.filter((row) => !isSystemGenericInvoice(row))
    : [];
  const invoices = invoiceRows
    .map(invoiceFromRow)
    .sort(
      (a, b) =>
        b.invoiceDate.localeCompare(a.invoiceDate) || b.invoiceNumber.localeCompare(a.invoiceNumber)
    );
  const summary = buildSummary(invoices);
  const linkedCustomers = buildLinkedCustomers(invoices);
  const branchAverage = numberValue(payload.branchAverage);
  const sellerDiagnostics = normalizeSellerDiagnostics(payload.sellerDiagnostics);
  const branchSellerNames = sellerDiagnostics.map((row) => row.sellerName);
  const globalSellerNames = Array.isArray(payload.globalSellerNames)
    ? unique(payload.globalSellerNames.map((value) => String(value || '')))
    : [];
  const matchedSellerNames = unique(invoices.map((invoice) => invoice.sellerName));

  if (roleAllowedForMatching && invoices.length === 0) {
    warnings.push(
      `لم يتم العثور على فواتير مطابقة للموظف "${staff.name}" خلال الفترة ${periodStart} إلى ${periodEnd}.`
    );
  }

  const difference = branchAverage > 0 ? summary.avgInvoice - branchAverage : 0;
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
        ? invoices.filter((invoice) => invoice.amount > branchAverage).length
        : 0,
      invoicesBelowBranchAvg: branchAverage
        ? invoices.filter((invoice) => invoice.amount < branchAverage).length
        : 0,
    },
    branchComparison: {
      staffAvg: summary.avgInvoice,
      branchAvg: branchAverage,
      difference,
      percentDifference: branchAverage > 0 ? (difference / branchAverage) * 100 : 0,
    },
    diagnostics: {
      sourceTable: 'sales_invoices',
      salesTableAvailable: true,
      warnings,
      errors,
      invoiceRowsScanned: rawRows.length,
      invoicesMatchedCount: invoices.length,
      totalMatchedSales: summary.totalSales,
      aliasesUsed: aliases,
      normalizedAliasesUsed: normalizedAliases,
      matchedSellerNames,
      branchSellerNamesSample: branchSellerNames.slice(0, 20),
      globalSellerNamesSample: globalSellerNames.slice(0, 30),
      distinctSellerNamesInBranch: branchSellerNames,
      topSellerNamesInBranch: sellerDiagnostics.slice(0, 20),
      roleDetected: staff.role || 'غير محدد',
      roleAllowedForMatching,
      suggestedAliases: buildSuggestedAliases(staff.name, branchSellerNames),
    },
  };
}
