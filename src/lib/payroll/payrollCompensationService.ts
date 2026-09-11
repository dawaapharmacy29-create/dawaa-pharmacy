import { supabase } from '@/lib/supabase';

export type PayrollListItem = {
  medicineId: string;
  productName: string;
  quantity: number;
  incentivePerUnit: number;
  incentiveTotal: number;
};

export type PayrollComponents = {
  engineVersion: number;
  staffId: string;
  staffUsername: string;
  staffName: string;
  branch: string;
  monthCycle: string;
  salaryCalculationMode: 'legacy_fixed' | 'monthly_hour_unit';
  monthlyHourUnitValue: number;
  contractedDailyHours: number;
  baseSalaryComponent: number;
  monthlyIncentiveComponent: number;
  overtimeHourRate: number;
  listIncentiveComponent: number;
  listItems: PayrollListItem[];
  targetBonusComponent: number;
  performanceIncentiveComponent: number;
  automatedIncentivesTotal: number;
  quarterlyIncentiveArchived: boolean;
};

export type CompensationProfileInput = {
  staffId: string;
  staffName: string;
  branch: string;
  salaryCalculationMode: 'legacy_fixed' | 'monthly_hour_unit';
  monthlyHourUnitValue: number;
  contractedDailyHours: number;
  monthlyBaseSalary: number;
  overtimeHourRate: number;
  monthlyIncentiveBase: number;
};

const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function fetchPayrollComponents(staffId?: string | null, monthCycle?: string | null): Promise<PayrollComponents | null> {
  if (!staffId || !monthCycle) return null;
  const { data, error } = await supabase.rpc('get_payroll_components_v17', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') return null;
  const row: any = data;
  return {
    engineVersion: number(row.engine_version || 17),
    staffId: String(row.staff_id || staffId),
    staffUsername: String(row.staff_username || ''),
    staffName: String(row.staff_name || ''),
    branch: String(row.branch || ''),
    monthCycle: String(row.month_cycle || monthCycle),
    salaryCalculationMode: row.salary_calculation_mode === 'monthly_hour_unit' ? 'monthly_hour_unit' : 'legacy_fixed',
    monthlyHourUnitValue: number(row.monthly_hour_unit_value),
    contractedDailyHours: number(row.contracted_daily_hours),
    baseSalaryComponent: number(row.base_salary_component),
    monthlyIncentiveComponent: number(row.monthly_incentive_component),
    overtimeHourRate: number(row.overtime_hour_rate),
    listIncentiveComponent: number(row.list_incentive_component),
    listItems: Array.isArray(row.list_items)
      ? row.list_items.map((item: any) => ({
          medicineId: String(item.medicine_id || ''),
          productName: String(item.product_name || ''),
          quantity: number(item.quantity),
          incentivePerUnit: number(item.incentive_per_unit),
          incentiveTotal: number(item.incentive_total),
        }))
      : [],
    targetBonusComponent: number(row.target_bonus_component),
    performanceIncentiveComponent: number(row.performance_incentive_component),
    automatedIncentivesTotal: number(row.automated_incentives_total),
    quarterlyIncentiveArchived: row.quarterly_incentive_archived !== false,
  };
}

export async function fetchCompensationProfile(staffId?: string | null) {
  if (!staffId) return null;
  const { data, error } = await supabase
    .from('employee_compensation_profiles')
    .select('staff_id,staff_name,branch,salary_calculation_mode,monthly_hour_unit_value,contracted_daily_hours,monthly_base_salary,overtime_hour_rate,monthly_incentive_base,active')
    .eq('staff_id', staffId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveCompensationProfile(input: CompensationProfileInput) {
  const { error } = await supabase.from('employee_compensation_profiles').upsert({
    staff_id: input.staffId,
    staff_name: input.staffName,
    branch: input.branch,
    salary_calculation_mode: input.salaryCalculationMode,
    monthly_hour_unit_value: number(input.monthlyHourUnitValue),
    contracted_daily_hours: number(input.contractedDailyHours),
    monthly_base_salary: number(input.monthlyBaseSalary),
    overtime_hour_rate: number(input.overtimeHourRate),
    monthly_incentive_base: number(input.monthlyIncentiveBase),
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'staff_id' });
  if (error) throw new Error(error.message);
}
