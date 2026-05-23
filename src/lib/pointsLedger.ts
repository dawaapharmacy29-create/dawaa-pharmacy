import type { PharmacyCycle } from "@/lib/pharmacy-cycle";
import { isDateInCycle } from "@/lib/pharmacy-cycle";
import { monthCycleFromDate } from "@/lib/conversationReviews";
import { INITIAL_POINTS } from "@/lib/constants";

export interface PointLedgerRecord {
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type?: string | null;
  points?: number | string | null;
  points_delta?: number | string | null;
  status?: string | null;
  manager_note?: string | null;
  month_cycle?: string | null;
  created_at?: string | null;
}

export interface StaffLedgerTarget {
  id?: string | null;
  name?: string | null;
  points?: number | string | null;
  max_points?: number | string | null;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

export function normalizeStaffLedgerKey(value: unknown) {
  return String(value || "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/^(\u062f|dr|doctor)\s*\/?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function pointRecordStatus(row: PointLedgerRecord) {
  const note = row.manager_note || "";
  const match = note.match(/(?:status|حالة):(pending|approved|rejected)/);
  const status = row.status || match?.[1] || "approved";
  if (status === "active") return "approved";
  if (status === "cancelled") return "rejected";
  return status;
}

export function isApprovedPointRecord(row: PointLedgerRecord) {
  return pointRecordStatus(row) === "approved";
}

export function pointRecordDelta(row: PointLedgerRecord) {
  const explicitDelta = numeric(row.points_delta);
  const rawPoints = numeric(row.points);
  const type = String(row.type || "").trim();
  const absPoints = Math.abs(rawPoints ?? explicitDelta ?? 0);

  if (type === "reward" || type === "bonus" || type === "مكافأة") return absPoints;
  if (type === "penalty" || type === "deduction" || type === "خصم" || type === "جزاء") return -absPoints;
  if (explicitDelta !== null && explicitDelta !== 0) return explicitDelta;
  return rawPoints ?? 0;
}

export function isRecordInCycle(row: PointLedgerRecord, cycle: PharmacyCycle) {
  const activeMonthCycle = monthCycleFromDate(cycle.end);
  if (row.month_cycle) return row.month_cycle === activeMonthCycle;
  return row.created_at ? isDateInCycle(new Date(row.created_at), cycle) : true;
}

export function recordBelongsToStaff(row: PointLedgerRecord, staff: StaffLedgerTarget) {
  const staffId = String(staff.id || "").trim();
  const rowCanonicalStaffId = String(row.staff_id || "").trim();
  if (staffId && rowCanonicalStaffId && staffId === rowCanonicalStaffId) return true;

  const rowStaffId = String(row.employee_id || "").trim();
  if (staffId && rowStaffId && staffId === rowStaffId) return true;

  const staffName = normalizeStaffLedgerKey(staff.name);
  const rowName = normalizeStaffLedgerKey(row.employee_name);
  return Boolean(staffName && rowName && staffName === rowName);
}

export function effectiveCyclePoints(
  staff: StaffLedgerTarget,
  records: PointLedgerRecord[],
  cycle: PharmacyCycle,
) {
  const maxPoints = numeric(staff.max_points) ?? INITIAL_POINTS;
  const persistedPoints = numeric(staff.points);
  const matchingRecords = records.filter((row) => (
    isApprovedPointRecord(row) &&
    isRecordInCycle(row, cycle) &&
    recordBelongsToStaff(row, staff)
  ));

  if (!matchingRecords.length && persistedPoints !== null) {
    return Math.max(0, Math.min(maxPoints, Math.round(persistedPoints)));
  }

  const delta = matchingRecords.reduce((sum, row) => sum + pointRecordDelta(row), 0);
  return Math.max(0, Math.min(maxPoints, Math.round(INITIAL_POINTS + delta)));
}
