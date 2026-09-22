import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, FileEdit, RefreshCw, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  createMyAttendanceCorrectionRequest,
  listMyAttendanceCorrectionRequests,
  type AttendanceCorrectionRequest,
} from '@/lib/hr/workforceService';

function labelForKind(kind?: string | null) {
  if (kind === 'missing_checkin') return 'بصمة دخول ناقصة';
  if (kind === 'missing_checkout') return 'بصمة خروج ناقصة';
  if (kind === 'wrong_time') return 'وقت غير صحيح';
  return 'طلب تصحيح آخر';
}

function statusMeta(status: string) {
  if (status === 'approved') return {
    label: 'وافق المدير على الطلب',
    cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]',
    icon: CheckCircle2,
  };
  if (status === 'rejected') return {
    label: 'مرفوض',
    cls: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]',
    icon: XCircle,
  };
  return {
    label: 'بانتظار المراجعة',
    cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
    icon: Clock3,
  };
}

export default function AttendanceCorrectionRequestPanel({ defaultDate }: { defaultDate?: string }) {
  const [rows, setRows] = useState<AttendanceCorrectionRequest[]>([]);
  const [date, setDate] = useState(defaultDate || '');
  const [kind, setKind] = useState<'missing_checkin' | 'missing_checkout' | 'wrong_time' | 'other'>('missing_checkin');
  const [time, setTime] = useState('09:00');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await listMyAttendanceCorrectionRequests(30));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل طلبات التصحيح');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => rows.filter((row) => row.status === 'pending').length, [rows]);

  async function submit() {
    if (!date) {
      toast.warning('اختر تاريخ اليوم المطلوب تصحيحه.');
      return;
    }
    if (reason.trim().length < 5) {
      toast.warning('اكتب سببًا واضحًا للتصحيح.');
      return;
    }

    const requestedTime = kind === 'other'
      ? null
      : new Date(`${date}T${time || '12:00'}:00+03:00`).toISOString();

    setSending(true);
    try {
      await createMyAttendanceCorrectionRequest({
        attendanceDate: date,
        requestKind: kind,
        requestedTime,
        reason: reason.trim(),
      });
      toast.success('تم إرسال طلب التصحيح للإدارة بدون تعديل سجل البصمة الخام.');
      setReason('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إرسال طلب التصحيح');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <FileEdit size={18} /> طلب تصحيح حضور
          </div>
          <p className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            لو في بصمة ناقصة أو وقت غير صحيح، قدّم طلبًا موثقًا. الطلب لا يغيّر البصمة الأصلية ولا المرتب تلقائيًا.
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          التاريخ
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          نوع التصحيح
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="input-dark mt-1 w-full">
            <option value="missing_checkin">بصمة دخول ناقصة</option>
            <option value="missing_checkout">بصمة خروج ناقصة</option>
            <option value="wrong_time">وقت غير صحيح</option>
            <option value="other">أخرى</option>
          </select>
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الوقت المقترح
          <input type="time" value={time} disabled={kind === 'other'} onChange={(e) => setTime(e.target.value)} className="input-dark mt-1 w-full disabled:opacity-50" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)] md:col-span-2">
          السبب
          <div className="mt-1 flex gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-dark flex-1" placeholder="مثال: بصمت دخول والجهاز لم يسجل الحركة..." />
            <button onClick={() => void submit()} disabled={sending} className="btn-primary shrink-0">
              <Send size={15} /> إرسال
            </button>
          </div>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-black text-[var(--dawaa-theme-heading)]">طلباتي السابقة</h3>
        <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-theme-muted)]">
          {pending.toLocaleString('ar-EG')} معلّق
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {rows.slice(0, 8).map((row) => {
          const meta = statusMeta(row.status);
          const Icon = meta.icon;
          return (
            <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-black text-[var(--dawaa-theme-heading)]">{labelForKind(row.request_kind || row.request_type)} · {row.attendance_date || row.requested_time.slice(0, 10)}</div>
                  <div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{row.reason}</div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black ${meta.cls}`}>
                  <Icon size={12} /> {meta.label}
                </span>
              </div>
              {row.review_note && <div className="mt-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">ملاحظة الإدارة: {row.review_note}</div>}
            </div>
          );
        })}
        {!rows.length && !loading && <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-4 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات تصحيح سابقة.</div>}
      </div>
    </section>
  );
}
