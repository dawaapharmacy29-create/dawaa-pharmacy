import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Award, Bell, CheckCircle2, ClipboardList, Filter, Headphones,
  MessageCircle, PieChart as PieChartIcon, RefreshCw, Star, Timer, Trophy, Users,
} from 'lucide-react';
import {
  Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import {
  fetchCustomerServiceFollowups,
  calculateFollowupStats,
  calculateTeamPerformance,
  type FollowupRow,
  type FollowupStats,
  type FollowupPerformanceRow,
} from '@/lib/api/customerServiceCommandCenter';
import CustomerServicePersonalDashboard from '@/components/customerService/CustomerServicePersonalDashboard';
import { ManagerLiveIncentiveCard } from '@/components/evaluations/ManagerLiveIncentiveCard';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };
const ALL = 'الكل';
const BRANCHES = ['فرع الشامي', 'فرع شكري'];
const DATE_RANGES = [
  { key: '7', label: 'آخر 7 أيام' },
  { key: '30', label: 'آخر 30 يوم' },
  { key: '90', label: 'آخر 3 شهور' },
];

type SourceKey = 'followups' | 'reviews' | 'welcome' | 'requests';
type SourceStatus = 'loading' | 'ready' | 'error';

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => window.clearTimeout(id));
  });
}

function KpiCard({ icon: Icon, label, value, sourceStatus, tone }: { icon: any; label: string; value: string | number; sourceStatus: SourceStatus; tone?: string }) {
  const shown = sourceStatus === 'loading' ? '…' : sourceStatus === 'error' ? '—' : value;
  return <div className={`rounded-2xl border p-4 ${sourceStatus === 'error' ? 'border-dashed border-amber-400/35' : ''}`} style={surface}>
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300"><Icon size={18} /></div>
      {tone ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${tone}`}>مباشر</span> : null}
    </div>
    <div className="mt-3 text-2xl font-black text-white">{shown}</div>
    <div className="mt-1 text-xs font-bold" style={mutedText}>{label}</div>
    {sourceStatus === 'error' ? <div className="mt-2 text-[10px] font-bold text-amber-300">المصدر غير متاح — ليست صفرًا</div> : null}
  </div>;
}

export default function CustomerServiceManagerDashboard() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(allBranches ? ALL : ownBranch);
  const [responsible, setResponsible] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [dateRange, setDateRange] = useState('30');
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [reviewsSummary, setReviewsSummary] = useState({ count: 0, avgScore: 0 });
  const [welcomeSummary, setWelcomeSummary] = useState({ sent: 0, replied: 0 });
  const [openRequests, setOpenRequests] = useState(0);
  const [sources, setSources] = useState<Record<SourceKey, SourceStatus>>({ followups: 'loading', reviews: 'loading', welcome: 'loading', requests: 'loading' });
  const [errors, setErrors] = useState<Partial<Record<SourceKey, string>>>({});
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;
    setSources({ followups: 'loading', reviews: 'loading', welcome: 'loading', requests: 'loading' });
    setErrors({});
    const branchFilter = branch === ALL ? undefined : branch;
    const since = daysAgoIso(Number(dateRange));

    const setSource = (key: SourceKey, sourceStatus: SourceStatus, error?: unknown) => {
      if (!isCurrent()) return;
      setSources((prev) => ({ ...prev, [key]: sourceStatus }));
      if (error) setErrors((prev) => ({ ...prev, [key]: error instanceof Error ? error.message : String(error) }));
    };

    withTimeout(fetchCustomerServiceFollowups({
      branch: branchFilter,
      status: status === ALL ? undefined : status,
      responsible: responsible === ALL ? undefined : responsible,
      limit: 500,
    }), 10000, 'customer-service-followups')
      .then((rows) => {
        if (!isCurrent()) return;
        setFollowups(rows);
        setSource('followups', 'ready');
      })
      .catch((error) => {
        console.error('[CustomerServiceManagerDashboard] followups failed', error);
        setSource('followups', 'error', error);
      });

    let reviewsQuery = supabase
      .from('conversation_sales_reviews')
      .select('final_score,total_score,branch,created_at')
      .gte('created_at', since)
      .limit(2000);
    if (branchFilter) reviewsQuery = reviewsQuery.eq('branch', branchFilter);
    withTimeout(reviewsQuery, 10000, 'customer-service-reviews')
      .then((result: any) => {
        if (!isCurrent()) return;
        if (result.error) throw result.error;
        const rows = result.data || [];
        const scores = rows.map((r: any) => Number(r.final_score ?? r.total_score ?? 0)).filter((n: number) => Number.isFinite(n) && n > 0);
        setReviewsSummary({ count: rows.length, avgScore: scores.length ? Math.round((scores.reduce((a: number, b: number) => a + b, 0) / scores.length) * 10) / 10 : 0 });
        setSource('reviews', 'ready');
      })
      .catch((error) => {
        console.error('[CustomerServiceManagerDashboard] reviews failed', error);
        setSource('reviews', 'error', error);
      });

    let welcomeQuery = supabase
      .from('customer_welcome_tasks')
      .select('welcome_message_sent_at,customer_replied_at,branch,created_at')
      .gte('created_at', since)
      .limit(2000);
    if (branchFilter) welcomeQuery = welcomeQuery.eq('branch', branchFilter);
    withTimeout(welcomeQuery, 10000, 'customer-service-welcome')
      .then((result: any) => {
        if (!isCurrent()) return;
        if (result.error) throw result.error;
        const rows = result.data || [];
        setWelcomeSummary({ sent: rows.filter((r: any) => r.welcome_message_sent_at).length, replied: rows.filter((r: any) => r.customer_replied_at).length });
        setSource('welcome', 'ready');
      })
      .catch((error) => {
        console.error('[CustomerServiceManagerDashboard] welcome failed', error);
        setSource('welcome', 'error', error);
      });

    let requestsQuery = supabase
      .from('customer_requests')
      .select('id,status,branch', { count: 'exact', head: true })
      .not('status', 'in', '("مكتمل","مغلق","completed","closed")');
    if (branchFilter) requestsQuery = requestsQuery.eq('branch', branchFilter);
    withTimeout(requestsQuery, 10000, 'customer-service-open-requests')
      .then((result: any) => {
        if (!isCurrent()) return;
        if (result.error) throw result.error;
        setOpenRequests(Number(result.count || 0));
        setSource('requests', 'ready');
      })
      .catch((error) => {
        console.error('[CustomerServiceManagerDashboard] open requests failed', error);
        setSource('requests', 'error', error);
      });
  }, [branch, status, responsible, dateRange]);

  useEffect(() => { load(); return () => { requestIdRef.current += 1; }; }, [load]);

  const loading = Object.values(sources).some((value) => value === 'loading');
  const failedSources = Object.keys(errors) as SourceKey[];
  const stats: FollowupStats = useMemo(() => calculateFollowupStats(followups), [followups]);
  const team: FollowupPerformanceRow[] = useMemo(() => calculateTeamPerformance(followups).sort((a, b) => b.completionRate - a.completionRate), [followups]);
  const uniqueCustomers = useMemo(() => new Set(followups.map((row) => (row as any).customer_code || (row as any).customer_phone || (row as any).customer_name)).size, [followups]);
  const responsibleOptions = useMemo(() => [ALL, ...Array.from(new Set(team.map((row) => row.responsible).filter(Boolean)))], [team]);
  const welcomeResponseRate = welcomeSummary.sent ? Math.round((welcomeSummary.replied / welcomeSummary.sent) * 100) : 0;

  return <div className="space-y-5 p-4 md:p-6" dir="rtl">
    {user?.name && !allBranches ? <>
      <CustomerServicePersonalDashboard branch={ownBranch} staffName={user.name} />
      <ManagerLiveIncentiveCard evaluationType="customer_service" staffId={user.staffId || user.id} branch={ownBranch} />
    </> : <div className="flex flex-col gap-3 rounded-3xl border p-5 md:flex-row md:items-center md:justify-between" style={surface}>
      <div><div className="flex items-center gap-2 text-teal-200"><Headphones size={18} /><span className="text-xs font-black">لوحة مديرة خدمة العملاء</span></div><h1 className="mt-1 text-2xl font-black text-white">أهلًا يا {user?.name || 'مديرة خدمة العملاء'}</h1><p className="mt-1 text-sm" style={mutedText}>{allBranches ? 'كل الفروع' : ownBranch} · نظرة شاملة على المتابعات وأداء الفريق</p></div>
      <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
    </div>}

    <div className="flex items-center gap-3 rounded-2xl border-2 border-teal-400/30 bg-teal-500/10 p-4">
      <Users size={20} className="shrink-0 text-teal-300" /><div className="flex-1"><div className="text-sm font-black text-white">نظرة عامة على الفرع بالكامل (كل الفريق)</div><div className="text-xs" style={mutedText}>الأرقام من هنا لتحت تخص فريق الفرع، وكل مصدر له حالة تحميل مستقلة.</div></div><button onClick={load} className="btn-secondary flex shrink-0 items-center gap-2 text-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث أرقام الفرع</button>
    </div>

    {failedSources.length ? <div className="flex items-start gap-2 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 text-xs font-bold text-amber-100"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>تعذر تحميل {failedSources.length} مصدر مؤقتًا. أي بطاقة مرتبطة به تظهر (—) بدل رقم صفر، وباقي المصادر تظل متاحة.</span></div> : null}

    <div className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={surfaceSoft}>
      <Filter size={16} className="text-teal-300" />
      {allBranches ? <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}><option value={ALL}>كل الفروع</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select> : null}
      <select className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)}>{responsibleOptions.map((r) => <option key={r} value={r}>{r === ALL ? 'كل الموظفين' : r}</option>)}</select>
      <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value={ALL}>كل الحالات</option><option value="متأخرة">متأخرة</option><option value="يحتاج مدير">يحتاج مدير</option><option value="مكتمل">مكتمل</option></select>
      <select className="input" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>{DATE_RANGES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard icon={ClipboardList} label="متابعات اليوم" value={stats.totalToday} sourceStatus={sources.followups} tone="bg-teal-400/15 text-teal-200" />
      <KpiCard icon={CheckCircle2} label="مكتملة" value={stats.completed} sourceStatus={sources.followups} />
      <KpiCard icon={AlertTriangle} label="متأخرة" value={stats.overdue} sourceStatus={sources.followups} />
      <KpiCard icon={Bell} label="تحتاج مدير" value={stats.needsManager} sourceStatus={sources.followups} />
      <KpiCard icon={Users} label="عملاء تمت متابعتهم" value={uniqueCustomers} sourceStatus={sources.followups} />
      <KpiCard icon={Star} label="متوسط تقييم المحادثات" value={reviewsSummary.avgScore || '—'} sourceStatus={sources.reviews} />
      <KpiCard icon={MessageCircle} label="رسائل ترحيبية مُرسلة" value={welcomeSummary.sent} sourceStatus={sources.welcome} />
      <KpiCard icon={Timer} label="نسبة رد العملاء على الترحيب" value={`${welcomeResponseRate}%`} sourceStatus={sources.welcome} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 font-black text-teal-200"><PieChartIcon size={18} /> توزيع حالات المتابعات</div>
        {sources.followups === 'error' ? <p className="mt-4 text-sm font-bold text-amber-200">تعذر تحميل المتابعات؛ لا يتم عرض مخطط فارغ كأنه حقيقة.</p> : sources.followups === 'loading' ? <div className="mt-5 h-52 animate-pulse rounded-2xl bg-slate-800/50" /> : stats.totalToday ? <ResponsiveContainer width="100%" height={220}><PieChart><Pie data={[{ name: 'مكتملة', value: stats.completed, color: '#34d399' }, { name: 'متأخرة', value: stats.overdue, color: '#fb7185' }, { name: 'تحتاج مدير', value: stats.needsManager, color: '#f59e0b' }, { name: 'لا يوجد رد', value: stats.noAnswer, color: '#94a3b8' }, { name: 'مؤجلة', value: stats.postponed, color: '#38bdf8' }].filter((d) => d.value > 0)} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>{[{ color: '#34d399' }, { color: '#fb7185' }, { color: '#f59e0b' }, { color: '#94a3b8' }, { color: '#38bdf8' }].map((d, i) => <Cell key={i} fill={d.color} />)}</Pie><Tooltip contentStyle={{ background: '#0f1d33', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }} /><Legend formatter={(value) => <span style={{ color: '#cbd5e1', fontSize: 12 }}>{value}</span>} /></PieChart></ResponsiveContainer> : <p className="mt-4 text-sm" style={mutedText}>لا توجد متابعات فعلية مطابقة للفلاتر المختارة.</p>}
      </div>

      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 font-black text-teal-200"><Award size={18} /> نسبة الإنجاز لكل موظف</div>
        {sources.followups === 'error' ? <p className="mt-4 text-sm font-bold text-amber-200">تعذر حساب أداء الفريق لأن مصدر المتابعات غير متاح.</p> : sources.followups === 'loading' ? <div className="mt-5 h-52 animate-pulse rounded-2xl bg-slate-800/50" /> : team.length ? <ResponsiveContainer width="100%" height={220}><BarChart data={team.slice(0, 8)} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 0 }}><XAxis type="number" domain={[0, 100]} hide /><YAxis type="category" dataKey="responsible" width={90} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={{ background: '#0f1d33', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }} formatter={(value: number) => [`${value}%`, 'نسبة الإنجاز']} /><Bar dataKey="completionRate" radius={[0, 8, 8, 0]} barSize={16}>{team.slice(0, 8).map((_, i) => <Cell key={i} fill={i === 0 ? '#2dd4bf' : 'rgba(255,255,255,0.18)'} />)}</Bar></BarChart></ResponsiveContainer> : <p className="mt-4 text-sm" style={mutedText}>لا توجد بيانات أداء فعلية مطابقة للفلاتر.</p>}
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 font-black text-teal-200"><Award size={18} /> أداء فريق خدمة العملاء</div>
        {sources.followups === 'ready' && team.length ? <div className="mt-3 space-y-2">{team.slice(0, 10).map((row, index) => <div key={`${row.responsible}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm" style={surfaceSoft}><div className="flex items-center gap-2">{index === 0 ? <Trophy size={16} className="text-amber-300" /> : <span className="w-4 text-center text-xs" style={mutedText}>{index + 1}</span>}<div><div className="font-black text-white">{row.responsible || 'غير محدد'}</div><div className="mt-0.5 text-xs" style={mutedText}>{row.branch} · {row.assigned} متابعة مسندة</div></div></div><div className="flex items-center gap-4 text-xs font-bold"><span className="text-emerald-300">{row.completionRate}% إنجاز</span>{row.avgQualityRating != null ? <span className="text-amber-200">{row.avgQualityRating}/5 جودة</span> : null}</div></div>)}</div> : <p className={`mt-4 text-sm ${sources.followups === 'error' ? 'font-bold text-amber-200' : ''}`} style={sources.followups === 'error' ? undefined : mutedText}>{sources.followups === 'loading' ? 'جاري تحميل أداء الفريق…' : sources.followups === 'error' ? 'تعذر تحميل مصدر المتابعات.' : 'لا توجد بيانات فعلية للفلاتر المختارة.'}</p>}
      </div>

      <div className="space-y-4">
        <div className={`rounded-3xl border p-5 ${sources.requests === 'error' ? 'border-dashed border-amber-400/35' : ''}`} style={surface}><div className="flex items-center gap-2 font-black text-teal-200"><Activity size={18} /> طلبات العملاء المفتوحة</div><div className="mt-3 text-3xl font-black text-white">{sources.requests === 'loading' ? '…' : sources.requests === 'error' ? '—' : openRequests}</div><p className="mt-1 text-xs" style={mutedText}>{sources.requests === 'error' ? 'تعذر المصدر — ليست صفرًا.' : 'طلبات أدوية أو استفسارات لسه محتاجة متابعة أو غلق.'}</p></div>
        <div className={`rounded-3xl border p-5 ${sources.welcome === 'error' ? 'border-dashed border-amber-400/35' : ''}`} style={surface}><div className="flex items-center gap-2 font-black text-teal-200"><MessageCircle size={18} /> تفاصيل الرسائل الترحيبية</div>{sources.welcome === 'error' ? <p className="mt-3 text-xs font-bold text-amber-200">تعذر تحميل المصدر.</p> : sources.welcome === 'loading' ? <p className="mt-3 text-xs" style={mutedText}>جاري التحميل…</p> : <div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span style={mutedText}>مُرسلة</span><span className="font-black text-white">{welcomeSummary.sent}</span></div><div className="flex justify-between"><span style={mutedText}>ردّ عليها العميل</span><span className="font-black text-white">{welcomeSummary.replied}</span></div><div className="flex justify-between"><span style={mutedText}>نسبة الرد</span><span className="font-black text-teal-300">{welcomeResponseRate}%</span></div></div>}</div>
      </div>
    </div>
  </div>;
}
