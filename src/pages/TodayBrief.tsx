import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { safeNumber } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';

type TodaySummary = {
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
};

function normalizeBranch(branch?: string | null) {
  const value = String(branch || '').trim();
  return !value || value === 'الكل' || value === 'كل الفروع' ? 'all' : value;
}

export default function TodayBrief() {
  const { user } = useAuth();
  const [data, setData] = useState<TodaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: rpcError } = await supabase.rpc('get_today_command_summary', {
        p_branch: normalizeBranch(user?.branch),
      });

      if (requestId !== requestIdRef.current) return;
      if (rpcError) throw rpcError;
      if (!result || typeof result !== 'object') {
        throw new Error('ملخص اليوم لم يرجع بيانات صالحة.');
      }

      setData(result as TodaySummary);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setData(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذر تحميل ملخص اليوم من المصدر الموحّد.'
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [user?.branch]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  if (!data && loading) return <SectionState state="loading" />;
  if (error) return <SectionState state="error" message={error} />;
  if (!data) return <SectionState state="empty" message="لا توجد بيانات متاحة لملخص اليوم." />;

  const loadedAt = new Date(data.loaded_at);
  const loadedTime = Number.isNaN(loadedAt.getTime())
    ? 'غير محدد'
    : loadedAt.toLocaleTimeString('ar-EG');

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <CommandHeader title="ملخص اليوم" subtitle={`آخر تحديث: ${loadedTime}`} />
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl p-2 transition hover:bg-slate-700/50"
          title="تحديث البيانات"
          disabled={loading}
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-teal-400">المبيعات</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="إجمالي اليوم"
            value={`${safeNumber(data.sales_today).toLocaleString('ar-EG')} ج.م`}
            icon={<Activity size={18} />}
            tone="teal"
          />
          <MetricCard
            label="عدد الفواتير"
            value={data.invoices_count}
            icon={<ClipboardList size={18} />}
            tone="sky"
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-purple-400">خدمة العملاء</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="متابعات مفتوحة"
            value={data.open_followups}
            icon={<Headphones size={18} />}
            tone={data.open_followups > 10 ? 'rose' : 'emerald'}
          />
          <MetricCard
            label="شكاوى مفتوحة"
            value={data.open_complaints}
            icon={<AlertTriangle size={18} />}
            tone={data.open_complaints > 0 ? 'rose' : 'emerald'}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-blue-400">الفريق</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="حاضرون الآن"
            value={data.staff_present}
            icon={<Users size={18} />}
            tone="emerald"
          />
          <MetricCard
            label="طلبات إجازة"
            value={data.pending_leaves}
            icon={<ClipboardList size={18} />}
            tone={data.pending_leaves > 0 ? 'amber' : 'emerald'}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-amber-400">التشغيل</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="نواقص مفتوحة"
            value={data.open_shortages}
            icon={<PackageSearch size={18} />}
            tone={data.open_shortages > 5 ? 'rose' : 'amber'}
          />
          <MetricCard
            label="طلبات دليفري"
            value={data.pending_delivery}
            icon={<Truck size={18} />}
            tone={data.pending_delivery > 0 ? 'sky' : 'emerald'}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-red-400">الجودة</h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="تقييمات منخفضة اليوم"
            value={data.weak_reviews}
            icon={<Star size={18} />}
            tone={data.weak_reviews > 5 ? 'rose' : 'amber'}
          />
          <MetricCard
            label="إجازات بتاريخ اليوم"
            value={data.staff_leaves}
            icon={<Users size={18} />}
            tone={data.staff_leaves > 0 ? 'amber' : 'emerald'}
          />
        </div>
      </section>

      <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
        📡 جميع المقاييس تأتي من ملخص Supabase الموحّد؛ لا توجد قراءة احتياطية جزئية من الجداول الخام.
      </div>
    </div>
  );
}
