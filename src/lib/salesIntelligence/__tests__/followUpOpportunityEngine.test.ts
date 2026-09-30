import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import {
  classifyAvailabilityStatementV32,
  classifyCustomerTimingRequestV32,
  isStaffFollowUpPromiseV32,
} from '@/lib/whatsappSemanticSignalsV32';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveFollowUpOpportunities } from '@/lib/salesIntelligence/followUpOpportunityEngine';
import { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';
import type { SalesIntelligenceCaseAnalysis } from '@/lib/salesIntelligence/types';

// BRAIN STEP 4E — Canonical Follow-up + Next Best Action. Follow-up != every No Sale: reason +
// evidence + goal are required; the engine is an analytical decision and writes nothing.

type Identity = { resolved?: boolean };

function analyze(raw: string, identity: Identity = { resolved: true }) {
  const result = runSalesIntelligencePipeline({
    conversationId: 'follow-up-conversation',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => [],
    customerIdHint: identity.resolved ? 'customer-1' : null,
    customerIdentityStatus: identity.resolved ? 'resolved' : 'unresolved',
  });
  expect(result.caseAnalyses.length).toBeGreaterThan(0);
  return result.caseAnalyses[0];
}

/** Re-derive Lost + Follow-up with a canonical `sale_proven` outcome (no trusted invoice in unit tests). */
function asSaleProven(analysis: SalesIntelligenceCaseAnalysis, raw: string) {
  const messages = buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0]).messages;
  const salesOutcome = { ...analysis.salesOutcome, outcome: 'sale_proven' as const, saleProofState: 'proven' as const, isSaleCountable: true, isRevenueCountable: true };
  const lostOpportunity = deriveLostOpportunity({
    caseId: analysis.caseId,
    messages,
    customerNeed: analysis.customerNeed,
    unavailableDemand: analysis.unavailableDemand,
    commercialConfirmation: analysis.commercialConfirmation,
    journeyState: analysis.journeyState,
    salesOutcome,
  });
  return deriveFollowUpOpportunities({
    conversationCase: analysis.conversationCase,
    messages,
    customerNeed: analysis.customerNeed,
    unavailableDemand: analysis.unavailableDemand,
    lostOpportunity,
    salesOutcome,
    customerIdentityStatus: 'resolved',
  });
}

const actionable = (analysis: SalesIntelligenceCaseAnalysis) =>
  analysis.followUp.opportunities.filter((o) => o.status === 'actionable');

describe('V32 follow-up evidence vocabulary', () => {
  it('reads staff promises and customer timing without inventing dates', () => {
    expect(isStaffFollowUpPromiseV32('هسأل الدكتور وهبلغ حضرتك')).toBe(true);
    expect(isStaffFollowUpPromiseV32('تحت أمر حضرتك')).toBe(false);
    expect(classifyCustomerTimingRequestV32('كلمني بكرة')).toEqual({ when: 'days', days: 1 });
    expect(classifyCustomerTimingRequestV32('تابع معايا بعد يومين')).toEqual({ when: 'days', days: 2 });
    expect(classifyCustomerTimingRequestV32('لما الصنف يتوفر كلمني')).toEqual({ when: 'when_in_stock', days: null });
    expect(classifyCustomerTimingRequestV32('شكرا')).toBeNull();
  });

  it('"هسأل الدكتور" is not a stock check (4B owner tightened)', () => {
    expect(classifyAvailabilityStatementV32('هسأل الدكتور وهبلغ حضرتك')).toBeNull();
    expect(classifyAvailabilityStatementV32('هسأل الفرع وأرد عليك')).toBe('check_pending');
  });
});

describe('Canonical Follow-up Opportunity Engine', () => {
  it('A. unavailable and the customer still wants it -> actionable stock follow-up, when_in_stock, no invented date', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: طيب`);
    const [followUp] = actionable(analysis);
    expect(followUp.reason).toBe('stock_unavailable');
    expect(followUp.duePolicy).toBe('when_in_stock');
    expect(followUp.dueAt).toBeNull();
    expect(followUp.nextBestAction).toBe('contact_customer_when_product_available');
    expect(followUp.productRaw).toContain('كونجستال');
    expect(followUp.quantity).toBe(2);
    expect(followUp.demandKey).toBe(analysis.unavailableDemand[0].demandKey);
  });

  it('B. unavailable + alternative accepted -> no follow-up for the original', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`);
    expect(analysis.followUp.opportunities.filter((o) => o.demandKey)).toHaveLength(0);
    expect(actionable(analysis)).toHaveLength(0);
  });

  it('C. alternative accepted + explicit "notify me when the original is back" -> actionable when_in_stock', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته
[9/15/26, 9:02:30 AM] Customer: ولما كونجستال يتوفر كلمني`);
    const [followUp] = actionable(analysis);
    expect(followUp.reason).toBe('customer_asked_to_wait');
    expect(followUp.duePolicy).toBe('when_in_stock');
    expect(followUp.dueAt).toBeNull();
  });

  it('D. staff promised to check and never came back -> actionable, high, assigned to the promiser', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز اعرف جرعة فيتامين د المناسبة لبنتي
[9/15/26, 9:01:00 AM] You: هسأل الدكتور وهبلغ حضرتك`);
    const promise = actionable(analysis).find((o) => o.reason === 'staff_promised_check')!;
    expect(promise).toBeDefined();
    expect(promise.priority).toBe('high');
    expect(promise.goal).toBe('complete_promised_check');
    expect(promise.assignedStaffName).toBe('You');
    expect(promise.duePolicy).toBe('same_shift');
  });

  it('E. customer considering -> actionable decision check', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 180 جنيه
[9/15/26, 9:02:00 AM] Customer: هفكر وأرد عليك`);
    const [followUp] = actionable(analysis);
    expect(followUp.reason).toBe('customer_considering');
    expect(followUp.nextBestAction).toBe('check_customer_decision');
  });

  it('F. price objection without a final decline -> actionable price follow-up', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 500 جنيه
[9/15/26, 9:02:00 AM] Customer: السعر غالي، هفكر`);
    expect(analysis.lostOpportunity.state).toBe('recoverable');
    const [followUp] = actionable(analysis);
    expect(followUp.reason).toBe('price_objection');
    expect(followUp.nextBestAction).toBe('follow_up_with_value_or_allowed_offer');
  });

  it('G. final decline -> suppressed, never actionable', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: مش عايزه خلاص`);
    expect(actionable(analysis)).toHaveLength(0);
    expect(analysis.followUp.decision).toBe('suppressed');
    expect(analysis.followUp.opportunities.every((o) => o.suppressedBy === 'customer_final_decline')).toBe(true);
  });

  it('H. bought elsewhere -> no actionable follow-up', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 500 جنيه
[9/15/26, 9:30:00 AM] Customer: خلاص جبته من صيدلية تانية`);
    expect(actionable(analysis)).toHaveLength(0);
    expect(analysis.followUp.opportunities.every((o) => o.status === 'suppressed')).toBe(true);
  });

  it('I. sale proven -> no standard sales follow-up', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 180 جنيه
[9/15/26, 9:02:00 AM] Customer: هفكر وأرد عليك`;
    const followUp = asSaleProven(analyze(raw), raw);
    expect(followUp.opportunities.filter((o) => o.status === 'actionable')).toHaveLength(0);
  });

  it('J. sale proven + explicit future stock request -> the stock follow-up survives', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته
[9/15/26, 9:02:30 AM] Customer: ولما كونجستال يتوفر كلمني`;
    const followUp = asSaleProven(analyze(raw), raw);
    const active = followUp.opportunities.filter((o) => o.status === 'actionable');
    expect(active).toHaveLength(1);
    expect(active[0].reason).toBe('customer_asked_to_wait');
  });

  it('K. customer identity unresolved -> blocked, never dropped', () => {
    const analysis = analyze(
      `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: طيب`,
      { resolved: false }
    );
    expect(analysis.followUp.decision).toBe('blocked');
    const [followUp] = analysis.followUp.opportunities;
    expect(followUp.status).toBe('blocked');
    expect(followUp.blocker).toBe('customer_identity_unresolved');
    expect(followUp.customerId).toBeNull();
  });

  it('L. staff never replied -> immediate obligation, not blocked by identity', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د`, { resolved: false });
    const [followUp] = actionable(analysis);
    expect(followUp.reason).toBe('staff_no_response');
    expect(followUp.duePolicy).toBe('immediate');
    expect(followUp.nextBestAction).toBe('respond_to_customer_request');
    expect(followUp.dueAt).toBe(new Date('2026-09-15T09:00:00').toISOString());
  });

  it('M. customer silent after a real offer -> exactly one recovery opportunity', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 180 جنيه، أجهزهولك؟`);
    const active = actionable(analysis);
    expect(active).toHaveLength(1);
    expect(active[0].reason).toBe('customer_no_response');
    expect(active[0].nextBestAction).toBe('send_single_recovery_followup');
  });

  it('N. courtesy closing only -> no follow-up', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود يا فندم، تحت أمر حضرتك`);
    expect(analysis.followUp.opportunities).toHaveLength(0);
    expect(analysis.followUp.decision).toBe('not_needed');
  });

  it('O. "كلمني بكرة" -> customer timing respected (dueAt = interaction end + 1 day)', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 180 جنيه
[9/15/26, 9:02:00 AM] Customer: كلمني بكرة`);
    const callback = actionable(analysis).find((o) => o.reason === 'callback_requested')!;
    expect(callback.duePolicy).toBe('customer_requested_time');
    expect(callback.requestedDelayDays).toBe(1);
    expect(callback.dueAt).toBe(new Date(new Date('2026-09-15T09:02:00').getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it('P. A sold + B waiting stock -> follow-up only for B', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا، وفيتامين د موجود
[9/15/26, 9:02:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:03:00 AM] Customer: تمام
[9/15/26, 9:03:30 AM] Customer: ولما كونجستال يتوفر كلمني`;
    const followUp = asSaleProven(analyze(raw), raw);
    const active = followUp.opportunities.filter((o) => o.status === 'actionable');
    expect(active).toHaveLength(1);
    expect(active[0].productRaw).toContain('كونجستال');
    expect(active[0].reason).toBe('customer_asked_to_wait');
  });

  it('follow-up identity is stable across runs and never uses a filename', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: طيب`;
    const first = analyze(raw).followUp.opportunities.map((o) => o.followUpKey);
    const second = analyze(raw).followUp.opportunities.map((o) => o.followUpKey);
    expect(first).toEqual(second);
    expect(first[0]).toMatch(/^fu1\|customer:customer-1\|/);
    expect(first[0]).not.toMatch(/\.txt|\.zip/);
  });

  it('owns no legacy input and no clock', () => {
    const code = fs
      .readFileSync(path.resolve(__dirname, '../followUpOpportunityEngine.ts'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/OperationalIntelligenceV6|followupPlan|ProductJourneyV7|CustomerCaseEngineV22|nextAction\b|conversation_actions|FollowupSignalDetector|supabase|Date\.now|new Date\(\)/);
  });
});
