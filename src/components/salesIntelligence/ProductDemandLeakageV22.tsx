import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Boxes, CircleAlert, RefreshCw, Settings2, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { runProductDemandBackfillV22, type ProductDemandBackfillSourceResultV22 } from '@/lib/whatsappProductDemandBackfillV22';

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

type DetailRow = {
  opportunity_id: string;
  source_id: string;
  cycle_start: string;
  branch: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  attributed_staff_name: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: number | null;
  current_stage: string;
  confidence: number | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  leakage_reason: string | null;
  leakage_code: string | null;
  opened_at: string | null;
};

type UnresolvedRow = {
  cycle_start: string;
  cycle_end: string;
  branch: string | null;
  unresolved_type: string;
  unresolved_mentions: number;
  conversations_affected: number;
};

const STAGE_LABELS: Record<string, string> = {
  detected: 'تم الرصد',
  requested: 'طلب العميل',
  available: 'الصنف متوفر',
  unavailable: 'الصنف غير متوفر',
  alternative_offered: 'تم عرض بديل',
  recommended: 'تم ترشيح صنف',
  accepted: 'العميل وافق',
  rejected: 'العميل رفض',
  order_confirmed: 'تم تأكيد الطلب',
  awaiting_invoice: 'بانتظار إثبات الفاتورة',
  verified_sale: 'بيع موثق',
  needs_followup: 'يحتاج متابعة',
};

const UNRESOLVED_LABELS: Record<string, string> = {
  reference_or_media: 'مرجع لصورة أو رسالة سابقة',
  contextual_product_reference: 'وصف سياقي يحتاج تحديد الصنف',
  category_need: 'احتياج عام أو فئة وليس اسم صنف',
  named_product_unresolved: 'اسم صنف لم يُطابق بالكتالوج بعد',
  noise: 'نص غير متعلق بصنف',
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
  const [previewSourceIds, setPreviewSourceIds] = useState<string[]>([]);
  const [previewHasFailures, setPreviewHasFailures] = useState(false);
  const [previewRows, setPreviewRows] = useState<ProductDemandBackfillSourceResultV22[]>([]);
  const [branchFilter, setBranchFilter] = useState<'all' | string>('all');
  const [cycleFilter, setCycleFilter] = useState<string>('latest');
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [detailsTitle, setDetailsTitle] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [insightView, setInsightView] = useState<'products' | 'leakage' | 'quality'>('products');

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
    setPreviewSourceIds([]);
    setPreviewRows([]);
    setPreviewHasFailures(false);
    try {
      const result = await runProductDemandBackfillV22({ limit: 20, dryRun: true });
      const ids = result.rows.filter((row) => row.status === 'ready').map((row) => row.sourceId);
      setPreviewSourceIds(ids);
      setPreviewRows(result.rows);
      setPreviewHasFailures(result.failed > 0);
      setBackfillMessage(
        `معاينة آمنة V22.1: ${result.scanned} محادثة • ${result.canonicalProducts} صنف مرتبط بالكتالوج • ${result.unresolvedProducts} عبارة غير محسومة • أخطاء ${result.failed}. ${result.failed ? 'لن يُسمح بالتنفيذ قبل مراجعة الأخطاء.' : 'الدفعة ثابتة وجاهزة للتنفيذ.'}`
      );
    } catch (cause) {
      setPreviewHasFailures(true);
      setBackfillMessage(cause instanceof Error ? cause.message : 'تعذرت معاينة إعادة التحليل.');
    } finally {
      setBackfillRunning(false);
    }
  }

  async function executeBackfill() {
    if (!previewSourceIds.length) {
      setBackfillMessage('لازم تعمل معاينة آمنة أولًا؛ التنفيذ لا يعمل على دفعة غير مُراجعة.');
      return;
    }
    if (previewHasFailures) {
      setBackfillMessage('تم إيقاف التنفيذ لأن المعاينة تحتوي على أخطاء. راجع الأخطاء قبل الكتابة.');
      return;
    }
    setBackfillRunning(true);
    setBackfillMessage(null);
    try {
      const lockedSourceIds = [...previewSourceIds];
      const result = await runProductDemandBackfillV22({ sourceIds: lockedSourceIds, dryRun: false, force: true });
      const unexpected = result.rows.filter((row) => !lockedSourceIds.includes(row.sourceId));
      if (unexpected.length) throw new Error('تم إيقاف الدفعة: نتيجة التنفيذ احتوت على مصدر خارج الدفعة التي تمت معاينتها.');
      setBackfillMessage(
        `تم تنفيذ نفس الدفعة المعاينة V22.1: ${result.written} محادثة • ${result.canonicalProducts} صنف مرتبط بالكتالوج • ${result.unresolvedProducts} عبارة غير محسومة • أخطاء ${result.failed}`
      );
      setPreviewSourceIds([]);
      setPreviewRows([]);
      setPreviewHasFailures(false);
      await load();
    } catch (cause) {
      setBackfillMessage(cause instanceof Error ? cause.message : 'تعذر تنفيذ إعادة التحليل.');
    } finally {
      setBackfillRunning(false);
    }
  }

  const cycles = useMemo(
    () => Array.from(new Set([...demand, ...leakage, ...unresolved].map((row) => row.cycle_start).filter(Boolean))).sort().reverse(),
    [demand, leakage, unresolved]
  );
  const latestCycle = cycles[0] || null;
  const selectedCycle = cycleFilter === 'latest' ? latestCycle : cycleFilter;

  const branches = useMemo(
    () => Array.from(new Set([...demand, ...leakage, ...unresolved].map((row) => row.branch).filter(Boolean))) as string[],
    [demand, leakage, unresolved]
  );
  const cycleDemand = useMemo(
    () => demand.filter((r) => (!selectedCycle || r.cycle_start === selectedCycle) && (branchFilter === 'all' || r.branch === branchFilter)),
    [demand, selectedCycle, branchFilter]
  );
  const cycleLeakage = useMemo(
    () => leakage.filter((r) => (!selectedCycle || r.cycle_start === selectedCycle) && (branchFilter === 'all' || r.branch === branchFilter)),
    [leakage, selectedCycle, branchFilter]
  );
  const cycleUnresolved = useMemo(
    () => unresolved.filter((r) => (!selectedCycle || r.cycle_start === selectedCycle) && (branchFilter === 'all' || r.branch === branchFilter)),
    [unresolved, selectedCycle, branchFilter]
  );


  async function loadDetails(kind: 'product' | 'leakage', value: string, title: string) {
    setDetailsLoading(true);
    setDetailsTitle(title);
    try {
      let query = supabase
        .from('whatsapp_product_demand_detail_v22')
        .select('*')
        .order('opened_at', { ascending: false })
        .limit(100);
      if (selectedCycle) query = query.eq('cycle_start', selectedCycle);
      if (branchFilter !== 'all') query = query.eq('branch', branchFilter);
      query = kind === 'product' ? query.eq('product_id', value) : query.eq('leakage_code', value);
      const { data, error } = await query;
      if (error) throw error;
      setDetails((data || []) as DetailRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل تفاصيل الحالات.');
      setDetails([]);
    } finally {
      setDetailsLoading(false);
    }
  }

  const totals = useMemo(() => ({
    demand: cycleDemand.reduce((sum, row) => sum + Number(row.inquiry_opportunities || 0), 0),
    customers: cycleDemand.reduce((sum, row) => sum + Number(row.unique_customers || 0), 0),
    accepted: cycleDemand.reduce((sum, row) => sum + Number(row.accepted_or_later_count || 0), 0),
    unresolved: cycleUnresolved.reduce((sum, row) => sum + Number(row.unresolved_mentions || 0), 0),
    leakage: cycleLeakage.reduce((sum, row) => sum + Number(row.cases_count || 0), 0),
  }), [cycleDemand, cycleLeakage, cycleUnresolved]);

  return (
    <section className="dawaa-card" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black"><BarChart3 size={18} /> ذكاء الطلب على الأصناف وفقد المبيعات</div>
          <div className="dawaa-muted mt-1 text-xs">
            يحتسب فقط الأصناف المرتبطة فعليًا بسجل الأصناف. العبارات غير المحسومة تُراقب منفصلة ولا تدخل ترتيب أكثر الأصناف طلبًا.
          </div>
          {selectedCycle ? <div className="dawaa-muted mt-1 text-[11px]">الدورة: {selectedCycle} → {cycleDemand[0]?.cycle_end || cycleLeakage[0]?.cycle_end || '—'}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowOperations((value) => !value)} className="dawaa-button dawaa-button--ghost text-xs">
            <Settings2 size={14} />
            {showOperations ? 'إخفاء أدوات التشغيل' : 'إدارة إعادة التحليل'}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="dawaa-button dawaa-button--secondary text-xs">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error ? <div className="dawaa-alert dawaa-alert--danger mt-3 text-xs">{error}</div> : null}
      {showOperations ? (
        <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-black text-sm">أدوات تشغيل وإعادة تحليل البيانات</div>
              <div className="dawaa-muted mt-1 text-[11px]">منطقة تشغيلية منفصلة عن مؤشرات الإدارة. المعاينة إلزامية قبل أي تنفيذ.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void previewBackfill()} disabled={backfillRunning} className="dawaa-button dawaa-button--ghost text-xs">
                معاينة ٢٠ محادثة
              </button>
              <button type="button" onClick={() => void executeBackfill()} disabled={backfillRunning || !previewSourceIds.length || previewHasFailures} className="dawaa-button dawaa-button--secondary text-xs">
                {backfillRunning ? <RefreshCw size={14} className="animate-spin" /> : null}
                تنفيذ الدفعة المعاينة
              </button>
            </div>
          </div>
          {backfillMessage ? <div className="dawaa-alert dawaa-alert--info mt-3 text-xs">{backfillMessage}</div> : null}
          {backfillStatus ? (
            <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-black">تقدم إعادة تحليل المحادثات التاريخية</div>
                <div className="dawaa-badge dawaa-badge--info">{Number(backfillStatus.completion_percent || 0).toLocaleString('ar-EG')}٪</div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, Number(backfillStatus.completion_percent || 0)))}%` }} />
              </div>
              <div className="dawaa-muted mt-2 text-[11px]">
                قابل للتحليل: {Number(backfillStatus.analyzable_sources || 0).toLocaleString('ar-EG')} • تم V22.1: {Number(backfillStatus.analyzed_v22 || 0).toLocaleString('ar-EG')} • متبقي: {Number(backfillStatus.remaining_sources || 0).toLocaleString('ar-EG')}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showOperations && previewRows.length ? (
        <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="font-black text-sm">مراجعة الدفعة قبل التنفيذ</div>
          <div className="dawaa-muted mt-1 text-xs">لن يتم تنفيذ غير هذه المحادثات نفسها. راجع الأصناف المحسومة والعبارات غير المحسومة قبل الضغط على التنفيذ.</div>
          <div className="mt-3 max-h-[360px] overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dawaa-theme-border)] text-right">
                  {['المصدر','الحالة','أصناف مرتبطة','أمثلة الأصناف','عبارات غير محسومة'].map((h) => <th key={h} className="p-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.sourceId} className="border-b border-[var(--dawaa-theme-border)]/60 align-top">
                    <td className="p-2 font-mono text-[10px]">{row.sourceId.slice(0, 8)}…</td>
                    <td className="p-2">{row.status === 'ready' ? 'جاهزة' : row.status === 'failed' ? 'خطأ' : row.status}</td>
                    <td className="p-2">{row.canonicalProducts}</td>
                    <td className="max-w-[360px] p-2">
                      {row.canonicalProductNames.length ? row.canonicalProductNames.join('، ') : '—'}
                    </td>
                    <td className="max-w-[360px] p-2">
                      {row.unresolvedExamples.length ? row.unresolvedExamples.join('، ') : '—'}
                      {row.reason ? <div className="mt-1 text-red-400">{row.reason}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="dawaa-muted">الدورة:</span>
          <select className="dawaa-input py-1 text-xs" value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)}>
            <option value="latest">أحدث دورة</option>
            {cycles.map((cycle) => <option key={cycle} value={cycle}>{cycle}</option>)}
          </select>
        </label>
        <span className="dawaa-muted text-xs">الفرع:</span>
        <button type="button" onClick={() => setBranchFilter('all')} className={branchFilter === 'all' ? 'dawaa-badge dawaa-badge--info' : 'dawaa-button dawaa-button--ghost text-xs'}>كل الفروع</button>
        {branches.map((branch) => (
          <button key={branch} type="button" onClick={() => setBranchFilter(branch)} className={branchFilter === branch ? 'dawaa-badge dawaa-badge--info' : 'dawaa-button dawaa-button--ghost text-xs'}>
            {branch}
          </button>
        ))}
      </div>

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

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {([
          { key: 'products', label: 'الأصناف المطلوبة', hint: 'الطلب والقبول' },
          { key: 'leakage', label: 'أسباب فقد البيع', hint: 'أين تضيع الفرص؟' },
          { key: 'quality', label: 'جودة البيانات', hint: 'غير المحسوم والتغطية' },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setInsightView(item.key)}
            className={insightView === item.key
              ? 'rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-3 text-right'
              : 'rounded-xl border border-transparent p-3 text-right hover:bg-[var(--dawaa-theme-soft)]'}
          >
            <div className="font-black text-sm">{item.label}</div>
            <div className="dawaa-muted mt-1 text-[10px]">{item.hint}</div>
          </button>
        ))}
      </div>

      {insightView === 'quality' && cycleUnresolved.length ? (
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="font-black">العبارات غير المحسومة — لماذا لم تتحول لصنف؟</div>
          <div className="dawaa-muted mt-1 text-xs">
            هذه العبارات لا تدخل ترتيب أكثر الأصناف طلبًا حتى يتم ربطها بصنف حقيقي من الكتالوج.
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {cycleUnresolved.map((row) => (
              <div key={(row.branch || '') + ':' + row.unresolved_type} className="rounded-xl border border-amber-500/20 bg-black/5 p-3 text-xs">
                <div className="font-bold">{UNRESOLVED_LABELS[row.unresolved_type] || row.unresolved_type}</div>
                <div className="mt-1 text-lg font-black">{Number(row.unresolved_mentions || 0).toLocaleString('ar-EG')}</div>
                <div className="dawaa-muted">{row.conversations_affected} محادثة • {row.branch || 'كل الفروع'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {insightView === 'quality' && !cycleUnresolved.length ? (
        <div className="dawaa-empty-state mt-4 py-8 text-center text-xs">لا توجد عبارات منتجات غير محسومة ضمن الفلاتر الحالية.</div>
      ) : null}

      {insightView !== 'quality' ? (
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {insightView === 'products' ? (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4 xl:col-span-2">
          <div className="mb-3 flex items-center gap-2 font-black"><Boxes size={16} /> أكثر الأصناف سؤالًا في الدورة</div>
          {!cycleDemand.length ? <div className="dawaa-empty-state py-6 text-center text-xs">لا توجد أصناف مرتبطة بالكتالوج من التحليل الجديد في هذه الدورة حتى الآن.</div> :
            cycleDemand.slice(0, 12).map((row, index) => (
              <button type="button" onClick={() => void loadDetails('product', row.product_id, row.product_name)} key={row.product_id + ':' + (row.branch || '')} className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-2 border-t border-[var(--dawaa-theme-border)] py-2 text-right text-xs hover:bg-black/5">
                <b>{index + 1}</b>
                <div>
                  <div className="font-bold">{row.product_name}</div>
                  <div className="dawaa-muted">كود {row.product_code} • {row.branch || 'كل الفروع'}</div>
                </div>
                <div className="text-left">
                  <div className="font-black">{Number(row.inquiry_opportunities).toLocaleString('ar-EG')} طلب</div>
                  <div className="dawaa-muted">قبول {row.acceptance_rate == null ? '—' : Number(row.acceptance_rate).toLocaleString('ar-EG') + '٪'}</div>
                </div>
              </button>
            ))}
        </div>
        ) : null}

        {insightView === 'leakage' ? (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4 xl:col-span-2">
          <div className="mb-3 flex items-center gap-2 font-black"><CircleAlert size={16} /> أسباب عدم اكتمال البيع</div>
          {!cycleLeakage.length ? <div className="dawaa-empty-state py-6 text-center text-xs">لا توجد أسباب فقد بيع مؤكدة من التحليل الجديد في هذه الدورة حتى الآن.</div> :
            cycleLeakage.slice(0, 12).map((row) => (
              <button type="button" onClick={() => void loadDetails('leakage', row.leakage_code, LEAK_LABELS[row.leakage_code] || row.leakage_code)} key={(row.branch || '') + ':' + row.leakage_code} className="flex w-full items-center justify-between gap-3 border-t border-[var(--dawaa-theme-border)] py-2 text-right text-xs hover:bg-black/5">
                <div>
                  <div className="font-bold">{LEAK_LABELS[row.leakage_code] || row.leakage_code}</div>
                  <div className="dawaa-muted">{row.branch || 'كل الفروع'} • {row.unique_products} أصناف • {row.unique_customers} عملاء</div>
                  <div className="dawaa-muted mt-0.5">النسبة من أسباب الفقد: {totals.leakage ? Math.round((Number(row.cases_count || 0) / totals.leakage) * 100).toLocaleString('ar-EG') : '٠'}٪</div>
                </div>
                <div className="dawaa-badge dawaa-badge--warning">{Number(row.cases_count).toLocaleString('ar-EG')} حالة</div>
              </button>
            ))}
        </div>
        ) : null}
      </div>
      ) : null}

      {detailsTitle ? (
        <div className="mt-4 rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-black">تفاصيل: {detailsTitle}</div>
            <button type="button" className="dawaa-button dawaa-button--ghost text-xs" onClick={() => { setDetailsTitle(null); setDetails([]); }}>إغلاق</button>
          </div>
          {detailsLoading ? <div className="dawaa-muted py-6 text-center text-xs">جاري تحميل التفاصيل...</div> :
            !details.length ? <div className="dawaa-empty-state py-6 text-center text-xs">لا توجد حالات مطابقة ضمن الفلاتر الحالية.</div> :
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead><tr className="border-b border-[var(--dawaa-theme-border)] text-right">
                  {['العميل','الفرع','الصنف','المرحلة','الدكتور','الفاتورة','سبب عدم الاكتمال','وقت الطلب'].map((h) => <th key={h} className="p-2">{h}</th>)}
                </tr></thead>
                <tbody>{details.map((row) => (
                  <tr key={row.opportunity_id} className="border-b border-[var(--dawaa-theme-border)]/60">
                    <td className="p-2"><b>{row.customer_name || 'غير معروف'}</b><div className="dawaa-muted">{row.customer_code || '—'} • {row.customer_phone || '—'}</div></td>
                    <td className="p-2">{row.branch || '—'}</td>
                    <td className="p-2">{row.product_name || 'غير محسوم'}{row.product_code ? <div className="dawaa-muted">كود {row.product_code}</div> : null}</td>
                    <td className="p-2">{STAGE_LABELS[row.current_stage] || row.current_stage}</td>
                    <td className="p-2">{row.attributed_staff_name || 'غير منسوب'}</td>
                    <td className="p-2">{row.matched_invoice_number || '—'}</td>
                    <td className="max-w-[320px] p-2">{row.leakage_reason || '—'}</td>
                    <td className="p-2">{row.opened_at ? new Date(row.opened_at).toLocaleString('ar-EG') : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>}
        </div>
      ) : null}

      <div className="dawaa-muted mt-3 flex items-center gap-2 text-[11px]">
        <TrendingUp size={13} />
        البيع على مستوى الصنف لا يعتبر مثبتًا إلا عندما تتوفر بنود الفاتورة وتطابق الصنف؛ حاليًا التقرير يفصل سؤال العميل عن إثبات البيع.
      </div>
    </section>
  );
}
