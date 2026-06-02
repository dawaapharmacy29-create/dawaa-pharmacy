import { useEffect, useState, useMemo } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Search, Plus, Phone, Edit2, UserCheck, Loader2, Eye, ClipboardList } from "lucide-react";
import { useSupabaseQuery, logActivity } from "@/hooks/useSupabaseQuery";
import { isCurrentlyOnShift, matchesOrderedSegments, percent } from "@/lib/utils";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { getTransactionShortReason, isApprovedPointRecord, isRecordInCycle, pointRecordDelta, recordBelongsToStaff, type PointLedgerRecord } from "@/lib/pointsLedger";
import { calculateStaffCycleIncentiveFromRows } from "@/lib/staffIncentiveService";
import { normalizeStaffName } from "@/lib/staffIdentityService";
import { BRANCHES, DAYS_AR, ROLES, INITIAL_POINTS } from "@/lib/constants";
import { useAuth, getSafeCurrentUserId } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { User } from "@/types";
import { Link } from "react-router-dom";
import { useStaff } from "@/hooks/useStaff";
import { useShiftSchedules } from "@/hooks/useShiftSchedules";
import { useEmployeeTransactions } from "@/hooks/useEmployeeTransactions";
import { friendlySupabaseError, logSupabaseError } from "@/lib/supabaseError";
import { TABLES } from "@/lib/supabaseTables";
import { createStaff, updateStaff, createStaffAccount } from "@/services/staffService";
import { replaceStaffShiftSchedules } from "@/services/shiftScheduleService";

interface Employee {
  id: string;
  name: string;
  username?: string;
  phone: string | null;
  role: string;
  branch: string;
  branch_id?: string;
  shift_start?: string | null;
  shift_end?: string | null;
  holiday_day?: string | null;
  points?: number | null;
  max_points: number;
  status: string;
  join_date?: string | null;
  notes?: string | null;
}

interface ShiftSchedule {
  id: string;
  staff_id?: string;
  staff_name: string;
  branch: string;
  branch_id?: string;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean | null;
  notes?: string | null;
}

interface EmployeeTransaction {
  id: string;
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type?: string | null;
  points?: number | null;
  amount?: number | null;
  points_delta?: number | null;
  reason: string;
  description?: string | null;
  source?: string | null;
  source_id?: string | null;
  created_at: string;
  month_cycle?: string | null;
  branch?: string | null;
  status?: string | null;
}

function transactionPoints(row: Pick<EmployeeTransaction, "points" | "points_delta">) {
  return Math.abs(pointRecordDelta(row));
}

function uniqueEmployeesByIdentity(rows: Employee[]) {
  const map = new Map<string, Employee>();
  for (const row of rows) {
    const key = row.id || `${normalizeStaffName(row.name)}__${row.branch || ""}__${row.role || ""}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

export default function Team() {
  const { user, canManage } = useAuth();
  const canCreateTeam = canManage || user?.permissions?.create_team_member === true;
  const canEditTeam = canManage || user?.permissions?.edit_team_member === true;
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [roleFilter, setRoleFilter] = useState("الكل");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);

  const { data: employees, loading, refetch } = useStaff<Employee>();
  const { data: schedules, loading: schedulesLoading } = useShiftSchedules<ShiftSchedule>();
  const { data: employeeTransactions } = useEmployeeTransactions<EmployeeTransaction>();
  const pointRecords = employeeTransactions as PointLedgerRecord[];
  const cycle = getCurrentCycle();
  const todayName = DAYS_AR[new Date().getDay()];

  const todayShift = (employee: Employee) =>
    schedules.find((item) => (item.staff_id === employee.id || item.staff_name === employee.name) && item.branch === employee.branch && item.day_name === todayName);

  const holidayDay = (employee: Employee) =>
    schedules.find((item) => (item.staff_id === employee.id || item.staff_name === employee.name) && item.branch === employee.branch && item.is_off)?.day_name || employee.holiday_day || "غير محدد";

  const getEmployeeTransactions = (employee: Employee) => {
    return (employeeTransactions || []).filter((transaction) =>
      recordBelongsToStaff(transaction as PointLedgerRecord, employee),
    );
  };

  const filtered = useMemo(() => employees.filter(e => {
    const raw = search.trim();
    const haystack = `${e.name} ${e.phone || ""} ${e.role || ""}`;
    const matchSearch = !raw || matchesOrderedSegments(haystack, raw);
    const matchBranch = branchFilter === "الكل" || e.branch === branchFilter;
    const matchRole = roleFilter === "الكل" || e.role === roleFilter;
    return matchSearch && matchBranch && matchRole;
  }), [employees, search, branchFilter, roleFilter]);
  const displayEmployees = useMemo(() => uniqueEmployeesByIdentity(filtered), [filtered]);

  const onShiftNow = employees.filter(e => {
    const shift = todayShift(e);
    return shift?.shift_start && shift?.shift_end && !shift.is_off && isCurrentlyOnShift(shift.shift_start, shift.shift_end) && e.status === "نشط";
  });
  const doctors = onShiftNow.filter(e => e.role === "صيدلاني");
  const assistants = onShiftNow.filter(e => e.role === "مساعد");
  const deliveryNow = onShiftNow.filter(e => e.role === "توصيل");

  const roles = [...new Set(employees.map(e => e.role))];
  const branchRankings = useMemo(() => {
    const uniqueEmployees = uniqueEmployeesByIdentity(employees);
    return BRANCHES.map((branch) => {
      const branchEmployees = uniqueEmployees
        .filter((employee) => employee.branch === branch)
        .map((employee) => ({ ...employee, cyclePoints: calculateStaffCycleIncentiveFromRows({ staff: employee, records: pointRecords || [], cycle }).finalPoints }))
        .sort((a, b) => b.cyclePoints - a.cyclePoints);
      return {
        branch,
        doctors: branchEmployees.filter((employee) => /صيد|دكتور|pharmacist|doctor/i.test(employee.role || "")),
        delivery: branchEmployees.filter((employee) => /توصيل|دليفري|delivery/i.test(employee.role || "")),
      };
    }).filter((group) => group.doctors.length || group.delivery.length);
  }, [cycle, employees, pointRecords]);

  if (loading || schedulesLoading) return <LoadingState />;

  return (
    <div className="space-y-5">
      {/* Live Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: "صيادلة على الشيفت", list: doctors, color: "teal" },
          { title: "مساعدون على الشيفت", list: assistants, color: "blue" },
          { title: "توصيل على الشيفت", list: deliveryNow, color: "amber" },
        ].map(({ title, list, color }) => (
          <div key={title} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <div className="section-title text-sm">{title}</div>
              <span className={`text-lg font-bold num ${color === "teal" ? "text-teal-400" : color === "blue" ? "text-blue-400" : "text-amber-400"}`}>{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.length === 0 ? (
                <div className="text-slate-400 text-xs py-2">لا يوجد حالياً</div>
              ) : list.map(e => (
                <div key={e.id} className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${color === "teal" ? "bg-teal-400" : color === "blue" ? "bg-blue-400" : "bg-amber-400"} animate-pulse-soft`} />
                  <span className="text-white text-xs font-medium">{e.name}</span>
                  <span className="text-slate-400 text-xs mr-auto">{todayShift(e)?.shift_start || "-"}–{todayShift(e)?.shift_end || "-"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="stat-card space-y-4">
        <div className="section-title text-sm">ترتيب الفريق حسب الفروع</div>
        <div className="grid lg:grid-cols-2 gap-4">
          {branchRankings.map((group) => (
            <div key={group.branch} className="rounded-xl border border-[#2d4063] bg-white/5 overflow-hidden">
              <div className="px-4 py-3 bg-[#16253f] text-white font-bold">{group.branch}</div>
              <RankingList title="الدكاترة والصيادلة" rows={group.doctors} />
              <RankingList title="الدليفري" rows={group.delivery} />
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في الفريق..." className="input-dark pr-10" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input-dark md:w-40">
          <option value="الكل">كل الفروع</option>
          {BRANCHES.map(b => <option key={b}>{b}</option>)}
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-dark md:w-40">
          <option value="الكل">كل الأدوار</option>
          {roles.map(r => <option key={r}>{r}</option>)}
        </select>
        {canCreateTeam && (
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} />
            موظف جديد
          </button>
        )}
      </div>

      {/* Employee Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayEmployees.map((emp) => {
          const shift = todayShift(emp);
          const onShift = Boolean(shift?.shift_start && shift?.shift_end && !shift.is_off && isCurrentlyOnShift(shift.shift_start, shift.shift_end) && emp.status === "نشط");
          const incentive = calculateStaffCycleIncentiveFromRows({ staff: emp, records: pointRecords || [], cycle });
          const points = incentive.finalPoints;
          const maxPoints = incentive.startingPoints;
          const pointsPct = percent(points, maxPoints);
          const penalties = incentive.deductionTransactions.length;
          const bonuses = incentive.rewardTransactions.length;
          const penaltyPoints = incentive.approvedDeductionPoints;
          const bonusPoints = incentive.approvedRewardPoints;
          return (
            <div key={emp.id} className="stat-card card-glow">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-lg font-bold">
                    {emp.name[0]}
                  </div>
                  {onShift && (
                    <span className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full bg-teal-400 border-2 border-[#243558]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-bold text-sm">{emp.name}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className="badge-info">{emp.role}</span>
                    <span className="text-slate-400 text-xs">{emp.branch}</span>
                  </div>
                </div>
                {canEditTeam && (
                  <button onClick={() => setEditing(emp)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
                    <Edit2 size={14} />
                  </button>
                )}
                <Link to={`/staff/${emp.id}`} className="p-1.5 rounded-lg text-teal-400 hover:text-white hover:bg-teal-500/10" title="ملف الأداء الشامل">
                  <ClipboardList size={14} />
                </Link>
                <button type="button" onClick={() => setViewing(emp)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5" title="تفاصيل الموظف">
                  <Eye size={14} />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/5 rounded-lg p-2.5">
                  <div className="text-slate-400">الشيفت</div>
                  <div className="text-white font-medium mt-0.5">{shift?.is_off ? "إجازة اليوم" : `${shift?.shift_start || "-"} — ${shift?.shift_end || "-"}`}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2.5">
                  <div className="text-slate-400">إجازة</div>
                  <div className="text-white font-medium mt-0.5">{holidayDay(emp)}</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-400">النقاط</span>
                  <span className={`font-bold num ${pointsPct >= 90 ? "text-teal-400" : pointsPct >= 70 ? "text-amber-400" : "text-red-400"}`}>
                    {points} / {maxPoints}
                  </span>
                </div>
                <div className="progress-bar">
                  <div className={`h-full rounded-full transition-all duration-500 ${pointsPct >= 90 ? "bg-gradient-to-r from-teal-500 to-teal-400" : pointsPct >= 70 ? "bg-gradient-to-r from-amber-500 to-amber-400" : "bg-gradient-to-r from-red-500 to-red-400"}`} style={{ width: `${pointsPct}%` }} />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Phone size={12} className="text-slate-400" />
                  <span className="text-slate-400 text-xs">{emp.phone || "بدون رقم"}</span>
                </div>
                <div className="flex items-center gap-3">
                  {penalties > 0 && (
                    <span className="text-red-400 text-xs font-bold">جزاء: {penalties} / {penaltyPoints} نقطة</span>
                  )}
                  {bonuses > 0 && (
                    <span className="text-green-400 text-xs font-bold">مكافأة: {bonuses} / {bonusPoints} نقطة</span>
                  )}
                  <span className={`text-xs font-medium ${onShift ? "text-teal-400" : "text-slate-500"}`}>
                    {onShift ? "● على الشيفت" : "○ خارج الشيفت"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showAddModal && <EmployeeModal onClose={() => setShowAddModal(false)} onSaved={refetch} user={user} />}
      {editing && <EmployeeModal employee={editing} onClose={() => setEditing(null)} onSaved={refetch} user={user} />}
      {viewing && <EmployeeDetailsModal employee={viewing} schedules={schedules.filter((item) => (item.staff_id === viewing.id || item.staff_name === viewing.name) && item.branch === viewing.branch)} transactions={getEmployeeTransactions(viewing)} onClose={() => setViewing(null)} />}
    </div>
  );
}

interface DaySchedule {
  day: string;
  shift_start: string;
  shift_end: string;
  is_day_off: boolean;
  use_custom_schedule: boolean;
}

function EmployeeModal({ employee, onClose, onSaved, user }: { employee?: Employee; onClose: () => void; onSaved: () => void; user: User | null }) {
  const [saving, setSaving] = useState(false);
  useEscapeKey(onClose, true);
  const [form, setForm] = useState({
    name: "", username: "", password: "", account_status: "active", phone: "", role: "صيدلاني", branch: "فرع شكري",
    default_shift_start: "09:00", default_shift_end: "19:00", notes: "",
  });
  const [daySchedules, setDaySchedules] = useState<DaySchedule[]>(
    DAYS_AR.map(day => ({
      day,
      shift_start: "09:00",
      shift_end: "19:00",
      is_day_off: day === "الجمعة",
      use_custom_schedule: false,
    }))
  );

  useEffect(() => {
    if (employee) {
      setForm({
        name: employee.name || "",
        username: employee.username || "",
        password: "",
        account_status: employee.status === "inactive" ? "inactive" : "active",
        phone: employee.phone || "",
        role: employee.role || "صيدلاني",
        branch: employee.branch || "فرع شكري",
        default_shift_start: employee.shift_start || "09:00",
        default_shift_end: employee.shift_end || "19:00",
        notes: employee.notes || "",
      });
      // Load existing schedules if editing
      // This would need to fetch from shift_schedules table
    }
  }, [employee]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        role: form.role,
        branch: form.branch,
        shift_start: form.default_shift_start,
        shift_end: form.default_shift_end,
        notes: form.notes,
        status: "نشط",
        max_points: INITIAL_POINTS,
        type: form.role === "صيدلاني" ? "Pharmacist" : form.role === "توصيل" ? "Delivery" : form.role,
      };
      
      let staffId = "";
      let error: string | null = null;
      
      if (employee) {
        const { error: updateError } = await updateStaff(employee.id, payload);
        error = updateError ? friendlySupabaseError(updateError) : null;
        if (!error) staffId = employee.id;
      } else {
        const result = await createStaff(payload);
        error = result.error ? friendlySupabaseError(result.error) : null;
        if (!error && result.data) staffId = (result.data as Employee).id;
      }
      
      if (error) {
        toast.error("خطأ في الحفظ: " + error);
        setSaving(false);
        return;
      }
      
      // Create shift schedules for all 7 days
      if (!employee) {
        // TODO: replace temporary password storage with server-side hashing or Supabase Auth.
        const accountResult = await createStaffAccount({
          staff_id: staffId!,
          username: form.username,
          temporary_password: form.password || null,
          password_hash: form.password || null,
          password_status: form.password ? "temporary" : null,
          name: form.name,
          staff_name: form.name,
          role: form.role,
          staff_role: form.role,
          branch: form.branch,
          active: form.account_status === "active",
          can_login: form.account_status === "active",
          visible_in_admin: true,
          permissions: {},
        });
        if (accountResult.error) {
          toast.warning("تم حفظ الموظف لكن حساب الدخول يحتاج مراجعة.");
        }
      }

      const scheduleRecords = daySchedules.map((schedule, index) => ({
        staff_id: staffId!,
        staff_name: form.name,
        branch: form.branch,
        day_name: schedule.day,
        day_of_week: index,
        shift_start: schedule.is_day_off ? null : (schedule.use_custom_schedule ? schedule.shift_start : form.default_shift_start),
        shift_end: schedule.is_day_off ? null : (schedule.use_custom_schedule ? schedule.shift_end : form.default_shift_end),
        is_off: schedule.is_day_off,
        is_day_off: schedule.is_day_off,
        is_different: !schedule.is_day_off && schedule.use_custom_schedule,
        has_custom_time: !schedule.is_day_off && schedule.use_custom_schedule,
        notes: schedule.is_day_off ? "day_off" : schedule.use_custom_schedule ? "custom_time" : null,
      }));
      
      const { error: scheduleError } = await replaceStaffShiftSchedules(staffId!, scheduleRecords);
      
      if (scheduleError) {
        toast.error("تم حفظ الموظف لكن حدث خطأ في حفظ المواعيد: " + scheduleError.message);
      }

      toast.success(employee ? "تم تعديل بيانات الموظف" : "تم إضافة الموظف بنجاح");
      // لا تجعل تسجيل النشاط سببًا في فشل حفظ الموظف؛ أحيانًا يكون الحساب الحالي محليًا أو غير مرتبط بـ UUID.
      try {
        const actorId = getSafeCurrentUserId();
        if (user && actorId) {
          await logActivity(
            actorId,
            user.name || "النظام",
            employee ? "تعديل موظف" : "إضافة موظف",
            "الفريق",
            `${employee ? "تعديل" : "إضافة"} ${form.name}`,
            form.branch,
          );
        }
      } catch (logError) {
        // Activity log skipped silently
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error("حدث خطأ غير متوقع أثناء الحفظ");
    }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-[#2d4063] sticky top-0 bg-[#1a2d4d] z-10">
          <div className="text-white font-bold text-lg">{employee ? "تعديل بيانات الموظف" : "إضافة موظف جديد"}</div>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="الاسم الكامل *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input-dark col-span-2" required />
            <input placeholder="اسم المستخدم *" value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} className="input-dark" required />
            <input placeholder="كلمة المرور *" type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} className="input-dark" required={!employee} />
            <input placeholder="رقم الهاتف" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className="input-dark" />
            <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} className="input-dark">
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
            <select value={form.branch} onChange={e => setForm(f => ({...f, branch: e.target.value}))} className="input-dark">
              {BRANCHES.map(b => <option key={b}>{b}</option>)}
            </select>
            <select value={form.account_status} onChange={e => setForm(f => ({...f, account_status: e.target.value}))} className="input-dark">
              <option value="active">نشط</option>
              <option value="inactive">موقوف</option>
            </select>
          </div>
          
          <div className="bg-white/5 rounded-xl p-4 border border-[#2d4063]">
            <div className="text-white font-bold text-sm mb-3">الميعاد الأساسي</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 text-xs mb-1 block">من</label>
                <input type="time" value={form.default_shift_start} onChange={e => setForm(f => ({...f, default_shift_start: e.target.value}))} className="input-dark" />
              </div>
              <div>
                <label className="text-slate-400 text-xs mb-1 block">إلى</label>
                <input type="time" value={form.default_shift_end} onChange={e => setForm(f => ({...f, default_shift_end: e.target.value}))} className="input-dark" />
              </div>
            </div>
          </div>
          
          <div className="bg-white/5 rounded-xl p-4 border border-[#2d4063]">
            <div className="text-white font-bold text-sm mb-3">المواعيد الأسبوعية</div>
            <div className="space-y-2">
              {daySchedules.map((schedule, index) => (
                <div key={schedule.day} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                  <div className="w-20 text-slate-300 text-sm font-medium">{schedule.day}</div>
                  <label className="flex items-center gap-2 text-slate-400 text-xs">
                    <input
                      type="checkbox"
                      checked={schedule.is_day_off}
                      onChange={e => {
                        const newSchedules = [...daySchedules];
                        newSchedules[index].is_day_off = e.target.checked;
                        setDaySchedules(newSchedules);
                      }}
                      className="rounded"
                    />
                    إجازة
                  </label>
                  {!schedule.is_day_off && (
                    <>
                      <label className="flex items-center gap-2 text-slate-400 text-xs">
                        <input
                          type="checkbox"
                          checked={schedule.use_custom_schedule}
                          onChange={e => {
                            const newSchedules = [...daySchedules];
                            newSchedules[index].use_custom_schedule = e.target.checked;
                            setDaySchedules(newSchedules);
                          }}
                          className="rounded"
                        />
                        ميعاد مختلف
                      </label>
                      {schedule.use_custom_schedule && (
                        <>
                          <input
                            type="time"
                            value={schedule.shift_start}
                            onChange={e => {
                              const newSchedules = [...daySchedules];
                              newSchedules[index].shift_start = e.target.value;
                              setDaySchedules(newSchedules);
                            }}
                            className="input-dark text-xs py-1"
                          />
                          <span className="text-slate-400">-</span>
                          <input
                            type="time"
                            value={schedule.shift_end}
                            onChange={e => {
                              const newSchedules = [...daySchedules];
                              newSchedules[index].shift_end = e.target.value;
                              setDaySchedules(newSchedules);
                            }}
                            className="input-dark text-xs py-1"
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <textarea placeholder="ملاحظات" value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} className="input-dark resize-none" />
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />} حفظ
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RankingList({ title, rows }: { title: string; rows: Array<Employee & { cyclePoints: number }> }) {
  return (
    <div className="p-3 border-t border-[#2d4063]">
      <div className="text-slate-300 text-xs font-bold mb-2">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 8).map((employee, index) => (
          <Link key={employee.id} to={`/staff/${employee.id}`} className="flex items-center gap-3 rounded-lg bg-[#1B2B4B] px-3 py-2 hover:bg-white/10 transition-colors">
            <span className="w-6 h-6 rounded-full bg-teal-500/15 text-teal-300 text-xs flex items-center justify-center num">{index + 1}</span>
            <span className="text-white text-sm font-bold flex-1">{employee.name}</span>
            <span className="text-slate-400 text-xs">{employee.role}</span>
            <span className="text-teal-300 font-bold num">{employee.cyclePoints}</span>
          </Link>
        ))}
        {rows.length === 0 && <div className="text-slate-500 text-xs py-2">لا توجد بيانات في هذا القسم.</div>}
      </div>
    </div>
  );
}

function EmployeeDetailsModal({ employee, schedules, transactions, onClose }: { employee: Employee; schedules: ShiftSchedule[]; transactions: EmployeeTransaction[]; onClose: () => void }) {
  useEscapeKey(onClose, true);
  const cycle = getCurrentCycle();
  const pointRecords = transactions as PointLedgerRecord[];
  const incentive = calculateStaffCycleIncentiveFromRows({ staff: employee, records: pointRecords, cycle });
  const points = incentive.finalPoints;
  const maxPoints = incentive.startingPoints;
  const activeTransactions = transactions.filter((t) => isApprovedPointRecord(t as PointLedgerRecord) && isRecordInCycle(t as PointLedgerRecord, cycle));
  const penaltyRows = activeTransactions.filter((t) => pointRecordDelta(t as PointLedgerRecord) < 0);
  const bonusRows = activeTransactions.filter((t) => pointRecordDelta(t as PointLedgerRecord) > 0);
  const penalties = penaltyRows.length;
  const bonuses = bonusRows.length;
  const permissions = schedules.filter((item) => item.is_off).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-3xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-[#2d4063]">
          <div className="text-white font-bold text-lg">{employee.name}</div>
          <div className="text-slate-400 text-sm">{employee.role} - {employee.branch}</div>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          <InfoBox label="التقييم الحالي" value={`${points} / ${maxPoints}`} />
          <InfoBox label="جزاءات" value={`${penalties}`} />
          <InfoBox label="مكافآت" value={`${bonuses}`} />
          <InfoBox label="إجازات/أذونات" value={`${permissions}`} />
          <InfoBox label="أداء 3 شهور" value="جاهز للربط مع النقاط" />
          <InfoBox label="أداء سنوي" value="جاهز للربط مع التقييمات" />
        </div>
        <div className="px-5 pb-5">
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-white font-bold text-sm mb-3">جدول الموظف</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {schedules.map((item) => (
                <div key={item.id} className={`rounded-xl border p-3 text-center ${item.is_off ? "bg-red-500/15 border-red-400/40 text-red-200" : "bg-white/5 border-[#2d4063] text-slate-200"}`}>
                  <div className="text-xs text-slate-400">{item.day_name}</div>
                  <div className="text-sm font-bold mt-1">{item.is_off ? "إجازة" : `${item.shift_start || "-"} - ${item.shift_end || "-"}`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-white font-bold text-sm mb-3">الجزاءات والمكافآت</div>
            {activeTransactions.length === 0 ? (
              <div className="text-slate-400 text-sm py-4 text-center">لا توجد جزاءات أو مكافآت مسجلة لهذا الموظف.</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {activeTransactions.map((t) => {
                  const isPenalty = pointRecordDelta(t as PointLedgerRecord) < 0;
                  return (
                  <div key={t.id} className={`rounded-lg border p-3 ${isPenalty ? 'bg-red-500/10 border-red-400/30' : 'bg-green-500/10 border-green-400/30'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold ${isPenalty ? 'text-red-300' : 'text-green-300'}`}>
                        {isPenalty ? 'جزاء' : 'مكافأة'}
                      </span>
                      <span className="text-slate-400 text-xs">{new Date(t.created_at).toLocaleDateString('ar-EG')}</span>
                    </div>
                    <div className="text-white text-sm font-medium">{getTransactionShortReason(t)}</div>
                    {t.description && <div className="text-slate-400 text-xs mt-1">{t.description}</div>}
                    <div className="flex gap-4 mt-2 text-xs">
                      {(t.points !== null && t.points !== undefined) || (t.points_delta !== null && t.points_delta !== undefined) ? (
                        <span className={`font-bold ${isPenalty ? 'text-red-300' : 'text-green-300'}`}>
                          النقاط: {transactionPoints(t)}
                        </span>
                      ) : null}
                      {t.amount !== null && t.amount !== undefined && (
                        <span className={`font-bold ${isPenalty ? 'text-red-300' : 'text-green-300'}`}>
                          المبلغ: {t.amount} ج.م
                        </span>
                      )}
                      {t.source && (
                        <span className="text-slate-400">
                          المصدر: {t.source}
                        </span>
                      )}
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 pb-5"><button onClick={onClose} className="btn-secondary w-full">إغلاق</button></div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 border border-[#2d4063] rounded-xl p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold mt-1">{value}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <div key={i} className="stat-card h-32 animate-pulse bg-white/5" />)}</div>
      <div className="grid grid-cols-3 gap-4">{[1,2,3,4,5,6].map(i => <div key={i} className="stat-card h-48 animate-pulse bg-white/5" />)}</div>
    </div>
  );
}
