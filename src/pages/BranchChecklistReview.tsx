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
    if (!branch) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_daily_checklist_submissions')
      .select(
        'id, staff_id, branch, completed, photo_url, staff_note, review_status, reviewer_note, staff_daily_checklist_items(title, description, requires_photo), staff(name, role)'
      )
      .eq('branch', branch)
      .eq('submission_date', today)
      .eq('completed', true)
      .order('created_at', { ascending: true });
    if (error) {
      toast.error(error.message);
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
      const { error } = await supabase
        .from('staff_daily_checklist_submissions')
        .update({
          review_status: status,
          reviewed_by: user?.staffId || user?.id || null,
          reviewed_by_name: user?.name || null,
          reviewer_note: status === 'rejected' ? noteDraft[row.id] || null : null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(status === 'approved' ? 'اتعتمد' : 'اترفض وهيتسجل خصم تلقائي');
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, review_status: status } : r)));
    },
    [noteDraft, user]
  );

  const pending = rows.filter((r) => r.review_status === 'pending');
  const reviewed = rows.filter((r) => r.review_status !== 'pending');

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24">
      <div>
        <h1 className="text-xl font-black text-white">مراجعة تشيك ليست النظافة والمساعدين — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="mt-1 text-sm text-slate-400">
          راجع كل بند بالصورة المرفقة. الرفض بيسجل خصم تلقائي فورًا على الموظف المسؤول.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-black text-amber-300">بانتظار المراجعة ({pending.length})</h2>
            {pending.length === 0 ? <p className="text-sm text-slate-500">مفيش حاجة محتاجة مراجعة دلوقتي.</p> : null}
            {pending.map((row) => (
              <div key={row.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-black text-white">{row.staff_daily_checklist_items?.title}</p>
                  <span className="text-xs text-slate-400">{row.staff?.name}</span>
                </div>
                {row.staff_daily_checklist_items?.description ? (
                  <p className="mt-1 text-xs text-slate-400">{row.staff_daily_checklist_items.description}</p>
                ) : null}
                {row.photo_url ? (
                  <img src={row.photo_url} alt="دليل" className="mt-3 h-40 w-full rounded-xl object-cover" />
                ) : (
                  <p className="mt-3 text-xs text-rose-300">مفيش صورة مرفقة.</p>
                )}
                <textarea
                  placeholder="ملاحظة الرفض (اختياري بس بتتسجل مع الخصم)"
                  className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white placeholder:text-slate-500"
                  rows={2}
                  value={noteDraft[row.id] || ''}
                  onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void review(row, 'approved')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 py-2 text-sm font-black text-emerald-300"
                  >
                    <Check size={16} /> اعتماد
                  </button>
                  <button
                    onClick={() => void review(row, 'rejected')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-500/20 py-2 text-sm font-black text-rose-300"
                  >
                    <X size={16} /> رفض
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-400">اتراجعت النهاردة ({reviewed.length})</h2>
            {reviewed.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-xs">
                <span className="text-slate-300">{row.staff_daily_checklist_items?.title} — {row.staff?.name}</span>
                <span className={row.review_status === 'approved' ? 'text-emerald-300' : 'text-rose-300'}>
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
