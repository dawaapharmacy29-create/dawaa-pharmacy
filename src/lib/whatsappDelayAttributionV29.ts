import type { WhatsAppConversationSession } from './whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from './whatsappParticipantRoleResolverV15';
import type { ConversationTimingV28 } from './whatsappConversationTimingV28';

export type DelayCauseV29 =
  | 'response_delay'
  | 'pharmacy_fulfillment_delay'
  | 'delivery_delay'
  | 'handoff_delay'
  | 'customer_waiting_or_missing_info'
  | 'external_or_unknown';

export interface DelayAttributionV29 {
  version: 'whatsapp-delay-attribution-v29';
  detected: boolean;
  cause: DelayCauseV29;
  label: string;
  confidence: number;
  shouldPenalizeCurrentStaffAutomatically: false;
  caseResponsibility: 'staff_response' | 'pharmacy_operations' | 'delivery' | 'shared_handoff' | 'customer_or_unknown';
  problemAt: string | null;
  firstRecoveryAt: string | null;
  problemToRecoverySeconds: number | null;
  responsibleStaffId: string | null;
  responsibleStaffName: string | null;
  responsibleRole: string | null;
  evidenceMessageIds: string[];
  reasons: string[];
  trainingFocus: string | null;
}

const DELIVERY_RX = /(مندوب|دليفري|توصيل|الطيار|السواق|خرج|في الطريق|المندوب|الدليفري)/i;
const FULFILLMENT_RX = /(تجهيز|بيتجهز|بيجهز|تحضير|الفرع|المخزن|الصنف|الاوردر|الأوردر|الطلب)/i;
const HANDOFF_RX = /(هحول|هحوّل|حولت|بنتابع مع|الفريق المختص|الفرع المختص|الدكتور المسؤول|هبلغ)/i;
const CUSTOMER_INFO_RX = /(العنوان|رقم الهاتف|لوكيشن|موقع|بيانات حضرتك|تأكيد البيانات|تاكيد البيانات)/i;
const WAITING_RX = /(مستني|منتظر|لسه|ماوصلش|موصلش|متاخر|متأخر|تأخير|تاخير)/i;

function roleByMessage(model?: WhatsAppParticipantRoleModelV15 | null) {
  return new Map((model?.messages || []).map((row) => [row.messageId, row]));
}

export function buildDelayAttributionV29(
  session: WhatsAppConversationSession,
  timing: ConversationTimingV28,
  participantRoles?: WhatsAppParticipantRoleModelV15 | null,
): DelayAttributionV29 {
  const problemAt = timing.orderTimeline.delayOrProblemAt;
  if (!problemAt) {
    return {
      version: 'whatsapp-delay-attribution-v29',
      detected: false,
      cause: 'external_or_unknown',
      label: 'لا يوجد تأخير/مشكلة مرصودة',
      confidence: 90,
      shouldPenalizeCurrentStaffAutomatically: false,
      caseResponsibility: 'customer_or_unknown',
      problemAt: null,
      firstRecoveryAt: timing.orderTimeline.recoveryAt,
      problemToRecoverySeconds: timing.orderTimeline.problemToRecoverySeconds,
      responsibleStaffId: null,
      responsibleStaffName: null,
      responsibleRole: null,
      evidenceMessageIds: [],
      reasons: ['لم يرصد النظام رسالة واضحة تشير إلى تأخير أو مشكلة زمنية.'],
      trainingFocus: null,
    };
  }

  const problemTime = new Date(problemAt).getTime();
  const recoveryAt = timing.orderTimeline.recoveryAt;
  const recoveryTime = recoveryAt ? new Date(recoveryAt).getTime() : Number.POSITIVE_INFINITY;
  const windowMessages = session.messages.filter((m) => {
    const t = m.timestamp.getTime();
    return t >= problemTime - 30 * 60_000 && t <= recoveryTime + 30 * 60_000;
  });
  const text = windowMessages.map((m) => m.text).join(' ');
  const inbound = windowMessages.filter((m) => m.direction === 'inbound').map((m) => m.text).join(' ');
  const outbound = windowMessages.filter((m) => m.direction === 'outbound').map((m) => m.text).join(' ');

  const reasons: string[] = [];
  let cause: DelayCauseV29 = 'external_or_unknown';
  let caseResponsibility: DelayAttributionV29['caseResponsibility'] = 'customer_or_unknown';
  let confidence = 60;

  const maxResponse = timing.responseSummary.maxResponseSeconds || 0;
  const recoveryLatency = timing.orderTimeline.problemToRecoverySeconds;

  // كان بيشترط WAITING_RX عالعميل تحديدًا، فلو الموظف نفسه بادر واعتذر/فسّر السبب
  // التشغيلي (مندوب متأخر مثلاً) قبل ما العميل يشتكي أصلًا - وده أفضل سيناريو ممكن -
  // كان بيفشل في تصنيف السبب ويرجع "غير محسوم" رغم إن نص الموظف نفسه واضح فيه المندوب
  // والتأخير. النص الكامل (عميل أو موظف) كافي طالما فيه بالفعل "مشكلة/تأخير" مرصودة أصلًا.
  if (DELIVERY_RX.test(text) && WAITING_RX.test(text)) {
    cause = 'delivery_delay';
    caseResponsibility = 'delivery';
    confidence = 90;
    reasons.push('رسائل المشكلة مرتبطة بالتوصيل/المندوب مع انتظار واضح (من العميل أو من تفسير الموظف نفسه).');
  } else if (HANDOFF_RX.test(outbound) && timing.handoff.handoffCount > 0) {
    cause = 'handoff_delay';
    caseResponsibility = 'shared_handoff';
    confidence = 84;
    reasons.push('ظهر انتقال مسؤولية/متابعة بين أكثر من مسؤول أثناء نفس الرحلة.');
  } else if (CUSTOMER_INFO_RX.test(text) && /محتاج|مطلوب|ابعت|ابعتي|ابعث|تأكيد|تاكيد/i.test(outbound)) {
    cause = 'customer_waiting_or_missing_info';
    caseResponsibility = 'customer_or_unknown';
    confidence = 78;
    reasons.push('التنفيذ يبدو متوقفًا على بيانات/تأكيد من العميل، لذلك لا يُنسب التأخير تلقائيًا للموظف.');
  } else if (maxResponse >= 10 * 60 && (!recoveryLatency || recoveryLatency >= 10 * 60)) {
    cause = 'response_delay';
    caseResponsibility = 'staff_response';
    confidence = 82;
    reasons.push(`يوجد Turn عميل انتظر ردًا طويلًا (حتى ${Math.round(maxResponse / 60)} دقيقة).`);
  } else if (FULFILLMENT_RX.test(text) && WAITING_RX.test(text)) {
    cause = 'pharmacy_fulfillment_delay';
    caseResponsibility = 'pharmacy_operations';
    confidence = 78;
    reasons.push('النص يشير لتأخير في تجهيز/تنفيذ الطلب أكثر من كونه تأخير رد (من العميل أو من تفسير الموظف نفسه).');
  } else {
    reasons.push('يوجد تأخير مرصود لكن الدليل النصي لا يكفي لتحديد السبب التشغيلي بثقة عالية.');
  }

  const roles = roleByMessage(participantRoles);
  const recoveryMessage = recoveryAt
    ? session.messages.find((m) => m.direction === 'outbound' && m.timestamp.getTime() >= new Date(recoveryAt).getTime())
    : null;
  const role = recoveryMessage ? roles.get(recoveryMessage.id) : null;

  if (recoveryLatency != null) {
    reasons.push(`أول استجابة لمعالجة المشكلة جاءت بعد ${Math.max(0, Math.round(recoveryLatency / 60))} دقيقة.`);
  }

  const evidenceMessageIds = windowMessages
    .filter((m) => WAITING_RX.test(m.text) || DELIVERY_RX.test(m.text) || HANDOFF_RX.test(m.text) || CUSTOMER_INFO_RX.test(m.text))
    .map((m) => m.id)
    .slice(0, 12);

  const labels: Record<DelayCauseV29,string> = {
    response_delay: 'تأخير في الرد على العميل',
    pharmacy_fulfillment_delay: 'تأخير تجهيز/تنفيذ داخل الصيدلية',
    delivery_delay: 'تأخير توصيل/مندوب',
    handoff_delay: 'تأخير مرتبط بتسليم المسؤولية',
    customer_waiting_or_missing_info: 'التنفيذ متوقف على بيانات/تأكيد من العميل',
    external_or_unknown: 'سبب التأخير غير محسوم',
  };

  const trainingFocus =
    cause === 'response_delay' ? 'تقليل زمن الاستجابة وتوضيح ملكية المحادثة.'
    : cause === 'handoff_delay' ? 'تسليم واضح بين المسؤولين مع تأكيد الاستلام والمتابعة.'
    : cause === 'pharmacy_fulfillment_delay' ? 'تحسين متابعة تجهيز الأوردر وإبلاغ العميل بتحديثات زمنية.'
    : cause === 'delivery_delay' ? 'متابعة المندوب استباقيًا وتحديث العميل قبل أن يضطر للسؤال.'
    : null;

  return {
    version: 'whatsapp-delay-attribution-v29',
    detected: true,
    cause,
    label: labels[cause],
    confidence,
    shouldPenalizeCurrentStaffAutomatically: false,
    caseResponsibility,
    problemAt,
    firstRecoveryAt: recoveryAt,
    problemToRecoverySeconds: recoveryLatency,
    responsibleStaffId: role?.staffId || null,
    responsibleStaffName: role?.staffName || recoveryMessage?.sender || null,
    responsibleRole: role?.role || null,
    evidenceMessageIds,
    reasons,
    trainingFocus,
  };
}
