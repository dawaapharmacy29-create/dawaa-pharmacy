import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, ChevronLeft, CircleAlert, FileText, PackageSearch, RefreshCw, Search, Stethoscope, TrendingUp, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = {
  staff_id: string | null;
  staff_name: string | null;
  branch: string | null;
  cycle_start: string;
  cycle_end: string;
  conversation_count: number;
  customer_count: number;
  commercial_conversations: number;
  verified_sale_conversations: number;
  conversations_needing_followup: number;
  complaint_conversations: number;
  verified_invoice_count: number;
  verified_revenue: number;
  verified_conversion_rate: number;
  product_journey_count: number;
  sale_leakage_count: number;
  chat_closed_product_count: number;
  recommendation_followup_count: number;
  accepted_product_count: number;
  unavailable_product_count: number;
};

type ConversationRow = {
  id: string;
  customer_name: string | null;
  customer_code: string | null;
  conversation_started_at: string | null;
  review_status: string | null;
  followup_required: boolean | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  analysis_json: any;
};

type ProductRow = {
  source_id: string;
  customer_name: string | null;
  customer_code: string | null;
  product_name: string | null;
  current_stage: string | null;
  sale_intent: boolean | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  next_action: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  confidence: number | null;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function money(value: unknown) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-center"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>;
}

export default function WhatsAppDoctorCycleIntelligenceV8({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [selected, setSelected] = useState<Row | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_doctor_cycle_intelligence_v1')
        .select('*')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .order('verified_revenue', { ascending: false });
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (error) {
      console.error('[whatsapp-doctor-cycle-v8] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDoctorDetail = async (row: Row) => {
    setSelected(row);
    setDetailLoading(true);
    try {
      let sourceQuery = supabase
        .from('whatsapp_review_sources')
        .select('id,customer_name,customer_code,conversation_started_at,review_status,followup_required,invoice_match_status,matched_invoice_number,matched_invoice_value,analysis_json')
        .gte('conversation_started_at', `${row.cycle_start}T00:00:00`)
        .lte('conversation_started_at', `${row.cycle_end}T23:59:59`)
        .eq('branch', row.branch || '')
        .order('conversation_started_at', { ascending: false })
        .limit(250);
      sourceQuery = row.staff_id ? sourceQuery.eq('staff_id', row.staff_id) : sourceQuery.eq('staff_name', row.staff_name || '');

      let productQuery = supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('source_id,customer_name,customer_code,product_name,current_stage,sale_intent,closed_in_chat,followup_candidate,leakage_reason,next_action,invoice_match_status,matched_invoice_number,matched_invoice_value,confidence')
        .eq('cycle_start', row.cycle_start)
        .eq('cycle_end', row.cycle_end)
        .eq('branch', row.branch || '')
        .order('conversation_started_at', { ascending: false })
        .limit(300);
      productQuery = row.staff_id ? productQuery.eq('staff_id', row.staff_id) : productQuery.eq('staff_name', row.staff_name || '');

      const [sourceResult, productResult] = await Promise.all([sourceQuery, productQuery]);
      if (sourceResult.error) throw sourceResult.error;
      if (productResult.error) throw productResult.error;
      setConversations((sourceResult.data || []) as ConversationRow[]);
      setProducts((productResult.data || []) as ProductRow[]);
    } catch (error) {
      console.error('[whatsapp-doctor-cycle-v8] detail load failed', error);
      setConversations([]);
      setProducts([]);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (!q) return true;
      return String(row.staff_name || '').toLowerCase().includes(q);
    });
  }, [rows, search, branch]);

  const totals = useMemo(() => ({
    revenue: filtered.reduce((sum, row) => sum + Number(row.verified_revenue || 0), 0),
    sales: filtered.reduce((sum, row) => sum + Number(row.verified_sale_conversations || 0), 0),
    opportunities: filtered.reduce((sum, row) => sum + Number(row.commercial_conversations || 0), 0),
    leakage: filtered.reduce((sum, row) => sum + Number(row.sale_leakage_count || 0), 0),
  }), [filtered]);

  const detailStats = useMemo(() => ({
    customers: new Set(conversations.map((x) => x.customer_code || x.customer_name).filter(Boolean)).size,
    verifiedSales: 0, // Legacy invoice_match_status is not canonical Sale Proof.
    verifiedRevenue: 0, // Revenue cannot be confirmed from the legacy statistical matcher.
    pendingFollowups: conversations.filter((x) => x.followup_required).length,
    leakage: products.filter((x) => Boolean(x.leakage_reason)).length,
  }), [conversations, products]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-emerald-200"><Stethoscope size={16}/> تحليل أداء الدكاترة V8</div>
        <h2 className="mt-1 text-xl font-black text-white">الأداء التشغيلي والبيعي في سايكل 26→25</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">بيانات البيع والإيراد في هذا القسم Legacy ولا تُعد إثباتًا رسميًا. الاعتماد النهائي للبيع والفاتورة يجب أن يأتي من Sales Intelligence canonical.</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="إيراد Legacy تاريخي" value={money(totals.revenue)} />
      <Metric label="بيعات Legacy تاريخية" value={totals.sales} />
      <Metric label="فرص تجارية" value={totals.opportunities} />
      <Metric label="فرص بيع متوقفة" value={totals.leakage} />
    </div>

    <div className="mt-4 flex flex-col gap-2 lg:flex-row">
      <label className="relative flex-1"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الدكتور" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
    </div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[1180px] w-full text-right text-sm">
        <thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">الدكتور</th><th className="p-3">الفرع</th><th className="p-3">المحادثات</th><th className="p-3">عملاء</th><th className="p-3">فرص تجارية</th><th className="p-3">بيع Legacy</th><th className="p-3">Conversion</th><th className="p-3">إيراد Legacy</th><th className="p-3">غير متوفر</th><th className="p-3">فقد بيع</th><th className="p-3">ترشيحات مقبولة</th><th className="p-3">متابعات</th><th className="p-3">شكاوى</th><th className="p-3">تفاصيل</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={`${row.staff_id || row.staff_name}-${row.branch}-${row.cycle_start}`} className="border-t border-slate-800 bg-slate-950/25 text-slate-200 hover:bg-slate-900/45"><td className="p-3 font-black text-white">{row.staff_name || 'غير محدد'}</td><td className="p-3">{row.branch || '—'}</td><td className="p-3">{row.conversation_count}</td><td className="p-3">{row.customer_count}</td><td className="p-3">{row.commercial_conversations}</td><td className="p-3 text-emerald-300">{row.verified_sale_conversations}</td><td className="p-3"><span className="inline-flex items-center gap-1"><TrendingUp size={13}/>{Number(row.verified_conversion_rate || 0).toFixed(1)}%</span></td><td className="p-3 font-black text-emerald-300"><span className="inline-flex items-center gap-1"><BadgeDollarSign size={13}/>{money(row.verified_revenue)}</span></td><td className="p-3">{row.unavailable_product_count}</td><td className="p-3 text-amber-300">{row.sale_leakage_count}</td><td className="p-3">{row.accepted_product_count}</td><td className="p-3">{row.conversations_needing_followup}</td><td className="p-3 text-rose-300">{row.complaint_conversations}</td><td className="p-3"><button type="button" onClick={() => void loadDoctorDetail(row)} className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-black text-cyan-200">فتح <ChevronLeft size={13}/></button></td></tr>)}</tbody>
      </table>
      {!loading && filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">لا توجد بيانات كافية للدكاترة في السايكل الحالي حتى الآن.</div> : null}
    </div>

    {selected ? <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="flex items-center gap-2 font-black text-white"><UserRound size={17}/> د. {selected.staff_name || 'غير محدد'} • {selected.branch || '—'}</div><div className="mt-1 text-xs text-slate-400">Drill-down السايكل {selected.cycle_start} → {selected.cycle_end}</div></div>
        <button onClick={() => setSelected(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-black text-slate-300">إغلاق التفاصيل</button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="العملاء" value={detailStats.customers}/><Metric label="بيع مؤكد" value={detailStats.verifiedSales}/><Metric label="إيراد مؤكد" value={money(detailStats.verifiedRevenue)}/><Metric label="متابعات مفتوحة" value={detailStats.pendingFollowups}/><Metric label="فرص متوقفة" value={detailStats.leakage}/>
      </div>

      {detailLoading ? <div className="mt-4 p-6 text-center text-sm text-slate-400">جاري تحميل التفاصيل...</div> : <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
          <div className="mb-3 flex items-center gap-2 font-black text-white"><FileText size={16}/> المحادثات والفواتير</div>
          <div className="max-h-[430px] space-y-2 overflow-y-auto">{conversations.map((item) => {
            const op = item.analysis_json?.operational;
            return <button type="button" key={item.id} onClick={() => onOpenSource?.(item.id)} className="w-full rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-right hover:border-cyan-400/30">
              <div className="flex items-start justify-between gap-2"><div><b className="text-white">{item.customer_name || 'عميل غير محدد'}</b>{item.customer_code ? <span className="mr-2 text-xs text-cyan-300">#{item.customer_code}</span> : null}<div className="mt-1 text-[11px] text-slate-500">{dateLabel(item.conversation_started_at)}</div></div><span className={`rounded-lg px-2 py-1 text-[10px] font-black ${item.invoice_match_status === 'verified' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-800 text-slate-300'}`}>{item.invoice_match_status === 'verified' ? `مطابقة آلية ${money(item.matched_invoice_value)}` : 'لا توجد مطابقة قوية'}</span></div>
              <div className="mt-2 text-xs text-slate-300">{op?.primaryIntent || item.review_status || '—'}{item.followup_required ? <span className="text-amber-300"> • متابعة مطلوبة</span> : null}{item.matched_invoice_number ? <span className="text-emerald-300"> • #{item.matched_invoice_number}</span> : null}</div>
            </button>;
          })}{!conversations.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد محادثات مرتبطة بهذا الدكتور في السايكل.</div> : null}</div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
          <div className="mb-3 flex items-center gap-2 font-black text-white"><PackageSearch size={16}/> الأصناف والفرص البيعية</div>
          <div className="max-h-[430px] space-y-2 overflow-y-auto">{products.map((item, index) => <button type="button" key={`${item.source_id}-${item.product_name}-${index}`} onClick={() => onOpenSource?.(item.source_id)} className="w-full rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-right hover:border-violet-400/30">
            <div className="flex items-start justify-between gap-2"><div><b className="text-white">{item.product_name || 'صنف غير محدد'}</b><div className="mt-1 text-[11px] text-slate-500">{item.customer_name || 'عميل غير محدد'}{item.customer_code ? ` • #${item.customer_code}` : ''}</div></div><span className="rounded-lg bg-violet-500/10 px-2 py-1 text-[10px] font-black text-violet-200">{item.current_stage || '—'}</span></div>
            {item.leakage_reason ? <div className="mt-2 flex items-start gap-1 text-xs text-amber-200"><CircleAlert size={13} className="mt-0.5 shrink-0"/>{item.leakage_reason}</div> : null}
            <div className="mt-2 text-[11px] text-slate-400">{item.next_action || (item.invoice_match_status === 'verified' ? 'توجد مطابقة فاتورة آلية Legacy؛ البيع غير مثبت رسميًا.' : 'لا توجد خطوة تالية مثبتة.')}{item.matched_invoice_value ? <span className="text-emerald-300"> • {money(item.matched_invoice_value)}</span> : null}</div>
          </button>)}{!products.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد رحلات أصناف مرتبطة بهذا الدكتور حتى الآن.</div> : null}</div>
        </div>
      </div>}
    </div> : null}
  </section>;
}
