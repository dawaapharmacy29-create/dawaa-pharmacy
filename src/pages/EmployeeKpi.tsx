import { useCallback, useEffect, useState } from 'react';
import { Award, ClipboardCheck, RefreshCw, Star, Users } from 'lucide-react';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';
import { calculateMonthlyIncentive, FREE_PERMISSIONS_PER_CYCLE, MONTHLY_STARTING_POINTS } from '@/lib/incentives/incentiveRulesEngine';
import { safeNumber, safeRows, safeText } from '@/lib/safeSupabase';

type KpiRow = {
  staff_id: string;
  staff_name: string;
  branch: string;
  role: string;
  reward_points: number;
  penalty_points: number;
  avg_review_score: number;
  review_count: number;
  days_present: number;
  days_absent: number;
  tasks_done: number;
  tasks_open: number;
  total_score: number;
  approved_permissions?: number;
};

function monthlyBreakdown(row: KpiRow) {
  return calculateMonthlyIncentive({
    startingPoints: MONTHLY_STARTING_POINTS,
    approvedDeductionPoints: row.penalty_points,
    approvedExceptionalRewardPoints: row.reward_points,
  });
}

function normalizeKpiRow(row: Record<string, unknown>): KpiRow {
  return {
    staff_id: safeText(row.staff_id ?? row.id ?? row.staff_name, crypto.randomUUID()),
    staff_name: safeText(row.staff_name ?? row.name, 'غير محدد'),
    branch: safeText(row.branch, 'غير محدد'),
    role: safeText(row.role, 'غير محدد'),
    reward_points: safeNumber(row.reward_points),
    penalty_points: safeNumber(row.penalty_points),
    avg_review_score: safeNumber(row.avg_review_score),
    review_count: safeNumber(row.review_count),
    days_present: safeNumber(row.days_present),
    days_absent: safeNumber(row.days_absent),
    tasks_done: safeNumber(row.tasks_done),
    tasks_open: safeNumber(row.tasks_open),
    total_score: safeNumber(row.total_score),
    approved_permissions: safeNumber(row.approved_permissions),
  };
}

export default function EmployeeKpi() {
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceIssue, setSourceIssue] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('الكل');

  const load = useCallback(async () => {
    setLoading(true);
    setSourceIssue(null);
    const result = await safeRows<Record<string, unknown>>(
      'employee_kpi_cycle_summary',
      (query) => query.order('total_score', { ascending: false }),
      500
    );
    setRows(result.rows.map(normalizeKpiRow));
    if (result.error) {
      setSourceIssue(
        `مصدر KPI الموظفين غير متاح أو يحتاج مراجعة: ${result.error}. لم يتم تغيير أي بيانات.`
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const branches = [...new Set(rows.map((r) => r.branch).filter(Boolean))];
  const filtered = rows.filter((r) => {
    const branchMatch = branch === 'الكل' || r.branch === branch;
    const query = search.trim().toLowerCase();
    const searchMatch =
      !query ||
      safeText(r.staff_name).toLowerCase().includes(query) ||
      safeText(r.role).toLowerCase().includes(query);
    return branchMatch && searchMatch;
  });

  const stats = {
    total: filtered.length,
    excellent: filtered.filter((r) => r.total_score >= 80).length,
    needsFollow: filtered.filter((r) => r.total_score < 60).length,
    avgScore: filtered.length
      ? Math.round(filtered.reduce((s, r) => s + r.total_score, 0) / filtered.length)
      : 0,
  };

  function getRecommendation(score: number): string {
    return score >= 80 ? '🏆 ممتاز' : score >= 60 ? '✅ جيد' : '⚠️ يحتاج متابعة';
  }

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex items-center justify-between">
        <CommandHeader
          title="مؤشرات أداء الموظفين"
          description="آخر 30 يوم • بيانات محسوبة من Supabase"
        />
        <button
          onClick={() => void load()}
          className="rounded-xl p-2 hover:bg-slate-700/50 transition"
          title="تحديث البيانات"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* الملخص السريع */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="إجمالي الموظفين" value={stats.total} icon={Users} tone="teal" />
        <MetricCard label="متوسط الأداء" value={`${stats.avgScore}%`} icon={Star} tone="green" />
        <MetricCard label="ممتاز" value={stats.excellent} icon={Award} tone="amber" />
        <MetricCard
          label="يحتاج متابعة"
          value={stats.needsFollow}
          icon={ClipboardCheck}
          tone="red"
        />
      </section>

      <section className="rounded-3xl border border-cyan-500/25 bg-[#102640] p-5 text-slate-100 shadow-xl">
        <h2 className="text-lg font-black text-white">شرح الحافز الشهري</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Explanation label="رصيد البداية" value={`${MONTHLY_STARTING_POINTS} نقطة`} />
          <Explanation label="قيمة النقطة" value="3 جنيه" />
          <Explanation label="السقف الشهري" value="1,500 جنيه" />
          <Explanation label="السماحات الشهرية" value={`${FREE_PERMISSIONS_PER_CYCLE} سماحات`} />
        </div>
        <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-sm font-semibold leading-7 text-cyan-50">الحافز الشهري يحسب من نقاط الدورة حتى سقف 500 نقطة، وأي نقاط أعلى من 500 تظهر كنقاط تميز ولا تُصرف شهريًا.</p>
        <div className="mt-4 border-t border-slate-700 pt-4"><h3 className="font-black text-white">مؤشر الأداء الإداري</h3><p className="mt-2 text-sm text-slate-300">الدرجة الإجمالية مؤشر إداري للمقارنة والمتابعة، ولا تساوي الحافز المالي مباشرة. الأوزان الإرشادية: نقاط الدورة 40%، تقييم المحادثات 30%، الحضور والانضباط 20%، وإنجاز المهام 10%.</p></div>
      </section>

      {/* الفلاتر */}
      <section className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم الموظف..."
          className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option>الكل</option>
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </section>

      {/* الجدول */}
      {sourceIssue && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-bold leading-7 text-amber-100">
          {sourceIssue}
        </div>
      )}

      <SectionState loading={loading} empty={!rows.length}>
        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/50">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700 bg-slate-900/50">
              <tr>
                {['#', 'الموظف', 'الفرع', 'التقييم', 'الحضور', 'المهام', 'النقاط', 'الحافز المتوقع', 'الدرجة'].map((h) => (
                  <th key={h} className="p-3 text-right text-xs font-black text-slate-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filtered.map((row, i) => (
                <tr key={row.staff_id} className="hover:bg-slate-700/30 transition">
                  <td className="p-3 text-slate-500">{i + 1}</td>
                  <td className="p-3">
                    <p className="font-bold text-white">{row.staff_name}</p>
                    <p className="text-xs text-slate-400">{row.role}</p>
                  </td>
                  <td className="p-3 text-slate-300">{row.branch}</td>
                  <td className="p-3 font-bold text-white">{row.avg_review_score}/100</td>
                  <td className="p-3">
                    <span className="text-emerald-400">{row.days_present} ✓</span>
                    {row.days_absent > 0 && <span className="ml-2 text-rose-400">{row.days_absent} ✗</span>}
                    <div className="mt-1 text-[11px] text-slate-400">السماحات المتبقية: {Math.max(0, FREE_PERMISSIONS_PER_CYCLE - Number(row.approved_permissions || 0))} / {FREE_PERMISSIONS_PER_CYCLE}</div>
                  </td>
                  <td className="p-3 text-white">
                    {row.tasks_done}/{row.tasks_done + row.tasks_open}
                  </td>
                  <td className="p-3">
                    <span className="text-teal-400">+{row.reward_points}</span>
                    {row.penalty_points > 0 && (
                      <span className="ml-1 text-rose-400">-{row.penalty_points}</span>
                    )}
                    <div className="mt-1 text-[11px] text-slate-400">النهائي: {monthlyBreakdown(row).finalPoints} · تميز: {monthlyBreakdown(row).distinctionPointsAbove500}</div>
                  </td>
                  <td className="p-3 font-black text-emerald-300">{monthlyBreakdown(row).monthlyIncentiveValue.toLocaleString('ar-EG')} ج</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-black ${
                        row.total_score >= 80
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : row.total_score >= 60
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {getRecommendation(row.total_score)} · {row.total_score}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </SectionState>

      {/* ملاحظة */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">
        📊 هذه النتائج توصيات فقط؛ الاعتماد النهائي والمكافآت المالية بقرار المدير.
      </div>
    </div>
  );
}

function Explanation({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3"><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-1 text-lg font-black text-cyan-100">{value}</div></div>;
}
