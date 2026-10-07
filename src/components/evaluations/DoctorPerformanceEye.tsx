import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Eye, FileText, Loader2, PackageSearch, RefreshCw, ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react';
import {
  loadDoctorPerformanceEvidence,
  loadDoctorPerformanceIntelligence,
  type DoctorEvidenceConversation,
  type DoctorEvidenceProduct,
  type DoctorPerformanceDiagnosis,
  type DoctorPerformanceIntelligence,
  type DoctorPerformanceMonth,
  type PerformanceSourceHealth,
} from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { invalidatePerformanceSalesBundleCache } from '@/lib/evaluations/performanceSalesBundleCache';

type EvidenceFocus = 'all' | 'conversion' | 'opportunity' | 'availability';

const UNAVAILABLE = 'غير متاح';
const fmt = (v: number | null, d = 0) => v === null ? UNAVAILABLE : v.toLocaleString('ar-EG', { maximumFractionDigits: d, minimumFractionDigits: d });
const money = (v: number | null) => v === null ? UNAVAILABLE : `${fmt(v)} ج`;
const pct = (v: number | null) => v === null ? UNAVAILABLE : `${fmt(v, 1)}%`;
const delta = (a: number | null | undefined, b: number | null | undefined) => a === null || a === undefined || b === null || b === undefined || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;
const coverageLabel = (c: DoctorPerformanceMonth['coverage']) => c === 'available' ? 'تغطية كاملة' : c === 'partial' ? 'تغطية جزئية' : c === 'not_applicable' ? 'قبل أول دليل' : 'غير متاح';
const confidenceLabel = (c: DoctorPerformanceMonth['confidence']) => c === 'high' ? 'ثقة عالية' : c === 'medium' ? 'ثقة متوسطة' : 'ثقة منخفضة';
const sourceStatusLabel = (s: PerformanceSourceHealth['status']) => s === 'available' ? 'متاح' : s === 'partial' ? 'جزئي' : 'غير متاح';
const severityRank = { attention: 0, watch: 1, positive: 2 } as const;

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const toneStyle = (tone: Tone) => tone === 'neutral'
  ? { color: 'var(--dawaa-theme-muted)', background: 'var(--dawaa-theme-soft)', borderColor: 'var(--dawaa-theme-border)' }
  : { color: `var(--dawaa-status-${tone}-text)`, background: `var(--dawaa-status-${tone}-bg)`, borderColor: `var(--dawaa-status-${tone}-border)` };
const statusTone = (s: PerformanceSourceHealth['status']): Tone => s === 'available' ? 'success' : s === 'partial' ? 'warning' : 'danger';
const severityTone = (s: DoctorPerformanceDiagnosis['severity']): Tone => s === 'attention' ? 'danger' : s === 'positive' ? 'success' : 'warning';
const severityLabel = (s: DoctorPerformanceDiagnosis['severity']) => s === 'attention' ? 'مشكلة' : s === 'positive' ? 'نقطة قوة' : 'للمراجعة';
const focusForDiagnosis = (d: DoctorPerformanceDiagnosis): EvidenceFocus => d.kind === 'conversion' ? 'conversion' : d.kind === 'opportunity' ? 'opportunity' : d.kind === 'customer_impact' && d.severity === 'watch' ? 'availability' : 'all';

function hasSourceFailure(data: DoctorPerformanceIntelligence) {
  return Object.values(data.sources).some(source => source.status !== 'available');
}

function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-black" style={toneStyle(tone)}>{children}</span>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="mt-5">
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{title}</h3>
      {hint ? <span className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{hint}</span> : null}
    </div>
    {children}
  </section>;
}

function Kpi({ label, value, deltaValue, deltaNote, unavailableReason }: { label: string; value: string; deltaValue: number | null; deltaNote: string | null; unavailableReason: string | null }) {
  const isUnavailable = value === UNAVAILABLE;
  return <div className="min-w-0 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface-raised, var(--dawaa-theme-surface))' }}>
    <div className="truncate text-[11px] font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>{label}</div>
    <div className="mt-1 truncate text-lg font-black tabular-nums" style={{ color: isUnavailable ? 'var(--dawaa-theme-muted)' : 'var(--dawaa-theme-heading)' }} title={isUnavailable && unavailableReason ? unavailableReason : undefined}>{value}</div>
    <div className="mt-1 flex min-h-[16px] items-center gap-1 text-[11px] font-bold" style={{ color: deltaValue === null ? 'var(--dawaa-theme-muted)' : deltaValue >= 0 ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-danger-text)' }}>
      {deltaValue === null ? null : deltaValue >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      <span className="truncate">{deltaValue !== null ? `${deltaValue >= 0 ? '+' : ''}${fmt(deltaValue, 1)}%` : isUnavailable ? 'المصدر لم يُحمّل — ليس صفرًا' : deltaNote || '—'}</span>
    </div>
  </div>;
}

export default function DoctorPerformanceEye({ staffId, staffName, cycleLabel, branch }: { staffId: string; staffName: string; cycleLabel: string; branch?: string | null }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [data, setData] = useState<DoctorPerformanceIntelligence | null>(null), [error, setError] = useState('');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null), [comparisonDetails, setComparisonDetails] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false), [evidenceLoading, setEvidenceLoading] = useState(false), [evidenceError, setEvidenceError] = useState('');
  const [evidence, setEvidence] = useState<{ conversations: DoctorEvidenceConversation[]; products: DoctorEvidenceProduct[] } | null>(null);
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceFocus>('all');
  const requestRef = useRef(0);
  const evidenceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    requestRef.current += 1;
    setData(null); setError(''); setLoading(false);
    setEvidence(null); setEvidenceOpen(false); setEvidenceError(''); setEvidenceFocus('all');
    setExpandedInsight(null); setComparisonDetails(false);
  }, [staffId, cycleLabel]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function load(force: boolean) {
    const requestId = ++requestRef.current;
    if (force) { invalidatePerformanceSalesBundleCache(staffId); setEvidence(null); setEvidenceError(''); }
    setLoading(true); setError('');
    try {
      const value = await loadDoctorPerformanceIntelligence({ staffId, staffName, cycleLabel });
      if (requestRef.current === requestId) setData(value);
    } catch (e) {
      if (requestRef.current === requestId) { setData(null); setError(e instanceof Error ? e.message : 'تعذر تحميل أداء الدكتور'); }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }
  function show() {
    setOpen(true);
    // A complete result is reused; a result with any failed source is retried instead of pinned.
    if (loading || (data && !hasSourceFailure(data))) return;
    void load(Boolean(data));
  }
  async function openEvidence(focus: EvidenceFocus) {
    setEvidenceFocus(focus); setEvidenceOpen(true);
    window.requestAnimationFrame(() => evidenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (evidence || evidenceLoading) return;
    const requestId = requestRef.current;
    setEvidenceLoading(true); setEvidenceError('');
    try {
      const value = await loadDoctorPerformanceEvidence({ staffId, cycleLabel });
      if (requestRef.current === requestId) setEvidence(value);
    } catch (e) {
      if (requestRef.current === requestId) setEvidenceError(e instanceof Error ? e.message : 'تعذر تحميل الأدلة التفصيلية');
    } finally {
      if (requestRef.current === requestId) setEvidenceLoading(false);
    }
  }

  const cur = data?.months[0], prev = data?.months[1];
  const snap = cur?.comparisonMode === 'same_period' ? cur.comparisonSnapshot : null;
  const fullCycleFair = Boolean(cur && prev && cur.comparisonMode === 'full_cycle' && cur.comparisonEligible && prev.comparisonEligible && prev.coverage !== 'not_applicable');
  const comparisonBasis = !cur ? '' : snap
    ? `المقارنة: أول ${fmt(snap.days)} يوم من الدورة الحالية مقابل نفس الفترة من السابقة${snap.dataAsOf ? ` · المبيعات حتى ${snap.dataAsOf}` : ''}`
    : fullCycleFair ? 'المقارنة: الدورة كاملة مقابل الدورة السابقة كاملة' : `بدون نسب تغير: ${cur.comparisonReason}`;
  const salesDelta = (fullCurrent: number | null, fullPrevious: number | null | undefined, sameCurrent?: number | null, samePrevious?: number | null) =>
    snap ? delta(sameCurrent, samePrevious) : fullCycleFair ? delta(fullCurrent, fullPrevious) : null;
  const otherDelta = (a: number | null, b: number | null | undefined) => fullCycleFair ? delta(a, b) : null;
  const otherNote = snap ? 'لا مقارنة عادلة أثناء الدورة' : null;
  const salesReason = data?.sources.sales.error || null;
  const insights = cur ? [...cur.diagnoses].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 5) : [];
  const failedSources = data ? ([['المبيعات', data.sources.sales], ['الحضور', data.sources.attendance], ['المحادثات', data.sources.conversations], ['أثر العملاء', data.sources.customerImpact]] as const).filter(([, s]) => s.status !== 'available') : [];
  const conversations = evidence?.conversations || [], products = evidence?.products || [];
  const visibleConversations = evidenceFocus === 'opportunity' ? conversations.filter(item => item.followup_required || item.invoice_match_status !== 'verified') : evidenceFocus === 'conversion' ? conversations : evidenceFocus === 'availability' ? [] : conversations;
  const visibleProducts = evidenceFocus === 'opportunity' ? products.filter(item => Boolean(item.leakage_reason) || Boolean(item.next_action)) : evidenceFocus === 'availability' ? products.filter(item => String(item.current_stage || '').toLowerCase().includes('unavailable') || String(item.leakage_reason || '').toLowerCase().includes('unavailable') || String(item.leakage_reason || '').includes('غير متاح')) : products;
  const maxSales = data ? Math.max(0, ...data.months.map(m => m.sales || 0)) : 0;

  return <>
    <button type="button" onClick={show} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary-strong)', background: 'var(--dawaa-theme-soft)' }} title="عرض ذكاء أداء الدكتور"><Eye size={16} /> عين أداء الدكتور</button>
    {open ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4" dir="rtl" role="dialog" aria-modal="true" aria-label={`عين أداء الدكتور — ${staffName}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl" onMouseDown={(event) => event.stopPropagation()} style={{ background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' }}>

        <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>عين أداء الدكتور</div>
              <h2 className="truncate text-lg font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{staffName}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-black disabled:opacity-50" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary-strong)' }}><RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> إعادة تحميل</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-1.5" style={{ color: 'var(--dawaa-theme-muted)' }}><X size={20} /></button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {branch ? <Chip>{branch}</Chip> : null}
            {cur ? <Chip>{cur.displayLabel}{cur.comparisonMode === 'same_period' ? ' · جارية' : ''}</Chip> : null}
            {cur ? <Chip tone={cur.coverage === 'available' ? 'success' : cur.coverage === 'partial' ? 'warning' : 'danger'} title={cur.coverageReason}>{coverageLabel(cur.coverage)}</Chip> : null}
            {cur ? <Chip tone={cur.confidence === 'high' ? 'success' : cur.confidence === 'medium' ? 'info' : 'warning'}>{confidenceLabel(cur.confidence)}</Chip> : null}
            {data ? <Chip title={`تم البناء ${new Date(data.generatedAt).toLocaleString('ar-EG')}`}>المبيعات حتى {data.sources.sales.dataAsOf || UNAVAILABLE}</Chip> : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-5">
          {loading && !data ? <div className="flex items-center justify-center gap-2 p-12 text-sm font-black"><Loader2 className="animate-spin" /> جاري بناء التحليل…</div>
          : error ? <div className="mt-6 rounded-xl border p-4 text-sm font-bold" style={toneStyle('danger')}>
              <div className="flex items-center gap-2 font-black"><AlertTriangle size={16} /> تعذر بناء التحليل</div>
              <div className="mt-1 break-words">{error}</div>
              <button type="button" onClick={() => void load(true)} className="mt-3 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-black" style={{ borderColor: 'currentColor' }}><RefreshCw size={14} /> إعادة المحاولة</button>
            </div>
          : cur && prev && data ? <>
            {failedSources.length ? <div className="mt-4 rounded-xl border p-3 text-[12px] font-bold" style={toneStyle(failedSources.some(([, s]) => s.status === 'unavailable') ? 'danger' : 'warning')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black"><AlertTriangle size={16} /> مصادر لم تكتمل — الأرقام المرتبطة بها محجوبة وليست صفرًا</div>
                <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-black disabled:opacity-50" style={{ borderColor: 'currentColor' }}><RefreshCw size={13} className={loading ? 'animate-spin' : undefined} /> إعادة تحميل</button>
              </div>
              <ul className="mt-2 space-y-1">{failedSources.map(([name, s]) => <li key={name} className="break-words">• {name} ({sourceStatusLabel(s.status)}): {s.error || 'سبب غير معروف'}</li>)}</ul>
            </div> : null}

            <Section title="الملخص التنفيذي — الدورة الحالية" hint={comparisonBasis}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                <Kpi label="المبيعات" value={money(cur.sales)} deltaValue={salesDelta(cur.sales, prev.sales, snap?.sales, snap?.previousSales)} deltaNote={null} unavailableReason={salesReason} />
                <Kpi label="الفواتير" value={fmt(cur.invoices)} deltaValue={salesDelta(cur.invoices, prev.invoices, snap?.invoices, snap?.previousInvoices)} deltaNote={null} unavailableReason={salesReason} />
                <Kpi label="العملاء" value={fmt(cur.customers)} deltaValue={salesDelta(cur.customers, prev.customers, snap?.customers, snap?.previousCustomers)} deltaNote={null} unavailableReason={salesReason} />
                <Kpi label="متوسط الفاتورة" value={money(cur.averageInvoice === null ? null : Math.round(cur.averageInvoice))} deltaValue={salesDelta(cur.averageInvoice, prev.averageInvoice, snap?.averageInvoice, snap?.previousAverageInvoice)} deltaNote={null} unavailableReason={salesReason} />
                <Kpi label="ساعات العمل" value={cur.workedHours === null ? UNAVAILABLE : `${fmt(cur.workedHours, 1)} س`} deltaValue={otherDelta(cur.workedHours, prev.workedHours)} deltaNote={otherNote} unavailableReason={data.sources.attendance.error} />
                <Kpi label="مبيعات/ساعة" value={cur.salesPerHour === null ? UNAVAILABLE : `${fmt(cur.salesPerHour)} ج`} deltaValue={otherDelta(cur.salesPerHour, prev.salesPerHour)} deltaNote={otherNote} unavailableReason={salesReason || data.sources.attendance.error} />
                <Kpi label="Conversion" value={pct(cur.conversionRate)} deltaValue={otherDelta(cur.conversionRate, prev.conversionRate)} deltaNote={otherNote} unavailableReason={data.sources.conversations.error} />
              </div>
            </Section>

            <Section title="ماذا يحدث؟" hint={insights.length ? 'مرتبة حسب الأهمية' : undefined}>
              <div className="space-y-2">
                {insights.map((d, index) => <div key={`${d.kind}-${index}`} className="rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)', borderInlineStartWidth: 4, borderInlineStartColor: `var(--dawaa-status-${severityTone(d.severity)}-text)` }}>
                  <button type="button" onClick={() => setExpandedInsight(expandedInsight === index ? null : index)} aria-expanded={expandedInsight === index} className="flex w-full items-start justify-between gap-3 p-3 text-right">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Chip tone={severityTone(d.severity)}>{severityLabel(d.severity)}</Chip><span className="text-[13px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{d.title}</span></div>
                      <div className="mt-1 text-[12px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{d.detail}</div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>لماذا؟ <ChevronDown size={14} className={expandedInsight === index ? 'rotate-180 transition-transform' : 'transition-transform'} /></span>
                  </button>
                  {expandedInsight === index ? <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                    <div className="flex flex-wrap gap-1">{d.evidence.map(e => <Chip key={e}>{e}</Chip>)}</div>
                    <button type="button" onClick={() => void openEvidence(focusForDiagnosis(d))} className="mt-2 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>افتح الأدلة التفصيلية ←</button>
                  </div> : null}
                </div>)}
              </div>
            </Section>

            <Section title="ماذا نفعل؟">
              {data.actions.length ? <ol className="space-y-2">
                {data.actions.map((a, index) => <li key={a.title} className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black" style={toneStyle('info')}>{fmt(index + 1)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{a.title}</span><Chip>{a.owner === 'doctor' ? 'الدكتور' : 'المدير'}</Chip></div>
                    <div className="mt-1 text-[12px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{a.detail}</div>
                    {a.focus !== 'all' ? <button type="button" onClick={() => void openEvidence(a.focus)} className="mt-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>عرض الحالات ←</button> : null}
                  </div>
                </li>)}
              </ol> : <div className="rounded-xl border p-3 text-[12px] font-bold" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>لا يوجد إجراء مطلوب من الأدلة الحالية.</div>}
            </Section>

            <Section title="مقارنة الدورات" hint={cur.comparisonMode === 'same_period' ? 'الدورة الحالية جارية؛ أرقامها حتى اليوم وليست دورة كاملة' : undefined}>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <table className="w-full min-w-[420px] table-fixed text-[12px] font-bold">
                  <thead><tr style={{ background: 'var(--dawaa-theme-table-head, var(--dawaa-theme-soft))', color: 'var(--dawaa-theme-heading)' }}>
                    <th className="w-[28%] p-2 text-right font-black">المؤشر</th>
                    {data.months.map((m, index) => <th key={m.cycleLabel} className="p-2 text-right font-black"><div className="truncate">{index === 0 ? 'الحالية' : index === 1 ? 'السابقة' : 'قبل السابقة'}</div><div className="truncate text-[10px]" style={{ color: 'var(--dawaa-theme-muted)' }}>{m.displayLabel}</div></th>)}
                  </tr></thead>
                  <tbody>
                    <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">المبيعات</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">
                      <div className="truncate">{money(m.sales)}</div>
                      {m.sales !== null && maxSales > 0 ? <div className="mt-1 h-1.5 rounded-full" style={{ background: 'var(--dawaa-theme-soft)' }}><div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (m.sales / maxSales) * 100)}%`, background: 'var(--dawaa-theme-primary)' }} /></div> : null}
                    </td>)}</tr>
                    <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">الفواتير</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{fmt(m.invoices)}</td>)}</tr>
                    <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">ساعات العمل</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{m.workedHours === null ? UNAVAILABLE : `${fmt(m.workedHours, 1)} س`}</td>)}</tr>
                    {comparisonDetails ? <>
                      <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">العملاء</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{fmt(m.customers)}</td>)}</tr>
                      <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">متوسط الفاتورة</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{money(m.averageInvoice === null ? null : Math.round(m.averageInvoice))}</td>)}</tr>
                      <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">مبيعات/ساعة</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{money(m.salesPerHour === null ? null : Math.round(m.salesPerHour))}</td>)}</tr>
                      <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">المحادثات</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{fmt(m.conversations)}</td>)}</tr>
                      <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">Conversion</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{pct(m.conversionRate)}</td>)}</tr>
                      <tr className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2">التغطية</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2"><Chip tone={m.coverage === 'available' ? 'success' : m.coverage === 'partial' ? 'warning' : m.coverage === 'not_applicable' ? 'neutral' : 'danger'} title={m.coverageReason}>{coverageLabel(m.coverage)}</Chip></td>)}</tr>
                    </> : null}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => setComparisonDetails(v => !v)} aria-expanded={comparisonDetails} className="mt-2 inline-flex items-center gap-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{comparisonDetails ? 'إخفاء تفاصيل المقارنة' : 'تفاصيل المقارنة'} <ChevronDown size={14} className={comparisonDetails ? 'rotate-180 transition-transform' : 'transition-transform'} /></button>
            </Section>

            <Section title="الأدلة التفصيلية" hint="المحادثات، الفواتير، الأصناف وفرص البيع المتوقفة">
              <div ref={evidenceRef} className="rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <button type="button" onClick={() => evidenceOpen ? setEvidenceOpen(false) : void openEvidence('all')} aria-expanded={evidenceOpen} className="flex w-full items-center justify-between gap-3 p-3 text-right">
                  <span className="flex items-center gap-2 text-[12px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}><FileText size={15} /> {evidenceOpen ? 'إخفاء الأدلة' : 'فتح الأدلة'}</span>
                  {cur.customerImpact.available ? <span className="flex flex-wrap justify-end gap-1">
                    <Chip>فرص {fmt(cur.customerImpact.commercialConversations)}</Chip><Chip tone="success">بيع مؤكد {fmt(cur.customerImpact.verifiedSaleConversations)}</Chip><Chip tone="danger">فقد بيع {fmt(cur.customerImpact.saleLeakage)}</Chip><Chip tone="warning">متابعات {fmt(cur.customerImpact.followupsNeeded)}</Chip>
                  </span> : <span className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>أثر العملاء غير متاح</span>}
                </button>
                {evidenceOpen ? <div className="border-t p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  {evidenceFocus !== 'all' ? <div className="mb-2 flex items-center justify-between rounded-lg border p-2 text-[11px] font-black" style={{ borderColor: 'var(--dawaa-theme-border)' }}><span>فلتر: {evidenceFocus === 'conversion' ? 'التحويل والبيع المؤكد' : evidenceFocus === 'opportunity' ? 'فقد البيع والمتابعة' : 'التوافر وتأثيره'}</span><button type="button" onClick={() => setEvidenceFocus('all')} style={{ color: 'var(--dawaa-theme-primary-strong)' }}>عرض الكل</button></div> : null}
                  {evidenceLoading ? <div className="flex items-center gap-2 p-4 text-xs font-black"><Loader2 size={15} className="animate-spin" /> جاري تحميل الأدلة…</div>
                  : evidenceError ? <div className="rounded-lg border p-3 text-xs font-bold" style={toneStyle('danger')}><div className="break-words">{evidenceError}</div><button type="button" onClick={() => { setEvidence(null); setEvidenceError(''); void openEvidence(evidenceFocus); }} className="mt-2 inline-flex items-center gap-1 font-black"><RefreshCw size={13} /> إعادة المحاولة</button></div>
                  : <div className="grid gap-3 lg:grid-cols-2">
                    <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-black"><FileText size={14} /> المحادثات والفواتير</div><div className="max-h-72 space-y-2 overflow-y-auto">
                      {visibleConversations.map(item => <div key={item.id} className="rounded-lg border p-2 text-[11px]" style={{ borderColor: 'var(--dawaa-theme-border)' }}><div className="truncate font-black">{item.customer_name || 'عميل غير محدد'} {item.customer_code ? `#${item.customer_code}` : ''}</div><div className="mt-1 break-words" style={{ color: 'var(--dawaa-theme-muted)' }}>{String(item.conversation_started_at || '').replace('T', ' ').slice(0, 16)} · {item.invoice_match_status === 'verified' ? `فاتورة مؤكدة ${item.matched_invoice_number || ''} — ${fmt(Number(item.matched_invoice_value || 0))} ج` : 'بدون بيع مؤكد'}{item.followup_required ? ' · متابعة مطلوبة' : ''}</div></div>)}
                      {!visibleConversations.length ? <div className="p-2 text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد محادثات مطابقة في هذه الدورة.</div> : null}
                    </div></div>
                    <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-black"><PackageSearch size={14} /> الأصناف والفرص</div><div className="max-h-72 space-y-2 overflow-y-auto">
                      {visibleProducts.map((item, index) => <div key={`${item.source_id}-${item.product_name}-${index}`} className="rounded-lg border p-2 text-[11px]" style={{ borderColor: 'var(--dawaa-theme-border)' }}><div className="truncate font-black">{item.product_name || 'صنف غير محدد'} · {item.customer_name || 'عميل غير محدد'}</div><div className="mt-1 break-words" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.current_stage || 'مرحلة غير محددة'}{item.leakage_reason ? ` · سبب فقد البيع: ${item.leakage_reason}` : ''}{item.next_action ? ` · التالي: ${item.next_action}` : ''}{item.invoice_match_status === 'verified' ? ` · بيع مؤكد ${fmt(Number(item.matched_invoice_value || 0))} ج` : ''}</div></div>)}
                      {!visibleProducts.length ? <div className="p-2 text-[11px]" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد رحلات أصناف مطابقة في هذه الدورة.</div> : null}
                    </div></div>
                  </div>}
                </div> : null}
              </div>
            </Section>

            <Section title="مصادر الحقيقة" hint="غير متاح ≠ صفر">
              <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                {([['المبيعات', data.sources.sales], ['الحضور', data.sources.attendance], ['المحادثات', data.sources.conversations]] as const).map(([name, s], index) => <div key={name} className={`grid grid-cols-2 gap-x-3 gap-y-1 p-2 text-[11px] font-bold sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center ${index ? 'border-t' : ''}`} style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
                  <span className="flex items-center gap-1 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}><ShieldCheck size={13} /> {name}</span>
                  <span className="justify-self-end sm:justify-self-auto"><Chip tone={statusTone(s.status)} title={s.error || undefined}>{sourceStatusLabel(s.status)}</Chip></span>
                  <span>دليل: {fmt(s.evidenceCount)}</span>
                  <span>أول دليل: {s.firstEvidenceDate || UNAVAILABLE}</span>
                  <span>حتى: {s.dataAsOf || UNAVAILABLE}</span>
                </div>)}
              </div>
              <div className="mt-2 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>هوية المبيعات: {cur.salesIdentity === 'canonical' ? 'فواتير الموظف الموثقة (canonical)' : 'المصدر غير متاح'}. Conversion = المحادثات المراجعة التي تحولت لبيع ÷ المحادثات المراجعة. نطاق الأدلة: آخر 3 دورات.</div>
            </Section>
          </> : null}
        </div>
      </div>
    </div> : null}
  </>;
}
