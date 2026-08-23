import { getStaffInvoiceTruth } from '@/lib/staffInvoiceTruthService';

type Row = Record<string, unknown>;

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

function emptySummary(warnings: string[] = []): StaffSalesSummary {
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
    sourceUsed: 'none',
    aliasesUsed: [],
    rawSellerNamesMatched: [],
    dataHealthWarnings: warnings,
  };
}

export async function getLiveStaffInvoiceRowsForPeriod(
  params: GetStaffSalesSummaryParams
): Promise<{ rows: Row[]; rawSellerNamesMatched: string[]; warnings: string[] }> {
  void params.staffName;
  void params.branch;
  void params.role;
  void params.includeAliases;
  void params.signal;

  try {
    const truth = await getStaffInvoiceTruth(params.staffId, params.cycleStart, params.cycleEnd);
    return {
      rows: truth.invoices.map((invoice) => ({
        id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        invoice_no: invoice.invoiceNumber,
        invoice_date: invoice.invoiceDate,
        customer_name: invoice.customerName,
        customer_code: invoice.customerCode,
        customer_phone: invoice.customerPhone,
        customer_address: invoice.customerAddress,
        customer_segment: invoice.customerSegment,
        branch: invoice.branch,
        seller_name: invoice.sellerName,
        invoice_type: invoice.invoiceType,
        invoice_category: invoice.invoiceCategory,
        shift: invoice.shift,
        net_total: invoice.amount,
        net_amount: invoice.amount,
        amount: invoice.amount,
      })),
      rawSellerNamesMatched: truth.matchedSellerNames,
      warnings: [...truth.diagnostics.warnings, ...truth.diagnostics.errors],
    };
  } catch (error) {
    return {
      rows: [],
      rawSellerNamesMatched: [],
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function getStaffSalesSummaryForPeriod(
  params: GetStaffSalesSummaryParams
): Promise<StaffSalesSummary> {
  void params.staffName;
  void params.branch;
  void params.role;
  void params.includeAliases;
  void params.signal;

  try {
    const truth = await getStaffInvoiceTruth(params.staffId, params.cycleStart, params.cycleEnd);
    const warnings = [...truth.diagnostics.warnings, ...truth.diagnostics.errors];
    const latestInvoices = truth.latestInvoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      amount: invoice.amount,
      customer: invoice.customerName || invoice.customerCode || 'غير محدد',
    }));
    const topInvoices = [...truth.invoices]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 30)
      .map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        amount: invoice.amount,
        customer: invoice.customerName || invoice.customerCode || 'غير محدد',
      }));
    const topCustomers = truth.linkedCustomers.slice(0, 12).map((customer) => ({
      name: customer.name || customer.code || 'غير محدد',
      phone: customer.phone || '',
      totalSpent: customer.totalSpent,
      invoicesCount: customer.invoicesCount,
    }));

    return {
      netSales: truth.summary.totalSales,
      invoicesCount: truth.summary.invoicesCount,
      avgInvoice: truth.summary.avgInvoice,
      uniqueCustomers: truth.summary.uniqueCustomersCount,
      deliveryInvoicesCount: truth.summary.deliveryInvoicesCount,
      branchContribution: 0,
      latestInvoices,
      topInvoices,
      topCustomers,
      salesByDay: truth.summary.salesByDay,
      salesByWeek: truth.summary.salesByWeek,
      salesByMonth: truth.summary.salesByMonth,
      salesByShift: truth.summary.salesByShift,
      salesByInvoiceType: truth.summary.salesByInvoiceType,
      sourceUsed: truth.diagnostics.salesTableAvailable ? 'invoices_fallback' : 'none',
      aliasesUsed: truth.aliases,
      rawSellerNamesMatched: truth.matchedSellerNames,
      dataHealthWarnings: warnings,
    };
  } catch (error) {
    return emptySummary([error instanceof Error ? error.message : String(error)]);
  }
}
