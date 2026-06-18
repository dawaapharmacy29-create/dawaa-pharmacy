import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Receipt, Target, TrendingUp, UserCheck } from 'lucide-react';
import { BRANCHES } from '@/lib/constants';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { safeRows, safeNumber, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';

type Row = Record<string, unknown>;
function amount(row: Row) {
  return safeNumber(
    row.net_amount ?? row.discounted_amount ?? row.amount ?? row.total_amount ?? row.net_total
  );
}

export default function DailyTarget() {
  const [branch, setBranch] = useState<string>(BRANCHES[0] || '');
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [targets, setTargets] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const date = new Date().toISOString().slice(0, 10);
    const [salesResult, targetResult] = await Promise.all([
      safeRows<Row>(
        'sales_invoices',
        (q) => q.gte('invoice_date', date).lte('invoice_date', `${date}T23:59:59`).limit(10000),
        10000
      ),
      safeRows<Row>('branch_sales_targets', (q) => q.limit(500)),
    ]);
    setInvoices(salesResult.rows);
    setTargets(targetResult.rows);
    if (!salesResult.available) setError('لا توجد بيانات مبيعات كافية لهذا القسم حاليًا');
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);
  const stats = useMemo(() => {
    const branchRows = invoices.filter(
      (r) => !branch || safeText(r.branch ?? r.branch_name) === branch
    );
    const sales = branchRows.reduce((s, r) => s + amount(r), 0);
    const cycle = getCurrentCycle();
    const days = Math.max(
      1,
      Math.round((cycle.end.getTime() - cycle.start.getTime()) / 86400000) + 1
    );
    const targetRow = targets.find((r) => safeText(r.branch ?? r.branch_name) === branch);
    const explicitDaily = safeNumber(targetRow?.daily_target ?? targetRow?.target_amount);
    const monthly = safeNumber(targetRow?.monthly_target ?? targetRow?.target);
    const target = explicitDaily || (monthly ? monthly / days : 0);
    const percentage = target ? Math.round((sales / target) * 100) : null;
    const hour = new Date().getHours();
    const remainingHours = Math.max(0, 24 - hour);
    const doctors = new Map<string, number>();
    branchRows.forEach((r) => {
      const name = safeText(r.seller_name ?? r.doctor_name ?? r.staff_name);
      if (name) doctors.set(name, (doctors.get(name) || 0) + amount(r));
    });
    const bestDoctor = [...doctors.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      sales,
      count: branchRows.length,
      target,
      percentage,
      remaining: Math.max(0, target - sales),
      remainingHours,
      hourly: remainingHours ? Math.max(0, target - sales) / remainingHours : 0,
      bestDoctor,
      cycle: `${formatCycleDate(cycle.start)} — ${formatCycleDate(cycle.end)}`,
    };
  }, [branch, invoices, targets]);
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
        description="متابعة الهدف والمبيعات الفعلية لحظيًا، بتحديث تلقائي كل خمس دقائق."
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
      <SectionState loading={loading} error={error} empty={!invoices.length && !loading}>
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
            value={stats.bestDoctor?.[0] || 'غير متاح'}
            hint={
              stats.bestDoctor
                ? `${Math.round(stats.bestDoctor[1]).toLocaleString('ar-EG')} ج`
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
