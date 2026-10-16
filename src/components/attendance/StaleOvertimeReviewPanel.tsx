import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, PencilLine, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  listStaleOvertimeApprovals,
  reviewStaleOvertimeApproval,
  type StaleOvertimeApprovalRow,
  type StaleOvertimeDecision,
  type StaleOvertimeReason,
} from '@/lib/attendance/attendanceBreakdownService';

const REASON_LABEL: Record<StaleOvertimeReason, string> = {
  no_attendance_link: 'غير مرتبط بيوم حضور',
  linked_attendance_missing: 'يوم الحضور المرتبط غير موجود',
  linked_attendance_not_approved: 'يوم الحضور لم يعد معتمدًا',
  fingerprint_missing: 'اعتُمد بدون بصمة Attendance Truth',
  fingerprint_diverged: 'Attendance Truth تغيّرت بعد الاعتماد',
};

const DECISION_SUCCESS: Record<StaleOvertimeDecision, string> = {
  confirm: 'تم تأكيد القرار الحالي وربطه بـ Attendance Truth الحالية.',
  adjust: 'تم حفظ التعديل وربطه بـ Attendance Truth الحالية.',
  reject: 'تم رفض الأوفر تايم وتوثيق السبب.',
  recalculate: 'أعيد الأوفر تايم لقائمة الانتظار؛ اعتمده لإعادة حسابه من Attendance Truth الحالية.',
};

function errorText(message: string) {
  if (message.includes('overtime_requires_approved_attendance_truth')) return 'يوم الحضور غير معتمد حاليًا؛ اعتمد يوم الحضور أولًا أو ارفض الأوفر تايم.';
  if (message.includes('payroll_already_finalized_for_cycle')) return 'مرتب هذه الدورة مقفل نهائيًا لهذا الموظف؛ لا يمكن تعديل القرار.';
  if (message.includes('overtime_not_stale_approved')) return 'هذا الأوفر تايم لم يعد يحتاج مراجعة؛ حدّث القائمة.';
  if (message.includes('stale_overtime_review_note_required')) return 'اكتب ملاحظة القرار أولًا.';
  if (message.includes('invalid_stale_overtime_adjustment')) return 'أدخل دقائق أكبر من صفر وقيمة غير سالبة.';
  if (message.includes('not_authorized')) return 'لا تملك صلاحية مراجعة أوفر تايم هذا الموظف.';
  return message;
}

const time = (value: string | null) => (value
  ? new Date(value).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })
  : '—');

export default function StaleOvertimeReviewPanel({ branch, onDecided }: { branch: string; onDecided: () => void }) {
  const [rows, setRows] = useState<StaleOvertimeApprovalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<{ minutes: string; amount: string; multiplier: string }>({ minutes: '', amount: '', multiplier: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listStaleOvertimeApprovals({ branch: branch || null }));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? errorText(error.message) : 'تعذر تحميل الأوفر تايم الذي يحتاج مراجعة');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  async function decide(row: StaleOvertimeApprovalRow, decision: StaleOvertimeDecision) {
    const note = (noteById[row.id] || '').trim();
    if (!note) {
      toast.warning('اكتب ملاحظة القرار أولًا حتى يظل القرار موثقًا.');
      return;
    }
    setDecidingId(row.id);
    try {
      await reviewStaleOvertimeApproval({
        id: row.id,
        decision,
        note,
        overtimeMinutes: decision === 'adjust' ? Number(adjust.minutes) : null,
        overtimeAmount: decision === 'adjust' && adjust.amount.trim() !== '' ? Number(adjust.amount) : null,
        multiplier: decision === 'adjust' && adjust.multiplier.trim() !== '' ? Number(adjust.multiplier) : null,
      });
      toast.success(DECISION_SUCCESS[decision]);
      setNoteById((current) => ({ ...current, [row.id]: '' }));
      setAdjustId(null);
      await load();
      onDecided();
    } catch (error) {
      toast.error(errorText(error instanceof Error ? error.message : 'تعذر تسجيل القرار'));
    } finally {
      setDecidingId(null);
    }
  }

  const staffCount = new Set(rows.map((row) => row.staff_id)).size;
  const missingAmount = rows.filter((row) => row.amount_missing).length;

  return (
    <div className="rounded-2xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-black text-[var(--dawaa-status-danger-text)]">
          <AlertTriangle size={17} /> أوفر تايم معتمد يحتاج قرار المدير
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs font-black">
          {!loadError && (
            <>
              <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1">الحالات: {rows.length.toLocaleString('ar-EG')}</span>
              <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1">الموظفون: {staffCount.toLocaleString('ar-EG')}</span>
              <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1">بدون قيمة: {missingAmount.toLocaleString('ar-EG')}</span>
            </>
          )}
          <button onClick={() => void load()} className="btn-secondary !py-1 !px-2"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      <p className="mb-3 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
        هذه الاعتمادات لا تطابق Attendance Truth الحالية، لذلك تمنع الإقفال المالي للموظف حتى تختار قرارًا لكل حالة. لا يتم أي تعديل تلقائي.
      </p>

      {loadError ? (
        <div role="alert" className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] p-3 text-sm font-bold text-[var(--dawaa-status-danger-text)]">
          تعذر تحميل قائمة المراجعة: {loadError}
        </div>
      ) : !rows.length ? (
        <p className="text-sm font-bold text-[var(--dawaa-theme-muted)]">لا يوجد أوفر تايم معتمد يحتاج مراجعة في الدورة الحالية.</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 text-xs">
              <div className="text-sm font-bold text-[var(--dawaa-theme-heading)]">
                <span className="font-black">{row.staff_name}</span> · {row.branch || '—'} · {row.attendance_date} · {row.overtime_minutes.toLocaleString('ar-EG')} دقيقة
                {' · '}
                {row.amount_missing
                  ? <span className="text-[var(--dawaa-status-warning-text)]">بدون قيمة محفوظة{row.is_delivery ? ' (تُحسب من سعر التوصيل × المعامل)' : ''}</span>
                  : <span>{Number(row.overtime_amount).toLocaleString('ar-EG')} ج.م</span>}
                {row.multiplier != null && <span className="text-[var(--dawaa-theme-muted)]"> · معامل ×{row.multiplier}</span>}
              </div>
              <div className="mt-2 grid gap-1 font-bold text-[var(--dawaa-theme-muted)] md:grid-cols-2">
                <div>سبب المراجعة: <span className="text-[var(--dawaa-status-danger-text)]">{REASON_LABEL[row.stale_reason] || row.stale_reason}</span> · البصمة: {row.fingerprint_state === 'missing' ? 'غير موجودة' : 'مختلفة'}</div>
                <div>
                  Attendance Truth الحالية: {row.truth_status || 'غير موجودة'}{row.truth_resolution_status ? ` / ${row.truth_resolution_status}` : ''}
                  {' · '}حضور {time(row.truth_first_in)} → انصراف {time(row.truth_last_out)} · نهاية الشيفت {time(row.truth_scheduled_end_at)}
                  {row.truth_payroll_eligible_hours != null ? ` · ساعات مستحقة ${row.truth_payroll_eligible_hours}` : ''}
                </div>
                <div>آخر اعتماد: {row.decided_by_name || '—'}{row.decided_at ? ` · ${new Date(row.decided_at).toLocaleDateString('ar-EG')}` : ''} · المصدر: {row.approval_source || 'غير موثق'}</div>
                <div>ملاحظة الاعتماد: {row.decision_note || '—'}</div>
              </div>

              {row.payroll_finalized ? (
                <div className="mt-2 font-black text-[var(--dawaa-status-warning-text)]">مرتب هذه الدورة مقفل نهائيًا لهذا الموظف؛ لا يمكن تعديل القرار.</div>
              ) : (
                <div className="mt-3 grid gap-2">
                  <input
                    value={noteById[row.id] || ''}
                    onChange={(e) => setNoteById((current) => ({ ...current, [row.id]: e.target.value }))}
                    placeholder="ملاحظة القرار · مطلوبة لكل قرار"
                    className="input-dark w-full"
                  />
                  {adjustId === row.id && (
                    <div className="grid gap-2 sm:grid-cols-4">
                      <input value={adjust.minutes} onChange={(e) => setAdjust((v) => ({ ...v, minutes: e.target.value }))} inputMode="numeric" placeholder="الدقائق المعتمدة" className="input-dark" />
                      <input value={adjust.amount} onChange={(e) => setAdjust((v) => ({ ...v, amount: e.target.value }))} inputMode="decimal" placeholder="القيمة ج.م (اختياري)" className="input-dark" />
                      <input value={adjust.multiplier} onChange={(e) => setAdjust((v) => ({ ...v, multiplier: e.target.value }))} inputMode="decimal" placeholder="المعامل (اختياري)" className="input-dark" />
                      <button disabled={decidingId === row.id} onClick={() => void decide(row, 'adjust')} className="btn-primary !py-1 !px-3 text-xs">حفظ التعديل</button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button disabled={decidingId === row.id} onClick={() => void decide(row, 'confirm')} className="btn-primary !py-1 !px-3 text-xs">
                      <CheckCircle2 size={14} /> تأكيد القرار كما هو
                    </button>
                    <button
                      disabled={decidingId === row.id}
                      onClick={() => {
                        setAdjustId((current) => (current === row.id ? null : row.id));
                        setAdjust({ minutes: String(row.overtime_minutes), amount: row.overtime_amount == null ? '' : String(row.overtime_amount), multiplier: row.multiplier == null ? '' : String(row.multiplier) });
                      }}
                      className="btn-secondary !py-1 !px-3 text-xs"
                    >
                      <PencilLine size={14} /> تعديل
                    </button>
                    <button disabled={decidingId === row.id} onClick={() => void decide(row, 'reject')} className="btn-secondary !py-1 !px-3 text-xs">
                      <XCircle size={14} /> رفض
                    </button>
                    <button
                      disabled={decidingId === row.id || !row.recalculate_available}
                      title={row.recalculate_available ? undefined : 'إعادة الحساب تتطلب يوم حضور معتمد بحالة قياسية وملف أجر صالح'}
                      onClick={() => void decide(row, 'recalculate')}
                      className="btn-secondary !py-1 !px-3 text-xs"
                    >
                      <RotateCcw size={14} /> إعادة الحساب من الحقيقة الحالية
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
