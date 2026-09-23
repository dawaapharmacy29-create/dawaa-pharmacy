// Phase I.B.3 — Basket Reconstruction V2 (instructions #5-#20).
//
// LAYER B only (instruction #1): consumes ConversationEntityGraphV2's nodes/edges through
// chronological, event-sourced state transitions. Never re-parses conversation text — every
// decision here reads a graph node/edge's already-computed `safety`/`confidence`/`ruleIds`.
//
// THE ONE RULE THIS ENTIRE FILE ENFORCES (instruction #4): only an edge whose `safety === 'safe'`
// may ever change `items`/`status`. A `review` or `unsafe` edge always produces a REVIEW_SIGNAL
// event and leaves every existing field untouched — this is checked at a single choke point
// (isSafeToMutate) rather than scattered per-branch, so there is exactly one place to audit.
import type {
  ActionNode,
  BasketCompletenessV2,
  BasketConfidenceV2,
  BasketEventType,
  BasketEventV2,
  BasketItemV2,
  BasketLinkingSafety,
  BasketReconstructionResultV2,
  BasketStatusV2,
  CaseBasketV2,
  ConversationEntityGraphV2,
  GraphEdge,
  PendingReviewSignalV2,
  PriceNode,
  ProductMentionNode,
  UnresolvedItemCandidateV2,
} from './basketV2Types';

function isSafeToMutate(safety: BasketLinkingSafety): boolean {
  return safety === 'safe';
}

interface MutableState {
  items: Map<string, BasketItemV2>;
  unresolvedCandidates: UnresolvedItemCandidateV2[];
  pendingReviewSignals: PendingReviewSignalV2[];
  status: BasketStatusV2;
  version: number;
  createdAt: string;
  sourceMessageIds: Set<string>;
  announcedOrderTotal: { value: number; evidenceComplete: boolean } | null;
}

function cloneItem(item: BasketItemV2): BasketItemV2 {
  return { ...item, rawMentions: [...item.rawMentions], evidenceHistory: [...item.evidenceHistory], unresolvedFlags: [...item.unresolvedFlags] };
}

function cloneState(state: MutableState): MutableState {
  const items = new Map<string, BasketItemV2>();
  state.items.forEach((v, k) => items.set(k, cloneItem(v)));
  return {
    items,
    unresolvedCandidates: [...state.unresolvedCandidates],
    pendingReviewSignals: [...state.pendingReviewSignals],
    status: state.status,
    version: state.version,
    createdAt: state.createdAt,
    sourceMessageIds: new Set(state.sourceMessageIds),
    announcedOrderTotal: state.announcedOrderTotal,
  };
}

function getOrCreateItem(state: MutableState, product: ProductMentionNode, sourceMessageId: string): BasketItemV2 {
  const existing = state.items.get(product.canonicalProductId!);
  if (existing) return existing;
  const created: BasketItemV2 = {
    itemId: `${product.canonicalProductId}:item`,
    canonicalProductId: product.canonicalProductId!,
    canonicalProductCode: product.canonicalProductCode,
    canonicalName: product.canonicalName,
    rawMentions: [...product.rawTexts],
    currentQuantity: null,
    quantityUnit: null,
    quantityStatus: 'unknown',
    unitPrice: null,
    lineTotal: null,
    itemState: 'active',
    resolutionStatus: 'proven',
    evidenceHistory: [],
    unresolvedFlags: [],
    substitutedFromProductId: null,
  };
  state.items.set(product.canonicalProductId!, created);
  return created;
}

function snapshotBasket(caseId: string, state: MutableState): CaseBasketV2 {
  const items = Array.from(state.items.values()).map(cloneItem);
  const resolvedCount = items.filter((i) => i.itemState !== 'removed' && i.itemState !== 'rejected').length;
  const ambiguousCount = state.unresolvedCandidates.length + state.pendingReviewSignals.length;
  const quantityKnownCount = items.filter((i) => i.quantityStatus === 'known').length;

  const confidence: BasketConfidenceV2 = {
    productIdentityConfidence: items.length === 0 ? 1 : resolvedCount / items.length,
    quantityConfidence: items.length === 0 ? 1 : quantityKnownCount / items.length,
    mutationConfidence: 1, // every mutation that reached here was, by construction, safety==='safe'
    completeness: items.length === 0 ? 0 : quantityKnownCount / items.length,
    ambiguityCount: ambiguousCount,
  };

  let completeness: BasketCompletenessV2;
  if (items.length === 0 && ambiguousCount === 0) completeness = 'insufficient';
  else if (ambiguousCount > 0 && resolvedCount === 0) completeness = 'ambiguous';
  else if (ambiguousCount > 0) completeness = 'ambiguous';
  else if (quantityKnownCount === items.length && items.length > 0) completeness = 'exact';
  else completeness = 'partial';

  return {
    caseId,
    basketId: `${caseId}:basketv2:${state.version}`,
    version: state.version,
    status: state.status,
    items,
    unresolvedCandidates: [...state.unresolvedCandidates],
    createdAt: state.createdAt,
    supersededAt: null,
    sourceMessageIds: Array.from(state.sourceMessageIds),
    pendingReviewSignals: [...state.pendingReviewSignals],
    confidence,
    completeness,
    announcedOrderTotal: state.announcedOrderTotal,
  };
}

export function reconstructBasketV2(graph: ConversationEntityGraphV2, messageTimestamps: Map<string, string>): BasketReconstructionResultV2 {
  const productById = new Map(graph.productMentions.map((p) => [p.id, p]));
  const edgesByFrom = new Map<string, GraphEdge[]>();
  graph.edges.forEach((e) => {
    const bucket = edgesByFrom.get(e.fromNodeId);
    if (bucket) bucket.push(e);
    else edgesByFrom.set(e.fromNodeId, [e]);
  });
  const actionTargetEdge = (actionId: string, type: GraphEdge['type']) => (edgesByFrom.get(actionId) ?? []).find((e) => e.type === type);
  /** A single request_product/add action can carry SEVERAL action_targets_product edges — one per
   * distinct product named in the same message ("عايز انتينال وفليكسيلاكس"). Every other action
   * type still targets at most one product, so only the request_product/add branch below uses this. */
  const actionTargetEdges = (actionId: string, type: GraphEdge['type']) => (edgesByFrom.get(actionId) ?? []).filter((e) => e.type === type);

  const events: BasketEventV2[] = [];
  const basketVersions: CaseBasketV2[] = [];
  let seq = 0;

  const firstTimestamp = graph.actions[0] ? messageTimestamps.get(graph.actions[0].sourceMessageId) ?? new Date(0).toISOString() : new Date(0).toISOString();
  let state: MutableState = {
    items: new Map(),
    unresolvedCandidates: [],
    pendingReviewSignals: [],
    status: 'draft',
    version: 1,
    createdAt: firstTimestamp,
    sourceMessageIds: new Set(),
    announcedOrderTotal: null,
  };

  function pushEvent(type: BasketEventType, action: ActionNode | null, targetProductId: string | null, previousState: unknown, nextState: unknown, confidence: number, safety: BasketLinkingSafety, ruleIds: string[], note: string) {
    events.push({
      eventId: `evt:${graph.caseId}:${seq}`,
      type,
      sequence: seq++,
      sourceMessageId: action?.sourceMessageId ?? '',
      targetProductId,
      previousState,
      nextState,
      confidence,
      safeForBasketMutation: safety,
      ruleIds,
      note,
    });
  }

  /** instruction #7: a mutation to an already-CONFIRMED basket opens a brand-new version; the old one is pushed, frozen, into basketVersions and never touched again. */
  function ensureMutableVersion() {
    if (state.status === 'confirmed') {
      const superseded = snapshotBasket(graph.caseId, state);
      basketVersions.push({ ...superseded, supersededAt: new Date().toISOString() });
      state = cloneState(state);
      state.version += 1;
      state.status = 'draft';
    }
  }

  function recordReview(sourceMessageId: string, rawText: string, reason: string, relatedProductId: string | null) {
    state.pendingReviewSignals.push({ sourceMessageId, reason, rawText, relatedProductId });
  }

  graph.actions.forEach((action) => {
    state.sourceMessageIds.add(action.sourceMessageId);
    const targetEdge = actionTargetEdge(action.id, 'action_targets_product');
    const targetProduct = targetEdge ? productById.get(targetEdge.toNodeId) ?? null : null;
    const targetSafe = targetEdge ? isSafeToMutate(targetEdge.safety) && Boolean(targetProduct?.canonicalProductId) : false;

    switch (action.actionType) {
      case 'request_product':
      case 'add': {
        // A single message can name SEVERAL products at once ("عايز انتينال وفليكسيلاكس") —
        // conversationEntityGraphV2.ts emits one action_targets_product edge per distinct product
        // in that case, so every one of them is processed here, never just the first.
        const targetEdges = actionTargetEdges(action.id, 'action_targets_product');
        if (targetEdges.length === 0) break;
        targetEdges.forEach((edge) => {
          const product = productById.get(edge.toNodeId) ?? null;
          if (!product) return;
          const safe = isSafeToMutate(edge.safety) && Boolean(product.canonicalProductId);
          if (!safe) {
            state.unresolvedCandidates.push({ sourceMessageId: action.sourceMessageId, rawText: product.rawText, reason: `product_${edge.safety}` });
            recordReview(action.sourceMessageId, product.rawText, `product_mention_${edge.safety}_not_added`, product.canonicalProductId);
            pushEvent('REVIEW_SIGNAL', action, product.canonicalProductId, null, null, action.confidence, edge.safety, action.ruleIds, `Candidate product "${product.rawText}" not safely resolved — not added to basket.`);
            return;
          }
          ensureMutableVersion();
          const before = state.items.has(product.canonicalProductId!) ? cloneItem(state.items.get(product.canonicalProductId!)!) : null;
          const item = getOrCreateItem(state, product, action.sourceMessageId);
          product.rawTexts.forEach((t) => { if (!item.rawMentions.includes(t)) item.rawMentions.push(t); });
          item.evidenceHistory.push({ sourceMessageId: action.sourceMessageId, description: `requested via "${action.rawText.slice(0, 80)}"` });

          // A quantity stated in the SAME message, safely linked to THIS product, is applied
          // immediately — never a global "assume 1" (instruction #12). Read the EDGE's own safety
          // (already resolved through conversationEntityGraphV2's effectiveQuantitySafetyForBasket +
          // gateOnResolvedIdentity), never the QuantityNode's raw safeForBasketLinking directly —
          // this file never re-derives what the graph already decided (instruction #1's layer
          // separation).
          const linkedQuantity = graph.quantities.find((q) => {
            if (q.sourceMessageId !== action.sourceMessageId) return false;
            const qEdge = edgesByFrom.get(q.id)?.find((e) => e.type === 'quantity_applies_to_product' && e.toNodeId === product.canonicalProductId);
            return Boolean(qEdge && isSafeToMutate(qEdge.safety));
          });
          if (linkedQuantity) {
            item.currentQuantity = linkedQuantity.value;
            item.quantityUnit = linkedQuantity.unit;
            item.quantityStatus = 'known';
          }
          pushEvent('ITEM_ADDED', action, product.canonicalProductId, before, cloneItem(item), action.confidence, 'safe', action.ruleIds, `Added "${product.canonicalName ?? product.rawText}" from "${action.rawText.slice(0, 80)}".`);
        });
        break;
      }

      case 'set_quantity':
      case 'increment_quantity':
      case 'decrement_quantity': {
        const expectedCorrectionKind = action.actionType === 'set_quantity' ? 'replace' : action.actionType === 'increment_quantity' ? 'increment' : 'decrement';
        const quantityNode = graph.quantities.find((q) => q.sourceMessageId === action.sourceMessageId && q.correctionKind === expectedCorrectionKind) ?? null;
        if (!targetEdge || !targetProduct) break;
        if (!targetSafe) {
          recordReview(action.sourceMessageId, targetProduct.rawText, 'quantity_correction_target_not_safe', targetProduct.canonicalProductId);
          pushEvent('REVIEW_SIGNAL', action, targetProduct.canonicalProductId, null, null, action.confidence, targetEdge.safety, action.ruleIds, `Quantity correction on "${targetProduct.rawText}" not safely targeted — basket unchanged.`);
          break;
        }
        ensureMutableVersion();
        const before = state.items.has(targetProduct.canonicalProductId!) ? cloneItem(state.items.get(targetProduct.canonicalProductId!)!) : null;
        const item = getOrCreateItem(state, targetProduct, action.sourceMessageId);
        const value = quantityNode?.value ?? null;
        if (value === null) break;
        if (action.actionType === 'set_quantity') item.currentQuantity = value;
        else if (action.actionType === 'increment_quantity') item.currentQuantity = (item.currentQuantity ?? 0) + value;
        else item.currentQuantity = Math.max(0, (item.currentQuantity ?? 0) - value);
        item.quantityStatus = 'known';
        item.evidenceHistory.push({ sourceMessageId: action.sourceMessageId, description: `quantity correction via "${action.rawText.slice(0, 80)}"` });
        pushEvent(
          action.actionType === 'set_quantity' ? 'QUANTITY_SET' : action.actionType === 'increment_quantity' ? 'QUANTITY_INCREMENTED' : 'QUANTITY_DECREMENTED',
          action,
          targetProduct.canonicalProductId,
          before,
          cloneItem(item),
          action.confidence,
          'safe',
          action.ruleIds,
          `Quantity ${action.actionType} on "${targetProduct.canonicalName ?? targetProduct.rawText}".`
        );
        break;
      }

      case 'remove': {
        if (!targetEdge || !targetProduct) break;
        if (!targetSafe || !state.items.has(targetProduct.canonicalProductId ?? '')) {
          recordReview(action.sourceMessageId, targetProduct.rawText, 'remove_target_not_safe_or_not_in_basket', targetProduct.canonicalProductId);
          pushEvent('REVIEW_SIGNAL', action, targetProduct.canonicalProductId, null, null, action.confidence, targetEdge.safety, action.ruleIds, 'Removal target not safely resolved — basket unchanged.');
          break;
        }
        ensureMutableVersion();
        const before = cloneItem(state.items.get(targetProduct.canonicalProductId!)!);
        const item = state.items.get(targetProduct.canonicalProductId!)!;
        item.itemState = 'removed';
        pushEvent('ITEM_REMOVED', action, targetProduct.canonicalProductId, before, cloneItem(item), action.confidence, 'safe', action.ruleIds, `Removed "${targetProduct.canonicalName ?? targetProduct.rawText}".`);
        break;
      }

      case 'reject': {
        if (!targetEdge || !targetProduct) break;
        if (!targetSafe) {
          recordReview(action.sourceMessageId, targetProduct.rawText, 'reject_antecedent_ambiguous', targetProduct.canonicalProductId);
          pushEvent('REVIEW_SIGNAL', action, targetProduct.canonicalProductId, null, null, action.confidence, targetEdge.safety, action.ruleIds, 'Rejection antecedent ambiguous — nothing removed (instruction #19).');
          break;
        }
        if (!state.items.has(targetProduct.canonicalProductId!)) break;
        ensureMutableVersion();
        const before = cloneItem(state.items.get(targetProduct.canonicalProductId!)!);
        const item = state.items.get(targetProduct.canonicalProductId!)!;
        item.itemState = 'rejected';
        pushEvent('ITEM_REJECTED', action, targetProduct.canonicalProductId, before, cloneItem(item), action.confidence, 'safe', action.ruleIds, `Rejected "${targetProduct.canonicalName ?? targetProduct.rawText}".`);
        break;
      }

      case 'substitute': {
        const subEdge = actionTargetEdge(action.id, 'substitutes_product') ?? graph.edges.find((e) => e.type === 'substitutes_product' && e.sourceMessageIds.includes(action.sourceMessageId));
        if (!subEdge) break;
        const originalProduct = productById.get(subEdge.fromNodeId) ?? null;
        const substituteProduct = productById.get(subEdge.toNodeId) ?? null;
        if (!substituteProduct?.canonicalProductId || !isSafeToMutate(subEdge.safety)) {
          recordReview(action.sourceMessageId, substituteProduct?.rawText ?? action.rawText, 'substitution_not_safe', substituteProduct?.canonicalProductId ?? null);
          pushEvent('REVIEW_SIGNAL', action, substituteProduct?.canonicalProductId ?? null, null, null, action.confidence, subEdge.safety, action.ruleIds, 'Substitution acceptance not safely resolved — original request preserved, nothing added.');
          break;
        }
        ensureMutableVersion();
        if (originalProduct?.canonicalProductId && state.items.has(originalProduct.canonicalProductId)) {
          const originalItem = state.items.get(originalProduct.canonicalProductId)!;
          originalItem.itemState = 'substituted';
        }
        const before = state.items.has(substituteProduct.canonicalProductId) ? cloneItem(state.items.get(substituteProduct.canonicalProductId)!) : null;
        const item = getOrCreateItem(state, substituteProduct, action.sourceMessageId);
        item.substitutedFromProductId = originalProduct?.canonicalProductId ?? null;
        substituteProduct.rawTexts.forEach((t) => { if (!item.rawMentions.includes(t)) item.rawMentions.push(t); });
        item.evidenceHistory.push({ sourceMessageId: action.sourceMessageId, description: `substituted for "${originalProduct?.rawText ?? 'unknown original'}" via "${action.rawText.slice(0, 80)}"` });
        pushEvent('PRODUCT_SUBSTITUTED', action, substituteProduct.canonicalProductId, before, cloneItem(item), action.confidence, 'safe', action.ruleIds, `"${originalProduct?.canonicalName ?? originalProduct?.rawText ?? 'original'}" substituted with "${substituteProduct.canonicalName ?? substituteProduct.rawText}" — original request preserved in evidence.`);
        break;
      }

      case 'confirm': {
        if (targetEdge && targetProduct && targetSafe && state.items.has(targetProduct.canonicalProductId!)) {
          const before = cloneItem(state.items.get(targetProduct.canonicalProductId!)!);
          const item = state.items.get(targetProduct.canonicalProductId!)!;
          item.itemState = 'confirmed';
          pushEvent('ITEM_CONFIRMED', action, targetProduct.canonicalProductId, before, cloneItem(item), action.confidence, 'safe', action.ruleIds, `Confirmed "${targetProduct.canonicalName ?? targetProduct.rawText}".`);
        } else if (state.items.size > 0 && state.status === 'draft') {
          // A bare acceptance with no single product target confirms the WHOLE current draft.
          const before = state.status;
          state.status = 'confirmed';
          state.items.forEach((item) => {
            if (item.itemState === 'active') item.itemState = 'confirmed';
          });
          pushEvent('BASKET_CONFIRMED', action, null, before, state.status, action.confidence, 'safe', action.ruleIds, 'Whole current basket confirmed.');
        }
        break;
      }

      case 'cancel_order': {
        const before = state.status;
        state.status = 'cancelled';
        state.items.forEach((item) => {
          if (item.itemState !== 'removed') item.itemState = 'rejected';
        });
        pushEvent('BASKET_CANCELLED', action, null, before, state.status, action.confidence, 'safe', action.ruleIds, 'Whole order cancelled (instruction #20 — distinct from a single-item rejection).');
        break;
      }

      case 'send_order':
        if (state.status === 'draft' && state.items.size > 0) {
          state.status = 'confirmed';
          pushEvent('BASKET_CONFIRMED', action, null, 'draft', 'confirmed', action.confidence, 'safe', action.ruleIds, 'Staff fulfillment message implies the basket was confirmed.');
        }
        break;

      case 'ask_availability':
      case 'ask_price':
        // Instruction #17: an inquiry is NEVER commercial acquisition intent — no event at all.
        break;
    }
  });

  // --- price attachment (processed after actions so items already exist where possible) ---
  graph.prices.forEach((priceNode: PriceNode) => {
    const edge = graph.edges.find((e) => e.type === 'price_applies_to_product' && e.fromNodeId === priceNode.id);
    if (edge && isSafeToMutate(edge.safety)) {
      const item = state.items.get(edge.toNodeId);
      if (item) {
        const before = cloneItem(item);
        item.unitPrice = priceNode.value;
        item.lineTotal = item.currentQuantity !== null ? item.currentQuantity * priceNode.value : null;
        pushEvent('PRICE_ATTACHED', null, item.canonicalProductId, before, cloneItem(item), priceNode.confidence, 'safe', ['price.attached'], `Unit price ${priceNode.value} attached to "${item.canonicalName ?? item.canonicalProductId}".`);
      }
    } else if (priceNode.priceRole === 'order_total') {
      // instruction #16: never derived from quantity*price when scope is ambiguous — this is the
      // ONLY source of announcedOrderTotal, a directly-stated figure, never a computed sum.
      state.announcedOrderTotal = { value: priceNode.value, evidenceComplete: true };
    }
  });

  const currentBasket = snapshotBasket(graph.caseId, state);
  return { caseId: graph.caseId, events, basketVersions, currentBasket };
}
