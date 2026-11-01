import { describe, expect, it } from 'vitest';
import { accountantSyncStale, categoryBreakdown, type AccountantTransaction } from '../accountantReport';

const tx = (id: string, vault_code: string, direction: 'in' | 'out', amount: number, classification: string) =>
  ({ id, vault_code, direction, amount, classification, date: '2026-11-01', category_name: null, description: null, created_by_name: null }) as AccountantTransaction;

describe('accountant report', () => {
  it('sums incoming and outgoing per classification, for one vault or all', () => {
    const rows = [
      tx('1', 'shamy', 'in', 1000, 'مبيعات'),
      tx('2', 'shamy', 'out', 300, 'موردين'),
      tx('3', 'shokry', 'in', 50, 'مبيعات'),
      tx('4', 'shokry', 'out', 20, 'مبيعات'),
    ];
    const all = categoryBreakdown(rows, null);
    expect(all.rows).toEqual([
      { classification: 'مبيعات', incoming: 1050, outgoing: 20, diff: 1030 },
      { classification: 'موردين', incoming: 0, outgoing: 300, diff: -300 },
    ]);
    expect(all.total).toEqual({ classification: 'الإجمالي', incoming: 1050, outgoing: 320, diff: 730 });
    expect(categoryBreakdown(rows, 'shokry').total.diff).toBe(30);
  });

  it('flags a sync older than an hour', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(accountantSyncStale(null, now)).toBe(true);
    expect(accountantSyncStale('2026-11-01T11:30:00Z', now)).toBe(false);
    expect(accountantSyncStale('2026-11-01T10:30:00Z', now)).toBe(true);
  });
});
