import { useMemo } from "react";
import { TrendingUp, TrendingDown, Award, Star, Calendar, BellRing, CheckSquare, HeadphonesIcon, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { getTransactionShortReason, isApprovedPointRecord, isRecordInCycle, pointRecordDelta, pointRecordStatus, recordBelongsToStaff } from "@/lib/pointsLedger";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { getPerformanceLevel } from "@/lib/points";
import { calculateStaffCycleIncentiveFromRows } from "@/lib/staffIncentiveService";
import { formatDateTime, percent } from "@/lib/utils";
import { TABLES } from "@/lib/supabaseTables";
import { normalizeNotification } from "@/lib/notificationService";
import StaffOperatingPolicy from "@/components/incentives/StaffOperatingPolicy";

// ─── Types ─────────────────────────────────────────────────────────────────

interface StaffInfo {
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
  created_at: string;
  status?: string | null;
  month_cycle?: string | null;
}

function isRewardRecord(row: PointRecord) {
  return pointRecordDelta(row) > 0;
}

function isPenaltyRecord(row: PointRecord) {
  return pointRecordDelta(row) < 0;
}

function MiniMetric({ icon: Icon, label, value, tone }: { icon: typeof BellRing; label: string; value: number; tone: "teal" | "red" | "amber" | "blue" }) {
  const colors = {
    teal: "text-teal-400 bg-teal-500/10",
    red: "text-red-400 bg-red-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    blue: "text-blue-400 bg-blue-500/10",
  };
  return (
    <div className="stat-card text-center">
      <div className={`mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl ${colors[tone]}`}><Icon size={20} /></div>
      <div className="num text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function StaffDashboard() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const effectiveStaffId = user?.staffId || user?.id || "";

  // Fetch current user's staff profile
  const { data: staffData, loading: staffLoading } =
    useSupabaseQuery<StaffInfo>({
      table: "staff",
      orderBy: { column: "name", ascending: true },
      realtimeEnabled: false,
    });

  // Fetch employee_transactions for this employee only
  const { data: records, loading: recLoading } = useSupabaseQuery<PointRecord>({
    table: TABLES.employeeTransactions,
    orderBy: { column: "created_at", ascending: false },
    limit: 1000,
    realtimeEnabled: true,
  });

  const { data: rawNotifications } = useSupabaseQuery<Record<string, unknown>>({
    table: TABLES.notifications,
    orderBy: { column: "created_at", ascending: false },
    limit: 100,
    realtimeEnabled: true,
  });

  const { data: tasks } = useSupabaseQuery<Record<string, unknown>>({
    table: TABLES.tasks,
    orderBy: { column: "created_at", ascending: false },
    limit: 120,
    realtimeEnabled: true,
  });

  const { data: followups } = useSupabaseQuery<Record<string, unknown>>({
    table: TABLES.dailyFollowups,
    orderBy: { column: "created_at", ascending: false },
    limit: 160,
    realtimeEnabled: true,
  });

  const staffInfo = useMemo(() => {
    return (
      staffData.find((item) => item.id === effectiveStaffId) ||
      staffData.find((item) => item.name === user?.name) ||
      null
    );
  }, [effectiveStaffId, staffData, user?.name]);
  const targetStaff = useMemo(
    () => staffInfo || { id: effectiveStaffId, name: user?.name || "" },
    [staffInfo, effectiveStaffId, user?.name],
  );

  // Cycle-filtered and approved records
  const cycleRecords = useMemo(
    () => records.filter((row) => isRecordInCycle(row, cycle)) as PointRecord[],
    [records, cycle],
  );

  const staffCycleRecords = useMemo(
    () => cycleRecords.filter((r) => recordBelongsToStaff(r, targetStaff)),
    [cycleRecords, targetStaff],
  );

  const approvedCycleRecords = useMemo(
    () => staffCycleRecords.filter((r) => isApprovedPointRecord(r)),
    [staffCycleRecords],
  );

  const incentiveSummary = useMemo(() => calculateStaffCycleIncentiveFromRows({
    staff: {
      id: staffInfo?.id || user?.staffId || user?.id,
      name: staffInfo?.name || user?.name,
      points: staffInfo?.points,
      max_points: staffInfo?.max_points,
    },
    records: cycleRecords,
    cycle,
  }), [staffInfo, cycleRecords, cycle, user]);

  const currentPoints = incentiveSummary.finalPoints;
  const maxPoints = incentiveSummary.startingPoints;
  const incentiveAmount = incentiveSummary.incentiveValue;
  const performanceLevel = getPerformanceLevel(currentPoints);
  const pointsPercent = percent(currentPoints, maxPoints);

  // Cycle bonus / deduction totals
  const bonusRecords = incentiveSummary.rewardTransactions;
  const deductionRecords = incentiveSummary.deductionTransactions;
  const bonusPoints = incentiveSummary.approvedRewardPoints;
  const deductionPoints = incentiveSummary.approvedDeductionPoints;

  // ── Loading state ──
  if (staffLoading || recLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="stat-card h-24 animate-pulse bg-white/5" />
        ))}
      </div>
    );
  }

  const displayName = staffInfo?.name || user?.name || "الموظف";
  const displayRole = staffInfo?.role || user?.role || "";
  const displayBranch = staffInfo?.branch || user?.branch || "";
  const myNotifications = rawNotifications
    .map((row) => normalizeNotification(row))
    .filter((item) =>
      item.recipient_staff_id === targetStaff.id ||
      item.user_id === user?.id ||
      item.recipient_user_id === user?.id ||
      item.recipient_role === user?.role ||
      (!item.recipient_staff_id && !item.user_id && item.branch && item.branch === displayBranch)
    );
  const unreadNotifications = myNotifications.filter((item) => !item.read && !item.is_read);
  const urgentRequired = myNotifications.filter((item) => item.requires_action || /high|urgent|critical|عاجل|حرج/i.test(String(item.priority || "")));
  const myOpenTasks = tasks.filter((row) => {
    const status = String(row.status || "");
    if (["completed", "done", "closed", "مكتمل", "تم"].includes(status)) return false;
    const assigned = String(row.assigned_to_name || row.staff_name || row.employee_name || row.assigned_to || "");
    return assigned.includes(displayName) || String(row.assigned_staff_id || row.staff_id || "") === targetStaff.id;
  });
  const myFollowups = followups.filter((row) => {
    const status = String(row.followup_status || row.status || "");
    if (["completed", "done", "closed", "تم"].includes(status)) return false;
    const assigned = String(row.responsible_name || row.assigned_to || row.assigned_doctor || "");
    return assigned.includes(displayName) || String(row.assigned_staff_id || row.staff_id || "") === targetStaff.id;
  });

  const pointsColor =
    pointsPercent >= 90
      ? "text-teal-400"
      : pointsPercent >= 70
        ? "text-amber-400"
        : "text-red-400";

  const barColor =
    pointsPercent >= 90
      ? "bg-gradient-to-r from-teal-500 to-teal-400"
      : pointsPercent >= 70
        ? "bg-gradient-to-r from-amber-500 to-amber-400"
        : "bg-gradient-to-r from-red-500 to-red-400";

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Profile hero card */}
      <div className="bg-gradient-to-r from-teal-500/10 to-teal-600/5 border border-teal-500/20 rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-2xl font-bold shrink-0">
          {displayName[0] || "م"}
        </div>
        <div className="flex-1">
          <h1 className="text-white font-bold text-xl">{displayName}</h1>
          <div className="text-slate-400 text-sm mt-0.5">
            {displayRole}
            {displayBranch ? ` — ${displayBranch}` : ""}
          </div>
          <div className="text-teal-300 text-xs mt-1">
            الدورة الحالية: {cycle.label}
          </div>
        </div>
        <div className="text-center md:text-left">
          <div className={`text-4xl font-bold num ${pointsColor}`}>
            {currentPoints}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">
            نقطة / {maxPoints}
          </div>
          <div className="text-slate-300 text-xs mt-1">{performanceLevel}</div>
        </div>
      </div>

      <StaffOperatingPolicy />

      {/* Points progress bar */}
      <div className="stat-card">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400">تقدم النقاط في الدورة الحالية</span>
          <span className="text-white font-medium num">
            {currentPoints} / {maxPoints}
          </span>
        </div>
        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pointsPercent}%` }}
          />
        </div>
        <div className="text-xs text-slate-500 mt-1.5">
          {pointsPercent.toFixed(0)}% من أقصى نقاط الدورة
        </div>
      </div>

      {/* Cycle performance stats */}
      <div>
        <h2 className="section-title mb-3">أداء الدورة الحالية</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card text-center">
            <Star className="mx-auto text-amber-400 mb-1" size={22} />
            <div className="text-2xl font-bold num text-amber-400">
              {incentiveAmount.toLocaleString("ar-EG")}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">
              الحافز المتوقع (ج.م)
            </div>
          </div>
          <div className="stat-card text-center">
            <TrendingUp className="mx-auto text-teal-400 mb-1" size={22} />
            <div className="text-2xl font-bold num text-teal-400">
              +{bonusPoints}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">نقاط مكافآت</div>
          </div>
          <div className="stat-card text-center">
            <TrendingDown className="mx-auto text-red-400 mb-1" size={22} />
            <div className="text-2xl font-bold num text-red-400">
              -{deductionPoints}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">نقاط خصومات</div>
          </div>
          <div className="stat-card text-center">
            <Award className="mx-auto text-purple-400 mb-1" size={22} />
            <div className="text-2xl font-bold num text-purple-400">
              {approvedCycleRecords.length}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">
              عمليات في الدورة
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="section-title mb-3">مطلوب منك الآن</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniMetric icon={BellRing} label="إشعارات غير مقروءة" value={unreadNotifications.length} tone="teal" />
          <MiniMetric icon={ShieldAlert} label="إجراءات عاجلة" value={urgentRequired.length} tone="red" />
          <MiniMetric icon={CheckSquare} label="مهام مفتوحة" value={myOpenTasks.length} tone="amber" />
          <MiniMetric icon={HeadphonesIcon} label="متابعات عملاء" value={myFollowups.length} tone="blue" />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="stat-card">
            <h3 className="mb-3 font-bold text-white">سجل إشعاراتي</h3>
            <div className="space-y-2">
              {myNotifications.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{item.title}</span>
                    <span className="text-xs text-slate-500">{String(item.created_at).slice(0, 10)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.body || item.message}</p>
                </div>
              ))}
              {!myNotifications.length && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">لا توجد إشعارات تخصك حاليًا</div>}
            </div>
          </div>
          <div className="stat-card">
            <h3 className="mb-3 font-bold text-white">مهامي ومتابعاتي</h3>
            <div className="space-y-2">
              {myOpenTasks.slice(0, 4).map((item) => (
                <div key={String(item.id)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">{String(item.title || item.description || "مهمة")}</div>
              ))}
              {myFollowups.slice(0, 4).map((item) => (
                <div key={String(item.id)} className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-3 text-sm text-teal-100">متابعة: {String(item.customer_name || item.name || "عميل")}</div>
              ))}
              {!myOpenTasks.length && !myFollowups.length && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">لا توجد مهام مفتوحة مسندة لك</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div>
        <h2 className="section-title mb-3">آخر المعاملات</h2>

        {records.length === 0 ? (
          <div className="stat-card text-center py-10">
            <Calendar className="mx-auto text-slate-600 mb-2" size={34} />
            <div className="text-slate-400 text-sm">لا توجد معاملات بعد</div>
            <div className="text-slate-600 text-xs mt-1">
              ستظهر هنا المكافآت والخصومات التي تخصك
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
            <table className="data-table">
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>النقاط</th>
                  <th>السبب</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {staffCycleRecords.slice(0, 20).map((row) => {
                  const isBonus = isRewardRecord(row);
                  const pts = Math.abs(pointRecordDelta(row));
                  const status = pointRecordStatus(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <span
                          className={isBonus ? "badge-success" : "badge-danger"}
                        >
                          {isBonus ? "مكافأة" : "خصم"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`num font-bold ${isBonus ? "text-teal-400" : "text-red-400"}`}
                        >
                          {isBonus ? "+" : "-"}
                          {pts}
                        </span>
                      </td>
                      <td className="text-slate-300 text-sm">{getTransactionShortReason(row)}</td>
                      <td>
                        <span
                          className={
                            status === "approved"
                              ? "badge-success"
                              : status === "pending"
                                ? "badge-warning"
                                : "badge-danger"
                          }
                        >
                          {status === "approved"
                            ? "معتمد"
                            : status === "pending"
                              ? "قيد المراجعة"
                              : "مرفوض"}
                        </span>
                      </td>
                      <td className="text-slate-400 text-xs whitespace-nowrap">
                        {formatDateTime(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {records.length > 20 && (
              <div className="px-4 py-2 text-xs text-slate-500 border-t border-[#2d4063]">
                عرض أحدث 20 معاملة من أصل {records.length}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
