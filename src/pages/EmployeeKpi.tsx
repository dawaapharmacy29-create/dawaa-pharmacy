import { useEffect, useMemo, useState } from 'react';
import { Award, ClipboardCheck, Star, Users } from 'lucide-react';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { safeRows, safeNumber, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';
type Row = Record<string, unknown>;
type Kpi = {
  id: string;
  name: string;
  branch: string;
  role: string;
  points: number;
  reviews: number;
  attendance: number;
  tasks: number;
  total: number;
  recommendation: string;
};
export default function EmployeeKpi() {
  const [sources, setSources] = useState<{
    staff: Row[];
    points: Row[];
    reviews: Row[];
    attendance: Row[];
    tasks: Row[];
  }>({ staff: [], points: [], reviews: [], attendance: [], tasks: [] });
  const [loading, setLoading] = useState(true);
  const cycle = getCurrentCycle();
  useEffect(() => {
    void Promise.all([
      safeRows<Row>('staff', (q) => q.limit(1000), 1000),
      safeRows<Row>(
        'employee_transactions',
        (q) =>
          q
            .gte('created_at', formatCycleDate(cycle.start))
            .lte('created_at', cycle.end.toISOString())
            .limit(5000),
        5000
      ),
      safeRows<Row>(
        'conversation_sales_reviews',
        (q) => q.gte('created_at', formatCycleDate(cycle.start)).limit(5000),
        5000
      ),
      safeRows<Row>(
        'attendance',
        (q) => q.gte('date', formatCycleDate(cycle.start)).limit(5000),
        5000
      ),
      safeRows<Row>(
        'tasks',
        (q) => q.gte('created_at', formatCycleDate(cycle.start)).limit(5000),
        5000
      ),
    ]).then(([staff, points, reviews, attendance, tasks]) => {
      setSources({
        staff: staff.rows,
        points: points.rows,
        reviews: reviews.rows,
        attendance: attendance.rows,
        tasks: tasks.rows,
      });
      setLoading(false);
    });
  }, []);
  const rows = useMemo<Kpi[]>(
    () =>
      sources.staff.map((s) => {
        const id = safeText(s.id);
        const name = safeText(s.name ?? s.staff_name);
        const related = (r: Row) =>
          safeText(r.staff_id ?? r.employee_id ?? r.user_id) === id ||
          safeText(r.staff_name ?? r.employee_name ?? r.doctor_name) === name;
        const pointRows = sources.points.filter(related);
        const reviewRows = sources.reviews.filter(related);
        const attendanceRows = sources.attendance.filter(related);
        const taskRows = sources.tasks.filter(related);
        const pointsRaw = pointRows.reduce((sum, r) => sum + safeNumber(r.points ?? r.amount), 0);
        const pointsScore = Math.max(0, Math.min(100, 50 + pointsRaw));
        const reviewsScore = reviewRows.length
          ? reviewRows.reduce(
              (sum, r) => sum + safeNumber(r.final_score ?? r.score ?? r.percentage),
              0
            ) / reviewRows.length
          : 0;
        const attendanceScore = attendanceRows.length
          ? (attendanceRows.filter(
              (r) =>
                /present|حاضر|موجود/i.test(safeText(r.status ?? r.attendance_status)) || r.check_in
            ).length /
              attendanceRows.length) *
            100
          : 0;
        const tasksScore = taskRows.length
          ? (taskRows.filter((r) => /completed|done|تم/i.test(safeText(r.status))).length /
              taskRows.length) *
            100
          : 0;
        const total = Math.round(
          pointsScore * 0.3 + reviewsScore * 0.3 + attendanceScore * 0.2 + tasksScore * 0.2
        );
        return {
          id,
          name,
          branch: safeText(s.branch),
          role: safeText(s.role),
          points: Math.round(pointsRaw),
          reviews: Math.round(reviewsScore),
          attendance: Math.round(attendanceScore),
          tasks: Math.round(tasksScore),
          total,
          recommendation:
            total >= 85
              ? 'ممتاز'
              : total >= 70
                ? 'جيد'
                : total >= 55
                  ? 'يحتاج متابعة'
                  : 'يحتاج تدريب',
        };
      }),
    [sources]
  );
  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="KPI Engine"
        title="مؤشرات أداء الموظفين"
        description={`توصية تشغيلية للدورة ${formatCycleDate(cycle.start)} — ${formatCycleDate(cycle.end)} دون اعتماد مالي تلقائي.`}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={Users} label="الموظفون" value={rows.length} />
        <MetricCard
          icon={Award}
          label="ممتاز"
          value={rows.filter((r) => r.recommendation === 'ممتاز').length}
          tone="green"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="يحتاج متابعة"
          value={rows.filter((r) => /متابعة|تدريب/.test(r.recommendation)).length}
          tone="amber"
        />
        <MetricCard
          icon={Star}
          label="متوسط التقييم"
          value={rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0}
        />
      </section>
      <SectionState loading={loading} empty={!rows.length}>
        <section className="dawaa-panel overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                {[
                  'الموظف',
                  'الفرع/الدور',
                  'نقاط الشهر',
                  'المحادثات 30%',
                  'الحضور 20%',
                  'المهام 20%',
                  'النهائي',
                  'التوصية',
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id || r.name}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="p-3 font-bold">{r.name}</td>
                  <td className="p-3">
                    {r.branch}
                    <div className="text-xs text-slate-500">{r.role}</div>
                  </td>
                  <td className="p-3">{r.points}</td>
                  <td className="p-3">{r.reviews}%</td>
                  <td className="p-3">{r.attendance}%</td>
                  <td className="p-3">{r.tasks}%</td>
                  <td className="p-3 font-black">{r.total}%</td>
                  <td className="p-3">
                    <span className={r.total >= 70 ? 'badge-success' : 'badge-warning'}>
                      {r.recommendation}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </SectionState>
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">
        هذه النتائج توصيات فقط؛ الاعتماد النهائي والمكافآت المالية بقرار المدير.
      </div>
    </div>
  );
}
