import { useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import type { EvaluationRuleDef } from "@/lib/evaluationRulesCatalog";
import { rulesForStaffRole } from "@/lib/evaluationRulesCatalog";
import type { PharmacyCycle } from "@/lib/pharmacy-cycle";
import {
  computeDeductionWithRepeat,
  countPreviousRuleApplicationsInCycle,
  evidenceRequiredForSubmission,
  type OperationKind,
} from "@/lib/pointsWorkflow";
import { approverHintFromRule, applyStaffDelta, persistPointsTransaction, shouldApplyToBalance } from "@/lib/pointsPersistence";
import { logActivity } from "@/hooks/useSupabaseQuery";
import { canonicalMaxPoints, effectiveCyclePoints, type PointLedgerRecord } from "@/lib/pointsLedger";

export interface StaffPickerRow {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id?: string | null;
  status?: string | null;
  active?: boolean | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
  points: number | null;
  max_points: number | null;
}

interface PointRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  type: string;
  points: number;
  reason: string;
  manager_note: string | null;
  created_by: string;
  branch: string;
  created_at: string;
}

const OPERATION_LABELS: Record<OperationKind, string> = {
  bonus: "مكافأة",
  deduction: "خصم",
  admin_adjustment: "تعديل إداري",
};

function isSelectableStaff(row: StaffPickerRow | undefined | null) {
  if (!row?.id || !row.name?.trim()) return false;
  if (row.deleted_at || row.is_deleted) return false;
  if (row.active === false) return false;
  const status = String(row.status || "").trim().toLowerCase();
  const inactiveStatuses = ["inactive", "deleted", "archived", "disabled", "false", "غير نشط", "محذوف", "موقوف"];
  return !(status && inactiveStatuses.includes(status));
}

function cycleDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function AddPointsModal({
  onClose,
  staffList,
  rules,
  records,
  cycle,
  user,
  onDone,
}: {
  onClose: () => void;
  staffList: StaffPickerRow[];
  rules: EvaluationRuleDef[];
  records: PointRecord[];
  cycle: PharmacyCycle;
  user: { id: string; name: string; role: string } | null;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState<OperationKind>("bonus");
  const [staffId, setStaffId] = useState("");
  const [appliedById, setAppliedById] = useState("");
  const [ruleCode, setRuleCode] = useState("");
  const [note, setNote] = useState("");
  const [adminDelta, setAdminDelta] = useState("0");
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleCategory, setRuleCategory] = useState("الكل");

  useEscapeKey(onClose, true);

  const selectableStaff = useMemo(() => staffList.filter(isSelectableStaff), [staffList]);
  const selectedStaff = selectableStaff.find((s) => s.id === staffId);

  const applierOptions = useMemo(() => {
    if (user && !selectableStaff.some((item) => item.id === user.id)) {
      return [{ id: user.id, name: user.name, role: user.role, branch: "الإدارة", points: null, max_points: null }, ...selectableStaff];
    }
    return selectableStaff;
  }, [selectableStaff, user]);

  const selectedApplier =
    applierOptions.find((item) => item.id === appliedById) ||
    (user ? { id: user.id, name: user.name, role: user.role, branch: "الإدارة", points: null, max_points: null } : null);

  const scopedRules = selectedStaff ? rules.filter((r) => rulesForStaffRole(selectedStaff.role).some((x) => x.code === r.code)) : rules;
  const selectedRule = rules.find((r) => r.code === ruleCode) || null;

  const repeatPreview = useMemo(() => {
    if (!selectedRule || operation !== "deduction" || selectedRule.repeat_policy !== "double_per_cycle" || !staffId) return null;
    const prev = countPreviousRuleApplicationsInCycle(records, staffId, selectedRule.code, cycle);
    const calc = computeDeductionWithRepeat(selectedRule.default_points, prev, selectedRule.max_points_cap);
    return { prev, ...calc, showWarn: prev > 0 };
  }, [selectedRule, operation, records, staffId, cycle]);

  const ruleCategories = useMemo(() => {
    const cats = scopedRules
      .filter((r) => operation === "bonus" ? r.type === "bonus" : operation === "deduction" ? r.type === "deduction" : true)
      .map((r) => r.category || "عام");
    return ["الكل", ...Array.from(new Set(cats))];
  }, [scopedRules, operation]);

  const normalizedRuleSearch = ruleSearch.replace(/\s+/g, " ").trim().toLowerCase();
  const filteredRulesForOp = scopedRules.filter((r) => {
    const matchesOp = operation === "bonus" ? r.type === "bonus" : operation === "deduction" ? r.type === "deduction" : true;
    const matchesCategory = ruleCategory === "الكل" || (r.category || "عام") === ruleCategory;
    const text = `${r.title} ${r.category} ${r.description} ${r.code}`.toLowerCase();
    const matchesSearch = !normalizedRuleSearch || text.includes(normalizedRuleSearch);
    return matchesOp && matchesCategory && matchesSearch;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId || !selectedStaff || !user || !isSelectableStaff(selectedStaff)) {
      toast.error("الموظف غير موجود أو غير نشط، برجاء تحديث الصفحة واختيار موظف صحيح.");
      return;
    }

    if (operation !== "admin_adjustment") {
      if (!selectedRule) {
        toast.error("اختر سبب القاعدة من القائمة");
        return;
      }
      if (evidenceRequiredForSubmission(selectedRule, operation, note)) {
        toast.error("هذا الخصم يتطلب ملاحظة أو دليل أوضح");
        return;
      }
    }

    let rulePayload: EvaluationRuleDef | null = selectedRule;
    let basePts: number | undefined;
    let repCt: number | undefined;
    let mult: number | undefined;
    let finalPts: number | undefined;
    let pointsVal = 0;

    if (operation === "admin_adjustment") {
      const delta = Number(adminDelta);
      if (!Number.isFinite(delta) || delta === 0) {
        toast.error("أدخل قيمة تعديل صحيحة");
        return;
      }
      rulePayload = null;
      pointsVal = Math.abs(delta);
    } else if (operation === "deduction") {
      const prev = repeatPreview?.repeat_count ?? countPreviousRuleApplicationsInCycle(records, staffId, selectedRule!.code, cycle);
      const calc = computeDeductionWithRepeat(selectedRule!.default_points, prev, selectedRule!.max_points_cap);
      basePts = calc.base_points;
      repCt = calc.repeat_count;
      mult = calc.multiplier;
      finalPts = calc.final_points;
      pointsVal = finalPts;
    } else {
      pointsVal = selectedRule!.default_points;
    }

    const status = "approved" as const;

    setSaving(true);
    const { error } = await persistPointsTransaction({
      employeeId: staffId,
      employeeName: selectedStaff.name,
      branch: selectedStaff.branch,
      branchId: selectedStaff.branch_id ?? null,
      operation,
      rule: rulePayload,
      pointsToStore: pointsVal,
      basePoints: basePts,
      repeatCount: repCt,
      multiplier: mult,
      finalPoints: finalPts,
      userNote: note,
      createdByName: selectedApplier?.name || user.name,
      createdById: selectedApplier?.id || user.id,
      createdByRole: selectedApplier?.role || user.role,
      approvedBy: user.id,
      status,
      cycle,
      source: "manual_admin",
      sourceModule: "manual_admin",
      description: note,
      approverRequiredLabel: selectedRule ? approverHintFromRule(selectedRule) : undefined,
      adminDeltaSigned: operation === "admin_adjustment" ? Number(adminDelta) : undefined,
    });

    if (error) {
      toast.error("تعذر حفظ العملية. تأكد من تحديث قاعدة البيانات ثم حاول مرة أخرى.");
      setSaving(false);
      return;
    }

    const deltaBalance =
      operation === "admin_adjustment"
        ? Number(adminDelta)
        : operation === "bonus"
          ? pointsVal
          : shouldApplyToBalance(status)
            ? -pointsVal
            : 0;

    if (shouldApplyToBalance(status) && deltaBalance !== 0) {
      const currentPoints = effectiveCyclePoints(selectedStaff, records as PointLedgerRecord[], cycle);
      await applyStaffDelta(
        staffId,
        currentPoints,
        canonicalMaxPoints(selectedStaff),
        deltaBalance,
        selectedStaff.name,
        selectedStaff.branch,
      );
    }

    await logActivity(
      user.id,
      user.name,
      operation === "bonus" ? "إضافة مكافأة" : operation === "deduction" ? "إضافة خصم" : "تعديل إداري نقاط",
      "النقاط",
      `${OPERATION_LABELS[operation]} ${Math.abs(deltaBalance || pointsVal)} نقطة على ${selectedStaff.name}`,
      selectedStaff.branch,
      {
        user_role: user.role,
        target_type: "staff",
        target_id: staffId,
        staff_name: selectedStaff.name,
        staff_role: selectedStaff.role,
        branch_id: selectedStaff.branch_id ?? null,
        operation,
        points: deltaBalance,
        rule_code: selectedRule?.code ?? null,
        reason: selectedRule?.title ?? note,
        applied_by_id: selectedApplier?.id || user.id,
        applied_by_name: selectedApplier?.name || user.name,
        applied_by_role: selectedApplier?.role || user.role,
        approved_by_id: user.id,
        approved_by_name: user.name,
        cycle_start: cycleDate(cycle.start),
        cycle_end: cycleDate(cycle.end),
      }
    );

    toast.success("تم حفظ العملية وتحديث النقاط بنجاح");
    onDone();
    onClose();
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-panel max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="p-5 border-b border-[#2d4063]">
          <div className="text-white font-bold text-lg">إضافة نقاط أو خصم أو تعديل إداري</div>
          <div className="text-slate-400 text-xs mt-1">اختر الموظف المتأثر، ثم اختر من طبق العملية وسببها.</div>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {(["bonus", "deduction", "admin_adjustment"] as const).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setOperation(op)}
                className={`flex-1 min-w-[100px] py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  operation === op ? "bg-teal-500/15 border-teal-500/30 text-teal-400" : "border-[#2d4063] text-slate-400"
                }`}
              >
                {OPERATION_LABELS[op]}
              </button>
            ))}
          </div>

          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="input-dark" required>
            <option value="">اختر الدكتور أو المساعد المتأثر</option>
            {selectableStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.branch} ({s.role})
              </option>
            ))}
          </select>
          {selectableStaff.length === 0 && (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
              لا توجد أسماء موظفين متاحة. حدّث بيانات الفريق أو شغّل SQL الحسابات والصلاحيات.
            </div>
          )}

          <select value={appliedById} onChange={(e) => setAppliedById(e.target.value)} className="input-dark">
            <option value="">من طبّق المكافأة أو الخصم؟ ({user?.name || "المستخدم الحالي"})</option>
            {applierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.branch} ({s.role})
              </option>
            ))}
          </select>

          {operation !== "admin_adjustment" ? (
            <>
              <div className="grid gap-2 md:grid-cols-[1fr_180px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={ruleSearch}
                    onChange={(e) => setRuleSearch(e.target.value)}
                    className="input-dark pr-10"
                    placeholder="ابحث في بنود الخصم والمكافأة: خدمة العملاء، تكويد العميل، واتساب..."
                  />
                </div>
                <select value={ruleCategory} onChange={(e) => setRuleCategory(e.target.value)} className="input-dark">
                  {ruleCategories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </div>
              <select value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} className="input-dark" required>
                <option value="">سبب القاعدة ({filteredRulesForOp.length} بند ظاهر)</option>
                {filteredRulesForOp.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.title} · {r.category} ({r.type === "bonus" ? "+" : "-"}{r.default_points})
                  </option>
                ))}
              </select>
              {filteredRulesForOp.length === 0 && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs font-bold text-amber-100">
                  لا توجد بنود مطابقة. غيّر التصنيف أو امسح البحث.
                </div>
              )}
              <div className="text-sm text-slate-300 space-y-1">
                <div>
                  النقاط المقترحة:{" "}
                  <span className="text-white font-bold num">
                    {operation === "deduction" ? repeatPreview?.final_points ?? selectedRule?.default_points : selectedRule?.default_points ?? "-"}
                  </span>
                </div>
                {selectedRule && <div className="text-xs text-slate-500">حق الاعتماد من: {approverHintFromRule(selectedRule) || "حسب الدور"}</div>}
              </div>
              {repeatPreview?.showWarn && (
                <div className="flex gap-2 text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 text-xs">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>
                    هذا الخطأ تكرر داخل نفس الدورة، لذلك تم مضاعفة الخصم: أساس {repeatPreview.base_points} × {repeatPreview.multiplier}.
                  </span>
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="text-slate-400 text-xs block mb-1">التعديل على الرصيد (+ يزيد، - يخصم)</label>
              <input type="number" value={adminDelta} onChange={(e) => setAdminDelta(e.target.value)} className="input-dark" />
            </div>
          )}

          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظات / دليل عند الحاجة" rows={3} className="input-dark resize-none" />

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving || selectableStaff.length === 0} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />} حفظ
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
