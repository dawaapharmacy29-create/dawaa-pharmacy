import { supabase } from '@/lib/supabase';
import {
  buildNotificationDedupeKey,
  canonicalNotificationRoute,
  canonicalNotificationType,
  notificationRequiresAction,
} from '@/lib/notifications/notificationDomain';

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
  dedupeKey?: string;
  stateKey?: string;
  createdByStaffId?: string;
};

function text(value: unknown): string { return String(value ?? '').trim(); }
function priority(value: unknown): StaffNotificationPriority {
  const candidate = text(value);
  return candidate === 'low' || candidate === 'high' || candidate === 'urgent' ? candidate : 'normal';
}
function mapRow(row: RawRow): StaffNotification {
  return {
    id: text(row.id), recipientStaffId: text(row.recipient_staff_id), type: text(row.notification_type || row.type || 'system'),
    title: text(row.title || 'إشعار'), message: text(row.message || row.body || row.description), priority: priority(row.priority),
    entityType: text(row.entity_type || row.target_type) || undefined, entityId: text(row.entity_id || row.target_id) || undefined,
    actionUrl: text(row.action_url || row.target_route || row.route) || undefined,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    isRead: Boolean(row.is_read ?? row.read ?? row.status === 'read'), createdAt: text(row.created_at),
  };
}

export async function createStaffNotification(input: CreateStaffNotificationInput): Promise<StaffNotification | null> {
  const recipientStaffId = text(input.recipientStaffId);
  const title = text(input.title);
  if (!recipientStaffId || !title) return null;

  const canonicalType = canonicalNotificationType(input.type);
  const notifPriority = input.priority || 'normal';
  const actionUrl = canonicalNotificationRoute({
    type: canonicalType,
    entityId: input.entityId,
    explicitRoute: input.actionUrl,
    recipientStaffId,
  });
  const dedupeKey = text(input.dedupeKey) || buildNotificationDedupeKey({
    type: canonicalType,
    recipientStaffId,
    entityType: input.entityType,
    entityId: input.entityId,
    stateKey: input.stateKey,
  });
  const metadata = {
    ...(input.metadata || {}),
    canonicalType,
    requiresAction: notificationRequiresAction(canonicalType, notifPriority),
    route: actionUrl,
  };

  // Canonical path: the DB RPC owns dedupe/upsert semantics. This keeps duplicate
  // protection at write time instead of relying on UI-side filtering after rows exist.
  const { data: rpcId, error: rpcError } = await supabase.rpc('create_staff_notification', {
    p_recipient_staff_id: recipientStaffId,
    p_notification_type: canonicalType,
    p_title: title,
    p_message: text(input.message),
    p_entity_type: text(input.entityType) || null,
    p_entity_id: text(input.entityId) || null,
    p_action_url: actionUrl,
    p_priority: notifPriority,
    p_metadata: metadata,
    p_dedupe_key: dedupeKey || null,
    p_created_by_staff_id: text(input.createdByStaffId) || null,
  });

  if (!rpcError && rpcId) {
    const { data: row } = await supabase.from('notifications').select('*').eq('id', String(rpcId)).maybeSingle();
    if (row) return mapRow(row as RawRow);
    return {
      id: String(rpcId), recipientStaffId, type: canonicalType, title,
      message: text(input.message), priority: notifPriority,
      entityType: text(input.entityType) || undefined, entityId: text(input.entityId) || undefined,
      actionUrl, metadata, isRead: false, createdAt: new Date().toISOString(),
    };
  }

  // Compatibility fallback for deployments where the RPC signature has not landed yet.
  // It still writes the canonical fields and dedupe key so the data remains migratable.
  const payload = {
    recipient_staff_id: recipientStaffId,
    notification_type: canonicalType,
    title,
    message: text(input.message),
    priority: notifPriority,
    entity_type: text(input.entityType) || null,
    entity_id: text(input.entityId) || null,
    action_url: actionUrl,
    target_route: actionUrl,
    route: actionUrl,
    metadata,
    dedupe_key: dedupeKey || null,
    requires_action: notificationRequiresAction(canonicalType, notifPriority),
    action_status: 'new',
    status: 'new',
    is_read: false,
    read: false,
  };

  let query = supabase.from('notifications').select('*').eq('recipient_staff_id', recipientStaffId);
  if (dedupeKey) query = query.eq('dedupe_key', dedupeKey);
  else {
    query = query.eq('notification_type', canonicalType);
    if (input.entityType) query = query.eq('entity_type', input.entityType);
    if (input.entityId) query = query.eq('entity_id', input.entityId);
  }
  const existing = await query.order('created_at', { ascending: false }).limit(1);
  const duplicate = (existing.data || [])[0] as RawRow | undefined;
  if (duplicate && (dedupeKey || input.entityId)) return mapRow(duplicate);

  const { data, error } = await supabase.from('notifications').insert(payload).select('*').single();
  if (error) throw rpcError || error;
  return data ? mapRow(data as RawRow) : null;
}

export async function notifyBranchDoctors(
  branch: string,
  notification: Omit<CreateStaffNotificationInput, 'recipientStaffId'>
): Promise<void> {
  const branchValue = text(branch);
  if (!branchValue) return;
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
  const { error } = await supabase.from('notifications').update({ is_read: true, read: true, status: 'read', read_at: new Date().toISOString() }).eq('id', notificationId);
  if (error) throw error;
}

export async function markAllStaffNotificationsRead(staffId: string): Promise<void> {
  if (!staffId) return;
  const { error } = await supabase.from('notifications').update({ is_read: true, read: true, status: 'read', read_at: new Date().toISOString() }).eq('recipient_staff_id', staffId).eq('is_read', false);
  if (error) throw error;
}

export function subscribeToStaffNotifications(staffId: string, onChange: () => void) {
  if (!staffId) return () => undefined;
  const channel = supabase.channel(`staff-notifications:${staffId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_staff_id=eq.${staffId}` }, onChange).subscribe();
  return () => { void supabase.removeChannel(channel); };
}
