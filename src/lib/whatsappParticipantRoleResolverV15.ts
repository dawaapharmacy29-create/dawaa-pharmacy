import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type WhatsAppParticipantRoleV15 = 'customer' | 'pharmacist' | 'customer_service' | 'delivery' | 'management' | 'pharmacy_unknown' | 'system';

export interface WhatsAppMessageRoleV15 {
  messageId: string;
  sender: string;
  role: WhatsAppParticipantRoleV15;
  staffId: string | null;
  staffName: string | null;
  confidence: number;
  reason: string;
}

export interface WhatsAppParticipantRoleModelV15 {
  version: 'whatsapp-participant-role-v15';
  messages: WhatsAppMessageRoleV15[];
  staff: Array<{ staffId: string | null; staffName: string; role: WhatsAppParticipantRoleV15; confidence: number }>;
}

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ').trim();

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
    /مع حضرتك\s+(?:د\.?|دكتور(?:ه|ة)?|أ?\.?|استاذ(?:ه|ة)?)?\s*([^\n،,.]{2,40})(?:\s+من\s+(?:خدمه|خدمة|صيدليات)|[،,.]|$)/i,
    /معاك(?:ي)?\s+(?:د\.?|دكتور(?:ه|ة)?)?\s*([^\n،,.]{2,40})(?:\s+من\s+(?:خدمه|خدمة|صيدليات)|[،,.]|$)/i,
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    if (match?.[1]) return match[1].trim();
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

function scoreName(candidate: string, staff: any) {
  const target = normalize(candidate);
  if (!target) return 0;
  const values = [staff.staff_name, staff.name, staff.username].map(normalize).filter(Boolean);
  let best = 0;
  for (const value of values) {
    if (value === target) best = Math.max(best, 100);
    else if (value.includes(target) || target.includes(value)) best = Math.max(best, 86);
    else {
      const a = new Set(value.split(' '));
      const b = target.split(' ');
      const overlap = b.filter((x) => a.has(x)).length;
      if (overlap >= 2) best = Math.max(best, 78);
    }
  }
  return best;
}

export async function resolveWhatsAppParticipantRolesV15(session: WhatsAppConversationSession): Promise<WhatsAppParticipantRoleModelV15> {
  const candidateNames = new Set<string>();
  for (const message of session.messages) {
    if (message.direction !== 'outbound') continue;
    const intro = introName(message.text);
    if (intro) candidateNames.add(intro);
    if (message.sender && !/^(you|me|انت|أنت|انا|أنا)$/i.test(message.sender.trim())) candidateNames.add(message.sender);
  }
  session.outboundStaffNames.forEach((name) => candidateNames.add(name));

  let staffRows: any[] = [];
  if (candidateNames.size) {
    const { data } = await supabase
      .from('staff_accounts')
      .select('id,staff_id,staff_name,name,username,role,staff_role,job_title,role_label,branch,active,is_active')
      .or('active.eq.true,is_active.eq.true')
      .limit(500);
    staffRows = data || [];
  }

  const resolvedByName = new Map<string, { row: any; score: number }>();
  for (const candidate of candidateNames) {
    const scored = staffRows
      .map((row) => ({ row, score: scoreName(candidate, row) }))
      .filter((x) => x.score >= 78)
      .sort((a, b) => b.score - a.score);
    if (scored[0] && (!scored[1] || scored[0].score > scored[1].score)) resolvedByName.set(normalize(candidate), scored[0]);
  }

  let activeStaff: { row: any; score: number } | null = null;
  const messages: WhatsAppMessageRoleV15[] = [];
  for (const message of session.messages) {
    const lexical = lexicalRole(message);
    if (lexical?.role === 'customer' || lexical?.role === 'system') {
      messages.push({ messageId: message.id, sender: message.sender, role: lexical.role, staffId: null, staffName: null, confidence: lexical.confidence, reason: lexical.reason });
      continue;
    }

    const intro = introName(message.text);
    const candidates = [intro, message.sender, ...session.outboundStaffNames].filter(Boolean) as string[];
    let resolved: { row: any; score: number } | null = null;
    for (const candidate of candidates) {
      const found = resolvedByName.get(normalize(candidate));
      if (found && (!resolved || found.score > resolved.score)) resolved = found;
    }
    if (intro && resolved) activeStaff = resolved;
    else if (!resolved && activeStaff) resolved = activeStaff;

    if (lexical?.role === 'customer_service') {
      messages.push({ messageId: message.id, sender: message.sender, role: 'customer_service', staffId: resolved?.row?.staff_id || null, staffName: resolved?.row?.staff_name || resolved?.row?.name || intro || null, confidence: Math.max(lexical.confidence, resolved?.score || 0), reason: lexical.reason });
      continue;
    }
    if (resolved) {
      const role = roleFromStaff(resolved.row);
      messages.push({ messageId: message.id, sender: message.sender, role, staffId: resolved.row.staff_id || null, staffName: resolved.row.staff_name || resolved.row.name || intro || null, confidence: Math.min(98, resolved.score), reason: `تم ربط هوية المرسل بحساب الموظف ودوره (${resolved.row.role || resolved.row.staff_role || resolved.row.job_title || 'غير محدد'}).` });
    } else {
      messages.push({ messageId: message.id, sender: message.sender, role: lexical?.role || 'pharmacy_unknown', staffId: null, staffName: intro || null, confidence: lexical?.confidence || 52, reason: lexical?.reason || 'رسالة خارجة من الصيدلية لكن هوية الموظف/دوره غير محسومة.' });
    }
  }

  const uniqueStaff = new Map<string, { staffId: string | null; staffName: string; role: WhatsAppParticipantRoleV15; confidence: number }>();
  for (const message of messages) {
    if (!message.staffName || ['customer','system'].includes(message.role)) continue;
    const key = `${message.staffId || ''}:${normalize(message.staffName)}`;
    const previous = uniqueStaff.get(key);
    if (!previous || message.confidence > previous.confidence) uniqueStaff.set(key, { staffId: message.staffId, staffName: message.staffName, role: message.role, confidence: message.confidence });
  }

  return { version: 'whatsapp-participant-role-v15', messages, staff: [...uniqueStaff.values()] };
}
