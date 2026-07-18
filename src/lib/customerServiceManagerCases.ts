import { supabase } from '@/lib/supabase';
import { appendFollowupEvent } from '@/lib/customerServiceDailyExecution';

export type ManagerCaseStatus = 'open' | 'accepted' | 'returned' | 'in_progress' | 'resolved' | 'closed';
export type ManagerCaseSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CustomerServiceManagerCase = {
  id: string;
  followup_id: string | null;
  queue_item_id: string | null;
  branch: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  case_type: string;
  complaint_category: string | null;
  severity: ManagerCaseSeverity;
  status: ManagerCaseStatus;
  escalation_reason: string;
  customer_impact: string | null;
  requested_action: string | null;
  manager_decision: string | null;
  resolution_notes: string | null;
  root_cause: string | null;
  compensation_type: string | null;
  compensation_amount: number;
  customer_satisfaction_after: string | null;
  escalated_by_staff_id: string | null;
  escalated_by_name: string | null;
  accepted_by_name: string | null;
  due_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const text = (value: unknown) => String(value ?? '').trim();
const missingRelation = (message: string) => /does not exist|schema cache|relation .* not found/i.test(message);

export async function listManagerCases(branch?: string, status?: ManagerCaseStatus | 'all') {
  let query = supabase
    .from('customer_service_manager_cases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (text(branch) && branch !== 'all') query = query.eq('branch', text(branch));
  if (status && status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    if (missingRelation(error.message)) return [] as CustomerServiceManagerCase[];
    throw new Error(error.message);
  }
  return (data || []) as CustomerServiceManagerCase[];
}

export async function createOrUpdateManagerCase(input: {
  followupId?: string | null;
  queueItemId?: string | null;
  branch: string;
  customerId?: string | null;
  customerCode?: string | null;
  customerName: string;
  customerPhone?: string | null;
  caseType?: string;
  complaintCategory?: string | null;
  severity?: ManagerCaseSeverity;
  escalationReason: string;
  customerImpact?: string | null;
  requestedAction?: string | null;
  escalatedByStaffId?: string | null;
  escalatedByName?: string | null;
  dueAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const payload = {
    followup_id: input.followupId || null,
    queue_item_id: input.queueItemId || null,
    branch: text(input.branch),
    customer_id: input.customerId || null,
    customer_code: input.customerCode || null,
    customer_name: text(input.customerName) || 'عميل غير مسجل',
    customer_phone: input.customerPhone || null,
    case_type: text(input.caseType) || 'manager_intervention',
    complaint_category: input.complaintCategory || null,
    severity: input.severity || 'high',
    status: 'open',
    escalation_reason: text(input.escalationReason) || 'تحتاج تدخل مدير',
    customer_impact: input.customerImpact || null,
    requested_action: input.requestedAction || null,
    escalated_by_staff_id: input.escalatedByStaffId || null,
    escalated_by_name: input.escalatedByName || null,
    due_at: input.dueAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    metadata: input.metadata || {},
  };

  let query = supabase.from('customer_service_manager_cases').insert(payload).select('*').single();
  if (input.followupId) {
    query = supabase
      .from('customer_service_manager_cases')
      .upsert(payload, { onConflict: 'followup_id', ignoreDuplicates: false })
      .select('*')
      .single();
  }
  const { data, error } = await query;
  if (error) {
    if (missingRelation(error.message)) return null;
    throw new Error(error.message);
  }
  await appendFollowupEvent({
    followupId: input.followupId,
    queueItemId: input.queueItemId,
    eventType: 'manager_escalated',
    status: 'open',
    actorStaffId: input.escalatedByStaffId,
    actorName: input.escalatedByName,
    notes: input.escalationReason,
    metadata: { caseId: data?.id, severity: payload.severity, category: payload.complaint_category },
  });
  return data as CustomerServiceManagerCase;
}

export async function updateManagerCase(input: {
  id: string;
  status: ManagerCaseStatus;
  managerDecision?: string | null;
  resolutionNotes?: string | null;
  rootCause?: string | null;
  compensationType?: string | null;
  compensationAmount?: number;
  customerSatisfactionAfter?: string | null;
  actorStaffId?: string | null;
  actorName?: string | null;
}) {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status: input.status,
    manager_decision: input.managerDecision || null,
    resolution_notes: input.resolutionNotes || null,
    root_cause: input.rootCause || null,
    compensation_type: input.compensationType || null,
    compensation_amount: Math.max(0, Number(input.compensationAmount || 0)),
    customer_satisfaction_after: input.customerSatisfactionAfter || null,
  };
  if (input.status === 'accepted' || input.status === 'in_progress') {
    payload.accepted_by_staff_id = input.actorStaffId || null;
    payload.accepted_by_name = input.actorName || null;
    payload.accepted_at = now;
  }
  if (input.status === 'resolved' || input.status === 'closed') {
    payload.resolved_by_staff_id = input.actorStaffId || null;
    payload.resolved_by_name = input.actorName || null;
    payload.resolved_at = now;
  }
  const { data, error } = await supabase
    .from('customer_service_manager_cases')
    .update(payload)
    .eq('id', input.id)
    .select('*')
    .single();
  if (error) {
    if (missingRelation(error.message)) return null;
    throw new Error(error.message);
  }
  const row = data as CustomerServiceManagerCase;
  await appendFollowupEvent({
    followupId: row.followup_id,
    queueItemId: row.queue_item_id,
    eventType: input.status === 'resolved' || input.status === 'closed' ? 'manager_resolved' : 'manager_decision',
    status: input.status,
    actorStaffId: input.actorStaffId,
    actorName: input.actorName,
    notes: input.resolutionNotes || input.managerDecision || null,
    metadata: { caseId: input.id, rootCause: input.rootCause, compensationAmount: input.compensationAmount || 0 },
  });
  return row;
}
