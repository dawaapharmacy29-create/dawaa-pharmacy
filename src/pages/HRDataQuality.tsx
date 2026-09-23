import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CalendarClock, Fingerprint, RefreshCw, ShieldCheck, UserCheck, Users, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { canManageBiometricOperations } from '@/lib/core/permissionSystem';

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

function QualityCard({
  title,
  value,
  description,
  href,
  icon: Icon,
  healthy,
}: {
  title: string;
  value: number | string;
  description: string;
  href: string;
  icon: typeof AlertTriangle;
  healthy: boolean;
}) {
  return (
    <Link
      to={href}
      className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        healthy
          ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
          : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-xl border border-current/10 bg-[var(--dawaa-theme-surface)] p-2"><Icon size={18} /></span>
        <ArrowLeft size={15} className="text-[var(--dawaa-theme-muted)]" />
      </div>
      <div className="mt-3 text-xs font-black text-[var(--dawaa-theme-muted)]">{title}</div>
      <div className="mt-1 text-3xl font-black text-[var(--dawaa-theme-heading)]">
        {typeof value === 'number' ? value.toLocaleString('ar-EG') : value}
      </div>
      <p className="mt-1 text-[11px] font-bold leading-5 text-[var(--dawaa-theme-muted)]">{description}</p>
    </Link>
  );
}

export default function HRDataQuality() {
  const { user, checkPermission } = useAuth();
  const canManageBiometrics = canManageBiometricOperations(user?.role);
  const today = cairoToday();
  const start = cycleStartFor(today);
  const branch = canSeeAllBranches(user?.role) ? null : normalizeBranchName(user?.branch || '') || null;

  const [loading, setLoading] = useState(false);
  const [triageAvailable, setTriageAvailable] = useState(false);
  const [opsAvailable, setOpsAvailable] = useState(false);
  const [stats, setStats] = useState({
    scheduleIssues: 0,
    systemInterpretation: 0,
    unmappedCodes: 0,
    unmappedEvents: 0,
    crossBranchStaff: 0,
    openSyncAlerts: 0,
    activeDevices: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [triageResult, opsResult] = await Promise.all([
        supabase.rpc('attendance_review_triage_v1', { p_start: start, p_end: today, p_branch: branch }),
        canManageBiometrics ? supabase.rpc('attendance_biometric_operations_v3') : Promise.resolve(null),
      ]);
      const triageOk = !triageResult.error && !!triageResult.data;
      const opsOk = !!opsResult && !opsResult.error && !!opsResult.data;
      setTriageAvailable(triageOk);
      setOpsAvailable(opsOk);
      const triage = triageOk ? (triageResult.data as Record<string, unknown>) : {};
      const ops = opsOk ? (opsResult.data as Record<string, any>) : {};
      setStats({
        scheduleIssues: Number(triage.schedule_issues || 0),
        systemInterpretation: Number(triage.system_interpretation || 0),
        unmappedCodes: Number(triage.unmapped_active_codes || 0),
        unmappedEvents: Number(triage.unmapped_events || 0),
        crossBranchStaff: Number(triage.cross_branch_staff || 0),
        openSyncAlerts: Array.isArray(ops.alerts) ? ops.alerts.filter((a: any) => !a.resolved).length : 0,
        activeDevices: Array.isArray(ops.devices) ? ops.devices.length : 0,
      });
    } catch {
      setTriageAvailable(false);
      setOpsAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [branch, start, today, canManageBiometrics]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">HR Data Quality</div>
            <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">جودة بيانات الموارد البشرية</h1>
            <p className="mt-1 max-w-3xl text-sm font-bold text-[var(--dawaa-theme-muted)]">
              المشاكل النظامية والهيكلية هنا منفصلة عن تقييم الموظف. لا تتحول مشكلة جدول أو ربط أو مزامنة إلى مخالفة أو خصم تلقائي.
            </p>
          </div>
          <button onClick={() => void load()} className="btn-primary">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </section>

      {(!triageAvailable || (canManageBiometrics && !opsAvailable)) && !loading && <div role="alert" className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 text-sm font-bold">بعض بيانات الجودة غير متاحة الآن. لا تعتبر المؤشرات غير المتاحة صفرًا، وراجع الصفحة المختصة قبل اعتماد الأرقام.</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QualityCard
          title="مشاكل الجداول"
          value={triageAvailable ? stats.scheduleIssues : 'غير متاح'}
          description="جدول ناقص أو غير قابل للتفسير خلال الدورة."
          href="/attendance-report?tab=schedules"
          icon={CalendarClock}
          healthy={triageAvailable && stats.scheduleIssues === 0}
        />
        <QualityCard
          title="تفسير النظام"
          value={triageAvailable ? stats.systemInterpretation : 'غير متاح'}
          description="حالات تحتاج تحسين تفسير آلي، وليست خطأ موظف."
          href="/attendance-report?tab=resolution&triage=system"
          icon={ShieldCheck}
          healthy={triageAvailable && stats.systemInterpretation === 0}
        />
        {canManageBiometrics && <QualityCard
          title="أكواد بصمة تحتاج ربط"
          value={triageAvailable ? stats.unmappedCodes : 'غير متاح'}
          description={`${triageAvailable ? stats.unmappedEvents.toLocaleString('ar-EG') : 'عدد غير متاح'} بصمة متأثرة في الدورة الحالية.`}
          href="/attendance-report?tab=unmapped"
          icon={UserCheck}
          healthy={triageAvailable && stats.unmappedCodes === 0}
        />}
        {canManageBiometrics && <QualityCard
          title="تنبيهات مزامنة مفتوحة"
          value={opsAvailable ? stats.openSyncAlerts : 'غير متاح'}
          description={`${opsAvailable ? stats.activeDevices.toLocaleString('ar-EG') : 'عدد غير متاح'} جهاز تشغيل ظاهر حاليًا.`}
          href="/attendance-report?tab=sync"
          icon={Fingerprint}
          healthy={opsAvailable && stats.openSyncAlerts === 0}
        />}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link to="/attendance-report?tab=cross-branch" className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><Users size={18} /> العمل بين الفروع</div>
          <div className="mt-2 text-2xl font-black">{triageAvailable ? stats.crossBranchStaff.toLocaleString('ar-EG') : 'غير متاح'}</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">معلومة تشغيلية فقط وليست مخالفة.</div>
        </Link>
        {checkPermission('view_staff_accounts') && <Link to="/staff-duplicate-audit" className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><Users size={18} /> هوية الموظفين</div>
          <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">مراجعة السجلات المكررة والهوية الموحدة للموظف.</div>
        </Link>}
        <Link to="/attendance-report?tab=report&section=payroll-truth" className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><WalletCards size={18} /> فروق الاعتماد المالي</div>
          <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">مراجعة Attendance Truth والـdrift قبل اعتماد المرتب.</div>
        </Link>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
        <h2 className="font-black text-[var(--dawaa-theme-heading)]">قاعدة الحوكمة</h2>
        <div className="mt-3 grid gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)] md:grid-cols-2">
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">مشكلة نظام ≠ خطأ موظف.</div>
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">Cross-branch = معلومة مكان فعلية وليست خصمًا.</div>
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">Approved/Paid snapshots لا تتغير بصمت بعد تعديل تاريخي.</div>
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">Raw biometric evidence يبقى محفوظًا ولا يُعدل بعد الاستقبال.</div>
        </div>
      </section>
    </div>
  );
}
