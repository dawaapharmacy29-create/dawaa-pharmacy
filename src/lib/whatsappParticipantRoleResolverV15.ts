import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';
import { normalizeDoctorName, resolveStaffDirectoryName } from '@/lib/staff/staffIdentityResolver';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type WhatsAppParticipantRoleV15 = 'customer' | 'pharmacist' | 'customer_service' | 'delivery' | 'management' | 'pharmacy_unknown' | 'system';

export interface WhatsAppMessageRoleV15 {
  messageId: string;
  sender: string;
  role: WhatsAppParticipantRoleV15;
  accountId: string | null;
  staffId: string | null;
  staffName: string | null;
  /** فرع الموظف المُطابَق (من staff_accounts.branch) — كانت متاحة داخليًا وغير مُصدَّرة.
   * بتُستخدم كـ branch context لمحلّلات أخرى (مثل whatsappStaffResolverV6/ownership) بدل
   * تمرير null دايمًا، من غير ما نعمل استعلام/محلّل فرع مواز جديد. */
  branch: string | null;
  confidence: number;
  reason: string;
}

export interface WhatsAppParticipantRoleModelV15 {
  version: 'whatsapp-participant-role-v15';
  messages: WhatsAppMessageRoleV15[];
  staff: Array<{ accountId: string | null; staffId: string | null; staffName: string; role: WhatsAppParticipantRoleV15; branch: string | null; confidence: number }>;
}

const normalize = normalizeDoctorName;

function cleanCandidateName(value: unknown) {
  return String(value ?? '')
    .replace(/\[[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}[\s\S]*$/g, '')
    .replace(/(?:^|\s)من\s+(?:خدمه|خدمة)\s+(?:ال)?عملاء\s+صيدليات\s+دواء[\s\S]*$/i, '')
    .replace(/(?:^|\s)من\s+صيدليات\s+دواء[\s\S]*$/i, '')
    .replace(/(?:^|\s)صيدليات\s+دواء[\s\S]*$/i, '')
    .trim();
}

function isPlausibleName(value: unknown) {
  const cleaned = cleanCandidateName(value);
  const n = normalize(cleaned);
  if (n.length < 2 || n.length > 45) return false;
  if (/^\d/.test(n) || /\d{1,2}\s+\d{1,2}\s+\d{2,4}/.test(n)) return false;
  if (/(am|pm|ص|م)\s*$/i.test(cleaned) && /\d/.test(cleaned)) return false;
  return /\p{L}/u.test(n);
}

const CUSTOMER_SERVICE_RX = /(خدمه العملاء|خدمة العملاء|مسؤول(?:ه|ة)? خدمه|مسئول(?:ه|ة)? خدمه|customer service|فريق دواء الفا|فريق دواء ألفا)/i;
const DELIVERY_RX = /(مندوب|دليفري|توصيل|delivery)/i;
const MANAGEMENT_RX = /(مدير عام|مدير الفروع|مديره الفروع|مديرة الفروع|مدير فرع|المدير التنفيذي|branches_manager|general_manager|executive_manager)/i;
const PHARMACIST_RX = /(صيدلي|صيدلاني|pharmacist|مسؤول الشيفت|مسئول الشيفت|shift_supervisor|دكتور|دكتوره|دكتورة)/i;

function roleFromStaff(row: any): WhatsAppParticipantRoleV15 {
  const combined = `${row?.role || ''} ${row?.staff_role || ''} ${row?.job_title || ''} ${row?.role_label || ''}`;
  if (CUSTOMER_SERVICE_RX.test(combined) || String(row?.role || '').toLowerCase() === 'team_dawaa_alpha') return 'customer_service';
  if (DELIVERY_RX.test(combined) || String(row?.role || '').toLowerCase() === 'delivery') return 'delivery';
  if (MANAGEMENT_RX.test(combined)) return 'management';
  if (PHARMACIST_RX.test(combined)) return 'pharmacist';
  return 'pharmacy_unknown';
}

function introName(text: string) {
  const patterns = [
    /مع حضرتك\s+(?:دكتور(?:ه|ة)?|د\s*[/.-]?|أ\.?|استاذ(?:ه|ة)?)?\s*([^\n،,.\u005B]{2,45})(?:\s+من\s+(?:خدمه|خدمة|صيدليات)|[،,.\u005B]|$)/i,
    /معاك(?:ي)?\s+(?:دكتور(?:ه|ة)?|د\s*[/.-]?)?\s*([^\n،,.\u005B]{2,45})(?:\s+من\s+(?:خدمه|خدمة|صيدليات)|[،,.\u005B]|$)/i,
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    const cleaned = cleanCandidateName(match?.[1]);
    if (cleaned && isPlausibleName(cleaned)) return cleaned;
  }
  return null;
}

function lexicalRole(message: WhatsAppParsedMessage): { role: WhatsAppParticipantRoleV15; confidence: number; reason: string } | null {
  if (message.direction === 'system') return { role: 'system', confidence: 100, reason: 'رسالة نظام.' };
  if (message.direction === 'inbound') return { role: 'customer', confidence: 98, reason: 'رسالة واردة من طرف العميل في التصدير.' };
  if (CUSTOMER_SERVICE_RX.test(message.text)) return { role: 'customer_service', confidence: 96, reason: 'الرسالة تعرّف المرسل صراحة كخدمة عملاء.' };
  if (DELIVERY_RX.test(message.text) && /(مع حضرتك|معاك|انا|أنا)/i.test(message.text)) return { role: 'delivery', confidence: 84, reason: 'تعريف صريح/شبه صريح كمندوب أو دليفري.' };
  return null;
}

function canonicalDisplayName(row: any, fallback?: string | null) {
  return String(row?.staff_name || row?.name || fallback || '').trim() || null;
}

export async function resolveWhatsAppParticipantRolesV15(session: WhatsAppConversationSession): Promise<WhatsAppParticipantRoleModelV15> {
  const candidateNames = new Set<string>();
  for (const message of session.messages) {
    if (message.direction !== 'outbound') continue;
    const intro = introName(message.text);
    if (intro) candidateNames.add(intro);
    if (message.sender && !/^(you|me|انت|أنت|انا|أنا)$/i.test(message.sender.trim()) && isPlausibleName(message.sender)) candidateNames.add(cleanCandidateName(message.sender));
  }
  session.outboundStaffNames.forEach((name) => { if (isPlausibleName(name)) candidateNames.add(cleanCandidateName(name)); });

  // One complete canonical read per session; never retain another user's directory cache.
  const directory = candidateNames.size ? await readStaffDirectory({ requireComplete: true }) : [];
  type Match = { row: any; score: number };
  const match = (candidate: string): Match | null => {
    const decision = resolveStaffDirectoryName(cleanCandidateName(candidate), directory);
    if (decision.status !== 'resolved' || !decision.staff?.id) return null;
    const person = decision.staff;
    const account = directory.find(row => row.source === 'staff_account' && row.id === person.id && row.active);
    return { row: { id: account?.accountId || null, staff_id: person.id, staff_name: person.name,
      role: account?.role || person.role, branch: person.branch }, score: 94 };
  };
  const known = new Map([...candidateNames].map(name => [normalize(name), match(name)]));
  let activeStaff: Match | null = null;
  const messages: WhatsAppMessageRoleV15[] = [];
  for (const message of session.messages) {
    const lexical = lexicalRole(message);
    if (lexical?.role === 'customer' || lexical?.role === 'system') {
      messages.push({ messageId: message.id, sender: message.sender, role: lexical.role, accountId: null, staffId: null, staffName: null, branch: null, confidence: lexical.confidence, reason: lexical.reason });
      continue;
    }
    const intro = introName(message.text);
    const explicitSender = message.sender && !/^(you|me|انت|أنت|انا|أنا)$/i.test(message.sender.trim()) && isPlausibleName(message.sender)
      ? cleanCandidateName(message.sender) : null;
    const candidate = intro || explicitSender || (session.outboundStaffNames.length === 1 ? cleanCandidateName(session.outboundStaffNames[0]) : null);
    let resolved = candidate ? known.get(normalize(candidate)) || match(candidate) : activeStaff;
    // An explicit unresolved new speaker must never inherit the preceding doctor's identity.
    if (intro || explicitSender) activeStaff = resolved || null;
    if (lexical && resolved && lexical.role !== roleFromStaff(resolved.row)) resolved = null;
    if (intro) activeStaff = resolved;
    const role = lexical?.role || (resolved ? roleFromStaff(resolved.row) : 'pharmacy_unknown');
    messages.push({ messageId: message.id, sender: message.sender, role,
      accountId: resolved?.row.id || null, staffId: resolved?.row.staff_id || null,
      staffName: resolved ? canonicalDisplayName(resolved.row, intro) : intro,
      branch: resolved?.row.branch || null, confidence: resolved ? 94 : lexical?.confidence || 52,
      reason: resolved ? 'مطابقة دقيقة غير متعارضة لهوية موظف ثابتة من الدليل الكامل.' : lexical?.reason || 'الهوية معلقة للمراجعة؛ لا تُعتمد بالمطابقة الجزئية.' });
  }

  const uniqueStaff = new Map<string, { accountId: string | null; staffId: string | null; staffName: string; role: WhatsAppParticipantRoleV15; branch: string | null; confidence: number }>();
  for (const message of messages) {
    if (!message.staffName || ['customer','system'].includes(message.role)) continue;
    const key = message.accountId || message.staffId || normalize(message.staffName);
    const previous = uniqueStaff.get(key);
    if (!previous || message.confidence > previous.confidence) uniqueStaff.set(key, { accountId: message.accountId, staffId: message.staffId, staffName: message.staffName, role: message.role, branch: message.branch, confidence: message.confidence });
  }

  return { version: 'whatsapp-participant-role-v15', messages, staff: [...uniqueStaff.values()] };
}
