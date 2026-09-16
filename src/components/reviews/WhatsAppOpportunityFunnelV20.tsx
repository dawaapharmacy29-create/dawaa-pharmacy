import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Filter, ShoppingCart, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = Record<string, any>;

function isoDateLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function currentCycle26to25(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - (now.getDate() < 26 ? 1 : 0), 26);
  const end = new Date(start.getFullYear(), start.getMonth()+1, 25);
  return { start: isoDateLocal(start), end: isoDateLocal(end) };
}
const pct = (v: any) => v == null ? 'غير قابل للحساب' : `${Number(v).toFixed(1)}%`;

export default function WhatsAppOpportunityFunnelV20() {
  const [rows, setRows] = useState<Row[]>([]);
  const [leakage, setLeakage] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cycle = useMemo(() => currentCycle26to25(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      const [funnel, leak] = await Promise.all([
        supabase.from('whatsapp_doctor_opportunity_funnel_v20').select('*').eq('cycle_start', cycle.start).limit(500),
        supabase.from('whatsapp_opportunity_leakage_v20').select('*').gte('opened_at', `${cycle.start}T00:00:00`).lte('opened_at', `${cycle.end}T23:59:59`).order('opened_at', { ascending: false }).limit(500),
      ]);
      if (cancelled) return;
      if (funnel.error || leak.error) { setError(funnel.error?.message || leak.error?.message || 'تعذر تحميل Funnel'); setRows([]); setLeakage([]); }
      else { setRows(funnel.data || []); setLeakage(leak.data || []); }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [cycle.start, cycle.end]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.staff_name || ''} ${r.branch || ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  const totals = useMemo(() => ({
    opportunities: rows.reduce((s,r)=>s+Number(r.opportunities||0),0),
    accepted: rows.reduce((s,r)=>s+Number(r.accepted_or_beyond||0),0),
    confirmed: rows.reduce((s,r)=>s+Number(r.order_confirmed_or_beyond||0),0),
    conversationSales: rows.reduce((s,r)=>s+Number(r.conversation_linked_verified_sales||0),0),
    productSales: rows.reduce((s,r)=>s+Number(r.product_verified_sales||0),0),
    leakage: rows.reduce((s,r)=>s+Number(r.opportunities_with_leakage||0),0),
  }), [rows]);

  const leakageGroups = useMemo(() => {
    const map = new Map<string, number>();
    leakage.forEach((r) => map.set(String(r.leakage_stage || 'other'), (map.get(String(r.leakage_stage || 'other')) || 0) + 1));
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  }, [leakage]);

  return <section className="dawaa-card dawaa-card--raised p-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div><div className="flex items-center gap-2 font-black text-white"><ShoppingCart size={18}/>Funnel الفرص البيعية الموثق V20</div><div className="mt-1 text-xs leading-5 text-slate-400">من اكتشاف الفرصة حتى الفاتورة، مع فصل بيع المحادثة عن إثبات الصنف نفسه.</div><div className="mt-1 text-[10px] text-slate-500">الدورة الحالية: {cycle.start} → {cycle.end}</div></div>
      <div className="relative w-full lg:w-64"><Filter size={14} className="absolute right-3 top-3 text-slate-500"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="بحث باسم الدكتور/الفرع" className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-2 pr-9 pl-3 text-sm text-white outline-none"/></div>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      <M label="الفرص" value={totals.opportunities}/><M label="وصلت لقبول" value={totals.accepted}/><M label="تأكيد أوردر" value={totals.confirmed}/><M label="فاتورة مرتبطة بالمحادثة" value={totals.conversationSales}/><M label="الصنف مثبت بالفاتورة" value={totals.productSales}/><M label="فرص بها تسريب" value={totals.leakage}/>
    </div>

    <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs leading-6 text-amber-100"><TriangleAlert size={14} className="ml-1 inline"/>حاليًا بيانات الفواتير لا تحتوي أسماء/أكواد بنود الفاتورة، لذلك <b>Product Conversion الدقيق غير قابل للإثبات</b>. الفاتورة تثبت Conversion للمحادثة فقط، والنظام لا يخمن الصنف.</div>

    {loading ? <div className="mt-4 text-sm text-slate-400">جاري تحميل الـFunnel...</div> : null}
    {error ? <div className="mt-4 text-xs text-rose-200">{error}</div> : null}
    {!loading && !error && !rows.length ? <div className="mt-4 text-sm text-slate-500">لا توجد فرص V20 محفوظة في الدورة الحالية حتى الآن.</div> : null}

    <div className="mt-4 space-y-2">
      {filtered.map((row) => <div key={`${row.staff_id}-${row.branch}`} className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{row.staff_name || 'دكتور غير محدد'}</div><div className="text-[10px] text-slate-500">{row.branch || '—'}</div></div>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3 xl:grid-cols-7">
          <K label="فرص" value={row.opportunities||0}/><K label="ترشيح/بديل" value={row.recommendation_or_alternative||0}/><K label="قبول" value={row.accepted_or_beyond||0}/><K label="أوردر مؤكد" value={row.order_confirmed_or_beyond||0}/><K label="بيع محادثة" value={row.conversation_linked_verified_sales||0}/><K label="قبول الترشيح" value={pct(row.recommendation_to_acceptance_rate)}/><K label="Conversion محادثة" value={pct(row.opportunity_to_conversation_sale_rate)}/>
        </div>
      </div>)}
    </div>

    {leakageGroups.length ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-3"><div className="flex items-center gap-2 font-black text-white"><BadgeCheck size={15}/>أكثر مراحل التسريب</div><div className="mt-2 flex flex-wrap gap-2">{leakageGroups.map(([stage,count])=><span key={stage} className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-300">{labelLeak(stage)} · {count}</span>)}</div></div> : null}
  </section>;
}

function M({label,value}:{label:string;value:any}){return <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2.5"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>}
function K({label,value}:{label:string;value:any}){return <div><div className="text-[10px] text-slate-500">{label}</div><div className="mt-0.5 font-black text-slate-100">{value}</div></div>}
function labelLeak(v:string){const m:Record<string,string>={stock_unavailable:'غير متوفر',alternative_not_decided:'بديل بدون حسم',recommendation_not_decided:'ترشيح بدون حسم',accepted_not_closed:'قبول بدون إغلاق',order_without_verified_invoice:'أوردر بلا فاتورة مؤكدة',customer_rejected_or_lost:'رفض/فقد فرصة',followup_pending:'متابعة معلقة',other:'أخرى'};return m[v]||v;}
