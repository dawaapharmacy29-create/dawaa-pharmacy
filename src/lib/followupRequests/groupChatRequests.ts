export type RequestVerdict = 'request' | 'review' | 'ignored' | 'repeat';

export interface GroupChatMessage {
  sender: string;
  /** Cairo wall-clock time as written in the export, `YYYY-MM-DDTHH:mm:ss`. */
  sentAtLocal: string;
  body: string;
  hasImage: boolean;
  verdict: RequestVerdict;
}

const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const SPACES = /[\u00a0\u202f]/g;
const IOS_HEADER = /^\[(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm]|ص|م)?\]\s*(.*)$/;
const ANDROID_HEADER = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm]|ص|م)?\s+-\s+(.*)$/;
const IMAGE_MARK = /<\s*تم حذف الصورة\s*>|<\s*image omitted\s*>|<\s*تم استبعاد الصورة\s*>|<\s*الوسائط محذوفة\s*>|<\s*media omitted\s*>|<attached:[^>]*>|\[صورة\]/gi;
const DELETED = /تم حذف هذه الرسالة|this message was deleted|لقد حذفت هذه الرسالة/i;

/** Words a doctor uses when asking the team to follow a customer up. */
const REQUEST_WORDS = ['نتابع', 'متابع', 'تابعو', 'نطمن', 'نتطمن', 'اطمن', 'طمنو', 'فولو', 'follow', 'نسال', 'نباركل', 'نكلم', 'كلموها', 'كلموه', 'نكسب', 'نتواصل', 'نهتم', 'نكود', 'نسجل'];

const normalize = (value: string) =>
  value.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

/** An invoice photo with one of these is news or a points question, not a case to follow up. */
const NOT_A_CASE = /(^|\s)ا?توف(ت|ي)(\s|$)|كاش|نقاط|بوينت|مندوب/;

function classify(body: string, hasImage: boolean): RequestVerdict {
  const text = normalize(body);
  const hasWords = REQUEST_WORDS.some((word) => text.includes(word));
  if (hasImage && hasWords) return 'request';
  // Some doctors describe the case under the invoice photo without writing "نتطمن".
  if (hasImage && text.split(/\s+/).filter(Boolean).length >= 2 && !NOT_A_CASE.test(text)) return 'request';
  if (hasImage || hasWords) return 'review';
  // A long typed description of a customer is often a request written without the usual words.
  if (text.split(/\s+/).filter(Boolean).length >= 7 && !NOT_A_CASE.test(text)) return 'review';
  return 'ignored';
}

const REPEAT_WINDOW_SECONDS = 120;
const BARE_LABEL_MIN_GAP_SECONDS = 10;
const BARE_LABELS = new Set(['عميل جديد', 'مولود جديد', 'حاله جديده']);

/**
 * WhatsApp retries leave the same batch twice within seconds, and each copy has its own time, so
 * the import's fingerprint cannot catch them. Bare labels can really be different customers:
 * those only repeat 10+ seconds later, and each earlier one can be repeated once.
 */
function markRepeats(messages: GroupChatMessage[]) {
  const seconds = (message: GroupChatMessage) => Date.parse(`${message.sentAtLocal}Z`) / 1000;
  const earlier = new Map<string, Array<{ at: number; consumed: boolean }>>();
  for (const message of messages) {
    const text = normalize(message.body).replace(/\s+/g, ' ').trim();
    if (message.verdict === 'ignored' || !text) continue;
    const key = `${message.sender}|${text.replace(/\s/g, '')}`;
    const at = seconds(message);
    const copies = earlier.get(key) || [];
    const bare = BARE_LABELS.has(text);
    const original = copies.find((copy) => at - copy.at <= REPEAT_WINDOW_SECONDS && (!bare || (!copy.consumed && at - copy.at >= BARE_LABEL_MIN_GAP_SECONDS)));
    if (original) {
      original.consumed = true;
      message.verdict = 'repeat';
      if (!bare) copies.push({ at, consumed: true });
    } else {
      copies.push({ at, consumed: false });
    }
    earlier.set(key, copies);
  }
}

interface RawMessage { a: number; b: number; c: number; hour: number; minute: number; second: number; meridiem: string; rest: string; lines: string[] }

/** WhatsApp writes the date in the phone's order, so the whole file decides day-first or month-first. */
function isDayFirst(messages: RawMessage[]): boolean {
  if (messages.some((m) => m.a > 12)) return true;
  if (messages.some((m) => m.b > 12)) return false;
  return false;
}

function localStamp(message: RawMessage, dayFirst: boolean): string {
  const yearFirst = message.a > 31;
  const year = yearFirst ? message.a : message.c < 100 ? 2000 + message.c : message.c;
  const month = yearFirst || !dayFirst ? (yearFirst ? message.b : message.a) : message.b;
  const day = yearFirst ? message.c : dayFirst ? message.a : message.b;
  let hour = message.hour;
  const meridiem = message.meridiem.toLowerCase();
  if ((meridiem === 'pm' || meridiem === 'م') && hour < 12) hour += 12;
  if ((meridiem === 'am' || meridiem === 'ص') && hour === 12) hour = 0;
  const two = (value: number) => String(value).padStart(2, '0');
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(message.minute)}:${two(message.second)}`;
}

export function parseGroupChat(content: string): GroupChatMessage[] {
  const raw: RawMessage[] = [];
  let current: RawMessage | null = null;
  for (const original of content.split(/\r?\n/)) {
    const line = original.replace(INVISIBLE, '').replace(SPACES, ' ');
    const match = IOS_HEADER.exec(line) || ANDROID_HEADER.exec(line);
    if (match) {
      current = {
        a: Number(match[1]), b: Number(match[2]), c: Number(match[3]),
        hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0),
        meridiem: match[7] || '', rest: match[8], lines: [],
      };
      raw.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const dayFirst = isDayFirst(raw);
  const messages: GroupChatMessage[] = [];
  for (const message of raw) {
    // A line with no "name:" is a WhatsApp notice, such as someone joining the group.
    const colon = message.rest.indexOf(':');
    if (colon <= 0) continue;
    const sender = message.rest.slice(0, colon).trim();
    const full = [message.rest.slice(colon + 1), ...message.lines].join('\n');
    if (DELETED.test(full)) continue;
    const hasImage = full.search(IMAGE_MARK) >= 0;
    const body = full.replace(IMAGE_MARK, ' ').replace(/[ \t]+/g, ' ').trim();
    messages.push({ sender, sentAtLocal: localStamp(message, dayFirst), body, hasImage, verdict: classify(body, hasImage) });
  }
  markRepeats(messages);
  return messages;
}
