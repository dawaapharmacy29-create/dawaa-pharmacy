import { REVIEW_CRITERIA, type ReviewCriterionKey } from '@/lib/conversationReviews';
import { extractIntroducedStaffName, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';
import { detectCommercialFrictionFactsV26 } from '@/lib/whatsappDeepConversationIntelligenceV26';

export type ReviewSuggestionStatus = 'assessed' | 'not_applicable' | 'review_required';

export interface WhatsAppReviewCriterionSuggestion {
  key: ReviewCriterionKey;
  label: string;
  maxPoints: number;
  status: ReviewSuggestionStatus;
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
}

export interface WhatsAppOfficialReviewSuggestion {
  provisionalScore: number | null;
  scoreLabel: string;
  assessedPoints: number;
  assessedMaxPoints: number;
  assessedCount: number;
  notApplicableCount: number;
  reviewRequiredCount: number;
  coveragePercent: number;
  confidence: number;
  items: WhatsAppReviewCriterionSuggestion[];
  summary: string;
  disclaimer: string;
}

const criterionMap = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

function getChoice(key: ReviewCriterionKey, value: string) {
  return criterionMap.get(key)?.choices.find((choice) => choice.value === value) || null;
}

function suggestion(
  key: ReviewCriterionKey,
  status: ReviewSuggestionStatus,
  option: string | null,
  confidence: number,
  reason: string,
  evidenceMessageIds: string[] = []
): WhatsAppReviewCriterionSuggestion {
  const criterion = criterionMap.get(key);
  if (!criterion) throw new Error(`Unknown review criterion: ${key}`);
  const choice = option ? getChoice(key, option) : null;
  return {
    key,
    label: criterion.label,
    maxPoints: criterion.maxPoints,
    status,
    selectedOption: option,
    selectedLabel:
      status === 'not_applicable'
        ? 'غير منطبق على الجلسة'
        : status === 'review_required'
          ? 'يحتاج مراجعة بشرية'
          : choice?.label || 'تم التقييم',
    pointsEarned: status === 'assessed' ? choice?.pointsEarned ?? null : null,
    confidence,
    reason,
    evidenceMessageIds,
  };
}

function firstResponseOption(seconds: number | null) {
  if (seconds == null) return null;
  if (seconds <= 300) return 'within_5';
  if (seconds <= 600) return 'five_to_10';
  if (seconds <= 1200) return 'ten_to_20';
  if (seconds <= 1800) return 'over_20';
  return 'over_30';
}

function followupOption(seconds: number | null) {
  if (seconds == null) return 'never';
  if (seconds <= 300) return 'within_5';
  if (seconds <= 600) return 'five_to_10';
  if (seconds <= 1200) return 'over_10';
  return 'over_20';
}

function scoreLabel(score: number | null) {
  if (score == null) return 'غير مكتمل';
  if (score >= 95) return 'ممتاز مبدئيًا';
  if (score >= 90) return 'جيد جدًا مبدئيًا';
  if (score >= 80) return 'جيد مبدئيًا';
  if (score >= 70) return 'يحتاج تحسين';
  return 'يحتاج مراجعة قوية';
}

function findMessage(session: WhatsAppConversationSession, pattern: RegExp, direction?: 'inbound' | 'outbound') {
  return session.messages.find((message) => (!direction || message.direction === direction) && pattern.test(message.text));
}

function containsCustomerName(outboundText: string, customerName: string | null | undefined) {
  const normalizedName = String(customerName || '').trim();
  if (!normalizedName || normalizedName === 'You') return false;
  const pieces = normalizedName.split(/\s+/).filter((piece) => piece.length >= 3);
  return pieces.some((piece) => outboundText.includes(piece));
}

export function buildOfficialReviewSuggestion(
  session: WhatsAppConversationSession,
  customerName?: string | null
): WhatsAppOfficialReviewSuggestion {
  const signals = extractConversationSignals(session);
  const outbound = session.messages.filter((message) => message.direction === 'outbound');
  const inbound = session.messages.filter((message) => message.direction === 'inbound');
  const outboundText = outbound.map((message) => message.text).join('\n');
  const allText = session.messages.map((message) => message.text).join('\n');
  const textConfidence = signals.deterministicConfidence;
  const commercialFriction = detectCommercialFrictionFactsV26(session.messages);
  const items: WhatsAppReviewCriterionSuggestion[] = [];

  const firstInbound = inbound[0];
  const firstOutbound = firstInbound
    ? outbound.find((message) => message.timestamp >= firstInbound.timestamp)
    : null;
  const responseOption = firstResponseOption(signals.firstResponseSeconds);
  items.push(
    responseOption
      ? suggestion(
          'first_response_speed',
          'assessed',
          responseOption,
          100,
          `زمن أول رد المحسوب ${signals.firstResponseSeconds} ثانية.`,
          [firstInbound?.id, firstOutbound?.id].filter(Boolean) as string[]
        )
      : suggestion(
          'first_response_speed',
          'review_required',
          null,
          30,
          'الجلسة لا تحتوي زوج عميل→دكتور يسمح بحساب أول رد بدقة.'
        )
  );

  const greetingMessage = findMessage(session, /أهل[ًاا] وسهل|نورتنا|السلام عليكم|مع حضرتك/i, 'outbound');
  items.push(
    signals.greetingDetected
      ? suggestion('greeting', 'assessed', 'official_full', Math.min(92, textConfidence), 'تم رصد ترحيب واضح في نص المحادثة.', greetingMessage ? [greetingMessage.id] : [])
      : suggestion('greeting', 'assessed', 'direct_reply', Math.min(82, textConfidence), 'لم يتم رصد صيغة ترحيب واضحة في الرسائل النصية. قد تقل الثقة لو توجد ميديا.', firstOutbound ? [firstOutbound.id] : [])
  );

  const introEntries = outbound
    .map((message) => ({ message, name: extractIntroducedStaffName(message) }))
    .filter((entry) => Boolean(entry.name));
  if (introEntries.length) {
    const firstIntro = introEntries[0];
    const early = outbound.indexOf(firstIntro.message) <= 1;
    items.push(suggestion('doctor_name', 'assessed', early ? 'start' : 'later', 96, early ? 'تم تقديم اسم الدكتور في بداية الجزء الصادر.' : 'تم ذكر اسم الدكتور لاحقًا.', [firstIntro.message.id]));
  } else {
    items.push(suggestion('doctor_name', 'assessed', 'none', 88, 'لم يتم اكتشاف تقديم واضح لاسم الدكتور في النص.', firstOutbound ? [firstOutbound.id] : []));
  }

  const resolvedCustomerName = customerName || session.customerName;
  if (resolvedCustomerName) {
    const used = containsCustomerName(outboundText, resolvedCustomerName);
    const evidence = used
      ? outbound.find((message) => containsCustomerName(message.text, resolvedCustomerName))
      : firstOutbound;
    items.push(suggestion('customer_name', 'assessed', used ? 'used' : 'not_used_good', used ? 90 : 72, used ? 'تم اكتشاف استخدام اسم العميل في الرد.' : 'اسم العميل معروف، لكن لم يتم رصد استخدامه نصيًا. جودة الاهتمام الشخصي تحتاج مراجعة.', evidence ? [evidence.id] : []));
  } else {
    items.push(suggestion('customer_name', 'not_applicable', null, 80, 'اسم العميل غير متاح بشكل موثوق لهذه الجلسة.'));
  }

  items.push(suggestion('tone', 'review_required', null, 35, 'جودة النبرة والاحتراف تحتاج تحليل لغوي دلالي، ولا يجب استنتاجها من الكلمات المفتاحية وحدها.'));
  items.push(suggestion('understanding', 'review_required', null, 35, 'فهم الطلب يحتاج مقارنة سؤال العميل برد الدكتور وتسلسل الاستيضاح.'));

  const promise = outbound.find((message) => /هكلمه|هرجع|هتابع|هطلب|هجيب مندوب|حالا|لحظات|هراجع/i.test(message.text));
  if (promise) {
    const nextOutbound = session.messages
      .filter((message) => message.direction === 'outbound' && message.timestamp > promise.timestamp)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0] || null;
    const seconds = nextOutbound ? Math.round((nextOutbound.timestamp.getTime() - promise.timestamp.getTime()) / 1000) : null;
    items.push(suggestion('followup_after_wait', 'assessed', followupOption(seconds), 88, nextOutbound ? `تم قياس الرجوع بعد الوعد خلال ${seconds} ثانية.` : 'تم رصد وعد بالرجوع ولم يتم رصد رجوع نصي لاحق في نفس الجلسة.', [promise.id, nextOutbound?.id].filter(Boolean) as string[]));
  } else {
    items.push(suggestion('followup_after_wait', 'not_applicable', null, 90, 'لم يتم رصد وعد واضح بالمراجعة أو الرجوع.'));
  }

  items.push(suggestion('consultation_quality', 'review_required', null, 30, 'جودة الاستشارة تحتاج فهم الحالة الطبية ومحتوى النص/الصوت/الصور.'));
  items.push(suggestion('dosage_explanation', 'review_required', null, 30, 'شرح الجرعات يحتاج تحليل طبي دقيق ولا يعتمد على كلمات مفتاحية فقط.'));

  const unavailable = findMessage(session, /مش موجود|مش متوفر|ناقص|هطلبه|هنوفر|بديل/i, 'outbound');
  items.push(
    unavailable
      ? suggestion('unavailable_items', 'review_required', null, 65, 'تم رصد إشارة من الصيدلية لصنف غير متوفر/بديل، ويجب مراجعة جودة البديل أو التسجيل.', [unavailable.id])
      : suggestion('unavailable_items', 'not_applicable', null, 88, 'لم يتم رصد دليل من الصيدلية على نقص/بديل؛ سؤال العميل وحده لا يثبت عدم التوفر.')
  );

  if (commercialFriction.closingResponsibility === 'customer') {
    items.push(suggestion('sales_closing', 'not_applicable', null, 92, 'الصيدلية قدمت ردًا تجاريًا ولم يظهر رد لاحق من العميل؛ لا يُحتسب ذلك كفشل إغلاق على الموظف.'));
  } else if (commercialFriction.closingResponsibility === 'inventory') {
    items.push(suggestion('sales_closing', 'not_applicable', null, 94, 'العائق المثبت هو عدم توافر المخزون، وليس تقصيرًا مثبتًا في إغلاق البيع من الموظف.'));
  } else if (!signals.saleIntentDetected) {
    items.push(suggestion('sales_closing', 'not_applicable', null, 85, 'لا توجد فرصة بيع مثبتة تجعل بند إغلاق البيع منطبقًا.'));
  } else if (commercialFriction.closingResponsibility === 'pharmacy') {
    items.push(suggestion('sales_closing', 'review_required', null, 78, 'العميل أبدى قبولًا ولم يظهر تأكيد نهائي للأوردر؛ يحتاج مراجعة بشرية قبل أي خصم.'));
  } else if (commercialFriction.chatClosed) {
    items.push(suggestion('sales_closing', 'review_required', null, 75, 'ظهر إغلاق للمحادثة/الأوردر، لكن جودة الإغلاق وربطه بالفاتورة تحتاج مراجعة قبل الاعتماد.'));
  } else {
    items.push(suggestion('sales_closing', 'review_required', null, 50, 'توجد نية بيع لكن مسؤولية عدم الإغلاق غير محسومة من الدليل الحالي.'));
  }

  items.push(
    signals.saleIntentDetected
      ? suggestion('cross_sell_upsell', 'review_required', null, 35, 'وجود فرصة Cross-sell/Up-sell يحتاج فهم المنتجات والاحتياج الطبي.')
      : suggestion('cross_sell_upsell', 'not_applicable', null, 60, 'لا توجد إشارة بيع واضحة تجعل Cross-sell بندًا مؤكد التطبيق.')
  );

  const complaintMessage = findMessage(session, /تأخير|التاخير|متأخر|مشكلة|شكوى|تستعجل|استعجل|لسه/i, 'inbound');
  if (signals.complaintOrEscalationDetected) {
    const apology = findMessage(session, /متاسف|آسف|بنعتذر|نعتذر/i, 'outbound');
    items.push(suggestion('angry_customer', 'review_required', null, apology ? 72 : 55, apology ? 'تم رصد شكوى/تصعيد واعتذار؛ جودة الحل النهائي تحتاج مراجعة.' : 'تم رصد شكوى/تصعيد بدون دليل كافٍ على الاحتواء والحل.', [complaintMessage?.id, apology?.id].filter(Boolean) as string[]));
  } else {
    items.push(suggestion('angry_customer', 'not_applicable', null, 82, 'لم يتم رصد شكوى أو غضب واضح نصيًا.'));
  }

  items.push(
    signals.saleIntentDetected || signals.deliveryIntentDetected
      ? suggestion('order_confirmation', 'review_required', null, 45, 'يوجد سياق طلب/دليفري؛ يلزم فحص تأكيد العنوان والكمية والهاتف والتفاصيل المهمة.')
      : suggestion('order_confirmation', 'not_applicable', null, 75, 'لا توجد إشارة طلب/دليفري مؤكدة تجعل البند منطبقًا.')
  );

  if (signals.deliveryIntentDetected && (signals.complaintOrEscalationDetected || signals.repeatedCustomerNudgeDetected)) {
    const apology = findMessage(session, /متاسف|آسف|بنعتذر|نعتذر/i, 'outbound');
    items.push(suggestion('order_delay_handling', 'review_required', null, 68, apology ? 'تم رصد تأخير/استعجال مرتبط بالدليفري مع اعتذار؛ يلزم التحقق من الإبلاغ والمتابعة حتى التنفيذ.' : 'تم رصد تأخير/استعجال مرتبط بالدليفري بدون دليل كافٍ على المعالجة.', [complaintMessage?.id, apology?.id].filter(Boolean) as string[]));
  } else {
    items.push(suggestion('order_delay_handling', 'not_applicable', null, 75, 'لا يوجد دليل نصي كافٍ على حالة تأخير أوردر تستلزم تطبيق البند.'));
  }

  if (unavailable || signals.followupPromiseDetected) {
    items.push(suggestion('customer_request_registration', 'review_required', null, 30, 'المحادثة قد تستلزم تسجيل طلب عميل، لكن إثبات التسجيل يجب أن يأتي من قاعدة البيانات وليس من نص واتساب.', unavailable ? [unavailable.id] : []));
  } else {
    items.push(suggestion('customer_request_registration', 'not_applicable', null, 65, 'لا توجد إشارة واضحة لوعد بتوفير صنف أو طلب نقص.'));
  }

  items.push(suggestion('exceptional_followup_recognition', 'review_required', null, 25, 'يحتاج ربط نوع العميل/الحالة وسجل المتابعة في النظام.'));
  items.push(suggestion('purchase_history_usage', 'review_required', null, 20, 'يتطلب مقارنة المحادثة بتاريخ مشتريات العميل في قاعدة البيانات.'));

  const closingMessage = findMessage(session, /تحت امر حضرتك|في اي وقت|تشرفنا|شكرًا لحضرتك|شكرا لحضرتك|تم الارسال|جاري الارسال/i, 'outbound');
  items.push(
    signals.closingDetected || closingMessage
      ? suggestion('closing_message', 'assessed', 'official', Math.min(88, textConfidence), 'تم رصد إغلاق/ختام واضح للمحادثة.', closingMessage ? [closingMessage.id] : [])
      : suggestion('closing_message', 'review_required', null, 60, 'لم يتم رصد ختام واضح؛ يلزم مراجعة نهاية الجلسة للتأكد أنها انتهت فعليًا.')
  );

  const assessed = items.filter((item) => item.status === 'assessed' && item.pointsEarned != null);
  const assessedPoints = assessed.reduce((sum, item) => sum + (item.pointsEarned || 0), 0);
  const assessedMaxPoints = assessed.reduce((sum, item) => sum + item.maxPoints, 0);
  const provisionalScore = assessedMaxPoints > 0 ? Math.round((assessedPoints / assessedMaxPoints) * 100) : null;
  const notApplicableCount = items.filter((item) => item.status === 'not_applicable').length;
  const reviewRequiredCount = items.filter((item) => item.status === 'review_required').length;
  const coveragePercent = Math.round((assessed.length / Math.max(1, items.length - notApplicableCount)) * 100);
  const confidence = assessed.length
    ? Math.round(assessed.reduce((sum, item) => sum + item.confidence, 0) / assessed.length)
    : 0;

  const alerts = [
    signals.waitsOver10Minutes ? `${signals.waitsOver10Minutes} انتظار فوق 10 دقائق` : '',
    signals.waitsOver5Minutes ? `${signals.waitsOver5Minutes} انتظار فوق 5 دقائق` : '',
    signals.unansweredInboundCount ? `${signals.unansweredInboundCount} رسالة بلا رد لاحق` : '',
    signals.complaintOrEscalationDetected ? 'شكوى/تصعيد محتمل' : '',
  ].filter(Boolean);

  const summary = alerts.length
    ? `التحليل الموضوعي رصد: ${alerts.join('، ')}. الدرجة المعروضة مبدئية ومبنية فقط على البنود التي أمكن إثباتها آليًا.`
    : 'لم تُرصد مؤشرات تشغيلية سلبية واضحة في البنود القابلة للقياس آليًا، مع بقاء البنود الدلالية للمراجعة البشرية.';

  return {
    provisionalScore,
    scoreLabel: scoreLabel(provisionalScore),
    assessedPoints,
    assessedMaxPoints,
    assessedCount: assessed.length,
    notApplicableCount,
    reviewRequiredCount,
    coveragePercent,
    confidence,
    items,
    summary,
    disclaimer: 'هذه ليست الدرجة الرسمية النهائية. لا يتم حفظ أو خصم نقاط قبل مراجعة البنود غير المحسومة واعتماد التقييم بشريًا.',
  };
}
