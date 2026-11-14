import type { GroupChatMessage } from '@/lib/followupRequests/groupChatRequests';
import { matchSenderToDoctor, type DoctorOption } from '@/lib/followupRequests/matchSenderToDoctor';
import { findNamedDoctor } from '@/lib/followupRequests/namedDoctor';

// Customer requests posted in a branch's WhatsApp group (owner decision 2026-11-14: requests now go
// through the group). Pure: the export's messages in, request candidates out, each with the customer
// code/phone it carries and the doctor it should be credited to. Nothing is saved here; the manager
// reviews each one and records it through the canonical request form.

export interface ShiftWindow { staffId: string; from: string; to: string }

export type CandidateKind = 'request' | 'confirmation';
export type DoctorReason = 'sender' | 'named' | 'on_shift' | 'several_on_shift' | 'none';

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
  doctorId: string | null;
  doctorReason: DoctorReason;
  /** Doctors punched in at the branch when the message was sent. */
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

/** Joins a sender's consecutive messages sent within MERGE_SECONDS of each other. */
function mergeBursts(messages: GroupChatMessage[]) {
  const out: Array<{ sender: string; sentAtLocal: string; body: string; hasImage: boolean }> = [];
  for (const message of messages) {
    if (message.verdict === 'repeat') continue;
    const last = out[out.length - 1];
    const gap = last ? seconds(message.sentAtLocal) - seconds(last.sentAtLocal) : -1;
    if (last && last.sender === message.sender && gap >= 0 && gap <= MERGE_SECONDS
      && !CONFIRMATION.test(message.body) && !CONFIRMATION.test(last.body)) {
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
        : onShift.length === 1 ? [onShift[0], 'on_shift']
          : onShift.length > 1 ? [null, 'several_on_shift'] : [null, 'none'];
    out.push({
      fingerprint: fingerprintOf(block), sentAtLocal: block.sentAtLocal, sender: block.sender, body: block.body, hasImage: block.hasImage,
      kind: confirmation ? 'confirmation' : 'request', customerCode, customerPhone,
      confirmedItem: confirmation ? (/\(([^)]+)\)/.exec(block.body)?.[1]?.trim() ?? null) : null,
      doctorId, doctorReason, onShift,
    });
  }
  return out;
}

export const DOCTOR_REASON_LABELS: Record<DoctorReason, string> = {
  sender: 'باعتها من موبايله',
  named: 'اسمه مكتوب في الرسالة',
  on_shift: 'كان باصم في الفرع وقت الرسالة',
  several_on_shift: 'أكتر من دكتور كان باصم — اختار',
  none: 'مفيش دكتور باصم وقتها — اختار',
};
