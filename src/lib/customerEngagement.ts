import { supabase } from '@/lib/supabase';

export type CustomerIdentity = {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
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

export async function fetchWelcomeMessageLogs(identity: CustomerIdentity) {
  const filter = customerOrFilter(identity);
  let query = supabase
    .from('customer_welcome_message_logs')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(100);
  if (filter) query = query.or(filter);
  const { data, error } = await query;
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

export function whatsappWelcomeUrl(phone?: string | null, message = DEFAULT_WELCOME_MESSAGE) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  const target = cleaned ? `2${cleaned.replace(/^2/, '')}` : '';
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}
