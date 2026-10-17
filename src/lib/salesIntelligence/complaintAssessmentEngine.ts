// Canonical Complaint Assessment — the single semantic owner of complaint existence/recovery state.
//
// Readers (conversation evaluation, operational projection, reviews) may score HOW staff handled
// the canonical facts, but they must not re-parse message text to decide whether a complaint exists
// or whether it was resolved. Dispatch/in-transit phrases are deliberately NOT resolution proof.

export type CanonicalComplaintState =
  | 'none'
  | 'detected'
  | 'recovery_attempted'
  | 'resolved'
  | 'unresolved'
  | 'insufficient_evidence';

export interface ComplaintAssessmentMessage {
  id: string;
  role: 'staff' | 'customer' | 'system' | 'unknown';
  text: string;
  meaningful: boolean;
}

export interface CanonicalComplaintAssessment {
  version: 'canonical-complaint-v1';
  caseId: string;
  state: CanonicalComplaintState;
  complaintMessageIds: string[];
  staffResponseMessageIds: string[];
  apologyMessageIds: string[];
  remedyAttemptMessageIds: string[];
  hostileResponseMessageIds: string[];
  resolutionMessageIds: string[];
  evidenceMessageIds: string[];
  confidence: 'high' | 'medium' | 'low';
  ruleIds: string[];
}

const COMPLAINT_RX =
  /(?:زعلان|متضايق|غاضب|شكوى|مشكله|مشكلة|مش\s*راضي|سيئ|وحش|خدمة\s*وحشه|خدمة\s*سيئه|كل\s*مرة|كل\s*مره|بشتكي|ليه\s*كده)/i;
const APOLOGY_RX = /(?:متاسف|متأسف|آسف|اسف|بنعتذر|نعتذر|حقك\s*علينا|معلش)/i;
const REMEDY_RX =
  /(?:هحل|هنحل|هنبدل|هبدل|هنرجع|هرجع\s*المبلغ|هتابع|هراجع|هكلم|هنكلم|هنوفر|هشوف|هراجع\s*بنفسي)/i;
const HOSTILE_RX =
  /(?:لو\s*مش\s*عاجبك|مش\s*مشكلتي|مش\s*شغلي|بلاش\s*زن|ما\s*تزنش|انت\s*غلطان|إنت\s*غلطان|روح\s*اشتكي|اخرس|اخرسي)/i;

// Explicit closure only. "في الطريق" / "جاري الإرسال" / "خرج مع المندوب" are progress facts,
// never proof that the complaint itself was resolved or that fulfillment completed.
const STAFF_RESOLUTION_RX =
  /(?:اتحل(?:ت)?\s*(?:المشكله|المشكلة|الموضوع)?|تم\s*(?:حل|معالجة)\s*(?:المشكله|المشكلة|الموضوع)?|اتظبط(?:ت)?\s*(?:المشكله|المشكلة|الموضوع)?)/i;
const CUSTOMER_RESOLUTION_RX =
  /(?:المشكله\s*اتحلت|المشكلة\s*اتحلت|الموضوع\s*اتحل|كده\s*تمام|كدا\s*تمام|تمام\s*كده|تمام\s*كدا|شكرا.*(?:اتحل|اتظبط|تمام))/i;

const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

export function deriveCanonicalComplaintAssessment(input: {
  caseId: string;
  messages: readonly ComplaintAssessmentMessage[];
}): CanonicalComplaintAssessment {
  const meaningful = input.messages.filter((message) => message.meaningful);
  const firstComplaintIndex = meaningful.findIndex(
    (message) => message.role === 'customer' && COMPLAINT_RX.test(message.text)
  );

  if (firstComplaintIndex < 0) {
    return {
      version: 'canonical-complaint-v1',
      caseId: input.caseId,
      state: 'none',
      complaintMessageIds: [],
      staffResponseMessageIds: [],
      apologyMessageIds: [],
      remedyAttemptMessageIds: [],
      hostileResponseMessageIds: [],
      resolutionMessageIds: [],
      evidenceMessageIds: [],
      confidence: 'high',
      ruleIds: ['complaint.none.no_explicit_customer_complaint'],
    };
  }

  const afterComplaint = meaningful.slice(firstComplaintIndex + 1);
  const complaintMessages = meaningful
    .slice(firstComplaintIndex)
    .filter((message) => message.role === 'customer' && COMPLAINT_RX.test(message.text));
  const staffResponses = afterComplaint.filter((message) => message.role === 'staff');
  const apologies = staffResponses.filter((message) => APOLOGY_RX.test(message.text));
  const remedies = staffResponses.filter((message) => REMEDY_RX.test(message.text));
  const hostile = staffResponses.filter((message) => HOSTILE_RX.test(message.text));
  const staffResolution = staffResponses.filter((message) => STAFF_RESOLUTION_RX.test(message.text));
  const customerResolution = afterComplaint.filter(
    (message) => message.role === 'customer' && CUSTOMER_RESOLUTION_RX.test(message.text)
  );
  const resolutionIds = unique([...staffResolution, ...customerResolution].map((message) => message.id));

  let state: CanonicalComplaintState;
  const ruleIds: string[] = [];
  if (resolutionIds.length > 0) {
    state = 'resolved';
    ruleIds.push('complaint.resolved.explicit_closure');
  } else if (apologies.length > 0 || remedies.length > 0) {
    state = 'recovery_attempted';
    ruleIds.push('complaint.recovery_attempted.no_explicit_closure');
  } else if (staffResponses.length > 0) {
    state = 'detected';
    ruleIds.push('complaint.detected.staff_response_without_recovery');
  } else {
    state = 'unresolved';
    ruleIds.push('complaint.unresolved.no_staff_response');
  }
  if (hostile.length > 0) ruleIds.push('complaint.hostile_response');

  const complaintMessageIds = complaintMessages.map((message) => message.id);
  const staffResponseMessageIds = staffResponses.map((message) => message.id);
  const apologyMessageIds = apologies.map((message) => message.id);
  const remedyAttemptMessageIds = remedies.map((message) => message.id);
  const hostileResponseMessageIds = hostile.map((message) => message.id);
  const evidenceMessageIds = unique([
    ...complaintMessageIds,
    ...staffResponseMessageIds,
    ...resolutionIds,
  ]);

  return {
    version: 'canonical-complaint-v1',
    caseId: input.caseId,
    state,
    complaintMessageIds,
    staffResponseMessageIds,
    apologyMessageIds,
    remedyAttemptMessageIds,
    hostileResponseMessageIds,
    resolutionMessageIds: resolutionIds,
    evidenceMessageIds,
    confidence: resolutionIds.length > 0 || complaintMessageIds.length > 0 ? 'high' : 'medium',
    ruleIds,
  };
}
