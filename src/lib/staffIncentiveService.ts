import { getCurrentCycle, type PharmacyCycle } from "@/lib/pharmacy-cycle";
import { STARTING_POINTS, MAX_BASE_INCENTIVE } from "@/lib/points";
import { calculateMonthlyIncentive } from "@/lib/incentives/incentiveRulesEngine";
import {
  canonicalMaxPoints,
  canonicalSnapshotPoints,
  formatTransactionSource,
  getTransactionShortReason,
  isApprovedPointRecord,
  isRecordInCycle,
  pointRecordDelta,
  pointRecordStatus,
  recordBelongsToStaff,
  type PointLedgerRecord,
  type StaffLedgerTarget,
} from "@/lib/pointsLedger";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { TABLES } from "@/lib/supabaseTables";

export type StaffIncentiveTransaction = PointLedgerRecord & {
  normalizedDelta: number;
  absPoints: number;
  sourceLabel: string;
  shortReason: string;
  includedInFinalPoints: boolean;
  exclusionReason?: string;
  duplicateWarning?: string;
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
  sourceBreakdown: Array<{ source: string; points: number; count: number }>;
  warnings: string[];
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeName(value: unknown) {
  return String(value || "")
    .replace(/[\u0623\u0625\u0622]/g, "ا")
    .replace(/\u0629/g, "ه")
    .replace(/^(\u062f|dr|doctor)\s*\/?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// منع التكرار باستخدام مفتاح مركب من source_type, source_id, staff_id, date, points_delta, reason
function createDuplicateKey(row: PointLedgerRecord): string {
  const sourceType = row.source_type || row.source || "unknown";
  const sourceId = row.source_id || "";
  const staffId = row.staff_id || row.employee_id || "";
  const date = (row.created_at || "").slice(0, 10);
  const delta = String(row.points_delta ?? row.points ?? "");
  const reason = (row.reason || row.manager_note || "").slice(0, 50);
  return `${sourceType}:${sourceId}:${staffId}:${date}:${delta}:${reason}`;
}

function deduplicatePointRecords(records: PointLedgerRecord[]): { records: PointLedgerRecord[]; duplicates: Map<string, PointLedgerRecord[]> } {
  const seen = new Map<string, PointLedgerRecord>();
  const duplicates = new Map<string, PointLedgerRecord[]>();
  
  for (const row of records) {
    const key = row.id
      ? `id:${row.id}`
      : createDuplicateKey(row);
    
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      if (!duplicates.has(key)) {
        duplicates.set(key, [existing]);
      }
      duplicates.get(key)!.push(row);
    } else {
      seen.set(key, row);
    }
  }
  
  return { records: [...seen.values()], duplicates };
}

function uniqById(rows: PointLedgerRecord[]) {
  const map = new Map<string, PointLedgerRecord>();
  for (const row of rows) {
    const key = String(row.id || `${row.source_type || row.source}:${row.source_id || ""}:${row.created_at || ""}:${row.points_delta || row.points || ""}`);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function normalizeTxn(row: PointLedgerRecord, includedInFinalPoints: boolean = true, exclusionReason?: string, duplicateWarning?: string): StaffIncentiveTransaction {
  const delta = pointRecordDelta(row);
  return {
    ...row,
    normalizedDelta: delta,
    absPoints: Math.abs(delta),
    sourceLabel: formatTransactionSource(row),
    shortReason: getTransactionShortReason(row),
    includedInFinalPoints,
    exclusionReason,
    duplicateWarning,
  };
}

export function calculateStaffCycleIncentiveFromRows(args: {
  staff: StaffLedgerTarget;
  records: PointLedgerRecord[];
  cycle?: PharmacyCycle;
}): StaffCycleIncentive {
  const cycle = args.cycle || getCurrentCycle();
  const staff = args.staff;
  const startingPoints = STARTING_POINTS; // دائماً 500 نقطة بداية الدورة
  const warnings: string[] = [];

  // منع التكرار
  const { records: dedupedRecords, duplicates } = deduplicatePointRecords(args.records);
  if (duplicates.size > 0) {
    warnings.push(`تم اكتشاف ${duplicates.size} سجل مكرر. تم احتسابهم مرة واحدة فقط.`);
  }

  const staffRows = dedupedRecords
    .filter((row) => recordBelongsToStaff(row, staff))
    .filter((row) => isRecordInCycle(row, cycle))
    .map((row) => normalizeTxn(row, true, undefined, duplicates.has(createDuplicateKey(row)) ? "سجل مكرر" : undefined));

  const approved = staffRows.filter((row) => isApprovedPointRecord(row));
  const pending = staffRows.filter((row) => pointRecordStatus(row) === "pending");
  const rejected = staffRows.filter((row) => ["rejected", "cancelled"].includes(pointRecordStatus(row)));
  if (rejected.length) warnings.push(`${rejected.length} سجل مرفوض/ملغي لا يدخل في الحافز.`);

  const rewardTransactions = approved.filter((row) => row.normalizedDelta > 0);
  const deductionTransactions = approved.filter((row) => row.normalizedDelta < 0);
  const pendingTransactions = pending;
  const excludedTransactions = rejected.map((row) => normalizeTxn(row, false, "مرفوض/ملغي"));
  
  const approvedRewardPoints = rewardTransactions.reduce((sum, row) => sum + row.absPoints, 0);
  const approvedDeductionPoints = deductionTransactions.reduce((sum, row) => sum + row.absPoints, 0);
  const pendingRewardPoints = pending.filter((row) => row.normalizedDelta > 0).reduce((sum, row) => sum + row.absPoints, 0);
  const pendingDeductionPoints = pending.filter((row) => row.normalizedDelta < 0).reduce((sum, row) => sum + row.absPoints, 0);
  const monthly = calculateMonthlyIncentive({
    startingPoints,
    approvedDeductionPoints,
    approvedExceptionalRewardPoints: approvedRewardPoints,
    pendingDeductionPoints,
    pendingRewardPoints,
  });
  const finalPoints = monthly.finalPoints;
  if (monthly.distinctionPointsAbove500 > 0) warnings.push("النقاط النهائية أعلى من 500؛ الحافز النقدي الشهري مقفول عند 1500 جنيه، والزيادة تظهر كنقاط تميز فقط.");

  const sourceMap = new Map<string, { source: string; points: number; count: number }>();
  for (const row of approved) {
    const source = row.sourceLabel || "سجل نقاط";
    const current = sourceMap.get(source) || { source, points: 0, count: 0 };
    current.points += row.normalizedDelta;
    current.count += 1;
    sourceMap.set(source, current);
  }

  // التحقق من صحة الحساب
  const expectedFinalPoints = startingPoints + approvedRewardPoints - approvedDeductionPoints;
  if (Math.abs(finalPoints - expectedFinalPoints) > 0.01) {
    warnings.push(`⚠️ عدم تطابق في الحساب: المتوقع ${expectedFinalPoints} نقطة لكن النتيجة ${finalPoints} نقطة`);
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
    sourceBreakdown: [...sourceMap.values()],
    warnings,
  };
}

export async function getStaffCycleIncentive(args: {
  staffId?: string | null;
  staffName?: string | null;
  branch?: string | null;
  cycleStart?: string;
  cycleEnd?: string;
}): Promise<StaffCycleIncentive> {
  if (!isSupabaseConfigured) throw new Error("إعدادات Supabase غير موجودة.");
  const cycle = getCurrentCycle();
  const staffQuery = args.staffId
    ? supabase.from("staff").select("id,name,points,max_points,branch").eq("id", args.staffId).maybeSingle()
    : supabase.from("staff").select("id,name,points,max_points,branch").eq("name", args.staffName || "").maybeSingle();
  const { data: staffData, error: staffError } = await staffQuery;
  if (staffError) throw new Error(staffError.message);
  const staff = (staffData || {
    id: args.staffId || null,
    name: args.staffName || "غير محدد",
    branch: args.branch || null,
    points: STARTING_POINTS,
    max_points: STARTING_POINTS,
  }) as StaffLedgerTarget;

  const name = String(staff.name || args.staffName || "");
  const normalized = normalizeName(name);
  
  // جمع البيانات من جميع المصادر الممكنة
  const [
    employeeTxnsById,
    employeeTxnsByEmployeeId,
    employeeTxnsByName,
    pointsTxns,
    pointRecords,
    conversationReviews,
    stagnantMedicines,
    incentiveMedicines,
  ] = await Promise.all([
    // employee_transactions
    staff.id ? supabase.from(TABLES.employeeTransactions).select("*").eq("staff_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
    staff.id ? supabase.from(TABLES.employeeTransactions).select("*").eq("employee_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
    name ? supabase.from(TABLES.employeeTransactions).select("*").eq("employee_name", name).limit(300) : Promise.resolve({ data: [], error: null } as any),
    // points_transactions
    staff.id ? supabase.from("points_transactions").select("*").eq("staff_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
    // point_records
    staff.id ? supabase.from("point_records").select("*").eq("staff_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
    // conversation_sales_reviews
    staff.id ? supabase.from("conversation_sales_reviews").select("*").eq("staff_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
    // stagnant_medicine_dispenses
    staff.id ? supabase.from("stagnant_medicine_dispenses").select("*").eq("staff_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
    // incentive_medicine_sales
    staff.id ? supabase.from("incentive_medicine_sales").select("*").eq("staff_id", staff.id).limit(300) : Promise.resolve({ data: [], error: null } as any),
  ]);
  
  // تحويل جميع البيانات إلى PointLedgerRecord
  const allRows: PointLedgerRecord[] = [];
  
  // employee_transactions
  for (const row of [...(employeeTxnsById.data || []), ...(employeeTxnsByEmployeeId.data || []), ...(employeeTxnsByName.data || [])]) {
    allRows.push({
      ...row,
      source_type: "employee_transactions",
      source_id: row.id,
      staff_id: row.staff_id || row.employee_id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      points_delta: row.points_delta || (row.type === "penalty" ? -Math.abs(row.points || 0) : Math.abs(row.points || 0)),
      points: Math.abs(row.points || 0),
      reason: row.reason || row.description || "",
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // points_transactions
  for (const row of pointsTxns.data || []) {
    allRows.push({
      ...row,
      source_type: "points_transactions",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name || name,
      points_delta: row.points_delta || row.points || 0,
      points: Math.abs(row.points_delta || row.points || 0),
      reason: row.reason || "",
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // point_records
  for (const row of pointRecords.data || []) {
    allRows.push({
      ...row,
      source_type: "point_records",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name || name,
      points_delta: row.points_delta || row.points || 0,
      points: Math.abs(row.points_delta || row.points || 0),
      reason: row.reason || "",
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // conversation_sales_reviews
  for (const row of conversationReviews.data || []) {
    const points = row.doctor_points_impact || row.base_points_impact || 0;
    const delta = row.extra_penalty_points ? points - row.extra_penalty_points : points;
    allRows.push({
      ...row,
      source_type: "conversation_sales_reviews",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name || name,
      points_delta: delta,
      points: Math.abs(delta),
      reason: `تقييم محادثة: ${row.customer_name || ""}`,
      created_at: row.conversation_date || row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // stagnant_medicine_dispenses
  for (const row of stagnantMedicines.data || []) {
    const points = row.points_impact || 0;
    allRows.push({
      ...row,
      source_type: "stagnant_medicine_dispenses",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name || name,
      points_delta: points,
      points: Math.abs(points),
      reason: `صنف راكد: ${row.medicine_name || ""}`,
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // incentive_medicine_sales
  for (const row of incentiveMedicines.data || []) {
    const points = row.points_impact || 0;
    allRows.push({
      ...row,
      source_type: "incentive_medicine_sales",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name || name,
      points_delta: points,
      points: Math.abs(points),
      reason: `صنف حافز: ${row.medicine_name || ""}`,
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  const result = calculateStaffCycleIncentiveFromRows({ staff, records: allRows, cycle });
  if (normalized && allRows.length === 0) result.warnings.push(`لم يتم العثور على سجلات نقاط باسم ${name}.`);
  return result;
}

export async function getStaffIncentiveSummaryForCycle(args: {
  cycle?: PharmacyCycle;
  branch?: string | null;
}) {
  const cycle = args.cycle || getCurrentCycle();
  let staffQuery = supabase.from("staff").select("id,name,points,max_points,branch").limit(500);
  if (args.branch && args.branch !== "الكل") staffQuery = staffQuery.eq("branch", args.branch);
  
  const [staffResult, employeeTxnsResult, pointsTxnsResult, pointRecordsResult] = await Promise.all([
    staffQuery,
    supabase.from(TABLES.employeeTransactions).select("*").limit(5000),
    supabase.from("points_transactions").select("*").limit(5000),
    supabase.from("point_records").select("*").limit(5000),
  ]);
  
  if (staffResult.error) throw new Error(staffResult.error.message);
  
  // جمع جميع السجلات من المصادر المختلفة
  const allRecords: PointLedgerRecord[] = [];
  
  // employee_transactions
  for (const row of employeeTxnsResult.data || []) {
    allRecords.push({
      ...row,
      source_type: "employee_transactions",
      source_id: row.id,
      staff_id: row.staff_id || row.employee_id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      points_delta: row.points_delta || (row.type === "penalty" ? -Math.abs(row.points || 0) : Math.abs(row.points || 0)),
      points: Math.abs(row.points || 0),
      reason: row.reason || row.description || "",
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // points_transactions
  for (const row of pointsTxnsResult.data || []) {
    allRecords.push({
      ...row,
      source_type: "points_transactions",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name,
      points_delta: row.points_delta || row.points || 0,
      points: Math.abs(row.points_delta || row.points || 0),
      reason: row.reason || "",
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  // point_records
  for (const row of pointRecordsResult.data || []) {
    allRecords.push({
      ...row,
      source_type: "point_records",
      source_id: row.id,
      staff_id: row.staff_id,
      employee_id: row.staff_id,
      employee_name: row.staff_name,
      points_delta: row.points_delta || row.points || 0,
      points: Math.abs(row.points_delta || row.points || 0),
      reason: row.reason || "",
      created_at: row.created_at,
      status: row.status || "active",
    } as PointLedgerRecord);
  }
  
  return ((staffResult.data || []) as StaffLedgerTarget[]).map((staff) =>
    calculateStaffCycleIncentiveFromRows({
      staff,
      records: allRecords,
      cycle,
    }),
  );
}
