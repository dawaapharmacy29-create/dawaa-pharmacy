import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, RefreshCw, Search, Stethoscope, TrendingUp } from 'lucide-react';
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

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function money(value: unknown) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-center"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>;
}

export default function WhatsAppDoctorCycleIntelligenceV8() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');

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

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-emerald-200"><Stethoscope size={16}/> تحليل أداء الدكاترة V8</div>
        <h2 className="mt-1 text-xl font-black text-white">الأداء التشغيلي والبيعي في سايكل 26→25</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">يعتمد البيع والإيراد فقط على فواتير مؤكدة. مؤشرات فقد البيع والمتابعة أدوات تشغيلية ولا تتحول تلقائيًا إلى نقاط أو خصومات.</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="إيراد مؤكد مرتبط" value={money(totals.revenue)} />
      <Metric label="محادثات بيع مؤكدة" value={totals.sales} />
      <Metric label="فرص تجارية" value={totals.opportunities} />
      <Metric label="فرص بيع متوقفة" value={totals.leakage} />
    </div>

    <div className="mt-4 flex flex-col gap-2 lg:flex-row">
      <label className="relative flex-1"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الدكتور" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
    </div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[1100px] w-full text-right text-sm">
        <thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">الدكتور</th><th className="p-3">الفرع</th><th className="p-3">المحادثات</th><th className="p-3">عملاء</th><th className="p-3">فرص تجارية</th><th className="p-3">بيع مؤكد</th><th className="p-3">Conversion</th><th className="p-3">الإيراد</th><th className="p-3">غير متوفر</th><th className="p-3">فقد بيع</th><th className="p-3">ترشيحات مقبولة</th><th className="p-3">متابعات مطلوبة</th><th className="p-3">شكاوى</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={`${row.staff_id || row.staff_name}-${row.branch}-${row.cycle_start}`} className="border-t border-slate-800 bg-slate-950/25 text-slate-200"><td className="p-3 font-black text-white">{row.staff_name || 'غير محدد'}</td><td className="p-3">{row.branch || '—'}</td><td className="p-3">{row.conversation_count}</td><td className="p-3">{row.customer_count}</td><td className="p-3">{row.commercial_conversations}</td><td className="p-3 text-emerald-300">{row.verified_sale_conversations}</td><td className="p-3"><span className="inline-flex items-center gap-1"><TrendingUp size={13}/>{Number(row.verified_conversion_rate || 0).toFixed(1)}%</span></td><td className="p-3 font-black text-emerald-300"><span className="inline-flex items-center gap-1"><BadgeDollarSign size={13}/>{money(row.verified_revenue)}</span></td><td className="p-3">{row.unavailable_product_count}</td><td className="p-3 text-amber-300">{row.sale_leakage_count}</td><td className="p-3">{row.accepted_product_count}</td><td className="p-3">{row.conversations_needing_followup}</td><td className="p-3 text-rose-300">{row.complaint_conversations}</td></tr>)}</tbody>
      </table>
      {!loading && filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">لا توجد بيانات كافية للدكاترة في السايكل الحالي حتى الآن.</div> : null}
    </div>
  </section>;
}
