import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { ExperimentSessionSnapshot } from './types';

export function toExperimentSessionSnapshot(
  session: WhatsAppConversationSession
): ExperimentSessionSnapshot {
  return {
    sessionId: session.id,
    customerName: session.customerName,
    doctors: session.outboundStaffNames || [],
    participants: session.participants || [],
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
    messageCount: session.messages.length,
    mediaCount: session.mediaCount || 0,
    missingMediaCount: session.missingMediaCount || 0,
    messages: session.messages.map((message) => ({
      id: message.id,
      timestamp: message.timestamp.toISOString(),
      rawTimestamp: message.rawTimestamp,
      sender: message.sender,
      direction: message.direction,
      kind: message.kind,
      text: message.text,
    })),
  };
}
