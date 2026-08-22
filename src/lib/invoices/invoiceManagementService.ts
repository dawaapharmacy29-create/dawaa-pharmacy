import { supabase } from '@/lib/supabase';

export interface ManagedInvoiceRecord {
  id: string;
  import_batch: string | null;
  branch: string | null;
  invoice_no: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_type: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number | null;
  net_amount: number | null;
  discounted_amount?: number | null;
  gross_amount: number | null;
  seller_name: string | null;
}

export interface InvoiceDuplicateAuditRow {
  invoice_number: string;
  branch: string;
  sale_date: string;
  count: number;
  latest_created_at: string | null;
}

export interface InvoiceManagementSummary {
  totalInvoices: number;
  totalSales: number;
  latestUpdatedAt: string | null;
  latestBatchStatus: string | null;
  branchRows: Array<{ branch_name: string; invoices_count: number; net_total: number; updated_at: string | null }>;
  dailyRows: Array<{ summary_date: string; invoices_count: number; net_total: number; updated_at: string | null }>;
}

export interface OtherBranchInvoiceRange {
  branch: string | null;
  min_invoice: number | string | null;
  max_invoice: number | string | null;
  invoice_count: number | string | null;
}

export interface ManagedInvoiceUpdatePayload {
  branch: string;
  invoice_no: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  seller_name: string;
  amount: number;
  net_amount: number;
  gross_amount: number;
}

function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function listManagedInvoices(options: {
  sellerName?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
} = {}) {
  let query = supabase
    .from('sales_invoices')
    .select('id,import_batch,branch,invoice_no,invoice_number,invoice_date,invoice_type,customer_code,customer_name,customer_phone,amount,net_amount,discounted_amount,gross_amount,seller_name')
    .order('invoice_date', { ascending: false })
    .limit(Math.min(Math.max(options.limit || 200, 1), 1000));

  if (options.sellerName) query = query.ilike('seller_name', `%${options.sellerName}%`);
  if (options.fromDate) query = query.gte('invoice_date', options.fromDate);
  if (options.toDate) query = query.lt('invoice_date', dayAfter(options.toDate));

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as ManagedInvoiceRecord[];
}

export async function getInvoiceManagementSummary(limit = 5000): Promise<InvoiceManagementSummary> {
  const { data, error } = await supabase.rpc('get_invoice_management_summary_v1', {
    p_limit: Math.min(Math.max(limit, 1), 10000),
  });
  if (error) throw new Error(error.message);
  const snapshot = (data || {}) as Partial<InvoiceManagementSummary>;
  return {
    totalInvoices: Number(snapshot.totalInvoices || 0),
    totalSales: Number(snapshot.totalSales || 0),
    latestUpdatedAt: snapshot.latestUpdatedAt || null,
    latestBatchStatus: snapshot.latestBatchStatus || null,
    branchRows: snapshot.branchRows || [],
    dailyRows: snapshot.dailyRows || [],
  };
}

export async function getInvoiceDuplicateAudit(limit = 3000): Promise<InvoiceDuplicateAuditRow[]> {
  const { data, error } = await supabase.rpc('get_invoice_duplicate_audit_v1', {
    p_limit: Math.min(Math.max(limit, 1), 5000),
  });
  if (error) throw new Error(error.message);
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    invoice_number: String(row.invoice_number || ''),
    branch: String(row.branch || 'غير محدد'),
    sale_date: String(row.sale_date || '').slice(0, 10),
    count: Number(row.count || 0),
    latest_created_at: row.latest_created_at ? String(row.latest_created_at) : null,
  }));
}

export async function getOtherBranchInvoiceNumberRanges(selectedBranch: string) {
  const { data, error } = await supabase.rpc('get_other_branch_invoice_number_ranges_v1', {
    p_selected_branch: selectedBranch,
  });
  if (error) throw new Error(error.message);
  return (data || []) as OtherBranchInvoiceRange[];
}

export async function deleteInvoiceBatchRows(
  batch: string,
  options: { chunkSize?: number; onProgress?: (deleted: number, total: number) => void } = {}
) {
  const idQuery = supabase.from('sales_invoices').select('id');
  const { data: idRows, error: idError } =
    batch === 'بدون رقم دفعة'
      ? await idQuery.is('import_batch', null)
      : await idQuery.eq('import_batch', batch);
  if (idError) throw new Error(idError.message);

  const ids = (idRows || []).map((row) => row.id).filter(Boolean);
  const chunkSize = Math.min(Math.max(options.chunkSize || 150, 25), 500);
  let deletedCount = 0;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const { error } = await supabase.from('sales_invoices').delete().in('id', chunk);
    if (error) {
      const failure = new Error(error.message) as Error & { deletedCount?: number; total?: number };
      failure.deletedCount = deletedCount;
      failure.total = ids.length;
      throw failure;
    }
    deletedCount += chunk.length;
    options.onProgress?.(deletedCount, ids.length);
  }
  return { deletedCount, total: ids.length };
}

export async function cleanupCustomerAnalysisByIdentifiers(identifiers: string[]) {
  if (!identifiers.length) return;
  const { error } = await supabase.from('customer_analysis').delete().in('customer_code', identifiers);
  if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
}

async function deleteTableRowsInChunks(table: 'sales_invoices' | 'customer_analysis', batchSize = 400) {
  let deleted = 0;
  for (let round = 0; round < 1000; round += 1) {
    const { data, error: selectError } = await supabase.from(table).select('id').limit(batchSize);
    if (selectError) {
      if (/does not exist|schema cache/i.test(selectError.message)) return deleted;
      throw new Error(selectError.message);
    }
    const ids = (data || []).map((row) => row.id).filter(Boolean);
    if (!ids.length) return deleted;
    const { error: deleteError } = await supabase.from(table).delete().in('id', ids);
    if (deleteError) throw new Error(deleteError.message);
    deleted += ids.length;
    if (ids.length < batchSize) return deleted;
  }
  return deleted;
}

export async function deleteAllInvoiceManagementData() {
  const deletedInvoices = await deleteTableRowsInChunks('sales_invoices');
  await deleteTableRowsInChunks('customer_analysis');
  return deletedInvoices;
}

export async function updateManagedInvoice(id: string, payload: ManagedInvoiceUpdatePayload) {
  const { error } = await supabase.from('sales_invoices').update(payload).eq('id', id);
  if (error) throw new Error(error.message);
}
