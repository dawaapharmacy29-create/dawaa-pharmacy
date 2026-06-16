import { INITIAL_POINTS } from "@/lib/constants";

export interface StaffChoice {
  id: string;
  name: string;
  original_name?: string;
  display_name?: string;
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
  duplicate_ids?: string[];
  aliases?: string[];
  duplicate_count?: number;
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
    original_name: name,
    display_name: name,
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

function normalizeDuplicateNameKey(value: string) {
  return value
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/^(\u062f|dr|doctor|d)\.?\s*\/?\s*/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeStaffDuplicateKey(value: string) {
  return normalizeDuplicateNameKey(value);
}

function withDuplicateDisplayNames(rows: StaffChoice[]) {
  const groups = new Map<string, StaffChoice[]>();
  rows.forEach((row) => {
    const key = normalizeDuplicateNameKey(row.original_name || row.name);
    if (!key) return;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });

  return rows.map((row) => {
    const group = groups.get(normalizeDuplicateNameKey(row.original_name || row.name)) || [];
    if (group.length <= 1) return row;
    const branch = row.branch && row.branch !== UNKNOWN_BRANCH ? row.branch : "";
    const role = row.role || "";
    const suffix = [branch, role].filter(Boolean).join(" - ") || row.id.slice(0, 8);
    return {
      ...row,
      display_name: `${row.original_name || row.name} (${suffix})`,
    };
  });
}

function mergeDuplicateStaffRows(rows: StaffChoice[]) {
  const groups = new Map<string, StaffChoice[]>();
  for (const row of rows) {
    const key = [normalizeDuplicateNameKey(row.original_name || row.name), row.branch || UNKNOWN_BRANCH, row.role || ""].join("|");
    if (!key.trim()) continue;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  const merged: StaffChoice[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    const sorted = [...group].sort((a, b) => {
      const score = (row: StaffChoice) =>
        (row.active !== false ? 100 : 0) +
        (row.username ? 20 : 0) +
        (row.phone ? 10 : 0) +
        (Number(row.points || 0) >= INITIAL_POINTS ? 5 : 0) -
        (row.deleted_at || row.is_deleted ? 1000 : 0);
      return score(b) - score(a) || String(a.id).localeCompare(String(b.id));
    });

    const primary = sorted[0];
    const aliases = Array.from(new Set(group.flatMap((row) => [row.name, row.original_name, row.display_name].filter(Boolean) as string[])));
    merged.push({
      ...primary,
      aliases,
      duplicate_ids: Array.from(new Set(group.map((row) => row.id).filter(Boolean))),
      duplicate_count: group.length,
      display_name: `${primary.original_name || primary.name} (${primary.branch}${primary.role ? ` - ${primary.role}` : ""})`,
    });
  }

  return merged.sort(sortStaff);
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
  return withDuplicateDisplayNames(mergeDuplicateStaffRows((rows || []).filter(isActiveRealStaff).map(normalizeStaff).sort(sortStaff)));
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
