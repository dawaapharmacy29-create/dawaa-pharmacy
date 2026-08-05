import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, ExternalLink, Image as ImageIcon, RefreshCw, TrendingUp } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, getCycleForDate, isDateInCycle, type PharmacyCycle } from '@/lib/pharmacy-cycle';

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
function rowDate(row: Row) { return row.conversation_date || row.created_at; }
function threeCycles(): PharmacyCycle[] {
  const current = getCurrentCycle();
  const prevDate = new Date(current.start); prevDate.setDate(prevDate.getDate() - 1);
  const previous = getCycleForDate(prevDate);
  const beforeDate = new Date(previous.start); beforeDate.setDate(beforeDate.getDate() - 1);
  const beforePrevious = getCycleForDate(beforeDate);
  return [current, previous, beforePrevious];
}

export default function DoctorReviewDetails() {
  const { user } = useAuth();
  const staffId = text(user?.staffId);
  const [searchParams] = useSearchParams();
  const focusReviewId = text(searchParams.get('reviewId'));
  const [rows, setRows] = useState<Row[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [openId, setOpenId] = useState<string | null>(focusReviewId || null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    const [byStaff, byDoctor] = await Promise.all([
      supabase.from('conversation_sales_reviews').select('*').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(500),
      supabase.from('conversation_sales_reviews').select('*').eq('doctor_id', staffId).order('created_at', { ascending: false }).limit(500),
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

  useEffect(() => {
    if (!focusReviewId || !rows.some((row) => text(row.id) === focusReviewId)) return;
    const el = document.getElementById(`review-${focusReviewId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusReviewId, rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    attachments.forEach((item) => map.set(item.review_id, [...(map.get(item.review_id) || []), item]));
    return map;
  }, [attachments]);

  const cycles = useMemo(() => threeCycles(), []);
  const [cycleIndex, setCycleIndex] = useState(0);
  const selectedCycle = cycles[cycleIndex];

  const rowsByCycle = useMemo(() => cycles.map((cycle) => rows.filter((row) => {
    const d = rowDate(row);
    if (!d) return false;
    const parsed = new Date(d);
    return !Number.isNaN(parsed.getTime()) && isDateInCycle(parsed, cycle);
  })), [rows, cycles]);

  const visibleRows = rowsByCycle[cycleIndex] || [];

  const cycleStats = useMemo(() => cycles.map((cycle, i) => {
    const list = rowsByCycle[i] || [];
    const avg = list.length ? list.reduce((sum, row) => sum + num(row.final_score ?? row.total_score), 0) / list.length : null;
    const impact = list.reduce((sum, row) => sum + num(row.doctor_points_impact ?? row.point_impact), 0);
    return { cycle, count: list.length, avg, impact };
  }), [cycles, rowsByCycle]);

  return <section dir="rtl" className="mt-5 rounded-3xl border border-cyan-400/20 bg-slate-900/85 p-5">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-2xl font-black text-white">تقييماتي وتفاصيل محادثاتي</h2><p className="mt-1 text-sm text-slate-400">لا تظهر هنا إلا التقييمات المرتبطة بمعرف حسابك، مع بنود التقييم ورسالة خدمة العملاء وصور المحادثة.</p></div>
      <button type="button" onClick={() => void load()} className="btn-secondary"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`}/> تحديث</button>
    </div>

    {rows.length ? (
      <div className="mt-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {cycles.map((cycle, i) => (
            <button
              key={cycle.shortLabel}
              type="button"
              onClick={() => setCycleIndex(i)}
              className={`rounded-2xl border p-3 text-center transition ${cycleIndex === i ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-slate-700 bg-slate-950/40'}`}
            >
              <div className="text-xs font-bold text-slate-400">{i === 0 ? 'الدورة الحالية' : i === 1 ? 'الدورة اللي فاتت' : 'اللي قبلها'}</div>
              <div className="mt-1 text-lg font-black text-white">{cycle.shortLabel}</div>
              <div className="mt-1 text-2xl font-black text-cyan-200">{cycleStats[i].count} تقييم</div>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 font-black text-violet-200"><TrendingUp size={18} /> تحليل الأداء عبر آخر 3 دورات</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {cycleStats.map((s, i) => (
              <div key={s.cycle.shortLabel} className="rounded-xl bg-slate-950/40 p-3 text-sm">
                <div className="font-bold text-white">{s.cycle.shortLabel}</div>
                <div className="mt-1 flex justify-between text-slate-300"><span>متوسط التقييم</span><span className="font-black text-teal-200">{s.avg != null ? `${s.avg.toFixed(1)}%` : '—'}</span></div>
                <div className="mt-1 flex justify-between text-slate-300"><span>عدد المحادثات</span><span className="font-black text-white">{s.count}</span></div>
                <div className="mt-1 flex justify-between text-slate-300"><span>تأثير النقاط</span><span className={`font-black ${s.impact >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{s.impact >= 0 ? '+' : ''}{s.impact}</span></div>
                {i > 0 && cycleStats[i - 1].avg != null && s.avg != null ? (
                  <div className="mt-2 text-xs font-bold" style={{ color: s.avg >= (cycleStats[i - 1].avg as number) ? '#6ee7b7' : '#fda4af' }}>
                    {s.avg >= (cycleStats[i - 1].avg as number) ? '▲' : '▼'} مقارنة بالدورة اللي بعدها
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-3 text-center"><div className="text-2xl font-black text-white">{visibleRows.length}</div><div className="mt-1 text-xs font-bold text-slate-400">عدد التقييمات — {selectedCycle.shortLabel}</div></div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-3 text-center"><div className="text-2xl font-black text-teal-200">{visibleRows.length ? (visibleRows.reduce((sum, row) => sum + num(row.final_score ?? row.total_score), 0) / visibleRows.length).toFixed(1) : '0'}%</div><div className="mt-1 text-xs font-bold text-slate-400">متوسط التقييم</div></div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-3 text-center"><div className="text-2xl font-black text-amber-200">{visibleRows.reduce((sum, row) => sum + num(row.doctor_points_impact ?? row.point_impact), 0)}</div><div className="mt-1 text-xs font-bold text-slate-400">إجمالي تأثير النقاط</div></div>
        </div>
      </div>
    ) : null}

    <div className="mt-4 space-y-3">{visibleRows.map((row) => {
      const id = text(row.id);
      const items = reviewItems(row);
      const files = grouped.get(id) || [];
      const open = openId === id;
      return <article key={id} id={`review-${id}`} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
        <button type="button" onClick={() => setOpenId(open ? null : id)} className="flex w-full items-start justify-between gap-3 text-right">
          <div><div className="font-black text-white">{text(row.evaluation_kind || row.conversation_type || 'تقييم محادثة')} — {text(row.customer_name || 'عميل غير محدد')}</div><div className="mt-1 text-xs text-slate-400">{formatDate(row.created_at || row.conversation_date)} · بواسطة {text(row.reviewer_name || 'خدمة العملاء')} · تأثير النقاط {num(row.doctor_points_impact ?? row.point_impact)}</div></div>
          <div className="flex items-center gap-3">
            <span className="text-xl font-black text-teal-200">{num(row.final_score ?? row.total_score)}/100</span>
            <span className="flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5 text-xs font-black text-cyan-200">
              <Eye size={15} /> التفاصيل
            </span>
            {open ? <ChevronUp/> : <ChevronDown/>}
          </div>
        </button>

        {open ? <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm"><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">العميل:</b><div className="mt-1 text-white">{text(row.customer_name || '—')}</div></div><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">الكود:</b><div className="mt-1 text-white">{text(row.customer_code || '—')}</div></div><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">الهاتف:</b><div className="mt-1 text-white">{maskPhone(row.customer_phone)}</div></div><div className="rounded-xl bg-slate-900 p-3"><b className="text-slate-400">سبب التقييم:</b><div className="mt-1 text-white">{text(row.evaluation_reason || '—')}</div></div></div>

          {text(row.reviewer_message) ? <div className="rounded-2xl border border-teal-400/30 bg-teal-500/10 p-4"><div className="font-black text-teal-100">رسالة دكتورة خدمة العملاء لك</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white">{text(row.reviewer_message)}</p></div> : null}
          {text(row.reviewer_notes) ? <div className="rounded-xl bg-slate-900 p-3 text-sm text-slate-200"><b className="text-amber-200">ملاحظات المراجع:</b> {text(row.reviewer_notes)}</div> : null}
          {text(row.training_recommendation) ? <div className="rounded-xl bg-sky-500/10 p-3 text-sm text-sky-100"><b>المطلوب للتطوير:</b> {text(row.training_recommendation)}</div> : null}

          {items.length ? (() => {
            const applicable = items.filter((item: Row) => item.applies !== false);
            const notApplicable = items.filter((item: Row) => item.applies === false);
            return <div>
              <h3 className="mb-3 font-black text-white">بنود التقييم بالتفصيل ({applicable.length} من {items.length})</h3>
              <div className="grid gap-2">
                {applicable.map((item: Row, index: number) => (
                  <div key={`${item.key || index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-white">{text(item.label || item.key)}</b><span className="font-black text-teal-200">{num(item.pointsEarned)}/{num(item.maxPoints)}</span></div>
                    <div className="mt-1 text-sm text-slate-300">الاختيار: {text(item.selectedOption || '—')}</div>
                    {text(item.notes) ? <div className="mt-2 text-sm text-amber-100">ملاحظة: {text(item.notes)}</div> : null}
                  </div>
                ))}
              </div>
              {notApplicable.length ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-bold text-slate-500">بنود غير مطبقة على هذه المحادثة (مش داخلة في حساب التقييم):</p>
                  <div className="grid gap-2 opacity-40">
                    {notApplicable.map((item: Row, index: number) => (
                      <div key={`na-${item.key || index}`} className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <b className="text-slate-400 line-through">{text(item.label || item.key)}</b>
                          <span className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[11px] font-black text-slate-400">لا ينطبق</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>;
          })() : null}

          {files.length ? <div><h3 className="mb-3 flex items-center gap-2 font-black text-white"><ImageIcon/> صور المحادثة</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{files.map((file) => <a key={file.id} href={file.signedUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl border border-slate-700 bg-slate-900"><img src={file.signedUrl} alt={file.file_name || 'صورة المحادثة'} className="h-64 w-full object-cover"/><div className="flex items-center justify-between p-3 text-sm font-black text-teal-200">فتح الصورة كاملة <ExternalLink size={16}/></div></a>)}</div></div> : null}
        </div> : null}
      </article>;
    })}{!loading && !visibleRows.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">{rows.length ? `مفيش تقييمات في ${selectedCycle.shortLabel}.` : 'لا توجد تقييمات مرتبطة بحسابك.'}</div> : null}</div>
  </section>;
}
