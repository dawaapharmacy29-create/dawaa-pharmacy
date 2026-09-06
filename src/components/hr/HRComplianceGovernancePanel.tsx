import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Fingerprint, History, Link2, LockKeyhole, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { cn } from '@/lib/utils';

type CaseRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  work_date: string;
  case_type: string;
  severity: string;
  data_confidence: 'verified' | 'needs_review' | 'blocked' | string;
  source_status: string | null;
  status: string;
  proposed_points_delta: number;
  proposed_money_delta: number;
  incentive_status: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  evidence: Record<string, unknown> | null;
  evidence_hash: string;
};

type AlignmentRow = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  compliance_score: number;
  risk_level: string;
  approved_hr_points: number;
  pending_hr_points: number;
  current_reward_points: number;
  current_deduction_points: number;
  current_final_points: number;
  current_points_incentive_egp: number;
  pending_total_cases: number;
  blocked_data_cases: number;
};

type IntegrityHealth = {
  sensitive_changes?: number;
  biometric_changes?: number;
  attendance_summary_changes?: number;
  schedule_changes?: number;
  exception_changes?: number;
  open_cases?: number;
  blocked_cases?: number;
  pending_hr_incentive_cases?: number;
};

const caseLabel: Record<string, string> = {
  absence: 'غياب',
  missing_checkout: 'بصمة خروج ناقصة',
  schedule_integrity: 'مشكلة جدول/ربط',
  late_arrival: 'تأخير حضور',
  early_leave: 'انصراف مبكر',
};

const confidenceLabel: Record<string, string> = {
  verified: 'الدليل مكتمل',
  needs_review: 'يحتاج مراجعة',
  blocked: 'محظور ماليًا',
};

const statusLabel: Record<string, string> = {
  open: 'مفتوحة', reviewed: 'تمت المراجعة', approved: 'معتمدة', rejected: 'مرفوضة', closed: 'مغلقة',
};

const incentiveLabel: Record<string, string> = {
  none: 'بدون أثر مالي', pending: 'أثر معلق', approved: 'أثر معتمد', rejected: 'الأثر مرفوض', settled: 'تمت التسوية',
};

function n(value: unknown) {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function ar(value: unknown) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(n(value));
}

export default function HRComplianceGovernancePanel({
  startDate,
  endDate,
  dailyDate,
  branch,
  onChanged,
}: {
  startDate: string;
  endDate: string;
  dailyDate: string;
  branch: string | null;
  onChanged?: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const canFinancialApprove = ['general_manager', 'executive_manager', 'branches_manager', 'admin'].includes(role);
  const canViewIntegrity = canFinancialApprove;
  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [alignment, setAlignment] = useState<AlignmentRow[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityHealth | null>(null);
  const [selected, setSelected] = useState<CaseRow | null>(null);
  const [note, setNote] = useState('');
  const [pointsDelta, setPointsDelta] = useState('0');
  const [moneyDelta, setMoneyDelta] = useState('0');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const calls = [
        supabase.rpc('hr_compliance_cases_v1', { p_start: startDate, p_end: endDate, p_branch: branch, p_status: null }),
        supabase.rpc('hr_staff_incentive_alignment_v1', { p_start: startDate, p_end: endDate, p_branch: branch }),
      ] as const;
      const [caseResult, alignmentResult] = await Promise.all(calls);
      if (caseResult.error) throw caseResult.error;
      if (alignmentResult.error) throw alignmentResult.error;
      setCases((caseResult.data || []) as CaseRow[]);
      setAlignment((alignmentResult.data || []) as AlignmentRow[]);
      if (canViewIntegrity) {
        const integrityResult = await supabase.rpc('hr_integrity_health_v1', { p_days: 60 });
        if (!integrityResult.error) setIntegrity((integrityResult.data || {}) as IntegrityHealth);
      } else setIntegrity(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل حوكمة الالتزام');
    } finally {
      setLoading(false);
    }
  }, [branch, canViewIntegrity, endDate, startDate]);

  useEffect(() => { void load(); }, [load]);

  const openCases = useMemo(() => cases.filter((c) => ['open', 'reviewed'].includes(c.status)), [cases]);
  const blockedCases = useMemo(() => openCases.filter((c) => c.data_confidence === 'blocked'), [openCases]);
  const pendingFinancial = useMemo(() => cases.filter((c) => c.incentive_status === 'pending'), [cases]);
  const pendingPoints = useMemo(() => alignment.reduce((sum, row) => sum + n(row.pending_hr_points), 0), [alignment]);

  const refreshDetectedCases = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('hr_refresh_compliance_cases_v1', { p_date: dailyDate, p_branch: branch });
      if (error) throw error;
      toast.success('تم تحديث حالات المراجعة من مصدر الحضور الحالي');
      await load();
      await onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالات المراجعة');
    } finally { setLoading(false); }
  };

  const verifySelected = async (row: CaseRow) => {
    const { data, error } = await supabase.rpc('hr_verify_case_chain_v1', { p_case_id: row.id });
    if (error) { toast.error(error.message); return; }
    const result = (data || {}) as { chain_ok?: boolean; evidence_hash_ok?: boolean; events?: number };
    if (result.chain_ok) toast.success(`سلامة السجل مؤكدة — ${result.events || 0} حدث مسجل`);
    else toast.error('يوجد كسر في سلامة السجل أو الدليل. لا تعتمد الحالة.');
  };

  const review = async (decision: 'review' | 'approve' | 'reject') => {
    if (!selected) return;
    if (!note.trim()) { toast.warning('اكتب سبب القرار أو المراجعة'); return; }
    if (decision === 'approve' && selected.data_confidence !== 'verified') {
      toast.error('لا يمكن الاعتماد: بيانات الحالة غير مكتملة أو محظورة ماليًا'); return;
    }
    const pd = decision === 'approve' ? n(pointsDelta) : 0;
    const md = decision === 'approve' ? n(moneyDelta) : 0;
    if ((pd !== 0 || md !== 0) && !canFinancialApprove) {
      toast.error('الأثر المالي يحتاج اعتماد الإدارة العامة/التنفيذية/مدير الفروع'); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('hr_review_compliance_case_v1', {
        p_case_id: selected.id,
        p_decision: decision,
        p_note: note.trim(),
        p_proposed_points_delta: pd,
        p_proposed_money_delta: md,
      });
      if (error) throw error;
      toast.success(decision === 'approve' && (pd !== 0 || md !== 0)
        ? 'تم اعتماد حالة HR وإرسال الأثر للحوافز كمعاملة معلقة تحتاج اعتمادًا نهائيًا'
        : decision === 'reject' ? 'تم رفض الحالة مع حفظ السبب في سجل التدقيق' : 'تم تسجيل المراجعة بدون أثر مالي');
      setSelected(null); setNote(''); setPointsDelta('0'); setMoneyDelta('0');
      await load();
      await onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ قرار المراجعة');
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4">
      <div className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><LockKeyhole size={20} className="text-[var(--dawaa-theme-primary)]" /><h2 className="dawaa-title text-xl">حوكمة الالتزام ومنع التلاعب</h2></div>
            <p className="dawaa-muted mt-1 text-sm">أي مخالفة تمر بدليل محفوظ + مراجعة + تحقق سلامة. الأثر المالي لا يدخل الحافز مباشرة؛ يظل معلقًا حتى اعتماد حوكمة الحوافز.</p>
          </div>
          <button onClick={() => void refreshDetectedCases()} disabled={loading} className="dawaa-button dawaa-button--primary"><RefreshCw size={16} className={cn(loading && 'animate-spin')} />تحديث حالات يوم {dailyDate}</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <GuardMetric label="حالات مفتوحة للمراجعة" value={openCases.length} icon={History} tone={openCases.length ? 'warning' : 'success'} />
          <GuardMetric label="محظورة بسبب جودة البيانات" value={blockedCases.length} icon={AlertTriangle} tone={blockedCases.length ? 'danger' : 'success'} />
          <GuardMetric label="آثار حوافز معلقة" value={pendingFinancial.length} icon={Link2} tone={pendingFinancial.length ? 'warning' : 'success'} />
          <GuardMetric label="صافي نقاط HR المعلقة" value={ar(pendingPoints)} icon={ShieldCheck} tone="info" />
        </div>
        {integrity && <div className="mt-4 grid gap-2 rounded-2xl border border-[var(--dawaa-theme-border)] p-4 md:grid-cols-5 text-sm">
          <Small label="تعديلات حساسة مسجلة" value={integrity.sensitive_changes || 0} />
          <Small label="تعديلات البصمة" value={integrity.biometric_changes || 0} />
          <Small label="تعديلات الجداول" value={integrity.schedule_changes || 0} />
          <Small label="تعديلات الأذونات" value={integrity.exception_changes || 0} />
          <Small label="آثار HR معلقة" value={integrity.pending_hr_incentive_cases || 0} />
        </div>}
      </div>

      <div className="dawaa-card overflow-hidden">
        <div className="border-b p-4"><h3 className="dawaa-title">حالات الموارد البشرية</h3><p className="dawaa-muted text-xs">المفتوحة أولًا. الحالة المحظورة لا يمكن أن تتحول إلى جزاء حتى اكتمال مصدر البيانات.</p></div>
        <div className="overflow-x-auto"><table className="min-w-[1250px] w-full text-sm"><thead><tr className="text-right dawaa-muted"><Th>التاريخ</Th><Th>الموظف</Th><Th>الفرع</Th><Th>الحالة</Th><Th>ثقة البيانات</Th><Th>التأخير/الخروج</Th><Th>المراجعة</Th><Th>الحافز</Th><Th>سلامة الدليل</Th><Th>إجراء</Th></tr></thead><tbody>
          {cases.length === 0 ? <tr><td colSpan={10} className="p-8 text-center dawaa-muted">لا توجد حالات HR مسجلة في الفترة. اضغط تحديث حالات اليوم بعد وصول بيانات البصمة.</td></tr> : cases.map((c) => {
            const ev = c.evidence || {};
            return <tr key={c.id} className="border-t"><Td>{c.work_date}</Td><Td><b>{c.staff_name}</b></Td><Td>{c.branch || '-'}</Td><Td><span className="dawaa-badge dawaa-badge--info">{caseLabel[c.case_type] || c.case_type}</span><div className="dawaa-muted mt-1 text-xs">{statusLabel[c.status] || c.status}</div></Td><Td><span className={cn('dawaa-badge', c.data_confidence === 'verified' ? 'dawaa-badge--success' : c.data_confidence === 'blocked' ? 'dawaa-badge--danger' : 'dawaa-badge--warning')}>{confidenceLabel[c.data_confidence] || c.data_confidence}</span><div className="dawaa-muted mt-1 text-xs">{c.source_status || '-'}</div></Td><Td>تأخير: {String(ev.late_minutes ?? 0)} د<br />خروج مبكر: {String(ev.early_leave_minutes ?? 0)} د</Td><Td>{c.reviewed_by_name || 'لم تراجع'}{c.review_note && <div className="dawaa-muted mt-1 max-w-xs text-xs">{c.review_note}</div>}</Td><Td>{incentiveLabel[c.incentive_status] || c.incentive_status}{n(c.proposed_points_delta) !== 0 && <div className="text-xs">نقاط: {ar(c.proposed_points_delta)}</div>}</Td><Td><button onClick={() => void verifySelected(c)} className="dawaa-button dawaa-button--ghost text-xs"><Fingerprint size={14} />تحقق</button></Td><Td>{['open','reviewed'].includes(c.status) ? <button onClick={() => { setSelected(c); setNote(''); setPointsDelta('0'); setMoneyDelta('0'); }} className="dawaa-button dawaa-button--secondary text-xs">مراجعة القرار</button> : <span className="dawaa-muted text-xs">مقفل</span>}</Td></tr>;
          })}
        </tbody></table></div>
      </div>

      <div className="dawaa-card overflow-hidden">
        <div className="border-b p-4"><h3 className="dawaa-title">ربط الالتزام بالحوافز</h3><p className="dawaa-muted text-xs">يعرض الالتزام بجانب النقاط الحالية والحافز، مع فصل واضح بين الأثر المعتمد والمعلق.</p></div>
        <div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-sm"><thead><tr className="text-right dawaa-muted"><Th>الموظف</Th><Th>الفرع</Th><Th>الالتزام</Th><Th>النقاط الحالية</Th><Th>مكافآت</Th><Th>خصومات معتمدة</Th><Th>HR معلق</Th><Th>حالات مفتوحة</Th><Th>بيانات محظورة</Th><Th>حافز النقاط الحالي</Th></tr></thead><tbody>{alignment.map((r) => <tr key={r.staff_id} className="border-t"><Td><b>{r.staff_name}</b></Td><Td>{r.branch || '-'}</Td><Td>{ar(r.compliance_score)}%</Td><Td>{ar(r.current_final_points)}</Td><Td>{ar(r.current_reward_points)}</Td><Td>{ar(r.current_deduction_points)}</Td><Td className={n(r.pending_hr_points) !== 0 ? 'font-black' : ''}>{ar(r.pending_hr_points)}</Td><Td>{r.pending_total_cases}</Td><Td>{r.blocked_data_cases}</Td><Td>{ar(r.current_points_incentive_egp)} ج</Td></tr>)}</tbody></table></div>
      </div>

      {selected && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" onClick={() => !saving && setSelected(null)}><div className="dawaa-card dawaa-card--raised w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="dawaa-title text-xl">مراجعة حالة: {selected.staff_name}</h3><p className="dawaa-muted mt-1 text-sm">{selected.work_date} — {caseLabel[selected.case_type] || selected.case_type} — {selected.branch}</p></div><button onClick={() => setSelected(null)} className="dawaa-button dawaa-button--ghost"><XCircle size={18} /></button></div>
        <div className="mt-4 rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-sm"><b>ثقة البيانات:</b> {confidenceLabel[selected.data_confidence] || selected.data_confidence}. {selected.data_confidence !== 'verified' && 'لن يسمح الخادم باعتماد أثر مالي حتى اكتمال الدليل.'}</div>
        <label className="mt-4 block text-sm font-bold">سبب القرار / ملاحظة المراجعة<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="dawaa-input mt-1 w-full" placeholder="اكتب السبب بوضوح؛ سيتم حفظه في سجل غير قابل للتعديل" /></label>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm font-bold">تأثير النقاط المقترح<input type="number" value={pointsDelta} onChange={(e) => setPointsDelta(e.target.value)} disabled={!canFinancialApprove} className="dawaa-input mt-1 w-full" /></label><label className="text-sm font-bold">تأثير مالي مقترح<input type="number" value={moneyDelta} onChange={(e) => setMoneyDelta(e.target.value)} disabled={!canFinancialApprove} className="dawaa-input mt-1 w-full" /></label></div>
        <p className="dawaa-muted mt-2 text-xs">القيمة السالبة = خصم، الموجبة = مكافأة. حتى بعد اعتماد HR، ستدخل الحوافز كـ «معلقة» ولا تصبح نهائية قبل حوكمة الحوافز.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button disabled={saving} onClick={() => void review('reject')} className="dawaa-button dawaa-button--secondary"><XCircle size={16} />رفض مع السبب</button><button disabled={saving} onClick={() => void review('review')} className="dawaa-button dawaa-button--secondary"><History size={16} />حفظ كمراجعة فقط</button><button disabled={saving || selected.data_confidence !== 'verified'} onClick={() => void review('approve')} className="dawaa-button dawaa-button--primary"><CheckCircle2 size={16} />اعتماد الحالة</button></div>
      </div></div>}
    </section>
  );
}

function GuardMetric({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof ShieldCheck; tone: 'success' | 'warning' | 'danger' | 'info' }) {
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4"><div className="flex items-center gap-2"><Icon size={16} /><span className="dawaa-muted text-xs font-bold">{label}</span></div><div className={cn('mt-2 text-2xl font-black', tone === 'danger' && 'text-red-500', tone === 'warning' && 'text-amber-500')}>{value}</div></div>;
}
function Small({ label, value }: { label: string; value: number }) { return <div><div className="dawaa-muted text-xs">{label}</div><div className="font-black">{ar(value)}</div></div>; }
function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-3 text-xs font-black">{children}</th>; }
function Td({ children, className }: { children: React.ReactNode; className?: string }) { return <td className={cn('px-3 py-3 align-top', className)}>{children}</td>; }
