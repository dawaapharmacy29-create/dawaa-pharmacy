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
    <main className="space-y-6 text-slate-100" dir="rtl">
      <section className="rounded-2xl border border-teal-400/20 bg-slate-900 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">لوحة القيادة 2027</h1>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              الداشبورد يعمل الآن في وضع الأمان حتى لا تظهر صفحة فارغة أثناء مراجعة الداشبورد المتقدم.
            </p>
          </div>
          <Link
            to="/diagnostics"
            className="rounded-xl bg-teal-600 px-4 py-3 text-center text-sm font-black text-white hover:bg-teal-500"
          >
            فتح التشخيص
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {healthCards.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-xs font-bold text-slate-400">{label}</div>
            <div className="mt-2 break-words text-lg font-black text-white">{value}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-xl font-black text-white">روابط سريعة</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950 px-4 py-4 text-sm font-black text-slate-100 transition hover:border-teal-400/50 hover:bg-slate-800"
              >
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-teal-300" />
                <span>
                  <span className="block">{item.label}</span>
                  <span className="mt-1 block text-xs font-bold text-slate-400">{item.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {['المبيعات', 'الفواتير', 'العملاء', 'خدمة العملاء', 'الموظفين', 'التنبيهات'].map((section) => (
          <div key={section} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm font-black text-white">{section}</div>
            <p className="mt-2 text-sm leading-7 text-slate-400">
              هذا القسم معزول مؤقتًا عن الاستعلامات الثقيلة. استخدم الروابط السريعة للوصول للصفحة المتخصصة.
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
