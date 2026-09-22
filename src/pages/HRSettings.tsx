import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Fingerprint, ShieldCheck, SlidersHorizontal, Users, WalletCards } from 'lucide-react';

const settings = [
  {
    title: 'الأدوار والصلاحيات',
    description: 'من يرى الحضور، من يراجع الاستثناءات، ومن يعتمد الرواتب أو الأوفر تايم.',
    href: '/roles-permissions',
    icon: ShieldCheck,
  },
  {
    title: 'إدارة الموظفين',
    description: 'الهوية الموحدة، الفرع الأساسي، الدور، والحساب المرتبط بالموظف.',
    href: '/team',
    icon: Users,
  },
  {
    title: 'الجداول والمناوبات',
    description: 'مصدر جدول العمل الفعلي والإصدارات والتغييرات التاريخية.',
    href: '/schedule',
    icon: Calendar,
  },
  {
    title: 'حوكمة البصمة',
    description: 'صحة الأجهزة، الأكواد، الربط، ومكان البصمة الحقيقي.',
    href: '/attendance-report?tab=sync',
    icon: Fingerprint,
  },
  {
    title: 'الرواتب والتعويضات',
    description: 'ملفات التعويضات وجاهزية الحضور قبل الحساب المالي.',
    href: '/staff-payroll',
    icon: WalletCards,
  },
];

export default function HRSettings() {
  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex items-center gap-2 text-[var(--dawaa-theme-primary-strong)]">
          <SlidersHorizontal size={18} />
          <span className="text-xs font-black">HR Governance</span>
        </div>
        <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">إعدادات الموارد البشرية</h1>
        <p className="mt-1 max-w-3xl text-sm font-bold text-[var(--dawaa-theme-muted)]">
          واجهة حوكمة موحدة للإعدادات الموجودة بالفعل. أي سياسة جديدة للحضور أو الأوفر تايم يجب أن تُبنى كمصدر Canonical واحد، وليس قواعد متفرقة داخل الشاشات.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {settings.map(({ title, description, href, icon: Icon }) => (
          <Link key={title} to={href} className="group rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2 text-[var(--dawaa-theme-primary-strong)]"><Icon size={18} /></span>
              <ArrowLeft size={15} className="text-[var(--dawaa-theme-muted)] transition group-hover:-translate-x-1" />
            </div>
            <div className="mt-3 font-black text-[var(--dawaa-theme-heading)]">{title}</div>
            <div className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">{description}</div>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4">
        <h2 className="font-black text-[var(--dawaa-theme-heading)]">سياسات الحضور — الهيكل المستهدف</h2>
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
          هذه ليست إعدادات مالية مفعلة تلقائيًا بعد. هي عقد التصميم الذي سنبني عليه Policy Engine واحد بدل تكرار القواعد في أكثر من RPC.
        </p>
        <div className="mt-3 grid gap-2 text-xs font-bold text-[var(--dawaa-theme-text)] sm:grid-cols-2 xl:grid-cols-3">
          {[
            'ساعات العمل المتوقعة',
            'Grace period للدخول',
            'Grace period للخروج',
            'نافذة الشيفت قبل/بعد',
            'Minimum full-day hours',
            'Maximum payable hours',
            'قواعد الشيفت الليلي',
            'Auto checkout tolerance',
            'سياسة الغياب',
            'سياسة التأخير والخروج المبكر',
            'OT eligibility',
            'Rounding rules',
          ].map((item) => (
            <div key={item} className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] p-3">{item}</div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        ترتيب التطبيق المستهدف للسياسات: موظف ← دور ← نوع توظيف ← فرع ← السياسة الافتراضية. الأكثر تحديدًا يتغلب على العامة، وكل تغيير تاريخي يكون Effective-dated.
      </section>
    </div>
  );
}
