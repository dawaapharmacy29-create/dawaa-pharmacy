import { canonicalNotificationType } from './notificationDomain';

export type CanonicalNotificationMetadata = Record<string, unknown> & {
  schemaVersion: 2;
  canonicalType: string;
  route?: string | null;
  branch?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  reviewId?: string | null;
  score?: number | null;
  pointsImpact?: number | null;
  taskTitle?: string | null;
  taskState?: string | null;
  syncName?: string | null;
  severity?: string | null;
};

function first(meta: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = meta[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function numberValue(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function normalizeNotificationMetadata(
  rawType: unknown,
  input: Record<string, unknown> | null | undefined
): CanonicalNotificationMetadata {
  const meta = input && typeof input === 'object' ? input : {};
  const canonicalType = canonicalNotificationType(rawType);

  const normalized: CanonicalNotificationMetadata = {
    ...meta,
    schemaVersion: 2,
    canonicalType,
  };

  const route = text(first(meta, 'route', 'actionUrl', 'action_url', 'targetRoute', 'target_route'));
  const branch = text(first(meta, 'branch', 'branchName', 'branch_name', 'audienceBranch'));
  const staffId = text(first(meta, 'staffId', 'staff_id', 'recipientStaffId', 'recipient_staff_id'));
  const staffName = text(first(meta, 'staffName', 'staff_name', 'doctorName', 'doctor_name', 'assignedStaffName', 'assigned_name'));
  const customerCode = text(first(meta, 'customerCode', 'customer_code', 'code'));
  const customerName = text(first(meta, 'customerName', 'customer_name'));
  const reviewId = text(first(meta, 'reviewId', 'review_id'));
  const score = numberValue(first(meta, 'score', 'reviewScore', 'review_score', 'totalScore', 'total_score'));
  const pointsImpact = numberValue(first(meta, 'pointsImpact', 'points_impact'));
  const taskTitle = text(first(meta, 'taskTitle', 'task_title', 'title'));
  const taskState = text(first(meta, 'taskState', 'task_state', 'state'));
  const syncName = text(first(meta, 'syncName', 'sync_name'));
  const severity = text(first(meta, 'severity'));

  if (route) normalized.route = route;
  if (branch) normalized.branch = branch;
  if (staffId) normalized.staffId = staffId;
  if (staffName) normalized.staffName = staffName;
  if (customerCode) normalized.customerCode = customerCode;
  if (customerName) normalized.customerName = customerName;
  if (reviewId) normalized.reviewId = reviewId;
  if (score !== null) normalized.score = score;
  if (pointsImpact !== null) normalized.pointsImpact = pointsImpact;
  if (taskTitle) normalized.taskTitle = taskTitle;
  if (taskState) normalized.taskState = taskState;
  if (syncName) normalized.syncName = syncName;
  if (severity) normalized.severity = severity;

  return normalized;
}

export function notificationMetadataContractIssues(
  rawType: unknown,
  metadata: Record<string, unknown> | null | undefined
): string[] {
  const meta = normalizeNotificationMetadata(rawType, metadata);
  const type = canonicalNotificationType(rawType);
  const issues: string[] = [];

  if (type === 'conversation_review') {
    if (!meta.reviewId) issues.push('reviewId');
    if (meta.score === undefined || meta.score === null) issues.push('score');
    if (!meta.staffName) issues.push('staffName');
  }

  if (type === 'staff_task') {
    if (!meta.taskTitle) issues.push('taskTitle');
    if (!meta.taskState) issues.push('taskState');
  }

  if (type === 'vip_customer_silence') {
    if (!meta.customerCode) issues.push('customerCode');
  }

  if (type === 'system' && (meta.syncName || /sync/i.test(String(rawType || '')))) {
    if (!meta.syncName) issues.push('syncName');
    if (!meta.severity) issues.push('severity');
  }

  return issues;
}
