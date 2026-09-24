import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PackageSearch, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = {
  source_id: string;
  branch: string | null;
  customer_code: string | null;
  customer_name: string | null;
  staff_name: string | null;
  cycle_start: string;
  cycle_end: string;
  product_name: string | null;
  product_code: string | null;
  quantity: number | null;
  current_stage: string | null;
  sale_intent: boolean | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  next_action: string | null;
  confidence: number | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function labelStage(value: string | null) {
  const labels: Record<string,string> = {
    requested:'طلب', available:'متوفر', unavailable:'غير متوفر', alternative_offered:'تم عرض بديل', recommended:'ترشيح', accepted:'العميل وافق', rejected:'العميل رفض', closed_in_chat:'تم إغلاق الأوردر في الشات', invoice_verified:'فاتورة مؤكدة', followup:'متابعة'
  };
  return value ? labels[value] || value : 'غير محدد';
}

export default function WhatsAppSalesLeakageV8({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows,setRows] = useState<Row[]>([]);
  const [loading,setLoading] = useState(false);
  const [search,setSearch] = useState('');
  const [branch,setBranch] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('*')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .order('conversation_started_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (error) {
      console.error('[whatsapp-sales-leakage-v8] load failed', error);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const leakageRows = useMemo(() => rows.filter((row) => Boolean(row.leakage_reason)), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leakageRows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (!q) return true;
      return [row.product_name,row.customer_name,row.customer_code,row.staff_name,row.leakage_reason,row.next_action].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [leakageRows,search,branch]);

  const reasons = useMemo(() => {
    const map = new Map<string,number>();
    for (const row of leakageRows) {
      const key = row.leakage_reason || 'غير محدد';
      map.set(key,(map.get(key)||0)+1);
    }
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  }, [leakageRows]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div><div className="flex items-center gap-2 text-xs font-black text-amber-200"><AlertTriangle size={16}/> Sales Leakage V8</div><h2 className="mt-1 text-xl font-black text-white">فين فرص البيع بتقف؟</h2><p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">يعرض فرص البيع المتوقفة كما سجلها Product Journey. حالة invoice_match_status القديمة لا تُخفي الفرصة لأنها مطابقة آلية Legacy وليست Sale Proof رسميًا.</p></div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {reasons.map(([reason,count]) => <div key={reason} className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3"><div className="text-xs leading-5 text-amber-100">{reason}</div><div className="mt-1 text-2xl font-black text-white">{count}</div></div>)}
      {!reasons.length ? <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-500">لا توجد أسباب فقد بيع مسجلة في السايكل الحالي.</div> : null}
    </div>

    <div className="mt-4 flex flex-col gap-2 lg:flex-row">
      <label className="relative flex-1"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث بالصنف أو العميل أو الدكتور أو سبب توقف البيع" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
      <select value={branch} onChange={(e)=>setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
    </div>

    <div className="mt-4 space-y-2">
      {filtered.slice(0,100).map((row) => <div key={`${row.source_id}-${row.product_code || row.product_name}-${row.current_stage}`} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><PackageSearch size={15} className="text-cyan-300"/><b className="text-white">{row.product_name || 'صنف غير محدد'}</b>{row.product_code?<span className="text-xs text-cyan-300">#{row.product_code}</span>:null}<span className="text-xs text-slate-500">{row.branch || '—'}</span></div><div className="mt-2 text-sm text-slate-300">{row.customer_name || 'عميل غير محدد'}{row.customer_code?` • #${row.customer_code}`:''} • {row.staff_name || 'الدكتور غير محدد'}</div><div className="mt-1 text-xs text-slate-500">المرحلة الحالية: {labelStage(row.current_stage)} • ثقة {Math.round(Number(row.confidence||0))}%</div><div className="mt-2 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-sm text-amber-100"><b>سبب التوقف:</b> {row.leakage_reason}</div>{row.next_action?<div className="mt-2 text-sm text-violet-200"><b>الخطوة التالية:</b> {row.next_action}</div>:null}</div>
          <div className="shrink-0 text-left">{row.closed_in_chat?<div className="text-xs text-amber-300">اتقفل في الشات — ينتظر فاتورة</div>:null}{row.followup_candidate?<div className="mt-1 text-xs text-violet-300">مرشح للمتابعة</div>:null}{onOpenSource?<button onClick={()=>onOpenSource(row.source_id)} className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-200">فتح المحادثة</button>:null}</div>
        </div>
      </div>)}
      {!loading && filtered.length===0 ? <div className="rounded-2xl border border-slate-800 p-8 text-center text-sm text-slate-500">لا توجد فرص متوقفة مطابقة للفلاتر الحالية.</div> : null}
    </div>
  </section>;
}
