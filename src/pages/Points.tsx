import { useMemo, useState } from "react";
import { CheckCircle, Plus, Search, Star, TrendingDown, XCircle, Calculator } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AddPointsModal } from "@/components/points/AddPointsModal";
import SalaryCalculator from "@/components/points/SalaryCalculator";
import { BRANCHES, INITIAL_POINTS } from "@/lib/constants";
import { mergeRulesFromSupabase, type EvaluationRuleDef } from "@/lib/evaluationRulesCatalog";
import { calculateIncentive, getPerformanceLevel, MAX_BASE_INCENTIVE, POINT_VALUE_EGP } from "@/lib/points";
import { approverHintFromRule, applyStaffDelta } from "@/lib/pointsPersistence";
import { formatTransactionExecutor, getTransactionShortReason, isApprovedPointRecord, isRecordInCycle, pointRecordDelta, pointRecordStatus } from "@/lib/pointsLedger";
import { type PointsTxnStatus } from "@/lib/pointsWorkflow";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { calculateStaffCycleIncentiveFromRows, getStaffCycleIncentive, type StaffCycleIncentive } from "@/lib/staffIncentiveService";
import { mergeStaffChoices } from "@/lib/staffFallback";
import { formatCurrency, formatDateTime, percent, toNumber } from "@/lib/utils";
import { useAuth, getCurrentUserProfile } from "@/hooks/useAuth";
import { logActivity, useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { TABLES } from "@/lib/supabaseTables";

interface StaffMember {
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
  approved_by?: string | null;
  created_by_id?: string | null;
  branch: string;
  branch_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  source_type?: string | null;
  source?: string | null;
  source_id?: string | null;
  title?: string | null;
  created_by_name?: string | null;
  executor_name?: string | null;
  item_name?: string | null;
  item_quantity?: number | null;
  metadata?: unknown;
  month_cycle?: string | null;
  cycle_start?: string | null;
  cycle_end?: string | null;
  status?: string | null;
}

function parseNoteStatus(note: string | null | undefined): PointsTxnStatus | null {
  const match = note?.match(/حالة:(pending|approved|rejected)/);
  return (match?.[1] as PointsTxnStatus) || null;
}

function cleanManagerNote(note: string | null | undefined) {
  return note?.replace(/__RULE__:[^\n]+\n?/, "").replace(/حالة:(pending|approved|rejected)\n?/g, "").trim() || "—";
}

function isBonusRecord(row: PointRecord) {
  return pointRecordDelta(row) > 0;
}

function isDeductionRecord(row: PointRecord) {
  return pointRecordDelta(row) < 0;
}

function recordPoints(row: PointRecord) {
  return Math.abs(pointRecordDelta(row));
}

function improvementTip(ruleTitle: string): string {
  return `كيفية التحسين: راجع بند «${ruleTitle}» مع مديرك، وطبّق التعليمات المعتمدة، ثم تابع خلال أسبوع لإظهار التصحيح.`;
}

function normalizeStaffLookupKey(value: string) {
  return value
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/^(\u062f|dr|doctor)\s*\/?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default function Points() {
  const { user, canManage, hasPermission } = useAuth();
  const [tab, setTab] = useState<"overview" | "records" | "rules" | "approvals" | "mine" | "salary">("overview");
  const [showAddModal, setShowAddModal] = useState(false);
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [search, setSearch] = useState("");
  const [selectedStaffForSalary, setSelectedStaffForSalary] = useState<StaffMember | null>(null);

  const cycle = getCurrentCycle();

  const { data: staffList, loading: staffLoading, refetch: refetchStaff } = useSupabaseQuery<StaffMember>({
    table: "staff",
    orderBy: { column: "points", ascending: false },
    realtimeEnabled: true,
  });

  const { data: records, loading: recLoading, refetch: refetchRecords } = useSupabaseQuery<PointRecord>({
    table: TABLES.employeeTransactions,
    orderBy: { column: "created_at", ascending: false },
    realtimeEnabled: true,
  });

  const { data: remoteRulesRows } = useSupabaseQuery<Record<string, unknown>>({
    table: "evaluation_rules",
    filters: [{ column: "active", operator: "eq", value: true }],
    realtimeEnabled: false,
  });

  const mergedRules = useMemo(() => mergeRulesFromSupabase(remoteRulesRows || []), [remoteRulesRows]);
  const staffChoices = useMemo(() => mergeStaffChoices(staffList), [staffList]);
  const validStaffIds = useMemo(() => new Set(staffChoices.map((staff) => staff.id)), [staffChoices]);
  const validStaffNames = useMemo(() => {
    const set = new Set<string>();
    for (const staff of staffChoices) {
      const name = staff.name.trim();
      if (!name) continue;
      set.add(name);
      set.add(normalizeStaffLookupKey(name));
    }
    return set;
  }, [staffChoices]);
  const staffIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const staff of staffChoices) {
      const name = staff.name.trim();
      if (name && !map.has(name)) map.set(name, staff.id);
      const normalizedName = normalizeStaffLookupKey(name);
      if (normalizedName && !map.has(normalizedName)) map.set(normalizedName, staff.id);
    }
    return map;
  }, [staffChoices]);
  const canonicalRecords = useMemo(() => records.map((row) => {
    const employee = staffChoices.find((staff) => staff.id === (row.staff_id || row.employee_id));
    const signedPoints = pointRecordDelta(row);
    const rawPoints = Math.abs(signedPoints);
    return {
      ...row,
      employee_id: row.employee_id || row.staff_id || "",
      employee_name: row.employee_name || employee?.name || "",
      points: rawPoints,
      points_delta: signedPoints,
      type: row.type === "reward" ? "bonus" : row.type === "penalty" ? "deduction" : row.type,
      manager_note: row.manager_note || row.description || null,
      created_by: row.created_by || row.created_by_id || "",
      branch: row.branch || employee?.branch || "",
      status: row.status === "active" ? "approved" : row.status === "cancelled" ? "rejected" : row.status,
    };
  }), [records, staffChoices]);

  const validRecords = useMemo(() => canonicalRecords.filter((row) => {
    const employeeId = String(row.employee_id || "").trim();
    const employeeName = String(row.employee_name || "").trim();
    return validStaffIds.has(employeeId) || validStaffNames.has(employeeName) || validStaffNames.has(normalizeStaffLookupKey(employeeName));
  }), [canonicalRecords, validStaffIds, validStaffNames]);
  const cycleRecords = useMemo(() => validRecords.filter((row) => isRecordInCycle(row, cycle)) as PointRecord[], [validRecords, cycle]);
  const approvedCycleRecords = useMemo(() => {
    return cycleRecords.filter((row) => isApprovedPointRecord(row));
  }, [cycleRecords]);
  const normalizedSearch = search.replace(/\*/g, " ").replace(/\s+/g, " ").trim();

  const filteredStaff = staffChoices.filter((staff) => {
    const branchMatches = branchFilter === "الكل" || staff.branch === branchFilter;
    const searchText = `${staff.name || ""} ${staff.role || ""} ${staff.branch || ""} ${staff.phone || ""}`.replace(/\s+/g, " ");
    const searchMatches = normalizedSearch === "" || searchText.includes(normalizedSearch);
    return branchMatches && searchMatches;
  });

  const topPerformers = [...staffChoices]
    .sort((a, b) => staffIncentiveSummary(b).currentPoints - staffIncentiveSummary(a).currentPoints)
    .slice(0, 3);
  const pendingApprovals = validRecords.filter((row) => pointRecordStatus(row) === "pending" && isDeductionRecord(row));
  const myCycleRecords = approvedCycleRecords.filter((row) => row.employee_id === user?.id);

  const staffCycleRecords = (staff: StaffMember) => {
    const normalizedName = normalizeStaffLookupKey(staff.name);
    return approvedCycleRecords.filter((row) => {
      const employeeName = String(row.employee_name || "").trim();
      return (
        row.employee_id === staff.id ||
        row.staff_id === staff.id ||
        employeeName === staff.name.trim() ||
        normalizeStaffLookupKey(employeeName) === normalizedName
      );
    });
  };

  const staffIncentiveSummary = (staff: StaffMember) => {
    // استخدام calculateStaffCycleIncentiveFromRows مع البيانات المحلية للتوافق مع SalaryCalculator
    // في المستقبل يمكن استخدام getStaffCycleIncentive لجمع من جميع المصادر
    const incentive = calculateStaffCycleIncentiveFromRows({
      staff,
      records: validRecords,
      cycle,
    });
    // تحويل StaffIncentiveTransaction[] إلى IncentiveTransaction[] للتوافق مع SalaryCalculator
    const records = [...incentive.rewardTransactions, ...incentive.deductionTransactions].map(tx => ({
      id: tx.id || `${tx.source_type}:${tx.source_id}`,
      type: tx.type,
      reason: tx.reason,
      manager_note: tx.manager_note,
      description: tx.description,
      source: tx.source,
      source_type: tx.source_type,
      created_by: tx.created_by,
      created_at: tx.created_at,
      points: typeof tx.points === 'number' ? tx.points : Number(tx.points || 0),
      points_delta: typeof tx.points_delta === 'number' ? tx.points_delta : Number(tx.points_delta || 0),
      status: tx.status,
    }));
    return {
      staff,
      records,
      currentPoints: incentive.finalPoints,
      maxPoints: incentive.startingPoints,
      rewardPoints: incentive.approvedRewardPoints,
      penaltyPoints: incentive.approvedDeductionPoints,
      pendingRewardPoints: incentive.pendingRewardPoints,
      pendingDeductionPoints: incentive.pendingDeductionPoints,
      incentive: incentive.incentiveValue,
      warnings: incentive.warnings,
    };
  };

  const printAllIncentivesReport = () => {
    const rows = staffChoices.map(staffIncentiveSummary);
    const totalIncentive = rows.reduce((sum, row) => sum + row.incentive, 0);
    const totalRewards = rows.reduce((sum, row) => sum + row.rewardPoints, 0);
    const totalPenalties = rows.reduce((sum, row) => sum + row.penaltyPoints, 0);
    const reportRows = rows
      .map((row) => `<tr>
        <td>${row.staff.name}</td>
        <td>${row.staff.role || "-"}</td>
        <td>${row.staff.branch || "-"}</td>
        <td>${row.currentPoints} / ${row.maxPoints}</td>
        <td>${row.rewardPoints}</td>
        <td>${row.penaltyPoints}</td>
        <td>${formatCurrency(row.incentive)}</td>
        <td>${row.records.length}</td>
      </tr>`)
      .join("");
    const win = window.open("", "_blank", "width=1100,height=780");
    if (!win) {
      toast.error("المتصفح منع فتح نافذة التقرير. اسمح بالنوافذ المنبثقة للتصدير.");
      return;
    }
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
      <title>تقرير حوافز كل الموظفين</title>
      <style>
        body{font-family:Arial,Tahoma,sans-serif;margin:28px;color:#102033;direction:rtl}
        h1{margin:0 0 8px;font-size:25px}.muted{color:#667085}.box{border:1px solid #d8dee8;border-radius:12px;padding:16px;margin:12px 0}
        table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #d8dee8;padding:9px;text-align:right;font-size:13px}th{background:#eef5f8}.num{font-weight:700;font-size:20px}
        .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.summary div{background:#f6fafb;border:1px solid #d8dee8;border-radius:10px;padding:12px}
        button{padding:10px 18px;border:0;border-radius:8px;background:#00a98f;color:white;font-weight:700;cursor:pointer}@media print{button{display:none}.box{break-inside:avoid}}
      </style></head><body>
      <button onclick="window.print()">تصدير PDF</button>
      <h1>صيدليات دواء - تقرير حوافز كل الموظفين</h1>
      <div class="muted">الدورة: ${cycle.label} - تاريخ الإصدار: ${new Date().toLocaleString("ar-EG")}</div>
      <div class="summary">
        <div><span class="muted">عدد الموظفين</span><br><span class="num">${rows.length}</span></div>
        <div><span class="muted">إجمالي الحوافز</span><br><span class="num">${formatCurrency(totalIncentive)}</span></div>
        <div><span class="muted">نقاط المكافآت</span><br><span class="num">${totalRewards}</span></div>
        <div><span class="muted">نقاط الخصومات</span><br><span class="num">${totalPenalties}</span></div>
      </div>
      <div class="box"><h2>تفاصيل الموظفين</h2><table>
        <thead><tr><th>الموظف</th><th>الدور</th><th>الفرع</th><th>النقاط</th><th>مكافآت</th><th>خصومات</th><th>الحافز النهائي</th><th>عمليات الدورة</th></tr></thead>
        <tbody>${reportRows || `<tr><td colspan="8">لا توجد بيانات موظفين</td></tr>`}</tbody>
      </table></div>
      <div class="box"><h2>طريقة الحساب</h2><table>
        <tr><th>بداية الرصيد</th><td>${INITIAL_POINTS} نقطة</td></tr>
        <tr><th>قيمة النقطة</th><td>${POINT_VALUE_EGP} جنيه</td></tr>
        <tr><th>الحافز النهائي</th><td>النقاط النهائية × قيمة النقطة، بحد أقصى ${formatCurrency(MAX_BASE_INCENTIVE)}</td></tr>
      </table></div>
      <script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>
      </body></html>`);
    win.document.close();
  };

  const approveRecord = async (row: PointRecord, approve: boolean) => {
    if (!canManage && !await hasPermission("approve_points_changes")) return;
    const note = row.manager_note || "";
    const nextStatus: PointsTxnStatus = approve ? "approved" : "rejected";
    const updatedNote = note.includes("حالة:pending") ? note.replace(/حالة:pending/, `حالة:${nextStatus}`) : `${note}\nحالة:${nextStatus}`;
    const nextNote = approve ? `${updatedNote}\nمعتمد:${user?.name} (${user?.role})` : updatedNote;

    const { error } = await supabase.from(TABLES.employeeTransactions).update({ description: nextNote, status: nextStatus === "approved" ? "active" : "cancelled" }).eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    if (approve && isDeductionRecord(row)) {
      const rowEmployeeName = normalizeStaffLookupKey(String(row.employee_name || ""));
      const employee = staffChoices.find((staff) => staff.id === row.employee_id || normalizeStaffLookupKey(staff.name) === rowEmployeeName);
      if (employee) {
        const currentIncentive = calculateStaffCycleIncentiveFromRows({ staff: employee, records: approvedCycleRecords, cycle });
        await applyStaffDelta(
          employee.id,
          currentIncentive.finalPoints,
          currentIncentive.startingPoints,
          -recordPoints(row),
          employee.name,
          employee.branch,
        );
      }
    }

    const currentUserProfile = getCurrentUserProfile();
    await logActivity(
      currentUserProfile.id,
      currentUserProfile.name,
      approve ? "اعتماد خصم" : "رفض خصم",
      "النقاط",
      `${row.reason} - ${row.employee_name}`,
      row.branch || "",
      { user_role: user?.role, target_type: "point_record", target_id: row.id }
    );

    toast.success(approve ? "تم اعتماد الخصم" : "تم رفض الخصم");
    refetchRecords();
    refetchStaff();
  };

  if (staffLoading || recLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="stat-card h-24 animate-pulse bg-white/5" />
        ))}
      </div>
    );
  }

  const cycleBonusPoints = approvedCycleRecords.filter(isBonusRecord).reduce((sum, row) => sum + recordPoints(row), 0);
  const cycleDeductionPoints = approvedCycleRecords.filter(isDeductionRecord).reduce((sum, row) => sum + recordPoints(row), 0);

  // Calculate salary for selected staff
  const handleCalculateSalary = (staff: StaffMember) => {
    setSelectedStaffForSalary(staff);
    setTab("salary");
  };

  return (
    <div className="space-y-5">
      <div className="bg-teal-500/10 border border-teal-500/25 rounded-xl p-4 text-sm text-slate-300 leading-relaxed">
        النظام هدفه تحسين الأداء ومكافأة الالتزام، وليس تصيد الأخطاء. استخدم الخصومات كأداة توجيه، وركز على التحسين المستمر.
      </div>

      <div className="bg-gradient-to-r from-teal-500/10 to-teal-600/5 border border-teal-500/20 rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <div className="text-teal-300 font-bold text-sm mb-1">الدورة الشهرية (26 إلى 25)</div>
          <div className="text-white font-bold text-lg">{cycle.label}</div>
          <div className="text-slate-400 text-sm mt-1">
            بداية الرصيد {INITIAL_POINTS} نقطة، الحد الأقصى {INITIAL_POINTS}، الحد الأدنى 0، قيمة النقطة {POINT_VALUE_EGP} ج، والحافز الكامل حتى {MAX_BASE_INCENTIVE.toLocaleString("ar-EG")} ج.
          </div>
        </div>
        <div className="flex gap-4 flex-wrap">
          <StatChip label="مكافآت الدورة" value={cycleBonusPoints} tone="teal" />
          <div className="w-px bg-[#2d4063]" />
          <StatChip label="خصومات الدورة" value={cycleDeductionPoints} tone="red" />
          <div className="w-px bg-[#2d4063]" />
          <StatChip label="عمليات الدورة" value={approvedCycleRecords.length} tone="white" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setSelectedStaffForSalary((current) => current || filteredStaff[0] || staffChoices[0] || null);
              setTab("salary");
            }}
            className="btn-secondary flex items-center gap-2"
          >
            <Calculator size={16} /> حساب الحوافز
          </button>
          <button type="button" onClick={printAllIncentivesReport} className="btn-secondary flex items-center gap-2">
            تصدير PDF لكل الموظفين
          </button>
          {(canManage || user?.permissions?.create_reward === true || user?.permissions?.create_deduction === true || user?.permissions?.edit_points_transaction === true) && (
            <button type="button" onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> نقاط / خصم / تعديل
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {topPerformers.map((employee, index) => {
          const employeeSummary = staffIncentiveSummary(employee);
          const employeePoints = employeeSummary.currentPoints;
          return (
          <div
            key={employee.id}
            className={`stat-card text-center border hover:border-teal-500/40 transition-colors ${index === 0 ? "border-amber-500/30" : index === 1 ? "border-slate-400/20" : "border-orange-600/20"}`}
          >
            <div className="text-3xl mb-2">{index === 0 ? "1" : index === 1 ? "2" : "3"}</div>
            <div className="text-white font-bold text-sm">{employee.name}</div>
            <div className="text-slate-400 text-xs mt-0.5">{employee.branch}</div>
            <div className={`text-2xl font-bold num mt-2 ${index === 0 ? "text-amber-400" : index === 1 ? "text-slate-300" : "text-orange-400"}`}>{employeePoints}</div>
            <div className="text-slate-400 text-xs mt-1">
              {getPerformanceLevel(employeePoints)} - حافز متوقع {employeeSummary.incentive.toLocaleString("ar-EG")} ج
            </div>
            <div className="progress-bar mt-2">
              <div className="progress-fill" style={{ width: `${percent(employeePoints, employeeSummary.maxPoints)}%` }} />
            </div>
            <div className="text-slate-400 text-xs mt-2">{employee.branch}</div>
            <button
              onClick={() => handleCalculateSalary(employee)}
              className="mt-3 w-full btn-secondary text-xs py-1.5"
            >
              حساب الحوافز
            </button>
          </div>
          );
        })}
      </div>

      {tab === "salary" && selectedStaffForSalary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SalaryCalculator
            staffName={selectedStaffForSalary.name}
            role={selectedStaffForSalary.role}
            branch={selectedStaffForSalary.branch}
            cycleLabel={cycle.label}
            currentPoints={staffIncentiveSummary(selectedStaffForSalary).currentPoints}
            maxPoints={staffIncentiveSummary(selectedStaffForSalary).maxPoints}
            rewardPoints={staffIncentiveSummary(selectedStaffForSalary).rewardPoints}
            penaltyPoints={staffIncentiveSummary(selectedStaffForSalary).penaltyPoints}
            records={staffIncentiveSummary(selectedStaffForSalary).records}
          />
          <div className="stat-card">
            <h3 className="text-white font-bold mb-3">ملخص حوافز {selectedStaffForSalary.name}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">الاسم:</span>
                <span className="text-white">{selectedStaffForSalary.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">الفرع:</span>
                <span className="text-white">{selectedStaffForSalary.branch}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">الدور:</span>
                <span className="text-white">{selectedStaffForSalary.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">النقاط:</span>
                <span className="text-white num">{staffIncentiveSummary(selectedStaffForSalary).currentPoints}</span>
              </div>
            </div>
            <button
              onClick={() => setTab("overview")}
              className="mt-4 w-full btn-secondary"
            >
              العودة للنظرة العامة
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#1B2B4B]/80 border border-[#2d4063] rounded-xl p-4 text-sm text-slate-300">
        <div className="text-teal-300 font-semibold text-xs mb-2">اقتراحات لتطوير الأداء والفريق</div>
        <ul className="list-disc list-inside space-y-1.5 text-slate-400 text-xs leading-relaxed">
          <li>راجع أسباب الخصومات مع الموظف في جلسة قصيرة وحدد هدف تحسين واحد للأسبوع القادم.</li>
          <li>اشرح تأثير الخصم على الحافز بأرقام واضحة، لأن كل نقطة تساوي {POINT_VALUE_EGP} جنيه.</li>
          <li>استخدم المكافآت كنماذج تعليمية للفريق، وليس فقط كرصيد نقاط.</li>
          <li>اعرض قواعد النقاط كاملة في اجتماع أسبوعي قصير حتى يعرف كل شخص المطلوب منه.</li>
        </ul>
      </div>

      <div className="flex gap-2 bg-[#1B2B4B] border border-[#2d4063] p-1.5 rounded-xl flex-wrap w-fit">
        {[
          ["overview", "نظرة عامة"],
          ["records", "السجلات"],
          ["rules", "القواعد الكاملة"],
          ...(canManage || user?.permissions?.approve_points_changes === true ? ([["approvals", `خصومات تحتاج اعتماد (${pendingApprovals.length})`]] as const) : []),
          ["mine", "خصوماتي ومكافآتي"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === key ? "bg-teal-500/15 text-teal-400 border border-teal-500/20" : "text-slate-400 hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="flex gap-3 flex-col md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم دكتور أو دليفري أو أي فرد من الفريق" className="input-dark pr-10" />
            </div>
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="input-dark md:w-40">
              <option value="الكل">كل الفروع</option>
              {BRANCHES.map((branch) => (
                <option key={branch}>{branch}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredStaff.map((employee) => {
              const summary = staffIncentiveSummary(employee);
              const points = summary.currentPoints;
              const maxPoints = summary.maxPoints;
              const pointPercent = percent(points, maxPoints);
              const normalizedEmployeeName = normalizeStaffLookupKey(employee.name);
              const employeeRecords = summary.records;
              const rewards = summary.rewardPoints;
              const deductions = summary.penaltyPoints;

              return (
                <Link key={employee.id} to={`/staff/${employee.id}`} className="stat-card hover:border-teal-500/30 block transition-colors">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-teal-500/15 flex items-center justify-center text-teal-400 font-bold">{employee.name[0]}</div>
                    <div className="flex-1">
                      <div className="text-white font-bold text-sm">{employee.name}</div>
                      <div className="text-slate-400 text-xs">
                        {employee.role} - {employee.branch}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className={`text-xl font-bold num ${pointPercent >= 90 ? "text-teal-400" : pointPercent >= 70 ? "text-amber-400" : "text-red-400"}`}>{points}</div>
                      <div className="text-slate-500 text-xs">/ {maxPoints}</div>
                    </div>
                  </div>
                  <div className="progress-bar mb-3">
                    <div
                      className={`h-full rounded-full transition-all ${pointPercent >= 90 ? "bg-gradient-to-r from-teal-500 to-teal-400" : pointPercent >= 70 ? "bg-gradient-to-r from-amber-500 to-amber-400" : "bg-gradient-to-r from-red-500 to-red-400"}`}
                      style={{ width: `${pointPercent}%` }}
                    />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <span className="badge-success text-xs">+{rewards} مكافآت</span>
                    <span className="badge-danger text-xs">-{deductions} خصومات</span>
                    <span className="text-slate-400 text-xs mr-auto">{employeeRecords.length} عملية</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {tab === "records" && <RecordsTable records={validRecords} staffIdByName={staffIdByName} validStaffIds={validStaffIds} />}
      {tab === "rules" && <RulesBoard rules={mergedRules} />}
      {tab === "approvals" && (canManage || user?.permissions?.approve_points_changes === true) && <ApprovalsBoard pending={pendingApprovals} onApprove={approveRecord} />}
      {tab === "mine" && <MineBoard rows={myCycleRecords} />}

      {showAddModal && (
        <AddPointsModal
          onClose={() => setShowAddModal(false)}
          staffList={staffChoices}
          rules={mergedRules}
          records={validRecords}
          cycle={cycle}
          user={user ? { id: user.id, name: user.name, role: user.role } : null}
          onDone={() => {
            refetchRecords();
            refetchStaff();
          }}
        />
      )}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "teal" | "red" | "white" }) {
  const cls = tone === "teal" ? "text-teal-400" : tone === "red" ? "text-red-400" : "text-white";
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold num ${cls}`}>{value}</div>
      <div className="text-slate-400 text-xs mt-0.5">{label}</div>
    </div>
  );
}

function RecordsTable({
  records,
  staffIdByName,
  validStaffIds,
}: {
  records: PointRecord[];
  staffIdByName: Map<string, string>;
  validStaffIds: Set<string>;
}) {
  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>النوع</th>
              <th>النقاط</th>
              <th>السبب</th>
              <th>حالة الاعتماد</th>
              <th>ملاحظات</th>
              <th>بواسطة</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {records.map((row) => {
              const source = row.source_type || row.source;
              const rawEmployeeId = String(row.employee_id || "").trim();
              const employeeName = String(row.employee_name || "").trim();
              const resolvedEmployeeId = validStaffIds.has(rawEmployeeId)
                ? rawEmployeeId
                : staffIdByName.get(employeeName) || staffIdByName.get(normalizeStaffLookupKey(employeeName)) || rawEmployeeId;
              const isConversationReview =
                (source === "conversation_evaluation" || source === "conversation_review" || source === "conversation_sales_reviews") && row.source_id && resolvedEmployeeId;
              const points = recordPoints(row);
              const isPositive = isBonusRecord(row);
              const isNeutral = !isBonusRecord(row) && !isDeductionRecord(row);
              return (
                <tr key={row.id}>
                  <td className="text-white font-medium">{row.employee_name}</td>
                  <td>
                    <span className={isPositive ? "badge-success" : isNeutral ? "badge-info" : "badge-danger"}>{row.type}</span>
                  </td>
                  <td>
                    <span className={`font-bold num ${isPositive ? "text-teal-400" : isNeutral ? "text-slate-300" : "text-red-400"}`}>
                      {isPositive ? "+" : isNeutral ? "" : "-"}
                      {points}
                    </span>
                  </td>
                  <td className="text-slate-300">
                    {isConversationReview ? (
                      <Link to={`/staff/${resolvedEmployeeId}?review=${row.source_id}`} className="text-teal-300 hover:text-teal-200 underline underline-offset-4" title="فتح تفاصيل تقييم المحادثة">
                        {getTransactionShortReason(row) || "تقييم محادثة عميل"}
                      </Link>
                    ) : (
                      getTransactionShortReason(row)
                    )}
                  </td>
                  <td className="text-slate-300 text-xs">{parseNoteStatus(row.manager_note) || row.status || "معتمد"}</td>
                  <td className="text-slate-400 text-xs max-w-[200px] truncate">{cleanManagerNote(row.manager_note)}</td>
                  <td className="text-slate-400">{formatTransactionExecutor(row)}</td>
                  <td className="text-slate-400 text-xs">{formatDateTime(row.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {records.length === 0 && <div className="py-8 text-center text-slate-400 text-sm">لا توجد سجلات بعد.</div>}
    </div>
  );
}

function RulesBoard({ rules }: { rules: EvaluationRuleDef[] }) {
  const categories = Array.from(new Set(rules.map((rule) => rule.category)));
  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <div key={category}>
          <div className="section-title mb-3">{category}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rules
              .filter((rule) => rule.category === category)
              .map((rule) => (
                <div key={rule.code} className={`stat-card border ${rule.type === "bonus" ? "border-teal-500/20" : "border-red-500/20"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${rule.type === "bonus" ? "bg-teal-500/15 text-teal-400" : "bg-red-500/15 text-red-400"}`}>
                      {rule.type === "bonus" ? <Star size={18} /> : <TrendingDown size={18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white font-bold text-sm">{rule.title}</span>
                        <span className={`text-lg font-bold num whitespace-nowrap ${rule.type === "bonus" ? "text-teal-400" : "text-red-400"}`}>
                          {rule.type === "bonus" ? "+" : "-"}
                          {rule.default_points}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[10px] mt-0.5 font-mono">{rule.code}</div>
                      <div className="text-slate-400 text-xs mt-1">{rule.description}</div>
                      <div className="text-slate-500 text-[11px] mt-2 space-y-0.5">
                        <div>
                          الشدة: {rule.severity} - اعتماد إداري: {rule.requires_approval ? "نعم" : "لا"} - دليل: {rule.evidence_required ? "مطلوب" : "اختياري"}
                        </div>
                        <div>يجوز الاعتماد من: {approverHintFromRule(rule) || "—"}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ApprovalsBoard({ pending, onApprove }: { pending: PointRecord[]; onApprove: (row: PointRecord, approve: boolean) => void }) {
  return (
    <div className="space-y-3">
      <div className="section-title">خصومات تحتاج اعتماد</div>
      {pending.length === 0 ? (
        <div className="stat-card text-slate-400 text-sm text-center py-10">لا توجد طلبات معلقة.</div>
      ) : (
        pending.map((row) => (
          <div key={row.id} className="stat-card flex flex-col md:flex-row md:items-center gap-3 border border-amber-500/20">
            <div className="flex-1">
              <div className="text-white font-bold text-sm">{row.employee_name}</div>
              <div className="text-slate-400 text-xs mt-1">{getTransactionShortReason(row)}</div>
              <div className="text-red-300 font-bold num mt-2">-{recordPoints(row)} نقطة</div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onApprove(row, true)} className="btn-primary flex items-center gap-1 text-sm py-2">
                <CheckCircle size={14} /> اعتماد
              </button>
              <button type="button" onClick={() => onApprove(row, false)} className="btn-secondary flex items-center gap-1 text-sm py-2">
                <XCircle size={14} /> رفض
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MineBoard({ rows }: { rows: PointRecord[] }) {
  return (
    <div className="space-y-3">
      <div className="section-title">حركتك في الدورة الحالية</div>
      {rows.length === 0 ? (
        <div className="stat-card text-center text-slate-400 py-10 text-sm">لا توجد عمليات مسجلة في هذه الدورة.</div>
      ) : (
        rows.map((row) => {
          const isPositive = isBonusRecord(row);
          return (
            <div key={row.id} className="stat-card border border-[#2d4063]">
              <div className="flex justify-between gap-2 flex-wrap">
                <span className={isPositive ? "badge-success" : "badge-danger"}>{row.type}</span>
                <span className="text-slate-400 text-xs">{parseNoteStatus(row.manager_note) || row.status || "معتمد"}</span>
              </div>
              <div className="text-white font-medium mt-2">{getTransactionShortReason(row)}</div>
              {isDeductionRecord(row) && <div className="text-slate-400 text-xs mt-2">{improvementTip(getTransactionShortReason(row))}</div>}
              <div className={`font-bold num mt-2 ${isPositive ? "text-teal-400" : "text-red-400"}`}>
                {isPositive ? "+" : "-"}
                {recordPoints(row)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
