import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type WhatsAppCaseTypeV22 = 'order' | 'complaint' | 'recommendation' | 'followup' | 'mixed';
export type WhatsAppCaseStateV22 = 'open' | 'awaiting_customer' | 'awaiting_pharmacy' | 'confirmed_order' | 'failed' | 'recovery' | 'reengaged' | 'closed';

export interface WhatsAppCaseSessionSignalV22 {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  orderIntent: boolean;
  orderConfirmed: boolean;
  failure: boolean;
  complaint: boolean;
  apology: boolean;
  followup: boolean;
  feedback: boolean;
  recommendation: boolean;
  customerReplied: boolean;
  lastDirection: 'inbound' | 'outbound' | 'system';
  staffNames: string[];
  mediaReferenced: number;
  mediaAvailable: number;
  mediaMissing: number;
  evidenceMessageIds: string[];
}

export interface WhatsAppCustomerCaseV22 {
  id: string;
  type: WhatsAppCaseTypeV22;
  state: WhatsAppCaseStateV22;
  startedAt: string;
  lastEventAt: string;
  sessionIds: string[];
  staffNames: string[];
  evidenceMessageIds: string[];
  orderIntent: boolean;
  orderConfirmed: boolean;
  failure: boolean;
  complaint: boolean;
  recommendation: boolean;
  recoveryAttempts: number;
  customerReengaged: boolean;
  mediaReferenced: number;
  mediaAvailable: number;
  mediaMissing: number;
  mediaCoveragePercent: number;
  semanticCoverage: 'full_text' | 'text_with_available_media' | 'text_with_missing_media';
  needsHumanReview: boolean;
  nextAction: string | null;
  summary: string;
}

export interface WhatsAppCustomerCaseEngineV22 {
  version: 'whatsapp-customer-case-v22';
  sessionCount: number;
  caseCount: number;
  openCaseCount: number;
  recoveryCaseCount: number;
  cases: WhatsAppCustomerCaseV22[];
  mediaReferenced: number;
  mediaAvailable: number;
  mediaMissing: number;
  mediaCoveragePercent: number;
  analysisCoverageLabel: string;
}

const ORDER_RX = /(عايز|عاوز|محتاج|ابعت|ابعث|هات|اطلب|أطلب|متوفر|موجود عندكم|عندكم|اوردر|أوردر|طلب)/i;
const ORDER_CONFIRM_RX = /(تم تأكيد|تم التاكيد|الأوردر اتأكد|الاوردر اتاكد|جاري الارسال|جاري الإرسال|خرج لحضرتك|اتعملت الفاتوره|اتعملت الفاتورة|الفاتوره اتعملت|الفاتورة اتعملت)/i;
const FAILURE_RX = /(ماوصلش|موصلش|الاوردر ماطلعش|الأوردر ماطلعش|الطلب ماطلعش|محدش جه|ماجاش|مجاش|اتلغى|اتلغي|لم يتم|ما تمش|مش هينفع يتبعت)/i;
const COMPLAINT_RX = /(شكوي|شكوى|زعلت|اتضايقت|مش راضي|مش مبسوط|خدمه سيئه|خدمة سيئة|مشكله|مشكلة|محدش رد|التأخير|التاخير)/i;
const APOLOGY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|آسفين|اسفين|حق حضرتك علينا|نعتذر لحضرتك|نعوض حضرتك)/i;
const FOLLOWUP_RX = /(حابين نطمن|حبيت اطمن|حبيت أطمن|متابعه|متابعة|بنطمن|نطمن|هتابع|هتواصل|اول ما|أول ما)/i;
const FEEDBACK_RX = /(راضي عن الخدمه|راضي عن الخدمة|كانت الخدمه|كانت الخدمة|تقييم الخدمه|تقييم الخدمة|على مستوى رضا|رأي حضرتك|راي حضرتك)/i;
const RECOMMEND_RX = /(ارشح|أرشح|نرشح|ترشيح|انصح|أنصح|بديل|ممكن تستخدم|ممكن تاخد|ممكن تاخدي)/i;
const MEDIA_KINDS = new Set(['image', 'voice', 'video', 'document']);

function normalizeName(value: unknown) {
  return String(value ?? '')
    .trim().toLowerCase()
    .replace(/^(?:د\s*[\/.\-]?\s*|دكتور(?:ه|ة)?\s+)/i, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalNames(names: string[]) {
  const map = new Map<string, string>();
  for (const name of names) {
    const key = normalizeName(name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, name.trim());
  }
  return [...map.values()];
}

function text(messages: WhatsAppParsedMessage[]) {
  return messages.map((m) => m.text).join('\n');
}

function signalForSession(session: WhatsAppConversationSession): WhatsAppCaseSessionSignalV22 {
  const inbound = session.messages.filter((m) => m.direction === 'inbound');
  const outbound = session.messages.filter((m) => m.direction === 'outbound');
  const inText = text(inbound);
  const outText = text(outbound);
  const allText = `${inText}\n${outText}`;
  const meaningful = session.messages.filter((m) => m.direction !== 'system');
  const lastDirection = meaningful.at(-1)?.direction || 'system';
  const mediaRows = session.messages.filter((m) => MEDIA_KINDS.has(m.kind));
  const mediaAvailable = mediaRows.filter((m) => m.mediaAvailable).length;
  const evidenceMessageIds = session.messages
    .filter((m) => ORDER_RX.test(m.text) || ORDER_CONFIRM_RX.test(m.text) || FAILURE_RX.test(m.text) || COMPLAINT_RX.test(m.text) || APOLOGY_RX.test(m.text) || FOLLOWUP_RX.test(m.text) || FEEDBACK_RX.test(m.text) || RECOMMEND_RX.test(m.text))
    .map((m) => m.id)
    .slice(0, 30);

  return {
    sessionId: session.id,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
    orderIntent: ORDER_RX.test(inText),
    orderConfirmed: ORDER_CONFIRM_RX.test(allText),
    failure: FAILURE_RX.test(allText),
    complaint: COMPLAINT_RX.test(allText),
    apology: APOLOGY_RX.test(outText),
    followup: FOLLOWUP_RX.test(outText),
    feedback: FEEDBACK_RX.test(outText),
    recommendation: RECOMMEND_RX.test(outText),
    customerReplied: inbound.length > 0,
    lastDirection,
    staffNames: canonicalNames(session.outboundStaffNames),
    mediaReferenced: mediaRows.length,
    mediaAvailable,
    mediaMissing: Math.max(0, mediaRows.length - mediaAvailable),
    evidenceMessageIds,
  };
}

function hoursBetween(a: string, b: string) {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

function isFollowupOnly(s: WhatsAppCaseSessionSignalV22) {
  return !s.orderIntent && !s.recommendation && (s.followup || s.feedback || s.apology);
}

function shouldAttach(caseRows: WhatsAppCaseSessionSignalV22[], next: WhatsAppCaseSessionSignalV22) {
  const last = caseRows.at(-1)!;
  const gapHours = hoursBetween(last.endedAt, next.startedAt);
  const hasProblem = caseRows.some((x) => x.failure || x.complaint);
  const isOpenOrder = caseRows.some((x) => x.orderIntent) && !caseRows.some((x) => x.orderConfirmed && !x.failure);

  if (gapHours <= 18) return true;
  if (hasProblem && isFollowupOnly(next) && gapHours <= 24 * 14) return true;
  if (isOpenOrder && isFollowupOnly(next) && gapHours <= 24 * 7) return true;
  if (caseRows.some((x) => x.recommendation) && isFollowupOnly(next) && gapHours <= 24 * 7) return true;
  return false;
}

function deriveType(rows: WhatsAppCaseSessionSignalV22[]): WhatsAppCaseTypeV22 {
  const hasOrder = rows.some((x) => x.orderIntent);
  const hasComplaint = rows.some((x) => x.complaint || x.failure);
  const hasRecommendation = rows.some((x) => x.recommendation);
  if ([hasOrder, hasComplaint, hasRecommendation].filter(Boolean).length >= 2) return 'mixed';
  if (hasComplaint) return 'complaint';
  if (hasOrder) return 'order';
  if (hasRecommendation) return 'recommendation';
  return 'followup';
}

function deriveCase(rows: WhatsAppCaseSessionSignalV22[], index: number): WhatsAppCustomerCaseV22 {
  const hasOrder = rows.some((x) => x.orderIntent);
  const orderConfirmed = rows.some((x) => x.orderConfirmed);
  const failure = rows.some((x) => x.failure);
  const complaint = rows.some((x) => x.complaint);
  const recommendation = rows.some((x) => x.recommendation);
  const recoveryAttempts = rows.filter((x) => x.apology || x.feedback || x.followup).length;
  const problemIndex = rows.findIndex((x) => x.failure || x.complaint);
  const customerReengaged = problemIndex >= 0 && rows.slice(problemIndex + 1).some((x) => x.customerReplied && (x.orderIntent || x.recommendation));
  const last = rows.at(-1)!;
  const lastDirection = last.lastDirection;

  let state: WhatsAppCaseStateV22 = 'open';
  if (failure && recoveryAttempts > 0 && !customerReengaged) state = 'recovery';
  else if (failure && !customerReengaged) state = 'failed';
  else if ((failure || complaint) && customerReengaged) state = 'reengaged';
  else if (hasOrder && orderConfirmed) state = 'confirmed_order';
  else if (lastDirection === 'outbound') state = 'awaiting_customer';
  else if (lastDirection === 'inbound') state = 'awaiting_pharmacy';
  else state = 'closed';

  const mediaReferenced = rows.reduce((sum, x) => sum + x.mediaReferenced, 0);
  const mediaAvailable = rows.reduce((sum, x) => sum + x.mediaAvailable, 0);
  const mediaMissing = rows.reduce((sum, x) => sum + x.mediaMissing, 0);
  const mediaCoveragePercent = mediaReferenced ? Math.round((mediaAvailable / mediaReferenced) * 100) : 100;
  const semanticCoverage = mediaReferenced === 0 ? 'full_text' : mediaMissing > 0 ? 'text_with_missing_media' : 'text_with_available_media';
  const needsHumanReview = mediaMissing > 0 || failure || complaint || (recommendation && !orderConfirmed);

  let nextAction: string | null = null;
  if (state === 'recovery' || state === 'failed') nextAction = 'متابعة استرجاع العميل حتى إعادة التفاعل أو وجود نتيجة موثقة.';
  else if (state === 'awaiting_pharmacy') nextAction = 'العميل ينتظر رد/تنفيذ من الصيدلية.';
  else if (state === 'awaiting_customer' && recommendation) nextAction = 'متابعة قرار العميل بخصوص الترشيح.';
  else if (state === 'awaiting_customer') nextAction = 'متابعة العميل إذا تجاوزت المهلة التشغيلية.';

  const type = deriveType(rows);
  const typeLabel: Record<WhatsAppCaseTypeV22, string> = {
    order: 'طلب', complaint: 'شكوى/تعثر', recommendation: 'ترشيح', followup: 'متابعة', mixed: 'طلب متعدد المراحل',
  };
  const stateLabel: Record<WhatsAppCaseStateV22, string> = {
    open: 'مفتوحة', awaiting_customer: 'بانتظار العميل', awaiting_pharmacy: 'بانتظار الصيدلية', confirmed_order: 'أوردر مؤكد', failed: 'متعثر', recovery: 'استرجاع', reengaged: 'العميل عاد للتفاعل', closed: 'مغلقة',
  };

  return {
    id: `${new Date(rows[0].startedAt).getTime()}-${index}`,
    type,
    state,
    startedAt: rows[0].startedAt,
    lastEventAt: last.endedAt,
    sessionIds: rows.map((x) => x.sessionId),
    staffNames: canonicalNames(rows.flatMap((x) => x.staffNames)),
    evidenceMessageIds: [...new Set(rows.flatMap((x) => x.evidenceMessageIds))].slice(0, 80),
    orderIntent: hasOrder,
    orderConfirmed,
    failure,
    complaint,
    recommendation,
    recoveryAttempts,
    customerReengaged,
    mediaReferenced,
    mediaAvailable,
    mediaMissing,
    mediaCoveragePercent,
    semanticCoverage,
    needsHumanReview,
    nextAction,
    summary: `${typeLabel[type]} — ${stateLabel[state]}${mediaMissing ? ` — ${mediaMissing} مرفق مفقود من التصدير` : ''}`,
  };
}

export function buildWhatsAppCustomerCaseEngineV22(sessions: WhatsAppConversationSession[]): WhatsAppCustomerCaseEngineV22 {
  const signals = [...sessions]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map(signalForSession);

  const groups: WhatsAppCaseSessionSignalV22[][] = [];
  let current: WhatsAppCaseSessionSignalV22[] = [];
  for (const signal of signals) {
    if (!current.length) {
      current = [signal];
      continue;
    }
    if (shouldAttach(current, signal)) current.push(signal);
    else {
      groups.push(current);
      current = [signal];
    }
  }
  if (current.length) groups.push(current);

  const cases = groups.map(deriveCase);
  const mediaReferenced = cases.reduce((sum, c) => sum + c.mediaReferenced, 0);
  const mediaAvailable = cases.reduce((sum, c) => sum + c.mediaAvailable, 0);
  const mediaMissing = cases.reduce((sum, c) => sum + c.mediaMissing, 0);
  const mediaCoveragePercent = mediaReferenced ? Math.round((mediaAvailable / mediaReferenced) * 100) : 100;
  const openStates = new Set<WhatsAppCaseStateV22>(['open', 'awaiting_customer', 'awaiting_pharmacy', 'failed', 'recovery']);

  return {
    version: 'whatsapp-customer-case-v22',
    sessionCount: sessions.length,
    caseCount: cases.length,
    openCaseCount: cases.filter((c) => openStates.has(c.state)).length,
    recoveryCaseCount: cases.filter((c) => c.state === 'recovery' || c.state === 'failed').length,
    cases,
    mediaReferenced,
    mediaAvailable,
    mediaMissing,
    mediaCoveragePercent,
    analysisCoverageLabel: mediaReferenced === 0
      ? 'السجل نصي بالكامل.'
      : mediaMissing === 0
        ? 'كل الميديا المشار إليها موجودة داخل التصدير، لكن فهم محتواها يعتمد على توفر Vision/Transcription.'
        : `يوجد ${mediaMissing} مرفقًا مشارًا إليه لكنه غير موجود داخل التصدير؛ لا يتم تخمين محتواه.`,
  };
}
