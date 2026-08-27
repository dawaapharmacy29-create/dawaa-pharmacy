import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  customerIdentityText,
  customerPhoneTail,
  isCustomerIdentityUuid,
  normalizeCustomerIdentityName,
  normalizeEgyptianCustomerPhone,
  sanitizeCustomerIdentityNameForIlike,
} from '@/lib/customers/customerIdentity';

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

function invoiceKey(row: CustomerInvoiceReadRow) {
  return (
    customerIdentityText(row.id) ||
    `${customerIdentityText(row.invoice_number || row.invoice_no)}|${customerIdentityText(row.branch_name || row.branch)}|${customerIdentityText(row.invoice_date || row.sale_date)}`
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
 * Transitional read-model adapter for customer invoice history.
 *
 * Runtime policy:
 * 1) exact canonical identities (code/id/phone) run in parallel;
 * 2) expensive wildcard phone-tail matching only runs when exact identity found nothing;
 * 3) name matching is the final compatibility fallback only.
 *
 * Identity normalization is owned by customers/customerIdentity so this adapter cannot drift
 * from follow-up/profile identity rules while it remains transitional.
 * Removal condition: replace `sales_invoices_adapter` with a canonical customer-invoice RPC/read view
 * after parity tests cover identity matching and full-history counts.
 */
export async function readCustomerInvoices(
  lookup: CustomerInvoiceLookup
): Promise<CustomerInvoiceReadResult> {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');

  const code = customerIdentityText(lookup.customerCode);
  const customerId = customerIdentityText(lookup.customerId);
  const phone = normalizeEgyptianCustomerPhone(lookup.customerPhone);
  const tail = customerPhoneTail(phone);
  const name = sanitizeCustomerIdentityNameForIlike(lookup.customerName);
  const warnings: string[] = [];

  const exactAttempts: Array<{
    label: CustomerInvoiceMatch;
    run: () => Promise<CustomerInvoiceReadRow[]>;
  }> = [];
  if (code) exactAttempts.push({ label: 'code', run: () => queryEq('customer_code', code) });
  if (customerId && isCustomerIdentityUuid(customerId)) {
    exactAttempts.push({ label: 'customer_id', run: () => queryEq('customer_id', customerId) });
  }
  if (phone) exactAttempts.push({ label: 'phone', run: () => queryEq('customer_phone', phone) });

  const matchedStrategies: CustomerInvoiceMatch[] = [];
  const rowsByKey = new Map<string, CustomerInvoiceReadRow>();

  await Promise.all(
    exactAttempts.map(async (attempt) => {
      try {
        const rows = dedupe(await attempt.run());
        if (rows.length) matchedStrategies.push(attempt.label);
        for (const row of rows) rowsByKey.set(invoiceKey(row), row);
      } catch (error) {
        warnings.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  if (!rowsByKey.size && tail.length >= 8) {
    try {
      const rows = dedupe(await queryIlike('customer_phone', `%${tail}`));
      if (rows.length) matchedStrategies.push('phone_tail');
      for (const row of rows) rowsByKey.set(invoiceKey(row), row);
    } catch (error) {
      warnings.push(`phone_tail: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!rowsByKey.size && normalizeCustomerIdentityName(name).length >= 3) {
    try {
      const rows = dedupe(await queryIlike('customer_name', `%${name}%`));
      if (rows.length) matchedStrategies.push('name');
      for (const row of rows) rowsByKey.set(invoiceKey(row), row);
    } catch (error) {
      warnings.push(`name: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const rows = [...rowsByKey.values()].sort((a, b) =>
    customerIdentityText(b.invoice_date || b.sale_date).localeCompare(
      customerIdentityText(a.invoice_date || a.sale_date)
    )
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
