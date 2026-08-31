import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';

type PendingTask = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  task_kind: 'shelf' | 'inventory';
  zone: string;
  log_date: string;
  notes: string | null;
  points: number;
  created_at: string;
};

const TASK_KIND_LABEL: Record<string, string> = {
  shelf: 'رص',
  inventory: 'جرد',
};

export default function PharmacyZoneReviewPanel() {
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc('list_pending_pharmacy_zone_tasks_v1');
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setTasks((data || []) as PendingTask[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = useCallback(async (taskId: string, status: 'approved' | 'rejected', note?: string) => {
    setActingId(taskId);
    try {
      const { error } = await supabase.rpc('review_pharmacy_zone_task_v1', {
        p_log_id: taskId,
        p_status: status,
        p_reviewer_note: note || null,
      });
      if (error) throw error;
      toast.success(status === 'approved' ? 'تم الاعتماد' : 'تم الرفض');
      setRejectingId(null);
      setRejectNote('');
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ');
    } finally {
      setActingId(null);
    }
  }, []);

  return (
    <Panel className="p-4">
      <SectionTitle title="اعتماد الرص والجرد" subtitle="مهام شيماء ويوسف عصام — تحتاج اعتماد قبل تحويلها لنقاط" />
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : loadError ? (
        <EmptyState label="تعذّر تحميل المهام بانتظار الاعتماد" error onRetry={() => void load()} />
      ) : tasks.length === 0 ? (
        <EmptyState label="مفيش مهام بانتظار الاعتماد دلوقتي" />
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {t.staff_name} — {TASK_KIND_LABEL[t.task_kind]} {t.zone}
                </p>
                <span className="text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>+{t.points} نقطة</span>
              </div>
              <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                {t.branch} — {t.log_date}
              </p>
              {t.notes ? (
                <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>ملاحظة: {t.notes}</p>
              ) : null}

              {rejectingId === t.id ? (
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    className="input-dark w-full text-sm"
                    placeholder="سبب الرفض (اختياري)"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={actingId === t.id}
                      onClick={() => void handleReview(t.id, 'rejected', rejectNote)}
                      className="flex-1 rounded-lg py-2 text-sm font-black text-white"
                      style={{ background: 'var(--dawaa-status-danger-text)' }}
                    >
                      تأكيد الرفض
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectNote('');
                      }}
                      className="flex-1 rounded-lg border py-2 text-sm font-black"
                      style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-text)' }}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={actingId === t.id}
                    onClick={() => void handleReview(t.id, 'approved')}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-black text-white"
                    style={{ background: 'var(--dawaa-status-success-text)' }}
                  >
                    {actingId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    اعتماد
                  </button>
                  <button
                    type="button"
                    disabled={actingId === t.id}
                    onClick={() => setRejectingId(t.id)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-sm font-black"
                    style={{ borderColor: 'var(--dawaa-status-danger-border)', color: 'var(--dawaa-status-danger-text)' }}
                  >
                    <X size={14} /> رفض
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
