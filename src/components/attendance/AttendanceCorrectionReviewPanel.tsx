import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  decideAttendanceCorrectionRequest,
  listAttendanceCorrectionRequests,
  type AttendanceCorrectionRequest,
} from '@/lib/hr/workforceService';

function kindLabel(kind?: string | null) {
  if (kind === 'missing_checkin') return 'بصمة دخول ناقصة';
  if (kind === 'missing_checkout') return 'بصمة خروج ناقصة';
  if (kind === 'wrong_time') return 'وقت غير صحيح';
  return 'تصحيح آخر';
}

export default function AttendanceCorrectionReviewPanel({ branch }: { branch?: string | null }) {
  const [rows, setRows] = useState<AttendanceCorrectionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAttendanceCorrectionRequests({ branch: branch && branch !== 'الكل' ? branch : null, status: 'pending', limit: 100 }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طلبات تصحيح الحضور');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const pendingCount = useMemo(() => rows.length, [rows]);

  async function decide(row: AttendanceCorrectionRequest, decision: 'approved' | 'rejected') {
    setBusy(row.id);
    try {
      await decideAttendanceCorrectionRequest(row.id, decision, noteById[row.id] || '');
      toast.success(decision === 'approved'
        ? 'تمت الموافقة على طلب التصحيح كدليل إداري. لم يتم تعديل البصمة الخام أو المرتب تلقائيًا.'
        : 'تم رفض طلب التصحيح.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ القرار');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <ClipboardCheck size={18} /> طلبات تصحيح الموظفين
          </div>
          <p className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            الموافقة هنا تثبت قبول طلب الموظف كدليل إداري فقط. لا تُنشئ بصمة جديدة ولا تغيّر Attendance Truth أو المرتب تلقائيًا.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">{pendingCount.toLocaleString('ar-EG')} معلّق</span>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name} · {kindLabel(row.request_kind || row.request_type)}</div>
                <div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                  {row.branch_name || 'غير محدد'} · {row.attendance_date || row.requested_time.slice(0, 10)}
                </div>
                <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-text)]">{row.reason}</div>
              </div>
              <div className="flex min-w-[320px] flex-col gap-2 sm:flex-row">
                <input
                  value={noteById[row.id] || ''}
                  onChange={(e) => setNoteById((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  className="input-dark flex-1"
                  placeholder="ملاحظة الإدارة (اختياري)"
                />
                <button disabled={busy === row.id} onClick={() => void decide(row, 'approved')} className="btn-primary"><CheckCircle2 size={14} /> موافقة</button>
                <button disabled={busy === row.id} onClick={() => void decide(row, 'rejected')} className="btn-secondary"><XCircle size={14} /> رفض</button>
              </div>
            </div>
          </div>
        ))}
        {!rows.length && !loading && <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-4 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات تصحيح معلقة.</div>}
      </div>
    </section>
  );
}
