import { describe, expect, it } from 'vitest';
import { cycleRange, purchasesTotals } from '../gmPurchasesSummary';
import { gmReviewCard } from '../gmReviewCard';

describe('دورة المشتريات 26 → 25', () => {
  it('current cycle runs from the last 26th to today', () => {
    expect(cycleRange('2026-11-05')).toEqual({ from: '2026-10-26', to: '2026-11-05' });
    expect(cycleRange('2026-11-26')).toEqual({ from: '2026-11-26', to: '2026-11-26' });
  });

  it('previous cycle ends on its 25th, across a year boundary too', () => {
    expect(cycleRange('2026-11-05', -1)).toEqual({ from: '2026-09-26', to: '2026-10-25' });
    expect(cycleRange('2027-01-10', -1)).toEqual({ from: '2026-11-26', to: '2026-12-25' });
  });

  it('adds the branches up', () => {
    const row = { branch: 'x', invoices: 2, gross: 10, transfers: 3, excluded: 1, net: 6 };
    expect(purchasesTotals([row, row])).toEqual({
      invoices: 4,
      gross: 20,
      transfers: 6,
      excluded: 2,
      net: 12,
    });
  });
});

describe('كارت المراجعة اليومية', () => {
  const now = new Date('2026-11-05T10:00:00');

  it('purchases: one sentence with the oldest wait and a chip per branch', () => {
    const card = gmReviewCard(
      {
        key: 'purchases_handover',
        done: false,
        detail: {
          synced_at: '2026-11-05T09:30:00',
          branches: [
            { branch: 'elshamy', pending: 3, value: 1200, oldest: '2026-10-28', yesterday: 4 },
            { branch: 'shokry', pending: 0, value: 0, oldest: null, yesterday: 6 },
          ],
        },
      },
      now
    );
    expect(card.headline).toContain('أقدمها من');
    expect(card.chips.map((chip) => [chip.label, chip.bad])).toEqual([
      ['الشامي', true],
      ['شكري', false],
    ]);
    expect(card.warning).toBeUndefined();
  });

  it('warns when the sync stopped', () => {
    const card = gmReviewCard(
      { key: 'shifts', done: false, detail: { synced_at: '2026-11-04T10:00:00', branches: [] } },
      now
    );
    expect(card.warning).toContain('المزامنة');
  });
});
