import { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const BUCKET = 'conversation-review-evidence';
const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ReviewRow = {
  id: string;
  staff_id?: string | null;
  staff_name?: string | null;
  branch?: string | null;
  final_score?: number | null;
  total_score?: number | null;
  created_at?: string | null;
  customer_name?: string | null;
  reviewer_message?: string | null;
};

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'chat';
}

export default function ConversationReviewEvidence() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [reviewId, setReviewId] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('conversation_sales_reviews')
        .select('id,staff_id,staff_name,branch,final_score,total_score,created_at,customer_name,reviewer_message')
        .order('created_at', { ascending: false })
        .limit(150);
      if (error) toast.error(error.message);
      setReviews((data || []) as ReviewRow[]);
      const fromUrl = new URLSearchParams(window.location.search).get('review');
      if (fromUrl) setReviewId(fromUrl);
      setLoading(false);
    })();
  }, []);

  const selected = useMemo(() => reviews.find((row) => row.id === reviewId) || null, [reviewId, reviews]);

  const pickFiles = (list: FileList | null) => {
    const next = Array.from(list || []);
    for (const file of next) {
      if (!ALLOWED.has(file.type)) {
        toast.error('المسموح JPG أو PNG أو WEBP فقط.');
        return;
      }
      if (file.size > MAX_SIZE) {
        toast.error('حجم كل صورة يجب ألا يتجاوز 5 ميجا.');
        return;
      }
    }
    setFiles((current) => [...current, ...next].slice(0, MAX_FILES));
  };

  const save = async () => {
    if (!selected) return toast.error('اختاري التقييم أولًا.');
    if (!message.trim() && files.length === 0) return toast.error('اكتبي رسالة توجيه أو أرفقي صورة واحدة على الأقل.');
    setSaving(true);
    try {
      if (message.trim()) {
        const { error } = await supabase
          .from('conversation_sales_reviews')
          .update({ reviewer_message: message.trim(), updated_at: new Date().toISOString() })
          .eq('id', selected.id);
        if (error) throw error;
      }

      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const unique = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const path = `${selected.staff_id || 'unlinked'}/${selected.id}/${unique}-${safeName(file.name)}.${ext}`;
        const upload = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type });
        if (upload.error) throw upload.error;
        const insert = await supabase.from('conversation_review_attachments').insert({
          review_id: selected.id,
          staff_id: selected.staff_id || null,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          uploaded_by: user?.id || null,
          uploaded_by_name: user?.name || null,
        });
        if (insert.error) throw insert.error;
      }

      toast.success('تم حفظ رسالة التوجيه وصور المحادثة.');
      setFiles([]);
      setMessage('');
    } catch (error) {
      toast.error(`تعذر الحفظ: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return <div dir="rtl" className="space-y-5">
    <section className="rounded-3xl border border-teal-400/25 bg-slate-900/85 p-5">
      <h1 className="text-3xl font-black text-white">إرفاق تفاصيل وصور المحادثة</h1>
      <p className="mt-2 text-sm text-slate-300">اختاري التقييم، اكتبي رسالة واضحة للدكتور، ثم ارفقي حتى 5 صور من محادثة واتساب.</p>
    </section>

    <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
      <label className="block text-sm font-black text-slate-200">التقييم</label>
      <select className="input-dark w-full" value={reviewId} onChange={(event) => setReviewId(event.target.value)} disabled={loading}>
        <option value="">{loading ? 'جارٍ التحميل…' : 'اختاري تقييمًا'}</option>
        {reviews.map((row) => <option key={row.id} value={row.id}>{row.staff_name || 'غير محدد'} — {row.branch || 'بدون فرع'} — {row.final_score ?? row.total_score ?? 0}/100 — {row.customer_name || 'بدون عميل'}</option>)}
      </select>

      <label className="block text-sm font-black text-slate-200">رسالة موجهة للدكتور</label>
      <textarea className="input-dark min-h-32 w-full" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="اكتبي الملاحظة العملية: ما الذي تم بشكل جيد؟ ما المطلوب تغييره؟ وما الجملة أو التصرف الأفضل في المرة القادمة؟" />

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-teal-400/40 bg-teal-500/10 p-6 font-black text-teal-100">
        <ImagePlus /> إرفاق صور المحادثة
        <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => pickFiles(event.target.files)} />
      </label>

      {files.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{files.map((file, index) => <div key={`${file.name}-${index}`} className="rounded-2xl border border-slate-700 p-3"><img src={URL.createObjectURL(file)} alt={file.name} className="h-48 w-full rounded-xl object-cover" /><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="mt-2 flex items-center gap-2 text-sm font-black text-red-300"><Trash2 size={16}/> حذف</button></div>)}</div> : null}

      <button type="button" onClick={() => void save()} disabled={saving || !selected} className="btn-primary flex items-center gap-2 disabled:opacity-50">{saving ? <Loader2 className="animate-spin"/> : <Save/>} حفظ الرسالة والمرفقات</button>
    </section>
  </div>;
}
