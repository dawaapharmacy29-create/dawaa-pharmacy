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
type FollowupPayload = { start_date: string; end_date: string; summary: FollowupSummary; team: TeamRow[] };
type SupportingPayload = {
  start_date: string;
  end_date: string;
  review_count: number;
  avg_score: number | null;
  welcome_sent: number;
  welcome_replied: number;
  open_requests_now: number;
};

const emptySummary: FollowupSummary = {
  total_today: 0,
  period_total: 0,
  completed: 0,
  no_answer: 0,
  postponed: 0,
  overdue: 0,
  needs_manager: 0,
  purchase_after_count: 0,
  purchase_after_amount: 0,
  unique_customers: 0,
};

const emptySupporting: SupportingPayload = {
  start_date: '',
  end_date: '',
  review_count: 0,
  avg_score: null,
  welcome_sent: 0,
  welcome_replied: 0,
  open_requests_now: 0,
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

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(resolve, reject).finally(() => window.clearTimeout(id));
  });
}

function Kpi({ icon: Icon, label, value, state, hint, live = false }: {
  icon: any;
  label: string;
  value: string | number;
  state: SourceState;
  hint?: string;
  live?: boolean;
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

export default function CustomerServiceManagerDashboardV3({ headerVariant = 'full' }: { headerVariant?: 'full' | 'compact' } = {}) {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(allBranches ? ALL : ownBranch);
  const [responsible, setResponsible] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [dateRange, setDateRange] = useState('30');
  const [summary, setSummary] = useState<FollowupSummary>(emptySummary);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [supporting, setSupporting] = useState<SupportingPayload>(emptySupporting);
  const [responsibleOptions, setResponsibleOptions] = useState<string[]>([ALL]);
  const [followupState, setFollowupState] = useState<SourceState>('loading');
  const [supportingState, setSupportingState] = useState<SourceState>('loading');
  const [followupError, setFollowupError] = useState('');
  const [supportingError, setSupportingError] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const id = ++requestIdRef.current;
    const current = () => id === requestIdRef.current;
    const days = Number(dateRange);
    const branchFilter = branch === ALL ? null : branch;
    const startDate = rangeStart(days);
    const endDate = localDateKey(new Date());
    const responsibleFilter = responsible === ALL ? null : responsible;

    setFollowupState('loading');
    setSupportingState('loading');
    setFollowupError('');
    setSupportingError('');

    withTimeout(
      supabase.rpc('get_cs_manager_followup_summary_v1', {
        p_branch: branchFilter,
        p_start: startDate,
        p_end: endDate,
        p_responsible: responsibleFilter,
        p_status: status === ALL ? null : status,
      }),
      10000,
      'cs-manager-followup-summary'
    ).then((result: any) => {
      if (!current()) return;
      if (result.error) throw result.error;
      const payload = (result.data || {}) as FollowupPayload;
      setSummary({ ...emptySummary, ...(payload.summary || {}) });
      const nextTeam = Array.isArray(payload.team) ? payload.team : [];
      setTeam(nextTeam);
      setResponsibleOptions((prev) => {
        const next = new Set<string>(prev);
        next.add(ALL);
        nextTeam.forEach((row) => { if (row.responsible) next.add(row.responsible); });
        return [...next];
      });
      setFollowupState('ready');
    }).catch((error) => {
      if (!current()) return;
      console.error('[CustomerServiceManagerDashboardV3] followup aggregate failed', error);
      setFollowupError(error instanceof Error ? error.message : String(error));
      setFollowupState('error');
    });

    withTimeout(
      supabase.rpc('get_cs_manager_supporting_metrics_v1', {
        p_branch: branchFilter,
        p_start: startDate,
        p_end: endDate,
        p_responsible: responsibleFilter,
      }),
      10000,
      'cs-manager-supporting-metrics'
    ).then((result: any) => {
      if (!current()) return;
      if (result.error) throw result.error;
      setSupporting({ ...emptySupporting, ...((result.data || {}) as SupportingPayload) });
      setSupportingState('ready');
    }).catch((error) => {
      if (!current()) return;
      console.error('[CustomerServiceManagerDashboardV3] supporting aggregate failed', error);
      setSupportingError(error instanceof Error ? error.message : String(error));
      setSupportingState('error');
    });
  }, [branch, responsible, status, dateRange]);

  useEffect(() => {
    load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  useEffect(() => {
    setResponsible(ALL);
    setResponsibleOptions([ALL]);
  }, [branch, dateRange]);

  const loading = followupState === 'loading' || supportingState === 'loading';
  const periodLabel = DATE_RANGES.find((item) => item.key === dateRange)?.label || 'الفترة المختارة';
  const chartRows = useMemo(() => [...team].sort((a, b) => b.completion_rate - a.completion_rate).slice(0, 10), [team]);
  const welcomeRate = supporting.welcome_sent ? Math.round((supporting.welcome_replied / supporting.welcome_sent) * 100) : 0;
  const selectedResponsibleHint = responsible === ALL ? 'كل الموظفين' : responsible;

  return <div className="space-y-5 p-4 md:p-6" dir="rtl">
    {headerVariant === 'full' ? <div className="flex flex-col gap-3 rounded-3xl border p-5 md:flex-row md:items-center md:justify-between" style={surface}>
      <div>
        <div className="flex items-center gap-2 text-teal-200"><Headphones size={18} /><span className="text-xs font-black">لوحة مدير خدمة العملاء</span></div>
        <h1 className="mt-1 text-2xl font-black text-white">أهلًا يا {user?.name || 'مدير خدمة العملاء'}</h1>
        <p className="mt-1 text-sm" style={muted}>أرقام تشغيلية دقيقة من Aggregates مباشرة بدون حدود صفوف مخفية.</p>
      </div>
      <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
    </div> : null}

    <div className="flex items-center gap-3 rounded-2xl border-2 border-teal-400/30 bg-teal-500/10 p-4">
      <Users size={20} className="shrink-0 text-teal-300" />
      <div className="flex-1">
        <div className="text-sm font-black text-white">حقيقة التشغيل — {periodLabel}</div>
        <div className="text-xs" style={muted}>الفترة والفرع والموظف تطبق على المتابعات والتقييمات والترحيب. فلتر الحالة خاص بالمتابعات فقط. «طلبات مفتوحة الآن» مؤشر لحظي لا يتأثر بالفترة.</div>
      </div>
      <button onClick={load} className="btn-secondary flex shrink-0 items-center gap-2 text-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث</button>
    </div>

    {followupState === 'error' || supportingState === 'error' ? <div className="flex items-start gap-2 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4 text-xs font-bold text-amber-100">
      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
      <span>تعذر تحميل {followupState === 'error' && supportingState === 'error' ? 'مصدرَي المتابعات والمؤشرات المساندة' : followupState === 'error' ? 'مصدر المتابعات' : 'المؤشرات المساندة'} مؤقتًا. المصدر المتعطل يظهر (—) ولا يتحول إلى صفر.{followupError || supportingError ? ' يمكن إعادة المحاولة من زر التحديث.' : ''}</span>
    </div> : null}

    <div className="rounded-2xl border p-3" style={soft}>
      <div className="mb-2 flex items-center gap-2 text-xs font-black text-teal-200"><Filter size={16} /> فلاتر التشغيل</div>
      <div className="flex flex-wrap items-center gap-2">
        {allBranches ? <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}><option value={ALL}>كل الفروع</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select> : null}
        <select className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)}>{responsibleOptions.map((name) => <option key={name} value={name}>{name === ALL ? 'كل الموظفين' : name}</option>)}</select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value={ALL}>كل حالات المتابعات</option><option value="متأخرة">متأخرة</option><option value="يحتاج مدير">يحتاج مدير</option><option value="مكتمل">مكتمل</option></select>
        <select className="input" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>{DATE_RANGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      </div>
      <div className="mt-2 text-[11px]" style={muted}>النطاق الحالي: {branch === ALL ? 'كل الفروع' : branch} · {selectedResponsibleHint} · {periodLabel}. حالة المتابعة لا تغيّر التقييمات أو الترحيب أو الطلبات المفتوحة.</div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Kpi icon={ClipboardList} label="متابعات اليوم" value={summary.total_today} state={followupState} live hint="موعدها الفعلي اليوم" />
      <Kpi icon={Users} label="إجمالي متابعات الفترة" value={summary.period_total} state={followupState} hint={periodLabel} />
      <Kpi icon={CheckCircle2} label="مكتملة في الفترة" value={summary.completed} state={followupState} />
      <Kpi icon={AlertTriangle} label="متأخرة" value={summary.overdue} state={followupState} />
      <Kpi icon={Bell} label="تحتاج مدير" value={summary.needs_manager} state={followupState} />
      <Kpi icon={Users} label="عملاء مختلفون" value={summary.unique_customers} state={followupState} />
      <Kpi icon={Star} label="متوسط تقييم المحادثات" value={supporting.avg_score == null ? '—' : supporting.avg_score} state={supportingState} hint={`${supporting.review_count} تقييم · ${periodLabel}`} />
      <Kpi icon={MessageCircle} label="رسائل ترحيبية مُرسلة" value={supporting.welcome_sent} state={supportingState} hint={periodLabel} />
      <Kpi icon={Timer} label="نسبة رد العملاء على الترحيب" value={`${welcomeRate}%`} state={supportingState} hint="من الرسائل المرسلة في الفترة" />
      <Kpi icon={ClipboardList} label="طلبات عملاء مفتوحة الآن" value={supporting.open_requests_now} state={supportingState} live hint="نفس تعريف صفحة طلبات العملاء" />
    </div>

    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 font-black text-teal-200"><Trophy size={18} /> أداء فريق خدمة العملاء — {periodLabel}</div>
        {followupState === 'ready' && chartRows.length ? <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="responsible" width={92} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={{ background: '#0f1d33', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }} formatter={(value: number) => [`${value}%`, 'نسبة الإنجاز']} />
            <Bar dataKey="completion_rate" radius={[0, 8, 8, 0]} barSize={17}>{chartRows.map((_, index) => <Cell key={index} fill={index === 0 ? '#2dd4bf' : 'rgba(255,255,255,0.2)'} />)}</Bar>
          </BarChart>
        </ResponsiveContainer> : <p className="mt-4 text-sm" style={muted}>{followupState === 'error' ? 'تعذر تحميل أداء الفريق.' : 'لا توجد متابعات مطابقة للفلاتر في الفترة.'}</p>}
      </section>

      <section className="rounded-3xl border p-5" style={surface}>
        <div className="font-black text-teal-200">تفسير الفترة</div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>لم يرد</div><div className="mt-1 text-xl font-black text-white">{followupState === 'ready' ? summary.no_answer : '—'}</div></div>
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>مؤجلة</div><div className="mt-1 text-xl font-black text-white">{followupState === 'ready' ? summary.postponed : '—'}</div></div>
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>شراء بعد المتابعة</div><div className="mt-1 text-xl font-black text-white">{followupState === 'ready' ? summary.purchase_after_count : '—'}</div></div>
          <div className="rounded-2xl border p-3" style={soft}><div style={muted}>قيمة الشراء بعد المتابعة</div><div className="mt-1 text-xl font-black text-white">{followupState === 'ready' ? `${Number(summary.purchase_after_amount || 0).toLocaleString('ar-EG')} ج` : '—'}</div></div>
        </div>
      </section>
    </div>

    <section className="rounded-3xl border p-5" style={surface}>
      <div className="flex items-center gap-2 font-black text-teal-200"><Users size={18} /> تفاصيل الفريق</div>
      {followupState === 'ready' && team.length ? <div className="mt-3 space-y-2">{[...team].sort((a, b) => b.completion_rate - a.completion_rate).map((row, index) => <div key={`${row.responsible_key}-${row.branch}`} className="flex flex-col gap-2 rounded-xl border p-3 text-sm md:flex-row md:items-center md:justify-between" style={soft}>
        <div className="flex items-center gap-2">{index === 0 ? <Trophy size={16} className="text-amber-300" /> : <span className="w-4 text-center text-xs" style={muted}>{index + 1}</span>}<div><div className="font-black text-white">{row.responsible}</div><div className="text-xs" style={muted}>{row.branch} · {row.assigned} متابعة في الفترة</div></div></div>
        <div className="flex flex-wrap gap-3 text-xs font-bold"><span className="text-emerald-300">{row.completion_rate}% إنجاز</span><span className="text-rose-300">{row.overdue} متأخرة</span>{row.needs_manager ? <span className="text-amber-300">{row.needs_manager} تحتاج مدير</span> : null}{row.avg_quality_rating != null ? <span className="text-sky-300">{row.avg_quality_rating}/5 جودة</span> : null}</div>
      </div>)}</div> : <p className="mt-4 text-sm" style={muted}>لا توجد بيانات مطابقة للفلاتر.</p>}
    </section>
  </div>;
}
