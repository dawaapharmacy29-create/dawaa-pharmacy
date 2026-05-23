import type { PharmacyCycle } from "@/lib/pharmacy-cycle";
import { isDateInCycle } from "@/lib/pharmacy-cycle";

export interface MedicineTarget {
  id: string;
  name: string;
  doctor?: string | null;
  totalQuantity: number;
  targetMinPercent?: number | null;
}

export interface MedicineMovement {
  medicine_id?: string | null;
  stagnant_medicine_id?: string | null;
  incentive_medicine_id?: string | null;
  doctor_name?: string | null;
  quantity?: number | string | null;
  dispensed_quantity?: number | string | null;
  sold_quantity?: number | string | null;
  transaction_date?: string | null;
  sale_date?: string | null;
  dispensed_at?: string | null;
  month_cycle?: string | null;
}

function numeric(value: unknown) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

export function movementQuantity(row: MedicineMovement) {
  return numeric(row.quantity ?? row.dispensed_quantity ?? row.sold_quantity);
}

export function movementDate(row: MedicineMovement) {
  return row.transaction_date || row.sale_date || row.dispensed_at || null;
}

export function isMovementInCycle(row: MedicineMovement, cycle: PharmacyCycle) {
  const date = movementDate(row);
  return date ? isDateInCycle(new Date(`${date.slice(0, 10)}T12:00:00`), cycle) : true;
}

export function movementTotalForMedicine(rows: MedicineMovement[], medicineId: string, cycle: PharmacyCycle, doctorName?: string | null) {
  return rows
    .filter((row) => (row.stagnant_medicine_id || row.incentive_medicine_id || row.medicine_id) === medicineId)
    .filter((row) => !doctorName || row.doctor_name === doctorName)
    .filter((row) => isMovementInCycle(row, cycle))
    .reduce((sum, row) => sum + movementQuantity(row), 0);
}

export function requiredQuantity(target: Pick<MedicineTarget, "totalQuantity" | "targetMinPercent">) {
  const pct = numeric(target.targetMinPercent);
  if (pct <= 0) return 0;
  return Math.ceil((numeric(target.totalQuantity) * pct) / 100);
}

export function targetAchieved(target: MedicineTarget, moved: number) {
  const required = requiredQuantity(target);
  return required <= 0 || moved >= required;
}

export function remainingQuantity(total: number, moved: number) {
  return Math.max(0, numeric(total) - numeric(moved));
}

export function groupDoctorTotals<T extends MedicineMovement>(rows: T[], cycle: PharmacyCycle) {
  const map = new Map<string, { doctor: string; quantity: number; count: number }>();
  for (const row of rows.filter((item) => isMovementInCycle(item, cycle))) {
    const doctor = row.doctor_name || "غير محدد";
    const current = map.get(doctor) || { doctor, quantity: 0, count: 0 };
    current.quantity += movementQuantity(row);
    current.count += 1;
    map.set(doctor, current);
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity);
}
