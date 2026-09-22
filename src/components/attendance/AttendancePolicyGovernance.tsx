import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlaskConical, History, Layers3, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cairoToday } from '@/lib/attendance/period';
import {
  assignAttendancePolicy,
  compareAttendancePolicyV3,
  createAttendancePolicyVersion,
  getAttendancePolicyRollout,
  listAttendancePolicyAudit,
  setAttendancePolicyRollout,
  type PolicyChangeAuditRow,
  type PolicyRolloutAssignment,
  type PolicyV3Compare,
} from '@/lib/hr/workforceService';

type StaffOption = { id: string; name: string; branch: string; role: string };

type PolicyOption = {
  id: string;
  policy_code: string;
  effective_from: string;
  active: boolean;
  late_grace_minutes: number;
  very_late_minutes: number;
  early_leave_grace_minutes: number | null;
};

export default function AttendancePolicyGovernance() {
  const today = cairoToday();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [rollout, setRollout] = useState<PolicyRolloutAssignment[]>([]);
  const [audit, setAudit] = useState<PolicyChangeAuditRow[]>([]);
  const [compare, setCompare] = useState<PolicyV3Compare | null>(null);
  const [loading, setLoading] = useState(false);

  const [policyCode, setPolicyCode] = useState('attendance_policy_pilot_' + today.replaceAll('-', ''));
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [lateGrace, setLateGrace] = useState('15');
  const [veryLate, setVeryLate] = useState('30');
  const [earlyGrace, setEarlyGrace] = useState('0');
  const [otThreshold, setOtThreshold] = useState('');
  const [rounding, setRounding] = useState('');
  const [policyNote, setPolicyNote] = useState('');

  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [scopeType, setScopeType] = useState<'staff' | 'role' | 'branch'>('branch');
  const [scopeKey, setScopeKey] = useState('فرع الشامي');
  const [assignmentDate, setAssignmentDate] = useState(today);
  const [assignmentNote, setAssignmentNote] = useState('');

  const [rolloutMode, setRolloutMode] = useState<'off' | 'shadow' | 'enforce'>('shadow');
  const [rolloutDate, setRolloutDate] = useState(today);
  const [rolloutNote, setRolloutNote] = useState('');
  const [enforcePhrase, setEnforcePhrase] = useState('');

  const [compareStart, setCompareStart] = useState(today);
  const [compareEnd, setCompareEnd] = useState(today);
  const [compareBranch, setCompareBranch] = useState('الكل');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffResult, policyResult, rolloutResult, auditResult] = await Promise.all([
        supabase.from('staff').select('id,name,branch,role').or('active.eq.true,is_active.eq.true').order('name'),
        supabase.from('attendance_policy_versions').select('id,policy_code,effective_from,active,late_grace_minutes,very_late_minutes,early_leave_grace_minutes').order('effective_from', { ascending: false }),
        getAttendancePolicyRollout(),
        listAttendancePolicyAudit(80),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (policyResult.error) throw policyResult.error;
      setStaff((staffResult.data || []) as StaffOption[]);
      setPolicies((policyResult.data || []) as PolicyOption[]);
      setRollout(rolloutResult);
      setAudit(auditResult);
      if (!selectedPolicyId && policyResult.data?.length) setSelectedPolicyId(String(policyResult.data[0].id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل حوكمة السياسات');
    } finally {
      setLoading(false);
    }
  }, [selectedPolicyId]);

  useEffect(() => { void load(); }, [load]);

  const scopeOptions = useMemo(() => {
    if (scopeType === 'branch') return ['فرع الشامي', 'فرع شكري'];
    if (scopeType === 'role') return [...new Set(staff.map((s) => s.role).filter(Boolean))];
    return staff.map((s) => ({ value: s.id, label: s.name + ' · ' + s.branch }));
  }, [scopeType, staff]);

  async function createPolicy() {
    const late = Number(lateGrace);
    const severe = Number(veryLate);
    const early = Number(earlyGrace);
    if (!policyCode.trim() || !Number.isFinite(late) || !Number.isFinite(severe) || severe < late || !Number.isFinite(early)) {
      toast.warning('راجع كود السياسة وقيم Grace وحد التأخير الشديد.');
      return;
    }
    setLoading(true);
    try {
      const result = await createAttendancePolicyVersion({
        policyCode: policyCode.trim(),
        effectiveFrom,
        lateGraceMinutes: late,
        veryLateMinutes: severe,
        earlyLeaveGraceMinutes: early,
        overtimeThresholdMinutes: otThreshold.trim() ? Number(otThreshold) : null,
        roundingMinutes: rounding.trim() ? Number(rounding) : null,
        note: policyNote,
      });
      const newId = String((result.policy as Record<string, unknown> | undefined)?.id || '');
      toast.success('تم إنشاء Policy Version staged. لم تُفعّل عالميًا.');
      await load();
      if (newId) setSelectedPolicyId(newId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء نسخة السياسة');
    } finally {
      setLoading(false);
    }
  }

  async function assignPolicy() {
    if (!selectedPolicyId || !scopeKey) {
      toast.warning('اختر Policy ونطاق التطبيق.');
      return;
    }
    setLoading(true);
    try {
      await assignAttendancePolicy({
        policyVersionId: selectedPolicyId,
        scopeType,
        scopeKey,
        effectiveFrom: assignmentDate,
        note: assignmentNote,
      });
      toast.success('تم ربط السياسة بالنطاق كنسخة staged.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر ربط السياسة بالنطاق');
    } finally {
      setLoading(false);
    }
  }

  async function saveRollout() {
    if (rolloutMode === 'enforce' && enforcePhrase.trim() !== 'ENFORCE') {
      toast.warning('لتفعيل Enforce اكتب ENFORCE حرفيًا. هذا يمنع التفعيل غير المقصود.');
      return;
    }
    if (!scopeKey) {
      toast.warning('اختر نطاق التطبيق.');
      return;
    }
    setLoading(true);
    try {
      await setAttendancePolicyRollout({
        scopeType,
        scopeKey,
        mode: rolloutMode,
        effectiveFrom: rolloutDate,
        note: rolloutNote,
      });
      toast.success(rolloutMode === 'enforce'
        ? 'تم إنشاء نطاق Enforce محدد. راجع مقارنة V2/V3 فورًا قبل استخدام Materializer V3.'
        : 'تم تحديث Rollout بدون تفعيل مالي عام.');
      setEnforcePhrase('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث Rollout');
    } finally {
      setLoading(false);
    }
  }

  async function runCompare() {
    setLoading(true);
    try {
      setCompare(await compareAttendancePolicyV3({
        start: compareStart,
        end: compareEnd,
        branch: compareBranch === 'الكل' ? null : compareBranch,
        limit: 30,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر مقارنة V2 وV3');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Policy Governance V3</div>
          <h2 className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">إدارة نسخ سياسة الحضور والـPilot</h2>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            النسخة الجديدة لا تصبح Global Active تلقائيًا. يتم ربطها بموظف/دور/فرع، ثم يبدأ Rollout في Shadow قبل أي Enforce.
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><Layers3 size={16} /> إنشاء Policy Version staged</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="كود السياسة"><input value={policyCode} onChange={(e) => setPolicyCode(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="تسري من"><input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="Grace التأخير"><input type="number" value={lateGrace} onChange={(e) => setLateGrace(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="تأخير شديد من"><input type="number" value={veryLate} onChange={(e) => setVeryLate(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="Grace الخروج المبكر"><input type="number" value={earlyGrace} onChange={(e) => setEarlyGrace(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="OT threshold — اختياري"><input type="number" value={otThreshold} onChange={(e) => setOtThreshold(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="Rounding — اختياري"><input type="number" value={rounding} onChange={(e) => setRounding(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="ملاحظة"><input value={policyNote} onChange={(e) => setPolicyNote(e.target.value)} className="input-dark w-full" /></Field>
          </div>
          <button onClick={() => void createPolicy()} className="btn-primary mt-3">إنشاء نسخة staged</button>
        </div>

        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><ShieldCheck size={16} /> ربط النسخة بنطاق Pilot</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Policy">
              <select value={selectedPolicyId} onChange={(e) => setSelectedPolicyId(e.target.value)} className="input-dark w-full">
                <option value="">اختر</option>
                {policies.map((p) => <option key={p.id} value={p.id}>{p.policy_code}{p.active ? ' · Global' : ' · Staged'}</option>)}
              </select>
            </Field>
            <Field label="نوع النطاق">
              <select value={scopeType} onChange={(e) => { setScopeType(e.target.value as typeof scopeType); setScopeKey(''); }} className="input-dark w-full">
                <option value="branch">فرع</option><option value="role">دور</option><option value="staff">موظف</option>
              </select>
            </Field>
            <Field label="النطاق">
              <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} className="input-dark w-full">
                <option value="">اختر</option>
                {scopeType === 'staff'
                  ? (scopeOptions as Array<{ value: string; label: string }>).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                  : (scopeOptions as string[]).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="يسري من"><input type="date" value={assignmentDate} onChange={(e) => setAssignmentDate(e.target.value)} className="input-dark w-full" /></Field>
            <Field label="ملاحظة"><input value={assignmentNote} onChange={(e) => setAssignmentNote(e.target.value)} className="input-dark w-full" /></Field>
          </div>
          <button onClick={() => void assignPolicy()} className="btn-secondary mt-3">ربط النسخة بالنطاق</button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
        <div className="font-black text-[var(--dawaa-status-info-text)]">Rollout للنطاق المحدد</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="الوضع">
            <select value={rolloutMode} onChange={(e) => setRolloutMode(e.target.value as typeof rolloutMode)} className="input-dark w-full">
              <option value="shadow">Shadow — مقارنة فقط</option>
              <option value="off">Off</option>
              <option value="enforce">Enforce — Pilot حقيقي</option>
            </select>
          </Field>
          <Field label="يسري من"><input type="date" value={rolloutDate} onChange={(e) => setRolloutDate(e.target.value)} className="input-dark w-full" /></Field>
          <Field label="ملاحظة"><input value={rolloutNote} onChange={(e) => setRolloutNote(e.target.value)} className="input-dark w-full" /></Field>
          {rolloutMode === 'enforce' && <Field label="تأكيد Enforce"><input value={enforcePhrase} onChange={(e) => setEnforcePhrase(e.target.value)} placeholder="اكتب ENFORCE" className="input-dark w-full" /></Field>}
          <div className="flex items-end"><button onClick={() => void saveRollout()} className={rolloutMode === 'enforce' ? 'btn-primary w-full' : 'btn-secondary w-full'}>حفظ Rollout</button></div>
        </div>
        <div className="mt-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
          حاليًا: {rollout.filter((r) => r.mode === 'shadow').length} Shadow · {rollout.filter((r) => r.mode === 'enforce').length} Enforce · {rollout.filter((r) => r.mode === 'off').length} Off.
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
        <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><FlaskConical size={16} /> مقارنة V2 ↔ V3</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="من"><input type="date" value={compareStart} onChange={(e) => setCompareStart(e.target.value)} className="input-dark w-full" /></Field>
          <Field label="إلى"><input type="date" value={compareEnd} onChange={(e) => setCompareEnd(e.target.value)} className="input-dark w-full" /></Field>
          <Field label="الفرع">
            <select value={compareBranch} onChange={(e) => setCompareBranch(e.target.value)} className="input-dark w-full">
              <option value="الكل">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option>
            </select>
          </Field>
          <div className="flex items-end"><button onClick={() => void runCompare()} className="btn-secondary w-full">تشغيل المقارنة</button></div>
        </div>
        {compare && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <Mini label="أيام مفحوصة" value={compare.checked_days} />
            <Mini label="تغيير فعلي V2/V3" value={compare.effective_status_changes} warn={compare.effective_status_changes > 0} />
            <Mini label="Candidate changes" value={compare.candidate_changes} />
            <Mini label="Shadow days" value={compare.shadow_days} />
            <Mini label="Enforced days" value={compare.enforced_days} warn={compare.enforced_days > 0} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4">
        <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><History size={16} /> سجل تغييرات السياسات</div>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {audit.slice(0, 30).map((row) => (
            <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
              <div className="font-black text-[var(--dawaa-theme-heading)]">{row.action}</div>
              <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">
                {row.actor_name || 'النظام'} · {row.created_at ? new Date(row.created_at).toLocaleString('ar-EG') : '-'}
              </div>
              {(row.scope_type || row.scope_key) && <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">{row.scope_type || '-'} · {row.scope_key || 'default'}</div>}
              {row.note && <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">{row.note}</div>}
            </div>
          ))}
          {!audit.length && <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد تغييرات مسجلة بعد.</div>}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">{label}<div className="mt-1">{children}</div></label>;
}

function Mini({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return <div className={warn ? 'rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3' : 'rounded-xl border border-[var(--dawaa-theme-border)] p-3'}>
    <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
    <div className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
  </div>;
}
