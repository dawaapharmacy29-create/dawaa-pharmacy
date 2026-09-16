import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15, WhatsAppMessageRoleV15 } from './whatsappParticipantRoleResolverV15';

export interface OrderLifecycleSyncContextV19 {
  sourceId: string;
  contextOnly?: boolean;
  participantRoles?: WhatsAppParticipantRoleModelV15 | null;
}

type LifecycleFact = 'delay_notice' | 'customer_accepted_delay' | 'promise_made' | 'promise_breach_signal' | 'staff_handoff' | 'delivery_blocker' | 'recovery_offer' | 'case_continuity_break';

const DELAY_NOTICE_RX = /(ممكن\s*يتاخر|ممكن\s*يتأخر|هيتأخر|هنتأخر|هتاخر|هتأخر|تأخير\s*(?:بسيط|شويه|شوية)|تاخير\s*(?:بسيط|شويه|شوية)|ممكن\s*ياخد\s*وقت)/i;
const DELAY_ACCEPT_RX = /(مفيش\s*مشكله|مفيش\s*مشكلة|ولا\s*يهمك|ولا\s*يهم حضرتك|تمام|ماشي|حاضر|اوكي|أوكي)/i;
const PROMISE_RX = /(هبعت|هنبعت|هجيب|هنجيب|هطلب\s*مندوب|هتواصل|هنتواصل|هنوفر|هتابع|هنتابع|هبلغ|هنبلغ|هخلي\s*المندوب|جاري\s*(?:الارسال|الإرسال))/i;
const DELIVERY_BLOCKER_RX = /(المندوب.*(?:بعيد|ظرف|مجاش|ماجاش|مش متاح|مش موجود)|مستني\s*مندوب|مندوب\s*من\s*الفرع\s*التاني|اوردر\s*بعيد|أوردر\s*بعيد)/i;
const APOLOGY_OR_FAILURE_RX = /(متاسف|متأسف|بنعتذر|نعتذر|التاخير الكبير|التأخير الكبير|ماوصلش|موصلش|مجاش|ماجاش)/i;
const RECOVERY_OFFER_RX = /(لو.*(?:نبعت|نبعتلك|نبعت لحضرتك)|نعوض|نقدر\s*نعوض|بنتابع\s*مع\s*الفريق|في\s*اسرع\s*وقت|في\s*أسرع\s*وقت)/i;
const GREETING_INTRO_RX = /(اهلًا|أهلًا|السلام عليكم|مع حضرتك\s+(?:د|دكتور|دكتوره|دكتورة|نور|هبه|هبة|هاجر))/i;
const CONTEXT_REFERENCE_RX = /(التاخير|التأخير|طلب حضرتك|الاوردر|الأوردر|المشكله|المشكلة|بنعتذر|متاسف|متأسف|بخصوص)/i;

function roleByMessage(model?: WhatsAppParticipantRoleModelV15 | null) {
  return new Map((model?.messages || []).map((row) => [row.messageId, row]));
}

function nextInboundAfter(session: WhatsAppConversationSession, message: WhatsAppParsedMessage) {
  const index = session.messages.findIndex((m) => m.id === message.id);
  if (index < 0) return null;
  for (let i = index + 1; i < session.messages.length; i += 1) {
    const candidate = session.messages[i];
    if (candidate.direction === 'system') continue;
    if (candidate.direction === 'outbound') continue;
    return candidate;
  }
  return null;
}

function evidence(message: WhatsAppParsedMessage, role?: WhatsAppMessageRoleV15 | null, extra: Record<string, unknown> = {}) {
  return {
    messageId: message.id,
    quote: message.text?.slice(0, 260) || '',
    sender: message.sender,
    role: role?.role || null,
    resolvedStaffId: role?.staffId || null,
    resolvedStaffName: role?.staffName || null,
    roleConfidence: role?.confidence || null,
    ...extra,
  };
}

export async function syncWhatsAppOrderLifecycleV19(session: WhatsAppConversationSession, context: OrderLifecycleSyncContextV19) {
  const { data: source, error: sourceError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,branch,customer_id,customer_code,customer_name,customer_phone,staff_id,staff_name,conversation_started_at,analysis_version')
    .eq('id', context.sourceId)
    .single();
  if (sourceError) throw sourceError;

  const roles = roleByMessage(context.participantRoles);
  const facts: any[] = [];
  const add = (type: LifecycleFact, key: string, message: WhatsAppParsedMessage, confidence: number, extraEvidence: Record<string, unknown> = {}) => {
    const r = roles.get(message.id);
    facts.push({
      source_id: context.sourceId,
      fact_key: key,
      fact_type: type,
      fact_at: message.timestamp.toISOString(),
      branch: source.branch || null,
      customer_id: source.customer_id || null,
      customer_code: source.customer_code || null,
      customer_name: source.customer_name || null,
      customer_phone: source.customer_phone || null,
      staff_id: r?.staffId || source.staff_id || null,
      staff_name: r?.staffName || source.staff_name || null,
      staff_role: r?.role || null,
      confidence,
      evidence_kind: 'message',
      evidence_json: evidence(message, r, extraEvidence),
      analysis_version: source.analysis_version || 'whatsapp-order-lifecycle-v19',
      review_state: 'proposed',
      official_eligible: false,
      updated_at: new Date().toISOString(),
    });
  };

  const promises: WhatsAppParsedMessage[] = [];
  const blockers: WhatsAppParsedMessage[] = [];
  const distinctStaff: Array<{ message: WhatsAppParsedMessage; role: WhatsAppMessageRoleV15 }> = [];

  for (const message of session.messages) {
    if (message.direction !== 'outbound') continue;
    const r = roles.get(message.id);
    if (PROMISE_RX.test(message.text)) {
      promises.push(message);
      add('promise_made', `promise:${message.id}`, message, 86);
    }
    if (DELAY_NOTICE_RX.test(message.text)) {
      add('delay_notice', `delay-notice:${message.id}`, message, 94);
      const reply = nextInboundAfter(session, message);
      if (reply && DELAY_ACCEPT_RX.test(reply.text) && (reply.timestamp.getTime() - message.timestamp.getTime()) <= 30 * 60 * 1000) {
        const replyRole = roles.get(reply.id);
        facts.push({
          source_id: context.sourceId,
          fact_key: `delay-accepted:${message.id}:${reply.id}`,
          fact_type: 'customer_accepted_delay',
          fact_at: reply.timestamp.toISOString(),
          branch: source.branch || null,
          customer_id: source.customer_id || null,
          customer_code: source.customer_code || null,
          customer_name: source.customer_name || null,
          customer_phone: source.customer_phone || null,
          staff_id: r?.staffId || source.staff_id || null,
          staff_name: r?.staffName || source.staff_name || null,
          staff_role: r?.role || null,
          confidence: 92,
          evidence_kind: 'message',
          evidence_json: { delayNotice: evidence(message, r), customerReply: evidence(reply, replyRole), relation: 'next inbound reply within 30 minutes' },
          analysis_version: source.analysis_version || 'whatsapp-order-lifecycle-v19',
          review_state: 'proposed', official_eligible: false, updated_at: new Date().toISOString(),
        });
      }
    }
    if (DELIVERY_BLOCKER_RX.test(message.text)) {
      blockers.push(message);
      add('delivery_blocker', `delivery-blocker:${message.id}`, message, 91);
    }
    if (APOLOGY_OR_FAILURE_RX.test(message.text) && RECOVERY_OFFER_RX.test(message.text)) add('recovery_offer', `recovery-offer:${message.id}`, message, 91);
    else if (RECOVERY_OFFER_RX.test(message.text)) add('recovery_offer', `recovery-offer:${message.id}`, message, 82);

    if (r?.staffName && !['customer','system','pharmacy_unknown'].includes(r.role)) {
      const previous = distinctStaff.at(-1);
      if (!previous || previous.role.staffId !== r.staffId || previous.role.staffName !== r.staffName) distinctStaff.push({ message, role: r });
    }
  }

  for (let i = 1; i < distinctStaff.length; i += 1) {
    const previous = distinctStaff[i - 1];
    const current = distinctStaff[i];
    add('staff_handoff', `handoff:${previous.message.id}:${current.message.id}`, current.message, Math.min(previous.role.confidence, current.role.confidence, 96), {
      from: { staffId: previous.role.staffId, staffName: previous.role.staffName, role: previous.role.role, messageId: previous.message.id },
      to: { staffId: current.role.staffId, staffName: current.role.staffName, role: current.role.role, messageId: current.message.id },
    });
  }

  const firstPromise = promises[0];
  const laterFailure = session.messages.find((m) => firstPromise && m.timestamp > firstPromise.timestamp && m.direction === 'outbound' && APOLOGY_OR_FAILURE_RX.test(m.text));
  if (firstPromise && laterFailure) {
    add('promise_breach_signal', `promise-breach:${firstPromise.id}:${laterFailure.id}`, laterFailure, 84, {
      originalPromise: { messageId: firstPromise.id, quote: firstPromise.text.slice(0, 220), at: firstPromise.timestamp.toISOString() },
      laterFailureSignal: { messageId: laterFailure.id, quote: laterFailure.text.slice(0, 220), at: laterFailure.timestamp.toISOString() },
      note: 'إشارة لتعثر وعد تشغيلي وليست إدانة تلقائية للموظف؛ تحديد المسؤولية يحتاج مراجعة بشرية لمسار التنفيذ.',
    });
  }

  if ((blockers.length || laterFailure) && distinctStaff.length > 1) {
    for (let i = 1; i < distinctStaff.length; i += 1) {
      const current = distinctStaff[i];
      if (GREETING_INTRO_RX.test(current.message.text) && !CONTEXT_REFERENCE_RX.test(current.message.text)) {
        const customerRepliedBetween = session.messages.some((m) => m.direction === 'inbound' && m.timestamp > distinctStaff[i - 1].message.timestamp && m.timestamp < current.message.timestamp);
        if (!customerRepliedBetween) add('case_continuity_break', `continuity:${current.message.id}`, current.message, 66, {
          note: 'بداية/تعريف جديد بعد تعثر سابق دون إشارة واضحة للسياق، والعميل لم يرسل ردًا جديدًا بينهما. تحتاج مراجعة بشرية قبل نسب خطأ.',
        });
      }
    }
  }

  if (facts.length) {
    const { error } = await supabase.from('whatsapp_evidence_facts_v17').upsert(facts, { onConflict: 'source_id,fact_key', ignoreDuplicates: false });
    if (error) throw error;
  }
  return { facts: facts.length };
}
