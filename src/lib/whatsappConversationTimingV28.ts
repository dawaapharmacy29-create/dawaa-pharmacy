import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from './whatsappParticipantRoleResolverV15';
import type { UnifiedInvoiceVerification } from './whatsappUnifiedIntelligenceV4';
import { buildWhatsAppResponseTurnsV18 } from './whatsappResponseTurnsV18';

export type TimingStageV28 =
  | 'opening'
  | 'order_request'
  | 'order_confirmation'
  | 'delay_or_problem'
  | 'service_recovery'
  | 'followup'
  | 'general';

export interface ConversationEpisodeV28 {
  id: string;
  label: string;
  stage: TimingStageV28;
  startedAt: string;
  endedAt: string;
  gapFromPreviousMinutes: number | null;
  messageIds: string[];
}

export interface ConversationTimingV28 {
  version: 'whatsapp-conversation-timing-v28';
  caseStartedAt: string;
  caseEndedAt: string;
  totalCaseMinutes: number;
  episodes: ConversationEpisodeV28[];
  responseTurns: Array<{
    turnKey: string;
    inboundStartedAt: string;
    inboundEndedAt: string;
    responseAt: string | null;
    responseLatencySeconds: number | null;
    noResponse: boolean;
    responderStaffName: string | null;
    responderRole: string | null;
    inboundMessageIds: string[];
    responseMessageId: string | null;
  }>;
  responseSummary: {
    customerTurns: number;
    answeredTurns: number;
    unansweredTurns: number;
    firstResponseSeconds: number | null;
    medianResponseSeconds: number | null;
    maxResponseSeconds: number | null;
    within5mRate: number | null;
    within10mRate: number | null;
  };
  orderTimeline: {
    requestAt: string | null;
    firstResponseAt: string | null;
    confirmedAt: string | null;
    delayOrProblemAt: string | null;
    recoveryAt: string | null;
    invoiceAt: string | null;
    requestToFirstResponseSeconds: number | null;
    requestToConfirmationSeconds: number | null;
    confirmationToProblemSeconds: number | null;
    problemToRecoverySeconds: number | null;
  };
  handoff: {
    responderNames: string[];
    responderCount: number;
    handoffCount: number;
  };
}

const ORDER_RX = /(عايز|عاوز|محتاج|ابعت|ابعث|هات|اطلب|أطلب|متوفر|موجود عندكم|بكام|السعر|اوردر|أوردر|طلب)/i;
const CONFIRM_RX = /(تم تأكيد|تم التاكيد|تم التأكيد|الأوردر اتأكد|الاوردر اتاكد|تم تسجيل الطلب|جاري الارسال|جاري الإرسال|خرج لحضرتك|هيتم التوصيل)/i;
const PROBLEM_RX = /(متاخر|متأخر|تاخير|تأخير|ماوصلش|موصلش|لسه مجاش|مشكله|مشكلة|غلط|شكوى|شكوي)/i;
const RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|بنتابع|هنتابع|هنراجع|نعوض|تعويض|رضا حضرتك)/i;
const FOLLOWUP_RX = /(حابين نطمن|حبيت اطمن|حبيت أطمن|متابعه|متابعة|بنطمن|نطمن|هتابع|هتواصل|اول ما|أول ما)/i;
const DELETED_MESSAGE_RX = /(you deleted this message|this message was deleted|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة)/i;

function firstMessage(session: WhatsAppConversationSession, rx: RegExp, direction?: 'inbound'|'outbound') {
  return session.messages.find((m) => (!direction || m.direction === direction) && rx.test(String(m.text || ''))) || null;
}

function secondsBetween(a?: Date | string | null, b?: Date | string | null) {
  if (!a || !b) return null;
  const av = a instanceof Date ? a.getTime() : new Date(a).getTime();
  const bv = b instanceof Date ? b.getTime() : new Date(b).getTime();
  if (!Number.isFinite(av) || !Number.isFinite(bv) || bv < av) return null;
  return Math.round((bv - av) / 1000);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function episodeStage(rows: WhatsAppParsedMessage[]): TimingStageV28 {
  const inbound = rows.filter((m) => m.direction === 'inbound').map((m) => m.text).join(' ');
  const outbound = rows.filter((m) => m.direction === 'outbound').map((m) => m.text).join(' ');
  const all = rows.map((m) => m.text).join(' ');
  if (PROBLEM_RX.test(all)) return 'delay_or_problem';
  if (RECOVERY_RX.test(outbound)) return 'service_recovery';
  if (CONFIRM_RX.test(all)) return 'order_confirmation';
  if (ORDER_RX.test(inbound)) return 'order_request';
  if (FOLLOWUP_RX.test(outbound)) return 'followup';
  if (rows[0]?.direction === 'outbound') return 'opening';
  return 'general';
}

function stageLabel(stage: TimingStageV28) {
  if (stage === 'order_request') return 'طلب العميل';
  if (stage === 'order_confirmation') return 'تأكيد/تنفيذ الأوردر';
  if (stage === 'delay_or_problem') return 'تأخير أو مشكلة في الأوردر';
  if (stage === 'service_recovery') return 'اعتذار واستعادة الخدمة';
  if (stage === 'followup') return 'متابعة العميل';
  if (stage === 'opening') return 'بداية التواصل';
  return 'استكمال المحادثة';
}

function buildEpisodes(session: WhatsAppConversationSession): ConversationEpisodeV28[] {
  const rows = session.messages.filter((m) => m.direction !== 'system').slice().sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  const groups: WhatsAppParsedMessage[][] = [];
  let current: WhatsAppParsedMessage[] = [];
  for (const row of rows) {
    if (!current.length) {
      current = [row];
      continue;
    }
    const previous = current[current.length - 1];
    const gapMinutes = (row.timestamp.getTime() - previous.timestamp.getTime()) / 60000;
    const dateChanged = row.timestamp.toDateString() !== previous.timestamp.toDateString();
    // 20 دقيقة هنا للعرض فقط، وليس لفصل التحليل. Case Context يظل موحدًا.
    if (dateChanged || gapMinutes >= 20) {
      groups.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }
  if (current.length) groups.push(current);

  return groups.map((messages, index) => {
    const first = messages[0];
    const last = messages[messages.length - 1];
    const previous = index > 0 ? groups[index - 1][groups[index - 1].length - 1] : null;
    const gap = previous ? Math.round((first.timestamp.getTime() - previous.timestamp.getTime()) / 60000) : null;
    const stage = episodeStage(messages);
    return {
      id: `episode-${index + 1}-${first.id}`,
      label: stageLabel(stage),
      stage,
      startedAt: first.timestamp.toISOString(),
      endedAt: last.timestamp.toISOString(),
      gapFromPreviousMinutes: gap,
      messageIds: messages.map((m) => m.id),
    };
  });
}

export function buildConversationTimingV28(
  session: WhatsAppConversationSession,
  participantRoles?: WhatsAppParticipantRoleModelV15 | null,
  invoiceVerification?: UnifiedInvoiceVerification | null,
): ConversationTimingV28 {
  const turns = buildWhatsAppResponseTurnsV18(session, participantRoles);
  const latencies = turns.map((t) => t.responseLatencySeconds).filter((x): x is number => typeof x === 'number');
  const answered = turns.filter((t) => !t.noResponse);
  const firstTurn = answered[0] || null;

  const request = firstMessage(session, ORDER_RX, 'inbound');
  const firstResponseAfterRequest = request
    ? session.messages.find(
        (m) =>
          m.direction === 'outbound' &&
          m.timestamp.getTime() >= request.timestamp.getTime() &&
          !DELETED_MESSAGE_RX.test(String(m.text || ''))
      )
    : null;
  const confirmed = firstMessage(session, CONFIRM_RX);
  const problem = firstMessage(session, PROBLEM_RX);
  const recovery = problem
    ? session.messages.find((m) => m.direction === 'outbound' && m.timestamp.getTime() >= problem.timestamp.getTime() && RECOVERY_RX.test(String(m.text || '')))
    : firstMessage(session, RECOVERY_RX, 'outbound');

  const responderNames = turns.map((t) => String(t.responderStaffName || t.responderSender || '')).filter(Boolean);
  let handoffCount = 0;
  let previousName = '';
  for (const name of responderNames) {
    if (previousName && name !== previousName) handoffCount += 1;
    previousName = name;
  }

  const episodes = buildEpisodes(session);
  const started = session.startedAt;
  const ended = session.endedAt;
  return {
    version: 'whatsapp-conversation-timing-v28',
    caseStartedAt: started.toISOString(),
    caseEndedAt: ended.toISOString(),
    totalCaseMinutes: Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60000)),
    episodes,
    responseTurns: turns.map((t) => ({
      turnKey: t.turnKey,
      inboundStartedAt: t.inboundStartedAt,
      inboundEndedAt: t.inboundEndedAt,
      responseAt: t.responseAt,
      responseLatencySeconds: t.responseLatencySeconds,
      noResponse: t.noResponse,
      responderStaffName: t.responderStaffName,
      responderRole: t.responderRole,
      inboundMessageIds: t.inboundMessageIds,
      responseMessageId: t.responseMessageId,
    })),
    responseSummary: {
      customerTurns: turns.length,
      answeredTurns: answered.length,
      unansweredTurns: turns.filter((t) => t.noResponse).length,
      firstResponseSeconds: firstTurn?.responseLatencySeconds ?? null,
      medianResponseSeconds: median(latencies),
      maxResponseSeconds: latencies.length ? Math.max(...latencies) : null,
      within5mRate: latencies.length ? Math.round(100 * latencies.filter((x) => x <= 300).length / latencies.length) : null,
      within10mRate: latencies.length ? Math.round(100 * latencies.filter((x) => x <= 600).length / latencies.length) : null,
    },
    orderTimeline: {
      requestAt: request?.timestamp.toISOString() || null,
      firstResponseAt: firstResponseAfterRequest?.timestamp.toISOString() || null,
      confirmedAt: confirmed?.timestamp.toISOString() || null,
      delayOrProblemAt: problem?.timestamp.toISOString() || null,
      recoveryAt: recovery?.timestamp.toISOString() || null,
      invoiceAt: invoiceVerification?.bestCandidate?.invoiceDate || null,
      requestToFirstResponseSeconds: secondsBetween(request?.timestamp, firstResponseAfterRequest?.timestamp),
      requestToConfirmationSeconds: secondsBetween(request?.timestamp, confirmed?.timestamp),
      confirmationToProblemSeconds: secondsBetween(confirmed?.timestamp, problem?.timestamp),
      problemToRecoverySeconds: secondsBetween(problem?.timestamp, recovery?.timestamp),
    },
    handoff: {
      responderNames: [...new Set(responderNames)],
      responderCount: [...new Set(responderNames)].length,
      handoffCount,
    },
  };
}
