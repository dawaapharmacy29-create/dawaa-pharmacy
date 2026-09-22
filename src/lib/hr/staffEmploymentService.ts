import { supabase } from '@/lib/supabase';

export type StaffEmploymentRecord = {
  id: string;
  staff_id: string;
  record_kind: 'contract' | 'renewal' | 'assignment' | 'correction';
  title: string;
  effective_from: string;
  effective_to: string | null;
  reference_code: string | null;
  note: string | null;
  supersedes_id: string | null;
  is_superseded: boolean;
  created_at: string;
  created_by_name: string | null;
};

export async function listStaffEmploymentRecords(staffId: string): Promise<StaffEmploymentRecord[]> {
  const { data, error } = await supabase.rpc('hr_list_staff_employment_records_v1', {
    p_staff_id: staffId, p_limit: 100,
  });
  if (error) throw new Error(error.message);
  return data as StaffEmploymentRecord[];
}

export async function createStaffEmploymentRecord(input: {
  staffId: string; kind: StaffEmploymentRecord['record_kind']; title: string;
  effectiveFrom: string; effectiveTo: string | null; referenceCode: string | null;
  note: string | null; supersedesId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('hr_create_staff_employment_record_v1', {
    p_staff_id: input.staffId, p_record_kind: input.kind, p_title: input.title,
    p_effective_from: input.effectiveFrom, p_effective_to: input.effectiveTo,
    p_reference_code: input.referenceCode, p_note: input.note,
    p_supersedes_id: input.supersedesId,
  });
  if (error) throw new Error(error.message);
}
