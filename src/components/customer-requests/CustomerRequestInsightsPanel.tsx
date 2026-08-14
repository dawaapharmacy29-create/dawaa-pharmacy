import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
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
import { getCustomerRequestOperationalInsights, type CustomerRequestInsights } from '@/lib/api/customerRequestInsights';
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

export default function CustomerRequestInsightsPanel({
  branch = 'all',
  onAction,
}: {
  branch?: string;
  onAction?: (action: AnalyticsAction) => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'queue' | 'analytics'>('analytics');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CustomerRequestInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tab !== 'analytics') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void getCustomerRequestOperationalInsights(branch, days)
      .then((result) => {
        if (!cancelled) setData(result);
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
  }, [branch, days, tab]);

  const k = data?.kpis;
  const generatedAt = data?.generated_at
    ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(data.generated_at))
    : null;

  return (
    <div className="space-y-4">
      <CustomerRequestSyncHealthPanel />

      <div className="grid grid-cols-2 gap-3 rounded-3xl border border-slate-700 bg-[#102640] p-3 shadow-lg">
        <button type="button" onClick={() => setTab('analytics')} className={`rounded-2xl px-4 py-4 text-sm font-black ${tab === 'analytics' ? 'bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40' : 'bg-slate-900/60 text-slate-300'}`}>
          التحليلات والقرارات التشغيلية
        </button>
        <button type="button" onClick={() => setTab('queue')} className={`rounded-2xl px-4 py-4 text-sm font-black ${tab === 'queue' ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/40' : 'bg-slate-900/60 text-slate-300'}`}>
          قائمة التنفيذ والمتابعة
        </button>
      </div>

      {tab === 'queue' ? <CustomerRequestActionQueue branch={branch} /> : null}

      {tab === 'analytics' ? (
        <section className="overflow-hidden rounded-3xl border border-slate-700 bg-[#102640] shadow-xl">
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 p-5 text-right">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
                <BarChart3 size={22} />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-black text-white">لوحة تحليل طلبات العملاء</div>
                <div className="mt-1 text-xs leading-6 text-slate-400">سرعة التنفيذ، الاختناقات، أداء الفروع والمسئولين، الأصناف والعملاء المتكررين، والقنوات والأولويات.</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {generatedAt && <span className="hidden text-[11px] text-slate-500 lg:inline">آخر تحديث {generatedAt}</span>}
              {k && <span className="hidden rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-200 md:inline">{n(k.ready_not_contacted)} جاهز بدون تواصل</span>}
              {open ? <ChevronUp size={18} className="text-slate-300" /> : <ChevronDown size={18} className="text-slate-300" />}
            </div>
          </button>

          {open && (
            <div className="border-t border-slate-700 p-4 md:p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400"><SlidersHorizontal size={15} /> الفترة التحليلية</div>
                <div className="flex gap-2">
                  {[7, 30, 90].map((value) => (
                    <button key={value} type="button" onClick={() => setDays(value)} className={`rounded-xl px-3 py-2 text-xs font-black ${days === value ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/40' : 'bg-slate-800 text-slate-300'}`}>
                      {value} يوم
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-800/70" />)}
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
              ) : data ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                    <Kpi label="طلبات الفترة" value={n(data.kpis.total)} icon={PackageSearch} tone="text-cyan-200" onClick={() => onAction?.({ quickFilter: 'all' })} />
                    <Kpi label="مفتوحة الآن" value={n(data.kpis.open)} icon={Clock3} tone="text-amber-200" />
                    <Kpi label="متأخرة" value={n(data.kpis.overdue)} icon={AlertTriangle} tone="text-red-300" onClick={() => onAction?.({ quickFilter: 'overdue' })} />
                    <Kpi label="جاهز بدون تواصل" value={n(data.kpis.ready_not_contacted)} icon={PhoneCall} tone="text-orange-200" onClick={() => onAction?.({ status: 'available' })} />
                    <Kpi label="تم التسليم" value={n(data.kpis.delivered)} icon={PackageCheck} tone="text-emerald-300" onClick={() => onAction?.({ status: 'delivered' })} />
                    <Kpi label="نسبة ربط الأصناف" value={pct(data.kpis.linked_products_rate)} icon={ShoppingBag} tone="text-teal-200" />
                    <Kpi label="نسبة التوفير" value={pct(data.kpis.fulfillment_rate)} icon={TrendingUp} tone="text-cyan-200" />
                    <Kpi label="متوسط الإغلاق" value={hours(data.kpis.avg_close_hours)} icon={Clock3} tone="text-violet-200" />
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <Panel title="سرعة وكفاءة الفروع" icon={BarChart3} className="xl:col-span-1">
                      <div className="space-y-3">
                        {data.branches.map((item) => (
                          <button type="button" key={item.branch} onClick={() => onAction?.({ quickFilter: 'all', branch: item.branch })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-4 text-right transition hover:border-cyan-400/50">
                            <div className="flex items-center justify-between gap-3">
                              <strong className="text-sm text-white">{item.branch}</strong>
                              <span className="num rounded-lg bg-cyan-500/15 px-2 py-1 text-xs font-black text-cyan-200">{n(item.total)} طلب</span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                              <Mini label="مفتوح" value={n(item.open)} />
                              <Mini label="تم التسليم" value={n(item.delivered)} tone="text-emerald-300" />
                              <Mini label="متأخر" value={n(item.overdue)} tone="text-red-300" />
                              <Mini label="جاهز" value={n(item.ready)} tone="text-amber-200" />
                              <Mini label="نسبة التوفير" value={pct(item.fulfillment_rate)} tone="text-teal-300" />
                              <Mini label="متوسط الإغلاق" value={hours(item.avg_fulfillment_hours)} tone="text-cyan-300" />
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-700">
                              <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, Number(item.fulfillment_rate || 0))}%` }} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </Panel>

                    <Panel title="أداء المسئولين" icon={UsersRound} className="xl:col-span-1">
                      <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
                        {data.owners.map((item, index) => (
                          <button type="button" key={`${item.owner_name}-${index}`} onClick={() => onAction?.({ assignee: item.owner_name })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-3 text-right transition hover:border-violet-400/50">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2"><span className="num flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-[11px] font-black text-violet-200">{index + 1}</span><strong className="truncate text-xs text-white">{item.owner_name}</strong></div>
                              <span className="num text-xs font-black text-emerald-300">{pct(item.completion_rate)}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                              <Mini label="مسند" value={n(item.assigned_count)} />
                              <Mini label="مغلق" value={n(item.completed_count)} tone="text-emerald-300" />
                              <Mini label="متأخر" value={n(item.overdue_count)} tone="text-red-300" />
                              <Mini label="جاهز بلا تواصل" value={n(item.ready_not_contacted_count)} tone="text-orange-200" />
                              <Mini label="توفير" value={pct(item.fulfillment_rate)} tone="text-teal-300" />
                              <Mini label="متوسط الإغلاق" value={hours(item.avg_close_hours)} tone="text-cyan-300" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </Panel>

                    <Panel title="أكثر الأصناف طلبًا" icon={PackageSearch} className="xl:col-span-1">
                      <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
                        {data.top_products.map((item, index) => (
                          <button type="button" key={`${item.product_code}-${item.medicine_name}-${index}`} onClick={() => onAction?.({ productCode: item.product_code, medicineName: item.medicine_name, branch: branch === 'all' ? undefined : branch, quickFilter: 'all' })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-3 text-right transition hover:border-cyan-400/50">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0"><div className="truncate text-xs font-black text-white">{item.medicine_name}</div><div className="mt-1 text-[10px] text-slate-400">كود {item.product_code} · الأكثر في {item.top_branch || 'غير محدد'}</div></div>
                              <span className="num rounded-lg bg-cyan-500/15 px-2 py-1 text-xs font-black text-cyan-200">{n(item.requests_count)}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                              <Mini label="تم توفيره" value={n(item.fulfilled_count)} tone="text-emerald-300" />
                              <Mini label="غير متوفر" value={n(item.not_available_count)} tone="text-red-300" />
                              <Mini label="نسبة التوفير" value={pct(item.fulfillment_rate)} tone="text-teal-300" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </Panel>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
                    <Panel title="مراحل الطلبات" icon={Sparkles}>
                      <div className="space-y-2">
                        {data.stages.map((item) => (
                          <button type="button" key={item.status} onClick={() => onAction?.({ status: item.status })} className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-800/60 p-3 text-right hover:bg-slate-800">
                            <div><div className="text-xs font-black text-white">{requestStatusLabel(item.status)}</div><div className="mt-1 text-[10px] text-slate-500">متوسط البقاء {hours(item.avg_stage_hours)}</div></div>
                            <strong className="num text-cyan-200">{n(item.requests_count)}</strong>
                          </button>
                        ))}
                      </div>
                    </Panel>

                    <Panel title="أسباب التأخير الحالية" icon={AlertTriangle}>
                      <div className="space-y-2">
                        {data.delay_reasons.length ? data.delay_reasons.map((item) => (
                          <button type="button" key={item.reason} onClick={() => onAction?.({ quickFilter: 'overdue' })} className="flex w-full items-center justify-between gap-3 rounded-xl bg-red-500/[0.06] p-3 text-right hover:bg-red-500/10">
                            <span className="text-xs font-bold leading-5 text-slate-200">{item.reason}</span>
                            <strong className="num text-red-300">{n(item.requests_count)}</strong>
                          </button>
                        )) : <Empty />}
                      </div>
                    </Panel>

                    <Panel title="القنوات" icon={PhoneCall}>
                      <div className="space-y-2">
                        {data.channels.map((item) => (
                          <div key={item.channel} className="rounded-xl bg-slate-800/60 p-3">
                            <div className="flex items-center justify-between gap-2"><strong className="text-xs text-white">{item.channel}</strong><span className="num text-cyan-200">{n(item.requests_count)}</span></div>
                            <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]"><Mini label="نسبة التوفير" value={pct(item.fulfillment_rate)} tone="text-emerald-300" /><Mini label="متوسط الإغلاق" value={hours(item.avg_close_hours)} tone="text-cyan-300" /></div>
                          </div>
                        ))}
                      </div>
                    </Panel>

                    <Panel title="الأولويات" icon={AlertTriangle}>
                      <div className="space-y-2">
                        {data.priorities.map((item) => (
                          <div key={item.priority} className="rounded-xl bg-slate-800/60 p-3">
                            <div className="flex items-center justify-between gap-2"><strong className="text-xs text-white">{item.priority}</strong><span className="num text-cyan-200">{n(item.requests_count)}</span></div>
                            <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]"><Mini label="متأخر" value={n(item.overdue_count)} tone="text-red-300" /><Mini label="نسبة الإغلاق" value={pct(item.completion_rate)} tone="text-emerald-300" /></div>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <Panel title="أكثر العملاء طلبًا" icon={UserRound}>
                      <div className="space-y-2">
                        {data.top_customers.map((item, index) => (
                          <button type="button" key={`${item.customer_key}-${index}`} onClick={() => onAction?.({ customerCode: item.customer_code || undefined, customerPhone: item.customer_phone || undefined, customerName: item.customer_name, branch: branch === 'all' ? undefined : branch, quickFilter: 'all' })} className="flex w-full items-center gap-3 rounded-xl bg-slate-800/60 p-3 text-right hover:bg-slate-800">
                            <span className="num flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-black text-cyan-200">{index + 1}</span>
                            <div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-white">{item.customer_name}</div><div className="mt-1 text-[10px] text-slate-400">كود {item.customer_code || '—'} · متأخر {item.overdue_count}</div></div>
                            <strong className="num text-cyan-200">{n(item.requests_count)}</strong>
                          </button>
                        ))}
                      </div>
                    </Panel>
                    <Ranking title="الأكثر تسجيلًا للطلبات" rows={(data.registrars || []).map((item) => ({ name: item.staff_name, primary: item.requests_count, secondary: `تم توفير ${item.fulfilled_count}` }))} />
                    <Ranking title="الأكثر متابعة للطلبات" rows={(data.followers || []).filter((item) => !/dawaawael|sync|system|النظام/i.test(item.staff_name)).map((item) => ({ name: item.staff_name, primary: item.actions_count, secondary: `${item.requests_count} طلب مختلف` }))} />
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone, onClick }: { label: string; value: string; icon: typeof PackageSearch; tone: string; onClick?: () => void }) {
  const content = <><div className="flex items-center justify-between"><Icon size={17} className={tone} /><strong className={`num text-xl ${tone}`}>{value}</strong></div><div className="mt-3 text-[11px] font-black text-slate-300">{label}</div></>;
  return onClick ? <button type="button" onClick={onClick} className="min-h-24 rounded-2xl border border-slate-700 bg-slate-900/50 p-3 text-right transition hover:-translate-y-0.5 hover:border-cyan-400/50">{content}</button> : <div className="min-h-24 rounded-2xl border border-slate-700 bg-slate-900/50 p-3">{content}</div>;
}

function Panel({ title, icon: Icon, children, className = '' }: { title: string; icon: typeof BarChart3; children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-700 bg-slate-900/45 p-4 ${className}`}><div className="mb-3 flex items-center gap-2 font-black text-white"><Icon size={17} className="text-cyan-300" />{title}</div>{children}</div>;
}

function Mini({ label, value, tone = 'text-slate-200' }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg bg-slate-900/55 px-2 py-1.5"><div className="text-slate-500">{label}</div><div className={`mt-0.5 font-black ${tone}`}>{value}</div></div>;
}

function Empty() {
  return <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">لا توجد بيانات في الفترة.</div>;
}

function Ranking({ title, rows }: { title: string; rows: Array<{ name: string; primary: number; secondary: string }> }) {
  return (
    <Panel title={title} icon={UsersRound}>
      <div className="space-y-2">
        {rows.length ? rows.slice(0, 10).map((row, index) => (
          <div key={`${row.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-slate-800/70 p-3">
            <span className="num flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 font-black text-violet-200">{index + 1}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-white">{row.name}</div><div className="mt-1 text-[10px] text-slate-400">{row.secondary}</div></div>
            <strong className="num text-lg text-cyan-200">{row.primary}</strong>
          </div>
        )) : <Empty />}
      </div>
    </Panel>
  );
}