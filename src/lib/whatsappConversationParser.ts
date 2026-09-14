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

const MESSAGE_RE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)\]\s*([^:]+):\s?(.*)$/i;
const STAFF_INTRO_PATTERNS = [
  /مع حضرتك\s+(?:د\.?|دكتور(?:ة)?)\s*([^\n،,.]+)/i,
  /معاك(?:ي)?\s+(?:د\.?|دكتور(?:ة)?)\s*([^\n،,.]+)/i,
];

function normalizeYear(raw: number) {
  return raw < 100 ? 2000 + raw : raw;
}

function parseTimestamp(match: RegExpMatchArray) {
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = normalizeYear(Number(match[3]));
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const meridiem = match[7].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === 'PM') hour += 12;
  return new Date(year, month - 1, day, hour, minute, second);
}

function detectKind(text: string): WhatsAppMessageKind {
  const value = text.toLowerCase();
  if (/messages and calls are end-to-end encrypted/i.test(text)) return 'system';
  if (/<voice message omitted>/i.test(text)) return 'voice';
  if (/<image omitted>/i.test(text)) return 'image';
  if (/<video omitted>/i.test(text)) return 'video';
  if (/<document omitted>/i.test(text)) return 'document';
  if (/you deleted this message|this message was deleted/i.test(value)) return 'deleted';
  if (/omitted>/i.test(value)) return 'unknown';
  return 'text';
}

function messageId(index: number, timestamp: Date, sender: string) {
  return `${timestamp.getTime()}-${index}-${sender}`;
}

export function parseWhatsAppExport(text: string): WhatsAppParsedMessage[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const messages: WhatsAppParsedMessage[] = [];
  let current: WhatsAppParsedMessage | null = null;

  for (const line of lines) {
    const match = line.match(MESSAGE_RE);
    if (match) {
      if (current) messages.push(current);
      const timestamp = parseTimestamp(match);
      const sender = match[8].trim();
      const body = match[9] || '';
      const direction = sender.toLowerCase() === 'you' ? 'outbound' : 'inbound';
      current = {
        id: messageId(messages.length, timestamp, sender),
        timestamp,
        rawTimestamp: match[0].slice(1, match[0].indexOf(']')),
        sender,
        text: body,
        direction,
        kind: detectKind(body),
        forwarded: /^\[forwarded\]/i.test(body.trim()),
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
  return messages.filter((message) => message.kind !== 'system');
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
