import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, RefreshCw, Search, Stethoscope, Store, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type JourneyRow = {
  source_id: string;
  branch: string | null;
  customer_name: string | null;
  customer_code: string | null;
  staff_name: string | null;
  product_name: string | null;
  current_stage: string | null;
  leakage_reason: string | null;
  next_action: string | null;
  confidence: number | null;
  invoice_match_status: string | null;
  matched_invoice_value: number | null;
  conversation_started_at: string | null;
};

const REASON_LABELS: Record<string, string> = {
  unavailable: 'الصنف غير متوفر',
  no_alternative: 'لم يتم إغلاق بديل مناسب',
  customer_no_reply: 'العميل لم يرد/لم يحسم',
  not_closed: 'لم يتم إغلاق الأوردر',
  invoice_missing: 'الأوردر ظاهر بالشات بدون فاتورة مؤكدة',
  recommendation_pending: 'ترشيح ينتظر قرار/متابعة',
  unknown: 'سبب يحتاج مراجعة',
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function classifyReason(row: JourneyRow) {
  const raw = String(row.leakage_reason || '').trim().toLowerCase();
  const stage = String(row.current_stage || '').trim().toLowerCase();
  if (/غير متوفر|unavailable|out.of.stock|not.available/.test(raw) || /unavailable|out.of.stock/.test(stage)) return 'unavailable';
  if (/بديل|alternative/.test(raw) && /لم|no|without|missing/.test(raw)) return 'no_alternative';
  if (/لم يرد|ما رد|no reply|no response|pending customer|لم يحسم/.test(raw)) return 'customer_no_reply';
  if (/فاتورة|invoice/.test(raw) || /confirmed|closed|ordered|order/.test(stage)) return 'invoice_missing';
  if (/ترشيح|recommendation/.test(raw) || /recommendation/.test(stage)) return 'recommendation_pending';
  if (/اغلاق|إغلاق|close|not closed|لم يتم/.test(raw)) return 'not_closed';
  if (raw) return raw;
  if (/available|alternative|accepted|offered/.test(stage)) return 'not_closed';
  return 'unknown';
}

function labelReason(key: string) {
  return REASON_LABELS[key] || key;
}

export default function WhatsAppLeakageReasonsV10({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<JourneyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState('all');
  const [doctor, setDoctor] = useState('all');
  const [product, setProduct] = useState('all');
  const [reason, setReason] = useState('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('source_id,branch,customer_name,customer_code,staff_name,product_name,current_stage,leakage_reason,next_action,confidence,invoice_match_status,matched_invoice_value,conversation_started_at,cycle_start,cycle_end')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .or('leakage_reason.not.is.null,invoice_match_status.neq.verified')
        .order('conversation_started_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      setRows((data || []) as JourneyRow[]);
    } catch (error) {
      console.error('[whatsapp-leakage-reasons-v10] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const doctors = useMemo(() => Array.from(new Set(rows.map((r) => r.staff_name).filter(Boolean) as string[])).sort(), [rows]);
  const products = useMemo(() => Array.from(new Set(rows.map((r) => r.product_name).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const rowReason = classifyReason(row);
      if (branch !== 'all' && row.branch !== branch) return false;
      if (doctor !== 'all' && row.staff_name !== doctor) return false;
      if (product !== 'all' && row.product_name !== product) return false;
      if (reason !== 'all' && rowReason !== reason) return false;
      if (!q) return true;
      return [row.customer_name, row.customer_code, row.staff_name, row.product_name, row.leakage_reason, row.next_action]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, branch, doctor, product, reason, search]);

  const reasonStats = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((row) => {
      const key = classifyReason(row);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const branchStats = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((row) => map.set(row.branch || 'غير محدد', (map.get(row.branch || 'غير محدد') || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const doctorStats = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((row) => map.set(row.staff_name || 'غير محدد', (map.get(row.staff_name || 'غير محدد') || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filtered]);

  const productStats = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((row) => map.set(row.product_name || 'غير محدد', (map.get(row.product_name || 'غير محدد') || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filtered]);

  const total = filtered.length;
  const topReason = reasonStats[0];

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-rose-200"><AlertTriangle size={16}/> تحليل أسباب فقد البيع V10</div>
        <h2 className="mt-1 text-xl font-black text-white">ليه الفرص بتضيع؟ وفين؟ ومع مين؟</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">تحليل تشغيلي على مستوى الفرع والدكتور والصنف. المؤشرات هنا للمراجعة والتحسين فقط ولا تنشئ نقاطًا أو خصومات تلقائيًا.</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3"><div className="text-xs text-rose-200">إجمالي فرص التسريب</div><div className="mt-1 text-2xl font-black text-white">{total}</div></div>
      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3"><div className="text-xs text-amber-200">أكبر سبب</div><div className="mt-1 text-sm font-black text-white">{topReason ? `${labelReason(topReason[0])} (${topReason[1]})` : '—'}</div></div>
      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3"><div className="text-xs text-cyan-200">فروع بها حالات</div><div className="mt-1 text-2xl font-black text-white">{branchStats.length}</div></div>
      <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3"><div className="text-xs text-violet-200">أصناف بها تسريب</div><div className="mt-1 text-2xl font-black text-white">{productStats.length}</div></div>
    </div>

    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
      <label className="relative xl:col-span-2"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالعميل، الدكتور، الصنف أو السبب" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
      <select value={doctor} onChange={(e) => setDoctor(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="all">كل الدكاترة</option>{doctors.map((name) => <option key={name} value={name}>{name}</option>)}</select>
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="all">كل الأسباب</option>{reasonStats.map(([key]) => <option key={key} value={key}>{labelReason(key)}</option>)}</select>
      <select value={product} onChange={(e) => setProduct(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white md:col-span-2 xl:col-span-1"><option value="all">كل الأصناف</option>{products.slice(0, 250).map((name) => <option key={name} value={name}>{name}</option>)}</select>
    </div>

    <div className="mt-4 grid gap-3 xl:grid-cols-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><div className="mb-3 flex items-center gap-2 font-black text-white"><Store size={15}/> حسب الفرع</div>{branchStats.map(([name, count]) => <div key={name} className="flex items-center justify-between border-t border-slate-800 py-2 text-sm"><span className="text-slate-300">{name}</span><b className="text-white">{count}</b></div>)}</div>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><div className="mb-3 flex items-center gap-2 font-black text-white"><Stethoscope size={15}/> أكثر دكاترة لديهم حالات</div>{doctorStats.map(([name, count]) => <div key={name} className="flex items-center justify-between border-t border-slate-800 py-2 text-sm"><span className="text-slate-300">{name}</span><b className="text-white">{count}</b></div>)}</div>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><div className="mb-3 flex items-center gap-2 font-black text-white"><Boxes size={15}/> أكثر أصناف بها تسريب</div>{productStats.map(([name, count]) => <div key={name} className="flex items-center justify-between border-t border-slate-800 py-2 text-sm"><span className="truncate text-slate-300">{name}</span><b className="text-white">{count}</b></div>)}</div>
    </div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[1050px] w-full text-right text-sm">
        <thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">السبب</th><th className="p-3">العميل</th><th className="p-3">الدكتور</th><th className="p-3">الفرع</th><th className="p-3">الصنف</th><th className="p-3">المرحلة</th><th className="p-3">الفاتورة</th><th className="p-3">الخطوة التالية</th><th className="p-3">فتح</th></tr></thead>
        <tbody>{filtered.slice(0, 120).map((row, index) => <tr key={`${row.source_id}-${row.product_name}-${index}`} className="border-t border-slate-800 bg-slate-950/25 text-slate-200"><td className="p-3 font-bold text-amber-200">{labelReason(classifyReason(row))}</td><td className="p-3"><span className="inline-flex items-center gap-1"><UserRound size={12}/>{row.customer_name || 'غير محدد'}{row.customer_code ? ` #${row.customer_code}` : ''}</span></td><td className="p-3">{row.staff_name || 'غير محدد'}</td><td className="p-3">{row.branch || '—'}</td><td className="p-3">{row.product_name || '—'}</td><td className="p-3">{row.current_stage || '—'}</td><td className="p-3">{row.invoice_match_status === 'verified' ? 'مطابقة آلية Legacy' : 'غير مرتبطة'}</td><td className="p-3 max-w-[280px] text-slate-300">{row.next_action || 'مراجعة الحالة'}</td><td className="p-3">{onOpenSource ? <button onClick={() => onOpenSource(row.source_id)} className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-xs font-black text-cyan-200">المحادثة</button> : '—'}</td></tr>)}</tbody>
      </table>
      {!loading && filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">لا توجد حالات تسريب مطابقة للفلاتر الحالية.</div> : null}
    </div>
  </section>;
}
