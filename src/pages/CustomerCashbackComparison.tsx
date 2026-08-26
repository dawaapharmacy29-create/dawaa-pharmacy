import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, Gauge, Minus, Search, Sparkles, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BRANCHES } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { friendlySupabaseError } from '@/lib/supabaseError';
import type { CashbackComparisonRow, CashbackComparisonPayload } from '@/lib/customerCashbackAnalyticsExport';
import { exportCustomerCashbackExecutiveWorkbook, type CashbackOperationsPayload } from '@/lib/customerCashbackExecutiveExport';

const ALL = '__all__';
const PAGE_SIZE = 100;

type Props = { forcedBranch?: string };
type Summary = {
  total_customers: number; new_customers: number; growing_customers: number; stable_customers: number;
  declining_customers: number; inactive_customers: number; current_points: number; previous_points: number;
  points_growth_pct: number | null; current_purchases: number; previous_purchases: number; purchases_growth_pct: number | null;
};
type Payload = CashbackComparisonPayload & { summary: Summary; rows: CashbackComparisonRow[]; filtered_count: number; limit: number; offset: number };

const EMPTY: Payload = {
  periods: { current_start: '', current_end: '', previous_start: '', previous_end: '' },
  summary: { total_customers: 0, new_customers: 0, growing_customers: 0, stable_customers: 0, declining_customers: 0, inactive_customers: 0, current_points: 0, previous_points: 0, points_growth_pct: null, current_purchases: 0, previous_purchases: 0, purchases_growth_pct: null },
  branch_summary: [], rows: [], filtered_count: 0, limit: PAGE_SIZE, offset: 0,
};

function trendLabel(trend: string) {
  if (trend === 'new') return 'عميل جديد'; if (trend === 'growing') return 'نمو'; if (trend === 'declining') return 'تراجع'; if (trend === 'inactive') return 'توقف'; return 'مستقر';
}
function trendClass(trend: string) {
  if (trend === 'growing') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  if (trend === 'new') return 'border-sky-400/25 bg-sky-500/10 text-sky-200';
  if (trend === 'declining' || trend === 'inactive') return 'border-rose-400/25 bg-rose-500/10 text-rose-200';
  return 'border-amber-400/25 bg-amber-500/10 text-amber-100';
}
function growthText(value: number | null) { if (value == null) return 'جديد'; return `${value > 0 ? '+' : ''}${Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })}%`; }
function pct(value: number | null | undefined) { return value == null ? '—' : `${Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })}%`; }
function days(hours: number | null | undefined) { return hours == null ? '—' : `${(Number(hours) / 24).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} يوم`; }

export default function CustomerCashbackComparison({ forcedBranch = '' }: Props) {
  const [branch, setBranch] = useState(forcedBranch || ALL);
  const [allowedBranches, setAllowedBranches] = useState<string[]>(forcedBranch ? [forcedBranch] : []);
  const [search, setSearch] = useState(''); const [debounced, setDebounced] = useState(''); const [page, setPage] = useState(0);
  const [payload, setPayload] = useState<Payload>(EMPTY); const [operations, setOperations] = useState<CashbackOperationsPayload | null>(null);
  const [loading, setLoading] = useState(true); const [exporting, setExporting] = useState(''); const seq = useRef(0);

  useEffect(() => { if (forcedBranch) { setBranch(forcedBranch); setAllowedBranches([forcedBranch]); } }, [forcedBranch]);
  useEffect(() => { const id = window.setTimeout(() => setDebounced(search.trim()), 250); return () => window.clearTimeout(id); }, [search]);
  useEffect(() => setPage(0), [branch, debounced]);

  useEffect(() => {
    if (forcedBranch) return;
    void (async () => {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_points_allowed_branches_v1', { p_manage: false });
      if (error) return;
      const values = (Array.isArray(data) ? data : []).map(String).filter((b) => BRANCHES.includes(b));
      setAllowedBranches(Array.from(new Set(values)));
    })();
  }, [forcedBranch]);

  const load = useCallback(async () => {
    const request = ++seq.current; setLoading(true);
    try {
      const comparisonPromise = (supabase as any).rpc('dawaa_customer_cashback_cycle_comparison_v1', {
        p_reference_date: null, p_branch: branch === ALL ? null : branch, p_search: debounced || null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      });
      const operationsPromise = branch === ALL ? Promise.resolve({ data: null, error: null }) : (supabase as any).rpc('dawaa_customer_cashback_branch_operations_v1', { p_branch: branch, p_reference_date: null });
      const [comparisonResult, operationsResult] = await Promise.all([comparisonPromise, operationsPromise]);
      if (comparisonResult.error) throw comparisonResult.error; if (operationsResult.error) throw operationsResult.error;
      if (request !== seq.current) return;
      const data = comparisonResult.data;
      setPayload({ ...EMPTY, ...(data || {}), rows: Array.isArray(data?.rows) ? data.rows : [], branch_summary: Array.isArray(data?.branch_summary) ? data.branch_summary : [] });
      setOperations(operationsResult.data || null);
    } catch (error) {
      if (request !== seq.current) return; toast.error(friendlySupabaseError(error as any) || 'تعذر تحميل مقارنة دورات النقاط');
    } finally { if (request === seq.current) setLoading(false); }
  }, [branch, debounced, page]);
  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(Number(payload.filtered_count || 0) / PAGE_SIZE));

  const fetchFullComparison = useCallback(async (targetBranch: string | null) => {
    const rows: CashbackComparisonRow[] = []; let offset = 0; let total = 1; let exportPayload: Payload = EMPTY;
    do {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_cycle_comparison_v1', { p_reference_date: null, p_branch: targetBranch, p_search: null, p_limit: 500, p_offset: offset });
      if (error) throw error; if (offset === 0) exportPayload = { ...EMPTY, ...(data || {}), rows: [], branch_summary: Array.isArray(data?.branch_summary) ? data.branch_summary : [] };
      const chunk = Array.isArray(data?.rows) ? data.rows as CashbackComparisonRow[] : []; rows.push(...chunk); total = Number(data?.filtered_count || 0); offset += chunk.length; if (!chunk.length) break;
    } while (offset < total);
    return { rows, payload: exportPayload };
  }, []);

  const exportReport = useCallback(async (target: string | null) => {
    const key = target || ALL; setExporting(key);
    try {
      const branchTargets = target ? [target] : allowedBranches.filter((b) => BRANCHES.includes(b));
      if (!branchTargets.length) throw new Error('لا توجد فروع متاحة للتقرير');
      const comparison = await fetchFullComparison(target);
      const opResults = await Promise.all(branchTargets.map(async (b) => {
        const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_branch_operations_v1', { p_branch: b, p_reference_date: null }); if (error) throw error; return data as CashbackOperationsPayload;
      }));
      await exportCustomerCashbackExecutiveWorkbook({ rows: comparison.rows, payload: comparison.payload, branchLabel: target || 'كل الفروع', operations: opResults });
      toast.success(`تم تجهيز التقرير التنفيذي — ${target || 'كل الفروع'}`);
    } catch (error) { toast.error(friendlySupabaseError(error as any) || (error as Error)?.message || 'تعذر تجهيز التقرير التنفيذي'); }
    finally { setExporting(''); }
  }, [allowedBranches, fetchFullComparison]);

  const cards = useMemo(() => [
    ['نمو إجمالي النقاط', payload.summary.points_growth_pct, payload.summary.points_growth_pct != null && payload.summary.points_growth_pct >= 0 ? ArrowUpRight : ArrowDownRight], ['عملاء جدد', payload.summary.new_customers, UserPlus], ['عملاء في نمو', payload.summary.growing_customers, Sparkles], ['مستقرون', payload.summary.stable_customers, Minus], ['متراجعون', payload.summary.declining_customers, ArrowDownRight], ['توقفوا', payload.summary.inactive_customers, UserMinus],
  ] as const, [payload.summary]);
  const op = operations?.current;

  return (
    <div className="space-y-4" dir="rtl">
      <section className="dawaa-hero">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><span className="dawaa-brand-chip">Cycle Analytics</span><h2 className="mt-3 text-2xl font-black text-[var(--theme-heading)]">مقارنة نقاط العملاء بين الدورات</h2><p className="mt-1 text-sm font-semibold text-[var(--theme-muted)]">مقارنة معيارية كل 3 شهور: {payload.periods.current_start || '—'} → {payload.periods.current_end || '—'} مقابل {payload.periods.previous_start || '—'} → {payload.periods.previous_end || '—'}.</p></div>
          <div className="flex flex-wrap gap-2">
            {allowedBranches.includes('فرع الشامي') && <button className="dawaa-button-primary" disabled={!!exporting} onClick={() => void exportReport('فرع الشامي')}><Download className="h-4 w-4" />{exporting === 'فرع الشامي' ? 'جارٍ تجهيز الشامي…' : 'تقرير الشامي'}</button>}
            {allowedBranches.includes('فرع شكري') && <button className="dawaa-button-primary" disabled={!!exporting} onClick={() => void exportReport('فرع شكري')}><Download className="h-4 w-4" />{exporting === 'فرع شكري' ? 'جارٍ تجهيز شكري…' : 'تقرير شكري'}</button>}
            {allowedBranches.length > 1 && <button className="btn-secondary" disabled={!!exporting} onClick={() => void exportReport(null)}><Download className="h-4 w-4" />{exporting === ALL ? 'جارٍ تجهيز الموحّد…' : 'التقرير الموحّد'}</button>}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="dawaa-kpi-card"><div className="text-xs font-bold text-[var(--theme-muted)]">نقاط الدورة الحالية</div><div className="mt-2 text-2xl font-black">{formatCurrency(Number(payload.summary.current_points || 0))}</div></div>
        <div className="dawaa-kpi-card"><div className="text-xs font-bold text-[var(--theme-muted)]">نقاط الدورة السابقة</div><div className="mt-2 text-2xl font-black">{formatCurrency(Number(payload.summary.previous_points || 0))}</div></div>
        <div className="dawaa-kpi-card"><div className="text-xs font-bold text-[var(--theme-muted)]">نمو المشتريات</div><div className="mt-2 text-2xl font-black">{growthText(payload.summary.purchases_growth_pct)}</div></div>
        <div className="dawaa-kpi-card"><div className="text-xs font-bold text-[var(--theme-muted)]">إجمالي العملاء بالمقارنة</div><div className="mt-2 text-2xl font-black">{Number(payload.summary.total_customers || 0).toLocaleString('ar-EG')}</div></div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, value, Icon]) => <div key={label} className="dawaa-panel p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-[var(--theme-muted)]">{label}</span><Icon className="h-4 w-4" /></div><div className="mt-2 text-lg font-black">{label.includes('نمو إجمالي') ? growthText(value as number | null) : Number(value || 0).toLocaleString('ar-EG')}</div></div>)}</section>

      {op && <section className="dawaa-panel p-4">
        <div className="mb-3 flex items-center gap-2"><Gauge className="h-5 w-5"/><h3 className="font-black">تنفيذ خدمة العملاء — {operations?.branch}</h3></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[['إجمالي العملاء',op.total],['تم التعامل',op.handled],['تم التبليغ',op.notified],['سحب جزئي',op.partial],['تمت التسوية',op.settled],['متبقي',op.pending]].map(([l,v])=><div key={String(l)} className="rounded-xl border border-[var(--theme-border)] p-3"><div className="text-xs font-bold text-[var(--theme-muted)]">{l}</div><div className="mt-1 text-xl font-black">{Number(v||0).toLocaleString('ar-EG')}</div></div>)}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-teal-500/5 p-3"><div className="text-xs font-bold">نسبة التعامل</div><div className="text-lg font-black">{pct(op.handled_rate)}</div></div>
          <div className="rounded-xl bg-teal-500/5 p-3"><div className="text-xs font-bold">نسبة التبليغ</div><div className="text-lg font-black">{pct(op.notification_rate)}</div></div>
          <div className="rounded-xl bg-teal-500/5 p-3"><div className="text-xs font-bold">نسبة التسوية</div><div className="text-lg font-black">{pct(op.settlement_rate)}</div></div>
          <div className="rounded-xl bg-teal-500/5 p-3"><div className="text-xs font-bold">متوسط زمن التبليغ</div><div className="text-lg font-black">{days(op.avg_notify_hours)}</div></div>
        </div>
        {!operations?.previous && <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-sm font-bold">الدورة الحالية هي أول Baseline تشغيلي موثوق؛ مقارنة سرعة التبليغ والتسوية بالدورة السابقة ستظهر تلقائيًا من الدورة الرسمية القادمة.</div>}
      </section>}

      <section className="dawaa-panel flex flex-wrap items-center gap-3 p-4">
        {!forcedBranch && <select value={branch} onChange={(e) => setBranch(e.target.value)} className="dawaa-input min-w-[180px]"><option value={ALL}>كل الفروع</option>{allowedBranches.map((b) => <option key={b} value={b}>{b}</option>)}</select>}
        <div className="relative min-w-[260px] flex-1"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--theme-muted)]"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالكود أو الاسم أو الهاتف" className="dawaa-input w-full pr-10"/></div><div className="text-xs font-bold text-[var(--theme-muted)]">{Number(payload.filtered_count || 0).toLocaleString('ar-EG')} عميل</div>
      </section>

      <section className="dawaa-panel overflow-hidden"><div className="overflow-x-auto"><table className="min-w-[1200px] w-full text-sm"><thead className="bg-teal-500/10 text-[var(--theme-heading)]"><tr>{['العميل','الكود','الفرع','نقاط الحالية','نقاط السابقة','الفرق','نمو النقاط','مشتريات الحالية','مشتريات السابقة','نمو المشتريات','الاتجاه'].map((h)=><th key={h} className="px-3 py-3 text-right font-black">{h}</th>)}</tr></thead><tbody>
        {loading && !payload.rows.length ? <tr><td colSpan={11} className="p-10 text-center font-bold">جارٍ تحميل المقارنة…</td></tr> : payload.rows.map((row)=><tr key={`${row.branch}-${row.customer_code}`} className="border-t border-[var(--theme-border)] hover:bg-white/5"><td className="px-3 py-3 font-black">{row.customer_name||'—'}</td><td className="px-3 py-3">{row.customer_code}</td><td className="px-3 py-3">{row.branch}</td><td className="px-3 py-3 font-black">{formatCurrency(row.current_points)}</td><td className="px-3 py-3">{formatCurrency(row.previous_points)}</td><td className={`px-3 py-3 font-black ${row.points_change>=0?'text-emerald-300':'text-rose-300'}`}>{row.points_change>0?'+':''}{formatCurrency(row.points_change)}</td><td className="px-3 py-3 font-black">{growthText(row.points_growth_pct)}</td><td className="px-3 py-3">{formatCurrency(row.current_purchases)}</td><td className="px-3 py-3">{formatCurrency(row.previous_purchases)}</td><td className="px-3 py-3">{growthText(row.purchases_growth_pct)}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${trendClass(row.trend)}`}>{trendLabel(row.trend)}</span></td></tr>)}
      </tbody></table></div><div className="flex items-center justify-between gap-3 border-t border-[var(--theme-border)] p-3"><button className="btn-secondary" disabled={page<=0||loading} onClick={()=>setPage(p=>Math.max(0,p-1))}>السابق</button><div className="text-sm font-black">صفحة {page+1} من {totalPages}</div><button className="btn-secondary" disabled={page+1>=totalPages||loading} onClick={()=>setPage(p=>p+1)}>التالي</button></div></section>
    </div>
  );
}
