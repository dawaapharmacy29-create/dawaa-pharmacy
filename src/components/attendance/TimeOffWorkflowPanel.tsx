import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, CheckCircle2, Clock3, Send, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { invalidateCachedRpc } from '@/lib/attendance/cachedRpc';
import { cn } from '@/lib/utils';

type MyRequest = {
  id: string;
  request_kind: string;
  request_label: string | null;
  status: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  requested_at: string;
  decision_note: string | null;
};

type QueueItem = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string;
  request_kind: string;
  request_label: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  requested_at: string;
  branch_decided_by_name?: string | null;
  branch_note?: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending_branch_review: { label: 'بانتظار موافقة مدير الفرع', cls: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' },
  pending_gm_review: { label: 'بانتظار الاعتماد النهائي', cls: 'text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]' },
  approved: { label: 'معتمد', cls: 'text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]' },
  rejected: { label: 'مرفوض', cls: 'text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]' },
  cancelled: { label: 'ملغى', cls: 'text-[var(--dawaa-theme-muted)] bg-[var(--dawaa-theme-surface-2)] border-[var(--dawaa-theme-border)]' },
};

export default function TimeOffWorkflowPanel() {
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [branchQueue, setBranchQueue] = useState<QueueItem[] | null>(null);
  const [gmQueue, setGmQueue] = useState<QueueItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [kind, setKind] = useState('permission');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    const mine = await supabase.rpc('attendance_my_time_off_requests_v1');
    if (!mine.error) setMyRequests((mine.data || []) as MyRequest[]);

    const branch = await supabase.rpc('attendance_branch_time_off_queue_v1');
    setBranchQueue(branch.error ? null : ((branch.data || []) as QueueItem[]));

    const gm = await supabase.rpc('attendance_gm_time_off_queue_v1');
    setGmQueue(gm.error ? null : ((gm.data || []) as QueueItem[]));
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function submitRequest() {
    if (!startDate || !endDate) { toast.warning('اختر تاريخ البداية والنهاية'); return; }
    if (!reason.trim()) { toast.warning('اكتب سبب الطلب'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('attendance_request_time_off_v1', {
        p_request_kind: kind, p_start_date: startDate, p_end_date: endDate,
        p_start_time: kind === 'permission' && startTime ? startTime : null,
        p_end_time: kind === 'permission' && endTime ? endTime : null,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success('تم إرسال طلبك — بانتظار موافقة مدير الفرع');
      invalidateCachedRpc('attendance_branch_time_off_queue_v1');
      setStartDate(''); setEndDate(''); setStartTime(''); setEndTime(''); setReason('');
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إرسال الطلب');
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(rpcName: string, id: string, decision: 'approve' | 'reject') {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc(rpcName, { p_request_id: id, p_decision: decision, p_note: notes[id] || null });
      if (error) throw error;
      toast.success(decision === 'approve' ? 'تم الاعتماد' : 'تم الرفض');
      invalidateCachedRpc('attendance_branch_time_off_queue_v1');
      invalidateCachedRpc('attendance_gm_time_off_queue_v1');
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تنفيذ القرار');
    } finally {
      setBusyId(null);
    }
  }

  async function cancelRequest(id: string) {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('attendance_cancel_time_off_request_v1', { p_request_id: id });
      if (error) throw error;
      toast.success('تم إلغاء الطلب');
      invalidateCachedRpc('attendance_branch_time_off_queue_v1');
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إلغاء الطلب');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-1.5 font-black text-[var(--dawaa-theme-heading)]"><Send size={16} /> طلب إذن أو إجازة</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="input-dark text-xs">
            <option value="permission">إذن (ساعات)</option>
            <option value="annual_leave">إجازة سنوية</option>
            <option value="sick_leave">إجازة مرضية</option>
            <option value="exceptional_leave">إجازة استثنائية</option>
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-dark text-xs" placeholder="من تاريخ" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-dark text-xs" placeholder="إلى تاريخ" />
          {kind === 'permission' && <div className="flex gap-1">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input-dark w-full text-xs" />
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input-dark w-full text-xs" />
          </div>}
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الطلب" className="input-dark mt-2 w-full min-h-16 text-xs" />
        <button disabled={submitting} onClick={() => void submitRequest()} className="btn-primary mt-2 text-xs">{submitting ? 'جارٍ الإرسال...' : 'إرسال الطلب'}</button>

        {!!myRequests.length && <div className="mt-4 space-y-1.5 border-t border-[var(--dawaa-theme-border)] pt-3">
          <p className="text-xs font-black text-[var(--dawaa-theme-muted)]">طلباتي الأخيرة</p>
          {myRequests.slice(0, 8).map((r) => { const meta = STATUS_META[r.status] || STATUS_META.cancelled; const cancellable = r.status === 'pending_branch_review' || r.status === 'pending_gm_review'; return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-xs">
              <span className="font-bold">{r.request_label} · {r.start_date}{r.end_date !== r.start_date ? ` ← ${r.end_date}` : ''}</span>
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', meta.cls)}>{meta.label}</span>
                {cancellable && <button disabled={busyId===r.id} onClick={() => void cancelRequest(r.id)} className="text-[10px] font-black text-[var(--dawaa-status-danger-text)] hover:underline">إلغاء</button>}
              </div>
            </div>
          ); })}
        </div>}
      </div>

      {branchQueue !== null && (
        <div className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 shadow-sm">
          <h3 className="mb-3 flex items-center gap-1.5 font-black text-[var(--dawaa-status-warning-text)]"><Clock3 size={16} /> طلبات بانتظار موافقتك (مدير الفرع) — {branchQueue.length}</h3>
          {!branchQueue.length ? <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات معلّقة.</p> : <div className="space-y-2">
            {branchQueue.map((q) => (
              <div key={q.id} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-[var(--dawaa-theme-heading)]">{q.staff_name} <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">— {q.branch} · {q.request_label} · {q.start_date}{q.end_date !== q.start_date ? ` ← ${q.end_date}` : ''}{q.start_time ? ` (${q.start_time}-${q.end_time})` : ''}</span></span>
                  <div className="flex items-center gap-2">
                    <button disabled={busyId===q.id} onClick={() => void decide('attendance_branch_review_time_off_v1', q.id, 'approve')} className="btn-primary px-2 py-1 text-xs"><CheckCircle2 size={12} className="inline ml-1" /> موافقة ورفع للمدير العام</button>
                    <button disabled={busyId===q.id} onClick={() => void decide('attendance_branch_review_time_off_v1', q.id, 'reject')} className="btn-secondary px-2 py-1 text-xs"><XCircle size={12} className="inline ml-1" /> رفض</button>
                  </div>
                </div>
                {q.reason && <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">السبب: {q.reason}</p>}
                <input value={notes[q.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [q.id]: e.target.value }))} placeholder="ملاحظة (اختياري)" className="input-dark mt-1 w-full text-xs" />
              </div>
            ))}
          </div>}
        </div>
      )}

      {gmQueue !== null && (
        <div className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 shadow-sm">
          <h3 className="mb-3 flex items-center gap-1.5 font-black text-[var(--dawaa-status-info-text)]"><ShieldCheck size={16} /> بانتظار اعتمادك النهائي (مدير عام) — {gmQueue.length}</h3>
          {!gmQueue.length ? <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات معلّقة.</p> : <div className="space-y-2">
            {gmQueue.map((q) => (
              <div key={q.id} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black text-[var(--dawaa-theme-heading)]">{q.staff_name} <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">— {q.branch} · {q.request_label} · {q.start_date}{q.end_date !== q.start_date ? ` ← ${q.end_date}` : ''}{q.start_time ? ` (${q.start_time}-${q.end_time})` : ''}</span></span>
                  <div className="flex items-center gap-2">
                    <button disabled={busyId===q.id} onClick={() => void decide('attendance_gm_review_time_off_v1', q.id, 'approve')} className="btn-primary px-2 py-1 text-xs"><CheckCircle2 size={12} className="inline ml-1" /> اعتماد نهائي</button>
                    <button disabled={busyId===q.id} onClick={() => void decide('attendance_gm_review_time_off_v1', q.id, 'reject')} className="btn-secondary px-2 py-1 text-xs"><XCircle size={12} className="inline ml-1" /> رفض</button>
                  </div>
                </div>
                {q.reason && <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">السبب: {q.reason}</p>}
                {q.branch_decided_by_name && <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[var(--dawaa-status-success-text)]"><CalendarCheck size={11} /> وافق عليه مدير الفرع: {q.branch_decided_by_name}{q.branch_note ? ` — ${q.branch_note}` : ''}</p>}
                <input value={notes[q.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [q.id]: e.target.value }))} placeholder="ملاحظة (اختياري)" className="input-dark mt-1 w-full text-xs" />
              </div>
            ))}
          </div>}
        </div>
      )}
    </div>
  );
}
