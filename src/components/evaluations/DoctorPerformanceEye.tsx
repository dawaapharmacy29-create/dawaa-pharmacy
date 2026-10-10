import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Eye, FileText, Gauge, Loader2, PackageSearch, RefreshCw, ShieldCheck, Target, TrendingDown, TrendingUp, Users, X } from 'lucide-react';
import {
  loadDoctorPerformanceEvidence,
  loadDoctorPerformanceIntelligence,
  type DoctorEvidenceConversation,
  type DoctorEvidenceProduct,
  type DoctorPerformanceIntelligence,
  type DoctorPerformanceMonth,
} from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { invalidatePerformanceSalesBundleCache } from '@/lib/evaluations/performanceSalesBundleCache';
import { buildDoctorPerformanceVerdict } from '@/lib/evaluations/doctorPerformanceVerdict';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';
import type { MonthlyConversationCoaching } from '@/lib/staff/employeeMonthlyEvidenceService';
import { buildDoctorDecision, invalidateDoctorDecisionData, loadDoctorDecisionSources, type DoctorDecisionSources } from '@/lib/evaluations/doctorDecisionDataService';
import { SCOPE_LABEL, type DecisionIntelligence } from '@/lib/evaluations/doctorDecisionIntelligence';
import { userFacingMessage } from '@/lib/evaluations/decisionSourceState';
import { buildEyeChartModel } from '@/lib/evaluations/doctorEyeChartModel';
import {
  branchComparisonNotice, buildEyeDataQuality, buildEyeDiagnosis, buildEyeHeaderFacts, buildEyeKpis, eyeVerdictLevel,
  DEFAULT_DIAGNOSIS_LIMIT, DIAGNOSIS_GROUP_LABEL, VERDICT_LEVEL_LABEL, VERDICT_LEVEL_TONE, type EyeEvidenceFocus, type EyeEvidenceTarget, type EyeKpi,
} from '@/lib/evaluations/doctorEyeViewModel';

const DoctorPerformanceChart = lazy(() => import('@/components/evaluations/DoctorPerformanceChart'));
const fmtDate = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }); };

type EvidenceFocus = EyeEvidenceFocus;

const UNAVAILABLE = 'غير متاح';
const fmt = (v: number | null, d = 0) => v === null ? UNAVAILABLE : v.toLocaleString('ar-EG', { maximumFractionDigits: d, minimumFractionDigits: d });
const money = (v: number | null) => v === null ? UNAVAILABLE : `${fmt(v)} ج`;
/** Unknown stays "غير متاح" — a KPI value is never rendered as 0 when its source is missing. */
const kpiValue = (k: EyeKpi) => k.value === null ? UNAVAILABLE
  : k.unit === 'money' ? `${fmt(Math.round(k.value))} ج` : k.unit === 'pct' ? `${fmt(k.value, 1)}%` : k.unit === 'days' ? `${fmt(k.value)} يوم` : fmt(k.value);
const coverageLabel = (c: DoctorPerformanceMonth['coverage']) => c === 'available' ? 'تغطية كاملة' : c === 'partial' ? 'تغطية جزئية' : c === 'not_applicable' ? 'قبل أول دليل' : 'غير متاح';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const toneStyle = (tone: Tone) => tone === 'neutral'
  ? { color: 'var(--dawaa-theme-muted)', background: 'var(--dawaa-theme-soft)', borderColor: 'var(--dawaa-theme-border)' }
  : { color: `var(--dawaa-status-${tone}-text)`, background: `var(--dawaa-status-${tone}-bg)`, borderColor: `var(--dawaa-status-${tone}-border)` };

/** Only a real (or partial) read failure is worth re-requesting; "not enabled" and "insufficient" are stable answers. */
function hasSourceFailure(data: DoctorPerformanceIntelligence) {
  return Object.values(data.sources).some(source => source.state === 'failed' || source.state === 'partial');
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

/**
 * header/conversation are the evidence the evaluation page already loaded for this employee and cycle,
 * so the Eye's decision summary reads the same attendance and conversation truth as the page.
 */
export default function DoctorPerformanceEye({ staffId, staffName, cycleLabel, branch, header = null, conversation = null, actorId = null, viewerScopeKey = null, sections = [] }: { staffId: string; staffName: string; cycleLabel: string; branch?: string | null; header?: EvaluationHeaderSummary | null; conversation?: MonthlyConversationCoaching | null; actorId?: string | null; viewerScopeKey?: string | null; sections?: { key: string; title: string; score: number }[] }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [data, setData] = useState<DoctorPerformanceIntelligence | null>(null), [error, setError] = useState('');
  const [comparisonDetails, setComparisonDetails] = useState(false), [detailsOpen, setDetailsOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false), [evidenceLoading, setEvidenceLoading] = useState(false), [evidenceError, setEvidenceError] = useState('');
  const [evidence, setEvidence] = useState<{ conversations: DoctorEvidenceConversation[]; products: DoctorEvidenceProduct[] } | null>(null);
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceFocus>('all');
  const [decisionSources, setDecisionSources] = useState<DoctorDecisionSources | null>(null), [decisionLoading, setDecisionLoading] = useState(false), [branchOpen, setBranchOpen] = useState(false);
  const [showAllDiagnosis, setShowAllDiagnosis] = useState(false), [qualityOpen, setQualityOpen] = useState(false);
  const requestRef = useRef(0);
  const evidenceRef = useRef<HTMLDivElement | null>(null);
  const cyclesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    requestRef.current += 1;
    setData(null); setError(''); setLoading(false);
    setEvidence(null); setEvidenceOpen(false); setEvidenceError(''); setEvidenceFocus('all');
    setComparisonDetails(false); setDetailsOpen(false);
    setDecisionSources(null); setDecisionLoading(false); setBranchOpen(false);
    setShowAllDiagnosis(false); setQualityOpen(false);
  }, [staffId, cycleLabel, branch, viewerScopeKey]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function loadDecision(force: boolean, requestId: number) {
    if (!branch) return;
    setDecisionLoading(true);
    try {
      const value = await loadDoctorDecisionSources({ staffId, branch, cycleLabel, actorId, force });
      if (requestRef.current === requestId) setDecisionSources(value);
    } finally {
      if (requestRef.current === requestId) setDecisionLoading(false);
    }
  }
  async function load(force: boolean) {
    const requestId = ++requestRef.current;
    if (force) { invalidatePerformanceSalesBundleCache(staffId); invalidateDoctorDecisionData(); setEvidence(null); setEvidenceError(''); }
    setLoading(true); setError('');
    try {
      const value = await loadDoctorPerformanceIntelligence({ viewerScopeKey, staffId, staffName, cycleLabel });
      if (requestRef.current === requestId) setData(value);
    } catch (e) {
      if (requestRef.current === requestId) { setData(null); setError(userFacingMessage(e, 'تعذر بناء التحليل الآن؛ أعد المحاولة بعد قليل.', 'load')); }
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
        // Branch-wide comparison can read thousands of review rows. Start it only after
        // the doctor's primary summary settles so it cannot compete with first useful paint.
        void loadDecision(force, requestId);
      }
    }
  }
  function show() {
    setOpen(true);
    // A complete primary result is reused. If only the comparative layer is missing/failed,
    // retry that layer without re-fetching the doctor's personal sources.
    const decisionFailed = Boolean(decisionSources && Object.values(decisionSources).some(x => x.status === 'failed'));
    if (loading) return;
    if (data && !hasSourceFailure(data)) {
      if (!branch || decisionLoading || (decisionSources && !decisionFailed)) return;
      void loadDecision(Boolean(decisionSources), requestRef.current);
      return;
    }
    void load(Boolean(data));
  }
  async function openEvidence(focus: EvidenceFocus) {
    setDetailsOpen(true); setEvidenceFocus(focus); setEvidenceOpen(true);
    window.requestAnimationFrame(() => evidenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (evidence || evidenceLoading) return;
    const requestId = requestRef.current;
    setEvidenceLoading(true); setEvidenceError('');
    try {
      const value = await loadDoctorPerformanceEvidence({ staffId, cycleLabel });
      if (requestRef.current === requestId) setEvidence(value);
    } catch (e) {
      if (requestRef.current === requestId) setEvidenceError(userFacingMessage(e, 'تعذر تحميل الأدلة التفصيلية الآن؛ أعد المحاولة.', 'evidence'));
    } finally {
      if (requestRef.current === requestId) setEvidenceLoading(false);
    }
  }

  const cur = data?.months[0], prev = data?.months[1];
  const snap = cur?.comparisonMode === 'same_period' ? cur.comparisonSnapshot : null;
  const fullCycleFair = Boolean(cur && prev && cur.comparisonMode === 'full_cycle' && cur.comparisonEligible && prev.comparisonEligible && prev.coverage !== 'not_applicable');
  const comparisonBasis = !cur ? '' : snap
    ? `المقارنة: أول ${fmt(snap.days)} يوم تقويمي من الدورة الحالية مقابل نفس الأيام من السابقة${snap.presentDays !== null && snap.previousPresentDays !== null ? `، أيام الحضور فيها ${fmt(snap.presentDays)} مقابل ${fmt(snap.previousPresentDays)}` : ''}${snap.dataAsOf ? `، المبيعات حتى ${snap.dataAsOf}` : ''}`
    : fullCycleFair ? 'المقارنة: الدورة كاملة مقابل الدورة السابقة كاملة' : `بدون نسب تغير: ${cur.comparisonReason}`;
  const conversations = evidence?.conversations || [], products = evidence?.products || [];
  const visibleConversations = evidenceFocus === 'opportunity' ? conversations.filter(item => item.followup_required || item.invoice_match_status !== 'verified') : evidenceFocus === 'conversion' ? conversations : evidenceFocus === 'availability' ? [] : conversations;
  const visibleProducts = evidenceFocus === 'opportunity' ? products.filter(item => Boolean(item.leakage_reason) || Boolean(item.next_action)) : evidenceFocus === 'availability' ? products.filter(item => String(item.current_stage || '').toLowerCase().includes('unavailable') || String(item.leakage_reason || '').toLowerCase().includes('unavailable') || String(item.leakage_reason || '').includes('غير متاح')) : products;
  // A verified invoice without a recorded value shows no amount (never "0 ج").
  const invoiceValue = (v: unknown) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : ` — ${fmt(Number(v))} ج`;
  const maxSales = data ? Math.max(0, ...data.months.map(m => m.sales || 0)) : 0;
  const verdict = data ? buildDoctorPerformanceVerdict({ data, header, conversation }) : null;
  const sectionsKey = sections.map(x => `${x.key}:${x.score}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decision: DecisionIntelligence | null = useMemo(() => decisionSources ? buildDoctorDecision(decisionSources, { staffId, cycleLabel, sections }) : null, [decisionSources, staffId, cycleLabel, sectionsKey]);
  // The comparative layer speaks only when the branch comparison is ready; otherwise the doctor's own
  // (already verified) summary stays in place and no verdict or recommendation is derived from a missing source.
  const ready = decision && decision.availability === 'ready' ? decision : null;
  const decisionSourceIssues = decisionSources ? ([['مقارنة الفرع', decisionSources.branch], ['مراجعات الفرع', decisionSources.reviews], ['التقييم السابق', decisionSources.previousEvaluation]] as const).filter(([, x]) => x.status !== 'available') : [];
  // One layer speaks for the whole summary (headline, strength, problem, action) so a sentence never mixes cycles
  // or sources: the branch analysis only when it covers the evaluated cycle and the doctor's own evidence holds no
  // higher-priority documented problem (safety, customer harm, discipline). A recommendation comes only from a
  // documented problem or from complete evidence.
  const readyLeadsWithPriority = Boolean(ready?.problems[0] && (ready.problems[0].severity === 'critical' || ready.problems[0].severity === 'high'));
  const summaryFromReady = Boolean(ready && ready.analysisIsEvaluatedCycle && !(verdict?.lead === 'problem' && !readyLeadsWithPriority));
  const summary = summaryFromReady
    ? { headline: ready!.summary.headline, strength: ready!.summary.strength, problem: ready!.summary.problem, action: ready!.decision?.action || null }
    : { headline: verdict?.headline || '', strength: verdict?.strength?.text || null, problem: verdict?.problem?.text || null, action: verdict?.action?.text || (verdict?.evidenceComplete ? 'استمرار المتابعة المعتادة' : null) };
  const chartModel = useMemo(() => data ? buildEyeChartModel({ data, decision, decisionLoading, hasBranch: Boolean(branch) }) : null, [data, decision, decisionLoading, branch]);
  // Presentation only: every figure below comes from the verdict, decision, chart model or source-health contract.
  const headerFacts = data ? buildEyeHeaderFacts({ data, cycleLabel }) : null;
  const kpis = data && chartModel ? buildEyeKpis({ data, chart: chartModel, header }) : [];
  const level = eyeVerdictLevel({ verdict, ready, summaryFromReady });
  const diagnosis = data ? buildEyeDiagnosis({ data, verdict, ready }) : [];
  const visibleDiagnosis = showAllDiagnosis ? diagnosis : diagnosis.slice(0, DEFAULT_DIAGNOSIS_LIMIT);
  const quality = data ? buildEyeDataQuality({ data, decision, decisionLoading, hasBranch: Boolean(branch) }) : null;
  const ownFailures = quality ? quality.rows.filter(x => x.key !== 'branch' && x.state === 'failed') : [];
  const ownRetryable = quality ? quality.rows.some(x => x.key !== 'branch' && x.retryable) : false;
  const branchRetryable = quality ? quality.rows.some(x => x.key === 'branch' && x.retryable) : false;
  const branchNotice = branchComparisonNotice({ decision, hasBranch: Boolean(branch) });
  const indicatorTone = (state: string): Tone => ['improving', 'above', 'consistent'].includes(state) ? 'success' : ['declining', 'below', 'gaps'].includes(state) ? 'warning' : 'neutral';
  const retryComparison = () => { if (!decisionLoading) void loadDecision(true, requestRef.current); };
  // Discipline, productivity and trend findings are evidenced by the per-cycle figures already loaded; conversation
  // and product findings by the lazily loaded evidence rows.
  const openTarget = (target: EyeEvidenceTarget) => {
    if (target !== 'cycles') { void openEvidence(target); return; }
    setDetailsOpen(true); setComparisonDetails(true);
    window.requestAnimationFrame(() => cyclesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const confidenceTone = (c: 'high' | 'medium' | 'low'): Tone => c === 'high' ? 'success' : c === 'medium' ? 'info' : 'warning';
  const muted = { color: 'var(--dawaa-theme-muted)' };
  const heading = { color: 'var(--dawaa-theme-heading)' };
  const border = { borderColor: 'var(--dawaa-theme-border)' };

  return <>
    <button type="button" onClick={show} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary-strong)', background: 'var(--dawaa-theme-soft)' }} title="عرض ذكاء أداء الدكتور"><Eye size={16} /> عين أداء الدكتور</button>
    {open ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4" dir="rtl" role="dialog" aria-modal="true" aria-label={`عين أداء الدكتور — ${staffName}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl" onMouseDown={(event) => event.stopPropagation()} style={{ background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' }}>

        {/* A. Executive header: identity, cycle and data freshness only. */}
        <header className="shrink-0 border-b px-4 py-3" style={border}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black" style={muted}>عين أداء الدكتور</div>
              <h2 className="truncate text-lg font-black" style={heading}>{staffName}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-black disabled:opacity-50" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary-strong)' }}><RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> إعادة تحميل</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق (Esc)" className="rounded-lg p-1.5" style={muted}><X size={20} /></button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="eye-header-facts">
            {branch ? <Chip>{branch}</Chip> : null}
            {headerFacts ? <Chip title={cur?.displayLabel}>{headerFacts.cycleRange}</Chip> : null}
            {headerFacts ? <Chip tone={headerFacts.running ? 'info' : 'neutral'}>{headerFacts.running ? 'دورة جارية' : 'دورة مغلقة'}</Chip> : null}
            {headerFacts ? <Chip tone={headerFacts.confidence.tone}>{headerFacts.confidence.label}</Chip> : null}
            {headerFacts ? <Chip title={data ? `تم البناء ${new Date(data.generatedAt).toLocaleString('ar-EG')}` : undefined}>آخر بيانات: {headerFacts.dataAsOf || UNAVAILABLE}</Chip> : null}
            {data?.salesScopeBranch ? <Chip tone="info" title="صلاحيتك تقتصر على هذا الفرع؛ مبيعات الدكتور في الفروع الأخرى غير معروضة">المبيعات داخل {data.salesScopeBranch} فقط</Chip> : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-5">
          {loading && !data ? <div className="mt-4 space-y-3" aria-busy="true" aria-label="جاري بناء التحليل">
              <div className="h-[150px] animate-pulse rounded-2xl" style={{ background: 'var(--dawaa-theme-soft)' }} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-[76px] animate-pulse rounded-xl" style={{ background: 'var(--dawaa-theme-soft)' }} />)}</div>
              <div className="h-[220px] animate-pulse rounded-2xl" style={{ background: 'var(--dawaa-theme-soft)' }} />
            </div>
          : error ? <div className="mt-6 rounded-xl border p-4 text-sm font-bold" style={toneStyle('danger')}>
              <div className="flex items-center gap-2 font-black"><AlertTriangle size={16} /> تعذر بناء التحليل</div>
              <div className="mt-1 break-words">{error}</div>
              <button type="button" onClick={() => void load(true)} className="mt-3 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-black" style={{ borderColor: 'currentColor' }}><RefreshCw size={14} /> إعادة المحاولة</button>
            </div>
          : cur && prev && data ? <>
            {/* Only a real load failure of the doctor's own sources is raised at the top; other states live in "جودة البيانات". */}
            {ownFailures.length ? <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-[12px] font-bold" style={toneStyle('danger')} data-testid="eye-source-status">
              <span className="flex items-center gap-2"><AlertTriangle size={15} /> تعذر تحميل: {ownFailures.map(x => x.label).join('، ')} — الأرقام المرتبطة محجوبة وليست صفرًا.</span>
              <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-black disabled:opacity-50" style={{ borderColor: 'currentColor' }}><RefreshCw size={13} className={loading ? 'animate-spin' : undefined} /> إعادة التحميل</button>
            </div> : null}

            {/* B. Executive verdict: one reading, from the existing verdict / decision layers only. */}
            <section className="mt-3 rounded-2xl border p-4 sm:mt-4 sm:p-5" style={{ ...border, background: 'var(--dawaa-theme-soft)' }} data-testid="eye-executive-verdict">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-black" style={muted}>الخلاصة التنفيذية</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={VERDICT_LEVEL_TONE[level]} title="قراءة للأدلة وليست درجة تقييم">{VERDICT_LEVEL_LABEL[level]}</Chip>
                  {summaryFromReady ? <Chip tone={confidenceTone(ready!.confidence.level)} title={ready!.confidence.reasons.join(' · ') || undefined}>ثقة التحليل: {ready!.confidence.level === 'high' ? 'عالية' : ready!.confidence.level === 'medium' ? 'متوسطة' : 'منخفضة'}</Chip> : decisionLoading ? <Chip><Loader2 size={11} className="animate-spin" /> جاري المقارنة بالفرع</Chip> : null}
                </div>
              </div>
              <p className="mt-2 text-[17px] font-black leading-8" style={heading}>{summary.headline}</p>
              {summaryFromReady && ready?.analysisNote ? <p className="mt-1 text-[11px] font-bold" style={muted}>{ready.analysisNote}</p> : null}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border p-3" style={{ ...border, background: 'var(--dawaa-theme-surface)' }}>
                  <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>أهم نقطة قوة</div>
                  <div className="mt-1 text-[13px] font-bold leading-6" style={heading}>{summary.strength || <span style={muted}>لا توجد نقطة قوة موثقة تتجاوز الحدود بعد.</span>}</div>
                </div>
                <div className="rounded-xl border p-3" style={{ ...border, background: 'var(--dawaa-theme-surface)' }}>
                  <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}>أهم مشكلة</div>
                  <div className="mt-1 text-[13px] font-bold leading-6" style={heading}>{summary.problem || <span style={muted}>لا توجد مشكلة موثقة تتجاوز الحدود في الأدلة المتاحة.</span>}</div>
                </div>
                <div className="rounded-xl border p-3" style={{ ...border, background: 'var(--dawaa-theme-surface)' }}>
                  <div className="flex items-center gap-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}><Target size={13} /> القرار المقترح</div>
                  <div className="mt-1 text-[13px] font-bold leading-6" style={heading}>{summary.action || <span style={muted}>لا توصية قبل اكتمال المصادر؛ لا يُبنى قرار على مصدر ناقص.</span>}</div>
                </div>
              </div>
            </section>

            {/* C. Core KPIs: value, final/provisional, and a change only where the comparison is fair. */}
            <section className="mt-3" aria-label="المؤشرات الأساسية" data-testid="eye-kpi-strip">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {kpis.map(k => <div key={k.key} className="min-w-0 rounded-xl border p-3" style={{ ...border, background: 'var(--dawaa-theme-surface)' }} data-testid={`eye-kpi-${k.key}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-black leading-4" style={muted}>{k.label}</span>
                    {k.status ? <span className="shrink-0 text-[10px] font-black" style={{ color: k.status === 'final' ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-warning-text)' }}>{k.status === 'final' ? 'نهائي' : 'مؤقت'}</span> : null}
                  </div>
                  <div className="mt-1 truncate text-lg font-black tabular-nums" style={{ color: k.value === null ? 'var(--dawaa-theme-muted)' : 'var(--dawaa-theme-heading)' }}>{kpiValue(k)}</div>
                  <div className="mt-0.5 flex min-h-[16px] items-center gap-1 text-[11px] font-bold" style={{ color: k.change === null ? 'var(--dawaa-theme-muted)' : k.change >= 0 ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-danger-text)' }}>
                    {k.change === null ? null : k.change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span className="truncate" title={k.noteDetail || k.note || undefined}>{k.change !== null ? `${k.change >= 0 ? '+' : '−'}${fmt(Math.abs(k.change), 1)}% ${k.note || ''}` : k.note || '—'}</span>
                  </div>
                </div>)}
              </div>
            </section>

            {/* D. Performance story: one chart, four tabs; the doctor's own tabs never wait for the branch comparison. */}
            {chartModel ? <div className="mt-3"><Suspense fallback={<div className="h-[260px] animate-pulse rounded-2xl" style={{ background: 'var(--dawaa-theme-soft)' }} />}><DoctorPerformanceChart key={`${staffId}:${cycleLabel}:${chartModel.defaultTab}`} model={chartModel} /></Suspense></div> : null}

            {/* Branch comparison: calm explanation when it cannot speak; three indicators when it can. */}
            {branchNotice ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12px] font-bold" style={{ ...border, ...muted }} data-testid="decision-source-status">
              <span><Users size={13} className="me-1 inline" /> مقارنة الفرع غير متاحة لهذه الدورة — {branchNotice}</span>
              {branchRetryable ? <button type="button" onClick={retryComparison} disabled={decisionLoading} className="inline-flex items-center gap-1 text-[11px] font-black disabled:opacity-50" style={{ color: 'var(--dawaa-theme-primary-strong)' }}><RefreshCw size={12} className={decisionLoading ? 'animate-spin' : undefined} /> إعادة المحاولة</button> : null}
            </div> : null}
            {ready ? <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {([
                { icon: <TrendingUp size={15} />, title: 'تطوره مقارنة بنفسه', ind: ready.indicators.self },
                { icon: <Users size={15} />, title: 'موقعه العادل بين زملائه', ind: ready.indicators.peers },
                { icon: <Gauge size={15} />, title: 'اتساق تقييمه مع الأدلة', ind: ready.indicators.evaluation },
              ]).map(x => <div key={x.title} className="min-w-0 rounded-xl border p-3" style={border}>
                <div className="flex items-center gap-1.5 text-[11px] font-black" style={muted}>{x.icon}{x.title}</div>
                <div className="mt-1"><Chip tone={indicatorTone(x.ind.state)}>{x.ind.label}</Chip></div>
                <div className="mt-1.5 line-clamp-2 text-[11px] font-bold leading-5" title={x.ind.detail} style={muted}>{x.ind.detail}</div>
              </div>)}
            </div> : decisionLoading ? <div className="mt-2 grid gap-2 sm:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-[92px] animate-pulse rounded-xl" style={{ background: 'var(--dawaa-theme-soft)' }} />)}</div> : null}

            {/* E. Why this result: intervention first, then review, then strengths. */}
            <Section title="لماذا ظهرت هذه النتيجة؟" hint={diagnosis.length > DEFAULT_DIAGNOSIS_LIMIT ? `أهم ${fmt(DEFAULT_DIAGNOSIS_LIMIT)} من ${fmt(diagnosis.length)}` : undefined}>
              {visibleDiagnosis.length ? <ul className="space-y-2" data-testid="eye-diagnosis">
                {visibleDiagnosis.map(d => <li key={d.id} className="rounded-xl border p-3" style={{ ...border, borderInlineStartWidth: 4, borderInlineStartColor: `var(--dawaa-status-${d.group === 'intervene' ? 'danger' : d.group === 'review' ? 'warning' : 'success'}-text)` }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={d.group === 'intervene' ? 'danger' : d.group === 'review' ? 'warning' : 'success'}>{DIAGNOSIS_GROUP_LABEL[d.group]}</Chip>
                    <span className="text-[13px] font-black" style={heading}>{d.title}</span>
                    <Chip tone={confidenceTone(d.confidence)}>ثقة {d.confidence === 'high' ? 'عالية' : d.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}</Chip>
                  </div>
                  <div className="mt-1 text-[12px] font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>{d.reason}</div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    {d.impact ? <span className="text-[11px] font-bold" style={muted}>{d.impact}</span> : <span />}
                    <button type="button" onClick={() => openTarget(d.focus)} className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>عرض الدليل ←</button>
                  </div>
                </li>)}
              </ul> : <div className="rounded-xl border p-3 text-[12px] font-bold" style={{ ...border, ...muted }}>{verdict?.evidenceComplete ? 'لا توجد ملاحظة موثقة تتجاوز حدود المتابعة.' : 'لا توجد ملاحظة موثقة في المصادر المتاحة؛ بعض الأدلة غير مكتملة.'}</div>}
              {diagnosis.length > DEFAULT_DIAGNOSIS_LIMIT ? <button type="button" onClick={() => setShowAllDiagnosis(v => !v)} className="mt-2 text-[12px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{showAllDiagnosis ? 'عرض الأهم فقط' : `عرض كل الملاحظات (${fmt(diagnosis.length)})`}</button> : null}
            </Section>

            {/* G. Data trust: a compact summary; details on demand. Insufficient data is not a failure. */}
            {quality ? <section className="mt-4 rounded-xl border" style={border} data-testid="eye-data-quality">
              <button type="button" onClick={() => setQualityOpen(v => !v)} aria-expanded={qualityOpen} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-right">
                <span className="flex items-center gap-2 text-[12px] font-black" style={heading}><ShieldCheck size={15} /> جودة البيانات</span>
                <span className="flex items-center gap-1.5">
                  <Chip tone={quality.hasFailure ? 'danger' : quality.complete === quality.total ? 'success' : 'warning'}>{fmt(quality.complete)} من {fmt(quality.total)} مصادر مكتملة</Chip>
                  <ChevronDown size={15} className={qualityOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </span>
              </button>
              {qualityOpen ? <div className="border-t p-3" style={border}>
                <ul className="space-y-1.5">
                  {quality.rows.map(x => <li key={x.key} className="flex flex-wrap items-start justify-between gap-2 text-[12px] font-bold">
                    <span className="min-w-0"><span className="font-black" style={heading}>{x.label}</span>{x.reason ? <span className="ms-1 break-words" style={muted}>— {x.reason}</span> : null}{x.dataAsOf && x.state !== 'available' ? null : x.dataAsOf ? <span className="ms-1" style={muted}>(حتى {x.dataAsOf})</span> : null}</span>
                    <Chip tone={x.tone}>{x.stateLabel}</Chip>
                  </li>)}
                </ul>
                {decisionSourceIssues.filter(([name]) => name !== 'مقارنة الفرع').length ? <ul className="mt-2 space-y-0.5 text-[11px] font-bold" style={muted}>{decisionSourceIssues.filter(([name]) => name !== 'مقارنة الفرع').map(([name, x]) => <li key={name} className="break-words">• {name}: {x.reason}</li>)}</ul> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {ownRetryable ? <button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-black disabled:opacity-50" style={{ ...border, color: 'var(--dawaa-theme-primary-strong)' }}><RefreshCw size={12} className={loading ? 'animate-spin' : undefined} /> إعادة تحميل المصادر المتعثرة</button> : null}
                  {branchRetryable ? <button type="button" onClick={retryComparison} disabled={decisionLoading} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-black disabled:opacity-50" style={{ ...border, color: 'var(--dawaa-theme-primary-strong)' }}><RefreshCw size={12} className={decisionLoading ? 'animate-spin' : undefined} /> إعادة تحميل مقارنة الفرع</button> : null}
                </div>
                <p className="mt-2 text-[11px] font-bold leading-5" style={muted}>غير متاح لا يعني صفرًا. «بيانات غير كافية» ليست عطلًا: المصدر يعمل لكن الأدلة أقل من الحد المطلوب. المبيعات: فواتير الدكتور الموثقة (رقم الموظف، أو اسم بائع يطابق موظفًا واحدًا فقط). الإنتاجية تُقسم على أيام الحضور المثبتة لا الأيام التقويمية، وتبقى مؤقتة طالما توجد أيام بانتظار المراجعة. التحويل الموثق = بيع مثبت بفاتورة ÷ النتائج المسجلة؛ غير المسجل غير معروف. نطاق الأدلة: آخر 3 دورات.</p>
              </div> : null}
            </section> : null}

            <button type="button" onClick={() => setDetailsOpen(v => !v)} aria-expanded={detailsOpen} className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border px-3 py-2.5 text-[13px] font-black" style={{ ...border, color: 'var(--dawaa-theme-primary-strong)' }}>{detailsOpen ? 'إخفاء الأدلة والتفاصيل' : 'عرض الأدلة والتفاصيل'} <ChevronDown size={16} className={detailsOpen ? 'rotate-180 transition-transform' : 'transition-transform'} /></button>

            {/* F. Evidence and details: collapsed until requested; evidence rows load lazily. */}
            <div hidden={!detailsOpen}>
            {summaryFromReady && ready?.decision ? <Section title="تفاصيل القرار">
              <div className="rounded-xl border p-3" style={border}>
                <dl className="grid gap-x-4 gap-y-2 text-[12px] font-bold leading-6 sm:grid-cols-[max-content_1fr]">
                  <dt className="font-black" style={muted}>لماذا؟</dt><dd style={{ color: 'var(--dawaa-theme-text)' }}>{ready.decision.why}</dd>
                  <dt className="font-black" style={muted}>المسؤول</dt><dd><Chip>{ready.decision.owner === 'doctor' ? 'الدكتور' : 'المدير'}</Chip></dd>
                  <dt className="font-black" style={muted}>مؤشر النجاح</dt><dd style={{ color: 'var(--dawaa-theme-text)' }}>{ready.decision.successMetric}</dd>
                  <dt className="font-black" style={muted}>موعد المراجعة</dt><dd style={{ color: 'var(--dawaa-theme-text)' }}>نهاية الدورة القادمة — {fmtDate(ready.decision.reviewBy)}</dd>
                </dl>
                {ready.decision.previousDecision ? <div className="mt-2 border-t pt-2 text-[12px] font-bold" style={{ ...border, ...muted }}>متابعة القرار السابق: <span style={heading}>{ready.decision.previousDecision}</span></div> : null}
              </div>
            </Section> : null}

            {ready && ready.branchPriorities.length ? <div className="mt-3 rounded-xl border" style={border}>
              <button type="button" onClick={() => setBranchOpen(v => !v)} aria-expanded={branchOpen} className="flex w-full items-center justify-between gap-2 p-3 text-right">
                <span className="text-[12px] font-black" style={heading}>أولويات الفرع لهذه الدورة ({ready.branchPriorities.length.toLocaleString('ar-EG')})</span>
                <ChevronDown size={15} className={branchOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {branchOpen ? <ol className="space-y-2 border-t p-3" style={border}>
                {ready.branchPriorities.map((b, i) => <li key={b.key} className="text-[12px] font-bold leading-6">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-black" style={heading}>{(i + 1).toLocaleString('ar-EG')}. {b.title}</span>{b.standalone ? <Chip tone="danger">أولوية مستقلة</Chip> : null}<Chip>{b.affected.toLocaleString('ar-EG')} من {b.covered.toLocaleString('ar-EG')} دكاترة</Chip><Chip>{SCOPE_LABEL[b.scope]}</Chip>{b.direction !== 'unknown' ? <Chip tone={b.direction === 'worsening' || b.direction === 'new' ? 'warning' : b.direction === 'improving' ? 'success' : 'neutral'}>{b.direction === 'worsening' ? 'تتفاقم' : b.direction === 'improving' ? 'تتحسن' : b.direction === 'new' ? 'جديدة' : 'مستقرة'}</Chip> : null}</div>
                  <div style={muted}>{b.action}</div>
                </li>)}
              </ol> : null}
            </div> : null}

            {data.actions.length ? <Section title="إجراءات المبيعات وأثر العملاء">
              <ol className="space-y-2">
                {data.actions.map((a, index) => <li key={a.title} className="flex items-start gap-3 rounded-xl border p-3" style={border}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black" style={toneStyle('info')}>{fmt(index + 1)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-black" style={heading}>{a.title}</span><Chip>{a.owner === 'doctor' ? 'الدكتور' : 'المدير'}</Chip></div>
                    <div className="mt-1 text-[12px] font-bold leading-5" style={muted}>{a.detail}</div>
                    {a.focus !== 'all' ? <button type="button" onClick={() => void openEvidence(a.focus)} className="mt-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>عرض الحالات ←</button> : null}
                  </div>
                </li>)}
              </ol>
            </Section> : null}

            <Section title="مقارنة الدورات" hint={comparisonBasis}>
              <div ref={cyclesRef} className="overflow-x-auto rounded-xl border" style={border}>
                <table className="w-full min-w-[420px] table-fixed text-[12px] font-bold">
                  <thead><tr style={{ background: 'var(--dawaa-theme-table-head, var(--dawaa-theme-soft))', color: 'var(--dawaa-theme-heading)' }}>
                    <th className="w-[28%] p-2 text-right font-black">المؤشر</th>
                    {data.months.map((m, index) => <th key={m.cycleLabel} className="p-2 text-right font-black"><div className="truncate">{index === 0 ? 'الحالية' : index === 1 ? 'السابقة' : 'قبل السابقة'}</div><div className="truncate text-[10px]" style={muted}>{m.displayLabel}</div></th>)}
                  </tr></thead>
                  <tbody>
                    <tr className="border-t" style={border}><td className="p-2">المبيعات</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">
                      <div className="truncate">{money(m.sales)}</div>
                      {m.sales !== null && maxSales > 0 ? <div className="mt-1 h-1.5 rounded-full" style={{ background: 'var(--dawaa-theme-soft)' }}><div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (m.sales / maxSales) * 100)}%`, background: 'var(--dawaa-theme-primary)' }} /></div> : null}
                    </td>)}</tr>
                    <tr className="border-t" style={border}><td className="p-2">الفواتير</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{fmt(m.invoices)}</td>)}</tr>
                    <tr className="border-t" style={border}><td className="p-2">أيام الحضور</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums" title={m.attendanceDetail?.unsettledDays ? `${fmt(m.attendanceDetail.unsettledDays)} يوم بانتظار المراجعة` : undefined}>{m.attendanceDetail ? `${fmt(m.attendanceDetail.presentDays)}${m.attendanceDetail.unsettledDays ? ` (${fmt(m.attendanceDetail.unsettledDays)} معلق)` : ''}` : UNAVAILABLE}</td>)}</tr>
                    <tr className="border-t" style={border}><td className="p-2">ساعات معتمدة</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{m.workedHours === null ? UNAVAILABLE : `${fmt(m.workedHours, 1)} س`}</td>)}</tr>
                    {comparisonDetails ? <>
                      <tr className="border-t" style={border}><td className="p-2">العملاء</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{fmt(m.customers)}</td>)}</tr>
                      <tr className="border-t" style={border}><td className="p-2">متوسط الفاتورة</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{money(m.averageInvoice === null ? null : Math.round(m.averageInvoice))}</td>)}</tr>
                      <tr className="border-t" style={border}><td className="p-2">مبيعات/ساعة</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{money(m.salesPerHour === null ? null : Math.round(m.salesPerHour))}</td>)}</tr>
                      <tr className="border-t" style={border}><td className="p-2">المحادثات</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2 tabular-nums">{fmt(m.conversations)}</td>)}</tr>
                      <tr className="border-t" style={border}><td className="p-2">التغطية</td>{data.months.map(m => <td key={m.cycleLabel} className="p-2"><Chip tone={m.coverage === 'available' ? 'success' : m.coverage === 'partial' ? 'warning' : m.coverage === 'not_applicable' ? 'neutral' : 'danger'} title={m.coverageReason}>{coverageLabel(m.coverage)}</Chip></td>)}</tr>
                    </> : null}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => setComparisonDetails(v => !v)} aria-expanded={comparisonDetails} className="mt-2 inline-flex items-center gap-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{comparisonDetails ? 'إخفاء تفاصيل المقارنة' : 'تفاصيل المقارنة'} <ChevronDown size={14} className={comparisonDetails ? 'rotate-180 transition-transform' : 'transition-transform'} /></button>
            </Section>

            <Section title="الأدلة التفصيلية" hint="المحادثات، الفواتير، الأصناف وفرص البيع المتوقفة">
              <div ref={evidenceRef} className="rounded-xl border" style={border}>
                <button type="button" onClick={() => evidenceOpen ? setEvidenceOpen(false) : void openEvidence('all')} aria-expanded={evidenceOpen} className="flex w-full items-center justify-between gap-3 p-3 text-right">
                  <span className="flex items-center gap-2 text-[12px] font-black" style={heading}><FileText size={15} /> {evidenceOpen ? 'إخفاء الأدلة' : 'فتح الأدلة'}</span>
                  {cur.customerImpact.available ? <span className="flex flex-wrap justify-end gap-1">
                    <Chip>فرص {fmt(cur.customerImpact.commercialConversations)}</Chip><Chip tone="success">بيع مؤكد {fmt(cur.customerImpact.verifiedSaleConversations)}</Chip><Chip tone="danger">فقد بيع {fmt(cur.customerImpact.saleLeakage)}</Chip><Chip tone="warning">متابعات {fmt(cur.customerImpact.followupsNeeded)}</Chip>
                  </span> : <span className="text-[11px] font-bold" style={muted}>أثر العملاء غير متاح</span>}
                </button>
                {evidenceOpen ? <div className="border-t p-3" style={border}>
                  {evidenceFocus !== 'all' ? <div className="mb-2 flex items-center justify-between rounded-lg border p-2 text-[11px] font-black" style={border}><span>فلتر: {evidenceFocus === 'conversion' ? 'التحويل والبيع المؤكد' : evidenceFocus === 'opportunity' ? 'فقد البيع والمتابعة' : 'التوافر وتأثيره'}</span><button type="button" onClick={() => setEvidenceFocus('all')} style={{ color: 'var(--dawaa-theme-primary-strong)' }}>عرض الكل</button></div> : null}
                  {evidenceLoading ? <div className="flex items-center gap-2 p-4 text-xs font-black"><Loader2 size={15} className="animate-spin" /> جاري تحميل الأدلة…</div>
                  : evidenceError ? <div className="rounded-lg border p-3 text-xs font-bold" style={toneStyle('danger')}><div className="break-words">{evidenceError}</div><button type="button" onClick={() => { setEvidence(null); setEvidenceError(''); void openEvidence(evidenceFocus); }} className="mt-2 inline-flex items-center gap-1 font-black"><RefreshCw size={13} /> إعادة المحاولة</button></div>
                  : <div className="grid gap-3 lg:grid-cols-2">
                    <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-black"><FileText size={14} /> المحادثات والفواتير</div><div className="max-h-72 space-y-2 overflow-y-auto">
                      {visibleConversations.map(item => <div key={item.id} className="rounded-lg border p-2 text-[11px]" style={border}><div className="truncate font-black">{item.customer_name || 'عميل غير محدد'} {item.customer_code ? `#${item.customer_code}` : ''}</div><div className="mt-1 break-words" style={muted}>{String(item.conversation_started_at || '').replace('T', ' ').slice(0, 16)} · {item.invoice_match_status === 'verified' ? `فاتورة مؤكدة ${item.matched_invoice_number || ''}${invoiceValue(item.matched_invoice_value)}` : 'بدون بيع مؤكد'}{item.followup_required ? ' · متابعة مطلوبة' : ''}</div></div>)}
                      {!visibleConversations.length ? <div className="p-2 text-[11px]" style={muted}>لا توجد محادثات مطابقة في هذه الدورة.</div> : null}
                    </div></div>
                    <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-black"><PackageSearch size={14} /> الأصناف والفرص</div><div className="max-h-72 space-y-2 overflow-y-auto">
                      {visibleProducts.map((item, index) => <div key={`${item.source_id}-${item.product_name}-${index}`} className="rounded-lg border p-2 text-[11px]" style={border}><div className="truncate font-black">{item.product_name || 'صنف غير محدد'} · {item.customer_name || 'عميل غير محدد'}</div><div className="mt-1 break-words" style={muted}>{item.current_stage || 'مرحلة غير محددة'}{item.leakage_reason ? ` · سبب فقد البيع: ${item.leakage_reason}` : ''}{item.next_action ? ` · التالي: ${item.next_action}` : ''}{item.invoice_match_status === 'verified' ? ` · بيع مؤكد${invoiceValue(item.matched_invoice_value)}` : ''}</div></div>)}
                      {!visibleProducts.length ? <div className="p-2 text-[11px]" style={muted}>لا توجد رحلات أصناف مطابقة في هذه الدورة.</div> : null}
                    </div></div>
                  </div>}
                </div> : null}
              </div>
            </Section>
            </div>
          </> : null}
        </div>
      </div>
    </div> : null}
  </>;
}
