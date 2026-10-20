import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';

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

  it('classifies nursing visit request as noncommercial review', () => {
    const raw = '[9/28/26, 2:17:35 AM] Customer: ممكن تبعت حد مالتمريض عشان الكانيولا اتحركت\n[9/28/26, 2:20:27 AM] You: عنيا هكلم الممرض';
    const cases = deriveConversationCases({ understanding: understandingFor(raw), conversationId: 'service-1' });
    expect(cases[0].caseType).toBe('follow_up');
    expect(cases[0].needsHumanReview).toBe(true);
    expect(cases[0].confidence.ruleIds).toContain('case.classification.nursing_visit_service_not_sale');
  });

  it('runs noncommercial nursing support through the canonical pipeline without revenue or recovery tasks', () => {
    const raw = [
      '[9/28/26, 2:17:35 AM] Customer: ممكن تبعت حد مالتمريض عشان الكانيولا',
      '[9/28/26, 2:20:27 AM] You: حاضر هكلم الممرض',
    ].join('\n');
    const result = runSalesIntelligencePipeline({
      conversationId: 'nursing-canonical',
      rawWhatsAppExportText: raw,
      customerIdHint: 'customer-1',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      resolveInvoiceCandidates: () => [],
    });
    const analysis = result.caseAnalyses[0];
    expect(analysis.conversationCase.caseType).toBe('follow_up');
    expect(analysis.salesOutcome.isSaleCountable).toBe(false);
    expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
    expect(analysis.lostOpportunity.state).toBe('no_commercial_opportunity');
    expect(analysis.followUp.decision).toBe('review_required');
    expect(analysis.followUp.opportunities).toHaveLength(0);
    expect(analysis.operationalDisposition?.state).toBe('open_unknown');
  });

  it('links a near-term service chase to the earlier nursing request only', () => {
    const raw = [
      '[9/28/26, 2:17:35 AM] Customer: ممكن تبعت حد مالتمريض',
      '[9/28/26, 2:20:27 AM] You: حاضر',
      '[9/28/26, 3:39:59 AM] Customer: دكتور معلش شوفه تاني كده',
      '[9/28/26, 3:40:13 AM] You: هكلمه',
    ].join('\n');
    const cases = deriveConversationCases({ understanding: understandingFor(raw), conversationId: 'service-then-chase' });
    expect(cases).toHaveLength(2);
    expect(cases.map((item) => item.caseType)).toEqual(['follow_up', 'follow_up']);
    expect(cases[1].confidence.ruleIds).toContain('case.classification.nursing_chase_service_not_sale');
  });

  it('a medicine order plus nursing service never disappears into the service-only category', () => {
    const raw = '[9/28/26, 2:17:35 AM] Customer: عايز علبتين كولونا وممكن تبعت حد من التمريض';
    const cases = deriveConversationCases({ understanding: understandingFor(raw), conversationId: 'medicine-and-service' });
    expect(cases[0].caseType).not.toBe('follow_up');
  });

  it('retains a bare medicine brand in an additive nursing request', () => {
    const raw = '[9/28/26, 2:17:35 AM] Customer: عايز جاستروبيوتيك وكمان ممرض';
    const cases = deriveConversationCases({ understanding: understandingFor(raw), conversationId: 'brand-and-service' });
    expect(cases[0].caseType).not.toBe('follow_up');
  });

  it('an unrelated vague message cannot invent an earlier nursing obligation', () => {
    const raw = '[9/28/26, 2:17:35 AM] Customer: دكتور معلش شوفه تاني كده';
    const cases = deriveConversationCases({ understanding: understandingFor(raw), conversationId: 'no-context' });
    expect(cases[0].caseType).not.toBe('follow_up');
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
