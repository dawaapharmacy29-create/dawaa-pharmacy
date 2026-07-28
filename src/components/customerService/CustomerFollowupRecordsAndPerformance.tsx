import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Eye, History, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';

type ViewMode = 'exceptional' | 'completed' | 'performance';
type Row = Record<string, any>;

const text = (value: unknown) => String(value ?? '').trim();
const finalStatus = (row: Row) => /مكتمل|تم$|تم الرد والعميل راضي|تم الشراء|تم حل|completed|closed|resolved/i.test(text(row.followup_status || row.status || row.contact_status || row.followup_result));
const exceptional = (row: Row) => /exceptional_followup|متابعة استثنائية/i.test(`${row.request_type || ''} ${row.source || ''} ${row.followup_reason || ''} ${row.notes || ''}`);
const actor = (row: Row) => text(row.assigned_doctor || row.responsible_name || row.completed_by_name || row.updated_by_name || 'غير محدد');
const requester = (row: Row) => text(row.requested_by_name || row.created_by_name || 'غير محدد');
const customer = (row: Row) => text(row.customer_name || row.name || 'عميل غير مسجل');
const resultText = (row: Row) => text(row.followup_result || row.contact_result || row.followup_summary || row.response_status || row.followup_status || row.status);
const createdAt = (row: Row) => text(row.created_at);
const completedAt = (row: Row) => text(row.completed_at || row.closed_at || row.updated_at || row.created_at);
const formatDate = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value || 'غير محدد' : d.toLocaleString('ar-EG'); };

export default function CustomerFollowupRecordsAndPerformance({ mode }: { mode: ViewMode }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let query = supabase.from('daily_followups').select('*').order('created_at', { ascending: false }).limit(5000);
        if (!managerView && userBranch) query = query.eq('branch', userBranch);
        const { data, error } = await query;
        if (error) throw error;
        if (!cancelled) setRows((data || []) as Row[]);
      } catch (error) {
        toast.error(`تعذر تحميل سجل المتابعات: ${(error as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [managerView, userBranch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let source = rows;
    if (mode === 'exceptional') source = source.filter((row) => exceptional(row) && !row.completed_at && !row.closed_at && !finalStatus(row));
    if (mode === 'completed') source = source.filter((row) => Boolean(row.completed_at || row.closed_at) || finalStatus(row));
    if (q) source = source.filter((row) => `${customer(row)} ${row.customer_code || ''} ${row.customer_phone || row.phone || ''}`.toLowerCase().includes(q));
    return source;
  }, [mode, rows, search]);

  const performance = useMemo(() => {
    const monthlyRows = rows.filter((row) => completedAt(row).slice(0, 7) === month && (row.completed_at || row.closed_at || finalStatus(row)));
    const groups = new Map<string, Row[]>();
    monthlyRows.forEach((row) => { const key = actor(row); groups.set(key, [...(groups.get(key) || []), row]); });
    return Array.from(groups.entries()).map(([name, items]) => {
      const documented = items.filter((row) => text(row.notes || row.followup_summary || row.request_details).length >= 12).length;
      const positive = items.filter((row) => /تم الشراء|راضي|تم الحل|تم تنفيذ|نجاح|completed|resolved/i.test(resultText(row))).length;
      const timely = items.filter((row) => {
        const start = new Date(createdAt(row)).getTime(); const end = new Date(completedAt(row)).getTime();
        return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 48 * 60 * 60 * 1000;
      }).length;
      const real = items.filter((row) => resultText(row).length >= 5).length;
      const total = Math.max(items.length, 1);
      const score = Math.round((real / total) * 40 + (positive / total) * 25 + (documented / total) * 20 + (timely / total) * 15);
      return { name, total: items.length, real, positive, documented, timely, score, incentive: Math.round(500 * score / 100) };
    }).sort((a, b) => b.score - a.score || b.total - a.total);
  }, [month, rows]);

  if (mode === 'performance') return (
    <section className="mx-4 rounded-3xl border border-white/10 bg-[#091b2d] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-white">تحليل أداء خدمة العملاء</h2><p className="mt-1 text-xs font-bold text-slate-400">الحافز الأقصى 500 جنيه ويعتمد على نتيجة حقيقية وتوثيق وسرعة، وليس عدد السجلات فقط.</p></div><input className="input-dark max-w-44" type="month" value={month} onChange={(e)=>setMonth(e.target.value)} /></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{performance.map((item, index)=><article key={item.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center justify-between"><div className="font-black text-white">#{index+1} {item.name}</div><div className="rounded-full bg-cyan-400/15 px-3 py-1 text-sm font-black text-cyan-200">{item.score}/100</div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300"><div>المكتمل الحقيقي: {item.real}/{item.total}</div><div>نتيجة إيجابية: {item.positive}</div><div>موثق جيدًا: {item.documented}</div><div>خلال 48 ساعة: {item.timely}</div></div><div className="mt-3 rounded-xl bg-emerald-400/10 p-3 text-center font-black text-emerald-200">الحافز المقترح: {item.incentive} جنيه</div></article>)}</div>
      {!performance.length ? <div className="mt-4 rounded-2xl border border-white/10 p-8 text-center text-slate-400">لا توجد متابعات مكتملة في الشهر المحدد.</div> : null}
    </section>
  );

  return (
    <section className="mx-4 rounded-3xl border border-white/10 bg-[#091b2d] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-white">{mode === 'exceptional' ? 'المتابعات الاستثنائية المطلوبة' : 'سجل المتابعات المكتملة'}</h2><p className="mt-1 text-xs font-bold text-slate-400">{mode === 'exceptional' ? 'كل الطلبات الاستثنائية المفتوحة مع مقدم الطلب والمسؤول.' : 'يشمل السجلات الجديدة والقديمة التي تحمل حالة مكتملة.'}</p></div><label className="relative min-w-64 flex-1 max-w-xl"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17}/><input className="input-dark w-full pr-10" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث باسم العميل أو الكود أو الهاتف" /></label></div>
      <div className="mt-4 text-xs font-black text-slate-400">النتائج: {filtered.length.toLocaleString('ar-EG')}</div>
      <div className="mt-3 grid gap-3">{filtered.map((row)=><article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-white">{customer(row)}</h3><p className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {row.customer_phone || row.phone || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</p></div><button className="btn-secondary flex items-center gap-2" onClick={()=>setSelected(row)}><Eye size={16}/> التفاصيل</button></div><div className="mt-3 grid gap-2 text-sm font-bold text-slate-300 md:grid-cols-3"><div>مقدم الطلب: {requester(row)}</div><div>المسؤول: {actor(row)}</div><div>{mode === 'completed' ? `تم في: ${formatDate(completedAt(row))}` : `تاريخ الطلب: ${formatDate(createdAt(row))}`}</div></div><p className="mt-3 rounded-xl bg-black/15 p-3 text-sm font-bold text-slate-200">{resultText(row) || text(row.request_details || row.notes) || 'لا توجد نتيجة مسجلة'}</p></article>)}</div>
      {!loading && !filtered.length ? <div className="mt-4 rounded-2xl border border-white/10 p-8 text-center text-slate-400">لا توجد سجلات مطابقة.</div> : null}
      {loading ? <div className="mt-4 text-center font-black text-cyan-200">جارٍ التحميل...</div> : null}
      {selected ? <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 p-3"><section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-cyan-300/20 bg-[#071827] p-5"><div className="flex items-start justify-between"><div><h2 className="text-xl font-black text-white">{customer(selected)}</h2><p className="mt-1 text-xs font-bold text-slate-400">تفاصيل المتابعة كاملة</p></div><button className="btn-secondary" onClick={()=>setSelected(null)}><X size={18}/></button></div><div className="mt-4 grid gap-3 text-sm font-bold text-slate-200 md:grid-cols-2"><div>الكود: {selected.customer_code || 'غير مسجل'}</div><div>الهاتف: {selected.customer_phone || selected.phone || 'غير مسجل'}</div><div>الفرع: {selected.branch || 'غير محدد'}</div><div>مقدم الطلب: {requester(selected)}</div><div>المسؤول: {actor(selected)}</div><div>تاريخ الإنشاء: {formatDate(createdAt(selected))}</div><div>تاريخ الإكمال: {formatDate(completedAt(selected))}</div><div>الحالة: {selected.followup_status || selected.status || 'غير محددة'}</div></div><div className="mt-4 space-y-3"><div className="rounded-xl bg-white/[0.04] p-4"><div className="text-xs font-black text-cyan-300">سبب الطلب</div><div className="mt-2 whitespace-pre-wrap text-sm font-bold text-white">{selected.followup_reason || selected.request_details || 'غير مسجل'}</div></div><div className="rounded-xl bg-white/[0.04] p-4"><div className="text-xs font-black text-cyan-300">ما تم مع العميل</div><div className="mt-2 whitespace-pre-wrap text-sm font-bold text-white">{resultText(selected) || 'لا توجد نتيجة تفصيلية مسجلة'}</div></div><div className="rounded-xl bg-white/[0.04] p-4"><div className="text-xs font-black text-cyan-300">الملاحظات</div><div className="mt-2 whitespace-pre-wrap text-sm font-bold text-white">{selected.notes || selected.followup_summary || 'لا توجد ملاحظات'}</div></div></div></section></div> : null}
    </section>
  );
}
