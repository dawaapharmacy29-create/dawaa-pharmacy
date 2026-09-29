import type { SmartDeepConversationAnalysis } from './whatsappSmartConversationIntelligence';
import type { SmartIntelligenceSnapshotV1, SmartRequestedProductEvidenceV32 } from './whatsappSmartIntelligenceSnapshot';

export interface SmartCustomerRequestActionProposal {
  kind: 'customer_request';
  customerName: string | null;
  customerCode: string | null;
  customerPhone: string | null;
  productName: string | null;
  quantity: number | null;
  concentration: string | null;
  staffName: string | null;
  evidenceMessageIds: string[];
  needsConfirmation: boolean;
}

export interface SmartFollowupActionProposal {
  kind: 'followup';
  customerName: string | null;
  customerCode: string | null;
  customerPhone: string | null;
  reason: string;
  staffName: string | null;
  evidenceMessageIds: string[];
  needsConfirmation: boolean;
}

export interface SmartReviewActionPlan {
  customerRequest: SmartCustomerRequestActionProposal | null;
  followup: SmartFollowupActionProposal | null;
}

const CUSTOMER_REQUEST_TRANSFER_KEY = 'dawaa_pending_customer_request_from_smart_review_v1';
const FOLLOWUP_CONTEXT_KEY = 'dawaa_pending_followup_context_v1';

function parseQuantity(value: string | null) {
  if (!value) return null;
  const match = String(value).match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function followupReasonLabel(reason: SmartDeepConversationAnalysis['followup']['reason']) {
  if (reason === 'illness') return 'حالة مرضية تحتاج متابعة واطمئنان';
  if (reason === 'recommendation') return 'تم ترشيح منتج/علاج ويُفضل متابعة النتيجة';
  if (reason === 'service_issue') return 'مشكلة خدمة تحتاج متابعة';
  if (reason === 'explicit_promise') return 'يوجد وعد صريح للعميل بالمتابعة';
  return 'متابعة مقترحة من تحليل المحادثة';
}

function canonicalCustomer(snapshot?: SmartIntelligenceSnapshotV1 | null) {
  const customer = snapshot?.customer?.customer || null;
  const contact = snapshot?.customerContact || null;
  return {
    name: customer?.name || null,
    code: customer?.code || null,
    phone:
      customer?.phone ||
      contact?.phone ||
      contact?.customerPhone ||
      contact?.mobile ||
      contact?.normalizedPhone ||
      contact?.whatsappPhone ||
      contact?.alternatePhone ||
      null,
  };
}

function canonicalRequestProduct(snapshot?: SmartIntelligenceSnapshotV1 | null): SmartRequestedProductEvidenceV32 | null {
  const products = snapshot?.requestedProducts || [];
  return products.find((row) => row.requestProven && ['requested', 'unavailable', 'accepted'].includes(row.status))
    || products.find((row) => row.status === 'unavailable' && row.sourceDirection === 'inbound')
    || null;
}

export function buildSmartReviewActionPlan(args: {
  intelligence: SmartDeepConversationAnalysis | null;
  smartIntelligence?: SmartIntelligenceSnapshotV1 | null;
  staffName?: string | null;
  fallbackCustomerName?: string | null;
}): SmartReviewActionPlan {
  const deep = args.intelligence;
  const smart = args.smartIntelligence || null;
  if (!deep && !smart) return { customerRequest: null, followup: null };

  const legacyRequest = deep?.customerRequest || null;
  const canonicalIdentity = canonicalCustomer(smart);
  const canonicalProduct = canonicalRequestProduct(smart);
  const canonicalFollowup = smart?.evaluationV2?.followups?.[0] || null;

  const hasCustomerRequest = Boolean(
    canonicalProduct ||
    legacyRequest?.detected ||
    deep?.unavailableItem.detected
  );

  const customerRequest: SmartCustomerRequestActionProposal | null = hasCustomerRequest
    ? {
        kind: 'customer_request',
        customerName: canonicalIdentity.name || legacyRequest?.customerName || args.fallbackCustomerName || null,
        customerCode: canonicalIdentity.code || legacyRequest?.customerCode || null,
        customerPhone: canonicalIdentity.phone || legacyRequest?.customerPhone || null,
        productName: canonicalProduct?.canonicalName || canonicalProduct?.rawName || legacyRequest?.productName || null,
        quantity: canonicalProduct?.quantity ?? parseQuantity(legacyRequest?.quantity || null),
        concentration: legacyRequest?.concentration || null,
        staffName: args.staffName || null,
        evidenceMessageIds: Array.from(new Set([
          ...(canonicalProduct?.evidenceMessageIds || []),
          ...(legacyRequest?.evidenceMessageIds || []),
          ...(deep?.unavailableItem.evidenceMessageIds || []),
        ])),
        // Action creation still requires a human confirmation; canonical facts only prefill it safely.
        needsConfirmation: true,
      }
    : null;

  const hasFollowup = Boolean(canonicalFollowup || deep?.followup.detected);
  const followup: SmartFollowupActionProposal | null = hasFollowup
    ? {
        kind: 'followup',
        customerName: canonicalIdentity.name || legacyRequest?.customerName || args.fallbackCustomerName || null,
        customerCode: canonicalIdentity.code || legacyRequest?.customerCode || null,
        customerPhone: canonicalIdentity.phone || legacyRequest?.customerPhone || null,
        reason: canonicalFollowup?.reason || canonicalFollowup?.label || followupReasonLabel(deep?.followup.reason || null),
        staffName: args.staffName || null,
        evidenceMessageIds: Array.from(new Set([
          ...(canonicalFollowup?.evidenceMessageIds || []),
          ...(deep?.followup.evidenceMessageIds || []),
        ])),
        needsConfirmation: true,
      }
    : null;

  return { customerRequest, followup };
}

export function writeSmartCustomerRequestTransfer(proposal: SmartCustomerRequestActionProposal) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(CUSTOMER_REQUEST_TRANSFER_KEY, JSON.stringify(proposal));
}

export function readSmartCustomerRequestTransfer(): SmartCustomerRequestActionProposal | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(CUSTOMER_REQUEST_TRANSFER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.kind === 'customer_request' ? parsed as SmartCustomerRequestActionProposal : null;
  } catch {
    return null;
  }
}

export function clearSmartCustomerRequestTransfer() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(CUSTOMER_REQUEST_TRANSFER_KEY);
}

export function writeSmartFollowupTransfer(proposal: SmartFollowupActionProposal) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem('dawaa_pending_followup_customer', JSON.stringify({
    code: proposal.customerCode || '',
    name: proposal.customerName || '',
    phone: proposal.customerPhone || '',
  }));
  window.sessionStorage.setItem(FOLLOWUP_CONTEXT_KEY, JSON.stringify(proposal));
}

export function readSmartFollowupContext(): SmartFollowupActionProposal | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(FOLLOWUP_CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.kind === 'followup' ? parsed as SmartFollowupActionProposal : null;
  } catch {
    return null;
  }
}

export function clearSmartFollowupContext() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(FOLLOWUP_CONTEXT_KEY);
}
