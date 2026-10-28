import { normalizeBranchName } from '@/lib/branch';
import { ABSENCE_WITH_DEDUCTION, LAB_THRESHOLDS, NON_PUNCTUALITY_ATTENDANCE, PUNCTUALITY_BANDS, UNRESOLVED_ATTENDANCE, labFamilyOf, type LabFamily } from './catalog';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import {
  aggregate, bandScore, closureScore, deviationScore, disciplineScore, measured, median, notMeasurable,
  percentileAmong, shrunkMean, targetScore, type AxisResult, type LabScore,
} from './scoring';

// Pure cycle computation: canonical evidence in, one score per employee out. No I/O.

export interface LabEvidence {
  staff: Array<{ id: string; name: string; role: string; branch: string | null }>;
  invoices: Array<{ staffId: string | null; net: number; coded: boolean; branch: string | null; deliveryStaffId: string | null }>;
  /** Official conversation reviews only (0..100). */
  reviews: Array<{ staffId: string; score: number }>;
  attendance: Array<{ staffId: string; date: string; status: string | null; hasFirstIn: boolean; scheduled: boolean; lateMinutes: number }>;
  requests: Array<{ recordedStaffId: string | null; branch: string | null; createdAt: string; closedAt: string | null }>;
  /** null when the source cannot be read by this session (its axis becomes not measurable). */
  purchases: Array<{ enteredByStaffId: string | null }> | null;
  targets: Array<{ branch: string; targetAmount: number }>;
  /** Sources with no rows in the cycle (e.g. follow-ups): shown as dormant. */
  dormantSources: string[];
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

interface PersonFacts {
  workedDays: number;
  resolvedDays: number;
  onTimeDays: number;
  halfDays: number;
  lateMinutes: number;
  unresolvedDays: number;
  invoices: number;
  coded: number;
  net: number;
  reviews: number[];
  requests: number;
  purchases: number;
  deliveries: number;
}

function factsFor(evidence: LabEvidence): Map<string, PersonFacts> {
  const facts = new Map<string, PersonFacts>();
  const get = (id: string) => {
    let row = facts.get(id);
    if (!row) {
      row = { workedDays: 0, resolvedDays: 0, onTimeDays: 0, halfDays: 0, lateMinutes: 0, unresolvedDays: 0, invoices: 0, coded: 0, net: 0, reviews: [], requests: 0, purchases: 0, deliveries: 0 };
      facts.set(id, row);
    }
    return row;
  };
  for (const person of evidence.staff) get(person.id);
  for (const day of evidence.attendance) {
    const row = get(day.staffId);
    if (day.hasFirstIn) row.workedDays += 1;
    const status = String(day.status || '');
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
  for (const request of evidence.requests) if (request.recordedStaffId) get(request.recordedStaffId).requests += 1;
  for (const purchase of evidence.purchases || []) if (purchase.enteredByStaffId) get(purchase.enteredByStaffId).purchases += 1;
  return facts;
}

const perDay = (count: number, days: number) => count / days;

function disciplineAxis(f: PersonFacts): AxisDraft {
  if (f.resolvedDays < LAB_THRESHOLDS.minResolvedDays) {
    return notMeasurable('discipline', `${f.resolvedDays} يوم محسوم فقط (الحد ${LAB_THRESHOLDS.minResolvedDays})`, `${f.unresolvedDays} يوم ينتظر المراجعة`);
  }
  const credit = (f.onTimeDays + f.halfDays / 2) / f.resolvedDays;
  const late = f.lateMinutes / f.resolvedDays;
  const beyond = f.resolvedDays - f.onTimeDays - f.halfDays;
  return measured('discipline', round(credit * 100), disciplineScore(credit),
    `${f.onTimeDays} يوم ≤${PUNCTUALITY_BANDS.graceMinutes}د · ${f.halfDays} يوم حتى ${PUNCTUALITY_BANDS.halfCreditMinutes}د · ${beyond} يوم أكثر · متوسط ${round(late)} د/يوم · ${f.unresolvedDays} يوم بانتظار المراجعة`);
}

/** Percentile axis over a per-worked-day rate among the family's measurable members. */
function rateAxis(
  key: 'sales_per_day' | 'customer_requests' | 'purchase_entry' | 'deliveries_per_day',
  members: Array<{ id: string; f: PersonFacts }>,
  pick: (f: PersonFacts) => number,
  unit: string,
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
      : measured(key, round(rate, 2), pct, `${round(rate, 2)} ${unit} · ترتيب ${round(pct)}٪ بين ${peers.length}`));
  }
  return out;
}

export function buildCycleScores(evidence: LabEvidence): LabPersonScore[] {
  const facts = factsFor(evidence);
  const people = evidence.staff
    .map((person) => ({ ...person, family: labFamilyOf(canonicalStaffRole(person.role)) }))
    .filter((person): person is typeof person & { family: LabFamily } => person.family !== null);
  const familyMembers = (family: LabFamily) => people.filter((p) => p.family === family).map((p) => ({ id: p.id, f: facts.get(p.id)! }));
  const axes = new Map<string, AxisDraft[]>();
  const push = (id: string, axis: AxisDraft) => axes.set(id, [...(axes.get(id) || []), axis]);

  // Doctors.
  const doctors = familyMembers('doctor');
  rateAxis('sales_per_day', doctors, (f) => f.net, 'ج/يوم').forEach((axis, id) => push(id, axis));
  rateAxis('customer_requests', doctors, (f) => f.requests, 'طلب/يوم').forEach((axis, id) => push(id, axis));
  const doctorRates = doctors.filter((d) => d.f.invoices >= LAB_THRESHOLDS.minInvoicesForCoding).map((d) => d.f.coded / d.f.invoices);
  const doctorRateMedian = median(doctorRates);
  const allReviews = doctors.flatMap((d) => d.f.reviews);
  const populationMean = allReviews.length ? allReviews.reduce((s, v) => s + v, 0) / allReviews.length : 0;
  const shrunk = new Map(doctors.filter((d) => d.f.reviews.length >= LAB_THRESHOLDS.minOfficialReviews)
    .map((d) => [d.id, shrunkMean(d.f.reviews.reduce((s, v) => s + v, 0) / d.f.reviews.length, d.f.reviews.length, populationMean)]));
  const shrunkPeers = [...shrunk.values()];
  for (const { id, f } of doctors) {
    push(id, disciplineAxis(f));
    push(id, f.invoices < LAB_THRESHOLDS.minInvoicesForCoding || doctorRateMedian === null
      ? notMeasurable('coding_quality', `${f.invoices} فاتورة فقط (الحد ${LAB_THRESHOLDS.minInvoicesForCoding})`)
      : measured('coding_quality', round((f.coded / f.invoices) * 100), bandScore(f.coded / f.invoices, 0.9, 1),
        `${f.coded}/${f.invoices} مكوّدة · وسيط الزملاء ${round(doctorRateMedian * 100)}٪`));
    const s = shrunk.get(id);
    const pct = s === undefined ? null : percentileAmong(s, shrunkPeers);
    push(id, s === undefined
      ? notMeasurable('conversation_quality', `${f.reviews.length} مراجعة رسمية فقط (الحد ${LAB_THRESHOLDS.minOfficialReviews})`)
      : pct === null
        ? notMeasurable('conversation_quality', 'زملاء قابلون للمقارنة غير كافين', `${round(s)}/100`)
        : measured('conversation_quality', round(s), bandScore(s, 90, 100), `${f.reviews.length} مراجعة · متوسط معدّل ${round(s)}/100 · ترتيب ${round(pct)}٪ بين الزملاء`));
    if (evidence.dormantSources.includes('followups')) push(id, notMeasurable('followups', 'لا توجد متابعات مسجلة في هذه الدورة (المصدر متوقف)'));
  }

  // Assistants and delivery.
  const assistants = familyMembers('assistant');
  if (evidence.purchases === null) {
    for (const { id } of assistants) push(id, notMeasurable('purchase_entry', 'فواتير المشتريات غير متاحة للقراءة من هذه الجلسة'));
  } else {
    rateAxis('purchase_entry', assistants, (f) => f.purchases, 'فاتورة/يوم').forEach((axis, id) => push(id, axis));
  }
  rateAxis('customer_requests', assistants, (f) => f.requests, 'طلب/يوم').forEach((axis, id) => push(id, axis));
  for (const { id, f } of assistants) push(id, disciplineAxis(f));
  const couriers = familyMembers('delivery');
  rateAxis('deliveries_per_day', couriers, (f) => f.deliveries, 'توصيلة/يوم').forEach((axis, id) => push(id, axis));
  for (const { id, f } of couriers) push(id, disciplineAxis(f));

  const scored = new Map<string, LabPersonScore>();
  for (const person of people) {
    if (person.family === 'branch_manager' || person.family === 'branches_manager') continue;
    scored.set(person.id, { staffId: person.id, name: person.name, branch: person.branch, family: person.family, ...aggregate(person.family, axes.get(person.id) || []) });
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

  const managerAxes = (keys: Set<string>, family: 'branch_manager' | 'branches_manager'): AxisDraft[] => {
    const b = branchFacts(keys);
    const out: AxisDraft[] = [];
    const net = b.invoices.reduce((s, inv) => s + inv.net, 0);
    out.push(b.target > 0
      ? measured('branch_target', round((net / b.target) * 100), targetScore(net / b.target), `${Math.round(net).toLocaleString('ar-EG')} من ${Math.round(b.target).toLocaleString('ar-EG')} ج`)
      : notMeasurable('branch_target', 'لا يوجد تارجت مسجل للفرع'));
    const closed = b.requests.filter((r) => r.closedAt);
    const hours = closed.map((r) => (Date.parse(r.closedAt as string) - Date.parse(r.createdAt)) / 36e5).filter((h) => Number.isFinite(h) && h >= 0);
    const medianHours = median(hours);
    out.push(b.requests.length
      ? measured('requests_closure', round((closed.length / b.requests.length) * 100), closureScore(closed.length / b.requests.length, medianHours),
        `${closed.length}/${b.requests.length} مغلق · وسيط ${medianHours === null ? '—' : round(medianHours)} ساعة`)
      : notMeasurable('requests_closure', 'لا توجد طلبات عملاء في الدورة'));
    const disciplineScores = b.team.map((p) => p.axes.find((a) => a.key === 'discipline')).filter((a): a is AxisResult => a?.status === 'measured');
    out.push(disciplineScores.length
      ? measured('team_discipline', disciplineScores.length, disciplineScores.reduce((s, a) => s + (a.score as number), 0) / disciplineScores.length, `متوسط ${disciplineScores.length} موظف`)
      : notMeasurable('team_discipline', 'لا يوجد أعضاء بانضباط قابل للقياس'));
    if (family === 'branch_manager') {
      const conv = b.team.map((p) => p.axes.find((a) => a.key === 'conversation_quality')).filter((a): a is AxisResult => a?.status === 'measured');
      out.push(conv.length
        ? measured('team_conversations', conv.length, conv.reduce((s, a) => s + (a.score as number), 0) / conv.length, `متوسط ${conv.length} صيدلي`)
        : notMeasurable('team_conversations', 'لا توجد مراجعات رسمية كافية للفريق'));
      const rate = b.invoices.length ? b.invoices.filter((inv) => inv.coded).length / b.invoices.length : null;
      out.push(rate === null || branchRateMedian === null
        ? notMeasurable('branch_coding', 'لا توجد فواتير للفرع')
        : measured('branch_coding', round(rate * 100), bandScore(rate, 0.9, 1), `${round(rate * 100)}٪ · وسيط الفروع ${round(branchRateMedian * 100)}٪`));
    }
    return out;
  };

  const results = [...scored.values()];
  const branchManagers = people.filter((p) => p.family === 'branch_manager');
  for (const manager of branchManagers) {
    const keys = new Set([branchKey(manager.branch)].filter(Boolean));
    const team = branchFacts(keys).team.map((p) => ({ staffId: p.staffId, name: p.name, total: p.total }));
    results.push({ staffId: manager.id, name: manager.name, branch: manager.branch, family: 'branch_manager', team, ...aggregate('branch_manager', managerAxes(keys, 'branch_manager')) });
  }
  const managerResults = results.filter((r) => r.family === 'branch_manager');
  for (const head of people.filter((p) => p.family === 'branches_manager')) {
    const keys = new Set(evidence.targets.map((t) => branchKey(t.branch)).filter(Boolean));
    const axesForHead = managerAxes(keys, 'branches_manager');
    const managerTotals = managerResults.filter((m) => m.total !== null);
    axesForHead.push(managerTotals.length
      ? measured('branch_managers', managerTotals.length, managerTotals.reduce((s, m) => s + (m.total as number), 0) / managerTotals.length, `متوسط ${managerTotals.length} مدير فرع`)
      : notMeasurable('branch_managers', 'لا توجد نتائج لمديري الفروع'));
    results.push({ staffId: head.id, name: head.name, branch: head.branch, family: 'branches_manager',
      team: managerResults.map((m) => ({ staffId: m.staffId, name: m.name, total: m.total })), ...aggregate('branches_manager', axesForHead) });
  }
  return results.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}
