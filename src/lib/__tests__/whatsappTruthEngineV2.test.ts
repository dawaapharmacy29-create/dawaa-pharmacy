import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppOperationalIntelligenceV6,
  mergeDeicticProductReferences,
  type WhatsAppProductSignal,
} from '@/lib/whatsappOperationalIntelligenceV6';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence, type UnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';

function message(id: string, minute: number, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 8, 13, 1, minute, 0)),
    rawTimestamp: String(minute),
    sender: direction === 'inbound' ? 'Customer' : 'You',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id: 'truth-v2',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['Customer', 'You'],
    outboundStaffNames: ['اسلام'],
    customerName: 'Customer',
    mediaCount: 0,
  };
}

function base(): UnifiedConversationIntelligence {
  return {
    version: 'whatsapp-review-v4',
    outcome: 'unknown',
    priority: 'normal',
    confidence: 85,
    requiresHumanApproval: false,
    followupRequired: false,
    suggestedFollowupReason: null,
    commercialEligible: true,
    chatSuggestedSold: false,
    serviceScore: 80,
    commercialScore: 70,
    journeyStages: [],
    lostSales: [],
    medicalSafetyFlags: [],
    strengths: [],
    weaknesses: [],
    executiveSummary: '',
  };
}

describe('Sales Intelligence Truth Engine V2 ground truth rules', () => {
  it('does not treat "مفيش مشكلة" as a complaint and recognizes a documented fulfillment failure', () => {
    const result = buildWhatsAppOperationalIntelligenceV6(
      session([
        message('m1', 0, 'inbound', 'محتاج الاوردر'),
        message('m2', 1, 'outbound', 'هجيب مندوب من الفرع التاني عشان الطلب'),
        message('m3', 2, 'inbound', 'مفيش مشكله'),
        message('m4', 3, 'outbound', 'انا متاسف لحضرتك عالتاخير الكبير دا'),
        message('m5', 4, 'outbound', 'المندوب كان المفروض جايلي لكن حصله ظرف ومجالبيش'),
        message('m6', 5, 'outbound', 'لو حضرتك تحبي نبعت الاوردر'),
      ]),
      base()
    );

    expect(result.primaryIntent).toBe('delivery_issue');
    expect(result.operationalOutcome).toBe('unresolved_request');
    expect(result.followupPlan.required).toBe(true);
    expect(result.followupPlan.priority).toBe('urgent');
    expect(result.followupPlan.reason || '').toMatch(/تعثر.*تنفيذ|تعثر.*توصيل/);
    expect(result.evidence.complaint.messageIds).toHaveLength(0);
  });

  it('merges a deictic "الغسول ده" reference into the preceding canonical product instead of creating a duplicate product', () => {
    const canonical: WhatsAppProductSignal = {
      rawName: 'Isis teenderm gel for sensitive skin',
      normalizedName: 'isis teenderm gel for sensitive skin',
      quantity: null,
      status: 'requested',
      sourceDirection: 'inbound',
      evidenceMessageIds: ['m0'],
      confidence: 92,
      productId: 'isis-product',
      productCode: '70271',
      canonicalName: 'ISIS TEEN DERM GEL SENSITIVE 250ML',
      catalogConfidence: 'strongly_inferred',
    };
    const reference: WhatsAppProductSignal = {
      rawName: 'الغسول ده',
      normalizedName: 'الغسول ده',
      quantity: null,
      status: 'requested',
      sourceDirection: 'inbound',
      evidenceMessageIds: ['m1'],
      confidence: 80,
    };

    const merged = mergeDeicticProductReferences(
      [canonical, reference],
      session([
        message('m0', 0, 'inbound', '[Forwarded] Isis teenderm gel for sensitive skin بديل الغسول'),
        message('m1', 1, 'inbound', 'موجود عندكم الغسول ده'),
      ])
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].productId).toBe('isis-product');
    expect(merged[0].evidenceMessageIds).toContain('m0');
    expect(merged[0].evidenceMessageIds).toContain('m1');
  });

  it('keeps a negated complaint out of the legacy unified complaint outcome too', () => {
    const unified = buildUnifiedConversationIntelligence(
      session([
        message('m1', 0, 'inbound', 'مفيش مشكله'),
        message('m2', 1, 'outbound', 'بنعتذر لحضرتك عن التأخير'),
      ])
    );

    expect(unified.outcome).not.toBe('complaint_resolved');
    expect(unified.outcome).not.toBe('complaint_unresolved');
  });

  it('does not invent a canonical product when a deictic request only points to missing media', () => {
    const reference: WhatsAppProductSignal = {
      rawName: 'واحد من دا',
      normalizedName: 'واحد من دا',
      quantity: 1,
      status: 'requested',
      sourceDirection: 'inbound',
      evidenceMessageIds: ['m1'],
      confidence: 80,
    };

    const merged = mergeDeicticProductReferences(
      [reference],
      session([
        message('m0', 0, 'inbound', '<image omitted>'),
        message('m1', 1, 'inbound', 'محتاجه واحد من دا'),
      ])
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].productId).toBeUndefined();
  });
});
