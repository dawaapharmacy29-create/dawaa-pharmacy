export const TASK_EVIDENCE_STATUSES = [
  'expected',
  'assigned',
  'accepted',
  'completed',
  'missed',
  'cancelled',
] as const;

export type TaskEvidenceStatus = (typeof TASK_EVIDENCE_STATUSES)[number];

export const TASK_EVIDENCE_SOURCE_TYPES = [
  'task',
  'shift_note',
  'customer_followup',
  'manager_checklist',
  'cleaning_task',
  'shelf_task',
  'customer_request',
] as const;

export type TaskEvidenceSourceType = (typeof TASK_EVIDENCE_SOURCE_TYPES)[number];

/**
 * Canonical evidence envelope shared by operational task-like domains.
 *
 * This is deliberately NOT a replacement for each domain's transactional table.
 * Shift Notes, cleaning, customer follow-up, manager checklists, etc. keep their
 * own workflow state. They expose completed/expected work through this contract
 * so evaluation and staff-profile projections do not reinterpret each table.
 *
 * Financial fields are intentionally absent. Evidence can influence evaluation
 * only through the canonical evaluation projection/settlement pipeline.
 */
export interface TaskEvidence {
  evidenceId: string;
  sourceType: TaskEvidenceSourceType;
  sourceId: string;
  taskKey: string;
  subjectStaffId: string;
  branch: string;
  status: TaskEvidenceStatus;
  expectedAt: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  occurredAt: string;
  assignedByStaffId: string | null;
  cancelledByStaffId: string | null;
  cancellationReason: string | null;
  outcome: string | null;
  evidenceRef: string | null;
  metadata: Record<string, unknown>;
}

export interface TaskEvidenceInput {
  evidenceId?: string | null;
  sourceType: TaskEvidenceSourceType;
  sourceId: string;
  taskKey: string;
  subjectStaffId: string;
  branch: string;
  status: TaskEvidenceStatus;
  expectedAt?: string | null;
  assignedAt?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  occurredAt: string;
  assignedByStaffId?: string | null;
  cancelledByStaffId?: string | null;
  cancellationReason?: string | null;
  outcome?: string | null;
  evidenceRef?: string | null;
  metadata?: Record<string, unknown> | null;
}

function required(value: string | null | undefined, field: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`Task evidence requires ${field}`);
  return normalized;
}

function validTimestamp(value: string | null | undefined, field: string) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Task evidence has invalid ${field}`);
  return new Date(timestamp).toISOString();
}

export function normalizeTaskEvidence(input: TaskEvidenceInput): TaskEvidence {
  const sourceId = required(input.sourceId, 'sourceId');
  const taskKey = required(input.taskKey, 'taskKey');
  const subjectStaffId = required(input.subjectStaffId, 'subjectStaffId');
  const branch = required(input.branch, 'branch');
  const occurredAt = validTimestamp(input.occurredAt, 'occurredAt');
  if (!occurredAt) throw new Error('Task evidence requires occurredAt');

  if (!TASK_EVIDENCE_SOURCE_TYPES.includes(input.sourceType)) {
    throw new Error(`Unsupported task evidence source: ${String(input.sourceType)}`);
  }
  if (!TASK_EVIDENCE_STATUSES.includes(input.status)) {
    throw new Error(`Unsupported task evidence status: ${String(input.status)}`);
  }
  if (input.status === 'cancelled' && !String(input.cancellationReason || '').trim()) {
    throw new Error('Cancelled task evidence requires cancellationReason');
  }
  if (input.status === 'completed' && !input.completedAt) {
    throw new Error('Completed task evidence requires completedAt');
  }

  return {
    evidenceId: String(input.evidenceId || `${input.sourceType}:${sourceId}:${taskKey}`).trim(),
    sourceType: input.sourceType,
    sourceId,
    taskKey,
    subjectStaffId,
    branch,
    status: input.status,
    expectedAt: validTimestamp(input.expectedAt, 'expectedAt'),
    assignedAt: validTimestamp(input.assignedAt, 'assignedAt'),
    acceptedAt: validTimestamp(input.acceptedAt, 'acceptedAt'),
    completedAt: validTimestamp(input.completedAt, 'completedAt'),
    occurredAt,
    assignedByStaffId: input.assignedByStaffId?.trim() || null,
    cancelledByStaffId: input.cancelledByStaffId?.trim() || null,
    cancellationReason: input.cancellationReason?.trim() || null,
    outcome: input.outcome?.trim() || null,
    evidenceRef: input.evidenceRef?.trim() || null,
    metadata: input.metadata || {},
  };
}

export function taskEvidenceStableKey(evidence: Pick<TaskEvidence, 'sourceType' | 'sourceId' | 'taskKey' | 'subjectStaffId'>) {
  return [evidence.sourceType, evidence.sourceId, evidence.taskKey, evidence.subjectStaffId].join(':');
}
