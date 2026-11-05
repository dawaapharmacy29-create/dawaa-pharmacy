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
    const row = { branch: 'x', invoices: 2, gross: 10, transfers: 3, returns: 2, excluded: 1, net: 4, pending_invoices: 1, pending_value: 5 };
    expect(purchasesTotals([row, row])).toEqual({
      invoices: 4,
      gross: 20,
      transfers: 6,
      returns: 4,
      excluded: 2,
      pending_invoices: 2,
      pending_value: 10,
      net: 8,
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

describe('مراجعة v3', () => {
  const now = new Date('2026-11-05T10:00:00Z');

  it('sales file counts only when uploaded today', () => {
    const card = gmReviewCard(
      {
        key: 'sales_upload',
        done: false,
        detail: [
          { branch: 'shokry', last_day: '2026-11-04', uploaded_at: '2026-11-04T05:39:00Z' },
          { branch: 'elshamy', last_day: '2026-11-05', uploaded_at: '2026-11-05T06:00:00Z' },
        ],
      },
      now
    );
    expect(card.chips.map((chip) => chip.bad)).toEqual([true, false]);
    expect(card.headline).toContain('لسه');
  });

  it('customers: new coded per branch and the pace to cycle end', () => {
    const card = gmReviewCard(
      {
        key: 'customers',
        done: false,
        detail: {
          open_requests: 3,
          big_customers_yesterday: 2,
          days_done: 10,
          cycle_days: 31,
          branches: [
            {
              branch: 'shokry',
              new_yesterday: 2,
              new_cycle: 100,
              buyers_yesterday: 29,
              buyers_cycle: 500,
              invoices_yesterday: 40,
              coded_invoices_yesterday: 30,
            },
          ],
        },
      },
      now
    );
    expect(card.chips[0]).toMatchObject({ label: 'شكري' });
    expect(card.table?.rows[0]?.[2]).toBe((310).toLocaleString('ar-EG'));
    expect(card.table?.rows[0]?.[4]).toBe('75%');
  });
});
