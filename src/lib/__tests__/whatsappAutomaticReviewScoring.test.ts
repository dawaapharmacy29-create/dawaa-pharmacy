import { describe, expect, it } from 'vitest';
import {
  buildAutomaticWhatsAppReview,
  evaluateAutomaticWhatsAppReview,
} from '@/lib/whatsappAutomaticReviewScoring';
import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type {
  WhatsAppConversationSession,
  WhatsAppParsedMessage,
} from '@/lib/whatsappConversationParser';

function msg(
  id: string,
  at: string,
  direction: 'inbound' | 'outbound',
  text: string
): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(at),
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'عميل تجريبي' : 'You',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
    sourceFormat: 'txt',
    replyTo: null,
    mediaPlaceholder: false,
    mediaAvailable: false,
  };
}

function session(
  messages: WhatsAppParsedMessage[],
  staffNames: string[] = ['أحمد']
): WhatsAppConversationSession {
  return {
    id: 'session-1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل تجريبي', 'You'],
    outboundStaffNames: staffNames,
    customerName: 'عميل تجريبي',
    mediaCount: 0,
    missingMediaCount: 0,
    replyCount: 0,
    forwardedCount: 0,
  };
}

const normalConversation = session([
  msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج استفسار عن دواء الضغط'),
  msg(
    'm2',
    '2026-09-01T10:02:00',
    'outbound',
    'أهلًا وسهلًا بحضرتك، معاك د أحمد من خدمة عملاء صيدليات دواء'
  ),
  msg('m3', '2026-09-01T10:05:00', 'outbound', 'تحت امر حضرتك في اي وقت'),
]);

describe('buildAutomaticWhatsAppReview', () => {
  it('resolves every review criterion (no item left unresolved)', () => {
    const build = buildAutomaticWhatsAppReview(normalConversation);
    expect(build.trace).toHaveLength(REVIEW_CRITERIA.length);
    for (const criterion of REVIEW_CRITERIA) {
      expect(build.state[criterion.key]).toBeTruthy();
      expect(typeof build.state[criterion.key].choice).toBe('string');
    }
  });

  it('never sets a severe error itself, even when suspicious keywords are present', () => {
    const suspicious = session([
      msg('m1', '2026-09-01T10:00:00', 'inbound', 'يا دكتور اخدت جرعة زيادة غلط من كلامكم'),
      msg('m2', '2026-09-01T10:02:00', 'outbound', 'أهلًا وسهلًا بحضرتك'),
    ]);
    const build = buildAutomaticWhatsAppReview(suspicious);
    expect(build.severeErrors).toEqual({
      medical_error: false,
      invoice_error: false,
      delivery_error: false,
      wrong_price: false,
      promised_unavailable: false,
      request_not_registered: false,
      insult: false,
    });
    // لازم يرصد الاشتباه كتنبيه فقط، من غير ما يفعّل severeErrors
    expect(build.suspicions.some((s) => s.key === 'medical_error')).toBe(true);
  });

  it('marks signal-backed items as signal and excludes review-required criteria from automatic points', () => {
    const build = buildAutomaticWhatsAppReview(normalConversation);
    const greeting = build.trace.find((t) => t.key === 'greeting');
    const dosage = build.trace.find((t) => t.key === 'dosage_explanation');
    expect(greeting?.source).toBe('signal');
    expect(dosage?.source).toBe('signal');
    expect(build.state.tone.applies).toBe(false);
    expect(build.state.understanding.applies).toBe(false);
    expect(build.state.dosage_explanation.applies).toBe(false);
  });
});

describe('evaluateAutomaticWhatsAppReview', () => {
  it('never produces hasSevereError, regardless of conversation content', () => {
    const suspicious = session([
      msg('m1', '2026-09-01T10:00:00', 'inbound', 'كلمني بأدب، ده كلام مش لائق منكم'),
      msg('m2', '2026-09-01T10:02:00', 'outbound', 'بنعتذر لحضرتك'),
    ]);
    const { result } = evaluateAutomaticWhatsAppReview(suspicious);
    expect(result.hasSevereError).toBe(false);
  });

  it('produces a full result without awarding points to review-required criteria', () => {
    const { build, result } = evaluateAutomaticWhatsAppReview(normalConversation);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(100);
    expect(result.reviewItems).toHaveLength(REVIEW_CRITERIA.length);
    expect(build.state.tone.applies).toBe(false);
    expect(build.state.understanding.applies).toBe(false);
    const tone = result.reviewItems.find((item) => item.key === 'tone');
    const understanding = result.reviewItems.find((item) => item.key === 'understanding');
    expect(tone?.applies).toBe(false);
    expect(understanding?.applies).toBe(false);
  });
});
