import { supabase } from '@/lib/supabase';

export type CustomerSearchResult = {
  id: string;
  name: string;
  code: string;
  phone: string;
  branch: string;
  category: string;
};

const CUSTOMER_SEARCH_FIELDS = 'id,name,phone,customer_code,branch,segment,status';

export function normalizePhone(value: unknown) {
  const digits = String(value ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+20')) return `0${digits.slice(3)}`;
  if (digits.startsWith('20') && digits.length === 12) return `0${digits.slice(2)}`;
  return digits;
}

export function normalizeArabicText(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function wildcardToIlikePattern(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '%';
  return trimmed.includes('*') ? trimmed.replace(/\*/g, '%') : `%${trimmed}%`;
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanCustomerCode(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text || UUID_LIKE_RE.test(text)) return '';
  return text;
}

export function normalizeCustomerRow(row: Record<string, unknown>): CustomerSearchResult {
  return {
    id: pick(row, ['id', 'customer_id']),
    name: pick(row, ['name', 'customer_name', 'full_name']) || 'عميل بدون اسم',
    code: cleanCustomerCode(pick(row, ['customer_code', 'code'])),
    phone: pick(row, ['phone', 'customer_phone', 'mobile']),
    branch: pick(row, ['branch', 'branch_name']),
    category: pick(row, ['segment', 'status', 'category', 'customer_category']),
  };
}

export async function searchCustomers(query: string, limit = 30): Promise<CustomerSearchResult[]> {
  const raw = query.trim();
  if (!raw) return [];
  const pattern = wildcardToIlikePattern(raw);
  const phone = normalizePhone(raw);

  // customers now has one canonical search schema. Using it directly avoids several
  // sequential failed requests against legacy aliases on every keystroke.
  if (!raw.includes('*')) {
    const exactFilter = `name.eq.${raw},customer_code.eq.${raw},phone.eq.${phone}`;
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_SEARCH_FIELDS)
      .or(exactFilter)
      .limit(limit);
    if (!error && data?.length) return data.filter(Boolean).map((row) => normalizeCustomerRow(row as Record<string, unknown>));
  }

  const substringFilter = `name.ilike.${pattern},customer_code.ilike.${pattern},phone.ilike.%${phone}%`;
  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_SEARCH_FIELDS)
    .or(substringFilter)
    .order('customer_code', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (!error) return (data || []).filter(Boolean).map((row) => normalizeCustomerRow(row as Record<string, unknown>));

  // Last-resort compatibility fallback stays bounded and only selects fields needed by the UI.
  const fallback = await supabase.from('customers').select(CUSTOMER_SEARCH_FIELDS).limit(250);
  const normalizedQuery = normalizeArabicText(raw.replace(/\*/g, ''));
  return ((fallback.data || []) as Record<string, unknown>[])
    .filter(Boolean)
    .map(normalizeCustomerRow)
    .filter((customer) => {
      const text = normalizeArabicText(`${customer.name} ${customer.code} ${customer.phone}`);
      return text.includes(normalizedQuery) || normalizePhone(customer.phone).includes(phone);
    })
    .slice(0, limit);
}

export async function createCustomerFromSearch(input: {
  name: string;
  phone: string;
  code?: string;
  branch?: string;
}) {
  const payload = {
    customer_name: input.name.trim(),
    name: input.name.trim(),
    customer_phone: normalizePhone(input.phone),
    phone: normalizePhone(input.phone),
    customer_code: input.code?.trim() || null,
    code: input.code?.trim() || null,
    branch: input.branch?.trim() || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let next: Record<string, unknown> = payload;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from('customers').insert(next).select(CUSTOMER_SEARCH_FIELDS).single();
    if (!error && data) return normalizeCustomerRow(data as Record<string, unknown>);
    const column =
      error?.message.match(/column "([^"]+)"/)?.[1] ||
      error?.message.match(/'([^']+)' column/)?.[1];
    if (!column || !(column in next)) throw new Error(error?.message || 'تعذر إضافة العميل');
    next = { ...next };
    delete next[column];
  }
  throw new Error('تعذر إضافة العميل');
}