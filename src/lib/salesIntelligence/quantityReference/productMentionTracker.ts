// Phase I.B.2 — the missing prerequisite layer the spec's referenceResolverV2 assumes exists:
// "ProductMention candidates" and "current basket candidates" (instruction #9). I.B.1 only scoped
// resolving an ALREADY-ISOLATED phrase against the catalog (pharmacyProductResolverV2.ts); nothing
// in this codebase previously found product-name-shaped spans inside a live conversation and
// tracked which ones are still "active" as the conversation goes on. Deliberately lightweight — a
// heuristic span-finder reusing V32's own request/acceptance/rejection vocabulary, never a full
// product NER model. Fuzzy resolution (when a PharmacyProductIndex is supplied) is entirely
// optional; without one, mentions still track by normalized raw text, which is enough for the
// reference/quantity linking this phase needs.
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { extractRejectionSignals, isRequestCandidate } from '../../whatsappSemanticSignalsV32';
import { normalizeProductKey, stripRequestPrefix } from '../caseBasketEngine';
import type {
  PharmacyProductIndex,
  ResolveProductMentionOptions,
} from '../pharmacyProducts/pharmacyProductResolverV2';
import { resolveProductMention } from '../pharmacyProducts/pharmacyProductResolverV2';
import type { MentionValidity, ProductMentionRole, ProductMentionV2 } from './quantityReferenceTypes';
import type { ProductResolutionResult } from '../pharmacyProducts/pharmacyProductResolverV2';

// A staff message that ONLY confirms availability, with no product content of its own to add —
// e.g. bare "موجود"/"متوفر". Distinguished from a staff_offer (which actually names/describes a
// product) so a pronoun resolving through it still points at whatever was named earlier.
const AVAILABILITY_ONLY_RX = /^(?:اه\s*)?(?:موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?)[!.، ]*$/i;
const OFFER_MARKER_RX = /موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?|عندنا|هبعت(?:لك|لحضرتك|هم|ه)?|ينفع|ممكن(?:\s*تاخد)?/i;
const STAFF_FILLER_PREFIX_RX = /^\s*(?:يا\s*فندم|حضرتك)?[،, ]*\s*/i;

/** Staff "X is not available" — shared with referenceResolverV2's substitution-context detection. */
export const NOT_AVAILABLE_RX = /مش\s*موجود[ةه]?|مفيش|خلص(?:ت)?\s*(?:من\s*)?عندنا|مش\s*متوفر[ةه]?/i;
const ALTERNATIVE_INTRO_RX = /(?:بس|لكن)?\s*(?:و)?\s*فيه\s+(.+)$/i;

// Conversational filler that carries no product identity of its own — stripped ONLY to compute
// the identity-bucketing key, never from the stored `rawText` fact. Deliberately NOT using \b:
// JS's \b never matches next to Arabic script (Arabic letters aren't \w) — see the same pitfall
// documented in pharmacyNormalization.ts / whatsappSemanticSignalsV32.ts.
const FILLER_WORDS_RX =
  /(?:موجودين|متوفرين|موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?|برضو|كمان|ايضا|أيضا|كذلك|تقريبا|ان\s*شاء\s*الله|باذن\s*الله|يا\s*فندم|ي\s*فندم|لو\s*سمحت)/gi;
const COLLECTIVE_REFERENCE_RX = /^(?:الاتنين|كلهم|الكل|كله)$/;
// I.B.2.1 fix: a staff reply like "متوفر ي فندم" or "موجود ان شاء الله" is STILL just a bare
// availability confirmation once the trailing pleasantry is stripped as filler — real Dawaa
// examples ("متوفر ي فندم", "موجود ان شاء الله") were wrongly kept as staff_offer, seeding a
// garbled identity ("ي فندم") that a later pronoun could wrongly resolve to.
const AVAILABILITY_CORE_RX = /^(?:موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?)$/;
// I.B.2.1 fix: a bare title/address ("دكتوره مي", "يا فندم") is not a product request — a real
// example ("هو ممكن ياخد ده" / customer: "دكتوره مي") was wrongly kept as a customer_request
// mention, becoming a bogus competing identity for a later reference to resolve against.
const ADDRESS_ONLY_RX = /^(?:يا\s*)?(?:دكتور[ةه]?|فندم|باشا|هانم|دكتوره\s+\S+|دكتور\s+\S+)$/i;
// A message that is ONLY a quantity-operation instruction ("خليهم 3"/"زود واحدة"/"شيل واحدة")
// names no new product — quantityIntelligenceV2.ts is what interprets these, not this tracker.
const QUANTITY_OPERATION_ONLY_RX = /^(?:لا\s*)?(?:خلي(?:ه|هم|ها)?|زود(?:ي)?|شيل(?:ي)?)\b/i;
const PURE_QUANTITY_RX =
  /^[0-9]+$|^(?:واحد[ةه]?|اتنين|اثنين|تلات(?:ة|ه)?|ثلاث(?:ة|ه)?|أربع(?:ة|ه)?|اربع(?:ة|ه)?|خمس(?:ة|ه)?)(?:\s*(?:علبة|علبه|علب|شريط|عبوة|عبوه|كيس|قرص|كبسولة|كبسوله|حبة|حبه))?$/;

function cleanStaffOfferText(text: string): string {
  return text.replace(STAFF_FILLER_PREFIX_RX, '').trim() || text.trim();
}

// I.B.2.1 bug fix: `stripped || rawText` looked like a safe fallback, but an EMPTY result is
// exactly the meaningful signal callers check for ("this message was pure filler, e.g. "موجود ان
// شاء الله"") — `||` treats '' as falsy and silently un-does the strip, which is what let two real
// examples ("موجود ان شاء الله", "متوفر ي فندم") keep their full untouched text as a bogus identity.
function identityCoreText(rawText: string): string {
  return rawText.replace(FILLER_WORDS_RX, ' ').replace(/\s+/g, ' ').trim();
}

// I.B.2.1 instruction #7 — an explicit, single-message "X أو Y" enumerated offer (e.g. staff
// "ممكن زوركال أو نيكسيوم"). Distinct from a plain "و" (and) list below: "أو" means the customer
// picks ONE, which is exactly the structural evidence an ordinal reference ("التاني") may safely
// use — a plain "and" list never licenses that.
const ENUMERATION_OR_RX = /^(.+?)\s+(?:أو|او)\s+(.+)$/;

// I.B.3.1 — structural root cause #2 ("phantom active candidates"): a customer message phrased as
// an AVAILABILITY/PRICE QUESTION about something already under discussion ("موجود عندكم الغسول
// ده" = "do you have THIS wash") was previously indistinguishable, at this layer, from a customer
// naming a brand-new product ("عايز غسول فيتشي"). isRequestCandidate() (whatsappSemanticSignalsV32,
// reused as-is) is deliberately broad — built for response-TIMING purposes, where "did the customer
// say something substantive" is exactly what's needed — but this tracker was repurposing that same
// broad signal as its product-mention gate. The real, general shape of the bug: an
// availability/price marker word CO-OCCURRING with a demonstrative pronoun referring back ("ده"/
// "دي"/"دول"/"دا") is a QUESTION about an existing topic, never a fresh product name — this is true
// regardless of which specific nouns sit in between. \p{L}/\p{N} lookaround (not \b) for the same
// reason documented in whatsappSemanticSignalsV32.ts's own PRODUCT_REFERENCE_RX.
const DEMONSTRATIVE_REFERENCE_RX = /(?<![\p{L}\p{N}])(?:ده|دي|دول|دا)(?![\p{L}\p{N}])/u;
const AVAILABILITY_OR_PRICE_QUESTION_MARKER_RX = /موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?|عندك(?:م)?|فيه|بكام|كام(?:\s*كده)?|سعر[ةه]?/i;

/**
 * I.B.3.1 instruction #5 — explicit ProductMention validity, computed at the EARLIEST layer
 * (mention creation itself), so every downstream consumer (computeActiveProductCandidates,
 * quantityIntelligenceV2, referenceResolverV2, the I.B.3 graph) inherits the fix for free rather
 * than needing its own Basket-level exception. `resolution` is this candidate's own
 * ProductResolverV2 result when a PharmacyProductIndex was supplied — never re-derived, only read.
 */
function classifyMentionValidity(rawTextForClassification: string, resolution: ProductResolutionResult | null): MentionValidity {
  if (resolution?.selected) return 'canonical_resolved';
  if (resolution?.ambiguous) return 'ambiguous';
  const core = identityCoreText(rawTextForClassification);
  if (core.length === 0) return 'non_product';
  if (
    COLLECTIVE_REFERENCE_RX.test(core) ||
    AVAILABILITY_CORE_RX.test(core) ||
    ADDRESS_ONLY_RX.test(core.trim()) ||
    PURE_QUANTITY_RX.test(core)
  ) {
    return 'non_product';
  }
  if (DEMONSTRATIVE_REFERENCE_RX.test(rawTextForClassification) && AVAILABILITY_OR_PRICE_QUESTION_MARKER_RX.test(rawTextForClassification)) {
    return 'non_product';
  }
  return 'unresolved_but_product_like';
}

interface ConjunctionBoundary {
  index: number;
  length: number;
}

/** Every "و" boundary that is NOT the very first character (a genuine product name starting with
 * "و" is never mangled) and is immediately followed by another Arabic letter (a real word
 * boundary, not e.g. "زوركال" -> "ز"+"وركال"). Only finds candidate CUT POINTS — never decides by
 * itself whether to actually cut there; see resolveProductSegments(). */
function findConjunctionBoundaries(text: string): ConjunctionBoundary[] {
  const boundaries: ConjunctionBoundary[] = [];
  const re = /\s+و(?=[ء-ي])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    boundaries.push({ index: m.index, length: m[0].length });
  }
  return boundaries;
}

interface ProductSegment {
  text: string;
  start: number;
  end: number;
  resolution: ProductResolutionResult | null;
}

/**
 * I.B.3.1 instructions #2/#3 — structural root cause #1 fix ("conjunction splitting"). The old
 * splitConjunctionList() blindly cut on every "و" boundary BEFORE ever consulting the catalog,
 * which mangled a product name with an internal transliterated "و" (e.g. "سنترم ومان" = "Centrum
 * Woman" was split into "سنترم" + "مان"). This function is CATALOG-FIRST / longest-safe-match:
 * 1. Always try the WHOLE phrase against the catalog first. If it safely resolves, the whole phrase
 *    IS one product mention — never split a genuine (possibly multi-word, possibly containing "و")
 *    product name apart.
 * 2. Only when the whole phrase does NOT safely resolve does this fall back to conjunction
 *    boundaries, splitting into independent candidate spans and resolving EACH ONE SEPARATELY —
 *    never re-deriving resolveProductMention()'s own resolution logic, only deciding how many times
 *    to call it and on what spans. A split-out piece that itself fails to resolve is still returned
 *    (as an unresolved segment) rather than silently dropped — classifyMentionValidity() is what
 *    decides whether it may ever become an active candidate, not this function.
 * This naturally handles an arbitrary number of conjunction-joined products (splitting occurs at
 * every boundary at once, not just the first), never invents multi-word spans beyond what the
 * conjunction boundaries themselves delimit (no O(N×catalog) span brute force).
 */
function resolveProductSegments(
  core: string,
  productIndex: PharmacyProductIndex | undefined,
  resolveOptions: ResolveProductMentionOptions | undefined
): ProductSegment[] {
  const whole = productIndex ? resolveProductMention(core, productIndex, resolveOptions) : null;
  if (whole?.selected) {
    return [{ text: core, start: 0, end: core.length, resolution: whole }];
  }

  const boundaries = findConjunctionBoundaries(core);
  if (boundaries.length === 0) {
    return [{ text: core, start: 0, end: core.length, resolution: whole }];
  }

  const rawPieces: Array<{ text: string; start: number }> = [];
  let cursor = 0;
  boundaries.forEach((b) => {
    const raw = core.slice(cursor, b.index);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingWhitespace = raw.length - raw.trimStart().length;
      rawPieces.push({ text: trimmed, start: cursor + leadingWhitespace });
    }
    cursor = b.index + b.length;
  });
  const tailRaw = core.slice(cursor);
  const tailTrimmed = tailRaw.trim();
  if (tailTrimmed.length > 0) {
    const leadingWhitespace = tailRaw.length - tailRaw.trimStart().length;
    rawPieces.push({ text: tailTrimmed, start: cursor + leadingWhitespace });
  }

  const validPieces = rawPieces.filter((p) => p.text.length >= 2);
  if (validPieces.length <= 1) {
    // Nothing safely splittable — deliberately conservative: keep the whole (still-unresolved)
    // phrase as ONE segment rather than guess.
    return [{ text: core, start: 0, end: core.length, resolution: whole }];
  }

  return validPieces.map((p) => ({
    text: p.text,
    start: p.start,
    end: p.start + p.text.length,
    resolution: productIndex ? resolveProductMention(p.text, productIndex, resolveOptions) : null,
  }));
}

export interface BuildProductMentionsOptions {
  productIndex?: PharmacyProductIndex;
  resolveOptions?: ResolveProductMentionOptions;
}

/**
 * Extracts ProductMentionV2s from a SINGLE case's already-scoped, chronological messages. Never
 * looks outside `messages` — the caller is responsible for Case-scoping (see instruction #15);
 * every downstream consumer (referenceResolverV2, quantityIntelligenceV2) inherits that scoping
 * for free by only ever being handed the mentions this function returns for the same array.
 */
export function buildProductMentions(
  messages: NormalizedConversationMessageV32[],
  options: BuildProductMentionsOptions = {}
): ProductMentionV2[] {
  const mentions: ProductMentionV2[] = [];
  let seq = 0;

  messages.forEach((message, messageIndex) => {
    if (!message.isMeaningful) return;
    if (message.role === 'customer' && QUANTITY_OPERATION_ONLY_RX.test(message.text.trim())) return;

    let role: ProductMentionRole | null = null;
    let rawText = '';

    if (message.role === 'customer' && isRequestCandidate(message)) {
      const stripped = stripRequestPrefix(message.text);
      if (stripped.length >= 2 && !PURE_QUANTITY_RX.test(stripped) && !ADDRESS_ONLY_RX.test(stripped.trim())) {
        role = 'customer_request';
        rawText = stripped;
      }
    } else if (message.role === 'staff' && NOT_AVAILABLE_RX.test(message.text)) {
      const altMatch = message.text.match(ALTERNATIVE_INTRO_RX);
      if (altMatch) {
        role = 'staff_offer';
        rawText = altMatch[1].trim();
      } else {
        role = 'staff_availability';
        rawText = message.text.trim();
      }
    } else if (message.role === 'staff' && OFFER_MARKER_RX.test(message.text)) {
      role = AVAILABILITY_ONLY_RX.test(message.text.trim()) ? 'staff_availability' : 'staff_offer';
      rawText = cleanStaffOfferText(message.text);
    }

    if (!role || !rawText) return;

    // A staff "offer" whose content, once conversational filler is stripped, is empty or is
    // itself just a collective reference ("الاتنين") names no NEW product — downgrade rather than
    // let it become its own bogus identity competing with the real ones.
    const core = identityCoreText(rawText);
    if (role === 'staff_offer' && (core.length === 0 || COLLECTIVE_REFERENCE_RX.test(core) || AVAILABILITY_CORE_RX.test(core))) {
      role = 'staff_availability';
    }

    if (role === 'staff_availability') {
      mentions.push({
        mentionId: `pm:${message.id}:${seq++}`,
        sourceMessageId: message.id,
        rawText,
        role,
        resolvedProductId: null,
        identityKey: `text:${normalizeProductKey(core)}`,
        messageIndex,
        timestamp: message.timestamp.toISOString(),
        validity: classifyMentionValidity(rawText, null),
        sourceOffsetStart: 0,
        sourceOffsetEnd: rawText.length,
      });
      return;
    }

    const enumMatch = role === 'staff_offer' ? core.match(ENUMERATION_OR_RX) : null;
    if (enumMatch) {
      // Explicit "X أو Y" enumerated offer — a different, already-correct mechanism than
      // conjunction splitting (the customer picks ONE named alternative), never routed through
      // resolveProductSegments()'s catalog-first logic.
      const groupId = `grp:${message.id}`;
      [enumMatch[1].trim(), enumMatch[2].trim()].forEach((part, partIndex) => {
        const resolution = options.productIndex ? resolveProductMention(part, options.productIndex, options.resolveOptions) : null;
        const offsetStart = rawText.indexOf(part);
        mentions.push({
          mentionId: `pm:${message.id}:${seq++}`,
          sourceMessageId: message.id,
          rawText: part,
          role,
          resolvedProductId: resolution?.selected?.product.productId ?? null,
          identityKey: resolution?.selected?.product.productId ?? `text:${normalizeProductKey(part)}`,
          messageIndex,
          timestamp: message.timestamp.toISOString(),
          enumerationGroupId: groupId,
          enumerationIndex: partIndex,
          validity: classifyMentionValidity(part, resolution),
          sourceOffsetStart: offsetStart === -1 ? null : offsetStart,
          sourceOffsetEnd: offsetStart === -1 ? null : offsetStart + part.length,
        });
      });
      return;
    }

    const segments = resolveProductSegments(core, options.productIndex, options.resolveOptions);
    segments.forEach((segment) => {
      const resolvedProductId = segment.resolution?.selected?.product.productId ?? null;
      const offsetStart = rawText.indexOf(segment.text);
      mentions.push({
        mentionId: `pm:${message.id}:${seq++}`,
        sourceMessageId: message.id,
        rawText: segments.length > 1 ? segment.text : rawText,
        role,
        resolvedProductId,
        identityKey: resolvedProductId ?? `text:${normalizeProductKey(segment.text)}`,
        messageIndex,
        timestamp: message.timestamp.toISOString(),
        validity: classifyMentionValidity(segment.text, segment.resolution),
        sourceOffsetStart: offsetStart === -1 ? null : offsetStart,
        sourceOffsetEnd: offsetStart === -1 ? null : offsetStart + segment.text.length,
      });
    });
  });

  return mentions;
}

export interface ActiveProductCandidate {
  identityKey: string;
  mentionIds: string[];
  lastMentionId: string;
  lastMessageIndex: number;
  /** True when the most recent mention of this identity came from a staff offer/availability reply rather than the customer's own words. */
  lastMentionWasStaffOffer: boolean;
}

/**
 * The "currently active products" concept instructions #11/#12/#17 require: distinct product
 * identities mentioned strictly BEFORE `beforeMessageIndex` in this same case, excluding any
 * identity whose most recent mention was followed by an explicit whole-item customer rejection
 * with no later re-mention. Never "nearest mention wins" by itself — this only computes the
 * CANDIDATE SET; referenceResolverV2.ts and quantityIntelligenceV2.ts do the actual scored
 * selection among these candidates.
 */
export function computeActiveProductCandidates(
  messages: NormalizedConversationMessageV32[],
  mentions: ProductMentionV2[],
  beforeMessageIndex: number
): ActiveProductCandidate[] {
  // staff_availability mentions ("موجود" alone) carry no new product identity of their own — they
  // only confirm whatever was named earlier, so they must never seed their own candidate bucket.
  // I.B.3.1 fix ("phantom active candidates", instruction #4/#5): a `non_product` mention (a
  // reference-question like "موجود عندكم الغسول ده", a bare address/quantity/collective phrase)
  // must never seed a candidate bucket either — fixed HERE, the earliest layer both quantity
  // linking and reference resolution (and the I.B.3 graph) share, so every consumer inherits the
  // fix without its own exception.
  const relevant = mentions.filter(
    (m) => m.messageIndex < beforeMessageIndex && m.role !== 'staff_availability' && m.validity !== 'non_product'
  );
  const byIdentity = new Map<string, ProductMentionV2[]>();
  relevant.forEach((m) => {
    const bucket = byIdentity.get(m.identityKey);
    if (bucket) bucket.push(m);
    else byIdentity.set(m.identityKey, [m]);
  });

  const rejectionSignals = extractRejectionSignals(messages.slice(0, beforeMessageIndex));
  const rejectionIndices = rejectionSignals.map((s) => messages.findIndex((m) => m.id === s.messageId));

  const candidates: ActiveProductCandidate[] = [];
  byIdentity.forEach((bucketMentions, identityKey) => {
    const sorted = bucketMentions.slice().sort((a, b) => a.messageIndex - b.messageIndex);
    const last = sorted[sorted.length - 1];
    // Rejected only if a whole-item rejection occurs strictly after this identity's last mention
    // and no LATER mention of the same identity re-establishes it.
    const rejectedAfter = rejectionIndices.some((idx) => idx > last.messageIndex);
    if (rejectedAfter) return;
    candidates.push({
      identityKey,
      mentionIds: sorted.map((m) => m.mentionId),
      lastMentionId: last.mentionId,
      lastMessageIndex: last.messageIndex,
      lastMentionWasStaffOffer: last.role === 'staff_offer' || last.role === 'staff_availability',
    });
  });

  return candidates.sort((a, b) => b.lastMessageIndex - a.lastMessageIndex);
}
