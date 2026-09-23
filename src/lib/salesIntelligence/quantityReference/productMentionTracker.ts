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
import type { ProductMentionRole, ProductMentionV2 } from './quantityReferenceTypes';

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

/**
 * I.B.2.1 instruction #7's "several active products" hardening needs a customer's own single
 * message ("انتينال وزوركال موجودين؟") to yield TWO distinct product identities, not one garbled
 * blob — the I.B.2 tracker's known limitation (documented in its own commit) that made the
 * multi-product ambiguity tests need artificially-split messages. Splits on a "و" that is NOT the
 * very first character (so a genuine product name starting with "و" is never mangled) and is
 * immediately followed by another Arabic letter (so "و" as a separate word, e.g. after "حضرتك و",
 * still requires a real word boundary). Deliberately conservative: falls back to the original,
 * unsplit text whenever the split would produce a trivially short fragment.
 */
function splitConjunctionList(text: string): string[] {
  if (text.length < 4) return [text];
  // Requires at least one PRECEDING SPACE before the "و" (not just "not string start") — otherwise
  // this would wrongly cut apart any product name whose own second letter happens to be و (e.g.
  // "زوركال" -> "ز" + "وركال"), a real bug caught by this module's own tests.
  const parts = text
    .split(/\s+و(?=[ء-ي])/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 && parts.every((p) => p.length >= 2) ? parts : [text];
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
      });
      return;
    }

    const enumMatch = role === 'staff_offer' ? core.match(ENUMERATION_OR_RX) : null;
    const isEnumeration = Boolean(enumMatch);
    const parts = enumMatch ? [enumMatch[1].trim(), enumMatch[2].trim()] : splitConjunctionList(core);
    const groupId = isEnumeration ? `grp:${message.id}` : undefined;

    parts.forEach((part, partIndex) => {
      let resolvedProductId: string | null = null;
      if (options.productIndex) {
        const result = resolveProductMention(part, options.productIndex, options.resolveOptions);
        resolvedProductId = result.selected?.product.productId ?? null;
      }
      mentions.push({
        mentionId: `pm:${message.id}:${seq++}`,
        sourceMessageId: message.id,
        rawText: parts.length > 1 ? part : rawText,
        role,
        resolvedProductId,
        identityKey: resolvedProductId ?? `text:${normalizeProductKey(part)}`,
        messageIndex,
        timestamp: message.timestamp.toISOString(),
        ...(groupId ? { enumerationGroupId: groupId, enumerationIndex: partIndex } : {}),
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
  const relevant = mentions.filter((m) => m.messageIndex < beforeMessageIndex && m.role !== 'staff_availability');
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
