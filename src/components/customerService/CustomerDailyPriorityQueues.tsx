import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  ChevronDown,
  ChevronUp,
  Crown,
  Download,
  FileUp,
  Gauge,
  Gift,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import SmartQueueExcelImportModal from '@/components/customerService/SmartQueueExcelImportModal';

type QueueType = 'vip_recent' | 'plus500' | 'points';
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
  trendState?: string;
  currentSales?: number;
  previousSales?: number;
  priorSales?: number;
  changeVsBaselinePct?: number | null;
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

type CompletionRow = {
  branch: string;
  vip_total: number; vip_handled: number;
  plus500_total: number; plus500_handled: number;
  points_total: number; points_handled: number;
};

type IntelligenceRow = {
  branch: string;
  customer_rank: number;
  customer_code: string;
  customer_name: string | null;
  customer_phone: string | null;
  recent_sales: number;
  last_purchase: string | null;
  current_period_sales: number;
  previous_period_sales: number;
  prior_period_sales: number;
  current_invoices: number;
  previous_invoices: number;
  prior_invoices: number;
  baseline_sales: number;
  change_vs_previous_pct: number | null;
  change_vs_baseline_pct: number | null;
  trend_state: string;
  priority_score: number;
  current_period_start: string;
  current_period_end: string;
  previous_period_start: string;
  previous_period_end: string;
  prior_period_start: string;
  prior_period_end: string;
};

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function money(value = 0) {
  return `${Math.round(value).toLocaleString('ar-EG')} ج.م`;
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%`;
}

function openFollowup(customer: QueueCustomer | IntelligenceRow) {
  const code = 'code' in customer ? customer.code : customer.customer_code;
  const name = 'name' in customer ? customer.name : customer.customer_name || '';
  const phone = 'phone' in customer ? customer.phone : customer.customer_phone || '';
  window.dispatchEvent(new CustomEvent('open-quick-followup', { detail: { code, name, phone } }));
}

function trendTone(state = '') {
  if (state === 'خطر فقد' || state === 'تراجع قوي') return 'border-rose-300/25 bg-rose-400/10 text-rose-200';
  if (state === 'تراجع') return 'border-orange-300/25 bg-orange-400/10 text-orange-200';
  if (state === 'نمو قوي' || state === 'نمو' || state === 'عميل صاعد جديد') return 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200';
  return 'border-slate-300/20 bg-white/5 text-slate-300';
}

function QueueCard({ customer, onPointDone }: { customer: QueueCustomer; onPointDone?: (customer: QueueCustomer) => void }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-black text-white">{customer.name}</div>
          {customer.trendState ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${trendTone(customer.trendState)}`}>{customer.trendState}</span> : null}
        </div>
        <div className="mt-1 text-[11px] font-bold text-slate-400">كود {customer.code} · {customer.branch}</div>
        <div className="mt-2 text-xs font-black text-cyan-200">{customer.label}</div>
        {customer.queueType === 'vip_recent' && customer.currentSales != null ? <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-bold">
          <div className="rounded-lg bg-white/5 p-1.5 text-slate-300">الحالي<br/><span className="text-white">{money(customer.currentSales)}</span></div>
          <div className="rounded-lg bg-white/5 p-1.5 text-slate-300">السابق<br/><span className="text-white">{money(customer.previousSales || 0)}</span></div>
          <div className="rounded-lg bg-white/5 p-1.5 text-slate-300">قبله<br/><span className="text-white">{money(customer.priorSales || 0)}</span></div>
        </div> : null}
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

function IntelligenceCard({ row, mode }: { row: IntelligenceRow; mode: 'risk' | 'growth' | 'stable' }) {
  const difference = Number(row.current_period_sales || 0) - Number(row.baseline_sales || 0);
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-black text-white">{row.customer_name || 'عميل'}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${trendTone(row.trend_state)}`}>{row.trend_state}</span>
        </div>
        <div className="mt-1 text-[11px] font-bold text-slate-400">#{row.customer_rank} ضمن أهم 50 · كود {row.customer_code} · {row.branch}</div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-bold">
          <div className="rounded-lg bg-white/5 p-1.5 text-slate-300">الفترة الحالية<br/><span className="text-white">{money(Number(row.current_period_sales || 0))}</span></div>
          <div className="rounded-lg bg-white/5 p-1.5 text-slate-300">نفس المدة السابقة<br/><span className="text-white">{money(Number(row.previous_period_sales || 0))}</span></div>
          <div className="rounded-lg bg-white/5 p-1.5 text-slate-300">نفس المدة قبلها<br/><span className="text-white">{money(Number(row.prior_period_sales || 0))}</span></div>
        </div>
        <div className="mt-2 text-[11px] font-black">
          {mode === 'risk' ? <span className="text-rose-200">فجوة عن المعتاد: {money(Math.max(0, -difference))} · التغير {pct(row.change_vs_baseline_pct)}</span> : null}
          {mode === 'growth' ? <span className="text-emerald-200">زيادة عن المعتاد: {money(Math.max(0, difference))} · التغير {pct(row.change_vs_baseline_pct)}</span> : null}
          {mode === 'stable' ? <span className="text-cyan-200">قيمة آخر 3 شهور: {money(Number(row.recent_sales || 0))} · آخر شراء {row.last_purchase || '—'}</span> : null}
        </div>
      </div>
      <button type="button" onClick={() => openFollowup(row)} className="shrink-0 rounded-xl bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300">متابعة</button>
    </div>
  </div>;
}

export default function CustomerDailyPriorityQueues() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const scopedBranch = normalizeBranchName(user?.branch || '');
  const [top50, setTop50] = useState<Top50Row[]>([]);
  const [intelligence, setIntelligence] = useState<IntelligenceRow[]>([]);
  const [vipDaily, setVipDaily] = useState<QueueCustomer[]>([]);
  const [largeInvoices, setLargeInvoices] = useState<QueueCustomer[]>([]);
  const [pointsDaily, setPointsDaily] = useState<QueueCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTop50, setShowTop50] = useState(false);
  const [showIntelligence, setShowIntelligence] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [completion, setCompletion] = useState<CompletionRow[]>([]);

  const yesterday = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; }, []);
  const importBranch = managerView ? 'كل الفروع' : scopedBranch;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const today = ymd(new Date());
      const saleDay = ymd(yesterday);
      const actorId = user?.id;
      const [topResult, intelligenceResult, vipResult, plusResult, pointsResult] = await Promise.all([
        supabase.rpc('get_customer_service_recent_top50_v2', { p_days: 90, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_three_cycle_intelligence_v1', { p_as_of: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_daily_vip7_v2', { p_date: today, p_actor_id: actorId }),
        supabase.rpc('get_customer_service_plus500_v2', { p_date: saleDay, p_actor_id: actorId }),
        supabase.rpc('get_customer_points_daily20_v2', { p_date: today, p_actor_id: actorId }),
      ]);
      const namedResults: Array<[string, typeof topResult]> = [
        ['أهم 50 عميل', topResult],
        ['تحليل 3 فترات', intelligenceResult],
        ['VIP اليوم', vipResult],
        ['فواتير +500', plusResult],
        ['نقاط اليوم', pointsResult],
      ];
      const failed = namedResults.find(([, result]) => result.error);
      if (failed) throw new Error(`${failed[0]}: ${failed[1].error?.message || 'خطأ غير معروف'}`);

      const topRows = (topResult.data || []) as Top50Row[];
      const intelligenceRows = (intelligenceResult.data || []) as IntelligenceRow[];
      setTop50(topRows);
      setIntelligence(intelligenceRows);

      const intelligenceMap = new Map(intelligenceRows.map((row) => [`${row.branch}|${row.customer_code}`, row]));
      setVipDaily(((vipResult.data || []) as Array<Record<string, unknown>>).map((r) => {
        const branch = String(r.branch || '');
        const code = String(r.customer_code || '');
        const signal = intelligenceMap.get(`${branch}|${code}`);
        return {
          code,
          name: String(r.customer_name || ''),
          phone: String(r.customer_phone || ''),
          branch,
          queueType: 'vip_recent' as const,
          rank: Number(r.customer_rank || 0),
          recentSales: Number(r.recent_sales || 0),
          activeMonths: Number(r.active_months || 0),
          lastPurchase: String(r.last_purchase || '') || null,
          value: Number(r.recent_sales || 0),
          trendState: signal?.trend_state,
          currentSales: Number(signal?.current_period_sales || 0),
          previousSales: Number(signal?.previous_period_sales || 0),
          priorSales: Number(signal?.prior_period_sales || 0),
          changeVsBaselinePct: signal?.change_vs_baseline_pct,
          label: `رقم ${Number(r.customer_rank || 0)} ضمن أهم 50 · آخر 3 شهور ${money(Number(r.recent_sales || 0))}${signal ? ` · ${signal.trend_state} ${pct(signal.change_vs_baseline_pct)}` : ''}`,
        };
      }));

      setLargeInvoices(((plusResult.data || []) as Array<Record<string, unknown>>).map((r) => ({
        code: String(r.customer_code || ''),
        name: String(r.customer_name || ''),
        phone: String(r.customer_phone || ''),
        branch: String(r.branch || ''),
        queueType: 'plus500' as const,
        invoiceCount: Number(r.qualifying_invoice_count || 0),
        value: Number(r.qualifying_total || 0),
        invoiceValues: Array.isArray(r.invoice_values) ? (r.invoice_values as InvoiceValue[]) : [],
        label: `${Number(r.qualifying_invoice_count || 0)} فاتورة ≥500 · الإجمالي ${money(Number(r.qualifying_total || 0))} · أعلى فاتورة ${money(Number(r.highest_invoice || 0))}`,
      })));

      setPointsDaily(((pointsResult.data || []) as Array<Record<string, unknown>>).map((r) => ({
        code: String(r.customer_code || ''),
        name: String(r.customer_name || ''),
        phone: String(r.customer_phone || ''),
        branch: String(r.branch || ''),
        queueType: 'points' as const,
        pointsBalance: Number(r.points_balance || 0),
        value: Number(r.points_balance || 0),
        label: `رصيد النقاط ${Number(r.points_balance || 0).toLocaleString('ar-EG')} نقطة${r.last_contacted_at ? ` · آخر إبلاغ ${new Date(String(r.last_contacted_at)).toLocaleDateString('ar-EG')}` : ' · لم يتم إبلاغه سابقًا'}`,
      })));

      // نسبة إنجاز قوائم اليوم (VIP + فواتير 500+ + النقاط) — مرئية لمسئول خدمة العملاء
      // ولمدير الفرع ومدير الفروع، وهي نفس المؤشر اللي بيغذي معيار التقييم الأسبوعي.
      const { data: completionData, error: completionError } = await supabase.rpc('get_customer_service_daily_queue_completion_v1', { p_date: today, p_actor_id: actorId });
      if (!completionError) setCompletion((completionData || []) as CompletionRow[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تحميل القوائم الذكية';
      setError(message);
      console.error('[CustomerDailyPriorityQueues] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [managerView, scopedBranch, user?.id]);

  async function markPointDone(customer: QueueCustomer) {
    try {
      const { error: markError } = await supabase.rpc('mark_customer_points_contacted_v2', {
        p_branch: customer.branch,
        p_customer_code: customer.code,
        p_actor_name: user?.name || 'خدمة العملاء',
        p_actor_id: user?.id,
      });
      if (markError) throw markError;
      toast.success(`تم تسجيل إبلاغ ${customer.name} برصيد النقاط`);
      await load();
    } catch (e) {
      toast.error(`تعذر التسجيل: ${(e as Error).message}`);
    }
  }

  async function exportExcel() {
    try {
      const XLSX = await import('xlsx');
      const resultColumns = {
        'تمت المتابعة': '',
        'تم الرد': '',
        'رد العميل': '',
        'عملية شراء': '',
        'قيمة عملية الشراء': '',
        'هل يحتاج متابعة أخرى': '',
        'موعد المتابعة القادمة': '',
        'ملاحظات': '',
      };
      const dailyRows = [...vipDaily, ...largeInvoices, ...pointsDaily].map((c) => ({
        'نوع القائمة': c.queueType === 'vip_recent' ? 'VIP آخر 3 شهور' : c.queueType === 'plus500' ? '+500' : 'نقاط',
        'الفرع': c.branch,
        'اسم العميل': c.name,
        'كود العميل': c.code,
        'الهاتف': c.phone,
        'حالة الاتجاه': c.trendState || '',
        'الفترة الحالية': c.currentSales ?? '',
        'الفترة السابقة': c.previousSales ?? '',
        'الفترة قبل السابقة': c.priorSales ?? '',
        'التغير عن المعتاد %': c.changeVsBaselinePct ?? '',
        'قيمة الفاتورة': c.queueType === 'plus500' ? Number(c.value || 0) : '',
        'عدد الفواتير': c.invoiceCount || '',
        'رصيد النقاط': c.queueType === 'points' ? Number(c.pointsBalance || 0) : '',
        'مبيعات آخر 3 شهور': c.queueType === 'vip_recent' ? Number(c.recentSales || 0) : '',
        'ترتيب أهم 50': c.rank || '',
        ...resultColumns,
      }));

      const topSheetRows = (branch: string) => top50.filter((r) => r.branch === branch).map((r) => {
        const signal = intelligence.find((item) => item.branch === branch && item.customer_code === r.customer_code);
        return {
          'الترتيب': r.customer_rank,
          'اسم العميل': r.customer_name || '',
          'كود العميل': r.customer_code,
          'الهاتف': r.customer_phone || '',
          'مبيعات آخر 3 شهور': Number(r.recent_sales || 0),
          'الفترة الحالية': Number(signal?.current_period_sales || 0),
          'الفترة السابقة': Number(signal?.previous_period_sales || 0),
          'الفترة قبل السابقة': Number(signal?.prior_period_sales || 0),
          'حالة الاتجاه': signal?.trend_state || '',
          'التغير عن المعتاد %': signal?.change_vs_baseline_pct ?? '',
          'عدد الفواتير': Number(r.invoice_count || 0),
          'الشهور النشطة': Number(r.active_months || 0),
          'متوسط الفاتورة': Number(r.avg_invoice || 0),
          'آخر شراء': r.last_purchase || '',
          'درجة الأهمية': Number(r.importance_score || 0),
        };
      });

      const intelligenceRows = intelligence.map((r) => ({
        'نوع القائمة': r.trend_state,
        'الفرع': r.branch,
        'الترتيب': r.customer_rank,
        'اسم العميل': r.customer_name || '',
        'كود العميل': r.customer_code,
        'الهاتف': r.customer_phone || '',
        'الحالة': r.trend_state,
        'مبيعات آخر 3 شهور': Number(r.recent_sales || 0),
        'الفترة الحالية': Number(r.current_period_sales || 0),
        'الفترة السابقة': Number(r.previous_period_sales || 0),
        'الفترة قبل السابقة': Number(r.prior_period_sales || 0),
        'متوسط الفترتين السابقتين': Number(r.baseline_sales || 0),
        'التغير عن الفترة السابقة %': r.change_vs_previous_pct ?? '',
        'التغير عن المعتاد %': r.change_vs_baseline_pct ?? '',
        'فواتير الحالي': r.current_invoices,
        'فواتير السابق': r.previous_invoices,
        'فواتير قبل السابق': r.prior_invoices,
        'آخر شراء': r.last_purchase || '',
        'درجة أولوية المتابعة': Number(r.priority_score || 0),
        ...resultColumns,
      }));

      const book = XLSX.utils.book_new();
      const add = (name: string, rows: Array<Record<string, unknown>>, widths: number[]) => {
        const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'ملاحظة': 'لا توجد بيانات' }]);
        (sheet as any)['!cols'] = widths.map((wch) => ({ wch }));
        if (rows.length) (sheet as any)['!autofilter'] = { ref: sheet['!ref'] };
        (sheet as any)['!views'] = [{ RTL: true }];
        XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
      };

      const instructions = [
        { 'الخطوة': '1', 'الشرح': 'كل صف = عميل واحد لازم يتم التواصل معاه اليوم.' },
        { 'الخطوة': '2', 'الشرح': 'شيت "المتابعة اليومية" = VIP + فواتير 500+ + النقاط. شيت "ذكاء 3 فترات" = تحليل مقارنة (تراجع/نمو/مستقر).' },
        { 'الخطوة': '3', 'الشرح': 'بعد التواصل مع العميل، املأ الأعمدة دي في نفس الصف: تمت المتابعة (نعم/لا)، تم الرد (نعم/لا)، رد العميل (اكتب اللي قاله العميل).' },
        { 'الخطوة': '4', 'الشرح': 'لو حصلت عملية شراء بعد المكالمة: اكتب "نعم" في عمود "عملية شراء" وحدد "قيمة عملية الشراء".' },
        { 'الخطوة': '5', 'الشرح': 'لو العميل محتاج متابعة تانية: اكتب "نعم" في "هل يحتاج متابعة أخرى" وحدد "موعد المتابعة القادمة".' },
        { 'الخطوة': '6', 'الشرح': 'لازم تكتب "ملاحظات" فيها تفاصيل واضحة عن المكالمة (10 حروف على الأقل) — ده مطلوب لتسجيل المتابعة كمكتملة في النظام.' },
        { 'الخطوة': '7', 'الشرح': 'بعد الانتهاء من الملف كله، ارفعه في "استيراد النتائج" من نفس صفحة متابعة العملاء. النظام بيقرأ كل الشيتات اللي فيها نتائج تلقائيًا.' },
        { 'الخطوة': '8', 'الشرح': 'لا تحذف أو تعيد ترتيب أي عمود في الشيت — الاستيراد بيدور على اسم العمود بالظبط.' },
      ];
      add('تعليمات الاستخدام', instructions, [10, 100]);

      add('المتابعة اليومية', dailyRows, [18,14,28,14,16,16,16,16,16,18,16,14,16,18,14,14,14,28,14,18,20,28]);
      add('ذكاء 3 فترات', intelligenceRows, [16,14,10,28,14,16,16,20,16,16,16,22,18,18,14,14,14,16,18,14,14,14,28,14,18,20,28]);
      if (managerView || scopedBranch === 'فرع شكري') add('Top50 شكري', topSheetRows('فرع شكري'), [10,28,14,16,20,16,16,16,16,18,14,14,18,14,16]);
      if (managerView || scopedBranch === 'فرع الشامي') add('Top50 الشامي', topSheetRows('فرع الشامي'), [10,28,14,16,20,16,16,16,16,18,14,14,18,14,16]);
      add('+500 أمس', largeInvoices.map((c) => ({
        'الفرع': c.branch,
        'اسم العميل': c.name,
        'الكود': c.code,
        'الهاتف': c.phone,
        'عدد الفواتير المؤهلة': c.invoiceCount,
        'إجمالي الفواتير المؤهلة': c.value,
        'تفاصيل الفواتير': c.invoiceValues?.map((v) => `${v.invoiceNumber || '-'}: ${v.value}`).join(' | ') || '',
      })), [14,28,14,16,20,22,50]);
      add('النقاط اليوم', pointsDaily.map((c) => ({ 'الفرع': c.branch, 'اسم العميل': c.name, 'الكود': c.code, 'الهاتف': c.phone, 'رصيد النقاط': c.pointsBalance })), [14,28,14,16,18]);
      (book as any).Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(book, `متابعة_خدمة_العملاء_${ymd(new Date())}.xlsx`);
      toast.success('تم تجهيز ملف Excel متكامل: المتابعة اليومية + تحليل 3 فترات + Top 50');
    } catch (e) {
      toast.error(`تعذر التصدير: ${(e as Error).message}`);
    }
  }

  const topCounts = useMemo(() => ({
    shokry: top50.filter((r) => r.branch === 'فرع شكري').length,
    shamy: top50.filter((r) => r.branch === 'فرع الشامي').length,
  }), [top50]);

  const riskCustomers = useMemo(() => intelligence.filter((r) => ['خطر فقد', 'تراجع قوي', 'تراجع'].includes(r.trend_state)).sort((a, b) => Number(b.priority_score) - Number(a.priority_score)), [intelligence]);
  const growthCustomers = useMemo(() => intelligence.filter((r) => ['نمو قوي', 'نمو', 'عميل صاعد جديد'].includes(r.trend_state)).sort((a, b) => Number(b.priority_score) - Number(a.priority_score)), [intelligence]);
  const stableCustomers = useMemo(() => intelligence.filter((r) => r.trend_state === 'مستقر').sort((a, b) => Number(b.recent_sales) - Number(a.recent_sales)), [intelligence]);
  const protectedValue = useMemo(() => riskCustomers.reduce((sum, r) => sum + Math.max(0, Number(r.baseline_sales || 0) - Number(r.current_period_sales || 0)), 0), [riskCustomers]);
  const growthValue = useMemo(() => growthCustomers.reduce((sum, r) => sum + Math.max(0, Number(r.current_period_sales || 0) - Number(r.baseline_sales || 0)), 0), [growthCustomers]);
  const period = intelligence[0];

  return <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-cyan-300/15 bg-[#0b2035] p-4 md:p-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black text-cyan-300">مركز ذكاء ومتابعة العملاء</p>
        <h2 className="mt-1 text-xl font-black text-white">قائمة عمل مسؤول خدمة العملاء — مبنية على حركة أفضل العملاء</h2>
        <p className="mt-1 max-w-5xl text-xs font-bold leading-6 text-slate-400">نختار أهم 50 عميل في كل فرع ممن اشتروا خلال آخر 3 شهور، ثم نقارن نفس عدد أيام دورة الصيدلية الحالية مع نفس المدة من الدورتين السابقتين. الهدف ليس مجرد قائمة أسماء: نكشف العميل المهم الذي بدأ يقلل تعامله، العميل الذي ينمو، وأفضل العملاء المستقرين للحفاظ عليهم.</p>
        {period ? <p className="mt-1 text-[11px] font-black text-cyan-200">المقارنة العادلة: {period.current_period_start} → {period.current_period_end} مقابل {period.previous_period_start} → {period.previous_period_end} ومقابل {period.prior_period_start} → {period.prior_period_end}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void exportExcel()} className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100"><Download size={14} className="ml-1 inline"/>تصدير Excel كامل</button>
        <button type="button" onClick={() => setImportOpen(true)} className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-100"><FileUp size={14} className="ml-1 inline"/>استيراد النتائج</button>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-200"><RefreshCw size={14} className={`ml-1 inline ${loading ? 'animate-spin' : ''}`}/>تحديث</button>
      </div>
    </div>

    {error ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-300/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-200"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-black text-rose-100 hover:bg-rose-400/20">إعادة المحاولة</button></div> : null}

    {completion.length ? <div className="grid gap-2 sm:grid-cols-2">
      {completion.map((row) => {
        const total = row.vip_total + row.plus500_total + row.points_total;
        const handled = row.vip_handled + row.plus500_handled + row.points_handled;
        const pctValue = total ? Math.round((handled / total) * 100) : null;
        const tone = pctValue === null ? 'text-slate-400' : pctValue >= 70 ? 'text-emerald-300' : pctValue >= 40 ? 'text-amber-300' : 'text-rose-300';
        return <div key={row.branch} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-black text-white"><Gauge size={14} className="text-cyan-300"/>{row.branch} · إنجاز اليوم</div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <span>VIP {row.vip_handled}/{row.vip_total} · 500+ {row.plus500_handled}/{row.plus500_total} · نقاط {row.points_handled}/{row.points_total}</span>
            <span className={`text-sm font-black ${tone}`}>{pctValue === null ? '—' : `${pctValue}%`}</span>
          </div>
        </div>;
      })}
    </div> : null}

    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <div className="rounded-2xl border border-rose-300/15 bg-rose-400/[0.06] p-3"><div className="flex items-center gap-2 text-xs font-black text-rose-200"><ShieldAlert size={15}/>عملاء مهمون معرضون للفقد</div><div className="mt-2 text-2xl font-black text-white">{riskCustomers.length}</div><div className="text-[11px] font-bold text-slate-400">من أفضل 100 عميل</div></div>
      <div className="rounded-2xl border border-rose-300/15 bg-rose-400/[0.035] p-3"><div className="text-xs font-black text-rose-200">فجوة مبيعات تستحق الاسترجاع</div><div className="mt-2 text-xl font-black text-white">{money(protectedValue)}</div><div className="text-[11px] font-bold text-slate-400">الحالي مقابل متوسط الفترتين السابقتين</div></div>
      <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.05] p-3"><div className="flex items-center gap-2 text-xs font-black text-emerald-200"><TrendingUp size={15}/>عملاء نمو وصعود</div><div className="mt-2 text-2xl font-black text-white">{growthCustomers.length}</div><div className="text-[11px] font-bold text-slate-400">نحافظ على سبب زيادة تعاملهم</div></div>
      <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.03] p-3"><div className="text-xs font-black text-emerald-200">نمو إضافي مكتسب</div><div className="mt-2 text-xl font-black text-white">{money(growthValue)}</div><div className="text-[11px] font-bold text-slate-400">فوق متوسط الفترتين السابقتين</div></div>
      <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.04] p-3"><div className="flex items-center gap-2 text-xs font-black text-cyan-200"><UsersRound size={15}/>أفضل عملاء مستقرين</div><div className="mt-2 text-2xl font-black text-white">{stableCustomers.length}</div><div className="text-[11px] font-bold text-slate-400">علاقة قوية يجب الحفاظ عليها</div></div>
    </div>

    <button type="button" onClick={() => setShowIntelligence((v) => !v)} className="flex w-full items-center justify-between rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] px-4 py-3 text-right">
      <span><span className="font-black text-white">لوحة قرارات مسؤول خدمة العملاء</span><span className="mr-3 text-xs font-bold text-slate-400">تراجع {riskCustomers.length} · نمو {growthCustomers.length} · مستقر {stableCustomers.length}</span></span>{showIntelligence ? <ChevronUp className="text-cyan-300"/> : <ChevronDown className="text-cyan-300"/>}
    </button>

    {showIntelligence ? <div className="grid gap-4 xl:grid-cols-3">
      <div className="max-h-[620px] overflow-auto rounded-2xl border border-rose-300/15 bg-rose-400/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-rose-200"><TrendingDown size={18}/><span className="font-black">أولوية الاسترجاع — العملاء الذين قل تعاملهم</span></div><div className="space-y-2">{riskCustomers.slice(0, 20).map((row) => <IntelligenceCard key={`risk-${row.branch}-${row.customer_code}`} row={row} mode="risk"/>)}{!riskCustomers.length && <div className="text-xs text-slate-400">لا توجد حالات تراجع مؤهلة.</div>}</div></div>
      <div className="max-h-[620px] overflow-auto rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-emerald-200"><TrendingUp size={18}/><span className="font-black">عملاء نمو — نعرف سبب الزيادة ونحافظ عليها</span></div><div className="space-y-2">{growthCustomers.slice(0, 20).map((row) => <IntelligenceCard key={`growth-${row.branch}-${row.customer_code}`} row={row} mode="growth"/>)}{!growthCustomers.length && <div className="text-xs text-slate-400">لا توجد حالات نمو مؤهلة.</div>}</div></div>
      <div className="max-h-[620px] overflow-auto rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.02] p-3"><div className="mb-3 flex items-center gap-2 text-cyan-200"><Crown size={18}/><span className="font-black">أفضل العملاء المستقرين — متابعة علاقة ورضا</span></div><div className="space-y-2">{stableCustomers.slice(0, 20).map((row) => <IntelligenceCard key={`stable-${row.branch}-${row.customer_code}`} row={row} mode="stable"/>)}{!stableCustomers.length && <div className="text-xs text-slate-400">لا توجد حالات مستقرة مؤهلة.</div>}</div></div>
    </div> : null}

    <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
      <div className="mb-3"><div className="text-sm font-black text-white">مهام اليوم التنفيذية</div><div className="mt-1 text-[11px] font-bold text-slate-400">هنا تتحول التحليلات إلى شغل يومي واضح: 7 من أهم العملاء + كل فواتير 500+ + 20 عميل لإبلاغ النقاط.</div></div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="max-h-[590px] overflow-auto rounded-2xl border border-amber-300/10 bg-amber-300/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-amber-200"><Crown size={18}/><span className="font-black">7 من أهم العملاء اليوم</span></div><BranchQueue title="VIP آخر 3 شهور" customers={vipDaily} loading={loading}/></div>
        <div className="max-h-[590px] overflow-auto rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-emerald-200"><BadgeDollarSign size={18}/><span className="font-black">كل عملاء +500 أمس</span></div><BranchQueue title={`فواتير ${ymd(yesterday)}`} customers={largeInvoices} loading={loading}/></div>
        <div className="max-h-[590px] overflow-auto rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3"><div className="mb-3 flex items-center gap-2 text-cyan-200"><Gift size={18}/><span className="font-black">20 عميل نقاط اليوم</span></div><BranchQueue title="الأقدم في الإبلاغ أولًا" customers={pointsDaily} onPointDone={(c) => void markPointDone(c)} loading={loading}/></div>
      </div>
    </div>

    <button type="button" onClick={() => setShowTop50((v) => !v)} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-right">
      <span><span className="font-black text-white">قائمة أهم 50 عميل لكل فرع — آخر 3 شهور فقط</span><span className="mr-3 text-xs font-bold text-slate-400">شكري {topCounts.shokry}/50 · الشامي {topCounts.shamy}/50</span></span>{showTop50 ? <ChevronUp className="text-cyan-300"/> : <ChevronDown className="text-cyan-300"/>}
    </button>

    {showTop50 ? <div className="grid gap-4 xl:grid-cols-2">{['فرع شكري', 'فرع الشامي'].map((branch) => {
      const rows = top50.filter((r) => r.branch === branch);
      if (!rows.length) return null;
      return <div key={branch} className="max-h-[560px] overflow-auto rounded-2xl border border-white/10">
        <div className="sticky top-0 z-10 bg-[#173252] px-4 py-3 text-sm font-black text-white">{branch} — {rows.length} عميل</div>
        <table className="min-w-[1040px] w-full text-xs"><thead className="bg-[#102941] text-slate-400"><tr>{['#','العميل','الحالة','الحالي','السابق','قبله','تغير %','مبيعات 3 شهور','آخر شراء'].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{rows.map((r) => {
          const signal = intelligence.find((item) => item.branch === branch && item.customer_code === r.customer_code);
          return <tr key={`${branch}-${r.customer_code}`} className="border-t border-white/5 text-slate-200"><td className="p-2 font-black text-cyan-300">{r.customer_rank}</td><td className="p-2"><div className="font-black text-white">{r.customer_name}</div><div className="text-[10px] text-slate-500">كود {r.customer_code}</div></td><td className="p-2">{signal ? <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${trendTone(signal.trend_state)}`}>{signal.trend_state}</span> : '—'}</td><td className="p-2 font-bold">{money(Number(signal?.current_period_sales || 0))}</td><td className="p-2">{money(Number(signal?.previous_period_sales || 0))}</td><td className="p-2">{money(Number(signal?.prior_period_sales || 0))}</td><td className="p-2 font-black">{pct(signal?.change_vs_baseline_pct)}</td><td className="p-2 font-bold">{money(Number(r.recent_sales || 0))}</td><td className="p-2">{r.last_purchase || '—'}</td></tr>;
        })}</tbody></table>
      </div>;
    })}</div> : null}

    <SmartQueueExcelImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void load()} branch={importBranch}/>
  </section>;
}
