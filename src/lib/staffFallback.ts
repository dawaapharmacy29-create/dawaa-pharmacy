import { INITIAL_POINTS } from "@/lib/constants";

export interface StaffChoice {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id?: string | null;
  phone?: string | null;
  status?: string | null;
  active?: boolean | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
  points: number | null;
  max_points: number | null;
  username?: string | null;
  temporary_password?: string | null;
  permissions?: Record<string, boolean> | null;
}

const UNKNOWN_BRANCH = "غير محدد";

export const DEFAULT_STAFF_PERMISSIONS: Record<string, boolean> = {
  view_dashboard: true,
  view_doctor_dashboard: true,
  view_customers: false,
  edit_customers: false,
  view_customer_service: false,
  manage_followups: false,
  view_team: true,
  view_schedule: true,
  manage_time_off: false,
  view_points: true,
  manage_points: false,
  view_reviews: false,
  add_reviews: false,
  view_medicines: true,
  view_delivery: true,
  view_analytics: false,
  view_invoices: false,
  manage_permissions: false,
  view_activity_log: false,
  view_shift_performance: false,
};

function toNumber(value: unknown, fallback: number | null = null) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeStaff(row: Record<string, unknown>): StaffChoice {
  const name = String(row.name || row.staff_name || row.employee_name || "").trim();
  const id = String(row.id || row.staff_id || "").trim();
  const branch = String(row.branch || row.branch_name || UNKNOWN_BRANCH).trim() || UNKNOWN_BRANCH;
  return {
    id,
    name,
    role: String(row.role || row.staff_role || "").trim(),
    branch,
    branch_id: (row.branch_id as string | null | undefined) || null,
    phone: (row.phone as string | null | undefined) || null,
    status: (row.status as string | null | undefined) || null,
    active: (row.active as boolean | null | undefined) ?? null,
    deleted_at: (row.deleted_at as string | null | undefined) || null,
    is_deleted: (row.is_deleted as boolean | null | undefined) ?? null,
    points: toNumber(row.points ?? row.current_points, null),
    max_points: toNumber(row.max_points ?? row.target_points, INITIAL_POINTS),
    username: (row.username as string | null | undefined) || null,
    temporary_password: (row.temporary_password as string | null | undefined) || null,
    permissions: (row.permissions as Record<string, boolean> | null | undefined) || null,
  };
}

function sortStaff(a: StaffChoice, b: StaffChoice) {
  return `${a.branch}-${a.role}-${a.name}`.localeCompare(`${b.branch}-${b.role}-${b.name}`, "ar");
}

function isActiveRealStaff(row: unknown): row is Record<string, unknown> {
  if (!row || typeof row !== "object") return false;
  const next = row as Record<string, unknown>;
  const id = String(next.id || next.staff_id || "").trim();
  const name = String(next.name || next.staff_name || next.employee_name || "").trim();
  if (!id || !name || id.startsWith("fallback-")) return false;
  if (next.deleted_at || next.is_deleted === true || next.active === false) return false;
  return true;
}

export function realStaffChoices(rows: unknown[] | null | undefined): StaffChoice[] {
  return (rows || []).filter(isActiveRealStaff).map(normalizeStaff).sort(sortStaff);
}

export function selectableStaffChoices(rows: unknown[] | null | undefined): StaffChoice[] {
  return realStaffChoices(rows);
}

export function mergeStaffChoices(rows: unknown[] | null | undefined): StaffChoice[] {
  return realStaffChoices(rows);
}

export function reviewerChoices(rows: unknown[] | null | undefined): StaffChoice[] {
  return realStaffChoices(rows).filter((row) =>
    /(صيدلي|مدير|جودة|خدمة)|admin|manager|quality|pharmacist/i.test(row.role),
  );
}

export function findFallbackStaffById() {
  return null;
}
