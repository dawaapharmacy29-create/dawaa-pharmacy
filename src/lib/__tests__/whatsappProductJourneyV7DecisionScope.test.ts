import { describe, expect, it } from 'vitest';
import { buildWhatsAppProductJourneyV7 } from '@/lib/whatsappProductJourneyV7';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import type { WhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';

function msg(id: string, minute: number, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 8, 15, 10, minute, 0)),
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
    id: 's1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['Customer', 'You'],
    outboundStaffNames: ['هبة'],
    customerName: 'Customer',
    mediaCount: 0,
  };
}

function operational(productEvidenceMessageId: string): WhatsAppOperationalIntelligenceV6 {
  return {
    version: 'whatsapp-operational-v6',
    primaryIntent: 'customer_request',
    secondaryIntents: [],
    initiator: 'customer',
    operationalOutcome: 'unresolved_request',
    customerState: 'unknown',
    products: [{
      rawName: 'Isis teenderm gel',
      normalizedName: 'isis teenderm gel',
      quantity: null,
      status: 'requested',
      sourceDirection: 'inbound',
      evidenceMessageIds: [productEvidenceMessageId],
      confidence: 92,
      productId: 'p1',
      productCode: '4902',
      canonicalName: 'ISIS Teen Derm Gel',
      catalogConfidence: 'proven',
    }],
    customerRequests: [{
      productName: 'ISIS Teen Derm Gel',
      quantity: null,
      urgency: 'normal',
      unresolved: true,
      evidenceMessageIds: [productEvidenceMessageId],
      confidence: 92,
    }],
    recommendations: [],
    followupPlan: { required: true, reason: null, ownerRole: 'team_dawaa_alpha', dueInDays: 1, priority: 'important', evidenceMessageIds: [productEvidenceMessageId] },
    nextBestAction: '',
    officialScoringEligible: true,
    intentConfidence: 90,
    outcomeConfidence: 80,
    evidence: {
      request: { messageIds: [productEvidenceMessageId], quote: '', confidence: 90 },
      recommendation: { messageIds: [], quote: '', confidence: 0 },
      complaint: { messageIds: [], quote: '', confidence: 0 },
      checkin: { messageIds: [], quote: '', confidence: 0 },
      saleClose: { messageIds: [], quote: '', confidence: 0 },
      customerState: { messageIds: [], quote: '', confidence: 0 },
    },
  };
}

describe('WhatsApp Product Journey V7 — scoped customer decisions', () => {
  it('maps direct request -> availability -> customer send-it acceptance', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel'),
      msg('m2', 1, 'outbound', 'موجود يا فندم'),
      msg('m3', 2, 'inbound', 'تمام ابعته'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).toContain('requested');
    expect(journey.events.map((e) => e.stage)).toContain('availability_confirmed');
    expect(journey.events.map((e) => e.stage)).toContain('accepted');
    expect(journey.currentStage).toBe('accepted');
    expect(journey.closedInChat).toBe(false);
    expect(journey.leakageCode).toBe('closing_gap');
    expect(result.unresolvedProducts).toBe(1);
    expect(result.nextBestCommercialAction).toMatch(/تأكيد أوردر|تأكيد.*أوردر/);
  });

  it('does not count a generic acknowledgement before availability as acceptance', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel'),
      msg('m2', 1, 'inbound', 'تمام'),
      msg('m3', 2, 'outbound', 'موجود يا فندم'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).not.toContain('accepted');
    expect(journey.currentStage).toBe('availability_confirmed');
  });

  it('does not pull a distant generic acknowledgement from another topic into this product', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel'),
      msg('m2', 1, 'outbound', 'موجود يا فندم'),
      msg('m3', 2, 'outbound', 'السعر 250 جنيه'),
      msg('m4', 3, 'outbound', 'التوصيل خلال ساعه'),
      msg('m5', 4, 'outbound', 'تحت امر حضرتك'),
      msg('m6', 5, 'inbound', 'عندي استفسار عن دواء الضغط'),
      msg('m7', 6, 'outbound', 'اتفضل يا فندم'),
      msg('m8', 7, 'inbound', 'تمام'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).not.toContain('accepted');
  });

  it('does not let a customer invoice question close the product journey', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 1, 'outbound', 'موجود يا فندم'),
      msg('m3', 2, 'inbound', 'تمام والفاتورة كام؟'),
      msg('m4', 3, 'outbound', 'لحظة أحسبه لحضرتك'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).not.toContain('order_confirmed');
    expect(journey.closedInChat).toBe(false);
  });

  it('keeps chat closure as awaiting invoice, never as a proven sale', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel'),
      msg('m2', 1, 'outbound', 'موجود يا فندم'),
      msg('m3', 2, 'inbound', 'ابعته'),
      msg('m4', 3, 'outbound', 'تم تأكيد الأوردر وجاري الإرسال'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).toContain('order_confirmed');
    expect(journey.currentStage).toBe('awaiting_invoice');
    expect(journey.closedInChat).toBe(true);
    expect(journey.nextAction).toMatch(/الفاتورة|فاتورة/);
  });
  it('does not treat the customer asking "مش موجود عندكم؟" as proven stock unavailability', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel مش موجود عندكم؟'),
      msg('m2', 1, 'outbound', 'هراجع لحضرتك يا فندم'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).not.toContain('unavailable');
    expect(journey.leakageCode).not.toBe('stock_unavailable');
  });

  it('records stock unavailability only when the pharmacy states it', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 1, 'outbound', 'للأسف مش موجود حاليا يا فندم'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).toContain('unavailable');
    expect(journey.currentStage).toBe('unavailable');
    expect(journey.leakageCode).toBe('stock_unavailable');
  });

  it('marks an offered alternative with no customer decision as recommendation_pending, not no_alternative', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 1, 'outbound', 'مش موجود حاليا لكن ممكن أرشح لحضرتك بديل مناسب'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.events.map((e) => e.stage)).toContain('unavailable');
    expect(journey.events.map((e) => e.stage)).toContain('alternative_offered');
    expect(journey.leakageCode).toBe('recommendation_pending');
  });

  it('attributes customer silence after availability to the customer, not pharmacy closing', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 1, 'outbound', 'موجود يا فندم والسعر 250 جنيه'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.leakageCode).toBe('customer_no_reply');
    expect(journey.leakageResponsibility).toBe('customer');
  });

  it('attributes accepted-but-not-confirmed closing gap to pharmacy action', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel'),
      msg('m2', 1, 'outbound', 'موجود يا فندم'),
      msg('m3', 2, 'inbound', 'ابعته'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.leakageCode).toBe('closing_gap');
    expect(journey.leakageResponsibility).toBe('pharmacy');
  });

  it('measures response delay from the actual product request, not an older unrelated inbound message', () => {
    const messages = [
      msg('m0', 0, 'inbound', 'مساء الخير'),
      msg('m0r', 20, 'outbound', 'مساء النور'),
      msg('m1', 21, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 22, 'outbound', 'موجود يا فندم'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.leakageCode).not.toBe('response_delay');
  });

  it('attributes a real delayed response to the pharmacy', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 15, 'outbound', 'موجود يا فندم'),
      msg('m3', 16, 'inbound', 'تمام شكرا'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    const journey = result.journeys[0];

    expect(journey.leakageCode).toBe('response_delay');
    expect(journey.leakageResponsibility).toBe('pharmacy');
  });

  it('attributes stockout to inventory rather than an individual employee', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'Isis teenderm gel موجود؟'),
      msg('m2', 1, 'outbound', 'للأسف مش موجود حاليا'),
    ];
    const result = buildWhatsAppProductJourneyV7(session(messages), operational('m1'));
    expect(result.journeys[0].leakageResponsibility).toBe('inventory');
  });

});
