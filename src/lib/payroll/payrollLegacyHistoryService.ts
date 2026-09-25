import { supabase } from '@/lib/supabase';

export type LegacyPaidPayrollHistoryRow = {
  id?: string;
  staff_username: string;
  payroll_month: string;
  deductions_total: number;
  net_salary?: number | null;
  status: string;
  approved_by_name?: string | null;
  freeze_version?: number | null;
};

/**
 * Historical compatibility only.
 * This service must never be used to calculate or edit the current payroll cycle.
 */
export async function listLegacyPaidPayrollHistory(
  username: string,
  limit = 12
): Promise<LegacyPaidPayrollHistoryRow[]> {
  const { data, error } = await supabase
    .from('staff_payroll_monthly_v13')
    .select('id,staff_username,payroll_month,deductions_total,net_salary,status,approved_by_name,freeze_version')
    .eq('staff_username', username)
    .in('status', ['approved', 'paid'])
    .order('payroll_month', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 24)));

  if (error) throw new Error(error.message);
  return (data || []) as LegacyPaidPayrollHistoryRow[];
}
