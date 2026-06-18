import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Headphones,
  PackageSearch,
  Star,
  Truck,
  Users,
} from 'lucide-react';
import {
  fetchCurrentShiftPresence,
  type CurrentShiftPresence,
} from '@/lib/attendance/currentShiftPresenceService';
import { safeRows, isOpenStatus, rowDate, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';

type Row = Record<string, unknown>;
type BriefData = {
  presence: CurrentShiftPresence;
  followups: Row[];
  complaints: Row[];
  orders: Row[];
  reviews: Row[];
  notes: Row[];
  shortages: Row[];
  activity: Row[];
};
const emptyPresence: CurrentShiftPresence = {
  doctors: [],
  assistants: [],
  delivery: [],
  total: 0,
  loadedAt: new Date(),
};

export default function TodayBrief() {
  const [data, setData] = useState<BriefData>({
    presence: emptyPresence,
    followups: [],
    complaints: [],
    orders: [],
    reviews: [],
    notes: [],
    shortages: [],
    activity: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [presence, followups, complaints, orders, reviews, notes, shortages, activity] =
          await Promise.all([
            fetchCurrentShiftPresence(),
            safeRows<Row>('daily_followups', (q) => q.limit(200)),
            safeRows<Row>('customer_requests', (q) => q.limit(200)),
            safeRows<Row>('delivery_orders', (q) => q.limit(200)),
            safeRows<Row>('conversation_sales_reviews', (q) => q.limit(100)),
            safeRows<Row>('shift_notes', (q) => q.limit(100)),
            safeRows<Row>('shortages', (q) => q.limit(100)),
            safeRows<Row>(
              'activity_log',
              (q) => q.order('created_at', { ascending: false }).limit(12),
              12
            ),
          ]);
        if (active)
          setData({
            presence,
            followups: followups.rows.filter((r) => isOpenStatus(r.status ?? r.followup_status)),
            complaints: complaints.rows.filter((r) => isOpenStatus(r.status)),
            orders: orders.rows.filter((r) => isOpenStatus(r.status)),
            reviews: reviews.rows.filter(
              (r) =>
                rowDate(r, ['created_at', 'review_date']) === new Date().toISOString().slice(0, 10)
            ),
            notes: notes.rows,
            shortages: shortages.rows.filter((r) => isOpenStatus(r.status)),
            activity: activity.rows,
          });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل ملخص اليوم');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Supervisor Brief"
        title="اليوم في لمحة"
        description="كل ما يحتاجه المشرف أو مدير الفرع في شاشة تشغيلية واحدة."
      />
      <SectionState loading={loading} error={error} empty={false}>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Users}
            label="الموجودون في الشيفت"
            value={data.presence.total}
            hint={`${data.presence.doctors.length} دكاترة`}
          />
          <MetricCard icon={Truck} label="الدليفري الموجود" value={data.presence.delivery.length} />
          <MetricCard icon={Headphones} label="المتابعات المعلقة" value={data.followups.length} />
          <MetricCard
            icon={AlertTriangle}
            label="الشكاوى المفتوحة"
            value={data.complaints.length}
            tone={data.complaints.length ? 'red' : 'green'}
          />
          <MetricCard icon={Truck} label="الأوردرات المعلقة" value={data.orders.length} />
          <MetricCard icon={Star} label="تقييمات اليوم" value={data.reviews.length} />
          <MetricCard icon={ClipboardList} label="ملاحظات الشيفت" value={data.notes.length} />
          <MetricCard
            icon={PackageSearch}
            label="النواقص المهمة"
            value={data.shortages.length}
            tone="amber"
          />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="dawaa-panel">
            <h2 className="mb-4 text-lg font-black text-slate-950 dark:text-white">
              الفريق الموجود الآن
            </h2>
            <div className="space-y-2">
              {[
                ...data.presence.doctors,
                ...data.presence.assistants,
                ...data.presence.delivery,
              ].map((person) => (
                <div
                  key={`${person.id}-${person.name}`}
                  className="flex justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                >
                  <span className="font-bold">{person.name}</span>
                  <span className="text-xs text-slate-500">
                    {person.role} · {person.attendance_status}
                  </span>
                </div>
              ))}
              {!data.presence.total && (
                <p className="text-sm text-slate-500">لا توجد بيانات حضور كافية حاليًا</p>
              )}
            </div>
          </div>
          <div className="dawaa-panel">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-950 dark:text-white">
              <Activity size={20} /> آخر أنشطة النظام
            </h2>
            <div className="space-y-2">
              {data.activity.map((row, index) => (
                <div
                  key={safeText(row.id, String(index))}
                  className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="font-bold">{safeText(row.action ?? row.operation, 'عملية')}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {safeText(row.user_name, 'النظام')} ·{' '}
                    {safeText(row.branch ?? row.branch_name, 'غير محدد')}
                  </div>
                </div>
              ))}
              {!data.activity.length && (
                <p className="text-sm text-slate-500">لا توجد بيانات كافية لهذا القسم حاليًا</p>
              )}
            </div>
          </div>
        </section>
      </SectionState>
    </div>
  );
}
