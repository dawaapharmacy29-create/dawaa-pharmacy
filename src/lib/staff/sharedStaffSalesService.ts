/**
 * Shared Staff Sales Service
 *
 * This service provides a unified way to fetch staff sales data
 * that is used by both the dashboard and staff detail pages.
 * It uses the same identity resolution logic as the dashboard.
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  findStaffIdentityForSalesRow,
  normalizeStaffName,
  fetchStaffIdentityRows,
} from '@/lib/staffIdentityService';
import { getInvoiceAmount, getInvoiceKey } from '@/lib/dawaa2027';
import { selectAllPaged } from '@/lib/supabasePaged';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';

type Row = Record<string, unknown>;

function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export interface StaffSalesSummary {
  netSales: number;
  invoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
  deliveryInvoicesCount: number;
  branchContribution: number;
  latestInvoices: Array<{ invoiceNumber: string; date: string; amount: number; customer: string }>;
  topInvoices: Array<{ invoiceNumber: string; date: string; amount: number; customer: string }>;
  topCustomers: Array<{ name: string; phone: string; totalSpent: number; invoicesCount: number }>;
  salesByDay: Array<{ date: string; sales: number; invoices: number }>;
  salesByWeek: Array<{ period: string; sales: number; invoices: number }>;
  salesByMonth: Array<{ period: string; sales: number; invoices: number }>;
  salesByShift: Array<{ shift: string; sales: number; invoices: number }>;
  salesByInvoiceType: Array<{ type: string; sales: number; invoices: number }>;
  sourceUsed: 'staff_id' | 'seller_name' | 'invoices_fallback' | 'none';
  aliasesUsed: string[];
  rawSellerNamesMatched: string[];
  dataHealthWarnings: string[];
}

export interface GetStaffSalesSummaryParams {
  staffId: string;
  staffName: string;
  branch: string;
  role?: string;
  cycleStart: string;
  cycleEnd: string;
  includeAliases?: boolean;
  signal?: AbortSignal;
}

function isSalesRole(role?: string | null) {
  return /صيد|دكتور|doctor|pharmacist|pharmacy/i.test(String(role || ''));
}

function invoiceAsStaffSalesRow(row: Row) {
  return {
    saleDate: String(row.invoice_date || '').slice(0, 10),
    sellerName: String(row.seller_name || ''),
    branch: String(row.branch || '') || null,
    netTotal: getInvoiceAmount(row),
    invoicesCount: 1,
    avgInvoice: getInvoiceAmount(row),
    uniqueCustomers: row.customer_code || row.customer_phone || row.customer_name ? 1 : 0,
  };
}

export async function getLiveStaffInvoiceRowsForPeriod(
  params: GetStaffSalesSummaryParams
): Promise<{ rows: Row[]; rawSellerNamesMatched: string[]; warnings: string[] }> {
  const aliases =
    params.includeAliases === false ? [params.staffName] : buildStaffAliases(params.staffName);
  const warnings: string[] = [];

  const [staffRows, invoiceResult] = await Promise.all([
    fetchStaffIdentityRows(),
    selectAllPaged<Row>({
      table: 'sales_invoices',
      select: '*',
      chunkSize: 1000,
      maxRows: 50000,
      orderBy: 'invoice_date',
      ascending: false,
      filters: (query) =>
        query.gte('invoice_date', params.cycleStart).lt('invoice_date', dayAfter(params.cycleEnd)),
    }),
  ]);

  if (invoiceResult.error || !invoiceResult.data) {
    return {
      rows: [],
      rawSellerNamesMatched: [],
      warnings: invoiceResult.error
        ? [`live invoices query failed: ${invoiceResult.error.message}`]
        : warnings,
    };
  }
  if (invoiceResult.truncated)
    warnings.push('تم الوصول للحد الأقصى لقراءة الفواتير 50000 صف في خدمة مبيعات الموظف.');

  const allowAliasFallback = isSalesRole(params.role);
  const filtered = (invoiceResult.data as Row[]).filter((row) => {
    const identity = findStaffIdentityForSalesRow(invoiceAsStaffSalesRow(row), staffRows);
    if (identity?.id) return identity.id === params.staffId;
    if (!allowAliasFallback) return false;
    return staffNameMatchesSeller(row.seller_name, aliases);
  });

  const rawSellerNamesMatched = [
    ...new Set(filtered.map((row) => String(row.seller_name || '')).filter(Boolean)),
  ];
  if (!allowAliasFallback) {
    warnings.push(
      'تم منع مطابقة الاسم فقط لهذا الدور حتى لا تختلط مبيعات الصيدلي مع موظف توصيل أو دور غير بيعي.'
    );
  }

  return { rows: filtered, rawSellerNamesMatched, warnings };
}

/**
 * Get staff sales summary for a period
 * This function uses the same data source and logic as the dashboard
 */
export async function getStaffSalesSummaryForPeriod(
  params: GetStaffSalesSummaryParams
): Promise<StaffSalesSummary> {
  const {
    staffId,
    staffName,
    branch,
    role,
    cycleStart,
    cycleEnd,
    includeAliases = true,
    signal,
  } = params;

  if (!isSupabaseConfigured) {
    return createEmptySummary('none', [], [], ['Supabase not configured']);
  }

  const warnings: string[] = [];
  const aliasesUsed: string[] = [];
  const rawSellerNamesMatched: string[] = [];
  let sourceUsed: 'staff_id' | 'seller_name' | 'invoices_fallback' | 'none' = 'none';
  let summaryData: Row[] | null = null;

  // Step 1: Build aliases for matching
  const aliases = includeAliases ? buildStaffAliases(staffName) : [staffName];
  aliasesUsed.push(...aliases);

  // Step 2: Use live invoices first so staff pages stay identical to the dashboard after imports.
  try {
    const liveInvoices = await getLiveStaffInvoiceRowsForPeriod(params);
    warnings.push(...liveInvoices.warnings);

    if (liveInvoices.rows.length > 0) {
      summaryData = liveInvoices.rows;
      sourceUsed = 'invoices_fallback';
      rawSellerNamesMatched.push(...liveInvoices.rawSellerNamesMatched);
      warnings.push(
        `Sales matched from live invoices: ${liveInvoices.rawSellerNamesMatched.slice(0, 3).join(', ')}`
      );
    }
  } catch (error) {
    warnings.push(
      `live invoices query failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Step 3: Fallback to staff_sales_summary by staff_id
  if (!summaryData || summaryData.length === 0) {
    try {
      const { data: summaryById, error: summaryByIdError } = await supabase
        .from('staff_sales_summary')
        .select('*')
        .eq('staff_id', staffId)
        .gte('sale_date', cycleStart)
        .lt('sale_date', dayAfter(cycleEnd))
        .limit(500);

      if (!summaryByIdError && summaryById && summaryById.length > 0) {
        summaryData = summaryById as Row[];
        sourceUsed = 'staff_id';
        const summaryRows = summaryById as any[];
        rawSellerNamesMatched.push(...new Set(summaryRows.map((r) => String((r as any).seller_name || '') as string)));
      }
    } catch (error) {
      warnings.push(
        `staff_id query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Step 4: Fallback to staff_sales_summary by seller_name with aliases
  if (!summaryData || summaryData.length === 0) {
    try {
      const { data: summaryByName, error: summaryByNameError } = await supabase
        .from('staff_sales_summary')
        .select('*')
        .gte('sale_date', cycleStart)
        .lt('sale_date', dayAfter(cycleEnd))
        .limit(500);

      if (!summaryByNameError && summaryByName) {
        // Filter by matching seller_name using aliases
        const filtered = isSalesRole(role)
          ? summaryByName.filter((row) => staffNameMatchesSeller(row.seller_name, aliases))
          : [];

        if (filtered.length > 0) {
          summaryData = filtered;
          sourceUsed = 'seller_name';
          const filteredRows = filtered as any[];
          rawSellerNamesMatched.push(...new Set(filteredRows.map((r) => String((r as any).seller_name || '') as string)));
          warnings.push(
            `Sales matched by seller_name aliases: ${rawSellerNamesMatched.slice(0, 3).join(', ')}`
          );
        }
      }
    } catch (error) {
      warnings.push(
        `seller_name query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Step 5: If still no data, add explicit warning
  if (!summaryData || summaryData.length === 0) {
    warnings.push(
      `No sales data found for staff "${staffName}" (ID: ${staffId}) in period ${cycleStart} to ${cycleEnd}. ` +
        `Searched aliases: ${aliases.join(', ')}. ` +
        `Checked sources: staff_sales_summary (by staff_id), staff_sales_summary (by seller_name), sales_invoices.`
    );
    return createEmptySummary('none', aliases, rawSellerNamesMatched, warnings);
  }

  // Step 6: Calculate metrics from summary data
  return calculateSalesMetrics(
    summaryData,
    sourceUsed,
    aliasesUsed,
    rawSellerNamesMatched,
    warnings
  );
}

/**
 * Build aliases for staff name matching
 */
function buildStaffAliases(staffName: string): string[] {
  const aliases: string[] = [];
  const name = staffName.trim();
  if (!name) return [];

  const addAlias = (value: string) => {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned) aliases.push(cleaned);
  };

  addAlias(name);

  const withoutPrefix = name
    .replace(/^(?:د\.?|د\/|دكتور|دكتورة|دكتوره|dr\.?|doctor)\s*/i, '')
    .trim();
  addAlias(withoutPrefix);

  const base = withoutPrefix || name;
  addAlias(`د ${base}`);
  addAlias(`د/ ${base}`);
  addAlias(`د. ${base}`);
  addAlias(`دكتور ${base}`);
  addAlias(`دكتورة ${base}`);

  const normalized = normalizeStaffName(name);
  addAlias(normalized);
  addAlias(canonicalStaffName(name));
  addAlias(canonicalStaffName(base));

  return [...new Set(aliases)];
}

function canonicalStaffName(value: unknown): string {
  return normalizeStaffName(String(value || ''))
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^(?:د\.?|د\/|دكتور|دكتوره|dr\.?|doctor)\s*/i, '')
    .replace(/[./\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function staffNameMatchesSeller(sellerName: unknown, aliases: string[]): boolean {
  const seller = canonicalStaffName(sellerName);
  if (!seller) return false;

  return aliases.some((alias) => {
    const candidate = canonicalStaffName(alias);
    return Boolean(
      candidate &&
      (seller === candidate || seller.includes(candidate) || candidate.includes(seller))
    );
  });
}

/**
 * Convert invoice data to summary format
 */
function convertInvoicesToSummary(invoices: Row[]): Row[] {
  // Group by date to create summary-like structure
  const grouped = new Map<string, Row>();

  for (const invoice of invoices) {
    const date = String(invoice.invoice_date || '').slice(0, 10);
    const amount = getInvoiceAmount(invoice);
    const existing = grouped.get(date);

    if (existing) {
      existing.net_total = ((existing.net_total as number) || 0) + amount;
      existing.invoices_count = ((existing.invoices_count as number) || 0) + 1;
      existing.unique_customers = new Set([
        ...((existing.unique_customers as Set<string>) || []),
        String(invoice.customer_name || ''),
      ]).size;
    } else {
      grouped.set(date, {
        sale_date: date,
        seller_name: invoice.seller_name,
        branch: invoice.branch,
        net_total: amount,
        invoices_count: 1,
        unique_customers: invoice.customer_name ? 1 : 0,
      });
    }
  }

  return Array.from(grouped.values());
}

/**
 * Calculate sales metrics from summary data
 */
function calculateSalesMetrics(
  summaryData: Row[],
  sourceUsed: 'staff_id' | 'seller_name' | 'invoices_fallback' | 'none',
  aliasesUsed: string[],
  rawSellerNamesMatched: string[],
  warnings: string[]
): StaffSalesSummary {
  const rowAmount = (row: Row) => Number(row.net_total ?? 0) || getInvoiceAmount(row);
  const rowInvoiceCount = (row: Row) =>
    Number(row.invoices_count ?? 0) ||
    (row.invoice_date || row.invoice_no || row.invoice_number ? 1 : 0);
  const rowDate = (row: Row) => String(row.sale_date || row.invoice_date || '').slice(0, 10);
  const rowCustomerKey = (row: Row) =>
    String(row.customer_code || row.customer_phone || row.customer_name || '').trim();
  const netSales = summaryData.reduce((sum, row) => sum + rowAmount(row), 0);
  const invoicesCount = summaryData.reduce((sum, row) => sum + rowInvoiceCount(row), 0);
  const uniqueCustomerKeys = new Set(summaryData.map(rowCustomerKey).filter(Boolean));
  const uniqueCustomers =
    uniqueCustomerKeys.size ||
    summaryData.reduce((sum, row) => sum + (Number(row.unique_customers) || 0), 0);
  const avgInvoice = invoicesCount > 0 ? netSales / invoicesCount : 0;

  // Calculate delivery invoices (if available)
  const deliveryInvoicesCount = summaryData.reduce((sum, row) => {
    const isDelivery = String(row.invoice_type || '')
      .toLowerCase()
      .includes('delivery');
    return sum + (isDelivery ? rowInvoiceCount(row) : 0);
  }, 0);

  // Calculate branch contribution (if branch data available)
  const branchContribution = 0; // Would need total branch sales for this

  // Get latest invoices
  const invoiceLikeRows = summaryData.filter(
    (row) => row.invoice_date || row.invoice_no || row.invoice_number
  );
  const invoiceCards = invoiceLikeRows.map((row) => ({
    invoiceNumber: getInvoiceKey(row) || String(row.id || '-'),
    date: rowDate(row),
    amount: rowAmount(row),
    customer: String(row.customer_name || row.customer_code || 'غير محدد'),
  }));
  const latestInvoices = [...invoiceCards]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  const topInvoices = [...invoiceCards].sort((a, b) => b.amount - a.amount).slice(0, 30);

  // Get top customers
  const customerMap = new Map<
    string,
    { name: string; phone: string; totalSpent: number; invoicesCount: number }
  >();
  summaryData.forEach((row) => {
    const key = rowCustomerKey(row);
    if (!key) return;
    const current = customerMap.get(key) || {
      name: String(row.customer_name || row.customer_code || 'غير محدد'),
      phone: String(row.customer_phone || ''),
      totalSpent: 0,
      invoicesCount: 0,
    };
    current.totalSpent += rowAmount(row);
    current.invoicesCount += rowInvoiceCount(row);
    customerMap.set(key, current);
  });
  const topCustomers = [...customerMap.values()]
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 12);

  // Sales by day
  const dayMap = new Map<string, { date: string; sales: number; invoices: number }>();
  summaryData.forEach((row) => {
    const date = rowDate(row);
    if (!date) return;
    const current = dayMap.get(date) || { date, sales: 0, invoices: 0 };
    current.sales += rowAmount(row);
    current.invoices += rowInvoiceCount(row);
    dayMap.set(date, current);
  });
  const salesByDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Sales by week
  const salesByWeek = groupByPeriod(salesByDay, 'week');

  // Sales by month
  const salesByMonth = groupByPeriod(salesByDay, 'month');

  // Sales by shift (if available)
  const shiftMap = new Map<string, { shift: string; sales: number; invoices: number }>();
  summaryData.forEach((row) => {
    const shift = String(row.shift || 'غير محدد');
    const current = shiftMap.get(shift) || { shift, sales: 0, invoices: 0 };
    current.sales += rowAmount(row);
    current.invoices += rowInvoiceCount(row);
    shiftMap.set(shift, current);
  });
  const salesByShift = [...shiftMap.values()].sort((a, b) => b.sales - a.sales);

  // Sales by invoice type (if available)
  const typeMap = new Map<string, { type: string; sales: number; invoices: number }>();
  summaryData.forEach((row) => {
    const type = String(row.invoice_type || 'غير محدد');
    const current = typeMap.get(type) || { type, sales: 0, invoices: 0 };
    current.sales += rowAmount(row);
    current.invoices += rowInvoiceCount(row);
    typeMap.set(type, current);
  });
  const salesByInvoiceType = [...typeMap.values()].sort((a, b) => b.sales - a.sales);

  return {
    netSales,
    invoicesCount,
    avgInvoice,
    uniqueCustomers,
    deliveryInvoicesCount,
    branchContribution,
    latestInvoices,
    topInvoices,
    topCustomers,
    salesByDay,
    salesByWeek,
    salesByMonth,
    salesByShift,
    salesByInvoiceType,
    sourceUsed,
    aliasesUsed,
    rawSellerNamesMatched,
    dataHealthWarnings: warnings,
  };
}

/**
 * Group sales data by period (week or month)
 */
function groupByPeriod(
  salesByDay: Array<{ date: string; sales: number; invoices: number }>,
  period: 'week' | 'month'
): Array<{ period: string; sales: number; invoices: number }> {
  const grouped = new Map<string, { sales: number; invoices: number }>();

  salesByDay.forEach((item) => {
    const date = new Date(item.date);
    let key: string;

    if (period === 'week') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    const existing = grouped.get(key) || { sales: 0, invoices: 0 };
    existing.sales += item.sales;
    existing.invoices += item.invoices;
    grouped.set(key, existing);
  });

  return Array.from(grouped.entries())
    .map(([period, data]) => ({ period, sales: data.sales, invoices: data.invoices }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Create empty summary with warnings
 */
function createEmptySummary(
  sourceUsed: 'staff_id' | 'seller_name' | 'invoices_fallback' | 'none',
  aliasesUsed: string[],
  rawSellerNamesMatched: string[],
  warnings: string[]
): StaffSalesSummary {
  return {
    netSales: 0,
    invoicesCount: 0,
    avgInvoice: 0,
    uniqueCustomers: 0,
    deliveryInvoicesCount: 0,
    branchContribution: 0,
    latestInvoices: [],
    topInvoices: [],
    topCustomers: [],
    salesByDay: [],
    salesByWeek: [],
    salesByMonth: [],
    salesByShift: [],
    salesByInvoiceType: [],
    sourceUsed,
    aliasesUsed,
    rawSellerNamesMatched,
    dataHealthWarnings: warnings,
  };
}
