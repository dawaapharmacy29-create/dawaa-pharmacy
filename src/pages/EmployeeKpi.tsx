import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, RefreshCw, Star, Users } from 'lucide-react';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';
import { useAuth } from '@/hooks/useAuth';
import { safeNumber, safeRows, safeText } from '@/lib/safeSupabase';

type KpiRow = {
  staff_id: string;
  staff_name: string;
  branch: string;
  role: string;
  reward_points: number;
  penalty_points: number;
  has_points_data: boolean;
  avg_review_score: number;
  review_count: number;
  has_review_data: boolean;
};

let kpiFallbackCounter = 0;

function normalizeKpiRow(row: Record<string, unknown>): KpiRow {
  kpiFallbackCounter += 1;
  return {
    staff_id: safeText(row.staff_id ?? row.id ?? row.staff_name, `kpi-${kpiFallbackCounter}`),
    staff_name: safeText(row.staff_name ?? row.name, 'غير محدد'),
    branch: safeText(row.branch, 'غير محدد'),
    role: safeText(row.role, 'غير محدد'),
    reward_points: safeNumber(row.reward_points),
    penalty_points: safeNumber(row.penalty_points),
    has_points_data: row.has_points_data === true,
    avg_review_score: safeNumber(row.avg_review_score),
    review_count: safeNumber(row.review_count),
    has_review_data: row.has_review_data === true,
  };
}

export default function EmployeeKpi() {
  const { checkPermission } = useAuth();
  const canView =
    checkPermission('view_team') &&
    checkPermission('view_points') &&
    checkPermission('view_reviews');

  const [rows, setRows] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(canView);
  const [sourceIssue, setSourceIssue] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('الكل');

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setRows([]);
      return;
    }

    setLoading(true);
    setSourceIssue(null);
    try {
      const result = await safeRows<Record<string, unknown>>(
        'employee_kpi_30d_summary',
        (query) => query.order('staff_name', { ascending: true }),
        500
      );

      setRows(result.rows.map(normalizeKpiRow));
      if (result.error) {
        const errorLower = result.error.toLowerCase();
        if (errorLower.includes('permission') || errorLower.includes('row-level security')) {
          setSourceIssue('لا توجد صلاحية قراءة مؤشرات الموظفين لهذا الحساب.');
        } else if (
          errorLower.includes('does not exist') ||
          errorLower.includes('not found') ||
          errorLower.includes('could not find')
        ) {
          setSourceIssue('مصدر مؤشرات الموظفين لآخر 30 يوم غير متاح حاليًا.');
        } else {
          setSourceIssue(`خطأ في تحميل البيانات: ${result.error}. لم يتم تغيير أي بيانات.`);
        }
      }
    } catch (error) {
      console.error('[EmployeeKpi] Load error:', error);
      setSourceIssue(
        `خطأ غير متوقع: ${error instanceof Error ? error.message : 'خطأ غير معروف'}. لم يتم تغيير أي بيانات.`
      );
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const branches = useMemo(
    () => [...new Set(rows.map((row) => row.branch).filter(Boolean))],
    [rows]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const branchMatch = branch === 'الكل' || row.branch === branch;
      const searchMatch =
        !query ||
        row.staff_name.toLowerCase().includes(query) ||
        row.role.toLowerCase().includes(query);
      return branchMatch && searchMatch;
    });
  }, [branch, rows, search]);

  const stats = useMemo(() => {
    const reviewRows = filtered.filter((row) => row.has_review_data);
    const avgReview = reviewRows.length
      ? reviewRows.reduce((sum, row) => sum + row.avg_review_score, 0) / reviewRows.length
      : 0;

    return {
      total: filtered.length,
      withPoints: filtered.filter((row) => row.has_points_data).length,
      withReviews: reviewRows.length,
      avgReview,
    };
  }, [filtered]);

  if (!canView) {
    return (
      <div className="p-4" dir="rtl">
        <div className="dawaa-card dawaa-card--soft dawaa-body py-16 text-center">
          ليس لديك صلاحيات الفريق والنقاط والتقييمات المطلوبة لعرض مؤشرات الموظفين.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <CommandHeader
          title="مؤشرات أداء الموظفين"
          description="آخر 30 يوم • بيانات تشغيلية خام من Supabase"
        />
        <button
          onClick={() => void load()}
          className="rounded-xl p-2 transition hover:bg-slate-700/50"
          title="تحديث البيانات"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="إجمالي الموظفين" value={stats.total} icon={Users} tone="teal" />
        <MetricCard label="لديهم حركة نقاط" value={stats.withPoints} icon={Award} tone="amber" />
        <MetricCard label="لديهم تقييمات" value={stats.withReviews} icon={Star} tone="green" />
        <MetricCard
          label="متوسط التقييم"
          value={stats.withReviews ? `${stats.avgReview.toFixed(1)}/100` : '—'}
          icon={Star}
          tone="green"
        />
      </section>

      <section className="rounded-3xl border border-cyan-500/25 bg-[#102640] p-5 text-slate-100 shadow-xl">
        <h2 className="text-lg font-black text-white">ما الذي تعرضه الصفحة؟</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">
          هذه الصفحة تعرض مؤشرات تشغيلية خام لآخر 30 يوم: حركة نقاط الموظف وتقييمات المحادثات فقط.
          لا يتم إنشاء درجة أداء عامة هنا، ولا يتم احتساب الحضور أو المهام أو حافز مالي من هذه الصفحة.
        </p>
      </section>

      <section className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="بحث باسم الموظف..."
          className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option>الكل</option>
          {branches.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </section>

      {sourceIssue && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-bold leading-7 text-amber-100">
          {sourceIssue}
        </div>
      )}

      <SectionState loading={loading} empty={!rows.length}>
        <section className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-800/50">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-slate-700 bg-slate-900/50">
              <tr>
                {['#', 'الموظف', 'الفرع', 'التقييم', 'عدد التقييمات', 'نقاط إيجابية', 'نقاط مخصومة'].map((heading) => (
                  <th key={heading} className="p-3 text-right text-xs font-black text-slate-400">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filtered.map((row, index) => (
                <tr key={row.staff_id} className="transition hover:bg-slate-700/30">
                  <td className="p-3 text-slate-500">{index + 1}</td>
                  <td className="p-3">
                    <p className="font-bold text-white">{row.staff_name}</p>
                    <p className="text-xs text-slate-400">{row.role}</p>
                  </td>
                  <td className="p-3 text-slate-300">{row.branch}</td>
                  <td className="p-3 font-bold text-white">
                    {row.has_review_data ? `${row.avg_review_score.toFixed(1)}/100` : 'لا توجد بيانات'}
                  </td>
                  <td className="p-3 text-slate-300">
                    {row.has_review_data ? row.review_count : '—'}
                  </td>
                  <td className="p-3 font-black text-teal-300">
                    {row.has_points_data ? `+${row.reward_points}` : 'لا توجد بيانات'}
                  </td>
                  <td className="p-3 font-black text-rose-300">
                    {row.has_points_data ? `-${row.penalty_points}` : 'لا توجد بيانات'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </SectionState>

      <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4 text-sm font-semibold leading-7 text-slate-300">
        المؤشرات هنا للمراجعة التشغيلية فقط. الحوافز والرواتب والتسويات لها مصادر اعتماد منفصلة.
      </div>
    </div>
  );
}
