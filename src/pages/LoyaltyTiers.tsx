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
import { exportLoyaltyToExcel } from '@/lib/exportExcel';
import {
  fetchLoyaltyTiers,
  LOYALTY_TIERS,
  type LoyaltyCustomer,
  type LoyaltyTier,
} from '@/lib/customers/loyaltyTiersService';
import { Skeleton } from '@/components/ui/skeleton';

const TIER_ORDER: LoyaltyTier[] = ['بلاتيني', 'ذهبي', 'فضي'];
const TIER_META: Record<LoyaltyTier, { icon: typeof Crown; badge: string; color: string }> = {
  بلاتيني: { icon: Crown, badge: 'dawaa-badge--info', color: 'var(--dawaa-chart-series-3)' },
  ذهبي: { icon: Star, badge: 'dawaa-badge--warning', color: 'var(--dawaa-chart-series-5)' },
  فضي: { icon: Award, badge: '', color: 'var(--dawaa-chart-series-2)' },
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
        <Skeleton key={i} className="dawaa-card dawaa-card--soft h-40 rounded-3xl" />
      ))}
    </div>
  );
}

export default function LoyaltyTiers() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [activeTier, setActiveTier] = useState<LoyaltyTier | 'all'>((params.get('tier') as LoyaltyTier) || 'all');
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

  useEffect(() => { void load(); }, []);

  const [R, setR] = useState<any>(null);
  useEffect(() => {
    let mounted = true;
    import('recharts').then((m) => { if (mounted) setR(m); });
    return () => { mounted = false; };
  }, []);

  const BarChart = R?.BarChart ?? (() => <div className="dawaa-card dawaa-card--soft h-56 animate-pulse shadow-none" />);
  const Bar = R?.Bar ?? (() => null);
  const XAxis = R?.XAxis ?? (() => null);
  const YAxis = R?.YAxis ?? (() => null);
  const CartesianGrid = R?.CartesianGrid ?? (() => null);
  const Tooltip = R?.Tooltip ?? (() => null);
  const ResponsiveContainer = R?.ResponsiveContainer ?? (({ children }: any) => <div>{children}</div>);
  const Cell = R?.Cell ?? (() => null);

  useEffect(() => {
    const tier = params.get('tier') as LoyaltyTier | null;
    if (tier && TIER_ORDER.includes(tier)) setActiveTier(tier);
  }, [params]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((customer) => { if (customer.branch) set.add(customer.branch); });
    return ['الكل', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [customers]);

  const visibleCustomers = useMemo(
    () => customers.filter((customer) => {
      if (activeTier !== 'all' && customer.tier !== activeTier) return false;
      if (branchFilter !== 'الكل' && customer.branch !== branchFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return customer.name.toLowerCase().includes(q) || String(customer.phone || '').includes(q) || String(customer.customer_code || '').includes(q);
    }),
    [activeTier, branchFilter, customers, search]
  );

  const summaries = useMemo(
    () => TIER_ORDER.map((tier) => {
      const rows = customers.filter((customer) => customer.tier === tier && (branchFilter === 'الكل' || customer.branch === branchFilter));
      const total = rows.reduce((sum, row) => sum + row.total_purchases, 0);
      return {
        tier,
        rows,
        count: rows.length,
        total,
        avg: rows.length ? total / rows.length : 0,
        top: [...rows].sort((a, b) => b.total_purchases - a.total_purchases)[0] || null,
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
    if (next === 'all') p.delete('tier'); else p.set('tier', next);
    setParams(p, { replace: true });
  }

  const tooltipStyle = {
    background: 'var(--dawaa-chart-tooltip-bg)',
    border: '1px solid var(--dawaa-chart-tooltip-border)',
    borderRadius: 12,
    color: 'var(--dawaa-chart-tooltip-text)',
  };

  return (
    <div className="space-y-6" dir="rtl">
      <section className="dawaa-card dawaa-card--raised p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="dawaa-title text-2xl">مستويات ولاء العملاء</h1>
            <p className="dawaa-caption mt-1 text-sm font-bold">تقسيم حقيقي حسب إجمالي مشتريات العميل: بلاتيني / ذهبي / فضي فقط.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="dawaa-source-badge">المصدر: {source || 'جاري التحميل'}</span>
              {loadedAt ? <span className="dawaa-source-badge">آخر تحديث: {loadedAt}</span> : null}
              <span className="dawaa-source-badge">أقل من 1500 لا يظهر ضمن المستويات الرئيسية</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void exportLoyaltyToExcel(visibleCustomers.map((c) => ({ ...c, tier: c.tier })))} disabled={!visibleCustomers.length} className="dawaa-button dawaa-button--secondary disabled:opacity-50"><Download size={16} /> Excel</button>
            <button onClick={() => void load()} className="dawaa-button dawaa-button--primary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
          </div>
        </div>
      </section>

      {warnings.length > 0 ? (
        <div className="dawaa-alert dawaa-alert--warning text-sm font-bold">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div><div className="font-black">ملاحظات تحميل</div><ul className="mt-1 list-disc space-y-1 pr-5">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>
        </div>
      ) : null}

      {loading ? <LoadingCards /> : (
        <div className="grid gap-4 md:grid-cols-3">
          {summaries.map((summary) => {
            const meta = TIER_META[summary.tier];
            const Icon = meta.icon;
            const active = activeTier === summary.tier;
            return (
              <button
                key={summary.tier}
                type="button"
                onClick={() => chooseTier(summary.tier)}
                className={`dawaa-card dawaa-card--interactive p-5 text-right ${active ? 'dawaa-card--raised' : ''}`}
                style={active ? { borderColor: 'var(--dawaa-theme-accent-border)' } : undefined}
                aria-pressed={active}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="dawaa-icon-tile h-11 w-11"><Icon className="h-6 w-6" /></span>
                  <span className={`dawaa-badge ${meta.badge}`}>{summary.tier}</span>
                </div>
                <div className="dawaa-caption mt-4 text-xs font-bold">{LOYALTY_TIERS[summary.tier].label}</div>
                <div className="dawaa-title mt-2 text-4xl">{summary.count.toLocaleString('ar-EG')}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="dawaa-card dawaa-card--soft p-2 shadow-none"><div className="dawaa-caption text-xs font-bold">إجمالي الإنفاق</div><div className="dawaa-title mt-1 text-base">{money(summary.total)} ج</div></div>
                  <div className="dawaa-card dawaa-card--soft p-2 shadow-none"><div className="dawaa-caption text-xs font-bold">متوسط العميل</div><div className="dawaa-title mt-1 text-base">{money(summary.avg)} ج</div></div>
                </div>
                {summary.top ? <div className="dawaa-card dawaa-card--soft mt-3 p-2 text-xs font-bold shadow-none">أعلى عميل: <span className="dawaa-title text-xs">{summary.top.name}</span> — {money(summary.top.total_purchases)} ج</div> : null}
                <div className="dawaa-caption mt-3 text-xs font-black">اضغط للتصفية داخل الصفحة</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="dawaa-card p-5 lg:col-span-2">
          <h2 className="dawaa-title mb-3 text-base">توزيع العملاء بالمستوى</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--dawaa-chart-grid)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [name === 'total' ? `${money(value)} ج` : value, name === 'total' ? 'إجمالي الإنفاق' : 'عدد العملاء']} />
              <Bar dataKey="عدد" radius={[8, 8, 0, 0]}>{chartData.map((entry) => <Cell key={entry.name} fill={TIER_META[entry.name as LoyaltyTier].color} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="dawaa-card p-5">
          <h2 className="dawaa-title text-base">ملخص الإنفاق</h2>
          <div className="dawaa-title mt-4 text-3xl">{money(displayedTotal)} ج</div>
          <div className="dawaa-caption mt-1 text-xs font-bold">إجمالي إنفاق العملاء المؤهلين للمستويات الثلاثة</div>
          <div className="mt-4 space-y-3">
            {summaries.map((summary) => {
              const share = displayedTotal ? (summary.total / displayedTotal) * 100 : 0;
              return (
                <div key={summary.tier}>
                  <div className="dawaa-caption mb-1 flex justify-between text-xs font-bold"><span>{summary.tier}</span><span>{share.toFixed(1)}%</span></div>
                  <div className="progress-bar"><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: TIER_META[summary.tier].color }} /></div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="dawaa-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search size={16} className="dawaa-caption absolute right-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الهاتف أو الكود" className="dawaa-input pr-10 text-sm font-bold" />
          </div>
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="dawaa-select text-sm font-bold">{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select>
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
            className="dawaa-select text-sm font-bold"
          >
            <option value="all">كل المستويات</option>
            {TIER_ORDER.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>
        </div>
      </section>

      <section className="dawaa-card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--dawaa-theme-divider)' }}>
          <h2 className="dawaa-title text-base">{visibleCustomers.length.toLocaleString('ar-EG')} عميل مؤهل</h2>
          {activeTier !== 'all' ? <button onClick={() => navigate(filterUrl(activeTier))} className="dawaa-button dawaa-button--secondary min-h-0 px-3 py-2 text-xs">فتح صفحة العملاء بهذا الفلتر <ExternalLink size={14} /></button> : null}
        </div>
        {visibleCustomers.length ? (
          <div className="dawaa-table-shell rounded-none border-0 shadow-none">
            <table className="dawaa-table-semantic min-w-full text-sm">
              <thead><tr><th className="text-right">العميل</th><th className="text-right">الهاتف</th><th className="text-right">الكود</th><th className="text-right">الفرع</th><th className="text-right">إجمالي الشراء</th><th className="text-right">الفواتير</th><th className="text-right">آخر شراء</th><th className="text-right">المستوى</th><th></th></tr></thead>
              <tbody>
                {visibleCustomers.slice(0, 300).map((customer) => (
                  <tr key={customer.id}>
                    <td className="font-black">{customer.name}</td>
                    <td className="font-mono text-xs">{customer.phone || '-'}</td>
                    <td>{customer.customer_code || '-'}</td>
                    <td>{customer.branch || '-'}</td>
                    <td className="font-black">{money(customer.total_purchases)} ج</td>
                    <td>{customer.total_invoices || 0}</td>
                    <td>{customer.last_purchase || '-'}</td>
                    <td><span className={`dawaa-badge ${TIER_META[customer.tier].badge}`}>{customer.tier}</span></td>
                    <td><button onClick={() => navigate(`/customer-360?${new URLSearchParams({ code: customer.customer_code || '', id: customer.id || '', phone: customer.phone || '', name: customer.name || '' }).toString()}`)} className="dawaa-button dawaa-button--secondary min-h-0 px-3 py-1 text-xs">ملف 360</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading ? (
          <div className="dawaa-empty-state m-5 p-10 font-bold"><Users className="mx-auto mb-3 h-10 w-10" />لا توجد نتائج مطابقة</div>
        ) : null}
      </section>
    </div>
  );
}
