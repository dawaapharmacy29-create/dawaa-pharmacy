import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import type { NormalizedConversationMessageV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { buildConversationEntityGraphV2 } from '../conversationEntityGraphV2';
import type { BuildGraphOptions } from '../conversationEntityGraphV2';
import { reconstructBasketV2 } from '../basketReconstructionV2';
import type { BasketReconstructionResultV2 } from '../basketV2Types';

export function messagesFrom(raw: string, trustedConversationStartedAt?: string | Date | null): NormalizedConversationMessageV32[] {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw, { trustedConversationStartedAt }), 120);
  if (sessions.length === 0) throw new Error('no session parsed from fixture');
  return buildConversationUnderstandingV32(sessions[0]).messages;
}

export function buildBasketFromConversation(raw: string, caseId = 'case-1', options: BuildGraphOptions = {}): BasketReconstructionResultV2 {
  const messages = messagesFrom(raw);
  const graph = buildConversationEntityGraphV2(caseId, messages, options);
  const timestamps = new Map(messages.map((m) => [m.id, m.timestamp.toISOString()] as const));
  return reconstructBasketV2(graph, timestamps);
}
