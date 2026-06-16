import type { PharmacyCycle } from "@/lib/pharmacy-cycle";
import { isDateInCycle } from "@/lib/pharmacy-cycle";
import { monthCycleFromDate } from "@/lib/conversationReviews";
import { INITIAL_POINTS } from "@/lib/constants";

export interface PointLedgerRecord {
  id?: string | null;
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type?: string | null;
  points?: number | string | null;
  points_delta?: number | string | null;
  title?: string | null;
  reason?: string | null;
  description?: string | null;
  source?: string | null;
  source_module?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  approved_by_name?: string | null;
  manager_name?: string | null;
  executor_name?: string | null;
  clean_reason?: string | null;
  display_reason?: string | null;
  item_name?: string | null;
  item_quantity?: number | string | null;
  source_label?: string | null;
  display_source?: string | null;
  metadata?: unknown;
  status?: string | null;
  manager_note?: string | null;
  month_cycle?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  branch?: string | null;
}

export interface StaffLedgerTarget {
  id?: string | null;
  name?: string | null;
  points?: number | string | null;
  max_points?: number | string | null;
  duplicate_ids?: string[] | null;
  aliases?: string[] | null;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

export function canonicalMaxPoints(staff?: StaffLedgerTarget | null) {
  const storedMax = numeric(staff?.max_points);
  return Math.max(INITIAL_POINTS, storedMax ?? INITIAL_POINTS);
}

export function canonicalSnapshotPoints(staff?: StaffLedgerTarget | null) {
  const storedPoints = numeric(staff?.points);
  const storedMax = numeric(staff?.max_points);
  if (storedPoints === null) return INITIAL_POINTS;
  if (storedMax !== null && storedMax < INITIAL_POINTS && storedPoints <= storedMax) return INITIAL_POINTS;
  return Math.max(0, Math.min(canonicalMaxPoints(staff), Math.round(storedPoints)));
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
  const status = String(row.status || match?.[1] || "approved")
    .trim()
    .toLowerCase()
    .replace("معتمد", "approved")
    .replace("تم الاعتماد", "approved")
    .replace("مقبول", "approved")
    .replace("قيد المراجعة", "pending")
    .replace("معلق", "pending")
    .replace("مرفوض", "rejected")
    .replace("ملغي", "cancelled")
    .replace("ملغى", "cancelled");
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

  if (explicitDelta !== null && explicitDelta !== 0) return explicitDelta;
  if (type === "reward" || type === "bonus" || type === "مكافأة") return absPoints;
  if (type === "penalty" || type === "deduction" || type === "خصم" || type === "جزاء") return -absPoints;
  return rawPoints ?? 0;
}

export function isSystemUuidLikeValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^0{8,}(-0{4})*/.test(text)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return true;
  if (/^[0-9a-f]{24,}$/i.test(text)) return true;
  return false;
}

export function cleanTechnicalText(value: unknown) {
  let text = String(value || "");
  if (!text.trim()) return "";
  text = text
    .replace(/__RULE__:[^\n]+/gi, " ")
    .replace(/RULE__[A-Z0-9_]+/gi, " ")
    .replace(/CMP_[A-Z0-9_]+/gi, " ")
    .replace(/status:(pending|approved|rejected|active|cancelled)/gi, " ")
    .replace(/created_by_role:[^\s]+/gi, " ")
    .replace(/source_id:[^\s]+/gi, " ")
    .replace(/approver:[^\s]+/gi, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b0{8,}\b/g, " ")
    .replace(/base:\d+/gi, " ")
    .replace(/repeat:\d+/gi, " ")
    .replace(/multiplier:\d+/gi, " ")
    .replace(/final:\d+/gi, " ")
    .replace(/[{}[\]|]+/g, " ")
    .replace(/\s*[-—]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const repeated = text.match(/^(.{8,120})(?:\s+\1){1,}$/);
  if (repeated) return repeated[1].trim();
  return text;
}

function cleanCandidate(value: unknown) {
  const text = cleanTechnicalText(value);
  if (!text || isSystemUuidLikeValue(text)) return "";
  if (/^(approved|pending|rejected|active|cancelled)$/i.test(text)) return "";
  return text;
}

export function normalizeTransactionType(rowOrType: PointLedgerRecord | string | null | undefined) {
  const raw = typeof rowOrType === "string" ? rowOrType : rowOrType?.type;
  const type = String(raw || "").toLowerCase();
  if (type.includes("reward") || type.includes("bonus") || type.includes("مكاف")) return "reward";
  if (type.includes("penalty") || type.includes("deduction") || type.includes("خصم") || type.includes("جزاء")) return "penalty";
  const delta = typeof rowOrType === "object" && rowOrType ? pointRecordDelta(rowOrType) : 0;
  if (delta < 0) return "penalty";
  if (delta > 0) return "reward";
  return "neutral";
}

export function formatTransactionSource(row: PointLedgerRecord) {
  const source = String(row.display_source || row.source_label || row.source || row.source_module || row.source_type || "").toLowerCase();
  if (source.includes("manual") || source.includes("penalty_incentive")) return "إدخال يدوي";
  if (source.includes("stagnant")) return "صرف راكد";
  if (source.includes("incentive")) return "صرف لستة";
  if (source.includes("conversation") || source.includes("whatsapp")) return "تقييم محادثة";
  if (source.includes("customer")) return "خدمة العملاء";
  if (source.includes("delivery")) return "دليفري";
  if (source.includes("training")) return "تدريب";
  if (source.includes("legacy") || source.includes("migration")) return "سجل قديم مرحل";
  return cleanCandidate(row.display_source || row.source_label) || "سجل نقاط";
}

export function getTransactionShortReason(row: PointLedgerRecord) {
  const title = cleanCandidate(row.title || row.display_reason || row.clean_reason);
  if (title) return title;

  const item = cleanCandidate(row.item_name || (row.metadata as Record<string, unknown> | undefined)?.item_name || (row.metadata as Record<string, unknown> | undefined)?.product_name);
  const qty = Number(row.item_quantity || (row.metadata as Record<string, unknown> | undefined)?.item_quantity || (row.metadata as Record<string, unknown> | undefined)?.quantity || 0);
  const source = formatTransactionSource(row);
  if (source === "صرف راكد" && item) return qty && qty !== 1 ? `صرف ${qty} علبة ${item}` : `صرف علبة ${item}`;
  if (source === "صرف لستة" && item) return `تحقيق هدف صنف ${item}`;
  if (source === "تقييم محادثة") return "تقييم محادثة واتساب";

  const reason = cleanCandidate(row.reason);
  if (reason) {
    const stagnant = reason.match(/(?:راكد|صنف راكد).*?:?\s*([^:،-]+?)(?:\s+صرف|\s+\d|$)/);
    if (stagnant?.[1]) return `صرف علبة ${cleanTechnicalText(stagnant[1])}`;
    return reason.length > 90 ? `${reason.slice(0, 90).trim()}...` : reason;
  }

  const description = cleanCandidate(row.description || row.manager_note);
  if (description) return description.length > 90 ? `${description.slice(0, 90).trim()}...` : description;
  return "سجل نقاط";
}

export function formatTransactionReason(row: PointLedgerRecord) {
  return getTransactionShortReason(row);
}

export function formatTransactionExecutor(row: PointLedgerRecord) {
  const candidates = [
    row.created_by_name,
    row.approved_by_name,
    row.manager_name,
    row.executor_name,
    row.created_by,
  ];
  for (const candidate of candidates) {
    const text = cleanCandidate(candidate);
    if (!text) continue;
    if (text === "admin" || text === "general_manager") return "المدير العام";
    if (isSystemUuidLikeValue(text)) continue;
    return text;
  }
  const source = formatTransactionSource(row);
  return source === "إدخال يدوي" ? "المدير العام" : "النظام";
}

export function formatTransactionDate(value: unknown) {
  if (!value) return "غير محدد";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });
}

export function getTransactionDetails(row: PointLedgerRecord) {
  const type = normalizeTransactionType(row) === "penalty" ? "خصم" : normalizeTransactionType(row) === "reward" ? "مكافأة" : "تسوية";
  const delta = pointRecordDelta(row);
  const full = cleanCandidate(row.description) || cleanCandidate(row.manager_note) || cleanCandidate(row.reason) || getTransactionShortReason(row);
  return {
    employee: cleanCandidate(row.employee_name) || "غير محدد",
    type,
    points: `${delta > 0 ? "+" : ""}${delta}`,
    reason: getTransactionShortReason(row),
    fullDescription: full,
    source: formatTransactionSource(row),
    executor: formatTransactionExecutor(row),
    createdAt: formatTransactionDate(row.created_at),
    approvedAt: row.approved_at ? formatTransactionDate(row.approved_at) : "غير محدد",
    branch: cleanCandidate(row.branch) || "غير محدد",
    cycle: cleanCandidate(row.month_cycle) || "غير محدد",
    related: row.source_id && !isSystemUuidLikeValue(row.source_id) ? cleanTechnicalText(row.source_id) : "غير ظاهر",
  };
}

export function isRecordInCycle(row: PointLedgerRecord, cycle: PharmacyCycle) {
  const activeMonthCycle = monthCycleFromDate(cycle.end);
  const createdInCycle = row.created_at ? isDateInCycle(new Date(row.created_at), cycle) : false;
  if (row.month_cycle) return row.month_cycle === activeMonthCycle || createdInCycle;
  return row.created_at ? createdInCycle : true;
}

export function recordBelongsToStaff(row: PointLedgerRecord, staff: StaffLedgerTarget) {
  const staffId = String(staff.id || "").trim();
  const duplicateIds = new Set([staffId, ...((staff.duplicate_ids || []) as string[])].filter(Boolean).map((value) => String(value).trim()));
  const rowCanonicalStaffId = String(row.staff_id || "").trim();
  if (rowCanonicalStaffId && duplicateIds.has(rowCanonicalStaffId)) return true;

  const rowStaffId = String(row.employee_id || "").trim();
  if (rowStaffId && duplicateIds.has(rowStaffId)) return true;

  const staffNames = new Set([staff.name, ...((staff.aliases || []) as string[])]
    .map(normalizeStaffLedgerKey)
    .filter(Boolean));
  const rowName = normalizeStaffLedgerKey(row.employee_name);
  return Boolean(rowName && staffNames.has(rowName));
}

export function effectiveCyclePoints(
  staff: StaffLedgerTarget,
  records: PointLedgerRecord[],
  cycle: PharmacyCycle,
) {
  const maxPoints = canonicalMaxPoints(staff);
  const matchingRecords = records.filter((row) => (
    isApprovedPointRecord(row) &&
    isRecordInCycle(row, cycle) &&
    recordBelongsToStaff(row, staff)
  ));

  const delta = matchingRecords.reduce((sum, row) => sum + pointRecordDelta(row), 0);
  return Math.max(0, Math.min(maxPoints, Math.round(INITIAL_POINTS + delta)));
}
