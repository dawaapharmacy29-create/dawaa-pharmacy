import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type CustomerInvoiceLookup = {
  customerId?: string | number | null;
  customerCode?: string | number | null;
  customerPhone?: string | number | null;
  customerName?: string | null;
};

export type CustomerInvoiceReadRow = Record<string, unknown>;

export type CustomerInvoiceReadResult = {
  rows: CustomerInvoiceReadRow[];
  matchedBy: 'code' | 'customer_id' | 'phone' | 'phone_tail' | 'name' | null;
  source: 'sales_invoices_adapter';
  warnings: string[];
};

const SELECT = [
  'id',
  'invoice_no',
  'invoice_number',
  'invoice_date',
  'sale_date',
  'net_total',
  'net_amount',
  'discounted_amount',
  'amount',
  'gross_total',
  'gross_amount',
  'total_amount',
  'branch',
  'branch_name',
  'seller_name',
  'normalized_seller_name',
  'staff_name',
  'customer_id',
  'customer_code',
  'customer_phone',
  'customer_name',
].join(',');

const MAX_ROWS = 700;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizePhone(value: unknown) {
  let digits = text(value)
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\D/g, '');
  if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && /^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;
  return digits;
}

function phoneTail(value: unknown) {
  const digits = normalizePhone(value);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeName(value: unknown) {
  return text(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function dedupe(rows: CustomerInvoiceReadRow[]) {
  const byKey = new Map<string, CustomerInvoiceReadRow>();
  for (const row of rows) {
    const key = text(row.id) || `${text(row.invoice_number || row.invoice_no)}|${text(row.branch_name || row.branch)}|${text(row.invoice_date || row.sale_date)}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function queryEq(column: string, value: string) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(SELECT)
    .eq(column, value)
    .order('invoice_date', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data || []) as CustomerInvoiceReadRow[];
}

async function queryIlike(column: string, value: string) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(SELECT)
    .ilike(column, value)
    .order('invoice_date', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data || []) as CustomerInvoiceReadRow[];
}

/**
 * Transitional read-model adapter for customer invoice history.
 *
 * Consumers must depend on this boundary rather than querying sales_invoices directly.
 * The adapter is intentionally the only place allowed to know the current transactional schema.
 * It can later be swapped to an RPC/read view without changing customer profile/service consumers.
 *
 * Removal condition: replace `sales_invoices_adapter` with a canonical customer-invoice RPC/read view
 * after parity tests cover code/phone/name matching and full-history counts.
 */
export async function readCustomerInvoices(
  lookup: CustomerInvoiceLookup
): Promise<CustomerInvoiceReadResult> {
  if (!isSupabaseConfigured) {
    return { rows: [], matchedBy: null, source: 'sales_invoices_adapter', warnings: ['Supabase is not configured'] };
  }

  const code = text(lookup.customerCode);
  const customerId = text(lookup.customerId);
  const phone = normalizePhone(lookup.customerPhone);
  const tail = phoneTail(phone);
  const name = text(lookup.customerName).replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
  const warnings: string[] = [];

  const attempts: Array<{ label: CustomerInvoiceReadResult['matchedBy']; run: () => Promise<CustomerInvoiceReadRow[]> }> = [];
  if (code) attempts.push({ label: 'code', run: () => queryEq('customer_code', code) });
  if (customerId && isUuid(customerId)) attempts.push({ label: 'customer_id', run: () => queryEq('customer_id', customerId) });
  if (phone) attempts.push({ label: 'phone', run: () => queryEq('customer_phone', phone) });
  if (tail.length >= 8) attempts.push({ label: 'phone_tail', run: () => queryIlike('customer_phone', `%${tail}`) });
  if (normalizeName(name).length >= 3) attempts.push({ label: 'name', run: () => queryIlike('customer_name', `%${name}%`) });

  for (const attempt of attempts) {
    try {
      let rows = dedupe(await attempt.run());
      if (attempt.label === 'name' && tail.length >= 8) {
        const narrowed = rows.filter((row) => phoneTail(row.customer_phone).endsWith(tail));
        if (narrowed.length) rows = narrowed;
      }
      if (rows.length) return { rows, matchedBy: attempt.label, source: 'sales_invoices_adapter', warnings };
    } catch (error) {
      warnings.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { rows: [], matchedBy: null, source: 'sales_invoices_adapter', warnings };
}
