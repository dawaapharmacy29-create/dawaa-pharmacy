import { describe, expect, it } from 'vitest';
import { buildSmartIntelligenceSnapshotV1 } from '@/lib/whatsappSmartIntelligenceSnapshot';
import type { ConversationJourneyResult } from '@/lib/whatsappConversationJourneyClassifier';
import type { UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';
import type { WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';

const journey: ConversationJourneyResult = {
  journeyType: 'checkin_then_order',
  journeyLabel: 'test',
  checkinDetected: true,
  requestAfterCheckin: true,
  consultationAfterCheckin: false,
  saleState: 'chat_sale_signal',
  saleStateLabel: 'test',
};

const notApplicable: UnifiedInvoiceVerification = {
  status: 'not_applicable', bestCandidate: null, candidates: [], verificationConfidence: 1, revenue: null, reason: '', warnings: [],
};

describe('buildSmartIntelligenceSnapshotV1', () => {
  it('is version-tagged, JSON-serializable, and carries the required fields through unchanged', () => {
    const snapshot = buildSmartIntelligenceSnapshotV1({
      journey,
      staffEffort: [{ staffName: 'أحمد', staffId: null, outboundMessages: 2, burstCount: 1, repliedBursts: 1, burstReplyRatePct: 100 }],
      invoiceVerification: notApplicable,
    });
    expect(snapshot.version).toBe('smart-intelligence-snapshot-v1');
    expect(snapshot.journey).toEqual(journey);
    expect(snapshot.invoiceVerification).toEqual(notApplicable);
    expect(snapshot.staffEffort).toHaveLength(1);
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
  });

  it('leaves not-yet-wired fields explicitly null/empty rather than fabricating data', () => {
    const snapshot = buildSmartIntelligenceSnapshotV1({ journey, staffEffort: [], invoiceVerification: notApplicable });
    expect(snapshot.customer).toBeNull();
    expect(snapshot.purchaseHistory).toBeNull();
    expect(snapshot.branchHint).toBeNull();
    expect(snapshot.bestMessageSignals).toEqual([]);
  });

  it('carries a resolved customer + purchase history through unchanged when passed (now wired)', () => {
    const customer: WhatsAppResolvedCustomer = {
      customer: { id: 'c1', name: 'أحمد الشامي', code: 'C1', phone: '01011111111', branch: 'فرع الشامي', category: 'vip' },
      confidence: 0.99,
      strategy: 'phone_exact',
      reason: 'test',
      candidates: [],
    };
    const purchaseHistory = { totalPurchases: 12, totalSpent: 4500, avgMonthly: 375, lastPurchaseAt: '2026-09-01' };
    const snapshot = buildSmartIntelligenceSnapshotV1({ journey, staffEffort: [], invoiceVerification: notApplicable, customer, purchaseHistory });
    expect(snapshot.customer).toEqual(customer);
    expect(snapshot.purchaseHistory).toEqual(purchaseHistory);
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
  });

  it('an ambiguous customer resolution (customer:null, multiple candidates) is carried through verbatim, never auto-picked', () => {
    const ambiguous: WhatsAppResolvedCustomer = {
      customer: null,
      confidence: 0.5,
      strategy: 'ambiguous',
      reason: 'test',
      candidates: [
        { id: 'c1', name: 'أحمد الشامي', code: 'C1', phone: '', branch: 'فرع الشامي', category: '' },
        { id: 'c2', name: 'أحمد الشامي', code: 'C2', phone: '', branch: 'فرع شكري', category: '' },
      ],
    };
    const snapshot = buildSmartIntelligenceSnapshotV1({ journey, staffEffort: [], invoiceVerification: notApplicable, customer: ambiguous });
    expect(snapshot.customer?.customer).toBeNull();
    expect(snapshot.customer?.candidates).toHaveLength(2);
  });

  it('records a real timestamp and the current engine versions as evidence', () => {
    const before = Date.now();
    const snapshot = buildSmartIntelligenceSnapshotV1({ journey, staffEffort: [], invoiceVerification: notApplicable });
    expect(new Date(snapshot.generatedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(snapshot.evidence.engineVersions.v6).toBe('6.1');
  });
});
