import { extractIntroducedStaffName, type WhatsAppConversationSession, type WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';
import { buildOfficialReviewSuggestion, type WhatsAppOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';

export type ReviewReadiness = 'quick_human_review' | 'detailed_human_review' | 'insufficient_evidence';
export type DecisionItemKind = 'risk' | 'opportunity' | 'positive' | 'attention';

export interface DoctorSegment {
  id: string;
  doctorName: string | null;
  startedAt: Date;
  endedAt: Date;
  messageIds: string[];
  outboundCount: number;
  inboundCount: number;
  confidence: number;
  attribution: 'explicit' | 'inherited' | 'unknown';
}

export interface ReviewDecisionItem {
  id: string;
  kind: DecisionItemKind;
  title: string;
  detail: string;
  responsibility: 'doctor' | 'delivery' | 'stock' | 'system' | 'customer' | 'unknown';
  confidence: number;
  messageIds: string[];
  affectsOfficialScore: boolean;
}

export interface ReviewDecisionSupport {
  readiness: ReviewReadiness;
  readinessLabel: string;
  readinessReason: string;
  confidence: number;
  resolvedCriteria: number;
  unresolvedCriteria: number;
  blockers: string[];
  doctorSegments: DoctorSegment[];
  hasDoctorAmbiguity: boolean;
  decisionItems: ReviewDecisionItem[];
  positives: ReviewDecisionItem[];
  risks: ReviewDecisionItem[];
  opportunities: ReviewDecisionItem[];
  executiveSummary: string;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

function doctorSegments(session: WhatsAppConversationSession): DoctorSegment[] {
  if (!session.messages.length) return [];

  const segments: Array<{ doctorName: string | null; attribution: DoctorSegment['attribution']; messages: WhatsAppParsedMessage[] }> = [];
  let activeDoctor: string | null = null;
  let activeAttribution: DoctorSegment['attribution'] = 'unknown';
  let current: WhatsAppParsedMessage[] = [];

  const flush = () => {
    if (!current.length) return;
    segments.push({ doctorName: activeDoctor, attribution: activeAttribution, messages: current });
    current = [];
  };

  for (const message of session.messages) {
    const introduced = extractIntroducedStaffName(message);
    if (introduced && introduced !== activeDoctor) {
      flush();
      activeDoctor = introduced;
      activeAttribution = 'explicit';
    } else if (!activeDoctor && session.outboundStaffNames.length === 1) {
      activeDoctor = session.outboundStaffNames[0];
      activeAttribution = 'inherited';
    }
    current.push(message);
  }
  flush();

  return segments.map((segment, index) => ({
    id: `${session.id}-doctor-${index}`,
    doctorName: segment.doctorName,
    startedAt: segment.messages[0].timestamp,
    endedAt: segment.messages[segment.messages.length - 1].timestamp,
    messageIds: segment.messages.map((message) => message.id),
    outboundCount: segment.messages.filter((message) => message.direction === 'outbound').length,
    inboundCount: segment.messages.filter((message) => message.direction === 'inbound').length,
    confidence: segment.attribution === 'explicit' ? 96 : segment.attribution === 'inherited' ? 78 : 35,
    attribution: segment.attribution,
  }));
}

function firstMessageMatching(session: WhatsAppConversationSession, pattern: RegExp, direction?: 'inbound' | 'outbound') {
  return session.messages.find((message) => (!direction || message.direction === direction) && pattern.test(message.text));
}

function buildDecisionItems(session: WhatsAppConversationSession, review: WhatsAppOfficialReviewSuggestion): ReviewDecisionItem[] {
  const signals = extractConversationSignals(session);
  const items: ReviewDecisionItem[] = [];

  const firstOutbound = session.messages.find((message) => message.direction === 'outbound');
  const complaint = firstMessageMatching(session, /تأخير|التاخير|متأخر|مشكلة|شكوى|تستعجل|استعجل|لسه/i, 'inbound');
  const sale = firstMessageMatching(session, /عاوز|محتاج|ابعت|الأوردر|الاوردر|شريط|علبة|قطرة|سرنج/i);
  const delivery = firstMessageMatching(session, /مندوب|توصيل|عنوان|خرج لحضرتك|الارسال/i);
  const promise = firstMessageMatching(session, /هكلمه|هرجع|هتابع|هطلب|هجيب مندوب|حالا|لحظات|هراجع/i, 'outbound');

  if (signals.firstResponseSeconds != null && signals.firstResponseSeconds <= 300) {
    items.push({ id: 'fast-first-response', kind: 'positive', title: 'استجابة أولى سريعة', detail: `أول رد خلال ${signals.firstResponseSeconds} ثانية.`, responsibility: 'doctor', confidence: 100, messageIds: firstOutbound ? [firstOutbound.id] : [], affectsOfficialScore: true });
  }

  if (signals.waitsOver5Minutes > 0) {
    const worst = [...signals.responseWaits].filter((item) => item.seconds != null).sort((a, b) => (b.seconds || 0) - (a.seconds || 0))[0];
    items.push({ id: 'long-waits', kind: 'risk', title: 'فترات انتظار تحتاج مراجعة', detail: `تم رصد ${signals.waitsOver5Minutes} انتظار فوق 5 دقائق${signals.waitsOver10Minutes ? `، منها ${signals.waitsOver10Minutes} فوق 10 دقائق` : ''}.`, responsibility: signals.deliveryIntentDetected ? 'unknown' : 'doctor', confidence: 96, messageIds: worst ? [worst.inboundMessageId, worst.outboundMessageId].filter(Boolean) as string[] : [], affectsOfficialScore: false });
  }

  if (signals.unansweredInboundCount > 0) {
    const unanswered = signals.responseWaits.find((item) => item.outboundMessageId == null);
    items.push({ id: 'unanswered', kind: 'risk', title: 'رسالة عميل بدون رد لاحق', detail: `يوجد ${signals.unansweredInboundCount} رسالة واردة لم يظهر بعدها رد نصي داخل الجلسة.`, responsibility: 'unknown', confidence: 90, messageIds: unanswered ? [unanswered.inboundMessageId] : [], affectsOfficialScore: false });
  }

  if (signals.complaintOrEscalationDetected) {
    items.push({ id: 'complaint', kind: 'attention', title: 'شكوى أو تصعيد محتمل', detail: 'توجد مؤشرات نصية لشكوى/استعجال؛ يجب مراجعة سبب المشكلة وجودة الاحتواء والحل.', responsibility: signals.deliveryIntentDetected ? 'delivery' : 'unknown', confidence: 82, messageIds: complaint ? [complaint.id] : [], affectsOfficialScore: false });
  }

  if (signals.saleIntentDetected) {
    items.push({ id: 'sale-intent', kind: 'opportunity', title: 'فرصة بيع واضحة', detail: 'المحادثة تحتوي نية شراء/طلب. يجب التحقق من الإغلاق والفاتورة قبل اعتبارها تحويلًا مؤكدًا.', responsibility: 'doctor', confidence: 78, messageIds: sale ? [sale.id] : [], affectsOfficialScore: false });
  }

  if (signals.deliveryIntentDetected) {
    items.push({ id: 'delivery-context', kind: 'attention', title: 'سياق دليفري', detail: 'أي تأخير يجب فصله بين سبب الدليفري وطريقة تعامل الدكتور؛ لا يُنسب سبب خارج إرادة الدكتور إليه تلقائيًا.', responsibility: 'delivery', confidence: 88, messageIds: delivery ? [delivery.id] : [], affectsOfficialScore: false });
  }

  if (signals.followupPromiseDetected) {
    items.push({ id: 'followup-promise', kind: 'attention', title: 'وعد بالمتابعة', detail: 'تم رصد وعد بالرجوع أو المتابعة ويجب التأكد من تنفيذه في الزمن المناسب.', responsibility: 'doctor', confidence: 88, messageIds: promise ? [promise.id] : [], affectsOfficialScore: true });
  }

  if (signals.apologyDetected && signals.complaintOrEscalationDetected) {
    const apology = firstMessageMatching(session, /متاسف|آسف|بنعتذر|نعتذر/i, 'outbound');
    items.push({ id: 'recovery-attempt', kind: 'positive', title: 'محاولة احتواء المشكلة', detail: 'تم رصد اعتذار بعد وجود شكوى/تصعيد. يبقى الحكم النهائي مرتبطًا بوجود حل ومتابعة.', responsibility: 'doctor', confidence: 80, messageIds: apology ? [apology.id] : [], affectsOfficialScore: false });
  }

  if (!signals.closingDetected && session.messages.some((message) => message.direction === 'outbound')) {
    items.push({ id: 'missing-closing', kind: 'opportunity', title: 'تحسين إغلاق المحادثة', detail: 'لم يتم رصد رسالة ختامية واضحة في النص المتاح.', responsibility: 'doctor', confidence: 74, messageIds: session.messages.slice(-2).map((message) => message.id), affectsOfficialScore: true });
  }

  const unresolvedHighValue = review.items.filter((item) => item.status === 'review_required' && ['understanding', 'consultation_quality', 'dosage_explanation', 'sales_closing', 'angry_customer', 'order_confirmation', 'order_delay_handling'].includes(item.key));
  if (unresolvedHighValue.length) {
    items.push({ id: 'semantic-review', kind: 'attention', title: 'بنود دلالية لم تُحسم', detail: `${unresolvedHighValue.length} بند مهم يحتاج فهم سياق أو مراجعة بشرية/AI دلالي قبل الدرجة النهائية.`, responsibility: 'unknown', confidence: 100, messageIds: [], affectsOfficialScore: false });
  }

  return items;
}

export function buildReviewDecisionSupport(session: WhatsAppConversationSession, customerName?: string | null): ReviewDecisionSupport {
  const review = buildOfficialReviewSuggestion(session, customerName);
  const signals = extractConversationSignals(session);
  const segments = doctorSegments(session);
  const distinctDoctors = Array.from(new Set(segments.map((segment) => segment.doctorName).filter(Boolean)));
  const hasUnknownSegment = segments.some((segment) => !segment.doctorName && segment.outboundCount > 0);
  const hasDoctorAmbiguity = distinctDoctors.length > 1 || hasUnknownSegment;
  const decisionItems = buildDecisionItems(session, review);

  const blockers: string[] = [];
  if (review.coveragePercent < 35) blockers.push('تغطية البنود المحسومة آليًا منخفضة');
  if (signals.mediaCount > 0) blockers.push(`يوجد ${signals.mediaCount} عنصر ميديا غير محلل`);
  if (hasDoctorAmbiguity) blockers.push('نسبة بعض الرسائل للدكتور تحتاج مراجعة');
  if (review.items.some((item) => item.status === 'review_required' && ['consultation_quality', 'dosage_explanation'].includes(item.key))) blockers.push('بنود طبية/استشارية غير محسومة');
  if (signals.complaintOrEscalationDetected) blockers.push('يوجد شكوى/تصعيد يحتاج مراجعة الحل والمسؤولية');

  const avgCriterionConfidence = review.items.length
    ? review.items.reduce((sum, item) => sum + item.confidence, 0) / review.items.length
    : 0;
  const confidence = clamp(avgCriterionConfidence - (signals.mediaCount ? 8 : 0) - (hasDoctorAmbiguity ? 8 : 0));

  let readiness: ReviewReadiness = 'quick_human_review';
  if (review.assessedCount < 3 || confidence < 45) readiness = 'insufficient_evidence';
  else if (blockers.length || review.reviewRequiredCount > 6) readiness = 'detailed_human_review';

  const readinessLabel = readiness === 'quick_human_review'
    ? 'جاهز للمراجعة السريعة'
    : readiness === 'detailed_human_review'
      ? 'يحتاج مراجعة تفصيلية'
      : 'الأدلة غير كافية';

  const readinessReason = readiness === 'quick_human_review'
    ? 'البيانات النصية تسمح بمراجعة سريعة، لكن الاعتماد النهائي يظل بشريًا.'
    : readiness === 'detailed_human_review'
      ? blockers[0] || 'توجد بنود دلالية غير محسومة تحتاج مراجعة قبل الاعتماد.'
      : 'لا توجد أدلة كافية لإنتاج تقييم موثوق لهذه الجلسة.';

  const positives = decisionItems.filter((item) => item.kind === 'positive');
  const risks = decisionItems.filter((item) => item.kind === 'risk' || item.kind === 'attention');
  const opportunities = decisionItems.filter((item) => item.kind === 'opportunity');

  const executiveSummaryParts = [
    review.provisionalScore != null ? `الدرجة المبدئية للبنود المحسومة ${review.provisionalScore}/100*` : 'لا توجد درجة مبدئية كافية',
    `تغطية آلية ${review.coveragePercent}%`,
    signals.firstResponseSeconds != null ? `أول رد ${signals.firstResponseSeconds} ثانية` : 'أول رد غير محسوم',
    signals.complaintOrEscalationDetected ? 'يوجد شكوى/تصعيد محتمل' : 'لا توجد شكوى واضحة نصيًا',
    signals.saleIntentDetected ? 'توجد نية بيع' : 'لا توجد نية بيع مؤكدة',
    readinessLabel,
  ];

  return {
    readiness,
    readinessLabel,
    readinessReason,
    confidence,
    resolvedCriteria: review.assessedCount,
    unresolvedCriteria: review.reviewRequiredCount,
    blockers,
    doctorSegments: segments,
    hasDoctorAmbiguity,
    decisionItems,
    positives,
    risks,
    opportunities,
    executiveSummary: executiveSummaryParts.join(' • '),
  };
}
