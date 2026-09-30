import {
  REVIEW_CRITERIA,
  type ReviewCriterionKey,
} from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import { buildConversationEvaluationEvidence } from './conversationEvaluationEvidence';

export type FoundationCriterionKey =
  | 'first_response_speed'
  | 'greeting'
  | 'doctor_name'
  | 'customer_name';

export type ConversationCriterionAssessmentStatus =
  | 'assessed'
  | 'not_applicable'
  | 'insufficient_evidence';

export interface ConversationCriterionAssessment {
  key: FoundationCriterionKey;
  label: string;
  status: ConversationCriterionAssessmentStatus;
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  measuredValue?: number | string | null;
}

export interface ConversationEvaluationFoundation {
  version: 'conversation-evaluation-foundation-v1';
  caseId: string;
  items: ConversationCriterionAssessment[];
}

const criterionMap = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

const GREETING_RX =
  /(?:وعليكم\s*السلام|السلام\s*عليكم|أهل[ًاا]?|اهل[ًاا]?|أهلا|اهلا|صباح\s*(?:الخير|النور)|مساء\s*(?:الخير|النور)|نورت(?:نا)?)/i;
const BRAND_RX = /صيدليات?\s*دواء/i;
const STAFF_INTRO_RX =
  /(?:مع\s*حضرتك|معاك|معاكي|معاكم)\s+(?:د(?:كتور(?:ة)?)?\.?\s*)?([^\n،,!.]{2,40})/i;
const OFFER_HELP_RX =
  /(?:تحت\s*(?:أمر|امر)|أقدر\s*أساعد|اقدر\s*اساعد|نقدر\s*نساعد|تؤمر|تؤمري|خدمة\s*التوصيل\s*(?:متاحة|متوفر))/i;
const RESPECTFUL_ADDRESS_RX =
  /(?:حضرتك|يا\s*فندم|يا\s*افندم|تحت\s*(?:أمر|امر)(?:\s*حضرتك)?|نورتنا)/i;

const CUSTOMER_HONORIFICS = new Set([
  'الحاج',
  'الحاجه',
  'الحاجة',
  'حاج',
  'حاجة',
  'السيد',
  'السيده',
  'السيدة',
  'استاذ',
  'استاذه',
  'الأستاذ',
  'الأستاذه',
  'الاستاذ',
  'الاستاذه',
  'دكتور',
  'دكتوره',
  'الدكتور',
  'الدكتوره',
]);

function normalizedArabic(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function customerNameTokens(value: string | null | undefined): string[] {
  return normalizedArabic(value || '')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !CUSTOMER_HONORIFICS.has(token));
}

function officialChoice(
  key: FoundationCriterionKey,
  option: string | null,
  status: ConversationCriterionAssessmentStatus,
  confidence: number,
  reason: string,
  evidenceMessageIds: string[],
  measuredValue?: number | string | null
): ConversationCriterionAssessment {
  const criterion = criterionMap.get(key);
  if (!criterion) throw new Error(`Unknown review criterion: ${key}`);
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
    measuredValue,
  };
}

function orderedMessages(view: CaseIntelligenceView) {
  return view.interaction.messages
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function firstCustomerAndReply(view: CaseIntelligenceView) {
  const messages = orderedMessages(view);
  const firstCustomerIndex = messages.findIndex((m) => m.role === 'customer' && m.meaningful);
  if (firstCustomerIndex < 0) {
    return { messages, firstCustomer: null, firstStaff: null, firstStaffIndex: -1, openingStaff: [] as typeof messages };
  }
  const firstCustomer = messages[firstCustomerIndex];
  const firstStaffIndex = messages.findIndex(
    (m, index) => index > firstCustomerIndex && m.role === 'staff' && m.meaningful
  );
  const firstStaff = firstStaffIndex >= 0 ? messages[firstStaffIndex] : null;
  if (!firstStaff) {
    return { messages, firstCustomer, firstStaff: null, firstStaffIndex: -1, openingStaff: [] as typeof messages };
  }

  const firstStaffAt = new Date(firstStaff.at).getTime();
  const openingStaff: typeof messages = [];
  for (let i = firstStaffIndex; i < messages.length; i += 1) {
    const message = messages[i];
    if (i > firstStaffIndex && message.role === 'customer' && message.meaningful) break;
    if (message.role !== 'staff' || !message.meaningful) continue;
    const at = new Date(message.at).getTime();
    if (Number.isFinite(at) && Number.isFinite(firstStaffAt) && at - firstStaffAt > 3 * 60 * 1000) break;
    openingStaff.push(message);
    if (openingStaff.length >= 4) break;
  }
  return { messages, firstCustomer, firstStaff, firstStaffIndex, openingStaff };
}

function responseOption(seconds: number): string {
  if (seconds <= 5 * 60) return 'within_5';
  if (seconds <= 10 * 60) return 'five_to_10';
  if (seconds <= 20 * 60) return 'ten_to_20';
  if (seconds <= 30 * 60) return 'over_20';
  return 'over_30';
}

function assessFirstResponse(view: CaseIntelligenceView): ConversationCriterionAssessment {
  const { firstCustomer, firstStaff } = firstCustomerAndReply(view);
  if (!firstCustomer || !firstStaff) {
    return officialChoice(
      'first_response_speed',
      null,
      'insufficient_evidence',
      25,
      'لا يوجد زوج واضح عميل ← موظف داخل نفس التفاعل يسمح بحساب أول رد بدقة.',
      firstCustomer ? [firstCustomer.id] : []
    );
  }
  const customerAt = new Date(firstCustomer.at).getTime();
  const staffAt = new Date(firstStaff.at).getTime();
  const seconds = Math.max(0, Math.round((staffAt - customerAt) / 1000));
  if (!Number.isFinite(seconds)) {
    return officialChoice(
      'first_response_speed',
      null,
      'insufficient_evidence',
      20,
      'توقيت الرسائل غير صالح لحساب أول رد.',
      [firstCustomer.id, firstStaff.id]
    );
  }
  return officialChoice(
    'first_response_speed',
    responseOption(seconds),
    'assessed',
    100,
    `أول رد حقيقي من الصيدلية جاء بعد ${seconds} ثانية من أول رسالة عميل في نفس التفاعل.`,
    [firstCustomer.id, firstStaff.id],
    seconds
  );
}

function assessGreeting(view: CaseIntelligenceView): ConversationCriterionAssessment {
  const { firstCustomer, firstStaff, openingStaff } = firstCustomerAndReply(view);
  if (!firstStaff) {
    return officialChoice(
      'greeting',
      'none',
      'assessed',
      firstCustomer ? 95 : 50,
      firstCustomer
        ? 'لا يوجد رد من الصيدلية بعد بداية العميل داخل هذا التفاعل، وبالتالي لا يوجد ترحيب.'
        : 'لا يوجد افتتاح قابل للتقييم في هذا التفاعل.',
      firstCustomer ? [firstCustomer.id] : []
    );
  }

  const openingText = openingStaff.map((m) => m.text).join('\n');
  const greeting = GREETING_RX.test(openingText);
  const brand = BRAND_RX.test(openingText);
  const intro = STAFF_INTRO_RX.test(openingText);
  const help = OFFER_HELP_RX.test(openingText);
  const evidenceIds = openingStaff.map((m) => m.id);

  if (greeting && brand && intro && help) {
    return officialChoice(
      'greeting',
      'official_full',
      'assessed',
      98,
      'الافتتاح جمع التحية واسم صيدليات دواء وتعريف الموظف وعرض الخدمة/المساعدة.',
      evidenceIds
    );
  }
  if (greeting && intro) {
    return officialChoice(
      'greeting',
      'close_with_name',
      'assessed',
      95,
      'تم رصد ترحيب واضح وتعريف باسم الموظف، لكن عناصر الرسالة الرسمية الكاملة لم تجتمع كلها.',
      evidenceIds
    );
  }
  if (greeting) {
    return officialChoice(
      'greeting',
      'greeting_no_name',
      'assessed',
      94,
      'تم رصد ترحيب واضح في افتتاح رد الصيدلية دون تعريف واضح باسم الموظف في نفس الافتتاح.',
      evidenceIds
    );
  }
  return officialChoice(
    'greeting',
    'direct_reply',
    'assessed',
    92,
    'بدأ الموظف بالرد على الطلب مباشرة دون ترحيب واضح في افتتاح هذا التفاعل.',
    [firstStaff.id]
  );
}

function introducedStaffName(text: string): string | null {
  const match = text.match(STAFF_INTRO_RX);
  return match?.[1]?.trim().replace(/\s+/g, ' ') || null;
}

function assessDoctorName(view: CaseIntelligenceView): ConversationCriterionAssessment {
  const { messages, firstStaff, openingStaff } = firstCustomerAndReply(view);
  const staffMessages = messages.filter((m) => m.role === 'staff' && m.meaningful);
  const openingIds = new Set(openingStaff.map((m) => m.id));

  const intro = staffMessages
    .map((message) => ({ message, name: introducedStaffName(message.text) }))
    .find((row) => Boolean(row.name));

  if (intro) {
    const early = openingIds.has(intro.message.id);
    return officialChoice(
      'doctor_name',
      early ? 'start' : 'later',
      'assessed',
      98,
      early
        ? `عرّف الموظف نفسه في بداية المحادثة باسم "${intro.name}".`
        : `تم ذكر اسم الموظف لاحقًا باسم "${intro.name}".`,
      [intro.message.id],
      intro.name
    );
  }

  return officialChoice(
    'doctor_name',
    'none',
    'assessed',
    firstStaff ? 94 : 80,
    firstStaff
      ? 'لم يتم العثور على تعريف نصي واضح باسم الموظف داخل رسائل هذا التفاعل.'
      : 'لم يوجد رد موظف يمكن أن يتضمن تعريفًا بالاسم.',
    firstStaff ? [firstStaff.id] : []
  );
}

function assessCustomerName(view: CaseIntelligenceView): ConversationCriterionAssessment {
  const canonicalName =
    view.customer.identityStatus === 'resolved' ? String(view.customer.customerName || '').trim() : '';
  if (!canonicalName) {
    return officialChoice(
      'customer_name',
      null,
      'not_applicable',
      100,
      'اسم العميل غير متاح كهوية موثوقة؛ لا يجوز تقييم استخدام الاسم من Sender أو التخمين.',
      []
    );
  }

  const tokens = customerNameTokens(canonicalName);
  if (!tokens.length) {
    return officialChoice(
      'customer_name',
      null,
      'insufficient_evidence',
      40,
      'هوية العميل موجودة لكن الاسم لا يحتوي جزءًا مناسبًا يمكن البحث عنه بأمان داخل الردود.',
      []
    );
  }

  const staffMessages = orderedMessages(view).filter((m) => m.role === 'staff' && m.meaningful);
  const used = staffMessages.find((message) => {
    const normalized = normalizedArabic(message.text);
    const words = new Set(normalized.split(' ').filter(Boolean));
    return tokens.some((token) => words.has(token));
  });
  if (used) {
    return officialChoice(
      'customer_name',
      'used',
      'assessed',
      97,
      `تم استخدام جزء موثوق من اسم العميل "${canonicalName}" في رد الصيدلية.`,
      [used.id],
      canonicalName
    );
  }

  const respectful = staffMessages.find((message) => RESPECTFUL_ADDRESS_RX.test(message.text));
  if (respectful) {
    return officialChoice(
      'customer_name',
      'not_used_good',
      'assessed',
      88,
      'اسم العميل كان متاحًا ولم يُذكر نصيًا، لكن تم رصد مخاطبة شخصية محترمة مثل "حضرتك/يا فندم".',
      [respectful.id],
      canonicalName
    );
  }

  return officialChoice(
    'customer_name',
    null,
    'insufficient_evidence',
    55,
    'اسم العميل كان متاحًا ولم يُستخدم، لكن تحديد هل الأسلوب كان جافًا أم مهتمًا يعتمد على تحليل الأسلوب في المرحلة التالية؛ لا يوجد خصم تلقائي الآن.',
    staffMessages.slice(0, 2).map((m) => m.id),
    canonicalName
  );
}

export function analyzeConversationEvaluationFoundation(
  view: CaseIntelligenceView
): ConversationEvaluationFoundation {
  const evidence = buildConversationEvaluationEvidence(view);
  const readiness = new Map(evidence.criteria.map((item) => [item.key, item.readiness]));

  const items = [
    assessFirstResponse(view),
    assessGreeting(view),
    assessDoctorName(view),
    assessCustomerName(view),
  ].map((item) => {
    // The evidence contract is the gate. A criterion cannot silently bypass it.
    const gate = readiness.get(item.key as ReviewCriterionKey);
    if (gate === 'not_applicable') {
      return item.status === 'not_applicable'
        ? item
        : officialChoice(item.key, null, 'not_applicable', 100, 'البند غير منطبق وفق عقد الأدلة.', []);
    }
    if (gate === 'insufficient_evidence' && item.status === 'assessed') {
      return officialChoice(
        item.key,
        null,
        'insufficient_evidence',
        30,
        'عقد الأدلة لا يملك مصدرًا كافيًا للحكم على هذا البند.',
        item.evidenceMessageIds
      );
    }
    return item;
  });

  return {
    version: 'conversation-evaluation-foundation-v1',
    caseId: view.caseId,
    items,
  };
}
