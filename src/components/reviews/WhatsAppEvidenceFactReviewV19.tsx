import { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Fact = Record<string, any>;

const factLabel: Record<string, string> = {
  greeting: 'ترحيب', response_delay: 'إشارة تأخير رد', customer_request: 'طلب عميل', request_registered: 'الطلب تم تسجيله',
  quantity_confirmed: 'الكمية مؤكدة', address_confirmed: 'العنوان مذكور/مؤكد', stock_unavailable: 'الصنف غير متوفر', availability_confirmed: 'التوفر مؤكد',
  alternative_offered: 'بديل معروض', recommendation: 'ترشيح', recommendation_accepted: 'الترشيح مقبول', recommendation_rejected: 'الترشيح مرفوض',
  order_confirmed: 'الأوردر مؤكد داخل الشات', order_failed: 'تعثر الطلب', delivery_delay: 'تأخير دليفري', complaint: 'شكوى', apology: 'اعتذار',
  service_followup: 'متابعة خدمة العملاء', customer_replied: 'العميل رد', customer_silent: 'العميل لم يرد', verified_sale: 'بيع مؤكد بفاتورة',
  media_missing_context: 'ميديا ناقصة من السياق', needs_followup: 'يحتاج متابعة', delay_notice: 'تم إبلاغ العميل بالتأخير', customer_accepted_delay: 'العميل وافق على الانتظار',
  promise_made: 'وعد تشغيلي', promise_breach_signal: 'إشارة لتعثر وعد', staff_handoff: 'انتقال الحالة لموظف آخر', delivery_blocker: 'عائق دليفري',
  recovery_offer: 'محاولة استرجاع', case_continuity_break: 'إشارة انقطاع في استمرارية الحالة',
};

export default function WhatsAppEvidenceFactReviewV19({ sourceId }: { sourceId: string | null }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!sourceId) { setFacts([]); return; }
    setLoading(true);
    const { data, error } = await supabase.from('whatsapp_evidence_facts_v17').select('*').eq('source_id', sourceId).order('fact_at', { ascending: true });
    if (error) setMessage(`تعذر تحميل الوقائع: ${error.message}`);
    else setFacts(data || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [sourceId]);

  const counts = useMemo(() => ({ proposed: facts.filter((f) => f.review_state === 'proposed').length, confirmed: facts.filter((f) => f.review_state === 'confirmed').length, rejected: facts.filter((f) => f.review_state === 'rejected').length }), [facts]);

  const decide = async (fact: Fact, decision: 'confirmed' | 'rejected') => {
    setBusyId(String(fact.id)); setMessage(null);
    const { error } = await supabase.rpc('dawaa_review_whatsapp_evidence_fact_v19', { p_fact_id: fact.id, p_decision: decision, p_note: null });
    if (error) setMessage(`لم يتم تحديث الدليل: ${error.message}`);
    else { setMessage(decision === 'confirmed' ? 'تم تأكيد الدليل وتسجيل القرار في سجل المراجعة.' : 'تم رفض الدليل وتسجيل القرار في سجل المراجعة.'); await load(); }
    setBusyId(null);
  };

  if (!sourceId) return null;
  return <section className="dawaa-card dawaa-card--soft p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="font-black text-white">مراجعة الوقائع المستخرجة V19</div><div className="mt-1 text-xs text-slate-400">تأكيد الوقائع يوثق الدليل فقط ولا ينشئ نقاطًا أو خصومات تلقائيًا.</div></div>
      <div className="flex gap-2 text-[10px]"><span className="rounded-lg border border-slate-700 px-2 py-1 text-slate-300">مقترح {counts.proposed}</span><span className="rounded-lg border border-emerald-400/20 px-2 py-1 text-emerald-200">مؤكد {counts.confirmed}</span><span className="rounded-lg border border-rose-400/20 px-2 py-1 text-rose-200">مرفوض {counts.rejected}</span></div>
    </div>
    {message ? <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/25 p-2 text-xs text-slate-300">{message}</div> : null}
    {loading ? <div className="mt-3 text-xs text-slate-400">جاري تحميل الوقائع...</div> : null}
    <div className="mt-3 max-h-[480px] space-y-2 overflow-auto pr-1">
      {facts.map((fact) => <div key={fact.id} className="rounded-xl border border-slate-800 bg-slate-950/25 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><div className="font-black text-white">{factLabel[fact.fact_type] || fact.fact_type}</div><div className="mt-1 text-[10px] text-slate-500">ثقة {Math.round(Number(fact.confidence || 0))}% · {fact.staff_name || 'بدون موظف منسوب'} · {fact.evidence_kind}</div></div>
          <State value={fact.review_state} />
        </div>
        {fact.product_name ? <div className="mt-1 text-xs text-violet-200">الصنف: {fact.product_name}{fact.quantity ? ` × ${fact.quantity}` : ''}</div> : null}
        {fact.evidence_json?.quote ? <div className="mt-2 rounded-lg border border-slate-800 bg-black/20 p-2 text-xs leading-5 text-slate-300">«{fact.evidence_json.quote}»</div> : null}
        {fact.evidence_json?.note ? <div className="mt-1 text-[10px] leading-5 text-amber-200">{fact.evidence_json.note}</div> : null}
        {fact.review_state === 'proposed' ? <div className="mt-2 flex gap-2">
          <button disabled={busyId === String(fact.id)} onClick={() => void decide(fact, 'confirmed')} className="flex items-center gap-1 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-200 disabled:opacity-50"><Check size={13}/>تأكيد الدليل</button>
          <button disabled={busyId === String(fact.id)} onClick={() => void decide(fact, 'rejected')} className="flex items-center gap-1 rounded-lg border border-rose-400/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200 disabled:opacity-50"><X size={13}/>رفض</button>
        </div> : null}
      </div>)}
      {!loading && !facts.length ? <div className="text-xs text-slate-500">لا توجد وقائع V17/V19 محفوظة لهذه الجلسة حتى الآن. أعد تحليل Export بعد نشر النسخة الجديدة.</div> : null}
    </div>
  </section>;
}

function State({ value }: { value: string }) {
  if (value === 'confirmed') return <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200"><Check size={11} className="inline"/> مؤكد</span>;
  if (value === 'rejected') return <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200"><X size={11} className="inline"/> مرفوض</span>;
  return <span className="rounded-lg bg-slate-800/70 px-2 py-1 text-[10px] text-slate-300"><RotateCcw size={11} className="inline"/> مقترح</span>;
}
