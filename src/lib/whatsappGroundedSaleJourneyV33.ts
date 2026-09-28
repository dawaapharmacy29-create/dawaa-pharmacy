import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { WhatsAppOperationalIntelligenceV6 } from './whatsappOperationalIntelligenceV6';
import type { UnifiedInvoiceVerification } from './whatsappUnifiedIntelligenceV4';
import type { SmartConversationEvaluationV2 } from './whatsappConversationEvaluationV2';
import type { ConversationTimingV28 } from './whatsappConversationTimingV28';
import type { WhatsAppParticipantRoleModelV15 } from './whatsappParticipantRoleResolverV15';
import type { ConversationUnderstandingV32 } from './whatsappConversationUnderstandingV32';

export type GroundedSaleStageKeyV33 =
  | 'request'
  | 'first_response'
  | 'product_identification'
  | 'availability'
  | 'recommendation'
  | 'customer_acceptance'
  | 'order_confirmation'
  | 'invoice'
  | 'delivery'
  | 'complaint'
  | 'recovery'
  | 'closing';

export interface GroundedSaleStageV33 {
  key: GroundedSaleStageKeyV33;
  label: string;
  detected: boolean;
  at: string | null;
  confidence: number;
  source: 'message' | 'invoice' | 'derived';
  evidenceMessageIds: string[];
  reason: string;
}

export interface GroundedSaleJourneyV33 {
  version: 'whatsapp-grounded-sale-journey-v33';
  grounded: true;
  outcome: 'invoice_candidate_strong' | 'chat_confirmed' | 'open_opportunity' | 'lost_or_blocked' | 'non_commercial' | 'needs_review';
  outcomeLabel: string;
  commercial: boolean;
  saleWindow: {
    startedAt: string | null;
    endedAt: string | null;
    startMessageId: string | null;
    endMessageId: string | null;
    endSource: 'message' | 'invoice' | 'none';
    messageIds: string[];
  };
  customerJourneyWindow: {
    startedAt: string | null;
    endedAt: string | null;
    messageIds: string[];
  };
  stages: GroundedSaleStageV33[];
  evidenceMessageIds: string[];
  complaintMessageIds: string[];
  delayMessageIds: string[];
  unresolvedMessageIds: string[];
  correctionMessageIds: string[];
  understanding: {
    interactionCount: number;
    meaningfulMessageCount: number;
    ignoredMessageCount: number;
    semanticSignalCount: number;
    requestSignalCount: number;
    confirmationSignalCount: number;
    correctionSignalCount: number;
  };
  staffContribution: Array<{
    staffName: string;
    role: string;
    messageIds: string[];
    firstMessageAt: string | null;
    lastMessageAt: string | null;
  }>;
  staffCoaching: Array<{
    staffName: string;
    role: string;
    evidenceMessageIds: string[];
    responseTurnCount: number;
    medianResponseSeconds: number | null;
    slowResponseCount: number;
    confirmationCount: number;
    recommendationCount: number;
    recoveryCount: number;
    closingCount: number;
    complaintResponseCount: number;
    findings: Array<{
      type: 'opening' | 'response_delay' | 'understanding_correction' | 'correction_recovery' | 'order_confirmation' | 'closing' | 'complaint_handling' | 'handoff';
      tone: 'strong' | 'improvement' | 'context';
      title: string;
      detail: string;
      evidenceMessageIds: string[];
      attributionConfidence: number;
    }>;
    strengths: string[];
    gaps: string[];
    score: number | null;
    label: string;
  }>;
  coaching: {
    strengths: string[];
    gaps: string[];
    complaintPoints: string[];
    delayPoints: string[];
    bestPracticeScore: number | null;
    bestPracticeLabel: string;
  };
  evidenceCoverage: number;
  confidence: number;
  truthQuality: {
    status: 'grounded' | 'partial' | 'review_required';
    decisionReady: boolean;
    directMessageEvidenceCount: number;
    invoiceCandidateStrong: boolean;
    customerResolved: boolean;
    invoiceItemCount: number;
    blockers: string[];
    caveats: string[];
  };
  warnings: string[];
}

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/\s+/g, ' ');

const ACCEPT_RX = /(^|\s)(تمام|ماشي|موافق|اوكي|أوكي|خلاص|ابعت|ابعته|ابعتي|هات|هاته|هاخده|هاخدها|هجربه|هجربها|تمام كده|تمام كدا)(\s|$)/i;
const CONFIRM_RX = /(نأكد مع حضرتك|ناكد مع حضرتك|تأكيد الأصناف|تاكيد الاصناف|نراجع مع حضرتك|حضرتك كده معانا|حضرتك كدا معانا|الأوردر كده|الاوردر كده|الأوردر كدا|الاوردر كدا|الطلب كده|الطلب كدا|تم تأكيد|تم التاكيد|تم التأكيد|تم تسجيل الطلب)/i;
const AVAILABILITY_RX = /(متوفر|موجود|متاح|غير متوفر|مش موجود|ناقص|هنوفر|هطلبه|هطلبها)/i;
const DELIVERY_RX = /(مندوب|توصيل|العنوان|جاري الارسال|جاري الإرسال|خرج لحضرتك|هيتم التوصيل|هيوصل)/i;
const COMPLAINT_RX = /(شكوى|شكوي|مشكله|مشكلة|زعلت|اتضايقت|محدش رد|متاخر|متأخر|التأخير|التاخير|ماوصلش|موصلش|لسه مجاش|غلط|وحش|سيء)/i;
const RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|هنراجع|هنتابع|بنتابع|هنحل|تم الحل|نعوض|تعويض|رضا حضرتك)/i;
const CLOSING_RX = /(تحت امر حضرتك|تحت أمر حضرتك|تحت أمرك|نتشرف بخدمة حضرتك|سعداء بخدمة حضرتك|شكرا لثقة حضرتك|شكرًا لثقة حضرتك|في أي وقت|يوم سعيد)/i;
const NEGATED_COMPLAINT_RX = /(مفيش\s+مشكله|مفيش\s+مشكلة|مافيش\s+مشكله|مافيش\s+مشكلة|لا\s+توجد\s+مشكله|لا\s+توجد\s+مشكلة|مش\s+مشكله|مش\s+مشكلة)/i;

function uniq<T>(rows: T[]) { return [...new Set(rows)]; }
function clamp(value: number, min = 0, max = 100) { return Math.max(min, Math.min(max, value)); }

function messageMap(session: WhatsAppConversationSession) {
  return new Map(session.messages.map((message) => [message.id, message]));
}

function idsFromOperational(operational: WhatsAppOperationalIntelligenceV6) {
  return uniq([
    ...(operational.evidence.request?.messageIds || []),
    ...(operational.evidence.recommendation?.messageIds || []),
    ...(operational.evidence.saleClose?.messageIds || []),
    ...(operational.evidence.complaint?.messageIds || []),
    ...operational.products.flatMap((row) => row.evidenceMessageIds || []),
    ...operational.customerRequests.flatMap((row) => row.evidenceMessageIds || []),
    ...operational.recommendations.flatMap((row) => row.evidenceMessageIds || []),
  ]);
}

function firstByIds(session: WhatsAppConversationSession, ids: string[]) {
  const set = new Set(ids);
  return session.messages
    .filter((message) => set.has(message.id))
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime())[0] || null;
}

function lastByIds(session: WhatsAppConversationSession, ids: string[]) {
  const set = new Set(ids);
  const rows = session.messages
    .filter((message) => set.has(message.id))
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  return rows[rows.length - 1] || null;
}

function matching(session: WhatsAppConversationSession, rx: RegExp, direction?: 'inbound'|'outbound') {
  return session.messages.filter((message) =>
    message.direction !== 'system' &&
    (!direction || message.direction === direction) &&
    rx.test(String(message.text || ''))
  );
}

function makeStage(
  key: GroundedSaleStageKeyV33,
  label: string,
  rows: WhatsAppParsedMessage[],
  reason: string,
  confidence = 90
): GroundedSaleStageV33 {
  const first = rows[0] || null;
  return {
    key,
    label,
    detected: rows.length > 0,
    at: first?.timestamp.toISOString() || null,
    confidence: rows.length ? confidence : 0,
    source: 'message',
    evidenceMessageIds: rows.map((row) => row.id).slice(0, 12),
    reason: rows.length ? reason : `لم يوجد دليل رسالة مباشر يثبت مرحلة «${label}».`,
  };
}

function normalizeStaffName(value: unknown) {
  return normalize(value)
    .replace(/^(?:د\s*[\/.-]?\s*|دكتور(?:ه|ة)?\s+)/i, '')
    .trim();
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function roleContribution(session: WhatsAppConversationSession, roles?: WhatsAppParticipantRoleModelV15 | null) {
  const byId = new Map((roles?.messages || []).map((row) => [row.messageId, row]));
  const groups = new Map<string, { staffName: string; role: string; rows: WhatsAppParsedMessage[] }>();
  for (const message of session.messages) {
    if (message.direction !== 'outbound') continue;
    const role = byId.get(message.id);
    const staffName = String(role?.staffName || message.sender || '').trim();
    if (!staffName) continue;
    const key = `${staffName}|${role?.role || 'pharmacy_unknown'}`;
    const current = groups.get(key) || { staffName, role: role?.role || 'pharmacy_unknown', rows: [] };
    current.rows.push(message);
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    staffName: group.staffName,
    role: group.role,
    messageIds: group.rows.map((row) => row.id),
    firstMessageAt: group.rows[0]?.timestamp.toISOString() || null,
    lastMessageAt: group.rows[group.rows.length - 1]?.timestamp.toISOString() || null,
  }));
}

function messageRange(session: WhatsAppConversationSession, start: WhatsAppParsedMessage | null, end: WhatsAppParsedMessage | null) {
  if (!start) return [];
  const startMs = start.timestamp.getTime();
  const endMs = end?.timestamp.getTime() ?? Number.POSITIVE_INFINITY;
  return session.messages
    .filter((message) => message.direction !== 'system' && message.timestamp.getTime() >= startMs && message.timestamp.getTime() <= endMs)
    .map((message) => message.id);
}

export function buildGroundedSaleJourneyV33(args: {
  session: WhatsAppConversationSession;
  operational: WhatsAppOperationalIntelligenceV6;
  invoiceVerification: UnifiedInvoiceVerification;
  evaluation: SmartConversationEvaluationV2;
  timing: ConversationTimingV28;
  participantRoles?: WhatsAppParticipantRoleModelV15 | null;
  understanding?: ConversationUnderstandingV32 | null;
  customerResolved?: boolean;
  customerAmbiguous?: boolean;
  invoiceItemCount?: number;
}): GroundedSaleJourneyV33 {
  const { session, operational, invoiceVerification, evaluation, timing, participantRoles, understanding } = args;
  const invoiceItemCount = Math.max(0, Number(args.invoiceItemCount || 0));
  const byId = messageMap(session);

  const semanticRequestIds = (understanding?.signals || [])
    .filter((signal) => signal.type === 'request' && signal.confidence >= 0.8)
    .map((signal) => signal.messageId);
  const semanticConfirmationIds = (understanding?.signals || [])
    .filter((signal) => signal.type === 'confirmation' && signal.confidence >= 0.7)
    .map((signal) => signal.messageId);
  const correctionMessageIds = (understanding?.signals || [])
    .filter((signal) => signal.type === 'correction' && signal.confidence >= 0.6)
    .map((signal) => signal.messageId);

  const requestIds = uniq([
    ...(operational.evidence.request?.messageIds || []),
    ...semanticRequestIds,
    ...operational.customerRequests.flatMap((row) => row.evidenceMessageIds || []),
    ...operational.products
      .filter((row) => ['requested','accepted','unavailable'].includes(row.status))
      .flatMap((row) => row.evidenceMessageIds || []),
  ]);
  const requestRows = session.messages
    .filter((message) => requestIds.includes(message.id) && message.direction === 'inbound')
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());

  const productRows = session.messages
    .filter((message) => operational.products.some((row) => row.evidenceMessageIds?.includes(message.id)))
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());

  let availabilityRows = matching(session, AVAILABILITY_RX, 'outbound');
  let recommendationRows = session.messages
    .filter((message) => operational.recommendations.some((row) => row.evidenceMessageIds?.includes(message.id)))
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  let acceptanceRows = matching(session, ACCEPT_RX, 'inbound');
  const confirmationRows = uniq([
    ...semanticConfirmationIds,
    ...evaluation.orderCompleteness.items
      .filter((row) => row.key === 'explicit_confirmation' && row.status === 'confirmed')
      .flatMap((row) => row.evidenceMessageIds),
    ...matching(session, CONFIRM_RX, 'outbound').map((row) => row.id),
  ]).map((id) => byId.get(id)).filter((row): row is WhatsAppParsedMessage => Boolean(row))
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  let deliveryRows = matching(session, DELIVERY_RX);
  let complaintRows = matching(session, COMPLAINT_RX, 'inbound')
    .filter((message) => !NEGATED_COMPLAINT_RX.test(String(message.text || '')));
  let recoveryRows = matching(session, RECOVERY_RX, 'outbound');
  let closingRows = matching(session, CLOSING_RX, 'outbound');

  const timingRequest = timing.orderTimeline.requestAt
    ? session.messages.find((message) => message.timestamp.toISOString() === timing.orderTimeline.requestAt) || null
    : null;
  const startMessage = requestRows[0] || productRows.find((row) => row.direction === 'inbound') || timingRequest || null;

  if (startMessage) {
    const startsAt = startMessage.timestamp.getTime();
    const afterStart = (row: WhatsAppParsedMessage) => row.timestamp.getTime() >= startsAt;
    availabilityRows = availabilityRows.filter(afterStart);
    recommendationRows = recommendationRows.filter(afterStart);
    acceptanceRows = acceptanceRows.filter(afterStart);
    deliveryRows = deliveryRows.filter(afterStart);
    complaintRows = complaintRows.filter(afterStart);
    recoveryRows = recoveryRows.filter(afterStart);
    closingRows = closingRows.filter(afterStart);
  }

  const saleRelevantIds = uniq([
    ...requestIds,
    ...productRows.map((row) => row.id),
    ...availabilityRows.map((row) => row.id),
    ...recommendationRows.map((row) => row.id),
    ...acceptanceRows.map((row) => row.id),
    ...confirmationRows.map((row) => row.id),
    ...deliveryRows.map((row) => row.id),
  ]);
  const lastSaleMessage = lastByIds(session, saleRelevantIds);

  let outcome: GroundedSaleJourneyV33['outcome'] = 'non_commercial';
  if (invoiceVerification.status === 'verified') outcome = 'invoice_candidate_strong';
  else if (evaluation.sale.outcome === 'order_confirmed') outcome = 'chat_confirmed';
  else if (['customer_accepted','opportunity_detected','probable_sale'].includes(evaluation.sale.outcome)) outcome = 'open_opportunity';
  else if (['stockout_blocked','customer_declined'].includes(evaluation.sale.outcome)) outcome = 'lost_or_blocked';
  else if (operational.officialScoringEligible || operational.customerRequests.length || operational.products.some((row) => row.status === 'requested')) outcome = 'needs_review';

  const saleEndMessage = confirmationRows[confirmationRows.length - 1]
    || deliveryRows[deliveryRows.length - 1]
    || acceptanceRows[acceptanceRows.length - 1]
    || lastSaleMessage;
  const saleEndedAt = saleEndMessage?.timestamp.toISOString() || null;
  const saleEndSource: GroundedSaleJourneyV33['saleWindow']['endSource'] =
    saleEndMessage ? 'message' : 'none';

  const saleWindowIds = startMessage ? messageRange(session, startMessage, saleEndMessage) : [];
  const lastJourneyEvent = [...complaintRows, ...recoveryRows, ...closingRows, ...deliveryRows, ...(saleEndMessage ? [saleEndMessage] : [])]
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime()).at(-1) || saleEndMessage || startMessage;
  const journeyIds = startMessage ? messageRange(session, startMessage, lastJourneyEvent || null) : [];

  const firstResponseRow = startMessage
    ? session.messages.find((message) => message.direction === 'outbound' && message.timestamp.getTime() >= startMessage.timestamp.getTime()) || null
    : null;
  const delayIds = uniq(
    timing.responseTurns
      .filter((turn) => turn.noResponse || (turn.responseLatencySeconds != null && turn.responseLatencySeconds > 600))
      .flatMap((turn) => [...turn.inboundMessageIds, ...(turn.responseMessageId ? [turn.responseMessageId] : [])])
  );
  const unresolvedIds = uniq([
    ...timing.responseTurns.filter((turn) => turn.noResponse).flatMap((turn) => turn.inboundMessageIds),
    ...requestIds.filter((id) => !saleWindowIds.includes(id) && outcome !== 'invoice_candidate_strong'),
  ]);

  const stages: GroundedSaleStageV33[] = [
    makeStage('request', 'بداية الطلب', requestRows.length ? requestRows : (startMessage ? [startMessage] : []), 'أول رسالة عميل مرتبطة بطلب/صنف فعلي.', 96),
    makeStage('first_response', 'أول رد', firstResponseRow ? [firstResponseRow] : [], 'أول رد من الصيدلية بعد بداية الطلب.', firstResponseRow ? 96 : 0),
    makeStage('product_identification', 'تحديد الأصناف', productRows, 'رسائل مرتبطة بأصناف مستخرجة ومثبتة داخل المحادثة.', productRows.length ? 92 : 0),
    makeStage('availability', 'التوفر/النواقص', availabilityRows, 'رد صريح متعلق بالتوفر أو النقص.', availabilityRows.length ? 90 : 0),
    makeStage('recommendation', 'ترشيح/بديل', recommendationRows, 'رسائل مرتبطة بترشيح أو بديل.', recommendationRows.length ? 90 : 0),
    makeStage('customer_acceptance', 'موافقة العميل', acceptanceRows, 'رد قبول من العميل داخل رحلة بيع قائمة.', acceptanceRows.length ? 82 : 0),
    makeStage('order_confirmation', 'تأكيد الأصناف/الطلب', confirmationRows, 'تأكيد صريح من الصيدلية قبل إغلاق الطلب.', confirmationRows.length ? 95 : 0),
    invoiceVerification.status === 'verified'
      ? {
          key: 'invoice',
          label: 'الفاتورة',
          detected: true,
          at: invoiceVerification.bestCandidate?.invoiceDate || null,
          confidence: Math.round(invoiceVerification.verificationConfidence * 100),
          source: 'invoice',
          evidenceMessageIds: [],
          reason: `مطابقة فاتورة قوية ${invoiceVerification.bestCandidate?.invoiceNumber || 'مرتبطة'} — لا تُعد Sale Proof قبل اعتماد الربط Canonical.`,
        }
      : {
          key: 'invoice',
          label: 'الفاتورة',
          detected: false,
          at: null,
          confidence: 0,
          source: 'invoice',
          evidenceMessageIds: [],
          reason: 'لا توجد فاتورة Verified مرتبطة بقوة كافية.',
        },
    makeStage('delivery', 'التوصيل', deliveryRows, 'رسائل مرتبطة بالتوصيل/العنوان/المندوب.', deliveryRows.length ? 88 : 0),
    makeStage('complaint', 'شكوى/مشكلة', complaintRows, 'شكوى أو مشكلة صريحة من العميل.', complaintRows.length ? 95 : 0),
    makeStage('recovery', 'معالجة المشكلة', recoveryRows, 'اعتذار أو إجراء استعادة خدمة بعد مشكلة.', recoveryRows.length ? 92 : 0),
    makeStage('closing', 'الختام', closingRows, 'رسالة ختامية صريحة من الصيدلية.', closingRows.length ? 90 : 0),
  ];

  const strengths: string[] = [];
  const gaps: string[] = [];
  const delayPoints: string[] = [];
  const complaintPoints: string[] = [];

  if (invoiceVerification.status === 'verified') strengths.push('يوجد تطابق فاتورة قوي يمكن مراجعته واعتماد ربطه يدويًا.');
  if (evaluation.opening.score != null && evaluation.opening.score >= 85) strengths.push('افتتاح المحادثة واضح ومهني.');
  if (timing.responseSummary.firstResponseSeconds != null && timing.responseSummary.firstResponseSeconds <= 300) strengths.push('الرد الأول تم خلال 5 دقائق.');
  if (confirmationRows.length) strengths.push('تم تأكيد الأصناف/الطلب مع العميل قبل الإغلاق.');
  if (evaluation.closing.score != null && evaluation.closing.score >= 85) strengths.push('الختام واضح ومهني.');
  if (operational.recommendations.some((row) => row.accepted === true)) strengths.push('يوجد ترشيح/بديل قبله العميل.');

  if (!confirmationRows.length && ['invoice_candidate_strong','chat_confirmed','open_opportunity'].includes(outcome)) gaps.push('لم يظهر تأكيد واضح للأصناف والكميات مع العميل قبل الإغلاق.');
  if (evaluation.opening.score != null && evaluation.opening.score < 70) gaps.push('الافتتاح يحتاج تحسين أو استكمال عناصر الترحيب الرسمي.');
  if (evaluation.closing.score != null && evaluation.closing.score < 70) gaps.push('الختام يحتاج تحسين أو رسالة ختامية أوضح.');
  if (timing.responseSummary.unansweredTurns > 0) gaps.push(`يوجد ${timing.responseSummary.unansweredTurns} Turn للعميل بدون رد واضح.`);
  if (operational.products.some((row) => row.status === 'unavailable') && !operational.recommendations.length) gaps.push('ظهر نقص/عدم توفر بدون بديل واضح مثبت.');
  if (correctionMessageIds.length) gaps.push('العميل صحح معلومة/فهمًا سابقًا؛ راجع الرسالة التي سبقت التصحيح للتأكد من فهم الطلب.');

  if (delayIds.length) {
    const slowTurns = timing.responseTurns.filter((turn) => turn.noResponse || (turn.responseLatencySeconds != null && turn.responseLatencySeconds > 600));
    for (const turn of slowTurns.slice(0, 5)) {
      delayPoints.push(
        turn.noResponse
          ? 'طلب/رسالة عميل لم يظهر لها رد داخل نطاق المحادثة.'
          : `رد متأخر بحوالي ${Math.round((turn.responseLatencySeconds || 0) / 60)} دقيقة.`
      );
    }
  }
  if (complaintRows.length) {
    complaintPoints.push(...complaintRows.slice(0, 5).map((row) => row.text.slice(0, 140)));
    if (!recoveryRows.length) gaps.push('ظهرت شكوى بدون معالجة/احتواء واضح بعدها.');
    else strengths.push('تم التعامل مع شكوى أو مشكلة بمحاولة استعادة خدمة.');
  }

  const bestPracticeParts: number[] = [];
  if (evaluation.qualityScore != null) bestPracticeParts.push(evaluation.qualityScore);
  if (timing.responseSummary.within5mRate != null) bestPracticeParts.push(timing.responseSummary.within5mRate);
  if (invoiceVerification.status === 'verified') bestPracticeParts.push(85);
  if (confirmationRows.length) bestPracticeParts.push(100);
  if (evaluation.closing.score != null) bestPracticeParts.push(evaluation.closing.score);
  let bestPracticeScore = bestPracticeParts.length
    ? Math.round(bestPracticeParts.reduce((sum, value) => sum + value, 0) / bestPracticeParts.length)
    : null;
  if (bestPracticeScore != null) {
    bestPracticeScore -= Math.min(25, timing.responseSummary.unansweredTurns * 10);
    if (complaintRows.length && !recoveryRows.length) bestPracticeScore -= 15;
    bestPracticeScore = clamp(bestPracticeScore);
  }

  const directEvidenceIds = uniq([
    ...idsFromOperational(operational),
    ...confirmationRows.map((row) => row.id),
    ...complaintRows.map((row) => row.id),
    ...recoveryRows.map((row) => row.id),
    ...delayIds,
    ...closingRows.map((row) => row.id),
  ]);
  const stageCount = stages.filter((stage) => stage.detected).length;
  const evidenceCoverage = clamp(Math.round((stageCount / Math.max(1, stages.length)) * 100));
  const confidence = clamp(Math.round(
    (invoiceVerification.status === 'verified' ? 25 : 10) +
    Math.min(35, directEvidenceIds.length * 3) +
    Math.min(20, evidenceCoverage * 0.2) +
    (startMessage ? 10 : 0) +
    (saleEndSource !== 'none' ? 10 : 0)
  ));

  const warnings: string[] = [];
  if (!startMessage && outcome !== 'non_commercial') warnings.push('لم يتم تحديد بداية بيع برسالة مباشرة؛ لا ينبغي تفسير الملف كاملًا كرحلة بيع.');
  if (invoiceVerification.status === 'verified' && !productRows.length) warnings.push('البيع مثبت بالفاتورة لكن أصناف الطلب غير واضحة من نص المحادثة.');
  if (session.missingMediaCount) warnings.push(`يوجد ${session.missingMediaCount} مرفق غير متاح؛ قد يحتوي على تفاصيل منتج/طلب.`);
  if (participantRoles?.messages.some((row) => row.role === 'pharmacy_unknown' && row.confidence < 70)) warnings.push('بعض الرسائل الخارجة لم تُنسب لموظف محدد بثقة كافية.');

  const contributions = roleContribution(session, participantRoles);
  const staffCoaching = contributions.map((staff) => {
    const key = normalizeStaffName(staff.staffName);
    const owned = new Set(staff.messageIds);
    const staffTurns = timing.responseTurns.filter((turn) =>
      turn.responseMessageId &&
      owned.has(turn.responseMessageId) &&
      normalizeStaffName(turn.responderStaffName || '') === key
    );
    const latencies = staffTurns
      .map((turn) => turn.responseLatencySeconds)
      .filter((value): value is number => typeof value === 'number');
    const confirmationCount = confirmationRows.filter((row) => owned.has(row.id)).length;
    const recommendationCount = recommendationRows.filter((row) => owned.has(row.id)).length;
    const recoveryCount = recoveryRows.filter((row) => owned.has(row.id)).length;
    const closingCount = closingRows.filter((row) => owned.has(row.id)).length;

    let complaintResponseCount = 0;
    const complaintResponseIds: string[] = [];
    for (const complaint of complaintRows) {
      const response = session.messages.find((message) =>
        message.direction === 'outbound' &&
        message.timestamp.getTime() >= complaint.timestamp.getTime() &&
        message.timestamp.getTime() - complaint.timestamp.getTime() <= 60 * 60 * 1000
      );
      if (response && owned.has(response.id)) {
        complaintResponseCount += 1;
        complaintResponseIds.push(response.id);
      }
    }

    const strengths: string[] = [];
    const gaps: string[] = [];
    const findings: GroundedSaleJourneyV33['staffCoaching'][number]['findings'] = [];

    const firstOutbound = session.messages.find((message) => message.direction === 'outbound') || null;
    const lastOutbound = [...session.messages].reverse().find((message) => message.direction === 'outbound') || null;
    const ownsOpening = Boolean(firstOutbound && owned.has(firstOutbound.id));
    const ownsClosing = Boolean(lastOutbound && owned.has(lastOutbound.id));
    const openingEvidenceOwned = evaluation.opening.evidence.messageIds.filter((id) => owned.has(id));
    const closingEvidenceOwned = evaluation.closing.evidence.messageIds.filter((id) => owned.has(id));
    const officialWelcomeMatched = evaluation.opening.evidence.reason.includes('قالب ترحيب رسمي معتمد');
    const officialClosingMatched = evaluation.closing.passed.includes('ختام رسمي معتمد');

    if (ownsOpening && officialWelcomeMatched) {
      strengths.push('استخدم صيغة ترحيب رسمية معتمدة.');
      findings.push({
        type: 'opening',
        tone: 'strong',
        title: 'ترحيب رسمي معتمد',
        detail: evaluation.opening.evidence.reason,
        evidenceMessageIds: openingEvidenceOwned.length ? openingEvidenceOwned : [firstOutbound!.id],
        attributionConfidence: evaluation.opening.evidence.confidence,
      });
    } else if (ownsOpening && evaluation.opening.missing.length) {
      const missingOpening = evaluation.opening.missing.slice(0, 3).join('، ');
      gaps.push(`الافتتاح ناقص: ${missingOpening}.`);
      findings.push({
        type: 'opening',
        tone: 'improvement',
        title: 'الترحيب الرسمي غير مكتمل',
        detail: `العناصر الناقصة في أول تواصل: ${missingOpening}.`,
        evidenceMessageIds: openingEvidenceOwned.length ? openingEvidenceOwned : [firstOutbound!.id],
        attributionConfidence: evaluation.opening.evidence.confidence,
      });
    }

    if (ownsClosing && officialClosingMatched) {
      strengths.push('استخدم صيغة ختام رسمية معتمدة.');
      findings.push({
        type: 'closing',
        tone: 'strong',
        title: 'ختام رسمي معتمد',
        detail: evaluation.closing.evidence.reason,
        evidenceMessageIds: closingEvidenceOwned.length ? closingEvidenceOwned : [lastOutbound!.id],
        attributionConfidence: evaluation.closing.evidence.confidence,
      });
    } else if (ownsClosing && evaluation.closing.missing.length) {
      const missingClosing = evaluation.closing.missing.slice(0, 3).join('، ');
      gaps.push(`الختام ناقص: ${missingClosing}.`);
      findings.push({
        type: 'closing',
        tone: 'improvement',
        title: 'الختام الرسمي غير مكتمل',
        detail: `العناصر الناقصة في نهاية التواصل: ${missingClosing}.`,
        evidenceMessageIds: closingEvidenceOwned.length ? closingEvidenceOwned : [lastOutbound!.id],
        attributionConfidence: evaluation.closing.evidence.confidence,
      });
    }

    const medianResponseSeconds = median(latencies);
    const slowTurns = staffTurns.filter((turn) =>
      typeof turn.responseLatencySeconds === 'number' && turn.responseLatencySeconds > 600
    );
    const slowResponseCount = slowTurns.length;

    for (const turn of slowTurns.slice(0, 5)) {
      findings.push({
        type: 'response_delay',
        tone: 'improvement',
        title: 'رد متأخر على العميل',
        detail: `الرد المسجل اتأخر حوالي ${Math.round((turn.responseLatencySeconds || 0) / 60)} دقيقة.`,
        evidenceMessageIds: uniq([
          ...turn.inboundMessageIds,
          ...(turn.responseMessageId ? [turn.responseMessageId] : []),
        ]),
        attributionConfidence: 96,
      });
    }

    const correctionSignals = (understanding?.signals || []).filter((signal) =>
      signal.type === 'correction' &&
      signal.confidence >= 0.6 &&
      (signal.relatedMessageIds || []).some((id) => owned.has(id))
    );
    for (const correction of correctionSignals.slice(0, 4)) {
      const correctedStaffIds = (correction.relatedMessageIds || []).filter((id) => owned.has(id));
      findings.push({
        type: 'understanding_correction',
        tone: 'improvement',
        title: 'العميل صحح فهمًا/معلومة',
        detail: 'العميل صحح رسالة سابقة لهذا الموظف؛ راجع الرسالة المصححة والتصحيح نفسه قبل تقييم فهم الطلب.',
        evidenceMessageIds: uniq([...correctedStaffIds, correction.messageId]),
        attributionConfidence: Math.round(correction.confidence * 100),
      });

      const correctionMessage = byId.get(correction.messageId);
      if (correctionMessage) {
        const laterOwnedResponse = session.messages.find((message) =>
          owned.has(message.id) &&
          message.direction === 'outbound' &&
          message.timestamp.getTime() > correctionMessage.timestamp.getTime() &&
          message.timestamp.getTime() - correctionMessage.timestamp.getTime() <= 10 * 60 * 1000
        );
        if (laterOwnedResponse) {
          findings.push({
            type: 'correction_recovery',
            tone: 'context',
            title: 'استجابة بعد تصحيح العميل',
            detail: 'ظهر رد من نفس الموظف بعد تصحيح العميل. وجود الرد مثبت، أما جودة التصحيح نفسه فتُراجع من النص.',
            evidenceMessageIds: [correction.messageId, laterOwnedResponse.id],
            attributionConfidence: 92,
          });
        }
      }
    }

    if (latencies.length && latencies.every((value) => value <= 300)) {
      strengths.push('ردوده المسجلة على Turns العملاء كانت خلال 5 دقائق.');
      findings.push({
        type: 'response_delay',
        tone: 'strong',
        title: 'سرعة رد جيدة',
        detail: 'كل Turns العملاء المنسوبة لهذا الموظف في هذه المحادثة تم الرد عليها خلال 5 دقائق.',
        evidenceMessageIds: uniq(staffTurns.flatMap((turn) => [
          ...turn.inboundMessageIds,
          ...(turn.responseMessageId ? [turn.responseMessageId] : []),
        ])).slice(0, 12),
        attributionConfidence: 96,
      });
    } else if (slowResponseCount) {
      gaps.push(`لديه ${slowResponseCount} رد متأخر أكثر من 10 دقائق داخل نطاقه.`);
    }
    if (confirmationCount) {
      strengths.push('نفذ تأكيدًا واضحًا للأصناف/الطلب مع العميل.');
      findings.push({
        type: 'order_confirmation',
        tone: 'strong',
        title: 'تأكيد واضح للطلب',
        detail: 'ظهر تأكيد صريح/سياقي قوي للطلب في رسالة يملكها هذا الموظف.',
        evidenceMessageIds: confirmationRows.filter((row) => owned.has(row.id)).map((row) => row.id),
        attributionConfidence: 96,
      });
    }
    if (recommendationCount) strengths.push('قدّم ترشيحًا/بديلًا مثبتًا في المحادثة.');
    if (recoveryCount) strengths.push('شارك في معالجة شكوى/تأخير بإجراء استعادة خدمة.');
    if (closingCount) {
      strengths.push('أنهى الجزء الخاص به بختام واضح.');
      if (!findings.some((finding) => finding.type === 'closing' && finding.tone === 'strong')) {
        findings.push({
          type: 'closing',
          tone: 'strong',
          title: 'ختام واضح',
          detail: 'ظهر ختام خدمة واضح في رسالة من هذا الموظف.',
          evidenceMessageIds: closingRows.filter((row) => owned.has(row.id)).map((row) => row.id),
          attributionConfidence: 95,
        });
      }
    }
    if (complaintResponseCount) strengths.push('رد على شكوى العميل داخل نطاق مسؤوليته.');

    for (const complaint of complaintRows) {
      const complaintIndex = session.messages.findIndex((message) => message.id === complaint.id);
      const nextOutbound = complaintIndex >= 0
        ? session.messages.slice(complaintIndex + 1).find((message) => message.direction === 'outbound')
        : null;
      if (!nextOutbound || !owned.has(nextOutbound.id)) continue;
      const handledWithRecovery = recoveryRows.some((row) => owned.has(row.id) && row.timestamp.getTime() >= complaint.timestamp.getTime());
      findings.push({
        type: 'complaint_handling',
        tone: handledWithRecovery ? 'strong' : 'context',
        title: handledWithRecovery ? 'تعامل مع الشكوى بإجراء استعادة' : 'رد على شكوى العميل',
        detail: handledWithRecovery
          ? 'الشكوى نفسها لا تُنسب للموظف؛ المثبت أنه رد عليها وظهر إجراء احتواء/استعادة خدمة في رسائله.'
          : 'الشكوى نفسها لا تُنسب للموظف؛ المثبت فقط أنه صاحب أول رد بعدها، ويحتاج نص الرد للمراجعة.',
        evidenceMessageIds: uniq([complaint.id, nextOutbound.id, ...recoveryRows.filter((row) => owned.has(row.id)).map((row) => row.id)]).slice(0, 8),
        attributionConfidence: 94,
      });
    }

    const staffCommercialMessages = staff.messageIds.filter((id) => saleWindowIds.includes(id));
    if (staffCommercialMessages.length && !confirmationCount && ['invoice_candidate_strong','chat_confirmed'].includes(outcome)) {
      gaps.push('شارك في رحلة بيع مكتملة لكن لم يظهر في رسائله تأكيد صريح للأصناف مع العميل.');
      findings.push({
        type: 'order_confirmation',
        tone: 'improvement',
        title: 'تأكيد الطلب غير ظاهر في رسائله',
        detail: 'شارك في رحلة بيع وصلت للإغلاق/مرشح فاتورة قوي، لكن لا يوجد تأكيد طلب مثبت في الرسائل المنسوبة له.',
        evidenceMessageIds: staffCommercialMessages.slice(0, 10),
        attributionConfidence: 88,
      });
    }
    if (staffCommercialMessages.length && !closingCount) {
      gaps.push('لا يظهر ختام واضح في الجزء الذي تولاه من رحلة البيع.');
      if (!findings.some((finding) => finding.type === 'closing' && finding.tone === 'improvement')) {
        findings.push({
          type: 'closing',
          tone: 'improvement',
          title: 'الختام غير ظاهر في الجزء الذي تولاه',
          detail: 'يوجد نشاط تجاري من الموظف، لكن لا توجد رسالة ختام مثبتة باسمه داخل نطاق الرحلة.',
          evidenceMessageIds: staffCommercialMessages.slice(-8),
          attributionConfidence: 86,
        });
      }
    }

    if (contributions.length > 1 && staff.messageIds.length) {
      const firstOwnedIndex = session.messages.findIndex((message) => owned.has(message.id));
      const previousOutbound = firstOwnedIndex > 0
        ? [...session.messages.slice(0, firstOwnedIndex)].reverse().find((message) => message.direction === 'outbound' && !owned.has(message.id))
        : null;
      if (previousOutbound) {
        findings.push({
          type: 'handoff',
          tone: 'context',
          title: 'استلام المحادثة بعد موظف آخر',
          detail: 'هذه نقطة Handoff موثقة وليست خطأ تلقائيًا. راجع استمرارية السياق بين الرسالتين عند الحاجة.',
          evidenceMessageIds: [previousOutbound.id, staff.messageIds[0]],
          attributionConfidence: 90,
        });
      }
    }

    const scoreParts: number[] = [];
    if (medianResponseSeconds != null) scoreParts.push(medianResponseSeconds <= 300 ? 100 : medianResponseSeconds <= 600 ? 80 : medianResponseSeconds <= 900 ? 60 : 40);
    if (staffCommercialMessages.length) scoreParts.push(confirmationCount ? 100 : 55);
    if (staffCommercialMessages.length) scoreParts.push(closingCount ? 100 : 65);
    if (complaintResponseCount) scoreParts.push(recoveryCount ? 100 : 65);
    if (recommendationCount) scoreParts.push(90);
    let score = scoreParts.length ? Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length) : null;
    if (score != null) score = clamp(score - Math.min(20, slowResponseCount * 8));

    return {
      staffName: staff.staffName,
      role: staff.role,
      evidenceMessageIds: uniq([
        ...staffCommercialMessages,
        ...complaintResponseIds,
        ...confirmationRows.filter((row) => owned.has(row.id)).map((row) => row.id),
        ...recoveryRows.filter((row) => owned.has(row.id)).map((row) => row.id),
      ]),
      responseTurnCount: staffTurns.length,
      medianResponseSeconds,
      slowResponseCount,
      confirmationCount,
      recommendationCount,
      recoveryCount,
      closingCount,
      complaintResponseCount,
      findings,
      strengths: uniq(strengths),
      gaps: uniq(gaps),
      score,
      label: score == null
        ? 'لا توجد أدلة كافية للتقييم الشخصي'
        : score >= 90
          ? 'أداء قوي جدًا'
          : score >= 80
            ? 'أداء جيد'
            : score >= 65
              ? 'أداء مقبول مع نقاط تحسين'
              : 'يحتاج مراجعة وتدريب',
    };
  });

  const blockers: string[] = [];
  const caveats: string[] = [];
  if (outcome !== 'non_commercial' && !startMessage) {
    blockers.push('بداية رحلة البيع غير مثبتة برسالة عميل ذات معنى.');
  }
  if (args.customerAmbiguous) {
    blockers.push('هوية العميل لها أكثر من مرشح ولا يجوز اختيار أحدهم تلقائيًا.');
  }
  if (session.missingMediaCount > 0 && !productRows.length && outcome !== 'non_commercial') {
    blockers.push('تفاصيل الطلب قد تكون داخل ميديا غير متاحة ولا يوجد دليل صنف نصي بديل.');
  } else if (session.missingMediaCount > 0) {
    caveats.push(`يوجد ${session.missingMediaCount} مرفق غير متاح؛ محتوى المرفق نفسه غير محسوم.`);
  }
  if (invoiceVerification.status === 'verified' && invoiceItemCount === 0) {
    caveats.push('الفاتورة مؤكدة لكن Line Items غير متاحة؛ حقيقة البيع مؤكدة ومطابقة الأصناف جزئية.');
  }
  if (correctionMessageIds.length) {
    caveats.push('يوجد تصحيح من العميل؛ يجب مراجعة الرسالة المصححة عند تقييم فهم الطلب.');
  }
  const unknownStaffEvidence = participantRoles?.messages.filter(
    (row) => row.role === 'pharmacy_unknown' && row.confidence < 70
  ).length || 0;
  if (unknownStaffEvidence) {
    caveats.push(`يوجد ${unknownStaffEvidence} رسالة صادرة بهوية موظف غير محسومة.`);
  }
  if (outcome !== 'non_commercial' && directEvidenceIds.length < 2) {
    caveats.push('الأدلة المباشرة قليلة؛ الاستنتاجات السلوكية تحتاج مراجعة بشرية.');
  }
  const truthStatus: GroundedSaleJourneyV33['truthQuality']['status'] =
    blockers.length ? 'review_required' : caveats.length ? 'partial' : 'grounded';

  const outcomeLabel: Record<GroundedSaleJourneyV33['outcome'], string> = {
    invoice_candidate_strong: 'مطابقة فاتورة قوية — تحتاج اعتماد الربط',
    chat_confirmed: 'طلب مؤكد في المحادثة — الفاتورة غير مثبتة',
    open_opportunity: 'فرصة بيع مفتوحة',
    lost_or_blocked: 'بيع توقف/لم يكتمل',
    non_commercial: 'لا توجد رحلة بيع مثبتة',
    needs_review: 'رحلة تجارية تحتاج مراجعة',
  };

  return {
    version: 'whatsapp-grounded-sale-journey-v33',
    grounded: true,
    outcome,
    outcomeLabel: outcomeLabel[outcome],
    commercial: outcome !== 'non_commercial',
    saleWindow: {
      startedAt: startMessage?.timestamp.toISOString() || null,
      endedAt: saleEndedAt,
      startMessageId: startMessage?.id || null,
      endMessageId: saleEndMessage?.id || null,
      endSource: saleEndSource,
      messageIds: saleWindowIds,
    },
    customerJourneyWindow: {
      startedAt: startMessage?.timestamp.toISOString() || session.startedAt.toISOString(),
      endedAt: lastJourneyEvent?.timestamp.toISOString() || session.endedAt.toISOString(),
      messageIds: journeyIds.length ? journeyIds : session.messages.filter((message) => message.direction !== 'system').map((message) => message.id),
    },
    stages,
    evidenceMessageIds: directEvidenceIds,
    complaintMessageIds: complaintRows.map((row) => row.id),
    delayMessageIds: delayIds,
    unresolvedMessageIds: unresolvedIds,
    correctionMessageIds: uniq(correctionMessageIds),
    understanding: {
      interactionCount: understanding?.interactions.length || 0,
      meaningfulMessageCount: understanding?.messages.filter((message) => message.isMeaningful).length || 0,
      ignoredMessageCount: understanding?.messages.filter((message) => !message.isMeaningful).length || 0,
      semanticSignalCount: understanding?.signals.length || 0,
      requestSignalCount: (understanding?.signals || []).filter((signal) => signal.type === 'request').length,
      confirmationSignalCount: (understanding?.signals || []).filter((signal) => signal.type === 'confirmation' && signal.confidence >= 0.7).length,
      correctionSignalCount: correctionMessageIds.length,
    },
    staffContribution: contributions,
    staffCoaching,
    coaching: {
      strengths: uniq(strengths),
      gaps: uniq(gaps),
      complaintPoints: uniq(complaintPoints),
      delayPoints: uniq(delayPoints),
      bestPracticeScore,
      bestPracticeLabel: bestPracticeScore == null
        ? 'لا توجد أدلة كافية'
        : bestPracticeScore >= 90
          ? 'محادثة قوية جدًا ويمكن التعلم منها'
          : bestPracticeScore >= 80
            ? 'محادثة جيدة'
            : bestPracticeScore >= 65
              ? 'جيدة جزئيًا وتحتاج تحسينات محددة'
              : 'تحتاج تدريب ومراجعة',
    },
    evidenceCoverage,
    confidence,
    truthQuality: {
      status: truthStatus,
      decisionReady: blockers.length === 0,
      directMessageEvidenceCount: directEvidenceIds.length,
      invoiceCandidateStrong: invoiceVerification.status === 'verified',
      customerResolved: Boolean(args.customerResolved),
      invoiceItemCount,
      blockers: uniq(blockers),
      caveats: uniq(caveats),
    },
    warnings: uniq([...warnings, ...blockers, ...caveats]),
  };
}
