import type { GroupChatMessage } from '@/lib/followupRequests/groupChatRequests';
import { matchSenderToDoctor, type DoctorOption } from '@/lib/followupRequests/matchSenderToDoctor';
import { findNamedDoctor } from '@/lib/followupRequests/namedDoctor';

// Customer requests posted in a branch's WhatsApp group (owner decision 2026-11-14: requests now go
// through the group). Pure: the export's messages in, request candidates out, each with the customer
// code/phone it carries and the doctor it should be credited to. Nothing is saved here.
// Owner decision 2026-11-18: a request is credited only to the doctor who sent it or who is named in
// it. One posted from the pharmacy's shared account without a doctor's name is still recorded, for
// the branch, but credited to nobody (being punched in at the time is no longer enough).

export interface ShiftWindow { staffId: string; from: string; to: string }

export type CandidateKind = 'request' | 'confirmation';
export type DoctorReason = 'sender' | 'named' | 'pharmacy_account' | 'none';

export interface RequestCandidate {
  /** Stable across re-uploads of the same export (sender + time + text). */
  fingerprint: string;
  sentAtLocal: string;
  sender: string;
  body: string;
  hasImage: boolean;
  kind: CandidateKind;
  customerCode: string | null;
  customerPhone: string | null;
  /** The item named in a confirmation message ("تم استلام وتأكيد طلب … (الصنف)"). */
  confirmedItem: string | null;
  /** The customer's name as written next to the code or phone ("مجدي الرحماني 1703"). */
  customerName: string | null;
  /** What the customer asked for: the request's other lines (items, quantity, notes). */
  details: string | null;
  doctorId: string | null;
  doctorReason: DoctorReason;
  /** Doctors punched in at the branch when the message was sent (shown only; it credits nobody). */
  onShift: string[];
}

const CONFIRMATION = /تم استلام وتأكيد طلب/;
const PHONE = /(?:\+?20|0020)?\s?(01[0125]\d{8})(?!\d)/;
/** A customer code is a standalone 4–6 digit number that is not part of a phone. */
const CODE = /(?<![\d+])(\d{4,6})(?!\d)/g;
/** Messages of the same sender this close together are one request split over lines ("الصنف" then "الاسم"). */
const MERGE_SECONDS = 90;
/** Prices and supply talk between the team ("شركة ايفا ٣٠٠٠", "مندوب") carry numbers that are not customer codes. */
const TEAM_TALK = /(سعر|جنيه|جمهور|شرك[هة]|مندوب|مخزن)/;

const toArabicDigits = (value: string) => value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const seconds = (local: string) => Date.parse(`${local}Z`) / 1000;

export function extractPhone(text: string) {
  const match = PHONE.exec(toArabicDigits(text).replace(/(\d)[\s-](?=\d)/g, '$1'));
  return match ? match[1] : null;
}

export function extractCustomerCode(text: string) {
  const plain = toArabicDigits(text).replace(/(?:\+?20|0020)?\s?01[0125]\d{8}/g, ' ');
  const codes = [...plain.matchAll(CODE)].map((m) => m[1]);
  return codes.length ? codes[0] : null;
}

function fingerprintOf(message: { sender: string; sentAtLocal: string; body: string }) {
  const text = `${message.sender}|${message.sentAtLocal}|${message.body.replace(/\s+/g, '')}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `wa-${hash.toString(36)}-${text.length}`;
}

const carriesCustomer = (text: string) => Boolean(extractPhone(text) || extractCustomerCode(text));

/**
 * Joins a sender's consecutive messages sent within MERGE_SECONDS of each other, unless both carry a
 * customer: "مجدي الرحماني 1703" then "مصطفي عزت18216" a minute later are two requests.
 */
function mergeBursts(messages: GroupChatMessage[]) {
  const out: Array<{ sender: string; sentAtLocal: string; body: string; hasImage: boolean }> = [];
  for (const message of messages) {
    if (message.verdict === 'repeat') continue;
    const last = out[out.length - 1];
    const gap = last ? seconds(message.sentAtLocal) - seconds(last.sentAtLocal) : -1;
    if (last && last.sender === message.sender && gap >= 0 && gap <= MERGE_SECONDS
      && !CONFIRMATION.test(message.body) && !CONFIRMATION.test(last.body)
      && !(carriesCustomer(last.body) && carriesCustomer(message.body))) {
      last.body = `${last.body}\n${message.body}`.trim();
      last.hasImage = last.hasImage || message.hasImage;
      continue;
    }
    out.push({ sender: message.sender, sentAtLocal: message.sentAtLocal, body: message.body, hasImage: message.hasImage });
  }
  return out;
}

/** Doctors whose punch window covers the time (Cairo wall-clock, same format as the export). */
export function doctorsOnShift(at: string, shifts: ShiftWindow[]) {
  const t = seconds(at);
  return [...new Set(shifts.filter((s) => seconds(s.from) <= t && t <= seconds(s.to)).map((s) => s.staffId))];
}

/** The branch's shared phone ("صيدليات دواء الشامي", "صيدليات دواء ابو العزم"), not a doctor's own. */
export const isPharmacyAccount = (sender: string) => /صيدلي|دواء|pharma/i.test(sender);

const LEAD_WORDS = /^(?:كود|الكود|رقم|العميل|عميل|اسم|الاسم|code)\s*[:：-]?\s*/i;
const TRAIL_WORDS = /\s*(?:كود|الكود|رقم|رقمه|رقمها|code)$/i;
const segmentsOf = (body: string) => body
  .replace(/[؜‎‏‪-‮⁦-⁩]/g, '')
  // "/" separates parts ("01067016533/ خالد محمد/ اوفيوهيبتا") except in a title: "د/ علياء".
  .split(/\n|(?<!(?:^|[\s(])د)\s*\/\s*/)
  .map((part) => part.replace(/<[^>]*>/g, ' ').replace(/-{2,}/g, ' , ').replace(/\s+/g, ' ').trim())
  .filter(Boolean);
const nameAround = (segment: string) => toArabicDigits(segment)
  .replace(/(?:\+?20|0020)?\s?01[0125]\d{8}/g, ' ')
  .replace(/\d+/g, ' ')
  .replace(/[-–:،,.()&+]+/g, ' ')
  .replace(/\s+/g, ' ').trim()
  .replace(LEAD_WORDS, '').replace(TRAIL_WORDS, '').trim();
/** One to four words with no item or request words look like a person's name. */
const looksLikeName = (text: string) => {
  const words = text.split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 4 && !/[a-z]/i.test(text)
    && !/(محتاج|عايز|عاوز|بيس[اأ]ل|بتس[اأ]ل|كانت|طلب|نوفر|علب|عبو|شريط|كبسول|قراص|شراب|مهم|كريم|حقن|فيال|اكياس|أكياس|لبوس|بكره|النهارده)/.test(text);
};
/** "ايهاب محمد كود 12781 محتاجه ميرنا لوب": the words before the number and the words after it. */
const aroundNumber = (segment: string): [string, string] => {
  const plain = toArabicDigits(segment).replace(/(\d)[\s-](?=\d)/g, '$1');
  const at = plain.search(/(?:\+?20|0020)?\s?01[0125]\d{8}|(?<![\d+])\d{4,6}(?!\d)/);
  if (at < 0) return [nameAround(plain), ''];
  const after = plain.slice(at).replace(/^(?:\+?20|0020)?\s?\d+/, '');
  return [nameAround(plain.slice(0, at)), after.replace(/^[\s\-–:،,.]+/, '').trim()];
};

/** Splits a request into the customer's name and the rest (items, quantity, notes). */
export function describeRequest(body: string): { customerName: string | null; details: string | null } {
  const segments = segmentsOf(body);
  let customerName: string | null = null;
  const rest: string[] = [];
  segments.forEach((segment, index) => {
    if (carriesCustomer(segment)) {
      const [before, after] = aroundNumber(segment);
      const afterName = nameAround(after);
      if (!customerName && before && looksLikeName(before)) {
        customerName = before;
        if (after) rest.push(after);
      } else if (!customerName && !before && afterName && looksLikeName(afterName)) {
        customerName = afterName;
      } else {
        const leftover = [before, after].filter(Boolean).join(' ').trim();
        if (leftover) rest.push(leftover);
      }
      return;
    }
    // A short line right before or after the code is the name: "9509" then "دنيا".
    const nextToCustomer = carriesCustomer(segments[index - 1] || '') || carriesCustomer(segments[index + 1] || '');
    if (!customerName && nextToCustomer && looksLikeName(nameAround(segment))) { customerName = nameAround(segment); return; }
    rest.push(segment);
  });
  const details = rest.join(' · ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { customerName, details: details || null };
}

export function extractRequestCandidates(messages: GroupChatMessage[], doctors: DoctorOption[], shifts: ShiftWindow[]): RequestCandidate[] {
  const out: RequestCandidate[] = [];
  for (const block of mergeBursts(messages)) {
    const confirmation = CONFIRMATION.test(block.body);
    const customerPhone = extractPhone(block.body);
    const customerCode = confirmation ? null : extractCustomerCode(block.body);
    if (!confirmation && !customerPhone && !customerCode) continue;
    // A bare number with no words is a price or a reply, not a request.
    const words = block.body.replace(/[\d\s.,:+\-/*()]/g, ' ').trim().split(/\s+/).filter((w) => w.length >= 2);
    if (!confirmation && words.length < 1) continue;
    if (!confirmation && !customerPhone && TEAM_TALK.test(block.body)) continue;
    const onShift = doctorsOnShift(block.sentAtLocal, shifts);
    const sender = matchSenderToDoctor(block.sender, doctors);
    const named = findNamedDoctor(block.body, doctors);
    const [doctorId, doctorReason]: [string | null, DoctorReason] = sender ? [sender.staffId, 'sender']
      : named ? [named.staffId, 'named']
        : isPharmacyAccount(block.sender) ? [null, 'pharmacy_account'] : [null, 'none'];
    const described = confirmation ? { customerName: null, details: null } : describeRequest(block.body);
    out.push({
      fingerprint: fingerprintOf(block), sentAtLocal: block.sentAtLocal, sender: block.sender, body: block.body, hasImage: block.hasImage,
      kind: confirmation ? 'confirmation' : 'request', customerCode, customerPhone,
      confirmedItem: confirmation ? (/\(([^)]+)\)/.exec(block.body)?.[1]?.trim() ?? null) : null,
      customerName: described.customerName, details: described.details,
      doctorId, doctorReason, onShift,
    });
  }
  return out;
}

export const DOCTOR_REASON_LABELS: Record<DoctorReason, string> = {
  sender: 'باعتها من موبايله',
  named: 'اسمه مكتوب في الرسالة',
  pharmacy_account: 'من رقم الصيدلية من غير اسم دكتور · للفرع بس',
  none: 'مش معروف مين بعتها · للفرع بس',
};

const BRANCH_WORDS: Array<[string, RegExp]> = [['فرع شكري', /شكري|ابو العزم|أبو العزم/], ['فرع الشامي', /الشامي|شامي|shamy|shami/i]];
const SENDER = /(?:\]|\s-)\s([^:\n\]]{2,40}):/g;
const sendersOf = (content: string) => [...content.slice(0, 400000).matchAll(SENDER)]
  .map((m) => m[1].replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim());

/**
 * The group's branch from the export itself: its title ("أنشأ مجموعة "طلبات العملاء فرع شكري""),
 * the file name, or the pharmacy account that posts in it. Null when they point at both or none.
 */
export function detectGroupBranch(fileName: string, content: string): string | null {
  const title = /مجموعة\s*["«“]([^"»”]+)["»”]/.exec(content.slice(0, 20000));
  const pharmacySenders = [...new Set(sendersOf(content).filter(isPharmacyAccount))].join(' ');
  for (const source of [title?.[1] || '', fileName, pharmacySenders]) {
    const hits = BRANCH_WORDS.filter(([, words]) => words.test(source)).map(([branch]) => branch);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** The pharmacy cycle (26th → 25th) a Cairo day falls in, as `YYYY-MM-DD` bounds. */
export function cycleOfDay(day: string): { start: string; end: string } {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number);
  const startMonth = date >= 26 ? month : month - 1;
  const start = new Date(Date.UTC(year, startMonth - 1, 26));
  const end = new Date(Date.UTC(year, startMonth, 25));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export type RequestPeriod = 'cycle' | 'two_cycles' | 'all';

/**
 * Exports carry the group's whole history; by default only the cycle of the newest message is
 * recorded (re-uploading is harmless: each request is saved once by its fingerprint).
 */
export function candidatesInPeriod(candidates: readonly RequestCandidate[], period: RequestPeriod) {
  if (!candidates.length) return { from: null, to: null, list: [] as RequestCandidate[] };
  const days = candidates.map((c) => c.sentAtLocal.slice(0, 10)).sort();
  const newest = days[days.length - 1];
  if (period === 'all') return { from: days[0], to: newest, list: [...candidates] };
  let { start } = cycleOfDay(newest);
  if (period === 'two_cycles') start = cycleOfDay(new Date(Date.parse(`${start}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)).start;
  return { from: start, to: newest, list: candidates.filter((c) => c.sentAtLocal.slice(0, 10) >= start) };
}
