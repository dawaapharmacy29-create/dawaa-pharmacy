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

export type CustomerInvoiceAggregate = {
  customerCode: string;
  count: number;
  total: number;
  first: string | null;
  last: string | null;
  activeMonths: number;
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
const BATCH_AGGREGATE_PAGE_SIZE = 1000;
const BATCH_AGGREGATE_MAX_ROWS = 10000;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value: unknown) {
  return text(value).slice(0, 10);
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

/**
 * Batch aggregate adapter for customer list metrics.
 * Keeps one batched invoice read for the visible customer codes instead of N per-customer queries.
 * Pagination avoids silently truncating the first 1,000 rows while preserving a hard safety ceiling.
 */
export async function readCustomerInvoiceAggregatesByCodes(
  customerCodes: Array<string | number | null | undefined>
): Promise<Map<string, CustomerInvoiceAggregate>> {
  if (!isSupabaseConfigured) return new Map();

  const codes = [...new Set(customerCodes.map(text).filter(Boolean))];
  if (!codes.length) return new Map();

  const rows: CustomerInvoiceReadRow[] = [];
  for (let offset = 0; offset < BATCH_AGGREGATE_MAX_ROWS; offset += BATCH_AGGREGATE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('id,customer_code,invoice_date,net_amount,discounted_amount,amount,gross_amount')
      .in('customer_code', codes)
      .order('invoice_date', { ascending: false })
      .range(offset, offset + BATCH_AGGREGATE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data || []) as CustomerInvoiceReadRow[];
    rows.push(...page);
    if (page.length < BATCH_AGGREGATE_PAGE_SIZE) break;
  }

  const working = new Map<
    string,
    { count: number; total: number; first: string | null; last: string | null; months: Set<string> }
  >();

  for (const row of dedupe(rows)) {
    const code = text(row.customer_code);
    if (!code) continue;
    const invoiceDate = dateOnly(row.invoice_date);
    const current = working.get(code) || {
      count: 0,
      total: 0,
      first: null,
      last: null,
      months: new Set<string>(),
    };
    current.count += 1;
    current.total += numberValue(row.net_amount ?? row.discounted_amount ?? row.amount ?? row.gross_amount);
    if (invoiceDate) {
      if (!current.first || invoiceDate < current.first) current.first = invoiceDate;
      if (!current.last || invoiceDate > current.last) current.last = invoiceDate;
      current.months.add(invoiceDate.slice(0, 7));
    }
    working.set(code, current);
  }

  return new Map(
    [...working.entries()].map(([customerCode, aggregate]) => [
      customerCode,
      {
        customerCode,
        count: aggregate.count,
        total: aggregate.total,
        first: aggregate.first,
        last: aggregate.last,
        activeMonths: aggregate.months.size,
      },
    ])
  );
}

/**
 * Transitional read-model adapter for customer invoice history.
 *
 * Runtime policy:
 * 1) exact canonical identities (code/id/phone) run in parallel;
 * 2) expensive wildcard phone-tail matching only runs when exact identity found nothing;
 * 3) name matching is the final compatibility fallback only.
 *
 * This preserves legacy recovery without making every normal customer profile pay for wildcard scans.
 * Removal condition: replace `sales_invoices_adapter` with a canonical customer-invoice RPC/read view
 * after parity tests cover identity matching and full-history counts.
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

  const exactAttempts: Array<{
    label: CustomerInvoiceMatch;
    run: () => Promise<CustomerInvoiceReadRow[]>;
  }> = [];
  if (code) exactAttempts.push({ label: 'code', run: () => queryEq('customer_code', code) });
  if (customerId && isUuid(customerId)) {
    exactAttempts.push({ label: 'customer_id', run: () => queryEq('customer_id', customerId) });
  }
  if (phone) exactAttempts.push({ label: 'phone', run: () => queryEq('customer_phone', phone) });

  const matchedStrategies: CustomerInvoiceMatch[] = [];
  const rowsByKey = new Map<string, CustomerInvoiceReadRow>();

  await Promise.all(
    exactAttempts.map(async (attempt) => {
      try {
        const matchedRows = dedupe(await attempt.run());
        if (matchedRows.length) matchedStrategies.push(attempt.label);
        for (const row of matchedRows) rowsByKey.set(invoiceKey(row), row);
      } catch (error) {
        warnings.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  if (!rowsByKey.size && tail.length >= 8) {
    try {
      const matchedRows = dedupe(await queryIlike('customer_phone', `%${tail}`));
      if (matchedRows.length) matchedStrategies.push('phone_tail');
      for (const row of matchedRows) rowsByKey.set(invoiceKey(row), row);
    } catch (error) {
      warnings.push(`phone_tail: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!rowsByKey.size && normalizeName(name).length >= 3) {
    try {
      const matchedRows = dedupe(await queryIlike('customer_name', `%${name}%`));
      if (matchedRows.length) matchedStrategies.push('name');
      for (const row of matchedRows) rowsByKey.set(invoiceKey(row), row);
    } catch (error) {
      warnings.push(`name: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const resultRows = [...rowsByKey.values()].sort((a, b) =>
    text(b.invoice_date || b.sale_date).localeCompare(text(a.invoice_date || a.sale_date))
  );
  const uniqueStrategies = [...new Set(matchedStrategies)];

  return {
    rows: resultRows,
    matchedBy: summarizeMatch(uniqueStrategies),
    matchedStrategies: uniqueStrategies,
    source: 'sales_invoices_adapter',
    warnings,
  };
}
