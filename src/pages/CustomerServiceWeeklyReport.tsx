import { useEffect, useMemo, useState } from 'react';
import { HeartHandshake, TrendingUp, TrendingDown, Save, Users, Star } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useAuth } from '@/hooks/useAuth';
import { isManagerRole } from '@/lib/security/userDataScope';
import { BRANCHES } from '@/lib/constants';

type WeeklyMetrics = {
  weekStart: string;
  weekEnd: string;
  activeCustomers: number;
  vipCustomersTotal: number;
  vipCustomersFollowedThisWeek: number;
  vipRetainedActive: number;
  vipLost: number;
  vipRetentionRate: number | null;
  thisWeekFollowupsCompleted: number;
  thisWeekFollowupsTotal: number;
  thisWeekCompletionRate: number | null;
  prevWeekCompletionRate: number | null;
  weekOverWeekCompletionDelta: number | null;
  thisWeekAvgConversationImpact: number;
  prevWeekAvgConversationImpact: number;
  weekOverWeekConversationDelta: number;
};

function mondayOf(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // برجع لأقرب يوم اتنين
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function DeltaBadge({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value === null || Number.isNaN(value)) return <span className="text-xs text-slate-500">—</span>;
  const positive = value >= 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-black ${positive ? 'text-emerald-300' : 'text-red-300'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}

export default function CustomerServiceWeeklyReport() {
  const { user } = useAuth();
  const managerView = isManagerRole(user);
  const [branch, setBranch] = useState(user?.branch || BRANCHES[0] || '');
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [metrics, setMetrics] = useState<WeeklyMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualNotes, setManualNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    if (!branch || !weekStart) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: metricsData, error: metricsError } = await supabase.rpc(
        'get_customer_service_weekly_metrics',
        { p_branch: branch, p_week_start: weekStart }
      );
      const { data: existing } = await supabase
        .from(TABLES.customerServiceWeeklyReports)
        .select('id, manual_notes')
        .eq('branch', branch)
        .eq('week_start', weekStart)
        .maybeSingle();
      if (cancelled) return;
      if (metricsError) {
        toast.error('تعذر تحميل مؤشرات الأسبوع');
      } else {
        setMetrics(metricsData as WeeklyMetrics);
      }
      setExistingId(existing?.id || null);
      setManualNotes(existing?.manual_notes || '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [branch, weekStart]);

  const save = async () => {
    if (!metrics) return;
    setSaving(true);
    try {
      const payload = {
        branch,
        week_start: weekStart,
        week_end: metrics.weekEnd,
        auto_metrics: metrics,
        manual_notes: manualNotes.trim() || null,
        evaluated_by_staff_id: user?.staffId || user?.id || null,
        evaluated_by_name: user?.name || null,
        status: 'submitted',
        updated_at: new Date().toISOString(),
      };
      const { error } = existingId
        ? await supabase.from('customer_service_weekly_reports').update(payload).eq('id', existingId)
        : await supabase.from('customer_service_weekly_reports').insert(payload);
      if (error) throw new Error(error.message);
      toast.success('تم حفظ تقرير الأسبوع');
    } catch (err) {
      toast.error(`تعذر الحفظ: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!managerView) {
    return <div dir="rtl" className="p-6 text-sm text-slate-400">هذه الصفحة متاحة للإدارة فقط.</div>;
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <HeartHandshake className="h-6 w-6 text-rose-300" />
        <div>
          <h1 className="text-xl font-black text-white">تقرير خدمة العملاء الأسبوعي</h1>
          <p className="text-sm text-slate-400">أداء التواصل مع العملاء والحفاظ على كبار العملاء، أسبوع بأسبوع.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input-dark" value={branch} onChange={(e) => setBranch(e.target.value)}>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <input type="date" className="input-dark" value={weekStart} onChange={(e) => setWeekStart(mondayOf(new Date(e.target.value)))} />
      </div>

      {loading && <p className="text-sm text-slate-400">جارٍ التحميل...</p>}

      {metrics && !loading && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="stat-card">
              <div className="flex items-center gap-2 text-slate-400"><Users className="h-4 w-4" /> عملاء نشطون بالفرع</div>
              <div className="mt-2 text-3xl font-black text-white">{metrics.activeCustomers}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-slate-400"><Star className="h-4 w-4" /> كبار العملاء (مهم/مهم جدًا)</div>
              <div className="mt-2 text-3xl font-black text-white">{metrics.vipCustomersTotal}</div>
              <div className="mt-1 text-xs text-slate-500">اتعمل متابعة فعلية لـ {metrics.vipCustomersFollowedThisWeek} منهم الأسبوع ده</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-slate-400">نسبة الحفاظ على كبار العملاء</div>
              <div className="mt-2 text-3xl font-black text-emerald-300">{metrics.vipRetentionRate ?? '—'}%</div>
              <div className="mt-1 text-xs text-slate-500">{metrics.vipRetainedActive} فاضل نشط، {metrics.vipLost} اتوقف</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="stat-card space-y-2">
              <div className="font-black text-white">إنجاز المتابعات — مقارنة بالأسبوع اللي فات</div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">هذا الأسبوع</span>
                <span className="font-bold text-white">{metrics.thisWeekFollowupsCompleted} / {metrics.thisWeekFollowupsTotal} ({metrics.thisWeekCompletionRate ?? 0}%)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">الأسبوع السابق</span>
                <span className="text-slate-300">{metrics.prevWeekCompletionRate ?? 0}%</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="text-sm text-slate-400">التغيّر</span>
                <DeltaBadge value={metrics.weekOverWeekCompletionDelta} />
              </div>
            </div>
            <div className="stat-card space-y-2">
              <div className="font-black text-white">تأثير جودة المحادثات على نقاط الدكاترة</div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">هذا الأسبوع</span>
                <span className="font-bold text-white">{metrics.thisWeekAvgConversationImpact}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">الأسبوع السابق</span>
                <span className="text-slate-300">{metrics.prevWeekAvgConversationImpact}</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="text-sm text-slate-400">التغيّر</span>
                <DeltaBadge value={metrics.weekOverWeekConversationDelta} suffix=" نقطة" />
              </div>
            </div>
          </div>

          <div className="stat-card space-y-3">
            <div className="font-black text-white">تقييم مدير الفروع النصي</div>
            <textarea
              className="input-dark w-full min-h-[110px]"
              placeholder="اكتب ملاحظاتك على أداء مسئول خدمة العملاء هذا الأسبوع..."
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-rose-500 px-5 py-2 font-black text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> حفظ التقرير
            </button>
          </div>
        </>
      )}
    </div>
  );
}
