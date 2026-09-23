import { supabase } from '@/lib/supabase';

export interface PaidStatement {
  id: string; staff_id: string; staff_name: string; branch: string; month_cycle: string;
  cycle_start: string; cycle_end: string; approved_at: string; paid_at: string;
  freeze_version: number; worked_hours: number; overtime_hours: number;
  net_salary: number; snapshot: {
    payroll_components: Record<string, number>;
    automated_incentives: Record<string, number>;
    compensation_components?: Record<string, unknown>;
  };
}

export async function getPaidStatement(staffId: string, monthCycle: string): Promise<PaidStatement> {
  const { data, error } = await supabase.rpc('get_paid_payroll_statement_v1', {
    p_staff_id: staffId, p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  if (!data?.snapshot?.payroll_components || !data?.snapshot?.automated_incentives) {
    throw new Error('بيانات الكشف المعتمد غير مكتملة.');
  }
  return data as PaidStatement;
}

export async function listMyPaidStatements(): Promise<{month_cycle:string;cycle_start:string;cycle_end:string;net_salary:number}[]> {
  const {data,error}=await supabase.rpc('list_my_paid_payroll_statements_v1');
  if(error)throw new Error(error.message);
  return data as {month_cycle:string;cycle_start:string;cycle_end:string;net_salary:number}[];
}
