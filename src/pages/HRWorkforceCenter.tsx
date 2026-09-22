import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Fingerprint,
  RefreshCw,
  UserCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { listPendingOvertime } from '@/lib/attendance/attendanceBreakdownService';
import { listStaffTimeOffRequests } from '@/lib/timeOffService';

type DashboardSummary = {
  staff: number;
  onTime: number;
  late: number;
  missing: number;
  issues: number;
};

type ReviewSummary = {
  needsManager: number;
  systemInterpretation: number;
  unmappedCodes: number;
  unmappedEvents: number;
  crossBranchStaff: number;
  crossBranchEvents: number;
};

type SyncSummary = {
  status: string;
  lagMinutes: number | null;
  latestActivity: string | null;
  devices: number;
};

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function cycleStartFor(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const cycleEnd = day >= 26
    ? new Date(Date.UTC(year, month, 25))
    : new Date(Date.UTC(year, month - 1, 25));
  return new Date(Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth() - 1, 26))
    .toISOString()
    .slice(0, 10);
}

function fmtDateTime(value: string | null) {
  if (!value) return 'غير مسجل';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' });
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: typeof Users;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info';
}) {
  const toneClass =
    tone === 'ok'
      ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
      : tone === 'warn'
        ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
        : tone === 'bad'
          ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]'
          : tone === 'info'
            ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]'
            : 'border-[var(--dawaa-theme-border)] dawaa-surface';
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-[var(--dawaa-theme-muted)]">{label}</span>
        <Icon size={17} className="text-[var(--dawaa-theme-primary-strong)]" />
      </div>
      <div className="mt-2 text-3xl font-black text-[var(--dawaa-theme-heading)]">
        {typeof value === 'number' ? value.toLocaleString('ar-EG') : value}
      </div>
      {hint && <div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{hint}</div>}
    </div>
  );
}

const quickLinks = [
  {
    title: 'متابعة اليوم',
    description: 'من المفترض حضوره، من حضر، ومن يحتاج انتباه الآن.',
    href: '/attendance-report?tab=dashboard',
    icon: Activity,
  },
  {
    title: 'صندوق المراجعة',
    description: 'الحالات التي تحتاج قرار مدير فقط، بعيدًا عن الحالات السليمة.',
    href: '/attendance-report?tab=resolution',
    icon: ClipboardCheck,
  },
  {
    title: 'سجل الحضور',
    description: 'الحضور المعتمد وتحليل الدورة الحالية والساعات الفعلية.',
    href: '/attendance-report?tab=report',
    icon: Clock,
  },
  {
    title: 'الجداول والمناوبات',
    description: 'إدارة الجداول والشيفتات وتاريخ التغطية.',
    href: '/schedule',
    icon: CalendarDays,
  },
  {
    title: 'الإجازات والغياب',
    description: 'طلبات الإجازات والأذونات وربطها بالحضور.',
    href: '/time-off',
    icon: CalendarDays,
  },
  {
    title: 'العمل الإضافي',
    description: 'الساعات المرشحة والمعتمدة للأوفر تايم.',
    href: '/attendance-report?tab=overtime',
    icon: Clock,
  },
  {
    title: 'إدارة البصمة',
    description: 'صحة الأجهزة، المزامنة، الأكواد والربط.',
    href: '/attendance-report?tab=sync',
    icon: Fingerprint,
  },
  {
    title: 'جاهزية المرتبات',
    description: 'الحضور الفعلي الجاهز للمرتب قبل الحساب النهائي.',
    href: '/attendance-report?tab=report',
    icon: WalletCards,
  },
];

export default function HRWorkforceCenter() {
  const { user } = useAuth();
  const today = cairoToday();
  const cycleStart = cycleStartFor(today);
  const canAllBranches = canSeeAllBranches(user?.role);
  const userBranch = normalizeBranchName(user?.branch || '');
  const branchArg = canAllBranches ? null : userBranch || null;

  const [daily, setDaily] = useState<DashboardSummary>({ staff: 0, onTime: 0, late: 0, missing: 0, issues: 0 });
  const [review, setReview] = useState<ReviewSummary>({
    needsManager: 0,
    systemInterpretation: 0,
    unmappedCodes: 0,
    unmappedEvents: 0,
    crossBranchStaff: 0,
    crossBranchEvents: 0,
  });
  const [sync, setSync] = useState<SyncSummary>({ status: 'unknown', lagMinutes: null, latestActivity: null, devices: 0 });
  const [pendingOvertime, setPendingOvertime] = useState(0);
  const [pendingTimeOff, setPendingTimeOff] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyResult, triageResult, syncResult, overtimeResult, timeOffResult] = await Promise.allSettled([
        supabase.rpc('attendance_dashboard_daily_summary_v1', { p_date: today, p_branch: branchArg }),
        supabase.rpc('attendance_review_triage_v1', { p_start: cycleStart, p_end: today, p_branch: branchArg }),
        supabase.rpc('attendance_biometric_operations_v3'),
        listPendingOvertime(branchArg),
        listStaffTimeOffRequests({ status: 'pending', limit: 200 }),
      ]);

      if (dailyResult.status === 'fulfilled' && !dailyResult.value.error) {
        const row = (dailyResult.value.data || {}) as Record<string, unknown>;
        setDaily({
          staff: Number(row.staff || 0),
          onTime: Number(row.on_time || 0),
          late: Number(row.late || 0),
          missing: Number(row.missing || 0),
          issues: Number(row.issues || 0),
        });
      }

      if (triageResult.status === 'fulfilled' && !triageResult.value.error) {
        const row = (triageResult.value.data || {}) as Record<string, unknown>;
        setReview({
          needsManager: Number(row.needs_manager_decision || 0),
          systemInterpretation: Number(row.system_interpretation || 0),
          unmappedCodes: Number(row.unmapped_active_codes || 0),
          unmappedEvents: Number(row.unmapped_events || 0),
          crossBranchStaff: Number(row.cross_branch_staff || 0),
          crossBranchEvents: Number(row.cross_branch_events || 0),
        });
      }

      if (syncResult.status === 'fulfilled' && !syncResult.value.error) {
        const row = (syncResult.value.data || {}) as Record<string, any>;
        setSync({
          status: String(row.status || 'unknown'),
          lagMinutes: row.lag_minutes == null ? null : Number(row.lag_minutes),
          latestActivity: row.latest_activity_at || null,
          devices: Array.isArray(row.devices) ? row.devices.length : 0,
        });
      }

      if (overtimeResult.status === 'fulfilled') setPendingOvertime((overtimeResult.value || []).length);
      if (timeOffResult.status === 'fulfilled') setPendingTimeOff((timeOffResult.value || []).length);
    } finally {
      setLoading(false);
    }
  }, [branchArg, cycleStart, today]);

  useEffect(() => { void load(); }, [load]);

  const attendanceCompleted = Math.max(0, daily.onTime + daily.late);
  const interventionCount = review.needsManager + pendingOvertime + pendingTimeOff;
  const syncHealthy = sync.status === 'healthy';
  const branchLabel = useMemo(() => branchArg || 'كل الفروع', [branchArg]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Dawaa Workforce & HR</div>
            <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">مركز الموارد البشرية</h1>
            <p className="mt-1 max-w-3xl text-sm font-bold text-[var(--dawaa-theme-muted)]">
              نقطة الدخول الموحدة للموظفين والجداول والحضور والإجازات والأوفر تايم والرواتب. الإدارة تراجع الاستثناءات فقط، بينما تظل البصمات الخام والجداول والحضور المعتمد في طبقات منفصلة.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black text-[var(--dawaa-theme-muted)]">
              <span className="rounded-full border border-[var(--dawaa-theme-border)] px-3 py-1">بيانات الدورة حتى اليوم: {cycleStart} ← {today}</span>
              <span className="rounded-full border border-[var(--dawaa-theme-border)] px-3 py-1">{branchLabel}</span>
            </div>
          </div>
          <button onClick={() => void load()} className="btn-primary">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث المركز
          </button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">يحتاج تدخلك الآن</h2>
            <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">الأولوية للقرارات البشرية، وليس للأرقام التاريخية أو مشاكل النظام التقنية.</p>
          </div>
          <Link to="/attendance-report?tab=resolution" className="btn-secondary">
            فتح صندوق المراجعة <ArrowLeft size={15} />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="حالات حضور تحتاج قرار" value={review.needsManager} hint="عدد أيام/حالات حضور داخل الدورة، وليس عدد الموظفين" icon={ClipboardCheck} tone={review.needsManager ? 'warn' : 'ok'} />
          <Metric label="أوفر تايم معلق" value={pendingOvertime} hint="ينتظر اعتمادًا بشريًا" icon={Clock} tone={pendingOvertime ? 'warn' : 'ok'} />
          <Metric label="طلبات إجازة" value={pendingTimeOff} hint="طلبات معلقة" icon={CalendarDays} tone={pendingTimeOff ? 'warn' : 'ok'} />
          <Metric label="إجمالي عناصر تحتاج تدخل" value={interventionCount} hint="مجموع حالات الحضور + الأوفر تايم + طلبات الإجازة، وليس عدد الموظفين" icon={AlertTriangle} tone={interventionCount ? 'warn' : 'ok'} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-black text-[var(--dawaa-theme-heading)]">تشغيل اليوم</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="مجدولون اليوم" value={daily.staff} icon={Users} />
          <Metric label="حضروا" value={attendanceCompleted} icon={UserCheck} tone="ok" />
          <Metric label="منتظمون" value={daily.onTime} icon={CheckCircle2} tone="ok" />
          <Metric label="متأخرون" value={daily.late} icon={Clock} tone={daily.late ? 'warn' : 'ok'} />
          <Metric label="لم تُحسم حالتهم" value={daily.missing} hint="لا تعني غيابًا نهائيًا" icon={AlertTriangle} tone={daily.missing ? 'warn' : 'neutral'} />
        </div>
      </section>

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">صحة النظام وجودة البيانات</h2>
          <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">هذه مؤشرات نظامية منفصلة عن أداء الموظف ولا تتحول تلقائيًا إلى مخالفة أو خصم.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="أجهزة البصمة"
            value={syncHealthy ? 'سليمة' : 'تحتاج فحص'}
            hint={`${sync.devices} جهاز نشط · آخر نشاط ${fmtDateTime(sync.latestActivity)}`}
            icon={Fingerprint}
            tone={syncHealthy ? 'ok' : 'warn'}
          />
          <Metric label="أكواد تحتاج ربط" value={review.unmappedCodes} hint={`${review.unmappedEvents.toLocaleString('ar-EG')} بصمة متأثرة في الدورة`} icon={UserCheck} tone={review.unmappedCodes ? 'warn' : 'ok'} />
          <Metric label="تفسير النظام" value={review.systemInterpretation} hint="لا تُنسب للموظف" icon={Activity} tone={review.systemInterpretation ? 'info' : 'ok'} />
          <Metric label="عمل بين الفروع" value={review.crossBranchStaff} hint={`${review.crossBranchEvents.toLocaleString('ar-EG')} بصمة معلوماتية`} icon={Users} tone="info" />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-black text-[var(--dawaa-theme-heading)]">وحدات الموارد البشرية</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {quickLinks.map(({ title, description, href, icon: Icon }) => (
            <Link key={title} to={href} className="group rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2 text-[var(--dawaa-theme-primary-strong)]"><Icon size={19} /></span>
                <ArrowLeft size={16} className="text-[var(--dawaa-theme-muted)] transition group-hover:-translate-x-1" />
              </div>
              <div className="mt-3 font-black text-[var(--dawaa-theme-heading)]">{title}</div>
              <div className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">{description}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
        <div className="text-sm font-black text-[var(--dawaa-status-info-text)]">مصدر الحقيقة في النظام الجديد</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-text)]">
          {['الموظف', 'الجدول', 'البصمة الخام', 'تفسير الحدث', 'يوم الحضور', 'الاستثناء', 'الاعتماد', 'الحضور المعتمد', 'المرتب'].map((item, index, arr) => (
            <span key={item} className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1">{item}</span>
              {index < arr.length - 1 && <ArrowLeft size={12} className="text-[var(--dawaa-theme-muted)]" />}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
