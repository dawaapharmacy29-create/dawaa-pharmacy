import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { ALL_FILTER, getCustomers, type CustomerMetric } from '@/lib/api/customers';
import { normalizeBranchName } from '@/lib/branch';
import { getBestCustomerPhone } from '@/lib/customerAnalyticsService';
import { calculateMonthlyIncentive } from '@/lib/performance/performanceRulesEngine';

export function clearCustomerServiceCommandCenterCache() {}

export type FollowupRow = {
  id: string; date: string | null; customer_id: string | null; customer_name: string | null; phone: string | null; segment: string | null; status: string | null; total_spent: number | null; followup_type: string | null; followup_status: string | null; notes: string | null; branch: string | null; created_at: string | null; followup_date: string | null; name: string | null; classification: string | null; customer_status: string | null; followup_reason: string | null; priority: string | null; contact_status: string | null; contact_result: string | null; responsible_name: string | null; contacted_at: string | null; staff_id: string | null; customer_code: string | null; customer_phone: string | null; customer_flags?: Record<string, boolean> | null; customer_notes?: string | null; service_notes?: string | null; team_notes?: string | null; handling_notes?: string | null; whatsapp_notes?: string | null; address?: string | null; phone_alt?: string | null; whatsapp_phone?: string | null; assigned_to: string | null; assigned_staff_id: string | null; contact_method: string | null; followup_summary: string | null; followup_result: string | null; next_followup_date: string | null; request_type: string | null; request_details: string | null; request_status: string | null; purchase_after_followup: boolean | null; purchase_amount: number | null; purchase_invoice_no: string | null; purchase_date: string | null; closed_at: string | null; closed_by: string | null; created_by: string | null; created_by_name: string | null; assigned_doctor: string | null; followup_notes: string | null; last_purchase_date: string | null; purchase_count_current_month: number | null; average_monthly_purchase_count: number | null; purchase_frequency_status: string | null; updated_at: string | null; category: string | null; suggested_action: string | null; quality_rating: number | null; customer_satisfaction: string | null; response_status: string | null; needs_manager: boolean | null; completed_at: string | null; postponed_until: string | null; cancelled_at: string | null; cancelled_by: string | null; updated_by: string | null; followup_datetime: string | null; customer_metrics?: CustomerMetric | null;
};

export type FollowupFilters = { branch?: string; status?: string; responsible?: string; search?: string; limit?: number };
export type CustomerServiceSearchResult = CustomerMetric & { source: 'customer_metrics_summary' | 'customers'; hasTodayFollowup: boolean; displayPhone: string | null; profile?: Record<string, unknown> | null };
export type FollowupStats = { totalToday: number; completed: number; noAnswer: number; postponed: number; overdue: number; needsManager: number; purchaseAfterCount: number; purchaseAfterAmount: number };
export type FollowupPerformanceRow = { responsible: string; branch: string; assigned: number; completed: number; overdue: number; noAnswer: number; postponed: number; needsManager: number; purchaseAfterCount: number; purchaseAfterAmount: number; avgQualityRating: number | null; completionRate: number; recoveredCustomers: number; improvedFrequencyCount: number; avgCustomerSatisfaction: number | null; totalPoints: number; incentiveValueEstimate: number };
export type CreateExceptionalFollowupInput = { customer?: CustomerMetric | null; customerName: string; customerPhone?: string | null; branch?: string | null; priority?: string | null; requestType?: string | null; followupReason?: string | null; assignedDoctor?: string | null; followupDatetime?: string | null; requestDetails?: string | null; notes?: string | null; createdBy?: string | null; createdByName?: string | null };
export type FollowupResultPayload = { contact_method?: string | null; contact_status?: string | null; contact_result?: string | null; followup_result?: string | null; followup_summary?: string | null; followup_notes?: string | null; purchase_after_followup?: boolean | null; purchase_amount?: number | null; purchase_invoice_no?: string | null; purchase_date?: string | null; next_followup_date?: string | null; quality_rating?: number | null; customer_satisfaction?: string | null; needs_manager?: boolean | null; response_status?: string | null; completed_at?: string | null; postponed_until?: string | null; updated_by?: string | null; status?: string | null; followup_status?: string | null };

type Row = Record<string, unknown>;

function requireSupabaseConfig() { if (!isSupabaseConfigured) throw new Error('Supabase is not configured.'); }
function toNumber(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function todayDay() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
function isAll(value?: string | null) { return !value || value === ALL_FILTER || value === 'كل الفروع' || value === 'all'; }
function normalizeStatus(value?: string | null) { const raw = String(value || '').trim(); if (!raw || raw === 'pending') return 'معلق'; if (['done','completed','تم التواصل','تم'].includes(raw)) return 'تم'; if (['no_answer','لم يرد'].includes(raw)) return 'لم يرد'; if (['postponed','مؤجل'].includes(raw)) return 'مؤجل'; if (['needs_manager','يحتاج مدير'].includes(raw)) return 'يحتاج مدير'; return raw; }
function isDone(row: FollowupRow) { return Boolean(row.completed_at) || ['تم','تم التواصل','تم الشراء بعد المتابعة'].includes(normalizeStatus(row.followup_status || row.status || row.contact_status)); }
function isNoAnswer(row: FollowupRow) { return normalizeStatus(row.followup_status || row.status || row.contact_status) === 'لم يرد'; }
function isPostponed(row: FollowupRow) { return Boolean(row.postponed_until) || normalizeStatus(row.followup_status || row.status || row.contact_status) === 'مؤجل'; }
function isOverdue(row: FollowupRow) { if (isDone(row) || isPostponed(row)) return false; const due = row.followup_datetime || row.followup_date || row.date; return due ? new Date(due).getTime() < Date.now() : false; }
function missingColumn(message: string) { return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || ''; }
function withoutColumn<T extends Row>(record: T, column: string) { const next = { ...record }; delete next[column]; return next; }

function publicFollowupReason(value?: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/[.。]+$/g, '').trim();
  if (/محاولة\s*استرجاع|استرجاع\s*العميل|سبب\s*التوقف|عرض\s*مناسب/i.test(normalized)) return 'الاطمئنان على حضرتك ومعرفة لو كان فيه أي ملاحظة أو احتياج نقدر نساعد فيه';
  if (/متابعة\s*VIP|احتياجات\s*شهرية/i.test(normalized)) return 'متابعة احتياجات حضرتك الشهرية والاطمئنان على رضاك عن الخدمة';
  if (/قبل\s*فقد\s*العميل|مهدد\s*بالتوقف/i.test(normalized)) return 'الاطمئنان على سبب قلة التعامل ومساعدتك في أي طلب أو ملاحظة';
  if (/تحفيز\s*للشراء|متابعة\s*دورية/i.test(normalized)) return 'متابعة احتياجات حضرتك والتأكد إن كل الأصناف المطلوبة متوفرة';
  if (/متابعة\s*عادية/i.test(normalized)) return 'الاطمئنان على حضرتك ومتابعة أي احتياج من الصيدلية';
  return normalized;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { if (timer) clearTimeout(timer); }
}

function normalizeFollowup(row: Row): FollowupRow {
  const safeFollowupReason = publicFollowupReason(row.followup_reason);
  const safeRequestDetails = publicFollowupReason(row.request_details);
  const safeSuggestedAction = publicFollowupReason(row.suggested_action);
  return {
    id: String(row.id || crypto.randomUUID()), date: (row.date as string) || null, customer_id: (row.customer_id as string) || null,
    customer_name: (row.customer_name as string) || (row.name as string) || null, phone: (row.phone as string) || (row.customer_phone as string) || null,
    segment: (row.segment as string) || (row.classification as string) || null, status: (row.status as string) || null, total_spent: toNumber(row.total_spent),
    followup_type: (row.followup_type as string) || null, followup_status: (row.followup_status as string) || null, notes: (row.notes as string) || null,
    branch: normalizeBranchName(row.branch as string), created_at: (row.created_at as string) || null, followup_date: (row.followup_date as string) || null,
    name: (row.name as string) || (row.customer_name as string) || null, classification: (row.classification as string) || (row.segment as string) || null,
    customer_status: (row.customer_status as string) || null, followup_reason: safeFollowupReason, priority: (row.priority as string) || null,
    contact_status: (row.contact_status as string) || null, contact_result: (row.contact_result as string) || null, responsible_name: (row.responsible_name as string) || null,
    contacted_at: (row.contacted_at as string) || null, staff_id: (row.staff_id as string) || null, customer_code: (row.customer_code as string) || null,
    customer_phone: (row.customer_phone as string) || (row.phone as string) || null, customer_flags: (row.customer_flags as Record<string, boolean>) || null,
    customer_notes: (row.customer_notes as string) || null, service_notes: (row.service_notes as string) || null, team_notes: (row.team_notes as string) || null,
    handling_notes: (row.handling_notes as string) || null, whatsapp_notes: (row.whatsapp_notes as string) || null, address: (row.address as string) || null,
    phone_alt: (row.phone_alt as string) || null, whatsapp_phone: (row.whatsapp_phone as string) || null, assigned_to: (row.assigned_to as string) || null,
    assigned_staff_id: (row.assigned_staff_id as string) || null, contact_method: (row.contact_method as string) || null, followup_summary: (row.followup_summary as string) || null,
    followup_result: (row.followup_result as string) || null, next_followup_date: (row.next_followup_date as string) || null, request_type: (row.request_type as string) || null,
    request_details: safeRequestDetails, request_status: (row.request_status as string) || null, purchase_after_followup: Boolean(row.purchase_after_followup),
    purchase_amount: toNumber(row.purchase_amount), purchase_invoice_no: (row.purchase_invoice_no as string) || null, purchase_date: (row.purchase_date as string) || null,
    closed_at: (row.closed_at as string) || null, closed_by: (row.closed_by as string) || null, created_by: (row.created_by as string) || null,
    created_by_name: (row.created_by_name as string) || null, assigned_doctor: (row.assigned_doctor as string) || null, followup_notes: (row.followup_notes as string) || null,
    last_purchase_date: (row.last_purchase_date as string) || null, purchase_count_current_month: toNumber(row.purchase_count_current_month), average_monthly_purchase_count: toNumber(row.average_monthly_purchase_count),
    purchase_frequency_status: (row.purchase_frequency_status as string) || null, updated_at: (row.updated_at as string) || null, category: (row.category as string) || null,
    suggested_action: safeSuggestedAction, quality_rating: row.quality_rating == null ? null : toNumber(row.quality_rating), customer_satisfaction: (row.customer_satisfaction as string) || null,
    response_status: (row.response_status as string) || null, needs_manager: Boolean(row.needs_manager), completed_at: (row.completed_at as string) || null,
    postponed_until: (row.postponed_until as string) || null, cancelled_at: (row.cancelled_at as string) || null, cancelled_by: (row.cancelled_by as string) || null,
    updated_by: (row.updated_by as string) || null, followup_datetime: (row.followup_datetime as string) || null,
  };
}

async function safeInsertFollowup(payload: Row) { let current = payload; const removed = new Set<string>(); for (let attempt = 0; attempt < 12; attempt += 1) { const { data, error } = await supabase.from('daily_followups').insert(current).select('*').single(); if (!error) return normalizeFollowup(data || current); const column = missingColumn(error.message); if (!column || removed.has(column)) throw new Error(error.message); removed.add(column); current = withoutColumn(current, column); } throw new Error('daily_followups insert failed.'); }
async function safeUpdateFollowup(id: string, payload: Row) { let current = payload; const removed = new Set<string>(); for (let attempt = 0; attempt < 12; attempt += 1) { const { data, error } = await supabase.from('daily_followups').update(current).eq('id', id).select('*').single(); if (!error) return normalizeFollowup(data || { id, ...current }); const column = missingColumn(error.message); if (!column || removed.has(column)) throw new Error(error.message); removed.add(column); current = withoutColumn(current, column); } throw new Error('daily_followups update failed.'); }

export async function searchCustomerMetrics(search: string, branch?: string): Promise<CustomerServiceSearchResult[]> { const result = await getCustomers({ search, branch: !isAll(branch) ? branch : ALL_FILTER, limit: 20, offset: 0 }); return result.customers.map((metric) => ({ ...metric, source: 'customer_metrics_summary', hasTodayFollowup: false, displayPhone: getBestCustomerPhone({ customer_code: metric.customer_code, customer_phone: metric.customer_phone, phone: metric.phone } as FollowupRow, metric, null), profile: null })); }

export async function fetchCustomerServiceFollowups(filters: FollowupFilters = {}) {
  requireSupabaseConfig();
  const load = async () => {
    let query = supabase.from('daily_followups').select('*').order('created_at', { ascending: false }).limit(filters.limit || 60);
    if (!isAll(filters.branch)) query = query.eq('branch', filters.branch as string);
    if (!isAll(filters.status) && filters.status !== 'متأخرة') {
      if (filters.status === 'يحتاج مدير') query = query.eq('needs_manager', true);
      else query = query.or(`status.eq.${filters.status},followup_status.eq.${filters.status},contact_status.eq.${filters.status}`);
    }
    if (!isAll(filters.responsible)) query = query.or(`responsible_name.eq.${filters.responsible},assigned_to.eq.${filters.responsible},assigned_doctor.eq.${filters.responsible}`);
    if (filters.search?.trim()) { const text = `%${filters.search.trim().replace(/[%_]/g, '')}%`; query = query.or(`customer_name.ilike.${text},name.ilike.${text},customer_code.ilike.${text},customer_phone.ilike.${text},phone.ilike.${text}`); }
    const { data, error } = await query; if (error) throw new Error(error.message); return (data || []).map((row) => normalizeFollowup(row as Row));
  };
  try { const rows = await withTimeout(load(), 8000, 'followups'); return filters.status === 'متأخرة' ? rows.filter(isOverdue) : rows; }
  catch (error) { console.warn('customer followups safe fallback returned empty list', error); return [] as FollowupRow[]; }
}

export async function fetchFollowupPerformanceSummary(branch?: string) { try { let query = supabase.from('followup_performance_summary').select('*').eq('followup_date', todayDay()).limit(60); if (!isAll(branch)) query = query.eq('branch', branch as string); const { data, error } = await query; if (error) return null; return (data || []) as Row[]; } catch { return null; } }
export function calculateFollowupStats(rows: FollowupRow[]): FollowupStats { return rows.reduce((acc, row) => { acc.totalToday += 1; if (isDone(row)) acc.completed += 1; if (isNoAnswer(row)) acc.noAnswer += 1; if (isPostponed(row)) acc.postponed += 1; if (isOverdue(row)) acc.overdue += 1; if (row.needs_manager || normalizeStatus(row.followup_status || row.status) === 'يحتاج مدير') acc.needsManager += 1; if (row.purchase_after_followup) { acc.purchaseAfterCount += 1; acc.purchaseAfterAmount += toNumber(row.purchase_amount); } return acc; }, { totalToday: 0, completed: 0, noAnswer: 0, postponed: 0, overdue: 0, needsManager: 0, purchaseAfterCount: 0, purchaseAfterAmount: 0 }); }
export function calculateTeamPerformance(rows: FollowupRow[]): FollowupPerformanceRow[] { const map = new Map<string, FollowupPerformanceRow>(); for (const row of rows) { const responsible = row.responsible_name || row.assigned_to || row.assigned_doctor || 'غير محدد'; const key = `${responsible}__${row.branch || ''}`; const item = map.get(key) || { responsible, branch: row.branch || 'غير محدد', assigned: 0, completed: 0, overdue: 0, noAnswer: 0, postponed: 0, needsManager: 0, purchaseAfterCount: 0, purchaseAfterAmount: 0, avgQualityRating: null, completionRate: 0, recoveredCustomers: 0, improvedFrequencyCount: 0, avgCustomerSatisfaction: null, totalPoints: 0, incentiveValueEstimate: 0 }; item.assigned += 1; if (isDone(row)) item.completed += 1; if (isOverdue(row)) item.overdue += 1; if (isNoAnswer(row)) item.noAnswer += 1; if (isPostponed(row)) item.postponed += 1; if (row.needs_manager) item.needsManager += 1; if (row.purchase_after_followup) { item.purchaseAfterCount += 1; item.purchaseAfterAmount += toNumber(row.purchase_amount); } map.set(key, item); } return [...map.values()].map((item) => ({ ...item, completionRate: item.assigned ? Math.round((item.completed / item.assigned) * 100) : 0, totalPoints: item.completed * 5 + item.purchaseAfterCount * 10 - item.noAnswer * 2, incentiveValueEstimate: calculateMonthlyIncentive(item.completed * 5 + item.purchaseAfterCount * 10 - item.noAnswer * 2).moneyValue })); }
export async function createExceptionalFollowup(input: CreateExceptionalFollowupInput) { const publicReason = publicFollowupReason(input.followupReason || input.requestType) || 'الاطمئنان على العميل ومتابعة احتياجه'; return safeInsertFollowup({ date: todayDay(), customer_id: input.customer?.customer_id || input.customer?.id || null, customer_code: input.customer?.customer_code || null, customer_name: input.customerName || input.customer?.customer_name || null, name: input.customerName || input.customer?.customer_name || null, customer_phone: input.customerPhone || input.customer?.customer_phone || null, phone: input.customerPhone || input.customer?.customer_phone || null, branch: normalizeBranchName(input.branch || input.customer?.branch || ''), priority: input.priority || 'مهم', request_type: input.requestType || 'متابعة استثنائية', followup_reason: publicReason, request_details: publicFollowupReason(input.requestDetails || input.notes) || null, assigned_doctor: input.assignedDoctor || null, responsible_name: input.assignedDoctor || null, followup_datetime: input.followupDatetime || new Date().toISOString(), followup_date: input.followupDatetime || new Date().toISOString(), status: 'معلق', followup_status: 'معلق', notes: input.notes || null, created_by: input.createdBy || null, created_by_name: input.createdByName || null }); }
export async function updateFollowupResult(id: string, payload: FollowupResultPayload) { const patch: Row = { ...payload, updated_at: new Date().toISOString() }; if (payload.followup_status === 'تم' || payload.status === 'تم' || payload.completed_at) patch.completed_at = payload.completed_at || new Date().toISOString(); return safeUpdateFollowup(id, patch); }
export async function generateTodayFollowupsFromCustomerMetrics(branch?: string, createdByName?: string | null) { const result = await getCustomers({ branch: !isAll(branch) ? branch : ALL_FILTER, limit: 12, offset: 0 }); const rows: FollowupRow[] = []; for (const customer of result.customers.slice(0, 12)) { try { rows.push(await createExceptionalFollowup({ customer, customerName: customer.customer_name || 'عميل', customerPhone: customer.customer_phone, branch: customer.branch, priority: customer.segment === 'مهم جدًا' ? 'عاجل' : 'مهم', requestType: 'متابعة يومية', followupReason: recommendedAction(customer), createdByName })); } catch (error) { console.warn('daily followup insert skipped', error); } } return rows; }
export function riskLevel(row: FollowupRow | CustomerMetric) { const status = 'customer_status' in row ? row.customer_status : null; const segment = 'segment' in row ? row.segment : null; if (status === 'متوقف' || segment === 'مهم جدًا') return 'عالي'; if (status === 'مهدد بالتوقف' || segment === 'مهم') return 'متوسط'; return 'منخفض'; }
export function recommendedAction(row: FollowupRow | CustomerMetric) { const status = 'customer_status' in row ? row.customer_status : null; const segment = 'segment' in row ? row.segment : null; if (status === 'متوقف') return 'الاطمئنان على سبب توقف التعامل ومعرفة أي ملاحظة أو احتياج'; if (status === 'مهدد بالتوقف') return 'متابعة سبب قلة التعامل قبل أن يتوقف العميل'; if (segment === 'مهم جدًا') return 'متابعة احتياجات العميل الشهرية لأنه من العملاء المميزين'; if (segment === 'مهم') return 'متابعة دورية للتأكد من توافر احتياجات العميل'; return 'الاطمئنان على العميل ومتابعة أي احتياج من الصيدلية'; }
