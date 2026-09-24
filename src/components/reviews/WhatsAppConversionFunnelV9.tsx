import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Search, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type JourneyRow = {
  source_id: string;
  branch: string | null;
  staff_id: string | null;
  staff_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  cycle_start: string;
  cycle_end: string;
  product_name: string | null;
  current_stage: string | null;
  sale_intent: boolean | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  invoice_match_status: string | null;
};

type Scope = 'all' | 'branch' | 'doctor';

type StageKey = 'opportunity' | 'available_or_alternative' | 'accepted' | 'chat_closed' | 'invoice_verified' | 'followup';

const stageLabel: Record<StageKey, string> = {
  opportunity: 'طلب/فرصة',
  available_or_alternative: 'توفر/بديل/ترشيح',
  accepted: 'قبول العميل',
  chat_closed: 'تأكيد الأوردر',
  invoice_verified: 'فاتورة مؤكدة',
  followup: 'متابعة بعد البيع',
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function normalizeStage(value: string | null) {
  return String(value || '').toLowerCase();
}

function reached(row: JourneyRow, stage: StageKey) {
  const current = normalizeStage(row.current_stage);
  const verified = false; // Legacy auto-match is not canonical Sale Proof.
  if (stage === 'opportunity') return row.sale_intent !== false;
  if (stage === 'available_or_alternative') return !/(requested|mentioned|unavailable_only)/.test(current) || /(available|alternative|recommended|accepted|closed|invoice|followup)/.test(current);
  if (stage === 'accepted') return /(accepted|closed|invoice|followup)/.test(current) || row.closed_in_chat === true || verified;
  if (stage === 'chat_closed') return row.closed_in_chat === true || /(closed|invoice|followup)/.test(current) || verified;
  if (stage === 'invoice_verified') return verified;
  return verified && row.followup_candidate === true;
}

export default function WhatsAppConversionFunnelV9({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<JourneyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState('all');
  const [doctor, setDoctor] = useState('all');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope>('all');

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('source_id,branch,staff_id,staff_name,customer_code,customer_name,cycle_start,cycle_end,product_name,current_stage,sale_intent,closed_in_chat,followup_candidate,leakage_reason,invoice_match_status')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .limit(5000);
      if (error) throw error;
      setRows((data || []) as JourneyRow[]);
    } catch (error) {
      console.error('[whatsapp-conversion-funnel-v9] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const doctors = useMemo(() => Array.from(new Set(rows.map((r) => r.staff_name).filter(Boolean) as string[])).sort((a,b)=>a.localeCompare(b,'ar')), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (doctor !== 'all' && row.staff_name !== doctor) return false;
      if (scope === 'branch' && branch === 'all') return false;
      if (scope === 'doctor' && doctor === 'all') return false;
      if (!q) return true;
      return [row.customer_name,row.customer_code,row.product_name,row.staff_name,row.leakage_reason].some((v)=>String(v||'').toLowerCase().includes(q));
    });
  }, [rows, branch, doctor, search, scope]);

  const stages = useMemo(() => {
    const keys: StageKey[] = ['opportunity','available_or_alternative','accepted','chat_closed','invoice_verified','followup'];
    const counts = keys.map((key) => ({ key, count: filtered.filter((row) => reached(row,key)).length }));
    return counts.map((item, index) => {
      const prev = index === 0 ? item.count : counts[index - 1].count;
      const conversion = prev > 0 ? (item.count / prev) * 100 : 0;
      const loss = Math.max(0, prev - item.count);
      return { ...item, conversion, loss };
    });
  }, [filtered]);

  const biggestLeak = useMemo(() => stages.slice(1).sort((a,b)=>b.loss-a.loss)[0] || null, [stages]);
  const leakageRows = useMemo(() => filtered.filter((r) => r.leakage_reason).slice(0,60), [filtered]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-fuchsia-200"><Activity size={16}/> Conversion Funnel V9</div>
        <h2 className="mt-1 text-xl font-black text-white">من أول الطلب لحد الفاتورة والمتابعة</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">يقيس انتقال فرص البيع بين المراحل، ويحدد أكبر نقطة تسريب. البيع النهائي لا يُحسب إلا بالفاتورة المؤكدة.</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 lg:grid-cols-4">
      <select value={scope} onChange={(e)=>setScope(e.target.value as Scope)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">عرض شامل</option><option value="branch">على مستوى الفرع</option><option value="doctor">على مستوى الدكتور</option></select>
      <select value={branch} onChange={(e)=>setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
      <select value={doctor} onChange={(e)=>setDoctor(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الدكاترة</option>{doctors.map((name)=><option key={name} value={name}>{name}</option>)}</select>
      <label className="relative"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="عميل / صنف / سبب فقد" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
    </div>

    <div className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      {stages.map((stage, index) => <div key={stage.key} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
        <div className="text-[11px] font-bold text-slate-400">{stageLabel[stage.key]}</div>
        <div className="mt-1 text-2xl font-black text-white">{stage.count}</div>
        {index > 0 ? <div className="mt-1 text-[11px] text-cyan-300">تحويل {stage.conversion.toFixed(1)}%</div> : <div className="mt-1 text-[11px] text-slate-500">بداية الـFunnel</div>}
        {stage.loss > 0 ? <div className="mt-1 text-[11px] text-amber-300">فقد {stage.loss}</div> : null}
      </div>)}
    </div>

    {biggestLeak && biggestLeak.loss > 0 ? <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100"><TrendingDown size={16} className="ml-2 inline"/><b>أكبر نقطة تسريب حاليًا:</b> قبل مرحلة «{stageLabel[biggestLeak.key]}» بفقد {biggestLeak.loss} فرصة، ونسبة انتقال {biggestLeak.conversion.toFixed(1)}%.</div> : null}

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[900px] w-full text-right text-sm">
        <thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">العميل</th><th className="p-3">الدكتور</th><th className="p-3">الصنف</th><th className="p-3">المرحلة</th><th className="p-3">سبب فقد البيع</th><th className="p-3">الفاتورة</th><th className="p-3">المحادثة</th></tr></thead>
        <tbody>{leakageRows.map((row)=><tr key={`${row.source_id}-${row.product_name || ''}`} className="border-t border-slate-800 bg-slate-950/25 text-slate-200"><td className="p-3">{row.customer_name || row.customer_code || 'غير محدد'}</td><td className="p-3">{row.staff_name || 'غير محدد'}</td><td className="p-3 font-bold text-white">{row.product_name || '—'}</td><td className="p-3">{row.current_stage || '—'}</td><td className="p-3 text-amber-200">{row.leakage_reason || '—'}</td><td className="p-3">{row.invoice_match_status === 'verified' ? 'مطابقة آلية Legacy' : 'لا توجد مطابقة قوية'}</td><td className="p-3">{onOpenSource ? <button onClick={()=>onOpenSource(row.source_id)} className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-xs font-black text-cyan-200">فتح</button> : '—'}</td></tr>)}</tbody>
      </table>
      {!loading && leakageRows.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">لا توجد فرص بيع متوقفة مطابقة للفلاتر الحالية.</div> : null}
    </div>
  </section>;
}
