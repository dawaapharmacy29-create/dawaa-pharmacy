import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { classifyCustomerIntentStatementV32 } from '@/lib/whatsappSemanticSignalsV32';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { deriveCustomerNeedModel } from '@/lib/salesIntelligence/customerNeedModel';
import { resolveActiveBasket } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import { deriveUnavailableDemand } from '@/lib/salesIntelligence/unavailableDemandEngine';
import type { SalesIntelligenceCaseAnalysis } from '@/lib/salesIntelligence/types';

// BRAIN STEP 4D — Canonical Lost Opportunity Engine. No Sale != Lost; Sale Proof is the only
// route to `won`; lost needs explicit end evidence; time alone never decides.

function analyze(raw: string, options: { staffNames?: string[]; staffIdBySender?: Record<string, string> } = {}) {
  const result = runSalesIntelligencePipeline({
    conversationId: 'lost-conversation',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => [],
    staffIdBySender: options.staffIdBySender,
  });
  expect(result.caseAnalyses.length).toBeGreaterThan(0);
  return result.caseAnalyses[0];
}

function asProven(analysis: SalesIntelligenceCaseAnalysis) {
  const messages = buildConversationUnderstandingV32(
    splitWhatsAppSessions(parseWhatsAppExport(RAW_CACHE.get(analysis)!), 24 * 60)[0]
  ).messages;
  return deriveLostOpportunity({
    caseId: analysis.caseId,
    messages,
    customerNeed: analysis.customerNeed,
    unavailableDemand: analysis.unavailableDemand,
    commercialConfirmation: analysis.commercialConfirmation,
    journeyState: analysis.journeyState,
    salesOutcome: { ...analysis.salesOutcome, outcome: 'sale_proven', saleProofState: 'proven', isSaleCountable: true, isRevenueCountable: true },
  });
}
const RAW_CACHE = new Map<SalesIntelligenceCaseAnalysis, string>();
function analyzeKeep(raw: string) {
  const analysis = analyze(raw);
  RAW_CACHE.set(analysis, raw);
  return analysis;
}

describe('V32 customer-intent vocabulary', () => {
  it('classifies explicit intent statements only', () => {
    expect(classifyCustomerIntentStatementV32('خلاص جبته من صيدلية تانية')).toBe('bought_elsewhere');
    expect(classifyCustomerIntentStatementV32('مش عايزه خلاص')).toBe('final_decline');
    expect(classifyCustomerIntentStatementV32('هستنى لما يوصل')).toBe('will_wait');
    expect(classifyCustomerIntentStatementV32('هفكر وأرد عليك')).toBe('considering');
    expect(classifyCustomerIntentStatementV32('تمام')).toBeNull();
  });
});

describe('Canonical Lost Opportunity Engine', () => {
  it('A. sale proven -> won, no active loss', () => {
    const analysis = analyzeKeep(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام`);
    const lost = asProven(analysis);
    expect(lost.state).toBe('won');
    expect(lost.reason).toBeNull();
    expect(lost.recoverability).toBe('none');
  });

  it('B. information-only -> no_commercial_opportunity', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: السلام عليكم
[9/15/26, 9:01:00 AM] You: وعليكم السلام، تحت أمر حضرتك`).lostOpportunity;
    expect(lost.state).toBe('no_commercial_opportunity');
  });

  it('C. unavailable + customer will wait for stock -> recoverable (high), never lost', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: هستنى لما يوصل`).lostOpportunity;
    expect(lost.state).toBe('recoverable');
    expect(lost.reason).toBe('stock_unavailable');
    expect(lost.waitingOn).toBe('stock');
    expect(lost.recoverability).toBe('high');
    expect(lost.responsibility).toBe('inventory');
  });

  it('D. unavailable + "مش عايزه خلاص" -> lost, stock context, not recoverable', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: مش عايزه خلاص`).lostOpportunity;
    expect(lost.state).toBe('lost');
    expect(lost.reason).toBe('stock_unavailable');
    expect(lost.recoverability).toBe('none');
  });

  it('E. unavailable + alternative accepted -> not lost; demand kept as replaced', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`);
    expect(analysis.lostOpportunity.state).toBe('open');
    expect(analysis.lostOpportunity.waitingOn).toBe('staff');
    expect(analysis.lostOpportunity.reason).toBeNull();
    expect(analysis.unavailableDemand).toHaveLength(1);
  });

  it('F. price objection + "هفكر" -> recoverable price (medium)', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 500 جنيه
[9/15/26, 9:02:00 AM] Customer: السعر غالي، هفكر`).lostOpportunity;
    expect(lost.state).toBe('recoverable');
    expect(lost.reason).toBe('price');
    expect(lost.recoverability).toBe('medium');
    expect(lost.responsibility).toBe('customer');
  });

  it('G. price objection + "لا خلاص مش عايزه" -> lost price', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 500 جنيه
[9/15/26, 9:02:00 AM] Customer: غالي
[9/15/26, 9:03:00 AM] Customer: لا خلاص مش عايزه`).lostOpportunity;
    expect(lost.state).toBe('lost');
    expect(lost.reason).toBe('price');
    expect(lost.recoverability).toBe('none');
  });

  it('H. bought elsewhere -> lost competitor, none', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 500 جنيه
[9/15/26, 9:30:00 AM] Customer: خلاص جبته من صيدلية تانية`).lostOpportunity;
    expect(lost.state).toBe('lost');
    expect(lost.reason).toBe('competitor');
    expect(lost.recoverability).toBe('none');
  });

  it('I. real request never answered -> staff_no_response (recoverable, staff)', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د`).lostOpportunity;
    expect(lost.reason).toBe('staff_no_response');
    expect(lost.responsibility).toBe('staff');
    expect(lost.state).toBe('recoverable');
  });

  it('J. customer silent after a real offer question -> customer_no_response with conservative confidence', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب 180 جنيه، أجهزهولك؟`).lostOpportunity;
    expect(lost.reason).toBe('customer_no_response');
    expect(lost.state).toBe('recoverable');
    expect(lost.confidence.level).toBe('weakly_inferred');
  });

  it('J2. a courtesy close ("تحت أمر حضرتك") is never customer_no_response', () => {
    const lost = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود يا فندم، تحت أمر حضرتك`).lostOpportunity;
    expect(lost.reason).not.toBe('customer_no_response');
    expect(lost.state).not.toBe('lost');
  });

  it('K. multiple staff -> each fact keeps its own sender; a stock loss is not blamed on staff', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] د. سارة: كونجستال مش متوفر حاليًا
[9/15/26, 9:02:00 AM] د. أحمد: فيه بديل كومتركس
[9/15/26, 9:03:00 AM] Customer: لا مش عايزه`;
    const session = splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0];
    session.outboundStaffNames = [...(session.outboundStaffNames || []), 'د. سارة', 'د. أحمد'];
    const understanding = buildConversationUnderstandingV32(session);
    const conversationCase = deriveConversationCases({ understanding, conversationId: 'lost-multi-staff' })[0];
    const messages = understanding.messages;
    const { baskets, itemsByBasketId } = buildCaseBaskets(conversationCase.caseId, messages);
    const resolution = resolveActiveBasket(baskets);
    const customerNeed = deriveCustomerNeedModel({
      caseId: conversationCase.caseId,
      messages,
      baskets,
      itemsByBasketId,
      activeBasket: resolution.outcome === 'selected' ? resolution.basket : null,
      staffIdBySender: { 'د. سارة': 'staff-sara', 'د. أحمد': 'staff-ahmed' },
    });
    const unavailableDemand = deriveUnavailableDemand({ conversationCase, customerNeed, messages });
    // Commercial confirmation/journey/outcome come from the same conversation run canonically.
    const structural = analyze(raw.replace(/د\. (?:سارة|أحمد):/g, 'You:'));
    const lost = deriveLostOpportunity({
      caseId: conversationCase.caseId,
      messages,
      customerNeed,
      unavailableDemand,
      commercialConfirmation: structural.commercialConfirmation,
      journeyState: structural.journeyState,
      salesOutcome: structural.salesOutcome,
    });
    const stated = lost.staffFacts.find((f) => f.fact === 'stated_unavailable')!;
    const offered = lost.staffFacts.find((f) => f.fact === 'offered_alternative')!;
    expect(stated).toMatchObject({ staffSender: 'د. سارة', staffId: 'staff-sara' });
    expect(offered).toMatchObject({ staffSender: 'د. أحمد', staffId: 'staff-ahmed' });
    expect(lost.reason).toBe('alternative_rejected');
    expect(lost.responsibility).toBe('inventory');
  });

  it('L. A in the final basket + B unavailable, sale proven -> won overall, B kept as product loss', () => {
    const analysis = analyzeKeep(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا، وفيتامين د موجود
[9/15/26, 9:02:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:03:00 AM] Customer: تمام`);
    const lost = asProven(analysis);
    expect(lost.state).toBe('won');
    const loss = lost.productLosses.find((p) => p.requestedProductRaw.includes('كونجستال'));
    expect(loss).toBeDefined();
    expect(loss!.reason).toBe('stock_unavailable');
    expect(loss!.outcome).toBe('recoverable');
    expect(loss!.demandKey).toBeTruthy();
  });

  it('owns no legacy input: never reads V7 leakage, V23/V22 lost reasons, leakage views or watcher actions', () => {
    const code = fs
      .readFileSync(path.resolve(__dirname, '../lostOpportunityEngine.ts'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/ProductJourneyV7|CaseLostReasonV23|proposed_lost_reason|leakage|whatsapp_lost_opportunities|conversation_actions|OperationalIntelligenceV6|supabase|Date\.now|new Date\(\)/);
  });
});

