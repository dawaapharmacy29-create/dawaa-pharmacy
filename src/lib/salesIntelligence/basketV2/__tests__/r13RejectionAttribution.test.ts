// Phase I.B.4 — R13 closure: rejection-target attribution.
//
// Root cause: computeActiveProductCandidates() used to treat ANY whole-item rejection ("لا"/"مش
// عايز") as invalidating EVERY product identity ever mentioned earlier in the conversation,
// regardless of what the rejection was actually about. R13's real shape: the customer clearly
// resolves "فليكس ليكس" to Flexilax in message 1; five messages later a "لا" replies to a staff
// clarification about a COMPLETELY UNRELATED product ("حضرتك تقصد كومتركس؟") — and that unrelated
// "لا" retroactively wiped Flexilax out of the active-candidate set for the rest of the
// conversation, so Flexilax could never be safely re-confirmed and the case never surfaced for
// human review either (see basketReconstructionV2.ts's own REVIEW_SIGNAL path, which needs a real
// action_targets_product edge to react to — one the rejection action never got).
//
// Fix: resolveRejectionTarget() (productMentionTracker.ts) attributes a bare rejection to the
// CURRENT topic — the identity/identities whose most recent mention is the closest one strictly
// before the rejection — never to the whole conversation history. conversationEntityGraphV2.ts uses
// it to give the reject ActionNode a real target edge (safe when resolved, downgraded to review by
// the existing gateOnResolvedIdentity() when not, or split into multiple `unsafe` edges — one per
// tied candidate — on a genuine ambiguous tie), so basketReconstructionV2.ts's already-existing
// "rejection antecedent ambiguous" REVIEW_SIGNAL handling can react instead of the action silently
// producing no edge at all.
import { describe, expect, it } from 'vitest';
import { buildBasketFromConversation, messagesFrom } from './testUtils';
import { buildProductMentions, computeActiveProductCandidates } from '../../quantityReference/productMentionTracker';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

const FLEXILAX_CATALOG = catalogFrom([
  { id: 'p-flexilax', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: '84', source: 'catalog_import' },
]);

const ANTINAL_ZURCAL_CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'Antinal 24 cap', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  { id: 'p-zurcal', name: 'Zurcal 20mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '96', source: 'catalog_import' },
]);

describe('I.B.4 — R13 rejection-target attribution', () => {
  it('(R13-shaped) a rejection replying to an UNRELATED staff clarification never invalidates an already-resolved earlier product, and surfaces human review for the ambiguous target', () => {
    const raw = `[4/25/26, 1:34:50 PM] Customer: فليكس ليكس
[4/25/26, 1:35:22 PM] Customer: هعوز شريط
[4/25/26, 1:35:23 PM] Customer: وموجود كيرلكس
[4/25/26, 1:35:53 PM] You: حضرتك تقصد كومتركس ؟
[4/25/26, 1:36:01 PM] Customer: لا`;
    const messages = messagesFrom(raw);
    const mentions = buildProductMentions(messages, { productIndex: FLEXILAX_CATALOG });
    const activeAfterRejection = computeActiveProductCandidates(messages, mentions, messages.length);
    expect(activeAfterRejection.some((c) => c.identityKey === 'p-flexilax')).toBe(true);

    const { currentBasket } = buildBasketFromConversation(raw, 'r13-shaped', { productIndex: FLEXILAX_CATALOG });
    expect(currentBasket.pendingReviewSignals.some((s) => s.reason === 'reject_antecedent_ambiguous')).toBe(true);
  });

  it('(negative sibling) an explicit rejection that DOES name the previously-requested product actually rejects it', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فليكس ليكس
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: لا مش عايز الفليكسيلاكس`;
    const messages = messagesFrom(raw);
    const mentions = buildProductMentions(messages, { productIndex: FLEXILAX_CATALOG });
    const activeAfterRejection = computeActiveProductCandidates(messages, mentions, messages.length);
    expect(activeAfterRejection.some((c) => c.identityKey === 'p-flexilax')).toBe(false);
  });

  it('(ambiguous sibling) a bare rejection after TWO products offered in the same message never drops either — stays ambiguous', () => {
    const raw = `[9/15/26, 9:00:00 AM] You: ممكن انتينال أو زوركال
[9/15/26, 9:01:00 AM] Customer: لا`;
    const messages = messagesFrom(raw);
    const mentions = buildProductMentions(messages, { productIndex: ANTINAL_ZURCAL_CATALOG });
    const activeAfterRejection = computeActiveProductCandidates(messages, mentions, messages.length);
    const identityKeys = activeAfterRejection.map((c) => c.identityKey);
    expect(identityKeys).toContain('p-antinal');
    expect(identityKeys).toContain('p-zurcal');
  });

  it('(requested product survives unrelated rejection) a customer-requested product stays active/requested when the customer rejects a SEPARATE staff-suggested add-on', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: عندنا زوركال كمان
[9/15/26, 9:02:00 AM] Customer: لا`;
    const messages = messagesFrom(raw);
    const mentions = buildProductMentions(messages, { productIndex: ANTINAL_ZURCAL_CATALOG });
    const activeAfterRejection = computeActiveProductCandidates(messages, mentions, messages.length);
    expect(activeAfterRejection.some((c) => c.identityKey === 'p-antinal')).toBe(true);
  });
});
