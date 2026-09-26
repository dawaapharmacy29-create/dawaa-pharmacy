import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { evaluateUnderstandingV32 } from '@/lib/whatsappUnderstandingEvidenceV32';

// V32.2 Golden Dataset Expansion — Egyptian colloquial semantics. Each case below was dry-run
// against the actual implementation before being locked in as an assertion (never guessed),
// per this phase's "analyze before you regex" and "test evidence, not just score" requirements.

function understandingOf(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

describe('UnderstandingEvidenceV32.2 — Golden Dataset Expansion', () => {
  it('never auto-succeeds understanding on a bare "حاضر" with no other content (generic acknowledgement)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز اوجمنتين 1جم
[9/15/26, 9:01:00 AM] You: حاضر`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBeNull();
    expect(result.pointsEarned).toBeNull();
    expect(result.needsHumanReview).toBe(true);
  });

  it('never auto-succeeds understanding on a bare "تمام" with no other content', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز اوجمنتين 1جم
[9/15/26, 9:01:00 AM] You: تمام`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBeNull();
    expect(result.needsHumanReview).toBe(true);
  });

  it('resolves a short pronoun reference ("هات منه") to the single prior staff offer and scores it as a clear request', () => {
    const raw = `[9/15/26, 9:00:00 AM] You: عندنا سيروم فيتامين سي
[9/15/26, 9:01:00 AM] Customer: هات منه
[9/15/26, 9:02:00 AM] You: من عنيا, هبعتلك واحدة بسعر 60 جنيه`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('strong');
    expect(result.pointsEarned).toBe(10);
  });

  it('reports unknown rather than guessing when a pronoun reference is ambiguous between two recent offers', () => {
    const raw = `[9/15/26, 9:00:00 AM] You: عندنا سيروم فيتامين سي
[9/15/26, 9:00:30 AM] You: وعندنا كمان كريم للتصبغات
[9/15/26, 9:01:00 AM] Customer: هات منه`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    const needClarity = result.findings.find((f) => f.key === 'need_clarity');
    expect(needClarity?.status).toBe('unknown');
  });

  it('scores strong when the staff rephrases the request back as a confirming question ("تقصد...؟")', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: محتاج حاجة للصداع
[9/15/26, 9:01:00 AM] You: تقصد حاجة تسكن الصداع بسرعة؟`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('strong');
  });

  it('scores strong for a clear request answered with a colloquial fulfillment promise, without needing a literal re-confirmation phrase', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين سي 1000 مجم
[9/15/26, 9:01:00 AM] You: تمام هبعتلك النهارده`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('strong');
  });

  it('records a location-only clarification question as irrelevant evidence, distinct from a relevant one', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز حاجة للكحة لطفلي
[9/15/26, 9:01:00 AM] You: حضرتك منين؟`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const clarification = result.findings.find((f) => f.key === 'clarification_asked');
    expect(clarification?.interpretation).toContain('irrelevant');
  });

  it('records a symptom-detail clarification question as relevant/partially_relevant evidence, not irrelevant', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز حاجة للكحة لطفلي
[9/15/26, 9:01:00 AM] You: سن الطفل كام؟ والكحة ناشفة ولا ببلغم؟`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const clarification = result.findings.find((f) => f.key === 'clarification_asked');
    expect(clarification?.interpretation).toContain('partially_relevant');
  });

  it('links a customer correction to the most recent staff message being corrected, not the first one in the conversation', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز باراسيتامول
[9/15/26, 9:01:00 AM] You: متوفر بسعر 20 جنيه
[9/15/26, 9:02:00 AM] Customer: بس ممكن سؤال
[9/15/26, 9:03:00 AM] You: تمام, عندنا فيفادول بسعر 25 جنيه
[9/15/26, 9:04:00 AM] Customer: مش ده اللي طلبته`;
    const understanding = understandingOf(raw);
    const result = evaluateUnderstandingV32({ understanding });
    expect(result.scoreBand).toBe('wrong');
    const correctionFinding = result.findings.find((f) => f.key === 'customer_correction');
    const correctedId = correctionFinding?.evidenceMessageIds[0];
    const correctedMessage = understanding.byId.get(correctedId || '');
    expect(correctedMessage?.text).toContain('فيفادول');
  });

  it('marks resolutionAfterCorrection as resolved when the staff sends a follow-up message after the correction', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز باراسيتامول
[9/15/26, 9:01:00 AM] You: متوفر بسعر 20 جنيه
[9/15/26, 9:02:00 AM] Customer: مش ده اللي طلبته
[9/15/26, 9:03:00 AM] You: آسف, تقصد حاجة تانية؟`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const correction = result.findings.find((f) => f.key === 'customer_correction');
    expect(correction?.interpretation).toContain('أرسل الموظف رسالة أخرى');
  });

  it('marks resolutionAfterCorrection as unresolved when the conversation ends right after the correction', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز باراسيتامول
[9/15/26, 9:01:00 AM] You: متوفر بسعر 20 جنيه
[9/15/26, 9:02:00 AM] Customer: مش ده اللي طلبته`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const correction = result.findings.find((f) => f.key === 'customer_correction');
    expect(correction?.interpretation).toContain('لم يُعثر على رد من الموظف بعد التصحيح');
  });

  it('keeps the minimal evidence set small (primaryMessageIds) for a direct clear request rather than dumping the whole scope', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين سي 1000 مجم
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.primaryMessageIds.length).toBeLessThanOrEqual(2);
  });

  // V32.2.1 hardening: a bare acknowledgement after a correction is never itself proof of resolution.
  it('V32.2.1: a bare "تمام" after a correction is NOT resolutionAfterCorrection=resolved', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز باراسيتامول
[9/15/26, 9:01:00 AM] You: متوفر بسعر 20 جنيه
[9/15/26, 9:02:00 AM] Customer: لا قصدي النوع التاني
[9/15/26, 9:03:00 AM] You: تمام`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const correction = result.findings.find((f) => f.key === 'customer_correction');
    expect(correction?.interpretation).not.toContain('أرسل الموظف رسالة أخرى');
    expect(correction?.interpretation).toContain('لم يُعثر على رد من الموظف بعد التصحيح');
  });

  it('V32.2.1: an unrelated staff message after a correction is NOT resolutionAfterCorrection=resolved', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز باراسيتامول
[9/15/26, 9:01:00 AM] You: متوفر بسعر 20 جنيه
[9/15/26, 9:02:00 AM] Customer: لا قصدي النوع التاني
[9/15/26, 9:03:00 AM] You: بالمناسبة التوصيل متاح 24 ساعة`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const correction = result.findings.find((f) => f.key === 'customer_correction');
    expect(correction?.interpretation).toContain('لم يُعثر على رد من الموظف بعد التصحيح');
  });

  it('V32.2.1: a staff reply that explicitly names the corrected item IS resolutionAfterCorrection=resolved (no question mark needed)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز باراسيتامول
[9/15/26, 9:01:00 AM] You: متوفر بسعر 20 جنيه
[9/15/26, 9:02:00 AM] Customer: لا قصدي النوع التاني
[9/15/26, 9:03:00 AM] You: تمام هبعتلك النوع التاني`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    const correction = result.findings.find((f) => f.key === 'customer_correction');
    expect(correction?.interpretation).toContain('أرسل الموظف رسالة أخرى');
  });

  it('V32.2.1: تمام never becomes a new Understanding trigger after an earlier real request in the same scope', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر بسعر 250 جنيه
[9/15/26, 9:02:00 AM] Customer: تمام`;
    const result = evaluateUnderstandingV32({ understanding: understandingOf(raw) });
    expect(result.findings[0].fact).toContain('عايز فيتامين د');
    expect(result.findings[0].fact).not.toContain('"تمام"');
  });
});
