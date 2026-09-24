import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, HeartPulse, PackageSearch, RefreshCw, ShoppingCart, Sparkles, UserRoundCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Source = {
  id: string;
  customer_code: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  analysis_json: any;
};

type ActionRow = {
  id: string; action_type: string; status: string; confidence: number | null; product_name: string | null;
  quantity: number | null; due_at: string | null; reason: string | null; target_table: string | null; target_id: string | null;
};

type CycleRow = {
  cycle_start: string; cycle_end: string; conversation_count: number; verified_invoice_count: number; verified_revenue: number;
  verified_revenue_over_500: boolean; pending_followup_actions: number; pending_customer_requests: number; needs_customer_service_action: boolean;
};

const intentLabels: Record<string,string> = {
  customer_request:'طلب عميل', product_inquiry:'استفسار عن صنف', medical_consultation:'استشارة دوائية', proactive_checkin:'اطمئنان من خدمة العملاء',
  complaint:'شكوى', doctor_recommendation:'ترشيح من دكتور', delivery_issue:'مشكلة توصيل', followup_response:'رد على متابعة', general_service:'خدمة عامة', other:'أخرى'
};
const outcomeLabels: Record<string,string> = {
  completed_sale:'بيع مؤكد بالفاتورة', probable_sale:'بيع محتمل — ينتظر الفاتورة', no_sale:'لم يتم البيع', needs_followup:'تحتاج متابعة',
  unresolved_request:'طلب غير محسوم', complaint_resolved:'شكوى تم احتواؤها', complaint_unresolved:'شكوى غير محسومة', consultation_only:'استشارة فقط', checkin_complete:'متابعة اطمئنان مكتملة', unknown:'غير محسومة'
};
const actionLabels: Record<string,string> = { customer_request:'تسجيل طلب عميل', customer_followup:'متابعة عميل', recommendation_followup:'متابعة ترشيح', complaint_followup:'متابعة شكوى', invoice_recheck:'إعادة مطابقة فاتورة', manual_review:'مراجعة بشرية' };
const statusLabels: Record<string,string> = { proposed:'مقترح', ready:'جاهز للتنفيذ', created:'تم إنشاؤه', dismissed:'مستبعد', error:'خطأ' };

function Badge({children, tone='slate'}:{children:React.ReactNode;tone?:'slate'|'green'|'amber'|'rose'|'cyan'|'violet'}) {
  const map = { slate:'border-slate-700 bg-slate-900 text-slate-200', green:'border-emerald-400/30 bg-emerald-500/10 text-emerald-200', amber:'border-amber-400/30 bg-amber-500/10 text-amber-200', rose:'border-rose-400/30 bg-rose-500/10 text-rose-200', cyan:'border-cyan-400/30 bg-cyan-500/10 text-cyan-200', violet:'border-violet-400/30 bg-violet-500/10 text-violet-200' };
  return <span className={`rounded-lg border px-2 py-1 text-[11px] font-black ${map[tone]}`}>{children}</span>;
}

export default function WhatsAppOperationalPanelV6({ source }: { source: Source }) {
  const [actions,setActions] = useState<ActionRow[]>([]);
  const [cycles,setCycles] = useState<CycleRow[]>([]);
  const [loading,setLoading] = useState(false);
  const operational = source.analysis_json?.operational || null;

  const load = async () => {
    setLoading(true);
    try {
      const [a,c] = await Promise.all([
        supabase.from('whatsapp_conversation_actions').select('id,action_type,status,confidence,product_name,quantity,due_at,reason,target_table,target_id').eq('source_id',source.id).order('created_at',{ascending:true}),
        source.customer_code ? supabase.from('whatsapp_customer_cycle_intelligence_v1').select('*').eq('customer_code',source.customer_code).order('cycle_start',{ascending:false}).limit(2) : Promise.resolve({data:[],error:null} as any),
      ]);
      if (!a.error) setActions((a.data || []) as ActionRow[]);
      if (!c.error) setCycles((c.data || []) as CycleRow[]);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [source.id, source.customer_code]);

  const effectiveOutcome = operational?.operationalOutcome;
  const products = Array.isArray(operational?.products) ? operational.products : [];
  const requests = Array.isArray(operational?.customerRequests) ? operational.customerRequests : [];
  const recommendations = Array.isArray(operational?.recommendations) ? operational.recommendations : [];
  const currentCycle = cycles[0] || null;
  const intentTone = operational?.primaryIntent === 'complaint' ? 'rose' : operational?.primaryIntent === 'customer_request' ? 'cyan' : operational?.primaryIntent === 'proactive_checkin' ? 'green' : 'violet';
  const outcomeTone = effectiveOutcome === 'completed_sale' || effectiveOutcome === 'checkin_complete' || effectiveOutcome === 'complaint_resolved' ? 'green' : effectiveOutcome === 'complaint_unresolved' ? 'rose' : effectiveOutcome === 'needs_followup' || effectiveOutcome === 'unresolved_request' ? 'amber' : 'slate';
  const readyActions = useMemo(() => actions.filter((a) => a.status === 'ready').length,[actions]);

  if (!operational) return <section className="dawaa-card dawaa-card--soft p-4 text-sm text-slate-400">هذه الجلسة ما زالت على تحليل أقدم. أعد فحص/استيراد المصدر لتطبيق Operational V6.</section>;

  return <section className="dawaa-card dawaa-card--raised space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 font-black text-white"><Sparkles size={18}/> الذكاء التشغيلي V6</div><div className="mt-1 text-xs text-slate-400">يفصل بين نوع المحادثة، نتيجتها، الطلبات، الترشيحات، المتابعة والبيع المؤكد بالفاتورة.</div></div>
      <button onClick={() => void load()} className="rounded-lg border border-slate-700 p-2 text-slate-300"><RefreshCw size={15} className={loading?'animate-spin':''}/></button>
    </div>

    <div className="flex flex-wrap gap-2">
      <Badge tone={intentTone as any}>{intentLabels[operational.primaryIntent] || operational.primaryIntent}</Badge>
      <Badge tone={outcomeTone as any}>{outcomeLabels[effectiveOutcome] || effectiveOutcome || '—'}</Badge>
      <Badge tone="cyan">البادئ: {operational.initiator === 'customer' ? 'العميل' : operational.initiator === 'pharmacy' ? 'الصيدلية' : 'غير محدد'}</Badge>
      <Badge tone={operational.officialScoringEligible?'green':'amber'}>{operational.officialScoringEligible?'صالح للتقييم الرسمي':'التقييم الرسمي يحتاج مراجعة'}</Badge>
      <Badge>ثقة النية {Math.round(Number(operational.intentConfidence||0))}%</Badge>
      <Badge>ثقة النتيجة {Math.round(Number(operational.outcomeConfidence||0))}%</Badge>
    </div>

    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><div className="flex items-center gap-2 font-black text-white"><PackageSearch size={16}/> الأصناف والطلبات</div>
        <div className="mt-3 space-y-2 text-sm text-slate-300">{products.length ? products.map((p:any,i:number)=><div key={i} className="rounded-xl bg-slate-900/70 p-2"><b>{p.canonicalName || p.rawName}</b> <span className="text-xs text-slate-500">• {p.status} • ثقة {Math.round(p.confidence||0)}%</span>{p.quantity?<span> • كمية {p.quantity}</span>:null}{p.productCode?<span className="text-cyan-300"> • كود {p.productCode}</span>:null}</div>) : <div className="text-slate-500">لم يتم استخراج صنف صريح بثقة كافية.</div>}</div>
        {requests.length ? <div className="mt-3 text-xs text-amber-200">تم استخراج {requests.length} طلب/طلبات عميل تحتاج متابعة مسارها.</div>:null}
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><div className="flex items-center gap-2 font-black text-white"><HeartPulse size={16}/> الترشيحات والمتابعة</div>
        <div className="mt-3 space-y-2 text-sm text-slate-300">{recommendations.length ? recommendations.map((r:any,i:number)=><div key={i} className="rounded-xl bg-slate-900/70 p-2"><b>{r.productName || 'ترشيح'}</b> • {r.accepted===true?'العميل وافق':r.accepted===false?'العميل رفض':'لم يُحسم قبول العميل'} <span className="text-xs text-slate-500">• ثقة {Math.round(r.confidence||0)}%</span></div>) : <div className="text-slate-500">لا يوجد ترشيح صريح مثبت في هذه الجلسة.</div>}</div>
        {operational.followupPlan?.required ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100"><b>المتابعة مطلوبة:</b> {operational.followupPlan.reason}{operational.followupPlan.dueInDays!=null?` • خلال ${operational.followupPlan.dueInDays} يوم`:''}</div>:null}
      </div>
    </div>

    <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4"><div className="font-black text-violet-100">الخطوة التالية المقترحة</div><div className="mt-2 text-sm leading-7 text-violet-50">{operational.nextBestAction}</div></div>

    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-800 p-4"><div className="flex items-center gap-2 font-black text-white"><ClipboardList size={16}/> الإجراءات التشغيلية <Badge tone={readyActions?'amber':'slate'}>{readyActions} جاهز</Badge></div><div className="mt-3 space-y-2">{actions.length?actions.map((a)=><div key={a.id} className="rounded-xl bg-slate-950/50 p-2 text-sm text-slate-300"><div><b>{actionLabels[a.action_type]||a.action_type}</b> • {statusLabels[a.status]||a.status} • {Math.round(Number(a.confidence||0))}%</div><div className="mt-1 text-xs text-slate-500">{a.product_name?`${a.product_name} • `:''}{a.reason||''}</div></div>):<div className="text-sm text-slate-500">لا توجد إجراءات تشغيلية مطلوبة.</div>}</div></div>
      <div className="rounded-2xl border border-slate-800 p-4"><div className="flex items-center gap-2 font-black text-white"><ShoppingCart size={16}/> قيمة العميل في سايكل 26→25</div>{currentCycle?<><div className="mt-3 grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-slate-950/50 p-2"><div className="text-xs text-slate-500">مبيعات مؤكدة مرتبطة</div><div className="text-lg font-black text-emerald-300">{Number(currentCycle.verified_revenue||0).toFixed(2)} ج</div></div><div className="rounded-xl bg-slate-950/50 p-2"><div className="text-xs text-slate-500">فواتير مؤكدة</div><div className="text-lg font-black text-cyan-300">{currentCycle.verified_invoice_count}</div></div></div><div className="mt-2 flex flex-wrap gap-2"><Badge tone={currentCycle.verified_revenue_over_500?'green':'slate'}>{currentCycle.verified_revenue_over_500?'تجاوز 500 ج في السايكل':'أقل من/يساوي 500 ج'}</Badge>{currentCycle.needs_customer_service_action?<Badge tone="amber">يحتاج إجراء خدمة عملاء</Badge>:<Badge tone="green">لا يوجد إجراء معلق</Badge>}</div><div className="mt-2 text-[11px] text-slate-500">{currentCycle.cycle_start} → {currentCycle.cycle_end} • {currentCycle.conversation_count} محادثة</div></>:<div className="mt-3 text-sm text-slate-500">لا توجد بيانات سايكل مرتبطة بهذا العميل حتى الآن.</div>}</div>
    </div>

    {source.invoice_match_status === 'verified' ? <div className="flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-3 text-sm text-cyan-100"><CheckCircle2 size={16}/> توجد مطابقة فاتورة آلية Legacy {source.matched_invoice_number || 'مرشحة'} بقيمة {Number(source.matched_invoice_value||0).toFixed(2)} ج — لا تثبت البيع رسميًا.</div> : operational.operationalOutcome === 'probable_sale' ? <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100"><AlertTriangle size={16}/> يوجد إغلاق بيع ظاهر في المحادثة، لكن لا نحسبه بيعًا رسميًا قبل مطابقة الفاتورة.</div> : null}
  </section>;
}
