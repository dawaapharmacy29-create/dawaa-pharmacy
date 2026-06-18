import { supabase } from '@/lib/supabase';
import { logSupabaseError } from '@/lib/supabaseError';
import { TABLES } from '@/lib/supabaseTables';

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
  if (!result.error) return result;

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
    }
    return retry;
  }

  logEmployeeTransactionsError(result.error);
  logSupabaseError('create employee transaction', result.error);
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
