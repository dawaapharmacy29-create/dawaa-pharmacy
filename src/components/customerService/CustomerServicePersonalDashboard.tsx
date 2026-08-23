import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Award, Calendar, CheckCircle2, ClipboardList, CreditCard, Gift,
  Heart, MessageCircle, Package, RefreshCw, Sparkles, Star, Trophy, Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';

const QUICK_LINKS = [
  { label: 'متابعة العملاء', icon: ClipboardList, tone: 'followups', path: '/customer-service' },
  { label: 'تقييم المحادثات', icon: Star, tone: 'reviews', path: '/reviews' },
  { label: 'رسائل الترحيب', icon: MessageCircle, tone: 'welcome', path: '/welcome-messages' },
  { label: 'طلبات العملاء', icon: Package, tone: 'requests', path: '/customer-requests' },
  { label: 'نقاط العملاء', icon: Gift, tone: 'points', path: '/customer-points-ledger' },
  { label: 'جدولي', icon: Calendar, tone: 'schedule', path: '/schedule' },
  { label: 'كريدت خدمة العملاء', icon: CreditCard, tone: 'credit', path: '/customer-service-credit' },
  { label: 'تقييمي الشهري', icon: Award, tone: 'evaluation', path: '/staff-monthly-evaluation' },
] as const;

const card = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const softCard = { background: 'var(--dawaa-theme-surface-2)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };
const headingText = { color: 'var(--dawaa-theme-heading)' };

type SourceKey = 'followups' | 'reviews' | 'ops';
type SourceStatus = 'loading' | 'ready' | 'error';
type FollowupBreakdown = {
  total_count: number;
  completed_count: number;
  exceptional_count: number;
  app_assigned_count: number;
  doctor_requested_count: number;
  self_initiated_count: number;
};
type NamedCount = { customer_name?: string; doctor_name?: string; followups_count?: number; requests_count?: number };
type DoctorRating = { doctor_name: string; avg_score: number; review_count: number; total_incentive_impact: number };
type TeamRow = { rep_name: string; review_count: number; avg_score_given: number };
type ShiftRow = { shift_date: string; day_name?: string; shift_name?: string; start_time?: string; end_time?: string };

type PersonalDashboardData = {
  cycle: { start: string; end: string };
  my_followups: FollowupBreakdown;
  top_followed_customers: NamedCount[];
  top_doctor_requesters: NamedCount[];
  my_reviews_this_cycle: { review_count: number; avg_score_given: number | null };
  doctor_ratings: DoctorRating[];
  branch_reviews: { branch_avg_score: number | null; branch_review_count: number };
  branch_sales: { invoices: number; total_sales: number };
  points_summary: { points_earned: number | null; points_redeemed: number | null };
  my_welcome_messages: { sent_count: number; delivered_count: number };
  my_customer_requests: { logged_count: number; open_count: number };
  my_upcoming_shifts: ShiftRow[];
  team_ranking: TeamRow[];
  active_customers: { last_3_months: number; previous_3_months: number; trend: number | null };
  recovery_stats: { total_followups: number; recovered_count: number; recovery_rate: number | null };
};

function emptyData(cycle: { start: string; end: string }): PersonalDashboardData {
  return {
    cycle,
    my_followups: { total_count: 0, completed_count: 0, exceptional_count: 0, app_assigned_count: 0, doctor_requested_count: 0, self_initiated_count: 0 },
    top_followed_customers: [],
    top_doctor_requesters: [],
    my_reviews_this_cycle: { review_count: 0, avg_score_given: null },
    doctor_ratings: [],
    branch_reviews: { branch_avg_score: null, branch_review_count: 0 },
    branch_sales: { invoices: 0, total_sales: 0 },
    points_summary: { points_earned: null, points_redeemed: null },
    my_welcome_messages: { sent_count: 0, delivered_count: 0 },
    my_customer_requests: { logged_count: 0, open_count: 0 },
    my_upcoming_shifts: [],
    team_ranking: [],
    active_customers: { last_3_months: 0, previous_3_months: 0, trend: null },
    recovery_stats: { total_followups: 0, recovered_count: 0, recovery_rate: null },
  };
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => window.clearTimeout(id));
  });
}

function numberText(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('ar-EG');
}

function StatusValue({ status, value }: { status: SourceStatus; value: string | number }) {
  if (status === 'loading') return <span style={mutedText}>…</span>;
  if (status === 'error') return <span className="dawaa-status-text-warning">—</span>;
  return <>{value}</>;
}

function StatCard({ icon: Icon, label, status, value, tone }: { icon: any; label: string; status: SourceStatus; value: string | number; tone: string }) {
  return <div className={`rounded-2xl border p-4 ${status === 'error' ? 'border-dashed' : ''}`} style={card}>
    <div className={`cs-personal-icon cs-personal-icon--${tone}`}><Icon size={18} /></div>
    <div className="mt-3 text-2xl font-black" style={headingText}><StatusValue status={status} value={value} /></div>
    <div className="mt-1 text-xs font-bold" style={mutedText}>{label}</div>
    {status === 'error' ? <div className="dawaa-status-text-warning mt-2 text-[10px] font-bold">تعذر تحميل المصدر — ليست قيمة صفر</div> : null}
  </div>;
}

function Section({ title, icon: Icon, status, children }: { title: string; icon: any; status: SourceStatus; children: React.ReactNode }) {
  const badgeClass = status === 'ready' ? 'dawaa-badge--success' : status === 'loading' ? 'dawaa-badge--info' : 'dawaa-badge--warning';
  return <div className="rounded-3xl border p-5" style={card}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 font-black" style={{ color: 'var(--dawaa-theme-primary)' }}><Icon size={18} />{title}</div>
      <span className={`dawaa-badge ${badgeClass} px-2 py-1 text-[10px] font-black`}>
        {status === 'ready' ? 'محدّث' : status === 'loading' ? 'جاري التحميل' : 'المصدر غير متاح'}
      </span>
    </div>
    {status === 'error' ? <p className="dawaa-status-text-warning mt-3 text-xs font-bold">هذا القسم لم يرجع بيانات مؤكدة؛ لم يتم تحويل الفشل إلى أرقام صفرية.</p> : children}
  </div>;
}

export default function CustomerServicePersonalDashboard({ branch, staffName }: { branch: string; staffName: string }) {
  const navigate = useNavigate();
  const cycle = useMemo(() => getPharmacyCycleRange(new Date()), []);
  const [data, setData] = useState<PersonalDashboardData>(() => emptyData(cycle));
  const [status, setStatus] = useState<Record<SourceKey, SourceStatus>>({ followups: 'loading', reviews: 'loading', ops: 'loading' });
  const [errors, setErrors] = useState<Partial<Record<SourceKey, string>>>({});
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!branch || !staffName) return;
    let cancelled = false;
    const args = { p_branch: branch, p_staff_name: staffName, p_cycle_start: cycle.start, p_cycle_end: cycle.end };
    setStatus({ followups: 'loading', reviews: 'loading', ops: 'loading' });
    setErrors({});

    const loadPart = async (key: SourceKey, rpc: string) => {
      try {
        const result = await withTimeout(supabase.rpc(rpc, args), 25000, rpc) as { data: Record<string, unknown> | null; error: { message?: string } | null };
        if (cancelled) return;
        if (result.error) throw new Error(result.error.message || `${rpc} failed`);
        const part = result.data || {};
        setData((prev) => {
          if (key === 'followups') return {
            ...prev,
            my_followups: (part.my_followups as PersonalDashboardData['my_followups']) || prev.my_followups,
            top_followed_customers: (part.top_followed_customers as NamedCount[]) || [],
            top_doctor_requesters: (part.top_doctor_requesters as NamedCount[]) || [],
          };
          if (key === 'reviews') return {
            ...prev,
            my_reviews_this_cycle: (part.my_reviews_this_cycle as PersonalDashboardData['my_reviews_this_cycle']) || prev.my_reviews_this_cycle,
            doctor_ratings: (part.doctor_ratings as DoctorRating[]) || [],
            branch_reviews: (part.branch_reviews as PersonalDashboardData['branch_reviews']) || prev.branch_reviews,
            team_ranking: (part.team_ranking as TeamRow[]) || [],
            recovery_stats: (part.recovery_stats as PersonalDashboardData['recovery_stats']) || prev.recovery_stats,
          };
          return {
            ...prev,
            branch_sales: (part.branch_sales as PersonalDashboardData['branch_sales']) || prev.branch_sales,
            points_summary: (part.points_summary as PersonalDashboardData['points_summary']) || prev.points_summary,
            my_welcome_messages: (part.my_welcome_messages as PersonalDashboardData['my_welcome_messages']) || prev.my_welcome_messages,
            my_customer_requests: (part.my_customer_requests as PersonalDashboardData['my_customer_requests']) || prev.my_customer_requests,
            my_upcoming_shifts: (part.my_upcoming_shifts as ShiftRow[]) || [],
            active_customers: (part.active_customers as PersonalDashboardData['active_customers']) || prev.active_customers,
          };
        });
        setStatus((prev) => ({ ...prev, [key]: 'ready' }));
      } catch (error) {
        if (cancelled) return;
        console.error(`[CustomerServicePersonalDashboard] ${key} failed`, error);
        setStatus((prev) => ({ ...prev, [key]: 'error' }));
        setErrors((prev) => ({ ...prev, [key]: error instanceof Error ? error.message : String(error) }));
      }
    };

    void loadPart('followups', 'get_cs_dashboard_followups');
    void loadPart('reviews', 'get_cs_dashboard_reviews');
    void loadPart('ops', 'get_cs_dashboard_ops');
    return () => { cancelled = true; };
  }, [branch, staffName, cycle.start, cycle.end, retryKey]);

  const failed = Object.keys(errors) as SourceKey[];
  const loading = Object.values(status).some((value) => value === 'loading');
  const f = data.my_followups;
  const completionRate = f.total_count ? Math.round((f.completed_count / f.total_count) * 100) : 0;
  const myRank = data.team_ranking.findIndex((row) => row.rep_name === staffName);

  return <div className="space-y-4" dir="rtl">
    <div className="cs-personal-hero rounded-3xl border p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2" style={{ color: 'var(--dawaa-theme-primary)' }}><Sparkles size={18} /><span className="text-xs font-black">لوحتك الشخصية</span></div>
          <h2 className="mt-1 text-2xl font-black" style={headingText}>أهلًا يا {staffName}</h2>
          <p className="mt-1 text-xs font-bold" style={mutedText}>الدورة الحالية: {cycle.start} — {cycle.end} · فرعك: {branch}</p>
        </div>
        <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="dawaa-button dawaa-button--secondary flex items-center gap-2 disabled:opacity-60"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث بياناتي</button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {(['followups', 'reviews', 'ops'] as SourceKey[]).map((key) => {
          const badgeClass = status[key] === 'ready' ? 'dawaa-badge--success' : status[key] === 'loading' ? 'dawaa-badge--info' : 'dawaa-badge--warning';
          return <div key={key} className={`dawaa-badge ${badgeClass} justify-start rounded-xl px-3 py-2 text-xs font-black`}>
            {key === 'followups' ? 'المتابعات' : key === 'reviews' ? 'التقييمات' : 'التشغيل'}: {status[key] === 'ready' ? 'محدّث' : status[key] === 'loading' ? 'جاري التحميل' : 'تعذر مؤقتًا'}
          </div>;
        })}
      </div>
    </div>

    {failed.length ? <div className="dawaa-alert dawaa-alert--warning flex items-start gap-2 p-4 text-xs font-bold"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><div>تم تحميل الأجزاء المتاحة من اللوحة. الأقسام التي عليها شرطة (—) لم ترجع بيانات مؤكدة، ولن تُعرض كصفر. يمكنك إعادة المحاولة بدون إعادة تحميل الصفحة كلها.</div></div> : null}

    <div className="grid grid-cols-4 gap-2.5 sm:gap-3 lg:grid-cols-8">
      {QUICK_LINKS.map((link) => <button key={link.path} type="button" onClick={() => navigate(link.path)} className={`cs-quick-link cs-quick-link--${link.tone}`}><link.icon size={23} /><span className="text-[10px] font-black leading-tight">{link.label}</span></button>)}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard icon={ClipboardList} label="متابعاتي هذه الدورة" status={status.followups} value={numberText(f.total_count)} tone="followups" />
      <StatCard icon={CheckCircle2} label="نسبة إنجاز متابعاتي" status={status.followups} value={`${completionRate}%`} tone="success" />
      <StatCard icon={Star} label="مراجعاتي للمحادثات" status={status.reviews} value={numberText(data.my_reviews_this_cycle.review_count)} tone="reviews" />
      <StatCard icon={Users} label="عملاء نشطون آخر 3 شهور" status={status.ops} value={numberText(data.active_customers.last_3_months)} tone="info" />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="تفصيل متابعاتي" icon={ClipboardList} status={status.followups}>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>مكتملة</div><div className="font-black dawaa-status-text-success">{f.completed_count}</div></div>
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>استثنائية</div><div className="font-black" style={headingText}>{f.exceptional_count}</div></div>
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>من التطبيق</div><div className="font-black" style={headingText}>{f.app_assigned_count}</div></div>
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>بطلب دكتور</div><div className="font-black" style={headingText}>{f.doctor_requested_count}</div></div>
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>بمبادرتي</div><div className="font-black" style={headingText}>{f.self_initiated_count}</div></div>
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>نسبة الإنجاز</div><div className="font-black" style={{ color: 'var(--dawaa-theme-primary)' }}>{completionRate}%</div></div>
        </div>
        {data.top_followed_customers.length ? <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}><div className="mb-2 text-xs font-black" style={mutedText}>أكثر العملاء متابعة</div>{data.top_followed_customers.slice(0, 5).map((row, index) => <div key={`${row.customer_name}-${index}`} className="flex justify-between py-1 text-xs"><span style={headingText}>{row.customer_name || 'عميل غير مسجل الاسم'}</span><span className="font-black" style={{ color: 'var(--dawaa-theme-primary)' }}>{row.followups_count || 0} متابعة</span></div>)}</div> : null}
      </Section>

      <Section title="التقييمات وجودة المحادثات" icon={Star} status={status.reviews}>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>مراجعاتي هذه الدورة</div><div className="mt-1 text-2xl font-black" style={headingText}>{data.my_reviews_this_cycle.review_count}</div></div>
          <div className="rounded-xl border p-3" style={softCard}><div className="text-xs" style={mutedText}>متوسط الفرع</div><div className="dawaa-status-text-warning mt-1 text-2xl font-black">{data.branch_reviews.branch_avg_score ?? '—'}</div></div>
        </div>
        <div className="mt-3 text-xs font-bold" style={mutedText}>ترتيبي بعدد المراجعات: {myRank >= 0 ? `${myRank + 1} من ${data.team_ranking.length}` : 'غير متاح'}</div>
        {data.doctor_ratings.length ? <div className="mt-3 space-y-1.5">{data.doctor_ratings.slice(0, 5).map((row) => <div key={row.doctor_name} className="flex items-center justify-between rounded-xl border px-3 py-2 text-xs" style={softCard}><span className="font-bold" style={headingText}>{row.doctor_name}</span><span className="dawaa-status-text-warning font-black">{row.avg_score}/100 · {row.review_count}</span></div>)}</div> : null}
      </Section>
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="طلبات العملاء" icon={Package} status={status.ops}><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span style={mutedText}>سجلتها</span><span className="font-black" style={headingText}>{data.my_customer_requests.logged_count}</span></div><div className="flex justify-between"><span style={mutedText}>مفتوحة</span><span className="dawaa-status-text-warning font-black">{data.my_customer_requests.open_count}</span></div></div></Section>
      <Section title="الرسائل الترحيبية" icon={MessageCircle} status={status.ops}><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span style={mutedText}>مرسلة</span><span className="font-black" style={headingText}>{data.my_welcome_messages.sent_count}</span></div><div className="flex justify-between"><span style={mutedText}>وصلت/تم تسليمها</span><span className="font-black" style={{ color: 'var(--dawaa-theme-primary)' }}>{data.my_welcome_messages.delivered_count}</span></div></div></Section>
      <Section title="حقيقة الفرع التشغيلية" icon={Heart} status={status.ops}><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span style={mutedText}>فواتير الفرع بالدورة</span><span className="font-black" style={headingText}>{numberText(data.branch_sales.invoices)}</span></div><div className="flex justify-between"><span style={mutedText}>مبيعات الفرع بالدورة</span><span className="dawaa-status-text-success font-black">{numberText(data.branch_sales.total_sales)} ج.م</span></div></div></Section>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="فعالية استرجاع العملاء" icon={Heart} status={status.reviews}><div className="mt-4 flex items-end gap-4"><div className="text-3xl font-black" style={headingText}>{data.recovery_stats.recovery_rate == null ? '—' : `${data.recovery_stats.recovery_rate}%`}</div><div className="pb-1 text-xs font-bold" style={mutedText}>{data.recovery_stats.recovered_count} رجعوا للشراء من {data.recovery_stats.total_followups} متابعة قابلة للقياس</div></div></Section>
      <Section title="جدولي القادم" icon={Calendar} status={status.ops}><div className="mt-3 space-y-2">{data.my_upcoming_shifts.length ? data.my_upcoming_shifts.slice(0, 5).map((shift) => <div key={`${shift.shift_date}-${shift.start_time}`} className="flex justify-between rounded-xl border p-2 text-xs" style={softCard}><span className="font-bold" style={headingText}>{shift.day_name || shift.shift_date}</span><span style={mutedText}>{shift.start_time?.slice(0, 5)} — {shift.end_time?.slice(0, 5)}</span></div>) : <p className="text-xs" style={mutedText}>لا يوجد جدول قادم مسجل.</p>}</div></Section>
    </div>

    <div className="rounded-2xl border p-4 text-xs font-bold" style={softCard}>
      <div className="flex items-center gap-2" style={{ color: 'var(--dawaa-theme-primary)' }}><Trophy size={15} /> قاعدة عرض البيانات</div>
      <p className="mt-2" style={mutedText}>الصفر يظهر فقط عندما ينجح المصدر ويعيد صفرًا فعليًا. أي timeout أو خطأ اتصال يظهر كشرطة (—) مع حالة المصدر، لذلك لا تختلط مشكلة التحميل مع الأداء الحقيقي.</p>
    </div>
  </div>;
}
