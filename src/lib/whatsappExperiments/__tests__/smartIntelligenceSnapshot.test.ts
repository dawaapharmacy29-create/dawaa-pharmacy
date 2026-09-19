import { describe, expect, it } from 'vitest';
import { buildSmartIntelligenceSnapshotV1 } from '@/lib/whatsappExperiments/smartIntelligenceSnapshot';
import type { ConversationJourneyResult } from '@/lib/whatsappExperiments/conversationJourneyClassifier';
import type { UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';

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
  status: 'not_applicable',
  bestCandidate: null,
  candidates: [],
  verificationConfidence: 1,
  revenue: null,
  reason: '',
  warnings: [],
};

describe('buildSmartIntelligenceSnapshotV1', () => {
  it('is version tagged and JSON serializable', () => {
    const snapshot = buildSmartIntelligenceSnapshotV1({
      journey,
      staffEffort: [{ staffName: 'أحمد', staffId: null, outboundMessages: 2, burstCount: 1, repliedBursts: 1, burstReplyRatePct: 100 }],
      invoiceVerification: notApplicable,
      branchHint: { value: 'فرع الشامي', source: 'active_owner', reason: 'test' },
    });
    expect(snapshot.version).toBe('smart-intelligence-snapshot-v1');
    expect(snapshot.journey).toEqual(journey);
    expect(snapshot.branchHint?.value).toBe('فرع الشامي');
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
  });

  it('keeps optional evidence explicit instead of fabricating values', () => {
    const snapshot = buildSmartIntelligenceSnapshotV1({
      journey,
      staffEffort: [],
      invoiceVerification: notApplicable,
    });
    expect(snapshot.customer).toBeNull();
    expect(snapshot.purchaseHistory).toBeNull();
    expect(snapshot.branchHint).toBeNull();
    expect(snapshot.bestMessageSignals).toEqual([]);
  });
});
