/**
 * Unified Staff Sales Service
 * 
 * This is the single source of truth for all staff sales calculations.
 * Used by Dashboard, Staff Profile, Sales Cards, and Analytics.
 * 
 * Data Sources (in priority order):
 * 1. staff_sales_summary with staff_id (most reliable)
 * 2. staff_sales_summary with seller_name + alias matching
 * 3. sales_invoices with seller_name + alias matching (fallback)
 * 
 * All calculations use the same cycle range (26th to 25th).
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { normalizeStaffName, type StaffIdentityRow } from "@/lib/staffIdentityService";
import { normalizeBranchName } from "@/lib/branch";
import { selectAllPaged } from "@/lib/supabasePaged";


function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;

export interface StaffCycleSales {
  totalSales: number;
  invoicesCount: number;
  avgInvoice: number;
  maxInvoiceAmount: number;
  maxInvoiceNumber: string | null;
  maxInvoiceCustomerName: string | null;
  maxInvoiceDate: string | null;
  uniqueCustomersCount: number;
  lastInvoiceDate: string | null;
  branchName: string | null;
  matchedAliases: string[];
  sourceTableUsed: "staff_sales_summary_staff_id" | "staff_sales_summary_seller_name" | "sales_invoices" | "none";
  warnings: string[];
}

export interface StaffCycleInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string | null;
  customerCode: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerSegment: string | null;
  customerType: string | null;
  invoiceType: string | null;
  invoiceCategory: string | null;
  netTotal: number;
  branchName: string | null;
  sellerName: string | null;
  matchedAlias: string | null;
}

export interface StaffLinkedCustomer {
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  invoicesCount: number;
  totalSales: number;
  avgInvoice: number;
  lastInvoiceDate: string | null;
}

export interface StaffInvoiceAnalysis {
  avgInvoice: number;
  maxInvoice: number;
  minInvoice: number;
  branchAvgInvoice: number;
  differenceFromBranchAvg: number;
  percentageVsBranchAvg: number;
  invoicesAboveBranchAvg: number;
  invoicesBelowBranchAvg: number;
  maxInvoiceDetails: {
    invoiceNumber: string;
    customerName: string;
    amount: number;
    date: string;
  };
}

export interface CycleRange {
  periodStart: string;
  periodEnd: string;
}

/**
 * Get the current pharmacy cycle range (26th to 25th)
 */
export function getCurrentCycleRange(referenceDate: Date = new Date()): CycleRange {
  const date = referenceDate;
  const day = date.getDate();
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();

  let periodStart: Date;
  let periodEnd: Date;

  if (day >= 26) {
    // We're in the start of a new cycle
    periodStart = new Date(year, month, 26);
    // End is 25th of next month
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    periodEnd = new Date(endYear, endMonth, 25, 23, 59, 59);
  } else {
    // We're in the second half of a cycle (1→25)
    // Cycle started on 26th of PREVIOUS month
    const startMonth = month === 0 ? 11 : month - 1;
    const startYear = month === 0 ? year - 1 : year;
    periodStart = new Date(startYear, startMonth, 26);
    periodEnd = new Date(year, month, 25, 23, 59, 59);
  }

  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  };
}

/**
 * Build aliases for staff name matching
 */
function buildStaffAliases(staffName: string): string[] {
  const aliases: string[] = [];
  const name = staffName.trim();

  if (!name) return aliases;

  // Original name
  aliases.push(name);

  // Remove common Arabic prefixes
  const withoutPrefix = name.replace(/^(?:د\.?|د\/|دكتو?ر|dr\.?|doctor)\s*/i, "");
  if (withoutPrefix !== name) {
    aliases.push(withoutPrefix);
  }

  // Add common prefix variations
  if (!name.startsWith("د")) {
    aliases.push(`د ${name}`);
    aliases.push(`د/ ${name}`);
    aliases.push(`د. ${name}`);
  }

  // Normalize and add
  const normalized = normalizeStaffName(name);
  if (normalized !== name.toLowerCase()) {
    aliases.push(normalized);
  }

  // Remove duplicates
  return [...new Set(aliases)];
}

function rowMatchesStaffIdentity(row: Row, staffId: string, aliases: string[]) {
  const idCandidates = [
    row.staff_id,
    row.employee_id,
    row.doctor_id,
    row.seller_id,
    row.pharmacist_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (staffId && idCandidates.includes(staffId)) return true;

  const normalizedSeller = normalizeStaffName(row.seller_name || row.doctor_name || row.staff_name || "");
  if (!normalizedSeller) return false;
  return aliases.some((alias) => normalizeStaffName(alias) === normalizedSeller);
}

function numberValue(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Get staff cycle sales - single source of truth
 */
export async function getStaffCycleSales(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffCycleSales> {
  if (!isSupabaseConfigured) {
    return createEmptySales("none", ["Supabase not configured"]);
  }

  const warnings: string[] = [];
  const matchedAliases: string[] = [];
  let sourceTableUsed: "staff_sales_summary_staff_id" | "staff_sales_summary_seller_name" | "sales_invoices" | "none" = "none";
  
  let summaryData: Row[] | null = null;

  // Step 1: Try staff_sales_summary by staff_id (preferred)
  try {
    const { data: summaryById, error: summaryByIdError } = await supabase
      .from("staff_sales_summary")
      .select("*")
      .eq("staff_id", staffId)
      .gte("sale_date", periodStart)
      .lt("sale_date", periodEnd)
      .limit(500);
    
    if (!summaryByIdError && summaryById && summaryById.length > 0) {
      summaryData = summaryById as Row[];
      sourceTableUsed = "staff_sales_summary_staff_id";
      matchedAliases.push(...new Set(summaryById.map((r) => String(r.seller_name || ""))));
    }
  } catch (error) {
    warnings.push(`staff_id query failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Step 2: Fallback to staff_sales_summary by seller_name with aliases
  if (!summaryData || summaryData.length === 0) {
    const aliases = buildStaffAliases(staffName);
    matchedAliases.push(...aliases);
    
    try {
      const { data: summaryByName, error: summaryByNameError } = await supabase
        .from("staff_sales_summary")
        .select("*")
        .gte("sale_date", periodStart)
        .lt("sale_date", periodEnd)
        .limit(1000);
      
      if (!summaryByNameError && summaryByName) {
        // Filter by matching seller_name using aliases
        const filtered = summaryByName.filter((row) => rowMatchesStaffIdentity(row, staffId, aliases));

        if (filtered.length > 0) {
          summaryData = filtered;
          sourceTableUsed = "staff_sales_summary_seller_name";
          warnings.push(`Sales matched by seller_name aliases: ${matchedAliases.slice(0, 3).join(", ")}`);
        }
      }
    } catch (error) {
      warnings.push(`seller_name query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Step 3: Fallback to sales_invoices with seller_name aliases
  if (!summaryData || summaryData.length === 0) {
    const aliases = buildStaffAliases(staffName);
    
    try {
      const { data: invoiceData, error: invoiceError } = await selectAllPaged<Row>({
        table: "sales_invoices",
        select: "*",
        chunkSize: 1000,
        maxRows: 50000,
        orderBy: "invoice_date",
        ascending: false,
        filters: (query) => query.gte("invoice_date", periodStart).lt("invoice_date", dayAfter(periodEnd)),
      });

      if (!invoiceError && invoiceData) {
        // Filter by matching seller_name using aliases
        const filtered = invoiceData.filter((row) => rowMatchesStaffIdentity(row, staffId, aliases));

        if (filtered.length > 0) {
          sourceTableUsed = "sales_invoices";
          summaryData = convertInvoicesToSummary(filtered as Row[]);
          warnings.push(`Sales matched from invoices using seller_name aliases: ${matchedAliases.slice(0, 3).join(", ")}`);
        }
      }
    } catch (error) {
      warnings.push(`invoices fallback query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Step 4: If still no data, add explicit warning
  if (!summaryData || summaryData.length === 0) {
    warnings.push(
      `No sales data found for staff "${staffName}" (ID: ${staffId}) in period ${periodStart} to ${periodEnd}. ` +
      `Searched aliases: ${matchedAliases.join(", ")}. ` +
      `Checked sources: staff_sales_summary (by staff_id), staff_sales_summary (by seller_name), sales_invoices.`
    );
    return createEmptySales("none", warnings);
  }

  // Step 5: Calculate metrics from summary data
  return calculateSalesMetrics(summaryData, sourceTableUsed, matchedAliases, warnings, branch);
}

/**
 * Convert invoice data to summary format
 */
function convertInvoicesToSummary(invoices: Row[]): Row[] {
  // Group by date to create summary-like structure
  const grouped = new Map<string, Row>();
  const customers = new Map<string, Set<string>>();

  for (const invoice of invoices) {
    const date = String(invoice.invoice_date || "").slice(0, 10);
    const existing = grouped.get(date);
    const customerKey = String(invoice.customer_code || invoice.customer_phone || invoice.customer_name || "");

    if (existing) {
      existing.net_total = numberValue(existing.net_total || 0) + numberValue(invoice.net_amount || invoice.discounted_amount || invoice.amount || 0);
      existing.invoices_count = numberValue(existing.invoices_count || 0) + 1;
    } else {
      grouped.set(date, {
        sale_date: date,
        seller_name: invoice.seller_name,
        branch: invoice.branch,
        net_total: numberValue(invoice.net_amount || invoice.discounted_amount || invoice.amount || 0),
        invoices_count: 1,
        unique_customers: customerKey ? 1 : 0,
      });
    }

    // Track unique customers
    if (customerKey) {
      if (!customers.has(date)) {
        customers.set(date, new Set());
      }
      customers.get(date)!.add(customerKey);
    }
  }

  // Update unique_customers count
  for (const [date, row] of grouped.entries()) {
    if (customers.has(date)) {
      row.unique_customers = customers.get(date)!.size;
    }
  }

  return Array.from(grouped.values());
}

/**
 * Calculate sales metrics from summary data
 */
function calculateSalesMetrics(
  summaryData: Row[],
  sourceTableUsed: "staff_sales_summary_staff_id" | "staff_sales_summary_seller_name" | "sales_invoices" | "none",
  matchedAliases: string[],
  warnings: string[],
  branch: string
): StaffCycleSales {
  const totalSales = summaryData.reduce((sum, row) => sum + numberValue(row.net_total || row.net_amount || row.discounted_amount || row.amount || 0), 0);
  const invoicesCount = summaryData.reduce((sum, row) => sum + numberValue(row.invoices_count || 0), 0);
  const uniqueCustomersCount = summaryData.reduce((sum, row) => sum + numberValue(row.unique_customers || 0), 0);
  const avgInvoice = invoicesCount > 0 ? totalSales / invoicesCount : 0;

  // Find max invoice
  let maxInvoiceAmount = 0;
  let maxInvoiceNumber: string | null = null;
  let maxInvoiceCustomerName: string | null = null;
  let maxInvoiceDate: string | null = null;

  // Find last invoice date
  let lastInvoiceDate: string | null = null;

  for (const row of summaryData) {
    const netTotal = row.net_total as number || 0;
    if (netTotal > maxInvoiceAmount) {
      maxInvoiceAmount = netTotal;
      maxInvoiceNumber = String(row.invoice_number || row.sale_date || "");
      maxInvoiceCustomerName = String(row.customer_name || "");
      maxInvoiceDate = String(row.sale_date || "");
    }

    const saleDate = String(row.sale_date || "");
    if (saleDate && (!lastInvoiceDate || saleDate > lastInvoiceDate)) {
      lastInvoiceDate = saleDate;
    }
  }

  return {
    totalSales,
    invoicesCount,
    avgInvoice,
    maxInvoiceAmount,
    maxInvoiceNumber,
    maxInvoiceCustomerName,
    maxInvoiceDate,
    uniqueCustomersCount,
    lastInvoiceDate,
    branchName: branch,
    matchedAliases,
    sourceTableUsed,
    warnings,
  };
}

/**
 * Create empty sales result
 */
function createEmptySales(
  sourceTableUsed: "staff_sales_summary_staff_id" | "staff_sales_summary_seller_name" | "sales_invoices" | "none",
  warnings: string[]
): StaffCycleSales {
  return {
    totalSales: 0,
    invoicesCount: 0,
    avgInvoice: 0,
    maxInvoiceAmount: 0,
    maxInvoiceNumber: null,
    maxInvoiceCustomerName: null,
    maxInvoiceDate: null,
    uniqueCustomersCount: 0,
    lastInvoiceDate: null,
    branchName: null,
    matchedAliases: [],
    sourceTableUsed,
    warnings,
  };
}

/**
 * Get staff cycle invoices
 */
export async function getStaffCycleInvoices(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string,
  limit: number = 20
): Promise<StaffCycleInvoice[]> {
  if (!isSupabaseConfigured) return [];

  const aliases = buildStaffAliases(staffName);
  const matchedAliases: string[] = [];

  try {
    const { data: invoiceData, error: invoiceError } = await selectAllPaged<Row>({
      table: "sales_invoices",
      select: "*",
      chunkSize: 1000,
      maxRows: 50000,
      orderBy: "invoice_date",
      ascending: false,
      filters: (query) => query.gte("invoice_date", periodStart).lt("invoice_date", dayAfter(periodEnd)),
    });

    if (invoiceError) return [];

    // Filter by matching seller_name using aliases
    const filtered = (invoiceData || []).filter((row) => {
      const sellerName = String(row.seller_name || "");
      const matched = rowMatchesStaffIdentity(row, staffId, aliases);
      if (matched) {
        matchedAliases.push(sellerName);
      }
      return matched;
    });

    return filtered.slice(0, limit).map((row) => ({
      invoiceNumber: String(row.invoice_number || ""),
      invoiceDate: String(row.invoice_date || ""),
      customerName: String(row.customer_name || null),
      customerCode: String(row.customer_code || null),
      customerPhone: String(row.customer_phone || null),
      customerAddress: String(row.customer_address || null),
      customerSegment: String(row.customer_segment || null),
      customerType: String(row.customer_type || null),
      invoiceType: String(row.invoice_type || null),
      invoiceCategory: String(row.invoice_category || null),
      netTotal: numberValue(row.net_amount || row.discounted_amount || row.amount || 0),
      branchName: String(row.branch || null),
      sellerName: String(row.seller_name || null),
      matchedAlias: matchedAliases.includes(String(row.seller_name || "")) ? String(row.seller_name || "") : null,
    }));
  } catch (error) {
    console.error("Error fetching staff invoices:", error);
    return [];
  }
}

/**
 * Get staff linked customers
 */
export async function getStaffLinkedCustomers(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffLinkedCustomer[]> {
  if (!isSupabaseConfigured) return [];

  const aliases = buildStaffAliases(staffName);

  try {
    const { data: invoiceData, error: invoiceError } = await selectAllPaged<Row>({
      table: "sales_invoices",
      select: "*",
      chunkSize: 1000,
      maxRows: 50000,
      orderBy: "invoice_date",
      ascending: false,
      filters: (query) => query.gte("invoice_date", periodStart).lt("invoice_date", dayAfter(periodEnd)),
    });

    if (invoiceError) return [];

    // Filter by matching seller_name using aliases
    const filtered = (invoiceData || []).filter((row) => {
      return rowMatchesStaffIdentity(row, staffId, aliases);
    });

    // Group by customer
    const customerMap = new Map<string, StaffLinkedCustomer>();

    for (const row of filtered) {
      const customerKey = String(row.customer_code || row.customer_phone || row.customer_name || row.customer_id || "");
      if (!customerKey) continue;

      const existing = customerMap.get(customerKey);
      const amount = numberValue(row.net_amount || row.discounted_amount || row.amount || 0);
      const invoiceDate = String(row.invoice_date || "");

      if (existing) {
        existing.invoicesCount += 1;
        existing.totalSales += amount;
        existing.lastInvoiceDate = invoiceDate > (existing.lastInvoiceDate || "") ? invoiceDate : existing.lastInvoiceDate;
      } else {
        customerMap.set(customerKey, {
          customerId: String(row.customer_id || null),
          customerCode: String(row.customer_code || null),
          customerName: String(row.customer_name || null),
          customerPhone: String(row.customer_phone || null),
          customerAddress: String(row.customer_address || null),
          invoicesCount: 1,
          totalSales: amount,
          avgInvoice: amount,
          lastInvoiceDate: invoiceDate,
        });
      }
    }

    // Calculate avg invoice
    for (const customer of customerMap.values()) {
      customer.avgInvoice = customer.invoicesCount > 0 ? customer.totalSales / customer.invoicesCount : 0;
    }

    return Array.from(customerMap.values()).sort((a, b) => b.totalSales - a.totalSales);
  } catch (error) {
    console.error("Error fetching staff customers:", error);
    return [];
  }
}

/**
 * Get staff invoice analysis
 */
export async function getStaffInvoiceAnalysis(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffInvoiceAnalysis> {
  if (!isSupabaseConfigured) {
    return createEmptyAnalysis();
  }

  const aliases = buildStaffAliases(staffName);

  try {
    // Get staff invoices
    const { data: invoiceData, error: invoiceError } = await selectAllPaged<Row>({
      table: "sales_invoices",
      select: "*",
      chunkSize: 1000,
      maxRows: 50000,
      orderBy: "invoice_date",
      ascending: false,
      filters: (query) => query.gte("invoice_date", periodStart).lt("invoice_date", dayAfter(periodEnd)),
    });

    if (invoiceError || !invoiceData) {
      return createEmptyAnalysis();
    }

    // Filter by matching seller_name using aliases
    const filtered = (invoiceData || []).filter((row) => {
      return rowMatchesStaffIdentity(row, staffId, aliases);
    });

    if (filtered.length === 0) {
      return createEmptyAnalysis();
    }

    // Calculate staff metrics
    const amounts = filtered.map((row) => numberValue(row.net_amount || row.discounted_amount || row.amount || 0));
    const avgInvoice = amounts.length > 0 ? amounts.reduce((sum, a) => sum + a, 0) / amounts.length : 0;
    const maxInvoice = Math.max(...amounts);
    const minInvoice = Math.min(...amounts);

    // Find max invoice details
    const maxInvoiceRow = filtered.find((row) => {
      const amount = numberValue(row.net_amount || row.discounted_amount || row.amount || 0);
      return amount === maxInvoice;
    });

    // Get branch average
    const branchAvg = await getBranchCycleAverage(branch, periodStart, periodEnd);

    // Calculate comparison
    const differenceFromBranchAvg = avgInvoice - branchAvg;
    const percentageVsBranchAvg = branchAvg > 0 ? ((avgInvoice - branchAvg) / branchAvg) * 100 : 0;
    const invoicesAboveBranchAvg = amounts.filter((a) => a > branchAvg).length;
    const invoicesBelowBranchAvg = amounts.filter((a) => a < branchAvg).length;

    return {
      avgInvoice,
      maxInvoice,
      minInvoice,
      branchAvgInvoice: branchAvg,
      differenceFromBranchAvg,
      percentageVsBranchAvg,
      invoicesAboveBranchAvg,
      invoicesBelowBranchAvg,
      maxInvoiceDetails: {
        invoiceNumber: String(maxInvoiceRow?.invoice_number || ""),
        customerName: String(maxInvoiceRow?.customer_name || ""),
        amount: maxInvoice,
        date: String(maxInvoiceRow?.invoice_date || ""),
      },
    };
  } catch (error) {
    console.error("Error calculating invoice analysis:", error);
    return createEmptyAnalysis();
  }
}

/**
 * Get branch cycle average
 */
export async function getBranchCycleAverage(
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  if (!isSupabaseConfigured) return 0;

  try {
    const { data, error } = await selectAllPaged<Row>({
      table: "sales_invoices",
      select: "*",
      chunkSize: 1000,
      maxRows: 50000,
      filters: (query) => {
        let q = query.gte("invoice_date", periodStart).lt("invoice_date", dayAfter(periodEnd));
        if (branch && branch !== "all") q = q.eq("branch", branch);
        return q;
      },
    });

    if (error || !data) return 0;

    const amounts = data.map((row) => row.net_amount || row.discounted_amount || row.net_total || row.amount || row.gross_amount || 0).map(Number).filter((v) => Number.isFinite(v) && v > 0);
    return amounts.length > 0 ? amounts.reduce((sum, a) => sum + a, 0) / amounts.length : 0;
  } catch (error) {
    console.error("Error calculating branch average:", error);
    return 0;
  }
}

/**
 * Create empty analysis
 */
function createEmptyAnalysis(): StaffInvoiceAnalysis {
  return {
    avgInvoice: 0,
    maxInvoice: 0,
    minInvoice: 0,
    branchAvgInvoice: 0,
    differenceFromBranchAvg: 0,
    percentageVsBranchAvg: 0,
    invoicesAboveBranchAvg: 0,
    invoicesBelowBranchAvg: 0,
    maxInvoiceDetails: {
      invoiceNumber: "",
      customerName: "",
      amount: 0,
      date: "",
    },
  };
}
