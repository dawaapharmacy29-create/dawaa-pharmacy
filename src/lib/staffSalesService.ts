import { getStaffInvoiceTruth } from '@/lib/staffInvoiceTruthService';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';

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
  sourceTableUsed:
    | 'staff_sales_summary_staff_id'
    | 'staff_sales_summary_seller_name'
    | 'sales_invoices'
    | 'none';
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

export function getCurrentCycleRange(referenceDate: Date = new Date()): CycleRange {
  const date = referenceDate;
  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();

  let periodStart: Date;
  let periodEnd: Date;

  if (day >= 26) {
    periodStart = new Date(year, month, 26);
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    periodEnd = new Date(endYear, endMonth, 25, 23, 59, 59);
  } else {
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

function emptySales(warnings: string[] = []): StaffCycleSales {
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
    sourceTableUsed: 'none',
    warnings,
  };
}

function emptyAnalysis(): StaffInvoiceAnalysis {
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
      invoiceNumber: '',
      customerName: '',
      amount: 0,
      date: '',
    },
  };
}

export async function getStaffCycleSales(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffCycleSales> {
  void staffName;
  try {
    const truth = await getStaffInvoiceTruth(staffId, periodStart, periodEnd);
    const maxInvoice = truth.summary.maxInvoice;
    const lastInvoiceDate = truth.invoices.reduce<string | null>((latest, invoice) => {
      if (!invoice.invoiceDate) return latest;
      return !latest || invoice.invoiceDate > latest ? invoice.invoiceDate : latest;
    }, null);

    return {
      totalSales: truth.summary.totalSales,
      invoicesCount: truth.summary.invoicesCount,
      avgInvoice: truth.summary.avgInvoice,
      maxInvoiceAmount: maxInvoice?.amount || 0,
      maxInvoiceNumber: maxInvoice?.invoiceNumber || null,
      maxInvoiceCustomerName: maxInvoice?.customerName || null,
      maxInvoiceDate: maxInvoice?.invoiceDate || null,
      uniqueCustomersCount: truth.summary.uniqueCustomersCount,
      lastInvoiceDate,
      branchName: truth.staff.branch || branch || null,
      matchedAliases: truth.aliases,
      sourceTableUsed: truth.diagnostics.salesTableAvailable ? 'sales_invoices' : 'none',
      warnings: [...truth.diagnostics.warnings, ...truth.diagnostics.errors],
    };
  } catch (error) {
    return emptySales([error instanceof Error ? error.message : String(error)]);
  }
}

export async function getStaffCycleInvoices(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string,
  limit: number = 20
): Promise<StaffCycleInvoice[]> {
  void staffName;
  void branch;
  try {
    const truth = await getStaffInvoiceTruth(staffId, periodStart, periodEnd);
    return [...truth.invoices]
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
      .slice(0, Math.max(0, limit))
      .map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        customerName: invoice.customerName || null,
        customerCode: invoice.customerCode || null,
        customerPhone: invoice.customerPhone || null,
        customerAddress: invoice.customerAddress || null,
        customerSegment: invoice.customerSegment || null,
        customerType: invoice.customerSegment || null,
        invoiceType: invoice.invoiceType || null,
        invoiceCategory: invoice.invoiceCategory || null,
        netTotal: invoice.amount,
        branchName: invoice.branch || null,
        sellerName: invoice.sellerName || null,
        matchedAlias: truth.matchedSellerNames.includes(invoice.sellerName)
          ? invoice.sellerName
          : null,
      }));
  } catch {
    return [];
  }
}

export async function getStaffLinkedCustomers(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffLinkedCustomer[]> {
  void staffName;
  void branch;
  try {
    const truth = await getStaffInvoiceTruth(staffId, periodStart, periodEnd);
    return truth.linkedCustomers.map((customer) => ({
      customerId: null,
      customerCode: customer.code || null,
      customerName: customer.name || null,
      customerPhone: customer.phone || null,
      customerAddress: customer.address || null,
      invoicesCount: customer.invoicesCount,
      totalSales: customer.totalSpent,
      avgInvoice: customer.avgInvoice,
      lastInvoiceDate: customer.lastPurchase || null,
    }));
  } catch {
    return [];
  }
}

export async function getStaffInvoiceAnalysis(
  staffId: string,
  staffName: string,
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<StaffInvoiceAnalysis> {
  void staffName;
  void branch;
  try {
    const truth = await getStaffInvoiceTruth(staffId, periodStart, periodEnd);
    const maxInvoice = truth.invoiceAnalysis.maxInvoice;
    return {
      avgInvoice: truth.invoiceAnalysis.avgInvoice,
      maxInvoice: maxInvoice?.amount || 0,
      minInvoice: truth.invoiceAnalysis.minInvoice?.amount || 0,
      branchAvgInvoice: truth.branchComparison.branchAvg,
      differenceFromBranchAvg: truth.branchComparison.difference,
      percentageVsBranchAvg: truth.branchComparison.percentDifference,
      invoicesAboveBranchAvg: truth.invoiceAnalysis.invoicesAboveBranchAvg,
      invoicesBelowBranchAvg: truth.invoiceAnalysis.invoicesBelowBranchAvg,
      maxInvoiceDetails: {
        invoiceNumber: maxInvoice?.invoiceNumber || '',
        customerName: maxInvoice?.customerName || '',
        amount: maxInvoice?.amount || 0,
        date: maxInvoice?.invoiceDate || '',
      },
    };
  } catch {
    return emptyAnalysis();
  }
}

export async function getBranchCycleAverage(
  branch: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  try {
    const summary = await loadSalesAnalyticsSummary({
      startDate: periodStart,
      endDate: periodEnd,
      branch: branch && branch !== 'all' ? branch : undefined,
    });
    return summary.kpis.avgInvoice;
  } catch {
    return 0;
  }
}
