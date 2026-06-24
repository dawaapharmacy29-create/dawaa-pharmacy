import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Receipt,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchExecutiveDashboardSummary,
  type DashboardSummary,
} from '@/lib/dashboardSummaryService';
import { safeRows, isOpenStatus, safeNumber, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';

type Row = Record<string, unknown>;
const today = () => new Date().toISOString().slice(0, 10);

export default function DailyCommand() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [extras, setExtras] = useState({
    complaints: 0,
    weakReviews: 0,
    shortages: 0,
    pendingApprovals: 0,
    leaveRequests: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const date = today();
      const result = await fetchExecutiveDashboardSummary({
        startDate: date,
        endDate: date,
        branch: user?.branch || 'all',
      });
      setSummary(result);
      const [complaints, reviews, shortages, points, leaves] = await Promise.all([
        safeRows<Row>('customer_requests', (q) => q.limit(200)),
        safeRows<Row>('conversation_sales_reviews', (q) => q.limit(200)),
        safeRows<Row>('shortages', (q) => q.limit(200)),
        safeRows<Row>('employee_transactions', (q) => q.limit(200)),
        safeRows<Row>('time_off_requests', (q) => q.limit(200)),
      ]);
      setExtras({
        complaints: complaints.rows.filter(
          (r) =>
            /complaint|شكوى/i.test(safeText(r.type ?? r.request_type)) && isOpenStatus(r.status)
        ).length,
        weakReviews: reviews.rows.filter(
          (r) => safeNumber(r.final_score ?? r.score ?? r.percentage) < 70
        ).length,
        shortages: shortages.rows.filter((r) => isOpenStatus(r.status)).length,
        pendingApprovals: points.rows.filter((r) =>
          /pending|معلق|بانتظار/i.test(safeText(r.status ?? r.approval_status))
        ).length,
        leaveRequests: leaves.rows.filter((r) => /pending|معلق|بانتظار/i.test(safeText(r.status)))
          .length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل مركز القيادة');
    } finally {
      setLoading(false);
    }
  }, [user?.branch]);

  useEffect(() => {
    void load();
  }, [load]);
  const k = summary?.kpis;
  const normalizedKpis = summary?.normalizedKpis;
  const customerIntelligence = summary?.customerIntelligence;
  const dataHealth = summary?.dataHealth;
  const sales = k?.netSales ?? null;
  const target = useMemo(
    () =>
      summary?.dailySales?.reduce(
        (sum, row) => sum + safeNumber((row as unknown as Row).target_amount),
        0
      ) || null,
    [summary]
  );
  const achievement = target && sales !== null ? Math.round((sales / target) * 100) : null;
  const risks = [
    ...(summary?.actionCenter || []).filter((item) => item.value !== 0),
    ...(extras.weakReviews
      ? [
          {
            key: 'weak',
            label: 'تقييمات محادثات أقل من 70%',
            value: extras.weakReviews,
            recommendation: 'راجع التسجيلات وحدد الاحتياج التدريبي',
            route: '/reviews',
            severity: 'danger' as const,
          },
        ]
      : []),
    ...(extras.shortages
      ? [
          {
            key: 'shortages',
            label: 'نواقص تحتاج مراجعة',
            value: extras.shortages,
            recommendation: 'راجع النواقص المفتوحة مع الفرع',
            route: '/shortages',
            severity: 'warning' as const,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Dawaa Command Center"
        title="مركز القيادة اليومي"
        description="صورة تشغيلية موحدة لليوم: المبيعات، المخاطر، والقرارات التي تحتاج تدخلًا."
      />
      <div className="flex justify-end">
        <button
          onClick={() => void load()}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw size={16} /> تحديث
        </button>
      </div>
      <SectionState loading={loading} error={error} empty={!summary}>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={TrendingUp}
            label="مبيعات اليوم"
            value={sales === null ? 'غير متاح' : `${sales.toLocaleString('ar-EG')} ج`}
          />
          <MetricCard icon={Receipt} label="عدد الفواتير" value={k?.invoicesCount ?? 'غير متاح'} />
          <MetricCard
            icon={Wallet}
            label="متوسط الفاتورة"
            value={
              k?.avgInvoice === null || k?.avgInvoice === undefined
                ? 'غير متاح'
                : `${Math.round(k.avgInvoice).toLocaleString('ar-EG')} ج`
            }
          />
          <MetricCard
            icon={Target}
            label="تحقيق هدف اليوم"
            value={achievement === null ? 'الهدف غير متاح' : `${achievement}%`}
            hint={
              target
                ? `المتبقي ${Math.max(0, target - (sales || 0)).toLocaleString('ar-EG')} ج`
                : undefined
            }
            tone={
              achievement === null
                ? 'teal'
                : achievement < 40
                  ? 'red'
                  : achievement < 80
                    ? 'amber'
                    : 'green'
            }
          />
          <MetricCard
            icon={CheckCircle2}
            label="المتابعات المتأخرة"
            value={
              k?.overdueFollowups ?? customerIntelligence?.overdueFollowups ?? 'غير متاح'
            }
          />
          <MetricCard icon={FileText} label="الشكاوى المفتوحة" value={extras.complaints} />
          <MetricCard
            icon={AlertTriangle}
            label="التقييمات الضعيفة"
            value={extras.weakReviews}
            tone={extras.weakReviews ? 'red' : 'green'}
          />
          <MetricCard
            icon={AlertTriangle}
            label="النواقص والتنبيهات"
            value={extras.shortages + safeNumber(normalizedKpis?.urgentNotifications?.value)}
            tone="amber"
          />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="dawaa-panel">
            <h2 className="mb-4 text-lg font-black text-slate-950 dark:text-white">إشارات الخطر</h2>
            <div className="space-y-3">
              {risks.length ? (
                risks.slice(0, 10).map((item) => (
                  <a
                    key={item.key}
                    href={item.route}
                    className="block rounded-2xl border border-red-200/40 bg-red-500/5 p-4"
                  >
                    <div className="flex justify-between gap-3 font-black text-slate-950 dark:text-white">
                      <span>{item.label}</span>
                      <span>{item.value ?? '—'}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{item.recommendation}</p>
                  </a>
                ))
              ) : (
                <p className="text-sm font-bold text-slate-500">لا توجد إشارات خطر مسجلة حاليًا</p>
              )}
            </div>
          </div>
          <div className="dawaa-panel">
            <h2 className="mb-4 text-lg font-black text-slate-950 dark:text-white">
              قرارات مطلوبة
            </h2>
            <div className="space-y-3">
              {[
                ['نقاط وخصومات تحتاج اعتماد', extras.pendingApprovals, '/penalty-incentive'],
                ['طلبات إجازة معلقة', extras.leaveRequests, '/time-off'],
                ['مشاكل بيانات تحتاج إصلاح', dataHealth?.error ? 1 : 0, '/data-health'],
                ['تقييمات تحتاج مراجعة', extras.weakReviews, '/reviews'],
              ].map(([label, value, route]) => (
                <a
                  key={String(label)}
                  href={String(route)}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 p-4 font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  <span>{label}</span>
                  <span className="badge-warning">{String(value)}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </SectionState>
    </div>
  );
}
