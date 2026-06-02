import { useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  TrendingDown,
  TrendingUp,
  Users,
  CheckCircle,
  Clock,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { useAuth, getCurrentUserProfile } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activityLog";
import { notifyEmployee } from "@/lib/notificationService";
import { supabase } from "@/lib/supabase";
import { TABLES } from "@/lib/supabaseTables";
import { formatDateTime, toNumber } from "@/lib/utils";
import { BRANCHES, POINT_REASONS } from "@/lib/constants";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { mergeStaffChoices } from "@/lib/staffFallback";
import {
  persistPointsTransaction,
  applyStaffDelta,
} from "@/lib/pointsPersistence";
import {
  formatTransactionExecutor,
  formatTransactionSource,
  getTransactionDetails,
  getTransactionShortReason,
  isApprovedPointRecord,
  isRecordInCycle,
  normalizeTransactionType,
  pointRecordDelta,
  pointRecordStatus,
  type PointLedgerRecord,
} from "@/lib/pointsLedger";
import { calculateStaffCycleIncentiveFromRows } from "@/lib/staffIncentiveService";

// ─── Types ─────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string;
  name: string;
  role: string;
  branch: string;
  points: number | null;
  max_points: number | null;
}

interface PointRecord {
  id: string;
  staff_id?: string | null;
  employee_id: string;
  employee_name: string;
  type: string;
  points: number;
  points_delta?: number | null;
  reason: string;
  manager_note: string | null;
  description?: string | null;
  created_by: string;
  branch: string;
  branch_id?: string | null;
  created_at: string;
  transaction_date?: string | null;
  status?: string | null;
  month_cycle?: string | null;
  source?: string | null;
  title?: string | null;
  created_by_name?: string | null;
  approved_by_name?: string | null;
  manager_name?: string | null;
  executor_name?: string | null;
  clean_reason?: string | null;
  display_reason?: string | null;
  item_name?: string | null;
  item_quantity?: number | null;
  source_label?: string | null;
  display_source?: string | null;
  source_id?: string | null;
  metadata?: unknown;
}

type RecordStatus = "approved" | "pending" | "rejected";

const EMPTY_FORM = {
  employeeId: "",
  type: "مكافأة" as "مكافأة" | "خصم",
  points: 5,
  reason: POINT_REASONS[0] as string,
  notes: "",
  status: "approved" as RecordStatus,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function recordStatus(r: PointRecord): RecordStatus {
  const status = pointRecordStatus(r);
  if (status === "pending") return "pending";
  if (status === "rejected" || status === "cancelled") return "rejected";
  return "approved";
}

function pointRecordNote(row: PointRecord) {
  return getTransactionShortReason(row);
}

function pointRecordMeta(row: PointRecord) {
  const date = row.transaction_date || row.created_at;
  return `المنفذ: ${formatTransactionExecutor(row)} — المصدر: ${formatTransactionSource(row)} — التاريخ: ${date ? formatDateTime(date) : "غير محدد"}`;
}

function isBonus(r: PointRecord) {
  return normalizeTransactionType(r) === "reward";
}

function absPoints(r: PointRecord) {
  const delta = pointRecordDelta(r);
  return Math.abs(delta) || Math.abs(toNumber(r.points));
}

function statusMeta(s: RecordStatus): { label: string; cls: string } {
  if (s === "approved") return { label: "معتمد", cls: "badge-success" };
  if (s === "pending") return { label: "قيد المراجعة", cls: "badge-warning" };
  return { label: "مرفوض", cls: "badge-danger" };
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function PenaltyIncentiveManagement() {
  const { user, canManage } = useAuth();
  const navigate = useNavigate();
  const cycle = getCurrentCycle();

  // ── UI state ──
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [typeFilter, setTypeFilter] = useState("كل");
  const [statusFilter, setStatusFilter] = useState("كل");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedRecord, setSelectedRecord] = useState<PointRecord | null>(null);

  // ── Data queries ──
  const { data: staffList, refetch: refetchStaff } =
    useSupabaseQuery<StaffMember>({
      table: TABLES.staff,
      orderBy: { column: "name", ascending: true },
      realtimeEnabled: false,
    });

  const {
    data: records,
    loading: recLoading,
    refetch: refetchRecords,
  } = useSupabaseQuery<PointRecord>({
    table: TABLES.employeeTransactions,
    orderBy: { column: "created_at", ascending: false },
    limit: 100,
    realtimeEnabled: true,
  });

  // ── Derived data ──
  const staffChoices = useMemo(() => mergeStaffChoices(staffList), [staffList]);

  const canonicalRecords = useMemo(() => records.map((row) => {
    const staff = staffChoices.find((item) => item.id === (row.staff_id || row.employee_id));
    const rawPoints = Math.abs(toNumber(row.points_delta) || toNumber(row.points));
    const signedPoints = toNumber(row.points_delta) || (row.type === "penalty" ? -rawPoints : rawPoints);
    return {
      ...row,
      employee_id: row.employee_id || row.staff_id || "",
      employee_name: row.employee_name || staff?.name || "",
      type: row.type === "reward" ? "bonus" : row.type === "penalty" ? "deduction" : row.type,
      points: rawPoints,
      points_delta: signedPoints,
      manager_note: row.manager_note || row.description || null,
      branch: row.branch || staff?.branch || "",
      status: row.status === "active" ? "approved" : row.status === "cancelled" ? "rejected" : row.status,
    };
  }), [records, staffChoices]);

  const cycleRecords = useMemo(
    () => canonicalRecords.filter((row) => isRecordInCycle(row, cycle)) as PointRecord[],
    [canonicalRecords, cycle],
  );

  const bonusCount = cycleRecords.filter(isBonus).length;
  const deductionCount = cycleRecords.filter((r) => !isBonus(r)).length;
  const approvedCount = cycleRecords.filter(isApprovedPointRecord).length;
  const pendingCount = cycleRecords.filter(
    (r) => recordStatus(r) === "pending",
  ).length;

  const filteredRecords = useMemo(() => {
    return cycleRecords.filter((r) => {
      if (branchFilter !== "الكل" && r.branch !== branchFilter) return false;
      if (typeFilter === "مكافأة" && !isBonus(r)) return false;
      if (typeFilter === "خصم" && isBonus(r)) return false;
      if (statusFilter !== "كل" && recordStatus(r) !== statusFilter)
        return false;
      if (search) {
        const q = search.toLowerCase();
        const text =
          `${r.employee_name} ${pointRecordNote(r)} ${formatTransactionExecutor(r)} ${formatTransactionSource(r)} ${r.branch}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [cycleRecords, branchFilter, typeFilter, statusFilter, search]);

  const selectedStaff = staffChoices.find((s) => s.id === form.employeeId);

  // ── Save handler ──
  const handleSave = async () => {
    if (!form.employeeId || !selectedStaff) {
      toast.error("اختر موظفاً أولًا");
      return;
    }
    if (form.points < 1) {
      toast.error("يجب أن تكون القيمة بالنقاط 1 على الأقل");
      return;
    }

    setSaving(true);
    try {
      let createdById: string;
      try {
        createdById = getCurrentUserProfile().id;
      } catch {
        toast.error("يجب تسجيل الدخول أولًا");
        return;
      }

      const finalStatus: RecordStatus = canManage ? form.status : "pending";

      const { error: txnError, id: newRecordId } =
        await persistPointsTransaction({
          employeeId: selectedStaff.id,
          employeeName: selectedStaff.name,
          branch: selectedStaff.branch,
          operation: form.type === "مكافأة" ? "bonus" : "deduction",
          rule: {
            code: `MANUAL_${form.type === "مكافأة" ? "BONUS" : "DEDUCTION"}`,
            category: "يدوي",
            title: form.reason,
            description: form.notes,
            default_points: form.points,
            type: form.type === "مكافأة" ? "bonus" : "deduction",
            severity: "medium",
            role_scope: "all",
            requires_approval: !canManage,
            evidence_required: false,
            allowed_approver_roles: ["general_manager"],
            repeat_policy: "none",
            active: true,
          },
          pointsToStore: form.points,
          basePoints: form.points,
          finalPoints: form.points,
          userNote: form.notes,
          createdByName: user?.name || "",
          createdById,
          createdByRole: user?.role || "",
          status: finalStatus,
          cycle: getCurrentCycle(),
          sourceModule: "penalty_incentive",
          reasonLabel: form.reason,
        });

      if (txnError) {
        toast.error(txnError);
        return;
      }

      if (finalStatus === "approved") {
        const approvedRows = cycleRecords.filter(isApprovedPointRecord) as PointLedgerRecord[];
        const currentIncentive = calculateStaffCycleIncentiveFromRows({ staff: selectedStaff, records: approvedRows, cycle });
        await applyStaffDelta(
          selectedStaff.id,
          currentIncentive.finalPoints,
          currentIncentive.startingPoints,
          form.type === "مكافأة" ? form.points : -form.points,
          selectedStaff.name,
          selectedStaff.branch,
        );
      }

      await logActivity({
        action: form.type === "مكافأة" ? "إضافة مكافأة" : "إضافة خصم",
        module: "الجزاءات والحوافز",
        target_type: "point_record",
        target_id: newRecordId,
        user_id: createdById,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: selectedStaff.branch,
        details: {
          summary: `${form.type} — ${form.reason} — ${selectedStaff.name}`,
          staffName: selectedStaff.name,
          points: form.points,
          reason: form.reason,
          status: finalStatus,
        },
      });

      await notifyEmployee({
        title: form.type === "مكافأة" ? "تم تسجيل مكافأة جديدة" : "تم تسجيل خصم جديد",
        message: `${form.reason} - ${form.points} نقطة - الحالة: ${finalStatus === "approved" ? "معتمد" : "قيد المراجعة"}`,
        type: form.type === "مكافأة" ? "reward" : "deduction",
        priority: form.type === "مكافأة" ? "normal" : "high",
        recipient_staff_id: selectedStaff.id,
        branch: selectedStaff.branch,
        target_type: "point_record",
        target_id: newRecordId,
        target_route: "/staff-dashboard",
        requires_action: form.type !== "مكافأة",
        created_by: createdById,
        created_by_name: user?.name,
        metadata: {
          staff_name: selectedStaff.name,
          points: form.points,
          reason: form.reason,
          status: finalStatus,
        },
      });

      toast.success(
        finalStatus === "approved"
          ? "تم الحفظ والاعتماد بنجاح"
          : "تم الحفظ وإرسال للمراجعة",
      );
      setShowModal(false);
      setForm({ ...EMPTY_FORM });
      refetchRecords();
      refetchStaff();
    } finally {
      setSaving(false);
    }
  };

  // ── Approve / reject ──
  const handleApprove = async (row: PointRecord, approve: boolean) => {
    if (!canManage) return;
    const nextStatus: RecordStatus = approve ? "approved" : "rejected";
    const { error } = await supabase
      .from(TABLES.employeeTransactions)
      .update({ status: nextStatus })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    if (approve) {
      const staff = staffChoices.find(
        (s) => s.id === row.employee_id || s.name === row.employee_name,
      );
      if (staff) {
        const delta = isBonus(row) ? absPoints(row) : -absPoints(row);
        const approvedRows = cycleRecords.filter(isApprovedPointRecord) as PointLedgerRecord[];
        const currentIncentive = calculateStaffCycleIncentiveFromRows({ staff, records: approvedRows, cycle });
        await applyStaffDelta(
          staff.id,
          currentIncentive.finalPoints,
          currentIncentive.startingPoints,
          delta,
          staff.name,
          staff.branch,
        );
      }
    }

    try {
      const profile = getCurrentUserProfile();
      await logActivity({
        action: approve ? "اعتماد سجل نقاط" : "رفض سجل نقاط",
        module: "الجزاءات والحوافز",
        target_type: "point_record",
        target_id: row.id,
        user_id: profile.id,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: row.branch,
        details: {
          staffName: row.employee_name,
          reason: row.reason,
          status: nextStatus,
        },
      });
      await notifyEmployee({
        title: approve ? "تم اعتماد سجل النقاط" : "تم رفض سجل النقاط",
        message: `${row.reason || row.display_reason || "سجل نقاط"} - ${row.employee_name}`,
        type: isBonus(row) ? "reward" : "deduction",
        priority: approve ? "normal" : "high",
        recipient_staff_id: row.employee_id || row.staff_id || null,
        branch: row.branch,
        target_type: "point_record",
        target_id: row.id,
        target_route: "/staff-dashboard",
        requires_action: !approve,
        created_by: profile.id,
        created_by_name: user?.name,
        metadata: {
          staff_name: row.employee_name,
          status: nextStatus,
          points: absPoints(row),
        },
      });
    } catch {
      // log failure is non-critical
    }

    toast.success(approve ? "تم الاعتماد" : "تم الرفض");
    refetchRecords();
    refetchStaff();
  };

  const handleSetPending = async (row: PointRecord) => {
    if (!canManage) return;
    const { error } = await supabase
      .from(TABLES.employeeTransactions)
      .update({ status: "pending" })
      .eq("id", row.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    try {
      const profile = getCurrentUserProfile();
      await logActivity({
        action: "إرجاع سجل نقاط للمراجعة",
        module: "الجزاءات والحوافز",
        target_type: "point_record",
        target_id: row.id,
        user_id: profile.id,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: row.branch,
        details: {
          staffName: row.employee_name,
          reason: pointRecordNote(row),
          status: "pending",
        },
      });
    } catch {
      // log failure is non-critical
    }

    toast.success("تم تحويل السجل إلى قيد المراجعة");
    refetchRecords();
  };

  const handleDeleteRecord = async (row: PointRecord) => {
    if (!canManage) return;
    const ok = window.confirm(`هل تريد مسح سجل "${pointRecordNote(row)}"؟`);
    if (!ok) return;

    const { error } = await supabase
      .from(TABLES.employeeTransactions)
      .delete()
      .eq("id", row.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    try {
      const profile = getCurrentUserProfile();
      await logActivity({
        action: "مسح سجل نقاط",
        module: "الجزاءات والحوافز",
        target_type: "point_record",
        target_id: row.id,
        user_id: profile.id,
        user_name: user?.name,
        user_role: user?.role,
        branch_name: row.branch,
        details: {
          staffName: row.employee_name,
          reason: pointRecordNote(row),
        },
      });
    } catch {
      // log failure is non-critical
    }

    toast.success("تم مسح السجل");
    refetchRecords();
    refetchStaff();
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <h1 className="section-title text-xl">إدارة الجزاءات والحوافز</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            إضافة ومتابعة المكافآت والخصومات لكل موظف — الدورة:{" "}
            {cycle.shortLabel}
          </p>
        </div>
        {(canManage ||
          user?.permissions?.create_reward === true ||
          user?.permissions?.create_deduction === true) && (
          <button
            type="button"
            onClick={() => {
              setForm({ ...EMPTY_FORM });
              setShowModal(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> إضافة جزاء أو حافز
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card text-center">
          <TrendingUp className="mx-auto text-teal-400 mb-1" size={22} />
          <div className="text-2xl font-bold num text-teal-400">
            {bonusCount}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">مكافآت الدورة</div>
        </div>
        <div className="stat-card text-center">
          <TrendingDown className="mx-auto text-red-400 mb-1" size={22} />
          <div className="text-2xl font-bold num text-red-400">
            {deductionCount}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">خصومات الدورة</div>
        </div>
        <div className="stat-card text-center">
          <CheckCircle className="mx-auto text-green-400 mb-1" size={22} />
          <div className="text-2xl font-bold num text-green-400">
            {approvedCount}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">معتمدة</div>
        </div>
        <div className="stat-card text-center">
          <Clock className="mx-auto text-amber-400 mb-1" size={22} />
          <div className="text-2xl font-bold num text-amber-400">
            {pendingCount}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">قيد الاعتماد</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="input-dark w-36"
        >
          <option value="الكل">كل الفروع</option>
          {BRANCHES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input-dark w-32"
        >
          <option value="كل">كل الأنواع</option>
          <option value="مكافأة">مكافأة</option>
          <option value="خصم">خصم</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-dark w-36"
        >
          <option value="كل">كل الحالات</option>
          <option value="approved">معتمد</option>
          <option value="pending">قيد المراجعة</option>
          <option value="rejected">مرفوض</option>
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم موظف أو سبب..."
          className="input-dark flex-1 min-w-[150px]"
        />
      </div>

      {/* Table */}
      {recLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="stat-card h-14 animate-pulse bg-white/5" />
          ))}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="stat-card text-center py-14">
          <Users className="mx-auto text-slate-600 mb-3" size={40} />
          <div className="text-slate-400 text-sm">
            لا توجد سجلات بالفلاتر الحالية
          </div>
          <div className="text-slate-600 text-xs mt-1">
            جرب تغيير الفلاتر أو إضافة سجل جديد
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
          <table className="data-table">
            <thead>
              <tr>
                <th>الموظف</th>
                <th>الفرع</th>
                <th>النوع</th>
                <th>النقاط</th>
                <th>السبب</th>
                <th>الحالة</th>
                <th>المنفذ</th>
                <th>التاريخ</th>
                {canManage && <th>إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((row) => {
                const st = recordStatus(row);
                const { label: stLabel, cls: stCls } = statusMeta(st);
                const pts = absPoints(row);
                return (
                  <tr key={row.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => setSelectedRecord(row)}>
                    <td className="font-medium text-white">
                      <button type="button" onClick={(event) => { event.stopPropagation(); navigate(`/staff/${row.staff_id || row.employee_id}`); }} className="text-teal-300 hover:text-teal-200 underline underline-offset-4">
                        {row.employee_name || "غير محدد"}
                      </button>
                    </td>
                    <td className="text-slate-400 text-xs">{row.branch}</td>
                    <td>
                      <span
                        className={
                          isBonus(row) ? "badge-success" : "badge-danger"
                        }
                      >
                        {isBonus(row) ? "مكافأة" : "خصم"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`num font-bold ${isBonus(row) ? "text-teal-400" : "text-red-400"}`}
                      >
                        {isBonus(row) ? "+" : "-"}
                        {pts}
                      </span>
                    </td>
                    <td className="text-slate-300 text-sm min-w-[260px] max-w-[420px]">
                      <div className="font-medium text-slate-100 leading-relaxed line-clamp-2" title={pointRecordNote(row)}>
                        {pointRecordNote(row)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1" title={pointRecordMeta(row)}>
                        {pointRecordMeta(row)}
                      </div>
                    </td>
                    <td>
                      <span className={stCls}>{stLabel}</span>
                    </td>
                    <td className="text-slate-400 text-xs max-w-[160px] truncate">
                      {formatTransactionExecutor(row)}
                    </td>
                    <td className="text-slate-400 text-xs whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </td>
                    {canManage && (
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {st !== "approved" && (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); handleApprove(row, true); }}
                              className="px-2 py-1 rounded text-xs bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 transition-colors"
                            >
                              اعتماد
                            </button>
                          )}
                          {st !== "rejected" && (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); handleApprove(row, false); }}
                              className="px-2 py-1 rounded text-xs bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                            >
                              رفض
                            </button>
                          )}
                          {st !== "pending" && (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); handleSetPending(row); }}
                              className="px-2 py-1 rounded text-xs bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors"
                            >
                              قيد المراجعة
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); handleDeleteRecord(row); }}
                            className="inline-flex items-center gap-1 rounded bg-slate-500/10 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-red-500/15 hover:text-red-300"
                            title="مسح السجل"
                          >
                            <Trash2 size={13} />
                            مسح
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-slate-500 border-t border-[#2d4063]">
            عرض {filteredRecords.length} سجل (آخر 100 إدخال)
          </div>
        </div>
      )}

      {selectedRecord && (
        <TransactionDetailsModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onStaff={() => navigate(`/staff/${selectedRecord.staff_id || selectedRecord.employee_id}`)}
        />
      )}

      {/* Add Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">
                إضافة جزاء أو حافز
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <XCircle size={22} />
              </button>
            </div>

            {/* Employee */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">
                اختر الموظف
              </label>
              <select
                value={form.employeeId}
                onChange={(e) =>
                  setForm({ ...form, employeeId: e.target.value })
                }
                className="input-dark w-full"
              >
                <option value="">-- اختر موظفاً --</option>
                {staffChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.branch}
                  </option>
                ))}
              </select>
            </div>

            {/* Type toggle */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">النوع</label>
              <div className="flex gap-2">
                {(["مكافأة", "خصم"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                      form.type === t
                        ? t === "مكافأة"
                          ? "bg-teal-500/20 text-teal-400 border-teal-500/40"
                          : "bg-red-500/20 text-red-400 border-red-500/40"
                        : "text-slate-400 border-[#2d4063] hover:border-slate-500"
                    }`}
                  >
                    {t === "مكافأة" ? "⬆ مكافأة" : "⬇ خصم"}
                  </button>
                ))}
              </div>
            </div>

            {/* Points */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">
                القيمة بالنقاط
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={form.points}
                onChange={(e) =>
                  setForm({
                    ...form,
                    points: Math.max(1, parseInt(e.target.value) || 1),
                  })
                }
                className="input-dark w-full"
              />
            </div>

            {/* Reason */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">السبب</label>
              <select
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="input-dark w-full"
              >
                {POINT_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">
                ملاحظات (اختياري)
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="input-dark w-full resize-none"
                placeholder="أي تفاصيل إضافية..."
              />
            </div>

            {/* Status — managers only */}
            {canManage && (
              <div>
                <label className="text-slate-400 text-xs mb-1 block">
                  الحالة
                </label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as RecordStatus })
                  }
                  className="input-dark w-full"
                >
                  <option value="approved">معتمد مباشرة</option>
                  <option value="pending">يحتاج مراجعة</option>
                </select>
              </div>
            )}

            {!canManage && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300">
                سيتم إرسال هذا الطلب للمراجعة من قِبل المدير قبل التطبيق.
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex-1 disabled:opacity-60"
              >
                {saving ? "جاري الحفظ..." : "حفظ"}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-secondary flex-1"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TransactionDetailsModal({ record, onClose, onStaff }: { record: PointRecord; onClose: () => void; onStaff: () => void }) {
  useEscapeKey(onClose, true);
  const details = getTransactionDetails(record);
  const fields = [
    ["الموظف", details.employee],
    ["النوع", details.type],
    ["النقاط", details.points],
    ["السبب المختصر", details.reason],
    ["الوصف", details.fullDescription],
    ["المصدر", details.source],
    ["المنفذ", details.executor],
    ["تاريخ الإنشاء", details.createdAt],
    ["تاريخ الاعتماد", details.approvedAt],
    ["الفرع", details.branch],
    ["الدورة", details.cycle],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-[#2d4063] bg-[#10213a] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <div>
            <h2 className="text-lg font-black text-white">تفاصيل سجل النقاط</h2>
            <p className="mt-1 text-xs text-slate-400">عرض إداري نظيف بدون أكواد أو بيانات تقنية</p>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary px-3 py-2">إغلاق</button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-1 whitespace-pre-line text-sm font-semibold text-white">{value || "غير محدد"}</div>
            </div>
          ))}
          <button type="button" onClick={onStaff} className="btn-primary w-full">فتح ملف الموظف</button>
        </div>
      </div>
    </div>
  );
}
