// V32 Phase C.3 / C.2 — Order Confirmation criterion, evidence-contract implementation.
// Context-aware checklist: an item's status can be 'proven' from trusted order/invoice
// context even when it is absent from the chat text (e.g. an address already on file) —
// that must never count as 'missing'. Reuses the exact point values already live in
// REVIEW_CRITERIA['order_confirmation'].
//
// V32.2 change (real-conversation gap found while validating the Ibrahim Al-Sayyad case):
// V32.1 only recognized an explicit phrase like "تم تسجيل الطلب" as evidence of confirmation.
// Real staff replies are overwhelmingly colloquial ("من عنيا لحضرتك", "حاضر هبعته لحضرتك") — V32.1
// treated those conversations as not_applicable instead of evaluating them. V32.2 uses the
// shared confirmationStrength signal (explicit/strong_implicit/weak_implicit/none) and,
// critically, only counts an implicit phrase when it is CONTEXTUALLY LINKED to a prior customer
// request/quantity — see whatsappSemanticSignalsV32.ts's isConfirmationContextuallyLinked. The
// same phrase answering a price question is never counted as an order confirmation.
//
// It also distinguishes a customer stating a value (status 'partially_proven', provenance
// 'customer_statement') from the staff actually confirming it back (status 'proven', provenance
// 'staff_confirmation'/'mutual_confirmation') — REVIEW_CRITERIA['order_confirmation'] is titled
// "تأكيد بيانات الطلب" (the staff confirming), so an unconfirmed customer-only statement still
// counts toward the missing-items score exactly as it did in V32.1 (no business-rule change),
// but the evidence now shows a human reviewer WHY it wasn't counted.
import {
  computeConfidenceV32,
  messagesInScopeV32,
  notApplicableResultV32,
  type CriterionEvaluationInputV32,
  type CriterionEvidenceContractV32,
  type CriterionEvidenceResultV32,
  type CriterionFindingV32,
  type EvidenceProvenance,
} from './whatsappCriterionEvidenceV32';
import {
  extractAddressSignals,
  extractConfirmationSignals,
  extractDeliverySignals,
  extractPhoneSignals,
  extractPriceSignals,
  extractQuantitySignals,
  isSubstantiveConfirmationSignal,
  type ConversationSemanticSignalV32,
} from './whatsappSemanticSignalsV32';
import type { NormalizedConversationMessageV32 } from './whatsappConversationUnderstandingV32';

const VERSION = 'order-confirmation-evidence-v32.2';
const MAX_POINTS = 10;

const BAND_POINTS: Record<string, number> = {
  full: 10,
  minor_missing: 7,
  many_missing: 4,
  important_missing: 0,
};

// Fields not covered by the shared semantic signal layer (genuinely specific to this one
// checklist, not reused by any other criterion — kept local rather than over-abstracted).
const DELIVERY_FEE_RX = /(?:مصاريف|رسوم)\s*(?:التوصيل|الشحن)|توصيل\s*(?:ب|مقابل)\s*\d+/i;
const PAYMENT_RX = /كاش|نقد[اً]?|فيزا|فوري|عند\s*الاستلام|دفع\s*اونلاين|instapay|فودافون\s*كاش/i;
const TIMING_RX = /خلال\s*(?:ساعة|ساعتين|\d+\s*(?:ساعة|ساعات|دقيق[ةه]))|هيوصل\s*(?:النهارد[ةه]|بكر[ةه]|اليوم)|من\s*\d+.*ل?ي?\s*\d+/i;

const CRITICAL_KEYS = new Set(['item', 'quantity', 'phone']);

type OrderField = keyof NonNullable<CriterionEvaluationInputV32['order']>;

function byMessageId(messages: NormalizedConversationMessageV32[]) {
  return new Map(messages.map((m) => [m.id, m]));
}

function messageFor(signal: ConversationSemanticSignalV32, lookup: Map<string, NormalizedConversationMessageV32>) {
  return lookup.get(signal.messageId) || null;
}

function findLocalPatternMatch(messages: NormalizedConversationMessageV32[], pattern: RegExp, role: 'staff' | 'customer') {
  return messages.find((m) => m.role === role && m.isMeaningful && pattern.test(m.text)) || null;
}

interface ItemResolution {
  status: 'proven' | 'partially_proven' | 'missing' | 'contradicted';
  fact: string;
  interpretation: string | null;
  source: 'conversation' | 'order';
  provenance: EvidenceProvenance;
  evidenceMessageIds: string[];
  ruleId: string;
}

function resolveFromOrder(
  key: string,
  orderValue: unknown,
  conflictMessage: NormalizedConversationMessageV32 | null
): ItemResolution {
  if (conflictMessage) {
    return {
      status: 'contradicted',
      fact: `بيانات الطلب تفيد أن ${key} = ${orderValue}، لكن رسالة في المحادثة تذكر قيمة مختلفة: "${conflictMessage.text.slice(0, 80)}".`,
      interpretation: 'يوجد تعارض بين ما ذُكر في المحادثة وبين بيانات الطلب الموثقة، ويحتاج مراجعة بشرية قبل الاعتماد.',
      source: 'order',
      provenance: 'order_record',
      evidenceMessageIds: [conflictMessage.id],
      ruleId: `${key}.conflict.order_vs_conversation`,
    };
  }
  return {
    status: 'proven',
    fact: `القيمة متوفرة ومؤكدة من بيانات الطلب/الفاتورة: ${key} = ${orderValue}.`,
    interpretation: 'لا يُعتبر غيابه عن نص المحادثة نقصًا لأنه موثّق من مصدر خارجي موثوق.',
    source: 'order',
    provenance: 'order_record',
    evidenceMessageIds: [],
    ruleId: `${key}.proven.order_record`,
  };
}

export function evaluateOrderConfirmationV32(input: CriterionEvaluationInputV32): CriterionEvidenceResultV32 {
  const scoped = messagesInScopeV32(input);
  const order = input.order || null;
  const lookup = byMessageId(scoped);

  const confirmationSignals = extractConfirmationSignals(scoped);
  const substantiveConfirmations = confirmationSignals.filter(isSubstantiveConfirmationSignal);
  const applicable = substantiveConfirmations.length > 0 || Boolean(order);

  if (!applicable) {
    return notApplicableResultV32(
      'order_confirmation',
      VERSION,
      MAX_POINTS,
      'لا يوجد دليل على تأكيد طلب (صريح أو ضمني مرتبط بسياق) في نطاق هذا التفاعل، ولا بيانات طلب خارجية.'
    );
  }

  const deliverySignals = extractDeliverySignals(scoped);
  const isDelivery = order?.deliveryMethod ? order.deliveryMethod === 'delivery' : deliverySignals.length > 0;

  const phoneSignals = extractPhoneSignals(scoped);
  const priceSignals = extractPriceSignals(scoped);
  const quantitySignals = extractQuantitySignals(scoped);
  const addressSignals = extractAddressSignals(scoped);

  function resolveConfirmationBacked(
    key: string,
    valueSignals: ConversationSemanticSignalV32[],
    orderField: OrderField,
    conflictComparableRole: 'staff' | 'customer' | 'any' = 'any'
  ): ItemResolution {
    const orderValue = order ? order[orderField] : null;
    if (orderValue != null && orderValue !== '') {
      const conflicting = valueSignals
        .map((s) => ({ signal: s, message: messageFor(s, lookup) }))
        .find(
          ({ signal, message }) =>
            message &&
            (conflictComparableRole === 'any' || message.role === conflictComparableRole) &&
            signal.extractedValue != null &&
            String(signal.extractedValue).replace(/\s/g, '') !== String(orderValue).replace(/\s/g, '')
        );
      return resolveFromOrder(key, orderValue, conflicting ? conflicting.message : null);
    }

    const staffSignal = valueSignals.find((s) => messageFor(s, lookup)?.role === 'staff');
    if (staffSignal) {
      const message = messageFor(staffSignal, lookup)!;
      return {
        status: 'proven',
        fact: `تم العثور على تأكيد من الموظف لهذا البند: "${message.text.slice(0, 80)}".`,
        interpretation: null,
        source: 'conversation',
        provenance: 'staff_confirmation',
        evidenceMessageIds: [message.id],
        ruleId: `${key}.proven.staff_confirmation`,
      };
    }

    const customerSignal = valueSignals.find((s) => messageFor(s, lookup)?.role === 'customer');
    if (customerSignal) {
      const customerMessage = messageFor(customerSignal, lookup)!;
      // An implicit confirmation only counts here when the shared signal layer has specifically
      // linked it to THIS customer statement (context, not just timestamp order). An EXPLICIT
      // confirmation ("تم تسجيل الطلب") is a blanket acknowledgement of the whole order, so any
      // occurrence after the customer's statement counts — that is the one case timestamp order
      // alone is sufficient, matching "Context أهم من العبارة نفسها" for implicit phrases only.
      const linkedConfirmation = substantiveConfirmations.find(
        (c) =>
          c.relatedMessageIds?.includes(customerMessage.id) ||
          (c.extractedValue === 'explicit' && messageFor(c, lookup)!.timestamp.getTime() >= customerMessage.timestamp.getTime())
      );
      if (linkedConfirmation) {
        const confirmMessage = messageFor(linkedConfirmation, lookup)!;
        return {
          status: 'proven',
          fact: `العميل ذكر القيمة ("${customerMessage.text.slice(0, 60)}") وتبعها تأكيد من الموظف ("${confirmMessage.text.slice(0, 60)}").`,
          interpretation: null,
          source: 'conversation',
          provenance: 'mutual_confirmation',
          evidenceMessageIds: [customerMessage.id, confirmMessage.id],
          ruleId: `${key}.proven.mutual_confirmation`,
        };
      }
      return {
        status: 'partially_proven',
        fact: `العميل ذكر القيمة ("${customerMessage.text.slice(0, 60)}") لكن لا يوجد تأكيد صريح أو ضمني مرتبط من الموظف.`,
        interpretation: 'لا يُحسب كبند "مؤكّد" حسب المعنى الحالي للبند (تأكيد بيانات الطلب من الموظف)، رغم توفر القيمة من العميل.',
        source: 'conversation',
        provenance: 'customer_statement',
        evidenceMessageIds: [customerMessage.id],
        ruleId: `${key}.partially_proven.customer_statement_unconfirmed`,
      };
    }

    return {
      status: 'missing',
      fact: 'لم يُعثر على هذا البند لا في نص المحادثة ولا في بيانات الطلب.',
      interpretation: null,
      source: 'conversation',
      provenance: 'staff_confirmation',
      evidenceMessageIds: [],
      ruleId: `${key}.missing`,
    };
  }

  function resolveLocalPattern(key: string, pattern: RegExp, orderField: OrderField): ItemResolution {
    const orderValue = order ? order[orderField] : null;
    if (orderValue != null && orderValue !== '') return resolveFromOrder(key, orderValue, null);
    const staffMatch = findLocalPatternMatch(scoped, pattern, 'staff');
    if (staffMatch) {
      return {
        status: 'proven',
        fact: `تم العثور على تأكيد من الموظف لهذا البند: "${staffMatch.text.slice(0, 80)}".`,
        interpretation: null,
        source: 'conversation',
        provenance: 'staff_confirmation',
        evidenceMessageIds: [staffMatch.id],
        ruleId: `${key}.proven.staff_confirmation`,
      };
    }
    return {
      status: 'missing',
      fact: 'لم يُعثر على هذا البند لا في نص المحادثة ولا في بيانات الطلب.',
      interpretation: null,
      source: 'conversation',
      provenance: 'staff_confirmation',
      evidenceMessageIds: [],
      ruleId: `${key}.missing`,
    };
  }

  function resolveItem(): ItemResolution {
    if (order?.item) return resolveFromOrder('item', order.item, null);
    const backingSignal = substantiveConfirmations[0];
    if (backingSignal) {
      const message = messageFor(backingSignal, lookup)!;
      return {
        status: 'proven',
        fact: `يوجد تأكيد ${backingSignal.extractedValue === 'explicit' ? 'صريح' : 'ضمني مرتبط بسياق طلب العميل'} من الموظف: "${message.text.slice(0, 80)}".`,
        interpretation: null,
        source: 'conversation',
        provenance: backingSignal.extractedValue === 'explicit' ? 'staff_confirmation' : 'mutual_confirmation',
        evidenceMessageIds: [message.id, ...(backingSignal.relatedMessageIds || [])],
        ruleId: `item.proven.confirmation_signal.${backingSignal.extractedValue}`,
      };
    }
    return {
      status: 'missing',
      fact: 'لم يُعثر على تأكيد لوجود صنف في الطلب لا في المحادثة ولا في بيانات الطلب.',
      interpretation: null,
      source: 'conversation',
      provenance: 'staff_confirmation',
      evidenceMessageIds: [],
      ruleId: 'item.missing',
    };
  }

  const findings: CriterionFindingV32[] = [];
  const positiveIds: string[] = [];
  const contradictionIds: string[] = [];
  let missingRequiredCount = 0;
  let criticalMissing = false;

  const checklistKeys: Array<{ key: string; requiredWhenApplicable: 'always' | 'delivery_only'; resolve: () => ItemResolution }> = [
    { key: 'item', requiredWhenApplicable: 'always', resolve: resolveItem },
    { key: 'quantity', requiredWhenApplicable: 'always', resolve: () => resolveConfirmationBacked('quantity', quantitySignals, 'quantity') },
    { key: 'phone', requiredWhenApplicable: 'always', resolve: () => resolveConfirmationBacked('phone', phoneSignals, 'phone') },
    { key: 'address', requiredWhenApplicable: 'delivery_only', resolve: () => resolveConfirmationBacked('address', addressSignals, 'address') },
    { key: 'area', requiredWhenApplicable: 'delivery_only', resolve: () => resolveConfirmationBacked('area', addressSignals, 'area') },
    { key: 'price', requiredWhenApplicable: 'always', resolve: () => resolveConfirmationBacked('price', priceSignals, 'price') },
    { key: 'deliveryFee', requiredWhenApplicable: 'delivery_only', resolve: () => resolveLocalPattern('deliveryFee', DELIVERY_FEE_RX, 'deliveryFee') },
    { key: 'paymentMethod', requiredWhenApplicable: 'always', resolve: () => resolveLocalPattern('paymentMethod', PAYMENT_RX, 'paymentMethod') },
    { key: 'deliveryTiming', requiredWhenApplicable: 'delivery_only', resolve: () => resolveLocalPattern('deliveryTiming', TIMING_RX, 'deliveryTiming') },
  ];

  checklistKeys.forEach(({ key, requiredWhenApplicable, resolve }) => {
    const required = requiredWhenApplicable === 'always' || isDelivery;
    if (!required) {
      findings.push({
        key,
        status: 'not_applicable',
        fact: 'هذا البند غير مطلوب لأن الطلب استلام/ليس توصيل.',
        interpretation: null,
        source: 'conversation',
        evidenceMessageIds: [],
        ruleId: `${key}.not_applicable.pickup_order`,
      });
      return;
    }

    const resolution = resolve();
    findings.push({
      key,
      status: resolution.status,
      fact: resolution.fact,
      interpretation: resolution.interpretation,
      source: resolution.source,
      provenance: resolution.provenance,
      evidenceMessageIds: resolution.evidenceMessageIds,
      ruleId: resolution.ruleId,
    });

    if (resolution.status === 'proven') {
      positiveIds.push(...resolution.evidenceMessageIds);
      return;
    }
    if (resolution.status === 'contradicted') {
      contradictionIds.push(...resolution.evidenceMessageIds);
      missingRequiredCount += 1;
      if (CRITICAL_KEYS.has(key)) criticalMissing = true;
      return;
    }
    // 'missing' and 'partially_proven' both fail to satisfy "the staff confirmed this" —
    // same scoring treatment as V32.1, only the evidence explaining why differs.
    missingRequiredCount += 1;
    if (CRITICAL_KEYS.has(key)) criticalMissing = true;
  });

  let band: keyof typeof BAND_POINTS;
  if (criticalMissing) band = 'important_missing';
  else if (missingRequiredCount === 0) band = 'full';
  else if (missingRequiredCount === 1) band = 'minor_missing';
  else band = 'many_missing';

  const provenFromOrder = findings.filter((f) => f.source === 'order' && f.status === 'proven').length;
  const totalRequired = findings.filter((f) => f.status !== 'not_applicable').length || 1;
  const primaryMessageIds = Array.from(
    new Set(findings.flatMap((f) => (f.status === 'proven' || f.status === 'contradicted' ? f.evidenceMessageIds : [])))
  );
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
    applicabilityReason: 'توجد إشارة تأكيد (صريحة أو ضمنية مرتبطة بسياق) في المحادثة أو في بيانات الطلب.',
    findings,
    positiveEvidenceMessageIds: Array.from(new Set(positiveIds)),
    negativeEvidenceMessageIds: [],
    contradictionMessageIds: contradictionIds,
    primaryMessageIds,
    scoreBand: band,
    pointsEarned: BAND_POINTS[band],
    scoreReasoning: `${missingRequiredCount} بند/بنود مطلوبة غير مؤكدة بالكامل${criticalMissing ? ' (من ضمنها بند أساسي)' : ''} من إجمالي ${totalRequired} بند قابل للتطبيق => "${band}".`,
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
