import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Multi-staff exports: mark the named senders as staff exactly as a group export would, by
// wrapping the REAL session splitter (test plumbing only; no engine is replaced).
const extraStaff = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('@/lib/whatsappConversationParser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsappConversationParser')>('@/lib/whatsappConversationParser');
  return {
    ...actual,
    splitWhatsAppSessions: (...args: Parameters<typeof actual.splitWhatsAppSessions>) =>
      actual.splitWhatsAppSessions(...args).map((session) => ({
        ...session,
        outboundStaffNames: [...(session.outboundStaffNames || []), ...extraStaff.names],
      })),
  };
});

import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';
import { deriveFollowUpOpportunities } from '@/lib/salesIntelligence/followUpOpportunityEngine';
import { buildCaseIntelligenceView } from '@/lib/salesIntelligence/caseIntelligenceView';
import type { SalesIntelligenceCaseAnalysis } from '@/lib/salesIntelligence/types';

// STEP 5A — Unified Case Intelligence: one read model per interaction, composed from canonical
// outputs only. It must never re-decide sale, lost, follow-up, products or identity.

interface Options {
  resolved?: boolean;
  staffNames?: string[];
  staffIdBySender?: Record<string, string>;
}

function analyze(raw: string, options: Options = { resolved: true }) {
  extraStaff.names = options.staffNames ?? [];
  const result = runSalesIntelligencePipeline({
    conversationId: 'case-intelligence',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => [],
    customerIdHint: options.resolved ? 'customer-1' : null,
    customerIdentityStatus: options.resolved ? 'resolved' : 'unresolved',
    branchNameRawHint: 'فرع شكري',
    staffIdBySender: options.staffIdBySender,
  });
  extraStaff.names = [];
  return result.caseAnalyses[0];
}

/** Recompose with a canonical sale_proven outcome (unit tests have no trusted invoice). */
function asSaleProven(analysis: SalesIntelligenceCaseAnalysis, raw: string) {
  const session = splitWhatsAppSessions(parseWhatsAppExport(raw), Number.MAX_SAFE_INTEGER)[0];
  const understanding = buildConversationUnderstandingV32(session);
  const messages = understanding.messages;
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
  const followUp = deriveFollowUpOpportunities({
    conversationCase: analysis.conversationCase,
    messages,
    customerNeed: analysis.customerNeed,
    unavailableDemand: analysis.unavailableDemand,
    lostOpportunity,
    salesOutcome,
    customerIdentityStatus: 'resolved',
  });
  const { caseIntelligence: _old, ...rest } = analysis;
  return buildCaseIntelligenceView(
    { ...rest, salesOutcome, lostOpportunity, followUp },
    { messages, interaction: understanding.interactions[0], customerIdentityStatus: 'resolved' }
  );
}

describe('Unified Case Intelligence read model', () => {
  it('1. normal sale: need -> basket -> confirmed, awaiting invoice; nothing lost, nothing to follow up', () => {
    const view = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب`).caseIntelligence;
    expect(view.version).toBe('case-intelligence-v1');
    expect(view.interaction.messageCount).toBe(4);
    expect(view.interaction.segmentationReason).toBe('conversation_start');
    expect(view.need.primaryNeed).toContain('فيتامين د');
    expect(view.products[0]).toMatchObject({ requestedQuantity: 2, inFinalBasket: true, availability: 'unknown' });
    expect(view.basket.activeItems.length).toBeGreaterThan(0);
    expect(view.basket.announcedTotal).toBe(180);
    expect(view.journey.currentState).toBe('awaiting_invoice');
    expect(view.sale.outcome).not.toBe('sale_proven');
    expect(view.lostOpportunity).toMatchObject({ state: 'open', waitingOn: 'invoice' });
    expect(view.followUp.decision).toBe('not_needed');
    expect(view.staff.facts.some((f) => f.fact === 'confirmed_order' && f.staffSender === 'You')).toBe(true);
  });

  it('2. unavailable + alternative rejected: demand + recoverable loss + follow-up, all cross-referenced', () => {
    const view = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، فيه بديل كومتركس
[9/15/26, 9:02:00 AM] Customer: لا مش عايزه`).caseIntelligence;
    expect(view.unavailableDemand).toHaveLength(1);
    expect(view.unavailableDemand[0].alternativeResponse).toBe('rejected');
    expect(view.lostOpportunity).toMatchObject({ state: 'recoverable', reason: 'alternative_rejected' });
    // Rejecting a substitute is not declining the need (canonical owner: Customer Need).
    expect(view.need.needDeclined).toBe(false);
    expect(view.journey.currentState).not.toBe('customer_declined');
    const product = view.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(product.demandKey).toBe(view.unavailableDemand[0].demandKey);
    expect(product.followUpKeys.length).toBe(1);
    expect(view.followUp.opportunities[0].reason).toBe('stock_unavailable');
  });

  it('3. unavailable + alternative accepted + sale proven: historical demand kept, won, no unnecessary follow-up', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`;
    const view = asSaleProven(analyze(raw), raw);
    expect(view.sale.outcome).toBe('sale_proven');
    expect(view.lostOpportunity.state).toBe('won');
    expect(view.unavailableDemand).toHaveLength(1);
    expect(view.unavailableDemand[0].alternativeResponse).toBe('accepted');
    expect(view.followUp.opportunities.filter((o) => o.status === 'actionable')).toHaveLength(0);
  });

  it('4. staff no response: recoverable loss owned by staff, immediate follow-up, coaching pointer', () => {
    const view = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د`).caseIntelligence;
    expect(view.lostOpportunity).toMatchObject({ state: 'recoverable', reason: 'staff_no_response', responsibility: 'staff' });
    expect(view.followUp.opportunities[0]).toMatchObject({ reason: 'staff_no_response', status: 'actionable', duePolicy: 'immediate' });
    expect(view.coachingEvidence.staffReplied).toBe(false);
    expect(view.coachingEvidence.unansweredRequestMessageIds.length).toBeGreaterThan(0);
  });

  it('5. unknown customer identity: full intelligence, review blocker, blocked follow-up, no guessing', () => {
    const view = analyze(
      `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: طيب`,
      { resolved: false }
    ).caseIntelligence;
    expect(view.customer).toMatchObject({ customerId: null, customerPhone: null, identityStatus: 'unresolved', blockers: ['customer_identity_unresolved'] });
    expect(view.unavailableDemand).toHaveLength(1);
    expect(view.followUp.decision).toBe('blocked');
    expect(view.review.required).toBe(true);
    const codes = view.review.reasons.map((r) => r.code);
    expect(codes).toContain('customer_identity_unresolved');
    expect(codes).toContain('follow_up.blocked.customer_identity_unresolved');
  });

  it('6. multiple staff: every fact belongs to the sender of its own message', () => {
    const view = analyze(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] د. سارة: كونجستال مش متوفر حاليًا
[9/15/26, 9:02:00 AM] د. أحمد: فيه بديل كومتركس
[9/15/26, 9:03:00 AM] Customer: لا مش عايزه`,
      { resolved: true, staffNames: ['د. سارة', 'د. أحمد'], staffIdBySender: { 'د. سارة': 'staff-sara', 'د. أحمد': 'staff-ahmed' } }
    ).caseIntelligence;
    expect(view.staff.participants.map((p) => p.sender).sort()).toEqual(['د. أحمد', 'د. سارة']);
    expect(view.staff.facts.find((f) => f.fact === 'stated_unavailable')).toMatchObject({ staffSender: 'د. سارة', staffId: 'staff-sara' });
    expect(view.staff.facts.find((f) => f.fact === 'offered_alternative')).toMatchObject({ staffSender: 'د. أحمد', staffId: 'staff-ahmed' });
  });

  it('7. mixed products: A sold, B unavailable — the sale never erases B', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا، وفيتامين د موجود
[9/15/26, 9:02:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:03:00 AM] Customer: تمام`;
    const view = asSaleProven(analyze(raw), raw);
    expect(view.lostOpportunity.state).toBe('won');
    const sold = view.products.find((p) => p.productNameRaw.includes('فيتامين'))!;
    const missing = view.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(sold.inFinalBasket).toBe(true);
    expect(missing.availability).toBe('unavailable');
    expect(missing.demandKey).toBeTruthy();
    expect(missing.lossReason).toBe('stock_unavailable');
  });

  it('is a projection: sections are the canonical outputs themselves, and the module runs no engine', () => {
    const analysis = analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا`);
    const view = analysis.caseIntelligence;
    expect(view.need).toBe(analysis.customerNeed);
    expect(view.journey).toBe(analysis.journeyState);
    expect(view.unavailableDemand).toBe(analysis.unavailableDemand);
    expect(view.lostOpportunity).toBe(analysis.lostOpportunity);
    expect(view.followUp).toBe(analysis.followUp);
    const code = fs.readFileSync(path.resolve(__dirname, '../caseIntelligenceView.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/derive[A-Z]\w*\(|build(?!CaseIntelligenceView)[A-Z]\w*\(|whatsappSemanticSignalsV32|RegExp|\.test\(|supabase|Date\.now/);
  });
});
