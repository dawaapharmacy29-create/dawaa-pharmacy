import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';

type PendingLog = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  task_type: string;
  stage: string;
  case_key: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  reference_note: string | null;
  purchase_invoice_no: string | null;
  target_cumulative_points: number | null;
  logged_at: string;
};

const TASK_TYPE_LABEL: Record<string, string> = {
  supplier_order: 'طلبية مورد',
  branch_transfer: 'تحويل بين فرعين',
  followup_execution: 'متابعة عميل',
  request_fulfillment: 'تنفيذ طلب عميل',
  exceptional_followup: 'متابعة استثنائية',
  welcome_message: 'رسالة ترحيب',
};

const STAGE_LABEL: Record<string, string> = {
  sent: 'تم الإرسال',
  transferred: 'تم التحويل',
  executed: 'تم التنفيذ',
  purchased: 'تم الشراء',
  logged: 'تسجيل الطلب',
  sourced: 'تم التوفير',
  branch_notified: 'تم إبلاغ الفرع',
  customer_replied: 'العميل رد',
  exceptional_purchased: 'تم الشراء (استثنائي)',
};

function friendlyError(message: string): string {
  if (message.includes('purchase_invoice_required')) return 'الحالة دي محتاجة رقم فاتورة قبل ما تعتمدها.';
  if (message.includes('purchase_window_expired')) return 'المهلة الزمنية للشراء خلصت لهذه الحالة — مينفعش تتعتمد.';
  if (message.includes('already reviewed')) return 'الحالة دي اتراجعت بالفعل.';
  return message;
}

export default function AssistantOperationalReviewPanel() {
  const [logs, setLogs] = useState<PendingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc('list_pending_assistant_operational_logs_v1');
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLogs((data || []) as PendingLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = useCallback(
    async (logId: string, status: 'approved' | 'rejected', note?: string) => {
      setActingId(logId);
      try {
        const { error } = await supabase.rpc('review_assistant_operational_log_v1', {
          p_log_id: logId,
          p_status: status,
          p_reviewer_note: note || null,
        });
        if (error) throw error;
        toast.success(status === 'approved' ? 'تم الاعتماد' : 'تم الرفض');
        setRejectingId(null);
        setRejectNote('');
        setLogs((prev) => prev.filter((l) => l.id !== logId));
      } catch (err) {
        toast.error(friendlyError(err instanceof Error ? err.message : 'حصل خطأ'));
      } finally {
        setActingId(null);
      }
    },
    []
  );

  return (
    <Panel className="p-4">
      <SectionTitle
        title="اعتماد عمليات نور وهاجر وهبة حماده"
        subtitle="كل عملية لازم تتراجع قبل ما تتحول لنقاط حقيقية"
      />
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : loadError ? (
        <EmptyState label="تعذّر تحميل العمليات بانتظار الاعتماد" error onRetry={() => void load()} />
      ) : logs.length === 0 ? (
        <EmptyState label="مفيش عمليات بانتظار الاعتماد دلوقتي" />
      ) : (
        <div className="space-y-3">
          {logs.map((l) => (
            <div key={l.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {l.staff_name} — {TASK_TYPE_LABEL[l.task_type] || l.task_type} — {STAGE_LABEL[l.stage] || l.stage}
                </p>
                <span className="text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
                  +{l.target_cumulative_points} نقطة تراكمية
                </span>
              </div>
              <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                {l.branch} {l.customer_name ? `— ${l.customer_name}` : ''} {l.customer_phone ? `— ${l.customer_phone}` : ''}
              </p>
              {l.purchase_invoice_no ? (
                <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>رقم الفاتورة: {l.purchase_invoice_no}</p>
              ) : null}
              {l.reference_note ? (
                <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة: {l.reference_note}</p>
              ) : null}
              <p className="mt-1 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                {new Date(l.logged_at).toLocaleString('ar-EG')}
              </p>

              {rejectingId === l.id ? (
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
                      disabled={actingId === l.id}
                      onClick={() => void handleReview(l.id, 'rejected', rejectNote)}
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
                    disabled={actingId === l.id}
                    onClick={() => void handleReview(l.id, 'approved')}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-black text-white"
                    style={{ background: 'var(--dawaa-status-success-text)' }}
                  >
                    {actingId === l.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    اعتماد
                  </button>
                  <button
                    type="button"
                    disabled={actingId === l.id}
                    onClick={() => setRejectingId(l.id)}
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
