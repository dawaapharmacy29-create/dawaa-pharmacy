import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { TABLES } from "@/lib/supabaseTables";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { applyStaffDelta, persistPointsTransaction } from "@/lib/pointsPersistence";
import { isActiveStaffFilter } from "@/lib/staffActiveFilter";
import { mergeStaffChoices, type StaffChoice } from "@/lib/staffFallback";
import type { EvaluationRuleDef } from "@/lib/evaluationRulesCatalog";
import { getSafeCurrentUserId } from "@/hooks/useAuth";
import { canonicalMaxPoints, canonicalSnapshotPoints } from "@/lib/pointsLedger";

const TYPES = ["إذن تأخير", "إذن انصراف مبكر", "إجازة مرضية", "إجازة عارضة", "غياب", "تبديل شيفت"];
const STATUSES = ["pending", "approved", "rejected"];

interface Staff extends StaffChoice {
  phone?: string | null;
}

interface ShiftException {
  id: string;
  staff_id?: string | null;
  staff_name: string;
  type: string;
  status: string;
  branch: string | null;
  day_name: string | null;
  date: string | null;
  date_end?: string | null;
  reason: string | null;
  deduct_points?: boolean | null;
  deduction_points?: number | null;
}

function dayName(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("ar-EG", { weekday: "long" });
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || "";
}

async function insertShiftException(payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await supabase.from(TABLES.shiftExceptions).insert(next);
    if (!error) return null;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return error.message;
    removed.add(column);
    delete next[column];
  }

  return "تعذر حفظ الإذن بسبب اختلاف أعمدة جدول shift_exceptions.";
}

function timeOffRule(type: string, points: number): EvaluationRuleDef {
  return {
    code: `TIME_OFF_${type.replace(/\s+/g, "_")}`,
    category: "الإذونات والإجازات",
    title: `خصم ${type}`,
    description: "خصم يدوي يحدده المدير العام عند تسجيل إذن أو إجازة.",
    default_points: points,
    type: "deduction",
    severity: points >= 30 ? "high" : points >= 10 ? "medium" : "low",
    role_scope: "all",
    requires_approval: false,
    evidence_required: false,
    allowed_approver_roles: ["general_manager"],
    repeat_policy: "none",
    active: true,
  };
}

export default function TimeOff() {
  const { data: staff = [] } = useSupabaseQuery<Staff>({ table: TABLES.staff, filters: isActiveStaffFilter(), realtimeEnabled: false });
  const { data: exceptions = [], loading, refetch } = useSupabaseQuery<ShiftException>({
    table: TABLES.shiftExceptions,
    orderBy: { column: "created_at", ascending: false },
    realtimeEnabled: true,
  });
  const staffChoices = useMemo(() => mergeStaffChoices(staff), [staff]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    staff_id: "",
    type: "إذن تأخير",
    status: "approved",
    date: new Date().toISOString().slice(0, 10),
    date_end: new Date().toISOString().slice(0, 10),
    reason: "",
    deduct_points: false,
    deduction_points: "",
  });

  const isLeaveType = form.type.includes("إجازة");
  const selectedStaff = staffChoices.find((item) => item.id === form.staff_id);
  const deductionPoints = Math.max(0, Number(form.deduction_points) || 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedStaff) {
      toast.error("اختار الموظف الأول.");
      return;
    }
    if (form.deduct_points && deductionPoints <= 0) {
      toast.error("اكتب قيمة الخصم بالنقاط أو اقفل اختيار الخصم.");
      return;
    }

    setSaving(true);
    const rangeNote =
      isLeaveType && form.date_end && form.date_end !== form.date
        ? `[من ${form.date} إلى ${form.date_end}] `
        : "";
    const deductionNote = form.deduct_points ? `[خصم نقاط: ${deductionPoints}] ` : "[بدون خصم نقاط] ";
    const finalReason = `${rangeNote}${deductionNote}${form.reason}`.trim();

    const payload = {
      staff_name: selectedStaff.name,
      staff_id: selectedStaff.id.startsWith("fallback-") ? null : selectedStaff.id,
      employee_name: selectedStaff.name,
      type: form.type,
      status: form.status,
      branch: selectedStaff.branch || null,
      date: form.date,
      date_end: form.date_end || form.date,
      day_name: dayName(form.date),
      reason: finalReason,
      deduct_points: form.deduct_points,
      deduction_points: deductionPoints,
      deduction_status: form.deduct_points ? form.status : "none",
      source: "manual",
      updated_at: new Date().toISOString(),
    };

    const error = editingId
      ? (await supabase.from(TABLES.shiftExceptions).update(payload).eq("id", editingId)).error?.message || null
      : await insertShiftException(payload);

    if (error) {
      setSaving(false);
      toast.error("تعذر حفظ الإذن: " + error);
      return;
    }

    if (form.deduct_points && deductionPoints > 0) {
      const status = form.status === "approved" ? "approved" : "pending";
      const result = await persistPointsTransaction({
        employeeId: selectedStaff.id,
        employeeName: selectedStaff.name,
        branch: selectedStaff.branch,
        operation: "deduction",
        rule: timeOffRule(form.type, deductionPoints),
        pointsToStore: deductionPoints,
        basePoints: deductionPoints,
        finalPoints: deductionPoints,
        userNote: finalReason,
        createdByName: "المدير العام",
        createdById: getSafeCurrentUserId() ?? null,
        createdByRole: "مدير عام",
        status,
        cycle: getCurrentCycle(),
        sourceModule: "time_off",
        reasonLabel: `${form.type} - خصم محدد من المدير`,
      });

      if (result.error) {
        toast.warning("تم حفظ الإذن، لكن لم يتم تسجيل الخصم في النقاط: " + result.error);
      } else if (status === "approved" && !selectedStaff.id.startsWith("fallback-")) {
        await applyStaffDelta(
          selectedStaff.id,
          canonicalSnapshotPoints(selectedStaff),
          canonicalMaxPoints(selectedStaff),
          -deductionPoints,
          selectedStaff.name,
          selectedStaff.branch,
        );
      }
    }

    setSaving(false);
    toast.success(form.deduct_points ? "تم حفظ الإذن وتسجيل خصم النقاط." : "تم حفظ الإذن/الإجازة بدون خصم نقاط.");
    setEditingId(null);
    setForm((current) => ({ ...current, reason: "", deduction_points: current.deduct_points ? current.deduction_points : "" }));
    refetch();
  };

  const editItem = (item: ShiftException, forceDeduction = false) => {
    const staffItem = staffChoices.find((choice) => choice.id === item.staff_id || choice.name === item.staff_name);
    setEditingId(item.id);
    setForm({
      staff_id: staffItem?.id || "",
      type: item.type || TYPES[0],
      status: item.status || "pending",
      date: item.date || new Date().toISOString().slice(0, 10),
      date_end: item.date_end || item.date || new Date().toISOString().slice(0, 10),
      reason: item.reason || "",
      deduct_points: forceDeduction || Boolean(item.deduct_points),
      deduction_points: String(item.deduction_points || (forceDeduction ? 10 : "")),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteItem = async (item: ShiftException) => {
    if (!window.confirm(`هل تريد حذف سجل ${item.type} لـ ${item.staff_name}؟`)) return;
    const { error } = await supabase.from(TABLES.shiftExceptions).delete().eq("id", item.id);
    if (error) return toast.error(`تعذر حذف السجل: ${error.message}`);
    toast.success("تم حذف سجل الإذن/الإجازة");
    refetch();
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="section-title">الإذونات والإجازات</div>
        <div className="text-slate-400 text-sm mt-1">
          سجل الإذن أو الإجازة، وحدد هل عليه خصم نقاط أم لا. قيمة الخصم يحددها المدير العام وقت التسجيل.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <select value={form.staff_id} onChange={(event) => setForm((f) => ({ ...f, staff_id: event.target.value }))} className="input-dark" required>
          <option value="">اختار الموظف</option>
          {staffChoices.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.role} - {item.branch}</option>)}
        </select>
        <select value={form.type} onChange={(event) => setForm((f) => ({ ...f, type: event.target.value }))} className="input-dark">
          {TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
        <select value={form.status} onChange={(event) => setForm((f) => ({ ...f, status: event.target.value }))} className="input-dark">
          {STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
        <input
          type="date"
          value={form.date}
          onChange={(event) => setForm((f) => ({ ...f, date: event.target.value, date_end: f.date_end < event.target.value ? event.target.value : f.date_end }))}
          className="input-dark"
        />
        {isLeaveType && (
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 text-[10px]">حتى (إجازة متعددة الأيام)</span>
            <input
              type="date"
              value={form.date_end}
              min={form.date}
              onChange={(event) => setForm((f) => ({ ...f, date_end: event.target.value }))}
              className="input-dark"
            />
          </div>
        )}
        <label className="input-dark flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.deduct_points}
            onChange={(event) => setForm((f) => ({ ...f, deduct_points: event.target.checked }))}
          />
          عليه خصم نقاط؟
        </label>
        {form.deduct_points && (
          <input
            type="number"
            min={1}
            value={form.deduction_points}
            onChange={(event) => setForm((f) => ({ ...f, deduction_points: event.target.value }))}
            placeholder="قيمة الخصم بالنقاط"
            className="input-dark md:col-span-2"
            required
          />
        )}
        <textarea value={form.reason} onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))} placeholder="سبب الإذن أو ملاحظات" className="input-dark md:col-span-4 resize-none" rows={2} />
        <button type="submit" disabled={saving || !form.staff_id} className="btn-primary flex items-center justify-center gap-2 md:col-span-6">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {editingId ? "تحديث السجل" : "حفظ"}
        </button>
        {editingId && (
          <button type="button" onClick={() => setEditingId(null)} className="btn-secondary md:col-span-6">
            إلغاء التعديل
          </button>
        )}
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TYPES.map((type) => (
          <div key={type} className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4">
            <div className="text-white font-bold">{type}</div>
            <div className="text-slate-400 text-sm mt-2">الحالات: {STATUSES.join(" / ")}</div>
            <div className="text-slate-400 text-xs mt-3 leading-relaxed">
              يمكن تسجيله بدون خصم، أو بخصم نقاط يحدده المدير العام. لو الحالة approved يتم احتساب الخصم مباشرة، ولو pending يبقى معلق للمراجعة.
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2d4063] text-white font-bold">آخر الإذونات والإجازات</div>
        {loading ? (
          <div className="p-6 text-slate-400">جاري التحميل...</div>
        ) : exceptions.length === 0 ? (
          <div className="p-6 text-slate-400">لا توجد إذونات مسجلة بعد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>الموظف</th><th>النوع</th><th>الحالة</th><th>الفرع</th><th>اليوم/التاريخ</th><th>خصم النقاط</th><th>السبب</th><th>إجراءات</th></tr></thead>
              <tbody>
                {exceptions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.staff_name}</td>
                    <td>{item.type}</td>
                    <td><span className={item.status === "approved" ? "badge-success" : item.status === "rejected" ? "badge-danger" : "badge-info"}>{item.status}</span></td>
                    <td>{item.branch || "-"}</td>
                    <td>{item.date || item.day_name || "-"}</td>
                    <td>{item.deduct_points ? `${item.deduction_points || 0} نقطة` : "بدون خصم"}</td>
                    <td>{item.reason || "-"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => editItem(item)} className="rounded-lg bg-teal-500/15 px-2 py-1 text-xs font-bold text-teal-200">تعديل</button>
                        <button type="button" onClick={() => editItem(item, true)} className="rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-200">جعله بخصم</button>
                        <button type="button" onClick={() => deleteItem(item)} className="rounded-lg bg-red-500/15 px-2 py-1 text-xs font-bold text-red-200">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
