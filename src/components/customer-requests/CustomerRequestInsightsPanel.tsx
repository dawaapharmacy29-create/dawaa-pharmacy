import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, ChevronDown, ChevronUp, Clock3, PackageCheck, PackageSearch, PhoneCall, UsersRound } from 'lucide-react';
import { getCustomerRequestOperationalInsights, type CustomerRequestInsights } from '@/lib/api/customerRequestInsights';
import CustomerRequestActionQueue from '@/components/customer-requests/CustomerRequestActionQueue';

function n(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('ar-EG');
}

export default function CustomerRequestInsightsPanel({ branch = 'all' }: { branch?: string }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'queue' | 'analytics'>('queue');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CustomerRequestInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void getCustomerRequestOperationalInsights(branch, days)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branch, days]);

  const k = data?.kpis;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-3xl border border-slate-700 bg-[#102640] p-3"><button type="button" onClick={() => setTab('queue')} className={`rounded-2xl px-4 py-4 text-sm font-black ${tab === 'queue' ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/40' : 'bg-slate-900/60 text-slate-300'}`}>قائمة التنفيذ والمتابعة</button><button type="button" onClick={() => setTab('analytics')} className={`rounded-2xl px-4 py-4 text-sm font-black ${tab === 'analytics' ? 'bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40' : 'bg-slate-900/60 text-slate-300'}`}>تحليل سرعة تلبية الطلبات</button></div>

      {tab === 'queue' ? <CustomerRequestActionQueue branch={branch} /> : null}

      {tab === 'analytics' ? <section className="overflow-hidden rounded-3xl border border-slate-700 bg-[#102640] shadow-lg">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 p-4 text-right">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-200"><BarChart3 size={20} /></div>
            <div className="min-w-0">
              <div className="font-black text-white">تحليلات التشغيل وقرارات المشتريات</div>
              <div className="mt-1 text-xs text-slate-400">الأصناف المتكررة، التأخير، الطلبات الجاهزة بدون تواصل، وأداء المسئولين</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {k && <span className="hidden rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-200 md:inline">{n(k.ready_not_contacted)} جاهز بدون تواصل</span>}
            {open ? <ChevronUp size={18} className="text-slate-300" /> : <ChevronDown size={18} className="text-slate-300" />}
          </div>
        </button>

        {open && (
          <div className="border-t border-slate-700 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-bold text-slate-400">الفترة التحليلية</div>
              <div className="flex gap-2">
                {[7, 30, 90].map((value) => (
                  <button key={value} type="button" onClick={() => setDays(value)} className={`rounded-xl px-3 py-2 text-xs font-black ${days === value ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/40' : 'bg-slate-800 text-slate-300'}`}>{value} يوم</button>
                ))}
              </div>
            </div>

            {loading ? <div className="py-10 text-center text-sm text-slate-400">جاري حساب التحليلات...</div> : error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                  {[
                    ['طلبات الفترة', data.kpis.total, PackageSearch, 'text-cyan-200'],
                    ['مفتوحة', data.kpis.open, Clock3, 'text-amber-200'],
                    ['متأخرة', data.kpis.overdue, AlertTriangle, 'text-red-300'],
                    ['جاهز بدون تواصل', data.kpis.ready_not_contacted, PhoneCall, 'text-orange-200'],
                    ['مرتبطة بأصناف', data.kpis.linked_products, PackageCheck, 'text-emerald-300'],
                    ['نسبة التوفير', `${data.kpis.fulfillment_rate ?? 0}%`, BarChart3, 'text-teal-200'],
                  ].map(([label, value, Icon, tone]) => {
                    const I = Icon as typeof PackageSearch;
                    return <div key={String(label)} className="rounded-2xl border border-slate-700 bg-slate-900/50 p-3"><div className="flex items-center justify-between"><I size={16} className={String(tone)} /><strong className={`num text-lg ${String(tone)}`}>{typeof value === 'number' ? n(value) : String(value)}</strong></div><div className="mt-2 text-[11px] font-bold text-slate-400">{String(label)}</div></div>;
                  })}
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/45 p-4 xl:col-span-1">
                    <div className="mb-3 flex items-center gap-2 font-black text-white"><PackageSearch size={17} className="text-cyan-300" /> أكثر الأصناف طلبًا</div>
                    <div className="space-y-2">
                      {data.top_products.slice(0, 8).map((item, index) => <div key={`${item.product_code}-${item.medicine_name}-${index}`} className="rounded-xl bg-slate-800/70 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-xs font-black text-white">{item.medicine_name}</div><div className="mt-1 text-[10px] text-slate-400">كود {item.product_code}</div></div><span className="num rounded-lg bg-cyan-500/15 px-2 py-1 text-xs font-black text-cyan-200">{item.requests_count}</span></div><div className="mt-2 text-[10px] text-slate-500">تم توفير {item.fulfilled_count} · غير متوفر {item.not_available_count}</div></div>)}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-900/45 p-4 xl:col-span-1">
                    <div className="mb-3 flex items-center gap-2 font-black text-white"><UsersRound size={17} className="text-violet-300" /> أداء المسئولين</div>
                    <div className="space-y-2">
                      {data.owners.slice(0, 8).map((item) => <div key={item.owner_name} className="rounded-xl bg-slate-800/70 p-3"><div className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-white">{item.owner_name}</strong><span className="num text-xs text-slate-300">{item.completed_count}/{item.assigned_count}</span></div><div className="mt-2 flex flex-wrap gap-2 text-[10px]"><span className="text-red-300">متأخر {item.overdue_count}</span>{item.avg_close_hours !== null && <span className="text-cyan-300">متوسط الإغلاق {item.avg_close_hours}س</span>}</div></div>)}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-900/45 p-4 xl:col-span-1">
                    <div className="mb-3 font-black text-white">سرعة وكفاءة الفروع</div>
                    <div className="space-y-3">
                      {data.branches.map((item) => {
                        const completion = item.total ? Math.round((item.completed / item.total) * 100) : 0;
                        return <div key={item.branch} className="rounded-xl bg-slate-800/70 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-xs text-white">{item.branch}</strong><span className="num text-xs text-cyan-200">{item.total}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, completion)}%` }} /></div><div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400"><span>مكتمل {item.completed}</span><span className="text-red-300">متأخر {item.overdue}</span><span className="text-emerald-300">توفير {item.fulfillment_rate || completion}%</span><span className="text-cyan-300">متوسط {item.avg_fulfillment_hours ?? '—'}س</span></div></div>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Ranking title="أكثر دكتور/موظف تسجيلًا للطلبات" rows={(data.registrars || []).map((item) => ({ name: item.staff_name, primary: item.requests_count, secondary: `تم توفير ${item.fulfilled_count}` }))} /><Ranking title="أكثر دكتور/موظف متابعةً للطلبات" rows={(data.followers || []).filter((item) => !/dawaawael|sync|system|النظام/i.test(item.staff_name)).map((item) => ({ name: item.staff_name, primary: item.actions_count, secondary: `${item.requests_count} طلب مختلف` }))} /></div>
              </div>
            ) : null}
          </div>
        )}
      </section> : null}
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: Array<{ name: string; primary: number; secondary: string }> }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900/45 p-4"><div className="mb-3 font-black text-white">{title}</div><div className="space-y-2">{rows.length ? rows.slice(0, 10).map((row, index) => <div key={`${row.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-slate-800/70 p-3"><span className="num flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 font-black text-violet-200">{index + 1}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-white">{row.name}</div><div className="mt-1 text-[10px] text-slate-400">{row.secondary}</div></div><strong className="num text-lg text-cyan-200">{row.primary}</strong></div>) : <div className="text-xs text-slate-400">لا توجد بيانات موثقة في الفترة.</div>}</div></div>;
}
