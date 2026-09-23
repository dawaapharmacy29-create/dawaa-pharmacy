import { supabase } from '@/lib/supabase';

export type EmploymentProfileVersion = {
  id: string;
  staff_id: string;
  effective_from: string;
  employment_type: 'full_time' | 'part_time' | 'temporary' | 'contractor';
  grade_label: string | null;
  reports_to_staff_id: string | null;
  manager_name: string | null;
  change_reason: string | null;
  supersedes_id: string | null;
  is_superseded: boolean;
  created_at: string;
  created_by_name: string | null;
};

export type EmploymentProfileTimeline = {
  current: EmploymentProfileVersion | null;
  history: EmploymentProfileVersion[];
  as_of: string;
};

export async function getEmploymentProfileTimeline(staffId: string, asOf: string): Promise<EmploymentProfileTimeline> {
  const { data, error } = await supabase.rpc('hr_get_employment_profile_timeline_v1', {
    p_staff_id: staffId, p_as_of: asOf,
  });
  if (error) throw new Error(error.message);
  return data as EmploymentProfileTimeline;
}

export async function createEmploymentProfileVersion(input: {
  staffId: string; effectiveFrom: string; employmentType: EmploymentProfileVersion['employment_type'];
  gradeLabel: string | null; managerStaffId: string | null; changeReason: string | null; supersedesId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('hr_create_employment_profile_version_v1', {
    p_staff_id: input.staffId, p_effective_from: input.effectiveFrom,
    p_employment_type: input.employmentType, p_grade_label: input.gradeLabel,
    p_reports_to_staff_id: input.managerStaffId, p_change_reason: input.changeReason,
    p_supersedes_id: input.supersedesId,
  });
  if (error) throw new Error(error.message);
}
