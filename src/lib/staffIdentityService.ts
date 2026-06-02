import { normalizeBranchName } from "@/lib/branch";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { StaffSalesSummary } from "@/lib/dashboardSummaryService";

type Row = Record<string, unknown>;

export type StaffIdentityRow = {
  id: string | null;
  name: string | null;
  branch: string | null;
  role: string | null;
};

export type GroupedStaffSalesPerformance = {
  staffId: string | null;
  sellerName: string | null;
  displayName: string;
  normalizedName: string;
  branch: string | null;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
  sourceRows: number;
  duplicateWarning: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeStaffName(value: unknown) {
  return text(value)
    .replace(/[\u064b-\u065f]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/^(?:\u062f\.?|\u062f\/|\u062f\u0643\u062a\u0648\u0631|dr\.?|doctor)\s*/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function read(row: Row, keys: string[], fallback: unknown = null) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

export async function fetchStaffIdentityRows(): Promise<StaffIdentityRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("staff")
    .select("id,name,branch,role")
    .limit(800);
  if (error) return [];
  return ((data ?? []) as Row[]).map((row) => ({
    id: text(read(row, ["id"], "")) || null,
    name: text(read(row, ["name"], "")) || null,
    branch: normalizeBranchName(read(row, ["branch"], null)) || null,
    role: text(read(row, ["role"], "")) || null,
  }));
}

export function findStaffIdentityForSalesRow(row: StaffSalesSummary, staffRows: StaffIdentityRow[]) {
  const sellerName = row.sellerName || "";
  const normalized = normalizeStaffName(sellerName);
  const branch = normalizeBranchName(row.branch);
  if (!normalized) return null;

  const sameBranch = staffRows.filter((staff) => normalizeStaffName(staff.name) === normalized && (!branch || !staff.branch || staff.branch === branch));
  if (sameBranch.length === 1) return sameBranch[0];
  if (sameBranch.length > 1) {
    const pharmacist = sameBranch.find((staff) => /صيد|دكتور|doctor|pharmacist/i.test(staff.role || ""));
    return pharmacist || sameBranch[0];
  }

  const anyBranch = staffRows.filter((staff) => normalizeStaffName(staff.name) === normalized);
  if (anyBranch.length === 1) return anyBranch[0];
  return null;
}

export function groupStaffSalesPerformance(rows: StaffSalesSummary[], staffRows: StaffIdentityRow[] = []): GroupedStaffSalesPerformance[] {
  const groups = new Map<string, GroupedStaffSalesPerformance>();

  for (const row of rows) {
    if (!row.sellerName) continue;
    const identity = findStaffIdentityForSalesRow(row, staffRows);
    const normalizedName = normalizeStaffName(identity?.name || row.sellerName);
    if (!normalizedName) continue;
    const branch = normalizeBranchName(identity?.branch || row.branch) || null;
    const key = identity?.id ? `id:${identity.id}` : `name:${normalizedName}:branch:${branch || "all"}`;
    const current = groups.get(key) || {
      staffId: identity?.id || null,
      sellerName: identity?.name || row.sellerName,
      displayName: identity?.name || row.sellerName || "غير محدد",
      normalizedName,
      branch,
      netTotal: 0,
      invoicesCount: 0,
      avgInvoice: 0,
      uniqueCustomers: 0,
      sourceRows: 0,
      duplicateWarning: null,
    };
    current.netTotal += row.netTotal || 0;
    current.invoicesCount += row.invoicesCount || 0;
    current.uniqueCustomers += row.uniqueCustomers || 0;
    current.sourceRows += 1;
    if (current.sourceRows > 1) current.duplicateWarning = "تم تجميع أكثر من صف لنفس الدكتور";
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((row) => ({
      ...row,
      avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
    }))
    .sort((a, b) => b.netTotal - a.netTotal);
}

export function staffProfileRoute(staffId: string | null | undefined) {
  return staffId ? `/staff/${staffId}` : null;
}
