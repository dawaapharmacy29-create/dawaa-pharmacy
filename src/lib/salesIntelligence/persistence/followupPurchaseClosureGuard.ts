// Case and time scope for anything that ties a purchase/invoice to an existing WhatsApp action.
//
// One conversation can hold several cases (e.g. a customer-service outreach, a later order, a
// nursing follow-up). A follow-up raised for one case must never be "recovered" or enriched by the
// invoice of a sibling case, and a purchase that happened before the follow-up existed cannot be the
// result of that follow-up. Pure: callers decide what to write; this only says whether the link is
// allowed and why. Matching is fail-closed: an action whose case cannot be identified uniquely is
// never linked to a case-scoped invoice.

export interface ActionCaseScopeInput {
  /** payload.caseId of canonical actions (the Sales Intelligence case id). */
  payloadCaseId?: string | null;
  /** action.evidence: message ids, or legacy anchors such as `case:1790495647000-0`. */
  evidence?: readonly unknown[] | null;
}

export interface CaseMessageScope {
  caseId: string;
  messageIds: readonly string[];
}

export type ActionCaseResolution =
  | { caseId: string; basis: 'payload_case_id' | 'evidence_message_time' }
  | { caseId: null; basis: 'unresolved' | 'ambiguous' };

const MESSAGE_TIME = /^(?:case:)?([0-9]{13})(?:-|$)/;

/** The 13-digit export timestamp that prefixes WhatsApp message ids and legacy case anchors. */
function messageTimeKey(value: unknown): string | null {
  return MESSAGE_TIME.exec(String(value ?? '').trim())?.[1] ?? null;
}

/**
 * Which case of THIS conversation an action belongs to. A canonical payload.caseId is decisive
 * when it is one of the given cases. Legacy actions carry only evidence anchors; message-id
 * indexes differ between export parsers, so the anchor is matched on its message timestamp and
 * must point to exactly one case.
 */
export function resolveActionCaseId(
  action: ActionCaseScopeInput,
  cases: readonly CaseMessageScope[]
): ActionCaseResolution {
  const payloadCaseId = String(action.payloadCaseId ?? '').trim();
  if (payloadCaseId) {
    return cases.some((c) => c.caseId === payloadCaseId)
      ? { caseId: payloadCaseId, basis: 'payload_case_id' }
      : { caseId: null, basis: 'unresolved' };
  }
  const anchors = new Set(
    (action.evidence ?? []).map(messageTimeKey).filter((key): key is string => Boolean(key))
  );
  if (!anchors.size) return { caseId: null, basis: 'unresolved' };
  const matched = cases.filter((c) =>
    c.messageIds.some((id) => anchors.has(messageTimeKey(id) ?? ''))
  );
  if (matched.length === 1) return { caseId: matched[0].caseId, basis: 'evidence_message_time' };
  return { caseId: null, basis: matched.length ? 'ambiguous' : 'unresolved' };
}

export type FollowupPurchaseClosureReason =
  | 'same_case_purchase_after_followup'
  | 'later_purchase_in_another_conversation'
  | 'purchase_time_unknown'
  | 'followup_time_unknown'
  | 'purchase_precedes_followup'
  | 'followup_case_unresolved'
  | 'purchase_from_another_case';

export interface FollowupPurchaseClosureDecision {
  allowed: boolean;
  reason: FollowupPurchaseClosureReason;
}

export const FOLLOWUP_PURCHASE_CLOSURE_LABELS: Record<FollowupPurchaseClosureReason, string> = {
  same_case_purchase_after_followup: 'شراء لاحق لإنشاء المتابعة ومن الحالة نفسها',
  later_purchase_in_another_conversation: 'شراء لاحق لإنشاء المتابعة في محادثة أخرى',
  purchase_time_unknown: 'وقت الشراء غير معروف؛ لا تُغلق المتابعة',
  followup_time_unknown: 'وقت إنشاء المتابعة غير معروف؛ لا تُغلق المتابعة',
  purchase_precedes_followup: 'الشراء سابق لإنشاء المتابعة؛ لا يمكن أن يكون نتيجة لها',
  followup_case_unresolved: 'حالة المتابعة داخل المحادثة غير محددة؛ لا تُغلق بفاتورة حالة أخرى',
  purchase_from_another_case: 'الفاتورة تخص حالة أخرى في نفس المحادثة',
};

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * May this purchase close (recover) this follow-up? Customer identity matching is the caller's
 * job; this adds the two guards identity alone cannot give: the purchase must come after the
 * follow-up was opened, and inside the same conversation it must be the follow-up's own case.
 */
export function evaluateFollowupPurchaseClosure(input: {
  followup: { sourceId: string | null; createdAt: string | null; caseId: string | null };
  purchase: { sourceId: string | null; caseId: string | null; invoiceAt: string | null };
}): FollowupPurchaseClosureDecision {
  const purchaseAt = time(input.purchase.invoiceAt);
  if (purchaseAt == null) return { allowed: false, reason: 'purchase_time_unknown' };
  const followupAt = time(input.followup.createdAt);
  if (followupAt == null) return { allowed: false, reason: 'followup_time_unknown' };
  if (purchaseAt < followupAt) return { allowed: false, reason: 'purchase_precedes_followup' };
  const sameConversation = Boolean(
    input.followup.sourceId &&
    input.purchase.sourceId &&
    input.followup.sourceId === input.purchase.sourceId
  );
  if (!sameConversation) return { allowed: true, reason: 'later_purchase_in_another_conversation' };
  if (!input.followup.caseId) return { allowed: false, reason: 'followup_case_unresolved' };
  if (!input.purchase.caseId || input.purchase.caseId !== input.followup.caseId) {
    return { allowed: false, reason: 'purchase_from_another_case' };
  }
  return { allowed: true, reason: 'same_case_purchase_after_followup' };
}
