import { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type JourneyRow = {
  source_id: string;
  branch: string | null;
  staff_name: string | null;
  product_name: string | null;
  customer_name: string | null;
  cycle_start: string;
  cycle_end: string;
  current_stage: string | null;
  sale_intent: boolean | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  invoice_match_status: string | null;
};

type Scope = { label: string; rows: JourneyRow[] };

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function stageFlags(row: JourneyRow) {
  const stage = String(row.current_stage || '').toLowerCase();
  const opportunity = row.sale_intent === true || Boolean(row.product_name);
  const offer = /available|alternative|recommended|offered|suggested|accepted|closed|invoice|sold/.test(stage);
  const accepted = /accepted|closed|invoice|sold/.test(stage) || row.closed_in_chat === true;
  const closed = row.closed_in_chat === true || /closed|invoice|sold/.test(stage);
  const verified = false; // Canonical Sale Proof is not available in this legacy view.
  const followup = row.followup_candidate === true;
  return { opportunity, offer, accepted, closed, verified, followup };
}

function funnel(scope: Scope) {
  const stages = [
    ['فرصة/طلب', 'opportunity'],
    ['توفر/بديل/ترشيح', 'offer'],
    ['قبول العميل', 'accepted'],
    ['تأكيد الأوردر', 'closed'],
    ['فاتورة مؤكدة', 'verified'],
    ['متابعة بعد البيع', 'followup'],
  ] as const;
  const values = stages.map(([label, key]) => ({ label, value: scope.rows.filter((r) => stageFlags(r)[key]).length }));
  return values.map((item, index) => ({
    ...item,
    conversion: index === 0 ? 100 : values[index - 1].value > 0 ? (item.value / values[index - 1].value) * 100 : 0,
    leakage: index === 0 ? 0 : Math.max(0, values[index - 1].value - item.value),
  }));
}

function ScopeCard({ scope }: { scope: Scope }) {
  const rows = funnel(scope);
  const biggest = rows.slice(1).sort((a,b) => b.leakage - a.leakage)[0];
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
    <div className="font-black text-white">{scope.label}</div>
    <div className="mt-3 space-y-2">
      {rows.map((row, i) => <div key={row.label} className="grid grid-cols-[1fr_70px_90px_80px] items-center gap-2 rounded-xl bg-slate-900/60 p-2 text-xs">
        <span className="text-slate-200">{row.label}</span>
        <span className="text-center font-black text-white">{row.value}</span>
        <span className="text-center text-cyan-300">{i === 0 ? '—' : `${row.conversion.toFixed(1)}%`}</span>
        <span className="text-center text-amber-300">{i === 0 ? '—' : `-${row.leakage}`}</span>
      </div>)}
    </div>
    {biggest?.leakage > 0 ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">أكبر تسريب: قبل مرحلة <b>{biggest.label}</b> — {biggest.leakage} فرصة.</div> : <div className="mt-3 text-xs text-slate-500">لا يظهر تسريب كافٍ للحكم حاليًا.</div>}
  </div>;
}

export default function WhatsAppFunnelComparisonV9() {
  const [rows,setRows] = useState<JourneyRow[]>([]);
  const [loading,setLoading] = useState(false);
  const [left,setLeft] = useState('فرع الشامي');
  const [right,setRight] = useState('فرع شكري');

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase.from('whatsapp_product_journey_detail_v1').select('source_id,branch,staff_name,product_name,customer_name,cycle_start,cycle_end,current_stage,sale_intent,closed_in_chat,followup_candidate,leakage_reason,invoice_match_status').lte('cycle_start',today).gte('cycle_end',today).limit(5000);
      if (error) throw error;
      setRows((data || []) as JourneyRow[]);
    } catch (e) {
      console.error('[whatsapp-funnel-comparison-v9] load failed', e);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const scopes = useMemo(() => {
    const branches = ['فرع الشامي','فرع شكري'];
    const doctors = Array.from(new Set(rows.map(r => r.staff_name).filter(Boolean) as string[])).sort((a,b)=>a.localeCompare(b,'ar'));
    return [...branches, ...doctors];
  }, [rows]);
  const makeScope = (name: string): Scope => ({ label: name, rows: rows.filter(r => r.branch === name || r.staff_name === name) });

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
      <div><div className="flex items-center gap-2 text-xs font-black text-cyan-200"><GitCompareArrows size={16}/> مقارنة الـFunnel V9</div><h2 className="mt-1 text-xl font-black text-white">فرع مقابل فرع أو دكتور مقابل دكتور</h2><p className="mt-2 text-sm text-slate-400">مقارنة وصفية لمراحل التحويل وتحديد موضع التسريب. لا تتحول تلقائيًا إلى تقييم أو نقاط.</p></div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white"><RefreshCw size={15} className={loading?'animate-spin':''}/> تحديث</button>
    </div>
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      <select value={left} onChange={e=>setLeft(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">{scopes.map(s=><option key={s} value={s}>{s}</option>)}</select>
      <select value={right} onChange={e=>setRight(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">{scopes.map(s=><option key={s} value={s}>{s}</option>)}</select>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2"><ScopeCard scope={makeScope(left)}/><ScopeCard scope={makeScope(right)}/></div>
  </section>;
}
