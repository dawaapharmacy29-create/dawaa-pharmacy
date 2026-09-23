import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import type { NormalizedConversationMessageV32 } from '@/lib/whatsappConversationUnderstandingV32';

/** Parses a bracketed WhatsApp export string into scoped, chronological messages for one case. */
export function messagesFrom(raw: string): NormalizedConversationMessageV32[] {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  if (sessions.length === 0) throw new Error('no session parsed from fixture');
  return buildConversationUnderstandingV32(sessions[0]).messages;
}

export function findByText(messages: NormalizedConversationMessageV32[], needle: string): NormalizedConversationMessageV32 {
  const found = messages.find((m) => m.text.includes(needle));
  if (!found) throw new Error(`no message found containing "${needle}"`);
  return found;
}
