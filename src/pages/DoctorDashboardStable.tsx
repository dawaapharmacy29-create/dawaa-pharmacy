import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Award, BarChart3, Bell, Calendar, CheckCircle2, ClipboardCheck, Clock3,
  DollarSign, ExternalLink, Gift, Headphones, Megaphone, Package, RefreshCw, ShieldCheck,
  Star, Store, Target, TrendingUp, Users, WalletCards,
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
import {
  listStaffNotifications,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
  subscribeToStaffNotifications,
  type StaffNotification,
} from '@/lib/staffNotificationService';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type Tab = 'overview' | 'requirements' | 'performance' | 'followups' | 'reviews' | 'notifications' | 'activity' | 'payroll' | 'offers' | 'rules';
type DoctorRow = SalesAnalyticsSummary['doctorRows'][number];
type Row = Record<string, unknown>;

type PersonalReview = {
  id: string; createdAt: string; kind: string; score: number; impact: number;
  positive: string; negative: string; notes: string; training: string; reviewer: string;
};
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
const WORK_RULE_GROUPS: Array<[string, typeof Store, string[]]> = [
  ['داخل الصيدلية', Store, ['الوقوف واستقبال العميل باهتمام','فهم الطلب قبل إحضار المنتج','شرح الجرعة والاستخدام','عرض بديل مناسب','التأكد من رضا العميل']],
  ['طريقة تنفيذ المطلوب', CheckCircle2, ['ابدأ المهام الجديدة في نفس اليوم','اكتب تقدمًا واضحًا','اطلب المساعدة قبل التأخير','أرسل المهمة للمراجعة بعد الإكمال']],
  ['الالتزام بالوقت', Clock3, ['راجع المواعيد النهائية يوميًا','أنهِ المتابعات في موعدها','لا تترك مهمة متأخرة دون ملاحظة']],
];

function normalizeName(value?: string | null) {
  return String(value || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '').replace(/[\s/_.-]+/g, ' ').trim().toLowerCase();
}
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function text(value: unknown) { return String(value ?? '').trim(); }
function formatDate(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value.slice(0, 16) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'صباح الخير' : hour < 18 ? 'نهارك سعيد' : 'مساء الخير'; }
function branchTarget(branch: string, sales: number) { return BRANCH_TARGETS[normalizeBranchName(branch)] || BRANCH_TARGETS[branch] || Math.max(sales * 1.25, 1); }
async function safeRows(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) { try { const result = await query; return result.error ? [] : (result.data || []) as Row[]; } catch { return []; } }

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: typeof DollarSign }) {
  return <div className="rounded-2xl border border-slate-700/70 bg-slate-900/80 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-slate-300">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div>{hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}</div><div className="rounded-xl bg-teal-500/15 p-3 text-teal-300"><Icon size={20} /></div></div></div>;
}

function Empty({ children }: { children: string }) { return <p className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-sm font-bold text-slate-400">{children}</p>; }

export default function DoctorDashboardStable() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const validTabs: Tab[] = ['overview','requirements','performance','followups','reviews','notifications','activity','payroll','offers','rules'];
  const tab: Tab = validTabs.includes(requestedTab as Tab) ? requestedTab as Tab : 'overview';
  const cycle = useMemo(() => getCurrentCycle(), []);
  const [state, setState] = useState<LoadState>('idle');
  const [summary, setSummary] = useState<SalesAnalyticsSummary | null>(null);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState<PersonalReview[]>([]);
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [events, setEvents] = useState<EmployeeEvent[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [payrollRows, setPayrollRows] = useState<Row[]>([]);
  const [manualPayrollRows, setManualPayrollRows] = useState<Row[]>([]);
  const [offers, setOffers] = useState<Row[]>([]);
  const [stories, setStories] = useState<Row[]>([]);
  const [personalState, setPersonalState] = useState<Record<string, LoadState>>({});

  const branch = text(user?.branch);
  const staffId = text(user?.staffId);
  const doctorName = text(user?.name);
  const selectTab = (next: Tab) => setSearchParams({ tab: next }, { replace: true });

  const setPart = (key: string, value: LoadState) => setPersonalState((current) => ({ ...current, [key]: value }));

  const load = useCallback(async () => {
    if (!branch) { setState('error'); setError('الحساب غير مرتبط بفرع واضح.'); return; }
    setState('loading'); setError('');
    try {
      const result = await loadSalesAnalyticsSummary({ startDate: formatCycleDate(cycle.start), endDate: formatCycleDate(cycle.end), branch }, true);
      setSummary(result); setState('success');
    } catch (loadError) { setState('error'); setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات لوحة الدكتور.'); }
  }, [branch, cycle.end, cycle.start]);

  const loadReviews = useCallback(async () => {
    setPart('reviews', 'loading');
    const queries: Promise<Row[]>[] = [];
    if (staffId) {
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(100)));
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_id', staffId).order('created_at', { ascending: false }).limit(100)));
    }
    const unique = new Map<string, Row>(); (await Promise.all(queries)).flat().forEach((row) => unique.set(text(row.id || `${row.created_at}-${row.doctor_name}`), row));
    setReviews([...unique.values()].sort((a,b) => text(b.created_at).localeCompare(text(a.created_at))).map((row) => ({
      id: text(row.id), createdAt: text(row.created_at || row.conversation_date), kind: text(row.evaluation_kind || row.conversation_type || 'تقييم محادثة'),
      score: number(row.final_score ?? row.total_score), impact: number(row.doctor_points_impact ?? row.point_impact),
      positive: text(row.main_positive_reason), negative: text(row.main_negative_reason), notes: text(row.reviewer_notes),
      training: text(row.training_recommendation), reviewer: text(row.reviewer_name || 'مراجع خدمة العملاء'),
    })));
    setPart('reviews', 'success');
  }, [staffId]);

  const loadNotifications = useCallback(async () => {
    setPart('notifications', 'loading');
    try { setNotifications(await listStaffNotifications(staffId, 120)); setPart('notifications', 'success'); }
    catch { setPart('notifications', 'error'); }
  }, [staffId]);

  const loadAssignments = useCallback(async () => {
    setPart('requirements', 'loading');
    setAssignments(await safeRows(supabase.from('staff_assignments').select('*').eq('assigned_to_staff_id', staffId).order('created_at', { ascending: false }).limit(150)));
    setPart('requirements', 'success');
  }, [staffId]);

  const loadPayroll = useCallback(async () => {
    setPart('payroll', 'loading');
    const [statements, manual] = await Promise.all([
      safeRows(supabase.from('employee_monthly_statements').select('*').eq('staff_id', staffId).order('cycle_end', { ascending: false }).limit(12)),
      safeRows(supabase.from('staff_payroll_manual_entries').select('*').eq('staff_id', staffId).eq('visible_to_staff', true).order('created_at', { ascending: false }).limit(100)),
    ]);
    setPayrollRows(statements); setManualPayrollRows(manual); setPart('payroll', 'success');
  }, [staffId]);

  const loadOffers = useCallback(async () => {
    setPart('offers', 'loading');
    const now = new Date().toISOString();
    const [offerRows, storyRows] = await Promise.all([
      safeRows(supabase.from('offers').select('*').or(`end_date.is.null,end_date.gte.${now}`).order('created_at', { ascending: false }).limit(50)),
      safeRows(supabase.from('stories').select('*').or(`expires_at.is.null,expires_at.gte.${now}`).order('created_at', { ascending: false }).limit(50)),
    ]);
    setOffers(offerRows); setStories(storyRows); setPart('offers', 'success');
  }, []);

  const loadActivity = useCallback(async () => { setPart('activity', 'loading'); setEvents((await getEmployeeEvents(staffId, 200)) as EmployeeEvent[]); setPart('activity', 'success'); }, [staffId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToStaffNotifications(staffId, () => void loadNotifications()), [loadNotifications, staffId]);
  useEffect(() => {
    if (tab === 'reviews' && !personalState.reviews) void loadReviews();
    if (tab === 'notifications' && !personalState.notifications) void loadNotifications();
    if (tab === 'requirements' && !personalState.requirements) void loadAssignments();
    if (tab === 'activity' && !personalState.activity) void loadActivity();
    if (tab === 'payroll' && !personalState.payroll) void loadPayroll();
    if (tab === 'offers' && !personalState.offers) void loadOffers();
  }, [loadActivity, loadAssignments, loadNotifications, loadOffers, loadPayroll, loadReviews, personalState, tab]);

  const doctorRow = useMemo<DoctorRow | null>(() => summary?.doctorRows.find((row) => row.staffId === staffId) || summary?.doctorRows.find((row) => normalizeName(row.doctor) === normalizeName(doctorName)) || null, [doctorName, staffId, summary]);
  const ranking = useMemo(() => summary ? [...summary.doctorRows].sort((a,b) => b.netSales - a.netSales) : [], [summary]);
  const doctorRank = doctorRow ? ranking.findIndex((row) => row.staffId === doctorRow.staffId && row.doctor === doctorRow.doctor) + 1 : 0;
  const branchSales = summary?.kpis.netSales || 0;
  const target = branchTarget(branch, branchSales);
  const achievement = target ? branchSales / target * 100 : 0;
  const unread = notifications.filter((item) => !item.isRead).length;
  const openAssignments = assignments.filter((item) => !['completed','cancelled'].includes(text(item.status)));
  const overdueAssignments = openAssignments.filter((item) => item.due_at && new Date(text(item.due_at)) < new Date());
  const reviewAverage = reviews.length ? reviews.reduce((sum, item) => sum + item.score, 0) / reviews.length : 0;

  const tabs: Array<[Tab,string]> = [
    ['overview','الملخص'],['requirements',`المطلوب مني${openAssignments.length ? ` (${openAssignments.length})` : ''}`],['performance','أدائي وترتيبي'],
    ['followups','متابعاتي'],['reviews','تقييماتي'],['notifications',`إشعاراتي${unread ? ` (${unread})` : ''}`],['activity','سجل نشاطي'],
    ['payroll','القبض والحوافز'],['offers','العروض والاستوريز'],['rules','قواعد الخدمة'],
  ];

  return <div dir="rtl" className="space-y-5 pb-8">
    <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-l from-teal-500/10 via-slate-900 to-sky-500/10 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-sm font-black text-teal-300">مساحة الدكتور الشخصية</div><h1 className="mt-1 text-3xl font-black text-white">{greeting()} يا دكتور {doctorName || 'الزميل'}</h1><p className="mt-2 text-sm text-slate-300">{branch || 'الفرع غير محدد'} — الدورة {cycle.label}</p><p className="mt-1 text-xs font-bold text-sky-200">كل البيانات هنا مرتبطة بحسابك وstaff_id الخاص بك فقط.</p></div><button type="button" onClick={() => { void load(); void loadNotifications(); }} disabled={state === 'loading'} className="btn-primary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} /> تحديث البيانات</button></div></section>

    <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:grid-cols-5 xl:grid-cols-10">{tabs.map(([key,label]) => <button key={key} type="button" onClick={() => selectTab(key)} className={`rounded-xl px-3 py-3 text-sm font-black ${tab === key ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>{label}</button>)}</nav>
    {state === 'error' ? <section className="rounded-3xl border border-red-400/25 bg-red-500/10 p-5 text-red-100">{error}</section> : null}

    {tab === 'overview' ? <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="مبيعاتي في الدورة" value={doctorRow ? formatCurrency(doctorRow.netSales) : 'غير مرتبط'} hint={doctorRow ? `${doctorRow.invoicesCount} فاتورة` : 'راجع staff_id'} icon={DollarSign} /><Metric label="متوسط فاتورتي" value={doctorRow ? formatCurrency(doctorRow.avgInvoice) : '—'} hint={`متوسط الفرع ${formatCurrency(summary?.kpis.avgInvoice || 0)}`} icon={TrendingUp} /><Metric label="ترتيبي في الفرع" value={doctorRank ? `${doctorRank} من ${ranking.length}` : '—'} icon={Award} /><Metric label="المطلوب المفتوح" value={String(openAssignments.length)} hint={overdueAssignments.length ? `${overdueAssignments.length} متأخر` : 'لا توجد مهام متأخرة'} icon={ClipboardCheck} /></section>
      <section className="grid gap-3 lg:grid-cols-3"><button onClick={() => selectTab('requirements')} className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-5 text-right"><div className="flex items-center gap-2 font-black text-amber-100"><Target /> المطلوب مني الآن</div><div className="mt-2 text-3xl font-black text-white">{openAssignments.length}</div><p className="mt-1 text-sm text-amber-100/80">مهام، رواكد، تدريب، تحسين مبيعات ومتابعات.</p></button><button onClick={() => selectTab('reviews')} className="rounded-2xl border border-sky-400/25 bg-sky-500/10 p-5 text-right"><div className="flex items-center gap-2 font-black text-sky-100"><ClipboardCheck /> متوسط تقييماتي</div><div className="mt-2 text-3xl font-black text-white">{reviews.length ? `${reviewAverage.toFixed(1)}%` : 'افتح التقييمات'}</div><p className="mt-1 text-sm text-sky-100/80">كل تقييم جديد يظهر لك مع نقاط القوة والتحسين.</p></button><button onClick={() => selectTab('notifications')} className="rounded-2xl border border-teal-400/25 bg-teal-500/10 p-5 text-right"><div className="flex items-center gap-2 font-black text-teal-100"><Bell /> إشعاراتي غير المقروءة</div><div className="mt-2 text-3xl font-black text-white">{unread}</div><p className="mt-1 text-sm text-teal-100/80">لا تظهر هنا إلا الأحداث الخاصة بك والإعلانات العامة.</p></button></section>
      <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5"><h2 className="text-xl font-black text-white">الوصول السريع</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[
        ['المطلوب مني','requirements',ClipboardCheck],['متابعاتي','followups',Headphones],['تقييماتي','reviews',Star],['القبض والحوافز','payroll',WalletCards],['العروض والاستوريز','offers',Megaphone],
      ].map(([label,key,Icon]) => <button key={String(key)} onClick={() => selectTab(key as Tab)} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 font-black text-slate-100 hover:border-teal-400/50"><Icon size={20} className="text-teal-300" />{String(label)}</button>)}</div></section>
    </> : null}

    {tab === 'requirements' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-white">المطلوب مني</h2><p className="mt-1 text-sm text-slate-400">المهام والرواكد والتدريب وتحسين الخدمة والمبيعات المسندة لك.</p></div><button className="btn-secondary" onClick={() => void loadAssignments()}>تحديث</button></div><div className="mt-4 space-y-3">{assignments.map((item) => { const status = text(item.status || 'new'); const overdue = item.due_at && new Date(text(item.due_at)) < new Date() && !['completed','cancelled'].includes(status); return <article key={text(item.id)} className={`rounded-2xl border p-4 ${overdue ? 'border-red-400/30 bg-red-500/5' : 'border-slate-700'}`}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-black text-white">{text(item.title || 'مطلوب جديد')}</div><p className="mt-1 text-sm text-slate-300">{text(item.description || 'افتح التفاصيل وابدأ التنفيذ.')}</p></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-black text-teal-200">{status}</span></div><div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-slate-400"><span>النوع: {text(item.assignment_type || 'مهمة')}</span><span>الأولوية: {text(item.priority || 'normal')}</span><span>التقدم: {number(item.progress_percent)}%</span>{item.due_at ? <span className={overdue ? 'text-red-300' : ''}>الموعد: {formatDate(text(item.due_at))}</span> : null}{number(item.expected_points) ? <span>النقاط المتوقعة: {number(item.expected_points)}</span> : null}</div>{text(item.manager_notes) ? <p className="mt-3 rounded-xl bg-slate-950/60 p-3 text-sm text-amber-100">ملاحظة المسؤول: {text(item.manager_notes)}</p> : null}</article>; })}{personalState.requirements === 'success' && !assignments.length ? <Empty>لا يوجد مطلوب مسند لك حاليًا.</Empty> : null}</div></section> : null}

    {tab === 'performance' ? <section className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="مبيعاتي" value={formatCurrency(doctorRow?.netSales || 0)} icon={DollarSign} /><Metric label="عدد الفواتير" value={String(doctorRow?.invoicesCount || 0)} icon={BarChart3} /><Metric label="متوسط البيع" value={formatCurrency(doctorRow?.avgInvoice || 0)} icon={TrendingUp} /><Metric label="تقدم الفرع" value={`${achievement.toFixed(1)}%`} hint={`المتبقي ${formatCurrency(Math.max(0,target-branchSales))}`} icon={Target} /></div><section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">ترتيب دكاترة الفرع</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead className="text-slate-400"><tr><th className="p-3">#</th><th className="p-3">الدكتور</th><th className="p-3">المبيعات</th><th className="p-3">الفواتير</th><th className="p-3">المتوسط</th></tr></thead><tbody>{ranking.map((row,index) => <tr key={row.staffId || row.doctor} className={`border-t border-slate-800 ${doctorRow && row.doctor === doctorRow.doctor ? 'bg-teal-500/10' : ''}`}><td className="p-3">{index+1}</td><td className="p-3 font-black text-white">{row.doctor}{doctorRow && row.doctor === doctorRow.doctor ? ' — أنت هنا' : ''}</td><td className="p-3">{formatCurrency(row.netSales)}</td><td className="p-3">{row.invoicesCount}</td><td className="p-3">{formatCurrency(row.avgInvoice)}</td></tr>)}</tbody></table></div></section></section> : null}

    {tab === 'followups' ? <DoctorRequestedFollowups /> : null}

    {tab === 'reviews' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><div className="flex items-center justify-between"><div><h2 className="text-2xl font-black text-white">تقييمات محادثاتي</h2><p className="mt-1 text-sm text-slate-400">كل تقييم مرتبط بـ staff_id الخاص بك فقط.</p></div><button className="btn-secondary" onClick={() => void loadReviews()}>تحديث</button></div>{reviews.length ? <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="عدد التقييمات" value={String(reviews.length)} icon={ClipboardCheck} /><Metric label="متوسط التقييم" value={`${reviewAverage.toFixed(1)}%`} icon={Star} /><Metric label="إجمالي تأثير النقاط" value={String(reviews.reduce((sum,item) => sum + item.impact, 0))} icon={Award} /></div> : null}<div className="mt-4 space-y-3">{reviews.map((review) => <article key={review.id} className="rounded-2xl border border-slate-700 p-4"><div className="flex justify-between gap-3"><div className="font-black text-white">{review.kind}</div><div className="text-xl font-black text-teal-200">{review.score}/100</div></div><div className="mt-2 text-xs text-slate-400">{formatDate(review.createdAt)} · {review.reviewer} · تأثير النقاط {review.impact}</div>{review.positive ? <p className="mt-2 text-sm text-teal-200">نقطة قوة: {review.positive}</p> : null}{review.negative ? <p className="mt-1 text-sm text-amber-200">فرصة تحسين: {review.negative}</p> : null}{review.training ? <p className="mt-2 rounded-xl bg-sky-500/10 p-3 text-sm text-sky-100">المطلوب للتطوير: {review.training}</p> : null}{review.notes ? <p className="mt-2 text-sm text-slate-300">{review.notes}</p> : null}</article>)}{personalState.reviews === 'success' && !reviews.length ? <Empty>لا توجد تقييمات مرتبطة بحسابك حتى الآن.</Empty> : null}</div></section> : null}

    {tab === 'notifications' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-black text-white">إشعاراتي الشخصية</h2><p className="mt-1 text-sm text-slate-400">تقييم، متابعة، إذن، خصم، مكافأة، مهمة أو إعلان يخصك.</p></div>{unread ? <button className="btn-secondary" onClick={async () => { await markAllStaffNotificationsRead(staffId); await loadNotifications(); }}>تحديد الكل كمقروء</button> : null}</div><div className="mt-4 space-y-3">{notifications.map((item) => <button key={item.id} className={`block w-full rounded-2xl border p-4 text-right transition ${item.isRead ? 'border-slate-700' : item.priority === 'urgent' || item.priority === 'high' ? 'border-red-400/40 bg-red-500/10' : 'border-teal-400/40 bg-teal-500/10'}`} onClick={async () => { if (!item.isRead) { await markStaffNotificationRead(item.id); await loadNotifications(); } if (item.actionUrl) window.location.href = item.actionUrl; }}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-black text-white"><Bell size={18} />{item.title}</div><p className="mt-2 text-sm text-slate-300">{item.message}</p></div>{item.actionUrl ? <ExternalLink size={17} className="text-teal-300" /> : null}</div><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-400"><span>{formatDate(item.createdAt)}</span><span>النوع: {item.type}</span><span>الأولوية: {item.priority}</span>{!item.isRead ? <span className="text-teal-200">جديد</span> : null}</div></button>)}{personalState.notifications === 'success' && !notifications.length ? <Empty>لا توجد إشعارات شخصية أو عامة حاليًا.</Empty> : null}</div></section> : null}

    {tab === 'activity' ? <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">سجل نشاطي</h2><div className="mt-4 space-y-3">{events.map((event) => <article key={event.id} className="rounded-2xl border border-slate-700 p-4"><div className="flex justify-between gap-3"><div className="font-black text-white">{event.title || event.category || 'حدث'}</div><div className="text-xs text-slate-400">{formatDate(event.event_at)}</div></div>{event.description ? <p className="mt-2 text-sm text-slate-300">{event.description}</p> : null}<div className="mt-2 text-xs text-slate-400">بواسطة: {event.actor_name || 'النظام'} {number(event.points_delta) ? `· النقاط ${number(event.points_delta)}` : ''}</div></article>)}{personalState.activity === 'success' && !events.length ? <Empty>لا توجد أحداث شخصية مسجلة بعد.</Empty> : null}</div></section> : null}

    {tab === 'payroll' ? <section className="space-y-4"><div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h2 className="text-2xl font-black text-white">تفاصيل القبض والحوافز</h2><p className="mt-1 text-sm text-slate-400">تشاهد فقط كشفك والبنود اليدوية المسموح بإظهارها لك.</p><div className="mt-4 space-y-3">{payrollRows.map((row) => <article key={text(row.id || row.cycle_end)} className="rounded-2xl border border-slate-700 p-4"><div className="font-black text-white">الدورة حتى {text(row.cycle_end || '—')}</div><div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm text-slate-300"><span>الأساسي: {formatCurrency(number(row.base_salary))}</span><span>ساعات الحضور: {number(row.attendance_hours)}</span><span>الحوافز: {formatCurrency(number(row.incentive_amount))}</span><span>الخصومات: {formatCurrency(number(row.deduction_amount))}</span><span>الإضافي: {formatCurrency(number(row.overtime_amount))}</span><span className="font-black text-teal-200">الصافي: {formatCurrency(number(row.net_amount))}</span></div></article>)}{personalState.payroll === 'success' && !payrollRows.length ? <Empty>لم يتم اعتماد كشف شهري لحسابك بعد.</Empty> : null}</div></div><div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5"><h3 className="text-xl font-black text-white">تفاصيل يدوية من الإدارة</h3><div className="mt-4 space-y-3">{manualPayrollRows.map((row) => <article key={text(row.id)} className="rounded-2xl border border-slate-700 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-white">{text(row.title)}</div><p className="mt-1 text-sm text-slate-300">{text(row.details)}</p></div><div className={`text-lg font-black ${text(row.entry_type) === 'deduction' ? 'text-red-300' : 'text-teal-200'}`}>{formatCurrency(number(row.amount))}</div></div><div className="mt-2 text-xs text-slate-400">{text(row.entry_type)} · {text(row.cycle_start)} إلى {text(row.cycle_end)}</div></article>)}{!manualPayrollRows.length ? <Empty>لا توجد بنود يدوية ظاهرة لك في هذه الدورة.</Empty> : null}</div></div></section> : null}

    {tab === 'offers' ? <section className="space-y-4"><div className="rounded-3xl border border-teal-400/20 bg-slate-900/80 p-5"><div className="flex items-center gap-2"><Megaphone className="text-teal-300" /><h2 className="text-2xl font-black text-white">العروض الحالية</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{offers.map((item) => <article key={text(item.id)} className="rounded-2xl border border-slate-700 p-4"><div className="font-black text-white">{text(item.title || item.name || 'عرض جديد')}</div><p className="mt-2 text-sm text-slate-300">{text(item.description || item.details)}</p><div className="mt-3 text-xs text-slate-400">حتى {text(item.end_date || 'إشعار آخر')}</div></article>)}{personalState.offers === 'success' && !offers.length ? <Empty>لا توجد عروض نشطة حاليًا.</Empty> : null}</div></div><div className="rounded-3xl border border-sky-400/20 bg-slate-900/80 p-5"><div className="flex items-center gap-2"><Gift className="text-sky-300" /><h2 className="text-2xl font-black text-white">الاستوريز والإعلانات</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{stories.map((item) => <article key={text(item.id)} className="rounded-2xl border border-slate-700 p-4"><div className="font-black text-white">{text(item.title || 'استوري جديدة')}</div><p className="mt-2 text-sm text-slate-300">{text(item.description || item.content)}</p><div className="mt-3 text-xs text-slate-400">{formatDate(text(item.created_at))}</div></article>)}{personalState.offers === 'success' && !stories.length ? <Empty>لا توجد استوريز نشطة حاليًا.</Empty> : null}</div></div></section> : null}

    {tab === 'rules' ? <section className="rounded-3xl border border-amber-400/20 bg-slate-900/80 p-5"><div className="flex items-center gap-2"><ShieldCheck className="text-amber-300" /><h2 className="text-2xl font-black text-white">قواعد الخدمة وتقييم المحادثة</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{SCORE_RULES.map(([title,score,detail]) => <div key={title} className="rounded-2xl border border-slate-700 p-4"><div className="flex justify-between"><h3 className="font-black text-white">{title}</h3><span className="text-teal-300">{score} درجات</span></div><p className="mt-2 text-sm text-slate-300">{detail}</p></div>)}</div><div className="mt-5 grid gap-3 lg:grid-cols-3">{WORK_RULE_GROUPS.map(([title,Icon,items]) => <div key={title} className="rounded-2xl border border-sky-400/15 p-4"><div className="flex items-center gap-2 font-black text-white"><Icon className="text-sky-300" />{title}</div><ul className="mt-3 space-y-2 text-sm text-slate-300">{items.map((item) => <li key={item}>• {item}</li>)}</ul></div>)}</div></section> : null}
  </div>;
}
