import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildSmartOfficialReviewDraftV1 } from '@/lib/whatsappSmartOfficialReviewDraft';
import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';

function oneSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

const SOLD_SESSION_RAW = `[9/15/26, 9:00:00 AM] Customer: صباح الخير، فيتامين د متوفر وبكام؟\n[9/15/26, 9:01:00 AM] You: صباح النور، مع حضرتك د هبة من صيدليات دواء. متوفر بسعر 250 جنيه\n[9/15/26, 9:02:00 AM] You: تحب نضيفه على أوردر حضرتك؟\n[9/15/26, 9:03:00 AM] Customer: تمام ابعته\n[9/15/26, 9:04:00 AM] You: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`;

describe('buildSmartOfficialReviewDraftV1', () => {
  it('wraps buildOfficialReviewSuggestion into the requested shape (applies/suggestedChoice/sourceEngine) without changing its underlying analysis', () => {
    const session = oneSession(SOLD_SESSION_RAW);
    const raw = buildOfficialReviewSuggestion(session, session.customerName);
    const draft = buildSmartOfficialReviewDraftV1(session, session.customerName);
    expect(draft.criteria).toHaveLength(raw.items.length);
    expect(draft.provisionalScore).toBe(raw.provisionalScore);
    for (let i = 0; i < raw.items.length; i++) {
      expect(draft.criteria[i].key).toBe(raw.items[i].key);
      expect(draft.criteria[i].applies).toBe(raw.items[i].status !== 'not_applicable');
      expect(draft.criteria[i].suggestedChoice).toBe(raw.items[i].selectedOption);
      expect(draft.criteria[i].sourceEngine).toBe('whatsapp-review-scoring-v1');
    }
  });

  it('never auto-applies a severe error, by construction', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    expect(draft.severeErrorAutoApplied).toBe(false);
  });

  it('every review_required criterion is flagged needsHumanReview, regardless of confidence', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const raw = buildOfficialReviewSuggestion(oneSession(SOLD_SESSION_RAW), null);
    raw.items.forEach((item, i) => {
      if (item.status === 'review_required') expect(draft.criteria[i].needsHumanReview).toBe(true);
    });
  });

  it('a low-confidence assessed criterion is still flagged needsHumanReview even though it "applies"', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const lowConfidenceAssessed = draft.criteria.find((c) => c.applies && c.confidence < 70);
    if (lowConfidenceAssessed) expect(lowConfidenceAssessed.needsHumanReview).toBe(true);
  });

  it('evidence pointing at a message with missing media forces needsHumanReview even for an otherwise-confident criterion', () => {
    const session = oneSession(SOLD_SESSION_RAW);
    const raw = buildOfficialReviewSuggestion(session, session.customerName);
    const confidentItem = raw.items.find((i) => i.status === 'assessed' && i.confidence >= 85 && i.evidenceMessageIds.length);
    expect(confidentItem).toBeTruthy();
    const draftWithoutMissingMedia = buildSmartOfficialReviewDraftV1(session, session.customerName);
    const before = draftWithoutMissingMedia.criteria.find((c) => c.key === confidentItem!.key)!;
    expect(before.needsHumanReview).toBe(false);

    const draftWithMissingMedia = buildSmartOfficialReviewDraftV1(session, session.customerName, {
      missingMediaMessageIds: [confidentItem!.evidenceMessageIds[0]],
    });
    const after = draftWithMissingMedia.criteria.find((c) => c.key === confidentItem!.key)!;
    expect(after.needsHumanReview).toBe(true);
  });

  it('confidentCriteriaCount + needsReviewCriteriaCount are consistent with the per-criterion flags', () => {
    const draft = buildSmartOfficialReviewDraftV1(oneSession(SOLD_SESSION_RAW), null);
    const expectedConfident = draft.criteria.filter((c) => c.applies && !c.needsHumanReview).length;
    const expectedNeedsReview = draft.criteria.filter((c) => c.needsHumanReview).length;
    expect(draft.confidentCriteriaCount).toBe(expectedConfident);
    expect(draft.needsReviewCriteriaCount).toBe(expectedNeedsReview);
  });
});
