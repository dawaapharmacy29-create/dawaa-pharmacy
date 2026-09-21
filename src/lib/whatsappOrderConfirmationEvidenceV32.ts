// V32 Phase C.3 — Order Confirmation criterion, evidence-contract implementation.
// Context-aware checklist: an item's status can be 'proven' from trusted order/invoice
// context even when it is absent from the chat text (e.g. an address already on file) —
// that must never count as 'missing'. Reuses the exact point values already live in
// REVIEW_CRITERIA['order_confirmation'].
import {
  computeConfidenceV32,
  messagesInScopeV32,
  notApplicableResultV32,
  type CriterionEvaluationInputV32,
  type CriterionEvidenceContractV32,
  type CriterionEvidenceResultV32,
  type CriterionFindingV32,
  type EvidenceSource,
  type EvidenceStatus,
} from './whatsappCriterionEvidenceV32';
import type { NormalizedConversationMessageV32 } from './whatsappConversationUnderstandingV32';

const VERSION = 'order-confirmation-evidence-v32';
const MAX_POINTS = 10;

const BAND_POINTS: Record<string, number> = {
  full: 10,
  minor_missing: 7,
  many_missing: 4,
  important_missing: 0,
};

const ORDER_CONFIRMED_RX = /تم\s*تسجيل|تأكيد\s*الطلب|الأورد?ر|تم\s*الطلب|هيتم\s*تجهيز|تسجيل\s*طلبك/i;
const DELIVERY_RX = /توصيل|دليفري|delivery/i;
const QUANTITY_RX = /(\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*(علبة|علب|حبة|حبوب|شريط|عبوة|قطعة|كيس)/i;
const PHONE_RX = /01[0-2,5]\d{8}/;
const ADDRESS_RX = /العنوان\s*[:\-]?\s*\S+|عنوانك|هيوصل\s*ل(?:ـ|حضرتك)/i;
const PRICE_RX = /(\d+(?:\.\d+)?)\s*(جنيه|جنيها|ج\.?م\.?|le|egp)/i;
const DELIVERY_FEE_RX = /(?:مصاريف|رسوم)\s*(?:التوصيل|الشحن)|توصيل\s*(?:ب|مقابل)\s*\d+/i;
const PAYMENT_RX = /كاش|نقد[اً]?|فيزا|فوري|عند\s*الاستلام|دفع\s*اونلاين|instapay|فودافون\s*كاش/i;
const TIMING_RX = /خلال\s*(?:ساعة|ساعتين|\d+\s*(?:ساعة|ساعات|دقيق[ةه]))|هيوصل\s*(?:النهارد[ةه]|بكر[ةه]|اليوم)|من\s*\d+.*ل?ي?\s*\d+/i;

interface ChecklistItem {
  key: string;
  requiredWhenApplicable: 'always' | 'delivery_only';
  chatPattern: RegExp;
  orderField: keyof NonNullable<CriterionEvaluationInputV32['order']>;
}

const CHECKLIST: ChecklistItem[] = [
  { key: 'item', requiredWhenApplicable: 'always', chatPattern: ORDER_CONFIRMED_RX, orderField: 'item' },
  { key: 'quantity', requiredWhenApplicable: 'always', chatPattern: QUANTITY_RX, orderField: 'quantity' },
  { key: 'phone', requiredWhenApplicable: 'always', chatPattern: PHONE_RX, orderField: 'phone' },
  { key: 'address', requiredWhenApplicable: 'delivery_only', chatPattern: ADDRESS_RX, orderField: 'address' },
  { key: 'area', requiredWhenApplicable: 'delivery_only', chatPattern: ADDRESS_RX, orderField: 'area' },
  { key: 'price', requiredWhenApplicable: 'always', chatPattern: PRICE_RX, orderField: 'price' },
  { key: 'deliveryFee', requiredWhenApplicable: 'delivery_only', chatPattern: DELIVERY_FEE_RX, orderField: 'deliveryFee' },
  { key: 'paymentMethod', requiredWhenApplicable: 'always', chatPattern: PAYMENT_RX, orderField: 'paymentMethod' },
  { key: 'deliveryTiming', requiredWhenApplicable: 'delivery_only', chatPattern: TIMING_RX, orderField: 'deliveryTiming' },
];

const CRITICAL_KEYS = new Set(['item', 'quantity', 'phone']);

function findEvidenceMessage(messages: NormalizedConversationMessageV32[], pattern: RegExp) {
  return messages.find((m) => m.role === 'staff' && m.isMeaningful && pattern.test(m.text));
}

// Only fields with a cleanly comparable value are checked for order-vs-chat contradictions —
// fuzzy fields (item/address/area) are intentionally left out rather than risking a false contradiction.
const COMPARABLE_EXTRACTORS: Partial<Record<string, (text: string) => string | null>> = {
  phone: (text) => text.match(PHONE_RX)?.[0] || null,
  price: (text) => text.match(PRICE_RX)?.[1] || null,
};

function findConflictingMessage(
  messages: NormalizedConversationMessageV32[],
  key: string,
  orderValue: unknown
) {
  const extractor = COMPARABLE_EXTRACTORS[key];
  if (!extractor) return null;
  return (
    messages.find((m) => {
      if (m.role !== 'staff' || !m.isMeaningful) return false;
      const extracted = extractor(m.text);
      return extracted != null && extracted.replace(/\s/g, '') !== String(orderValue).replace(/\s/g, '');
    }) || null
  );
}

export function evaluateOrderConfirmationV32(input: CriterionEvaluationInputV32): CriterionEvidenceResultV32 {
  const scoped = messagesInScopeV32(input);
  const allText = scoped.map((m) => m.text).join('\n');
  const order = input.order || null;

  const orderConfirmedInChat = ORDER_CONFIRMED_RX.test(allText);
  if (!orderConfirmedInChat && !order) {
    return notApplicableResultV32(
      'order_confirmation',
      VERSION,
      MAX_POINTS,
      'لا يوجد دليل على وجود طلب/أوردر في نطاق هذا التفاعل.'
    );
  }

  const isDelivery = order?.deliveryMethod ? order.deliveryMethod === 'delivery' : DELIVERY_RX.test(allText);

  const findings: CriterionFindingV32[] = [];
  const positiveIds: string[] = [];
  const negativeIds: string[] = [];
  const contradictionIds: string[] = [];
  let missingRequiredCount = 0;
  let criticalMissing = false;

  CHECKLIST.forEach((item) => {
    const required = item.requiredWhenApplicable === 'always' || isDelivery;
    if (!required) {
      findings.push({
        key: item.key,
        status: 'not_applicable',
        fact: 'هذا البند غير مطلوب لأن الطلب استلام/ليس توصيل.',
        interpretation: null,
        source: 'conversation',
        evidenceMessageIds: [],
      });
      return;
    }

    const orderValue = order ? order[item.orderField] : null;
    if (orderValue != null && orderValue !== '') {
      const conflictingMessage = findConflictingMessage(scoped, item.key, orderValue);
      if (conflictingMessage) {
        findings.push({
          key: item.key,
          status: 'contradicted',
          fact: `بيانات الطلب تفيد أن ${item.key} = ${orderValue}، لكن رسالة الموظف في المحادثة تذكر قيمة مختلفة: "${conflictingMessage.text.slice(0, 80)}".`,
          interpretation: 'يوجد تعارض بين ما ذكره الموظف في المحادثة وبين بيانات الطلب الموثقة، ويحتاج مراجعة بشرية قبل الاعتماد.',
          source: 'order',
          evidenceMessageIds: [conflictingMessage.id],
        });
        contradictionIds.push(conflictingMessage.id);
        missingRequiredCount += 1;
        if (CRITICAL_KEYS.has(item.key)) criticalMissing = true;
        return;
      }
      findings.push({
        key: item.key,
        status: 'proven',
        fact: `القيمة متوفرة ومؤكدة من بيانات الطلب/الفاتورة: ${item.key} = ${orderValue}.`,
        interpretation: 'لا يُعتبر غيابه عن نص المحادثة نقصًا لأنه موثّق من مصدر خارجي موثوق.',
        source: 'order',
        evidenceMessageIds: [],
      });
      return;
    }

    const evidenceMessage = findEvidenceMessage(scoped, item.chatPattern);
    if (evidenceMessage) {
      findings.push({
        key: item.key,
        status: 'proven',
        fact: `تم العثور على تأكيد من الموظف لهذا البند: "${evidenceMessage.text.slice(0, 80)}".`,
        interpretation: null,
        source: 'conversation',
        evidenceMessageIds: [evidenceMessage.id],
      });
      positiveIds.push(evidenceMessage.id);
      return;
    }

    findings.push({
      key: item.key,
      status: 'missing',
      fact: `لم يُعثر على تأكيد لهذا البند لا في نص المحادثة ولا في بيانات الطلب.`,
      interpretation: null,
      source: 'conversation',
      evidenceMessageIds: [],
    });
    missingRequiredCount += 1;
    if (CRITICAL_KEYS.has(item.key)) criticalMissing = true;
  });

  let band: keyof typeof BAND_POINTS;
  if (criticalMissing) band = 'important_missing';
  else if (missingRequiredCount === 0) band = 'full';
  else if (missingRequiredCount === 1) band = 'minor_missing';
  else band = 'many_missing';

  const provenFromOrder = findings.filter((f) => f.source === 'order' && f.status === 'proven').length;
  const totalRequired = findings.filter((f) => f.status !== 'not_applicable').length || 1;
  const orderConfirmationConfidenceFactors = {
    evidenceCompleteness: 1 - missingRequiredCount / totalRequired,
    evidenceClarity: 0.85,
    contradictions: contradictionIds.length ? 0.4 : 1,
    sourceReliability: 0.6 + 0.4 * (provenFromOrder / totalRequired),
  };

  return {
    criterionKey: 'order_confirmation',
    version: VERSION,
    maxPoints: MAX_POINTS,
    applicable: true,
    applicabilityReason: 'توجد إشارة لطلب/أوردر في المحادثة أو في بيانات الطلب.',
    findings,
    positiveEvidenceMessageIds: positiveIds.filter(Boolean),
    negativeEvidenceMessageIds: negativeIds.filter(Boolean),
    contradictionMessageIds: contradictionIds,
    scoreBand: band,
    pointsEarned: BAND_POINTS[band],
    scoreReasoning: `${missingRequiredCount} بند/بنود مطلوبة ناقصة${criticalMissing ? ' (من ضمنها بند أساسي)' : ''} من إجمالي ${totalRequired} بند قابل للتطبيق => "${band}".`,
    confidence: computeConfidenceV32(orderConfirmationConfidenceFactors),
    confidenceFactors: orderConfirmationConfidenceFactors,
    needsHumanReview: contradictionIds.length > 0,
    humanReviewReasons: contradictionIds.length ? ['order_chat_value_conflict'] : [],
  };
}

export const OrderConfirmationEvidenceContractV32: CriterionEvidenceContractV32 = {
  criterionKey: 'order_confirmation',
  version: VERSION,
  maxPoints: MAX_POINTS,
  evaluate: evaluateOrderConfirmationV32,
};
