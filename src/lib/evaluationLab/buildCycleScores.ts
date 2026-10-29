import { normalizeBranchName } from '@/lib/branch';
import {
  ABSENCE_WITH_DEDUCTION, INVALID_REQUEST_STATUS, LAB_CURRENT_VERSION, LAB_VERSION_ORDER, LAB_THRESHOLDS, MISSING_PUNCH, NON_PUNCTUALITY_ATTENDANCE,
  PENDING_DECISION, PUNCTUALITY_BANDS, UNRESOLVED_ATTENDANCE, labFamilyOf, type LabFamily, type LabVersion,
} from './catalog';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import { summarizeFulfillment, type FulfillmentResult } from './requestFulfillment';
import {
  aggregate, bandScore, closureScore, codingGatePenalty, disciplineScore, measured, median, notMeasurable,
  percentileAmong, shrunkMean, targetScore, type AxisResult, type LabAdjustment, type LabScore,
} from './scoring';

// Pure cycle computation: canonical evidence in, one score per employee out. No I/O.

export interface LabEvidence {
  staff: Array<{ id: string; name: string; role: string; branch: string | null }>;
  invoices: Array<{
    staffId: string | null; net: number; date: string; coded: boolean; branch: string | null; deliveryStaffId: string | null; deliveryLabeled?: boolean;
    /** Cairo shift of invoice_datetime and the invoice's line count (v6.2 basket metrics). */
    shift?: string | null; items?: number | null;
    /** Discount on the invoice (v6.5 discount statistics). */
    discount?: number | null;
  }>;
  /** Official conversation reviews only (0..100). */
  reviews: Array<{ staffId: string; score: number }>;
  attendance: Array<{ staffId: string; date: string; status: string | null; hasFirstIn: boolean; scheduled: boolean; lateMinutes: number }>;
  requests: Array<{
    recordedStaffId: string | null; branch: string | null; createdAt: string; closedAt: string | null; status?: string | null;
    /** v6.3 matching with the Master Brain's detected requests. */
    id?: string; customerId?: string | null; customerCode?: string | null; customerPhone?: string | null; medicineName?: string | null; productCode?: string | null;
    quantity?: number | null;
  }>;
  /** v6.4: each request matched to the customer's invoice items (null when unreadable). */
  fulfillment?: FulfillmentResult[] | null;
  /** v6.5: the previous cycle per branch (valid invoices and net), for growth. */
  previousBranchSales?: Array<{ branch: string; invoices: number; net: number }> | null;
  /** v6.5: monthly evaluation status of each staff member for this cycle (official RPC). */
  teamEvaluations?: Array<{ staffId: string; branch: string | null; status: string | null; sentAt: string | null }> | null;
  /** v6.5: purchase invoices of the cycle (review state per branch). */
  purchaseInvoices?: Array<{ branch: string | null; enteredByStaffId: string | null; reviewed: boolean }> | null;
  /**
   * Customer requests the Master Brain found in WhatsApp conversations of the cycle (v6.3).
   * null when the source cannot be read by this session.
   */
  brainRequests?: BrainRequest[] | null;
  /** null when the source cannot be read by this session (its axis becomes not measurable). */
  purchases: Array<{ enteredByStaffId: string | null }> | null;
  targets: Array<{ branch: string; targetAmount: number }>;
  /** Sources with no rows in the cycle (followups, assistant_checklist, delivery_ratings): shown as dormant. */
  dormantSources: string[];
}

export interface BrainRequest {
  id: string;
  staffId: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerPhone: string | null;
  productCode: string | null;
  productName: string | null;
  status: string | null;
  /** The customer request created by approving this proposal (not self-recorded). */
  targetId: string | null;
  conversationStartedAt: string;
  conversationEndedAt: string | null;
  /** When the customer asked (projector payload.requestedAt); preferred over the conversation window. */
  requestedAt?: string | null;
}

const phoneKey = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '').slice(-10);
const productKey = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase().replace(/[\s\-_.]+/g, ' ');

/**
 * Was this Master Brain request already recorded by the same doctor? Same customer (id, code or
 * phone), same product (code, or one name containing the other), recorded from captureLeadHours
 * before the conversation to captureWindowHours after it, and not the request the approval created.
 */
export function isSelfRecorded(detected: BrainRequest, requests: LabEvidence['requests']): boolean {
  if (!detected.staffId) return false;
  const askedAt = detected.requestedAt && Number.isFinite(Date.parse(detected.requestedAt)) ? Date.parse(detected.requestedAt) : null;
  const from = (askedAt ?? Date.parse(detected.conversationStartedAt)) - LAB_THRESHOLDS.captureLeadHours * 36e5;
  const to = (askedAt ?? Date.parse(detected.conversationEndedAt || detected.conversationStartedAt)) + LAB_THRESHOLDS.captureWindowHours * 36e5;
  const phone = phoneKey(detected.customerPhone);
  const product = productKey(detected.productName);
  return requests.some((request) => {
    if (request.recordedStaffId !== detected.staffId) return false;
    if (detected.targetId && request.id === detected.targetId) return false;
    if (INVALID_REQUEST_STATUS.test(String(request.status || '').toLowerCase())) return false;
    const at = Date.parse(request.createdAt);
    if (!(at >= from && at <= to)) return false;
    const sameCustomer = Boolean(
      (detected.customerId && request.customerId === detected.customerId)
      || (detected.customerCode && request.customerCode && request.customerCode.trim() === detected.customerCode.trim())
      || (phone.length >= 8 && phoneKey(request.customerPhone) === phone),
    );
    if (!sameCustomer) return false;
    const requested = productKey(request.medicineName);
    return Boolean(
      (detected.productCode && request.productCode && request.productCode.trim() === detected.productCode.trim())
      || (product && requested && (requested.includes(product) || product.includes(requested))),
    );
  });
}

export interface LabPersonScore extends LabScore {
  staffId: string;
  name: string;
  branch: string | null;
  family: LabFamily;
  /** Members whose scores feed a manager's team axes. */
  team?: Array<{ staffId: string; name: string; total: number | null }>;
}

type AxisDraft = Omit<AxisResult, 'label' | 'weight'>;
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const branchKey = (value: string | null | undefined) => normalizeBranchName(value || '') || '';
const egp = (value: number) => Math.round(value).toLocaleString('ar-EG');

interface PersonFacts {
  workedDays: number;
  resolvedDays: number;
  onTimeDays: number;
  halfDays: number;
  lateMinutes: number;
  unresolvedDays: number;
  /** v6.1: scheduled days whose missing punch was never corrected. */
  missingPunchDays: number;
  /** Days waiting for a manager/administration decision. */
  pendingDecisionDays: number;
  invoices: number;
  coded: number;
  net: number;
  reviews: number[];
  requests: number;
  invalidRequests: number;
  purchases: number;
  deliveries: number;
}

function factsFor(evidence: LabEvidence, version: LabVersion): Map<string, PersonFacts> {
  const facts = new Map<string, PersonFacts>();
  const get = (id: string) => {
    let row = facts.get(id);
    if (!row) {
      row = { workedDays: 0, resolvedDays: 0, onTimeDays: 0, halfDays: 0, lateMinutes: 0, unresolvedDays: 0, missingPunchDays: 0, pendingDecisionDays: 0,
        invoices: 0, coded: 0, net: 0, reviews: [], requests: 0, invalidRequests: 0, purchases: 0, deliveries: 0 };
      facts.set(id, row);
    }
    return row;
  };
  for (const person of evidence.staff) get(person.id);
  for (const day of evidence.attendance) {
    const row = get(day.staffId);
    if (day.hasFirstIn) row.workedDays += 1;
    const status = String(day.status || '');
    if (PENDING_DECISION.test(status)) row.pendingDecisionDays += 1;
    if (version !== 'v6.0' && MISSING_PUNCH.test(status) && day.scheduled) {
      // The employee's own miss: a resolved day with zero credit.
      row.missingPunchDays += 1;
      row.resolvedDays += 1;
      continue;
    }
    if (!status || UNRESOLVED_ATTENDANCE.test(status)) {
      if (day.hasFirstIn || status) row.unresolvedDays += 1;
      continue;
    }
    if (ABSENCE_WITH_DEDUCTION.test(status)) { row.resolvedDays += 1; continue; }
    if (NON_PUNCTUALITY_ATTENDANCE.test(status) || !day.scheduled || !day.hasFirstIn) continue;
    row.resolvedDays += 1;
    const late = Math.max(0, day.lateMinutes || 0);
    row.lateMinutes += late;
    if (late <= PUNCTUALITY_BANDS.graceMinutes) row.onTimeDays += 1;
    else if (late <= PUNCTUALITY_BANDS.halfCreditMinutes) row.halfDays += 1;
  }
  for (const invoice of evidence.invoices) {
    if (invoice.staffId) {
      const row = get(invoice.staffId);
      row.invoices += 1;
      row.net += invoice.net;
      if (invoice.coded) row.coded += 1;
    }
    if (invoice.deliveryStaffId) get(invoice.deliveryStaffId).deliveries += 1;
  }
  for (const review of evidence.reviews) get(review.staffId).reviews.push(review.score);
  for (const request of evidence.requests) {
    if (!request.recordedStaffId) continue;
    const row = get(request.recordedStaffId);
    // v6.1 counts only valid requests (a cancelled/duplicate request is not credited).
    if (version !== 'v6.0' && INVALID_REQUEST_STATUS.test(String(request.status || '').toLowerCase())) row.invalidRequests += 1;
    else row.requests += 1;
  }
  for (const purchase of evidence.purchases || []) if (purchase.enteredByStaffId) get(purchase.enteredByStaffId).purchases += 1;
  return facts;
}

const perDay = (count: number, days: number) => count / days;

function disciplineAxis(f: PersonFacts): AxisDraft {
  if (f.resolvedDays < LAB_THRESHOLDS.minResolvedDays) {
    return notMeasurable('discipline', `${f.resolvedDays} يوم محسوم فقط (الحد ${LAB_THRESHOLDS.minResolvedDays})`, `${f.unresolvedDays} يوم ينتظر المراجعة`);
  }
  const credit = (f.onTimeDays + f.halfDays / 2) / f.resolvedDays;
  const late = f.lateMinutes / Math.max(1, f.resolvedDays - f.missingPunchDays);
  const beyond = f.resolvedDays - f.onTimeDays - f.halfDays - f.missingPunchDays;
  const missing = f.missingPunchDays ? ` · ${f.missingPunchDays} بصمة ناقصة لم تُصحَّح` : '';
  return measured('discipline', round(credit * 100), disciplineScore(credit),
    `${f.onTimeDays} يوم ≤${PUNCTUALITY_BANDS.graceMinutes}د · ${f.halfDays} يوم حتى ${PUNCTUALITY_BANDS.halfCreditMinutes}د · ${beyond} يوم أكثر${missing} · متوسط ${round(late)} د/يوم · ${f.unresolvedDays} يوم بانتظار المراجعة`);
}

/** Percentile axis over a per-worked-day rate among the family's measurable members. */
function rateAxis(
  key: 'sales_per_day' | 'customer_requests' | 'purchase_entry' | 'deliveries_per_day',
  members: Array<{ id: string; f: PersonFacts }>,
  pick: (f: PersonFacts) => number,
  unit: string,
  note: (f: PersonFacts) => string = () => '',
): Map<string, AxisDraft> {
  const out = new Map<string, AxisDraft>();
  const eligible = members.filter((member) => member.f.workedDays >= LAB_THRESHOLDS.minWorkedDays);
  const rates = new Map(eligible.map((member) => [member.id, perDay(pick(member.f), member.f.workedDays)]));
  const peers = [...rates.values()];
  for (const member of members) {
    const rate = rates.get(member.id);
    if (rate === undefined) {
      out.set(member.id, notMeasurable(key, `${member.f.workedDays} يوم عمل فقط (الحد ${LAB_THRESHOLDS.minWorkedDays})`));
      continue;
    }
    const pct = percentileAmong(rate, peers);
    out.set(member.id, pct === null
      ? notMeasurable(key, `زملاء قابلون للمقارنة أقل من ${LAB_THRESHOLDS.minPeersForPercentile}`, `${round(rate, 2)} ${unit}`)
      : measured(key, round(rate, 2), pct, `${round(rate, 2)} ${unit} · ترتيب ${round(pct)}٪ بين ${peers.length}${note(member.f)}`));
  }
  return out;
}

/**
 * Fair share of the branch's daily volume on the days the person actually worked: for each worked
 * day the expected volume is the branch's volume that day divided by the people of the same family
 * present. Part-timers are compared on their own days only; branch size and busy days cancel out.
 */
function fairShareAxis(
  key: 'sales_per_day' | 'deliveries_per_day' | 'invoice_share',
  members: Array<{ id: string; branch: string | null }>,
  evidence: LabEvidence,
  /** The person credited by an invoice and the invoice's volume (net for sales, 1 for a delivery). */
  ownerOf: (invoice: LabEvidence['invoices'][number]) => string | null,
  volumeOf: (invoice: LabEvidence['invoices'][number]) => number,
  describe: (own: number, expected: number, days: number, share: number) => string,
): Map<string, AxisDraft> {
  const out = new Map<string, AxisDraft>();
  const memberBranch = new Map(members.map((m) => [m.id, branchKey(m.branch)]));
  const workedDays = new Map<string, Set<string>>();
  const onDuty = new Map<string, number>();
  const markWorked = (staffId: string, date: string) => {
    const branch = memberBranch.get(staffId);
    if (branch === undefined || !date) return;
    const set = workedDays.get(staffId) || new Set<string>();
    if (set.has(date)) return;
    workedDays.set(staffId, set.add(date));
    onDuty.set(`${branch}|${date}`, (onDuty.get(`${branch}|${date}`) || 0) + 1);
  };
  // A worked day is a punched day OR a day with own volume: missing punches never erase work.
  for (const day of evidence.attendance) if (day.hasFirstIn) markWorked(day.staffId, day.date);
  for (const invoice of evidence.invoices) { const owner = ownerOf(invoice); if (owner) markWorked(owner, invoice.date); }
  const branchDay = new Map<string, number>();
  const ownDay = new Map<string, number>();
  for (const invoice of evidence.invoices) {
    const volume = volumeOf(invoice);
    if (!volume) continue;
    const key = `${branchKey(invoice.branch)}|${invoice.date}`;
    branchDay.set(key, (branchDay.get(key) || 0) + volume);
    const owner = ownerOf(invoice);
    if (owner) ownDay.set(`${owner}|${invoice.date}`, (ownDay.get(`${owner}|${invoice.date}`) || 0) + volume);
  }
  for (const member of members) {
    const days = [...(workedDays.get(member.id) || [])];
    if (days.length < LAB_THRESHOLDS.minWorkedDays) {
      out.set(member.id, notMeasurable(key, `${days.length} يوم عمل فقط (الحد ${LAB_THRESHOLDS.minWorkedDays})`));
      continue;
    }
    const branch = memberBranch.get(member.id) || '';
    let own = 0;
    let expected = 0;
    for (const date of days) {
      const present = onDuty.get(`${branch}|${date}`) || 1;
      expected += (branchDay.get(`${branch}|${date}`) || 0) / present;
      own += ownDay.get(`${member.id}|${date}`) || 0;
    }
    if (expected <= 0) {
      out.set(member.id, notMeasurable(key, 'لا يوجد حجم عمل للفرع في أيام عمله'));
      continue;
    }
    const share = own / expected;
    out.set(member.id, measured(key, round(share, 2),
      bandScore(share, LAB_THRESHOLDS.fairShareFloor, LAB_THRESHOLDS.fairShareCeiling), describe(own, expected, days.length, share)));
  }
  return out;
}

const dormant = (evidence: LabEvidence, source: string) => evidence.dormantSources.includes(source);
/** Every version keeps the rules of the ones before it. */
const atLeast = (version: LabVersion, minimum: LabVersion) => LAB_VERSION_ORDER.indexOf(version) >= LAB_VERSION_ORDER.indexOf(minimum);
const share = (part: number, whole: number) => (whole ? part / whole : null);

/**
 * Basket metric against the same branch, day and shift: for every invoice the doctor closed, the
 * expected value is the average of that metric over all of the branch's invoices in the same
 * day and shift. Ratio = own total ÷ expected total, so the shift mix and branch size cancel out.
 * Returns and zero invoices are excluded.
 */
function basketAxis(
  key: 'avg_invoice' | 'basket_items',
  members: Array<{ id: string }>,
  evidence: LabEvidence,
  metric: (invoice: LabEvidence['invoices'][number]) => number | null,
  floor: number,
  ceiling: number,
  describe: (own: number, expected: number, count: number, ratio: number) => string,
): Map<string, AxisDraft> {
  const out = new Map<string, AxisDraft>();
  const slotOf = (invoice: LabEvidence['invoices'][number]) => `${branchKey(invoice.branch)}|${invoice.date}|${invoice.shift || ''}`;
  const valid = evidence.invoices.filter((invoice) => invoice.net > 0 && invoice.shift && metric(invoice) !== null);
  const slots = new Map<string, { sum: number; n: number }>();
  for (const invoice of valid) {
    const slot = slots.get(slotOf(invoice)) || { sum: 0, n: 0 };
    slot.sum += metric(invoice) as number;
    slot.n += 1;
    slots.set(slotOf(invoice), slot);
  }
  const own = new Map<string, { value: number; expected: number; n: number }>();
  for (const invoice of valid) {
    if (!invoice.staffId) continue;
    const slot = slots.get(slotOf(invoice))!;
    const row = own.get(invoice.staffId) || { value: 0, expected: 0, n: 0 };
    row.value += metric(invoice) as number;
    row.expected += slot.sum / slot.n;
    row.n += 1;
    own.set(invoice.staffId, row);
  }
  for (const member of members) {
    const row = own.get(member.id);
    if (!row || row.n < LAB_THRESHOLDS.minInvoicesForBasket) {
      out.set(member.id, notMeasurable(key, `${row?.n ?? 0} فاتورة فقط (الحد ${LAB_THRESHOLDS.minInvoicesForBasket})`));
      continue;
    }
    const ratio = row.value / row.expected;
    out.set(member.id, measured(key, round(ratio, 2), bandScore(ratio, floor, ceiling), describe(row.value / row.n, row.expected / row.n, row.n, ratio)));
  }
  return out;
}

export function buildCycleScores(evidence: LabEvidence, version: LabVersion = LAB_CURRENT_VERSION): LabPersonScore[] {
  const facts = factsFor(evidence, version);
  const people = evidence.staff
    .map((person) => ({ ...person, family: labFamilyOf(canonicalStaffRole(person.role)) }))
    .filter((person): person is typeof person & { family: LabFamily } => person.family !== null);
  const familyMembers = (family: LabFamily) => people.filter((p) => p.family === family).map((p) => ({ id: p.id, branch: p.branch, f: facts.get(p.id)! }));
  const axes = new Map<string, AxisDraft[]>();
  const adjustments = new Map<string, LabAdjustment[]>();
  const push = (id: string, axis: AxisDraft) => axes.set(id, [...(axes.get(id) || []), axis]);
  const invalidNote = (f: PersonFacts) => (f.invalidRequests ? ` · ${f.invalidRequests} ملغي لا يُحتسب` : '');

  // Doctors.
  const doctors = familyMembers('doctor');
  fairShareAxis('sales_per_day', doctors, evidence, (inv) => inv.staffId, (inv) => inv.net,
    (own, expected, days, share) => `باع ${egp(own)} من نصيب متوقع ${egp(expected)} ج في ${days} يوم عمل (×${round(share, 2)})`)
    .forEach((axis, id) => push(id, axis));
  rateAxis('customer_requests', doctors, (f) => f.requests, 'طلب/يوم', invalidNote).forEach((axis, id) => push(id, axis));
  if (atLeast(version, 'v6.2')) {
    fairShareAxis('invoice_share', doctors, evidence, (inv) => inv.staffId, (inv) => (inv.net > 0 ? 1 : 0),
      (own, expected, days, share) => `${egp(own)} فاتورة من نصيب متوقع ${egp(expected)} في ${days} يوم عمل (×${round(share, 2)})`)
      .forEach((axis, id) => push(id, axis));
    basketAxis('avg_invoice', doctors, evidence, (inv) => inv.net, LAB_THRESHOLDS.avgInvoiceFloor, LAB_THRESHOLDS.avgInvoiceCeiling,
      (own, expected, n, ratio) => `متوسط ${egp(own)} ج مقابل ${egp(expected)} ج للفرع في نفس اليوم والشيفت · ${n} فاتورة (×${round(ratio, 2)})`)
      .forEach((axis, id) => push(id, axis));
    basketAxis('basket_items', doctors, evidence, (inv) => (inv.items && inv.items > 0 ? inv.items : null), LAB_THRESHOLDS.basketFloor, LAB_THRESHOLDS.basketCeiling,
      (own, expected, n, ratio) => `${round(own, 2)} صنف/فاتورة مقابل ${round(expected, 2)} للفرع في نفس اليوم والشيفت · ${n} فاتورة (×${round(ratio, 2)})`)
      .forEach((axis, id) => push(id, axis));
  }
  const captureByStaff = new Map<string, { found: number; self: number }>();
  if (atLeast(version, 'v6.3')) {
    const detectedFor = new Map<string, BrainRequest[]>();
    for (const detected of evidence.brainRequests || []) {
      if (!detected.staffId || /^(rejected|dismissed|cancelled)$/i.test(String(detected.status || ''))) continue;
      detectedFor.set(detected.staffId, [...(detectedFor.get(detected.staffId) || []), detected]);
    }
    for (const { id } of doctors) {
      const found = detectedFor.get(id) || [];
      captureByStaff.set(id, { found: found.length, self: found.filter((detected) => isSelfRecorded(detected, evidence.requests)).length });
      if (evidence.brainRequests == null) {
        push(id, notMeasurable('request_capture', 'طلبات العقل المدبر غير متاحة للقراءة من هذه الجلسة'));
      } else if (found.length < LAB_THRESHOLDS.minDetectedRequests) {
        push(id, notMeasurable('request_capture',
          `العقل المدبر وجد ${found.length} طلب فقط في محادثاته (الحد ${LAB_THRESHOLDS.minDetectedRequests}) — يُقاس بعد اعتماد تحليل كل المحادثات`));
      } else {
        const self = found.filter((detected) => isSelfRecorded(detected, evidence.requests)).length;
        const share = self / found.length;
        push(id, measured('request_capture', round(share * 100), bandScore(share, LAB_THRESHOLDS.captureFloor, LAB_THRESHOLDS.captureCeiling),
          `سجّل بنفسه ${self} من ${found.length} طلب وجدها العقل المدبر · فاته ${found.length - self}`));
      }
    }
  }
  const doctorRates = doctors.filter((d) => d.f.invoices >= LAB_THRESHOLDS.minInvoicesForCoding).map((d) => d.f.coded / d.f.invoices);
  const doctorRateMedian = median(doctorRates);
  const allReviews = doctors.flatMap((d) => d.f.reviews);
  const populationMean = allReviews.length ? allReviews.reduce((s, v) => s + v, 0) / allReviews.length : 0;
  const shrunk = new Map(doctors.filter((d) => d.f.reviews.length >= LAB_THRESHOLDS.minOfficialReviews)
    .map((d) => [d.id, shrunkMean(d.f.reviews.reduce((s, v) => s + v, 0) / d.f.reviews.length, d.f.reviews.length, populationMean)]));
  const shrunkPeers = [...shrunk.values()];
  for (const { id, f } of doctors) {
    push(id, disciplineAxis(f));
    if (f.invoices < LAB_THRESHOLDS.minInvoicesForCoding || doctorRateMedian === null) {
      push(id, notMeasurable('coding_quality', `${f.invoices} فاتورة فقط (الحد ${LAB_THRESHOLDS.minInvoicesForCoding})`));
    } else {
      const rate = f.coded / f.invoices;
      const penalty = version !== 'v6.0' ? codingGatePenalty(rate) : 0;
      push(id, measured('coding_quality', round(rate * 100), bandScore(rate, 0.9, 1),
        `${f.coded}/${f.invoices} مكوّدة · وسيط الزملاء ${round(doctorRateMedian * 100)}٪${version !== 'v6.0' ? ` · الحد الأدنى ${LAB_THRESHOLDS.codingGateFloor * 100}٪${penalty ? ` (خصم ${-penalty})` : ' (مستوفى)'}` : ''}`));
      if (penalty) adjustments.set(id, [{ label: 'تكويد أقل من الحد الأدنى', points: penalty, reason: `${round(rate * 100)}٪ من ${f.invoices} فاتورة` }]);
    }
    const s = shrunk.get(id);
    const pct = s === undefined ? null : percentileAmong(s, shrunkPeers);
    push(id, s === undefined
      ? notMeasurable('conversation_quality', `${f.reviews.length} مراجعة رسمية فقط (الحد ${LAB_THRESHOLDS.minOfficialReviews})`)
      : pct === null
        ? notMeasurable('conversation_quality', 'زملاء قابلون للمقارنة غير كافين', `${round(s)}/100`)
        : measured('conversation_quality', round(s), bandScore(s, 90, 100), `${f.reviews.length} مراجعة · متوسط معدّل ${round(s)}/100 · ترتيب ${round(pct)}٪ بين الزملاء`));
    if (dormant(evidence, 'followups')) push(id, notMeasurable('followups', 'لا توجد متابعات مسجلة في هذه الدورة (المصدر متوقف)'));
  }

  // Assistants.
  const assistants = familyMembers('assistant');
  if (evidence.purchases === null) {
    for (const { id } of assistants) push(id, notMeasurable('purchase_entry', 'فواتير المشتريات غير متاحة للقراءة من هذه الجلسة'));
  } else {
    rateAxis('purchase_entry', assistants, (f) => f.purchases, 'فاتورة/يوم').forEach((axis, id) => push(id, axis));
  }
  rateAxis('customer_requests', assistants, (f) => f.requests, 'طلب/يوم', invalidNote).forEach((axis, id) => push(id, axis));
  for (const { id, f } of assistants) {
    push(id, disciplineAxis(f));
    if (dormant(evidence, 'assistant_checklist')) push(id, notMeasurable('assistant_checklist', 'لا توجد تسليمات لقائمة المهام اليومية في هذه الدورة (المصدر متوقف)'));
  }

  // Delivery.
  const couriers = familyMembers('delivery');
  if (version !== 'v6.0') {
    // Delivery evidence quality per branch: labelled share and the share of labels resolved to a courier.
    const courierBranchQuality = new Map<string, { labelled: number; resolved: number; total: number }>();
    for (const invoice of evidence.invoices) {
      const key = branchKey(invoice.branch);
      const row = courierBranchQuality.get(key) || { labelled: 0, resolved: 0, total: 0 };
      row.total += 1;
      if (invoice.deliveryLabeled ?? Boolean(invoice.deliveryStaffId)) row.labelled += 1;
      if (invoice.deliveryStaffId) row.resolved += 1;
      courierBranchQuality.set(key, row);
    }
    const deliveryGap = (branch: string | null) => {
      const q = courierBranchQuality.get(branchKey(branch));
      if (!q || !q.total) return 'لا توجد فواتير للفرع';
      const labelled = q.labelled / q.total;
      const resolved = q.labelled ? q.resolved / q.labelled : 0;
      if (labelled < LAB_THRESHOLDS.minCourierLabelShare) return `الفرع يكتب اسم الدليفري على ${round(labelled * 100)}٪ فقط من الفواتير (الحد ${LAB_THRESHOLDS.minCourierLabelShare * 100}٪)`;
      if (resolved < LAB_THRESHOLDS.minCourierLabelResolved) return `${round(resolved * 100)}٪ فقط من أسماء الدليفري على الفواتير مربوطة بموظف توصيل (الحد ${LAB_THRESHOLDS.minCourierLabelResolved * 100}٪)`;
      return null;
    };
    const gaps = new Map(couriers.map((c) => [c.id, deliveryGap(c.branch)]));
    for (const { id } of couriers) { const gap = gaps.get(id); if (gap) push(id, notMeasurable('deliveries_per_day', gap)); }
    fairShareAxis('deliveries_per_day', couriers.filter((c) => !gaps.get(c.id)), evidence, (inv) => inv.deliveryStaffId, (inv) => (inv.deliveryStaffId ? 1 : 0),
      (own, expected, days, share) => `${own} توصيلة من نصيب متوقع ${round(expected)} في ${days} يوم عمل (×${round(share, 2)})`)
      .forEach((axis, id) => push(id, axis));
  } else {
    rateAxis('deliveries_per_day', couriers, (f) => f.deliveries, 'توصيلة/يوم').forEach((axis, id) => push(id, axis));
  }
  for (const { id, f } of couriers) {
    push(id, disciplineAxis(f));
    if (dormant(evidence, 'delivery_ratings')) push(id, notMeasurable('delivery_rating', 'لا توجد تقييمات توصيل مسجلة في هذه الدورة (المصدر متوقف)'));
  }

  const scored = new Map<string, LabPersonScore>();
  for (const person of people) {
    if (person.family === 'branch_manager' || person.family === 'branches_manager') continue;
    scored.set(person.id, { staffId: person.id, name: person.name, branch: person.branch, family: person.family,
      ...aggregate(person.family, axes.get(person.id) || [], { version, adjustments: adjustments.get(person.id) }) });
  }

  // Branch-level evidence for managers.
  const branchFacts = (keys: Set<string>) => {
    const invoices = evidence.invoices.filter((inv) => keys.has(branchKey(inv.branch)));
    const requests = evidence.requests.filter((req) => keys.has(branchKey(req.branch)));
    const target = evidence.targets.filter((t) => keys.has(branchKey(t.branch))).reduce((s, t) => s + t.targetAmount, 0);
    const team = [...scored.values()].filter((p) => keys.has(branchKey(p.branch)));
    return { invoices, requests, target, team };
  };
  const allBranchRates = [...new Set(evidence.invoices.map((inv) => branchKey(inv.branch)).filter(Boolean))]
    .map((key) => { const rows = evidence.invoices.filter((inv) => branchKey(inv.branch) === key); return rows.length ? rows.filter((r) => r.coded).length / rows.length : null; })
    .filter((rate): rate is number => rate !== null);
  const branchRateMedian = median(allBranchRates);
  const measuredScores = (team: LabPersonScore[], key: string) =>
    team.map((p) => p.axes.find((a) => a.key === key)).filter((a): a is AxisResult => a?.status === 'measured');
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

  const pending = (key: Parameters<typeof notMeasurable>[0], reason: string) => notMeasurable(key, reason);
  const DORMANT: Record<string, string> = {
    inventory_counts: 'لم يُسجَّل أي جرد في النظام بعد — يحتاج تحديد دورية الجرد ومسؤوله',
    fast_movers: 'يحتاج تعريف الأصناف السريعة وربط الرصيد اليومي بالفرع',
    stagnant_expiry: 'قوائم الرواكد والصلاحية فاضية — تحتاج رفعًا دوريًا',
    shortages: 'سجل النواقص غير مستخدم حاليًا',
    standards_submissions: 'مسار صور النظافة والرص قيد البناء',
    standards_audit: 'مراجعة مدير الفروع بالعينة قيد البناء',
    agenda_closure: 'أجندة الاستثناءات اليومية قيد البناء',
    cs_followups: 'قائمة متابعات خدمة العملاء متوقفة منذ يوليو',
    complaints: 'لا توجد شكاوى مسجلة في النظام — يحتاج مسار تسجيل الشكاوى',
    audits: 'زيارات المراجعة الأسبوعية قيد البناء',
    bm_trend: 'يُحسب بعد إغلاق دورتين بنفس البطاقة',
  };

  /** v6.5 scorecard axes from data available today; the rest are pending with their reason. */
  const scorecardAxes = (
    keys: Set<string>,
    family: 'branch_manager' | 'branches_manager',
    b: ReturnType<typeof branchFacts>,
  ): AxisDraft[] => {
    const out: AxisDraft[] = [];
    const valid = b.invoices.filter((inv) => inv.net > 0);
    const net = valid.reduce((s, inv) => s + inv.net, 0);
    const previous = (evidence.previousBranchSales || []).filter((row) => keys.has(branchKey(row.branch)));
    const prevInvoices = previous.reduce((s, row) => s + row.invoices, 0);
    const prevNet = previous.reduce((s, row) => s + row.net, 0);
    const teamIds = new Set(b.team.map((p) => p.staffId));

    if (family === 'branch_manager') {
      // Sales and growth.
      if (evidence.previousBranchSales == null || !prevInvoices) {
        out.push(notMeasurable('customers_growth', 'مبيعات الدورة السابقة غير متاحة'));
        out.push(notMeasurable('avg_invoice_growth', 'مبيعات الدورة السابقة غير متاحة'));
      } else {
        const growth = valid.length / prevInvoices;
        out.push(measured('customers_growth', round(growth * 100), bandScore(growth, LAB_THRESHOLDS.customersGrowthFloor, LAB_THRESHOLDS.customersGrowthCeiling),
          `${egp(valid.length)} فاتورة مقابل ${egp(prevInvoices)} في الدورة السابقة (×${round(growth, 2)})`));
        const avgNow = valid.length ? net / valid.length : 0;
        const avgPrev = prevNet / prevInvoices;
        const ratio = avgPrev ? avgNow / avgPrev : 0;
        out.push(measured('avg_invoice_growth', round(ratio * 100), bandScore(ratio, LAB_THRESHOLDS.avgInvoiceGrowthFloor, LAB_THRESHOLDS.avgInvoiceGrowthCeiling),
          `متوسط ${egp(avgNow)} ج مقابل ${egp(avgPrev)} ج في الدورة السابقة (×${round(ratio, 2)})`));
      }
      // Team WhatsApp request capture (Master Brain).
      const capture = [...teamIds].map((id) => captureByStaff.get(id)).filter(Boolean) as Array<{ found: number; self: number }>;
      const found = capture.reduce((s, c) => s + c.found, 0);
      const self = capture.reduce((s, c) => s + c.self, 0);
      out.push(evidence.brainRequests == null || found < LAB_THRESHOLDS.minDetectedRequests
        ? notMeasurable('team_capture', `العقل المدبر وجد ${found} طلب للفريق (الحد ${LAB_THRESHOLDS.minDetectedRequests}) — يُقاس بعد اعتماد تحليل كل المحادثات`)
        : measured('team_capture', round((self / found) * 100), bandScore(self / found, LAB_THRESHOLDS.captureFloor, LAB_THRESHOLDS.captureCeiling),
          `الفريق سجّل ${self} من ${found} طلب وجدها العقل المدبر`));
      // Monthly evaluations of the team sent.
      const evals = evidence.teamEvaluations == null ? null : evidence.teamEvaluations.filter((row) => keys.has(branchKey(row.branch)));
      const sent = evals ? evals.filter((row) => row.sentAt || /^(sent|approved)$/i.test(String(row.status || ''))).length : 0;
      out.push(!evals || !evals.length
        ? notMeasurable('team_evaluations', 'حالة التقييمات الشهرية غير متاحة لهذه الجلسة')
        : measured('team_evaluations', round((sent / evals.length) * 100), (sent / evals.length) * 100,
          `اتبعت ${sent} من ${evals.length} تقييم · ${evals.filter((row) => /^draft$/i.test(String(row.status || ''))).length} مسودة`));
      // Policy breaches: employees above the missing-punch allowance.
      const over = [...teamIds].filter((id) => (facts.get(id)?.missingPunchDays || 0) > LAB_THRESHOLDS.missingPunchAllowance).length;
      out.push(teamIds.size
        ? measured('team_violations', over, Math.max(0, 100 - over * 25), `${over} موظف تجاوز سماح البصمات الناقصة (${LAB_THRESHOLDS.missingPunchAllowance} في الدورة)`)
        : notMeasurable('team_violations', 'لا يوجد فريق للفرع'));
      // Discounts: shown, scored once the owner sets the policy limit.
      const discount = valid.reduce((s, inv) => s + Math.max(0, Number(inv.discount) || 0), 0);
      out.push(notMeasurable('discount_policy', 'سياسة الحد الأقصى للخصم لم تُحدَّد بعد',
        `الخصم ${round((discount / Math.max(1, net + discount)) * 100, 2)}٪ من قيمة الفواتير · ${valid.filter((inv) => (Number(inv.discount) || 0) > 0).length} فاتورة بخصم`));
      for (const key of ['inventory_counts', 'fast_movers', 'stagnant_expiry', 'shortages', 'standards_submissions', 'standards_audit', 'agenda_closure'] as const) {
        out.push(pending(key, DORMANT[key]));
      }
    } else {
      // Customer service: customer data quality of the requests.
      const requests = b.requests.filter((r) => !INVALID_REQUEST_STATUS.test(String(r.status || '').toLowerCase()));
      const identified = requests.filter((r) => (r.customerCode && !/^[0\s.-]*$/.test(r.customerCode))
        || String(r.customerPhone || '').replace(/\D/g, '').length >= 8).length;
      const quality = share(identified, requests.length);
      out.push(quality === null
        ? notMeasurable('request_data_quality', 'لا توجد طلبات في الدورة')
        : measured('request_data_quality', round(quality * 100), bandScore(quality, LAB_THRESHOLDS.requestDataFloor, 1),
          `${identified} من ${requests.length} طلب فيه كود أو موبايل العميل`));
      // Monthly evaluations across the system.
      const evals = evidence.teamEvaluations;
      const sent = evals ? evals.filter((row) => row.sentAt || /^(sent|approved)$/i.test(String(row.status || ''))).length : 0;
      out.push(!evals || !evals.length
        ? notMeasurable('org_evaluations', 'حالة التقييمات الشهرية غير متاحة لهذه الجلسة')
        : measured('org_evaluations', round((sent / evals.length) * 100), (sent / evals.length) * 100, `اتبعت ${sent} من ${evals.length} تقييم في الفرعين`));
      for (const key of ['cs_followups', 'complaints', 'fast_movers', 'stagnant_expiry', 'audits', 'bm_trend'] as const) {
        out.push(pending(key, DORMANT[key]));
      }
    }
    // Purchase invoices reviewed (branch for the manager, all branches for the head).
    const purchases = evidence.purchaseInvoices == null ? null : evidence.purchaseInvoices.filter((row) => keys.has(branchKey(row.branch)));
    const reviewed = purchases ? purchases.filter((row) => row.reviewed).length : 0;
    out.push(!purchases
      ? notMeasurable('purchase_review', 'فواتير الشراء غير متاحة للقراءة من هذه الجلسة')
      : purchases.length < LAB_THRESHOLDS.minPurchaseInvoices
        ? notMeasurable('purchase_review', `${purchases.length} فاتورة شراء فقط (الحد ${LAB_THRESHOLDS.minPurchaseInvoices})`)
        : measured('purchase_review', round((reviewed / purchases.length) * 100), (reviewed / purchases.length) * 100,
          `اتراجع ${reviewed} من ${egp(purchases.length)} فاتورة شراء · ${egp(purchases.length - reviewed)} بانتظار المراجعة`));
    return out;
  };

  const managerAxes = (keys: Set<string>, family: 'branch_manager' | 'branches_manager'): AxisDraft[] => {
    const b = branchFacts(keys);
    const out: AxisDraft[] = [];
    const net = b.invoices.reduce((s, inv) => s + inv.net, 0);
    out.push(b.target > 0
      ? measured('branch_target', round((net / b.target) * 100), targetScore(net / b.target), `${egp(net)} من ${egp(b.target)} ج`)
      : notMeasurable('branch_target', 'لا يوجد تارجت مسجل للفرع'));
    const requests = version !== 'v6.0' ? b.requests.filter((r) => !INVALID_REQUEST_STATUS.test(String(r.status || '').toLowerCase())) : b.requests;
    const closed = requests.filter((r) => r.closedAt);
    const hours = closed.map((r) => (Date.parse(r.closedAt as string) - Date.parse(r.createdAt)) / 36e5).filter((h) => Number.isFinite(h) && h >= 0);
    const medianHours = median(hours);
    out.push(requests.length
      ? measured('requests_closure', round((closed.length / requests.length) * 100), closureScore(closed.length / requests.length, medianHours),
        `${closed.length}/${requests.length} تم تنفيذه · ${requests.length - closed.length} مفتوح · وسيط ${medianHours === null ? '—' : round(medianHours)} ساعة`)
      : notMeasurable('requests_closure', 'لا توجد طلبات عملاء في الدورة'));
    const discipline = measuredScores(b.team, 'discipline');
    out.push(discipline.length
      ? measured('team_discipline', discipline.length, mean(discipline.map((a) => a.score as number)), `متوسط ${discipline.length} موظف`)
      : notMeasurable('team_discipline', 'لا يوجد أعضاء بانضباط قابل للقياس'));
    const teamFacts = b.team.map((p) => facts.get(p.staffId)!).filter(Boolean);
    const pending = teamFacts.reduce((s, f) => s + f.pendingDecisionDays, 0);
    const worked = teamFacts.reduce((s, f) => s + f.workedDays, 0);
    if (atLeast(version, 'v6.4')) {
      const ids = new Set(b.requests.map((r) => r.id).filter(Boolean));
      const results = evidence.fulfillment == null ? null : evidence.fulfillment.filter((result) => ids.has(result.requestId));
      const s = results ? summarizeFulfillment(results) : null;
      out.push(!s
        ? notMeasurable('requests_fulfilled', 'أصناف الفواتير أو الكتالوج غير متاحة للقراءة من هذه الجلسة')
        : s.judged < LAB_THRESHOLDS.minJudgedRequests || s.share === null
          ? notMeasurable('requests_fulfilled', `${s.judged} طلب قابل للحكم فقط (الحد ${LAB_THRESHOLDS.minJudgedRequests})`,
            `${s.noCustomer} بدون كود عميل · ${s.windowOpen} لسه في مهلة الـ14 يوم`)
          : measured('requests_fulfilled', round(s.share * 100), bandScore(s.share, LAB_THRESHOLDS.fulfillmentFloor, LAB_THRESHOLDS.fulfillmentCeiling),
            `اشترى العميل ${s.fulfilled} طلب كامل و${s.partial} جزئي من ${s.judged} · لم يُشترَ ${s.notFound} · ${s.noCustomer} بدون كود عميل لا يُحكم عليها`));
    }
    if (version !== 'v6.0') {
      out.push(worked
        ? measured('decision_backlog', pending, bandScore(1 - pending / worked, 0.85, 1), `${pending} يوم حضور بانتظار قرار من ${worked} يوم عمل — للمعلومة حتى يُحدَّد صاحب القرار`)
        : notMeasurable('decision_backlog', 'لا توجد أيام حضور للفريق'));
    }
    if (atLeast(version, 'v6.5')) out.push(...scorecardAxes(keys, family, b));
    if (family === 'branch_manager') {
      const conv = measuredScores(b.team, 'conversation_quality');
      out.push(conv.length
        ? measured('team_conversations', conv.length, mean(conv.map((a) => a.score as number)), `متوسط ${conv.length} صيدلي`)
        : notMeasurable('team_conversations', 'لا توجد مراجعات رسمية كافية للفريق'));
      const rate = b.invoices.length ? b.invoices.filter((inv) => inv.coded).length / b.invoices.length : null;
      const codingScore = rate === null ? null : bandScore(rate, 0.9, 1);
      out.push(rate === null || branchRateMedian === null
        ? notMeasurable('branch_coding', 'لا توجد فواتير للفرع')
        : measured('branch_coding', round(rate * 100), codingScore as number, `${round(rate * 100)}٪ · وسيط الفروع ${round(branchRateMedian * 100)}٪`));
      if (version !== 'v6.0') {
        const parts = [...(conv.length ? [mean(conv.map((a) => a.score as number))] : []), ...(codingScore === null ? [] : [codingScore])];
        out.push(parts.length
          ? measured('team_quality', parts.length, mean(parts),
            `محادثات ${conv.length ? round(mean(conv.map((a) => a.score as number))) : '—'} · تكويد الفرع ${rate === null ? '—' : `${round(rate * 100)}٪`}`)
          : notMeasurable('team_quality', 'لا توجد مراجعات ولا فواتير للفرع'));
        const missing = teamFacts.reduce((s, f) => s + f.missingPunchDays, 0);
        const scheduled = teamFacts.reduce((s, f) => s + f.resolvedDays, 0);
        out.push(scheduled
          ? measured('team_followup', round((1 - missing / scheduled) * 100), bandScore(1 - missing / scheduled, LAB_THRESHOLDS.followupFloor, 1),
            `${missing} بصمة ناقصة لم تُصحَّح من ${scheduled} يوم شيفت للفريق`)
          : notMeasurable('team_followup', 'لا توجد أيام شيفت محسومة للفريق'));
      }
    }
    return out;
  };

  const results = [...scored.values()];
  const branchManagers = people.filter((p) => p.family === 'branch_manager');
  for (const manager of branchManagers) {
    const keys = new Set([branchKey(manager.branch)].filter(Boolean));
    const team = branchFacts(keys).team.map((p) => ({ staffId: p.staffId, name: p.name, total: p.total }));
    results.push({ staffId: manager.id, name: manager.name, branch: manager.branch, family: 'branch_manager', team,
      ...aggregate('branch_manager', managerAxes(keys, 'branch_manager'), { version }) });
  }
  const managerResults = results.filter((r) => r.family === 'branch_manager');
  for (const head of people.filter((p) => p.family === 'branches_manager')) {
    const keys = new Set(evidence.targets.map((t) => branchKey(t.branch)).filter(Boolean));
    const axesForHead = managerAxes(keys, 'branches_manager');
    const managerTotals = managerResults.filter((m) => m.total !== null);
    if (atLeast(version, 'v6.5')) {
      const weighted = managerTotals.map((m) => {
        const salesOf = evidence.invoices.filter((inv) => branchKey(inv.branch) === branchKey(m.branch) && inv.net > 0).reduce((s, inv) => s + inv.net, 0);
        return { total: m.total as number, weight: salesOf, name: m.name, branch: m.branch };
      }).filter((row) => row.weight > 0);
      const weightSum = weighted.reduce((s, row) => s + row.weight, 0);
      axesForHead.push(weightSum
        ? measured('branches_scorecard', weighted.length, weighted.reduce((s, row) => s + row.total * row.weight, 0) / weightSum,
          weighted.map((row) => `${row.branch || row.name}: ${Math.round(row.total)} (${round((row.weight / weightSum) * 100)}٪ من المبيعات)`).join(' · '))
        : notMeasurable('branches_scorecard', 'لا توجد بطاقات فروع محسوبة'));
    }
    axesForHead.push(managerTotals.length
      ? measured('branch_managers', managerTotals.length, mean(managerTotals.map((m) => m.total as number)), `متوسط ${managerTotals.length} مدير فرع`)
      : notMeasurable('branch_managers', 'لا توجد نتائج لمديري الفروع'));
    results.push({ staffId: head.id, name: head.name, branch: head.branch, family: 'branches_manager',
      team: managerResults.map((m) => ({ staffId: m.staffId, name: m.name, total: m.total })), ...aggregate('branches_manager', axesForHead, { version }) });
  }
  return results.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}
