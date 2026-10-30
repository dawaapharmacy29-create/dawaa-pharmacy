import { describe, expect, it } from 'vitest';
import { expectedInventoryWeeks, inventoryAccuracy, type InventoryItemEvidence, type InventorySessionEvidence } from '../inventoryAccuracy';

const session = (id: string, overrides: Partial<InventorySessionEvidence> = {}): InventorySessionEvidence => ({
  id, branch: 'فرع شكري', weekStart: '2026-11-01', dueDate: '2026-11-04', status: 'closed', closedDay: '2026-11-04', ...overrides,
});
const item = (sessionId: string, code: string, expected: number, actual: number, overrides: Partial<InventoryItemEvidence> = {}): InventoryItemEvidence => ({
  sessionId, productCode: code, itemName: code, expected, actual, reviewedQty: null, reviewResult: null, unitPrice: 10, ...overrides,
});

describe('inventory accuracy', () => {
  it('weighs accuracy 60% and on-time approval 40%', () => {
    const items = [
      ...Array.from({ length: 49 }, (_, i) => item('s1', `a${i}`, 5, 5)),
      item('s1', 'x', 5, 3),
    ];
    const result = inventoryAccuracy([session('s1')], items, 4);
    // 49/50 = 98% → accuracy band 100; 1 of 4 weeks on time → 25%.
    expect(result).toMatchObject({ counted: 50, matching: 49, approvedOnTime: 1, expectedWeeks: 4, differenceValue: 20 });
    expect(result.score).toBeCloseTo(0.6 * 100 + 0.4 * 25, 5);
  });

  it('the manager correction counts, recount is a mismatch, late approval is not on time', () => {
    const result = inventoryAccuracy(
      [session('s1', { closedDay: '2026-11-06' })],
      [item('s1', 'a', 5, 3, { reviewResult: 'corrected', reviewedQty: 5 }), item('s1', 'b', 5, 5, { reviewResult: 'recount' })],
      1,
    );
    expect(result).toMatchObject({ matching: 1, counted: 2, approvedOnTime: 0, onTime: 0 });
  });

  it('flags items whose balance is wrong in two weeks and ignores open counts', () => {
    const result = inventoryAccuracy(
      [session('s1'), session('s2', { weekStart: '2026-11-08' }), session('s3', { status: 'counting', closedDay: null })],
      [item('s1', 'a', 5, 4), item('s2', 'a', 6, 5), item('s3', 'b', 1, 0)],
      2,
    );
    expect(result).toMatchObject({ repeatedMismatches: 1, counted: 2, approved: 2 });
    expect(inventoryAccuracy([session('s3', { status: 'counting' })], [], 1).score).toBeNull();
  });

  it('expected weeks start from the later of the cycle start and the first weekly count', () => {
    const cycle = { start: '2026-10-26', endExclusive: '2026-11-26' };
    expect(expectedInventoryWeeks(cycle, '2026-10-01')).toBe(5);
    expect(expectedInventoryWeeks(cycle, '2026-11-01')).toBe(4);
    expect(expectedInventoryWeeks(cycle, null)).toBe(0);
    expect(expectedInventoryWeeks(cycle, '2026-12-01')).toBe(0);
  });
});
