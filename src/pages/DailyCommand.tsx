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

function safeString(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}
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
      let result: DashboardSummary | null = null;
      try {
        result = await fetchExecutiveDashboardSummary({
          startDate: date,
          endDate: date,
          branch: user?.branch || 'all',
        });
      } catch (summaryErr) {
        // If fetchExecutiveDashboardSummary throws, catch it and use empty summary
        console.error('[DailyCommand] Dashboard summary fetch error:', summaryErr);
        const errorMsg = summaryErr instanceof Error ? summaryErr.message : 'خطأ في تحميل البيانات';
        result = {
          kpis: null,
          dailySales: [],
          staffSales: [],
          deliveryPerformance: [],
          followupPerformance: [],
          notifications: [],
          activity: [],
          customerIntelligence: {
            importantNeedFollowup: null,
            stoppedCustomers: null,
            atRiskCustomers: null,
            customersWithoutValidPhone: null,
            incompleteCustomers: null,
            unlinkedCustomers: null,
            dueTodayFollowups: null,
            overdueFollowups: null,
            needsManagerFollowups: null,
            error: errorMsg,
          },
          normalizedKpis: {
            netSales: { value: null, status: 'error', source: 'error', message: errorMsg, error: errorMsg },
            invoicesCount: { value: null, status: 'error', source: 'error', message: errorMsg, error: errorMsg },
            avgInvoice: { value: null, status: 'error', source: 'error', message: errorMsg, error: errorMsg },
            uniqueCustomers: { value: null, status: 'error', source: 'error', message: errorMsg, error: errorMsg },
            overdueFollowups: { value: null, status: 'error', source: 'error', message: errorMsg, error: errorMsg },
            urgentNotifications: { value: null, status: 'error', source: 'error', message: errorMsg, error: errorMsg },
          },
          actionCenter: [],
          dataHealth: { invoicesWithoutCustomerCode: null, invoicesWithoutCustomerPhone: null, invoicesWithoutSellerName: null, invoicesWithoutBranch: null, lastInvoiceDate: null, latestImportBatch: null, error: errorMsg },
          sourceHealth: { rpcAvailable: false, salesSummaryAvailable: false, staffSummaryAvailable: false, deliverySummaryAvailable: false, followupSummaryAvailable: false, customerSummaryAvailable: false, notificationsAvailable: false, activityLogAvailable: false },
          errors: [{ source: 'dashboard_summary', message: errorMsg }],
        };
      }
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
      console.error('[DailyCommand] Error during load:', err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل مركز القيادة');
    } finally {
      setLoading(false);
    }
  }, [user?.branch]);

  useEffect(() => {
    void load();
  }, [load]);
  
  // Defensive guards for all data access
  const k = summary?.kpis ?? null;
  const normalizedKpis = (summary?.normalizedKpis ?? {}) as Partial<typeof summary.normalizedKpis>;
  const customerIntelligence = summary?.customerIntelligence ?? null;
  const dataHealth = summary?.dataHealth ?? null;
  const sales = typeof k?.netSales === 'number' ? k.netSales : null;
  const target = useMemo(
    () =>
      (summary?.dailySales?.length ? 
        summary.dailySales.reduce(
          (sum, row) => sum + safeNumber((row as unknown as Row).target_amount),
          0
        )
      : null) || null,
    [summary?.dailySales]
  );
  const achievement = target && sales !== null ? Math.round((sales / target) * 100) : null;
  const urgentNotifications = safeNumber(normalizedKpis?.urgentNotifications?.value);
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
            value={sales === null ? 'غير متاح' : String(sales)}
                    // sales is guaranteed to be number|null
          />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Risks section temporarily disabled for debugging */}
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
