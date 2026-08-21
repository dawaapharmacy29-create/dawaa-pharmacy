import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type CustomerInvoiceLookup = {
  customerId?: string | number | null;
  customerCode?: string | number | null;
  customerPhone?: string | number | null;
  customerName?: string | null;
};

export type CustomerInvoiceReadRow = Record<string, unknown>;

export type CustomerInvoiceMatch = 'code' | 'customer_id' | 'phone' | 'phone_tail' | 'name';

export type CustomerInvoiceReadResult = {
  rows: CustomerInvoiceReadRow[];
  matchedBy: CustomerInvoiceMatch | 'mixed' | null;
  matchedStrategies: CustomerInvoiceMatch[];
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

const MAX_ROWS_PER_STRATEGY = 1200;

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

function invoiceKey(row: CustomerInvoiceReadRow) {
  return (
    text(row.id) ||
    `${text(row.invoice_number || row.invoice_no)}|${text(row.branch_name || row.branch)}|${text(row.invoice_date || row.sale_date)}`
  );
}

function dedupe(rows: CustomerInvoiceReadRow[]) {
  const byKey = new Map<string, CustomerInvoiceReadRow>();
  for (const row of rows) byKey.set(invoiceKey(row), row);
  return [...byKey.values()];
}

async function queryEq(column: string, value: string) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(SELECT)
    .eq(column, value)
    .order('invoice_date', { ascending: false })
    .limit(MAX_ROWS_PER_STRATEGY);
  if (error) throw error;
  return (data || []) as CustomerInvoiceReadRow[];
}

async function queryIlike(column: string, value: string) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select(SELECT)
    .ilike(column, value)
    .order('invoice_date', { ascending: false })
    .limit(MAX_ROWS_PER_STRATEGY);
  if (error) throw error;
  return (data || []) as CustomerInvoiceReadRow[];
}

function summarizeMatch(strategies: CustomerInvoiceMatch[]): CustomerInvoiceReadResult['matchedBy'] {
  const unique = [...new Set(strategies)];
  if (!unique.length) return null;
  return unique.length === 1 ? unique[0] : 'mixed';
}

function nameRowsBelongToIdentity(
  rows: CustomerInvoiceReadRow[],
  lookup: { code: string; customerId: string; phone: string; tail: string }
) {
  return rows.filter((row) => {
    const rowCode = text(row.customer_code);
    if (lookup.code && rowCode) return rowCode === lookup.code;

    const rowId = text(row.customer_id);
    if (lookup.customerId && rowId) return rowId === lookup.customerId;

    const rowPhone = normalizePhone(row.customer_phone);
    if (lookup.phone && rowPhone) return rowPhone === lookup.phone;
    if (lookup.tail.length >= 8 && rowPhone) return phoneTail(rowPhone) === lookup.tail;

    return !lookup.code && !lookup.customerId && !lookup.phone;
  });
}

/**
 * Transitional read-model adapter for customer invoice history.
 *
 * Consumers depend on this boundary rather than querying sales_invoices directly. Strong identity
 * strategies are combined so legacy rows linked by different identifiers do not silently disappear.
 * Name-only matching is used only when strong identifiers are unavailable, or to add rows that can
 * be independently verified against one of those identifiers.
 *
 * Removal condition: replace `sales_invoices_adapter` with a canonical customer-invoice RPC/read view
 * after parity tests cover code/phone/name matching and full-history counts.
 */
export async function readCustomerInvoices(
  lookup: CustomerInvoiceLookup
): Promise<CustomerInvoiceReadResult> {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');

  const code = text(lookup.customerCode);
  const customerId = text(lookup.customerId);
  const phone = normalizePhone(lookup.customerPhone);
  const tail = phoneTail(phone);
  const name = text(lookup.customerName).replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
  const warnings: string[] = [];

  const strongAttempts: Array<{
    label: CustomerInvoiceMatch;
    run: () => Promise<CustomerInvoiceReadRow[]>;
  }> = [];
  if (code) strongAttempts.push({ label: 'code', run: () => queryEq('customer_code', code) });
  if (customerId && isUuid(customerId)) {
    strongAttempts.push({ label: 'customer_id', run: () => queryEq('customer_id', customerId) });
  }
  if (phone) strongAttempts.push({ label: 'phone', run: () => queryEq('customer_phone', phone) });
  if (tail.length >= 8) {
    strongAttempts.push({ label: 'phone_tail', run: () => queryIlike('customer_phone', `%${tail}`) });
  }

  const matchedStrategies: CustomerInvoiceMatch[] = [];
  const rowsByKey = new Map<string, CustomerInvoiceReadRow>();

  await Promise.all(
    strongAttempts.map(async (attempt) => {
      try {
        const rows = dedupe(await attempt.run());
        if (rows.length) matchedStrategies.push(attempt.label);
        for (const row of rows) rowsByKey.set(invoiceKey(row), row);
      } catch (error) {
        warnings.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  if (normalizeName(name).length >= 3) {
    try {
      const rawNameRows = dedupe(await queryIlike('customer_name', `%${name}%`));
      const verifiedNameRows = nameRowsBelongToIdentity(rawNameRows, { code, customerId, phone, tail });
      if (verifiedNameRows.length) matchedStrategies.push('name');
      for (const row of verifiedNameRows) rowsByKey.set(invoiceKey(row), row);
    } catch (error) {
      warnings.push(`name: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const rows = [...rowsByKey.values()].sort((a, b) =>
    text(b.invoice_date || b.sale_date).localeCompare(text(a.invoice_date || a.sale_date))
  );
  const uniqueStrategies = [...new Set(matchedStrategies)];

  return {
    rows,
    matchedBy: summarizeMatch(uniqueStrategies),
    matchedStrategies: uniqueStrategies,
    source: 'sales_invoices_adapter',
    warnings,
  };
}
