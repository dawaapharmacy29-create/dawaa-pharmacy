// Phase I.B.3 — Price Intelligence V1 (instruction #15/#16).
//
// A genuinely NEW capability this phase introduces (no prior phase built price-ROLE
// classification) — reuses whatsappSemanticSignalsV32's own PRICE_RX-equivalent detection
// approach (a bare "<number> جنيه/ج" pattern) but adds the role differentiation
// (item_unit_price vs item_line_total vs order_total vs delivery_fee vs discount vs cashback)
// that nothing before this phase attempted. Deliberately conservative: a price is only ever
// `item_unit_price` when the message's own scope is unambiguous (see priceIntelligenceV1.test.ts);
// everything else defaults to `unknown_price` rather than guessing — instruction #15's
// "الإجمالي 250 must not attach to one item" is enforced by NEVER classifying a total-marked
// price as anything but `order_total`, structurally incapable of becoming an item price.
import type { PriceRole } from './basketV2Types';

const PRICE_NUMBER_RX = /([0-9]+(?:\.[0-9]+)?)\s*(?:جنيه|جنيها|ج\.?م\.?|le|egp)?/i;

const ORDER_TOTAL_MARKER_RX = /إجمالي\s*الحساب|الحساب\s*كل?ه|الإجمالي|الاجمالي|المجموع|(?:كده\s*)?الحساب(?!\s*٭?كام)/i;
const DELIVERY_FEE_MARKER_RX = /توصيل|دليفري|delivery/i;
const DISCOUNT_MARKER_RX = /خصم|تخفيض|عرض/i;
const CASHBACK_MARKER_RX = /كاش\s*باك|كاشباك|cashback/i;
const PRICE_QUESTION_RX = /بكام|كام\s*(?:كده)?[؟?]|السعر\s*كام|سعر.*كام/i;

export interface PriceMentionV1 {
  rawText: string;
  value: number;
  priceRole: PriceRole;
  confidence: number;
  ruleIds: string[];
}

/**
 * Extracts every price mention from ONE message's text, with a role. `hasSingleActiveProduct`
 * tells this function whether exactly one product is currently in scope in the conversation at
 * this point — the ONLY condition under which a plain, unmarked price may be read as that
 * product's own unit price (instruction #15's "العلبة 55 may attach to currently scoped single
 * product"). Never called with case-crossing state; the caller (conversationEntityGraphV2.ts)
 * computes `hasSingleActiveProduct` from the same active-candidate tracker quantityIntelligenceV2
 * already uses, never a fresh one.
 */
export function extractPriceMentions(text: string, hasSingleActiveProduct: boolean): PriceMentionV1[] {
  // A bare price QUESTION ("بكام؟") carries no stated amount to attach — not a price mention at all.
  if (PRICE_QUESTION_RX.test(text) && !/[0-9]/.test(text)) return [];

  const mentions: PriceMentionV1[] = [];
  const rx = new RegExp(PRICE_NUMBER_RX.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    const value = Number(match[1]);
    const before = text.slice(Math.max(0, match.index - 25), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 15);
    const context = `${before} ${after}`;

    let role: PriceRole;
    const ruleIds: string[] = [];
    if (ORDER_TOTAL_MARKER_RX.test(context)) {
      role = 'order_total';
      ruleIds.push('price.role.order_total_marker');
    } else if (DELIVERY_FEE_MARKER_RX.test(context)) {
      role = 'delivery_fee';
      ruleIds.push('price.role.delivery_fee_marker');
    } else if (DISCOUNT_MARKER_RX.test(context)) {
      role = 'discount';
      ruleIds.push('price.role.discount_marker');
    } else if (CASHBACK_MARKER_RX.test(context)) {
      role = 'cashback';
      ruleIds.push('price.role.cashback_marker');
    } else if (hasSingleActiveProduct) {
      // No total/fee/discount marker, and exactly one product is in scope — the ONLY case a bare
      // price is read as that product's own unit price, never guessed when scope is ambiguous.
      role = 'item_unit_price';
      ruleIds.push('price.role.single_active_product_unit_price');
    } else {
      role = 'unknown_price';
      ruleIds.push('price.role.unmarked_ambiguous_scope');
    }

    mentions.push({
      rawText: match[0].trim(),
      value,
      priceRole: role,
      confidence: role === 'unknown_price' ? 0.3 : role === 'item_unit_price' ? 0.6 : 0.85,
      ruleIds,
    });
  }
  return mentions;
}
