import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Row = Record<string, any>;

type Attachment = {
  id: string;
  review_id: string;
  storage_path: string;
  file_name?: string | null;
  signedUrl?: string;
};

function text(value: unknown) { return String(value ?? '').trim(); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function formatDate(value?: string | null) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
function maskPhone(value: unknown) { const phone = text(value); if (phone.length < 7) return phone || '—'; return `${phone.slice(0, 3)}••••${phone.slice(-3)}`; }
function reviewItems(row: Row) {
  if (Array.isArray(row.review_items)) return row.review_items;
  const raw = typeof row.raw_scores === 'string' ? (() => { try { return JSON.parse(row.raw_scores); } catch { return null; } })() : row.raw_scores;
  return Array.isArray(raw?.result?.reviewItems) ? raw.result.reviewItems : [];
}

export default function DoctorReviewDetails() {
  const { user } = useAuth();
  const staffId = text(user?.staffId);
  const [rows, setRows] = useState<Row[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    const [byStaff, byDoctor] = await Promise.all([
      supabase.from('conversation_sales_reviews').select('*').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(100),
      supabase.from('conversation_sales_reviews').select('*').eq('doctor_id', staffId).order('created_at', { ascending: false }).limit(100),
    ]);
    const unique = new Map<string, Row>();
    [...(byStaff.data || []), ...(byDoctor.data || [])].forEach((row: Row) => unique.set(text(row.id), row));
    const reviews = [...unique.values()].sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)));
    setRows(reviews);

    const ids = reviews.map((row) => text(row.id)).filter(Boolean);
    if (ids.length) {
      const result = await supabase.from('conversation_review_attachments').select('*').in('review_id', ids).order('created_at');
      const signed = await Promise.all(((result.data || []) as Attachment[]).map(async (item) => {
        const url = await supabase.storage.from('conversation-review-evidence').createSignedUrl(item.storage_path, 3600);
        return { ...item, signedUrl: url.data?.signedUrl };
      }));
      setAttachments(signed);
    } else setAttachments([]);
    setLoading(false);
  }, [staffId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    attachments.forEach((item) => map.set(item.review_id, [...(map.get(item.review_id) || []), item]));
    return map;
  }, [attachments]);

  return <section dir="rtl" className="mt-5 rounded-3xl border border-cyan-400/20 bg-slate-900/85 p-5">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-2xl font-black text-white">التفاصيل الكاملة لتقييمات محادثاتي</h2><p className="mt-1 text-sm text-slate-400">لا تظهر هنا إلا التقييمات المرتبطة بمعرف حسابك، مع بنود التقييم ورسالة خدمة العملاء وصور المحادثة.</p></div>
      <button type="button" onClick={() => void load()} className="btn-secondary"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`}/> تحديث</button>
    </div>

    <div className="mt-4 space-y-3">{rows.map((row) => {
      const id = text(row.id);
      const items = reviewItems(row);
      const files = grouped.get(id) || [];
      const open = openId === id;
      return <article key={id} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
        <button type="button" onClick={() => setOpenId(open ? null : id)} className="flex w-full items-start justify-between gap-3 text-right">
          <div><div className="font-black text-white">{text(row.evaluation_kind || row.conversation_type || 'تقييم محادثة')} — {text(row.customer_name || 'عميل غير محدد')}</div><div className="mt-1 text-xs text-slate-400">{formatDate(row.created_at || row.conversation_date)} · بواسطة {text(row.reviewer_name || 'خدمة العملاء')} · تأثير النقاط {num(row.doctor_points_impact ?? row.point_impact)}</div></div>
          <div className="flex items-center gap-2"><span className="text-xl font-black text-teal-200">{num(row.final_score ?? row.total_score)}/100</span>{open ? <ChevronUp/> : <ChevronDown/>}</div>
        </button>

        {open ? <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm"><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">العميل:</b><div className="mt-1 text-white">{text(row.customer_name || '—')}</div></div><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">الكود:</b><div className="mt-1 text-white">{text(row.customer_code || '—')}</div></div><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">الهاتف:</b><div className="mt-1 text-white">{maskPhone(row.customer_phone)}</div></div><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">سبب التقييم:</b><div className="mt-1 text-white">{text(row.evaluation_reason || '—')}</div></div></div>

          {text(row.reviewer_message) ? <div className="rounded-2xl border border-teal-400/30 bg-teal-500/10 p-4"><div className="font-black text-teal-100">رسالة دكتورة خدمة العملاء لك</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white">{text(row.reviewer_message)}</p></div> : null}
          {text(row.reviewer_notes) ? <div className="rounded-xl bg-slate-900 p-3 text-sm text-slate-200"><b className="text-amber-200">ملاحظات المراجع:</b> {text(row.reviewer_notes)}</div> : null}
          {text(row.training_recommendation) ? <div className="rounded-xl bg-sky-500/10 p-3 text-sm text-sky-100"><b>المطلوب للتطوير:</b> {text(row.training_recommendation)}</div> : null}

          {items.length ? <div><h3 className="mb-3 font-black text-white">بنود التقييم بالتفصيل</h3><div className="grid gap-2">{items.map((item: Row, index: number) => <div key={`${item.key || index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-white">{text(item.label || item.key)}</b><span className="font-black text-teal-200">{num(item.pointsEarned)}/{num(item.maxPoints)}</span></div><div className="mt-1 text-sm text-slate-300">الاختيار: {text(item.selectedOption || '—')}</div>{text(item.notes) ? <div className="mt-2 text-sm text-amber-100">ملاحظة: {text(item.notes)}</div> : null}</div>)}</div></div> : null}

          {files.length ? <div><h3 className="mb-3 flex items-center gap-2 font-black text-white"><ImageIcon/> صور المحادثة</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{files.map((file) => <a key={file.id} href={file.signedUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl border border-slate-700 bg-slate-900"><img src={file.signedUrl} alt={file.file_name || 'صورة المحادثة'} className="h-64 w-full object-cover"/><div className="flex items-center justify-between p-3 text-sm font-black text-teal-200">فتح الصورة كاملة <ExternalLink size={16}/></div></a>)}</div></div> : null}
        </div> : null}
      </article>;
    })}{!loading && !rows.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">لا توجد تقييمات مرتبطة بحسابك.</div> : null}</div>
  </section>;
}
