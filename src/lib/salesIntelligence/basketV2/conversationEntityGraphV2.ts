// Phase I.B.3 — Conversation Entity Graph V2 (instruction #2/#3).
//
// LAYER A only (instruction #1): builds semantic facts and relationships. Never decides basket
// state — that is basketReconstructionV2.ts's job, consuming this graph's nodes/edges only.
//
// Consumes I.B.1/I.B.2/I.B.2.1 AS-IS: buildProductMentions, extractQuantityMentionsV2,
// extractReferenceMentionsV2, computeActiveProductCandidates, and every mention's own
// safeForBasketLinking. Nothing here re-derives product/quantity/reference resolution.
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { buildProductMentions, computeActiveProductCandidates } from '../quantityReference/productMentionTracker';
import type { BuildProductMentionsOptions } from '../quantityReference/productMentionTracker';
import { extractQuantityMentionsV2 } from '../quantityReference/quantityIntelligenceV2';
import type { QuantityExtractionOptions } from '../quantityReference/quantityIntelligenceV2';
import { extractReferenceMentionsV2 } from '../quantityReference/referenceResolverV2';
import { resolveProductMention } from '../pharmacyProducts/pharmacyProductResolverV2';
import type { PharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import type { CanonicalProduct } from '../pharmacyProducts/canonicalProduct';
import { extractPriceMentions } from './priceIntelligenceV1';
import { classifyMessageActions, classifyMessageIntent } from './actionIntentClassifierV2';
import { computeActiveProductStateV2 } from './activeProductStateV2';
import type {
  ActionNode,
  BasketLinkingSafety,
  ConversationEntityGraphV2,
  GraphEdge,
  IntentNode,
  PriceNode,
  ProductMentionNode,
  QuantityNode,
  ReferenceNode,
} from './basketV2Types';

export interface BuildGraphOptions {
  productIndex?: PharmacyProductIndex;
  mentionOptions?: BuildProductMentionsOptions;
  quantityOptions?: QuantityExtractionOptions;
}

/**
 * I.B.3-owned, narrowly-scoped exception — NEVER modifies quantityIntelligenceV2.ts or its
 * QuantityMentionV2.safeForBasketLinking value (still visible unmodified on the QuantityNode).
 *
 * I.B.2.1's computeQuantitySafety() caps a quantity at `review` whenever EITHER it carries any
 * `ambiguityReasons` (e.g. the purely-informational 'no_explicit_unit' flag on every bare-number
 * order-quantity, "هات اتنين"/"هات 2") OR its own extraction confidence is below its fixed 0.8
 * threshold (e.g. every "خليهم 3"/"شيل واحدة"-style correction, which scores 0.65-0.7) — in both
 * cases regardless of how unambiguous the LINK TARGET itself is. This phase's own instruction #11
 * explicitly requires "one active product: هات اتنين -> safe quantity mutation", and instruction
 * #13 lists "زود واحدة"/"شيل واحدة"/"خليهم 3"/"لا خليه 2" as exactly the mutation-worthy corrections
 * — so for basket-MUTATION purposes only, a quantity is treated as effectively safe when it is
 * ALREADY linked to exactly one product (I.B.2.1's own cross-message linking already refused to
 * link at all when more than one product was active) and its only reason for landing on `review`
 * is either the missing-unit flag or a sub-threshold (but otherwise unambiguous) confidence score
 * — never for any other reason: multiple active products, dose/retail ambiguity, an unverified
 * brand-strength number, a price-context exclusion, or an implicit-quantity-of-1 inference all stay
 * exactly as I.B.2.1 computed them (see instruction #12's explicit "only use quantity=1 when
 * I.B.2.1 classifies it as safe" for why the implicit-one case — which always carries its own
 * distinct `implicit_quantity_inferred_not_stated` ambiguity reason — is deliberately EXCLUDED
 * here).
 */
function effectiveQuantitySafetyForBasket(q: { semanticRole: string; ambiguityReasons: string[]; linkedProductMentionId: string | null; safeForBasketLinking: BasketLinkingSafety }): BasketLinkingSafety {
  if (q.safeForBasketLinking === 'safe') return 'safe';
  const onlyMissingUnit = q.ambiguityReasons.length === 1 && q.ambiguityReasons[0] === 'no_explicit_unit';
  const fullyUnambiguousLink = q.ambiguityReasons.length === 0;
  if (q.safeForBasketLinking === 'review' && q.semanticRole === 'order_quantity' && (onlyMissingUnit || fullyUnambiguousLink) && q.linkedProductMentionId) return 'safe';
  return q.safeForBasketLinking;
}

/**
 * I.B.3-owned, narrowly-scoped exception — NEVER modifies referenceResolverV2.ts. Applied ONLY to
 * the `substitutes_product` edge, never to a plain `reference_points_to_product` edge.
 *
 * referenceResolverV2.ts's generic pronoun/ordinal SCORER (margin-over-second-candidate) has no
 * knowledge of substitution semantics — "التاني"/"ده" after a staff "X مش موجود بس فيه Y" often
 * scores a thin margin between the just-offered Y and the originally-requested X (both are equally
 * "recently mentioned"), landing on `review` even when the conversation's STRUCTURE leaves no real
 * ambiguity. `findSubstitutionContext()` (already invoked by I.B.2.1 itself, unmodified here) is a
 * SEPARATE, independent structural check: it only ever returns non-null when (a) an explicit staff
 * "not available" phrase exists, AND (b) the scorer's own top-ranked candidate was itself the
 * specific product mentioned right after that phrase. That is a second, structurally-orthogonal
 * confirmation of the SAME candidate the generic scorer already picked — not a lowered bar, but an
 * independent corroborating signal the generic scorer itself cannot see. Instruction #14's own
 * worked example ("staff offers Y, customer says 'هات التاني', Y is safely added") requires exactly
 * this — never applied when substitutionContext is absent (an ordinary ambiguous reference stays
 * exactly as I.B.2.1 computed it).
 */
function effectiveSubstitutionSafetyForBasket(ref: { safeForBasketLinking: BasketLinkingSafety; substitutionContext: unknown }): BasketLinkingSafety {
  if (ref.safeForBasketLinking === 'safe') return 'safe';
  if (ref.safeForBasketLinking === 'review' && ref.substitutionContext) return 'safe';
  return ref.safeForBasketLinking;
}

function productLookup(index?: PharmacyProductIndex): Map<string, CanonicalProduct> {
  const map = new Map<string, CanonicalProduct>();
  index?.catalog.forEach((p) => map.set(p.productId, p));
  return map;
}

export function buildConversationEntityGraphV2(
  caseId: string,
  messages: NormalizedConversationMessageV32[],
  options: BuildGraphOptions = {}
): ConversationEntityGraphV2 {
  const catalogById = productLookup(options.productIndex);
  const mentionOpts: BuildProductMentionsOptions = { productIndex: options.productIndex, ...options.mentionOptions };
  const mentions = buildProductMentions(messages, mentionOpts);
  // I.B.4: references are derived first so Quantity Intelligence can consume ONLY their already-
  // calibrated safe same-message edges. Quantity never re-runs reference resolution itself.
  const references = extractReferenceMentionsV2(messages, mentions);
  const quantities = extractQuantityMentionsV2(
    messages,
    mentions,
    { productIndex: options.productIndex, ...options.quantityOptions },
    references
  );

  // IMPORTANT: node id = IDENTITY KEY, not the raw mention id. I.B.2's own quantity/reference
  // linking (QuantityMentionV2.linkedProductMentionId, ReferenceMentionV2.selectedAntecedentId)
  // already resolves to `ProductMentionV2.identityKey` (a real productId when resolved, else a
  // normalized-text key) — see productMentionTracker.ts/computeActiveProductCandidates. Keying
  // this graph's product nodes the SAME way means every downstream edge lines up with zero
  // translation, AND directly satisfies instruction #9 (same SKU across different wordings is
  // ONE node) for free, since mentions sharing an identityKey already merge upstream.
  const mentionIdToIdentityKey = new Map(mentions.map((m) => [m.mentionId, m.identityKey] as const));
  const mentionsByIdentity = new Map<string, typeof mentions>();
  mentions.forEach((m) => {
    const bucket = mentionsByIdentity.get(m.identityKey);
    if (bucket) bucket.push(m);
    else mentionsByIdentity.set(m.identityKey, [m]);
  });
  const productMentionsById = new Map<string, ProductMentionNode>();
  mentionsByIdentity.forEach((group, identityKey) => {
    const resolvedProductId = group.find((m) => m.resolvedProductId)?.resolvedProductId ?? null;
    const product = resolvedProductId ? catalogById.get(resolvedProductId) ?? null : null;
    // Evidence-richest (longest) raw text first, purely for a readable default display value —
    // every raw mention is still preserved in `evidence` and consumed later via evidenceHistory.
    const representative = group.slice().sort((a, b) => b.rawText.length - a.rawText.length)[0];
    productMentionsById.set(identityKey, {
      id: identityKey,
      sourceMessageId: representative.sourceMessageId,
      rawText: representative.rawText,
      canonicalProductId: resolvedProductId,
      canonicalProductCode: product?.productCode ?? null,
      canonicalName: product?.canonicalName ?? null,
      resolutionStatus: resolvedProductId ? 'resolved' : 'unresolved',
      confidence: resolvedProductId ? 0.7 : 0.3,
      evidence: group.map((m) => ({ sourceMessageId: m.sourceMessageId, description: `product mention: "${m.rawText}"` })),
      rawTexts: Array.from(new Set(group.map((m) => m.rawText))),
    });
  });
  // Safe LINKING (I.B.2.1's safeForBasketLinking) and safe PRODUCT IDENTITY (a real catalog id)
  // are different facts — a `safe` link to a still-unresolved text-identity must never be reported
  // as a `safe` edge here (instruction #8's "do not add a canonical product silently" applies to
  // every edge's own safety label, not only to basketReconstructionV2.ts's own gating).
  const gateOnResolvedIdentity = (identityKey: string, safety: GraphEdge['safety']): GraphEdge['safety'] =>
    safety === 'safe' && !productMentionsById.get(identityKey)?.canonicalProductId ? 'review' : safety;

  const quantityNodes: QuantityNode[] = quantities.map((q) => ({
    id: q.mentionId,
    sourceMessageId: q.sourceMessageId,
    value: q.numericValue,
    unit: q.unit,
    semanticRole: q.semanticRole,
    correctionKind: q.correctionKind,
    safeForBasketLinking: q.safeForBasketLinking,
    confidence: q.confidence,
    evidence: [{ sourceMessageId: q.sourceMessageId, description: `quantity mention: "${q.rawText}"` }],
  }));

  const referenceNodes: ReferenceNode[] = references.map((r) => ({
    id: r.referenceId,
    sourceMessageId: r.sourceMessageId,
    rawText: r.rawText,
    antecedentKind: r.antecedentKind,
    candidateAntecedents: r.candidateAntecedentIds,
    selectedAntecedent: r.selectedAntecedentId,
    safeForBasketLinking: r.safeForBasketLinking,
    confidence: r.confidence,
    evidence: [{ sourceMessageId: r.sourceMessageId, description: `reference: "${r.rawText}"` }],
  }));

  const mentionsByMessage = new Map<string, typeof mentions>();
  mentions.forEach((m) => {
    const bucket = mentionsByMessage.get(m.sourceMessageId);
    if (bucket) bucket.push(m);
    else mentionsByMessage.set(m.sourceMessageId, [m]);
  });
  const quantitiesByMessage = new Map<string, typeof quantities>();
  quantities.forEach((q) => {
    const bucket = quantitiesByMessage.get(q.sourceMessageId);
    if (bucket) bucket.push(q);
    else quantitiesByMessage.set(q.sourceMessageId, [q]);
  });
  const referencesByMessage = new Map<string, typeof references>();
  references.forEach((r) => {
    const bucket = referencesByMessage.get(r.sourceMessageId);
    if (bucket) bucket.push(r);
    else referencesByMessage.set(r.sourceMessageId, [r]);
  });

  const actions: ActionNode[] = [];
  const intents: IntentNode[] = [];
  const prices: PriceNode[] = [];
  const edges: GraphEdge[] = [];
  let edgeSeq = 0;
  const nextEdgeId = () => `edge:${caseId}:${edgeSeq++}`;

  let hasExistingBasketContent = false;

  messages.forEach((message, messageIndex) => {
    if (!message.isMeaningful) return;
    const messageMentions = mentionsByMessage.get(message.id) ?? [];
    const messageQuantities = quantitiesByMessage.get(message.id) ?? [];
    const messageReferences = referencesByMessage.get(message.id) ?? [];

    // --- Actions + intent ---
    const classified = classifyMessageActions(message, messageQuantities, messageReferences, hasExistingBasketContent);
    classified.forEach((c) => {
      const actionId = `action:${message.id}:${actions.length}`;
      actions.push({
        id: actionId,
        sourceMessageId: message.id,
        actionType: c.actionType,
        rawText: message.text,
        confidence: c.confidence,
        ruleIds: c.ruleIds,
        evidence: [{ sourceMessageId: message.id, description: `action "${c.actionType}" from: "${message.text.slice(0, 80)}"` }],
      });
      if (c.actionType === 'request_product' || c.actionType === 'add') hasExistingBasketContent = true;

      // A single message can name SEVERAL products at once ("عايز انتينال وفليكسيلاكس",
      // "سنترم ومان و فوليك أسيد و نيورفيت") — a real, common shape in this corpus. An
      // add/request_product action targets EVERY distinct resolved identity mentioned in its own
      // message, not just the first (which would silently drop every product after the first —
      // a real recall bug found via the I.B.3 benchmark, never a re-derivation of I.B.1/I.B.2's own
      // per-mention resolution, only using what buildProductMentions already resolved for each one).
      const resolvedDirectIdentities = Array.from(new Set(messageMentions.filter((m) => m.resolvedProductId).map((m) => m.identityKey)));
      if ((c.actionType === 'request_product' || c.actionType === 'add') && resolvedDirectIdentities.length > 1) {
        resolvedDirectIdentities.forEach((identityKey) => {
          const safety = gateOnResolvedIdentity(identityKey, 'safe');
          edges.push({
            edgeId: nextEdgeId(),
            type: 'action_targets_product',
            fromNodeId: actionId,
            toNodeId: identityKey,
            sourceMessageIds: [message.id],
            ruleIds: ['graph.action_target.same_message_multi_product_mention'],
            confidence: c.confidence,
            safety,
          });
        });
        return;
      }

      // action_targets_product — the target is this SAME message's own product mention when one
      // exists (the common case: "عايز انتينال"); otherwise a safely-linked quantity/reference on
      // this message; otherwise the sole currently-active product. Never invented beyond that.
      const directMention = messageMentions[0];
      const quantityLink = messageQuantities.find((q) => q.linkedProductMentionId);
      const referenceLink = messageReferences.find((r) => r.selectedAntecedentId);
      let targetMentionId: string | null = null;
      let targetSafety: GraphEdge['safety'] = 'unsafe';
      let targetRuleIds: string[] = [];
      if (directMention?.resolvedProductId) {
        targetMentionId = directMention.identityKey;
        targetSafety = 'safe';
        targetRuleIds = ['graph.action_target.same_message_resolved_mention'];
      } else if (quantityLink) {
        targetMentionId = quantityLink.linkedProductMentionId; // already an identityKey — see productMentions' own comment
        targetSafety = effectiveQuantitySafetyForBasket(quantityLink);
        targetRuleIds = ['graph.action_target.via_quantity_link'];
      } else if (referenceLink) {
        targetMentionId = referenceLink.selectedAntecedentId; // already an identityKey
        targetSafety = referenceLink.safeForBasketLinking;
        targetRuleIds = ['graph.action_target.via_reference_link'];
      } else if (c.ruleIds.includes('action.add.acceptance_of_recommendation_no_existing_basket')) {
        // The bare acceptance's own product-mention candidate (if productMentionTracker.ts produced
        // one at all — it treats an unmatched order-verb-adjacent phrase as an unresolved candidate
        // keyed by its own full text, e.g. "تمام هاته" itself, which names no real product) is never
        // the right target here. The only possible target is whatever was the SOLE active product
        // immediately before this message (e.g. the product staff just recommended). Never invented
        // when more than one product is active — that stays unresolved, same as every other "sole
        // active candidate" gate in this file (mirrors the price-attachment fallback below). This
        // branch MUST be checked before the generic `directMention` fallback right below, which
        // would otherwise wrongly target that same bogus full-text candidate.
        const soleActiveForAcceptance = computeActiveProductCandidates(messages, mentions, messageIndex);
        if (soleActiveForAcceptance.length === 1) {
          targetMentionId = soleActiveForAcceptance[0].identityKey;
          targetSafety = 'safe';
          targetRuleIds = ['graph.action_target.recommendation_acceptance_sole_active_product'];
        }
      } else if (directMention) {
        // A mention exists but resolution is unresolved — never a `safe` target.
        targetMentionId = directMention.identityKey;
        targetSafety = 'review';
        targetRuleIds = ['graph.action_target.unresolved_same_message_mention'];
      } else if ((c.actionType === 'remove' || c.actionType === 'reject') && options.productIndex) {
        // productMentionTracker.ts's QUANTITY_OPERATION_ONLY_RX (I.B.2, must-not-modify) suppresses
        // ALL product-mention creation for a message starting with خلي/زود/شيل — correct for pure
        // corrections ("شيل واحدة") but it also blanks out a real named product in the SAME message
        // for a remove/reject verb ("شيل انتينال"). Without this fallback the action would silently
        // target nothing (worse than a review signal — instruction #19 requires remove/reject with
        // no safely-resolved target to stay a REVIEW_SIGNAL, never a silent no-op). This never
        // re-derives resolution logic: it calls resolveProductMention (I.B.1) AS-IS against the same
        // text with the operation verb stripped off.
        const stripped = message.text.replace(/^\s*(?:خلي(?:ه|ها|هم)?|زود(?:ي)?|شيل(?:ي)?|الغ[يى](?:ي)?)\s*/u, '').trim();
        if (stripped.length >= 2) {
          const resolution = resolveProductMention(stripped, options.productIndex, options.mentionOptions?.resolveOptions);
          if (resolution.selected) {
            const resolvedId = resolution.selected.product.productId;
            if (!productMentionsById.has(resolvedId)) {
              const product = catalogById.get(resolvedId) ?? null;
              productMentionsById.set(resolvedId, {
                id: resolvedId,
                sourceMessageId: message.id,
                rawText: stripped,
                canonicalProductId: resolvedId,
                canonicalProductCode: product?.productCode ?? null,
                canonicalName: product?.canonicalName ?? null,
                resolutionStatus: 'resolved',
                confidence: 0.7,
                evidence: [{ sourceMessageId: message.id, description: `product mention: "${stripped}"` }],
                rawTexts: [stripped],
              });
            }
            targetMentionId = resolvedId;
            targetSafety = 'safe';
            targetRuleIds = ['graph.action_target.remove_reject_bare_verb_fallback_resolved'];
          }
        }
      }
      if (targetMentionId) {
        const gated = gateOnResolvedIdentity(targetMentionId, targetSafety);
        if (gated !== targetSafety) targetRuleIds = [...targetRuleIds, 'graph.action_target.downgraded_unresolved_product_identity'];
        targetSafety = gated;
      }
      if (targetMentionId) {
        edges.push({
          edgeId: nextEdgeId(),
          type: 'action_targets_product',
          fromNodeId: actionId,
          toNodeId: targetMentionId,
          sourceMessageIds: [message.id],
          ruleIds: targetRuleIds,
          confidence: c.confidence,
          safety: targetSafety,
        });
        if (c.actionType === 'confirm') {
          edges.push({ edgeId: nextEdgeId(), type: 'confirms_product', fromNodeId: actionId, toNodeId: targetMentionId, sourceMessageIds: [message.id], ruleIds: targetRuleIds, confidence: c.confidence, safety: targetSafety });
        }
        if (c.actionType === 'reject') {
          edges.push({ edgeId: nextEdgeId(), type: 'rejects_product', fromNodeId: actionId, toNodeId: targetMentionId, sourceMessageIds: [message.id], ruleIds: targetRuleIds, confidence: c.confidence, safety: targetSafety });
        }
      }

      if (c.actionType === 'substitute') {
        const ref = messageReferences.find((r) => r.substitutionContext);
        if (ref?.substitutionContext && ref.selectedAntecedentId) {
          // ReferenceSubstitutionContext.originalProductMentionId is a raw ProductMentionV2
          // mentionId (see referenceResolverV2.ts's findSubstitutionContext) — translate through
          // to its identityKey so this edge's `fromNodeId` matches this graph's node-id scheme.
          const originalIdentityKey = mentionIdToIdentityKey.get(ref.substitutionContext.originalProductMentionId) ?? ref.substitutionContext.originalProductMentionId;
          edges.push({
            edgeId: nextEdgeId(),
            type: 'substitutes_product',
            fromNodeId: originalIdentityKey,
            toNodeId: ref.selectedAntecedentId,
            sourceMessageIds: [message.id],
            ruleIds: ['graph.substitutes_product.from_reference_substitution_context'],
            confidence: ref.confidence,
            safety: gateOnResolvedIdentity(ref.selectedAntecedentId, effectiveSubstitutionSafetyForBasket(ref)),
          });
        }
      }
    });

    const intent = classifyMessageIntent(message, classified);
    if (intent) {
      intents.push({
        id: `intent:${message.id}`,
        sourceMessageId: message.id,
        intentType: intent.intentType,
        confidence: intent.confidence,
        evidence: [{ sourceMessageId: message.id, description: `intent "${intent.intentType}"` }],
      });
    }

    // --- quantity_applies_to_product / modifies_quantity_of ---
    messageQuantities.forEach((q) => {
      if (q.linkedProductMentionId) {
        edges.push({
          edgeId: nextEdgeId(),
          type: 'quantity_applies_to_product',
          fromNodeId: q.mentionId,
          toNodeId: q.linkedProductMentionId,
          sourceMessageIds: [q.sourceMessageId],
          ruleIds: q.ruleIds,
          confidence: q.confidence,
          safety: gateOnResolvedIdentity(q.linkedProductMentionId, effectiveQuantitySafetyForBasket(q)),
        });
      }
      if (q.correctionOfMentionId) {
        edges.push({
          edgeId: nextEdgeId(),
          type: 'modifies_quantity_of',
          fromNodeId: q.mentionId,
          toNodeId: q.correctionOfMentionId,
          sourceMessageIds: [q.sourceMessageId],
          ruleIds: ['graph.modifies_quantity_of.correction_chain'],
          confidence: q.confidence,
          safety: q.safeForBasketLinking,
        });
      }
    });

    // --- reference_points_to_product ---
    messageReferences.forEach((r) => {
      if (r.selectedAntecedentId) {
        edges.push({
          edgeId: nextEdgeId(),
          type: 'reference_points_to_product',
          fromNodeId: r.referenceId,
          toNodeId: r.selectedAntecedentId,
          sourceMessageIds: [r.sourceMessageId],
          ruleIds: ['graph.reference_points_to_product'],
          confidence: r.confidence,
          safety: gateOnResolvedIdentity(r.selectedAntecedentId, r.safeForBasketLinking),
        });
      }
    });

    // --- price nodes + price_applies_to_product ---
    const activeAsOfHere = computeActiveProductCandidates(messages, mentions, messageIndex + 1);
    const soleActive = activeAsOfHere.length === 1 ? activeAsOfHere[0] : null;
    const priceMentions = extractPriceMentions(message.text, Boolean(soleActive));
    priceMentions.forEach((p, i) => {
      const priceId = `price:${message.id}:${i}`;
      prices.push({
        id: priceId,
        sourceMessageId: message.id,
        value: p.value,
        currency: 'EGP',
        priceRole: p.priceRole,
        confidence: p.confidence,
        evidence: [{ sourceMessageId: message.id, description: `price mention: "${p.rawText}"` }],
      });
      if (p.priceRole === 'item_unit_price' && soleActive) {
        edges.push({
          edgeId: nextEdgeId(),
          type: 'price_applies_to_product',
          fromNodeId: priceId,
          toNodeId: soleActive.identityKey,
          sourceMessageIds: [message.id],
          ruleIds: p.ruleIds,
          confidence: p.confidence,
          safety: gateOnResolvedIdentity(soleActive.identityKey, 'safe'),
        });
      }
    });
  });

  // Derived AFTER the message loop: the remove/reject bare-verb fallback (see the action loop
  // above) may have added synthetic entries to productMentionsById for a product that was never
  // otherwise mentioned in this case before the removal/rejection itself.
  const productMentions = Array.from(productMentionsById.values());

  // --- derived_from_message provenance edges (instruction #3's completeness list) ---
  const allNodeIds: string[] = [
    ...productMentions.map((n) => n.id),
    ...quantityNodes.map((n) => n.id),
    ...prices.map((n) => n.id),
    ...referenceNodes.map((n) => n.id),
    ...actions.map((n) => n.id),
    ...intents.map((n) => n.id),
  ];
  const sourceByNodeId = new Map<string, string>([
    ...productMentions.map((n): [string, string] => [n.id, n.sourceMessageId]),
    ...quantityNodes.map((n): [string, string] => [n.id, n.sourceMessageId]),
    ...prices.map((n): [string, string] => [n.id, n.sourceMessageId]),
    ...referenceNodes.map((n): [string, string] => [n.id, n.sourceMessageId]),
    ...actions.map((n): [string, string] => [n.id, n.sourceMessageId]),
    ...intents.map((n): [string, string] => [n.id, n.sourceMessageId]),
  ]);
  allNodeIds.forEach((nodeId) => {
    const sourceMessageId = sourceByNodeId.get(nodeId)!;
    edges.push({
      edgeId: nextEdgeId(),
      type: 'derived_from_message',
      fromNodeId: nodeId,
      toNodeId: sourceMessageId,
      sourceMessageIds: [sourceMessageId],
      ruleIds: ['graph.derived_from_message.provenance'],
      confidence: 1,
      safety: 'safe',
    });
  });

  const activeProductStates = computeActiveProductStateV2(messages, mentions, messages.length);

  return { caseId, productMentions, quantities: quantityNodes, prices, references: referenceNodes, actions, intents, edges, activeProductStates };
}
