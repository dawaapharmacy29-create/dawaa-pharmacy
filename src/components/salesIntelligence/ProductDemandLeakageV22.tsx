import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Boxes, CircleAlert, RefreshCw, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { runProductDemandBackfillV22 } from '@/lib/whatsappProductDemandBackfillV22';

type DemandRow = {
  cycle_start: string;
  cycle_end: string;
  branch: string | null;
  product_id: string;
  product_code: string;
  product_name: string;
  inquiry_opportunities: number;
  unique_customers: number;
  unavailable_count: number;
  accepted_or_later_count: number;
  acceptance_rate: number | null;
  conversation_verified_count: number;
};

type LeakageRow = {
  cycle_start: string;
  cycle_end: string;
  branch: string | null;
  leakage_code: string;
  cases_count: number;
  unique_customers: number;
  unique_products: number;
};

type BackfillStatus = {
  analyzable_sources: number;
  analyzed_v22: number;
  remaining_sources: number;
  completion_percent: number | string | null;
};

type UnresolvedRow = {
  cycle_start: string;
  cycle_end: string;
  branch: string | null;
  unresolved_mentions: number;
  conversations_affected: number;
};

const LEAK_LABELS: Record<string, string> = {
  stock_unavailable: 'عدم توفر الصنف',
  no_alternative: 'عدم حسم البديل بعد عدم التوفر',
  price_objection: 'اعتراض على السعر',
  response_delay: 'تأخر الرد',
  closing_gap: 'فجوة في إغلاق البيع',
  customer_no_reply: 'العميل لم يرد',
  recommendation_pending: 'ترشيح أو بديل بدون حسم',
  delivery_issue: 'مشكلة تنفيذ أو توصيل',
  customer_rejected: 'رفض العميل',
  unknown: 'سبب غير محسوم',
};

export default function ProductDemandLeakageV22() {
  const [demand, setDemand] = useState<DemandRow[]>([]);
  const [leakage, setLeakage] = useState<LeakageRow[]>([]);
  const [unresolved, setUnresolved] = useState<UnresolvedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<'all' | string>('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [{ data: d, error: de }, { data: l, error: le }, { data: u, error: ue }, { data: bs, error: bse }] = await Promise.all([
        supabase.from('whatsapp_product_demand_monthly_v22').select('*').order('cycle_start', { ascending: false }).order('inquiry_opportunities', { ascending: false }).limit(200),
        supabase.from('whatsapp_sales_leakage_monthly_v22').select('*').order('cycle_start', { ascending: false }).order('cases_count', { ascending: false }).limit(200),
        supabase.from('whatsapp_product_demand_unresolved_v22').select('*').order('cycle_start', { ascending: false }).limit(100),
        supabase.from('whatsapp_product_demand_backfill_status_v22').select('*').maybeSingle(),
      ]);
      if (de || le || ue || bse) throw de || le || ue || bse;
      setDemand((d || []) as DemandRow[]);
      setLeakage((l || []) as LeakageRow[]);
      setUnresolved((u || []) as UnresolvedRow[]);
      setBackfillStatus((bs || null) as BackfillStatus | null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل تحليل الطلب على الأصناف وأسباب فقد البيع.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function previewBackfill() {
    setBackfillRunning(true);
    setBackfillMessage(null);
    try {
      const result = await runProductDemandBackfillV22({ limit: 20, dryRun: true });
      setBackfillMessage(
        `معاينة آمنة: ${result.scanned} محادثة • ${result.canonicalProducts} صنف مرتبط بالكتالوج • ${result.unresolvedProducts} عبارة غير محسومة • أخطاء ${result.failed}`
      );
    } catch (cause) {
      setBackfillMessage(cause instanceof Error ? cause.message : 'تعذرت معاينة إعادة التحليل.');
    } finally {
      setBackfillRunning(false);
    }
  }

  async function executeBackfill() {
    setBackfillRunning(true);
    setBackfillMessage(null);
    try {
      const result = await runProductDemandBackfillV22({ limit: 20, dryRun: false });
      setBackfillMessage(
        `تمت إعادة التحليل: ${result.written} محادثة • ${result.canonicalProducts} صنف مرتبط بالكتالوج • ${result.unresolvedProducts} عبارة غير محسومة • أخطاء ${result.failed}`
      );
      await load();
    } catch (cause) {
      setBackfillMessage(cause instanceof Error ? cause.message : 'تعذر تنفيذ إعادة التحليل.');
    } finally {
      setBackfillRunning(false);
    }
  }

  const latestCycle = useMemo(() => {
    const values = [...demand, ...leakage, ...unresolved].map((row) => row.cycle_start).filter(Boolean).sort().reverse();
    return values[0] || null;
  }, [demand, leakage, unresolved]);

  const branches = useMemo(
    () => Array.from(new Set([...demand, ...leakage, ...unresolved].map((row) => row.branch).filter(Boolean))) as string[],
    [demand, leakage, unresolved]
  );
  const cycleDemand = useMemo(
    () => demand.filter((r) => (!latestCycle || r.cycle_start === latestCycle) && (branchFilter === 'all' || r.branch === branchFilter)),
    [demand, latestCycle, branchFilter]
  );
  const cycleLeakage = useMemo(
    () => leakage.filter((r) => (!latestCycle || r.cycle_start === latestCycle) && (branchFilter === 'all' || r.branch === branchFilter)),
    [leakage, latestCycle, branchFilter]
  );
  const cycleUnresolved = useMemo(
    () => unresolved.filter((r) => (!latestCycle || r.cycle_start === latestCycle) && (branchFilter === 'all' || r.branch === branchFilter)),
    [unresolved, latestCycle, branchFilter]
  );

  const totals = useMemo(() => ({
    demand: cycleDemand.reduce((sum, row) => sum + Number(row.inquiry_opportunities || 0), 0),
    customers: cycleDemand.reduce((sum, row) => sum + Number(row.unique_customers || 0), 0),
    accepted: cycleDemand.reduce((sum, row) => sum + Number(row.accepted_or_later_count || 0), 0),
    unresolved: cycleUnresolved.reduce((sum, row) => sum + Number(row.unresolved_mentions || 0), 0),
  }), [cycleDemand, cycleUnresolved]);

  return (
    <section className="dawaa-card" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black"><BarChart3 size={18} /> ذكاء الطلب على الأصناف وفقد المبيعات</div>
          <div className="dawaa-muted mt-1 text-xs">
            يحتسب فقط الأصناف المرتبطة فعليًا بسجل الأصناف. العبارات غير المحسومة تُراقب منفصلة ولا تدخل ترتيب أكثر الأصناف طلبًا.
          </div>
          {latestCycle ? <div className="dawaa-muted mt-1 text-[11px]">الدورة: {latestCycle} → {cycleDemand[0]?.cycle_end || cycleLeakage[0]?.cycle_end || '—'}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void previewBackfill()} disabled={backfillRunning} className="dawaa-button dawaa-button--ghost text-xs">
            معاينة إعادة تحليل ٢٠ محادثة
          </button>
          <button type="button" onClick={() => void executeBackfill()} disabled={backfillRunning} className="dawaa-button dawaa-button--secondary text-xs">
            {backfillRunning ? <RefreshCw size={14} className="animate-spin" /> : null}
            إعادة تحليل ٢٠ محادثة
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="dawaa-button dawaa-button--secondary text-xs">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error ? <div className="dawaa-alert dawaa-alert--danger mt-3 text-xs">{error}</div> : null}
      {backfillMessage ? <div className="dawaa-alert dawaa-alert--info mt-3 text-xs">{backfillMessage}</div> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="dawaa-muted text-xs">الفرع:</span>
        <button type="button" onClick={() => setBranchFilter('all')} className={branchFilter === 'all' ? 'dawaa-badge dawaa-badge--info' : 'dawaa-button dawaa-button--ghost text-xs'}>كل الفروع</button>
        {branches.map((branch) => (
          <button key={branch} type="button" onClick={() => setBranchFilter(branch)} className={branchFilter === branch ? 'dawaa-badge dawaa-badge--info' : 'dawaa-button dawaa-button--ghost text-xs'}>
            {branch}
          </button>
        ))}
      </div>

      {backfillStatus ? (
        <div className="mt-4 rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="font-black">تقدم إعادة تحليل المحادثات التاريخية</div>
            <div className="dawaa-badge dawaa-badge--info">{Number(backfillStatus.completion_percent || 0).toLocaleString('ar-EG')}٪</div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, Number(backfillStatus.completion_percent || 0)))}%` }} />
          </div>
          <div className="dawaa-muted mt-2 text-[11px]">
            قابل للتحليل: {Number(backfillStatus.analyzable_sources || 0).toLocaleString('ar-EG')} • تم V22: {Number(backfillStatus.analyzed_v22 || 0).toLocaleString('ar-EG')} • متبقي: {Number(backfillStatus.remaining_sources || 0).toLocaleString('ar-EG')}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
          <div className="dawaa-muted text-xs">طلبات أصناف مرتبطة بالكتالوج</div>
          <div className="mt-1 text-2xl font-black">{totals.demand.toLocaleString('ar-EG')}</div>
        </div>
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
          <div className="dawaa-muted text-xs">عملاء فريدون</div>
          <div className="mt-1 text-2xl font-black">{totals.customers.toLocaleString('ar-EG')}</div>
        </div>
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
          <div className="dawaa-muted text-xs">وصلوا للقبول أو أبعد</div>
          <div className="mt-1 text-2xl font-black">{totals.accepted.toLocaleString('ar-EG')}</div>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="dawaa-muted text-xs">عبارات منتجات غير محسومة</div>
          <div className="mt-1 text-2xl font-black">{totals.unresolved.toLocaleString('ar-EG')}</div>
          <div className="dawaa-muted mt-1 text-[10px]">مؤشر جودة للمحرك — لا تدخل ترتيب المنتجات</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="mb-3 flex items-center gap-2 font-black"><Boxes size={16} /> أكثر الأصناف سؤالًا في الدورة</div>
          {!cycleDemand.length ? <div className="dawaa-empty-state py-6 text-center text-xs">لا توجد أصناف مرتبطة بالكتالوج من التحليل الجديد في هذه الدورة حتى الآن.</div> :
            cycleDemand.slice(0, 12).map((row, index) => (
              <div key={row.product_id + ':' + (row.branch || '')} className="grid grid-cols-[32px_1fr_auto] items-center gap-2 border-t border-[var(--dawaa-theme-border)] py-2 text-xs">
                <b>{index + 1}</b>
                <div>
                  <div className="font-bold">{row.product_name}</div>
                  <div className="dawaa-muted">كود {row.product_code} • {row.branch || 'كل الفروع'}</div>
                </div>
                <div className="text-left">
                  <div className="font-black">{Number(row.inquiry_opportunities).toLocaleString('ar-EG')} طلب</div>
                  <div className="dawaa-muted">قبول {row.acceptance_rate == null ? '—' : Number(row.acceptance_rate).toLocaleString('ar-EG') + '٪'}</div>
                </div>
              </div>
            ))}
        </div>

        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="mb-3 flex items-center gap-2 font-black"><CircleAlert size={16} /> أسباب عدم اكتمال البيع</div>
          {!cycleLeakage.length ? <div className="dawaa-empty-state py-6 text-center text-xs">لا توجد أسباب فقد بيع مؤكدة من التحليل الجديد في هذه الدورة حتى الآن.</div> :
            cycleLeakage.slice(0, 12).map((row) => (
              <div key={(row.branch || '') + ':' + row.leakage_code} className="flex items-center justify-between gap-3 border-t border-[var(--dawaa-theme-border)] py-2 text-xs">
                <div>
                  <div className="font-bold">{LEAK_LABELS[row.leakage_code] || row.leakage_code}</div>
                  <div className="dawaa-muted">{row.branch || 'كل الفروع'} • {row.unique_products} أصناف • {row.unique_customers} عملاء</div>
                </div>
                <div className="dawaa-badge dawaa-badge--warning">{Number(row.cases_count).toLocaleString('ar-EG')} حالة</div>
              </div>
            ))}
        </div>
      </div>

      <div className="dawaa-muted mt-3 flex items-center gap-2 text-[11px]">
        <TrendingUp size={13} />
        البيع على مستوى الصنف لا يعتبر مثبتًا إلا عندما تتوفر بنود الفاتورة وتطابق الصنف؛ حاليًا التقرير يفصل سؤال العميل عن إثبات البيع.
      </div>
    </section>
  );
}
