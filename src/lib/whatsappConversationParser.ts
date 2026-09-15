export type WhatsAppMessageKind = 'text' | 'image' | 'voice' | 'video' | 'document' | 'deleted' | 'system' | 'unknown';

export interface WhatsAppParsedMessage {
  id: string;
  timestamp: Date;
  rawTimestamp: string;
  sender: string;
  text: string;
  direction: 'inbound' | 'outbound' | 'system';
  kind: WhatsAppMessageKind;
  forwarded: boolean;
  raw: string;
}

export interface WhatsAppConversationSession {
  id: string;
  startedAt: Date;
  endedAt: Date;
  messages: WhatsAppParsedMessage[];
  participants: string[];
  outboundStaffNames: string[];
  customerName: string | null;
  mediaCount: number;
}

type ParsedPrefix = {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  meridiem: string;
  rest: string;
  rawTimestamp: string;
};

const STAFF_INTRO_PATTERNS = [
  /مع حضرتك\s+(?:د\.?|دكتور(?:ة)?|دكتوره)\s*([^\n،,.]+)/i,
  /معاك(?:ي)?\s+(?:د\.?|دكتور(?:ة)?|دكتوره)\s*([^\n،,.]+)/i,
  /(?:د\.?|دكتور(?:ة)?|دكتوره)\s+([^\n،,.]+)\s+من\s+(?:خدمة عملاء|صيدليات)\s+دواء/i,
];
const PHARMACY_TEXT_RX = /(صيدليات دواء|مع حضرتك|تحت امر حضرتك|تحت أمر حضرتك|تم تأكيد الطلب|جاري الارسال|جاري الإرسال)/i;
const SYSTEM_RX = /(messages and calls are end-to-end encrypted|created group|added you|changed the subject|security code changed)/i;

function normalizeYear(raw: number) {
  return raw < 100 ? 2000 + raw : raw;
}

function normalizeMeridiem(raw: string) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'pm' || value === 'م') return 'pm';
  if (value === 'am' || value === 'ص') return 'am';
  return '';
}

function resolveDayMonth(a: number, b: number, year: number) {
  if (a > 12 && b <= 12) return { day: a, month: b };
  if (b > 12 && a <= 12) return { day: b, month: a };
  // WhatsApp exports from the Windows/English UI commonly use M/D/Y.
  // Arabic/Egyptian exports commonly use D/M/Y. Prefer D/M for four-digit years
  // with day-looking first values, otherwise M/D to preserve the existing parser behavior.
  if (String(year).length === 4 && a >= 13) return { day: a, month: b };
  return { day: b, month: a };
}

function parsePrefix(line: string): ParsedPrefix | null {
  const normalized = line.replace(/^\u200e/, '');
  const patterns = [
    /^\[?(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm]|[صم])?\]?\s*[-–]?\s*(.*)$/,
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm]|[صم])?\s*[-–]\s*(.*)$/,
  ];
  for (const rx of patterns) {
    const match = normalized.match(rx);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const rawYear = Number(match[3]);
    const year = normalizeYear(rawYear);
    const { day, month } = resolveDayMonth(first, second, rawYear);
    return {
      day,
      month,
      year,
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0),
      meridiem: normalizeMeridiem(match[7] || ''),
      rest: match[8] || '',
      rawTimestamp: `${match[1]}/${match[2]}/${match[3]}, ${match[4]}:${match[5]}${match[6] ? `:${match[6]}` : ''}${match[7] ? ` ${match[7]}` : ''}`,
    };
  }
  return null;
}

function timestampFromPrefix(prefix: ParsedPrefix) {
  let hour = prefix.hour;
  if (prefix.meridiem === 'pm' && hour < 12) hour += 12;
  if (prefix.meridiem === 'am' && hour === 12) hour = 0;
  const date = new Date(prefix.year, prefix.month - 1, prefix.day, hour, prefix.minute, prefix.second);
  return Number.isNaN(date.getTime()) ? null : date;
}

function detectKind(text: string): WhatsAppMessageKind {
  const value = text.toLowerCase();
  if (SYSTEM_RX.test(text)) return 'system';
  if (/<voice message omitted>|audio omitted|صوت محذوف/i.test(text)) return 'voice';
  if (/<image omitted>|image omitted|صورة محذوفة/i.test(text)) return 'image';
  if (/<video omitted>|video omitted|فيديو محذوف/i.test(text)) return 'video';
  if (/<document omitted>|document omitted|مستند محذوف/i.test(text)) return 'document';
  if (/you deleted this message|this message was deleted|تم حذف هذه الرسالة/i.test(value)) return 'deleted';
  if (/omitted>|محذوف/i.test(value)) return 'unknown';
  return 'text';
}

function messageId(index: number, timestamp: Date, sender: string) {
  return `${timestamp.getTime()}-${index}-${sender}`;
}

function isExplicitOutboundSender(sender: string) {
  const value = sender.trim().toLowerCase();
  return value === 'you' || value === 'me' || value === 'أنت' || value === 'انت' || value === 'أنا' || value === 'انا';
}

function inferPharmacySender(messages: WhatsAppParsedMessage[]) {
  const nonSystem = messages.filter((m) => m.direction !== 'system');
  const senders = Array.from(new Set(nonSystem.map((m) => m.sender)));
  let best: { sender: string; score: number } | null = null;
  for (const sender of senders) {
    const owned = nonSystem.filter((m) => m.sender === sender);
    let score = 0;
    for (const message of owned) {
      if (STAFF_INTRO_PATTERNS.some((rx) => rx.test(message.text))) score += 8;
      if (PHARMACY_TEXT_RX.test(message.text)) score += 2;
    }
    if (!best || score > best.score) best = { sender, score };
  }
  return best && best.score >= 4 ? best.sender : null;
}

export function parseWhatsAppExport(text: string): WhatsAppParsedMessage[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const messages: WhatsAppParsedMessage[] = [];
  let current: WhatsAppParsedMessage | null = null;

  for (const line of lines) {
    const prefix = parsePrefix(line);
    if (prefix) {
      if (current) messages.push(current);
      const timestamp = timestampFromPrefix(prefix);
      if (!timestamp) {
        current = null;
        continue;
      }
      const speakerMatch = prefix.rest.match(/^([^:]{1,100}):\s?([\s\S]*)$/);
      if (!speakerMatch) {
        current = {
          id: messageId(messages.length, timestamp, 'system'),
          timestamp,
          rawTimestamp: prefix.rawTimestamp,
          sender: 'system',
          text: prefix.rest.trim(),
          direction: 'system',
          kind: 'system',
          forwarded: false,
          raw: line,
        };
        continue;
      }
      const sender = speakerMatch[1].trim();
      const body = speakerMatch[2] || '';
      current = {
        id: messageId(messages.length, timestamp, sender),
        timestamp,
        rawTimestamp: prefix.rawTimestamp,
        sender,
        text: body,
        direction: isExplicitOutboundSender(sender) ? 'outbound' : 'inbound',
        kind: detectKind(body),
        forwarded: /^\[?forwarded\]?|تمت إعادة توجيه/i.test(body.trim()),
        raw: line,
      };
      continue;
    }

    if (current) {
      current.text += `\n${line}`;
      current.raw += `\n${line}`;
      current.kind = detectKind(current.text);
    }
  }

  if (current) messages.push(current);
  const humans = messages.filter((message) => message.kind !== 'system' && message.direction !== 'system');
  if (!humans.some((m) => m.direction === 'outbound')) {
    const pharmacySender = inferPharmacySender(humans);
    if (pharmacySender) humans.forEach((m) => { m.direction = m.sender === pharmacySender ? 'outbound' : 'inbound'; });
  }
  return humans;
}

export function extractIntroducedStaffName(message: WhatsAppParsedMessage): string | null {
  if (message.direction !== 'outbound') return null;
  for (const pattern of STAFF_INTRO_PATTERNS) {
    const match = message.text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

export function splitWhatsAppSessions(
  messages: WhatsAppParsedMessage[],
  inactivityMinutes = 120
): WhatsAppConversationSession[] {
  if (!messages.length) return [];
  const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const sessions: WhatsAppConversationSession[] = [];
  let bucket: WhatsAppParsedMessage[] = [];

  const flush = () => {
    if (!bucket.length) return;
    const participants = Array.from(new Set(bucket.map((m) => m.sender)));
    const introduced = Array.from(
      new Set(bucket.map(extractIntroducedStaffName).filter((v): v is string => Boolean(v)))
    );
    const inbound = bucket.find((m) => m.direction === 'inbound');
    const startedAt = bucket[0].timestamp;
    const endedAt = bucket[bucket.length - 1].timestamp;
    sessions.push({
      id: `session-${startedAt.getTime()}-${sessions.length}`,
      startedAt,
      endedAt,
      messages: bucket,
      participants,
      outboundStaffNames: introduced,
      customerName: inbound?.sender || null,
      mediaCount: bucket.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).length,
    });
    bucket = [];
  };

  for (const message of sorted) {
    if (bucket.length) {
      const previous = bucket[bucket.length - 1];
      const gapMinutes = (message.timestamp.getTime() - previous.timestamp.getTime()) / 60000;
      if (gapMinutes >= inactivityMinutes) flush();
    }
    bucket.push(message);
  }
  flush();
  return sessions;
}
