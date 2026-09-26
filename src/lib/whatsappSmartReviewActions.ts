import type { SmartDeepConversationAnalysis } from './whatsappSmartConversationIntelligence';

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

export function buildSmartReviewActionPlan(args: {
  intelligence: SmartDeepConversationAnalysis | null;
  staffName?: string | null;
  fallbackCustomerName?: string | null;
}): SmartReviewActionPlan {
  const deep = args.intelligence;
  if (!deep) return { customerRequest: null, followup: null };

  const request = deep.customerRequest;
  const customerRequest: SmartCustomerRequestActionProposal | null = request.detected || deep.unavailableItem.detected
    ? {
        kind: 'customer_request',
        customerName: request.customerName || args.fallbackCustomerName || null,
        customerCode: request.customerCode,
        customerPhone: request.customerPhone,
        productName: request.productName,
        quantity: parseQuantity(request.quantity),
        concentration: request.concentration,
        staffName: args.staffName || null,
        evidenceMessageIds: Array.from(new Set([
          ...request.evidenceMessageIds,
          ...deep.unavailableItem.evidenceMessageIds,
        ])),
        // Even a high-confidence text extraction must be bound to canonical customer/product ids by the user.
        needsConfirmation: true,
      }
    : null;

  const followup: SmartFollowupActionProposal | null = deep.followup.detected
    ? {
        kind: 'followup',
        customerName: request.customerName || args.fallbackCustomerName || null,
        customerCode: request.customerCode,
        customerPhone: request.customerPhone,
        reason: followupReasonLabel(deep.followup.reason),
        staffName: args.staffName || null,
        evidenceMessageIds: deep.followup.evidenceMessageIds.slice(),
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
