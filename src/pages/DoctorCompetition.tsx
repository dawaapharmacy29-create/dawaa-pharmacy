import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Trophy } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  getDoctorCompetitionMetrics,
  normalizeDoctorName,
  type DoctorCompetitionPeriod,
  type DoctorCompetitionScore,
} from '@/lib/doctorCompetitionMetrics';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { canViewAllBranches, rowMatchesCurrentDoctor } from '@/lib/security/userDataScope';
import { getBranchScope } from '@/lib/security/permissionScopes';
import { normalizeBranchName } from '@/lib/branch';

const ALL_BRANCHES = 'كل الفروع';

type RankingMode = 'points' | 'sales' | 'invoices' | 'average';

function money(value: number) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج`;
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function currentDoctor(user: ReturnType<typeof useAuth>['user'], row: DoctorCompetitionScore) {
  if (user?.staffId && row.staffId === user.staffId) return true;
  return rowMatchesCurrentDoctor(user, { staff_id: row.staffId, doctor_name: row.name, branch: row.branch });
}

export default function DoctorCompetition() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const canSeeAllBranches = canViewAllBranches(user);
  const requestedBranch = params.get('branch') || ALL_BRANCHES;
  const [branchFilter, setBranchFilter] = useState(() =>
    canSeeAllBranches ? requestedBranch : normalizeBranchName(user?.branch || '') || ALL_BRANCHES
  );
  const [period, setPeriod] = useState<DoctorCompetitionPeriod>('cycle');
  const [mode, setMode] = useState<RankingMode>('points');
  const [rows, setRows] = useState<DoctorCompetitionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const effectiveBranch = getBranchScope(user, branchFilter, ALL_BRANCHES);

  useEffect(() => {
    if (!canSeeAllBranches) setBranchFilter(normalizeBranchName(user?.branch || '') || ALL_BRANCHES);
  }, [canSeeAllBranches, user?.branch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const result = await getDoctorCompetitionMetrics({
        period,
        branch: effectiveBranch,
        userBranch: user?.branch,
        canSeeAllBranches,
      });
      setRows(result.rows);
      if (result.status === 'partial') setWarning('تم عرض البيانات المتاحة، وبعض المصادر المساندة لم تُحمّل بالكامل.');
      if (!result.rows.some((row) => currentDoctor(user, row)) && user?.staffId) {
        setWarning((value) => `${value ? `${value} ` : ''}حسابك غير مربوط بفواتير المسابقة بصورة كاملة، لكن ترتيب دكاترة الفرع ظاهر.`);
      }
    } catch (loadError) {
      console.error('[DoctorCompetition] load failed', loadError);
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مسابقة الدكاترة.');
    } finally {
      setLoading(false);
    }
  }, [canSeeAllBranches, effectiveBranch, period, user]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = useMemo(() => {
    const sorted = [...rows];
    if (mode === 'sales') return sorted.sort((a, b) => b.totalSales - a.totalSales || b.competitionPoints - a.competitionPoints);
    if (mode === 'invoices') return sorted.sort((a, b) => b.invoices - a.invoices || b.totalSales - a.totalSales);
    if (mode === 'average') return sorted.sort((a, b) => b.avgInvoice - a.avgInvoice || b.invoices - a.invoices);
    return sorted.sort((a, b) => b.competitionPoints - a.competitionPoints || b.totalSales - a.totalSales);
  }, [mode, rows]);

  const exportCsv = () => {
    const lines = [
      ['الترتيب', 'اسم الدكتور', 'الفرع', 'إجمالي المبيعات', 'عدد الفواتير', 'متوسط الفاتورة', 'نقاط المسابقة', 'الفرق عن المركز السابق', 'المطلوب للمركز التالي'].map(csvCell).join(','),
      ...visibleRows.map((row, index) => {
        const previous = index > 0 ? visibleRows[index - 1] : null;
        const gap = previous ? Math.max(0, previous.competitionPoints - row.competitionPoints) : 0;
        const salesNeeded = previous ? Math.max(0, previous.totalSales - row.totalSales + 1) : 0;
        return [
          index + 1,
          row.name,
          row.branch,
          row.totalSales.toFixed(2),
          row.invoices,
          row.avgInvoice.toFixed(2),
          row.competitionPoints.toFixed(1),
          index === 0 ? 'المركز الأول' : gap.toFixed(1),
          index === 0 ? '—' : salesNeeded.toFixed(2),
        ].map(csvCell).join(',');
      }),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `doctor-competition-${effectiveBranch || 'all'}-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-amber-400/25 bg-slate-950/80 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-amber-200"><Trophy size={22} /><span className="font-black">مسابقة الدكاترة</span></div>
            <h1 className="mt-2 text-3xl font-black text-white">ترتيب الدكاترة حسب نطاق حسابك</h1>
            <p className="mt-2 text-sm text-slate-300">التجميع يعتمد على staff_id أولًا، والاسم الموحد فقط كحل احتياطي. لا تظهر ملاحظات التقييم الداخلية لزملائك.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportCsv} disabled={!visibleRows.length} className="btn-secondary disabled:opacity-50"><Download className="ml-1 inline h-4 w-4" /> تصدير CSV</button>
            <button type="button" onClick={() => void load()} disabled={loading} className="btn-primary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-3">
        <select className="input-dark" value={period} onChange={(event) => setPeriod(event.target.value as DoctorCompetitionPeriod)}>
          <option value="cycle">الدورة الحالية 26 إلى 25</option>
          <option value="last30">آخر 30 يومًا</option>
          <option value="last90">آخر 3 شهور</option>
        </select>
        {canSeeAllBranches ? (
          <select className="input-dark" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value={ALL_BRANCHES}>{ALL_BRANCHES}</option>
            {BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 font-black text-slate-200">{effectiveBranch || user?.branch || 'الفرع غير محدد'}</div>
        )}
        <select className="input-dark" value={mode} onChange={(event) => setMode(event.target.value as RankingMode)}>
          <option value="points">الترتيب حسب نقاط المسابقة</option>
          <option value="sales">الترتيب حسب المبيعات</option>
          <option value="invoices">الترتيب حسب عدد الفواتير</option>
          <option value="average">الترتيب حسب متوسط الفاتورة</option>
        </select>
      </section>

      {warning ? <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">{warning}</div> : null}
      {error ? <div className="rounded-2xl border border-red-300/25 bg-red-500/10 p-4 text-sm font-bold text-red-100">{error}</div> : null}

      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80">
        <div className="border-b border-slate-800 p-5">
          <h2 className="text-2xl font-black text-white">قائمة الدكاترة المؤهلين</h2>
          <p className="mt-1 text-sm text-slate-400">{loading ? 'جارٍ التحميل…' : `${visibleRows.length} دكتور داخل النطاق الحالي`}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-right text-sm">
            <thead className="bg-slate-950 text-slate-300">
              <tr>
                <th className="p-3">الترتيب</th><th className="p-3">الدكتور</th><th className="p-3">الفرع</th>
                <th className="p-3">المبيعات</th><th className="p-3">الفواتير</th><th className="p-3">متوسط الفاتورة</th>
                <th className="p-3">نقاط المسابقة</th><th className="p-3">الفرق عن السابق</th><th className="p-3">المطلوب للمركز التالي</th>
              </tr>
            </thead>
            <tbody>
              {loading && !visibleRows.length ? Array.from({ length: 6 }).map((_, index) => (
                <tr key={index} className="border-t border-slate-800"><td colSpan={9} className="p-3"><div className="h-9 animate-pulse rounded-lg bg-slate-800" /></td></tr>
              )) : visibleRows.map((row, index) => {
                const previous = index > 0 ? visibleRows[index - 1] : null;
                const pointsGap = previous ? Math.max(0, previous.competitionPoints - row.competitionPoints) : 0;
                const salesNeeded = previous ? Math.max(0, previous.totalSales - row.totalSales + 1) : 0;
                const mine = currentDoctor(user, row);
                return (
                  <tr key={row.staffId || `${row.branch}-${normalizeDoctorName(row.name)}`} className={`border-t border-slate-800 ${mine ? 'bg-teal-500/15 ring-1 ring-inset ring-teal-400/40' : 'hover:bg-slate-800/50'}`}>
                    <td className="p-3 text-xl font-black text-amber-200">{index + 1}</td>
                    <td className="p-3 font-black text-white">{row.name}{mine ? <span className="mr-2 rounded-full bg-teal-400 px-2 py-1 text-[11px] text-slate-950">أنت هنا</span> : null}</td>
                    <td className="p-3 text-slate-300">{row.branch}</td>
                    <td className="p-3 font-black text-white">{money(row.totalSales)}</td>
                    <td className="p-3">{row.invoices}</td>
                    <td className="p-3">{money(row.avgInvoice)}</td>
                    <td className="p-3 font-black text-teal-200">{row.competitionPoints.toFixed(1)}</td>
                    <td className="p-3">{index === 0 ? 'المركز الأول' : `${pointsGap.toFixed(1)} نقطة`}</td>
                    <td className="p-3">{index === 0 ? '—' : `${money(salesNeeded)} تقريبًا`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && !visibleRows.length ? (
          <div className="p-12 text-center"><div className="text-xl font-black text-white">لا توجد بيانات للمسابقة</div><p className="mt-2 text-sm text-slate-400">لا توجد حسابات دكاترة مؤهلة أو فواتير مرتبطة بالنطاق والفترة المختارين.</p></div>
        ) : null}
      </section>
    </div>
  );
}
