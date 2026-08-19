import { supabase } from '@/lib/supabase';

export type StaffNotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type StaffNotification = {
  id: string;
  recipientStaffId: string;
  type: string;
  title: string;
  message: string;
  priority: StaffNotificationPriority;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
};

type RawRow = Record<string, unknown>;
export type CreateStaffNotificationInput = {
  recipientStaffId: string;
  type: string;
  title: string;
  message: string;
  priority?: StaffNotificationPriority;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
};

function text(value: unknown): string { return String(value ?? '').trim(); }
function priority(value: unknown): StaffNotificationPriority {
  const candidate = text(value);
  return candidate === 'low' || candidate === 'high' || candidate === 'urgent' ? candidate : 'normal';
}
function mapRow(row: RawRow): StaffNotification {
  return {
    id: text(row.id), recipientStaffId: text(row.recipient_staff_id), type: text(row.notification_type || row.type || 'general'),
    title: text(row.title || 'إشعار'), message: text(row.message || row.body || row.description), priority: priority(row.priority),
    entityType: text(row.entity_type) || undefined, entityId: text(row.entity_id) || undefined,
    actionUrl: text(row.action_url || row.target_route || row.route) || undefined,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    isRead: Boolean(row.is_read ?? row.read ?? row.status === 'read'), createdAt: text(row.created_at),
  };
}

export async function createStaffNotification(input: CreateStaffNotificationInput): Promise<StaffNotification | null> {
  const recipientStaffId = text(input.recipientStaffId);
  if (!recipientStaffId || !text(input.title)) return null;

  let duplicateQuery = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_staff_id', recipientStaffId)
    .eq('notification_type', text(input.type || 'general'))
    .order('created_at', { ascending: false })
    .limit(1);
  if (input.entityType) duplicateQuery = duplicateQuery.eq('entity_type', input.entityType);
  if (input.entityId) duplicateQuery = duplicateQuery.eq('entity_id', input.entityId);

  const existing = await duplicateQuery;
  const duplicate = (existing.data || [])[0] as RawRow | undefined;
  if (duplicate && input.entityId) return mapRow(duplicate);

  const payload = {
    recipient_staff_id: recipientStaffId,
    notification_type: text(input.type || 'general'),
    title: text(input.title),
    message: text(input.message),
    priority: input.priority || 'normal',
    entity_type: text(input.entityType) || null,
    entity_id: text(input.entityId) || null,
    action_url: text(input.actionUrl) || null,
    metadata: input.metadata || {},
    is_read: false,
  };
  const { data, error } = await supabase.from('notifications').insert(payload).select('*').single();
  if (error) throw error;
  return data ? mapRow(data as RawRow) : null;
}

export async function notifyBranchDoctors(
  branch: string,
  notification: Omit<CreateStaffNotificationInput, 'recipientStaffId'>
): Promise<void> {
  const branchValue = text(branch);
  if (!branchValue) return;
  // لازم تشمل الدكاترة (pharmacist) والمساعدين (assistant) مع بعض — التنبيه الخاص
  // بفرع معين المفروض يوصل لكل فريق الفرع ده، مش الصيادلة بس.
  // staff_accounts محمي بـ RLS — دالة آمنة عشان التنبيه يوصل لكل الفريق حتى
  // لو اللي شغّل العملية مش مدير.
  const { data, error } = await supabase.rpc('get_staff_accounts_directory', {
    p_roles: ['pharmacist', 'assistant'],
    p_branch: branchValue,
  });
  if (error || !data) return;
  const activeRows = (data as Array<{ staff_id: string; active: boolean; can_login: boolean }>)
    .filter((row) => row.active !== false && row.can_login !== false);
  const staffIds: string[] = [...new Set(activeRows.map((row) => text(row.staff_id)))].filter((value): value is string => Boolean(value));
  await Promise.all(staffIds.map((recipientStaffId: string) => createStaffNotification({ ...notification, recipientStaffId }).catch(() => null)));
}

export async function listStaffNotifications(staffId: string, limit = 100): Promise<StaffNotification[]> {
  if (!staffId) return [];
  const [personal, global] = await Promise.all([
    supabase.from('notifications').select('*').eq('recipient_staff_id', staffId).order('created_at', { ascending: false }).limit(limit),
    supabase.from('notifications').select('*').eq('is_global', true).order('created_at', { ascending: false }).limit(Math.min(limit, 30)),
  ]);
  const unique = new Map<string, StaffNotification>();
  [...(personal.data || []), ...(global.data || [])].map((row) => mapRow(row as RawRow)).filter((row) => row.id).forEach((row) => unique.set(row.id, row));
  return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function markStaffNotificationRead(notificationId: string): Promise<void> {
  if (!notificationId) return;
  const { error } = await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', notificationId);
  if (error) throw error;
}

export async function markAllStaffNotificationsRead(staffId: string): Promise<void> {
  if (!staffId) return;
  const { error } = await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('recipient_staff_id', staffId).eq('is_read', false);
  if (error) throw error;
}

export function subscribeToStaffNotifications(staffId: string, onChange: () => void) {
  if (!staffId) return () => undefined;
  const channel = supabase.channel(`staff-notifications:${staffId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_staff_id=eq.${staffId}` }, onChange).subscribe();
  return () => { void supabase.removeChannel(channel); };
}
