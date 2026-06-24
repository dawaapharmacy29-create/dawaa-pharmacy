import { useAuth } from '@/hooks/useAuth';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Headphones,
  PackageSearch,
  RefreshCw,
  Star,
  Truck,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isOpenStatus, rowDate, safeNumber, safeRows, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';

interface TodaySummary {
  sales_today: number;
  invoices_count: number;
  open_followups: number;
  open_complaints: number;
  staff_present: number;
  pending_leaves: number;
  open_shortages: number;
  pending_delivery: number;
  weak_reviews: number;
  staff_leaves: number;
  loaded_at: string;
}

export default function TodayBrief() {
  const { user } = useAuth();
  const [data, setData] = useState<TodaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarning, setSourceWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSourceWarning(null);
    try {
      const { data: result, error: err } = await supabase.rpc('get_today_command_summary', {
        p_branch: user?.branch || 'all',
      });

      if (err) throw err;
      setData(result as TodaySummary);
    } catch (e) {
      try {
        const fallback = await buildFallbackSummary(user?.branch || 'all');
        setData(fallback);
        setSourceWarning(
          `تعذر استخدام دالة ملخص اليوم السريعة؛ تم عرض قراءة آمنة من الجداول المتاحة. السبب: ${
            e instanceof Error ? e.message : 'مصدر البيانات غير متاح'
          }`
        );
      } catch (fallbackError) {
        setError(
          fallbackError instanceof Error
            ? fallbackError.message
            : 'تعذر تحميل ملخص اليوم من المصادر المتاحة'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [user?.branch]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data && loading) return <SectionState state="loading" />;
  if (error) return <SectionState state="error" message={error} />;
  if (!data) return null;

  const d = data;
  const salesFormatted = safeNumber(d.sales_today).toLocaleString('ar-EG');
  const loadedAt = new Date(d.loaded_at);
  const loadedTime = Number.isNaN(loadedAt.getTime())
    ? 'غير محدد'
    : loadedAt.toLocaleTimeString('ar-EG');

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex items-center justify-between">
        <CommandHeader
          title="ملخص اليوم"
          subtitle={`آخر تحديث: ${loadedTime}`}
        />
        <button
          onClick={() => void load()}
          className="rounded-xl p-2 hover:bg-slate-700/50 transition"
          title="تحديث البيانات"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {sourceWarning && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs font-bold leading-6 text-amber-100">
          {sourceWarning}
        </div>
      )}

      {/* المبيعات */}
      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-teal-400">المبيعات</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="إجمالي اليوم"
            value={`${salesFormatted} ج.م`}
            icon={<Activity size={18} />}
            tone="teal"
          />
          <MetricCard
            label="عدد الفواتير"
            value={d.invoices_count}
            icon={<ClipboardList size={18} />}
            tone="sky"
          />
        </div>
      </section>

      {/* خدمة العملاء */}
      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-purple-400">
          خدمة العملاء
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="متابعات مفتوحة"
            value={d.open_followups}
            icon={<Headphones size={18} />}
            tone={d.open_followups > 10 ? 'rose' : 'emerald'}
          />
          <MetricCard
            label="شكاوى مفتوحة"
            value={d.open_complaints}
            icon={<AlertTriangle size={18} />}
            tone={d.open_complaints > 0 ? 'rose' : 'emerald'}
          />
        </div>
      </section>

      {/* الفريق */}
      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-blue-400">الفريق</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="حاضرون الآن"
            value={d.staff_present}
            icon={<Users size={18} />}
            tone="emerald"
          />
          <MetricCard
            label="طلبات إجازة"
            value={d.pending_leaves}
            icon={<ClipboardList size={18} />}
            tone={d.pending_leaves > 0 ? 'amber' : 'emerald'}
          />
        </div>
      </section>

      {/* التشغيل */}
      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-amber-400">التشغيل</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="نواقص مفتوحة"
            value={d.open_shortages}
            icon={<PackageSearch size={18} />}
            tone={d.open_shortages > 5 ? 'rose' : 'amber'}
          />
          <MetricCard
            label="طلبات دليفري"
            value={d.pending_delivery}
            icon={<Truck size={18} />}
            tone={d.pending_delivery > 0 ? 'sky' : 'emerald'}
          />
        </div>
      </section>

      {/* جودة البيانات */}
      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-red-400">جودة البيانات</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="تقييمات منخفضة اليوم"
            value={d.weak_reviews}
            icon={<Star size={18} />}
            tone={d.weak_reviews > 5 ? 'rose' : 'amber'}
          />
          <MetricCard
            label="إجازات بتاريخ اليوم"
            value={d.staff_leaves}
            icon={<Users size={18} />}
            tone={d.staff_leaves > 0 ? 'amber' : 'emerald'}
          />
        </div>
      </section>

      {/* ملاحظة */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
        📡 جميع المقاييس محسوبة من Supabase في الوقت الفعلي عبر دالة واحدة محسّنة.
      </div>
    </div>
  );
}

type SafeRow = Record<string, unknown>;

const todayIso = () => new Date().toISOString().slice(0, 10);

function matchesBranch(row: SafeRow, branch: string) {
  if (!branch || branch === 'all' || branch === 'الكل') return true;
  const rowBranch = safeText(row.branch ?? row.branch_name ?? row.store_branch);
  return !rowBranch || rowBranch === branch;
}

function rowIsToday(row: SafeRow, keys: string[]) {
  return rowDate(row, keys) === todayIso();
}

async function buildFallbackSummary(branch: string): Promise<TodaySummary> {
  const [invoices, followups, requests, attendance, leaves, shortages, delivery, reviews] =
    await Promise.all([
      safeRows<SafeRow>('sales_invoices', undefined, 300),
      safeRows<SafeRow>('followups', undefined, 300),
      safeRows<SafeRow>('customer_requests', undefined, 300),
      safeRows<SafeRow>('attendance_records', undefined, 300),
      safeRows<SafeRow>('time_off_requests', undefined, 300),
      safeRows<SafeRow>('shortages', undefined, 300),
      safeRows<SafeRow>('delivery_orders', undefined, 300),
      safeRows<SafeRow>('conversation_sales_reviews', undefined, 300),
    ]);

  const todayInvoices = invoices.rows.filter(
    (row) =>
      matchesBranch(row, branch) &&
      rowIsToday(row, ['invoice_date', 'sale_date', 'created_at', 'date'])
  );
  const todayReviews = reviews.rows.filter((row) =>
    rowIsToday(row, ['review_date', 'created_at', 'date'])
  );

  return {
    sales_today: todayInvoices.reduce(
      (sum, row) => sum + safeNumber(row.net_total ?? row.total_amount ?? row.amount ?? row.total),
      0
    ),
    invoices_count: todayInvoices.length,
    open_followups: followups.rows.filter(
      (row) => matchesBranch(row, branch) && isOpenStatus(row.followup_status ?? row.status)
    ).length,
    open_complaints: requests.rows.filter(
      (row) =>
        matchesBranch(row, branch) &&
        isOpenStatus(row.status) &&
        /complaint|شكوى/i.test(safeText(row.type ?? row.request_type))
    ).length,
    staff_present: attendance.rows.filter(
      (row) =>
        matchesBranch(row, branch) &&
        rowIsToday(row, ['attendance_date', 'date', 'created_at']) &&
        /present|حاضر/i.test(safeText(row.status ?? row.attendance_status))
    ).length,
    pending_leaves: leaves.rows.filter((row) =>
      /pending|معلق|بانتظار/i.test(safeText(row.status))
    ).length,
    open_shortages: shortages.rows.filter(
      (row) => matchesBranch(row, branch) && isOpenStatus(row.status)
    ).length,
    pending_delivery: delivery.rows.filter(
      (row) => matchesBranch(row, branch) && isOpenStatus(row.status)
    ).length,
    weak_reviews: todayReviews.filter((row) => {
      const score = safeNumber(row.final_score ?? row.score ?? row.percentage);
      return score > 0 && score < 70;
    }).length,
    staff_leaves: leaves.rows.filter((row) =>
      rowIsToday(row, ['date', 'date_start', 'created_at'])
    ).length,
    loaded_at: new Date().toISOString(),
  };
}
