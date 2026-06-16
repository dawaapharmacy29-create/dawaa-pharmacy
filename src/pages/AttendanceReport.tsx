import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Users, CheckCircle2, XCircle, Clock, Download, Filter, Printer } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { exportAttendanceToExcel } from "@/lib/exportExcel";
import { Skeleton } from "@/components/ui/skeleton";

interface AttendanceRow {
  id?: string;
  staff_id?: string | null;
  staff_name?: string | null;
  date?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  branch?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  notes?: string | null;
  status?: string | null;
}

interface StaffSummary {
  staff_name: string;
  branch: string;
  present: number;
  absent: number;
  late: number;
  total_days: number;
  attendance_rate: number;
  avg_checkin: string | null;
}

function isLate(checkIn: string | null | undefined, shiftStart: string | null | undefined): boolean {
  if (!checkIn || !shiftStart) return false;
  try {
    const [ch, cm] = checkIn.slice(0, 5).split(":").map(Number);
    const [sh, sm] = shiftStart.slice(0, 5).split(":").map(Number);
    return ch * 60 + cm > sh * 60 + sm + 15;
  } catch {
    return false;
  }
}

function getMonthDays(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthLabel(value: string): string {
  const [y, m] = value.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long" });
}

function TableSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-3">
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AttendanceReport() {
  const { user } = useAuth();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [year, monthNum] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(getMonthDays(year, monthNum)).padStart(2, "0")}`;

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("attendance")
        .select("id,staff_id,staff_name,date,check_in,check_out,branch,shift_start,shift_end,notes,status")
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .limit(2000);
      if (err) throw err;
      setRows((data || []) as AttendanceRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل بيانات الحضور");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { void load(); }, [load]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.branch) set.add(r.branch); });
    return ["الكل", ...Array.from(set).sort()];
  }, [rows]);

  const summaries = useMemo((): StaffSummary[] => {
    const map = new Map<string, { rows: AttendanceRow[]; branch: string }>();
    rows
      .filter((r) => branchFilter === "الكل" || r.branch === branchFilter)
      .forEach((r) => {
        const name = r.staff_name || r.staff_id || "غير محدد";
        if (!map.has(name)) map.set(name, { rows: [], branch: r.branch || "-" });
        map.get(name)!.rows.push(r);
      });

    const totalDays = getMonthDays(year, monthNum);

    return Array.from(map.entries()).map(([name, { rows: staffRows, branch }]) => {
      const present = staffRows.filter((r) => r.check_in).length;
      const late = staffRows.filter((r) => isLate(r.check_in, r.shift_start)).length;
      const absent = Math.max(totalDays - present, 0);
      const checkins = staffRows.filter((r) => r.check_in).map((r) => r.check_in!);
      const avgCheckin = checkins.length
        ? (() => {
            const totalMins = checkins.reduce((sum, ci) => {
              const [h, m] = ci.slice(0, 5).split(":").map(Number);
              return sum + h * 60 + m;
            }, 0) / checkins.length;
            const h = Math.floor(totalMins / 60);
            const m = Math.round(totalMins % 60);
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          })()
        : null;

      return {
        staff_name: name,
        branch,
        present,
        absent,
        late,
        total_days: totalDays,
        attendance_rate: totalDays > 0 ? Math.round((present / totalDays) * 100) : 0,
        avg_checkin: avgCheckin,
      };
    }).sort((a, b) => b.attendance_rate - a.attendance_rate);
  }, [rows, branchFilter, year, monthNum]);

  const totals = useMemo(() => ({
    staff: summaries.length,
    present: summaries.reduce((s, r) => s + r.present, 0),
    absent: summaries.reduce((s, r) => s + r.absent, 0),
    late: summaries.reduce((s, r) => s + r.late, 0),
  }), [summaries]);

  function handleExport() {
    exportAttendanceToExcel(summaries, month);
  }

  return (
    <div className="space-y-6 print:space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-black text-slate-900">تقرير الحضور الشهري</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">ملخص حضور الفريق لكل شهر مع معدلات الانتظام والتأخير.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={summaries.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 print:hidden"
          >
            <Download size={16} /> Excel
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 print:hidden"
          >
            <Printer size={16} /> طباعة
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> تحديث
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center print:hidden">
        <div className="flex items-center gap-2 flex-1">
          <Filter size={16} className="text-slate-400 shrink-0" />
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
          />
          <span className="text-sm font-bold text-slate-600">{monthLabel(month)}</span>
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
        >
          {branches.map((b) => <option key={b}>{b}</option>)}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: "عدد الموظفين", value: totals.staff, icon: Users, color: "text-blue-600 bg-blue-50 border-blue-200" },
          { label: "إجمالي أيام الحضور", value: totals.present, icon: CheckCircle2, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
          { label: "إجمالي أيام الغياب", value: totals.absent, icon: XCircle, color: "text-red-700 bg-red-50 border-red-200" },
          { label: "إجمالي أيام التأخير", value: totals.late, icon: Clock, color: "text-amber-700 bg-amber-50 border-amber-200" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={cn("flex items-center gap-3 rounded-2xl border p-4 shadow-sm", color)}>
            <Icon size={28} />
            <div>
              <div className="text-xs font-bold">{label}</div>
              {loading
                ? <Skeleton className="h-8 w-12 mt-1" />
                : <div className="text-3xl font-black">{value.toLocaleString("ar-EG")}</div>
              }
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          ⚠️ {error}
        </div>
      )}

      {loading && <TableSkeleton />}

      {!loading && rows.length === 0 && isSupabaseConfigured && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
          <Users size={40} className="mx-auto mb-3 text-slate-300" />
          <div className="text-sm font-bold text-slate-500">
            لا توجد بيانات حضور لشهر {monthLabel(month)}. راجع جدول attendance في Supabase.
          </div>
        </div>
      )}

      {!loading && summaries.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-black text-slate-900">تفصيلة بالموظف — {monthLabel(month)}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-right">
                  <th className="p-3 font-bold">الموظف</th>
                  <th className="p-3 font-bold">الفرع</th>
                  <th className="p-3 font-bold">أيام الحضور</th>
                  <th className="p-3 font-bold">أيام الغياب</th>
                  <th className="p-3 font-bold">أيام التأخير</th>
                  <th className="p-3 font-bold">متوسط الدخول</th>
                  <th className="p-3 font-bold">معدل الانتظام</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.staff_name} className="border-t hover:bg-slate-50 transition">
                    <td className="p-3 font-black text-slate-900">{s.staff_name}</td>
                    <td className="p-3 text-slate-700">{s.branch}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-800">{s.present}</span>
                    </td>
                    <td className="p-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-black", s.absent > 3 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700")}>{s.absent}</span>
                    </td>
                    <td className="p-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-black", s.late > 2 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")}>{s.late}</span>
                    </td>
                    <td className="p-3 font-bold text-slate-700">{s.avg_checkin || "-"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", s.attendance_rate >= 90 ? "bg-emerald-500" : s.attendance_rate >= 75 ? "bg-amber-500" : "bg-red-500")}
                            style={{ width: `${s.attendance_rate}%` }}
                          />
                        </div>
                        <span className={cn("text-xs font-black", s.attendance_rate >= 90 ? "text-emerald-700" : s.attendance_rate >= 75 ? "text-amber-700" : "text-red-700")}>
                          {s.attendance_rate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
