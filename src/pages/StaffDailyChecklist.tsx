import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Check, Clock, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { uploadImageToStorage } from '@/lib/storageUpload';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { toast } from 'sonner';

type ChecklistItem = {
  id: string;
  item_key: string;
  title: string;
  description: string | null;
  time_slot: string;
  sort_order: number;
  requires_photo: boolean;
};

type Submission = {
  id: string;
  item_id: string;
  completed: boolean;
  photo_url: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
};

const TIME_SLOT_ORDER: Record<string, number> = { 'فتح': 0, 'أثناء اليوم': 1, 'قفل': 2 };

const STATUS_LABEL: Record<Submission['review_status'], { label: string; className: string }> = {
  pending: { label: 'بانتظار مراجعة المدير', className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  approved: { label: 'معتمد', className: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  rejected: { label: 'مرفوض', className: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
};

export default function StaffDailyChecklist() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const branch = user?.branch || '';
  const role = normalizeRole(user?.role) === 'assistant' ? 'مساعد صيدلي' : null;
  const isCleaner = /نظاف/.test(String(user?.role || ''));
  const staffRole = isCleaner ? 'مسؤولة النظافة' : role;

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!staffRole) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [itemsRes, subsRes] = await Promise.all([
      supabase
        .from('staff_daily_checklist_items')
        .select('id, item_key, title, description, time_slot, sort_order, requires_photo')
        .eq('role', staffRole)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      staffId
        ? supabase
            .from('staff_daily_checklist_submissions')
            .select('id, item_id, completed, photo_url, review_status, reviewer_note')
            .eq('staff_id', staffId)
            .eq('submission_date', today)
        : Promise.resolve({ data: [] as Submission[] }),
    ]);
    setItems((itemsRes.data || []) as ChecklistItem[]);
    const map: Record<string, Submission> = {};
    ((subsRes.data || []) as Submission[]).forEach((s) => {
      map[s.item_id] = s;
    });
    setSubmissions(map);
    setLoading(false);
  }, [staffId, staffRole, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const groups: Record<string, ChecklistItem[]> = {};
    items.forEach((item) => {
      groups[item.time_slot] = groups[item.time_slot] || [];
      groups[item.time_slot].push(item);
    });
    return Object.entries(groups).sort((a, b) => (TIME_SLOT_ORDER[a[0]] ?? 9) - (TIME_SLOT_ORDER[b[0]] ?? 9));
  }, [items]);

  const handleUploadAndComplete = useCallback(
    async (item: ChecklistItem, file: File | null) => {
      if (!staffId) return;
      setUploadingKey(item.item_key);
      try {
        let photoUrl: string | null = null;
        if (file) {
          const { publicUrl } = await uploadImageToStorage('checklist-evidence', file, `${branch}/${staffId}`);
          photoUrl = publicUrl;
        }
        if (item.requires_photo && !photoUrl) {
          toast.error('البند ده محتاج صورة قبل ما تتم عليه.');
          setUploadingKey(null);
          return;
        }
        const { data, error } = await supabase
          .from('staff_daily_checklist_submissions')
          .upsert(
            {
              staff_id: staffId,
              item_id: item.id,
              submission_date: today,
              branch,
              completed: true,
              photo_url: photoUrl,
              submitted_at: new Date().toISOString(),
              review_status: 'pending',
            },
            { onConflict: 'staff_id,item_id,submission_date' }
          )
          .select('id, item_id, completed, photo_url, review_status, reviewer_note')
          .single();
        if (error) throw error;
        setSubmissions((prev) => ({ ...prev, [item.id]: data as Submission }));
        toast.success('اتسجل، وهيتراجع من مدير الفرع.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
      } finally {
        setUploadingKey(null);
      }
    },
    [branch, staffId, today]
  );

  if (!staffRole) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        الصفحة دي مخصصة لعامل النظافة والمساعد فقط.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24">
      <div>
        <h1 className="text-xl font-black text-white">التشيك ليست اليومي — {new Date().toLocaleDateString('ar-EG')}</h1>
        <p className="mt-1 text-sm text-slate-400">علّم كل بند وارفع صورة كدليل. مدير الفرع هيراجعها النهاردة.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : (
        grouped.map(([slot, slotItems]) => (
          <div key={slot} className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-black text-teal-300">
              <Clock size={14} /> {slot}
            </h2>
            {slotItems.map((item) => {
              const sub = submissions[item.id];
              const status = sub ? STATUS_LABEL[sub.review_status] : null;
              return (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-white">{item.title}</p>
                      {item.description ? <p className="mt-1 text-xs text-slate-400">{item.description}</p> : null}
                    </div>
                    {sub?.completed ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                        <Check size={16} />
                      </span>
                    ) : null}
                  </div>

                  {status ? (
                    <div className={`mt-3 rounded-lg border px-3 py-1.5 text-xs font-black ${status.className}`}>
                      {status.label}
                      {sub?.review_status === 'rejected' && sub.reviewer_note ? (
                        <span className="mt-1 block font-normal">{sub.reviewer_note}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {sub?.photo_url ? (
                    <img src={sub.photo_url} alt={item.title} className="mt-3 h-32 w-full rounded-xl object-cover" />
                  ) : null}

                  {!sub?.completed ? (
                    <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 py-3 text-sm font-black text-slate-300 hover:border-teal-400/40">
                      {uploadingKey === item.item_key ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <Camera size={16} /> {item.requires_photo ? 'صوّر وسجّل' : 'سجّل الإنجاز'}
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingKey === item.item_key}
                        onChange={(e) => void handleUploadAndComplete(item, e.target.files?.[0] || null)}
                      />
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
