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
  } catch {
    return null;
  }
}

function checkTone(status: Check['status']) {
  if (status === 'ready') return 'dawaa-badge--success';
  if (status === 'error') return 'dawaa-badge--danger';
  return 'dawaa-badge--warning';
}

export default function OperationalReadinessPanel() {
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Check[]>([]);

  const permissionAudit = useMemo(
    () =>
      ROLE_EXPECTATIONS.map((item) => {
        const current = getDefaultPermissionsForRole(item.role);
        const missing = item.permissions.filter((permission) => current[permission] !== true);
        return { ...item, missing };
      }),
    []
  );

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

  useEffect(() => {
    void load();
  }, []);

  const missingPermissionCount = permissionAudit.reduce((sum, item) => sum + item.missing.length, 0);

  return (
    <section className="dawaa-card dawaa-card--raised space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="dawaa-icon-tile h-9 w-9"><ShieldCheck size={19} /></div>
            <span className="dawaa-title text-sm">جاهزية التشغيل والصلاحيات</span>
          </div>
          <h2 className="dawaa-title mt-2 text-2xl">اختبار موحد بدون تعديل البيانات</h2>
          <p className="dawaa-caption mt-1">يراجع التغطية الافتراضية للأدوار وحالة الوحدات التشغيلية الموجودة بالفعل.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="dawaa-button dawaa-button--secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث الاختبار
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {checks.map((check) => (
          <div key={check.key} className="dawaa-card dawaa-card--soft p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="dawaa-title text-sm">{check.label}</span>
              <span className={`dawaa-badge ${checkTone(check.status)}`}>
                {check.status === 'ready' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {check.status === 'ready' ? 'جاهز' : check.status === 'error' ? 'خطأ' : 'مراجعة'}
              </span>
            </div>
            <div className="dawaa-title mt-3 text-3xl">{loading ? '…' : check.value === null ? 'غير متاح' : check.value}</div>
            <p className="dawaa-caption mt-2 text-xs leading-5">{check.note}</p>
          </div>
        ))}
      </div>

      <div className="dawaa-card dawaa-card--soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={19} className="dawaa-muted" />
            <span className="dawaa-title text-sm">اختبار تغطية الأدوار الأساسية</span>
          </div>
          <span className={`dawaa-badge ${missingPermissionCount ? 'dawaa-badge--warning' : 'dawaa-badge--success'}`}>
            {missingPermissionCount ? `${missingPermissionCount} صلاحية تحتاج مراجعة` : 'التغطية مكتملة'}
          </span>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {permissionAudit.map((item) => (
            <div key={item.role} className="dawaa-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="dawaa-title text-sm">{item.label}</span>
                <span className={`dawaa-badge ${item.missing.length ? 'dawaa-badge--warning' : 'dawaa-badge--success'}`}>
                  {item.missing.length ? `${item.missing.length} ناقصة` : 'مكتمل'}
                </span>
              </div>
              {item.missing.length ? (
                <p className="dawaa-caption mt-2 text-xs leading-5">{item.missing.join('، ')}</p>
              ) : (
                <p className="dawaa-caption mt-2 flex items-center gap-1 text-xs">
                  <ClipboardCheck size={14} /> الصفحات الأساسية متاحة حسب الدور.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
