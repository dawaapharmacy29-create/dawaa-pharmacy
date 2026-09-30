import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { evaluateResponseSpeedV32 } from '@/lib/whatsappResponseSpeedEvidenceV32';

function understandingOf(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

describe('ResponseSpeedEvidenceV32 (Shadow Mode — Golden Cases)', () => {
  it('scores within_5 (10/10) for a reply under 5 minutes', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:03:00 AM] You: متوفر بسعر 250 جنيه`;
    const understanding = understandingOf(raw);
    const result = evaluateResponseSpeedV32({ understanding });
    expect(result.applicable).toBe(true);
    expect(result.scoreBand).toBe('within_5');
    expect(result.pointsEarned).toBe(10);
    expect(result.needsHumanReview).toBe(false);
    expect(result.positiveEvidenceMessageIds.length).toBe(2);
  });

  it('scores over_20 (0/10) for a delayed reply', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:25:00 AM] You: آسفين على التأخير، متوفر بسعر 250 جنيه`;
    const understanding = understandingOf(raw);
    const result = evaluateResponseSpeedV32({ understanding });
    expect(result.scoreBand).toBe('over_20');
    expect(result.pointsEarned).toBe(0);
  });

  it('does not count an automatic out-of-hours reply as the real first response', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:00:15 AM] You: رسالة تلقائية: نحن خارج مواعيد العمل الرسمية نرد عليك أول الدوام
[9/15/26, 9:04:00 AM] You: صباح النور، متوفر بسعر 250 جنيه`;
    const understanding = understandingOf(raw);
    const result = evaluateResponseSpeedV32({ understanding });
    expect(result.scoreBand).toBe('within_5');
    expect(result.pointsEarned).toBe(10);
    const finding = result.findings[0];
    expect(finding.evidenceMessageIds.some((id) => understanding.byId.get(id)?.text.includes('صباح النور'))).toBe(true);
  });

  it('evaluates response speed per-interaction so a reply in a different topic is never credited across the gap', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام هطلبه
[9/15/26, 9:50:00 AM] Customer: بالمناسبة عندكم شامبو للشعر؟
[9/15/26, 9:58:00 AM] You: أيوه متوفر`;
    const understanding = understandingOf(raw);
    expect(understanding.interactions.length).toBe(2);
    const secondInteractionResult = evaluateResponseSpeedV32({
      understanding,
      interaction: understanding.interactions[1],
    });
    // trigger 9:50 -> reply 9:58 = 8 minutes = five_to_10 band, never mixed with the first interaction's fast reply.
    expect(secondInteractionResult.scoreBand).toBe('five_to_10');
    expect(secondInteractionResult.pointsEarned).toBe(5);
  });

  it('flags missing evidence for human review when the customer never gets a staff reply', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] Customer: في حد موجود؟`;
    const understanding = understandingOf(raw);
    const result = evaluateResponseSpeedV32({ understanding });
    expect(result.applicable).toBe(true);
    expect(result.scoreBand).toBeNull();
    expect(result.pointsEarned).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.humanReviewReasons).toContain('no_staff_reply_found');
  });

  it('V32.2: times a 3-message customer request burst from the earliest substantive message, not the greeting or the last message', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: مساء الخير
[9/15/26, 9:00:20 AM] Customer: عايز اسأل عن دواء
[9/15/26, 9:00:40 AM] Customer: ترايليبتال 600
[9/15/26, 9:03:00 AM] You: متوفر بسعر 90 جنيه`;
    const understanding = understandingOf(raw);
    const burstMessages = understanding.messages.filter((m) => m.requestBurstId);
    expect(burstMessages.length).toBe(3);
    expect(new Set(burstMessages.map((m) => m.requestBurstId)).size).toBe(1);

    const result = evaluateResponseSpeedV32({ understanding });
    // Trigger is "عايز اسأل عن دواء" (9:00:20), not "مساء الخير" (9:00:00) and not "ترايليبتال 600"
    // (9:00:40). Reply at 9:03:00 -> 160s from the real trigger -> still within_5.
    expect(result.findings[0].fact).toContain('عايز اسأل عن دواء');
    expect(result.findings[0].fact).not.toContain('"مساء الخير"');
    expect(result.scoreBand).toBe('within_5');
    expect(result.pointsEarned).toBe(10);
  });
});
