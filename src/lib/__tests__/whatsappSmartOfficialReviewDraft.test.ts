import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildSmartOfficialReviewDraftV1, conflictsWithJourney } from '@/lib/whatsappSmartOfficialReviewDraft';
import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';
import type { ConversationJourneyResult } from '@/lib/whatsappConversationJourneyClassifier';

function oneSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

const SOLD_SESSION_RAW = `[9/15/26, 9:00:00 AM] Customer: صباح الخير، فيتامين د متوفر وبكام؟\n[9/15/26, 9:01:00 AM] You: صباح النور، مع حضرتك د هبة من صيدليات دواء. متوفر بسعر 250 جنيه\n[9/15/26, 9:02:00 AM] You: تحب نضيفه على أوردر حضرتك؟\n[9/15/26, 9:03:00 AM] Customer: تمام ابعته\n[9/15/26, 9:04:00 AM] You: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`;

function noSaleJourney(): ConversationJourneyResult {
  return {
    journeyType: 'direct_customer_request',
    journeyLabel: 'test',
    checkinDetected: false,
    requestAfterCheckin: false,
    consultationAfterCheckin: false,
    saleState: 'no_verified_invoice',
    saleStateLabel: 'test',
  };
}

describe('buildSmartOfficialReviewDraftV1', () => {
  it('wraps buildOfficialReviewSuggestion into the requested shape (criterionKey/applies/suggestedChoice/sourceEngine) without changing its underlying analysis', () => {
    const session = oneSession(SOLD_SESSION_RAW);
    const raw = buildOfficialReviewSuggestion(session, session.customerName);
    const draft = buildSmartOfficialReviewDraftV1(session, session.customerName);
    expect(draft.criteria).toHaveLength(raw.items.length);
    expect(draft.provisionalScore).toBe(raw.provisionalScore);
    for (let i = 0; i < raw.items.length; i++) {
      expect(draft.criteria[i].criterionKey).toBe(raw.items[i].key);
      expect(draft.criteria[i].applies).toBe(raw.items[i].status !== 'not_applicable');
      expect(draft.criteria[i].suggestedChoice).toBe(raw.items[i].selectedOption);
      expect(draft.criteria[i].sourceEngine).toBe('whatsapp-review-scoring-v1');
    }
  });

  it('never auto-applies a severe error, by construction', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    expect(draft.severeErrorAutoApplied).toBe(false);
  });

  it('every underlying review_required criterion stays review_required, regardless of confidence', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const raw = buildOfficialReviewSuggestion(oneSession(SOLD_SESSION_RAW), null);
    raw.items.forEach((item, i) => {
      if (item.status === 'review_required') expect(draft.criteria[i].status).toBe('review_required');
    });
  });

  it('a not_applicable underlying criterion maps to unsupported, not confident or review_required', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const raw = buildOfficialReviewSuggestion(oneSession(SOLD_SESSION_RAW), null);
    raw.items.forEach((item, i) => {
      if (item.status === 'not_applicable') expect(draft.criteria[i].status).toBe('unsupported');
    });
  });

  it('a low-confidence assessed criterion becomes review_required even though it "applies"', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const lowConfidenceAssessed = draft.criteria.find((c) => c.applies && c.confidence < 70);
    if (lowConfidenceAssessed) expect(lowConfidenceAssessed.status).toBe('review_required');
  });

  it('evidence pointing at a message with missing media forces review_required even for an otherwise-confident criterion', () => {
    const session = oneSession(SOLD_SESSION_RAW);
    const raw = buildOfficialReviewSuggestion(session, session.customerName);
    const confidentItem = raw.items.find((i) => i.status === 'assessed' && i.confidence >= 85 && i.evidenceMessageIds.length);
    expect(confidentItem).toBeTruthy();
    const draftWithoutMissingMedia = buildSmartOfficialReviewDraftV1(session, session.customerName);
    const before = draftWithoutMissingMedia.criteria.find((c) => c.criterionKey === confidentItem!.key)!;
    expect(before.status).toBe('confident');

    const draftWithMissingMedia = buildSmartOfficialReviewDraftV1(session, session.customerName, {
      missingMediaMessageIds: [confidentItem!.evidenceMessageIds[0]],
    });
    const after = draftWithMissingMedia.criteria.find((c) => c.criterionKey === confidentItem!.key)!;
    expect(after.status).toBe('review_required');
  });

  // ملحوظة: محرك الاقتراح الحالي (whatsappReviewScoring.ts) لسه ما بيوصّلش أي بند بيع فعليًا
  // لـstatus='assessed' — فبنختبر منطق التضارب مباشرة كوحدة معزولة، مش عن طريق محادثة حقيقية.
  describe('conflictsWithJourney (unit-tested directly since no real session triggers it yet)', () => {
    it('flags a conflict when a sales-related criterion is confidently assessed but V6/Journey found no sale signal at all', () => {
      expect(conflictsWithJourney('sales_closing', 'assessed', noSaleJourney())).toBe(true);
    });

    it('does not flag a conflict for a non-sales criterion, regardless of saleState', () => {
      expect(conflictsWithJourney('greeting', 'assessed', noSaleJourney())).toBe(false);
    });

    it('does not flag a conflict when the criterion is not actually assessed', () => {
      expect(conflictsWithJourney('sales_closing', 'review_required', noSaleJourney())).toBe(false);
    });

    it('does not flag a conflict when there is a real sale signal', () => {
      const journey = { ...noSaleJourney(), saleState: 'invoice_verified_sale' as const };
      expect(conflictsWithJourney('sales_closing', 'assessed', journey)).toBe(false);
    });

    it('does not flag a conflict when no journey cross-check was provided at all', () => {
      expect(conflictsWithJourney('sales_closing', 'assessed', null)).toBe(false);
    });
  });

  it('a non-sales criterion is unaffected by a saleState conflict end-to-end', () => {
    const session = oneSession(SOLD_SESSION_RAW);
    const draft = buildSmartOfficialReviewDraftV1(session, session.customerName, { journey: noSaleJourney() });
    const greeting = draft.criteria.find((c) => c.criterionKey === 'greeting')!;
    expect(greeting.reason).not.toContain('تضارب');
  });

  it('confidentCriteriaCount + needsReviewCriteriaCount are consistent with the per-criterion statuses', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const expectedConfident = draft.criteria.filter((c) => c.status === 'confident').length;
    const expectedNeedsReview = draft.criteria.filter((c) => c.status === 'review_required').length;
    expect(draft.confidentCriteriaCount).toBe(expectedConfident);
    expect(draft.needsReviewCriteriaCount).toBe(expectedNeedsReview);
  });
});
