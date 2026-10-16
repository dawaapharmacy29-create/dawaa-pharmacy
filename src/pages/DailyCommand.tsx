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
import { supabase } from '@/lib/supabase';
import {
  fetchExecutiveDashboardSummary,
  type DashboardSummary,
} from '@/lib/dashboardSummaryService';
import { safeNumber } from '@/lib/safeSupabase';
import { listStaffTimeOffRequests } from '@/lib/timeOffService';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { countPendingEmployeeTransactionsForCycle } from '@/services/employeeTransactionService';

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

type TeamAlphaRow = {
  staff_id: string; staff_name: string; track: string; track_label: string; branch: string;
  checklist_total: number; checklist_completed: number; checklist_completion_pct: number;
  points_this_week: number; track_avg_points: number; performance_index: number | null;
};
type AtRiskCompletionRow = { branch: string; at_risk_total: number; at_risk_handled: number };
type BranchOfferRow = { offer_title: string; offer_details: string | null; ends_on: string };

export default function DailyCommand() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [teamAlpha, setTeamAlpha] = useState<TeamAlphaRow[]>([]);
  const [atRiskStatus, setAtRiskStatus] = useState<AtRiskCompletionRow[]>([]);
  const [branchOffers, setBranchOffers] = useState<Record<string, BranchOfferRow | null>>({});
  const [teamAlphaError, setTeamAlphaError] = useState<string | null>(null);
  const [atRiskError, setAtRiskError] = useState<string | null>(null);
  const [extras, setExtras] = useState<{ weakReviews: number | null; pendingApprovals: number | null; leaveRequests: number | null }>({
    weakReviews: null,
    pendingApprovals: null,
    leaveRequests: null,
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
          // This page renders sales and invoice data health only, not the ~10 s customer cards.
          includeCustomerIntelligence: false,
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
      // Decision counts come from their canonical sources as exact server-side counts; a failed read is shown
      // as unavailable (null), never as 0. (The old first-200-rows scans counted the wrong rows and read
      // tables that do not exist: shortages, time_off_requests.)
      const cycle = getCurrentCycle();
      const [pointsResult, reviewsResult, leavesResult] = await Promise.allSettled([
        countPendingEmployeeTransactionsForCycle(cycle.start.toISOString().slice(0, 10), cycle.end.toISOString().slice(0, 10)),
        supabase
          .from('conversation_sales_reviews')
          .select('id', { count: 'exact', head: true })
          .eq('is_current', true)
          .or('final_score.lt.70,and(final_score.is.null,total_score.lt.70)'),
        listStaffTimeOffRequests({ status: 'pending', limit: 200 }),
      ]);
      const exactCount = (settled: PromiseSettledResult<{ count: number | null; error: unknown }>) =>
        settled.status === 'fulfilled' && !settled.value.error && typeof settled.value.count === 'number'
          ? settled.value.count
          : null;
      setExtras({
        pendingApprovals: pointsResult.status === 'fulfilled' ? pointsResult.value : null,
        weakReviews: exactCount(reviewsResult),
        leaveRequests: leavesResult.status === 'fulfilled' ? leavesResult.value.length : null,
      });

      const [teamAlphaRes, atRiskRes, shokryOfferRes, shamiOfferRes] = await Promise.all([
        supabase.rpc('dawaa_team_alpha_scoreboard_v1'),
        supabase.rpc('get_customer_service_at_risk_completion_v1', { p_actor_id: user?.id }),
        supabase.rpc('get_current_branch_offer_v1', { p_branch: 'فرع شكري' }),
        supabase.rpc('get_current_branch_offer_v1', { p_branch: 'فرع الشامي' }),
      ]);
      setTeamAlphaError(teamAlphaRes.error ? teamAlphaRes.error.message : null);
      setTeamAlpha(teamAlphaRes.error ? [] : (teamAlphaRes.data || []) as TeamAlphaRow[]);
      setAtRiskError(atRiskRes.error ? atRiskRes.error.message : null);
      setAtRiskStatus(atRiskRes.error ? [] : (atRiskRes.data || []) as AtRiskCompletionRow[]);
      setBranchOffers({
        'فرع شكري': (Array.isArray(shokryOfferRes.data) ? shokryOfferRes.data[0] : null) as BranchOfferRow | null,
        'فرع الشامي': (Array.isArray(shamiOfferRes.data) ? shamiOfferRes.data[0] : null) as BranchOfferRow | null,
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
  // Number of invoice data-health categories with open issues; unknown when the summary failed.
  const dataIssueCount = !dataHealth || dataHealth.error
    ? null
    : [
        dataHealth.invoicesWithoutCustomerCode,
        dataHealth.invoicesWithoutCustomerPhone,
        dataHealth.invoicesWithoutSellerName,
        dataHealth.invoicesWithoutBranch,
      ].filter((value) => typeof value === 'number' && value > 0).length;
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
              {([
                ['نقاط وخصومات تحتاج اعتماد', extras.pendingApprovals, '/penalty-incentive'],
                ['طلبات إجازة معلقة', extras.leaveRequests, '/time-off'],
                ['مشاكل بيانات تحتاج إصلاح', dataIssueCount, '/data-health'],
                ['تقييمات تحتاج مراجعة', extras.weakReviews, '/reviews'],
              ] as Array<[string, number | null, string]>).map(([label, value, route]) => (
                <a
                  key={String(label)}
                  href={String(route)}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 p-4 font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  <span>{label}</span>
                  <span className="badge-warning">{value === null ? 'غير متاح' : String(value)}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="dawaa-panel">
          <h2 className="mb-4 text-lg font-black text-slate-950 dark:text-white">
            فريق دواء ألفا — المسار الأسبوعي
          </h2>
          <div className="space-y-2">
            {teamAlpha.map((row) => (
              <div key={row.staff_id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <p className="font-black text-slate-800 dark:text-slate-100">{row.staff_name}</p>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{row.track_label}</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-black text-slate-700 dark:text-slate-200">
                  <span>تشيك ليست: {row.checklist_completed}/{row.checklist_total} ({row.checklist_completion_pct}%)</span>
                  <span>نقاط الأسبوع: {row.points_this_week}</span>
                  <span>{row.performance_index == null ? 'لسه مفيش مقارنة' : `${row.performance_index}% من متوسط المسار`}</span>
                </div>
              </div>
            ))}
            {teamAlphaError ? <p role="alert" className="text-sm font-bold text-red-500">تعذر تحميل بيانات الفريق: {teamAlphaError}</p> : null}
            {!teamAlphaError && !loading && !teamAlpha.length ? <p className="text-sm font-bold text-slate-500">لا توجد بيانات للفريق هذا الأسبوع.</p> : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {['فرع شكري', 'فرع الشامي'].map((branch) => {
              const risk = atRiskStatus.find((r) => r.branch === branch);
              const offer = branchOffers[branch];
              return (
                <div key={branch} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="font-black text-slate-800 dark:text-slate-100">{branch}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    عملاء معرّضين للخطر اتعمل معاهم متابعة: {atRiskError ? 'غير متاح' : risk ? `${risk.at_risk_handled}/${risk.at_risk_total}` : '0/0'}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    عرض الأسبوع: {offer ? `${offer.offer_title} (حتى ${offer.ends_on})` : 'مفيش عرض مسجل'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </SectionState>
    </div>
  );
}
