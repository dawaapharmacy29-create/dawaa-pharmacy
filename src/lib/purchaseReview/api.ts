import { supabase } from '@/lib/supabase';
import {
  parseEPlusPurchases,
  ReportError,
  type ParsedReport,
  type PurchaseBranch,
} from './ePlusReport';
import type { PurchaseReviewData } from './ledger';

// «مراجعة المشتريات» data (migrations 20261114153544, 20261114160410). Top management only.

const ERRORS: Record<string, string> = {
  not_authorized: 'الصفحة دي للمدير العام والتنفيذي بس',
  invalid_store: 'المخزن مش معروف',
  empty_file: 'مفيش فواتير في الملف',
  bad_rows: 'فيه فواتير ناقصة الرقم أو التاريخ أو المورد',
  unknown_supplier: 'المورد مش موجود',
  invalid_payment: 'المبلغ أو التاريخ مش صح',
  invalid_period: 'الفترة مش صح',
  unknown_invoice: 'الفاتورة مش موجودة',
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

// The dashboard shows two cards built from the whole «مراجعة المشتريات» read (the money overview and the
// daily review). They share one read instead of asking the server twice, and reuse it for a few minutes.
const SHARED_TTL_MS = 3 * 60 * 1000;
let shared: { at: number; promise: Promise<PurchaseReviewData> } | null = null;

/** Drops the shared read after anything that changes the purchase review. */
function invalidateSharedPurchaseReview() {
  shared = null;
}

/** The whole purchase review (from = null), shared by the dashboard cards and kept for a few minutes. */
export function loadPurchaseReviewShared(): Promise<PurchaseReviewData> {
  if (shared && Date.now() - shared.at < SHARED_TTL_MS) return shared.promise;
  const promise = loadPurchaseReview(null);
  const entry = { at: Date.now(), promise };
  shared = entry;
  // A failed read is not kept, so the next card or refresh asks again.
  promise.catch(() => {
    if (shared === entry) shared = null;
  });
  return promise;
}

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
      pay_until_days: s.pay_until_days == null ? null : num(s.pay_until_days),
      excluded: Boolean(s.excluded),
    })),
    payments: (d.payments ?? []).map((p) => ({ ...p, amount: num(p.amount), source: 'manual' })),
    track_from: d.track_from ? String(d.track_from) : null,
    treasury: (d.treasury ?? []).map((t) => ({
      ...t,
      id: String(t.id),
      category: String(t.category ?? '').trim(),
      amount: num(t.amount),
      day: String(t.day),
    })),
    links: (d.links ?? []).map((l) => ({
      category: String(l.category),
      supplier_code: l.supplier_code ? String(l.supplier_code) : null,
      ignored: Boolean(l.ignored),
    })),
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
  invalidateSharedPurchaseReview();
  if (error) fail(error, 'تعذّر رفع الملف');
  return data as ImportResult;
}

export async function saveSupplierTerms(terms: {
  code: string;
  month_start_day: number;
  pay_after_days: number;
  pay_until_days: number | null;
  excluded: boolean;
  note: string | null;
}) {
  const { error } = await supabase.rpc('save_purchase_supplier_terms_v2', {
    p_code: terms.code,
    p_month_start_day: terms.month_start_day,
    p_pay_after_days: terms.pay_after_days,
    p_pay_until_days: terms.pay_until_days,
    p_excluded: terms.excluded,
    p_note: terms.note,
  });
  invalidateSharedPurchaseReview();
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
  invalidateSharedPurchaseReview();
  if (error) fail(error, 'تعذّر تسجيل الدفعة');
}

export async function deleteSupplierPayment(id: string) {
  const { error } = await supabase.rpc('delete_purchase_review_payment_v1', { p_id: id });
  invalidateSharedPurchaseReview();
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
  excluded?: boolean;
  excluded_note?: string | null;
}

const invoiceRows = (data: unknown): ReviewInvoice[] =>
  ((data ?? []) as ReviewInvoice[]).map((r) => ({
    ...r,
    net: num(r.net),
    gross: num(r.gross),
    excluded: Boolean(r.excluded),
  }));

/** By our serial, the supplier's invoice number, or the supplier's name or code. */
export async function searchReviewInvoices(query: string): Promise<ReviewInvoice[]> {
  const { data, error } = await supabase.rpc('search_purchase_review_invoices_v1', {
    p_query: query,
  });
  if (error) fail(error, 'تعذّر البحث');
  return invoiceRows(data);
}

/** Takes one invoice out of the debt, or puts it back. */
export async function setInvoiceExcluded(
  invoice: { store: string; serial: string },
  excluded: boolean,
  note: string | null = null
) {
  const { error } = await supabase.rpc('set_purchase_invoice_excluded_v1', {
    p_store: invoice.store,
    p_serial: invoice.serial,
    p_excluded: excluded,
    p_note: note,
  });
  invalidateSharedPurchaseReview();
  if (error) fail(error, 'تعذّر الحفظ');
}

export async function saveTrackFrom(day: string) {
  const { error } = await supabase.rpc('save_purchase_review_track_from_v1', {
    p_track_from: day,
  });
  invalidateSharedPurchaseReview();
  if (error) fail(error, 'تعذّر الحفظ');
}

/** Links a treasury item to a supplier; `ignored` marks it as not a supplier; neither clears it. */
export async function linkTreasuryItem(
  category: string,
  supplierCode: string | null,
  ignored = false
) {
  const { error } = await supabase.rpc('link_purchase_treasury_item_v1', {
    p_category: category,
    p_supplier_code: supplierCode,
    p_ignored: ignored,
  });
  invalidateSharedPurchaseReview();
  if (error) fail(error, 'تعذّر الربط');
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
  return invoiceRows(data);
}

/** One branch of yesterday's purchase invoices as the customer service team reviewed them. */
export interface GmPurchaseDayBranch {
  branch: string;
  invoices: number;
  net: number;
  ok: number;
  fixed: number;
  problem: number;
  pending: number;
  paper_no: number;
  paper_unset: number;
  problems: {
    serial: string;
    supplier: string;
    net: number;
    problems: string[];
    by: string | null;
  }[];
  transfers: number;
  transfer_problems: number;
  last_upload: string | null;
}
export interface GmPurchaseDay {
  day: string;
  branches: GmPurchaseDayBranch[];
}

/** Yesterday's purchase invoices (9 am to 9 am) per branch: reviewed, fixed, with problems, paper serial. */
export async function loadGmPurchaseDay(): Promise<GmPurchaseDay> {
  const { data, error } = await supabase.rpc('dawaa_gm_purchase_day_v1', {});
  if (error) fail(error, 'تعذّر تحميل فواتير امبارح');
  const d = (data ?? {}) as { day?: string; branches?: Array<Record<string, unknown>> };
  return {
    day: String(d.day ?? ''),
    branches: (d.branches ?? []).map((b) => ({
      branch: String(b.branch ?? ''),
      invoices: num(b.invoices),
      net: num(b.net),
      ok: num(b.ok),
      fixed: num(b.fixed),
      problem: num(b.problem),
      pending: num(b.pending),
      paper_no: num(b.paper_no),
      paper_unset: num(b.paper_unset),
      problems: Array.isArray(b.problems) ? (b.problems as GmPurchaseDayBranch['problems']) : [],
      transfers: num(b.transfers),
      transfer_problems: num(b.transfer_problems),
      last_upload: b.last_upload ? String(b.last_upload) : null,
    })),
  };
}
