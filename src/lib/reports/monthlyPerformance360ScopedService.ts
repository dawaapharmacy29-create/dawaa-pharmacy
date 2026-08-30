import { supabase } from '@/lib/supabase';
import {
  loadMonthlyPerformance360,
  type MonthlyPerformance360Report,
} from '@/lib/reports/monthlyPerformance360Service';

export async function loadScopedMonthlyPerformance360(args: {
  actorId: string;
  staffId: string;
  cycleLabel: string;
}): Promise<MonthlyPerformance360Report> {
  const { data, error } = await supabase.rpc('can_view_monthly_performance_360_safe', {
    p_actor_id: args.actorId,
    p_staff_id: args.staffId,
  });

  if (error) throw new Error(`تعذر التحقق من صلاحية تقرير 360°: ${error.message}`);
  if (data !== true) throw new Error('ليس لديك صلاحية لعرض تقرير هذا الموظف.');

  return loadMonthlyPerformance360(args);
}
