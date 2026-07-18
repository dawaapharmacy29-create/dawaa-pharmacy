import { supabase } from '@/lib/supabase';
import { createStaffNotification } from '@/lib/staffNotificationService';

export type DailyQueueCandidate = {
  key: string;
  source: string;
  customerId?: string | null;
  code?: string | null;
  name: string;
  phone?: string | null;
  branch: string;
  priority?: string | null;
  reason?: string | null;
  nextFollowupDate?: string | null;
  linkedFollowupId?: string | null;
  metadata?: Record<string, unknown>;
};

export type DailyQueueItem = DailyQueueCandidate & {
  id: string;
  queueDate: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const normalizeKey = (value: unknown) => text(value).toLowerCase().replace(/\s+/g, '');
const missingRelation = (message: string) => /does not exist|schema cache|relation .* not found/i.test(message);

function mapRow(row: Record<string, unknown>): DailyQueueItem {
  return {
    id: text(row.id),
    queueDate: text(row.queue_date),
    branch: text(row.branch),
    key: text(row.customer_key),
    customerId: text(row.customer_id) || null,
    code: text(row.customer_code) || null,
    name: text(row.customer_name) || 'عميل غير مسجل',
    phone: text(row.customer_phone) || null,
    source: text(row.source) || 'important',
    priority: text(row.priority) || 'مهم',
    reason: text(row.reason) || null,
    status: text(row.status) || 'not_started',
    linkedFollowupId: text(row.linked_followup_id) || null,
    nextFollowupDate: text(row.next_followup_date) || null,
    startedAt: text(row.started_at) || null,
    completedAt: text(row.completed_at) || null,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
  };
}

async function recentCustomerKeys(branch: string, days = 7) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('customer_service_daily_queue_items')
    .select('customer_key,queue_date,next_followup_date,status')
    .eq('branch', branch)
    .gte('queue_date', startKey)
    .lt('queue_date', todayKey())
    .limit(1000);
  if (error) {
    if (missingRelation(error.message)) return new Set<string>();
    throw error;
  }
  const today = todayKey();
  return new Set(
    (data || [])
      .filter((row) => text(row.next_followup_date) !== today)
      .map((row) => normalizeKey(row.customer_key))
      .filter(Boolean)
  );
}

export async function loadOrCreateDailyQueue(
  branch: string,
  candidates: DailyQueueCandidate[],
  actor?: { id?: string | null; name?: string | null }
): Promise<{ items: DailyQueueItem[]; persistent: boolean }> {
  const queueDate = todayKey();
  const current = await supabase
    .from('customer_service_daily_queue_items')
    .select('*')
    .eq('queue_date', queueDate)
    .eq('branch', branch)
    .order('created_at', { ascending: true });

  if (current.error) {
    if (missingRelation(current.error.message)) return { items: candidates.slice(0, 30).map((item, index) => ({ ...item, id: `fallback-${index}`, queueDate, status: 'not_started' })), persistent: false };
    throw current.error;
  }
  if ((current.data || []).length) return { items: (current.data || []).map((row) => mapRow(row as Record<string, unknown>)), persistent: true };

  const recent = await recentCustomerKeys(branch);
  const selected: DailyQueueCandidate[] = [];
  for (const candidate of candidates) {
    const key = normalizeKey(candidate.key || candidate.code || candidate.phone || candidate.name);
    if (!key) continue;
    const scheduledToday = text(candidate.nextFollowupDate).slice(0, 10) === queueDate;
    const urgent = candidate.source === 'doctor_request' || scheduledToday;
    if (!urgent && recent.has(key)) continue;
    if (selected.some((row) => normalizeKey(row.key) === key)) continue;
    selected.push({ ...candidate, key });
    if (selected.length >= 30) break;
  }

  if (!selected.length) return { items: [], persistent: true };
  const payload = selected.map((item) => ({
    queue_date: queueDate,
    branch,
    customer_key: item.key,
    customer_id: item.customerId || null,
    customer_code: item.code || null,
    customer_name: item.name,
    customer_phone: item.phone || null,
    source: item.source,
    priority: item.priority || 'مهم',
    reason: item.reason || null,
    status: 'not_started',
    linked_followup_id: item.linkedFollowupId || null,
    next_followup_date: item.nextFollowupDate ? item.nextFollowupDate.slice(0, 10) : null,
    created_by: actor?.id || null,
    created_by_name: actor?.name || null,
    metadata: item.metadata || {},
  }));
  const inserted = await supabase.from('customer_service_daily_queue_items').upsert(payload, { onConflict: 'queue_date,branch,customer_key' }).select('*');
  if (inserted.error) throw inserted.error;
  return { items: (inserted.data || []).map((row) => mapRow(row as Record<string, unknown>)), persistent: true };
}

export async function updateDailyQueueItem(
  id: string,
  patch: { status?: string; linkedFollowupId?: string | null; nextFollowupDate?: string | null; completed?: boolean; started?: boolean }
) {
  if (!id || id.startsWith('fallback-')) return;
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = { last_action_at: now };
  if (patch.status) payload.status = patch.status;
  if (patch.linkedFollowupId !== undefined) payload.linked_followup_id = patch.linkedFollowupId;
  if (patch.nextFollowupDate !== undefined) payload.next_followup_date = patch.nextFollowupDate ? patch.nextFollowupDate.slice(0, 10) : null;
  if (patch.started) payload.started_at = now;
  if (patch.completed) payload.completed_at = now;
  const { error } = await supabase.from('customer_service_daily_queue_items').update(payload).eq('id', id);
  if (error && !missingRelation(error.message)) throw error;
}

export async function appendFollowupEvent(input: {
  followupId?: string | null;
  queueItemId?: string | null;
  eventType: string;
  status?: string | null;
  actorStaffId?: string | null;
  actorName?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('customer_service_followup_events').insert({
    followup_id: input.followupId || null,
    queue_item_id: input.queueItemId || null,
    event_type: input.eventType,
    event_status: input.status || null,
    actor_staff_id: input.actorStaffId || null,
    actor_name: input.actorName || null,
    notes: input.notes || null,
    metadata: input.metadata || {},
  });
  if (error && !missingRelation(error.message)) throw error;
}

export async function notifyIncompleteDailyQueue(input: {
  branch: string;
  ownerName: string;
  total: number;
  completed: number;
  needsManager: number;
}) {
  if (!input.total || input.completed >= input.total) return;
  const hour = new Date().getHours();
  const stage = hour >= 19 ? 'end' : hour >= 15 ? 'mid' : '';
  if (!stage) return;
  const roles = ['customer_service_manager', 'branch_manager', 'branches_manager', 'general_manager'];
  const accounts = await supabase
    .from('staff_accounts')
    .select('staff_id,id,role,branch,active,status')
    .in('role', roles)
    .limit(100);
  if (accounts.error) return;
  const recipients = (accounts.data || []).filter((row) => {
    if (row.active === false || text(row.status).includes('موقوف')) return false;
    const role = text(row.role);
    if (role === 'branch_manager' || role === 'customer_service_manager') return !row.branch || text(row.branch) === input.branch;
    return true;
  });
  const remaining = Math.max(0, input.total - input.completed);
  await Promise.allSettled(recipients.map((row) => createStaffNotification({
    recipientStaffId: text(row.staff_id || row.id),
    type: 'customer_service_queue_incomplete',
    title: stage === 'end' ? 'قائمة خدمة العملاء لم تكتمل' : 'تنبيه تقدم قائمة خدمة العملاء',
    message: `${input.branch}: تم تنفيذ ${input.completed} من ${input.total}، والمتبقي ${remaining}${input.needsManager ? `، ومنها ${input.needsManager} تحتاج مديرًا` : ''}.`,
    priority: stage === 'end' || input.needsManager ? 'urgent' : 'high',
    entityType: 'customer_service_daily_queue',
    entityId: `${todayKey()}:${input.branch}:${stage}`,
    actionUrl: `/customer-service?branch=${encodeURIComponent(input.branch)}`,
    metadata: { branch: input.branch, owner: input.ownerName, total: input.total, completed: input.completed, remaining, needsManager: input.needsManager, stage },
  })));
}
