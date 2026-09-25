import { supabase } from '@/lib/supabase';
import { logSupabaseError } from '@/lib/supabaseError';
import { createStaffNotification } from '@/lib/staffNotificationService';

export type EmployeeTransactionType = 'penalty' | 'reward';
export type EmployeeTransactionLifecycleStatus = 'pending' | 'active' | 'cancelled';

export interface EmployeeTransaction {
  id: string;
  staff_id: string;
  type: EmployeeTransactionType;
  points?: number | null;
  amount?: number | null;
  points_delta?: number | null;
  reason: string;
  description?: string | null;
  source?: string | null;
  source_id?: string | null;
  created_by?: string | null;
  created_at: string;
  month_cycle?: string | null;
  branch?: string | null;
  status?: string | null;
}

export interface EmployeePointEventInput {
  staffId: string;
  type: EmployeeTransactionType;
  points: number;
  reason: string;
  description?: string | null;
  source: string;
  sourceId?: string | null;
  ruleCode: string;
  monthCycle: string;
  branch?: string | null;
  status?: EmployeeTransactionLifecycleStatus;
  category?: string | null;
  managerOverride?: boolean;
}

export function transactionDelta(row: Pick<EmployeeTransaction, 'type' | 'points_delta'>) {
  const value = Number(row.points_delta || 0);
  if (value !== 0) return value;
  return row.type === 'reward' ? Math.abs(value) : -Math.abs(value);
}

export function transactionPoints(row: Pick<EmployeeTransaction, 'points' | 'points_delta'>) {
  return Math.abs(Number(row.points ?? row.points_delta ?? 0) || 0);
}

function logEmployeeTransactionsError(error: {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}) {
  console.error('Employee transactions error:', {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
}

async function notifyTransaction(input: EmployeePointEventInput, id?: string | null) {
  const isReward = input.type === 'reward';
  await createStaffNotification({
    recipientStaffId: input.staffId,
    type: isReward ? 'reward' : 'penalty',
    title: isReward ? 'مكافأة جديدة' : 'خصم مسجل على حسابك',
    message: input.reason || (isReward ? 'تم تسجيل مكافأة جديدة لك.' : 'تم تسجيل خصم على حسابك.'),
    priority: isReward ? 'normal' : 'high',
    entityType: 'employee_transaction',
    entityId: id || undefined,
    actionUrl: '/doctor-dashboard?tab=activity',
  }).catch(() => null);
}

export async function recordEmployeePointEvent(input: EmployeePointEventInput) {
  const signedPoints = input.type === 'penalty'
    ? -Math.abs(Number(input.points || 0))
    : Math.abs(Number(input.points || 0));

  const result = await supabase.rpc('record_employee_points_transaction_v4', {
    p_staff_id: input.staffId,
    p_signed_points: signedPoints,
    p_reason: input.reason,
    p_description: input.description || null,
    p_source: input.source,
    p_source_id: input.sourceId || null,
    p_rule_code: input.ruleCode,
    p_month_cycle: input.monthCycle,
    p_branch: input.branch || null,
    p_status: input.status || 'active',
    p_category: input.category || null,
    p_metadata: {
      engine_version: 4,
      service: 'employeeTransactionService',
    },
    p_manager_override: input.managerOverride === true,
  });

  if (result.error) {
    logEmployeeTransactionsError(result.error);
    logSupabaseError('record employee point event v4', result.error);
    return result;
  }

  const row = (result.data || {}) as Record<string, unknown>;
  if (input.staffId) void notifyTransaction(input, row.id ? String(row.id) : undefined);
  return result;
}

export async function transitionEmployeeTransaction(
  id: string,
  status: EmployeeTransactionLifecycleStatus,
  description?: string | null
) {
  const result = await supabase.rpc('transition_employee_points_transaction_v4', {
    p_transaction_id: id,
    p_status: status,
    p_description: description ?? null,
  });
  if (result.error) {
    logEmployeeTransactionsError(result.error);
    logSupabaseError('transition employee transaction', result.error);
  }
  return result;
}

export async function fetchEmployeeTransactionsForStaff(staffId: string) {
  const result = await supabase
    .from('employee_transactions')
    .select('*')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false });
  if (result.error) {
    logEmployeeTransactionsError(result.error);
    logSupabaseError('fetch employee transactions', result.error);
  }
  return result;
}
