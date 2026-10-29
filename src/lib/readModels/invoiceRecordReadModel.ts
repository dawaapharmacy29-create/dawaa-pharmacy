import { supabase } from '@/lib/supabase';

export type InvoiceRecordReadRow = Record<string, unknown> & {
  id: string;
  customer_code?: string | null;
  customer_phone?: string | null;
  amount?: number | null;
};

type SupabaseLike = any;

const SALES_INTELLIGENCE_INVOICE_SELECT = [
  'id',
  'invoice_number',
  'invoice_no',
  'invoice_datetime',
  'close_datetime',
  'invoice_date',
  'sale_date',
  'net_total',
  'total_amount',
  'net_amount',
  'amount',
  'gross_amount',
  'discount_amount',
  'branch',
  'branch_name',
  'customer_id',
  'customer_code',
  'customer_phone',
  'whatsapp_phone',
  'customer_name',
  'seller_name',
  'normalized_seller_name',
  'staff_id',
  'staff_name',
  'delivery_staff',
].join(',');

export async function readInvoiceRecordById(
  invoiceId: string,
  client: SupabaseLike = supabase
): Promise<InvoiceRecordReadRow | null> {
  const { data, error } = await client
    .from('sales_invoices')
    .select(SALES_INTELLIGENCE_INVOICE_SELECT)
    .eq('id', invoiceId)
    .maybeSingle();

  if (error) throw error;
  return (data as InvoiceRecordReadRow | null) ?? null;
}

export async function readInvoiceRecordsByIds(
  invoiceIds: string[],
  client: SupabaseLike = supabase
): Promise<InvoiceRecordReadRow[]> {
  const ids = [...new Set(invoiceIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await client
    .from('sales_invoices')
    .select(SALES_INTELLIGENCE_INVOICE_SELECT)
    .in('id', ids);
  if (error) throw error;
  return (data || []) as InvoiceRecordReadRow[];
}

export async function readInvoiceRecordsByInvoiceNumbers(
  invoiceNumbers: string[],
  client: SupabaseLike = supabase
): Promise<InvoiceRecordReadRow[]> {
  const numbers = [...new Set(invoiceNumbers.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!numbers.length) return [];

  const rowsById = new Map<string, InvoiceRecordReadRow>();
  for (const field of ['invoice_number', 'invoice_no'] as const) {
    const { data, error } = await client
      .from('sales_invoices')
      .select(SALES_INTELLIGENCE_INVOICE_SELECT)
      .in(field, numbers)
      .limit(5000);
    if (error) throw error;
    for (const row of (data || []) as InvoiceRecordReadRow[]) {
      const id = String(row.id || '').trim();
      if (id) rowsById.set(id, row);
    }
  }
  return [...rowsById.values()];
}

export async function readInvoiceRecordsByIdentityWindow(args: {
  column: 'customer_code' | 'customer_id' | 'customer_phone' | 'whatsapp_phone';
  value: string;
  windowStartIso: string;
  windowEndIso: string;
  limit: number;
  client?: SupabaseLike;
}): Promise<InvoiceRecordReadRow[]> {
  const client = args.client || supabase;
  const { data, error } = await client
    .from('sales_invoices')
    .select(SALES_INTELLIGENCE_INVOICE_SELECT)
    .gte('invoice_datetime', args.windowStartIso)
    .lte('invoice_datetime', args.windowEndIso)
    .eq(args.column, args.value)
    .limit(args.limit);
  if (error) throw error;
  return (data || []) as InvoiceRecordReadRow[];
}

export async function readInvoiceRecordsByCustomerWindow(args: {
  queryStartIso: string;
  queryEndIso: string;
  customerCode?: string | null;
  customerId?: string | null;
  branch?: string | null;
  limit?: number;
  client?: SupabaseLike;
}): Promise<InvoiceRecordReadRow[]> {
  const client = args.client || supabase;
  let query = client
    .from('sales_invoices')
    .select(SALES_INTELLIGENCE_INVOICE_SELECT)
    .gte('invoice_datetime', args.queryStartIso)
    .lte('invoice_datetime', args.queryEndIso)
    .limit(args.limit ?? 100);

  if (args.customerCode) query = query.eq('customer_code', args.customerCode);
  else if (args.customerId) query = query.eq('customer_id', args.customerId);
  else return [];

  if (args.branch) query = query.eq('branch', args.branch);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as InvoiceRecordReadRow[];
}

/** Approved read boundary: internal-code ledger is a finance report, not target-eligible sales. */
export async function readInternalCodeLedgerPage(codes: string[], fromIso: string, toIso: string, branch: string, offset: number, pageSize: number) {
 let query=supabase.from('sales_invoices').select('id,invoice_number,invoice_date,customer_code,branch,customer_name,net_amount,net_total,amount,seller_name').in('customer_code',codes).gte('invoice_date',fromIso).lt('invoice_date',toIso).order('invoice_date',{ascending:true}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
 if(branch!=='all') query=query.eq('branch',branch);
 const result=await query;
 if(result.error)throw new Error(result.error.message);
 return result.data || [];
}

export type StaffCycleSaleRow = { id: string; invoice_date: string | null; sale_date: string | null; net_amount: number | null; total_amount: number | null };

/**
 * Approved read boundary: the invoices credited to one employee (staff_id) in a cycle window,
 * ordered by the (staff_id, invoice_date) index. Bounded: throws instead of returning a partial cycle.
 */
export async function readStaffCycleSales(staffId: string, fromIso: string, toIso: string, maxRows = 5000): Promise<StaffCycleSaleRow[]> {
  const pageSize = 1000;
  const rows: StaffCycleSaleRow[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('id,invoice_date,sale_date,net_amount,total_amount')
      .eq('staff_id', staffId)
      .gte('invoice_date', fromIso)
      .lt('invoice_date', toIso)
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as StaffCycleSaleRow[]));
    if ((data || []).length < pageSize) return rows;
  }
  throw new Error('staff_cycle_sales_limit_reached');
}
