import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import { deriveCanonicalComplaintAssessment } from './complaintAssessmentEngine';
import type { CaseIntelligenceView } from './types';

type RecoveryCriterionKey = 'angry_customer' | 'order_delay_handling';

export interface RecoveryCriterionAssessment {
  key: RecoveryCriterionKey;
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
}

export interface ConversationEvaluationServiceRecovery {
  version: 'conversation-evaluation-service-recovery-v1';
  caseId: string;
  items: RecoveryCriterionAssessment[];
}

const criteria = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

const APOLOGY_RX = /(?:متاسف|متأسف|آسف|اسف|بنعتذر|نعتذر|حقك\s*علينا|معلش)/i;
const ORDER_CONTEXT_RX = /(?:اوردر|أوردر|الاوردر|الأوردر|طلب|المندوب|توصيل|دليفري)/i;
const DELAY_RX = /(?:اتأخر|اتاخر|متأخر|متاخر|تأخير|تاخير|لسه|فين|مجاش|ماجاش|موصلش|ماوصلش|هييجي\s*امتى|هيوصل\s*امتى)/i;
const STAFF_DELAY_NOTICE_RX =
  /(?:(?:الطلب|الاوردر|الأوردر|المندوب|التوصيل)[^\n]{0,40}(?:ه?يتأخر|متأخر|في\s*تأخير|فيه\s*تأخير)|(?:في|فيه)\s*تأخير[^\n]{0,30}(?:الطلب|الاوردر|المندوب|التوصيل))/i;
const ETA_RX =
  /(?:خلال\s*\d+\s*(?:دقيقه|دقيقة|دقائق|ساعه|ساعة|ساعات)|نص\s*ساعه|نصف\s*ساعه|هيوصل\s*(?:خلال|في)|هيكون\s*عند\s*حضرتك|موعد\s*جديد)/i;
const DELIVERY_PROGRESS_RX =
  /(?:خرج\s*(?:مع|ل)\s*المندوب|في\s*الطريق|جاري\s*الارسال|جاري\s*الإرسال|تم\s*الارسال|تم\s*الإرسال)/i;
const DELIVERY_CLOSURE_RX =
  /(?:تم\s*التسليم|اتسلم|استلم(?:ت|نا)?|وصل(?:ت)?\s*(?:تمام|الحمد|شكرا|شكرًا)|المشكله\s*اتحلت|المشكلة\s*اتحلت|تم\s*الحل)/i;
const CANCEL_RX =
  /(?:الغ(?:ي|ى)\s*(?:الطلب|الاوردر)|مش\s*عايزه|مش\s*عايز|خلاص\s*مش\s*محتاج|هجيب\s*من\s*مكان\s*تاني)/i;

function make(
  key: RecoveryCriterionKey,
  option: string | null,
  status: RecoveryCriterionAssessment['status'],
  confidence: number,
  reason: string,
  evidenceMessageIds: string[]
): RecoveryCriterionAssessment {
  const criterion = criteria.get(key);
  if (!criterion) throw new Error(`Missing criterion ${key}`);
  const choice = option ? criterion.choices.find((item) => item.value === option) ?? null : null;
  return {
    key,
    label: criterion.label,
    status,
    selectedOption: option,
    selectedLabel:
      status === 'not_applicable'
        ? 'غير منطبق على المحادثة'
        : status === 'insufficient_evidence'
          ? 'الدليل غير كافٍ للحكم'
          : choice?.label || 'تم التقييم',
    pointsEarned: status === 'assessed' ? choice?.pointsEarned ?? null : null,
    maxPoints: criterion.maxPoints,
    confidence,
    reason,
    evidenceMessageIds: Array.from(new Set(evidenceMessageIds.filter(Boolean))),
  };
}

function ordered(view: CaseIntelligenceView) {
  return view.interaction.messages
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function assessComplaint(view: CaseIntelligenceView): RecoveryCriterionAssessment {
  const complaint = deriveCanonicalComplaintAssessment({
    caseId: view.caseId,
    messages: ordered(view).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      meaningful: message.meaningful,
    })),
  });

  if (complaint.state === 'none') {
    return make(
      'angry_customer',
      null,
      'not_applicable',
      100,
      'العقل الكانونيكال لم يثبت وجود شكوى/غضب صريح في هذا التفاعل.',
      []
    );
  }

  if (complaint.hostileResponseMessageIds.length > 0) {
    return make(
      'angry_customer',
      'inappropriate',
      'assessed',
      99,
      'العقل الكانونيكال أثبت ردًا غير لائق بعد شكوى العميل.',
      complaint.evidenceMessageIds
    );
  }

  if (complaint.state === 'unresolved' && complaint.staffResponseMessageIds.length === 0) {
    return make(
      'angry_customer',
      'ignored',
      'assessed',
      98,
      'العقل الكانونيكال أثبت شكوى ولم يثبت أي رد موظف لاحق داخل نفس التفاعل.',
      complaint.complaintMessageIds
    );
  }

  const hasApology = complaint.apologyMessageIds.length > 0;
  const hasRemedy = complaint.remedyAttemptMessageIds.length > 0;

  if (complaint.state === 'resolved' && hasApology && hasRemedy) {
    return make(
      'angry_customer',
      'solved',
      'assessed',
      96,
      'العقل الكانونيكال أثبت اعتذارًا وإجراءً ثم إغلاقًا صريحًا للمشكلة.',
      complaint.evidenceMessageIds
    );
  }

  if (complaint.state === 'recovery_attempted' && hasApology && hasRemedy) {
    return make(
      'angry_customer',
      'good',
      'assessed',
      92,
      'العقل الكانونيكال أثبت احتواء الشكوى باعتذار وإجراء واضح، لكن لم يثبت إغلاقها نهائيًا.',
      complaint.evidenceMessageIds
    );
  }

  if (complaint.state === 'resolved') {
    return make(
      'angry_customer',
      'medium',
      'assessed',
      86,
      'العقل الكانونيكال أثبت إغلاق المشكلة، لكن عناصر الاعتذار/الإجراء قبل الإغلاق غير مكتملة في الدليل.',
      complaint.evidenceMessageIds
    );
  }

  if (complaint.state === 'recovery_attempted' || hasApology || hasRemedy) {
    return make(
      'angry_customer',
      'medium',
      'assessed',
      84,
      'العقل الكانونيكال أثبت محاولة تعافٍ جزئية، لكن الاحتواء أو الإغلاق غير مكتمل.',
      complaint.evidenceMessageIds
    );
  }

  return make(
    'angry_customer',
    'medium',
    'assessed',
    76,
    'العقل الكانونيكال أثبت وجود الشكوى وردًا عليها، لكن لم يثبت اعتذارًا أو إجراء تعافٍ واضحًا.',
    complaint.evidenceMessageIds
  );
}

function assessDelay(view: CaseIntelligenceView): RecoveryCriterionAssessment {
  const messages = ordered(view);
  const customerDelayIndex = messages.findIndex(
    (message) =>
      message.role === 'customer' &&
      message.meaningful &&
      ORDER_CONTEXT_RX.test(message.text) &&
      DELAY_RX.test(message.text)
  );

  const proactiveNoticeIndex = messages.findIndex(
    (message) =>
      message.role === 'staff' && message.meaningful && STAFF_DELAY_NOTICE_RX.test(message.text)
  );

  if (customerDelayIndex < 0 && proactiveNoticeIndex < 0) {
    return make(
      'order_delay_handling',
      null,
      'not_applicable',
      100,
      'لا يوجد تأخير أوردر/توصيل مثبت نصيًا داخل هذا التفاعل.',
      []
    );
  }

  const anchorIndex = customerDelayIndex >= 0 ? customerDelayIndex : proactiveNoticeIndex;
  const anchor = messages[anchorIndex];
  const laterMessages = messages.slice(anchorIndex + 1).filter((message) => message.meaningful);
  const laterStaff = laterMessages.filter((message) => message.role === 'staff');
  const apology =
    anchor.role === 'staff' && APOLOGY_RX.test(anchor.text)
      ? anchor
      : laterStaff.find((message) => APOLOGY_RX.test(message.text)) || null;
  const eta =
    anchor.role === 'staff' && ETA_RX.test(anchor.text)
      ? anchor
      : laterStaff.find((message) => ETA_RX.test(message.text)) || null;
  const progress = laterStaff.find((message) => DELIVERY_PROGRESS_RX.test(message.text)) || null;
  const closure =
    laterMessages.find(
      (message) =>
        (message.role === 'customer' || message.role === 'staff') &&
        DELIVERY_CLOSURE_RX.test(message.text)
    ) || null;

  const cancelled = messages
    .slice(anchorIndex + 1)
    .find(
      (message) =>
        message.role === 'customer' && message.meaningful && CANCEL_RX.test(message.text)
    );

  if (cancelled && view.lostOpportunity.reason === 'delivery_issue') {
    return make(
      'order_delay_handling',
      'lost_customer',
      'assessed',
      98,
      'العميل ألغى/ترك الطلب بعد سياق تأخير توصيل، وLost Opportunity ربط الخسارة بمشكلة الدليفري. التقييم هنا لطريقة المتابعة لا لسبب التأخير نفسه.',
      [anchor.id, cancelled.id, ...view.lostOpportunity.evidenceMessageIds]
    );
  }

  if (proactiveNoticeIndex >= 0 && apology && eta && closure) {
    return make(
      'order_delay_handling',
      view.lostOpportunity.responsibility === 'delivery' ||
        view.lostOpportunity.responsibility === 'inventory'
        ? 'outside_reason_handled'
        : 'handled_full',
      'assessed',
      97,
      'تم إبلاغ العميل بالتأخير والاعتذار وإعطاء توقيت جديد، ثم ظهر دليل إغلاق صريح. لا يتم تحميل الموظف سببًا تشغيليًا خارج إرادته.',
      [messages[proactiveNoticeIndex].id, apology.id, eta.id, closure.id]
    );
  }

  if ((proactiveNoticeIndex >= 0 || laterStaff.length > 0) && eta) {
    return make(
      'order_delay_handling',
      'informed_only',
      'assessed',
      90,
      progress
        ? 'تم إبلاغ العميل/الرد عليه بوقت جديد وظهرت متابعة تشغيلية، لكن لا يوجد دليل إغلاق صريح؛ حالة «في الطريق» لا تُعامل كتسليم مكتمل.'
        : 'تم إبلاغ العميل/الرد عليه مع وقت أو توقع جديد، لكن لا يوجد دليل إغلاق صريح.',
      [anchor.id, eta.id, ...(apology ? [apology.id] : []), ...(progress ? [progress.id] : [])]
    );
  }

  if (customerDelayIndex >= 0 && apology) {
    return make(
      'order_delay_handling',
      'late_apology',
      'assessed',
      92,
      'الاعتذار ظهر بعد أن سأل العميل أو اشتكى من التأخير، بدون وقت جديد/متابعة كاملة مثبتة.',
      [anchor.id, apology.id]
    );
  }

  if (customerDelayIndex >= 0 && !laterStaff.length) {
    return make(
      'order_delay_handling',
      'not_informed',
      'assessed',
      99,
      'العميل سأل/اشتكى من تأخير الأوردر ولم يظهر رد لاحق يبلغه بالحالة أو وقت جديد.',
      [anchor.id]
    );
  }

  return make(
    'order_delay_handling',
    'informed_only',
    'assessed',
    78,
    'يوجد تعامل مع التأخير لكنه غير مكتمل بما يكفي لإثبات متابعة كاملة.',
    [anchor.id, ...laterStaff.slice(0, 2).map((message) => message.id)]
  );
}

export function analyzeConversationEvaluationServiceRecovery(
  view: CaseIntelligenceView
): ConversationEvaluationServiceRecovery {
  return {
    version: 'conversation-evaluation-service-recovery-v1',
    caseId: view.caseId,
    items: [assessComplaint(view), assessDelay(view)],
  };
}
