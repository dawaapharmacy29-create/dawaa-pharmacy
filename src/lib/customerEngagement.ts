import { supabase } from '@/lib/supabase';

export type CustomerIdentity = {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
};

export type WelcomeMessageFilters = {
  actor_id?: string | null;
  search?: string | null;
  branch?: string | null;
  status?: string | null;
  doctor?: string | null;
  from?: string | null;
  to?: string | null;
};

export type CustomerPointsLedgerRow = CustomerIdentity & {
  id: string;
  points_amount: number;
  transaction_type: 'credit' | 'debit' | 'correction';
  source_type: string;
  points_reason: string | null;
  related_invoice_number: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
};

export type WelcomeMessageLogRow = CustomerIdentity & {
  id: string;
  followup_id: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  message_body: string;
  channel: string;
  status: string;
  sent_by: string | null;
  sent_by_name: string | null;
  sent_at: string | null;
  notes: string | null;
  created_at: string | null;
};

export const DEFAULT_WELCOME_MESSAGE =
  'أهلا بحضرتك، مع حضرتك صيدليات دواء. بنرحب بحضرتك ونتشرف بخدمتك دائمًا. لو حضرتك محتاج أي استفسار عن دواء أو متابعة طلب، إحنا تحت أمر حضرتك.';

function customerOrFilter(identity: CustomerIdentity) {
  return [
    identity.customer_code ? `customer_code.eq.${identity.customer_code}` : '',
    identity.customer_phone ? `customer_phone.eq.${identity.customer_phone}` : '',
    identity.customer_id ? `customer_id.eq.${identity.customer_id}` : '',
  ]
    .filter(Boolean)
    .join(',');
}

export async function searchCustomerIdentity(query: string): Promise<CustomerIdentity[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('customer_metrics_summary')
    .select('customer_id,customer_code,customer_name,customer_phone,branch')
    .or(`customer_code.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%`)
    .limit(20);
  if (error) throw new Error(error.message);
  return (data || []) as CustomerIdentity[];
}

export async function fetchCustomerPointsLedger(identity: CustomerIdentity) {
  const filter = customerOrFilter(identity);
  if (!filter) return [];
  const { data, error } = await supabase
    .from('customer_points_ledger')
    .select('*')
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data || []) as CustomerPointsLedgerRow[];
}

export function totalCustomerPoints(rows: CustomerPointsLedgerRow[]) {
  return rows.reduce((sum, row) => {
    const amount = Number(row.points_amount || 0);
    if (row.transaction_type === 'debit') return sum - Math.abs(amount);
    if (row.transaction_type === 'correction') return sum + amount;
    return sum + Math.abs(amount);
  }, 0);
}

export async function addCustomerPoints(payload: Partial<CustomerPointsLedgerRow>) {
  if (!payload.customer_name && !payload.customer_phone) {
    throw new Error('اكتب اسم العميل أو رقم الهاتف على الأقل قبل احتساب النقاط.');
  }
  if (!Number(payload.points_amount)) throw new Error('اكتب عدد النقاط.');
  const { data, error } = await supabase.rpc('insert_customer_points_ledger', {
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر احتساب نقاط العميل.');
  return data as CustomerPointsLedgerRow;
}

export async function fetchWelcomeMessageLogs(identity: CustomerIdentity, filters: WelcomeMessageFilters = {}) {
  const { data, error } = await supabase.rpc('fetch_customer_welcome_message_logs', {
    p_actor_id: filters.actor_id || null,
    p_customer_code: identity.customer_code || null,
    p_customer_phone: identity.customer_phone || null,
    p_customer_id: identity.customer_id || null,
    p_search: filters.search || null,
    p_branch: filters.branch || null,
    p_status: filters.status || null,
    p_doctor: filters.doctor || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
  });
  if (error) throw new Error(error.message);
  return (data || []) as WelcomeMessageLogRow[];
}

export async function addWelcomeMessageLog(payload: Partial<WelcomeMessageLogRow>) {
  if (!payload.message_body?.trim()) throw new Error('اكتب نص الرسالة الترحيبية.');
  const { data, error } = await supabase.rpc('insert_customer_welcome_message_log', {
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر تسجيل الرسالة الترحيبية.');
  return data as WelcomeMessageLogRow;
}

export async function updateWelcomeMessageStatus(id: string, status: string, actorId?: string | null, actorName?: string | null) {
  const { data, error } = await supabase.rpc('update_customer_welcome_message_status', {
    p_id: id,
    p_status: status,
    p_actor_id: actorId || null,
    p_actor_name: actorName || null,
  });
  if (error) throw new Error(error.message || 'تعذر تحديث حالة الرسالة.');
  return data as WelcomeMessageLogRow;
}

function normalizeEgyptWhatsappPhone(phone?: string | null) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `2${digits}`;
  if (/^1[0125]\d{8}$/.test(digits)) return `20${digits}`;
  if (digits.startsWith('2')) return digits;
  return digits;
}

export function whatsappWelcomeUrl(phone?: string | null, message = DEFAULT_WELCOME_MESSAGE) {
  const target = normalizeEgyptWhatsappPhone(phone);
  if (!target) return '';
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}
