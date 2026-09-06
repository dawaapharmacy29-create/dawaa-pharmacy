import { useCallback, useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, CheckCircle2, CircleDollarSign, ClipboardList, History, Loader2, ShieldCheck, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';

type EmploymentEvent = {
  id: string;
  event_type: string;
  effective_date: string;
  title: string;
  description?: string | null;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  source?: string;
  created_by_name?: string | null;
};

type PayrollRow = {
  month?: string;
  cycle_start?: string;
  cycle_end?: string;
  worked_hours?: number;
  overtime_hours?: number;
  target_bonus?: number;
  quarterly_bonus?: number;
  incentives_total?: number;
  deductions_total?: number;
  manual_adjustment?: number;
  net_salary?: number;
  status?: string;
  approved_at?: string | null;
  paid_at?: string | null;
};

type IncentiveRow = {
  cycle_start: string;
  cycle_end: string;
  cycle_status?: string;
  performance_score?: number;
  performance_incentive?: number;
  target_bonus?: number;
  other_incentives?: number;
  deductions?: number;
  total_incentive?: number;
  eligible?: boolean;
};

type HR360 = {
  staff: { id: string; name: string; role?: string; branch?: string; join_date?: string; status?: string; is_active?: boolean; shift?: string; day_off?: string };
  employment_timeline: EmploymentEvent[];
  task_summary: { total?: number; completed?: number; open?: number; last_30_days?: number; recent?: Array<{ date: string; title: string; status?: string; priority?: string }> };
  incentive_history: IncentiveRow[];
  salary_access: boolean;
  current_compensation?: { base_salary?: number; hourly_rate?: number; target_bonus_amount?: number; quarterly_bonus_amount?: number; active?: boolean; updated_at?: string } | null;
  salary_history?: Array<{ effective_from: string; base_salary?: number; hourly_rate?: number; target_bonus_amount?: number; quarterly_bonus_amount?: number; reason?: string }> | null;
  payroll_history?: PayrollRow[] | null;
};

const EVENT_LABELS: Record<string, string> = {
  hire: 'تعيين', promotion: 'ترقية', role_change: 'تغيير دور', branch_transfer: 'نقل فرع', status_change: 'تغيير حالة',
  warning: 'إنذار', commendation: 'إشادة', training: 'تدريب', responsibility_change: 'تغيير مهام', contract_update: 'تحديث تعاقد', note: 'ملاحظة إدارية',
};

function daysBetween(date?: string) {
  if (!date) return null;
  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}

export default function StaffHR360Panel({ staffId }: { staffId: string }) {
  const [data, setData] = useState<HR360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: payload, error: rpcError } = await supabase.rpc('get_staff_hr_360_v1', { p_staff_id: staffId });
    if (rpcError) setError(rpcError.message);
    else setData(payload as HR360);
    setLoading(false);
  }, [staffId]);

  useEffect(() => { void load(); }, [load]);

  const serviceDays = useMemo(() => daysBetween(data?.staff.join_date), [data?.staff.join_date]);
  const latestIncentive = data?.incentive_history?.[0];
  const latestPayroll = data?.payroll_history?.[0];

  if (loading) return <div className="dawaa-card flex items-center justify-center gap-2 p-10 dawaa-muted"><Loader2 className="animate-spin" size={18}/>جاري تحميل ملف الموارد البشرية 360°...</div>;
  if (error || !data) return <div className="dawaa-card p-6 text-sm text-red-300">تعذر تحميل ملف HR 360°: {error || 'بيانات غير متاحة'}</div>;

  return <div className="space-y-5" dir="rtl">
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Kpi icon={CalendarDays} label="تاريخ التعيين" value={data.staff.join_date || 'غير مسجل'} />
      <Kpi icon={History} label="مدة الخدمة" value={serviceDays == null ? 'غير محسوبة' : serviceDays < 365 ? `${serviceDays} يوم` : `${(serviceDays/365.25).toFixed(1)} سنة`} />
      <Kpi icon={BriefcaseBusiness} label="الدور الحالي" value={data.staff.role || '-'} />
      <Kpi icon={ClipboardList} label="مهام آخر 30 يوم" value={String(data.task_summary?.last_30_days || 0)} />
      <Kpi icon={ShieldCheck} label="الحالة" value={data.staff.is_active ? 'نشط' : 'غير نشط'} />
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="dawaa-card p-5">
        <h3 className="dawaa-title flex items-center gap-2 text-base"><History size={18}/>المسار الوظيفي والترقيات</h3>
        <p className="dawaa-muted mt-1 text-xs">تاريخ التعيين، الترقيات، تغيير الدور، النقل، التدريب، الإنذارات وتغيير المسؤوليات في سجل غير قابل للمسح أو التعديل.</p>
        <div className="mt-4 space-y-3">
          {data.employment_timeline.length === 0 ? <div className="dawaa-muted text-sm">لا يوجد تاريخ وظيفي مسجل بعد.</div> : data.employment_timeline.map((e) => <div key={e.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black">{e.title}</div><span className="dawaa-badge dawaa-badge--info">{EVENT_LABELS[e.event_type] || e.event_type}</span></div>
            <div className="dawaa-muted mt-1 text-xs">{e.effective_date}{e.created_by_name ? ` • بواسطة ${e.created_by_name}` : ''}</div>
            {e.description && <div className="mt-2 text-sm">{e.description}</div>}
          </div>)}
        </div>
      </div>

      <div className="dawaa-card p-5">
        <h3 className="dawaa-title flex items-center gap-2 text-base"><ClipboardList size={18}/>المهام والمسؤوليات الفعلية</h3>
        <div className="mt-4 grid grid-cols-3 gap-2"><Mini label="إجمالي المهام" value={data.task_summary?.total || 0}/><Mini label="مكتملة" value={data.task_summary?.completed || 0}/><Mini label="مفتوحة" value={data.task_summary?.open || 0}/></div>
        <div className="mt-4 space-y-2">{(data.task_summary?.recent || []).slice(0,12).map((t, i) => <div key={`${t.date}-${i}`} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3"><div><div className="font-bold text-sm">{t.title}</div><div className="dawaa-muted text-xs">{t.date} • {t.priority || 'عادي'}</div></div><span className="dawaa-badge">{t.status || '-'}</span></div>)}</div>
      </div>
    </section>

    <section className="dawaa-card p-5">
      <h3 className="dawaa-title flex items-center gap-2 text-base"><TrendingUp size={18}/>تاريخ الحوافز</h3>
      {latestIncentive && <div className="mt-4 grid gap-3 md:grid-cols-4"><Mini label="آخر تقييم" value={`${latestIncentive.performance_score ?? 0}%`}/><Mini label="حافز الأداء" value={formatCurrency(latestIncentive.performance_incentive || 0)}/><Mini label="حافز التارجت" value={formatCurrency(latestIncentive.target_bonus || 0)}/><Mini label="إجمالي الحافز" value={formatCurrency(latestIncentive.total_incentive || 0)}/></div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="dawaa-muted text-right"><th className="p-2">الدورة</th><th className="p-2">الأداء</th><th className="p-2">حافز الأداء</th><th className="p-2">التارجت</th><th className="p-2">خصومات</th><th className="p-2">الإجمالي</th></tr></thead><tbody>{data.incentive_history.slice(0,18).map((r, i)=><tr key={`${r.cycle_start}-${i}`} className="border-t border-[var(--dawaa-theme-border)]"><td className="p-2">{r.cycle_start} ← {r.cycle_end}</td><td className="p-2">{r.performance_score ?? '-'}</td><td className="p-2">{formatCurrency(r.performance_incentive || 0)}</td><td className="p-2">{formatCurrency(r.target_bonus || 0)}</td><td className="p-2">{formatCurrency(r.deductions || 0)}</td><td className="p-2 font-black">{formatCurrency(r.total_incentive || 0)}</td></tr>)}</tbody></table></div>
    </section>

    <section className="dawaa-card p-5">
      <h3 className="dawaa-title flex items-center gap-2 text-base"><CircleDollarSign size={18}/>الراتب والسجل المالي</h3>
      {!data.salary_access ? <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-4 text-sm dawaa-muted">بيانات الراتب حساسة، وتظهر فقط لمن لديه صلاحية إدارة الرواتب.</div> : <>
        <div className="mt-4 grid gap-3 md:grid-cols-4"><Mini label="الراتب الأساسي" value={formatCurrency(data.current_compensation?.base_salary || 0)}/><Mini label="أجر الساعة" value={formatCurrency(data.current_compensation?.hourly_rate || 0)}/><Mini label="حافز التارجت القياسي" value={formatCurrency(data.current_compensation?.target_bonus_amount || 0)}/><Mini label="آخر صافي مرتب" value={formatCurrency(latestPayroll?.net_salary || 0)}/></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="dawaa-muted text-right"><th className="p-2">الشهر</th><th className="p-2">ساعات</th><th className="p-2">إضافي</th><th className="p-2">حوافز</th><th className="p-2">خصومات</th><th className="p-2">صافي الراتب</th><th className="p-2">الحالة</th></tr></thead><tbody>{(data.payroll_history || []).slice(0,24).map((r,i)=><tr key={`${r.month}-${i}`} className="border-t border-[var(--dawaa-theme-border)]"><td className="p-2">{r.month || r.cycle_start || '-'}</td><td className="p-2">{r.worked_hours ?? 0}</td><td className="p-2">{r.overtime_hours ?? 0}</td><td className="p-2">{formatCurrency((r.incentives_total || 0)+(r.target_bonus || 0)+(r.quarterly_bonus || 0))}</td><td className="p-2">{formatCurrency(r.deductions_total || 0)}</td><td className="p-2 font-black">{formatCurrency(r.net_salary || 0)}</td><td className="p-2">{r.status || '-'}</td></tr>)}</tbody></table></div>
        <div className="mt-5"><div className="mb-2 text-sm font-black">تاريخ تغييرات الراتب</div><div className="space-y-2">{(data.salary_history || []).map((r,i)=><div key={`${r.effective_from}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3"><div><div className="font-bold">{r.effective_from} — {r.reason || 'تغيير راتب'}</div><div className="dawaa-muted text-xs">راتب أساسي {formatCurrency(r.base_salary || 0)} • أجر الساعة {formatCurrency(r.hourly_rate || 0)}</div></div><CheckCircle2 size={17} className="dawaa-muted"/></div>)}</div></div>
      </>}
    </section>
  </div>;
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: string }) { return <div className="dawaa-card p-4"><div className="dawaa-muted flex items-center gap-2 text-xs font-bold"><Icon size={16}/>{label}</div><div className="dawaa-title mt-2 text-lg">{value}</div></div>; }
function Mini({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3"><div className="dawaa-muted text-xs font-bold">{label}</div><div className="dawaa-title mt-1 text-base">{value}</div></div>; }
