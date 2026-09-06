import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, Download, RefreshCw, Search, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { cn } from '@/lib/utils';
import HRComplianceGovernancePanel from '@/components/hr/HRComplianceGovernancePanel';

type RiskLevel = 'critical' | 'attention' | 'watch' | 'good' | string;

type StaffCompliance = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  scheduled_days: number;
  present_days: number;
  absent_days: number;
  on_time_days: number;
  late_days: number;
  very_late_days: number;
  total_late_minutes: number;
  early_leave_days: number;
  total_early_leave_minutes: number;
  missing_checkout_days: number;
  approved_exception_days: number;
  approved_permission_days: number;
  approved_leave_days: number;
  worked_on_off_days: number;
  schedule_issue_days: number;
  biometric_days: number;
  biometric_events: number;
  attendance_rate: number;
  punctuality_rate: number;
  compliance_score: number;
  risk_level: RiskLevel;
  attention_reasons: string[] | null;
};

type BranchCompliance = {
  branch: string;
  employees: number;
  scheduled_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  total_late_minutes: number;
  early_leave_days: number;
  permissions_days: number;
  leave_days: number;
  missing_checkout_days: number;
  schedule_issue_days: number;
  attendance_rate: number;
  punctuality_rate: number;
  avg_compliance_score: number;
  critical_employees: number;
  attention_employees: number;
};

type AttentionRow = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  work_date: string;
  attendance_status: string;
  shift_start: string | null;
  shift_end: string | null;
  first_check_in: string | null;
  last_check_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  approved_exception_type: string | null;
  approved_exception_reason: string | null;
  biometric_events: number;
  source_status: string | null;
  severity: string;
  manager_action: string;
};

const riskLabel: Record<string, string> = {
  critical: 'حرج',
  attention: 'يحتاج تدخل',
  watch: 'تحت المراقبة',
  good: 'ملتزم',
};

const riskClass: Record<string, string> = {
  critical: 'dawaa-badge--danger',
  attention: 'dawaa-badge--warning',
  watch: 'dawaa-badge--info',
  good: 'dawaa-badge--success',
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: number) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(num(value));
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    absent: 'غياب', missing_checkout: 'بصمة خروج ناقصة', schedule_conflict: 'تعارض جدول',
    schedule_missing: 'جدول ناقص', punch_without_valid_schedule: 'بصمة بدون جدول صالح',
    late: 'تأخير', very_late: 'تأخير شديد', approved_exception: 'استثناء معتمد',
  };
  return map[status] || status || 'غير محدد';
}

export default function HRComplianceCenter() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const canAllBranches = canSeeAllBranches(user?.role);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [startDate, setStartDate] = useState(dateOnly(cycle.start));
  const [endDate, setEndDate] = useState(dateOnly(cycle.end));
  const [dailyDate, setDailyDate] = useState(dateOnly(new Date()));
  const [branch, setBranch] = useState(canAllBranches ? 'الكل' : userBranch || 'الكل');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [staff, setStaff] = useState<StaffCompliance[]>([]);
  const [branches, setBranches] = useState<BranchCompliance[]>([]);
  const [attention, setAttention] = useState<AttentionRow[]>([]);
  const [tab, setTab] = useState<'overview' | 'staff' | 'attention'>('overview');

  const effectiveBranch = canAllBranches ? (branch === 'الكل' ? null : normalizeBranchName(branch) || branch) : userBranch || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffResult, branchResult, attentionResult] = await Promise.all([
        supabase.rpc('hr_staff_compliance_summary_v1', { p_start: startDate, p_end: endDate, p_branch: effectiveBranch }),
        supabase.rpc('hr_branch_compliance_summary_v1', { p_start: startDate, p_end: endDate }),
        supabase.rpc('hr_daily_attention_queue_v1', { p_date: dailyDate, p_branch: effectiveBranch }),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (branchResult.error) throw branchResult.error;
      if (attentionResult.error) throw attentionResult.error;
      setStaff((staffResult.data || []) as StaffCompliance[]);
      setBranches((branchResult.data || []) as BranchCompliance[]);
      setAttention((attentionResult.data || []) as AttentionRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل مركز الموارد البشرية والالتزام');
    } finally {
      setLoading(false);
    }
  }, [dailyDate, effectiveBranch, endDate, startDate]);

  useEffect(() => { void load(); }, [load]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((row) => `${row.staff_name} ${row.branch || ''} ${row.role || ''}`.toLowerCase().includes(q));
  }, [search, staff]);

  const totals = useMemo(() => ({
    employees: staff.length,
    critical: staff.filter((row) => row.risk_level === 'critical').length,
    attention: staff.filter((row) => row.risk_level === 'attention').length,
    avgScore: staff.length ? staff.reduce((sum, row) => sum + num(row.compliance_score), 0) / staff.length : 0,
    absences: staff.reduce((sum, row) => sum + num(row.absent_days), 0),
    lateMinutes: staff.reduce((sum, row) => sum + num(row.total_late_minutes), 0),
    permissions: staff.reduce((sum, row) => sum + num(row.approved_permission_days), 0),
  }), [staff]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const staffSheet = XLSX.utils.json_to_sheet(filteredStaff.map((r) => ({
      'الموظف': r.staff_name, 'الفرع': r.branch, 'الوظيفة': r.role,
      'أيام العمل': r.scheduled_days, 'الحضور': r.present_days, 'الغياب': r.absent_days,
      'مرات التأخير': r.late_days, 'دقائق التأخير': r.total_late_minutes,
      'تأخير أكثر من 30 دقيقة': r.very_late_days, 'انصراف مبكر': r.early_leave_days,
      'دقائق الانصراف المبكر': r.total_early_leave_minutes, 'بصمة خروج ناقصة': r.missing_checkout_days,
      'أذونات معتمدة': r.approved_permission_days, 'إجازات معتمدة': r.approved_leave_days,
      'مشاكل الجدول': r.schedule_issue_days, 'نسبة الحضور %': r.attendance_rate,
      'الالتزام بالمواعيد %': r.punctuality_rate, 'درجة الالتزام': r.compliance_score,
      'الحالة': riskLabel[r.risk_level] || r.risk_level,
      'أسباب المراجعة': (r.attention_reasons || []).join(' | '),
    })));
    XLSX.utils.book_append_sheet(wb, staffSheet, 'الموظفون');
    const branchSheet = XLSX.utils.json_to_sheet(branches.map((r) => ({
      'الفرع': r.branch, 'الموظفون': r.employees, 'أيام العمل': r.scheduled_days, 'الحضور': r.present_days,
      'الغياب': r.absent_days, 'مرات التأخير': r.late_days, 'دقائق التأخير': r.total_late_minutes,
      'الأذونات': r.permissions_days, 'الإجازات': r.leave_days, 'متوسط الالتزام': r.avg_compliance_score,
      'نسبة الحضور %': r.attendance_rate, 'الالتزام بالمواعيد %': r.punctuality_rate,
      'حالات حرجة': r.critical_employees, 'تحتاج تدخل': r.attention_employees,
    })));
    XLSX.utils.book_append_sheet(wb, branchSheet, 'الفروع');
    const attentionSheet = XLSX.utils.json_to_sheet(attention.map((r) => ({
      'التاريخ': r.work_date, 'الموظف': r.staff_name, 'الفرع': r.branch, 'الحالة': statusLabel(r.attendance_status),
      'التأخير بالدقائق': r.late_minutes, 'انصراف مبكر بالدقائق': r.early_leave_minutes,
      'الاستثناء المعتمد': r.approved_exception_type, 'السبب': r.approved_exception_reason,
      'إجراء المدير المقترح': r.manager_action,
    })));
    XLSX.utils.book_append_sheet(wb, attentionSheet, 'مراجعة يومية');
    XLSX.writeFile(wb, `مركز_الموارد_البشرية_${startDate}_${endDate}.xlsx`);
  };

  return (
    <div dir="rtl" className="space-y-5 pb-10">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="text-[var(--dawaa-theme-primary)]" /><h1 className="dawaa-title text-2xl">مركز الموارد البشرية والالتزام</h1></div>
            <p className="dawaa-muted mt-2 text-sm">صورة إدارية موحدة للحضور، التأخير، الأذونات، الإجازات، مشاكل البصمة والجدول، مع قائمة يومية للحالات التي تحتاج مراجعة قبل أي محاسبة.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void load()} disabled={loading} className="dawaa-button dawaa-button--secondary"><RefreshCw size={16} className={cn(loading && 'animate-spin')} />تحديث</button>
            <button onClick={() => void exportExcel()} className="dawaa-button dawaa-button--primary"><Download size={16} />تصدير Excel</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-bold">من<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="dawaa-input mt-1 w-full" /></label>
          <label className="text-xs font-bold">إلى<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="dawaa-input mt-1 w-full" /></label>
          <label className="text-xs font-bold">الفرع<select value={branch} disabled={!canAllBranches} onChange={(e) => setBranch(e.target.value)} className="dawaa-input mt-1 w-full"><option>الكل</option><option>شكري</option><option>الشامي</option></select></label>
          <label className="text-xs font-bold">تاريخ المراجعة اليومية<input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="dawaa-input mt-1 w-full" /></label>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          ['الموظفون', totals.employees, Users], ['متوسط الالتزام', `${fmt(totals.avgScore)}%`, ShieldCheck],
          ['حالات حرجة', totals.critical, AlertTriangle], ['تحتاج تدخل', totals.attention, UserCheck],
          ['أيام غياب', totals.absences, CalendarDays], ['دقائق التأخير', totals.lateMinutes, BarChart3], ['الأذونات', totals.permissions, CalendarDays],
        ] as Array<[string, string | number, ElementType]>).map(([label, value, Icon]) => <div key={String(label)} className="dawaa-card p-4"><div className="flex items-center gap-2"><Icon size={17} className="dawaa-muted" /><span className="dawaa-muted text-xs font-bold">{String(label)}</span></div><div className="dawaa-title mt-2 text-2xl">{String(value)}</div></div>)}
      </section>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTab('overview')} className={cn('dawaa-button', tab === 'overview' ? 'dawaa-button--primary' : 'dawaa-button--secondary')}>نظرة الفروع</button>
        <button onClick={() => setTab('staff')} className={cn('dawaa-button', tab === 'staff' ? 'dawaa-button--primary' : 'dawaa-button--secondary')}>تفاصيل الموظفين</button>
        <button onClick={() => setTab('attention')} className={cn('dawaa-button', tab === 'attention' ? 'dawaa-button--primary' : 'dawaa-button--secondary')}>مراجعة اليوم ({attention.length})</button>
      </div>

      {tab === 'overview' && <section className="grid gap-4 lg:grid-cols-2">{branches.map((r) => <article key={r.branch} className="dawaa-card p-5"><div className="flex items-center justify-between"><h2 className="dawaa-title text-lg">فرع {r.branch}</h2><span className="dawaa-badge dawaa-badge--info">{r.employees} موظف</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label="متوسط الالتزام" value={`${fmt(r.avg_compliance_score)}%`} /><Metric label="نسبة الحضور" value={`${fmt(r.attendance_rate)}%`} /><Metric label="الالتزام بالمواعيد" value={`${fmt(r.punctuality_rate)}%`} /><Metric label="دقائق التأخير" value={fmt(r.total_late_minutes)} /><Metric label="الغياب" value={fmt(r.absent_days)} /><Metric label="الأذونات" value={fmt(r.permissions_days)} /><Metric label="حالات حرجة" value={fmt(r.critical_employees)} /><Metric label="تحتاج تدخل" value={fmt(r.attention_employees)} /></div></article>)}</section>}

      {tab === 'staff' && <section className="dawaa-card overflow-hidden"><div className="border-b p-4"><div className="relative max-w-md"><Search size={16} className="absolute right-3 top-3 dawaa-muted" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الموظف أو الفرع أو الوظيفة" className="dawaa-input w-full pr-10" /></div></div><div className="overflow-x-auto"><table className="min-w-[1200px] w-full text-sm"><thead><tr className="text-right dawaa-muted"><Th>الموظف</Th><Th>الفرع</Th><Th>الحضور</Th><Th>الغياب</Th><Th>التأخير</Th><Th>إجمالي دقائق التأخير</Th><Th>أذونات</Th><Th>إجازات</Th><Th>انصراف مبكر</Th><Th>مشاكل بصمة/جدول</Th><Th>الالتزام</Th><Th>الحالة</Th></tr></thead><tbody>{filteredStaff.map((r) => <tr key={r.staff_id} className="border-t"><Td><div className="font-black">{r.staff_name}</div><div className="dawaa-muted text-xs">{r.role || 'غير محدد'}</div></Td><Td>{r.branch || '-'}</Td><Td>{r.present_days}/{r.scheduled_days} <div className="dawaa-muted text-xs">{fmt(r.attendance_rate)}%</div></Td><Td>{r.absent_days}</Td><Td>{r.late_days} <div className="dawaa-muted text-xs">شديد: {r.very_late_days}</div></Td><Td>{r.total_late_minutes}</Td><Td>{r.approved_permission_days}</Td><Td>{r.approved_leave_days}</Td><Td>{r.early_leave_days}</Td><Td>{r.missing_checkout_days + r.schedule_issue_days}</Td><Td className="font-black">{fmt(r.compliance_score)}%</Td><Td><span className={cn('dawaa-badge', riskClass[r.risk_level] || 'dawaa-badge--info')}>{riskLabel[r.risk_level] || r.risk_level}</span>{(r.attention_reasons || []).length > 0 && <div className="dawaa-muted mt-1 max-w-xs text-xs">{r.attention_reasons?.join(' • ')}</div>}</Td></tr>)}</tbody></table></div></section>}

      {tab === 'attention' && <section className="space-y-3">{attention.length === 0 ? <div className="dawaa-card p-8 text-center dawaa-muted">لا توجد حالات حضور تحتاج مراجعة في هذا اليوم.</div> : attention.map((r, index) => <article key={`${r.staff_id}-${index}`} className="dawaa-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-black">{r.staff_name} <span className="dawaa-muted text-xs">— {r.branch || 'غير محدد'}</span></div><div className="mt-1 text-sm">{statusLabel(r.attendance_status)}</div></div><span className={cn('dawaa-badge', r.severity === 'critical' ? 'dawaa-badge--danger' : r.severity === 'high' ? 'dawaa-badge--warning' : 'dawaa-badge--info')}>{r.severity === 'critical' ? 'حرج' : r.severity === 'high' ? 'مرتفع' : 'مراجعة'}</span></div><div className="mt-3 grid gap-2 text-sm md:grid-cols-4"><Metric label="التأخير" value={`${r.late_minutes || 0} دقيقة`} /><Metric label="انصراف مبكر" value={`${r.early_leave_minutes || 0} دقيقة`} /><Metric label="بصمات" value={String(r.biometric_events || 0)} /><Metric label="استثناء معتمد" value={r.approved_exception_type || 'لا يوجد'} /></div><div className="mt-3 rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-sm"><b>الإجراء الإداري:</b> {r.manager_action}</div>{r.approved_exception_reason && <div className="dawaa-muted mt-2 text-xs">السبب المسجل: {r.approved_exception_reason}</div>}</article>)}</section>}

      <HRComplianceGovernancePanel
        startDate={startDate}
        endDate={endDate}
        dailyDate={dailyDate}
        branch={effectiveBranch}
        onChanged={load}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3"><div className="dawaa-muted text-xs font-bold">{label}</div><div className="dawaa-title mt-1 text-lg">{value}</div></div>;
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-3 text-xs font-black">{children}</th>; }
function Td({ children, className }: { children: React.ReactNode; className?: string }) { return <td className={cn('px-3 py-3 align-top', className)}>{children}</td>; }
