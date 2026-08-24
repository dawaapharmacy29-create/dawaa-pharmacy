import { normalizeTaskEvidence, type TaskEvidence, type TaskEvidenceStatus } from './taskEvidence';

type Nullable<T> = T | null | undefined;

type ShiftNoteEvidenceRow = {
  id: string;
  branch?: Nullable<string>;
  title?: Nullable<string>;
  note_type?: Nullable<string>;
  note_kind?: Nullable<string>;
  status?: Nullable<string>;
  priority?: Nullable<string>;
  due_at?: Nullable<string>;
  assigned_at?: Nullable<string>;
  received_at?: Nullable<string>;
  completed_at?: Nullable<string>;
  closed_at?: Nullable<string>;
  cancelled_at?: Nullable<string>;
  closure_reason?: Nullable<string>;
  created_at?: Nullable<string>;
  updated_at?: Nullable<string>;
};

type CleaningTaskEvidenceRow = {
  id: string;
  branch?: Nullable<string>;
  task_date?: Nullable<string>;
  date?: Nullable<string>;
  shift?: Nullable<string>;
  responsible_staff_id?: Nullable<string>;
  cleaning_responsible_id?: Nullable<string>;
  status?: Nullable<string>;
  notes?: Nullable<string>;
  approved_by?: Nullable<string>;
  approved_at?: Nullable<string>;
  reviewed_at?: Nullable<string>;
  created_by?: Nullable<string>;
  created_at?: Nullable<string>;
  updated_at?: Nullable<string>;
  review_photo_url?: Nullable<string>;
  review_photo_path?: Nullable<string>;
};

type ManagerChecklistEvidenceRow = {
  id: string;
  staff_id?: Nullable<string>;
  branch?: Nullable<string>;
  task_date?: Nullable<string>;
  task_key?: Nullable<string>;
  completed?: Nullable<boolean>;
  note?: Nullable<string>;
  completed_at?: Nullable<string>;
  created_at?: Nullable<string>;
  updated_at?: Nullable<string>;
};

type CustomerFollowupEvidenceRow = {
  id: string;
  branch?: Nullable<string>;
  staff_id?: Nullable<string>;
  assigned_staff_id?: Nullable<string>;
  followup_reason_key?: Nullable<string>;
  followup_reason?: Nullable<string>;
  followup_type?: Nullable<string>;
  status?: Nullable<string>;
  followup_status?: Nullable<string>;
  contact_status?: Nullable<string>;
  response_status?: Nullable<string>;
  contact_result?: Nullable<string>;
  followup_result?: Nullable<string>;
  followup_datetime?: Nullable<string>;
  followup_date?: Nullable<string>;
  contacted_at?: Nullable<string>;
  first_attempt_at?: Nullable<string>;
  completed_at?: Nullable<string>;
  closed_at?: Nullable<string>;
  cancelled_at?: Nullable<string>;
  cancelled_reason?: Nullable<string>;
  created_at?: Nullable<string>;
  updated_at?: Nullable<string>;
  attempt_count?: Nullable<number>;
  is_duplicate?: Nullable<boolean>;
  is_hidden?: Nullable<boolean>;
  archived_at?: Nullable<string>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalStaffId(value: Nullable<string>) {
  const text = String(value || '').trim();
  return UUID_RE.test(text) ? text : null;
}

function text(value: unknown) {
  return String(value || '').trim();
}

function iso(value: Nullable<string>) {
  const raw = text(value);
  if (!raw) return null;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function dateAtEndOfDay(value: Nullable<string>) {
  const raw = text(value);
  if (!raw) return null;
  const direct = iso(raw);
  if (direct && raw.includes('T')) return direct;
  const timestamp = new Date(`${raw}T23:59:59+03:00`).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : direct;
}

function normalizedState(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, '_');
}

function isPast(value: Nullable<string>, observedAt: string) {
  const target = iso(value) || dateAtEndOfDay(value);
  if (!target) return false;
  return new Date(target).getTime() < new Date(observedAt).getTime();
}

function taskStateFromFlags(input: {
  cancelled: boolean;
  completed: boolean;
  accepted: boolean;
  assigned: boolean;
  overdue: boolean;
}): TaskEvidenceStatus {
  if (input.cancelled) return 'cancelled';
  if (input.completed) return 'completed';
  if (input.overdue) return 'missed';
  if (input.accepted) return 'accepted';
  if (input.assigned) return 'assigned';
  return 'expected';
}

export function shiftNoteToTaskEvidence(
  row: ShiftNoteEvidenceRow,
  subjectStaffId: string,
  observedAt = new Date().toISOString()
): TaskEvidence | null {
  const staffId = canonicalStaffId(subjectStaffId);
  const branch = text(row.branch);
  const sourceId = text(row.id);
  if (!staffId || !branch || !sourceId) return null;

  const state = normalizedState(row.status);
  const cancelled = Boolean(row.cancelled_at) || ['cancelled', 'canceled', 'ملغي', 'ملغى'].includes(state);
  const completed = Boolean(row.completed_at || row.closed_at) || ['completed', 'closed', 'done', 'مكتمل', 'مغلق'].includes(state);
  const accepted = Boolean(row.received_at);
  const assigned = Boolean(row.assigned_at);
  const overdue = !cancelled && !completed && Boolean(row.due_at) && isPast(row.due_at, observedAt);
  const status = taskStateFromFlags({ cancelled, completed, accepted, assigned, overdue });
  const completedAt = iso(row.completed_at || row.closed_at);
  const cancelledAt = iso(row.cancelled_at);
  const occurredAt = cancelledAt || completedAt || iso(row.received_at || row.assigned_at || row.updated_at || row.created_at) || observedAt;

  return normalizeTaskEvidence({
    sourceType: 'shift_note',
    sourceId,
    taskKey: text(row.note_kind || row.note_type || row.title) || 'shift_note',
    subjectStaffId: staffId,
    branch,
    status,
    expectedAt: iso(row.due_at),
    assignedAt: iso(row.assigned_at),
    acceptedAt: iso(row.received_at),
    completedAt: status === 'completed' ? completedAt || occurredAt : null,
    occurredAt,
    cancellationReason: status === 'cancelled' ? text(row.closure_reason) || 'cancelled' : null,
    outcome: status === 'completed' ? text(row.closure_reason) || 'completed' : null,
    metadata: {
      priority: text(row.priority) || null,
      sourceStatus: text(row.status) || null,
      title: text(row.title) || null,
    },
  });
}

export function cleaningTaskToTaskEvidence(
  row: CleaningTaskEvidenceRow,
  observedAt = new Date().toISOString()
): TaskEvidence | null {
  const staffId = canonicalStaffId(row.responsible_staff_id || row.cleaning_responsible_id);
  const branch = text(row.branch);
  const sourceId = text(row.id);
  if (!staffId || !branch || !sourceId) return null;

  const state = normalizedState(row.status);
  const cancelled = ['cancelled', 'canceled', 'ملغي', 'ملغى'].includes(state);
  const completed = Boolean(row.approved_at || row.reviewed_at) || ['completed', 'approved', 'done', 'مكتمل', 'معتمد'].includes(state);
  const expectedAt = dateAtEndOfDay(row.task_date || row.date);
  const overdue = !cancelled && !completed && Boolean(expectedAt) && isPast(expectedAt, observedAt);
  const status = taskStateFromFlags({ cancelled, completed, accepted: false, assigned: true, overdue });
  const completedAt = iso(row.approved_at || row.reviewed_at);
  const occurredAt = completedAt || iso(row.updated_at || row.created_at) || observedAt;

  return normalizeTaskEvidence({
    sourceType: 'cleaning_task',
    sourceId,
    taskKey: `cleaning:${text(row.shift) || 'daily'}`,
    subjectStaffId: staffId,
    branch,
    status,
    expectedAt,
    assignedAt: iso(row.created_at),
    completedAt: status === 'completed' ? completedAt || occurredAt : null,
    occurredAt,
    assignedByStaffId: canonicalStaffId(row.created_by),
    cancellationReason: status === 'cancelled' ? text(row.notes) || 'cancelled' : null,
    outcome: status === 'completed' ? text(row.notes) || 'completed' : null,
    evidenceRef: text(row.review_photo_url || row.review_photo_path) || null,
    metadata: {
      shift: text(row.shift) || null,
      sourceStatus: text(row.status) || null,
      approvedByStaffId: canonicalStaffId(row.approved_by),
    },
  });
}

export function managerChecklistToTaskEvidence(
  row: ManagerChecklistEvidenceRow,
  observedAt = new Date().toISOString()
): TaskEvidence | null {
  const staffId = canonicalStaffId(row.staff_id);
  const branch = text(row.branch);
  const sourceId = text(row.id);
  const taskKey = text(row.task_key);
  if (!staffId || !branch || !sourceId || !taskKey) return null;

  const expectedAt = dateAtEndOfDay(row.task_date);
  const completed = Boolean(row.completed || row.completed_at);
  const overdue = !completed && Boolean(expectedAt) && isPast(expectedAt, observedAt);
  const status: TaskEvidenceStatus = completed ? 'completed' : overdue ? 'missed' : 'expected';
  const completedAt = iso(row.completed_at);
  const occurredAt = completedAt || iso(row.updated_at || row.created_at) || observedAt;

  return normalizeTaskEvidence({
    sourceType: 'manager_checklist',
    sourceId,
    taskKey,
    subjectStaffId: staffId,
    branch,
    status,
    expectedAt,
    completedAt: status === 'completed' ? completedAt || occurredAt : null,
    occurredAt,
    outcome: status === 'completed' ? text(row.note) || 'completed' : null,
    metadata: { note: text(row.note) || null },
  });
}

export function customerFollowupToTaskEvidence(
  row: CustomerFollowupEvidenceRow,
  observedAt = new Date().toISOString()
): TaskEvidence | null {
  if (row.is_duplicate || row.is_hidden || row.archived_at) return null;

  const staffId = canonicalStaffId(row.assigned_staff_id || row.staff_id);
  const branch = text(row.branch);
  const sourceId = text(row.id);
  if (!staffId || !branch || !sourceId) return null;

  const state = normalizedState(row.followup_status || row.status);
  const cancelled = Boolean(row.cancelled_at) || ['cancelled', 'canceled', 'ملغي', 'ملغى'].includes(state);
  const completed = Boolean(row.completed_at || row.closed_at) || ['completed', 'closed', 'done', 'مكتمل', 'مغلق'].includes(state);
  const accepted = Boolean(row.contacted_at || row.first_attempt_at || (row.attempt_count || 0) > 0);
  const expectedAt = iso(row.followup_datetime) || dateAtEndOfDay(row.followup_date);
  const overdue = !cancelled && !completed && !accepted && Boolean(expectedAt) && isPast(expectedAt, observedAt);
  const status = taskStateFromFlags({ cancelled, completed, accepted, assigned: true, overdue });
  const completedAt = iso(row.completed_at || row.closed_at);
  const cancelledAt = iso(row.cancelled_at);
  const occurredAt = cancelledAt || completedAt || iso(row.contacted_at || row.first_attempt_at || row.updated_at || row.created_at) || observedAt;

  return normalizeTaskEvidence({
    sourceType: 'customer_followup',
    sourceId,
    taskKey: text(row.followup_reason_key || row.followup_type || row.followup_reason) || 'customer_followup',
    subjectStaffId: staffId,
    branch,
    status,
    expectedAt,
    acceptedAt: accepted ? iso(row.contacted_at || row.first_attempt_at) || occurredAt : null,
    completedAt: status === 'completed' ? completedAt || occurredAt : null,
    occurredAt,
    cancellationReason: status === 'cancelled' ? text(row.cancelled_reason) || 'cancelled' : null,
    outcome: text(row.followup_result || row.contact_result || row.response_status || row.contact_status) || null,
    metadata: {
      sourceStatus: text(row.followup_status || row.status) || null,
      attempts: Number(row.attempt_count || 0),
    },
  });
}
