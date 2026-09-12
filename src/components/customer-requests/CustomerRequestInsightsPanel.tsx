import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  PackageCheck,
  PackageSearch,
  PhoneCall,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { requestStatusLabel } from '@/lib/api/customerRequests';
import { getCustomerRequestOperationalInsightsWithTrend, type CustomerRequestInsights } from '@/lib/api/customerRequestInsights';
import CustomerRequestActionQueue from '@/components/customer-requests/CustomerRequestActionQueue';
import CustomerRequestSyncHealthPanel from '@/components/customer-requests/CustomerRequestSyncHealthPanel';

function n(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('ar-EG');
}

function pct(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%`;
}

function hours(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} س`;
}

function deltaPct(current: number | null | undefined, previous: number | null | undefined): number | null {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  if (!prev) return cur > 0 ? null : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`num rounded-full px-1.5 py-0.5 text-[11px] font-black ${up ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%
    </span>
  );
}

type AnalyticsAction = {
  quickFilter?: 'all' | 'overdue' | 'unassigned';
  status?: string;
  assignee?: string;
  search?: string;
  branch?: string;
  customerCode?: string;
  customerPhone?: string;
  customerName?: string;
  productCode?: string;
  medicineName?: string; // CUSTOMER_REQUEST_CONTEXT_ROUTING_V2
};

type ViewTab = 'queue' | 'overview' | 'branches' | 'staff' | 'products';

const VIEW_TABS: Array<{ key: ViewTab; label: string; icon: typeof BarChart3 }> = [
  { key: 'overview', label: 'نظرة عامة', icon: Sparkles },
  { key: 'branches', label: 'الفروع', icon: BarChart3 },
  { key: 'staff', label: 'الموظفون', icon: UsersRound },
  { key: 'products', label: 'الأصناف والعملاء', icon: PackageSearch },
  { key: 'queue', label: 'قائمة التنفيذ', icon: PhoneCall },
];

export default function CustomerRequestInsightsPanel({
  branch = 'all',
  onAction,
}: {
  branch?: string;
  onAction?: (action: AnalyticsAction) => void;
}) {
  const [view, setView] = useState<ViewTab>('overview');
  const [days, setDays] = useState(7);
  const [data, setData] = useState<CustomerRequestInsights | null>(null);
  const [previous, setPrevious] = useState<CustomerRequestInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (view === 'queue') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void getCustomerRequestOperationalInsightsWithTrend(branch, days)
      .then((result) => {
        if (!cancelled) { setData(result.current); setPrevious(result.previous); }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branch, days, view]);

  const generatedAt = data?.generated_at
    ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(data.generated_at))
    : null;

  return (
    <div className="space-y-3">
      <CustomerRequestSyncHealthPanel />

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-1.5 shadow-sm">
        {VIEW_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${view === t.key ? 'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)] ring-1 ring-[var(--dawaa-theme-focus)]' : 'text-[var(--dawaa-theme-text)] hover:bg-[var(--dawaa-theme-surface-2)]'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {view === 'queue' ? <CustomerRequestActionQueue branch={branch} /> : (
        <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-sm md:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
              <SlidersHorizontal size={14} /> الفترة <span className="hidden text-[10px] opacity-70 sm:inline">(النسب مقارنة بنفس المدة السابقة)</span>
              {generatedAt && <span className="hidden text-[10px] opacity-70 lg:inline">· آخر تحديث {generatedAt}</span>}
            </div>
            <div className="flex gap-1.5">
              {[{ value: 1, label: 'اليوم' }, { value: 7, label: 'الأسبوع' }, { value: 30, label: 'الشهر' }, { value: 90, label: '٣ شهور' }].map((opt) => (
                <button key={opt.value} type="button" onClick={() => setDays(opt.value)} className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${days === opt.value ? 'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)] ring-1 ring-[var(--dawaa-theme-focus)]' : 'bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-text)]'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)]" />)}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 text-sm text-[var(--dawaa-status-danger-text)]">{error}</div>
          ) : !data ? null : view === 'overview' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <Kpi label="طلبات الفترة" value={n(data.kpis.total)} icon={PackageSearch} tone="text-[var(--dawaa-theme-primary)]" onClick={() => onAction?.({ quickFilter: 'all' })} />
                <Kpi label="مفتوحة الآن" value={n(data.kpis.open)} icon={Clock3} tone="text-[var(--dawaa-status-warning-text)]" />
                <Kpi label="متأخرة" value={n(data.kpis.overdue)} icon={AlertTriangle} tone="text-[var(--dawaa-status-danger-text)]" onClick={() => onAction?.({ quickFilter: 'overdue' })} />
                <Kpi label="جاهز بدون تواصل" value={n(data.kpis.ready_not_contacted)} icon={PhoneCall} tone="text-[var(--dawaa-status-warning-text)]" onClick={() => onAction?.({ status: 'available' })} />
                <Kpi label="تم التسليم" value={n(data.kpis.delivered)} icon={PackageCheck} tone="text-[var(--dawaa-status-success-text)]" onClick={() => onAction?.({ status: 'delivered' })} />
                <Kpi label="نسبة ربط الأصناف" value={pct(data.kpis.linked_products_rate)} icon={ShoppingBag} tone="text-[var(--dawaa-theme-primary)]" />
                <Kpi label="نسبة التوفير" value={pct(data.kpis.fulfillment_rate)} icon={TrendingUp} tone="text-[var(--dawaa-theme-primary)]" />
                <Kpi label="متوسط الإغلاق" value={hours(data.kpis.avg_close_hours)} icon={Clock3} tone="text-[var(--dawaa-status-info-text)]" />
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Panel title="مراحل الطلبات" icon={Sparkles}>
                  <div className="space-y-1.5">
                    {data.stages.map((item) => (
                      <button type="button" key={item.status} onClick={() => onAction?.({ status: item.status })} className="flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2.5 text-right hover:bg-[var(--dawaa-theme-surface-2)]">
                        <div><div className="text-xs font-black text-[var(--dawaa-theme-heading)]">{requestStatusLabel(item.status)}</div><div className="mt-0.5 text-[10px] text-[var(--dawaa-theme-muted)]">متوسط البقاء {hours(item.avg_stage_hours)}</div></div>
                        <strong className="num text-base text-[var(--dawaa-theme-primary)]">{n(item.requests_count)}</strong>
                      </button>
                    ))}
                  </div>
                </Panel>

                <Panel title="أسباب التأخير الحالية" icon={AlertTriangle}>
                  <div className="space-y-1.5">
                    {data.delay_reasons.length ? data.delay_reasons.map((item) => (
                      <button type="button" key={item.reason} onClick={() => onAction?.({ quickFilter: 'overdue' })} className="flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--dawaa-status-danger-bg)]/[0.06] p-2.5 text-right hover:bg-[var(--dawaa-status-danger-bg)]">
                        <span className="text-xs font-bold leading-5 text-[var(--dawaa-theme-heading)]">{item.reason}</span>
                        <strong className="num text-base text-[var(--dawaa-status-danger-text)]">{n(item.requests_count)}</strong>
                      </button>
                    )) : <Empty />}
                  </div>
                </Panel>
              </div>
            </div>
          ) : view === 'branches' ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {data.branches.map((item) => {
                const prevBranch = previous?.branches?.find((p) => p.branch === item.branch);
                const trend = deltaPct(item.fulfillment_rate, prevBranch?.fulfillment_rate);
                return (
                  <button type="button" key={item.branch} onClick={() => onAction?.({ quickFilter: 'all', branch: item.branch })} className="w-full rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4 text-right transition hover:border-[var(--dawaa-theme-accent-border)]">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm text-[var(--dawaa-theme-heading)]">{item.branch}</strong>
                      <span className="num rounded-lg bg-[var(--dawaa-theme-accent-soft)] px-2 py-1 text-xs font-black text-[var(--dawaa-theme-primary)]">{n(item.total)} طلب</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Mini label="مفتوح" value={n(item.open)} />
                      <Mini label="تم التسليم" value={n(item.delivered)} tone="text-[var(--dawaa-status-success-text)]" />
                      <Mini label="متأخر" value={n(item.overdue)} tone="text-[var(--dawaa-status-danger-text)]" />
                      <Mini label="جاهز" value={n(item.ready)} tone="text-[var(--dawaa-status-warning-text)]" />
                      <Mini label="نسبة التوفير" value={<>{pct(item.fulfillment_rate)}<TrendBadge delta={trend} /></>} tone="text-[var(--dawaa-theme-primary)]" />
                      <Mini label="متوسط الإغلاق" value={hours(item.avg_fulfillment_hours)} tone="text-[var(--dawaa-theme-primary)]" />
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--dawaa-theme-surface-2)]">
                      <div className="h-full rounded-full bg-[var(--dawaa-theme-accent-soft)]" style={{ width: `${Math.min(100, Number(item.fulfillment_rate || 0))}%` }} />
                    </div>
                  </button>
                );
              })}
              <Panel title="القنوات" icon={PhoneCall}>
                <div className="space-y-1.5">
                  {data.channels.map((item) => (
                    <div key={item.channel} className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2.5">
                      <div className="flex items-center justify-between gap-2"><strong className="text-xs text-[var(--dawaa-theme-heading)]">{item.channel}</strong><span className="num text-[var(--dawaa-theme-primary)]">{n(item.requests_count)}</span></div>
                      <div className="mt-2 grid grid-cols-2 gap-1"><Mini label="نسبة التوفير" value={pct(item.fulfillment_rate)} tone="text-[var(--dawaa-status-success-text)]" /><Mini label="متوسط الإغلاق" value={hours(item.avg_close_hours)} tone="text-[var(--dawaa-theme-primary)]" /></div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="الأولويات" icon={AlertTriangle}>
                <div className="space-y-1.5">
                  {data.priorities.map((item) => (
                    <div key={item.priority} className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2.5">
                      <div className="flex items-center justify-between gap-2"><strong className="text-xs text-[var(--dawaa-theme-heading)]">{item.priority}</strong><span className="num text-[var(--dawaa-theme-primary)]">{n(item.requests_count)}</span></div>
                      <div className="mt-2 grid grid-cols-2 gap-1"><Mini label="متأخر" value={n(item.overdue_count)} tone="text-[var(--dawaa-status-danger-text)]" /><Mini label="نسبة الإغلاق" value={pct(item.completion_rate)} tone="text-[var(--dawaa-status-success-text)]" /></div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          ) : view === 'staff' ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Panel title="أداء المسئولين عن التوفير" icon={UsersRound}>
                <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                  {data.owners.map((item, index) => {
                    const prevOwner = previous?.owners?.find((p) => p.owner_name === item.owner_name);
                    const trend = deltaPct(item.completion_rate, prevOwner?.completion_rate);
                    return (
                      <button type="button" key={`${item.owner_name}-${index}`} onClick={() => onAction?.({ assignee: item.owner_name })} className="w-full rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3 text-right transition hover:border-[var(--dawaa-status-info-border)]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2"><span className="num flex h-7 w-7 items-center justify-center rounded-full bg-[var(--dawaa-status-info-bg)] text-[11px] font-black text-[var(--dawaa-status-info-text)]">{index + 1}</span><strong className="truncate text-xs text-[var(--dawaa-theme-heading)]">{item.owner_name}</strong></div>
                          <span className="flex items-center gap-1 num text-xs font-black text-[var(--dawaa-status-success-text)]">{pct(item.completion_rate)}<TrendBadge delta={trend} /></span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1">
                          <Mini label="مسند" value={n(item.assigned_count)} />
                          <Mini label="مغلق" value={n(item.completed_count)} tone="text-[var(--dawaa-status-success-text)]" />
                          <Mini label="متأخر" value={n(item.overdue_count)} tone="text-[var(--dawaa-status-danger-text)]" />
                          <Mini label="جاهز بلا تواصل" value={n(item.ready_not_contacted_count)} tone="text-[var(--dawaa-status-warning-text)]" />
                          <Mini label="توفير" value={pct(item.fulfillment_rate)} tone="text-[var(--dawaa-theme-primary)]" />
                          <Mini label="متوسط الإغلاق" value={hours(item.avg_close_hours)} tone="text-[var(--dawaa-theme-primary)]" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
              <Ranking title="الأكثر تسجيلًا للطلبات" rows={(data.registrars || []).map((item) => {
                const prevItem = previous?.registrars?.find((p) => p.staff_name === item.staff_name);
                return { name: item.staff_name, primary: item.requests_count, secondary: `تم توفير ${item.fulfilled_count}`, trend: deltaPct(item.requests_count, prevItem?.requests_count) };
              })} />
              <Ranking title="الأكثر متابعة للطلبات" rows={(data.followers || []).filter((item) => !/dawaawael|sync|system|النظام/i.test(item.staff_name)).map((item) => ({ name: item.staff_name, primary: item.actions_count, secondary: `${item.requests_count} طلب مختلف` }))} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Panel title="أكثر الأصناف طلبًا" icon={PackageSearch}>
                <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                  {data.top_products.map((item, index) => (
                    <button type="button" key={`${item.product_code}-${item.medicine_name}-${index}`} onClick={() => onAction?.({ productCode: item.product_code, medicineName: item.medicine_name, branch: branch === 'all' ? undefined : branch, quickFilter: 'all' })} className="w-full rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3 text-right transition hover:border-[var(--dawaa-theme-accent-border)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><div className="truncate text-xs font-black text-[var(--dawaa-theme-heading)]">{item.medicine_name}</div><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">كود {item.product_code} · الأكثر في {item.top_branch || 'غير محدد'}</div></div>
                        <span className="num rounded-lg bg-[var(--dawaa-theme-accent-soft)] px-2 py-1 text-xs font-black text-[var(--dawaa-theme-primary)]">{n(item.requests_count)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        <Mini label="تم توفيره" value={n(item.fulfilled_count)} tone="text-[var(--dawaa-status-success-text)]" />
                        <Mini label="غير متوفر" value={n(item.not_available_count)} tone="text-[var(--dawaa-status-danger-text)]" />
                        <Mini label="نسبة التوفير" value={pct(item.fulfillment_rate)} tone="text-[var(--dawaa-theme-primary)]" />
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel title="أكثر العملاء طلبًا" icon={UserRound}>
                <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1">
                  {data.top_customers.map((item, index) => (
                    <button type="button" key={`${item.customer_key}-${index}`} onClick={() => onAction?.({ customerCode: item.customer_code || undefined, customerPhone: item.customer_phone || undefined, customerName: item.customer_name, branch: branch === 'all' ? undefined : branch, quickFilter: 'all' })} className="flex w-full items-center gap-3 rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2.5 text-right hover:bg-[var(--dawaa-theme-surface-2)]">
                      <span className="num flex h-8 w-8 items-center justify-center rounded-full bg-[var(--dawaa-theme-accent-soft)] text-xs font-black text-[var(--dawaa-theme-primary)]">{index + 1}</span>
                      <div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-[var(--dawaa-theme-heading)]">{item.customer_name}</div><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">كود {item.customer_code || '—'} · متأخر {item.overdue_count}</div></div>
                      <strong className="num text-base text-[var(--dawaa-theme-primary)]">{n(item.requests_count)}</strong>
                    </button>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone, onClick }: { label: string; value: string; icon: typeof PackageSearch; tone: string; onClick?: () => void }) {
  const content = <><div className="flex items-center justify-between"><Icon size={16} className={tone} /><strong className={`num text-lg ${tone}`}>{value}</strong></div><div className="mt-2 text-[11px] font-black text-[var(--dawaa-theme-text)]">{label}</div></>;
  return onClick ? <button type="button" onClick={onClick} className="min-h-20 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-2.5 text-right transition hover:-translate-y-0.5 hover:border-[var(--dawaa-theme-accent-border)]">{content}</button> : <div className="min-h-20 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-2.5">{content}</div>;
}

function Panel({ title, icon: Icon, children, className = '' }: { title: string; icon: typeof BarChart3; children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 ${className}`}><div className="mb-2 flex items-center gap-2 text-sm font-black text-[var(--dawaa-theme-heading)]"><Icon size={16} className="text-[var(--dawaa-theme-primary)]" />{title}</div>{children}</div>;
}

function Mini({ label, value, tone = 'text-[var(--dawaa-theme-heading)]' }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div className="rounded-lg bg-[var(--dawaa-theme-surface)] px-2 py-1.5"><div className="text-[10px] text-[var(--dawaa-theme-muted)]">{label}</div><div className={`num mt-0.5 flex items-center gap-1 text-sm font-black ${tone}`}>{value}</div></div>;
}

function Empty() {
  return <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-4 text-center text-xs text-[var(--dawaa-theme-muted)]">لا توجد بيانات في الفترة.</div>;
}

function Ranking({ title, rows }: { title: string; rows: Array<{ name: string; primary: number; secondary: string; trend?: number | null }> }) {
  return (
    <Panel title={title} icon={UsersRound}>
      <div className="space-y-2">
        {rows.length ? rows.slice(0, 10).map((row, index) => (
          <div key={`${row.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2.5">
            <span className="num flex h-8 w-8 items-center justify-center rounded-full bg-[var(--dawaa-status-info-bg)] font-black text-[var(--dawaa-status-info-text)]">{index + 1}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-[var(--dawaa-theme-heading)]">{row.name}</div><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">{row.secondary}</div></div>
            <div className="flex flex-col items-end gap-1"><strong className="num text-base text-[var(--dawaa-theme-primary)]">{row.primary}</strong>{row.trend !== undefined ? <TrendBadge delta={row.trend ?? null} /> : null}</div>
          </div>
        )) : <Empty />}
      </div>
    </Panel>
  );
}
