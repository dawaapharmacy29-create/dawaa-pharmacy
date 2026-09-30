// Sales Intelligence — Customer Need Model.
//
// Pure semantic projection over the SAME V32 messages + CaseBasket history. It never reparses an
// invoice, never invents a product identity, and never decides Sale Proof. Product ids/quantities
// come from the canonical basket owner when available; message-level semantic signals only add
// roles/evidence that a final staff recap may have overwritten inside the basket snapshot.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import {
  availabilityStatementClausesV32,
  classifyCustomerOfferResponseV32,
  extractAcceptanceSignals,
  extractAlternativeOfferSignals,
  extractAvailabilitySignals,
  extractCorrectionSignals,
  extractProductReferenceSignals,
  extractQuantitySignals,
  extractRejectionSignals,
  extractRequestSignals,
  isRequestCandidate,
  resolveReference,
} from '../whatsappSemanticSignalsV32';
import { normalizeProductKey, stripRequestPrefix } from './caseBasketEngine';
import type {
  CaseBasket,
  CaseBasketItem,
  ConfidenceAssessment,
  ConfidenceLevel,
  CustomerNeedAlternative,
  CustomerNeedAlternativeResponse,
  CustomerNeedAvailability,
  CustomerNeedAvailabilityEvidence,
  CustomerNeedModel,
  CustomerNeedObjection,
  CustomerNeedObjectionCategory,
  CustomerNeedProductLifecycle,
  CustomerNeedProductRole,
  EvidenceRef,
} from './types';

export interface DeriveCustomerNeedModelInput {
  caseId: string;
  messages: NormalizedConversationMessageV32[];
  baskets: CaseBasket[];
  itemsByBasketId: Record<string, CaseBasketItem[]>;
  activeBasket: CaseBasket | null;
  /**
   * Canonical sender -> staff.id resolution supplied by the caller (staff identity owner). Used only
   * for the exact sender of each availability/alternative message; never a "first staff" fallback.
   */
  staffIdBySender?: Record<string, string>;
}

const PRICE_OBJECTION_RX = /غالي|السعر\s*(?:عالي|كتير|كبير)|كتير\s*(?:عليه|عليها)|مش\s*مناسب.*(?:السعر|الثمن)|خصم\s*اكتر/i;
const AVAILABILITY_OBJECTION_RX = /مش\s*(?:موجود|متوفر)|مفيش|خلص|مش\s*لاقي|مش\s*لاقية/i;
const DELIVERY_OBJECTION_RX = /التوصيل|الدليفري|المندوب|اتأخر|متأخر|مش\s*(?:هستنى|هقدر\s*استنى)/i;
const PRODUCT_FIT_OBJECTION_RX = /مش\s*مناسب|مش\s*ده|عايز\s*غير|عاوز\s*غير|بديل|حساسي[ةه]|مش\s*نفس/i;
const TIMING_OBJECTION_RX = /مش\s*دلوقتي|بعدين|بعد\s*كده|وقت\s*تاني|لما\s*احتاج/i;
const ALTERNATIVE_RX = /بديل|بدل(?:ه|ها|هم|\s)/i;

function evidenceRef(messageId: string, description: string): EvidenceRef {
  return {
    sourceTable: 'whatsapp_review_sources',
    sourceId: '',
    messageIds: [messageId],
    description,
  };
}

function assessment(
  level: ConfidenceLevel,
  score: number,
  ruleIds: string[],
  evidence: EvidenceRef[]
): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

function confidenceRank(level: ConfidenceLevel): number {
  switch (level) {
    case 'proven': return 4;
    case 'strongly_inferred': return 3;
    case 'weakly_inferred': return 2;
    case 'unknown': return 1;
  }
}

function strongestConfidence(
  current: ConfidenceAssessment | null,
  next: ConfidenceAssessment
): ConfidenceAssessment {
  if (!current) return next;
  if (confidenceRank(next.level) > confidenceRank(current.level)) return next;
  if (confidenceRank(next.level) < confidenceRank(current.level)) return current;
  return next.score > current.score ? next : current;
}

interface ProductAccumulator {
  key: string;
  productNameRaw: string;
  productId: string | null;
  requestedQuantity: number | null;
  offeredQuantity: number | null;
  finalQuantity: number | null;
  roles: Set<CustomerNeedProductRole>;
  evidenceMessageIds: Set<string>;
  confidence: ConfidenceAssessment | null;
  availabilityEvidence: CustomerNeedAvailabilityEvidence[];
  alternatives: CustomerNeedAlternative[];
}

// Words that turn a customer's stock question into a product phrase once removed
// ("عندكم بانادول اكسترا؟" -> "بانادول اكسترا"). A leftover that is only filler/negation is no product.
const STOCK_QUESTION_WORDS_RX =
  /(?<![\p{L}\p{N}])(?:هو|هي|هل|طيب|عندكم|عندكو|عندك|موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?|فيه|في|لو\s*سمحت|من\s*فضلك|ممكن|يا\s*(?:دكتور[ةه]?|فندم))(?![\p{L}\p{N}])/giu;
const NON_PRODUCT_LEFTOVER_RX = /^(?:مش|لا|لأ|اه|آه|تمام|حاجة|حاجه|ده|دي|دا|منه|منها)?$/;

function productPhraseFromStockQuestion(text: string): string | null {
  const phrase = stripRequestPrefix(text.replace(STOCK_QUESTION_WORDS_RX, ' '))
    .replace(/[؟?!.،]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (phrase.length < 3 || NON_PRODUCT_LEFTOVER_RX.test(phrase)) return null;
  return phrase;
}

function classifyObjectionCategory(
  text: string,
  explicitRejection: boolean,
  correction: boolean
): CustomerNeedObjectionCategory | null {
  if (PRICE_OBJECTION_RX.test(text)) return 'price';
  if (AVAILABILITY_OBJECTION_RX.test(text)) return 'availability';
  if (DELIVERY_OBJECTION_RX.test(text)) return 'delivery';
  if (PRODUCT_FIT_OBJECTION_RX.test(text)) return 'product_fit';
  if (TIMING_OBJECTION_RX.test(text)) return 'timing';
  if (explicitRejection) return 'customer_declined';
  if (correction) return 'unknown';
  return null;
}

function directRequestedProduct(
  message: NormalizedConversationMessageV32,
  quantityPhrase: string | null
): string | null {
  let text = message.text;
  if (quantityPhrase) text = text.replace(quantityPhrase, ' ');
  const stripped = stripRequestPrefix(text)
    .replace(/^(?:لو\s*سمحت|من\s*فضلك)\s*/i, '')
    .replace(/[؟?!.،]+$/g, '')
    .trim();
  return stripped.length >= 2 ? stripped : null;
}

export function deriveCustomerNeedModel(input: DeriveCustomerNeedModelInput): CustomerNeedModel {
  const messages = input.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const requestSignals = extractRequestSignals(messages);
  const rejectionSignals = extractRejectionSignals(messages);
  const correctionSignals = extractCorrectionSignals(messages);
  const acceptanceSignals = extractAcceptanceSignals(messages);
  const quantitySignals = extractQuantitySignals(messages);
  const referenceSignals = extractProductReferenceSignals(messages);

  const firstRequestSignal = requestSignals[0] ?? null;
  const firstRequestMessage = firstRequestSignal ? messageById.get(firstRequestSignal.messageId) ?? null : null;

  const products = new Map<string, ProductAccumulator>();
  const ensureProduct = (
    productNameRaw: string,
    confidence: ConfidenceAssessment,
    productId: string | null = null
  ) => {
    const key = normalizeProductKey(productNameRaw);
    if (!key) return null;
    let product = products.get(key);
    if (!product) {
      product = {
        key,
        productNameRaw,
        productId,
        requestedQuantity: null,
        offeredQuantity: null,
        finalQuantity: null,
        roles: new Set(),
        evidenceMessageIds: new Set(),
        confidence,
        availabilityEvidence: [],
        alternatives: [],
      };
      products.set(key, product);
    } else {
      if (!product.productId && productId) product.productId = productId;
      product.confidence = strongestConfidence(product.confidence, confidence);
    }
    return product;
  };

  const basketIds = input.baskets.map((basket) => basket.basketId);
  for (const basketId of basketIds) {
    const basket = input.baskets.find((candidate) => candidate.basketId === basketId)!;
    const items = input.itemsByBasketId[basketId] ?? [];
    const isActive = input.activeBasket?.basketId === basketId;

    for (const item of items) {
      const sourceMessage = messageById.get(item.sourceMessageId) ?? null;
      const product = ensureProduct(item.productNameRaw, item.confidence, item.productId);
      if (!product) continue;
      product.evidenceMessageIds.add(item.sourceMessageId);
      if (sourceMessage?.role === 'customer') {
        product.roles.add('requested');
        if (product.requestedQuantity == null && item.quantity != null) {
          product.requestedQuantity = item.quantity;
        }
      }
      if (sourceMessage?.role === 'staff') {
        product.roles.add('offered');
        if (product.offeredQuantity == null && item.quantity != null) {
          product.offeredQuantity = item.quantity;
        }
      }
      if (sourceMessage && ALTERNATIVE_RX.test(sourceMessage.text)) product.roles.add('alternative');
      if (isActive) {
        product.roles.add('final_basket');
        product.finalQuantity = item.quantity;
        if (basket.status === 'confirmed' || basket.confirmedByCustomerAt) {
          product.roles.add('accepted');
        }
        if (basket.status === 'cancelled') product.roles.add('rejected');
      }
    }
  }

  // A final staff recap can replace the basket's earlier customer-origin sourceMessageId. Re-add
  // the request role/quantity from the shared V32 signals, then merge it into the SAME normalized
  // product key rather than creating a parallel extraction truth.
  for (const signal of quantitySignals) {
    const message = messageById.get(signal.messageId);
    if (!message || message.role !== 'customer') continue;

    let productNameRaw: string | null = null;
    let quantity: number | null = null;
    if (signal.ruleId === 'quantity.digit_or_word_plus_unit') {
      const phrase = signal.extractedValue || '';
      const numberToken = phrase.trim().split(/\s+/)[0] || '';
      const digit = Number(numberToken);
      quantity = Number.isFinite(digit)
        ? digit
        : ({ واحد: 1, واحده: 1, واحدة: 1, اتنين: 2, تلاته: 3, تلاتة: 3, اربعة: 4, أربعة: 4, خمسة: 5 } as Record<string, number>)[numberToken] ?? null;
      productNameRaw = directRequestedProduct(message, phrase);
    } else {
      const index = messages.indexOf(message);
      const resolved = resolveReference(messages, index);
      productNameRaw = resolved?.text.trim() ?? null;
      const numberMatch = (signal.extractedValue || '').match(/\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?/);
      if (numberMatch) {
        const numeric = Number(numberMatch[0]);
        quantity = Number.isFinite(numeric)
          ? numeric
          : ({ واحد: 1, واحده: 1, واحدة: 1, اتنين: 2, تلاته: 3, تلاتة: 3, اربعة: 4, أربعة: 4, خمسة: 5 } as Record<string, number>)[numberMatch[0]] ?? null;
      }
    }

    if (!productNameRaw) continue;
    const ref = evidenceRef(message.id, `العميل طلب الصنف بكمية: "${message.text.slice(0, 120)}".`);
    const product = ensureProduct(
      productNameRaw,
      assessment('strongly_inferred', 0.8, ['need.product.customer_quantity_request'], [ref])
    );
    if (!product) continue;
    product.roles.add('requested');
    product.evidenceMessageIds.add(message.id);
    if (product.requestedQuantity == null && quantity != null) product.requestedQuantity = quantity;
  }

  // Pronoun references ("هات منه") are already resolved by the shared semantic layer. When the
  // antecedent is a basket item's source message, attach the CUSTOMER request evidence to it.
  for (const signal of referenceSignals) {
    if (signal.extractedValue === 'unknown') continue;
    const requestMessage = messageById.get(signal.messageId);
    if (!requestMessage || requestMessage.role !== 'customer') continue;
    for (const product of products.values()) {
      const itemSourceMatch = input.baskets.some((basket) =>
        (input.itemsByBasketId[basket.basketId] ?? []).some(
          (item) =>
            normalizeProductKey(item.productNameRaw) === product.key &&
            item.sourceMessageId === signal.extractedValue
        )
      );
      if (!itemSourceMatch) continue;
      product.roles.add('requested');
      product.evidenceMessageIds.add(requestMessage.id);
    }
  }

  // Compare immutable basket versions to identify factual removals/replacements. This is safer
  // than guessing which product a generic "لا" referred to.
  for (let i = 0; i < input.baskets.length - 1; i += 1) {
    const before = input.baskets[i];
    const after = input.baskets[i + 1];
    const beforeItems = input.itemsByBasketId[before.basketId] ?? [];
    const afterKeys = new Set((input.itemsByBasketId[after.basketId] ?? []).map((item) => normalizeProductKey(item.productNameRaw)));
    const changeEvidence = after.sourceMessageIds.filter((id) => messageById.get(id)?.role === 'customer');

    for (const item of beforeItems) {
      const key = normalizeProductKey(item.productNameRaw);
      if (afterKeys.has(key)) continue;
      const product = products.get(key);
      if (!product) continue;
      product.roles.add('rejected');
      changeEvidence.forEach((id) => product.evidenceMessageIds.add(id));
    }

    const substitutionEvidence = changeEvidence.some((id) => ALTERNATIVE_RX.test(messageById.get(id)?.text || ''));
    if (substitutionEvidence) {
      for (const item of input.itemsByBasketId[after.basketId] ?? []) {
        const product = products.get(normalizeProductKey(item.productNameRaw));
        if (product) product.roles.add('alternative');
      }
    }
  }

  // If the customer's wording explicitly named the product and the final recap uses the same raw
  // normalized phrase, restore "requested" even when no quantity signal existed.
  for (const request of requestSignals) {
    const message = messageById.get(request.messageId);
    if (!message) continue;
    const normalizedRequest = normalizeProductKey(stripRequestPrefix(message.text));
    for (const product of products.values()) {
      if (
        normalizedRequest === product.key ||
        normalizedRequest.includes(product.key) ||
        product.key.includes(normalizedRequest)
      ) {
        product.roles.add('requested');
        product.evidenceMessageIds.add(message.id);
      }
    }
  }

  // ---- Availability + alternatives: extensions of the SAME product lifecycle (no second extraction). ----
  // Only staff statements assert stock (V32 availability signals). Each fact is attributed to its own
  // message sender. A statement/offer that cannot be tied to exactly one requested product stays
  // unlinked evidence rather than being guessed onto a product.
  const staffIdFor = (sender: string): string | null => input.staffIdBySender?.[sender] ?? null;
  const indexById = new Map(messages.map((message, index) => [message.id, index]));
  const unlinkedAvailability: CustomerNeedAvailabilityEvidence[] = [];
  const unlinkedAlternatives: CustomerNeedAlternative[] = [];

  const linkProduct = (
    staffMessage: NormalizedConversationMessageV32,
    exclude: Set<string> = new Set()
  ): { product: ProductAccumulator; basis: 'product_named_in_message' | 'single_open_request' } | null => {
    const staffText = normalizeProductKey(staffMessage.text);
    // A product extracted FROM this very message (e.g. a whole staff sentence the basket kept as an
    // offered line) is not a product "named in" it.
    const named = Array.from(products.values()).filter(
      (product) =>
        !exclude.has(product.key) &&
        product.key.length >= 3 &&
        product.key !== staffText &&
        !product.evidenceMessageIds.has(staffMessage.id) &&
        staffText.includes(product.key)
    );
    if (named.length === 1) return { product: named[0], basis: 'product_named_in_message' };
    if (named.length > 1) return null;

    // Only the customer turn directly answered by this staff message may supply the link, and only
    // when that turn holds exactly one request; two open requests in one turn are ambiguous.
    const index = indexById.get(staffMessage.id) ?? -1;
    const before = messages.slice(0, Math.max(index, 0));
    const lastStaffIndex = before.map((message) => message.role === 'staff' && message.isMeaningful).lastIndexOf(true);
    const customerTurn = before
      .slice(lastStaffIndex + 1)
      .filter((message) => message.role === 'customer' && isRequestCandidate(message));
    const request = customerTurn.length === 1 ? customerTurn[0] : null;
    if (customerTurn.length > 1) return null;
    if (request) {
      const tied = Array.from(products.values()).filter(
        (product) => !exclude.has(product.key) && product.evidenceMessageIds.has(request.id)
      );
      if (tied.length === 1) return { product: tied[0], basis: 'single_open_request' };
      if (tied.length === 0) {
        const phrase = productPhraseFromStockQuestion(request.text);
        if (phrase && !exclude.has(normalizeProductKey(phrase))) {
          const ref = evidenceRef(request.id, `العميل سأل عن الصنف: "${request.text.slice(0, 120)}".`);
          const created = ensureProduct(
            phrase,
            assessment('weakly_inferred', 0.6, ['need.product.customer_stock_question'], [ref])
          );
          if (created) {
            created.roles.add('requested');
            created.evidenceMessageIds.add(request.id);
            return { product: created, basis: 'single_open_request' };
          }
        }
      }
    }

    const requested = Array.from(products.values()).filter(
      (product) =>
        !exclude.has(product.key) &&
        product.roles.has('requested') &&
        Array.from(product.evidenceMessageIds).some((id) => (indexById.get(id) ?? Infinity) < index)
    );
    return requested.length === 1 ? { product: requested[0], basis: 'single_open_request' } : null;
  };

  const availabilityByMessageId = new Map<string, ProductAccumulator>();
  const namedInClause = (clause: string, message: NormalizedConversationMessageV32) => {
    const clauseKey = normalizeProductKey(clause);
    return Array.from(products.values()).filter(
      (product) =>
        product.key.length >= 3 &&
        product.key !== normalizeProductKey(message.text) &&
        !product.evidenceMessageIds.has(message.id) &&
        clauseKey.includes(product.key)
    );
  };
  const availabilityFact = (
    message: NormalizedConversationMessageV32,
    state: CustomerNeedAvailabilityEvidence['state'],
    basis: CustomerNeedAvailabilityEvidence['linkBasis'],
    signalConfidence: number,
    ruleId: string
  ): CustomerNeedAvailabilityEvidence => ({
    state,
    messageId: message.id,
    staffSender: message.sender,
    staffId: staffIdFor(message.sender),
    linkBasis: basis,
    confidence: assessment(
      basis === 'product_named_in_message' ? 'strongly_inferred' : 'weakly_inferred',
      basis === 'product_named_in_message' ? signalConfidence : Math.min(signalConfidence, 0.7),
      [ruleId, `need.availability.link.${basis}`],
      [evidenceRef(message.id, `الموظف (${message.sender}) قال عن التوفر: "${message.text.slice(0, 120)}".`)]
    ),
  });
  const attach = (product: ProductAccumulator, fact: CustomerNeedAvailabilityEvidence) => {
    product.availabilityEvidence.push(fact);
    product.evidenceMessageIds.add(fact.messageId);
    if (fact.state === 'unavailable' || !availabilityByMessageId.has(fact.messageId)) {
      availabilityByMessageId.set(fact.messageId, product);
    }
  };
  for (const signal of extractAvailabilitySignals(messages)) {
    const message = messageById.get(signal.messageId);
    if (!message) continue;

    // Clause level first: each clause's state belongs to the one product named in THAT clause.
    const clauseLinks = availabilityStatementClausesV32(message.text)
      .map((row) => ({ state: row.state, named: namedInClause(row.clause, message) }))
      .filter((row) => row.named.length === 1);
    if (clauseLinks.length > 0) {
      const seen = new Set<string>();
      for (const row of clauseLinks) {
        const product = row.named[0];
        if (seen.has(product.key)) continue;
        seen.add(product.key);
        attach(product, availabilityFact(message, row.state, 'product_named_in_message', signal.confidence, `availability.staff_statement.${row.state}`));
      }
      continue;
    }

    const state = signal.extractedValue as CustomerNeedAvailabilityEvidence['state'];
    const link = linkProduct(message);
    const fact = availabilityFact(message, state, link?.basis ?? 'unlinked', signal.confidence, signal.ruleId);
    if (!link) {
      unlinkedAvailability.push(fact);
      continue;
    }
    attach(link.product, fact);
  }

  const alternativeSignals = extractAlternativeOfferSignals(messages);
  const alternativeMessageIds = new Set(alternativeSignals.map((signal) => signal.messageId));
  const customerResponseTo = (
    offer: NormalizedConversationMessageV32
  ): { response: CustomerNeedAlternativeResponse; messageId: string | null } => {
    const start = (indexById.get(offer.id) ?? -1) + 1;
    const replies: NormalizedConversationMessageV32[] = [];
    for (const message of messages.slice(start)) {
      if (alternativeMessageIds.has(message.id)) break;
      if (message.role === 'customer' && message.isMeaningful) replies.push(message);
      if (replies.length >= 3) break;
    }
    if (replies.length === 0) return { response: 'no_response', messageId: null };
    for (const reply of replies) {
      const response = classifyCustomerOfferResponseV32(reply.text);
      if (response) return { response, messageId: reply.id };
    }
    return { response: 'unknown', messageId: null };
  };

  const itemsSourcedFrom = (messageId: string) =>
    input.baskets.flatMap((basket) => input.itemsByBasketId[basket.basketId] ?? []).filter(
      (item) => item.sourceMessageId === messageId
    );

  for (const signal of alternativeSignals) {
    const offer = messageById.get(signal.messageId);
    if (!offer) continue;
    const trigger = (signal.relatedMessageIds ?? [])[0];
    let original: ProductAccumulator | null =
      (trigger ? availabilityByMessageId.get(trigger) : undefined) ??
      availabilityByMessageId.get(offer.id) ??
      null;

    // The alternative's own identity: a basket item the staff wrote in this very message, else the
    // raw phrase after the offer marker. Never the original product.
    // A basket line that is the staff's whole sentence is not a product name; fall back to the phrase.
    const offerText = normalizeProductKey(offer.text);
    const sourcedKeys = Array.from(
      new Set(itemsSourcedFrom(offer.id).map((item) => normalizeProductKey(item.productNameRaw)))
    ).filter((key) => key && key !== original?.key && key !== offerText);
    const phraseKey = signal.extractedValue ? normalizeProductKey(signal.extractedValue) : '';
    let alternativeProduct: ProductAccumulator | null =
      sourcedKeys.length === 1
        ? products.get(sourcedKeys[0]) ?? null
        : phraseKey && phraseKey !== original?.key
          ? products.get(phraseKey) ?? null
          : null;
    if (!original) {
      const link = linkProduct(offer, new Set(alternativeProduct ? [alternativeProduct.key] : []));
      original = link?.product ?? null;
    }
    if (alternativeProduct && alternativeProduct.key === original?.key) alternativeProduct = null;
    if (alternativeProduct) {
      alternativeProduct.roles.add('alternative');
      alternativeProduct.evidenceMessageIds.add(offer.id);
    }

    const { response: textResponse, messageId: responseMessageId } = customerResponseTo(offer);
    const inFinalBasket = alternativeProduct?.roles.has('final_basket') ?? false;
    const response: CustomerNeedAlternativeResponse =
      textResponse === 'unknown' || textResponse === 'no_response'
        ? (inFinalBasket ? 'accepted' : textResponse)
        : textResponse;
    const evidenceIds = [
      ...(trigger ? [trigger] : []),
      offer.id,
      ...(responseMessageId ? [responseMessageId] : []),
    ];
    const named = Boolean(alternativeProduct || signal.extractedValue);
    const alternative: CustomerNeedAlternative = {
      productKey: alternativeProduct?.key ?? null,
      productNameRaw: alternativeProduct?.productNameRaw ?? signal.extractedValue ?? null,
      productId: alternativeProduct?.productId ?? null,
      offerMessageId: offer.id,
      offeredByStaffSender: offer.sender,
      offeredByStaffId: staffIdFor(offer.sender),
      response,
      responseMessageId,
      evidenceMessageIds: evidenceIds,
      confidence: assessment(
        original && named ? 'strongly_inferred' : 'weakly_inferred',
        original && named ? signal.confidence : Math.min(signal.confidence, 0.6),
        [signal.ruleId, `need.alternative.response.${response}`],
        [evidenceRef(offer.id, `الموظف (${offer.sender}) عرض بديلًا: "${offer.text.slice(0, 120)}".`)]
      ),
    };
    if (!original) {
      unlinkedAlternatives.push(alternative);
      continue;
    }
    original.alternatives.push(alternative);
    evidenceIds.forEach((id) => original!.evidenceMessageIds.add(id));
  }

  const currentAvailability = (product: ProductAccumulator): CustomerNeedAvailability => {
    const latest = product.availabilityEvidence
      .slice()
      .sort((a, b) => (indexById.get(a.messageId) ?? 0) - (indexById.get(b.messageId) ?? 0))
      .pop();
    return latest?.state ?? 'unknown';
  };

  const rejectionIds = new Set(rejectionSignals.map((signal) => signal.messageId));
  const correctionIds = new Set(correctionSignals.map((signal) => signal.messageId));
  const objections: CustomerNeedObjection[] = [];
  for (const message of messages) {
    if (message.role !== 'customer' || !message.isMeaningful) continue;
    const category = classifyObjectionCategory(
      message.text,
      rejectionIds.has(message.id),
      correctionIds.has(message.id)
    );
    if (!category) continue;
    const score = category === 'unknown' ? 0.55 : 0.8;
    objections.push({
      category,
      text: message.text,
      messageId: message.id,
      confidence: assessment(
        category === 'unknown' ? 'weakly_inferred' : 'strongly_inferred',
        score,
        [`need.objection.${category}`],
        [evidenceRef(message.id, `اعتراض/عائق صريح من العميل: "${message.text.slice(0, 120)}".`)]
      ),
    });
  }

  const activeItems = input.activeBasket
    ? (input.itemsByBasketId[input.activeBasket.basketId] ?? [])
    : [];
  const explicitDecline = objections.some((objection) => objection.category === 'customer_declined');
  const structurallyIncomplete =
    !input.activeBasket ||
    activeItems.length === 0 ||
    input.activeBasket.status === 'draft' ||
    input.activeBasket.status === 'awaiting_confirmation' ||
    activeItems.some(
      (item) =>
        item.quantity == null ||
        item.resolutionStatus === 'unknown' ||
        item.resolutionStatus === 'contradicted'
    );
  const unresolvedNeed =
    requestSignals.length > 0 &&
    input.activeBasket?.status !== 'cancelled' &&
    !explicitDecline &&
    structurallyIncomplete;

  const humanReviewReasons: string[] = [];
  if (requestSignals.length > 0 && products.size === 0) {
    humanReviewReasons.push('customer_need_without_resolved_product_context');
  }
  if (
    activeItems.some(
      (item) => item.resolutionStatus === 'unknown' || item.resolutionStatus === 'contradicted'
    )
  ) {
    humanReviewReasons.push('customer_need_product_context_ambiguous');
  }

  const productList: CustomerNeedProductLifecycle[] = Array.from(products.values()).map((product) => ({
    key: product.key,
    productNameRaw: product.productNameRaw,
    productId: product.productId,
    requestedQuantity: product.requestedQuantity,
    offeredQuantity: product.offeredQuantity,
    finalQuantity: product.finalQuantity,
    roles: Array.from(product.roles),
    availability: currentAvailability(product),
    availabilityEvidence: product.availabilityEvidence,
    alternatives: product.alternatives,
    evidenceMessageIds: Array.from(product.evidenceMessageIds),
    confidence:
      product.confidence ??
      assessment('unknown', 0.2, ['need.product.insufficient_evidence'], []),
  }));

  const evidenceMessageIds = Array.from(
    new Set([
      ...requestSignals.map((signal) => signal.messageId),
      ...productList.flatMap((product) => product.evidenceMessageIds),
      ...objections.map((objection) => objection.messageId),
      ...acceptanceSignals.map((signal) => signal.messageId),
    ])
  );

  let confidence: ConfidenceAssessment;
  if (requestSignals.length > 0 && productList.length > 0) {
    confidence = assessment(
      'strongly_inferred',
      0.85,
      ['need.model.request_plus_product_lifecycle'],
      firstRequestMessage
        ? [evidenceRef(firstRequestMessage.id, `الحاجة الأساسية كما قالها العميل: "${firstRequestMessage.text.slice(0, 120)}".`)]
        : []
    );
  } else if (requestSignals.length > 0) {
    confidence = assessment(
      'weakly_inferred',
      0.55,
      ['need.model.request_without_product_lifecycle'],
      firstRequestMessage
        ? [evidenceRef(firstRequestMessage.id, `طلب/احتياج حقيقي بدون منتج محسوم: "${firstRequestMessage.text.slice(0, 120)}".`)]
        : []
    );
  } else if (productList.length > 0) {
    confidence = assessment(
      'weakly_inferred',
      0.5,
      ['need.model.product_without_explicit_customer_request'],
      []
    );
  } else {
    confidence = assessment('unknown', 0.1, ['need.model.no_commercial_need_evidence'], []);
  }

  return {
    caseId: input.caseId,
    primaryNeed: firstRequestMessage?.text ?? null,
    primaryNeedMessageId: firstRequestMessage?.id ?? null,
    products: productList,
    unlinkedAvailability,
    unlinkedAlternatives,
    objections,
    unresolvedNeed,
    evidenceMessageIds,
    confidence,
    needsHumanReview: humanReviewReasons.length > 0,
    humanReviewReasons,
  };
}
