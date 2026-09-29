import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type SmartConversationStage =
  | 'customer_service_followup'
  | 'product_request'
  | 'pharmacist_consultation'
  | 'complaint_or_service_issue'
  | 'order_confirmation'
  | 'service_recovery';

export type SmartConversationOutcome =
  | 'open'
  | 'order_requested_unverified'
  | 'invoice_verified_sale'
  | 'service_issue_open'
  | 'service_issue_recovered'
  | 'closed_no_sale'
  | 'needs_review';

export interface SmartResponseTurn {
  inboundMessageIds: string[];
  inboundStartedAt: Date;
  inboundEndedAt: Date;
  responseMessageId: string | null;
  responseAt: Date | null;
  responseLatencySeconds: number | null;
  noResponse: boolean;
}

export interface SmartConversationClassification {
  primaryType: SmartConversationStage | 'unknown';
  journey: SmartConversationStage[];
  finalIntent: SmartConversationStage | 'unknown';
  outcome: SmartConversationOutcome;
  lastMeaningfulMessageId: string | null;
  detectedStaffNames: string[];
  responseTurns: SmartResponseTurn[];
  suggestedReviewCriteria: string[];
  evidenceMessageIds: string[];
  requiresHumanReview: boolean;
  reviewReasons: string[];
}

const normalizeArabic = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/\s+/g, ' ');

const ACK_ONLY_RX = /^(تمام|حاضر|شكرا|شكراً|الف شكر|تسلم|اوكي|ok|okay|ماشي|مفيش مشكله|تحت امركم|جزاكم الله خيرا)[.!،\s🌷🌹🤍💚💙🙏]*$/i;
const CLOSING_RX = /(تحت امر حضرتك|تتشرف بخدمة حضرتك|نهتم بصحتك|نورتنا|شكرا لثقتك|في اي وقت|فى اى وقت)/i;
const CUSTOMER_SERVICE_RX = /(خدمه عملاء|خدمة عملاء|حابين نطمن|حبيت اطمن|متابعه|متابعة|مستوى الخدمه|مستوى الخدمة|رضا حضرتك|التجربه|التجربة)/i;
const PRODUCT_REQUEST_RX = /(محتاج|محتاجه|هحتاج|عايز|عايزه|متاح|موجود|بكام|السعر|ابعت|ابعته|اوردر|أوردر|الطلب|العنوان|سرنج|علبه|علبة|واحد من دا|واحد من ده)/i;
const CONSULTATION_RX = /(جرعه|جرعة|استخدام|مناسب|اعراض|أعراض|كحه|كحة|حراره|حرارة|حموضه|حموضة|ضغط|سكر|طفل|حامل|رضاعه|رضاعة|تعبان|مفعوله|مفعولة|دواء|علاج)/i;
const CUSTOMER_COMPLAINT_RX = /(شكوى|شكوي|متضايق|زعلان|اتاخرت|اتأخرت|تأخير|تاخير|مشكله|مشكلة|مش راضي|سيئ|وحش)/i;
const STAFF_RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسف|آسف|التاخير|التأخير|هتابع|بنتابع|اعوض|نعوض)/i;
const ORDER_CONFIRM_RX = /(تم الارسال|تم الإرسال|تم تأكيد|ابعتهم لحضرتك|ابعت لحضرتك|على عنوان|علي عنوان|الدليفري متاح|المندوب)/i;

function cleanStaffCandidate(raw: string) {
  const beforeOrg = raw
    .split(/\s+(?:من\s+(?:خدمة\s*عملاء|صيدليات\s+دواء)|خدمة\s+التوصيل|خدمه\s+التوصيل)/i)[0]
    .replace(/[🥼💊🌷🌹🤍💚💙✨🚗]+/g, ' ')
    .replace(/[،,.؛;:]+$/g, '')
    .trim();
  const words = beforeOrg.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  if (beforeOrg.length > 40) return null;
  if (/(اقدر|أقدر|اساعد|أساعد|حضرتك|الخدمه|الخدمة|صيدليات|دواء)/i.test(beforeOrg)) return null;
  return beforeOrg;
}

export function extractValidatedStaffName(text: string): string | null {
  const patterns = [
    /مع\s+حضرتك\s+(?:د\.?|دكتور(?:ه|ة)?|دكتوره)\s*([^\n،,.]+)/i,
    /معاك(?:ي)?\s+(?:د\.?|دكتور(?:ه|ة)?|دكتوره)\s*([^\n،,.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (!match?.[1]) continue;
    const candidate = cleanStaffCandidate(match[1]);
    if (candidate) return candidate;
  }
  return null;
}

export function collectValidatedStaffNames(messages: WhatsAppParsedMessage[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.direction !== 'outbound') continue;
    const name = extractValidatedStaffName(message.text);
    if (!name) continue;
    const key = normalizeArabic(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function buildEpisodeResponseTurns(session: WhatsAppConversationSession): SmartResponseTurn[] {
  const messages = session.messages
    .filter((message) => message.direction !== 'system')
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const turns: SmartResponseTurn[] = [];
  let index = 0;
  while (index < messages.length) {
    const current = messages[index];
    if (current.direction !== 'inbound') {
      index += 1;
      continue;
    }
    const inbound: WhatsAppParsedMessage[] = [current];
    let cursor = index + 1;
    while (cursor < messages.length && messages[cursor].direction === 'inbound') {
      inbound.push(messages[cursor]);
      cursor += 1;
    }
    const response = cursor < messages.length && messages[cursor].direction === 'outbound' ? messages[cursor] : null;
    const inboundStartedAt = inbound[0].timestamp;
    const inboundEndedAt = inbound[inbound.length - 1].timestamp;
    const latency = response ? Math.max(0, Math.round((response.timestamp.getTime() - inboundEndedAt.getTime()) / 1000)) : null;
    turns.push({
      inboundMessageIds: inbound.map((message) => message.id),
      inboundStartedAt,
      inboundEndedAt,
      responseMessageId: response?.id || null,
      responseAt: response?.timestamp || null,
      responseLatencySeconds: latency,
      noResponse: !response,
    });
    index = response ? cursor + 1 : cursor;
  }
  return turns;
}

function stageForMessage(message: WhatsAppParsedMessage): SmartConversationStage[] {
  const text = message.text || '';
  const stages: SmartConversationStage[] = [];
  if (CUSTOMER_SERVICE_RX.test(text)) stages.push('customer_service_followup');
  if (message.direction === 'inbound' && CUSTOMER_COMPLAINT_RX.test(text)) stages.push('complaint_or_service_issue');
  if (message.direction === 'outbound' && STAFF_RECOVERY_RX.test(text)) stages.push('service_recovery');
  if (PRODUCT_REQUEST_RX.test(text)) stages.push('product_request');
  if (CONSULTATION_RX.test(text)) stages.push('pharmacist_consultation');
  if (ORDER_CONFIRM_RX.test(text)) stages.push('order_confirmation');
  return stages;
}

function isMeaningful(message: WhatsAppParsedMessage) {
  if (message.direction === 'system' || message.kind === 'system' || message.kind === 'deleted') return false;
  const text = String(message.text || '').trim();
  if (!text) return false;
  if (ACK_ONLY_RX.test(text)) return false;
  if (message.direction === 'outbound' && CLOSING_RX.test(text) && !PRODUCT_REQUEST_RX.test(text) && !STAFF_RECOVERY_RX.test(text)) return false;
  return true;
}

function uniqueInOrder<T>(items: T[]) {
  const seen = new Set<T>();
  return items.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

export function classifySmartConversation(
  session: WhatsAppConversationSession,
  options?: { invoiceVerified?: boolean; invoiceMatchAmbiguous?: boolean },
): SmartConversationClassification {
  const ordered = session.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const stageEvents = ordered.flatMap((message) => stageForMessage(message).map((stage) => ({ stage, message })));
  const journey = uniqueInOrder(stageEvents.map((item) => item.stage));
  const meaningful = ordered.filter(isMeaningful);
  const lastMeaningful = meaningful[meaningful.length - 1] || null;
  const finalStages = lastMeaningful ? stageForMessage(lastMeaningful) : [];
  const finalIntent = finalStages.find((stage) => stage === 'product_request' || stage === 'pharmacist_consultation' || stage === 'complaint_or_service_issue' || stage === 'customer_service_followup')
    || journey.slice().reverse().find((stage) => stage !== 'order_confirmation' && stage !== 'service_recovery')
    || 'unknown';

  const primaryType = journey.find((stage) => stage === 'customer_service_followup')
    || journey.find((stage) => stage === 'complaint_or_service_issue')
    || journey.find((stage) => stage === 'product_request')
    || journey.find((stage) => stage === 'pharmacist_consultation')
    || 'unknown';

  const customerComplaint = stageEvents.some((item) => item.stage === 'complaint_or_service_issue' && item.message.direction === 'inbound');
  const serviceRecovery = journey.includes('service_recovery');
  const productRequest = journey.includes('product_request');
  const orderConfirmation = journey.includes('order_confirmation');
  let outcome: SmartConversationOutcome = 'open';
  if (options?.invoiceVerified) outcome = 'invoice_verified_sale';
  else if (options?.invoiceMatchAmbiguous) outcome = 'needs_review';
  else if (customerComplaint && serviceRecovery) outcome = 'service_issue_recovered';
  else if (customerComplaint) outcome = 'service_issue_open';
  else if (productRequest && orderConfirmation) outcome = 'order_requested_unverified';
  else if (productRequest) outcome = 'order_requested_unverified';

  const responseTurns = buildEpisodeResponseTurns(session);
  const reviewReasons: string[] = [];
  const suggestedReviewCriteria = new Set<string>();
  if (responseTurns.some((turn) => !turn.noResponse && Number(turn.responseLatencySeconds) > 600)) {
    suggestedReviewCriteria.add('first_response_speed');
    reviewReasons.push('يوجد انتظار رد يتجاوز 10 دقائق داخل نفس الجلسة');
  }
  if (responseTurns.some((turn) => turn.noResponse)) {
    suggestedReviewCriteria.add('understanding');
    reviewReasons.push('يوجد دور للعميل بدون رد داخل نفس الجلسة');
  }
  if (journey.includes('service_recovery')) {
    suggestedReviewCriteria.add('order_delay_handling');
    reviewReasons.push('تم رصد اعتذار/استدراك متعلق بالخدمة أو التأخير');
  }
  if (journey.includes('complaint_or_service_issue')) suggestedReviewCriteria.add('angry_customer');
  if (journey.includes('product_request')) suggestedReviewCriteria.add('sales_closing');
  if (journey.includes('order_confirmation')) suggestedReviewCriteria.add('order_confirmation');
  if (journey.includes('pharmacist_consultation')) suggestedReviewCriteria.add('consultation_quality');

  const detectedStaffNames = collectValidatedStaffNames(ordered);
  if (!detectedStaffNames.length && ordered.some((message) => message.direction === 'outbound')) {
    reviewReasons.push('لم يتم تأكيد اسم الدكتور من صيغة تعريف موثوقة');
  }

  return {
    primaryType,
    journey,
    finalIntent,
    outcome,
    lastMeaningfulMessageId: lastMeaningful?.id || null,
    detectedStaffNames,
    responseTurns,
    suggestedReviewCriteria: Array.from(suggestedReviewCriteria),
    evidenceMessageIds: uniqueInOrder(stageEvents.map((item) => item.message.id)),
    requiresHumanReview: Boolean(options?.invoiceMatchAmbiguous) || reviewReasons.length > 0,
    reviewReasons,
  };
}
