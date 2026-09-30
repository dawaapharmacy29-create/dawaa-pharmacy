import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from './whatsappParticipantRoleResolverV15';

export interface WhatsAppResponseTurnSyncContextV18 {
  sourceId: string;
  contextOnly?: boolean;
  participantRoles?: WhatsAppParticipantRoleModelV15 | null;
}

function roleMap(model?: WhatsAppParticipantRoleModelV15 | null) {
  return new Map((model?.messages || []).map((row) => [row.messageId, row]));
}

const DELETED_MESSAGE_RX = /(you deleted this message|this message was deleted|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة)/i;

function nonSystem(messages: WhatsAppParsedMessage[]) {
  return messages.filter(
    (m) =>
      m.direction !== 'system' &&
      m.kind !== 'system' &&
      !DELETED_MESSAGE_RX.test(String(m.text || ''))
  );
}

export function buildWhatsAppResponseTurnsV18(session: WhatsAppConversationSession, participantRoles?: WhatsAppParticipantRoleModelV15 | null) {
  const messages = nonSystem(session.messages).slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const roles = roleMap(participantRoles);
  const turns: any[] = [];
  let inbound: WhatsAppParsedMessage[] = [];

  const flush = (response: WhatsAppParsedMessage | null) => {
    if (!inbound.length) return;
    const started = inbound[0].timestamp;
    const ended = inbound[inbound.length - 1].timestamp;
    const role = response ? roles.get(response.id) : null;
    const latency = response ? Math.max(0, Math.round((response.timestamp.getTime() - ended.getTime()) / 1000)) : null;
    turns.push({
      turnKey: `inbound:${inbound[0].id}`,
      inboundStartedAt: started.toISOString(),
      inboundEndedAt: ended.toISOString(),
      inboundMessageIds: inbound.map((m) => m.id),
      inboundMessageCount: inbound.length,
      responseAt: response?.timestamp?.toISOString() || null,
      responseMessageId: response?.id || null,
      responseLatencySeconds: latency,
      noResponse: !response,
      responderSender: response?.sender || null,
      responderRole: role?.role || (response ? 'pharmacy_unknown' : null),
      responderAccountId: role?.accountId || null,
      responderStaffCode: role?.staffId || null,
      responderStaffName: role?.staffName || null,
      evidence: {
        customerLastMessage: inbound[inbound.length - 1].text?.slice(0, 220) || '',
        responseText: response?.text?.slice(0, 220) || null,
        responderConfidence: role?.confidence || null,
        responderReason: role?.reason || null,
        responderStaffCode: role?.staffId || null,
      },
    });
    inbound = [];
  };

  for (const message of messages) {
    if (message.direction === 'inbound') { inbound.push(message); continue; }
    if (message.direction === 'outbound' && inbound.length) flush(message);
  }
  flush(null);
  return turns;
}

export async function syncWhatsAppResponseTurnsV18(session: WhatsAppConversationSession, context: WhatsAppResponseTurnSyncContextV18) {
  const turns = buildWhatsAppResponseTurnsV18(session, context.participantRoles);
  if (!turns.length) return { turns: 0 };

  const { data: source, error: sourceError } = await supabase.from('whatsapp_review_sources').select('branch,customer_id,customer_code,staff_id,staff_name').eq('id', context.sourceId).single();
  if (sourceError) throw sourceError;

  const rows = turns.map((turn) => ({
    source_id: context.sourceId,
    turn_key: turn.turnKey,
    branch: source.branch || null,
    customer_id: source.customer_id || null,
    customer_code: source.customer_code || null,
    staff_id: turn.responderAccountId || source.staff_id || null,
    staff_name: turn.responderStaffName || source.staff_name || null,
    responder_sender: turn.responderSender,
    responder_role: turn.responderRole,
    inbound_started_at: turn.inboundStartedAt,
    inbound_ended_at: turn.inboundEndedAt,
    response_at: turn.responseAt,
    response_latency_seconds: turn.responseLatencySeconds,
    inbound_message_count: turn.inboundMessageCount,
    response_message_id: turn.responseMessageId,
    inbound_message_ids: turn.inboundMessageIds,
    evidence_json: turn.evidence,
    no_response: turn.noResponse,
    context_only: Boolean(context.contextOnly),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('whatsapp_response_turns_v18').upsert(rows, { onConflict: 'source_id,turn_key', ignoreDuplicates: false });
  if (error) throw error;
  return { turns: rows.length };
}
