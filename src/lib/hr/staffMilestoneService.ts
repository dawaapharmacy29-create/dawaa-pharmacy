import { supabase } from '@/lib/supabase';

export type StaffMilestone = {
  id: string;
  staff_id: string;
  kind: 'onboarding' | 'document' | 'training' | 'offboarding';
  title: string;
  due_on: string | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
};

export type DueStaffMilestone = Pick<StaffMilestone, 'id' | 'staff_id' | 'kind' | 'title' | 'due_on' | 'note' | 'created_at'> & {
  staff_name: string;
  branch: string;
  days_until_due: number;
};

export async function listDueStaffMilestones(branch: string | null): Promise<DueStaffMilestone[]> {
  const { data, error } = await supabase.rpc('hr_list_due_staff_milestones_v1', {
    p_branch: branch, p_limit: 100,
  });
  if (error) throw new Error(error.message);
  return data as DueStaffMilestone[];
}

export async function listStaffMilestones(staffId: string): Promise<StaffMilestone[]> {
  const { data, error } = await supabase.rpc('hr_list_staff_milestones_v1', { p_staff_id: staffId, p_limit: 100 });
  if (error) throw new Error(error.message);
  return data as StaffMilestone[];
}

export async function createStaffMilestone(input: {
  staffId: string; kind: StaffMilestone['kind']; title: string; dueOn: string | null; note: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('hr_create_staff_milestone_v1', {
    p_staff_id: input.staffId, p_kind: input.kind, p_title: input.title,
    p_due_on: input.dueOn, p_note: input.note,
  });
  if (error) throw new Error(error.message);
}

export async function completeStaffMilestone(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('hr_complete_staff_milestone_v1', { p_id: id });
  if (error) throw new Error(error.message);
  return data === true;
}
