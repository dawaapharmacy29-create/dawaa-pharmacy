import { supabase } from "@/lib/supabase";
import {
  applyCustomerSalesMetrics,
  getCustomerMetrics,
  matchCustomerInvoice,
  normalizePhone,
  normalizeText,
  cleanCustomerCode,
  type CustomerLike,
  type InvoiceLike,
} from "@/lib/customerMetrics";
import { getInvoiceAmount, getInvoiceDate, getInvoiceDoctor, pickFirst } from "@/lib/dawaa2027";

export interface NormalizedInvoice {
  raw: InvoiceLike;
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  amount: number;
  doctor: string;
  branch: string;
  customerCode: string;
  customerName: string;
  customerPhone: string;
}

export async function fetchSalesInvoices(limit = 100000): Promise<InvoiceLike[]> {
  const pageSize = 1000;
  const rows: InvoiceLike[] = [];

  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from("sales_invoices")
      .select("*")
      .order("invoice_date", { ascending: false })
      .range(from, to);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as InvoiceLike[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

export function normalizeInvoice(invoice: InvoiceLike): NormalizedInvoice {
  return {
    raw: invoice,
    id: String(pickFirst(invoice, ["id"], "")),
    invoiceNumber: String(pickFirst(invoice, ["invoice_number", "number", "receipt_number"], "")),
    invoiceDate: String(getInvoiceDate(invoice) || "") || null,
    amount: getInvoiceAmount(invoice),
    doctor: getInvoiceDoctor(invoice) || "غير محدد",
    branch: String(pickFirst(invoice, ["branch", "branch_name"], "غير محدد") || "غير محدد"),
    customerCode: cleanCustomerCode(pickFirst(invoice, ["customer_code", "code"], "")),
    customerName: String(pickFirst(invoice, ["customer_name", "name"], "") || ""),
    customerPhone: normalizePhone(pickFirst(invoice, ["customer_phone", "phone", "phone_number", "mobile"], "")),
  };
}

export function computeDashboardSalesMetrics(invoices: InvoiceLike[]) {
  const totalSales = invoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);
  const invoiceCount = invoices.filter((invoice) => getInvoiceAmount(invoice) > 0).length;
  const customers = new Set(
    invoices
      .map((invoice) => normalizeInvoice(invoice))
      .map((invoice) => invoice.customerCode || invoice.customerPhone || normalizeText(invoice.customerName))
      .filter(Boolean),
  );
  return {
    totalSales,
    invoiceCount,
    averageInvoice: invoiceCount ? totalSales / invoiceCount : 0,
    activeCustomers: customers.size,
  };
}

export function computeCustomerMetrics(customer: CustomerLike, invoices: InvoiceLike[]) {
  return getCustomerMetrics(customer, invoices);
}

export function enrichCustomersWithSalesMetrics<T extends CustomerLike>(customers: T[], invoices: InvoiceLike[]): T[] {
  return customers.map((customer) => applyCustomerSalesMetrics(customer, invoices));
}

export function computeStaffSalesMetrics(staffName: string, invoices: InvoiceLike[]) {
  const normalizedName = normalizeText(staffName);
  const matched = invoices.filter((invoice) => normalizeText(getInvoiceDoctor(invoice)) === normalizedName);
  const totalSales = matched.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);
  return {
    totalSales,
    invoiceCount: matched.length,
    averageInvoice: matched.length ? totalSales / matched.length : 0,
    customersHandled: new Set(
      matched
        .map((invoice) => normalizeInvoice(invoice))
        .map((invoice) => invoice.customerCode || invoice.customerPhone || normalizeText(invoice.customerName))
        .filter(Boolean),
    ).size,
    highestInvoices: [...matched].sort((a, b) => getInvoiceAmount(b) - getInvoiceAmount(a)).slice(0, 10),
  };
}

export function getInvoicesForCustomer(customer: CustomerLike, invoices: InvoiceLike[]) {
  return invoices.filter((invoice) => matchCustomerInvoice(customer, invoice));
}
