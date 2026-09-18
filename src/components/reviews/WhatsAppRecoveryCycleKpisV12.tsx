import { useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type KpiRow = {
  cycle_start:string;
  cycle_end:string;
  assigned_to_id:string|null;
  assigned_to_name:string;
  total_tasks:number;
  open_tasks:number;
  overdue_tasks:number;
  completed_tasks:number;
  sold_outcomes:number;
  verified_recovered_sales:number;
  recovered_revenue:number;
  completion_rate:number|null;
  sla_hit_rate:number|null;
  avg_completion_hours:number|null;
  followup_attempts:number;
  sla_eligible_completed:number;
  sla_hit_tasks:number;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA',{ timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date());
  const get = (type:string) => parts.find((p)=>p.type===type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const money = (v:unknown) => `${Number(v || 0).toLocaleString('ar-EG',{ maximumFractionDigits:2 })} ج`;
const pct = (v:unknown) => `${Number(v || 0).toLocaleString('ar-EG',{ maximumFractionDigits:1 })}%`;

export default function WhatsAppRecoveryCycleKpisV12() {
  const [rows,setRows] = useState<KpiRow[]>([]);
  const [loading,setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data,error } = await supabase.from('whatsapp_recovery_staff_kpis_v1').select('*').lte('cycle_start',today).gte('cycle_end',today).order('recovered_revenue',{ ascending:false });
      if (error) throw error;
      setRows((data || []) as KpiRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل مؤشرات الاسترجاع');
    } finally { setLoading(false); }
  };

  useEffect(()=>{ void load(); },[]);

  const totals = useMemo(()=>{
    const total = rows.reduce((s,r)=>s+Number(r.total_tasks||0),0);
    const completed = rows.reduce((s,r)=>s+Number(r.completed_tasks||0),0);
    const slaEligible = rows.reduce((s,r)=>s+Number(r.sla_eligible_completed||0),0);
    const slaHit = rows.reduce((s,r)=>s+Number(r.sla_hit_tasks||0),0);
    const verifiedSales = rows.reduce((s,r)=>s+Number(r.verified_recovered_sales||0),0);
    return {
      total,
      open:rows.reduce((s,r)=>s+Number(r.open_tasks||0),0),
      overdue:rows.reduce((s,r)=>s+Number(r.overdue_tasks||0),0),
      completed,
      completion:total ? completed/total*100 : 0,
      sla:slaEligible ? slaHit/slaEligible*100 : 0,
      verifiedSales,
      revenue:rows.reduce((s,r)=>s+Number(r.recovered_revenue||0),0),
      attempts:rows.reduce((s,r)=>s+Number(r.followup_attempts||0),0),
    };
  },[rows]);

  const cycleLabel = rows[0] ? `${rows[0].cycle_start} ← ${rows[0].cycle_end}` : 'الدورة الحالية 26→25';

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div><div className="flex items-center gap-2 text-xs font-black text-cyan-200"><BarChart3 size={16}/> Recovery KPI V12</div><h2 className="mt-1 text-xl font-black text-white">نتائج استرجاع العملاء — {cycleLabel}</h2><p className="mt-2 text-sm text-slate-400">الأرقام محسوبة من قاعدة البيانات على كامل الدورة، وليست محدودة بعدد الصفوف الظاهر في الصفحة. الإيراد هنا فواتير مؤكدة فقط.</p></div>
      <button onClick={()=>void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {[
        ['كل المهام',totals.total],['مفتوحة',totals.open],['متأخرة',totals.overdue],['نسبة الإكمال',pct(totals.completion)],['التزام SLA',pct(totals.sla)],['إيراد مؤكد',money(totals.revenue)]
      ].map(([label,value])=><div key={String(label)} className={`rounded-xl border p-3 ${label==='متأخرة'&&Number(value)>0?'border-rose-400/30 bg-rose-500/5':'border-slate-800'}`}><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>)}
    </div>

    <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400"><span>مبيعات مسترجعة مؤكدة: <b className="text-emerald-300">{totals.verifiedSales}</b></span><span>محاولات متابعة: <b className="text-cyan-300">{totals.attempts}</b></span></div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="w-full min-w-[900px] text-right text-xs"><thead className="bg-slate-950/60 text-slate-500"><tr><th className="p-3">المسئول</th><th className="p-3">مهام</th><th className="p-3">مفتوحة</th><th className="p-3">متأخرة</th><th className="p-3">مكتملة</th><th className="p-3">الإكمال</th><th className="p-3">SLA</th><th className="p-3">متوسط الإغلاق</th><th className="p-3">بيع مؤكد</th><th className="p-3">إيراد مؤكد</th></tr></thead><tbody>
        {rows.map((r)=><tr key={r.assigned_to_id || 'unassigned'} className="border-t border-slate-800"><td className="p-3 font-black text-white">{r.assigned_to_name}</td><td className="p-3 text-slate-300">{r.total_tasks}</td><td className="p-3 text-slate-300">{r.open_tasks}</td><td className={`p-3 ${r.overdue_tasks?'text-rose-300':'text-slate-300'}`}>{r.overdue_tasks}</td><td className="p-3 text-slate-300">{r.completed_tasks}</td><td className="p-3 text-cyan-300">{pct(r.completion_rate)}</td><td className="p-3 text-cyan-300">{r.sla_eligible_completed ? pct(r.sla_hit_rate) : '—'}</td><td className="p-3 text-slate-300">{r.avg_completion_hours == null ? '—' : `${Number(r.avg_completion_hours).toLocaleString('ar-EG',{maximumFractionDigits:1})} س`}</td><td className="p-3 text-emerald-300">{r.verified_recovered_sales}</td><td className="p-3 font-black text-emerald-300">{money(r.recovered_revenue)}</td></tr>)}
        {!loading&&!rows.length?<tr><td colSpan={10} className="p-8 text-center text-slate-500">لا توجد مهام استرجاع في الدورة الحالية حتى الآن.</td></tr>:null}
      </tbody></table>
    </div>
  </section>;
}
