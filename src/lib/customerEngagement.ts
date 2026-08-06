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
  calculation_mode?: 'manual' | 'automatic' | null;
  purchase_total?: number | null;
  reward_rate?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  invoice_count?: number | null;
  cycle_key?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CustomerLoyaltySetting = CustomerIdentity & {
  id: string;
  reward_rate: number;
  cycle_months: number;
  calculation_mode: 'automatic' | 'manual';
  cycle_start_date: string;
  last_calculated_at: string | null;
  last_period_start: string | null;
  last_period_end: string | null;
  next_due_date: string;
  active: boolean;
  created_by: string | null;
  created_by_name: string | null;
};

export type CustomerInvoicePeriodSummary = {
  purchase_total: number;
  invoice_count: number;
  period_start: string;
  period_end: string;
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

  // أول حاجة: تطابق تام بالكود أو الهاتف أو الاسم. ده أهم من أي بحث جزئي، لأن مفيش
  // ضمانة ترتيب في نتائج ILIKE مع limit — لو أكتر من 20 عميل مشتركين في نفس الأرقام
  // كجزء من كود أطول (زي 850 جوه 10850 و11850 و8502...)، العميل اللي كوده مطابق
  // تمامًا ممكن ميظهرش أصلًا ضمن أول 20 نتيجة عشوائية. التطابق التام بيضمن إنه يتلقى
  // دايمًا، أيًا كان عدد التطابقات الجزئية التانية.
  const exactResult = await supabase
    .from('customer_metrics_summary')
    .select('customer_id,customer_code,customer_name,customer_phone,branch')
    .or(`customer_code.eq.${q},customer_phone.eq.${q},customer_name.eq.${q}`)
    .limit(20);
  if (exactResult.error) throw new Error(exactResult.error.message);
  if (exactResult.data && exactResult.data.length) return exactResult.data as CustomerIdentity[];

  const { data, error } = await supabase
    .from('customer_metrics_summary')
    .select('customer_id,customer_code,customer_name,customer_phone,branch')
    .or(`customer_code.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%`)
    .order('customer_code', { ascending: true })
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
    .limit(200);
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
  if (!payload.customer_name && !payload.customer_phone) throw new Error('اكتب اسم العميل أو رقم الهاتف على الأقل قبل احتساب النقاط.');
  if (!Number(payload.points_amount)) throw new Error('اكتب عدد النقاط.');
  const { data, error } = await supabase.rpc('insert_customer_points_ledger', { p_payload: payload });
  if (error) throw new Error(error.message || 'تعذر احتساب نقاط العميل.');
  return data as CustomerPointsLedgerRow;
}

export async function fetchCustomerLoyaltySetting(identity: CustomerIdentity) {
  const filter = customerOrFilter(identity);
  if (!filter) return null;
  const { data, error } = await supabase
    .from('customer_loyalty_settings')
    .select('*')
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CustomerLoyaltySetting | null;
}

export async function saveCustomerLoyaltySetting(payload: Partial<CustomerLoyaltySetting> & { created_by?: string | null; created_by_name?: string | null }) {
  const { data, error } = await supabase.rpc('upsert_customer_loyalty_setting', { p_payload: payload });
  if (error) throw new Error(error.message || 'تعذر حفظ إعداد نقاط العميل.');
  return data as CustomerLoyaltySetting;
}

export async function previewCustomerInvoicePeriod(identity: CustomerIdentity, periodStart: string, periodEnd: string) {
  const { data, error } = await supabase.rpc('customer_invoice_period_summary', {
    p_customer_code: identity.customer_code || null,
    p_customer_phone: identity.customer_phone || null,
    p_customer_id: identity.customer_id || null,
    p_branch: identity.branch || null,
    p_from: periodStart,
    p_to: periodEnd,
  });
  if (error) throw new Error(error.message || 'تعذر حساب مشتريات العميل للفترة.');
  return data as CustomerInvoicePeriodSummary;
}

export async function calculateCustomerLoyaltyCycle(input: {
  settingId: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  manualPurchaseTotal?: number | null;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const { data, error } = await supabase.rpc('calculate_customer_loyalty_cycle', {
    p_setting_id: input.settingId,
    p_period_start: input.periodStart || null,
    p_period_end: input.periodEnd || null,
    p_manual_purchase_total: input.manualPurchaseTotal ?? null,
    p_actor_id: input.actorId || null,
    p_actor_name: input.actorName || null,
  });
  if (error) throw new Error(error.message || 'تعذر احتساب دورة نقاط العميل.');
  return data as CustomerPointsLedgerRow;
}

export async function runDueCustomerLoyaltyCycles(actorId?: string | null, actorName?: string | null) {
  const { data, error } = await supabase.rpc('run_due_customer_loyalty_cycles', {
    p_actor_id: actorId || null,
    p_actor_name: actorName || 'النظام',
  });
  if (error) throw new Error(error.message || 'تعذر تشغيل الاستحقاقات التلقائية.');
  return data as { calculated: number; errors: number };
}

export type CashbackQuarterBounds = { period_start: string; period_end: string; quarter_label: string };
export async function fetchCashbackQuarterBounds(): Promise<CashbackQuarterBounds | null> {
  const { data, error } = await supabase.rpc('get_cashback_quarter_bounds');
  if (error) return null;
  return (data as CashbackQuarterBounds[] | null)?.[0] || null;
}

export type CustomerWithPendingPoints = {
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  total_points: number;
  last_earned_at: string;
  fully_contacted: boolean;
  uncontacted_count: number;
};
export async function fetchCustomersWithPendingPoints(branch: string): Promise<CustomerWithPendingPoints[]> {
  const { data, error } = await supabase.rpc('get_customers_with_points_for_followup', { p_branch: branch });
  if (error) throw new Error(error.message || 'تعذر تحميل قائمة العملاء.');
  // الدالة بترجع {total_customers, rows} من بعد migration raise_points_followup_limit_add_total_count
  // (مش مصفوفة مباشرة زي ما كانت قبل كده) — لازم نفك التغليف هنا.
  const payload = data as { total_customers?: number; rows?: CustomerWithPendingPoints[] } | CustomerWithPendingPoints[] | null;
  if (Array.isArray(payload)) return payload; // توافق رجعي لو الدالة رجعت لشكلها القديم يومًا
  return payload?.rows || [];
}

export async function markCustomerPointsContacted(customerCode: string, branch: string, actorName?: string | null) {
  const { error } = await supabase.rpc('mark_customer_points_contacted', {
    p_customer_code: customerCode, p_branch: branch, p_actor_name: actorName || 'غير محدد',
  });
  if (error) throw new Error(error.message || 'تعذر تسجيل التواصل.');
}

export async function runQuarterlyCashbackBatch(actorName?: string | null) {
  const { data, error } = await supabase.rpc('run_quarterly_cashback_batch', {
    p_period_start: null, p_period_end: null, p_reward_rate: 0.05, p_actor_name: actorName || 'يدوي من الصفحة',
  });
  if (error) throw new Error(error.message || 'تعذر تشغيل الاحتساب الربع سنوي.');
  return data as { period_start: string; period_end: string; customers_credited: number; total_points: number };
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
  const { data, error } = await supabase.rpc('insert_customer_welcome_message_log', { p_payload: payload });
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
