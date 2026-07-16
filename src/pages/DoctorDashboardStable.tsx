import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  Headphones,
  Package,
  RefreshCw,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { loadSalesAnalyticsSummary, type SalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type Tab = 'overview' | 'branch' | 'performance' | 'rules';

type DoctorRow = SalesAnalyticsSummary['doctorRows'][number];

const BRANCH_TARGETS: Record<string, number> = {
  'فرع الشامي': 1_000_000,
  'الشامي': 1_000_000,
  'فرع شكري': 1_500_000,
  'شكري': 1_500_000,
};

const SCORE_RULES = [
  ['الترحيب وبداية الحوار', '10', 'ترحيب ودود واستخدام اسم العميل عند توفره.'],
  ['فهم الاحتياج', '20', 'استمع، اسأل، ثم لخّص الطلب قبل الترشيح.'],
  ['الترشيح الآمن', '25', 'رشّح الأنسب للحالة مع مراجعة الموانع والتعارضات.'],
  ['شرح الاستخدام', '15', 'اشرح الفائدة وطريقة الاستخدام والفرق بين البدائل.'],
  ['Cross-selling أخلاقي', '10', 'منتج مكمل مرتبط باحتياج حقيقي وبدون ضغط.'],
  ['Up-selling مسؤول', '10', 'اختيار أفضل عند وجود فائدة واضحة وشرح فرق السعر.'],
  ['الاحترام وعدم الضغط', '5', 'احترم قرار العميل ورفضه.'],
  ['الختام والمتابعة', '5', 'أكد الطلب والاستخدام واختم باهتمام.'],
] as const;

const ACTIONS = [
  { label: 'مسابقة الدكاترة', href: '/doctor-competition', icon: Award },
  { label: 'متابعاتي المطلوبة', href: '/doctor-dashboard?section=followups', icon: Headphones },
  { label: 'بحث العملاء', href: '/customers', icon: Users },
  { label: 'تقييم المحادثات', href: '/reviews', icon: ClipboardCheck },
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
  const exact = BRANCH_TARGETS[branch];
  if (exact) return exact;
  const found = Object.entries(BRANCH_TARGETS).find(([key]) => branch.includes(key.replace('فرع ', '')));
  return found?.[1] || Math.max(branchSales * 1.25, 1);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'نهارك سعيد';
  return 'مساء الخير';
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

export default function DoctorDashboardStable() {
  const { user } = useAuth();
  const cycle = useMemo(() => getCurrentCycle(), []);
  const [tab, setTab] = useState<Tab>('overview');
  const [state, setState] = useState<LoadState>('idle');
  const [summary, setSummary] = useState<SalesAnalyticsSummary | null>(null);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const branch = String(user?.branch || '').trim();
  const staffId = String(user?.staffId || user?.id || '').trim();
  const doctorName = String(user?.name || '').trim();

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
      });
      setSummary(result);
      setLoadedAt(new Date());
      setState('success');
    } catch (loadError) {
      console.error('Stable doctor dashboard load failed:', loadError);
      setState('error');
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات لوحة الدكتور.');
    }
  }, [branch, cycle.end, cycle.start]);

  useEffect(() => {
    void load();
  }, [load]);

  const doctorRow = useMemo<DoctorRow | null>(() => {
    if (!summary) return null;
    const byId = summary.doctorRows.find((row) => row.staffId && row.staffId === staffId);
    if (byId) return byId;
    const normalized = normalizeName(doctorName);
    return summary.doctorRows.find((row) => normalizeName(row.doctor) === normalized) || null;
  }, [doctorName, staffId, summary]);

  const ranking = useMemo(() => {
    if (!summary) return [];
    return [...summary.doctorRows].sort((a, b) => b.netSales - a.netSales);
  }, [summary]);

  const doctorRank = doctorRow ? ranking.findIndex((row) => row === doctorRow) + 1 : 0;
  const branchSales = summary?.kpis.netSales || 0;
  const target = branchTarget(branch, branchSales);
  const achievement = target ? (branchSales / target) * 100 : 0;
  const remaining = Math.max(0, target - branchSales);
  const activeDays = Math.max(1, summary?.kpis.activeDays || 1);
  const totalCycleDays = 30;
  const projected = branchSales ? (branchSales / activeDays) * totalCycleDays : 0;

  return (
    <div dir="rtl" className="space-y-5 pb-8">
      <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-l from-teal-500/10 via-slate-900 to-sky-500/10 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-black text-teal-300">لوحة الدكتور الجديدة — نسخة مستقرة</div>
            <h1 className="mt-1 text-3xl font-black text-white">{greeting()} يا دكتور {doctorName || 'الزميل'}</h1>
            <p className="mt-2 text-sm text-slate-300">{branch || 'الفرع غير محدد'} — الدورة {cycle.label}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={state === 'loading'} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-400/30 bg-teal-500/15 px-5 py-3 font-black text-teal-100 disabled:opacity-50">
            <RefreshCw size={18} className={state === 'loading' ? 'animate-spin' : ''} />
            تحديث البيانات
          </button>
        </div>
      </section>

      <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:grid-cols-4">
        {([
          ['overview', 'الملخص'],
          ['branch', 'تقدم الفرع'],
          ['performance', 'أدائي وترتيبي'],
          ['rules', 'قواعد الخدمة'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-xl px-4 py-3 text-sm font-black transition ${tab === key ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>
            {label}
          </button>
        ))}
      </nav>

      {state === 'loading' ? (
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center gap-3 text-slate-200"><RefreshCw className="animate-spin text-teal-300" /> جاري تحميل ملخص المبيعات فقط…</div>
        </section>
      ) : null}

      {state === 'error' ? (
        <section className="rounded-3xl border border-red-400/25 bg-red-500/10 p-6 text-red-100">
          <div className="font-black">تعذر تحميل بيانات المبيعات</div>
          <div className="mt-2 text-sm">{error}</div>
          <button type="button" onClick={() => void load()} className="mt-4 rounded-xl bg-red-500 px-4 py-2 font-black text-white">إعادة المحاولة</button>
        </section>
      ) : null}

      {tab === 'overview' && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="مبيعاتي في الدورة" value={doctorRow ? formatCurrency(doctorRow.netSales) : 'غير مرتبط'} hint={doctorRow ? `${doctorRow.invoicesCount} فاتورة` : 'راجع ربط اسم الدكتور أو staff_id'} icon={DollarSign} />
            <Metric label="مبيعات الفرع" value={formatCurrency(branchSales)} hint={`${summary?.kpis.invoicesCount || 0} فاتورة`} icon={BarChart3} />
            <Metric label="متوسط فاتورتي" value={doctorRow ? formatCurrency(doctorRow.avgInvoice) : '—'} hint={`متوسط الفرع ${formatCurrency(summary?.kpis.avgInvoice || 0)}`} icon={TrendingUp} />
            <Metric label="ترتيبي في الفرع" value={doctorRank ? `${doctorRank} من ${ranking.length}` : '—'} hint="حسب المبيعات في الدورة" icon={Award} />
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5">
            <h2 className="text-xl font-black text-white">الوصول السريع</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map(({ label, href, icon: Icon }) => (
                <a key={href} href={href} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 font-black text-slate-100 hover:border-teal-400/50 hover:bg-teal-500/10">
                  <Icon size={20} className="text-teal-300" />{label}
                </a>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === 'branch' && (
        <section className="rounded-3xl border border-sky-400/20 bg-slate-900/80 p-5">
          <h2 className="text-2xl font-black text-white">تقدم {branch}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="المبيعات" value={formatCurrency(branchSales)} icon={BarChart3} />
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
              <tbody>
                {ranking.map((row, index) => {
                  const mine = row === doctorRow;
                  return <tr key={`${row.staffId || row.doctor}-${index}`} className={mine ? 'bg-teal-500/15 text-teal-100' : 'border-t border-slate-800 text-slate-200'}><td className="p-3 font-black">{index + 1}</td><td className="p-3 font-black">{row.doctor}{mine ? ' — أنت' : ''}</td><td className="p-3">{formatCurrency(row.netSales)}</td><td className="p-3">{row.invoicesCount}</td><td className="p-3">{formatCurrency(row.avgInvoice)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'rules' && (
        <section className="rounded-3xl border border-amber-300/20 bg-slate-900/80 p-5">
          <div className="flex items-center gap-3"><ShieldCheck className="text-amber-300" /><h2 className="text-2xl font-black text-white">قواعد الخدمة وتقييم المحادثة</h2></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {SCORE_RULES.map(([title, score, detail]) => <div key={title} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4"><div className="flex justify-between gap-2"><div className="font-black text-white">{title}</div><span className="text-sm font-black text-teal-300">{score} درجات</span></div><p className="mt-2 text-sm leading-6 text-slate-300">{detail}</p></div>)}
          </div>
          <div className="mt-4 rounded-2xl border border-teal-400/20 bg-teal-500/10 p-4 text-sm font-bold leading-7 text-teal-50"><CheckCircle2 className="ml-2 inline" size={18} />اسأل → افهم → رشّح الأنسب → اشرح → أكد رضا العميل. ممنوع الضغط أو بيع الأغلى لمجرد السعر.</div>
        </section>
      )}

      <div className="text-center text-xs text-slate-500">{loadedAt ? `آخر تحديث ${loadedAt.toLocaleTimeString('ar-EG')}` : ''}</div>
    </div>
  );
}
