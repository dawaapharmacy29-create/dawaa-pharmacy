import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notificationService';

export type EmployeeEventCategory =
  | 'conversation_review'
  | 'followup'
  | 'shift_note'
  | 'attendance'
  | 'leave'
  | 'permission'
  | 'points'
  | 'reward'
  | 'deduction'
  | 'stagnant_sale'
  | 'inventory'
  | 'cleaning'
  | 'task'
  | 'account'
  | 'payroll'
  | 'sales'
  | 'system';

export interface EmployeeEventInput {
  subjectStaffId: string;
  subjectUserId?: string | null;
  subjectName?: string | null;
  actorStaffId?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  branch?: string | null;
  category: EmployeeEventCategory | string;
  eventType: string;
  title: string;
  description?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  route?: string | null;
  pointsDelta?: number | null;
  moneyDelta?: number | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  requiresAction?: boolean;
  metadata?: Record<string, unknown> | null;
  notify?: boolean;
  eventAt?: string;
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

async function insertWithFallback(table: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(next).select('id').single();
    if (!error) return { id: String(data?.id || ''), error: null as string | null };
    const column = missingColumn(error.message);
    if (!column || removed.has(column) || !(column in next)) return { id: '', error: error.message };
    removed.add(column);
    delete next[column];
  }
  return { id: '', error: 'تعذر حفظ حدث الموظف بسبب اختلاف مخطط قاعدة البيانات.' };
}

export async function recordEmployeeEvent(input: EmployeeEventInput) {
  if (!isSupabaseConfigured || !input.subjectStaffId) return { id: '', error: null as string | null };

  const eventAt = input.eventAt || new Date().toISOString();
  const dedupeKey = [input.sourceTable || 'manual', input.sourceId || eventAt, input.eventType, input.subjectStaffId].join(':');
  const payload: Record<string, unknown> = {
    subject_staff_id: input.subjectStaffId,
    subject_user_id: input.subjectUserId || null,
    subject_name: input.subjectName || null,
    actor_staff_id: input.actorStaffId || null,
    actor_user_id: input.actorUserId || null,
    actor_name: input.actorName || 'النظام',
    actor_role: input.actorRole || null,
    branch: input.branch || null,
    category: input.category,
    event_type: input.eventType,
    title: input.title,
    description: input.description || null,
    source_table: input.sourceTable || null,
    source_id: input.sourceId || null,
    route: input.route || null,
    points_delta: input.pointsDelta ?? null,
    money_delta: input.moneyDelta ?? null,
    priority: input.priority || 'normal',
    requires_action: input.requiresAction ?? false,
    metadata: { ...(input.metadata || {}), dedupe_key: dedupeKey },
    event_at: eventAt,
    created_at: eventAt,
  };

  const result = await insertWithFallback('employee_events', payload);
  if (result.error && !/relation .* does not exist|schema cache/i.test(result.error)) {
    console.warn('[employee-events] insert failed', result.error);
  }

  if (input.notify !== false) {
    await createNotification({
      title: input.title,
      message: input.description || input.title,
      type:
        input.category === 'reward' ? 'reward' :
        input.category === 'deduction' ? 'deduction' :
        input.category === 'conversation_review' ? 'conversation_review' :
        input.category === 'followup' ? 'followup' : 'task',
      priority: input.priority || 'normal',
      recipient_staff_id: input.subjectStaffId,
      recipient_user_id: input.subjectUserId || null,
      user_id: input.subjectUserId || null,
      branch: input.branch || null,
      target_type: input.eventType,
      target_id: input.sourceId || result.id || null,
      target_route: input.route || '/doctor-dashboard?tab=activity',
      requires_action: input.requiresAction ?? false,
      created_by: input.actorUserId || null,
      created_by_name: input.actorName || 'النظام',
      metadata: {
        ...(input.metadata || {}),
        employee_event_id: result.id || null,
        subject_staff_id: input.subjectStaffId,
        points_delta: input.pointsDelta ?? null,
        money_delta: input.moneyDelta ?? null,
      },
    });
  }

  return result;
}

export async function getEmployeeEvents(staffId: string, limit = 100) {
  if (!staffId || !isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('employee_events')
    .select('*')
    .eq('subject_staff_id', staffId)
    .order('event_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));
  if (error) {
    if (!/relation .* does not exist|schema cache/i.test(error.message)) console.warn('[employee-events] load failed', error);
    return [];
  }
  return data || [];
}
