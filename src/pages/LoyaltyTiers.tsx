import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Crown,
  Star,
  Award,
  Users,
  RefreshCw,
  Search,
  Download,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
/* recharts will be dynamically imported inside the component to reduce initial bundle size */
import { exportLoyaltyToExcel } from '@/lib/exportExcel';
import { cn } from '@/lib/utils';
import {
  fetchLoyaltyTiers,
  LOYALTY_TIERS,
  type LoyaltyCustomer,
  type LoyaltyTier,
} from '@/lib/customers/loyaltyTiersService';
import { Skeleton } from '@/components/ui/skeleton';

const TIER_ORDER: LoyaltyTier[] = ['بلاتيني', 'ذهبي', 'فضي'];
const TIER_STYLE: Record<
  LoyaltyTier,
  { card: string; badge: string; icon: typeof Crown; color: string }
> = {
  بلاتيني: {
    card: 'border-violet-400/40 bg-violet-500/10 text-violet-100',
    badge: 'bg-violet-500 text-white',
    icon: Crown,
    color: '#8b5cf6',
  },
  ذهبي: {
    card: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
    badge: 'bg-amber-500 text-white',
    icon: Star,
    color: '#f59e0b',
  },
  فضي: {
    card: 'border-slate-300/35 bg-slate-400/10 text-slate-100',
    badge: 'bg-slate-500 text-white',
    icon: Award,
    color: '#94a3b8',
  },
};

function money(value: number) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value || 0);
}

function filterUrl(tier: LoyaltyTier) {
  const cfg = LOYALTY_TIERS[tier];
  const params = new URLSearchParams();
  params.set('loyalty', tier);
  params.set('min_purchase', String(Math.floor(cfg.min)));
  if (cfg.max !== null) params.set('max_purchase', String(Math.floor(cfg.max)));
  return `/customers?${params.toString()}`;
}

function LoadingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-40 rounded-3xl bg-slate-800/70" />
      ))}
    </div>
  );
}

export default function LoyaltyTiers() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [activeTier, setActiveTier] = useState<LoyaltyTier | 'all'>(
    (params.get('tier') as LoyaltyTier) || 'all'
  );
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('الكل');
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await fetchLoyaltyTiers();
      setCustomers(result.customers);
      setSource(result.source);
      setWarnings(result.warnings);
      setLoadedAt(new Date(result.loadedAt).toLocaleTimeString('ar-EG'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const [R, setR] = useState<any>(null);
  useEffect(() => {
    let mounted = true;
    import('recharts').then((m) => {
      if (mounted) setR(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const BarChart = R?.BarChart ?? ((props: any) => <div className="h-56 rounded-2xl bg-slate-100 animate-pulse" />);
  const Bar = R?.Bar ?? ((props: any) => null);
  const XAxis = R?.XAxis ?? ((props: any) => null);
  const YAxis = R?.YAxis ?? ((props: any) => null);
  const CartesianGrid = R?.CartesianGrid ?? ((props: any) => null);
  const Tooltip = R?.Tooltip ?? ((props: any) => null);
  const ResponsiveContainer = R?.ResponsiveContainer ?? (({ children }: any) => <div>{children}</div>);
  const Cell = R?.Cell ?? ((props: any) => null);

  useEffect(() => {
    const tier = params.get('tier') as LoyaltyTier | null;
    if (tier && TIER_ORDER.includes(tier)) setActiveTier(tier);
  }, [params]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((customer) => {
      if (customer.branch) set.add(customer.branch);
    });
    return ['الكل', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [customers]);

  const visibleCustomers = useMemo(
    () =>
      customers.filter((customer) => {
        if (activeTier !== 'all' && customer.tier !== activeTier) return false;
        if (branchFilter !== 'الكل' && customer.branch !== branchFilter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          customer.name.toLowerCase().includes(q) ||
          String(customer.phone || '').includes(q) ||
          String(customer.customer_code || '').includes(q)
        );
      }),
    [activeTier, branchFilter, customers, search]
  );

  const summaries = useMemo(
    () =>
      TIER_ORDER.map((tier) => {
        const rows = customers.filter(
          (customer) =>
            customer.tier === tier && (branchFilter === 'الكل' || customer.branch === branchFilter)
        );
        const total = rows.reduce((sum, row) => sum + row.total_purchases, 0);
        return {
          tier,
          rows,
          count: rows.length,
          total,
          avg: rows.length ? total / rows.length : 0,
          top: rows.sort((a, b) => b.total_purchases - a.total_purchases)[0] || null,
        };
      }),
    [branchFilter, customers]
  );

  const chartData = summaries.map((row) => ({ name: row.tier, عدد: row.count, total: row.total }));
  const displayedTotal = summaries.reduce((sum, row) => sum + row.total, 0);

  function chooseTier(tier: LoyaltyTier) {
    const next = activeTier === tier ? 'all' : tier;
    setActiveTier(next);
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('tier');
    else p.set('tier', next);
    setParams(p, { replace: true });
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white">مستويات ولاء العملاء</h1>
            <p className="mt-1 text-sm font-bold text-slate-400">
              تقسيم حقيقي حسب إجمالي مشتريات العميل: بلاتيني / ذهبي / فضي فقط.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-400">
              <span className="rounded-full border border-slate-700 px-2 py-1">
                المصدر: {source || 'جاري التحميل'}
              </span>
              {loadedAt && (
                <span className="rounded-full border border-slate-700 px-2 py-1">
                  آخر تحديث: {loadedAt}
                </span>
              )}
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-teal-200">
                أقل من 1500 لا يظهر ضمن المستويات الرئيسية
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                void exportLoyaltyToExcel(visibleCustomers.map((c) => ({ ...c, tier: c.tier })))
              }
              disabled={!visibleCustomers.length}
              className="inline-flex items-center gap-2 rounded-2xl border border-teal-400/30 bg-teal-500/15 px-4 py-2 text-sm font-black text-teal-100 disabled:opacity-50"
            >
              <Download size={16} /> Excel
            </button>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-500"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-100">
          <div className="mb-1 flex items-center gap-2 font-black">
            <AlertTriangle size={16} /> ملاحظات تحميل
          </div>
          <ul className="list-disc space-y-1 pr-5">
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <LoadingCards />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {summaries.map((summary) => {
            const style = TIER_STYLE[summary.tier];
            const Icon = style.icon;
            const active = activeTier === summary.tier;
            return (
              <button
                key={summary.tier}
                type="button"
                onClick={() => chooseTier(summary.tier)}
                className={cn(
                  'rounded-3xl border p-5 text-right shadow-lg transition hover:-translate-y-1 hover:shadow-2xl',
                  style.card,
                  active && 'ring-2 ring-teal-300/70'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-2xl bg-white/10 p-3">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-black', style.badge)}>
                    {summary.tier}
                  </span>
                </div>
                <div className="mt-4 text-xs font-bold text-slate-300">
                  {LOYALTY_TIERS[summary.tier].label}
                </div>
                <div className="mt-2 text-4xl font-black text-white">
                  {summary.count.toLocaleString('ar-EG')}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300">
                  <div className="rounded-xl bg-slate-950/30 p-2">
                    إجمالي الإنفاق
                    <br />
                    <span className="text-base text-teal-200">{money(summary.total)} ج</span>
                  </div>
                  <div className="rounded-xl bg-slate-950/30 p-2">
                    متوسط العميل
                    <br />
                    <span className="text-base text-teal-200">{money(summary.avg)} ج</span>
                  </div>
                </div>
                {summary.top && (
                  <div className="mt-3 rounded-xl bg-slate-950/30 p-2 text-xs font-bold text-slate-300">
                    أعلى عميل: <span className="text-white">{summary.top.name}</span> —{' '}
                    {money(summary.top.total_purchases)} ج
                  </div>
                )}
                <div className="mt-3 flex items-center gap-1 text-xs font-black text-teal-200">
                  اضغط للتصفية داخل الصفحة
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-5 lg:col-span-2">
          <h2 className="mb-3 text-base font-black text-white">توزيع العملاء بالمستوى</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 12,
                  color: '#f8fafc',
                }}
                formatter={(value: number, name: string) => [
                  name === 'total' ? `${money(value)} ج` : value,
                  name === 'total' ? 'إجمالي الإنفاق' : 'عدد العملاء',
                ]}
              />
              <Bar dataKey="عدد" radius={[8, 8, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={TIER_STYLE[entry.name as LoyaltyTier].color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-5">
          <h2 className="text-base font-black text-white">ملخص الإنفاق</h2>
          <div className="mt-4 text-3xl font-black text-teal-200">{money(displayedTotal)} ج</div>
          <div className="mt-1 text-xs font-bold text-slate-400">
            إجمالي إنفاق العملاء المؤهلين للمستويات الثلاثة
          </div>
          <div className="mt-4 space-y-3">
            {summaries.map((summary) => {
              const pct = displayedTotal ? (summary.total / displayedTotal) * 100 : 0;
              return (
                <div key={summary.tier}>
                  <div className="mb-1 flex justify-between text-xs font-bold text-slate-300">
                    <span>{summary.tier}</span>
                    <span>{pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: TIER_STYLE[summary.tier].color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/40 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالاسم أو الهاتف أو الكود"
              className="flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-500"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm font-bold text-white"
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <select
            value={activeTier}
            onChange={(event) => {
              const value = event.target.value as LoyaltyTier | 'all';
              if (value === 'all') {
                setActiveTier('all');
                const p = new URLSearchParams(params);
                p.delete('tier');
                setParams(p, { replace: true });
              } else chooseTier(value);
            }}
            className="rounded-2xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm font-bold text-white"
          >
            <option value="all">كل المستويات</option>
            {TIER_ORDER.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-700/50 bg-slate-900/60 shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/50 px-5 py-4">
          <h2 className="font-black text-white">
            {visibleCustomers.length.toLocaleString('ar-EG')} عميل مؤهل
          </h2>
          {activeTier !== 'all' && (
            <button
              onClick={() => navigate(filterUrl(activeTier))}
              className="inline-flex items-center gap-2 rounded-xl border border-teal-400/30 bg-teal-500/15 px-3 py-2 text-xs font-black text-teal-100"
            >
              فتح صفحة العملاء بهذا الفلتر <ExternalLink size={14} />
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-950/40 text-right text-slate-300">
                <th className="p-3">العميل</th>
                <th className="p-3">الهاتف</th>
                <th className="p-3">الكود</th>
                <th className="p-3">الفرع</th>
                <th className="p-3">إجمالي الشراء</th>
                <th className="p-3">الفواتير</th>
                <th className="p-3">آخر شراء</th>
                <th className="p-3">المستوى</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleCustomers.slice(0, 300).map((customer) => (
                <tr key={customer.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="p-3 font-black text-white">{customer.name}</td>
                  <td className="p-3 font-mono text-xs text-slate-300">{customer.phone || '-'}</td>
                  <td className="p-3 text-slate-300">{customer.customer_code || '-'}</td>
                  <td className="p-3 text-slate-300">{customer.branch || '-'}</td>
                  <td className="p-3 font-black text-teal-200">
                    {money(customer.total_purchases)} ج
                  </td>
                  <td className="p-3 text-slate-300">{customer.total_invoices || 0}</td>
                  <td className="p-3 text-slate-400">{customer.last_purchase || '-'}</td>
                  <td className="p-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-1 text-xs font-black',
                        TIER_STYLE[customer.tier].badge
                      )}
                    >
                      {customer.tier}
                    </span>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() =>
                        navigate(
                          `/customer-360?${new URLSearchParams({ code: customer.customer_code || '', id: customer.id || '', phone: customer.phone || '', name: customer.name || '' }).toString()}`
                        )
                      }
                      className="rounded-xl bg-teal-500/15 px-3 py-1 text-xs font-black text-teal-100"
                    >
                      ملف 360
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && visibleCustomers.length === 0 && (
          <div className="p-10 text-center font-bold text-slate-400">
            <Users className="mx-auto mb-3 h-10 w-10 text-slate-600" />
            لا توجد نتائج مطابقة
          </div>
        )}
      </div>
    </div>
  );
}
