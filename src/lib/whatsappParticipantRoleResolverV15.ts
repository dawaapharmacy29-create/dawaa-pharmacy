import { supabase } from '@/lib/supabase';
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

const STAFF_DIRECTORY_CACHE_TTL_MS = 5 * 60_000;
let staffDirectoryCache: { rows: any[]; expiresAt: number } | null = null;
let staffDirectoryRequest: Promise<any[]> | null = null;

async function getStaffDirectoryRows() {
  const now = Date.now();
  if (staffDirectoryCache && staffDirectoryCache.expiresAt > now) return staffDirectoryCache.rows;
  if (staffDirectoryRequest) return staffDirectoryRequest;

  staffDirectoryRequest = (async () => {
    const { data } = await supabase
      .from('staff_accounts')
      .select('id,staff_id,staff_name,name,username,role,staff_role,job_title,role_label,branch,active,is_active')
      .limit(800);
    const rows = data || [];
    staffDirectoryCache = { rows, expiresAt: Date.now() + STAFF_DIRECTORY_CACHE_TTL_MS };
    return rows;
  })();

  try {
    return await staffDirectoryRequest;
  } finally {
    staffDirectoryRequest = null;
  }
}

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase()
  .replace(/^(?:د\s*[\/.\-]?\s*|دكتور(?:ه|ة)?\s+|أستاذ(?:ه|ة)?\s+|استاذ(?:ه|ة)?\s+)/i, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ').trim();

function cleanCandidateName(value: unknown) {
  return String(value ?? '')
    .replace(/\[[0-9]{1,2}[\/.\-][0-9]{1,2}[\/.\-][0-9]{2,4}[\s\S]*$/g, '')
    .replace(/\bمن\s+(?:خدمه|خدمة)\s+عملاء\s+صيدليات\s+دواء[\s\S]*$/i, '')
    .replace(/\bمن\s+صيدليات\s+دواء[\s\S]*$/i, '')
    .replace(/\bصيدليات\s+دواء[\s\S]*$/i, '')
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
    /مع حضرتك\s+(?:د\s*[\/.\-]?|دكتور(?:ه|ة)?|أ\.?|استاذ(?:ه|ة)?)?\s*([^\n،,.\[]]{2,45})(?:\s+من\s+(?:خدمه|خدمة|صيدليات)|[،,.\[]|$)/i,
    /معاك(?:ي)?\s+(?:د\s*[\/.\-]?|دكتور(?:ه|ة)?)?\s*([^\n،,.\[]]{2,45})(?:\s+من\s+(?:خدمه|خدمة|صيدليات)|[،,.\[]|$)/i,
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

function currentnessScore(staff: any) {
  let score = 0;
  if (staff?.active === true && staff?.is_active !== false) score += 12;
  else if (staff?.active === true) score += 9;
  else if (staff?.is_active === true) score += 3;
  if (staff?.active === false) score -= 8;
  if (staff?.staff_id) score += 4;
  if (staff?.job_title) score += 2;
  return score;
}

function scoreName(candidate: string, staff: any, expectedRole?: WhatsAppParticipantRoleV15 | null) {
  const target = normalize(cleanCandidateName(candidate));
  if (!target) return 0;
  const values = [staff.staff_name, staff.name, staff.username].map((x) => normalize(cleanCandidateName(x))).filter(Boolean);
  let best = 0;
  for (const value of values) {
    if (value === target) best = Math.max(best, 100);
    else if (value.startsWith(`${target} `) || target.startsWith(`${value} `)) best = Math.max(best, 91);
    else if (value.includes(target) || target.includes(value)) best = Math.max(best, 84);
    else {
      const a = new Set(value.split(' '));
      const b = target.split(' ');
      const overlap = b.filter((x) => a.has(x)).length;
      if (overlap >= 2) best = Math.max(best, 79);
      else if (overlap === 1 && b.length === 1) best = Math.max(best, 76);
    }
  }
  if (!best) return 0;
  const staffRole = roleFromStaff(staff);
  const roleBonus = expectedRole && expectedRole !== 'pharmacy_unknown' && staffRole === expectedRole ? 7 : 0;
  const rolePenalty = expectedRole && expectedRole !== 'pharmacy_unknown' && staffRole !== expectedRole ? -4 : 0;
  return best + currentnessScore(staff) + roleBonus + rolePenalty;
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

  const staffRows: any[] = candidateNames.size ? await getStaffDirectoryRows() : [];

  const resolvedByName = new Map<string, { row: any; score: number; margin: number }>();
  for (const candidate of candidateNames) {
    const scored = staffRows
      .map((row) => ({ row, score: scoreName(candidate, row, null) }))
      .filter((x) => x.score >= 76)
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    const second = scored[1];
    if (!top) continue;
    const sameCanonicalDuplicate = second && normalize(canonicalDisplayName(second.row)) === normalize(canonicalDisplayName(top.row));
    const margin = top.score - (second?.score || 0);
    if (!second || margin >= 6 || (sameCanonicalDuplicate && currentnessScore(top.row) > currentnessScore(second.row))) {
      resolvedByName.set(normalize(candidate), { row: top.row, score: top.score, margin });
    }
  }

  let activeStaff: { row: any; score: number; margin?: number } | null = null;
  const messages: WhatsAppMessageRoleV15[] = [];
  for (const message of session.messages) {
    const lexical = lexicalRole(message);
    if (lexical?.role === 'customer' || lexical?.role === 'system') {
      messages.push({ messageId: message.id, sender: message.sender, role: lexical.role, accountId: null, staffId: null, staffName: null, branch: null, confidence: lexical.confidence, reason: lexical.reason });
      continue;
    }

    const intro = introName(message.text);
    const candidates = [intro, message.sender, ...session.outboundStaffNames].filter((x): x is string => Boolean(x) && isPlausibleName(x));
    let resolved: { row: any; score: number; margin?: number } | null = null;
    for (const candidate of candidates) {
      const key = normalize(cleanCandidateName(candidate));
      const direct = resolvedByName.get(key);
      if (direct && (!resolved || direct.score > resolved.score)) resolved = direct;

      if (lexical?.role && (!direct || lexical.role === 'customer_service')) {
        const roleScored = staffRows
          .map((row) => ({ row, score: scoreName(candidate, row, lexical.role) }))
          .filter((x) => x.score >= 82)
          .sort((a, b) => b.score - a.score);
        if (roleScored[0] && (!roleScored[1] || roleScored[0].score - roleScored[1].score >= 6) && (!resolved || roleScored[0].score > resolved.score)) {
          resolved = { ...roleScored[0], margin: roleScored[0].score - (roleScored[1]?.score || 0) };
        }
      }
    }
    if (intro && resolved) activeStaff = resolved;
    else if (!resolved && activeStaff) resolved = activeStaff;

    if (lexical?.role === 'customer_service') {
      messages.push({ messageId: message.id, sender: message.sender, role: 'customer_service', accountId: resolved?.row?.id || null, staffId: resolved?.row?.staff_id || null, staffName: canonicalDisplayName(resolved?.row, intro), branch: resolved?.row?.branch || null, confidence: Math.min(99, Math.max(lexical.confidence, resolved?.score || 0)), reason: resolved ? `${lexical.reason} تم توحيد الهوية مع الحساب الحالي.` : lexical.reason });
      continue;
    }
    if (resolved) {
      const role = roleFromStaff(resolved.row);
      const confidence = Math.max(72, Math.min(99, Math.round(resolved.score - Math.max(0, 6 - (resolved.margin || 6)))));
      messages.push({ messageId: message.id, sender: message.sender, role, accountId: resolved.row.id || null, staffId: resolved.row.staff_id || null, staffName: canonicalDisplayName(resolved.row, intro), branch: resolved.row.branch || null, confidence, reason: `تم توحيد اسم المرسل وربطه بالحساب الأنسب (${resolved.row.role || resolved.row.staff_role || resolved.row.job_title || 'غير محدد'}).` });
    } else {
      messages.push({ messageId: message.id, sender: message.sender, role: lexical?.role || 'pharmacy_unknown', accountId: null, staffId: null, staffName: intro || null, branch: null, confidence: lexical?.confidence || 52, reason: lexical?.reason || 'رسالة خارجة من الصيدلية لكن هوية الموظف/دوره غير محسومة.' });
    }
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
