import { supabase } from '@/lib/supabase';
import { logSupabaseError } from '@/lib/supabaseError';
import { TABLES } from '@/lib/supabaseTables';
import { createStaffNotification } from '@/lib/staffNotificationService';

export type EmployeeTransactionType = 'penalty' | 'reward';

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

export interface EmployeeTransactionInput {
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
  month_cycle?: string | null;
  branch?: string | null;
  status?: string | null;
}

export type EmployeeTransactionLifecycleStatus = 'pending' | 'active' | 'cancelled';

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

async function notifyTransaction(input: EmployeeTransactionInput, id?: string | null) {
  const isReward = input.type === 'reward';
  await createStaffNotification({
    recipientStaffId: input.staff_id,
    type: isReward ? 'reward' : 'penalty',
    title: isReward ? 'مكافأة جديدة' : 'خصم مسجل على حسابك',
    message: input.reason || (isReward ? 'تم تسجيل مكافأة جديدة لك.' : 'تم تسجيل خصم على حسابك.'),
    priority: isReward ? 'normal' : 'high',
    entityType: 'employee_transaction',
    entityId: id || undefined,
    actionUrl: '/doctor-dashboard?tab=activity',
  }).catch(() => null);
}

export async function createEmployeeTransaction(input: EmployeeTransactionInput) {
  const payload = {
    ...input,
    points: input.points ?? Math.abs(Number(input.points_delta ?? 0)),
  };
  const result = await supabase
    .from(TABLES.employeeTransactions)
    .insert(payload)
    .select('id')
    .single();
  if (!result.error) {
    if (input.staff_id) void notifyTransaction(input, result.data?.id as string | undefined);
    return result;
  }

  if (result.error.message.toLowerCase().includes('points')) {
    const { points: _points, ...withoutPoints } = payload;
    const retry = await supabase
      .from(TABLES.employeeTransactions)
      .insert(withoutPoints)
      .select('id')
      .single();
    if (retry.error) {
      logEmployeeTransactionsError(retry.error);
      logSupabaseError('create employee transaction', retry.error);
    } else if (input.staff_id) {
      void notifyTransaction(input, retry.data?.id as string | undefined);
    }
    return retry;
  }

  logEmployeeTransactionsError(result.error);
  logSupabaseError('create employee transaction', result.error);
  return result;
}

export async function createEmployeeTransactions(inputs: EmployeeTransactionInput[]) {
  if (!inputs.length) return { data: [], error: null };
  const payloads = inputs.map((input) => ({
    ...input,
    points: input.points ?? Math.abs(Number(input.points_delta ?? 0)),
  }));
  const result = await supabase
    .from(TABLES.employeeTransactions)
    .insert(payloads)
    .select('id');
  if (result.error) {
    logEmployeeTransactionsError(result.error);
    logSupabaseError('create employee transactions', result.error);
    return result;
  }
  inputs.forEach((input, index) => {
    if (input.staff_id) void notifyTransaction(input, result.data?.[index]?.id as string | undefined);
  });
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

export async function updateEmployeeTransaction(
  id: string,
  changes: Partial<EmployeeTransactionInput>
) {
  const result = await supabase
    .from(TABLES.employeeTransactions)
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (result.error) {
    logEmployeeTransactionsError(result.error);
    logSupabaseError('update employee transaction', result.error);
  }
  return result;
}

export async function fetchEmployeeTransactionsForStaff(staffId: string) {
  const result = await supabase
    .from(TABLES.employeeTransactions)
    .select('*')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false });
  if (result.error) {
    logEmployeeTransactionsError(result.error);
    logSupabaseError('fetch employee transactions', result.error);
  }
  return result;
}
