import { describe, expect, it, vi } from 'vitest';

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }));

import { cycleStartOf, dueBatches, invoiceReviewScore, nextCycleStart, reviewErrorMessage, suggestCycleTargets } from '../reviewSamples';

describe('weekly review batches', () => {
  it('draws Sat-Tue invoices from Wednesday and Wed-Fri invoices plus the week of conversations from Saturday', () => {
    // 2026-11-18 is a Wednesday (the previous Wed-Fri invoices aged out; last week's chats are still drawn).
    expect(dueBatches('2026-11-18')).toEqual([
      { kind: 'invoice', start: '2026-11-14', end: '2026-11-17' },
      { kind: 'conversation', start: '2026-11-07', end: '2026-11-13' },
    ]);
    // 2026-11-21 is a Saturday.
    expect(dueBatches('2026-11-21')).toEqual([
      { kind: 'invoice', start: '2026-11-14', end: '2026-11-17' },
      { kind: 'invoice', start: '2026-11-18', end: '2026-11-20' },
      { kind: 'conversation', start: '2026-11-14', end: '2026-11-20' },
      { kind: 'conversation', start: '2026-11-07', end: '2026-11-13' },
    ]);
  });

  it('drops an invoice batch once its cameras have rolled over, and a missed chat week after one more week', () => {
    // Monday 2026-11-23: Sat-Tue ended 6 days ago, too late; Wed-Fri ended 3 days ago.
    expect(dueBatches('2026-11-23').map((b) => `${b.kind}:${b.start}`))
      .toEqual(['invoice:2026-11-18', 'conversation:2026-11-14', 'conversation:2026-11-07']);
    // Wednesday 2026-11-25: the 7-13 chat week ended 12 days ago.
    expect(dueBatches('2026-11-25').map((b) => `${b.kind}:${b.start}`))
      .toEqual(['invoice:2026-11-21', 'conversation:2026-11-14']);
  });

  it('maps days to the 26th cycle', () => {
    expect(cycleStartOf('2026-11-17')).toBe('2026-10-26');
    expect(cycleStartOf('2026-11-26')).toBe('2026-11-26');
    expect(cycleStartOf('2027-01-05')).toBe('2026-12-26');
    expect(nextCycleStart('2026-12-26')).toBe('2027-01-26');
  });
});

describe('invoice review score and target suggestion', () => {
  it('scores only the visible criteria and needs three', () => {
    expect(invoiceReviewScore({ greeting: 2, speed: 1 })).toBeNull();
    expect(invoiceReviewScore({ greeting: 2, speed: 1, check: 2, closing: null })).toBe(83.3);
  });

  it('climbs follow-ups by 200 up to 1000 and requests by 15%', () => {
    expect(suggestCycleTargets({ followups: 550, requests: 95 })).toEqual({ followups: 750, requests: 110 });
    expect(suggestCycleTargets({ followups: 900, requests: 225 })).toEqual({ followups: 1000, requests: 260 });
  });
});

describe('review sample errors', () => {
  it('shows the owner a sentence instead of the database code', () => {
    expect(reviewErrorMessage('review_invoice_already_sampled')).toBe('الفاتورة دي متضافة للمراجعة قبل كده');
    expect(reviewErrorMessage('ERROR: review_sample_already_reviewed (22023)')).toBe('العينة دي اتقيّمت خلاص، مينفعش تتشال');
    expect(reviewErrorMessage('network down')).toBe('network down');
  });
});
