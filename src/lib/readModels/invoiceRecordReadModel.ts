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
  column: 'customer_id' | 'customer_phone' | 'whatsapp_phone';
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
