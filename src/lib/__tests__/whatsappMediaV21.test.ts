import { describe, expect, it, vi } from 'vitest';
import { attachWhatsAppMediaToMessagesV21 } from '@/lib/whatsappMediaV21';
import type { WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import type { WhatsAppExportMediaFile } from '@/lib/whatsappExportFileReader';

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

function message(id: string, text: string, kind: WhatsAppParsedMessage['kind'] = 'image'): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date('2026-09-15T18:00:00.000Z'),
    rawTimestamp: '9/15/26, 9:00 PM',
    sender: 'Customer',
    text,
    direction: 'inbound',
    kind,
    forwarded: false,
    raw: text,
    sourceFormat: 'txt',
    replyTo: null,
    mediaPlaceholder: true,
    mediaAvailable: false,
  };
}

function media(archiveName: string, kind: WhatsAppExportMediaFile['kind'] = 'image'): WhatsAppExportMediaFile {
  return {
    archiveName,
    fileName: archiveName.split('/').at(-1) || archiveName,
    mimeType: kind === 'voice' ? 'audio/ogg' : 'image/jpeg',
    kind,
    byteSize: 3,
    bytes: new Uint8Array([1, 2, 3]),
  };
}

describe('attachWhatsAppMediaToMessagesV21', () => {
  it('uses exact filename evidence before any ordered fallback', () => {
    const result = attachWhatsAppMediaToMessagesV21(
      [
        message('m1', '<attached: IMG-20260915-WA0007.jpg>'),
        message('m2', '<image omitted>'),
      ],
      [
        media('IMG-20260915-WA0007.jpg'),
        media('IMG-20260915-WA0008.jpg'),
      ]
    );

    expect(result.messages[0].mediaFileName).toBe('IMG-20260915-WA0007.jpg');
    expect(result.messages[0].mediaMatchConfidence).toBe(99);
    expect(result.summary.exactMatches).toBe(1);
    expect(result.messages[1].mediaFileName).toBe('IMG-20260915-WA0008.jpg');
    expect(result.messages[1].mediaMatchConfidence).toBe(60);
    expect(result.summary.orderedMatches).toBe(1);
  });

  it('does not guess when unmatched file/message counts differ', () => {
    const result = attachWhatsAppMediaToMessagesV21(
      [message('m1', '<image omitted>')],
      [media('a.jpg'), media('b.jpg')]
    );

    expect(result.messages[0].mediaAvailable).toBe(false);
    expect(result.messages[0].mediaFileName).toBeUndefined();
    expect(result.summary.orderedMatches).toBe(0);
    expect(result.summary.unmatchedFiles).toBe(2);
    expect(result.summary.unmatchedMessages).toBe(1);
  });

  it('preserves media kind when linking a voice attachment', () => {
    const result = attachWhatsAppMediaToMessagesV21(
      [message('m1', '<attached: PTT-20260915-WA0001.ogg>', 'voice')],
      [media('PTT-20260915-WA0001.ogg', 'voice')]
    );

    expect(result.messages[0].kind).toBe('voice');
    expect(result.messages[0].mediaAvailable).toBe(true);
    expect(result.messages[0].mediaMimeType).toBe('audio/ogg');
  });
});
