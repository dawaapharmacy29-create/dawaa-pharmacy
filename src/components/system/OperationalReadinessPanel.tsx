import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { getDefaultPermissionsForRole, type RoleKey } from '@/lib/core/permissionSystem';
import { supabase } from '@/lib/supabase';

type Check = { key: string; label: string; value: number | null; status: 'ready' | 'warning' | 'error'; note: string };

const ROLE_EXPECTATIONS: Array<{ role: RoleKey; label: string; permissions: string[] }> = [
  { role: 'pharmacist', label: 'الصيدلي', permissions: ['view_doctor_dashboard','view_customers','view_customer_details','create_followup','whatsapp_customer','view_schedule','view_points','view_reviews','view_stagnant_medicines'] },
  { role: 'shift_supervisor_morning', label: 'مشرف الشيفت الصباحي', permissions: ['view_doctor_dashboard','view_customers','create_followup','view_schedule','view_reviews','view_points','view_stagnant_medicines'] },
  { role: 'shift_supervisor_evening', label: 'مشرف الشيفت المسائي', permissions: ['view_doctor_dashboard','view_customers','create_followup','view_schedule','view_reviews','view_points','view_stagnant_medicines'] },
  { role: 'branch_manager', label: 'مدير الفرع', permissions: ['view_branch_dashboard','view_customers','view_customer_service','view_team','view_schedule','view_reviews','view_points'] },
  { role: 'customer_service', label: 'خدمة العملاء', permissions: ['view_customers','view_customer_details','view_customer_service','create_followup','edit_followup','view_reviews'] },
  { role: 'customer_service_manager', label: 'مدير خدمة العملاء', permissions: ['view_customers','view_customer_service','assign_followup','close_followup','view_reviews','add_reviews','view_activity_log'] },
];

async function countRows(table: string, configure?: (query: any) => any): Promise<number | null> {
  try {
    let query: any = supabase.from(table).select('*', { count: 'exact', head: true });
    if (configure) query = configure(query);
    const { count, error } = await query;
    if (error) return null;
    return Number(count || 0);
  } catch { return null; }
}

export default function OperationalReadinessPanel() {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Check[]>([]);

  const permissionAudit = useMemo(() => ROLE_EXPECTATIONS.map((item) => {
    const current = getDefaultPermissionsForRole(item.role);
    const missing = item.permissions.filter((permission) => current[permission] !== true);
    return { ...item, missing };
  }), []);

  const load = async () => {
    setLoading(true);
    const [openFollowups, unreadNotifications, pendingAssignments, draftPayroll, activeOffers] = await Promise.all([
      countRows('daily_followups', (q) => q.not('status', 'in', '(completed,closed,cancelled)')),
      countRows('notifications', (q) => q.eq('is_read', false)),
      countRows('staff_assignments', (q) => q.not('status', 'in', '(completed,cancelled)')),
      countRows('employee_monthly_statements', (q) => q.in('status', ['draft','pending_review','manager_review'])),
      countRows('offers', (q) => q.eq('active', true)),
    ]);
    setChecks([
      { key: 'followups', label: 'متابعات مفتوحة', value: openFollowups, status: openFollowups === null ? 'warning' : 'ready', note: 'تعكس ضغط العمل الحالي على خدمة العملاء.' },
      { key: 'notifications', label: 'إشعارات غير مقروءة', value: unreadNotifications, status: unreadNotifications === null ? 'warning' : unreadNotifications > 100 ? 'warning' : 'ready', note: 'ارتفاع العدد يعني أن التنبيهات تحتاج ترتيبًا ومتابعة.' },
      { key: 'assignments', label: 'مهام موظفين مفتوحة', value: pendingAssignments, status: pendingAssignments === null ? 'warning' : 'ready', note: 'يجب أن يكون لكل مهمة مسؤول وموعد واضح.' },
      { key: 'payroll', label: 'كشوف قبض تحت المراجعة', value: draftPayroll, status: draftPayroll === null ? 'warning' : 'ready', note: 'تظل المسودات غير معتمدة حتى إغلاق الدورة.' },
      { key: 'offers', label: 'عروض نشطة', value: activeOffers, status: activeOffers === null ? 'warning' : 'ready', note: 'تظهر للدكاترة في مساحة العروض والاستوريز.' },
    ]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const missingPermissionCount = permissionAudit.reduce((sum, item) => sum + item.missing.length, 0);

  return <section className="space-y-4 rounded-3xl border border-sky-400/20 bg-slate-900/80 p-5" dir="rtl">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sky-300"><ShieldCheck size={21} /><span className="font-black">جاهزية التشغيل والصلاحيات</span></div>
        <h2 className="mt-1 text-2xl font-black text-white">اختبار موحد بدون تعديل البيانات</h2>
        <p className="mt-1 text-sm text-slate-400">يراجع التغطية الافتراضية للأدوار وحالة الوحدات التشغيلية الموجودة بالفعل.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث الاختبار</button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {checks.map((check) => <div key={check.key} className={`rounded-2xl border p-4 ${check.status === 'ready' ? 'border-emerald-400/25 bg-emerald-500/10' : check.status === 'error' ? 'border-red-400/25 bg-red-500/10' : 'border-amber-400/25 bg-amber-500/10'}`}>
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-black text-white">{check.label}</span>{check.status === 'ready' ? <CheckCircle2 size={18} className="text-emerald-300" /> : <AlertTriangle size={18} className="text-amber-300" />}</div>
        <div className="mt-2 text-3xl font-black text-white">{loading ? '…' : check.value === null ? 'غير متاح' : check.value}</div>
        <p className="mt-1 text-xs leading-5 text-slate-400">{check.note}</p>
      </div>)}
    </div>

    <div className={`rounded-2xl border p-4 ${missingPermissionCount ? 'border-amber-400/25 bg-amber-500/10' : 'border-emerald-400/25 bg-emerald-500/10'}`}>
      <div className="flex items-center gap-2 font-black text-white"><Users size={19} /> اختبار تغطية الأدوار الأساسية</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {permissionAudit.map((item) => <div key={item.role} className="rounded-xl border border-white/10 bg-black/10 p-3">
          <div className="flex items-center justify-between"><span className="font-black text-white">{item.label}</span><span className={`text-xs font-black ${item.missing.length ? 'text-amber-200' : 'text-emerald-200'}`}>{item.missing.length ? `${item.missing.length} ناقصة` : 'مكتمل'}</span></div>
          {item.missing.length ? <p className="mt-2 text-xs leading-5 text-amber-100">{item.missing.join('، ')}</p> : <p className="mt-2 flex items-center gap-1 text-xs text-emerald-100"><ClipboardCheck size={14} /> الصفحات الأساسية متاحة حسب الدور.</p>}
        </div>)}
      </div>
    </div>
  </section>;
}
