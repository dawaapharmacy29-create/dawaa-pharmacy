import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { DailyFollowup } from '@/types/database';
import { cleanEgyptianPhone } from '@/lib/whatsapp';
import { generateTodayFollowupsFromCustomerMetrics } from '@/lib/api/customerServiceCommandCenter';
import {
  buildCustomerIdentity,
  getFollowupDataIssues,
  isFinalFollowupStatus,
  isValidEgyptianMobile,
  normalizeEgyptianPhone,
  resolveRequestedBy,
} from '@/lib/customerFollowupGuards';

type DailyFollowupInsert = Partial<Omit<DailyFollowup, 'id' | 'created_at' | 'updated_at'>>;
type DailyFollowupUpdate = Partial<DailyFollowup>;
type FollowupRow = DailyFollowup & Record<string, unknown>;

export const DAILY_FOLLOWUP_QUOTAS = {
  important: 10,
  medium: 10,
  threatened: 15,
  stopped: 10,
} as const;

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');
}

function startOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

function isSmartFollowup(row: DailyFollowup) {
  const notes = row.notes || '';
  return notes.includes('قائمة يومية ذكية') || /daily|smart/i.test(notes);
}

function cleanCustomerCode(value: unknown) {
  const code = String(value ?? '').trim();
  if (!code || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code))
    return '';
  return code;
}

function phoneKey(value?: string | null) {
  return normalizeEgyptianPhone(value || cleanEgyptianPhone(value || ''));
}

function enrichLocalGuards(row: DailyFollowup): DailyFollowup {
  const record = row as FollowupRow;
  const phone = normalizeEgyptianPhone(String(record.customer_phone || record.phone || ''));
  const requestedBy = resolveRequestedBy(record);
  const issues = getFollowupDataIssues({
    customerId: String(record.customer_id || ''),
    customerCode: String(record.customer_code || ''),
    customerName: String(record.customer_name || record.name || ''),
    phone,
    branch: String(record.branch || ''),
    requestedBy,
    reason: String(record.followup_reason || record.notes || ''),
    status: String(record.status || record.followup_status || ''),
    result: String(record.followup_result || record.contact_result || ''),
    nextFollowupDate: String(record.next_followup_date || ''),
    completedAt: String(record.completed_at || ''),
  });
  return {
    ...row,
    customer_phone: phone || row.customer_phone,
    phone: phone || row.phone,
    ...(record.identity_key
      ? {}
      : {
          identity_key: buildCustomerIdentity({
            customerId: String(record.customer_id || ''),
            customerCode: String(record.customer_code || ''),
            phone,
            name: String(record.customer_name || record.name || ''),
          }),
        }),
    data_issues: Array.isArray(record.data_issues) && record.data_issues.length ? record.data_issues : issues,
    data_quality_status:
      String(record.data_quality_status || '') || (issues.length ? 'warning' : 'complete'),
    requested_by_name: String(record.requested_by_name || requestedBy),
  } as DailyFollowup;
}

async function insertFollowupRecords(records: Array<Record<string, unknown>>) {
  const guarded: Array<Record<string, unknown>> = records.map((record) => {
    const phone = normalizeEgyptianPhone(String(record.customer_phone || record.phone || ''));
    const identityKey = buildCustomerIdentity({
      customerId: String(record.customer_id || ''),
      customerCode: String(record.customer_code || ''),
      phone,
      name: String(record.customer_name || record.name || ''),
    });
    return {
      ...record,
      customer_phone: phone || null,
      phone: phone || null,
      identity_key: identityKey || null,
      next_followup_date:
        record.next_followup_date ||
        (isValidEgyptianMobile(phone)
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : null),
    };
  });

  const created: DailyFollowup[] = [];
  for (const record of guarded) {
    const { data: result, error } = await supabase.rpc('dawaa_create_or_link_customer_followup_v1', {
      p_customer_id: record.customer_id || null, p_customer_code: record.customer_code || null,
      p_customer_name: record.customer_name || record.name || null, p_customer_phone: record.customer_phone || record.phone || null,
      p_branch: record.branch || null, p_request_type: record.request_type || record.followup_type || 'general',
      p_request_details: record.request_details || record.notes || null, p_followup_reason: record.followup_reason || record.notes || null,
      p_priority: record.priority || 'متوسطة', p_next_followup_date: record.next_followup_date || null,
      p_client_request_id: record.client_request_id || null, p_source: record.request_source || 'daily_followups_api',
    });
    if (error) throw new Error(error.message);
    const followupId = String((result as Record<string, unknown> | null)?.followup_id || '');
    if (!followupId) throw new Error('لم ترجع قاعدة البيانات رقم المتابعة');
    const { data, error: loadError } = await supabase.from('daily_followups').select('*').eq('id', followupId).single();
    if (loadError) throw new Error(loadError.message);
    created.push(enrichLocalGuards(data as DailyFollowup));
  }
  return created;
}

async function loadCustomerPhoneLookup(followups: DailyFollowup[]) {
  const missing = followups.filter((row) => !isValidEgyptianMobile(phoneKey(row.customer_phone)));
  const lookup = new Map<string, string>();
  if (missing.length === 0) return lookup;
  const codes = [...new Set(missing.map((row) => cleanCustomerCode(row.customer_code)).filter(Boolean))].slice(0, 500);
  if (!codes.length) return lookup;
  const { data } = await supabase
    .from('customers')
    .select('customer_code, phone, whatsapp_phone, phone_alt')
    .in('customer_code', codes);
  for (const row of (data || []) as Record<string, unknown>[]) {
    const code = cleanCustomerCode(row.customer_code);
    const phone = phoneKey(String(row.whatsapp_phone || row.phone || row.phone_alt || ''));
    if (code && isValidEgyptianMobile(phone)) lookup.set(`code:${code}`, phone);
  }
  return lookup;
}

async function hydrateFollowupCustomerPhones(rows: DailyFollowup[]) {
  const phoneLookup = await loadCustomerPhoneLookup(rows);
  return rows.map((row) => {
    if (isValidEgyptianMobile(phoneKey(row.customer_phone))) return enrichLocalGuards(row);
    const code = cleanCustomerCode(row.customer_code) || '';
    const phone = phoneLookup.get(`code:${code}`);
    return enrichLocalGuards(phone ? { ...row, customer_phone: phone, phone } : row);
  });
}

export async function getTodayFollowups() {
  requireSupabaseConfig();
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { data, error } = await supabase
    .from('daily_followups')
    .select('*')
    .eq('is_hidden', false)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DailyFollowup[];
  const smartRows = rows.filter(isSmartFollowup);
  return hydrateFollowupCustomerPhones(smartRows.length ? smartRows : rows);
}

export async function createDailyFollowup(followup: DailyFollowupInsert) {
  requireSupabaseConfig();
  const today = startOfToday().toISOString().slice(0, 10);
  const payload = {
    date: followup.followup_date || today,
    followup_date: followup.followup_date || today,
    status: 'open',
    followup_status: 'open',
    open_case: true,
    is_hidden: false,
    ...followup,
  };
  const rows = await insertFollowupRecords([payload as Record<string, unknown>]);
  return rows[0];
}

export async function updateFollowupStatus(id: string, updates: DailyFollowupUpdate) {
  requireSupabaseConfig();
  const record = updates as FollowupRow;
  const nextStatus = String(record.status || record.followup_status || '').trim();
  const completed = Boolean(record.completed_at) || isFinalFollowupStatus(nextStatus);
  const result = String(record.followup_result || record.contact_result || '').trim();
  if (completed && !result) throw new Error('لا يمكن إغلاق المتابعة بدون نتيجة رسمية واضحة.');
  if (!completed && result !== 'الرقم غير صحيح' && !record.next_followup_date)
    throw new Error('يجب تحديد موعد المتابعة القادمة قبل حفظ الحالة المفتوحة.');

  const { data, error } = await supabase.rpc('dawaa_save_customer_followup_result_v1', {
    p_followup_id: id, p_status: nextStatus, p_contact_status: record.contact_status || null,
    p_contact_result: result, p_summary: record.followup_summary || result, p_notes: record.notes || null,
    p_contact_method: record.contact_method || null, p_next_followup_date: record.next_followup_date || null,
    p_responsible_name: record.responsible_name || null, p_request_type: record.request_type || null,
    p_request_details: record.request_details || null, p_request_status: record.request_status || null,
    p_purchase_amount: record.purchase_after_followup ? Number(record.purchase_amount || 0) : null,
    p_quality_rating: record.quality_rating == null ? null : Number(record.quality_rating),
    p_internal_rating: record.internal_rating == null ? null : Number(record.internal_rating),
    p_customer_satisfaction: record.customer_satisfaction || null,
    p_purchase_invoice_no: record.purchase_invoice_no || null,
  });
  if (error) throw new Error(error.message);
  return enrichLocalGuards(data as DailyFollowup);
}

export async function getFollowupHistory(
  options: { limit?: number; from?: string; to?: string; status?: string } = {}
) {
  requireSupabaseConfig();
  const requestedLimit = Math.max(1, Math.min(options.limit || 5000, 10000));
  const pageSize = 1000;
  const allRows: DailyFollowup[] = [];
  for (let offset = 0; offset < requestedLimit; offset += pageSize) {
    let query = supabase
      .from('daily_followups')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, requestedLimit - 1));
    if (options.from) query = query.gte('created_at', options.from);
    if (options.to) query = query.lte('created_at', options.to);
    if (options.status && options.status !== 'all') query = query.eq('status', options.status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as DailyFollowup[];
    allRows.push(...page);
    if (page.length < pageSize) break;
  }
  return hydrateFollowupCustomerPhones(allRows);
}

export async function getCustomerFollowupHistory(
  customer: { code?: string | null; name?: string | null; phone?: string | null },
  limit = 100
) {
  requireSupabaseConfig();
  const code = cleanCustomerCode(customer.code);
  const name = String(customer.name || '').trim();
  const phone = normalizeEgyptianPhone(customer.phone || '');
  const clauses: string[] = [];
  if (code) clauses.push(`customer_code.eq.${code}`);
  if (name) clauses.push(`customer_name.eq.${name}`);
  if (phone) clauses.push(`customer_phone.eq.${phone}`, `phone.eq.${phone}`);
  let query = supabase
    .from('daily_followups')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 500));
  if (clauses.length) query = query.or(clauses.join(','));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return hydrateFollowupCustomerPhones((data ?? []) as DailyFollowup[]);
}

export async function generateTodayFollowups() {
  requireSupabaseConfig();
  return generateTodayFollowupsFromCustomerMetrics();
}

export async function clearTodayTrialFollowups() {
  requireSupabaseConfig();
  const { data, error } = await supabase.rpc('dawaa_archive_today_trial_followups_v1');
  if (error) throw new Error(error.message);
  return Number(data || 0);
}
