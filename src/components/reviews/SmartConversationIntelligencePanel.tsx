import type { ReactNode } from 'react';
import type { SmartDeepConversationAnalysis } from '@/lib/whatsappSmartConversationIntelligence';

const intentLabels: Record<string, string> = {
  service_followup: 'متابعة خدمة عملاء', product_request: 'طلب صنف', availability_check: 'سؤال عن التوفر', consultation: 'استشارة', complaint: 'شكوى', order: 'طلب / أوردر', unknown: 'غير محدد',
};
const originLabels: Record<string, string> = {
  customer_service_outreach: 'خدمة العملاء بدأت المحادثة', customer_initiated: 'العميل بدأ المحادثة', unknown: 'بداية غير مؤكدة',
};
const opportunityLabels: Record<string, string> = {
  handled_well: 'تم التعامل جيدًا مع فرصة البيع', partial: 'تم التعامل جزئيًا وكان ممكن أفضل', missed: 'فرصة بيع لم يتم استغلالها بشكل كافٍ', needs_review: 'تحتاج مراجعة بشرية', not_applicable: 'لا ينطبق',
};
const consultLabels: Record<string, string> = {
  clear: 'الشرح واضح ومنظم', partial: 'الشرح موجود لكنه غير مكتمل', weak: 'الشرح ضعيف ويحتاج مراجعة', not_applicable: 'لا توجد استشارة في الجزء المحدد',
};
const criteriaLabels: Record<string, string> = {
  sales_closing: 'إغلاق البيع', cross_sell_upsell: 'البيع الإضافي / التكميلي', consultation_quality: 'جودة شرح الاستشارة', dosage_explanation: 'شرح الجرعة والاستخدام', unavailable_items: 'النواقص والبدائل', customer_request_registration: 'تسجيل طلب العميل', exceptional_followup_recognition: 'اكتشاف فرصة متابعة',
};
function YesNo({ value }: { value: boolean }) {
  return <span className={value ? 'font-black text-emerald-300' : 'font-black text-amber-300'}>{value ? 'نعم' : 'لا'}</span>;
}
function AnalysisBlock({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><div className="mb-3 font-black text-white">{title}</div>{children}</div>;
}
export default function SmartConversationIntelligencePanel({ conversation, staff }: { conversation: SmartDeepConversationAnalysis | null; staff: SmartDeepConversationAnalysis | null }) {
  const active = staff || conversation;
  if (!active) return null;
  return <section className="dawaa-card dawaa-card--raised p-4 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs font-black text-cyan-300">فهم المحادثة</div><h2 className="mt-1 text-xl font-black text-white">نوع المحادثة، فرص البيع، النواقص والمتابعات</h2><p className="mt-1 text-xs leading-6 text-slate-400">مساعدة للمراجع وليست درجة تلقائية. أي حالة غير مؤكدة تظل بحاجة لتأكيد بشري.</p></div>
      <div className="rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">ثقة التحليل: <b className="text-white">{Math.round(active.confidence * 100)}%</b></div>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">بداية المحادثة</div><div className="mt-1 font-black text-white">{originLabels[(conversation || active).entryOrigin]}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">النية الأساسية</div><div className="mt-1 font-black text-white">{intentLabels[active.primaryIntent]}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">رحلة المحادثة</div><div className="mt-1 font-black text-white">{active.intentJourney.map((item) => intentLabels[item] || item).join(' ← ') || 'غير محدد'}</div></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <AnalysisBlock title="فرص البيع">{active.salesOpportunities.length ? <div className="space-y-2">{active.salesOpportunities.map((item, index) => <div key={`${item.triggerMessageId}-${index}`} className="rounded-xl border border-slate-800 p-3 text-sm"><div className="font-black text-white">{opportunityLabels[item.handling]}</div><div className="mt-1 text-slate-300">{item.reason}</div><div className="mt-1 text-xs text-slate-500">أدلة: {item.evidenceMessageIds.length} رسالة</div></div>)}</div> : <div className="text-sm text-slate-400">لا توجد فرصة بيع واضحة في الجزء المحدد.</div>}</AnalysisBlock>
      <AnalysisBlock title="أسلوب شرح الاستشارة"><div className="font-black text-white">{consultLabels[active.consultationCommunication]}</div><div className="mt-2 text-sm text-slate-400">يتم تقييم وضوح وترتيب الشرح فقط، وليس صحة التشخيص أو المعلومة الطبية.</div>{active.consultationEvidenceMessageIds.length ? <div className="mt-2 text-xs text-slate-500">أدلة: {active.consultationEvidenceMessageIds.length} رسالة</div> : null}</AnalysisBlock>
      <AnalysisBlock title="الصنف غير المتاح والبدائل">{!active.unavailableItem.detected ? <div className="text-sm text-slate-400">لم يتم رصد نقص واضح.</div> : <div className="grid gap-2 text-sm sm:grid-cols-2"><div>تم عرض بديل: <YesNo value={active.unavailableItem.alternativeOffered} /></div><div>تم شرح البديل: <YesNo value={active.unavailableItem.alternativeExplained} /></div><div>تم تسجيل طلب العميل: <YesNo value={active.unavailableItem.requestRegistered} /></div><div>تم إبلاغ العميل بالمتابعة: <YesNo value={active.unavailableItem.customerToldRequestRegistered} /></div></div>}</AnalysisBlock>
      <AnalysisBlock title="طلب العميل المستخرج">{!active.customerRequest.detected ? <div className="text-sm text-slate-400">لا يوجد طلب عميل منظم تم رصده.</div> : <div className="grid gap-2 text-sm sm:grid-cols-2"><div><span className="text-slate-500">الصنف:</span> <b className="text-white">{active.customerRequest.productName || 'غير محدد'}</b></div><div><span className="text-slate-500">العميل:</span> <b className="text-white">{active.customerRequest.customerName || 'غير محدد'}</b></div><div><span className="text-slate-500">الكود:</span> <b className="text-white">{active.customerRequest.customerCode || 'غير محدد'}</b></div><div><span className="text-slate-500">الهاتف:</span> <b className="text-white">{active.customerRequest.customerPhone || 'غير محدد'}</b></div><div><span className="text-slate-500">الكمية:</span> <b className="text-white">{active.customerRequest.quantity || '—'}</b></div><div><span className="text-slate-500">التركيز:</span> <b className="text-white">{active.customerRequest.concentration || '—'}</b></div><div className="sm:col-span-2">الحالة: <b className={active.customerRequest.needsConfirmation ? 'text-amber-300' : 'text-emerald-300'}>{active.customerRequest.needsConfirmation ? 'يحتاج تأكيد قبل التسجيل' : 'بيانات مكتملة بدرجة ثقة عالية'}</b></div></div>}</AnalysisBlock>
      <AnalysisBlock title="المتابعة المطلوبة">{!active.followup.detected ? <div className="text-sm text-slate-400">لا توجد متابعة واضحة مقترحة.</div> : <div className="text-sm text-slate-200"><div>سبب المتابعة: <b className="text-white">{active.followup.reason === 'illness' ? 'حالة مرضية تحتاج اطمئنان' : active.followup.reason === 'recommendation' ? 'تم ترشيح / شرح علاج' : active.followup.reason === 'service_issue' ? 'مشكلة خدمة' : 'وعد صريح بالمتابعة'}</b></div><div className="mt-2">الحالة: <b className={active.followup.needsConfirmation ? 'text-amber-300' : 'text-emerald-300'}>{active.followup.needsConfirmation ? 'اقتراح يحتاج تأكيد المراجع' : 'متابعة مؤكدة من نص المحادثة'}</b></div></div>}</AnalysisBlock>
      <AnalysisBlock title="بنود التقييم المقترحة"><div className="flex flex-wrap gap-2">{active.suggestedCriteria.length ? active.suggestedCriteria.map((item) => <span key={item} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-100">{criteriaLabels[item] || item}</span>) : <span className="text-sm text-slate-400">لا توجد بنود إضافية مقترحة.</span>}</div><div className="mt-3 text-xs text-slate-500">عدد رسائل الدليل: {active.evidenceMessageIds.length}</div></AnalysisBlock>
    </div>
  </section>;
}
