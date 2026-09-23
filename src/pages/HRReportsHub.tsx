import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, CalendarDays, Clock, FileSpreadsheet, Fingerprint, Star, Users, WalletCards } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canManageBiometricOperations, getRoutePermissions } from '@/lib/core/permissionSystem';

const reports = [
  { title: 'تقرير الحضور الشهري', description: 'أيام الحضور الفعلية، التأخير، الغياب المعلق، والساعات.', href: '/attendance-report?tab=report', icon: Clock },
  { title: 'جاهزية الحضور للمرتب', description: 'الساعات المعتمدة والـdrift قبل إدخالها في المرتبات.', href: '/attendance-report?tab=report&section=payroll-truth', icon: WalletCards },
  { title: 'العمل الإضافي', description: 'Worked OT مقابل Approved OT والحالات المعلقة.', href: '/attendance-report?tab=overtime', icon: Clock },
  { title: 'الإجازات والأذونات', description: 'الطلبات، الاعتمادات، والأرصدة وربطها بالحضور.', href: '/time-off', icon: CalendarDays },
  { title: 'العمل بين الفروع', description: 'الفرع الأساسي مقابل مكان البصمة الحقيقي.', href: '/attendance-report?tab=cross-branch', icon: Users },
  { title: 'صحة أجهزة البصمة', description: 'Bridge، Watermark، آخر اتصال، والتنبيهات الحالية.', href: '/attendance-report?tab=sync', icon: Fingerprint },
  { title: 'مؤشرات الموظف', description: 'مؤشرات الأداء والتشغيل على مستوى الموظف.', href: '/employee-kpi', icon: BarChart3 },
  { title: 'التقييم الشهري', description: 'التقييمات الشهرية الحالية للموظفين.', href: '/staff-monthly-evaluation', icon: Star },
  { title: 'الحوافز الشهرية', description: 'تقارير الحوافز والنتائج الشهرية.', href: '/monthly-incentive-report', icon: WalletCards },
  { title: 'مركز التقارير العام', description: 'التقارير التشغيلية والمالية الأخرى في تطبيق الإدارة.', href: '/reports', icon: FileSpreadsheet },
];

export default function HRReportsHub() {
  const { user, checkPermission } = useAuth();
  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">HR Reports</div>
        <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">تقارير الموارد البشرية</h1>
        <p className="mt-1 max-w-3xl text-sm font-bold text-[var(--dawaa-theme-muted)]">
          مدخل موحد للتقارير الموجودة بالفعل. لا نكرر محركات الحساب؛ كل تقرير يقرأ من مصدر الحقيقة الخاص به.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reports.filter(({ href }) => (href !== '/attendance-report?tab=sync' || canManageBiometricOperations(user?.role)) && (getRoutePermissions(href.split('?')[0])?.some(checkPermission) ?? true)).map(({ title, description, href, icon: Icon }) => (
          <Link key={title} to={href} className="group rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2 text-[var(--dawaa-theme-primary-strong)]"><Icon size={18} /></span>
              <ArrowLeft size={15} className="text-[var(--dawaa-theme-muted)] transition group-hover:-translate-x-1" />
            </div>
            <div className="mt-3 font-black text-[var(--dawaa-theme-heading)]">{title}</div>
            <div className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">{description}</div>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        التقارير التاريخية لا تُستخدم لإعادة كتابة Attendance Truth أو Payroll المدفوع. أي تعديل لاحق يجب أن يمر من مسار مراجعة وتسوية موثق.
      </section>
    </div>
  );
}
