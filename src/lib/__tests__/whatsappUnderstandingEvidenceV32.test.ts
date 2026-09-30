import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { evaluateUnderstandingV32 } from '@/lib/whatsappUnderstandingEvidenceV32';

function understandingOf(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

describe('UnderstandingEvidenceV32 (Shadow Mode — Golden Cases)', () => {
  it('scores strong when the request is clear and the staff reply addresses it directly', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 5000 وحدة
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.applicable).toBe(true);
    expect(result.scoreBand).toBe('strong');
    expect(result.pointsEarned).toBe(10);
    expect(result.needsHumanReview).toBe(false);
  });

  it('scores adequate when the request is vague and the staff asks a real clarifying question first', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز حاجة
[9/15/26, 9:01:00 AM] You: تحت أمرك، حضرتك عايز حاجة لإيه بالظبط؟
[9/15/26, 9:02:00 AM] Customer: للصداع
[9/15/26, 9:03:00 AM] You: متوفر بسعر 40 جنيه`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('adequate');
    expect(result.pointsEarned).toBe(7);
    const clarificationFinding = result.findings.find((f) => f.key === 'clarification_asked');
    expect(clarificationFinding?.status).toBe('proven');
  });

  it('scores wrong when the customer explicitly corrects a mistaken assumption', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز كريم للبشرة الدهنية
[9/15/26, 9:01:00 AM] You: متوفر كريم للبشرة الجافة بسعر 150 جنيه
[9/15/26, 9:02:00 AM] Customer: لا، ده مش اللي طلبته`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('wrong');
    expect(result.pointsEarned).toBe(0);
    const correction = result.findings.find((f) => f.key === 'customer_correction');
    expect(correction?.status).toBe('contradicted');
    expect(result.contradictionMessageIds.length).toBe(1);
  });

  it('scores weak when the staff assumes and offers without clarifying a vague request', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز حاجة
[9/15/26, 9:01:00 AM] You: متوفر بسعر 200 جنيه`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('weak');
    expect(result.pointsEarned).toBe(2);
  });

  it('reports unknown (not a guessed score) when the evidence cannot support a judgment', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز حاجة
[9/15/26, 9:01:00 AM] You: تمام، لحظة`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBeNull();
    expect(result.pointsEarned).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.humanReviewReasons).toContain('insufficient_understanding_signals');
  });
});
