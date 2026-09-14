import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export interface ConversationSignalSummary {
  firstInboundAt: Date | null;
  firstOutboundAt: Date | null;
  firstResponseSeconds: number | null;
  longestCustomerWaitSeconds: number | null;
  unansweredInboundCount: number;
  outboundStaffNames: string[];
  greetingDetected: boolean;
  closingDetected: boolean;
  saleIntentDetected: boolean;
  deliveryIntentDetected: boolean;
  followupPromiseDetected: boolean;
  complaintOrEscalationDetected: boolean;
  apologyDetected: boolean;
  repeatedCustomerNudgeDetected: boolean;
  mediaCount: number;
  missingEvidence: string[];
  deterministicConfidence: number;
}

const includesAny = (value: string, patterns: RegExp[]) => patterns.some((p) => p.test(value));

const GREETING = [/أهل[ًاا] وسهل/i, /نورتنا/i, /السلام عليكم/i, /مع حضرتك/i];
const CLOSING = [/تتشرف بخدمة حضرتك/i, /تحت امر حضرتك/i, /في اي وقت/i, /تم الارسال/i, /جاري الارسال/i];
const SALE = [/عاوز/i, /محتاج/i, /ابعت/i, /الأوردر/i, /الاوردر/i, /شريط/i, /علبة/i, /قطرة/i, /سرنج/i];
const DELIVERY = [/مندوب/i, /توصيل/i, /عنوان/i, /خرج لحضرتك/i, /الارسال/i];
const FOLLOWUP_PROMISE = [/هكلمه/i, /هرجع/i, /هتابع/i, /هطلب/i, /هجيب مندوب/i, /حالا/i];
const COMPLAINT = [/تأخير/i, /التاخير/i, /متأخر/i, /مشكلة/i, /شكوى/i, /تستعجل/i, /استعجل/i, /لسه/i];
const APOLOGY = [/متاسف/i, /آسف/i, /بنعتذر/i, /نعتذر/i];
const NUDGE = [/تمام\??/i, /بعد اذنك/i, /لو سمحت/i, /تستعجل/i, /^\.\.$/i];

function secondsBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

function textOf(messages: WhatsAppParsedMessage[], direction?: 'inbound' | 'outbound') {
  return messages
    .filter((m) => !direction || m.direction === direction)
    .map((m) => m.text)
    .join('\n');
}

export function extractConversationSignals(session: WhatsAppConversationSession): ConversationSignalSummary {
  const inbound = session.messages.filter((m) => m.direction === 'inbound');
  const outbound = session.messages.filter((m) => m.direction === 'outbound');
  const firstInbound = inbound[0] || null;
  const firstOutboundAfterInbound = firstInbound
    ? outbound.find((m) => m.timestamp >= firstInbound.timestamp) || null
    : outbound[0] || null;

  let longestWait: number | null = null;
  let unansweredInboundCount = 0;
  for (let i = 0; i < session.messages.length; i += 1) {
    const message = session.messages[i];
    if (message.direction !== 'inbound') continue;
    const nextOutbound = session.messages.slice(i + 1).find((m) => m.direction === 'outbound');
    if (!nextOutbound) {
      unansweredInboundCount += 1;
      continue;
    }
    const wait = secondsBetween(message.timestamp, nextOutbound.timestamp);
    longestWait = longestWait == null ? wait : Math.max(longestWait, wait);
  }

  const allText = textOf(session.messages);
  const inboundText = textOf(session.messages, 'inbound');
  const outboundText = textOf(session.messages, 'outbound');
  const media = session.messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind));
  const missingEvidence = Array.from(new Set(media.map((m) => m.kind)));

  const nudges = inbound.filter((m) => includesAny(m.text, NUDGE));
  const meaningfulInboundCount = inbound.filter((m) => m.kind === 'text' && m.text.trim().length > 1).length;
  const evidenceCoverage = session.messages.length
    ? Math.max(0, 1 - media.length / session.messages.length)
    : 0;
  const deterministicConfidence = Math.round(
    Math.min(100, (0.65 + 0.25 * evidenceCoverage + (meaningfulInboundCount > 0 ? 0.1 : 0)) * 100)
  );

  return {
    firstInboundAt: firstInbound?.timestamp || null,
    firstOutboundAt: firstOutboundAfterInbound?.timestamp || null,
    firstResponseSeconds:
      firstInbound && firstOutboundAfterInbound
        ? secondsBetween(firstInbound.timestamp, firstOutboundAfterInbound.timestamp)
        : null,
    longestCustomerWaitSeconds: longestWait,
    unansweredInboundCount,
    outboundStaffNames: session.outboundStaffNames,
    greetingDetected: includesAny(outboundText, GREETING),
    closingDetected: includesAny(outboundText, CLOSING),
    saleIntentDetected: includesAny(allText, SALE),
    deliveryIntentDetected: includesAny(allText, DELIVERY),
    followupPromiseDetected: includesAny(outboundText, FOLLOWUP_PROMISE),
    complaintOrEscalationDetected: includesAny(inboundText + '\n' + outboundText, COMPLAINT),
    apologyDetected: includesAny(outboundText, APOLOGY),
    repeatedCustomerNudgeDetected: nudges.length >= 2,
    mediaCount: media.length,
    missingEvidence,
    deterministicConfidence,
  };
}
