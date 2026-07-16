import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface ActivityLogInput {
  action: string;
  module: string;
  target_type?: string | null;
  target_id?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_role?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  details?: Record<string, unknown> | string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  route_path?: string | null;
}

const DETAIL_LABELS: Record<string, string> = {
  summary: 'الملخص', staff_id: 'رقم الموظف', target_staff_id: 'رقم الموظف', subject_staff_id: 'رقم الموظف',
  staff_name: 'الموظف', staffName: 'الموظف', subject_name: 'الموظف', staff_role: 'الدور', customer_id: 'رقم العميل',
  customer_name: 'العميل', customerName: 'العميل', customer_code: 'كود العميل', customer_phone: 'هاتف العميل', phone: 'الهاتف',
  points: 'النقاط', points_delta: 'تأثير النقاط', score: 'التقييم', final_score: 'التقييم النهائي', reason: 'السبب', status: 'الحالة',
  branch: 'الفرع', branch_name: 'الفرع', source: 'المصدر', source_id: 'رقم المصدر', route: 'الرابط',
};

function renderDetailValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function compactDetails(details: ActivityLogInput['details']) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  return Object.entries(details)
    .map(([key, value]) => {
      const rendered = renderDetailValue(value);
      return rendered ? `${DETAIL_LABELS[key] || key}: ${rendered}` : '';
    })
    .filter(Boolean)
    .join(' | ');
}

export function formatActivityDetails(details: unknown) {
  if (!details) return 'لا توجد تفاصيل إضافية';
  if (typeof details === 'string') {
    if (!details.trim()) return 'لا توجد تفاصيل إضافية';
    try { return formatActivityDetails(JSON.parse(details)); } catch { return details; }
  }
  if (typeof details === 'object') return compactDetails(details as Record<string, unknown>) || 'لا توجد تفاصيل إضافية';
  return String(details);
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

async function insertWithColumnFallback(table: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabase.from(table).insert(next);
    if (!error) return true;
    const column = missingColumn(error.message);
    if (!column || removed.has(column) || !(column in next)) return false;
    removed.add(column);
    delete next[column];
  }
  return false;
}

function normalizeInput(
  inputOrUserId: ActivityLogInput | string,
  userName?: string,
  action?: string,
  module?: string,
  summary?: string,
  branchName?: string,
  details?: Record<string, unknown>
): ActivityLogInput {
  if (typeof inputOrUserId !== 'string') return inputOrUserId;
  return {
    user_id: inputOrUserId || null,
    user_name: userName || 'النظام',
    action: action || 'نشاط',
    module: module || 'system',
    branch_name: branchName || null,
    details: { summary: summary || '', ...(details || {}) },
    target_type: String(details?.target_type || '') || null,
    target_id: String(details?.target_id || '') || null,
    route_path: String(details?.route || '') || null,
    user_role: String(details?.user_role || '') || null,
  };
}

async function resolveStaffIdFromAccount(userId?: string | null) {
  if (!userId) return '';
  const { data } = await supabase.from('staff_accounts').select('staff_id').eq('id', userId).limit(1).maybeSingle();
  return String(data?.staff_id || '');
}

async function mirrorEmployeeEvents(input: ActivityLogInput, createdAt: string) {
  const details = typeof input.details === 'object' && input.details ? input.details as Record<string, unknown> : {};
  const targetStaffId = String(details.subject_staff_id || details.target_staff_id || details.staff_id || '');
  const targetName = String(details.subject_name || details.staff_name || details.staffName || '');
  const actorStaffId = String(details.actor_staff_id || await resolveStaffIdFromAccount(input.user_id));
  const description = formatActivityDetails(input.details);
  const common = {
    actor_staff_id: actorStaffId || null,
    actor_user_id: input.user_id || null,
    actor_name: input.user_name || 'النظام',
    actor_role: input.user_role || null,
    branch: input.branch_name || String(details.branch || details.branch_name || '') || null,
    category: String(details.category || input.target_type || input.module || 'system'),
    event_type: input.action || 'activity',
    title: String(details.title || input.action || 'نشاط موظف'),
    description,
    source_table: input.module || null,
    source_id: input.target_id || String(details.source_id || '') || null,
    route: input.route_path || String(details.route || '') || null,
    points_delta: Number(details.points_delta ?? details.points ?? 0) || 0,
    money_delta: Number(details.money_delta ?? 0) || 0,
    priority: String(details.priority || 'normal'),
    requires_action: Boolean(details.requires_action),
    metadata: { ...details, mirrored_from_activity_log: true },
    event_at: createdAt,
    created_at: createdAt,
  };

  if (targetStaffId) {
    await insertWithColumnFallback('employee_events', {
      ...common,
      subject_staff_id: targetStaffId,
      subject_name: targetName || null,
    });
  }

  if (actorStaffId && actorStaffId !== targetStaffId) {
    await insertWithColumnFallback('employee_events', {
      ...common,
      subject_staff_id: actorStaffId,
      subject_user_id: input.user_id || null,
      subject_name: input.user_name || null,
      event_type: `${input.action || 'activity'}_performed`,
      title: `قمت بـ: ${input.action || 'نشاط'}`,
      description,
    });
  }
}

export async function logActivity(
  inputOrUserId: ActivityLogInput | string,
  userName?: string,
  action?: string,
  module?: string,
  summary?: string,
  branchName?: string,
  legacyDetails?: Record<string, unknown>
) {
  if (!isSupabaseConfigured) return;
  const input = normalizeInput(inputOrUserId, userName, action, module, summary, branchName, legacyDetails);
  const details = input.details ?? {};
  const branch = input.branch_name || '';
  const createdAt = new Date().toISOString();
  const payload: Record<string, unknown> = {
    action: input.action,
    module: input.module,
    target_type: input.target_type || null,
    target_id: input.target_id || null,
    user_id: input.user_id || null,
    user_name: input.user_name || 'النظام',
    user_role: input.user_role || null,
    branch_id: input.branch_id || null,
    branch_name: branch || null,
    branch: branch || null,
    details,
    old_value: input.old_value || null,
    new_value: input.new_value || null,
    route_path: input.route_path || null,
    created_at: createdAt,
  };

  const saved = await insertWithColumnFallback('activity_log', payload);
  if (!saved) {
    await insertWithColumnFallback('activity_log', {
      user_id: payload.user_id,
      user_name: payload.user_name,
      action: payload.action,
      module: payload.module,
      branch: payload.branch,
      details: formatActivityDetails(details),
      created_at: createdAt,
    });
  }

  try { await mirrorEmployeeEvents(input, createdAt); } catch (error) { console.warn('[activity-log] employee mirror skipped', error); }
}
