import { describe, expect, it } from 'vitest';
import { buildWhatsAppCustomerCaseEngineV22 } from '@/lib/whatsappCustomerCaseEngineV22';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string, kind: WhatsAppParsedMessage['kind'] = 'text', mediaAvailable = false): WhatsAppParsedMessage {
  const timestamp = new Date(at);
  return {
    id,
    timestamp,
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'عميل' : 'You',
    text,
    direction,
    kind,
    forwarded: false,
    raw: text,
    sourceFormat: 'txt',
    replyTo: null,
    mediaPlaceholder: kind !== 'text',
    mediaAvailable,
  };
}

function session(id: string, messages: WhatsAppParsedMessage[], staffNames: string[] = []): WhatsAppConversationSession {
  return {
    id,
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل', 'You'],
    outboundStaffNames: staffNames,
    customerName: 'عميل',
    mediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).length,
    missingMediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind) && !m.mediaAvailable).length,
    replyCount: 0,
    forwardedCount: 0,
  };
}

describe('WhatsAppCustomerCaseEngineV22', () => {
  it('keeps failed order + feedback + apology in one recovery case', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-09-01T10:00:00', 'inbound', 'عاوز الطلب ده لو سمحت'),
        msg('m2', '2026-09-01T11:00:00', 'outbound', 'حاضر يا فندم'),
        msg('m3', '2026-09-01T14:00:00', 'inbound', 'الاوردر ماوصلش واتضايقت من التأخير'),
      ], ['د مي']),
      session('s2', [
        msg('m4', '2026-09-02T12:00:00', 'outbound', 'حابين نعرف كانت الخدمة على مستوى رضا حضرتك؟'),
      ], ['هبه']),
      session('s3', [
        msg('m5', '2026-09-03T12:00:00', 'outbound', 'بنعتذر لحضرتك عن التأخير وان الطلب ماوصلش'),
      ], ['هبة']),
    ];

    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(1);
    expect(result.cases[0].state).toBe('recovery');
    expect(result.cases[0].sessionIds).toEqual(['s1', 's2', 's3']);
    expect(result.cases[0].recoveryAttempts).toBeGreaterThanOrEqual(2);
  });

  it('starts a new case when the customer returns later with a new order', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-08-01T10:00:00', 'inbound', 'عاوز الطلب'),
        msg('m2', '2026-08-01T14:00:00', 'inbound', 'الطلب ماوصلش'),
      ]),
      session('s2', [
        msg('m3', '2026-08-02T10:00:00', 'outbound', 'بنعتذر لحضرتك وهنعمل متابعة'),
      ]),
      session('s3', [
        msg('m4', '2026-08-25T10:00:00', 'inbound', 'محتاج اوردر جديد'),
        msg('m5', '2026-08-25T10:10:00', 'outbound', 'تم تأكيد الطلب وجاري الإرسال'),
      ]),
    ];

    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(2);
    expect(result.cases[0].state).toBe('recovery');
    expect(result.cases[1].state).toBe('confirmed_order');
  });

  it('tracks missing media without pretending the content was understood', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-09-01T10:00:00', 'inbound', 'دي موجودة؟'),
        msg('m2', '2026-09-01T10:01:00', 'inbound', '<image omitted>', 'image', false),
        msg('m3', '2026-09-01T10:03:00', 'outbound', 'هراجع لحضرتك'),
      ]),
    ];
    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.mediaReferenced).toBe(1);
    expect(result.mediaAvailable).toBe(0);
    expect(result.mediaMissing).toBe(1);
    expect(result.mediaCoveragePercent).toBe(0);
    expect(result.cases[0].needsHumanReview).toBe(true);
    expect(result.analysisCoverageLabel).toContain('لا يتم تخمين');
  });

  it('normalizes spelling variants of the same short doctor name inside a case', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج صنف'),
        msg('m2', '2026-09-01T10:05:00', 'outbound', 'متاح'),
      ], ['د مي']),
      session('s2', [
        msg('m3', '2026-09-01T18:00:00', 'outbound', 'حابين نطمن على الطلب'),
      ], ['د مى']),
    ];
    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(1);
    expect(result.cases[0].staffNames).toHaveLength(1);
  });
});
