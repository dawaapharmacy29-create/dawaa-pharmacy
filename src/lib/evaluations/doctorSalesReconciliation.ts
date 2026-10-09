/**
 * Reads `get_doctor_sales_reconciliation_v1` — the single source that separates a doctor's total sales from the
 * sales that can be compared as productivity. The same SQL core feeds the branch peer comparison, so the Eye and
 * the peers never compute attribution or attendance placement twice.
 *
 * Categories (every attributed invoice is in exactly one; none is dropped):
 * - attendance_verified: reliable identity, inside one of the doctor's punched shifts at the same branch.
 * - identity_only: reliable identity, no punched shift covers it. Part of total sales, never of productivity.
 * - uncertain: shared seller name, duplicated invoice number, or covering shift punched at another branch.
 * - zero_value: non-positive amount.
 */
export type ReconciliationCategory = 'attendance_verified' | 'identity_only' | 'uncertain' | 'zero_value';
export const RECONCILIATION_CATEGORIES: ReconciliationCategory[] = ['attendance_verified', 'identity_only', 'uncertain', 'zero_value'];

/**
 * Review classes from get_doctor_sales_reconciliation_v1. The cited invoice must carry the number, belong to the
 * same customer and fall between 1h before and 48h after the conversation (customer + time disambiguate numbers
 * that repeat across branches; the review's branch label is not trusted).
 * - verified: exactly one such invoice, not claimed by another review, rung up by the doctor.
 * - served_other_seller: the customer bought as cited, but a colleague rang up the invoice (service proven,
 *   issuance not). Not counted under the current policy; see docs/DOCTOR_SALES_RECONCILIATION.md.
 */
export type ConversionClass =
  | 'verified' | 'served_other_seller' | 'no_sale' | 'unknown' | 'claimed_without_invoice' | 'invoice_missing'
  | 'invoice_not_matching_customer_or_time' | 'invoice_ambiguous' | 'invoice_reused';

export type CycleReconciliation = {
  start: string;
  endExclusive: string;
  categories: Record<ReconciliationCategory, { invoices: number; sales: number }>;
  attendance: { presentDays: number; settledDays: number; pendingDays: number; approvedHours: number; approvedDaysWithHours: number; pendingHours: number; daysWithoutHours: number; unprovenBranchDays: number; otherBranchDays: number; lastDay: string | null };
  /** Verified sales placed on the shift day they belong to (a night shift owns its tail after midnight). */
  productivity: { verifiedSales: number; verifiedInvoices: number; verifiedSalesSettledDays: number; daysWithVerifiedSales: number };
  conversion: Partial<Record<ConversionClass, number>>;
};

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function parseSalesReconciliation(payload: unknown): CycleReconciliation[] {
  const cycles = Array.isArray(obj(payload).cycles) ? (obj(payload).cycles as unknown[]) : [];
  return cycles.map(raw => {
    const c = obj(raw);
    const cat = obj(c.categories), att = obj(c.attendance), prod = obj(c.productivity), conv = obj(c.conversion);
    const categories = Object.fromEntries(RECONCILIATION_CATEGORIES.map(k => [k, { invoices: num(obj(cat[k]).invoices), sales: num(obj(cat[k]).sales) }])) as CycleReconciliation['categories'];
    return {
      start: String(c.start || '').slice(0, 10),
      endExclusive: String(c.endExclusive || '').slice(0, 10),
      categories,
      attendance: {
        presentDays: num(att.presentDays), settledDays: num(att.settledDays), pendingDays: num(att.pendingDays),
        approvedHours: num(att.approvedHours), approvedDaysWithHours: num(att.approvedDaysWithHours), pendingHours: num(att.pendingHours), daysWithoutHours: num(att.daysWithoutHours), unprovenBranchDays: num(att.unprovenBranchDays),
        otherBranchDays: num(att.otherBranchDays), lastDay: att.lastDay ? String(att.lastDay).slice(0, 10) : null,
      },
      productivity: {
        verifiedSales: num(prod.verifiedSales), verifiedInvoices: num(prod.verifiedInvoices),
        verifiedSalesSettledDays: num(prod.verifiedSalesSettledDays), daysWithVerifiedSales: num(prod.daysWithVerifiedSales),
      },
      conversion: Object.fromEntries(Object.entries(conv).map(([k, v]) => [k, num(v)])) as CycleReconciliation['conversion'],
    };
  });
}

/** Fewer approved days than this make a per-hour rate a single-day anecdote. */
export const MIN_APPROVED_DAYS_FOR_RATE = 5;

export function totalSales(c: CycleReconciliation) {
  return RECONCILIATION_CATEGORIES.reduce((sum, k) => sum + c.categories[k].sales, 0);
}

/** Share of total sales value that is attendance-verified (0–1), or null without sales. */
export function verifiedCoverage(c: CycleReconciliation) {
  const total = totalSales(c);
  return total > 0 ? c.categories.attendance_verified.sales / total : null;
}

/**
 * Comparable productivity: only attendance-verified sales, divided only by the days and hours they come from.
 * - per attendance day: verified sales ÷ punched days (provisional while any day is pending review);
 * - per hour: verified sales of approved days with known hours ÷ those hours.
 * Sales of days without a punch are never divided by other days.
 */
export function comparableProductivity(c: CycleReconciliation) {
  const a = c.attendance, p = c.productivity;
  return {
    perAttendanceDay: a.presentDays > 0 ? p.verifiedSales / a.presentDays : null,
    perAttendanceDayFinal: a.pendingDays === 0,
    perApprovedHour: a.approvedHours > 0 && a.approvedDaysWithHours >= MIN_APPROVED_DAYS_FOR_RATE ? p.verifiedSalesSettledDays / a.approvedHours : null,
  };
}

/**
 * Conversion verified at invoice, customer and seller level: verified ÷ (verified + recorded no-sale).
 * A sale rung up by a colleague for the same customer (served_other_seller) and every unverified claim stay out
 * of both sides; they are reported, not counted as a sale or as a loss.
 */
export function verifiedConversion(c: CycleReconciliation) {
  const v = c.conversion;
  const verified = num(v.verified), noSale = num(v.no_sale);
  const reviews = Object.values(v).reduce((s, n) => s + num(n), 0);
  const servedByColleague = num(v.served_other_seller);
  const unverifiedClaims = num(v.claimed_without_invoice) + num(v.invoice_missing) + num(v.invoice_not_matching_customer_or_time) + num(v.invoice_ambiguous) + num(v.invoice_reused);
  const recorded = verified + noSale;
  return { reviews, verified, noSale, recorded, servedByColleague, unverifiedClaims, unknown: num(v.unknown), rate: recorded > 0 ? (verified / recorded) * 100 : null, coverage: reviews > 0 ? recorded / reviews : null };
}
