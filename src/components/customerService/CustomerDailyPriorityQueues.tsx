import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, ChevronDown, ChevronUp, Crown, Download, FileUp, Gift, RefreshCw, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { fetchMonthlyCustomerPerformance, type CustomerMonthlyRow } from '@/lib/customerMonthlyPerformanceService';
import SmartQueueExcelImportModal from '@/components/customerService/SmartQueueExcelImportModal';

type QueueType = 'vip_recent' | 'plus500' | 'points' | 'activity';
type InvoiceValue = { invoiceNumber?: string; value: number };
type QueueCustomer = {
  code: string;
  name: string;
  phone: string;
  branch: string;
  queueType: QueueType;
  label: string;
  value?: number;
  invoiceCount?: number;
  invoiceValues?: InvoiceValue[];
  pointsBalance?: number;
  rank?: number;
  recentSales?: number;
  activeMonths?: number;
  lastPurchase?: string | null;
  state?: string;
};

type Top50Row = {
  customer_rank: number;
  branch: string;
  customer_code: string;
  customer_name: string | null;
  customer_phone: string | null;
  recent_sales: number;
  invoice_count: number;
  active_months: number;
  avg_invoice: number;
  last_purchase: string | null;
  importance_score: number;
};

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function money(value = 0) { return `${Math.round(value).toLocaleString('ar-EG')} ج.م`; }
function openFollowup(customer: QueueCustomer) {
  window.dispatchEvent(new CustomEvent('open-quick-followup', { detail: { code: customer.code, name: customer.name, phone: customer.phone } }));
}

function QueueCard({ customer, onPointDone }: { customer: QueueCustomer; onPointDone?: (customer: QueueCustomer) => void }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-white">{customer.name}</div>
        <div className="mt-1 text-[11px] font-bold text-slate-400">كود {customer.code} · {customer.branch}</div>
        <div className="mt-2 text-xs font-black text-cyan-200">{customer.label}</div>
        {!!customer.invoiceValues?.length && <div className="mt-1 text-[11px] font-bold leading-5 text-slate-300">الفواتير: {customer.invoiceValues.map((item) => `${item.invoiceNumber ? `#${item.invoiceNumber} ` : ''}${money(item.value)}`).join(' · ')}</div>}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <button type="button" onClick={() => openFollowup(customer)} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300">متابعة</button>
        {customer.queueType === 'points' && onPointDone ? <button type="button" onClick={() => onPointDone(customer)} className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-[11px] font-black text-emerald-200 hover:bg-emerald-400/20">تم إبلاغه</button> : null}
      </div>
    </div>
  </div>;
}

function BranchQueue({ title, customers, onPointDone, loading }: { title: string; customers: QueueCustomer[]; onPointDone?: (customer: QueueCustomer) => void; loading?: boolean }) {
  const groups = ['فرع شكري', 'فرع الشامي'].map((branch) => ({ branch, rows: customers.filter((c) => c.branch === branch) })).filter((g) => g.rows.length);
  return <div className="space-y-2">
    <div className="text-sm font-black text-white">{title} ({customers.length})</div>
    {groups.map((group) => <div key={group.branch} className="space-y-2 rounded-2xl border border-white/5 bg-black/10 p-2">
      <div className="sticky top-0 z-10 rounded-lg bg-[#0b2035]/95 px-2 py-1 text-xs font-black text-teal-200">{group.branch} · {group.rows.length}</div>
      {group.rows.map((c, index) => <QueueCard key={`${c.queueType}-${c.branch}-${c.code}-${index}`} customer={c} onPointDone={onPointDone}/>) }
    </div>)}
    {!customers.length ? <div className="rounded-xl border border-white/10 p-3 text-xs text-slate-400">{loading ? 'جارٍ التحميل...' : 'لا توجد بيانات مؤهلة حاليًا.'}</div> : null}
  </div>;
}

export default function CustomerDailyPriorityQueues() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const scopedBranch = normalizeBranchName(user?.branch || '');
  const [top50, setTop50] = useState<Top50Row[]>([]);
  const [vipDaily, setVipDaily] = useState<QueueCustomer[]>([]);
  const [largeInvoices, setLargeInvoices] = useState<QueueCustomer[]>([]);
  const [pointsDaily, setPointsDaily] = useState<QueueCustomer[]>([]);
  const [activity, setActivity] = useState<QueueCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTop50, setShowTop50] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const yesterday = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; }, []);
  const importBranch = managerView ? 'كل الفروع' : scopedBranch;

  const load = async () => {
    setLoading(true); setError('');
    try {
      const today = ymd(new Date());
      const saleDay = ymd(yesterday);
      // p_actor_id is passed explicitly (from the logged-in session) rather than relying only on the
      // x-dawaa-user-id request header, which was found to sometimes not reach the branch-scope check —
      // causing these queues to silently return zero rows with no visible error.
      const actorId = user?.id;
      const [topResult, vipResult, plusResult, pointsResult] = await Promise.all([
        supabase.rpc('get_customer_service_recent_top50_v2', { p_days: 90, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_daily_vip7_v2', { p_date: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_plus500_v2', { p_date: saleDay, p_actor_id: actorId }),
        supabase.rpc('get_customer_points_daily20_v2', { p_date: today, p_actor_id: actorId }),
      ]);
      const namedResults: Array<[string, typeof topResult]> = [
        ['أهم 50 عميل', topResult], ['VIP اليوم', vipResult], ['فواتير +500', plusResult], ['نقاط اليوم', pointsResult],
      ];
      const failed = namedResults.find(([, r]) => r.error);
      if (failed) throw new Error(`${failed[0]}: ${failed[1].error?.message || 'خطأ غير معروف'}`);

      const topRows = (topResult.data || []) as Top50Row[];
      setTop50(topRows);
      setVipDaily(((vipResult.data || []) as Array<Record<string, unknown>>).map((r) => ({
        code: String(r.customer_code || ''), name: String(r.customer_name || ''), phone: String(r.customer_phone || ''),
        branch: String(r.branch || ''), queueType: 'vip_recent' as const, rank: Number(r.customer_rank || 0),
        recentSales: Number(r.recent_sales || 0), activeMonths: Number(r.active_months || 0), lastPurchase: String(r.last_purchase || '') || null,
        value: Number(r.recent_sales || 0),
        label: `رقم ${Number(r.customer_rank || 0)} ضمن أهم 50 · آخر 3 شهور ${money(Number(r.recent_sales || 0))} · ${Number(r.active_months || 0)} شهر نشط`,
      })));
      setLargeInvoices(((plusResult.data || []) as Array<Record<string, unknown>>).map((r) => ({
        code: String(r.customer_code || ''), name: String(r.customer_name || ''), phone: String(r.customer_phone || ''), branch: String(r.branch || ''),
        queueType: 'plus500' as const, invoiceCount: Number(r.qualifying_invoice_count || 0), value: Number(r.qualifying_total || 0),
        invoiceValues: Array.isArray(r.invoice_values) ? (r.invoice_values as InvoiceValue[]) : [],
        label: `${Number(r.qualifying_invoice_count || 0)} فاتورة ≥500 · الإجمالي ${money(Number(r.qualifying_total || 0))} · أعلى فاتورة ${money(Number(r.highest_invoice || 0))}`,
      })));
      setPointsDaily(((pointsResult.data || []) as Array<Record<string, unknown>>).map((r) => ({
        code: String(r.customer_code || ''), name: String(r.customer_name || ''), phone: String(r.customer_phone || ''), branch: String(r.branch || ''),
        queueType: 'points' as const, pointsBalance: Number(r.points_balance || 0), value: Number(r.points_balance || 0),
        label: `رصيد النقاط ${Number(r.points_balance || 0).toLocaleString('ar-EG')} نقطة${r.last_contacted_at ? ` · آخر إبلاغ ${new Date(String(r.last_contacted_at)).toLocaleDateString('ar-EG')}` : ' · لم يتم إبلاغه سابقًا'}`,
      })));

      const period = getPharmacyCycleRange(new Date());
      const prevAnchor = new Date(period.start); prevAnchor.setDate(prevAnchor.getDate() - 1);
      const prev = getPharmacyCycleRange(prevAnchor);
      const perf = await fetchMonthlyCustomerPerformance(managerView ? null : scopedBranch, period.start, period.end, prev.start, prev.end, 'cycle');
      const rows = perf.rows.filter((r) => r.customer_code && !['5','10','54','170','12820'].includes(String(r.customer_code)));
      const pick = (states: string[], limit: number, sorter?: (a: CustomerMonthlyRow, b: CustomerMonthlyRow) => number) => rows.filter((r) => states.includes(r.customer_state)).sort(sorter || ((a,b) => Number(b.sales_amount)-Number(a.sales_amount))).slice(0, limit);
      const selected = [...pick(['مستقر'],5), ...pick(['تراجع قوي','تراجع'],5,(a,b)=>Number(b.previous_month_sales)-Number(a.previous_month_sales)), ...pick(['نمو قوي','نمو','مستعاد'],5,(a,b)=>Number(b.sales_change_amount)-Number(a.sales_change_amount))];
      setActivity(selected.map((r) => ({ code:String(r.customer_code||''),name:String(r.customer_name||''),phone:String(r.phone||''),branch:normalizeBranchName(r.branch||''),queueType:'activity',state:r.customer_state,value:Number(r.sales_amount||0),label:`${r.customer_state} · الحالي ${money(Number(r.sales_amount||0))}` })));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تحميل القوائم الذكية';
      setError(message);
      console.error('[CustomerDailyPriorityQueues] load failed', e);
    }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [managerView, scopedBranch, user?.id]);

  async function markPointDone(customer: QueueCustomer) {
    try {
      const { error: markError } = await supabase.rpc('mark_customer_points_contacted_v2', { p_branch: customer.branch, p_customer_code: customer.code, p_actor_name: user?.name || 'خدمة العملاء', p_actor_id: user?.id });
      if (markError) throw markError;
      toast.success(`تم تسجيل إبلاغ ${customer.name} برصيد النقاط`);
      await load();
    } catch (e) { toast.error(`تعذر التسجيل: ${(e as Error).message}`); }
  }

  async function exportExcel() {
    try {
      const XLSX = await import('xlsx');
      const resultColumns = {
        'تمت المتابعة': '', 'تم الرد': '', 'رد العميل': '', 'عملية شراء': '', 'قيمة عملية الشراء': '',
        'هل يحتاج متابعة أخرى': '', 'موعد المتابعة القادمة': '', 'ملاحظات': '',
      };
      const dailyRows = [...vipDaily, ...largeInvoices, ...pointsDaily].map((c) => ({
        'نوع القائمة': c.queueType === 'vip_recent' ? 'VIP آخر 3 شهور' : c.queueType === 'plus500' ? '+500' : 'نقاط',
        'الفرع': c.branch, 'اسم العميل': c.name, 'كود العميل': c.code, 'الهاتف': c.phone,
        'قيمة الفاتورة': c.queueType === 'plus500' ? Number(c.value || 0) : '', 'عدد الفواتير': c.invoiceCount || '',
        'رصيد النقاط': c.queueType === 'points' ? Number(c.pointsBalance || 0) : '',
        'مبيعات آخر 3 شهور': c.queueType === 'vip_recent' ? Number(c.recentSales || 0) : '', 'ترتيب أهم 50': c.rank || '',
        ...resultColumns,
      }));
      const topSheetRows = (branch: string) => top50.filter((r) => r.branch === branch).map((r) => ({
        'الترتيب': r.customer_rank, 'اسم العميل': r.customer_name || '', 'كود العميل': r.customer_code, 'الهاتف': r.customer_phone || '',
        'مبيعات آخر 3 شهور': Number(r.recent_sales || 0), 'عدد الفواتير': Number(r.invoice_count || 0), 'الشهور النشطة': Number(r.active_months || 0),
        'متوسط الفاتورة': Number(r.avg_invoice || 0), 'آخر شراء': r.last_purchase || '', 'درجة الأهمية': Number(r.importance_score || 0),
      }));
      const book = XLSX.utils.book_new();
      const add = (name: string, rows: Array<Record<string, unknown>>, widths: number[]) => {
        const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'ملاحظة': 'لا توجد بيانات' }]);
        (sheet as any)['!cols'] = widths.map((wch) => ({ wch }));
        if (rows.length) (sheet as any)['!autofilter'] = { ref: sheet['!ref'] };
        (sheet as any)['!views'] = [{ RTL: true }];
        XLSX.utils.book_append_sheet(book, sheet, name.slice(0,31));
      };
      add('المتابعة اليومية', dailyRows, [18,14,28,14,16,16,14,14,18,14,14,14,28,14,18,20,28]);
      if (managerView || scopedBranch === 'فرع شكري') add('Top50 شكري', topSheetRows('فرع شكري'), [10,28,14,16,20,14,14,18,14,16]);
      if (managerView || scopedBranch === 'فرع الشامي') add('Top50 الشامي', topSheetRows('فرع الشامي'), [10,28,14,16,20,14,14,18,14,16]);
      add('+500 أمس', largeInvoices.map((c) => ({ 'الفرع':c.branch,'اسم العميل':c.name,'الكود':c.code,'الهاتف':c.phone,'عدد الفواتير المؤهلة':c.invoiceCount,'إجمالي الفواتير المؤهلة':c.value,'تفاصيل الفواتير':c.invoiceValues?.map((v)=>`${v.invoiceNumber || '-'}: ${v.value}`).join(' | ') || '' })), [14,28,14,16,20,22,50]);
      add('النقاط اليوم', pointsDaily.map((c) => ({ 'الفرع':c.branch,'اسم العميل':c.name,'الكود':c.code,'الهاتف':c.phone,'رصيد النقاط':c.pointsBalance })), [14,28,14,16,18]);
      (book as any).Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(book, `متابعة_خدمة_العملاء_${ymd(new Date())}.xlsx`);
      toast.success('تم تجهيز ملف Excel منسق للعمل خارج التطبيق');
    } catch (e) { toast.error(`تعذر التصدير: ${(e as Error).message}`); }
  }

  const topCounts = useMemo(() => ({ shokry: top50.filter((r)=>r.branch==='فرع شكري').length, shamy: top50.filter((r)=>r.branch==='فرع الشامي').length }), [top50]);

  return <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-cyan-300/15 bg-[#0b2035] p-4 md:p-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-black text-cyan-300">قوائم المتابعة الذكية</p><h2 className="mt-1 text-lg font-black text-white">أولويات اليوم لخدمة العملاء</h2><p className="mt-1 text-xs font-bold leading-6 text-slate-400">Top 50 لكل فرع مبني فقط على آخر 3 شهور: الشهر الحالي والشهرين السابقين. النظام يوزع 7 عملاء يوميًا من الـ100 بالتبادل 4/3 بين الفرعين، ليتم المرور على كل عميل تقريبًا مرتين شهريًا.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void exportExcel()} className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100"><Download size={14} className="ml-1 inline"/>تصدير Excel</button>
        <button type="button" onClick={() => setImportOpen(true)} className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-100"><FileUp size={14} className="ml-1 inline"/>استيراد النتائج</button>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-200"><RefreshCw size={14} className={`ml-1 inline ${loading?'animate-spin':''}`}/>تحديث</button>
      </div>
    </div>
    {error ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-300/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-200"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-black text-rose-100 hover:bg-rose-400/20">إعادة المحاولة</button></div> : null}

    <div className="grid gap-4 xl:grid-cols-3">
      <div className="max-h-[560px] overflow-auto rounded-2xl border border-amber-300/10 bg-amber-300/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-amber-200"><Crown size={18}/><span className="font-black">7 من أهم العملاء اليوم</span></div><BranchQueue title="VIP آخر 3 شهور" customers={vipDaily} loading={loading}/></div>
      <div className="max-h-[560px] overflow-auto rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-emerald-200"><BadgeDollarSign size={18}/><span className="font-black">كل عملاء +500 أمس</span></div><BranchQueue title={`فواتير ${ymd(yesterday)}`} customers={largeInvoices} loading={loading}/></div>
      <div className="max-h-[560px] overflow-auto rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-cyan-200"><Gift size={18}/><span className="font-black">20 عميل نقاط اليوم</span></div><BranchQueue title="الأقدم في الإبلاغ أولًا" customers={pointsDaily} onPointDone={(c)=>void markPointDone(c)} loading={loading}/></div>
    </div>

    <button type="button" onClick={() => setShowTop50((v)=>!v)} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-right">
      <span><span className="font-black text-white">قائمة أهم 50 عميل لكل فرع — آخر 3 شهور فقط</span><span className="mr-3 text-xs font-bold text-slate-400">شكري {topCounts.shokry}/50 · الشامي {topCounts.shamy}/50</span></span>{showTop50?<ChevronUp className="text-cyan-300"/>:<ChevronDown className="text-cyan-300"/>}
    </button>
    {showTop50 ? <div className="grid gap-4 xl:grid-cols-2">{['فرع شكري','فرع الشامي'].map((branch) => {
      const rows=top50.filter((r)=>r.branch===branch); if (!rows.length) return null;
      return <div key={branch} className="max-h-[520px] overflow-auto rounded-2xl border border-white/10"><div className="sticky top-0 z-10 bg-[#173252] px-4 py-3 text-sm font-black text-white">{branch} — {rows.length} عميل</div><table className="min-w-[760px] w-full text-xs"><thead className="bg-[#102941] text-slate-400"><tr>{['#','العميل','مبيعات 3 شهور','فواتير','شهور نشطة','آخر شراء'].map((h)=><th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{rows.map((r)=><tr key={`${branch}-${r.customer_code}`} className="border-t border-white/5 text-slate-200"><td className="p-2 font-black text-cyan-300">{r.customer_rank}</td><td className="p-2"><div className="font-black text-white">{r.customer_name}</div><div className="text-[10px] text-slate-500">كود {r.customer_code}</div></td><td className="p-2 font-bold">{money(Number(r.recent_sales||0))}</td><td className="p-2">{r.invoice_count}</td><td className="p-2">{r.active_months}</td><td className="p-2">{r.last_purchase || '—'}</td></tr>)}</tbody></table></div>;
    })}</div> : null}

    <button type="button" onClick={() => setShowActivity((v)=>!v)} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-right"><span className="font-black text-slate-200"><UserCheck size={16} className="ml-2 inline text-cyan-300"/>عينة ذكية إضافية: مستقرون + متراجعون + متحسنون ({activity.length})</span>{showActivity?<ChevronUp size={18}/>:<ChevronDown size={18}/>}</button>
    {showActivity ? <div className="grid gap-3 md:grid-cols-3"><BranchQueue title="المستقرون" customers={activity.filter((c)=>c.state==='مستقر')}/><BranchQueue title="المتراجعون" customers={activity.filter((c)=>c.state?.includes('تراجع'))}/><BranchQueue title="المتحسنون" customers={activity.filter((c)=>['نمو','نمو قوي','مستعاد'].includes(c.state||''))}/></div> : null}

    <SmartQueueExcelImportModal open={importOpen} onClose={()=>setImportOpen(false)} onImported={()=>void load()} branch={importBranch}/>
  </section>;
}
