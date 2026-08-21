import { normalizeBranchName } from '@/lib/branch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type EmployeeTransactionReadRow = Record<string, unknown>;

export type EmployeeTransactionReadParams = {
  staffId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  branch?: string | null;
  limit?: number;
};

/**
 * Canonical read boundary for employee event/points ledger history.
 *
 * This is intentionally a read model, not an incentive calculator. Final payroll values
 * must come from settled payroll projections such as staff_payroll_incentive_truth_v1.
 */
export async function readEmployeeTransactions(
  params: EmployeeTransactionReadParams = {}
): Promise<EmployeeTransactionReadRow[]> {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير متاحة.');

  let query = supabase.from('employee_transactions').select('*');
  if (params.staffId) query = query.eq('staff_id', params.staffId);
  if (params.startDate) query = query.gte('created_at', `${params.startDate.slice(0, 10)}T00:00:00`);
  if (params.endDate) query = query.lte('created_at', `${params.endDate.slice(0, 10)}T23:59:59.999`);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(params.limit || 3000, 1), 5000));

  if (error) throw new Error(error.message);
  const rows = (data || []) as EmployeeTransactionReadRow[];
  const branch = normalizeBranchName(params.branch || '');
  if (!branch) return rows;

  return rows.filter((row) => {
    const rowBranch = normalizeBranchName(String(row.branch || ''));
    return rowBranch === branch;
  });
}
