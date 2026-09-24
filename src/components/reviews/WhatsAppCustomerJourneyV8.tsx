import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, MessageSquareText, RefreshCw, ShoppingCart, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type SourceRow = {
  id: string;
  branch: string | null;
  staff_name: string | null;
  conversation_started_at: string | null;
  conversation_ended_at: string | null;
  review_status: string | null;
  priority: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  followup_required: boolean | null;
  suggested_followup_reason: string | null;
  analysis_json: any;
};

type CycleRow = {
  cycle_start: string;
  cycle_end: string;
  conversation_count: number;
  verified_invoice_count: number;
  verified_revenue: number;
  verified_revenue_over_500: boolean;
  pending_followup_actions: number;
  pending_customer_requests: number;
  needs_customer_service_action: boolean;
};

type ActionRow = {
  id: string;
  source_id: string;
  action_type: string;
  status: string;
  due_at: string | null;
  product_name: string | null;
  reason: string | null;
};

const intentLabel: Record<string,string> = {
  customer_request:'طلب عميل', product_inquiry:'استفسار صنف', medical_consultation:'استشارة دوائية', proactive_checkin:'اطمئنان من الصيدلية',
  complaint:'شكوى', doctor_recommendation:'ترشيح دكتور', delivery_issue:'مشكلة توصيل', followup_response:'رد متابعة', general_service:'خدمة عامة', other:'أخرى'
};
const outcomeLabel: Record<string,string> = {
  completed_sale:'بيع غير مثبت رسميًا', probable_sale:'بيع محتمل', no_sale:'بدون بيع', needs_followup:'تحتاج متابعة', unresolved_request:'طلب غير محسوم',
  complaint_resolved:'شكوى محلولة', complaint_unresolved:'شكوى مفتوحة', consultation_only:'استشارة فقط', checkin_complete:'اطمئنان مكتمل', unknown:'غير محسومة'
};

function formatDate(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'});
}

function currentCycleBounds() {
  const now = new Date();
  const cairo = new Date(now.toLocaleString('en-US',{timeZone:'Africa/Cairo'}));
  const y = cairo.getFullYear();
  const m = cairo.getMonth();
  const d = cairo.getDate();
  const start = d >= 26 ? new Date(y,m,26) : new Date(y,m-1,26);
  const end = new Date(start.getFullYear(),start.getMonth()+1,25);
  const iso = (x:Date) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  return { start: iso(start), end: iso(end) };
}

export default function WhatsAppCustomerJourneyV8({ customerCode, customerName }: { customerCode?: string | null; customerName?: string | null }) {
  const [sources,setSources] = useState<SourceRow[]>([]);
  const [actions,setActions] = useState<ActionRow[]>([]);
  const [cycle,setCycle] = useState<CycleRow | null>(null);
  const [loading,setLoading] = useState(false);

  const load = async () => {
    if (!customerCode) return;
    setLoading(true);
    try {
      const bounds = currentCycleBounds();
      const [s,a,c] = await Promise.all([
        supabase.from('whatsapp_review_sources')
          .select('id,branch,staff_name,conversation_started_at,conversation_ended_at,review_status,priority,invoice_match_status,matched_invoice_number,matched_invoice_value,followup_required,suggested_followup_reason,analysis_json')
          .eq('customer_code',customerCode)
          .gte('conversation_started_at',`${bounds.start}T00:00:00+03:00`)
          .lte('conversation_started_at',`${bounds.end}T23:59:59+03:00`)
          .order('conversation_started_at',{ascending:true})
          .limit(100),
        supabase.from('whatsapp_conversation_actions')
          .select('id,source_id,action_type,status,due_at,product_name,reason')
          .eq('customer_code',customerCode)
          .order('created_at',{ascending:true})
          .limit(100),
        supabase.from('whatsapp_customer_cycle_intelligence_v1')
          .select('*').eq('customer_code',customerCode).eq('cycle_start',bounds.start).maybeSingle(),
      ]);
      if (!s.error) setSources((s.data || []) as SourceRow[]);
      if (!a.error) setActions((a.data || []) as ActionRow[]);
      if (!c.error) setCycle((c.data || null) as CycleRow | null);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [customerCode]);

  const model = useMemo(() => {
    const openActions = actions.filter((a) => ['proposed','ready'].includes(a.status));
    const complaintOpen = sources.some((s) => s.analysis_json?.operational?.operationalOutcome === 'complaint_unresolved');
    const unresolvedRequest = sources.some((s) => s.analysis_json?.operational?.operationalOutcome === 'unresolved_request');
    const acceptedRecommendation = sources.some((s) => Array.isArray(s.analysis_json?.operational?.recommendations) && s.analysis_json.operational.recommendations.some((r:any) => r.accepted === true));
    const verifiedSales: SourceRow[] = []; // Legacy invoice matcher is not canonical sale proof.
    const revenue = verifiedSales.reduce((sum,s) => sum + Number(s.matched_invoice_value || 0),0);
    let next = 'لا يوجد إجراء عاجل مثبت حاليًا.';
    if (complaintOpen) next = 'الأولوية: متابعة الشكوى المفتوحة والتأكد من حلها ورضا العميل.';
    else if (openActions.length) next = openActions[0].reason || 'يوجد إجراء تشغيلي مفتوح يحتاج التنفيذ.';
    else if (unresolvedRequest) next = 'متابعة الطلب غير المحسوم وربطه بالصنف أو الفاتورة.';
    else if (acceptedRecommendation) next = 'متابعة نتيجة الترشيح بعد الاستخدام.';
    else if (revenue > 500) next = 'متابعة رضا العميل بعد مشتريات مؤكدة تجاوزت 500 ج في السايكل.';
    return { openActions, complaintOpen, unresolvedRequest, acceptedRecommendation, verifiedSales, revenue, next };
  },[sources,actions]);

  if (!customerCode) return null;

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-cyan-200"><UserRound size={15}/> Customer Journey V8</div>
        <h3 className="mt-1 text-lg font-black text-white">رحلة {customerName || `العميل #${customerCode}`} خلال السايكل</h3>
        <p className="mt-1 text-xs leading-6 text-slate-400">يجمع المحادثات المتفرقة لنفس العميل في رحلة واحدة بدل تقييم كل Export بمعزل عن الباقي.</p>
      </div>
      <button onClick={() => void load()} className="rounded-lg border border-slate-700 p-2 text-slate-300"><RefreshCw size={15} className={loading?'animate-spin':''}/></button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-[11px] text-slate-500">المحادثات</div><div className="text-xl font-black text-white">{cycle?.conversation_count ?? sources.length}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-[11px] text-slate-500">فواتير مؤكدة</div><div className="text-xl font-black text-cyan-300">{cycle?.verified_invoice_count ?? model.verifiedSales.length}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-[11px] text-slate-500">إيراد مؤكد</div><div className="text-xl font-black text-emerald-300">{Number(cycle?.verified_revenue ?? model.revenue).toFixed(2)} ج</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-[11px] text-slate-500">إجراءات مفتوحة</div><div className="text-xl font-black text-amber-300">{model.openActions.length}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-[11px] text-slate-500">+500 ج</div><div className="text-xl font-black text-white">{(cycle?.verified_revenue_over_500 ?? model.revenue > 500) ? 'نعم' : 'لا'}</div></div>
    </div>

    <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4"><div className="text-sm font-black text-violet-100">الخطوة التالية على مستوى رحلة العميل</div><div className="mt-2 text-sm leading-7 text-violet-50">{model.next}</div></div>

    <div className="mt-4 space-y-2">
      {sources.map((s,index) => {
        const op = s.analysis_json?.operational || {};
        const isSale = false; // Never infer a sale from the legacy statistical matcher.
        const linkedActions = actions.filter((a) => a.source_id === s.id);
        return <div key={s.id} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-black text-white">{index+1}. {intentLabel[op.primaryIntent] || op.primaryIntent || 'محادثة'}</span><span className="text-slate-500">→</span><span className={isSale?'text-emerald-300':'text-cyan-300'}>{isSale ? 'بيع غير مثبت رسميًا' : outcomeLabel[op.operationalOutcome] || op.operationalOutcome || 'غير محسومة'}</span></div>
              <div className="mt-1 text-xs text-slate-500">{formatDate(s.conversation_started_at)} • {s.staff_name || 'الدكتور غير محدد'} • {s.branch || '—'}</div>
              {op.nextBestAction ? <div className="mt-2 text-xs leading-6 text-slate-300">{op.nextBestAction}</div> : null}
              {linkedActions.length ? <div className="mt-2 flex flex-wrap gap-1">{linkedActions.map((a) => <span key={a.id} className={`rounded-lg px-2 py-1 text-[10px] font-bold ${a.status==='created'?'bg-emerald-500/10 text-emerald-200':'bg-amber-500/10 text-amber-200'}`}>{a.product_name ? `${a.product_name} • ` : ''}{a.action_type} • {a.status}</span>)}</div> : null}
            </div>
            <div className="shrink-0 text-xs text-left">
              {isSale ? <div className="rounded-lg bg-emerald-500/10 px-2 py-1 font-black text-emerald-200"><ShoppingCart size={12} className="ml-1 inline"/>{Number(s.matched_invoice_value||0).toFixed(2)} ج {s.matched_invoice_number ? `• ${s.matched_invoice_number}`:''}</div> : s.followup_required ? <div className="rounded-lg bg-amber-500/10 px-2 py-1 font-black text-amber-200"><Clock3 size={12} className="ml-1 inline"/>متابعة</div> : <div className="rounded-lg bg-slate-800 px-2 py-1 text-slate-400"><MessageSquareText size={12} className="ml-1 inline"/>جلسة</div>}
            </div>
          </div>
        </div>;
      })}
      {!loading && sources.length === 0 ? <div className="rounded-xl border border-slate-800 p-6 text-center text-sm text-slate-500">لا توجد محادثات لهذا العميل في السايكل الحالي.</div> : null}
    </div>

    {model.complaintOpen ? <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-100"><AlertTriangle size={15}/> يوجد مسار شكوى مفتوح في رحلة العميل.</div> : cycle && !cycle.needs_customer_service_action && !model.openActions.length ? <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100"><CheckCircle2 size={15}/> لا توجد متابعة تشغيلية معلقة في السايكل الحالي.</div> : null}
  </section>;
}
