import type { ParsedWhatsAppMessage, WhatsAppChatAnalysis } from './whatsappChatAnalyzer';

export type JourneyStage =
  | 'opening'
  | 'need_discovery'
  | 'consultation'
  | 'availability_price'
  | 'objection'
  | 'alternative'
  | 'upsell'
  | 'order_confirmation'
  | 'delivery'
  | 'followup'
  | 'complaint_recovery'
  | 'closing'
  | 'unknown';

export type JourneyEvent = {
  id: string;
  stage: JourneyStage;
  messageIds: string[];
  summary: string;
  confidence: number;
};

export type LostSaleOpportunity = {
  type: 'no_alternative' | 'no_followup' | 'no_close' | 'price_objection_unhandled' | 'stockout_dead_end' | 'no_cross_sell';
  severity: 'low' | 'medium' | 'high';
  summary: string;
  messageIds: string[];
};

export type JourneyAnalysis = {
  stages: JourneyEvent[];
  outcome: 'sold' | 'not_sold' | 'needs_followup' | 'complaint_resolved' | 'complaint_unresolved' | 'unknown';
  customerIntent: string[];
  objections: string[];
  lostSales: LostSaleOpportunity[];
  nextBestActions: string[];
  conversionConfidence: number;
};

const RX = {
  greeting: /(السلام|صباح الخير|مساء الخير|اهلا|أهلا|مرحبا|مرحب|مع حضرتك)/i,
  need: /(عايز|عاوزه|محتاج|محتاجة|بدور على|ممكن|عندي|ابني|بنتي|والدتي|زوجتي|زوجي)/i,
  consultation: /(اعراض|أعراض|جرعة|استخدام|ينفع|مناسب|حامل|رضاعة|سكر|ضغط|حساسية|كحة|سخونية|وجع|التهاب)/i,
  price: /(سعر|بكام|كام جنيه|غالي|رخيص)/i,
  availability: /(متوفر|موجود|خلص|ناقص|مش موجود|غير متوفر)/i,
  objection: /(غالي|كتير|مش مناسب|مش عايز|مش عاوز|هفكر|خليني اشوف|سعره عالي|مش مقتنع)/i,
  alternative: /(بديل|بديله|بداله|بدلاً|ممكن ناخد|ينفع بدل)/i,
  upsell: /(تحب|نضيف|كمان|معاه|عرض|باكدج|حجم اكبر|الأكبر|الاكبر)/i,
  confirm: /(تمام ابعته|تمام ابعتي|أكد الطلب|اكد الطلب|تم تأكيد|هيتم التوصيل|ثبت الطلب|خلاص ابعته)/i,
  delivery: /(العنوان|التوصيل|الدليفري|هيوصل|مندوب|المنطقة|لوكيشن)/i,
  wait: /(لحظات|هراجع|هتأكد|هشوف|راجع لحضرتك|بشوف)/i,
  complaint: /(شكوى|زعلان|مستاء|غلط|اتأخر|متأخر|محدش رد|ماوصلش|موصلش|سيء|وحش)/i,
  recovery: /(نعتذر|آسف|اسف|حق حضرتك|هنحل|هنتابع|تم الحل|هعوض|نعوض)/i,
  closing: /(تحت أمر|تحت امرك|في أي وقت|فى اى وقت|سلامتك|ألف سلامة|الف سلامه|يشرفنا)/i,
};

function stageOf(m: ParsedWhatsAppMessage): JourneyStage[] {
  const text = m.text || '';
  const stages: JourneyStage[] = [];
  if (RX.greeting.test(text)) stages.push('opening');
  if (RX.need.test(text)) stages.push('need_discovery');
  if (RX.consultation.test(text)) stages.push('consultation');
  if (RX.price.test(text) || RX.availability.test(text)) stages.push('availability_price');
  if (RX.objection.test(text)) stages.push('objection');
  if (RX.alternative.test(text)) stages.push('alternative');
  if (RX.upsell.test(text)) stages.push('upsell');
  if (RX.confirm.test(text)) stages.push('order_confirmation');
  if (RX.delivery.test(text)) stages.push('delivery');
  if (RX.wait.test(text)) stages.push('followup');
  if (RX.complaint.test(text) || RX.recovery.test(text)) stages.push('complaint_recovery');
  if (RX.closing.test(text)) stages.push('closing');
  return stages.length ? stages : ['unknown'];
}

function summarize(stage: JourneyStage, messages: ParsedWhatsAppMessage[]) {
  const labels: Record<JourneyStage, string> = {
    opening: 'بداية وترحيب بالمحادثة',
    need_discovery: 'اكتشاف احتياج العميل',
    consultation: 'استشارة/فهم الحالة أو الاستخدام',
    availability_price: 'سؤال أو رد عن التوفر/السعر',
    objection: 'اعتراض أو تردد من العميل',
    alternative: 'اقتراح بديل',
    upsell: 'محاولة Cross-sell / Upsell',
    order_confirmation: 'تأكيد الطلب أو الإغلاق البيعي',
    delivery: 'ترتيبات التوصيل',
    followup: 'وعد بالرجوع أو متابعة',
    complaint_recovery: 'شكوى أو محاولة احتواء',
    closing: 'ختام المحادثة',
    unknown: 'جزء غير مصنف بوضوح',
  };
  const excerpt = messages.map((m) => m.text.replace(/\n/g, ' ')).join(' | ').slice(0, 180);
  return `${labels[stage]}${excerpt ? ` — ${excerpt}` : ''}`;
}

export function analyzeConversationJourney(analysis: WhatsAppChatAnalysis): JourneyAnalysis {
  const messages = analysis.messages.filter((m) => !m.system);
  const stages: JourneyEvent[] = [];

  messages.forEach((m, index) => {
    for (const stage of stageOf(m)) {
      stages.push({
        id: `${stage}-${m.id}-${index}`,
        stage,
        messageIds: [m.id],
        summary: summarize(stage, [m]),
        confidence: stage === 'unknown' ? .35 : .78,
      });
    }
  });

  const customer = messages.filter((m) => m.role === 'customer');
  const staff = messages.filter((m) => m.role === 'staff');
  const customerText = customer.map((m) => m.text).join(' ');
  const staffText = staff.map((m) => m.text).join(' ');

  const customerIntent = [
    RX.price.test(customerText) ? 'معرفة السعر' : '',
    RX.availability.test(customerText) ? 'معرفة التوفر' : '',
    RX.consultation.test(customerText) ? 'استشارة/ترشيح' : '',
    RX.delivery.test(customerText) ? 'طلب توصيل' : '',
    RX.complaint.test(customerText) ? 'شكوى/مشكلة' : '',
  ].filter(Boolean);

  const objections = customer
    .filter((m) => RX.objection.test(m.text))
    .map((m) => m.text)
    .slice(0, 10);

  const sold = RX.confirm.test(staffText) || RX.confirm.test(customerText);
  const complaint = RX.complaint.test(customerText);
  const recovery = RX.recovery.test(staffText);
  const waitOpen = analysis.metrics.missedPromisedFollowups > 0;
  const askedPrice = RX.price.test(customerText);
  const hadObjection = objections.length > 0;
  const proposedAlternative = RX.alternative.test(staffText);
  const stockout = /(غير متوفر|مش موجود|خلص|ناقص)/i.test(staffText);
  const didUpsell = RX.upsell.test(staffText);

  const lostSales: LostSaleOpportunity[] = [];
  if (stockout && !proposedAlternative) lostSales.push({ type: 'stockout_dead_end', severity: 'high', summary: 'تم إبلاغ العميل بعدم التوفر بدون بديل واضح.', messageIds: staff.filter((m) => /(غير متوفر|مش موجود|خلص|ناقص)/i.test(m.text)).map((m) => m.id) });
  if (hadObjection && !sold && !proposedAlternative) lostSales.push({ type: 'price_objection_unhandled', severity: 'high', summary: 'ظهر اعتراض/تردد ولم يظهر تعامل واضح ببديل أو قيمة أو إغلاق.', messageIds: customer.filter((m) => RX.objection.test(m.text)).map((m) => m.id) });
  if ((askedPrice || analysis.metrics.detectedProductQuestions > 0) && !sold && !waitOpen) lostSales.push({ type: 'no_close', severity: 'medium', summary: 'المحادثة وصلت لمرحلة اهتمام/سعر لكن لم يظهر إغلاق بيعي واضح.', messageIds: [] });
  if (waitOpen) lostSales.push({ type: 'no_followup', severity: 'high', summary: 'وعد بالرجوع لم يُستكمل وقد يؤدي لفقد العميل.', messageIds: [] });
  if (sold && !didUpsell) lostSales.push({ type: 'no_cross_sell', severity: 'low', summary: 'تم البيع بدون Cross-sell واضح؛ يراجع فقط إذا كان مناسبًا للحالة.', messageIds: [] });

  let outcome: JourneyAnalysis['outcome'] = 'unknown';
  if (complaint) outcome = recovery ? 'complaint_resolved' : 'complaint_unresolved';
  else if (sold) outcome = 'sold';
  else if (waitOpen || analysis.metrics.unansweredCustomerMessages > 0) outcome = 'needs_followup';
  else if (messages.length) outcome = 'not_sold';

  const nextBestActions = [
    waitOpen ? 'إعادة فتح متابعة العميل فورًا.' : '',
    stockout && !proposedAlternative ? 'اقتراح بديل متوفر بنفس الاحتياج والسعر المناسب.' : '',
    hadObjection && !sold ? 'التعامل مع الاعتراض بالقيمة/بدائل السعر ثم محاولة إغلاق البيع.' : '',
    analysis.metrics.unansweredCustomerMessages ? 'الرد على الرسائل التي لم تجد متابعة.' : '',
    complaint && !recovery ? 'تصعيد الشكوى ومتابعة الحل مع العميل.' : '',
  ].filter(Boolean);

  const signals = [sold, complaint, recovery, hadObjection, proposedAlternative, stockout, messages.length > 3].filter(Boolean).length;
  const conversionConfidence = Math.min(.96, .5 + signals * .06);

  return { stages, outcome, customerIntent, objections, lostSales, nextBestActions, conversionConfidence };
}
