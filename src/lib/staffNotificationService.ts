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
};

// Staff notifications are intentionally paused to remove notification load from
// the admin app while the database is under recovery/compute pressure.
export async function createStaffNotification(_input: CreateStaffNotificationInput): Promise<StaffNotification | null> {
  return null;
}

export async function notifyBranchDoctors(
  _branch: string,
  _notification: Omit<CreateStaffNotificationInput, 'recipientStaffId'>
): Promise<void> {
  return;
}

export async function listStaffNotifications(_staffId: string, _limit = 100): Promise<StaffNotification[]> {
  return [];
}

export async function markStaffNotificationRead(_notificationId: string): Promise<void> {
  return;
}

export async function markAllStaffNotificationsRead(_staffId: string): Promise<void> {
  return;
}

export function subscribeToStaffNotifications(_staffId: string, _onChange: () => void) {
  return () => undefined;
}
