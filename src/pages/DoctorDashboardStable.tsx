import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  Headphones,
  MessageCircle,
  Package,
  Phone,
  RefreshCw,
  ShieldCheck,
  Star,
  Store,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { loadSalesAnalyticsSummary, type SalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type Tab = 'overview' | 'branch' | 'performance' | 'reviews' | 'notifications' | 'rules';
type DoctorRow = SalesAnalyticsSummary['doctorRows'][number];
type Row = Record<string, unknown>;

type PersonalReview = {
  id: string;
  createdAt: string;
  kind: string;
  score: number;
  level: string;
  impact: number;
  positive: string;
  negative: string;
  notes: string;
  training: string;
  reviewer: string;
};

type PersonalNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  route: string;
  createdAt: string;
  isRead: boolean;
  priority: string;
};

const BRANCH_TARGETS: Record<string, number> = {
  'فرع الشامي': 1_000_000,
  الشامي: 1_000_000,
  'فرع شكري': 1_500_000,
  شكري: 1_500_000,
};

const SCORE_RULES = [
  ['الترحيب وبداية الحوار', '10', 'ترحيب ودود، استخدام اسم العميل عند توفره، وتعريف واضح بصيدليات دواء.'],
  ['فهم الاحتياج', '20', 'استمع بدون مقاطعة، اسأل سؤالًا توضيحيًا، ثم لخّص الطلب قبل الترشيح.'],
  ['الترشيح الآمن', '25', 'رشّح الأنسب للحالة مع مراجعة الموانع والتعارضات وعدم تكرار المادة الفعالة.'],
  ['شرح الاستخدام', '15', 'اشرح الفائدة وطريقة الاستخدام والفرق بين البدائل بلغة بسيطة.'],
  ['Cross-selling أخلاقي', '10', 'منتج مكمل مرتبط باحتياج حقيقي وبعد سؤال العميل وبدون ضغط.'],
  ['Up-selling مسؤول', '10', 'اختيار أفضل فقط عند وجود فائدة واضحة مع شرح فرق السعر وترك القرار للعميل.'],
  ['الاحترام وعدم الضغط', '5', 'احترم قرار العميل ورفضه ولا تستخدم التخويف أو الإلحاح.'],
  ['الختام والمتابعة', '5', 'أكد الطلب والاستخدام واسأل عن احتياج إضافي واختم باهتمام.'],
] as const;

const CHANNEL_RULES = [
  {
    title: 'داخل الصيدلية',
    icon: Store,
    items: ['الوقوف واستقبال العميل باهتمام', 'فهم الطلب قبل إحضار المنتج', 'شرح الجرعة والاستخدام بوضوح', 'عرض بديل مناسب عند عدم التوافر', 'التأكد من رضا العميل قبل إنهاء التعامل'],
  },
  {
    title: 'واتساب',
    icon: MessageCircle,
    items: ['الرد خلال 0–5 دقائق قدر الإمكان', 'الترحيب باسم العميل وعدم إرسال رد مقتضب', 'تأكيد فهم الطلب قبل الترشيح', 'توضيح السعر والتوافر والتوصيل', 'ختام المحادثة والتأكد من عدم وجود طلب آخر'],
  },
  {
    title: 'المكالمة',
    icon: Phone,
    items: ['التعريف بالنفس وبصيدليات دواء', 'الاستماع دون مقاطعة', 'تلخيص الطلب قبل التنفيذ', 'تأكيد الاسم والعنوان والطلب', 'إنهاء المكالمة بملخص واضح وودود'],
  },
] as const;

const ACTIONS = [
  { label: 'مسابقة الدكاترة', href: '/doctor-competition', icon: Award },
  { label: 'متابعاتي المطلوبة', href: '/doctor-dashboard?tab=overview#followups', icon: Headphones },
  { label: 'بحث العملاء', href: '/customers', icon: Users },
  { label: 'تقييماتي الشخصية', href: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck },
  { label: 'إشعاراتي', href: '/doctor-dashboard?tab=notifications', icon: Bell },
  { label: 'النقاط والحافز', href: '/points', icon: Star },
  { label: 'الرواكد واللستة', href: '/stagnant-medicines', icon: Package },
  { label: 'الجدول', href: '/schedule', icon: Calendar },
] as const;

function normalizeName(value?: string | null) {
  return String(value || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '')
    .replace(/[\s/_.-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function branchTarget(branch: string, branchSales: number) {
  const normalized = normalizeBranchName(branch);
  const exact = BRANCH_TARGETS[normalized] || BRANCH_TARGETS[branch];
  return exact || Math.max(branchSales * 1.25, 1);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function tabFromSearch(): Tab {
  const value = new URLSearchParams(window.location.search).get('tab');
  return ['overview', 'branch', 'performance', 'reviews', 'notifications', 'rules'].includes(String(value)) ? (value as Tab) : 'overview';
}

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: typeof DollarSign }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-900/80 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-300">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
          {hint ? <div className="mt-1 text-xs leading-5 text-slate-400">{hint}</div> : null}
        </div>
        <div className="rounded-xl bg-teal-500/15 p-3 text-teal-300"><Icon size={20} /></div>
      </div>
    </div>
  );
}

async function safeRows(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) {
  try {
    const result = await query;
    return result.error ? [] : ((result.data || []) as Row[]);
  } catch {
    return [];
  }
}

export default function DoctorDashboardStable() {
  const { user } = useAuth();
  const cycle = useMemo(() => getCurrentCycle(), []);
  const [tab, setTab] = useState<Tab>(() => tabFromSearch());
  const [state, setState] = useState<LoadState>('idle');
  const [summary, setSummary] = useState<SalesAnalyticsSummary | null>(null);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [reviews, setReviews] = useState<PersonalReview[]>([]);
  const [reviewsState, setReviewsState] = useState<LoadState>('idle');
  const [notifications, setNotifications] = useState<PersonalNotification[]>([]);
  const [notificationsState, setNotificationsState] = useState<LoadState>('idle');

  const branch = String(user?.branch || '').trim();
  const staffId = String(user?.staffId || user?.id || '').trim();
  const userId = String(user?.id || '').trim();
  const doctorName = String(user?.name || '').trim();

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
  }, []);

  const load = useCallback(async () => {
    if (!branch) {
      setState('error');
      setError('الحساب غير مرتبط بفرع واضح.');
      return;
    }
    setState('loading');
    setError('');
    try {
      const result = await loadSalesAnalyticsSummary({
        startDate: formatCycleDate(cycle.start),
        endDate: formatCycleDate(cycle.end),
        branch,
      }, true);
      setSummary(result);
      setLoadedAt(new Date());
      setState('success');
    } catch (loadError) {
      console.error('Stable doctor dashboard load failed:', loadError);
      setState('error');
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات لوحة الدكتور.');
    }
  }, [branch, cycle.end, cycle.start]);

  const loadReviews = useCallback(async () => {
    if (!staffId && !doctorName) return;
    setReviewsState('loading');
    const queries: Promise<Row[]>[] = [];
    if (staffId) {
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(40)));
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_id', staffId).order('created_at', { ascending: false }).limit(40)));
    }
    if (doctorName) queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_name', doctorName).order('created_at', { ascending: false }).limit(40)));
    const groups = await Promise.all(queries);
    const unique = new Map<string, Row>();
    groups.flat().forEach((row) => unique.set(String(row.id || `${row.created_at}-${row.doctor_name}`), row));
    const normalizedDoctor = normalizeName(doctorName);
    const personal = [...unique.values()]
      .filter((row) => {
        const rowId = String(row.staff_id || row.doctor_id || '');
        const rowName = normalizeName(String(row.staff_name || row.doctor_name || ''));
        return (staffId && rowId === staffId) || (normalizedDoctor && rowName === normalizedDoctor);
      })
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 30)
      .map((row): PersonalReview => ({
        id: String(row.id || ''),
        createdAt: String(row.created_at || row.conversation_date || ''),
        kind: String(row.evaluation_kind || row.conversation_type || 'تقييم محادثة'),
        score: asNumber(row.final_score ?? row.total_score),
        level: String(row.level || ''),
        impact: asNumber(row.doctor_points_impact ?? row.point_impact),
        positive: String(row.main_positive_reason || ''),
        negative: String(row.main_negative_reason || ''),
        notes: String(row.reviewer_notes || ''),
        training: String(row.training_recommendation || ''),
        reviewer: String(row.reviewer_name || 'مراجع خدمة العملاء'),
      }));
    setReviews(personal);
    setReviewsState('success');
  }, [doctorName, staffId]);

  const loadNotifications = useCallback(async () => {
    if (!staffId && !userId) return;
    setNotificationsState('loading');
    const queries: Promise<Row[]>[] = [];
    if (staffId) queries.push(safeRows(supabase.from('notifications').select('*').eq('recipient_staff_id', staffId).order('created_at', { ascending: false }).limit(40)));
    if (userId) {
      queries.push(safeRows(supabase.from('notifications').select('*').eq('recipient_user_id', userId).order('created_at', { ascending: false }).limit(40)));
      queries.push(safeRows(supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40)));
    }
    const groups = await Promise.all(queries);
    const unique = new Map<string, Row>();
    groups.flat().forEach((row) => unique.set(String(row.id || `${row.created_at}-${row.title}`), row));
    const personal = [...unique.values()]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 40)
      .map((row): PersonalNotification => ({
        id: String(row.id || ''),
        title: String(row.title || row.type || 'إشعار'),
        message: String(row.message || row.body || row.description || ''),
        type: String(row.type || 'system'),
        route: String(row.target_route || row.route || ''),
        createdAt: String(row.created_at || ''),
        isRead: Boolean(row.is_read ?? row.read ?? row.status === 'read'),
        priority: String(row.priority || 'normal'),
      }));
    setNotifications(personal);
    setNotificationsState('success');
  }, [staffId, userId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onPopState = () => setTab(tabFromSearch());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (tab === 'reviews' && reviewsState === 'idle') void loadReviews();
    if (tab === 'notifications' && notificationsState === 'idle') void loadNotifications();
  }, [loadNotifications, loadReviews, notificationsState, reviewsState, tab]);

  const doctorRow = useMemo<DoctorRow | null>(() => {
    if (!summary) return null;
    const byId = summary.doctorRows.find((row) => row.staffId && row.staffId === staffId);
    if (byId) return byId;
    const normalized = normalizeName(doctorName);
    return summary.doctorRows.find((row) => normalizeName(row.doctor) === normalized) || null;
  }, [doctorName, staffId, summary]);

  const ranking = useMemo(() => summary ? [...summary.doctorRows].sort((a, b) => b.netSales - a.netSales) : [], [summary]);
  const doctorRank = doctorRow ? ranking.findIndex((row) => row === doctorRow) + 1 : 0;
  const branchSales = summary?.kpis.netSales || 0;
  const target = branchTarget(branch, branchSales);
  const achievement = target ? (branchSales / target) * 100 : 0;
  const remaining = Math.max(0, target - branchSales);
  const lastSalesDate = summary?.dailyTrend?.map((row) => row.date).filter(Boolean).sort().at(-1) || '';
  const startDate = formatCycleDate(cycle.start);
  const elapsedDays = lastSalesDate
    ? Math.max(1, Math.floor((new Date(`${lastSalesDate}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000) + 1)
    : 1;
  const totalCycleDays = Math.max(1, Math.floor((new Date(`${formatCycleDate(cycle.end)}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000) + 1);
  const projected = branchSales ? (branchSales / Math.min(elapsedDays, totalCycleDays)) * totalCycleDays : 0;
  const reviewAverage = reviews.length ? reviews.reduce((sum, row) => sum + row.score, 0) / reviews.length : 0;
  const unreadNotifications = notifications.filter((item) => !item.isRead).length;

  return (
    <div dir="rtl" className="space-y-5 pb-8">
      <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-l from-teal-500/10 via-slate-900 to-sky-500/10 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-black text-teal-300">لوحة الدكتور — البيانات الشخصية وبيانات الفرع</div>
            <h1 className="mt-1 text-3xl font-black text-white">{greeting()} يا دكتور {doctorName || 'الزميل'}</h1>
            <p className="mt-2 text-sm text-slate-300">{branch || 'الفرع غير محدد'} — الدورة {cycle.label}</p>
            <p className="mt-1 text-xs font-bold text-sky-200">آخر يوم مبيعات ظاهر: {lastSalesDate || 'جاري التحقق من آخر ملف مرفوع'}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={state === 'loading'} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-400/30 bg-teal-500/15 px-5 py-3 font-black text-teal-100 disabled:opacity-50">
            <RefreshCw size={18} className={state === 'loading' ? 'animate-spin' : ''} /> تحديث البيانات
          </button>
        </div>
      </section>

      <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:grid-cols-3 xl:grid-cols-6">
        {([
          ['overview', 'الملخص'], ['branch', 'تقدم الفرع'], ['performance', 'أدائي وترتيبي'],
          ['reviews', 'تقييماتي'], ['notifications', `إشعاراتي${unreadNotifications ? ` (${unreadNotifications})` : ''}`], ['rules', 'قواعد الخدمة'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => selectTab(key)} className={`rounded-xl px-4 py-3 text-sm font-black transition ${tab === key ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>{label}</button>
        ))}
      </nav>

      {state === 'loading' ? <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><div className="flex items-center gap-3 text-slate-200"><RefreshCw className="animate-spin text-teal-300" /> جاري تحميل ملخص المبيعات…</div></section> : null}
      {state === 'error' ? <section className="rounded-3xl border border-red-400/25 bg-red-500/10 p-6 text-red-100"><div className="font-black">تعذر تحميل بيانات المبيعات</div><div className="mt-2 text-sm">{error}</div><button type="button" onClick={() => void load()} className="mt-4 rounded-xl bg-red-500 px-4 py-2 font-black text-white">إعادة المحاولة</button></section> : null}

      {tab === 'overview' && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="مبيعاتي في الدورة" value={doctorRow ? formatCurrency(doctorRow.netSales) : 'غير مرتبط'} hint={doctorRow ? `${doctorRow.invoicesCount} فاتورة — حتى ${lastSalesDate || 'آخر رفع'}` : 'راجع ربط اسم الدكتور أو staff_id'} icon={DollarSign} />
            <Metric label="مبيعات الفرع" value={formatCurrency(branchSales)} hint={`${summary?.kpis.invoicesCount || 0} فاتورة — حتى ${lastSalesDate || 'آخر رفع'}`} icon={BarChart3} />
            <Metric label="متوسط فاتورتي" value={doctorRow ? formatCurrency(doctorRow.avgInvoice) : '—'} hint={`متوسط الفرع ${formatCurrency(summary?.kpis.avgInvoice || 0)}`} icon={TrendingUp} />
            <Metric label="ترتيبي في الفرع" value={doctorRank ? `${doctorRank} من ${ranking.length}` : '—'} hint="حسب المبيعات في الدورة" icon={Award} />
          </section>
          <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5">
            <h2 className="text-xl font-black text-white">الوصول السريع</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map(({ label, href, icon: Icon }) => <a key={`${label}-${href}`} href={href} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 font-black text-slate-100 hover:border-teal-400/50 hover:bg-teal-500/10"><Icon size={20} className="text-teal-300" />{label}</a>)}
            </div>
          </section>
        </>
      )}

      {tab === 'branch' && (
        <section className="rounded-3xl border border-sky-400/20 bg-slate-900/80 p-5">
          <h2 className="text-2xl font-black text-white">تقدم {branch}</h2>
          <p className="mt-1 text-sm text-slate-400">الحساب حتى آخر يوم مبيعات مرفوع: {lastSalesDate || 'غير متاح'}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="المبيعات" value={formatCurrency(branchSales)} hint={`اليوم ${Math.min(elapsedDays, totalCycleDays)} من ${totalCycleDays}`} icon={BarChart3} />
            <Metric label="التارجت" value={formatCurrency(target)} icon={Target} />
            <Metric label="نسبة التحقيق" value={`${achievement.toFixed(1)}%`} icon={Award} />
            <Metric label="المتبقي" value={formatCurrency(remaining)} icon={TrendingUp} />
            <Metric label="التوقع بنهاية الدورة" value={formatCurrency(projected)} hint={`${target ? ((projected / target) * 100).toFixed(1) : 0}% متوقع`} icon={DollarSign} />
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(100, achievement)}%` }} /></div>
        </section>
      )}

      {tab === 'performance' && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
          <h2 className="text-2xl font-black text-white">ترتيب دكاترة الفرع</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[650px] text-right text-sm">
              <thead className="text-slate-400"><tr><th className="p-3">#</th><th className="p-3">الدكتور</th><th className="p-3">المبيعات</th><th className="p-3">الفواتير</th><th className="p-3">متوسط الفاتورة</th></tr></thead>
              <tbody>{ranking.map((row, index) => { const mine = row === doctorRow; return <tr key={`${row.staffId || row.doctor}-${index}`} className={mine ? 'bg-teal-500/15 text-teal-100' : 'border-t border-slate-800 text-slate-200'}><td className="p-3 font-black">{index + 1}</td><td className="p-3 font-black">{row.doctor}{mine ? ' — أنت' : ''}</td><td className="p-3">{formatCurrency(row.netSales)}</td><td className="p-3">{row.invoicesCount}</td><td className="p-3">{formatCurrency(row.avgInvoice)}</td></tr>; })}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'reviews' && (
        <section className="rounded-3xl border border-violet-400/20 bg-slate-900/80 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-black text-white">سجل تقييماتي الشخصية</h2><p className="mt-1 text-sm text-slate-400">عرض فقط للتقييمات المسجلة عليك؛ لا توجد صلاحية لإضافة تقييم من هنا.</p></div><button type="button" onClick={() => void loadReviews()} className="rounded-xl border border-violet-400/30 px-4 py-2 font-black text-violet-100">تحديث التقييمات</button></div>
          {reviewsState === 'loading' ? <div className="mt-5 text-slate-300">جاري تحميل تقييماتك فقط…</div> : null}
          {reviewsState === 'success' && !reviews.length ? <div className="mt-5 rounded-2xl border border-slate-700 p-5 text-slate-400">لا توجد تقييمات مرتبطة بحسابك حتى الآن.</div> : null}
          {reviews.length ? <><div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="عدد تقييماتي" value={String(reviews.length)} icon={ClipboardCheck} /><Metric label="متوسط التقييم" value={`${reviewAverage.toFixed(1)}/100`} icon={Star} /><Metric label="آخر تقييم" value={formatDate(reviews[0]?.createdAt)} icon={Calendar} /></div><div className="mt-4 space-y-3">{reviews.map((review) => <div key={review.id} className="rounded-2xl border border-slate-700 bg-slate-950/45 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="font-black text-white">{review.kind} — {review.score}/100</div><div className="text-xs font-bold text-slate-400">{formatDate(review.createdAt)} · {review.reviewer}</div></div><div className="mt-3 grid gap-2 md:grid-cols-2"><div className="rounded-xl bg-teal-500/10 p-3 text-sm text-teal-100"><b>نقطة قوة:</b> {review.positive || 'لم تسجل'}</div><div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100"><b>فرصة تحسين:</b> {review.negative || review.training || 'لا توجد ملاحظة'}</div></div>{review.notes ? <div className="mt-2 text-sm leading-6 text-slate-300">ملاحظة المراجع: {review.notes}</div> : null}<div className={`mt-2 text-sm font-black ${review.impact >= 0 ? 'text-teal-300' : 'text-red-300'}`}>تأثير النقاط: {review.impact > 0 ? '+' : ''}{review.impact}</div></div>)}</div></> : null}
        </section>
      )}

      {tab === 'notifications' && (
        <section className="rounded-3xl border border-sky-400/20 bg-slate-900/80 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-black text-white">إشعاراتي الشخصية</h2><p className="mt-1 text-sm text-slate-400">تقييمات، نقاط، مكافآت، خصومات، مهام أو متابعات موجهة لحسابك فقط.</p></div><button type="button" onClick={() => void loadNotifications()} className="rounded-xl border border-sky-400/30 px-4 py-2 font-black text-sky-100">تحديث الإشعارات</button></div>
          {notificationsState === 'loading' ? <div className="mt-5 text-slate-300">جاري تحميل إشعاراتك فقط…</div> : null}
          {notificationsState === 'success' && !notifications.length ? <div className="mt-5 rounded-2xl border border-slate-700 p-5 text-slate-400">لا توجد إشعارات شخصية حتى الآن.</div> : null}
          <div className="mt-4 space-y-3">{notifications.map((item) => { const content = <div className={`rounded-2xl border p-4 ${item.isRead ? 'border-slate-700 bg-slate-950/35' : 'border-sky-400/35 bg-sky-500/10'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div className="font-black text-white">{item.title}</div><div className="text-xs font-bold text-slate-400">{formatDate(item.createdAt)}</div></div><p className="mt-2 text-sm leading-6 text-slate-300">{item.message || 'إشعار جديد متعلق بحسابك.'}</p><div className="mt-2 text-xs font-bold text-sky-200">{item.isRead ? 'مقروء' : 'جديد'} · {item.type} · {item.priority}</div></div>; return item.route ? <a key={item.id} href={item.route}>{content}</a> : <div key={item.id}>{content}</div>; })}</div>
        </section>
      )}

      {tab === 'rules' && (
        <div className="space-y-4">
          <section className="rounded-3xl border border-amber-300/20 bg-slate-900/80 p-5"><div className="flex items-center gap-3"><ShieldCheck className="text-amber-300" /><h2 className="text-2xl font-black text-white">قواعد الخدمة وتقييم المحادثة</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{SCORE_RULES.map(([title, score, detail]) => <div key={title} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4"><div className="flex justify-between gap-2"><div className="font-black text-white">{title}</div><span className="text-sm font-black text-teal-300">{score} درجات</span></div><p className="mt-2 text-sm leading-6 text-slate-300">{detail}</p></div>)}</div></section>
          <section className="grid gap-4 xl:grid-cols-3">{CHANNEL_RULES.map(({ title, icon: Icon, items }) => <div key={title} className="rounded-3xl border border-sky-400/15 bg-slate-900/80 p-5"><div className="flex items-center gap-2"><Icon className="text-sky-300" /><h3 className="text-xl font-black text-white">{title}</h3></div><div className="mt-4 space-y-2">{items.map((item) => <div key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-200"><CheckCircle2 size={16} className="mt-1 shrink-0 text-teal-300" /><span>{item}</span></div>)}</div></div>)}</section>
          <section className="rounded-3xl border border-red-400/20 bg-red-500/5 p-5"><div className="flex items-center gap-2"><AlertTriangle className="text-red-300" /><h3 className="text-xl font-black text-red-100">ممنوعات أساسية</h3></div><p className="mt-3 text-sm font-bold leading-7 text-red-50">ممنوع الضغط على العميل، أو بيع الأغلى لمجرد السعر، أو ترشيح منتج غير مناسب، أو تكرار مادة فعالة، أو إعطاء معلومة غير مؤكدة. القاعدة: اسأل → افهم → رشّح الأنسب → اشرح → أكد رضا العميل.</p></section>
        </div>
      )}

      <div className="text-center text-xs text-slate-500">{loadedAt ? `آخر تحديث ${loadedAt.toLocaleTimeString('ar-EG')}` : ''}</div>
    </div>
  );
}
