import { supabase } from '@/lib/supabase';

type Row = Record<string, unknown>;

export type CustomerInvoiceHistoryIdentity = {
  customerCode?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
};

function sanitizeIlike(value: string) {
  return value.replace(/[,%.]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[%_]/g, '');
}

function normalizePhone(value: unknown) {
  return String(value || '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^\d]/g, '')
    .replace(/^0020/, '0')
    .replace(/^20(?=1\d{9}$)/, '0');
}

function withAbort<T>(query: T, signal?: AbortSignal): T {
  const maybe = query as any;
  if (signal && maybe && typeof maybe.abortSignal === 'function') return maybe.abortSignal(signal);
  return query;
}

export async function fetchCustomerInvoiceHistory(
  identity: CustomerInvoiceHistoryIdentity,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<Row[]> {
  const code = String(identity.customerCode || '').trim();
  const phone = normalizePhone(identity.customerPhone);
  const phoneTail = phone.length >= 10 ? phone.slice(-10) : '';
  const name = sanitizeIlike(String(identity.customerName || ''));
  const limit = Math.min(Math.max(options.limit || 2000, 1), 2000);

  let query = supabase
    .from('dawaa_customer_invoice_stats_view')
    .select(
      'id,invoice_key,invoice_no,invoice_number,invoice_date,sale_date,date,amount,seller_name,branch,customer_code,customer_name,customer_phone,phone'
    );

  // Customer code is the strongest operational identity. Do not broaden a coded
  // customer to phone/name matches, which can accidentally merge family/shared data.
  if (code) {
    query = query.eq('customer_code', code);
  } else {
    const clauses = [
      phone ? `customer_phone.eq.${phone}` : '',
      phone ? `phone.eq.${phone}` : '',
      phoneTail ? `customer_phone.ilike.%${phoneTail}%` : '',
      phoneTail ? `phone.ilike.%${phoneTail}%` : '',
      name.length >= 3 ? `customer_name.ilike.%${name}%` : '',
    ].filter(Boolean);
    if (!clauses.length) return [];
    query = query.or(clauses.join(','));
  }

  const { data, error } = await withAbort(
    query.order('invoice_date', { ascending: false }).limit(limit),
    options.signal
  );
  if (error) throw error;

  const byKey = new Map<string, Row>();
  for (const row of (data || []) as Row[]) {
    const key = String(row.id || row.invoice_key || `${row.invoice_number || row.invoice_no || ''}:${row.invoice_date || ''}`);
    if (key) byKey.set(key, row);
  }
  return [...byKey.values()];
}
