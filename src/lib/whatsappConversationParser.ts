export type WhatsAppMessageKind =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'document'
  | 'deleted'
  | 'system'
  | 'unknown';
export type WhatsAppExportSourceFormat = 'txt' | 'md';

export interface WhatsAppParseOptions {
  /**
   * Optional TRUSTED conversation timestamp from persistence metadata. Only its calendar DATE is
   * used, and only for markdown exports whose message lines contain time-of-day but omit the usual
   * "## Month Day, Year" heading. Never pass import/created_at time here unless it is itself the
   * persisted conversation_started_at for this exact source.
   */
  trustedConversationStartedAt?: string | Date | null;
}

export interface WhatsAppReplyContext {
  sender: string | null;
  text: string;
}

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
  sourceFormat?: WhatsAppExportSourceFormat;
  replyTo?: WhatsAppReplyContext | null;
  mediaPlaceholder?: boolean;
  mediaAvailable?: boolean;
  mediaArchiveName?: string | null;
  mediaFileName?: string | null;
  mediaMimeType?: string | null;
  mediaMatchConfidence?: number | null;
  mediaObjectUrl?: string | null;
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
  mediaKinds?: Record<WhatsAppMessageKind, number>;
  missingMediaCount?: number;
  replyCount?: number;
  forwardedCount?: number;
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
const PHARMACY_TEXT_RX =
  /(صيدليات دواء|مع حضرتك|تحت امر حضرتك|تحت أمر حضرتك|تم تأكيد الطلب|جاري الارسال|جاري الإرسال)/i;
const SYSTEM_RX =
  /(messages and calls are end-to-end encrypted|created group|added you|changed the subject|security code changed)/i;
const MEDIA_KIND_SET = new Set<WhatsAppMessageKind>(['image', 'voice', 'video', 'document']);

function normalizeYear(raw: number) {
  return raw < 100 ? 2000 + raw : raw;
}

function normalizeMeridiem(raw: string) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'pm' || value === 'م') return 'pm';
  if (value === 'am' || value === 'ص') return 'am';
  return '';
}

function resolveDayMonth(a: number, b: number, year: number) {
  if (a > 12 && b <= 12) return { day: a, month: b };
  if (b > 12 && a <= 12) return { day: b, month: a };
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
  const date = new Date(
    prefix.year,
    prefix.month - 1,
    prefix.day,
    hour,
    prefix.minute,
    prefix.second
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function detectKind(text: string): WhatsAppMessageKind {
  const value = text.toLowerCase();
  if (SYSTEM_RX.test(text)) return 'system';
  if (
    /<voice message omitted>|audio omitted|صوت محذوف|\[voice message\]|\.(?:opus|ogg|mp3|m4a|wav)(?:\s|$|\))/i.test(
      text
    )
  )
    return 'voice';
  if (
    /<image omitted>|image omitted|صورة محذوفة|\[image\]|\.(?:jpe?g|png|webp|gif|heic)(?:\s|$|\))/i.test(
      text
    )
  )
    return 'image';
  if (/<video omitted>|video omitted|فيديو محذوف|\[video\]|\.(?:mp4|mov)(?:\s|$|\))/i.test(text))
    return 'video';
  if (
    /<document omitted>|document omitted|مستند محذوف|\[document\]|\[file\]|\.(?:pdf|docx?|xlsx?)(?:\s|$|\))/i.test(
      text
    )
  )
    return 'document';
  if (/you deleted this message|this message was deleted|تم حذف هذه الرسالة/i.test(value))
    return 'deleted';
  if (/omitted>|محذوف/i.test(value)) return 'unknown';
  return 'text';
}

function hasMediaPlaceholder(text: string, kind: WhatsAppMessageKind) {
  return (
    MEDIA_KIND_SET.has(kind) &&
    /(omitted>|\[(?:voice message|image|video|document|file)\]|<attached:|\.(?:jpe?g|png|webp|gif|heic|opus|ogg|mp3|m4a|wav|mp4|mov|pdf|docx?|xlsx?))/i.test(
      text
    )
  );
}

function messageId(index: number, timestamp: Date, sender: string) {
  return `${timestamp.getTime()}-${index}-${sender}`;
}

function isExplicitOutboundSender(sender: string) {
  const value = sender.trim().toLowerCase();
  return (
    value === 'you' ||
    value === 'me' ||
    value === 'أنت' ||
    value === 'انت' ||
    value === 'أنا' ||
    value === 'انا'
  );
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

function finalizeDirections(messages: WhatsAppParsedMessage[]) {
  const humans = messages.filter(
    (message) => message.kind !== 'system' && message.direction !== 'system'
  );
  if (!humans.some((m) => m.direction === 'outbound')) {
    const pharmacySender = inferPharmacySender(humans);
    if (pharmacySender)
      humans.forEach((m) => {
        m.direction = m.sender === pharmacySender ? 'outbound' : 'inbound';
      });
  }
  return humans;
}

function parseTextExport(text: string): WhatsAppParsedMessage[] {
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
          sourceFormat: 'txt',
          replyTo: null,
          mediaPlaceholder: false,
          mediaAvailable: false,
        };
        continue;
      }
      const sender = speakerMatch[1].trim();
      const body = speakerMatch[2] || '';
      const kind = detectKind(body);
      current = {
        id: messageId(messages.length, timestamp, sender),
        timestamp,
        rawTimestamp: prefix.rawTimestamp,
        sender,
        text: body,
        direction: isExplicitOutboundSender(sender) ? 'outbound' : 'inbound',
        kind,
        forwarded: /^\[?forwarded\]?|تمت إعادة توجيه/i.test(body.trim()),
        raw: line,
        sourceFormat: 'txt',
        replyTo: null,
        mediaPlaceholder: hasMediaPlaceholder(body, kind),
        mediaAvailable: false,
      };
      continue;
    }
    if (current) {
      current.text += `${current.text ? '\n' : ''}${line}`;
      current.raw += `\n${line}`;
      current.kind = detectKind(current.text);
      current.mediaPlaceholder = hasMediaPlaceholder(current.text, current.kind);
    }
  }
  if (current) messages.push(current);
  finalizeDirections(messages);
  return messages;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseMarkdownDateHeading(line: string) {
  const match = line.trim().match(/^##\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return { year: Number(match[3]), month, day: Number(match[2]) };
}

function parseMarkdownClockSeconds(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4].toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return hour * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function parseMarkdownTime(raw: string, date: { year: number; month: number; day: number }) {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4].toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  const timestamp = new Date(
    date.year,
    date.month - 1,
    date.day,
    hour,
    Number(match[2]),
    Number(match[3] || 0)
  );
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function parseMarkdownReply(lines: string[]) {
  const quoteLines = lines.filter((line) => /^>\s?/.test(line.trim()));
  if (!quoteLines.length) return null;
  const combined = quoteLines
    .map((line) => line.trim().replace(/^>\s?/, ''))
    .join('\n')
    .trim();
  const italic = combined.match(/^_([^:]{1,100}):\s*([\s\S]*?)_$/);
  if (italic)
    return { sender: italic[1].trim(), text: italic[2].trim() } satisfies WhatsAppReplyContext;
  const plain = combined.match(/^([^:]{1,100}):\s*([\s\S]*)$/);
  if (plain)
    return {
      sender: plain[1].trim(),
      text: plain[2].trim().replace(/^_|_$/g, ''),
    } satisfies WhatsAppReplyContext;
  return { sender: null, text: combined.replace(/^_|_$/g, '') } satisfies WhatsAppReplyContext;
}

function trustedDateParts(value: string | Date | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Persistence timestamps are timestamptz. Use UTC calendar parts so server/browser local timezone
  // never silently changes the trusted source date.
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function parseMarkdownExport(text: string, trustedConversationStartedAt?: string | Date | null): WhatsAppParsedMessage[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const messages: WhatsAppParsedMessage[] = [];
  let currentDate: { year: number; month: number; day: number } | null = trustedDateParts(trustedConversationStartedAt);
  const trustedAnchor = trustedConversationStartedAt
    ? (trustedConversationStartedAt instanceof Date ? trustedConversationStartedAt : new Date(trustedConversationStartedAt))
    : null;
  let usingTrustedTimeOnlyTimeline = Boolean(trustedAnchor && !Number.isNaN(trustedAnchor.getTime()));
  let firstClockSeconds: number | null = null;
  let previousAbsoluteClockSeconds: number | null = null;
  let current: {
    timestamp: Date;
    rawTimestamp: string;
    sender: string;
    initialBody: string;
    bodyLines: string[];
    rawLines: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    const allBody = [current.initialBody, ...current.bodyLines].join('\n').trim();
    const replyTo = parseMarkdownReply(current.bodyLines);
    const bodyLines = current.bodyLines.filter((line) => !/^>\s?/.test(line.trim()));
    const body = [current.initialBody, ...bodyLines].join('\n').trim();
    const kind = detectKind(body || allBody);
    const sender = current.sender.trim();
    messages.push({
      id: messageId(messages.length, current.timestamp, sender),
      timestamp: current.timestamp,
      rawTimestamp: current.rawTimestamp,
      sender,
      text: body,
      direction: isExplicitOutboundSender(sender) ? 'outbound' : 'inbound',
      kind,
      forwarded: /^\[forwarded\]/i.test(body),
      raw: current.rawLines.join('\n'),
      sourceFormat: 'md',
      replyTo,
      mediaPlaceholder: hasMediaPlaceholder(body || allBody, kind),
      mediaAvailable: false,
    });
    current = null;
  };

  for (const line of lines) {
    const dateHeading = parseMarkdownDateHeading(line);
    if (dateHeading) {
      flush();
      currentDate = dateHeading;
      usingTrustedTimeOnlyTimeline = false;
      firstClockSeconds = null;
      previousAbsoluteClockSeconds = null;
      continue;
    }
    if (!currentDate) continue;

    const header = line.match(
      /^\[(\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm])\]\s+\*\*([^*]{1,100}):\*\*\s?(.*)$/
    );
    if (header) {
      flush();
      let timestamp: Date | null = null;
      if (usingTrustedTimeOnlyTimeline && trustedAnchor) {
        const clockSeconds = parseMarkdownClockSeconds(header[1]);
        if (clockSeconds != null) {
          if (firstClockSeconds == null) {
            firstClockSeconds = clockSeconds;
            previousAbsoluteClockSeconds = clockSeconds;
            // The persisted conversation_started_at is the trusted absolute timestamp of the first
            // source message. This avoids a hidden server-timezone dependency (Vercel runs UTC,
            // while these WhatsApp clocks are Egypt-local).
            timestamp = new Date(trustedAnchor.getTime());
          } else {
            let absoluteClockSeconds = clockSeconds;
            while (previousAbsoluteClockSeconds != null && absoluteClockSeconds < previousAbsoluteClockSeconds) {
              absoluteClockSeconds += 24 * 3600;
            }
            previousAbsoluteClockSeconds = absoluteClockSeconds;
            timestamp = new Date(trustedAnchor.getTime() + (absoluteClockSeconds - firstClockSeconds) * 1000);
          }
        }
      } else {
        timestamp = parseMarkdownTime(header[1], currentDate);
      }
      if (!timestamp) continue;
      current = {
        timestamp,
        rawTimestamp: `${currentDate.year}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')} ${header[1]}`,
        sender: header[2],
        initialBody: header[3] || '',
        bodyLines: [],
        rawLines: [line],
      };
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
      current.rawLines.push(line);
    }
  }
  flush();
  finalizeDirections(messages);
  return messages;
}

export function detectWhatsAppExportFormat(text: string): WhatsAppExportSourceFormat {
  const head = text.slice(0, 5000);
  if (
    /^# WhatsApp Chat Export:/m.test(head) ||
    /^##\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}$/m.test(head) ||
    /^\[\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm]\]\s+\*\*[^*]{1,100}:\*\*/m.test(head)
  ) return 'md';
  return 'txt';
}

export function parseWhatsAppExport(text: string, options: WhatsAppParseOptions = {}): WhatsAppParsedMessage[] {
  return detectWhatsAppExportFormat(text) === 'md'
    ? parseMarkdownExport(text, options.trustedConversationStartedAt)
    : parseTextExport(text);
}

export function extractIntroducedStaffName(message: WhatsAppParsedMessage): string | null {
  if (message.direction !== 'outbound') return null;
  for (const pattern of STAFF_INTRO_PATTERNS) {
    const match = message.text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

function extractStaffNames(messages: WhatsAppParsedMessage[]) {
  const names = new Set<string>();
  for (const message of messages.filter((m) => m.direction === 'outbound')) {
    const name = extractIntroducedStaffName(message);
    if (name) names.add(name);
  }
  return [...names];
}

function buildSession(
  messages: WhatsAppParsedMessage[],
  index: number
): WhatsAppConversationSession {
  const first = messages[0];
  const last = messages[messages.length - 1];
  const mediaKinds = messages.reduce(
    (acc, message) => {
      acc[message.kind] = (acc[message.kind] || 0) + 1;
      return acc;
    },
    {} as Record<WhatsAppMessageKind, number>
  );
  const mediaCount = messages.filter((m) => MEDIA_KIND_SET.has(m.kind)).length;
  const missingMediaCount = messages.filter(
    (m) => MEDIA_KIND_SET.has(m.kind) && !m.mediaAvailable
  ).length;
  const participants = Array.from(
    new Set(messages.filter((m) => m.direction !== 'system').map((m) => m.sender))
  );
  const inboundSender = messages.find((m) => m.direction === 'inbound')?.sender || null;
  return {
    id: `${first.timestamp.getTime()}-${index}`,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    messages,
    participants,
    outboundStaffNames: extractStaffNames(messages),
    customerName: inboundSender,
    mediaCount,
    mediaKinds,
    missingMediaCount,
    replyCount: messages.filter((m) => Boolean(m.replyTo?.text)).length,
    forwardedCount: messages.filter((m) => m.forwarded).length,
  };
}

export function splitWhatsAppSessions(
  messages: WhatsAppParsedMessage[],
  gapMinutes = 120
): WhatsAppConversationSession[] {
  const humans = messages.filter((m) => m.direction !== 'system' && m.kind !== 'system');
  if (!humans.length) return [];
  const sorted = humans.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const groups: WhatsAppParsedMessage[][] = [];
  let current: WhatsAppParsedMessage[] = [];
  for (const message of sorted) {
    const previous = current[current.length - 1];
    const gap = previous ? (message.timestamp.getTime() - previous.timestamp.getTime()) / 60000 : 0;
    if (current.length && gap > gapMinutes) {
      groups.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => buildSession(group, index));
}
