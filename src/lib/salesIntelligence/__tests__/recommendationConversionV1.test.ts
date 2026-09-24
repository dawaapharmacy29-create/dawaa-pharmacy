import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import type { WhatsAppProductJourneySummaryV7 } from '@/lib/whatsappProductJourneyV7';
import { deriveRecommendationConversionFactsV1 } from '@/lib/salesIntelligence/recommendationConversionV1';

function msg(
  id: string,
  at: string,
  direction: 'inbound' | 'outbound',
  sender: string,
  text: string
): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(at),
    rawTimestamp: at,
    sender,
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
    sourceFormat: 'txt',
    replyTo: null,
    mediaPlaceholder: false,
    mediaAvailable: false,
  };
}

function buildSession(): WhatsAppConversationSession {
  const messages = [
    msg('m1', '2026-09-20T10:00:00', 'inbound', 'العميل', 'محتاج بديل للصنف'),
    msg('m2', '2026-09-20T10:02:00', 'outbound', 'د هبة', 'ممكن حضرتك تستخدم المنتج البديل ده'),
    msg('m3', '2026-09-20T10:03:00', 'inbound', 'العميل', 'تمام ابعته'),
  ];
  return {
    id: 'session-1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['العميل', 'د هبة'],
    outboundStaffNames: ['د هبة'],
    customerName: 'العميل',
    mediaCount: 0,
    missingMediaCount: 0,
    replyCount: 0,
    forwardedCount: 0,
  };
}

const journeySummary: WhatsAppProductJourneySummaryV7 = {
  version: 'whatsapp-product-journey-v7',
  journeys: [
    {
      productName: 'Product X',
      productCode: 'X1',
      productId: 'p1',
      quantity: 1,
      currentStage: 'accepted',
      events: [
        { stage: 'recommended', messageIds: ['m2'], confidence: 90, note: 'recommended' },
        { stage: 'accepted', messageIds: ['m3'], confidence: 90, note: 'accepted' },
      ],
      saleIntent: true,
      closedInChat: false,
      followupCandidate: true,
      leakageReason: 'accepted but waiting invoice',
      leakageCode: 'closing_gap',
      leakageResponsibility: 'pharmacy',
      responsibilityNote: null,
      nextAction: 'match invoice',
      confidence: 90,
    },
  ],
  requestedProducts: 0,
  unavailableProducts: 0,
  alternativesOffered: 0,
  recommendationsAccepted: 1,
  chatClosedProducts: 0,
  unresolvedProducts: 1,
  followupProducts: 1,
  saleLeakageCount: 1,
  dominantLeakageReason: 'accepted but waiting invoice',
  nextBestCommercialAction: 'match invoice',
};

describe('recommendationConversionV1', () => {
  it('counts an official conversion only when invoice evidence is official', () => {
    const session = buildSession();
    const lines = [{
      productId: 'p1',
      productCode: 'X1',
      productName: 'Product X',
      quantity: 1,
      netLineAmount: 500,
      staffId: 'staff-2',
      staffName: 'د وائل',
    }];

    const official = deriveRecommendationConversionFactsV1({
      session,
      journeySummary,
      invoiceLines: lines,
      invoiceEvidenceLevel: 'official',
    });
    expect(official[0].recommenderName).toBe('د هبة');
    expect(official[0].invoiceStaffName).toBe('د وائل');
    expect(official[0].officialSaleFromRecommendation).toBe(true);
    expect(official[0].conversionStatus).toBe('official_sale');
    expect(official[0].soldNetValue).toBe(500);

    const candidate = deriveRecommendationConversionFactsV1({
      session,
      journeySummary,
      invoiceLines: lines,
      invoiceEvidenceLevel: 'candidate',
    });
    expect(candidate[0].officialSaleFromRecommendation).toBe(false);
    expect(candidate[0].conversionStatus).toBe('candidate_invoice_match');
    expect(candidate[0].needsHumanReview).toBe(true);
  });
});
