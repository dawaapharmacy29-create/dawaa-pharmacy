import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Fingerprint, RefreshCw, ShieldCheck, SlidersHorizontal, Users, WalletCards } from 'lucide-react';
import { getAttendancePolicyCatalog, type AttendancePolicyCatalog } from '@/lib/attendance/attendanceResolutionService';
import {
  getAttendancePolicyRollout,
  getPolicyShadowAudit,
  type PolicyRolloutAssignment,
  type PolicyShadowAudit,
} from '@/lib/hr/workforceService';
import { cairoToday, startOfMonth } from '@/lib/attendance/period';
import AttendancePolicySimulator from '@/components/attendance/AttendancePolicySimulator';
import AttendancePolicyGovernance from '@/components/attendance/AttendancePolicyGovernance';

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

function policyValue(policy: Record<string, unknown> | null, key: string, suffix = '') {
  if (!policy || policy[key] == null || policy[key] === '') return 'غير محدد بعد';
  return `${String(policy[key])}${suffix}`;
}

export default function HRSettings() {
  const [catalog, setCatalog] = useState<AttendancePolicyCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [shadow, setShadow] = useState<PolicyShadowAudit | null>(null);
  const [rollout, setRollout] = useState<PolicyRolloutAssignment[]>([]);
  const [policyError, setPolicyError] = useState(false);
  const [shadowError, setShadowError] = useState(false);

  async function loadPolicies() {
    setLoading(true);
    try {
      const [catalogResult, rolloutResult] = await Promise.all([
        getAttendancePolicyCatalog(),
        getAttendancePolicyRollout(),
      ]);
      setCatalog(catalogResult);
      setRollout(rolloutResult);
      setPolicyError(false);
    } catch {
      setCatalog(null);
      setRollout([]);
      setPolicyError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPolicies(); }, []);

  useEffect(() => {
    const today = cairoToday();
    void getPolicyShadowAudit(startOfMonth(today), today, null)
      .then((result) => { setShadow(result); setShadowError(false); })
      .catch(() => { setShadow(null); setShadowError(true); });
  }, []);

  const activePolicy = catalog?.policies.find((p) => p.active === true) || catalog?.policies[0] || null;
  const defaultAssignment = catalog?.assignments.find((a) => a.scope_type === 'default') || null;

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

      {(policyError || shadowError) && (
        <div role="alert" className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 text-sm font-bold text-[var(--dawaa-status-warning-text)]">
          تعذر تحميل {policyError ? 'سياسات الحضور ونطاقات التطبيق' : ''}{policyError && shadowError ? ' و' : ''}{shadowError ? 'نتائج المقارنة' : ''}. راجع البيانات قبل تغيير سياسة الحضور.
        </div>
      )}

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

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-[var(--dawaa-theme-heading)]">سياسة الحضور الفعلية</h2>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">قراءة مباشرة من Attendance Policy Contract. الحقول غير المحددة لا يتم اختراع قيمة لها من الواجهة.</p>
          </div>
          <button onClick={() => void loadPolicies()} className="btn-secondary"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <PolicyStat label="كود السياسة" value={policyValue(activePolicy, 'policy_code')} />
          <PolicyStat label="Grace للتأخير" value={policyValue(activePolicy, 'late_grace_minutes', ' دقيقة')} />
          <PolicyStat label="تأخير شديد من" value={policyValue(activePolicy, 'very_late_minutes', ' دقيقة')} />
          <PolicyStat label="Grace للخروج المبكر" value={policyValue(activePolicy, 'early_leave_grace_minutes', ' دقيقة')} />
          <PolicyStat label="ساعات يوم متوقعة" value={policyValue(activePolicy, 'expected_daily_hours', ' ساعة')} />
          <PolicyStat label="أقصى ساعات مدفوعة" value={policyValue(activePolicy, 'max_payable_minutes', ' دقيقة')} />
          <PolicyStat label="بداية OT" value={policyValue(activePolicy, 'overtime_threshold_minutes', ' دقيقة')} />
          <PolicyStat label="اعتماد OT" value={activePolicy ? (activePolicy.overtime_requires_approval === false ? 'لا يحتاج' : 'يحتاج اعتماد') : 'غير محدد'} />
        </div>
        <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
          التعيين الافتراضي الحالي: {defaultAssignment ? `${String(defaultAssignment.scope_type)} · من ${String(defaultAssignment.effective_from || '-')}` : 'لا يوجد تعيين افتراضي'}.
          ترتيب الحل: موظف ← دور ← فرع ← افتراضي.
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-[var(--dawaa-theme-heading)]">حالة تطبيق Policy Engine</h2>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
              المحرك V3 جاهز على مراحل. الوضع الافتراضي الحالي Shadow، لذلك لا يغير Attendance Truth أو المرتب.
            </p>
          </div>
          <span className={
            (rollout.find((item) => item.scope_type === 'default')?.mode || 'shadow') === 'enforce'
              ? 'rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]'
              : 'rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-info-text)]'
          }>
            {(rollout.find((item) => item.scope_type === 'default')?.mode || 'shadow') === 'enforce' ? 'Enforce' : 'Shadow'}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <PolicyStat label="نطاقات Shadow" value={String(rollout.filter((item) => item.mode === 'shadow').length)} />
          <PolicyStat label="نطاقات Enforce" value={String(rollout.filter((item) => item.mode === 'enforce').length)} />
          <PolicyStat label="نطاقات Off" value={String(rollout.filter((item) => item.mode === 'off').length)} />
        </div>
        <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
          راجع مقارنة V2 وV3 وسجل الـRollout الحالي قبل التفعيل. الملخص أعلاه يقرأ النطاقات الحالية، وقد تكون هناك تغييرات بعد آخر اختبار.
        </div>
      </section>

      <AttendancePolicySimulator activePolicy={activePolicy} />
      <AttendancePolicyGovernance />

      {shadow && (
        <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
          <h2 className="font-black text-[var(--dawaa-status-info-text)]">Shadow Mode — أثر السياسة قبل التفعيل</h2>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">النظام يحسب أثر Policy Contract للمقارنة فقط بدون تعديل Attendance Truth أو المرتب.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <PolicyStat label="أيام تم تقييمها" value={shadow.evaluated_days.toLocaleString('ar-EG')} />
            <PolicyStat label="أيام حُلّت لها سياسة" value={shadow.policies_resolved.toLocaleString('ar-EG')} />
            <PolicyStat label="تغييرات تصنيف التأخير" value={shadow.late_classification_changes.toLocaleString('ar-EG')} />
            <PolicyStat label="خروج مبكر داخل Grace جديد" value={shadow.early_leave_within_new_grace.toLocaleString('ar-EG')} />
          </div>
        </section>
      )}

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


function PolicyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--dawaa-theme-heading)]">{value}</div>
    </div>
  );
}
