// Branch stock accuracy from the weekly inventory counts (owner decision 2026-10-30).
// The point is not only that the count happens: the branch must keep its balances right, because
// balance mix-ups disturb the branch's work. Pure.
//   accuracy (60%): share of counted items whose final quantity equals the program balance
//                   (the manager's corrected quantity wins; "recount" is a mismatch)
//   on time  (40%): weekly counts approved by their due date / weeks expected in the cycle

export interface InventorySessionEvidence {
  id: string;
  branch: string | null;
  weekStart: string;
  dueDate: string | null;
  status: string | null;
  /** Cairo day the manager approved the count. */
  closedDay: string | null;
}

export interface InventoryItemEvidence {
  sessionId: string;
  productCode: string | null;
  itemName: string | null;
  expected: number | null;
  actual: number | null;
  reviewedQty: number | null;
  reviewResult: string | null;
  unitPrice: number | null;
}

export const INVENTORY_ACCURACY_WEIGHT = 0.6;
export const INVENTORY_ON_TIME_WEIGHT = 0.4;
/** Accuracy band: 80% of items right → 0, 98% → 100. */
export const INVENTORY_ACCURACY_FLOOR = 0.8;
export const INVENTORY_ACCURACY_CEILING = 0.98;

export interface InventoryAccuracyResult {
  expectedWeeks: number;
  approvedOnTime: number;
  approved: number;
  counted: number;
  matching: number;
  /** Absolute value of the differences (EGP, items with a price). */
  differenceValue: number;
  /** Items wrong in two or more weekly counts of the cycle: repeated balance mix-ups. */
  repeatedMismatches: number;
  accuracy: number | null;
  onTime: number;
  score: number | null;
}

const band = (value: number, floor: number, ceiling: number) => Math.max(0, Math.min(100, ((value - floor) / (ceiling - floor)) * 100));

export function inventoryAccuracy(
  sessions: readonly InventorySessionEvidence[],
  items: readonly InventoryItemEvidence[],
  expectedWeeks: number,
): InventoryAccuracyResult {
  const closed = sessions.filter((s) => s.status === 'closed');
  const closedIds = new Set(closed.map((s) => s.id));
  const approvedOnTime = closed.filter((s) => s.closedDay && (!s.dueDate || s.closedDay <= s.dueDate)).length;
  const counted = items.filter((item) => closedIds.has(item.sessionId) && item.actual !== null && item.expected !== null);
  const finalQty = (item: InventoryItemEvidence) =>
    item.reviewResult === 'corrected' && item.reviewedQty !== null ? item.reviewedQty : item.actual;
  const mismatched = counted.filter((item) => item.reviewResult === 'recount' || Number(finalQty(item)) !== Number(item.expected));
  const differenceValue = mismatched.reduce(
    (sum, item) => sum + Math.abs(Number(finalQty(item)) - Number(item.expected)) * (Number(item.unitPrice) || 0),
    0,
  );
  const wrongSessions = new Map<string, Set<string>>();
  for (const item of mismatched) {
    const key = (item.productCode || item.itemName || '').trim().toLowerCase();
    if (!key) continue;
    wrongSessions.set(key, (wrongSessions.get(key) || new Set()).add(item.sessionId));
  }
  const expected = Math.max(1, expectedWeeks);
  const onTime = Math.min(1, approvedOnTime / expected);
  const accuracy = counted.length ? (counted.length - mismatched.length) / counted.length : null;
  return {
    expectedWeeks: expected,
    approvedOnTime,
    approved: closed.length,
    counted: counted.length,
    matching: counted.length - mismatched.length,
    differenceValue,
    repeatedMismatches: [...wrongSessions.values()].filter((ids) => ids.size >= 2).length,
    accuracy,
    onTime,
    score: accuracy === null
      ? null
      : INVENTORY_ACCURACY_WEIGHT * band(accuracy, INVENTORY_ACCURACY_FLOOR, INVENTORY_ACCURACY_CEILING) + INVENTORY_ON_TIME_WEIGHT * onTime * 100,
  };
}

/** Weeks expected in a cycle for a branch: from the later of the cycle start and its first weekly count. */
export function expectedInventoryWeeks(cycle: { start: string; endExclusive: string }, firstWeekStart: string | null): number {
  if (!firstWeekStart || firstWeekStart >= cycle.endExclusive) return 0;
  const from = firstWeekStart > cycle.start ? firstWeekStart : cycle.start;
  const days = (Date.parse(`${cycle.endExclusive}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;
  return Math.max(1, Math.ceil(days / 7));
}
