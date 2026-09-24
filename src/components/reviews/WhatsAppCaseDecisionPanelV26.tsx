import { useMemo } from 'react';
import { AlertTriangle, Clock3, HeartPulse, ShoppingCart } from 'lucide-react';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';
import {
  deriveLostReasonCodes,
  detectCommercialFrictionFactsV26,
  detectDeepJourneyStages,
  evaluateMedicalHardGate,
  summarizeResponseMetrics,
} from '@/lib/whatsappDeepConversationIntelligenceV26';

const labelForReason: Record<string, string> = {
  stockout_dead_end: 'صنف غير متوفر بدون بديل واضح',
  price_objection_unhandled: 'اعتراض سعر لم يُعالج',
  no_close: 'فرصة بيع بدون إغلاق',
  no_followup: 'وعد متابعة لم يُستكمل',
  no_cross_sell: 'بيع تم بدون فرصة تكميلية واضحة',
  customer_no_reply_after_offer: 'الصيدلية ردت والعميل لم يحسم',
  slow_response: 'تأخير مرتفع في الرد',
  unanswered_customer: 'رسالة عميل بدون رد',
  unknown: 'لا يوجد سبب فقد مؤكد',
};

function formatSeconds(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value} ث`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds ? `${minutes}د ${seconds}ث` : `${minutes}د`;
}

export default function WhatsAppCaseDecisionPanelV26({ session }: { session: WhatsAppConversationSession }) {
  const model = useMemo(() => {
    const signals = extractConversationSignals(session);
    const response = summarizeResponseMetrics(signals.responseWaits.map((row) => ({
      response_latency_seconds: row.seconds,
      no_response: row.outboundMessageId == null,
    })));
    const journey = detectDeepJourneyStages(session.messages);
    const medical = evaluateMedicalHardGate(session.messages);
    const outbound = session.messages.filter((m) => m.direction === 'outbound').map((m) => m.text || '').join('\n');
    const friction = detectCommercialFrictionFactsV26(session.messages);
    const followupPromised = /(هتابع|هرجع|هبلغ|هتواصل|اول ما|أول ما|هنوفره)/i.test(outbound);
    const followupCompleted = followupPromised && session.messages.slice().reverse().some((m) => m.direction === 'outbound' && /(تم|اتوفر|توفر|رجعنا|متاح|موجود)/i.test(m.text || ''));
    const upsellDetected = journey.some((x) => x.stage === 'upsell' && x.detected);
    const salesEligible = /(عايز|عاوز|محتاج|متوفر|سعر|بكام|ابعت|ابعث|طلب|اوردر|أوردر)/i.test(inbound);
    const lostReasons = deriveLostReasonCodes({
      stockout: friction.stockout,
      alternativeOffered: friction.alternativeOffered,
      priceObjection: friction.priceObjection,
      sold: friction.chatClosed,
      followupPromised,
      followupCompleted,
      upsellDetected,
      salesEligible,
      p90ResponseSeconds: response.p90Seconds,
      unanswered: response.unanswered,
      closingResponsibility: friction.closingResponsibility,
    });
    const humanReviewReasons = [
      ...(medical.blocked ? medical.reasons.map((x) => `مراجعة صيدلي: ${x}`) : []),
      ...(response.unanswered > 0 ? ['يوجد رسالة عميل بدون رد'] : []),
      ...(lostReasons.includes('price_objection_unhandled') ? ['اعتراض سعر يحتاج مراجعة التعامل معه — لا يعني خطأ موظف تلقائيًا'] : []),
      ...(lostReasons.includes('stockout_dead_end') ? ['نقص بدون بديل يحتاج مراجعة تشغيلية — لا يُنسب تلقائيًا للدكتور'] : []),
      ...(lostReasons.includes('no_close') && friction.closingResponsibility === 'pharmacy' ? ['العميل وافق ولم يظهر تأكيد نهائي للأوردر — راجع مرحلة الإغلاق'] : []),
    ];
    return { signals, response, journey, medical, friction, lostReasons, humanReviewReasons };
  }, [session]);

  return (
    <section className="dawaa-card dawaa-card--raised p-4" dir="rtl">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-black text-cyan-200">Case Decision V26</div>
          <div className="mt-1 text-lg font-black text-white">قرار تشغيلي مبني على الدليل — قبل أي تقييم رسمي</div>
          <div className="mt-1 text-xs leading-6 text-slate-400">يعرض سرعة الرد، مراحل الاستشارة والاعتراض والبيع الإضافي، أسباب فقد البيع، وأي Hard Gate طبي. لا يصدر خصمًا أو حكمًا طبيًا آليًا.</div>
        </div>
        <span className={`rounded-xl border px-3 py-2 text-xs font-black ${model.humanReviewReasons.length ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'}`}>
          {model.humanReviewReasons.length ? `مراجعة بشرية: ${model.humanReviewReasons.length} سبب` : 'لا توجد بوابة إلزامية ظاهرة'}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><div className="text-[10px] text-slate-500">متوسط الرد</div><div className="mt-1 font-black text-white">{formatSeconds(model.response.averageSeconds)}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><div className="text-[10px] text-slate-500">Median</div><div className="mt-1 font-black text-white">{formatSeconds(model.response.medianSeconds)}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><div className="text-[10px] text-slate-500">P90</div><div className="mt-1 font-black text-white">{formatSeconds(model.response.p90Seconds)}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><div className="text-[10px] text-slate-500">P95</div><div className="mt-1 font-black text-white">{formatSeconds(model.response.p95Seconds)}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><div className="text-[10px] text-slate-500">أكثر من 10د</div><div className="mt-1 font-black text-amber-200">{model.response.over10Minutes}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><div className="text-[10px] text-slate-500">بدون رد</div><div className="mt-1 font-black text-rose-200">{model.response.unanswered}</div></div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-black text-white"><ShoppingCart size={15}/> Journey العميق</div>
          <div className="space-y-2">{model.journey.map((row) => <div key={row.stage} className="rounded-xl border border-slate-800 px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-slate-200">{row.stage === 'consultation' ? 'استشارة' : row.stage === 'objection' ? 'اعتراض' : 'Upsell'}</span><span className={row.detected ? 'text-emerald-300 text-[10px]' : 'text-slate-500 text-[10px]'}>{row.detected ? `مكتشف ${row.confidence}%` : 'غير مثبت'}</span></div><div className="mt-1 text-[11px] leading-5 text-slate-500">{row.reason}</div></div>)}</div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-black text-white"><AlertTriangle size={15}/> أسباب فقد/تعطل البيع</div>
          <div className="space-y-2">{model.lostReasons.map((reason) => <div key={reason} className={`rounded-xl border px-3 py-2 text-xs ${reason === 'unknown' ? 'border-slate-800 text-slate-500' : 'border-amber-400/20 bg-amber-500/5 text-amber-100'}`}>{labelForReason[reason] || reason}</div>)}</div>
        </div>

        <div className={`rounded-2xl border p-3 ${model.medical.blocked ? 'border-rose-400/25 bg-rose-500/5' : 'border-slate-800 bg-slate-950/30'}`}>
          <div className="mb-2 flex items-center gap-2 text-sm font-black text-white"><HeartPulse size={15}/> Medical Hard Gate</div>
          {model.medical.blocked ? <><div className="text-xs leading-6 text-rose-100">ممنوع الاعتماد الطبي الآلي. يلزم مراجع صيدلي قبل اعتماد أي حكم متعلق بالجرعة أو سلامة الترشيح.</div><div className="mt-2 flex flex-wrap gap-1.5">{model.medical.reasons.map((reason) => <span key={reason} className="rounded-full border border-rose-400/20 px-2 py-1 text-[10px] text-rose-200">{reason}</span>)}</div></> : <div className="text-xs text-slate-500">لم يتم رصد Trigger طبي يستلزم Hard Gate في النص الحالي.</div>}
        </div>
      </div>

      {model.humanReviewReasons.length ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3"><div className="flex items-center gap-2 text-xs font-black text-amber-200"><Clock3 size={14}/> أسباب المراجعة البشرية</div><div className="mt-2 flex flex-wrap gap-2">{model.humanReviewReasons.map((reason) => <span key={reason} className="rounded-lg bg-slate-950/40 px-2 py-1 text-[11px] text-slate-300">{reason}</span>)}</div></div> : null}
    </section>
  );
}
