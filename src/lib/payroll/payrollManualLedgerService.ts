import { supabase } from '@/lib/supabase';

export type PayrollManualEntryKind = 'earning' | 'deduction' | 'adjustment';
export type PayrollManualEntryCategory = 'attendance' | 'incentive' | 'expiry_shortage' | 'branch_general' | 'individual' | 'deduction' | 'salary' | 'other';

export type PayrollManualEntry = {
  id: string;
  staff_id: string;
  month_cycle: string;
  entry_kind: PayrollManualEntryKind;
  category: PayrollManualEntryCategory;
  amount: number;
  signed_amount: number;
  reason: string;
  reference_note: string | null;
  reversal_of: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export async function listPayrollManualEntries(staffId: string, monthCycle: string): Promise<PayrollManualEntry[]> {
  const { data, error } = await supabase.rpc('list_staff_payroll_manual_entries_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
    p_limit: 200,
  });
  if (error) throw new Error(error.message);
  return (data || []) as PayrollManualEntry[];
}

export async function createPayrollManualEntry(input: {
  staffId: string;
  monthCycle: string;
  kind: PayrollManualEntryKind;
  category: PayrollManualEntryCategory;
  amount: number;
  reason: string;
  referenceNote?: string | null;
}): Promise<PayrollManualEntry> {
  const { data, error } = await supabase.rpc('create_staff_payroll_manual_entry_v1', {
    p_staff_id: input.staffId,
    p_month_cycle: input.monthCycle,
    p_entry_kind: input.kind,
    p_category: input.category,
    p_amount: input.amount,
    p_reason: input.reason,
    p_reference_note: input.referenceNote || null,
  });
  if (error) throw new Error(error.message);
  return data as PayrollManualEntry;
}

export async function reversePayrollManualEntry(entryId: string, reason: string): Promise<PayrollManualEntry> {
  const { data, error } = await supabase.rpc('reverse_staff_payroll_manual_entry_v1', {
    p_entry_id: entryId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as PayrollManualEntry;
}
