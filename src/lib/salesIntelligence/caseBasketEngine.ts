// Sales Intelligence Phase B.2 — Case Basket Engine.
//
// Pure functions only — no Supabase calls, no mutation of historical state. A basket version is
// never edited in place: any customer modification after a final-basket-summary was presented
// closes the current version (status -> 'superseded') and opens a new one.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import {
  contextWindowV32,
  availabilityStatementClausesV32,
  classifyCustomerOfferResponseV32,
  extractAcceptanceSignals,
  extractAlternativeOfferSignals,
  extractConfirmationSignals,
  extractProductReferenceSignals,
  extractQuantitySignals,
  extractRejectionSignals,
  isSubstantiveConfirmationSignal,
  resolveReference,
} from '../whatsappSemanticSignalsV32';
import { resolveProductMention, type PharmacyProductIndex } from './pharmacyProducts/pharmacyProductResolverV2';
import type {
  AnnouncedTotal,
  CaseBasket,
  CaseBasketItem,
  CaseStatus,
  ConfidenceAssessment,
  ConfidenceLevel,
  CustomerConfirmationEvent,
  EvidenceRef,
  FinalBasketSummaryEvent,
  ItemResolutionStatus,
  StaffFinalConfirmationEvent,
} from './types';

// ---------------------------------------------------------------------------
// Local, basket-specific vocabulary. Deliberately NOT added to the shared V32 signal layer:
// these phrases only make sense in the context of a staff basket-summary/confirmation exchange,
// which is a new domain concept this engine owns — not a general conversation-semantics concept.
// ---------------------------------------------------------------------------

const FINAL_BASKET_SUMMARY_MARKER_RX = /تأمر\s*ب|إجمالي\s*الحساب|هل\s*الطلب\s*كده\s*كامل|حضرتك\s*تأمر/i;
// Natural Egyptian recap used in real order closing: "يعني كدا 4 علب ...". Requiring both a
// recap opener AND a quantity/unit keeps this narrower than a generic "يعني كدا" sentence.
const NATURAL_FINAL_RECAP_RX =
  /^(?:يعني\s*)?(?:كدا|كده)\s+.*(?:\d+\s*(?:علب|علبة|علبه|شريط|شراب|عبوة|عبوه|كيس|حبة|حبه|نوع)|علبتين|شريطين|عبوتين|كيسين|حبتين)/i;
// Phase C: broadened past the two original "تم تأكيد/تسجيل" phrases to cover the natural-language
// fulfillment variants the spec explicitly requires ("جاري الإرسال/التجهيز", "الطلب اتأكد") — still
// deliberately narrow (no bare "حاضر"/"تمام" alone) since this only ever fires once a customer
// confirmation already exists (see the `status === 'confirmed'` gate in buildCaseBaskets below).
const STAFF_FINAL_CONFIRMATION_RX =
  /تم\s*تأكيد\s*الطلب|تم\s*تسجيل(?:\s*طلبك)?|تسجيل\s*طلبك|جاري\s*(?:التجهيز|الإرسال|الارسال)|الطلب\s*اتأكد/i;
// Phase C: combo confirmation phrases the shared V32 ACCEPTANCE_RX doesn't cover (each of its
// alternatives requires an exact whole-string match to ONE fixed token) — "ايوه تمام"/"كده تمام"/
// "لا كده تمام"/"شكرا كده تمام" are all real ways a customer confirms an exact presented basket.
const CUSTOMER_BASKET_CONFIRMATION_RX =
  /^(?:ايوا|ايوه|اه|آه)?\s*كده\s*تمام[!.، ]*$|^لا\s*كده\s*تمام[!.، ]*$|^شكرا?ً?\s*(?:يا\s*فندم\s*)?كده\s*تمام[!.، ]*$|^(?:ايوا|ايوه|اه|آه)\s*تمام[!.، ]*$/i;
const MODIFICATION_ADD_RX = /زود(?:ي)?|ضيف(?:ي)?\s|كمان\s*عايز|كمان\s*حاجة|نسيت/i;
const MODIFICATION_REMOVE_RX = /شيل(?:ي)?\s|الغ[يى](?:ي)?\s*(?!.*كل)/i;
const MODIFICATION_QTY_CHANGE_RX = /خليه?م?\s*(\d+|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*بدل\s*(\d+|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)/i;
/** "بدل الصابونة العادية هات التاني" — a product swap, distinct from the numeric quantity-change phrasing above. */
const SUBSTITUTION_MARKER_RX = /بدل(?:ها|منها|ه)?\s/i;
// Phase C: "خالص" is now optional after "الطلب" — the spec's own canonical example ("لا خلاص مش
// عايز الطلب") has no trailing "خالص". "الطلب" itself (not a product name) is what distinguishes
// a whole-order rejection from a partial one ("مش عايز الزوركال" stays a single-item rejection).
const WHOLE_BASKET_REJECTION_RX = /مش\s*عايز\s*(?:ده|حاجه|أي\s*حاجه|الطلب)(?:\s*خالص)?|الغ[يى]\s*كل\s*حاجة|كنسل\s*الطلب/i;

/** Parses a multi-item consolidated summary ("3 علب انتينال\n2 علبة ستريبتوكين\n1 شريط زوركال"). */
const QUANTITY_UNIT_ITEM_RX =
  /(\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*(علبة|علب|حبة|حبوب|شريط|عبوة|قطعة|كيس)\s+([^\n,،]+)/gi;

/**
 * Phase C: the TOTAL a staff explicitly announced ("الحساب كله 1000 جنيه", "الإجمالي 1000",
 * "كده الإجمالي 1000", "المجموع 1000 جنيه") — deliberately distinct from a bare price mention
 * (extractPriceSignals matches ANY "<number> جنيه", including a single item's price or a delivery
 * fee). Requiring one of these total-specific keywords is what keeps a per-item price or a
 * delivery fee from ever being mistaken for the announced order total.
 */
const ANNOUNCED_TOTAL_RX =
  /(?:كده\s*)?(?:إجمالي\s*الحساب|الحساب\s*كل?ه|الإجمالي|المجموع|الحساب)\s*(?:كده\s*)?(\d+(?:\.\d+)?)\s*(?:جنيه|جنيها|ج\.?م\.?)?/i;
// A compact amount is accepted only as a contextual answer to the customer's own total question.
// This intentionally does NOT turn every bare "90 جنيه" into an order total.
const COMPACT_ANNOUNCED_TOTAL_RX =
  /^\s*(\d+(?:\.\d+)?)\s*(?:جنيه|جنيها|ج(?:\.?م\.?)?)\s*(?:ان\s*شاء\s*الله)?[.!، ]*$/i;
const TOTAL_QUESTION_RX =
  /(?:الحساب|الإجمالي|الاجمالي|المجموع).{0,16}كام|(?:كدا|كده)?\s*(?:هيبقا|هيبقى|يبقا|يبقى)\s*كام/i;

const ARABIC_NUMBER_WORDS: Record<string, number> = {
  واحد: 1, واحده: 1, واحدة: 1,
  اتنين: 2,
  تلاته: 3, تلاتة: 3,
  اربعة: 4, أربعة: 4,
  خمسة: 5,
};

function parseNumberToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return ARABIC_NUMBER_WORDS[token.trim()] ?? null;
}

export function normalizeProductKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

// Standalone additive connectors ("و", "وكمان", "كمان", "برضه", "أيضا") that open a request but are
// not part of the product name ("وكمان 2 علبة فيتامين د" -> "فيتامين د"). Whole tokens only: a
// product whose own name starts with the letter "و" is never cut.
const ADDITIVE_CONNECTOR_RX = /^\s*(?:(?:و|وكمان|كمان|وبرضه|برضه|برضو|وأيضا|وايضا|أيضا|ايضا)(?=\s)\s*)+/i;

// Acknowledgement / discourse openers before a request ("تمام هات X", "بالمناسبة عايز X") and a
// trailing additive ("... كمان") — whole tokens only, never part of a product name.
const GREETING_LEAD_RX =
  /^\s*(?:(?:السلام\s*عليكم(?:\s*ورحمة\s*الله(?:\s*وبركاته)?)?|صباح\s*الخير|مساء\s*الخير|أهلا|اهلا)(?=[\s،,!]|$)[\s،,!]*)+/i;
const LEAD_DISCOURSE_RX =
  /^\s*(?:(?:تمام|ماشي|اوك|ok|خلاص|طيب|ايوه|ايوا|اه|آه|بالمناسبة|على\s*فكرة)(?=[\s،,])[\s،,]*)+/i;
const TRAILING_ADDITIVE_RX = /\s+(?:كمان|برضه|برضو|أيضا|ايضا)\s*$/i;

export function stripRequestPrefix(text: string): string {
  return text
    .replace(GREETING_LEAD_RX, '')
    .replace(LEAD_DISCOURSE_RX, '')
    .replace(ADDITIVE_CONNECTOR_RX, '')
    .replace(/^\s*(?:عايز[هة]?|عاوز[هة]?|محتاج[هة]?|ممكن|هات[ي]?|ابعت(?:لي|يلي)?)\s*/i, '')
    .replace(ADDITIVE_CONNECTOR_RX, '')
    .replace(TRAILING_ADDITIVE_RX, '')
    .trim()
    .replace(/^[,،]+|[,،]+$/g, '')
    .trim();
}

const NON_PRODUCT_PHRASE_RX = /^(?:مش|لا|لأ|اه|آه|تمام|حاجة|حاجه|ده|دي|دا|دول|منه|منها|بس)?$/;
const GENERIC_DEICTIC_PRODUCT_PHRASE_RX =
  /^(?:(?:العلب[هة]|العبو[هة]|الشريط|الصنف)\s*(?:دي|ده|دا)|(?:الحاجات|الحاجه|الحاجة|الأشياء|الاشياء)\s*(?:دي|دول|ده|دا)?|(?:دول|دي|ده|دا)(?:\s*كلهم)?|اللي\s*(?:في|ف)\s*(?:الصوره|الصورة|الصور|الفويس|الصوت)|اللي\s*(?:بعت(?:ه|ها|هم)|مبعت(?:ه|ها|هم)))$/i;
const NON_IDENTIFYING_RECAP_ITEM_RX = /مع\s+\d+\s+نوع|اللي\s+الدكتور|في\s+(?:الريكورد|الفويس|الصوت)/i;

export function isGenericDeicticProductPhrase(value: string): boolean {
  return GENERIC_DEICTIC_PRODUCT_PHRASE_RX.test(String(value || '').trim());
}
const EXPLICIT_REQUEST_VERB_RX = /(?<![\p{L}\p{N}])(?:عايز[هة]?|عاوز[هة]?|محتاج[هة]?|هات(?:ي|لي)?|ابعت(?:لي|يلي)?)(?![\p{L}\p{N}])/u;
// "ابعت X بس" — the customer narrows the order to the named item(s).
const ONLY_THIS_RX = /(?<![\p{L}\p{N}])(?:بس|فقط)[.!، ]*$/u;

const INFO_QUESTION_LEAD_RX = /^(?:اعرف|أعرف|اسأل|أسأل|استفسر|أستفسر|افهم|أفهم|اشوف|أشوف|اتأكد|أتأكد)(?=\s|$)/;
const POLITENESS_RX = /(?<![\p{L}\p{N}])(?:لو\s*سمحت|من\s*فضلك|يا\s*(?:دكتور[ةه]?|فندم)|بعد\s*اذنك|بعد\s*إذنك)(?![\p{L}\p{N}])/giu;

/** Product phrases named by an explicit request ("عايز X و Y"); [] when it is not a product request. */
export function explicitRequestProductPhrases(text: string): string[] {
  const phrase = stripRequestPrefix(text.replace(POLITENESS_RX, ' '))
    .replace(/[؟?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!phrase || /[؟?]/.test(text) || INFO_QUESTION_LEAD_RX.test(phrase)) return [];
  const parts = phrase
    .split(/\s+و\s+|\s*[،,+]\s*/)
    .map((part) => stripRequestPrefix(part).trim())
    .filter((part) => part.length >= 2);
  if (
    !parts.length ||
    parts.some(
      (part) =>
        part.split(/\s+/).length > 4 ||
        NON_PRODUCT_PHRASE_RX.test(part) ||
        isGenericDeicticProductPhrase(part)
    )
  ) return [];
  return parts;
}



// A quantity revision addressed to the current item by pronoun: "خليهم علبة واحدة بس",
// "خليها اتنين", "نزلهم لواحدة". Only the quantity changes; no new product is named.
const QUANTITY_REVISION_RX =
  /^(?:(?:لا|لأ|طيب|خلاص)[،,\s]+)?(?:خلي(?:ه|ها|هم|هملي|هولي|هالي)|نزل(?:ه|ها|هم))\s+(?:ل)?(?:(\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*(?:علب[ةه]?|علب|شريط|عبو[ةه]|قطع[ةه]|حب[ةه])?|(?:علب[ةه]|شريط|عبو[ةه]|قطع[ةه]|حب[ةه])\s*(واحد[ةه]?|اتنين|\d+)|(علبتين|شريطين|عبوتين|حبتين))\s*(?:بس|فقط)?[.!، ]*$/i;

function parseQuantityRevision(text: string): number | null {
  const match = text.trim().match(QUANTITY_REVISION_RX);
  if (!match) return null;
  if (match[3]) return 2;
  return parseNumberToken(match[1] ?? match[2] ?? '');
}

function assessment(level: ConfidenceLevel, score: number, ruleId: string, evidence: EvidenceRef[]): ConfidenceAssessment {
  return { level, score, ruleIds: [ruleId], evidence };
}

function refFor(message: NormalizedConversationMessageV32, description: string): EvidenceRef {
  return {
    sourceTable: 'whatsapp_review_sources',
    sourceId: '',
    messageIds: [message.id],
    description,
  };
}

interface DraftItem {
  productNameRaw: string;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  sourceMessageId: string;
  confidence: ConfidenceAssessment;
  resolutionStatus: ItemResolutionStatus;
}

const NATURAL_UNIT_ITEM_RX =
  /(علبتين|علبة|علبه|شريطين|شريط|عبوتين|عبوة|عبوه|كيسين|كيس|حبتين|حبة|حبه)\s+(.+?)(?=(?:\s+(?:و\s*|مع\s+)(?:علبتين|علبة|علبه|شريطين|شريط|عبوتين|عبوة|عبوه|كيسين|كيس|حبتين|حبة|حبه)\s+)|[,،]|$)/gi;
const NATURAL_UNIT_QTY: Record<string, { quantity: number; unit: string }> = {
  علبتين: { quantity: 2, unit: 'علبة' },
  علبة: { quantity: 1, unit: 'علبة' },
  علبه: { quantity: 1, unit: 'علبة' },
  شريطين: { quantity: 2, unit: 'شريط' },
  شريط: { quantity: 1, unit: 'شريط' },
  عبوتين: { quantity: 2, unit: 'عبوة' },
  عبوة: { quantity: 1, unit: 'عبوة' },
  عبوه: { quantity: 1, unit: 'عبوة' },
  كيسين: { quantity: 2, unit: 'كيس' },
  كيس: { quantity: 1, unit: 'كيس' },
  حبتين: { quantity: 2, unit: 'حبة' },
  حبة: { quantity: 1, unit: 'حبة' },
  حبه: { quantity: 1, unit: 'حبة' },
};
const PRICE_INQUIRY_RX = /بكام|عامل\s*كام|سعر(?:ه|ها)?|كام\s*(?:جنيه|العلبة|العلبه)|فيها\s*كام/i;
const STAFF_RECAP_CONTEXT_RX = /يعني\s*(?:كدا|كده|حضرتك)|حضرتك\s*محتاج|تكرر|كرر|تأمر|تحت\s*امر/i;

function extractNaturalUnitItems(message: NormalizedConversationMessageV32): DraftItem[] {
  if (!message.isMeaningful || /<(?:image|audio|voice message) omitted>/i.test(message.text)) return [];
  if (message.role === 'customer' && PRICE_INQUIRY_RX.test(message.text)) return [];
  if (message.role === 'staff' && !STAFF_RECAP_CONTEXT_RX.test(message.text)) return [];

  const items: DraftItem[] = [];
  for (const match of message.text.matchAll(NATURAL_UNIT_ITEM_RX)) {
    const quantityInfo = NATURAL_UNIT_QTY[match[1]];
    if (!quantityInfo) continue;
    const productNameRaw = match[2]
      .trim()
      .replace(/^(?:من\s+فضلك|لو\s*سمحت|ان\s*شاء\s*الله)\s*/i, '')
      .replace(/\s+(?:صح|مظبوط|ان\s*شاء\s*الله)\??$/i, '')
      .trim();
    if (
      !productNameRaw ||
      productNameRaw.length < 2 ||
      PRICE_INQUIRY_RX.test(productNameRaw) ||
      NON_PRODUCT_PHRASE_RX.test(productNameRaw) ||
      isGenericDeicticProductPhrase(productNameRaw) ||
      NON_IDENTIFYING_RECAP_ITEM_RX.test(productNameRaw)
    ) continue;
    items.push({
      productNameRaw,
      productId: null,
      quantity: quantityInfo.quantity,
      unit: quantityInfo.unit,
      sourceMessageId: message.id,
      confidence: assessment('strongly_inferred', 0.8, 'basket.item.natural_arabic_unit_form', [
        refFor(message, `صياغة طلب عربية طبيعية بكمية ضمنية/مثنى: "${match[0].trim()}".`),
      ]),
      resolutionStatus: 'proven',
    });
  }
  return items;
}

/** Items explicitly parsed out of ONE consolidated staff summary message (multi-item, per-line). */
function parseSummaryItems(message: NormalizedConversationMessageV32): DraftItem[] {
  const items: DraftItem[] = [];
  const matches = message.text.matchAll(QUANTITY_UNIT_ITEM_RX);
  for (const m of matches) {
    const quantity = parseNumberToken(m[1]);
    const unit = m[2];
    const productNameRaw = m[3].trim();
    if (
      !productNameRaw ||
      NON_PRODUCT_PHRASE_RX.test(productNameRaw) ||
      isGenericDeicticProductPhrase(productNameRaw) ||
      NON_IDENTIFYING_RECAP_ITEM_RX.test(productNameRaw)
    ) continue;
    items.push({
      productNameRaw,
      productId: null,
      quantity,
      unit,
      sourceMessageId: message.id,
      confidence: assessment('strongly_inferred', 0.8, 'basket.item.parsed_from_staff_summary', [
        refFor(message, `بند من ملخص الطلب النهائي: "${m[0].trim()}".`),
      ]),
      resolutionStatus: 'proven',
    });
  }

  // Staff recaps in real chats often use natural Egyptian forms:
  // "علبتين كولونا وعلبة جاسترو". Add those too, while letting an explicit
  // "2 علبة ..." win when both parsers see the same product.
  const explicitKeys = new Set(items.map((item) => normalizeProductKey(item.productNameRaw)));
  for (const natural of extractNaturalUnitItems(message)) {
    const key = normalizeProductKey(natural.productNameRaw);
    if (!key || explicitKeys.has(key)) continue;
    items.push(natural);
  }
  return items;
}

/**
 * Items extracted from ongoing customer/staff messages (before any consolidated summary exists).
 * Takes the FULL chronologically-scoped case message array (not just the message(s) being
 * processed) so `resolveReference` can see prior messages and actually resolve pronouns like
 * "منه"/"منها" — a 1-element array can never contain a "prior" message. `restrictToIds`, when
 * given, limits which messages' signals are turned into output items without narrowing the
 * context `resolveReference` searches.
 */
function extractDraftItemsFromScope(
  allMessages: NormalizedConversationMessageV32[],
  restrictToIds?: Set<string>
): DraftItem[] {
  const items: DraftItem[] = [];
  const scopedMessages = restrictToIds
    ? allMessages.filter((message) => restrictToIds.has(message.id))
    : allMessages;
  scopedMessages.forEach((message) => items.push(...extractNaturalUnitItems(message)));

  const quantitySignals = extractQuantitySignals(allMessages).filter(
    (s) => !restrictToIds || restrictToIds.has(s.messageId)
  );

  quantitySignals.forEach((signal) => {
    const message = allMessages.find((m) => m.id === signal.messageId);
    if (!message) return;
    if (signal.ruleId === 'quantity.digit_or_word_plus_unit') {
      const phrase = signal.extractedValue || '';
      const [numToken, ...unitParts] = phrase.trim().split(/\s+/);
      const quantity = parseNumberToken(numToken);
      const unit = unitParts.join(' ') || null;
      const productNameRaw = stripRequestPrefix(message.text.replace(phrase, ' ')) || message.text.trim();
      if (NON_PRODUCT_PHRASE_RX.test(productNameRaw) || isGenericDeicticProductPhrase(productNameRaw)) return;
      items.push({
        productNameRaw,
        productId: null,
        quantity,
        unit,
        sourceMessageId: message.id,
        confidence: assessment('strongly_inferred', 0.75, 'basket.item.quantity_unit_in_message', [
          refFor(message, `العميل/الموظف ذكر كمية ووحدة صريحة: "${phrase}" في رسالة "${message.text.slice(0, 60)}".`),
        ]),
        resolutionStatus: 'proven',
      });
      return;
    }
    // quantity.reference_attached_no_unit — e.g. "هات منه اتنين": resolve the pronoun to the
    // nearest prior staff offer for the product name; quantity is proven, product identity is
    // only as strong as the reference resolution.
    const index = allMessages.indexOf(message);
    const resolved = resolveReference(allMessages, index);
    const numberMatch = (signal.extractedValue || '').match(/\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?/);
    const quantity = numberMatch ? parseNumberToken(numberMatch[0]) : null;
    items.push({
      productNameRaw: resolved ? resolved.text.trim() : message.text.trim(),
      productId: null,
      quantity,
      unit: null,
      sourceMessageId: message.id,
      confidence: resolved
        ? assessment('strongly_inferred', 0.65, 'basket.item.reference_resolved_to_prior_offer', [
            refFor(message, `كمية مرجعية "${signal.extractedValue}" تُحل إلى العرض السابق: "${resolved.text.slice(0, 60)}".`),
          ])
        : assessment('unknown', 0.3, 'basket.item.reference_unresolved', [
            refFor(message, `كمية مرجعية "${signal.extractedValue}" بدون عرض سابق واضح يُحل إليه المرجع.`),
          ]),
      resolutionStatus: resolved ? 'partially_proven' : 'unknown',
    });
  });

  // A product mentioned by name/reference with NO quantity anywhere — still a real basket item
  // candidate (quantity stays null rather than being guessed as 1).
  const productRefSignals = extractProductReferenceSignals(allMessages).filter(
    (s) => !restrictToIds || restrictToIds.has(s.messageId)
  );
  productRefSignals.forEach((signal) => {
    const alreadyCaptured = quantitySignals.some((q) => q.messageId === signal.messageId);
    if (alreadyCaptured) return;
    const message = allMessages.find((m) => m.id === signal.messageId);
    if (!message) return;
    // A staff pronoun ("ممكن بدل منه نجيب ...", "ده متوفر") points back at a product already under
    // discussion; it never adds a basket line, and must never turn the staff sentence into one.
    if (message.role === 'staff') return;
    const index = allMessages.indexOf(message);
    const resolved = resolveReference(allMessages, index);
    // An unresolved "ده/دي/دول/منه..." is evidence that product context is missing, NOT a product
    // identity. Keeping the whole customer sentence as a basket line poisoned downstream demand,
    // availability and invoice-item matching. Unknown stays unknown until a real antecedent,
    // catalog match, media analysis or trusted invoice evidence supplies the product identity.
    if (!resolved) return;
    items.push({
      productNameRaw: resolved.text.trim(),
      productId: null,
      quantity: null,
      unit: null,
      sourceMessageId: message.id,
      confidence: assessment('strongly_inferred', 0.6, 'basket.item.product_reference_resolved_no_quantity', [
        refFor(message, `إشارة لمنتج بدون كمية، تُحل إلى العرض السابق: "${resolved.text.slice(0, 60)}".`),
      ]),
      resolutionStatus: 'partially_proven',
    });
  });

  // A customer request that names its product(s) with an explicit verb but no quantity
  // ("عايز بانادول اكسترا و كونجستال", "تمام هات كومتركس") is a draft line with quantity unknown —
  // only when nothing else in that message produced a line, and never from staff text.
  scopedMessages.forEach((message) => {
    if (message.role !== 'customer' || !message.isMeaningful || !EXPLICIT_REQUEST_VERB_RX.test(message.text)) return;
    if (items.some((item) => item.sourceMessageId === message.id)) return;
    for (const productNameRaw of explicitRequestProductPhrases(message.text.replace(ONLY_THIS_RX, ''))) {
      items.push({
        productNameRaw,
        productId: null,
        quantity: null,
        unit: null,
        sourceMessageId: message.id,
        confidence: assessment('weakly_inferred', 0.55, 'basket.item.explicit_named_request_no_quantity', [
          refFor(message, `العميل طلب الصنف بالاسم دون كمية: "${message.text.slice(0, 80)}".`),
        ]),
        resolutionStatus: 'partially_proven',
      });
    }
  });

  return items;
}

/**
 * Direct product-name intake: a customer message naming a product WITHOUT any request verb
 * ("جاست ريج أمبول", said as if naming an order item directly, instead of "عايز جاست ريج أمبول")
 * still becomes a real basket line -- but ONLY when the real catalog resolver independently finds
 * one safe, non-ambiguous, strong (proven/strongly_inferred) match for the message's own text.
 * Deliberately narrow: no request-verb heuristic is broadened here, and a message that does not
 * resolve this strongly stays exactly as before (no item, no guess).
 */
function directCatalogMentionItem(
  message: NormalizedConversationMessageV32,
  productIndex: PharmacyProductIndex
): DraftItem | null {
  if (!message.isMeaningful || message.role !== 'customer') return null;
  const resolution = resolveProductMention(message.text, productIndex);
  const selected = resolution.selected;
  if (resolution.ambiguous || !selected || !['proven', 'strongly_inferred'].includes(selected.confidence)) return null;
  return {
    productNameRaw: message.text.trim(),
    productId: selected.product.productId,
    quantity: null,
    unit: null,
    sourceMessageId: message.id,
    confidence: assessment(
      selected.confidence,
      selected.score,
      'basket.item.direct_catalog_mention',
      [refFor(message, `تطابق مباشر وآمن مع كتالوج المنتجات (${selected.basis}): "${message.text.slice(0, 80)}".`)]
    ),
    resolutionStatus: selected.confidence === 'proven' ? 'proven' : 'partially_proven',
  };
}

/** Keys of current draft items the customer's "only X" message names (ال-prefix tolerant, whole tokens). */
function itemsNamedIn(text: string, keys: string[]): string[] {
  const phraseTokens = normalizeProductKey(stripRequestPrefix(text.replace(ONLY_THIS_RX, '')))
    .split(' ')
    .map((token) => token.replace(/^ال/, ''))
    .filter((token) => token.length >= 3);
  return keys.filter((key) => {
    const keyTokens = key.split(' ').map((token) => token.replace(/^ال/, ''));
    return phraseTokens.length > 0 && phraseTokens.every((token) => keyTokens.includes(token));
  });
}

function draftItemsToMap(items: DraftItem[]): Map<string, DraftItem> {
  const map = new Map<string, DraftItem>();
  items.forEach((item) => map.set(normalizeProductKey(item.productNameRaw), item));
  return map;
}

function contextualCompactTotal(
  scopedMessages: NormalizedConversationMessageV32[],
  summaryMessage: NormalizedConversationMessageV32,
  candidate: NormalizedConversationMessageV32
): number | null {
  if (candidate.role !== 'staff' || !candidate.isMeaningful) return null;
  const amountMatch = candidate.text.match(COMPACT_ANNOUNCED_TOTAL_RX);
  if (!amountMatch) return null;
  const summaryIndex = scopedMessages.findIndex((m) => m.id === summaryMessage.id);
  const candidateIndex = scopedMessages.findIndex((m) => m.id === candidate.id);
  if (summaryIndex < 0 || candidateIndex <= summaryIndex) return null;
  const prior = scopedMessages
    .slice(summaryIndex + 1, candidateIndex)
    .filter((m) => m.isMeaningful);
  const totalQuestion = [...prior].reverse().find(
    (m) => m.role === 'customer' && TOTAL_QUESTION_RX.test(m.text)
  );
  if (!totalQuestion) return null;

  // Real chats often contain a short acknowledgement while the staff member calculates the total:
  // customer asks "كدا هيبقا كام" -> staff says "حالا هبلغ حضرتك" -> customer says "تمام"
  // -> staff answers "1579ج". Keep that chain intact, but fail closed if the customer introduces
  // any new commercial content before the compact amount.
  if (candidate.timestamp.getTime() - totalQuestion.timestamp.getTime() > 10 * 60_000) return null;
  const totalQuestionIndex = scopedMessages.findIndex((m) => m.id === totalQuestion.id);
  if (totalQuestionIndex < 0) return null;
  const SAFE_WAITING_ACK_RX = /^(?:تمام|ماشي|حاضر|اوكي|أوكي|اوك|ok|شكرا|شكرًا|تسلم)(?:\s+يا\s+فندم)?[.!، ]*$/i;
  const laterCustomerMessages = scopedMessages
    .slice(totalQuestionIndex + 1, candidateIndex)
    .filter((m) => m.isMeaningful && m.role === 'customer');
  if (laterCustomerMessages.some((m) => !SAFE_WAITING_ACK_RX.test(m.text.trim()))) return null;

  return Number(amountMatch[1]);
}

function extractAnnouncedTotal(
  scopedMessages: NormalizedConversationMessageV32[],
  summaryMessage: NormalizedConversationMessageV32,
  version: number
): AnnouncedTotal | null {
  const candidates = scopedMessages
    .filter((m) => m.timestamp.getTime() >= summaryMessage.timestamp.getTime())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const m of candidates) {
    const explicitMatch = m.text.match(ANNOUNCED_TOTAL_RX);
    const amount = explicitMatch ? Number(explicitMatch[1]) : contextualCompactTotal(scopedMessages, summaryMessage, m);
    if (amount == null || !Number.isFinite(amount)) continue;
    return {
      amount,
      currency: 'EGP',
      messageId: m.id,
      staffId: null,
      announcedAt: m.timestamp.toISOString(),
      basketVersion: version,
      supersededByTotalId: null,
    };
  }
  return null;
}

function isFinalBasketSummary(message: NormalizedConversationMessageV32): boolean {
  return message.role === 'staff' && message.isMeaningful &&
    (FINAL_BASKET_SUMMARY_MARKER_RX.test(message.text) || NATURAL_FINAL_RECAP_RX.test(message.text));
}

function isStaffFinalConfirmation(message: NormalizedConversationMessageV32): boolean {
  return message.role === 'staff' && message.isMeaningful && STAFF_FINAL_CONFIRMATION_RX.test(message.text);
}

/** True when a customer message is a modification instruction distinct from a plain confirmation/rejection. */
function classifyCustomerModification(text: string): 'add' | 'remove' | 'quantity_change' | 'substitute' | null {
  if (MODIFICATION_QTY_CHANGE_RX.test(text) || parseQuantityRevision(text) != null) return 'quantity_change';
  if (SUBSTITUTION_MARKER_RX.test(text)) return 'substitute';
  if (MODIFICATION_ADD_RX.test(text)) return 'add';
  if (MODIFICATION_REMOVE_RX.test(text)) return 'remove';
  return null;
}

/** "بدل الصابونة العادية هات التاني" -> "التاني" — the fact as stated, no invented product identity. */
function extractSubstituteProductName(text: string): string {
  const afterVerb = text.replace(/^.*?(?:هات[ي]?|عايز|عاوز|ابعت(?:لي|يلي)?)\s*/i, '').trim();
  return afterVerb || text.trim();
}

/**
 * "كمان عايز شامبو للشعر" -> "شامبو للشعر" — used only as a fallback when a plain product-name
 * add has no quantity/unit and no pronoun reference for `extractDraftItemsFromScope` to resolve
 * (V32's shared signal layer has no general product-NER, only pronoun-reference detection).
 */
function extractAddedProductName(text: string): string {
  const stripped = text.replace(/^.*?(?:زود(?:ي)?|ضيف(?:ي)?|كمان\s*عايز|كمان\s*حاجة|نسيت)\s*/i, '').trim();
  return stripped || text.trim();
}

/** A confirmation/acceptance/rejection signal counts only when it follows the summary within the lookback window. */
function isLinkedToSummary(
  scopedMessages: NormalizedConversationMessageV32[],
  candidateMessageId: string,
  summaryMessageId: string
): boolean {
  const index = scopedMessages.findIndex((m) => m.id === candidateMessageId);
  if (index === -1) return false;
  const { before } = contextWindowV32(scopedMessages, index, 5, 0);
  return before.some((m) => m.id === summaryMessageId) || scopedMessages[index - 1]?.id === summaryMessageId;
}

interface BuildCaseBasketsResult {
  baskets: CaseBasket[];
  itemsByBasketId: Record<string, CaseBasketItem[]>;
  /** Phase C — one per staff message that genuinely qualifies as a consolidated order recap. */
  summaryEvents: FinalBasketSummaryEvent[];
  /** Phase C — only customer confirmations CONTEXTUALLY LINKED to a specific summary/version. */
  customerConfirmationEvents: CustomerConfirmationEvent[];
  /** Phase C — the staff's own post-acceptance "order registered/being prepared" message. */
  staffFinalConfirmationEvents: StaffFinalConfirmationEvent[];
}

/**
 * Walks a case's messages chronologically, building successive basket versions. Historical
 * versions are never mutated — each is pushed once final and only ever gains a
 * `supersededByBasketId` pointer afterward.
 */
export function buildCaseBaskets(
  caseId: string,
  scopedMessages: NormalizedConversationMessageV32[],
  productIndex?: PharmacyProductIndex
): BuildCaseBasketsResult {
  const messages = scopedMessages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const baskets: CaseBasket[] = [];
  const itemsByBasketId: Record<string, CaseBasketItem[]> = {};
  const summaryEvents: FinalBasketSummaryEvent[] = [];
  const customerConfirmationEvents: CustomerConfirmationEvent[] = [];
  const staffFinalConfirmationEvents: StaffFinalConfirmationEvent[] = [];

  let version = 0;
  let items = new Map<string, DraftItem>();
  let status: CaseBasket['status'] = 'draft';
  let createdAt: string | null = null;
  let sourceMessageIds: string[] = [];
  let announcedTotal: AnnouncedTotal | null = null;
  let confirmedAt: string | null = null;
  let confirmedByCustomerAt: string | null = null;
  let lastSummaryMessageId: string | null = null;
  let hasOpenBasket = false;

  const currentBasketId = () => `${caseId}:basket:${version}`;
  const alternativeOffers = extractAlternativeOfferSignals(messages);
  const indexOfMessage = new Map(messages.map((m, i) => [m.id, i]));

  /** Draft keys a staff alternative offer (or the unavailable statement it answers) said are unavailable. */
  function unavailableKeysReplacedBy(reply: NormalizedConversationMessageV32): string[] {
    const replyIndex = indexOfMessage.get(reply.id) ?? -1;
    const offer = alternativeOffers
      .filter((signal) => (indexOfMessage.get(signal.messageId) ?? Infinity) < replyIndex)
      .pop();
    if (!offer) return [];
    const offerIndex = indexOfMessage.get(offer.messageId) ?? -1;
    // Only the customer's direct answer to that offer (no other customer message in between).
    if (messages.slice(offerIndex + 1, replyIndex).some((m) => m.role === 'customer' && m.isMeaningful)) return [];
    if (classifyCustomerOfferResponseV32(reply.text) === 'rejected') return [];
    const statementIds = [offer.messageId, ...(offer.relatedMessageIds ?? [])];
    const keys = new Set<string>();
    for (const id of statementIds) {
      const statement = messages[indexOfMessage.get(id) ?? -1];
      if (!statement) continue;
      for (const clause of availabilityStatementClausesV32(statement.text)) {
        if (clause.state !== 'unavailable') continue;
        const clauseKey = normalizeProductKey(clause.clause);
        for (const key of items.keys()) if (key.length >= 3 && clauseKey.includes(key)) keys.add(key);
      }
    }
    return Array.from(keys);
  }

  function flushCurrentBasket(finalStatus?: CaseBasket['status']) {
    if (!hasOpenBasket) return;
    const basketId = currentBasketId();
    const resolvedStatus = finalStatus ?? status;
    baskets.push({
      basketId,
      caseId,
      version,
      status: resolvedStatus,
      createdAt: createdAt ?? messages[0]?.timestamp.toISOString() ?? new Date(0).toISOString(),
      confirmedAt,
      confirmedByCustomerAt,
      staffId: null,
      announcedTotal,
      sourceMessageIds: [...sourceMessageIds],
      confidence: assessment(
        resolvedStatus === 'confirmed' ? 'strongly_inferred' : 'weakly_inferred',
        resolvedStatus === 'confirmed' ? 0.8 : 0.5,
        'basket.version.flushed',
        []
      ),
      supersededByBasketId: null,
    });
    itemsByBasketId[basketId] = Array.from(items.values()).map((item, i) => ({
      itemId: `${basketId}:item:${i}`,
      basketId,
      productNameRaw: item.productNameRaw,
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: null,
      lineTotal: null,
      sourceMessageId: item.sourceMessageId,
      confidence: item.confidence,
      resolutionStatus: item.resolutionStatus,
    }));
  }

  function startNewVersion(carryForwardItems: Map<string, DraftItem>, initialStatus: CaseBasket['status']) {
    version += 1;
    items = new Map(carryForwardItems);
    status = initialStatus;
    createdAt = null;
    sourceMessageIds = [];
    announcedTotal = null;
    confirmedAt = null;
    confirmedByCustomerAt = null;
    hasOpenBasket = true;
  }

  messages.forEach((message) => {
    if (isFinalBasketSummary(message)) {
      if (!hasOpenBasket) startNewVersion(new Map(), 'draft');
      else if (status === 'confirmed' || status === 'awaiting_confirmation') {
        // A brand new summary after one was already presented/confirmed — treat as a fresh
        // restatement of the SAME version only if no modification triggered a version bump in
        // between (handled by the modification branch below, which itself calls startNewVersion).
      }
      const summaryItems = parseSummaryItems(message);
      if (summaryItems.length > 0) items = draftItemsToMap(summaryItems);
      status = 'awaiting_confirmation';
      createdAt = createdAt ?? message.timestamp.toISOString();
      sourceMessageIds.push(message.id);
      announcedTotal = extractAnnouncedTotal(messages, message, version) ?? announcedTotal;
      lastSummaryMessageId = message.id;
      summaryEvents.push({
        eventId: `${currentBasketId()}:summary:${message.id}`,
        caseId,
        basketId: currentBasketId(),
        basketVersion: version,
        staffId: null,
        messageId: message.id,
        presentedAt: message.timestamp.toISOString(),
        evidence: [refFor(message, `ملخص طلب نهائي: "${message.text.slice(0, 120)}".`)],
        ruleIds: ['commercial.final_summary.marker_matched'],
        confidence: assessment('strongly_inferred', 0.75, 'commercial.final_summary.marker_matched', [
          refFor(message, `تطابقت الرسالة مع علامات ملخص الطلب النهائي: "${message.text.slice(0, 120)}".`),
        ]),
      });
      return;
    }

    if (message.role === 'customer' && message.isMeaningful) {
      const modification = classifyCustomerModification(message.text);
      if (modification && hasOpenBasket && (status === 'awaiting_confirmation' || status === 'confirmed')) {
        flushCurrentBasket('superseded');
        const carried = new Map(items);
        if (modification === 'remove') {
          const targetKey = Array.from(carried.keys()).find((key) =>
            normalizeProductKey(message.text).includes(key.split(' ')[0])
          );
          if (targetKey) carried.delete(targetKey);
        }
        startNewVersion(carried, 'draft');
        sourceMessageIds.push(message.id);
        if (modification === 'add') {
          const extra = extractDraftItemsFromScope(messages, new Set([message.id]));
          if (extra.length > 0) {
            extra.forEach((item) => items.set(normalizeProductKey(item.productNameRaw), item));
          } else {
            // No quantity/unit signal and no resolvable pronoun reference — fall back to the
            // customer's own wording directly, mirroring the 'substitute' branch's pattern.
            const productNameRaw = extractAddedProductName(message.text);
            items.set(normalizeProductKey(productNameRaw), {
              productNameRaw,
              productId: null,
              quantity: null,
              unit: null,
              sourceMessageId: message.id,
              confidence: assessment('weakly_inferred', 0.4, 'basket.item.add_fallback_from_customer_wording', [
                refFor(message, `العميل أضاف صنفًا جديدًا بالاسم فقط دون كمية أو إشارة مرجعية: "${message.text.slice(0, 80)}".`),
              ]),
              resolutionStatus: 'partially_proven',
            });
          }
        }
        if (modification === 'quantity_change') {
          const match = message.text.match(MODIFICATION_QTY_CHANGE_RX);
          const newQty = match ? parseNumberToken(match[1]) : parseQuantityRevision(message.text);
          const lastKey = Array.from(items.keys())[0];
          if (lastKey && newQty != null) {
            const existing = items.get(lastKey)!;
            items.set(lastKey, { ...existing, quantity: newQty, sourceMessageId: message.id });
          }
        }
        if (modification === 'substitute') {
          // Replaces the basket's focus item with whatever the customer named as the swap — a
          // fact taken directly from their own wording, never resolved to a catalog identity here.
          items.clear();
          const productNameRaw = extractSubstituteProductName(message.text);
          items.set(normalizeProductKey(productNameRaw), {
            productNameRaw,
            productId: null,
            quantity: null,
            unit: null,
            sourceMessageId: message.id,
            confidence: assessment('weakly_inferred', 0.4, 'basket.item.substitution_from_customer_wording', [
              refFor(message, `العميل طلب استبدال الصنف: "${message.text.slice(0, 80)}".`),
            ]),
            resolutionStatus: 'partially_proven',
          });
        }
        lastSummaryMessageId = null;
        return;
      }

      if (hasOpenBasket && status === 'awaiting_confirmation' && lastSummaryMessageId) {
        if (WHOLE_BASKET_REJECTION_RX.test(message.text) && isLinkedToSummary(messages, message.id, lastSummaryMessageId)) {
          status = 'cancelled';
          sourceMessageIds.push(message.id);
          return;
        }
        const rejectionSignal = extractRejectionSignals([message])[0];
        const acceptanceSignal = extractAcceptanceSignals([message])[0];
        const localComboConfirmation = CUSTOMER_BASKET_CONFIRMATION_RX.test(message.text);
        const confirmationLinked =
          ((acceptanceSignal || localComboConfirmation) && isLinkedToSummary(messages, message.id, lastSummaryMessageId)) ||
          extractConfirmationSignals(messages)
            .filter(isSubstantiveConfirmationSignal)
            .some((s) => s.relatedMessageIds?.includes(lastSummaryMessageId!));
        if (confirmationLinked && !rejectionSignal) {
          status = 'confirmed';
          confirmedByCustomerAt = message.timestamp.toISOString();
          sourceMessageIds.push(message.id);
          customerConfirmationEvents.push({
            eventId: `${currentBasketId()}:customer_confirm:${message.id}`,
            caseId,
            basketId: currentBasketId(),
            basketVersion: version,
            messageId: message.id,
            confirmedAt: message.timestamp.toISOString(),
            relatedSummaryMessageId: lastSummaryMessageId,
            evidence: [refFor(message, `تأكيد العميل: "${message.text.slice(0, 120)}", مرتبط بملخص الرسالة ${lastSummaryMessageId}.`)],
            ruleIds: ['commercial.customer_confirmation.linked_to_summary'],
            confidence: assessment('strongly_inferred', 0.8, 'commercial.customer_confirmation.linked_to_summary', [
              refFor(message, `تأكيد العميل مرتبط بسياق ملخص الطلب الأخير: "${message.text.slice(0, 120)}".`),
            ]),
          });
          return;
        }
      }

      // Ongoing basket-building content (no summary yet, or unrelated chit-chat): fold in any
      // new item-bearing signal from this single message without forcing a version bump. Once a
      // final summary exists (awaiting_confirmation/confirmed), an unclassified message must NOT
      // silently mutate the basket this way — it already had its chance to be recognized as a
      // modification/confirmation/rejection above; anything else here (e.g. a question like "هو
      // السعر ده شامل التوصيل؟", where a bare "ده" would otherwise spuriously resolve as a
      // product reference) is a no-op, leaving the basket exactly as awaiting confirmation.
      if (!hasOpenBasket) startNewVersion(new Map(), 'draft');
      // Draft-phase quantity revision of the single item being ordered: a new version (history kept),
      // never a new product called "واحدة بس".
      const revisedQuantity = status === 'draft' && items.size === 1 ? parseQuantityRevision(message.text) : null;
      // "ابعت البانادول بس": the customer narrows a multi-item draft to the item(s) named.
      if (status === 'draft' && items.size > 1 && ONLY_THIS_RX.test(message.text) && EXPLICIT_REQUEST_VERB_RX.test(message.text)) {
        const keep = itemsNamedIn(message.text, Array.from(items.keys()));
        if (keep.length > 0 && keep.length < items.size) {
          const kept = new Map(Array.from(items.entries()).filter(([key]) => keep.includes(key)));
          flushCurrentBasket('superseded');
          startNewVersion(kept, 'draft');
          sourceMessageIds.push(message.id);
          return;
        }
      }
      if (revisedQuantity != null) {
        const [key, existing] = Array.from(items.entries())[0];
        flushCurrentBasket('superseded');
        startNewVersion(new Map(items), 'draft');
        items.set(key, { ...existing, quantity: revisedQuantity, sourceMessageId: message.id });
        sourceMessageIds.push(message.id);
        return;
      }
      if (status === 'draft') {
        const newItems = extractDraftItemsFromScope(messages, new Set([message.id]));
        // Accepting a staff alternative replaces the item the staff said was unavailable: a new
        // version without it (history kept), never both the unavailable original and its substitute.
        const replaced = newItems.length ? unavailableKeysReplacedBy(message) : [];
        const newKeys = new Set(newItems.map((item) => normalizeProductKey(item.productNameRaw)));
        const toRemove = replaced.filter((key) => !newKeys.has(key));
        if (toRemove.length) {
          flushCurrentBasket('superseded');
          startNewVersion(new Map(Array.from(items.entries()).filter(([key]) => !toRemove.includes(key))), 'draft');
        }
        newItems.forEach((item) => {
          items.set(normalizeProductKey(item.productNameRaw), item);
          sourceMessageIds.push(message.id);
        });
        if (newItems.length === 0 && productIndex) {
          const direct = directCatalogMentionItem(message, productIndex);
          if (direct) {
            items.set(normalizeProductKey(direct.productNameRaw), direct);
            sourceMessageIds.push(message.id);
          }
        }
      }
      return;
    }

    if (message.role === 'staff' && message.isMeaningful && hasOpenBasket) {
      if (status === 'confirmed' && isStaffFinalConfirmation(message)) {
        confirmedAt = message.timestamp.toISOString();
        sourceMessageIds.push(message.id);
        staffFinalConfirmationEvents.push({
          eventId: `${currentBasketId()}:staff_confirm:${message.id}`,
          caseId,
          basketId: currentBasketId(),
          basketVersion: version,
          staffId: null,
          messageId: message.id,
          confirmedAt: message.timestamp.toISOString(),
          evidence: [refFor(message, `تأكيد نهائي من الموظف بعد قبول العميل: "${message.text.slice(0, 120)}".`)],
          ruleIds: ['commercial.staff_final_confirmation.after_customer_acceptance'],
          confidence: assessment('strongly_inferred', 0.85, 'commercial.staff_final_confirmation.after_customer_acceptance', [
            refFor(message, `رسالة تأكيد نهائي من الموظف: "${message.text.slice(0, 120)}".`),
          ]),
        });
        return;
      }
      // Staff building the basket before any consolidated summary (e.g. confirming each item as offered).
      if (status === 'draft') {
        extractDraftItemsFromScope(messages, new Set([message.id])).forEach((item) => {
          items.set(normalizeProductKey(item.productNameRaw), item);
        });
      }
    }
  });

  flushCurrentBasket();

  // Wire supersededByBasketId forward and enforce "never mutate historical state" by only
  // touching the pointer field on already-flushed (immutable-in-spirit) records here, once.
  for (let i = 0; i < baskets.length - 1; i += 1) {
    baskets[i] = { ...baskets[i], status: baskets[i].status === 'cancelled' ? 'cancelled' : 'superseded', supersededByBasketId: baskets[i + 1].basketId };
  }

  return { baskets, itemsByBasketId, summaryEvents, customerConfirmationEvents, staffFinalConfirmationEvents };
}

/** Refines a ConversationCase's coarse status once its basket state is known — Phase B stops at 'customer_confirmed'. */
export function deriveCaseStatusFromBasket(baseline: CaseStatus, latestBasket: CaseBasket | null): CaseStatus {
  if (!latestBasket) return baseline;
  if (latestBasket.status === 'cancelled') return 'cancelled';
  if (latestBasket.confirmedAt) return 'customer_confirmed';
  if (latestBasket.status === 'confirmed') return 'customer_confirmed';
  if (latestBasket.status === 'awaiting_confirmation') return 'awaiting_customer_confirmation';
  return 'basket_building';
}