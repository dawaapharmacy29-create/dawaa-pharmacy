import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Fingerprint,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { canManageBiometricOperations } from '@/lib/core/permissionSystem';
import {
  getHRTruthQualitySnapshotV2,
  type HRTruthQualitySnapshotV2,
} from '@/lib/hr/hrTruthService';

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
  const [truthAvailable, setTruthAvailable] = useState(false);
  const [truth, setTruth] = useState<HRTruthQualitySnapshotV2 | null>(null);
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
      const [triageResult, opsResult, truthResult] = await Promise.allSettled([
        supabase.rpc('attendance_review_triage_v1', { p_start: start, p_end: today, p_branch: branch }),
        canManageBiometrics ? supabase.rpc('attendance_biometric_operations_v3') : Promise.resolve(null),
        getHRTruthQualitySnapshotV2({ date: today, branch }),
      ]);

      const triageOk = triageResult.status === 'fulfilled' && !triageResult.value.error && !!triageResult.value.data;
      const opsOk = opsResult.status === 'fulfilled' && !!opsResult.value && !opsResult.value.error && !!opsResult.value.data;
      const truthOk = truthResult.status === 'fulfilled';

      setTriageAvailable(triageOk);
      setOpsAvailable(opsOk);
      setTruthAvailable(truthOk);

      const triage = triageOk ? (triageResult.value.data as Record<string, unknown>) : {};
      const ops = opsOk ? (opsResult.value.data as Record<string, any>) : {};

      setStats({
        scheduleIssues: Number(triage.schedule_issues || 0),
        systemInterpretation: Number(triage.system_interpretation || 0),
        unmappedCodes: Number(triage.unmapped_active_codes || 0),
        unmappedEvents: Number(triage.unmapped_events || 0),
        crossBranchStaff: Number(triage.cross_branch_staff || 0),
        openSyncAlerts: Array.isArray(ops.alerts) ? ops.alerts.filter((a: any) => !a.resolved).length : 0,
        activeDevices: Array.isArray(ops.devices) ? ops.devices.length : 0,
      });

      setTruth(truthOk ? truthResult.value : null);
    } finally {
      setLoading(false);
    }
  }, [branch, start, today, canManageBiometrics]);

  useEffect(() => { void load(); }, [load]);

  const truthBlockers = truth
    ? truth.active_without_schedule
      + truth.active_schedule_branch_mismatch
      + truth.archived_visible_in_schedule
      + truth.legacy_shift_drift
    : 0;

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">HR Truth & Data Quality V2</div>
            <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">جودة بيانات الموارد البشرية</h1>
            <p className="mt-1 max-w-3xl text-sm font-bold text-[var(--dawaa-theme-muted)]">
              شاشة فحص بنيوية للمصدر المعتمد للموظف والجدول والحضور. الهدف منع التضارب قبل وصوله إلى الحضور أو المرتب، وليس اكتشافه بعد المشكلة.
            </p>
          </div>
          <button onClick={() => void load()} className="btn-primary">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </section>

      {(!triageAvailable || !truthAvailable || (canManageBiometrics && !opsAvailable)) && !loading && (
        <div role="alert" className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 text-sm font-bold">
          بعض مصادر الجودة غير متاحة الآن. لا نعرض صفرًا وهميًا؛ المصدر غير المتاح يظل غير متاح حتى تتم مراجعته.
        </div>
      )}

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">سلامة مصدر الحقيقة</h2>
          <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
            هذه الفحوصات تكشف التعارض بين سجل الموظف والجدول المعتمد قبل أن يتحول إلى مشكلة حضور أو مرتب.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QualityCard
            title="موظفون نشطون بدون جدول"
            value={truthAvailable && truth ? truth.active_without_schedule : 'غير متاح'}
            description="موظف active لا يملك Schedule canonical لليوم."
            href="/schedule"
            icon={CalendarClock}
            healthy={!!truth && truth.active_without_schedule === 0}
          />
          <QualityCard
            title="تعارض فرع الموظف والجدول"
            value={truthAvailable && truth ? truth.active_schedule_branch_mismatch : 'غير متاح'}
            description="الفرع المسجل على الموظف لا يطابق فرع الجدول المعتمد."
            href="/hr-data-quality"
            icon={Users}
            healthy={!!truth && truth.active_schedule_branch_mismatch === 0}
          />
          <QualityCard
            title="تعارض ساعات legacy"
            value={truthAvailable && truth ? truth.legacy_shift_drift : 'غير متاح'}
            description="ساعات staff القديمة تختلف عن Schedule canonical؛ الجدول هو المرجع التشغيلي."
            href="/schedule"
            icon={CalendarClock}
            healthy={!!truth && truth.legacy_shift_drift === 0}
          />
          <QualityCard
            title="مؤرشفون ظاهرون في الجداول"
            value={truthAvailable && truth ? truth.archived_visible_in_schedule : 'غير متاح'}
            description="سجل غير نشط ما زال visible_in_schedule ويحتاج تنظيفًا بنيويًا."
            href="/team"
            icon={UserCheck}
            healthy={!!truth && truth.archived_visible_in_schedule === 0}
          />
        </div>
        <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-black text-[var(--dawaa-theme-heading)]">بوابة سلامة HR Truth</div>
              <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                {truthAvailable && truth
                  ? `${truth.active_staff.toLocaleString('ar-EG')} موظف نشط · ${truth.overnight_schedules.toLocaleString('ar-EG')} شيفت عابر لمنتصف الليل`
                  : 'المصدر غير متاح'}
              </div>
            </div>
            <div className={`rounded-full px-4 py-2 text-xs font-black ${
              truthAvailable && truthBlockers === 0
                ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
                : 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'
            }`}>
              {truthAvailable ? (truthBlockers === 0 ? 'المصدر متسق' : `${truthBlockers.toLocaleString('ar-EG')} تعارض بنيوي`) : 'غير متاح'}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">جودة الحضور والبصمة</h2>
          <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">مشاكل النظام منفصلة عن أداء الموظف ولا تتحول تلقائيًا إلى مخالفة أو خصم.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QualityCard
            title="مشاكل الجداول داخل الدورة"
            value={triageAvailable ? stats.scheduleIssues : 'غير متاح'}
            description="أيام جدول ناقصة أو غير قابلة للتفسير خلال الدورة."
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
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link to="/attendance-report?tab=cross-branch" className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><Users size={18} /> العمل بين الفروع</div>
          <div className="mt-2 text-2xl font-black">{triageAvailable ? stats.crossBranchStaff.toLocaleString('ar-EG') : 'غير متاح'}</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">معلومة تشغيلية فقط وليست مخالفة.</div>
        </Link>
        {checkPermission('view_staff_accounts') && <Link to="/staff-duplicate-audit" className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><Users size={18} /> هوية الموظفين</div>
          <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            {truthAvailable && truth
              ? `${truth.duplicate_active_display_names.toLocaleString('ar-EG')} اسم نشط مكرر يحتاج مراجعة هوية`
              : 'مراجعة السجلات المكررة والهوية الموحدة للموظف.'}
          </div>
        </Link>}
        <Link to="/attendance-report?tab=report&section=payroll-truth" className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><WalletCards size={18} /> فروق الاعتماد المالي</div>
          <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">مراجعة Attendance Truth والـdrift قبل اعتماد المرتب.</div>
        </Link>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
        <h2 className="font-black text-[var(--dawaa-theme-heading)]">قواعد V2 غير القابلة للتفاوض</h2>
        <div className="mt-3 grid gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)] md:grid-cols-2">
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">staff.id هو هوية الموظف؛ الاسم للعرض فقط.</div>
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">Schedule canonical هو مرجع المواعيد؛ staff.shift_* بيانات legacy وليست مصدر قرار.</div>
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">مشكلة نظام ≠ خطأ موظف.</div>
          <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">Approved/Paid snapshots لا تتغير بصمت بعد تعديل تاريخي.</div>
        </div>
      </section>
    </div>
  );
}
