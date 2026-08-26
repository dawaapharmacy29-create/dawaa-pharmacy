import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Database,
  Download,
  MessageSquare,
  Percent,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Users,
  WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BRANCHES } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { cashbackStatusLabel } from '@/lib/api/customerLoyalty';
import { cleanEgyptianPhone, generateWhatsAppLink } from '@/lib/whatsapp';
import { friendlySupabaseError } from '@/lib/supabaseError';

const ALL = '__all__';
const PAGE_SIZE = 100;
const CACHE_TTL_MS = 30_000;
const SHAMY = 'فرع الشامي';
const SHAMY_EXCEPTION_START = '2026-04-01';
const SHAMY_EXCEPTION_END = '2026-07-31';

type CashbackRow = {
  id: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  cycle_label: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  total_spent: number | null;
  cashback_rate: number | null;
  cashback_value: number | null;
  redeemed_value: number | null;
  remaining_value: number | null;
  status: string | null;
  notified_at: string | null;
  bconnect_updated_at: string | null;
  settled_at: string | null;
  notes: string | null;
};

type Summary = {
  total: number;
  available: number;
  pending: number;
  notified: number;
  bconnect: number;
  partial: number;
  settled: number;
  rate3: number;
  rate5: number;
  systemLog: number;
};

type Totals = { count: number; spent: number; cashback: number; remaining: number };
type FastPayload = { rows: CashbackRow[]; summary: Summary; totals: Totals; limit: number; offset: number };

type Props = { forcedBranch?: string };

const EMPTY_SUMMARY: Summary = {
  total: 0,
  available: 0,
  pending: 0,
  notified: 0,
  bconnect: 0,
  partial: 0,
  settled: 0,
  rate3: 0,
  rate5: 0,
  systemLog: 0,
};
const EMPTY_TOTALS: Totals = { count: 0, spent: 0, cashback: 0, remaining: 0 };
const responseCache = new Map<string, { at: number; payload: FastPayload }>();

function localDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function standardQuarterBounds(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  let start: Date;
  let end: Date;
  if (month >= 2 && month <= 4) {
    start = new Date(year - 1, 10, 1);
    end = new Date(year, 0, 31);
  } else if (month >= 5 && month <= 7) {
    start = new Date(year, 1, 1);
    end = new Date(year, 3, 30);
  } else if (month >= 8 && month <= 10) {
    start = new Date(year, 4, 1);
    end = new Date(year, 6, 31);
  } else {
    start = new Date(year, 7, 1);
    end = new Date(year, 9, 31);
  }
  return { start: localDateOnly(start), end: localDateOnly(end) };
}

function boundsForBranch(branch: string, standard: { start: string; end: string }) {
  if (branch === SHAMY && standard.start === '2026-05-01' && standard.end === SHAMY_EXCEPTION_END) {
    return { start: SHAMY_EXCEPTION_START, end: SHAMY_EXCEPTION_END };
  }
  return standard;
}

function previousQuarterBounds() {
  const current = standardQuarterBounds();
  const date = new Date(`${current.start}T12:00:00`);
  date.setMonth(date.getMonth() - 3);
  return standardQuarterBounds(date);
}

function rowRemaining(row: CashbackRow) {
  return Math.max(0, Number(row.cashback_value || 0) - Number(row.redeemed_value || 0));
}

function statusTone(status?: string | null) {
  const value = String(status || 'calculated');
  if (value === 'settled') return 'border-sky-400/25 bg-sky-500/5';
  if (value === 'bconnect_updated') return 'border-violet-400/25 bg-violet-500/5';
  if (value === 'notified') return 'border-emerald-400/25 bg-emerald-500/5';
  if (value === 'partially_redeemed') return 'border-cyan-400/25 bg-cyan-500/5';
  return 'border-[var(--theme-border)] bg-[var(--theme-surface)]';
}

function normalizePayload(value: any): FastPayload {
  return {
    rows: Array.isArray(value?.rows) ? value.rows : [],
    summary: { ...EMPTY_SUMMARY, ...(value?.summary || {}) },
    totals: { ...EMPTY_TOTALS, ...(value?.totals || {}) },
    limit: Number(value?.limit || PAGE_SIZE),
    offset: Number(value?.offset || 0),
  };
}

export default function CustomerCashbackFast({ forcedBranch = '' }: Props) {
  const standardCurrent = useMemo(() => standardQuarterBounds(), []);
  const previous = useMemo(() => previousQuarterBounds(), []);
  const initialBranch = forcedBranch || ALL;
  const initialBounds = useMemo(() => boundsForBranch(initialBranch, standardCurrent), [initialBranch, standardCurrent]);

  const [branch, setBranch] = useState(initialBranch);
  const [cycleStart, setCycleStart] = useState(initialBounds.start);
  const [cycleEnd, setCycleEnd] = useState(initialBounds.end);
  const [status, setStatus] = useState(ALL);
  const [quickFilter, setQuickFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [payload, setPayload] = useState<FastPayload>({ rows: [], summary: EMPTY_SUMMARY, totals: EMPTY_TOTALS, limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(0), [branch, cycleStart, cycleEnd, status, quickFilter, debouncedSearch]);

  const cacheKey = useMemo(
    () => [cycleStart, cycleEnd, branch, status, quickFilter, debouncedSearch, page].join('|'),
    [branch, cycleEnd, cycleStart, debouncedSearch, page, quickFilter, status]
  );

  const load = useCallback(async (force = false) => {
    const cached = responseCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setPayload(cached.payload);
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    if (payload.rows.length) setRefreshing(true);
    else setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_fast_page_v1', {
        p_cycle_start: cycleStart,
        p_cycle_end: cycleEnd,
        p_branch: branch === ALL ? null : branch,
        p_status: status === ALL ? null : status,
        p_quick_filter: quickFilter,
        p_search: debouncedSearch || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      if (seq !== requestSeq.current) return;
      const next = normalizePayload(data);
      responseCache.set(cacheKey, { at: Date.now(), payload: next });
      setPayload(next);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      toast.error(friendlySupabaseError(error as any) || 'تعذر تحميل نقاط العملاء');
      if (!payload.rows.length) setPayload({ rows: [], summary: EMPTY_SUMMARY, totals: EMPTY_TOTALS, limit: PAGE_SIZE, offset: 0 });
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [branch, cacheKey, cycleEnd, cycleStart, debouncedSearch, page, payload.rows.length, quickFilter, status]);

  useEffect(() => { void load(); }, [load]);

  const invalidateAndReload = useCallback(async () => {
    responseCache.clear();
    await load(true);
  }, [load]);

  const updateRow = async (row: CashbackRow, patch: Record<string, unknown>, eventType: string, amount?: number) => {
    try {
      const { error } = await supabase.from('customer_cashback_cycles').update(patch).eq('id', row.id);
      if (error) throw error;
      const { error: eventError } = await supabase.from('customer_cashback_events').insert({
        cycle_id: row.id,
        customer_code: row.customer_code,
        event_type: eventType,
        amount: amount ?? null,
      });
      if (eventError) console.warn('[cashback-fast] event log failed', eventError);
      await invalidateAndReload();
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر حفظ التعديل');
    }
  };

  const calculate = async () => {
    if (branch === ALL) {
      toast.error('اختار الفرع الأول قبل احتساب الكاش باك.');
      return;
    }
    setCalculating(true);
    try {
      const { data, error } = await (supabase as any).rpc('calculate_customer_cashback_cycle_for_branch_v1', {
        p_cycle_start: cycleStart,
        p_cycle_end: cycleEnd,
        p_branch: branch,
      });
      if (error) throw error;
      toast.success(`تم احتساب الكاش باك لـ ${Number(data || 0).toLocaleString('ar-EG')} عميل`);
      await invalidateAndReload();
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر احتساب الكاش باك');
    } finally {
      setCalculating(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const rows: CashbackRow[] = [];
      let offset = 0;
      let total = Number(payload.totals.count || 0);
      while (offset < total) {
        const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_fast_page_v1', {
          p_cycle_start: cycleStart,
          p_cycle_end: cycleEnd,
          p_branch: branch === ALL ? null : branch,
          p_status: status === ALL ? null : status,
          p_quick_filter: quickFilter,
          p_search: debouncedSearch || null,
          p_limit: 200,
          p_offset: offset,
        });
        if (error) throw error;
        const chunk = normalizePayload(data);
        rows.push(...chunk.rows);
        total = Number(chunk.totals.count || total);
        if (!chunk.rows.length) break;
        offset += chunk.rows.length;
      }
      const { exportToExcel } = await import('@/lib/exportExcel');
      await exportToExcel(rows.map((row) => ({
        'الكود': row.customer_code || '',
        'الاسم': row.customer_name || '',
        'الهاتف': row.customer_phone || '',
        'الفرع': row.branch || '',
        'الدورة': row.cycle_label || `${row.cycle_start || ''} - ${row.cycle_end || ''}`,
        'إجمالي المشتريات': Number(row.total_spent || 0),
        'النسبة': Number(row.cashback_rate || 0),
        'قيمة الكاش باك': Number(row.cashback_value || 0),
        'المسحوب': Number(row.redeemed_value || 0),
        'المتبقي': rowRemaining(row),
        'الحالة': cashbackStatusLabel(row.status),
      })), `كاش_باك_${cycleStart}_${cycleEnd}`, 'الكاش باك');
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || 'تعذر تصدير Excel');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(Number(payload.totals.count || 0) / PAGE_SIZE));
  const firstShown = payload.totals.count ? page * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min((page + 1) * PAGE_SIZE, Number(payload.totals.count || 0));

  const summaryCards = [
    ['all', 'إجمالي العملاء', payload.summary.total, Users],
    ['pending', 'لم يتم التعامل', payload.summary.pending, Clock3],
    ['available', 'لهم نقاط', payload.summary.available, Coins],
    ['notified', 'تم تبليغهم', payload.summary.notified, Send],
    ['bconnect', 'اتغيروا على بي كونكت', payload.summary.bconnect, Smartphone],
    ['partial', 'سحبوا جزء', payload.summary.partial, WalletCards],
    ['settled', 'تمت التسوية', payload.summary.settled, CheckCircle2],
    ['rate5', 'عملاء 5%', payload.summary.rate5, Percent],
    ['rate3', 'عملاء 3%', payload.summary.rate3, Percent],
    ['systemlog', 'سجل السيستم', payload.summary.systemLog, Database],
  ] as const;

  return (
    <div className="customer-service-page space-y-4" dir="rtl">
      <section className="dawaa-hero flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="dawaa-brand-chip">Fast Customer Cashback</span>
          <h1 className="mt-3 text-2xl font-black text-[var(--theme-heading)]">نقاط العملاء / الكاش باك</h1>
          <p className="mt-1 text-sm font-semibold text-[var(--theme-muted)]">تحميل سريع ومستقر — البيانات والإجماليات من السيرفر والجدول 100 عميل في الصفحة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="dawaa-button-primary" onClick={() => void calculate()} disabled={calculating}>
            {calculating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} احتساب الكاش باك
          </button>
          <button type="button" className="btn-secondary" onClick={() => void exportExcel()} disabled={exporting}>
            {exporting ? <RefreshCw className="ml-1 inline h-4 w-4 animate-spin" /> : <Download className="ml-1 inline h-4 w-4" />} Excel
          </button>
          <button type="button" className="btn-secondary" onClick={() => void invalidateAndReload()} disabled={refreshing}>
            <RefreshCw className={`ml-1 inline h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </section>

      <section className="dawaa-panel grid gap-3 lg:grid-cols-6">
        <button type="button" className="btn-secondary" onClick={() => {
          const b = boundsForBranch(branch, standardCurrent);
          setCycleStart(b.start); setCycleEnd(b.end);
        }}>الدورة الحالية</button>
        <button type="button" className="btn-secondary" onClick={() => { setCycleStart(previous.start); setCycleEnd(previous.end); }}>الدورة السابقة</button>
        <input type="date" className="dawaa-input" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} />
        <input type="date" className="dawaa-input" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)} />
        <select className="dawaa-input" value={branch} disabled={Boolean(forcedBranch)} onChange={(e) => {
          const next = e.target.value;
          const wasSpecial = cycleStart === SHAMY_EXCEPTION_START && cycleEnd === SHAMY_EXCEPTION_END;
          setBranch(next);
          if (next === SHAMY && standardCurrent.start === '2026-05-01' && standardCurrent.end === SHAMY_EXCEPTION_END) {
            setCycleStart(SHAMY_EXCEPTION_START); setCycleEnd(SHAMY_EXCEPTION_END);
          } else if (next !== SHAMY && wasSpecial) {
            setCycleStart(standardCurrent.start); setCycleEnd(standardCurrent.end);
          }
        }}>
          {!forcedBranch ? <option value={ALL}>كل الفروع</option> : null}
          {BRANCHES.filter((item) => !forcedBranch || item === forcedBranch).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="dawaa-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value={ALL}>كل الحالات</option>
          <option value="calculated">لم يتم التعامل</option>
          <option value="notified">تم تبليغ العميل</option>
          <option value="bconnect_updated">تم تحديث بي كونكت</option>
          <option value="partially_redeemed">تم سحب جزء</option>
          <option value="settled">تمت التسوية</option>
        </select>
      </section>

      <section className="grid gap-2 md:grid-cols-5 xl:grid-cols-10">
        {summaryCards.map(([key, label, value, Icon]) => (
          <button key={key} type="button" onClick={() => setQuickFilter(key)} className={`rounded-2xl border p-3 text-right transition ${quickFilter === key ? 'border-teal-300 bg-teal-500/15 ring-1 ring-teal-300' : 'border-[var(--theme-border)] bg-[var(--theme-surface)] hover:border-teal-400/40'}`}>
            <Icon className="h-4 w-4 text-teal-300" />
            <div className="mt-2 text-[11px] font-bold text-[var(--theme-muted)]">{label}</div>
            <div className="mt-1 text-xl font-black text-[var(--theme-heading)]">{Number(value || 0).toLocaleString('ar-EG')}</div>
          </button>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Kpi label="عدد العملاء في القائمة" value={Number(payload.totals.count || 0).toLocaleString('ar-EG')} />
        <Kpi label="إجمالي مشتريات القائمة" value={formatCurrency(Number(payload.totals.spent || 0))} />
        <Kpi label="قيمة الكاش باك" value={formatCurrency(Number(payload.totals.cashback || 0))} />
        <Kpi label="المتبقي للعملاء" value={formatCurrency(Number(payload.totals.remaining || 0))} />
      </section>

      <section className="dawaa-panel space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[280px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--theme-muted)]" />
            <input className="dawaa-input w-full pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم / الكود / الهاتف" />
          </div>
          <div className="text-xs font-bold text-[var(--theme-muted)]">
            {refreshing ? 'جارٍ تحديث البيانات…' : `عرض ${firstShown.toLocaleString('ar-EG')}–${lastShown.toLocaleString('ar-EG')} من ${Number(payload.totals.count || 0).toLocaleString('ar-EG')}`}
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--theme-border)]">
          <table className="w-full min-w-[1180px] text-sm text-[var(--theme-text)]">
            <thead className="bg-[var(--theme-table-head)] text-xs text-[var(--theme-muted)]">
              <tr className="text-right"><th className="p-3">العميل</th><th className="p-3">الفرع</th><th className="p-3">المشتريات</th><th className="p-3">النسبة</th><th className="p-3">المستحق</th><th className="p-3">المسحوب</th><th className="p-3">المتبقي</th><th className="p-3">الحالة</th><th className="p-3">إجراءات سريعة</th></tr>
            </thead>
            <tbody>
              {loading && !payload.rows.length ? (
                Array.from({ length: 8 }).map((_, index) => <tr key={index}><td colSpan={9} className="p-3"><div className="h-9 animate-pulse rounded-xl bg-slate-700/20" /></td></tr>)
              ) : payload.rows.length ? payload.rows.map((row) => {
                const wa = row.customer_phone ? generateWhatsAppLink(cleanEgyptianPhone(row.customer_phone), `أهلاً أ/ ${row.customer_name || 'حضرتك'} 🌷\nمع حضرتك خدمة عملاء صيدليات دواء. ليك نقاط/كاش باك بقيمة ${formatCurrency(row.cashback_value || 0)}.`) : '';
                return (
                  <tr key={row.id} className={`border-t ${statusTone(row.status)}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '54px' }}>
                    <td className="p-3"><div className="font-black">{row.customer_name || 'عميل بدون اسم'}</div><div className="text-xs text-[var(--theme-muted)]">{row.customer_code || '-'} · {row.customer_phone || '-'}</div></td>
                    <td className="p-3 font-bold">{row.branch || '-'}</td>
                    <td className="p-3 font-bold">{formatCurrency(row.total_spent || 0)}</td>
                    <td className="p-3">{Number(row.cashback_rate || 0)}%</td>
                    <td className="p-3 font-black text-emerald-400">{formatCurrency(row.cashback_value || 0)}</td>
                    <td className="p-3">{formatCurrency(row.redeemed_value || 0)}</td>
                    <td className="p-3 font-black text-teal-300">{formatCurrency(rowRemaining(row))}</td>
                    <td className="p-3"><span className="rounded-full border border-teal-400/30 bg-teal-500/10 px-2 py-1 text-xs font-bold">{cashbackStatusLabel(row.status)}</span></td>
                    <td className="p-3"><div className="flex flex-wrap gap-1.5">
                      {wa ? <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary !px-2 !py-1 text-xs"><MessageSquare className="h-3.5 w-3.5" /> واتساب</a> : null}
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => void updateRow(row, { status: 'notified', notified_at: new Date().toISOString() }, 'notified')}><Send className="h-3.5 w-3.5" /> تبليغ</button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => void updateRow(row, { status: 'bconnect_updated', bconnect_updated_at: new Date().toISOString() }, 'bconnect_updated')}><Smartphone className="h-3.5 w-3.5" /> بي كونكت</button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => {
                        const raw = window.prompt(`المتبقي ${formatCurrency(rowRemaining(row))}\nاكتب قيمة السحب:`);
                        if (!raw) return;
                        const amount = Number(raw);
                        if (!Number.isFinite(amount) || amount <= 0 || amount > rowRemaining(row)) { toast.error('قيمة السحب غير صحيحة'); return; }
                        const redeemed = Number(row.redeemed_value || 0) + amount;
                        const settled = redeemed >= Number(row.cashback_value || 0);
                        void updateRow(row, { redeemed_value: redeemed, status: settled ? 'settled' : 'partially_redeemed', ...(settled ? { settled_at: new Date().toISOString() } : {}) }, settled ? 'settled' : 'partially_redeemed', amount);
                      }}><WalletCards className="h-3.5 w-3.5" /> سحب</button>
                    </div></td>
                  </tr>
                );
              }) : <tr><td colSpan={9} className="p-8 text-center font-bold text-[var(--theme-muted)]">لا توجد بيانات مطابقة</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-bold text-[var(--theme-muted)]">صفحة {(page + 1).toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}</div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronRight className="h-4 w-4" /> السابق</button>
            <button className="btn-secondary" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>التالي <ChevronLeft className="h-4 w-4" /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4"><div className="text-xs font-bold text-[var(--theme-muted)]">{label}</div><div className="mt-2 text-2xl font-black text-[var(--theme-heading)]">{value}</div></div>;
}
