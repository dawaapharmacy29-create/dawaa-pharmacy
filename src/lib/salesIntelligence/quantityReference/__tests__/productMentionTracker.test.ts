import { describe, expect, it } from 'vitest';
import { buildProductMentions, computeActiveProductCandidates } from '../productMentionTracker';
import { messagesFrom } from './testUtils';

describe('buildProductMentions', () => {
  it('extracts a customer request mention and a staff offer mention', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود انتينال`);
    const mentions = buildProductMentions(messages);
    expect(mentions.some((m) => m.role === 'customer_request')).toBe(true);
    expect(mentions.some((m) => m.role === 'staff_offer')).toBe(true);
  });

  it('a bare staff availability reply ("موجود") with no product content is tagged staff_availability, not staff_offer', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود`);
    const mentions = buildProductMentions(messages);
    const staffMention = mentions.find((m) => m.sourceMessageId === messages[1].id);
    expect(staffMention?.role).toBe('staff_availability');
  });
});

describe('computeActiveProductCandidates', () => {
  it('excludes an identity explicitly rejected by the customer with no later re-mention', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود انتينال
[9/15/26, 9:02:00 AM] Customer: مش عايز انتينال خالص
[9/15/26, 9:03:00 AM] Customer: هات منه اتنين`);
    const mentions = buildProductMentions(messages);
    const activeBeforeReference = computeActiveProductCandidates(messages, mentions, messages.length - 1);
    expect(activeBeforeReference).toHaveLength(0);
  });

  it('keeps two distinct identities active when both were offered and neither was rejected', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال
[9/15/26, 9:01:00 AM] You: الاتنين موجودين`);
    const mentions = buildProductMentions(messages);
    const active = computeActiveProductCandidates(messages, mentions, messages.length);
    expect(active.length).toBeGreaterThanOrEqual(1);
  });
});
