import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';

function understandingFor(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

describe('ConversationCase Engine (Sales Intelligence Phase B.1) — Golden Cases', () => {
  it('1. a simple single-request case is classified sales_opportunity/basket_building with strong confidence', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 2 علبة
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه`;
    const understanding = understandingFor(raw);
    const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
    expect(cases.length).toBe(1);
    expect(cases[0].caseType).toBe('sales_opportunity');
    expect(cases[0].status).toBe('basket_building');
    expect(cases[0].confidence.level).toBe('strongly_inferred');
    expect(cases[0].needsHumanReview).toBe(false);
  });

  it('2. two requests separated by a time gap become two independent cases', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام هطلبه
[9/15/26, 9:50:00 AM] Customer: عندكم شامبو للشعر؟
[9/15/26, 9:51:00 AM] You: أيوه متوفر`;
    const understanding = understandingFor(raw);
    const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
    expect(cases.length).toBe(2);
    expect(cases[0].caseId).not.toBe(cases[1].caseId);
  });

  it('3. a topic-shift marker splits a case even without a time gap', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام هطلبه
[9/15/26, 9:03:00 AM] Customer: بالمناسبة عندكم شامبو للشعر؟
[9/15/26, 9:04:00 AM] You: أيوه متوفر`;
    const understanding = understandingFor(raw);
    const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
    expect(cases.length).toBe(2);
  });

  it('4. a pure thanks/closing exchange is information_only; a later unrelated request is its own sales_opportunity case', () => {
    const raw = `[9/15/26, 9:00:00 AM] You: مساء الخير، حابين نطمن على مستوى الخدمة
[9/15/26, 9:01:00 AM] Customer: شكرا لحضرتك
[9/15/26, 9:50:00 AM] Customer: عايز فيتامين سي
[9/15/26, 9:51:00 AM] You: متوفر بسعر 90 جنيه`;
    const understanding = understandingFor(raw);
    const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
    expect(cases.length).toBe(2);
    expect(cases[0].caseType).toBe('information_only');
    expect(cases[0].confidence.level).toBe('proven');
    expect(cases[1].caseType).toBe('sales_opportunity');
    expect(cases[1].status).toBe('basket_building');
  });

  it('5. two distinct customer requests with no staff reply between them are flagged for human review, not silently merged', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:00:30 AM] Customer: وعايز كمان شامبو للشعر`;
    const understanding = understandingFor(raw);
    const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
    expect(cases.length).toBe(1);
    expect(cases[0].needsHumanReview).toBe(true);
    expect(cases[0].humanReviewReasons).toContain('possible_unsegmented_multiple_requests');
    expect(cases[0].confidence.level).toBe('weakly_inferred');
  });
});
