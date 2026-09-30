import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export interface ResponseWaitEvidence {
  inboundMessageId: string;
  outboundMessageId: string | null;
  seconds: number | null;
  inboundText: string;
  outboundText: string | null;
}

export interface ConversationSignalSummary {
  firstInboundAt: Date | null;
  firstOutboundAt: Date | null;
  firstResponseSeconds: number | null;
  medianResponseSeconds: number | null;
  longestCustomerWaitSeconds: number | null;
  waitsOver5Minutes: number;
  waitsOver10Minutes: number;
  unansweredInboundCount: number;
  responseWaits: ResponseWaitEvidence[];
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
const COMPLAINT = [
  /تأخير/i,
  /التاخير/i,
  /متأخر/i,
  /مشكلة/i,
  /شكوى/i,
  /تستعجل/i,
  /استعجل/i,
  /لسه\s+(?:مجاش|ماوصلش|موصلش|محدش\s+رد|محدش\s+كلمني)/i,
  /ماوصلش|موصلش|محدش\s+رد|غلط|وحش|سيء/i,
];
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

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function extractConversationSignals(session: WhatsAppConversationSession): ConversationSignalSummary {
  const inbound = session.messages.filter((m) => m.direction === 'inbound');
  const outbound = session.messages.filter((m) => m.direction === 'outbound');
  const firstInbound = inbound[0] || null;
  const firstOutboundAfterInbound = firstInbound
    ? outbound.find((m) => m.timestamp >= firstInbound.timestamp) || null
    : outbound[0] || null;

  const responseWaits: ResponseWaitEvidence[] = [];
  let unansweredInboundCount = 0;

  // Measure one operational wait per inbound burst, not one wait per individual customer message.
  // Example: a customer sends 4 short messages before the pharmacist replies once — that is one
  // response cycle, not four independent delays and not four unanswered messages.
  let i = 0;
  while (i < session.messages.length) {
    const message = session.messages[i];
    if (message.direction !== 'inbound') {
      i += 1;
      continue;
    }

    const burst: WhatsAppParsedMessage[] = [message];
    let j = i + 1;
    while (j < session.messages.length && session.messages[j].direction === 'inbound') {
      burst.push(session.messages[j]);
      j += 1;
    }

    const nextOutbound = session.messages.slice(j).find((m) => m.direction === 'outbound') || null;
    const firstInboundInBurst = burst[0];
    if (!nextOutbound) {
      unansweredInboundCount += 1;
      responseWaits.push({
        inboundMessageId: firstInboundInBurst.id,
        outboundMessageId: null,
        seconds: null,
        inboundText: burst.map((m) => m.text).join('\n'),
        outboundText: null,
      });
    } else {
      responseWaits.push({
        inboundMessageId: firstInboundInBurst.id,
        outboundMessageId: nextOutbound.id,
        seconds: secondsBetween(firstInboundInBurst.timestamp, nextOutbound.timestamp),
        inboundText: burst.map((m) => m.text).join('\n'),
        outboundText: nextOutbound.text,
      });
    }

    i = j;
  }

  const measuredWaits = responseWaits
    .map((item) => item.seconds)
    .filter((value): value is number => value != null);
  const longestWait = measuredWaits.length ? Math.max(...measuredWaits) : null;

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
    medianResponseSeconds: median(measuredWaits),
    longestCustomerWaitSeconds: longestWait,
    waitsOver5Minutes: measuredWaits.filter((value) => value > 300).length,
    waitsOver10Minutes: measuredWaits.filter((value) => value > 600).length,
    unansweredInboundCount,
    responseWaits,
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
