import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { deriveCustomerNeedModel } from '@/lib/salesIntelligence/customerNeedModel';
import { resolveActiveBasket } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import { deriveUnavailableDemand } from '@/lib/salesIntelligence/unavailableDemandEngine';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';

// BRAIN STEP 4C — Canonical Unavailable Demand Engine. A pure projection over the Customer Need
// product lifecycle: no new detector, no parsing, no legacy rows, no writer.

interface Options {
  staffNames?: string[];
  staffIdBySender?: Record<string, string>;
  customerIdHint?: string | null;
  customerIdentityStatus?: 'resolved' | 'unresolved' | 'ambiguous' | 'contradicted';
  branchNameRawHint?: string | null;
}

function demandFor(raw: string, options: Options = {}) {
  const session = splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0];
  if (options.staffNames) session.outboundStaffNames = [...(session.outboundStaffNames || []), ...options.staffNames];
  const understanding = buildConversationUnderstandingV32(session);
  const conversationCase = deriveConversationCases({
    understanding,
    conversationId: 'demand-conversation',
    customerIdHint: options.customerIdHint ?? null,
    branchNameRawHint: options.branchNameRawHint ?? 'فرع شكري',
  })[0];
  const messages = understanding.messages.filter((m) =>
    understanding.interactions[0].messageIds.includes(m.id)
  );
  const { baskets, itemsByBasketId } = buildCaseBaskets(conversationCase.caseId, messages);
  const resolution = resolveActiveBasket(baskets);
  const customerNeed = deriveCustomerNeedModel({
    caseId: conversationCase.caseId,
    messages,
    baskets,
    itemsByBasketId,
    activeBasket: resolution.outcome === 'selected' ? resolution.basket : null,
    staffIdBySender: options.staffIdBySender,
  });
  return deriveUnavailableDemand({
    conversationCase,
    customerNeed,
    messages,
    customerIdentityStatus: options.customerIdentityStatus,
  });
}

const resolved = { customerIdHint: 'customer-1', customerIdentityStatus: 'resolved' as const };

describe('Canonical Unavailable Demand Engine', () => {
  it('1. requested product A qty 2, staff says unavailable -> exactly one demand', () => {
    const demands = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا`,
      resolved
    );
    expect(demands).toHaveLength(1);
    const demand = demands[0];
    expect(demand.requestedProductRaw).toContain('كونجستال');
    expect(demand.quantityRequested).toBe(2);
    expect(demand.availabilityState).toBe('unavailable');
    expect(demand.customerId).toBe('customer-1');
    expect(demand.branchNameRaw).toBe('فرع شكري');
    expect(demand.statedByStaffName).toBe('You');
    expect(demand.alternativeOffered).toBe(false);
    expect(demand.followUpCandidate).toBe(true);
    expect(demand.followUpReason).toBe('original_unavailable_no_alternative');
    expect(demand.requestedAt).toBeTruthy();
    expect(demand.demandKey).toBe(`${demand.caseId}:demand:raw:${demand.productKey}`);
  });

  it('2. alternative rejected -> original demand kept, follow-up candidate', () => {
    const [demand] = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، فيه بديل كومتركس
[9/15/26, 9:02:00 AM] Customer: لا مش عايزه`,
      resolved
    );
    expect(demand.requestedProductRaw).toContain('كونجستال');
    expect(demand.alternativeOffered).toBe(true);
    expect(demand.alternativeProductRaw).toContain('كومتركس');
    expect(demand.alternativeResponse).toBe('rejected');
    expect(demand.followUpCandidate).toBe(true);
    expect(demand.followUpReason).toBe('alternative_rejected');
  });

  it('3. alternative accepted -> original demand kept, no follow-up', () => {
    const [demand] = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`,
      resolved
    );
    expect(demand.requestedProductRaw).toContain('كونجستال');
    expect(demand.alternativeResponse).toBe('accepted');
    expect(demand.followUpCandidate).toBe(false);
    expect(demand.followUpSuppressedBy).toBe('alternative_accepted');
  });

  it('4. staff will check availability -> check_pending demand', () => {
    const [demand] = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عندكم كونجستال؟
[9/15/26, 9:01:00 AM] You: لحظة أتأكد من توفره`,
      resolved
    );
    expect(demand.availabilityState).toBe('check_pending');
    expect(demand.followUpReason).toBe('availability_check_pending');
  });

  it('5. customer asks "مش موجود؟", staff says available -> no demand', () => {
    const demands = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:30 AM] Customer: هو مش موجود؟
[9/15/26, 9:01:00 AM] You: كونجستال موجود يا فندم`,
      resolved
    );
    expect(demands).toHaveLength(0);
  });

  it('6. A unavailable + B available in the same interaction -> demand only for A', () => {
    const demands = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا، وفيتامين د موجود`,
      resolved
    );
    expect(demands).toHaveLength(1);
    expect(demands[0].requestedProductRaw).toContain('كونجستال');
  });

  it('7. two unavailable products -> two demand records', () => {
    const demands = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 1 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود، وفيتامين د كمان مش متوفر`,
      resolved
    );
    expect(demands).toHaveLength(2);
    expect(new Set(demands.map((d) => d.demandKey)).size).toBe(2);
  });

  it('8. unknown customer identity -> demand kept, customerId null, blocker set', () => {
    for (const options of [
      { customerIdHint: 'customer-1', customerIdentityStatus: 'ambiguous' as const },
      { customerIdHint: 'customer-1' },
      {},
    ]) {
      const demands = demandFor(
        `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا`,
        options
      );
      expect(demands).toHaveLength(1);
      expect(demands[0].customerId).toBeNull();
      expect(demands[0].blockers).toContain('customer_identity_unresolved');
    }
  });

  it('9. multiple staff -> each fact attributed to its own sender', () => {
    const [demand] = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] د. سارة: كونجستال مش متوفر حاليًا
[9/15/26, 9:02:00 AM] د. أحمد: فيه بديل كومتركس
[9/15/26, 9:03:00 AM] Customer: لا مش عايزه`,
      {
        ...resolved,
        staffNames: ['د. سارة', 'د. أحمد'],
        staffIdBySender: { 'د. سارة': 'staff-sara', 'د. أحمد': 'staff-ahmed' },
      }
    );
    expect(demand.statedByStaffName).toBe('د. سارة');
    expect(demand.statedByStaffId).toBe('staff-sara');
    expect(demand.alternativeOfferedByStaffName).toBe('د. أحمد');
    expect(demand.alternativeOfferedByStaffId).toBe('staff-ahmed');
    expect(demand.blockers).not.toContain('staff_identity_unresolved');
  });

  it('10. a later interaction for the same product is a separate demand, never merged', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'demand-two-interactions',
      rawWhatsAppExportText: `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/18/26, 6:00:00 PM] Customer: عايز 1 علبة كونجستال
[9/18/26, 6:01:00 PM] You: كونجستال مش موجود حاليًا`,
      resolveInvoiceCandidates: () => [],
    });
    const demands = result.caseAnalyses.flatMap((analysis) => analysis.unavailableDemand);
    expect(result.caseAnalyses.length).toBeGreaterThanOrEqual(2);
    expect(demands).toHaveLength(2);
    expect(new Set(demands.map((d) => d.caseId)).size).toBe(2);
    expect(new Set(demands.map((d) => d.demandKey)).size).toBe(2);
  });

  it('a proven sale never erases the demand for the original product', () => {
    const demands = demandFor(
      `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`,
      resolved
    );
    // The engine takes no sale input at all; the demand exists whatever the sale outcome.
    expect(demands).toHaveLength(1);
    expect(demands[0].followUpCandidate).toBe(false);
  });

  it('owns no detector: reads only the lifecycle, never legacy engines, filenames or writers', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '../unavailableDemandEngine.ts'),
      'utf8'
    ).replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/whatsappSemanticSignalsV32|OperationalIntelligenceV6|ProductJourneyV7|sales_opportunities|conversation_actions|supabase|filename|fileName|\.test\(|RegExp|\/[^/\n]+\/[gimsuy]*\.test/);
  });
});
