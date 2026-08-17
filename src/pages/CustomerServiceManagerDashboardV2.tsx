import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, CheckCircle2, ClipboardList, Filter, Headphones, MessageCircle,
  RefreshCw, Star, Timer, Trophy, Users,
} from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import CustomerServicePersonalDashboard from '@/components/customerService/CustomerServicePersonalDashboard';
import { ManagerLiveIncentiveCard } from '@/components/evaluations/ManagerLiveIncentiveCard';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const soft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const muted = { color: 'var(--dawaa-theme-muted)' };
const ALL = 'الكل';
const BRANCHES = ['فرع الشامي', 'فرع شكري'];
const DATE_RANGES = [
  { key: '7', label: 'آخر 7 أيام' },
  { key: '30', label: 'آخر 30 يوم' },
  { key: '90', label: 'آخر 3 شهور' },
];

type SourceKey = 'followups' | 'reviews' | 'welcome' | 'requests';
type SourceState = 'loading' | 'ready' | 'error';
type FollowupSummary = {
  total_today: number;
  period_total: number;
  completed: number;
  no_answer: number;
  postponed: number;
  overdue: number;
  needs_manager: number;
  purchase_after_count: number;
  purchase_after_amount: number;
  unique_customers: number;
};
type TeamRow = {
  responsible_key: string;
  responsible: string;
  branch: string;
  assigned: number;
  completed: number;
  overdue: number;
  no_answer: number;
  postponed: number;
  needs_manager: number;
  purchase_after_count: number;
  purchase_after_amount: number;
  avg_quality_rating: number | null;
  completion_rate: number;
};

type AggregatePayload = { start_date: string; end_date: string; summary: FollowupSummary; team: TeamRow[] };

const emptySummary: FollowupSummary = {
  total_today: 0, period_total: 0, completed: 0, no_answer: 0, postponed: 0,
  overdue: 0, needs_manager: 0, purchase_after_count: 0, purchase_after_amount: 0,
  unique_customers: 0,
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rangeStart(days: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(0, days - 1));
  return localDateKey(d);
}

function dayStartIso(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(0, days - 1));
  return d.toISOString();
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(resolve, reject).finally(() => window.clearTimeout(id));
  });
}

function Kpi({ icon: Icon, label, value, state, hint, live = false }: {
  icon: any; label: string; value: string | number; state: SourceState; hint?: string; live?: boolean;
}) {
  const shown = state === 'loading' ? '…' : state === 'error' ? '—' : value;
  return <div className={`rounded-2xl border p-4 ${state === 'error' ? 'border-dashed border-amber-400/35' : ''}`} style={surface}>
    <div className="flex items-center justify-between gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300"><Icon size={18} /></div>
      {live ? <span className="rounded-full bg-teal-400/15 px-2 py-0.5 text-[10px] font-black text-teal-200">مباشر</span> : null}
    </div>
    <div className="mt-3 text-2xl font-black text-white">{shown}</div>
    <div className="mt-1 text-xs font-bold" style={muted}>{label}</div>
    {state === 'ready' && hint ? <div className="mt-1 text-[10px] font-bold text-slate-500">{hint}</div> : null}
    {state === 'error' ? <div className="mt-2 text-[10px] font-bold text-amber-300">المصدر غير متاح — ليست صفرًا</div> : null}
  </div>;
}

export default function CustomerServiceManagerDashboardV2() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(allBranches ? ALL : ownBranch);
  const [responsible, setResponsible] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [dateRange, setDateRange] = useState('30');
  const [summary, setSummary] = useState<FollowupSummary>(emptySummary);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [responsibleOptions, setResponsibleOptions] = useState<string[]>([ALL]);
  const [reviews, setReviews] = useState({ count: 0, avg: 0 });
  const [welcome, setWelcome] = useState({ sent: 0, replied: 0 });
  const [openRequests, setOpenRequests] = useState(0);
  const [sources, setSources] = useState<Record<SourceKey, SourceState>>({ followups: 'loading', reviews: 'loading', welcome: 'loading', requests: 'loading' });
  const [errors, setErrors] = useState<Partial<Record<SourceKey, string>>>({});
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const id = ++requestIdRef.current;
    const current = () => id === requestIdRef.current;
    const days = Number(dateRange);
    const branchFilter = branch === ALL ? null : branch;
    const startDate = rangeStart(days);
    const endDate = localDateKey(new Date());
    const sinceIso = dayStartIso(days);
    setSources({ followups: 'loading', reviews: 'loading', welcome: 'loading', requests: 'loading' });
    setErrors({});

    const settle = (key: SourceKey, state: SourceState, error?: unknown) => {
      if (!current()) return;
      setSources((prev) => ({ ...prev, [key]: state }));
      if (error) setErrors((prev) => ({ ...prev, [key]: error instanceof Error ? error.message : String(error) }));
    };

    withTimeout(
      supabase.rpc('get_cs_manager_followup_summary_v1', {
        p_branch: branchFilter,
        p_start: startDate,
        p_end: endDate,
        p_responsible: responsible === ALL ? null : responsible,
        p_status: status === ALL ? null : status,
      }),
      10000,
      'cs-manager-followup-summary'
    ).then((result: any) => {
      if (!current()) return;
      if (result.error) throw result.error;
      const payload = (result.data || {}) as AggregatePayload;
      setSummary({ ...emptySummary, ...(payload.summary || {}) });
      const nextTeam = Array.isArray(payload.team) ? payload.team : [];
      setTeam(nextTeam);
      setResponsibleOptions((prev) => {
        const next = new Set<string>(branch === ALL ? [ALL] : prev);
        next.add(ALL);
        nextTeam.forEach((row) => { if (row.responsible) next.add(row.responsible); });
        return [...next];
      });
      settle('followups', 'ready');
    }).catch((error) => {
      console.error('[CustomerServiceManagerDashboardV2] aggregate failed', error);
      settle('followups', 'error', error);
    });

    let reviewsQuery = supabase.from('conversation_sales_reviews').select('final_score,total_score,branch,created_at').gte('created_at', sinceIso).limit(5000);
    if (branchFilter) reviewsQuery = reviewsQuery.eq('branch', branchFilter);
    withTimeout(reviewsQuery, 10000, 'cs-manager-reviews').then((result: any) => {
      if (!current()) return;
      if (result.error) throw result.error;
      const rows = result.data || [];
      const scores = rows.map((row: any) => Number(row.final_score ?? row.total_score ?? 0)).filter((n: number) => Number.isFinite(n) && n > 0);
      setReviews({ count: rows.length, avg: scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length * 10) / 10 : 0 });
      settle('reviews', 'ready');
    }).catch((error) => settle('reviews', 'error', error));

    let welcomeQuery = supabase.from('customer_welcome_tasks').select('welcome_message_sent_at,customer_replied_at,branch,created_at').gte('created_at', sinceIso).limit(5000);
    if (branchFilter) welcomeQuery = welcomeQuery.eq('branch', branchFilter);
    withTimeout(welcomeQuery, 10000, 'cs-manager-welcome').then((result: any) => {
      if (!current()) return;
      if (result.error) throw result.error;
      const rows = result.data || [];
      setWelcome({ sent: rows.filter((row: any) => row.welcome_message_sent_at).length, replied: rows.filter((row: any) => row.customer_replied_at).length });
      settle('welcome', 'ready');
    }).catch((error) => settle('welcome', 'error', error));

    let requestsQuery = supabase.from('customer_requests').select('id,status,branch', { count: 'exact', head: true }).not('status', 'in', '("مكتمل","مغلق","completed","closed")');
    if (branchFilter) requestsQuery = requestsQuery.eq('branch', branchFilter);
    withTimeout(requestsQuery, 10000, 'cs-manager-open-requests').then((result: any) => {
      if (!current()) return;
      if (result.error) throw result.error;
      setOpenRequests(Number(result.count || 0));
      settle('requests', 'ready');
    }).catch((error) => settle('requests', 'error', error));
  }, [branch, responsible, status, dateRange]);

  useEffect(() => { load(); return () => { requestIdRef.current += 1; }; }, [load]);
  useEffect(() => { setResponsible(ALL); setResponsibleOptions([ALL]); }, [branch, dateRange]);

  const loading = Object.values(sources).some((state) => state === 'loading');
  const failed = Object.keys(errors) as SourceKey[];
  const welcomeRate = welcome.sent ? Math.round(welcome.replied / welcome.sent * 100) : 0;
  const periodLabel = DATE_RANGES.find((item) => item.key === dateRange)?.label || 'الفترة المختارة';
  const chartRows = useMemo(() => [...team].sort((a, b) => b.completion_rate - a.completion_rate).slice(0, 10), [team]);

  return <div className="space-y-5 p-4 md:p-6" dir="rtl">
    {user?.name && !allBranches ? <>
      <CustomerServicePersonalDashboard branch={ownBranch} staffName={user.name} />
      <ManagerLiveIncentiveCard evaluationType="customer_service" staffId={user.staffId || user.id} branch={ownBranch} />
    </> : <div className="flex flex-col gap-3 rounded-3xl border p-5 md:flex-row md:items-center md:justify-between" style={surface}>
      <div><div className="flex items-center gap-2 text-teal-200"><Headphones size={18} /><span className="text-xs font-black">لوحة مدير خدمة العملاء</span></div><h1 className="mt-1 text-2xl font-black text-white">أهلًا يا {user?.name || 'مدير خدمة العملاء'}</h1><p className="mt-1 text-sm" style={muted}>أرقام تشغيلية دقيقة حسب الفترة والفلاتر المختارة</p></div>
      <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
    </div>}

    <div className="flex items-center gap-3 rounded-2xl border-2 border-teal-400/30 bg-teal-500/10 p-4">
      <Users size={20} className="shrink-0 text-teal-300" />
      <div className="flex-1"><div className="text-sm font-black text-white">حقيقة المتابعات — {periodLabel}</div><div className="text-xs" style={muted}>«متابعات اليوم» تحسب الموعد الفعلي لليوم فقط. باقي مؤشرات المتابعات تخص الفترة المختارة كاملة بدون حد 500 صف.</div></div>
      <button onClick={load} className="btn-secondary flex shrink-0 items-center gap-2 text-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث</button>
    </div>

    {failed.length ? <div className="flex items-start gap-2 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 text-xs font-bold text-amber-100"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>تعذر تحميل {failed.length} مصدر مؤقتًا. المصدر المتعطل يظهر (—) ولا يتحول إلى صفر.</span></div> : null}

    <div className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={soft}>
      <Filter size={16} className="text-teal-300" />
      {allBranches ? <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}><option value={ALL}>كل الفروع</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select> : null}
      <select className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)}>{responsibleOptions.map((name) => <option key={name} value={name}>{name === ALL ? 'كل الموظفين' : name}</option>)}</select>
      <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value={ALL}>كل الحالات</option><option value="متأخرة">متأخرة</option><option value="يحتاج مدير">يحتاج مدير</option><option value="مكتمل">مكتمل</option></select>
      <select className="input" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>{DATE_RANGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Kpi icon={ClipboardList} label="متابعات اليوم" value={summary.total_today} state={sources.followups} live hint="موعدها الفعلي اليوم" />
      <Kpi icon={Users} label="إجمالي متابعات الفترة" value={summary.period_total} state={sources.followups} hint={periodLabel} />
      <Kpi icon={CheckCircle2} label="مكتملة في الفترة" value={summary.completed} state={sources.followups} />
      <Kpi icon={AlertTriangle} label="متأخرة" value={summary.overdue} state={sources.followups} />
      <Kpi icon={Bell} label="تحتاج مدير" value={summary.needs_manager} state={sources.followups} />
      <Kpi icon={Users} label="عملاء مختلفون" value={summary.unique_customers} state={sources.followups} />
      <Kpi icon={Star} label="متوسط تقييم المحادثات" value={reviews.avg || '—'} state={sources.reviews} hint={`${reviews.count} تقييم في الفترة`} />
      <Kpi icon={MessageCircle} label="رسائل ترحيبية مُرسلة" value={welcome.sent} state={sources.welcome} />
      <Kpi icon={Timer} label="نسبة رد العملاء على الترحيب" value={`${welcomeRate}%`} state={sources.welcome} />
      <Kpi icon={ClipboardList} label="طلبات عملاء مفتوحة الآن" value={openRequests} state={sources.requests} />
    </div>

    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 font-black text-teal-200"><Trophy size={18} /> أداء فريق خدمة العملاء — {periodLabel}</div>
        {sources.followups === 'ready' && chartRows.length ? <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="responsible" width={92} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={{ background: '#0f1d33', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }} formatter={(value: number) => [`${value}%`, 'نسبة الإنجاز']} />
            <Bar dataKey="completion_rate" radius={[0, 8, 8, 0]} barSize={17}>{chartRows.map((_, index) => <Cell key={index} fill={index === 0 ? '#2dd4bf' : 'rgba(255,255,255,0.2)'} />)}</Bar>
          </BarChart>
        </ResponsiveContainer> : <p className="mt-4 text-sm" style={muted}>{sources.followups === 'error' ? 'تعذر تحميل أداء الفريق.' : 'لا توجد متابعات مطابقة للفلاتر في الفترة.'}</p>}
      </section>

      <section className="rounded-3xl border p-5" style={surface}>
        <div className="font-black text-teal-200">تفسير الفترة</div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>لم يرد</div><div className="mt-1 text-xl font-black text-white">{sources.followups === 'ready' ? summary.no_answer : '—'}</div></div>
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>مؤجلة</div><div className="mt-1 text-xl font-black text-white">{sources.followups === 'ready' ? summary.postponed : '—'}</div></div>
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>شراء بعد المتابعة</div><div className="mt-1 text-xl font-black text-white">{sources.followups === 'ready' ? summary.purchase_after_count : '—'}</div></div>
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>قيمة الشراء بعد المتابعة</div><div className="mt-1 text-xl font-black text-white">{sources.followups === 'ready' ? `${Number(summary.purchase_after_amount || 0).toLocaleString('ar-EG')} ج` : '—'}</div></div>
        </div>
      </section>
    </div>

    <section className="rounded-3xl border p-5" style={surface}>
      <div className="flex items-center gap-2 font-black text-teal-200"><Users size={18} /> تفاصيل الفريق</div>
      {sources.followups === 'ready' && team.length ? <div className="mt-3 space-y-2">{[...team].sort((a, b) => b.completion_rate - a.completion_rate).map((row, index) => <div key={`${row.responsible_key}-${row.branch}`} className="flex flex-col gap-2 rounded-xl border p-3 text-sm md:flex-row md:items-center md:justify-between" style={soft}>
        <div className="flex items-center gap-2">{index === 0 ? <Trophy size={16} className="text-amber-300" /> : <span className="w-4 text-center text-xs" style={muted}>{index + 1}</span>}<div><div className="font-black text-white">{row.responsible}</div><div className="text-xs" style={muted}>{row.branch} · {row.assigned} متابعة في الفترة</div></div></div>
        <div className="flex flex-wrap gap-3 text-xs font-bold"><span className="text-emerald-300">{row.completion_rate}% إنجاز</span><span className="text-rose-300">{row.overdue} متأخرة</span>{row.needs_manager ? <span className="text-amber-300">{row.needs_manager} تحتاج مدير</span> : null}{row.avg_quality_rating != null ? <span className="text-sky-300">{row.avg_quality_rating}/5 جودة</span> : null}</div>
      </div>)}</div> : <p className="mt-4 text-sm" style={muted}>لا توجد بيانات مطابقة للفلاتر.</p>}
    </section>
  </div>;
}
