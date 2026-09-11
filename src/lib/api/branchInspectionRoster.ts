import { supabase } from '@/lib/supabase';
import { filterActiveStaffRows } from '@/lib/staffActiveFilter';

export type BranchInspectionRosterRow = Record<string, any>;

export interface BranchInspectionRosterSources {
  staffRows: BranchInspectionRosterRow[];
  scheduleRows: BranchInspectionRosterRow[];
}

export async function loadBranchInspectionRosterSources(params: {
  branch: string;
  dayName: string;
}): Promise<BranchInspectionRosterSources> {
  const [staffResult, scheduleResult] = await Promise.all([
    supabase
      .from('staff')
      .select('id,name,role,branch,active,is_active,status,deleted_at,is_deleted')
      .eq('branch', params.branch)
      .limit(300),
    supabase
      .from('shift_schedules')
      .select('id,staff_id,staff_name,role,branch,day_name,shift_start,shift_end,start_time,end_time,is_off,status')
      .eq('branch', params.branch)
      .eq('day_name', params.dayName)
      .limit(300),
  ]);

  if (staffResult.error) {
    throw new Error(`تعذر تحميل موظفي الفرع: ${staffResult.error.message}`);
  }
  if (scheduleResult.error) {
    throw new Error(`تعذر تحميل جدول اليوم: ${scheduleResult.error.message}`);
  }

  return {
    staffRows: filterActiveStaffRows((staffResult.data || []) as BranchInspectionRosterRow[]),
    scheduleRows: (scheduleResult.data || []) as BranchInspectionRosterRow[],
  };
}
