import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type Row = {
  id: string;
  staff_id: string;
  branch: string;
  completed: boolean;
  photo_url: string | null;
  staff_note: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
  staff_daily_checklist_items: { title: string; description: string | null; requires_photo: boolean } | null;
  staff: { name: string; role: string } | null;
};

export default function BranchChecklistReview() {
  const { user } = useAuth();
  const branch = user?.branch || '';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!branch) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_daily_checklist_submissions')
      .select(
        'id, staff_id, branch, completed, photo_url, staff_note, review_status, reviewer_note, staff_daily_checklist_items(title, description, requires_photo), staff:staff!staff_daily_checklist_submissions_staff_id_fkey(name, role)'
      )
      .eq('branch', branch)
      .eq('submission_date', today)
      .eq('completed', true)
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('تعذر تحميل مراجعات التشيك ليست');
      console.error('[BranchChecklistReview] load failed', error);
      setRows([]);
    } else {
      setRows((data || []) as unknown as Row[]);
    }
    setLoading(false);
  }, [branch, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(
    async (row: Row, status: 'approved' | 'rejected') => {
      const { data, error } = await supabase.rpc('review_staff_daily_checklist_v1', {
        p_submission_id: row.id,
        p_status: status,
        p_reviewer_note: status === 'rejected' ? noteDraft[row.id] || null : null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(status === 'approved' ? 'تم الاعتماد' : 'تم الرفض وتسجيل الإجراء');
      const saved = Array.isArray(data) ? data[0] : data;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, review_status: saved?.review_status || status } : r)));
    },
    [noteDraft]
  );

  const pending = rows.filter((r) => r.review_status === 'pending');
  const reviewed = rows.filter((r) => r.review_status !== 'pending');

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24" dir="rtl">
      <div className="dawaa-card dawaa-card--raised p-5">
        <h1 className="dawaa-title text-xl">مراجعة تشيك ليست النظافة والمساعدين — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="dawaa-caption mt-1 text-sm font-semibold">
          راجع كل بند والصورة المرفقة. الرفض يسجل الإجراء المعتمد على الموظف المسؤول.
        </p>
      </div>

      {loading ? (
        <div className="dawaa-card flex justify-center py-10"><Loader2 className="animate-spin text-[var(--dawaa-theme-primary)]" /></div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-black text-[var(--dawaa-status-warning-text)]">بانتظار المراجعة ({pending.length})</h2>
            {pending.length === 0 ? (
              <div className="dawaa-card dawaa-card--soft p-4 text-sm font-semibold text-[var(--dawaa-theme-muted)]">لا توجد بنود تحتاج مراجعة الآن.</div>
            ) : null}
            {pending.map((row) => (
              <div key={row.id} className="dawaa-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_daily_checklist_items?.title || 'بند بدون عنوان'}</p>
                  <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.staff?.name || 'موظف غير محدد'}</span>
                </div>
                {row.staff_daily_checklist_items?.description ? (
                  <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{row.staff_daily_checklist_items.description}</p>
                ) : null}
                {row.photo_url ? (
                  <img src={row.photo_url} alt="دليل تنفيذ البند" className="mt-3 h-40 w-full rounded-xl border border-[var(--dawaa-theme-border)] object-cover" />
                ) : (
                  <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold">لا توجد صورة مرفقة.</div>
                )}
                <textarea
                  placeholder="ملاحظة الرفض (اختياري)"
                  className="dawaa-input mt-3 w-full p-2 text-xs"
                  rows={2}
                  value={noteDraft[row.id] || ''}
                  onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void review(row, 'approved')}
                    className="dawaa-button dawaa-button--primary flex flex-1 items-center justify-center gap-1.5"
                  >
                    <Check size={16} /> اعتماد
                  </button>
                  <button
                    onClick={() => void review(row, 'rejected')}
                    className="dawaa-button dawaa-button--danger flex flex-1 items-center justify-center gap-1.5"
                  >
                    <X size={16} /> رفض
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-[var(--dawaa-theme-muted)]">تمت مراجعتها اليوم ({reviewed.length})</h2>
            {reviewed.map((row) => (
              <div key={row.id} className="dawaa-card dawaa-card--soft flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="font-semibold text-[var(--dawaa-theme-text)]">{row.staff_daily_checklist_items?.title || 'بند'} — {row.staff?.name || 'موظف غير محدد'}</span>
                <span className={row.review_status === 'approved' ? 'font-black text-[var(--dawaa-status-success-text)]' : 'font-black text-[var(--dawaa-status-danger-text)]'}>
                  {row.review_status === 'approved' ? 'معتمد' : 'مرفوض'}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
