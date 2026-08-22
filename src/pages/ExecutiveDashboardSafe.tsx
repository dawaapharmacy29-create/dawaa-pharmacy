import {
  ActivitySquare,
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  Headphones,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const quickLinks = [
  { label: 'متابعة العملاء', href: '/customer-service', icon: Headphones, hint: 'فتح مركز خدمة العملاء' },
  { label: 'مراجعة بيانات العملاء', href: '/customer-data-review', icon: ClipboardCheck, hint: 'تنظيف ومراجعة بيانات العملاء' },
  { label: 'حسابات الموظفين', href: '/staff-accounts', icon: ShieldCheck, hint: 'صلاحيات وحسابات الفريق' },
  { label: 'تقرير الحضور', href: '/attendance-report', icon: Users, hint: 'متابعة الحضور والانصراف' },
  { label: 'سجل الأنشطة', href: '/activity-log', icon: ActivitySquare, hint: 'تتبع العمليات المهمة' },
  { label: 'مركز التقارير', href: '/reports', icon: BarChart3, hint: 'تقارير تشغيلية سريعة' },
  { label: 'الفواتير', href: '/invoices', icon: FileSpreadsheet, hint: 'استيراد ومراجعة الفواتير' },
];

export default function ExecutiveDashboardSafe() {
  const { user } = useAuth();
  const loadedAt = new Date().toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

  const healthCards = [
    ['المستخدم الحالي', user?.name || 'غير مسجل'],
    ['الفرع', user?.branch || 'غير محدد'],
    ['الدور', user?.role || 'غير محدد'],
    ['وقت التحميل', loadedAt],
  ];

  return (
    <main className="dawaa-page space-y-6" dir="rtl">
      <section className="dawaa-card dawaa-card--raised p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-3xl">لوحة القيادة 2027</h1>
            <p className="dawaa-caption mt-2 leading-7">
              الداشبورد يعمل الآن في وضع الأمان حتى لا تظهر صفحة فارغة أثناء مراجعة الداشبورد المتقدم.
            </p>
          </div>
          <Link to="/diagnostics" className="dawaa-button dawaa-button--primary text-center text-sm">
            فتح التشخيص
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {healthCards.map(([label, value]) => (
          <div key={label} className="dawaa-card p-5">
            <div className="dawaa-caption text-xs font-bold">{label}</div>
            <div className="dawaa-title mt-2 break-words text-lg">{value}</div>
          </div>
        ))}
      </section>

      <section className="dawaa-card p-5">
        <h2 className="dawaa-title text-xl">روابط سريعة</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className="dawaa-card dawaa-card--interactive flex items-start gap-3 px-4 py-4 text-sm font-black"
              >
                <span className="dawaa-icon-tile mt-0.5 h-9 w-9 flex-shrink-0">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="dawaa-title block text-sm">{item.label}</span>
                  <span className="dawaa-caption mt-1 block text-xs font-bold">{item.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {['المبيعات', 'الفواتير', 'العملاء', 'خدمة العملاء', 'الموظفين', 'التنبيهات'].map((section) => (
          <div key={section} className="dawaa-card p-5">
            <div className="dawaa-title text-sm">{section}</div>
            <p className="dawaa-caption mt-2 leading-7">
              هذا القسم معزول مؤقتًا عن الاستعلامات الثقيلة. استخدم الروابط السريعة للوصول للصفحة المتخصصة.
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
