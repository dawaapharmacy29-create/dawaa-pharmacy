import { supabase } from '@/lib/supabase';
import {
  parseEPlusPurchases,
  ReportError,
  type ParsedReport,
  type PurchaseBranch,
} from './ePlusReport';
import type { PurchaseReviewData } from './ledger';

// «مراجعة المشتريات» data (migration 20261114153544). Top management only.

const ERRORS: Record<string, string> = {
  not_authorized: 'الصفحة دي للمدير العام والتنفيذي بس',
  invalid_store: 'المخزن مش معروف',
  empty_file: 'مفيش فواتير في الملف',
  bad_rows: 'فيه فواتير ناقصة الرقم أو التاريخ أو المورد',
  unknown_supplier: 'المورد مش موجود',
  invalid_payment: 'المبلغ أو التاريخ مش صح',
  invalid_period: 'الفترة مش صح',
};

function fail(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message || '');
  const known = Object.keys(ERRORS).find((key) => message.includes(key));
  if (/function .* does not exist|Could not find the function/i.test(message))
    throw new Error('الصفحة لسه مستنية تحديث قاعدة البيانات');
  throw new Error(known ? ERRORS[known] : fallback);
}

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export async function loadPurchaseReview(from: string | null = null): Promise<PurchaseReviewData> {
  const { data, error } = await supabase.rpc('get_purchase_review_v1', { p_from: from });
  if (error) fail(error, 'تعذّر تحميل المشتريات');
  const d = (data ?? {}) as Partial<PurchaseReviewData>;
  return {
    today: String(d.today ?? ''),
    from: String(d.from ?? ''),
    lines: (d.lines ?? []).map((l) => ({ ...l, invoices: num(l.invoices), net: num(l.net) })),
    suppliers: (d.suppliers ?? []).map((s) => ({
      ...s,
      code: String(s.code),
      month_start_day: num(s.month_start_day) || 1,
      pay_after_days: num(s.pay_after_days),
      excluded: Boolean(s.excluded),
    })),
    payments: (d.payments ?? []).map((p) => ({ ...p, amount: num(p.amount) })),
    uploads: (d.uploads ?? []).map((u) => ({
      ...u,
      invoices: num(u.invoices),
      net: num(u.net),
      report_net: u.report_net == null ? null : num(u.report_net),
    })),
  };
}

/** Reads an ePlus Excel export in the browser. */
export async function readEPlusFile(file: File): Promise<ParsedReport> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new ReportError('الملف فاضي');
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });
  return parseEPlusPurchases(rows);
}

export interface ImportResult {
  first_day: string;
  last_day: string;
  invoices: number;
  net: number;
  replaced: number;
}

export async function importPurchaseReport(
  report: ParsedReport,
  fileName: string
): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_purchase_review_file_v1', {
    p_store: report.store,
    p_branch: report.branch,
    p_file_name: fileName,
    p_report_net: report.reportNet,
    p_invoices: report.invoices,
  });
  if (error) fail(error, 'تعذّر رفع الملف');
  return data as ImportResult;
}

export async function saveSupplierTerms(terms: {
  code: string;
  month_start_day: number;
  pay_after_days: number;
  excluded: boolean;
  note: string | null;
}) {
  const { error } = await supabase.rpc('save_purchase_supplier_terms_v1', {
    p_code: terms.code,
    p_month_start_day: terms.month_start_day,
    p_pay_after_days: terms.pay_after_days,
    p_excluded: terms.excluded,
    p_note: terms.note,
  });
  if (error) fail(error, 'تعذّر الحفظ');
}

export async function addSupplierPayment(payment: {
  supplier_code: string;
  branch: PurchaseBranch;
  amount: number;
  paid_on: string;
  note: string | null;
}) {
  const { error } = await supabase.rpc('add_purchase_review_payment_v1', {
    p_supplier_code: payment.supplier_code,
    p_branch: payment.branch,
    p_amount: payment.amount,
    p_paid_on: payment.paid_on,
    p_note: payment.note,
  });
  if (error) fail(error, 'تعذّر تسجيل الدفعة');
}

export async function deleteSupplierPayment(id: string) {
  const { error } = await supabase.rpc('delete_purchase_review_payment_v1', { p_id: id });
  if (error) fail(error, 'تعذّر المسح');
}

export interface ReviewInvoice {
  store: string;
  serial: string;
  branch: PurchaseBranch;
  payment: 'credit' | 'cash';
  invoice_at: string;
  supplier_code: string;
  supplier_name: string;
  supplier_invoice_no: string | null;
  items: number;
  gross: number;
  discount: number;
  net: number;
  entered_by: string | null;
  note: string | null;
}

export async function listReviewInvoices(params: {
  from: string;
  to: string;
  supplier_code?: string | null;
  branch?: PurchaseBranch | null;
}): Promise<ReviewInvoice[]> {
  const { data, error } = await supabase.rpc('list_purchase_review_invoices_v1', {
    p_from: params.from,
    p_to: params.to,
    p_supplier_code: params.supplier_code ?? null,
    p_branch: params.branch ?? null,
  });
  if (error) fail(error, 'تعذّر تحميل الفواتير');
  return ((data ?? []) as ReviewInvoice[]).map((r) => ({
    ...r,
    net: num(r.net),
    gross: num(r.gross),
  }));
}
