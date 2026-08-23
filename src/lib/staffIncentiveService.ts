import { getCurrentCycle, getCycleForDate, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import { STARTING_POINTS, MAX_BASE_INCENTIVE } from '@/lib/points';
import { calculateMonthlyIncentive } from '@/lib/performance/performanceRulesEngine';
import {
  formatTransactionSource,
  getTransactionShortReason,
  isApprovedPointRecord,
  isRecordInCycle,
  pointRecordDelta,
  pointRecordStatus,
  recordBelongsToStaff,
  type PointLedgerRecord,
  type StaffLedgerTarget,
} from '@/lib/pointsLedger';
import { isSupabaseConfigured } from '@/lib/supabase';
import { readEmployeeTransactions } from '@/lib/readModels/employeeTransactionReadModel';
import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';

export type StaffIncentiveTransaction = PointLedgerRecord & {
  normalizedDelta: number;
  absPoints: number;
  sourceLabel: string;
  shortReason: string;
  includedInFinalPoints: boolean;
  exclusionReason?: string;
  duplicateWarning?: string;
  moneyAmount?: number;
  isQuarterlyCashReward?: boolean;
};

export type StaffCycleIncentive = {
  staff: StaffLedgerTarget;
  cycleStart: string;
  cycleEnd: string;
  startingPoints: number;
  approvedRewardPoints: number;
  approvedDeductionPoints: number;
  pendingRewardPoints: number;
  pendingDeductionPoints: number;
  finalPoints: number;
  expectedFinalPoints?: number;
  distinctionPointsAbove500: number;
  incentiveValue: number;
  maxIncentiveValue: number;
  progressPercent: number;
  rewardTransactions: StaffIncentiveTransaction[];
  deductionTransactions: StaffIncentiveTransaction[];
  pendingTransactions: StaffIncentiveTransaction[];
  excludedTransactions: StaffIncentiveTransaction[];
  cashRewardTransactions: StaffIncentiveTransaction[];
  quarterlyCashRewards: number;
  sourceBreakdown: Array<{ source: string; points: number; count: number }>;
  warnings: string[];
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function numberOrZero(value: unknown) {
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

function getRowMetadata(row: PointLedgerRecord) {
  return row.metadata && typeof row.metadata === 'object'
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function rowText(row: PointLedgerRecord) {
  const meta = getRowMetadata(row);
  return [
    row.source_type,
    row.source,
    row.source_module,
    row.reason,
    row.description,
    row.title,
    row.manager_note,
    meta.source_type,
    meta.source,
    meta.source_module,
    meta.rule_code,
    meta.impact_type,
    meta.category,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
}

export function isQuarterlyCashRewardRecord(row: PointLedgerRecord) {
  const delta = pointRecordDelta(row);
  if (delta <= 0) return false;
  const text = rowText(row);
  const isStagnantOrList =
    /(stagnant|stagnant_medicine|incentive_medicine|list_item|list_items|medicine_sales|راكد|رواكد|لسته|لستة|اصناف اللسته|أصناف اللستة|صنف حافز|صرف لست)/i.test(
      text
    );
  if (!isStagnantOrList) return false;
  const isExplicitMonthly =
    /(monthly_exceptional_reward|monthly_points|نقاط شهريه|نقاط شهرية)/i.test(text);
  return !isExplicitMonthly;
}

export function getQuarterlyCashAmount(row: PointLedgerRecord) {
  const meta = getRowMetadata(row);
  const candidates = [
    (row as any).total_incentive,
    (row as any).incentive_total,
    (row as any).money_amount,
    (row as any).money_delta,
    (row as any).reward_amount,
    (row as any).amount,
    meta.total_incentive,
    meta.incentive_total,
    meta.money_amount,
    meta.money_delta,
    meta.reward_amount,
    meta.amount,
  ];
  for (const candidate of candidates) {
    const n = numberOrZero(candidate);
    if (n > 0) return n;
  }
  return Math.abs(pointRecordDelta(row));
}

function createDuplicateKey(row: PointLedgerRecord): string {
  const sourceType = row.source_type || row.source || 'unknown';
  const sourceId = row.source_id || '';
  const staffId = row.staff_id || row.employee_id || '';
  const date = (row.created_at || '').slice(0, 10);
  const delta = String(row.points_delta ?? row.points ?? '');
  const reason = (row.reason || row.manager_note || '').slice(0, 50);
  return `${sourceType}:${sourceId}:${staffId}:${date}:${delta}:${reason}`;
}

function deduplicatePointRecords(records: PointLedgerRecord[]) {
  const seen = new Map<string, PointLedgerRecord>();
  const duplicates = new Map<string, PointLedgerRecord[]>();

  for (const row of records) {
    const key = row.id ? `id:${row.id}` : createDuplicateKey(row);
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      if (!duplicates.has(key)) duplicates.set(key, [existing]);
      duplicates.get(key)!.push(row);
    } else {
      seen.set(key, row);
    }
  }
  return { records: [...seen.values()], duplicates };
}

function normalizeTxn(
  row: PointLedgerRecord,
  includedInFinalPoints = true,
  exclusionReason?: string,
  duplicateWarning?: string
): StaffIncentiveTransaction {
  const delta = pointRecordDelta(row);
  const isCash = isQuarterlyCashRewardRecord(row);
  return {
    ...row,
    normalizedDelta: isCash ? 0 : delta,
    absPoints: isCash ? 0 : Math.abs(delta),
    sourceLabel: formatTransactionSource(row),
    shortReason: getTransactionShortReason(row),
    includedInFinalPoints: includedInFinalPoints && !isCash,
    exclusionReason: isCash
      ? 'مكافأة مالية للرواكد/اللستة تُحسب في الحافز الربع سنوي ولا تدخل نقاط الشهر'
      : exclusionReason,
    duplicateWarning,
    moneyAmount: isCash ? getQuarterlyCashAmount(row) : 0,
    isQuarterlyCashReward: isCash,
  };
}

export function calculateStaffCycleIncentiveFromRows(args: {
  staff: StaffLedgerTarget;
  records: PointLedgerRecord[];
  cycle?: PharmacyCycle;
}): StaffCycleIncentive {
  const cycle = args.cycle || getCurrentCycle();
  const staff = args.staff;
  const startingPoints = STARTING_POINTS;
  const warnings: string[] = [];

  const { records: dedupedRecords, duplicates } = deduplicatePointRecords(args.records);
  if (duplicates.size > 0) {
    warnings.push(`تم اكتشاف ${duplicates.size} سجل مكرر. تم احتسابهم مرة واحدة فقط.`);
  }

  const staffRows = dedupedRecords
    .filter((row) => recordBelongsToStaff(row, staff))
    .filter((row) => isRecordInCycle(row, cycle))
    .map((row) =>
      normalizeTxn(
        row,
        true,
        undefined,
        duplicates.has(createDuplicateKey(row)) ? 'سجل مكرر' : undefined
      )
    );

  const approved = staffRows.filter((row) => isApprovedPointRecord(row));
  const pending = staffRows.filter((row) => pointRecordStatus(row) === 'pending');
  const rejected = staffRows.filter((row) =>
    ['rejected', 'cancelled'].includes(pointRecordStatus(row))
  );
  if (rejected.length) warnings.push(`${rejected.length} سجل مرفوض/ملغي لا يدخل في الحافز.`);

  const cashRewardTransactions = approved.filter((row) => row.isQuarterlyCashReward);
  const monthlyApproved = approved.filter((row) => !row.isQuarterlyCashReward);
  const monthlyPending = pending.filter((row) => !row.isQuarterlyCashReward);
  const rewardTransactions = monthlyApproved.filter((row) => row.normalizedDelta > 0);
  const deductionTransactions = monthlyApproved.filter((row) => row.normalizedDelta < 0);
  const pendingTransactions = monthlyPending;
  const excludedTransactions = [
    ...rejected.map((row) => normalizeTxn(row, false, 'مرفوض/ملغي')),
    ...approved
      .filter((row) => row.isQuarterlyCashReward)
      .map((row) => ({ ...row, includedInFinalPoints: false })),
    ...pending
      .filter((row) => row.isQuarterlyCashReward)
      .map((row) => ({ ...row, includedInFinalPoints: false })),
  ];
  const quarterlyCashRewards = cashRewardTransactions.reduce(
    (sum, row) => sum + (row.moneyAmount || 0),
    0
  );
  if (quarterlyCashRewards > 0) {
    warnings.push(
      `تم فصل ${quarterlyCashRewards.toLocaleString('ar-EG')} جنيه مكافآت رواكد/لستة عن نقاط الشهر وإضافتها للحافز الربع سنوي.`
    );
  }

  const approvedRewardPoints = rewardTransactions.reduce((sum, row) => sum + row.absPoints, 0);
  const approvedDeductionPoints = deductionTransactions.reduce(
    (sum, row) => sum + row.absPoints,
    0
  );
  const pendingRewardPoints = monthlyPending
    .filter((row) => row.normalizedDelta > 0)
    .reduce((sum, row) => sum + row.absPoints, 0);
  const pendingDeductionPoints = monthlyPending
    .filter((row) => row.normalizedDelta < 0)
    .reduce((sum, row) => sum + row.absPoints, 0);

  const monthly = calculateMonthlyIncentive({
    startingPoints,
    approvedDeductionPoints,
    approvedExceptionalRewardPoints: approvedRewardPoints,
    pendingDeductionPoints,
    pendingRewardPoints,
  });
  const finalPoints = monthly.finalPoints;
  if (monthly.distinctionPointsAbove500 > 0) {
    warnings.push(
      'النقاط النهائية أعلى من 500؛ الحافز النقدي الشهري مقفول عند 1500 جنيه، والزيادة تظهر كنقاط تميز فقط.'
    );
  }

  const sourceMap = new Map<string, { source: string; points: number; count: number }>();
  for (const row of monthlyApproved) {
    const source = row.sourceLabel || 'سجل نقاط';
    const current = sourceMap.get(source) || { source, points: 0, count: 0 };
    current.points += row.normalizedDelta;
    current.count += 1;
    sourceMap.set(source, current);
  }

  const expectedFinalPoints = startingPoints + approvedRewardPoints - approvedDeductionPoints;
  if (Math.abs(finalPoints - expectedFinalPoints) > 0.01) {
    warnings.push(
      `⚠️ عدم تطابق في الحساب: المتوقع ${expectedFinalPoints} نقطة لكن النتيجة ${finalPoints} نقطة`
    );
  }

  return {
    staff,
    cycleStart: dateKey(cycle.start),
    cycleEnd: dateKey(cycle.end),
    startingPoints,
    approvedRewardPoints,
    approvedDeductionPoints,
    pendingRewardPoints,
    pendingDeductionPoints,
    finalPoints,
    expectedFinalPoints,
    distinctionPointsAbove500: monthly.distinctionPointsAbove500,
    incentiveValue: monthly.monthlyIncentiveValue,
    maxIncentiveValue: MAX_BASE_INCENTIVE,
    progressPercent: monthly.progressPercent,
    rewardTransactions,
    deductionTransactions,
    pendingTransactions,
    excludedTransactions,
    cashRewardTransactions,
    quarterlyCashRewards,
    sourceBreakdown: [...sourceMap.values()],
    warnings,
  };
}

function cycleForArgs(start?: string, end?: string): PharmacyCycle {
  if (!start) return getCurrentCycle();
  const cycle = getCycleForDate(new Date(`${start.slice(0, 10)}T12:00:00`));
  if (end && dateKey(cycle.end) !== end.slice(0, 10)) {
    return {
      ...cycle,
      start: new Date(`${start.slice(0, 10)}T00:00:00`),
      end: new Date(`${end.slice(0, 10)}T23:59:59`),
    };
  }
  return cycle;
}

function ledgerRow(row: Record<string, unknown>): PointLedgerRecord {
  const rawPoints = numberOrZero(row.points);
  const explicitDelta = row.points_delta === null || row.points_delta === undefined
    ? null
    : numberOrZero(row.points_delta);
  const type = String(row.type || '').toLowerCase();
  const derivedDelta =
    explicitDelta !== null
      ? explicitDelta
      : type === 'penalty' || type === 'deduction'
        ? -Math.abs(rawPoints)
        : Math.abs(rawPoints);

  return {
    ...(row as PointLedgerRecord),
    source_type: String(row.source || 'employee_transactions'),
    source_id: (row.source_id as string | null | undefined) || (row.id as string | null | undefined),
    staff_id: (row.staff_id as string | null | undefined) || (row.employee_id as string | null | undefined),
    employee_id: row.employee_id as string | null | undefined,
    employee_name: row.employee_name as string | null | undefined,
    points_delta: derivedDelta,
    points: Math.abs(rawPoints || derivedDelta),
    reason: String(row.reason || row.description || ''),
    created_at: String(row.created_at || row.transaction_date || ''),
    status: String(row.status || 'active'),
  };
}

async function staffTarget(args: {
  staffId?: string | null;
  staffName?: string | null;
  branch?: string | null;
}): Promise<StaffLedgerTarget> {
  const directory = await readStaffDirectory();
  const id = String(args.staffId || '').trim();
  const name = String(args.staffName || '').trim();
  const normalizedName = name.toLowerCase();
  const candidates = directory.filter((row) => {
    if (row.source === 'alias') return false;
    if (id && row.id === id) return true;
    return !id && name && String(row.name || '').trim().toLowerCase() === normalizedName;
  });
  const selected = candidates.length === 1 ? candidates[0] : candidates.find((row) => row.id === id);
  return {
    id: selected?.id || args.staffId || null,
    name: selected?.name || args.staffName || 'غير محدد',
    branch: selected?.branch || args.branch || null,
    points: STARTING_POINTS,
    max_points: STARTING_POINTS,
  } as StaffLedgerTarget;
}

export async function getStaffCycleIncentive(args: {
  staffId?: string | null;
  staffName?: string | null;
  branch?: string | null;
  cycleStart?: string;
  cycleEnd?: string;
}): Promise<StaffCycleIncentive> {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');
  const cycle = cycleForArgs(args.cycleStart, args.cycleEnd);
  const staff = await staffTarget(args);
  const staffId = String(staff.id || '').trim();
  if (!staffId) throw new Error('تعذر تحديد staff_id للحافز.');

  const rows = await readEmployeeTransactions({
    staffId,
    startDate: dateKey(cycle.start),
    endDate: dateKey(cycle.end),
    limit: 5000,
  });
  const result = calculateStaffCycleIncentiveFromRows({
    staff,
    records: rows.map(ledgerRow),
    cycle,
  });
  if (!rows.length) result.warnings.push('لا توجد حركات Ledger للموظف في الدورة المحددة.');
  return result;
}

export async function getStaffIncentiveSummaryForCycle(args: {
  cycle?: PharmacyCycle;
  branch?: string | null;
}) {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');
  const cycle = args.cycle || getCurrentCycle();
  const directory = await readStaffDirectory();
  const branch = String(args.branch || '').trim();
  const activeStaff = directory.filter(
    (row) =>
      row.source !== 'alias' &&
      row.active !== false &&
      (!branch || branch === 'الكل' || row.branch === branch)
  );
  const rows = await readEmployeeTransactions({
    startDate: dateKey(cycle.start),
    endDate: dateKey(cycle.end),
    limit: 5000,
  });
  const records = rows.map(ledgerRow);

  return activeStaff.map((row) =>
    calculateStaffCycleIncentiveFromRows({
      staff: {
        id: row.id,
        name: row.name,
        branch: row.branch,
        points: STARTING_POINTS,
        max_points: STARTING_POINTS,
      } as StaffLedgerTarget,
      records,
      cycle,
    })
  );
}
