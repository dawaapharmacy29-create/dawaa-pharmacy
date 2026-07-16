import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Award, BarChart3, Bell, Calendar, ClipboardCheck, DollarSign, Headphones,
  MessageCircle, Package, Phone, RefreshCw, ShieldCheck, Star, Store, Target, TrendingUp, Users, WalletCards,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { loadSalesAnalyticsSummary, type SalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import DoctorRequestedFollowups from '@/components/doctor/DoctorRequestedFollowups';
import { getEmployeeEvents } from '@/lib/employeeEventService';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type Tab = 'overview' | 'branch' | 'performance' | 'followups' | 'reviews' | 'notifications' | 'activity' | 'payroll' | 'rules';
type DoctorRow = SalesAnalyticsSummary['doctorRows'][number];
type Row = Record<string, unknown>;

type PersonalReview = { id: string; createdAt: string; kind: string; score: number; impact: number; positive: string; negative: string; notes: string; training: string; reviewer: string };
type PersonalNotification = { id: string; title: string; message: string; route: string; createdAt: string; isRead: boolean; priority: string };
type EmployeeEvent = { id: string; title?: string; description?: string; category?: string; actor_name?: string; points_delta?: number; money_delta?: number; route?: string; event_at?: string };

const BRANCH_TARGETS: Record<string, number> = { 'فرع الشامي': 1_000_000, الشامي: 1_000_000, 'فرع شكري': 1_500_000, شكري: 1_500_000 };
const SCORE_RULES = [
  ['الترحيب وبداية الحوار', '10', 'ترحيب ودود واستخدام اسم العميل عند توفره.'],
  ['فهم الاحتياج', '20', 'استمع واسأل ثم لخّص الطلب قبل الترشيح.'],
  ['الترشيح الآمن', '25', 'رشّح الأنسب مع مراجعة الموانع والتعارضات.'],
  ['شرح الاستخدام', '15', 'اشرح الفائدة وطريقة الاستخدام والفرق بين البدائل.'],
  ['Cross-selling أخلاقي', '10', 'منتج مكمل مرتبط باحتياج حقيقي وبدون ضغط.'],
  ['Up-selling مسؤول', '10', 'اختيار أفضل عند وجود فائدة واضحة مع شرح فرق السعر.'],
  ['الاحترام وعدم الضغط', '5', 'احترم قرار العميل ورفضه.'],
  ['الختام والمتابعة', '5', 'أكد الطلب واسأل عن احتياج إضافي واختم باهتمام.'],
] as const;
const CHANNEL_RULES = [
  { title: 'داخل الصيدلية', icon: Store, items: ['الوقوف واستقبال العميل باهتمام', 'فهم الطلب قبل إحضار المنتج', 'شرح الجرعة والاستخدام', 'عرض بديل مناسب', 'التأكد من رضا العميل'] },
  { title: 'واتساب', icon: MessageCircle, items: ['الرد خلال 0–5 دقائق قدر الإمكان', 'الترحيب باسم العميل', 'تأكيد فهم الطلب', 'توضيح السعر والتوافر والتوصيل', 'ختام المحادثة بوضوح'] },
  { title: 'المكالمة', icon: Phone, items: ['التعريف بالنفس والصيدلية', 'الاستماع دون مقاطعة', 'تلخيص الطلب', 'تأكيد الاسم والعنوان', 'إنهاء المكالمة بملخص واضح'] },
] as const;
const ACTIONS = [
  { label: 'مسابقة الدكاترة', href: '/doctor-competition', icon: Award },
  { label: 'متابعاتي المطلوبة', href: '/doctor-dashboard?tab=followups', icon: Headphones },
  { label: 'بحث العملاء', href: '/customers', icon: Users },
  { label: 'تقييماتي الشخصية', href: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck },
  { label: 'إشعاراتي', href: '/doctor-dashboard?tab=notifications', icon: Bell },
  { label: 'سجل نشاطي', href: '/doctor-dashboard?tab=activity', icon: Activity },
  { label: 'حسابي والقبض', href: '/doctor-dashboard?tab=payroll', icon: WalletCards },
  { label: 'النقاط والحافز', href: '/points', icon: Star },
  { label: 'الرواكد واللستة', href: '/stagnant-medicines', icon: Package },
  { label: 'الجدول', href: '/schedule', icon: Calendar },
] as const;

function normalizeName(value?: string | null) {
  return String(value || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '').replace(/[\s/_.-]+/g, ' ').trim().toLowerCase();
}
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function formatDate(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value.slice(0, 16) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'صباح الخير' : hour < 18 ? 'نهارك سعيد' : 'مساء الخير'; }
function branchTarget(branch: string, sales: number) { return BRANCH_TARGETS[normalizeBranchName(branch)] || BRANCH_TARGETS[branch] || Math.max(sales * 1.25, 1); }
async function safeRows(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) { try { const result = await query; return result.error ? [] : (result.data || []) as Row[]; } catch { return []; } }

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: typeof DollarSign }) {
  return <div className="rounded-2xl border border-slate-700/70 bg-slate-900/80 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-slate-300">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div>{hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}</div><div className="rounded-xl bg-teal-500/15 p-3 text-teal-300"><Icon size={20} /></div></div></div>;
}

export default function DoctorDashboardStable() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab: Tab = ['overview','branch','performance','followups','reviews','notifications','activity','payroll','rules'].includes(String(requestedTab)) ? requestedTab as Tab : 'overview';
  const cycle = useMemo(() => getCurrentCycle(), []);
  const [state, setState] = useState<LoadState>('idle');
  const [summary, setSummary] = useState<SalesAnalyticsSummary | null>(null);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState<PersonalReview[]>([]);
  const [notifications, setNotifications] = useState<PersonalNotification[]>([]);
  const [events, setEvents] = useState<EmployeeEvent[]>([]);
  const [personalState, setPersonalState] = useState<Record<string, LoadState>>({ reviews: 'idle', notifications: 'idle', activity: 'idle', payroll: 'idle' });
  const [payrollRows, setPayrollRows] = useState<Row[]>([]);

  const branch = String(user?.branch || '').trim();
  const staffId = String(user?.staffId || '').trim();
  const userId = String(user?.id || '').trim();
  const doctorName = String(user?.name || '').trim();
  const selectTab = (next: Tab) => setSearchParams({ tab: next }, { replace: true });

  const load = useCallback(async () => {
    if (!branch) { setState('error'); setError('الحساب غير مرتبط بفرع واضح.'); return; }
    setState('loading'); setError('');
    try {
      const result = await loadSalesAnalyticsSummary({ startDate: formatCycleDate(cycle.start), endDate: formatCycleDate(cycle.end), branch }, true);
      setSummary(result); setState('success');
    } catch (loadError) { setState('error'); setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات لوحة الدكتور.'); }
  }, [branch, cycle.end, cycle.start]);

  const loadReviews = useCallback(async () => {
    setPersonalState((s) => ({ ...s, reviews: 'loading' }));
    const queries: Promise<Row[]>[] = [];
    if (staffId) { queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(100))); queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_id', staffId).order('created_at', { ascending: false }).limit(100))); }
    if (doctorName) queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_name', doctorName).order('created_at', { ascending: false }).limit(100)));
    const unique = new Map<string, Row>(); (await Promise.all(queries)).flat().forEach((row) => unique.set(String(row.id || `${row.created_at}-${row.doctor_name}`), row));
    const normalized = normalizeName(doctorName);
    setReviews([...unique.values()].filter((row) => (staffId && String(row.staff_id || row.doctor_id || '') === staffId) || (normalized && normalizeName(String(row.staff_name || row.doctor_name || '')) === normalized)).sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map((row) => ({ id: String(row.id || ''), createdAt: String(row.created_at || row.conversation_date || ''), kind: String(row.evaluation_kind || row.conversation_type || 'تقييم محادثة'), score: number(row.final_score ?? row.total_score), impact: number(row.doctor_points_impact ?? row.point_impact), positive: String(row.main_positive_reason || ''), negative: String(row.main_negative_reason || ''), notes: String(row.reviewer_notes || ''), training: String(row.training_recommendation || ''), reviewer: String(row.reviewer_name || 'مراجع خدمة العملاء') })));
    setPersonalState((s) => ({ ...s, reviews: 'success' }));
  }, [doctorName, staffId]);

  const loadNotifications = useCallback(async () => {
    setPersonalState((s) => ({ ...s, notifications: 'loading' }));
    const queries: Promise<Row[]>[] = [];
    if (staffId) queries.push(safeRows(supabase.from('notifications').select('*').eq('recipient_staff_id', staffId).order('created_at', { ascending: false }).limit(100)));
    if (userId) { queries.push(safeRows(supabase.from('notifications').select('*').eq('recipient_user_id', userId).order('created_at', { ascending: false }).limit(100))); queries.push(safeRows(supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100))); }
    const unique = new Map<string, Row>(); (await Promise.all(queries)).flat().forEach((row) => unique.set(String(row.id || `${row.created_at}-${row.title}`), row));
    setNotifications([...unique.values()].sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map((row) => ({ id: String(row.id || ''), title: String(row.title || row.type || 'إشعار'), message: String(row.message || row.body || row.description || ''), route: String(row.target_route || row.route || ''), createdAt: String(row.created_at || ''), isRead: Boolean(row.is_read ?? row.read ?? row.status === 'read'), priority: String(row.priority || 'normal') })));
    setPersonalState((s) => ({ ...s, notifications: 'success' }));
  }, [staffId, userId]);

  const loadActivity = useCallback(async () => { setPersonalState((s) => ({ ...s, activity: 'loading' })); setEvents((await getEmployeeEvents(staffId, 200)) as EmployeeEvent[]); setPersonalState((s) => ({ ...s, activity: 'success' })); }, [staffId]);
  const loadPayroll = useCallback(async () => { setPersonalState((s) => ({ ...s, payroll: 'loading' })); const rows = await safeRows(supabase.from('employee_monthly_statements').select('*').eq('staff_id', staffId).order('cycle_end', { ascending: false }).limit(12)); setPayrollRows(rows); setPersonalState((s) => ({ ...s, payroll: 'success' })); }, [staffId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab === 'reviews' && personalState.reviews === 'idle') void loadReviews();
    if (tab === 'notifications' && personalState.notifications === 'idle') void loadNotifications();
    if (tab === 'activity' && personalState.activity === 'idle') void loadActivity();
    if (tab === 'payroll' && personalState.payroll === 'idle') void loadPayroll();
  }, [loadActivity, loadNotifications, loadPayroll, loadReviews, personalState, tab]);

  const doctorRow = useMemo<DoctorRow | null>(() => { if (!summary) return null; return summary.doctorRows.find((row) => row.staffId && row.staffId === staffId) || summary.doctorRows.find((row) => normalizeName(row.doctor) === normalizeName(doctorName)) || null; }, [doctorName, staffId, summary]);
  const ranking = useMemo(() => summary ? [...summary.doctorRows].sort((a,b) => b.netSales - a.netSales) : [], [summary]);
  const doctorRank = doctorRow ? ranking.findIndex((row) => row.staffId === doctorRow.staffId && row.doctor === doctorRow.doctor) + 1 : 0;
  const branchSales = summary?.kpis.netSales || 0;
  const target = branchTarget(branch, branchSales);
  const achievement = target ? branchSales / target * 100 : 0;
  const lastSalesDate = summary?.dailyTrend?.map((row) => row.date).filter(Boolean).sort().at(-1) || '';
  const unread = notifications.filter((item) => !item.isRead).length;

  const tabs: Array<[Tab,string]> = [['overview','الملخص'],['branch','تقدم الفرع'],['performance','أدائي وترتيبي'],['followups','متابعاتي المطلوبة'],['reviews','تقييماتي'],['notifications',`إشعاراتي${unread ? ` (${unread})` : ''}`],['activity','سجل نشاطي'],['payroll','حسابي والقبض'],['rules','قواعد الخدمة']];

  return <div dir="rtl" className="space-y-5 pb-8">
    <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-l from-teal-500/10 via-slate-900 to-sky-500/10 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-sm font-black text-teal-300">لوحة الدكتور — البيانات الشخصية وبيانات الفرع</div><h1 className="mt-1 text-3xl font-black text-white">{greeting()} يا دكتور {doctorName || 'الزميل'}</h1><p className="mt-2 text-sm text-slate-300">{branch || 'الفرع غير محدد'} — الدورة {cycle.label}</p><p className="mt-1 text-xs font-bold text-sky-200">آخر يوم مبيعات ظاهر: {lastSalesDate || 'جارٍ التحقق'}</p></div><button type="button" onClick={() => void load()} disabled={state === 'loading'} className="btn-primary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} /> تحديث البيانات</button></div></section>

    <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:grid-cols-3 xl:grid-cols-9">{tabs.map(([key,label]) => <button key={key} type="button" onClick={() => selectTab(key)} className={`rounded-xl px-3 py-3 text-sm font-black ${tab === key ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>{label}</button>)}</nav>
    {state === 'error' ? <section className="rounded-3xl border border-red-400/25 bg-red-500/10 p-5 text-red-100">{error}</section> : null}

    {tab === 'overview' ? <><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="مبيعاتي في الدورة" value={doctorRow ? formatCurrency(doctorRow.netSales) : 'غير مرتبط'} hint={doctorRow ? `${doctorRow.invoicesCount} فاتورة` : 'راجع staff_id'} icon={DollarSign} /><Metric label="مبيعات الفرع" value={formatCurrency(branchSales)} hint={`${summary?.kpis.invoicesCount || 0} فاتورة`} icon={BarChart3} /><Metric label="متوسط فاتورتي" value={doctorRow ? formatCurrency(doctorRow.avgInvoice) : '—'} hint={`متوسط الفرع ${formatCurrency(summary?.kpis.avgInvoice || 0)}`} icon={TrendingUp} /><Metric label="ترتيبي في الفرع" value={doctorRank ? `${doctorRank} من ${ranking.length}` : '—'} icon={Award} /></section><section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5"><h2 className="text-xl font-black text-white">الوصول السريع</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{ACTIONS.map(({label,href,icon:Icon}) => <a key={href} href={href} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 font-black text-slate-100 hover:border-teal-400/50"><Icon size={20} className="text-teal-300" />{label}</a>)}</div></section></> : null}

    {tab === 'branch' ? <section className="rounded-3xl border border-sky-400/20 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">تقدم {branch}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="المبيعات" value={formatCurrency(branchSales)} icon={BarChart3} /><Metric label="التارجت" value={formatCurrency(target)} icon={Target} /><Metric label="نسبة التحقيق" value={`${achievement.toFixed(1)}%`} icon={Award} /><Metric label="المتبقي" value={formatCurrency(Math.max(0,target-branchSales))} icon={TrendingUp} /></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-teal-400" style={{width:`${Math.min(100,achievement)}%`}} /></div></section> : null}

    {tab === 'performance' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">ترتيب دكاترة الفرع</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead className="text-slate-400"><tr><th className="p-3">#</th><th className="p-3">الدكتور</th><th className="p-3">المبيعات</th><th className="p-3">الفواتير</th><th className="p-3">المتوسط</th></tr></thead><tbody>{ranking.map((row,index) => <tr key={row.staffId || row.doctor} className={`border-t border-slate-800 ${doctorRow && row.doctor === doctorRow.doctor ? 'bg-teal-500/10' : ''}`}><td className="p-3">{index+1}</td><td className="p-3 font-black text-white">{row.doctor}{doctorRow && row.doctor === doctorRow.doctor ? ' — أنت هنا' : ''}</td><td className="p-3">{formatCurrency(row.netSales)}</td><td className="p-3">{row.invoicesCount}</td><td className="p-3">{formatCurrency(row.avgInvoice)}</td></tr>)}</tbody></table></div></section> : null}

    {tab === 'followups' ? <DoctorRequestedFollowups /> : null}

    {tab === 'reviews' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><div className="flex items-center justify-between"><h2 className="text-2xl font-black text-white">تقييماتي الشخصية</h2><button className="btn-secondary" onClick={() => void loadReviews()}>تحديث</button></div>{personalState.reviews === 'loading' ? <p className="mt-4 text-slate-400">جارٍ التحميل…</p> : null}<div className="mt-4 space-y-3">{reviews.map((review) => <article key={review.id} className="rounded-2xl border border-slate-700 p-4"><div className="flex justify-between gap-3"><div className="font-black text-white">{review.kind}</div><div className="text-xl font-black text-teal-200">{review.score}/100</div></div><div className="mt-2 text-xs text-slate-400">{formatDate(review.createdAt)} · {review.reviewer}</div>{review.positive ? <p className="mt-2 text-sm text-teal-200">نقطة قوة: {review.positive}</p> : null}{review.negative ? <p className="mt-1 text-sm text-amber-200">فرصة تحسين: {review.negative}</p> : null}{review.notes ? <p className="mt-2 text-sm text-slate-300">{review.notes}</p> : null}</article>)}{personalState.reviews === 'success' && !reviews.length ? <p className="text-slate-400">لا توجد تقييمات مرتبطة بحسابك.</p> : null}</div></section> : null}

    {tab === 'notifications' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">إشعاراتي الشخصية</h2><div className="mt-4 space-y-3">{notifications.map((item) => { const card = <article className={`rounded-2xl border p-4 ${item.isRead ? 'border-slate-700' : 'border-teal-400/30 bg-teal-500/5'}`}><div className="font-black text-white">{item.title}</div><p className="mt-1 text-sm text-slate-300">{item.message}</p><div className="mt-2 text-xs text-slate-400">{formatDate(item.createdAt)}</div></article>; return item.route ? <a key={item.id} href={item.route}>{card}</a> : <div key={item.id}>{card}</div>; })}</div></section> : null}

    {tab === 'activity' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">سجل نشاطي</h2><div className="mt-4 space-y-3">{events.map((event) => <article key={event.id} className="rounded-2xl border border-slate-700 p-4"><div className="flex justify-between gap-3"><div className="font-black text-white">{event.title || event.category || 'حدث'}</div><div className="text-xs text-slate-400">{formatDate(event.event_at)}</div></div>{event.description ? <p className="mt-2 text-sm text-slate-300">{event.description}</p> : null}<div className="mt-2 text-xs text-slate-400">بواسطة: {event.actor_name || 'النظام'} {number(event.points_delta) ? `· النقاط ${number(event.points_delta)}` : ''}</div></article>)}{personalState.activity === 'success' && !events.length ? <p className="text-slate-400">لا توجد أحداث شخصية مسجلة بعد.</p> : null}</div></section> : null}

    {tab === 'payroll' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">حسابي والقبض</h2><p className="mt-1 text-sm text-slate-400">البيانات المعروضة هي كشوفك الشهرية فقط.</p><div className="mt-4 space-y-3">{payrollRows.map((row) => <article key={String(row.id || row.cycle_end)} className="rounded-2xl border border-slate-700 p-4"><div className="font-black text-white">الدورة حتى {String(row.cycle_end || '—')}</div><div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm text-slate-300"><span>سعر الساعة: {formatCurrency(number(row.hourly_rate))}</span><span>ساعات الحضور: {number(row.attendance_hours)}</span><span>الحوافز: {formatCurrency(number(row.incentive_amount))}</span><span>الخصومات: {formatCurrency(number(row.deduction_amount))}</span><span>الإضافي: {formatCurrency(number(row.overtime_amount))}</span><span className="font-black text-teal-200">الصافي: {formatCurrency(number(row.net_amount))}</span></div></article>)}{personalState.payroll === 'success' && !payrollRows.length ? <p className="text-slate-400">لم يتم اعتماد كشف شهري لحسابك بعد.</p> : null}</div></section> : null}

    {tab === 'rules' ? <section className="rounded-3xl border border-amber-400/20 bg-slate-900/80 p-5"><div className="flex items-center gap-2"><ShieldCheck className="text-amber-300" /><h2 className="text-2xl font-black text-white">قواعد الخدمة وتقييم المحادثة</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{SCORE_RULES.map(([title,score,detail]) => <div key={title} className="rounded-2xl border border-slate-700 p-4"><div className="flex justify-between"><h3 className="font-black text-white">{title}</h3><span className="text-teal-300">{score} درجات</span></div><p className="mt-2 text-sm text-slate-300">{detail}</p></div>)}</div><div className="mt-5 grid gap-3 lg:grid-cols-3">{CHANNEL_RULES.map(({title,icon:Icon,items}) => <div key={title} className="rounded-2xl border border-sky-400/15 p-4"><div className="flex items-center gap-2 font-black text-white"><Icon className="text-sky-300" />{title}</div><ul className="mt-3 space-y-2 text-sm text-slate-300">{items.map((item) => <li key={item}>• {item}</li>)}</ul></div>)}</div></section> : null}
  </div>;
}
