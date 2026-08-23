import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Receipt, Target, TrendingUp, UserCheck } from 'lucide-react';
import { BRANCHES } from '@/lib/constants';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { safeRows, safeNumber, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';
import {
  loadSalesAnalyticsSummary,
  type SalesAnalyticsSummary,
} from '@/lib/salesAnalyticsSummaryService';

type Row = Record<string, unknown>;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptySalesSummary(): SalesAnalyticsSummary {
  return {
    kpis: { netSales: 0, invoicesCount: 0, avgInvoice: 0, uniqueCustomers: 0, activeDays: 0 },
    dailyTrend: [],
    dailySales: [],
    staffSalesSummary: [],
    last5DaysByBranch: [],
    branchRows: [],
    doctorRows: [],
    customerCards: { important: null, stopped: null, threatened: null, invalidPhone: null },
    dataHealth: { invoicesWithoutCustomer: null, invoicesWithoutDoctor: null, invoicesWithoutBranch: null },
    sourceHealth: [],
    errorsBySection: {},
  };
}

export default function DailyTarget() {
  const [branch, setBranch] = useState<string>(BRANCHES[0] || '');
  const [salesSummary, setSalesSummary] = useState<SalesAnalyticsSummary>(() => emptySalesSummary());
  const [targets, setTargets] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      const date = localDateKey();
      const [salesResult, targetResult] = await Promise.allSettled([
        loadSalesAnalyticsSummary(
          {
            startDate: date,
            endDate: date,
            branch,
          },
          forceRefresh
        ),
        safeRows<Row>('branch_sales_targets', (q) => q.limit(500)),
      ]);

      if (salesResult.status === 'fulfilled') {
        setSalesSummary(salesResult.value);
        const sectionErrors = Object.values(salesResult.value.errorsBySection || {}).filter(Boolean);
        if (sectionErrors.length) setError(sectionErrors[0]);
      } else {
        setError(
          salesResult.reason instanceof Error
            ? salesResult.reason.message
            : 'تعذر تحميل ملخص مبيعات اليوم'
        );
      }

      if (targetResult.status === 'fulfilled') {
        setTargets(targetResult.value.rows);
      }
      setLoading(false);
    },
    [branch]
  );

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const stats = useMemo(() => {
    const sales = safeNumber(salesSummary.kpis.netSales);
    const invoiceCount = safeNumber(salesSummary.kpis.invoicesCount);
    const cycle = getCurrentCycle();
    const days = Math.max(
      1,
      Math.round((cycle.end.getTime() - cycle.start.getTime()) / 86400000) + 1
    );
    const targetRow = targets.find((row) => safeText(row.branch ?? row.branch_name) === branch);
    const explicitDaily = safeNumber(targetRow?.daily_target ?? targetRow?.target_amount);
    const monthly = safeNumber(targetRow?.monthly_target ?? targetRow?.target);
    const target = explicitDaily || (monthly ? monthly / days : 0);
    const percentage = target ? Math.round((sales / target) * 100) : null;
    const hour = new Date().getHours();
    const remainingHours = Math.max(0, 24 - hour);
    const bestDoctor = [...salesSummary.doctorRows]
      .filter((row) => !row.branch || row.branch === branch)
      .sort((a, b) => b.netSales - a.netSales)[0];

    return {
      sales,
      count: invoiceCount,
      target,
      percentage,
      remaining: Math.max(0, target - sales),
      remainingHours,
      hourly: remainingHours ? Math.max(0, target - sales) / remainingHours : 0,
      bestDoctor,
      cycle: `${formatCycleDate(cycle.start)} — ${formatCycleDate(cycle.end)}`,
    };
  }, [branch, salesSummary, targets]);

  const tone =
    stats.percentage === null
      ? 'teal'
      : stats.percentage < 40
        ? 'red'
        : stats.percentage < 80
          ? 'amber'
          : 'green';

  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Live Target"
        title="لوحة الهدف اليومي"
        description="متابعة الهدف والمبيعات الفعلية لحظيًا من تجميعات السيرفر، بتحديث تلقائي كل خمس دقائق."
      />
      <div className="dawaa-panel">
        <label className="text-sm font-black text-slate-700 dark:text-slate-200">الفرع</label>
        <select
          className="dawaa-input mt-2 w-full md:w-72"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          {BRANCHES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-slate-500">دورة الهدف: {stats.cycle}</p>
      </div>
      <SectionState
        loading={loading}
        error={error}
        empty={!salesSummary.kpis.invoicesCount && !loading && !error}
      >
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Target}
            label="هدف اليوم"
            value={
              stats.target ? `${Math.round(stats.target).toLocaleString('ar-EG')} ج` : 'غير متاح'
            }
          />
          <MetricCard
            icon={TrendingUp}
            label="مبيعات اليوم"
            value={`${stats.sales.toLocaleString('ar-EG')} ج`}
            tone={tone}
          />
          <MetricCard icon={Receipt} label="عدد الفواتير" value={stats.count} />
          <MetricCard
            icon={Clock3}
            label="المطلوب في الساعة"
            value={
              stats.target ? `${Math.round(stats.hourly).toLocaleString('ar-EG')} ج` : 'غير متاح'
            }
            hint={`${stats.remainingHours} ساعة متبقية`}
          />
          <MetricCard
            icon={Target}
            label="نسبة الإنجاز"
            value={stats.percentage === null ? 'غير متاح' : `${stats.percentage}%`}
            hint={
              stats.target
                ? `المتبقي ${Math.round(stats.remaining).toLocaleString('ar-EG')} ج`
                : undefined
            }
            tone={tone}
          />
          <MetricCard
            icon={UserCheck}
            label="أفضل دكتور اليوم"
            value={stats.bestDoctor?.doctor || 'غير متاح'}
            hint={
              stats.bestDoctor
                ? `${Math.round(stats.bestDoctor.netSales).toLocaleString('ar-EG')} ج`
                : undefined
            }
          />
        </section>
        <div className="dawaa-panel">
          <div className="h-5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full transition-all ${tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, stats.percentage || 0)}%` }}
            />
          </div>
        </div>
      </SectionState>
    </div>
  );
}
