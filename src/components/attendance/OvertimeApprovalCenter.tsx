import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, History, Link2, ReceiptText, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  decideOvertimeApproval,
  listOvertimeDecisions,
  listPendingOvertime,
  type OvertimeDecisionRow,
  type PendingOvertimeRow,
} from '@/lib/attendance/attendanceBreakdownService';
import OvertimeDecisionEvidenceCardV3 from '@/components/attendance/OvertimeDecisionEvidenceCardV3';

export default function OvertimeApprovalCenter({ defaultBranch = '' }: { defaultBranch?: string }) {
  const [branch, setBranch] = useState(defaultBranch);
  const [pending, setPending] = useState<PendingOvertimeRow[]>([]);
  const [decisions, setDecisions] = useState<OvertimeDecisionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);

  useEffect(() => { setBranch(defaultBranch); }, [defaultBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRows, decisionRows] = await Promise.all([
        listPendingOvertime(branch || null),
        listOvertimeDecisions({ branch: branch || null, limit: 100 }),
      ]);
      setPending(pendingRows);
      setDecisions(decisionRows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل بيانات الأوفر تايم');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  async function decide(row: PendingOvertimeRow, decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !(noteById[row.id] || '').trim()) {
      toast.warning('اكتب سبب الرفض حتى يظل القرار موثقًا.');
      return;
    }
    setDecidingId(row.id);
    try {
      await decideOvertimeApproval(row.id, decision, noteById[row.id] || undefined);
      toast.success(
        decision === 'approved'
          ? 'تم اعتماد الأوفر تايم بعد التحقق من Attendance Truth المعتمدة.'
          : 'تم رفض الأوفر تايم وتوثيق القرار.'
      );
      setNoteById((current) => ({ ...current, [row.id]: '' }));
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تسجيل القرار';
      if (message.includes('overtime_requires_approved_attendance_truth')) {
        toast.error('لا يمكن اعتماد الأوفر تايم قبل اعتماد يوم الحضور نفسه.');
      } else if (message.includes('overtime_source_resolution_drifted') || message.includes('overtime_source_resolution_changed')) {
        toast.error('يوم الحضور تغيّر بعد إنشاء الأوفر تايم. راجع Attendance Truth أولًا ثم أعد إنشاء القرار.');
      } else {
        toast.error(message);
      }
    } finally {
      setDecidingId(null);
    }
  }

  const money = (v: number | null | undefined) => (v == null ? 'غير محدد' : `${v.toLocaleString('ar-EG')} ج.م`);

  const formatOvertimeDuration = (hours: number | null | undefined) => {
    const totalMinutes = Math.max(0, Math.round(Number(hours || 0) * 60));
    if (totalMinutes < 60) return `${totalMinutes.toLocaleString('ar-EG')} دقيقة`;
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes
      ? `${wholeHours.toLocaleString('ar-EG')}:${String(minutes).padStart(2, '0')} ساعة`
      : `${wholeHours.toLocaleString('ar-EG')} ساعة`;
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Overtime Decision Evidence V3</div>
          <h2 className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">اعتماد الأوفر تايم بالأدلة التشغيلية</h2>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            القرار يعرض Attendance Truth + عدد زملاء نفس الفئة الموجودين في الفرع + حركة مبيعات الفرع والموظف داخل نفس نافذة الوقت. الأدلة تساعد المدير ولا تصدر حكم استحقاق تلقائيًا.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="الفرع (فارغ = الكل)" className="input-dark" />
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        <div className="flex items-center gap-2"><ShieldCheck size={15} /> قاعدة V2: Attendance Truth → Overtime Review → Payroll. لا يمكن تجاوز اعتماد يوم الحضور.</div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-black text-[var(--dawaa-status-warning-text)]"><Clock3 size={17} /> بانتظار الاعتماد</h3>
          <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{pending.length.toLocaleString('ar-EG')}</span>
        </div>

        {!pending.length ? (
          <p className="text-sm font-bold text-[var(--dawaa-theme-muted)]">لا يوجد أوفر تايم بانتظار القرار حاليًا.</p>
        ) : (
          <div className="grid gap-3">
            {pending.map((row) => (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                aria-expanded={expandedEvidenceId === row.id}
                onClick={() => setExpandedEvidenceId((current) => current === row.id ? null : row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpandedEvidenceId((current) => current === row.id ? null : row.id);
                  }
                }}
                className="cursor-pointer rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 transition hover:border-[var(--dawaa-theme-primary)]"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="text-sm font-bold text-[var(--dawaa-theme-heading)]">
                      <span className="font-black">{row.staff_name}</span> · {row.branch} · {row.attendance_date} · {formatOvertimeDuration(row.overtime_hours)}
                      {row.overtime_amount != null && <span className="text-[var(--dawaa-theme-muted)]"> (~{money(row.overtime_amount)})</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-black text-[var(--dawaa-theme-muted)]">
                      <Link2 size={11} />
                      {row.source_resolution_id
                        ? 'مرتبط حاليًا بـ Attendance Truth Snapshot'
                        : 'Legacy candidate — سيتم ربطه والتحقق منه لحظة الاعتماد'}
                    </div>
                  </div>

                  <div className="flex min-w-[360px] flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedEvidenceId((current) => current === row.id ? null : row.id);
                      }}
                      className="btn-secondary !py-1 !px-3 text-xs"
                    >
                      <ReceiptText size={14} />
                      تفاصيل القرار
                      {expandedEvidenceId === row.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <input
                      value={noteById[row.id] || ''}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(e) => setNoteById((current) => ({ ...current, [row.id]: e.target.value }))}
                      placeholder="ملاحظة القرار · مطلوبة عند الرفض"
                      className="input-dark flex-1"
                    />
                    <button disabled={decidingId === row.id} onClick={(event) => { event.stopPropagation(); void decide(row, 'approved'); }} className="btn-primary !py-1 !px-3 text-xs">
                      <CheckCircle2 size={14} /> اعتماد
                    </button>
                    <button disabled={decidingId === row.id} onClick={(event) => { event.stopPropagation(); void decide(row, 'rejected'); }} className="btn-secondary !py-1 !px-3 text-xs">
                      <XCircle size={14} /> رفض
                    </button>
                  </div>
                </div>
                {expandedEvidenceId === row.id && <OvertimeDecisionEvidenceCardV3 overtimeId={row.id} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><History size={17} /> سجل القرارات</h3>
        {!decisions.length ? (
          <p className="text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد قرارات سابقة بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dawaa-theme-border)] text-right text-xs font-black text-[var(--dawaa-theme-muted)]">
                  <th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">التاريخ</th><th className="p-3">الساعات</th><th className="p-3">القيمة</th><th className="p-3">Truth Link</th><th className="p-3">الحالة</th><th className="p-3">القرار بواسطة</th><th className="p-3">الملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)] last:border-0">
                    <td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">{row.staff_name}</td>
                    <td className="p-3">{row.branch}</td>
                    <td className="p-3">{row.attendance_date}</td>
                    <td className="p-3 font-black">{formatOvertimeDuration(row.overtime_hours)}</td>
                    <td className="p-3">{money(row.overtime_amount)}</td>
                    <td className="p-3 text-xs font-bold">
                      {row.source_resolution_id
                        ? <span className="text-[var(--dawaa-status-success-text)]">Linked</span>
                        : <span className="text-[var(--dawaa-status-warning-text)]">Legacy / Unlinked</span>}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${
                        row.status === 'approved'
                          ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
                          : 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'
                      }`}>
                        {row.status === 'approved' ? 'معتمد' : 'مرفوض'}
                      </span>
                    </td>
                    <td className="p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.decided_by_name || '-'}</td>
                    <td className="p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.decision_note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
