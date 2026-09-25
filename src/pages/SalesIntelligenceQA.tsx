// Sales Intelligence management + QA workspace.
// Management views are separated from the read-only QA audit surface to keep the page decision-oriented.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  Columns3,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { fetchQaBranchOptions, fetchQaCaseList, filterCaseListRows } from '@/lib/salesIntelligence/qa/queries';
import { DEFAULT_QA_LIST_FILTERS, type QaCaseListRow, type QaListFilters } from '@/lib/salesIntelligence/qa/types';
import { buildRecentPharmacyCyclesV1, dateFallsInCycleV1, previousPharmacyCycleV1 } from '@/lib/salesIntelligence/dashboardScopeV1';
import ProductDemandLeakageV22 from '@/components/salesIntelligence/ProductDemandLeakageV22';
import SalesIntelligenceManagementOverviewV1 from '@/components/salesIntelligence/SalesIntelligenceManagementOverviewV1';
import SalesIntelligenceStaffPerformanceV1 from '@/components/salesIntelligence/SalesIntelligenceStaffPerformanceV1';
import {
  attributionLevelBadge,
  branchLabelFor,
  caseTypeLabelFor,
  historicalClosureBadge,
  integrityScopeBadge,
  protocolApplicabilityLabelFor,
  reviewReasonsSummary,
  saleProofStateBadge,
  saleProofStateLabelFor,
} from '@/lib/salesIntelligence/qa/presentation';

const QUICK_FILTERS: Array<{ key: QaListFilters['quickFilter']; label: string }> = [
  { key: 'proof_proven', label: 'مؤكد' },
  { key: 'proof_strongly_supported', label: 'مدعوم بقوة' },
  { key: 'proof_unknown', label: 'غير معروف' },
  { key: 'proof_contradicted', label: 'متناقض' },
  { key: 'needs_human_review', label: 'تحتاج مراجعة' },
  { key: 'competing_attribution', label: 'منافسة على فاتورة' },
  { key: 'no_invoice', label: 'بدون فاتورة' },
  { key: 'has_invoice', label: 'بفاتورة' },
];

type WorkspaceSection = 'overview' | 'demand' | 'staff' | 'qa';

export default function SalesIntelligenceQA() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<QaCaseListRow[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<QaListFilters>(DEFAULT_QA_LIST_FILTERS);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('overview');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showTechnicalColumns, setShowTechnicalColumns] = useState(false);
  const cycleOptions = useMemo(() => buildRecentPharmacyCyclesV1(new Date(), 8), []);
  const [cycleKey, setCycleKey] = useState(cycleOptions[0]?.key || '');
  const [branchScope, setBranchScope] = useState('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [list, branchOptions] = await Promise.all([
        fetchQaCaseList(supabase),
        fetchQaBranchOptions(supabase),
      ]);
      setRows(list);
      setBranches(branchOptions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل حالات ذكاء المبيعات.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      setLoading(true);
      try {
        const [list, branchOptions] = await Promise.all([
          fetchQaCaseList(supabase),
          fetchQaBranchOptions(supabase),
        ]);
        if (cancelled) return;
        setRows(list);
        setBranches(branchOptions);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'تعذر تحميل حالات ذكاء المبيعات.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialLoad();
    return () => { cancelled = true; };
  }, []);

  const selectedCycle = useMemo(
    () => cycleOptions.find((cycle) => cycle.key === cycleKey) || cycleOptions[0],
    [cycleKey, cycleOptions]
  );
  const previousCycle = useMemo(
    () => selectedCycle ? previousPharmacyCycleV1(selectedCycle) : null,
    [selectedCycle]
  );
  const scopedRows = useMemo(
    () => selectedCycle
      ? rows.filter((row) =>
          dateFallsInCycleV1(row.caseStartedAt, selectedCycle) &&
          (branchScope === 'all' || row.branchNameRaw === branchScope)
        )
      : rows,
    [branchScope, rows, selectedCycle]
  );
  const previousScopedRows = useMemo(
    () => previousCycle
      ? rows.filter((row) =>
          dateFallsInCycleV1(row.caseStartedAt, previousCycle) &&
          (branchScope === 'all' || row.branchNameRaw === branchScope)
        )
      : [],
    [branchScope, previousCycle, rows]
  );
  const filteredRows = useMemo(
    () => filterCaseListRows(scopedRows, { ...filters, branch: 'all' }),
    [filters, scopedRows]
  );

  function toggleQuickFilter(key: QaListFilters['quickFilter']) {
    setFilters((current) => ({ ...current, quickFilter: current.quickFilter === key ? 'none' : key }));
  }

  function resetFilters() {
    setFilters(DEFAULT_QA_LIST_FILTERS);
  }

  const tabs = [
    { key: 'overview' as const, label: 'الملخص التنفيذي', hint: 'الأرقام والقرارات المهمة', Icon: LayoutDashboard },
    { key: 'demand' as const, label: 'الطلب وفقد البيع', hint: 'الأصناف والفرص والتسرب', Icon: BarChart3 },
    { key: 'staff' as const, label: 'أداء الفريق', hint: 'المبيعات الرسمية والموظف الحقيقي', Icon: UsersRound },
    { key: 'qa' as const, label: 'مراجعة الحالات', hint: 'التفاصيل الفنية والحالات الملتبسة', Icon: ListChecks },
  ];

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="dawaa-icon-tile h-11 w-11 shrink-0"><ShieldCheck size={20} /></span>
            <div>
              <div className="dawaa-heading text-xl font-black">ذكاء المبيعات</div>
              <div className="dawaa-muted mt-1 max-w-3xl text-sm leading-6">
                لوحة إدارة موحدة تربط المحادثة بالفاتورة والأصناف والموظف الحقيقي، مع فصل كامل بين مؤشرات القرار وشاشة الـQA الفنية.
              </div>
            </div>
          </div>
          <button type="button" onClick={() => void load()} className="dawaa-button dawaa-button--secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث البيانات
          </button>
        </div>
      </section>

      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm font-bold">{error}</div> : null}

      <section className="dawaa-card p-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {tabs.map(({ key, label, hint, Icon }) => {
            const active = activeSection === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveSection(key)}
                className={active
                  ? 'rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-3 text-right'
                  : 'rounded-2xl border border-transparent p-3 text-right hover:bg-[var(--dawaa-theme-soft)]'}
              >
                <div className="flex items-center gap-2 font-black"><Icon size={17} />{label}</div>
                <div className="dawaa-muted mt-1 text-[11px]">{hint}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="dawaa-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid flex-1 gap-3 md:grid-cols-[260px_1fr]">
            <label className="block">
              <span className="dawaa-muted mb-1 flex items-center gap-1 text-[11px] font-bold"><CalendarDays size={13} /> دورة العمل</span>
              <select className="dawaa-select w-full" value={cycleKey} onChange={(event) => setCycleKey(event.target.value)}>
                {cycleOptions.map((cycle) => <option key={cycle.key} value={cycle.key}>{cycle.label}</option>)}
              </select>
            </label>
            <div>
              <div className="dawaa-muted mb-1 text-[11px] font-bold">الفرع</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setBranchScope('all')} className={branchScope === 'all' ? 'dawaa-badge dawaa-badge--info px-3 py-2' : 'dawaa-button dawaa-button--ghost text-xs'}>كل الفروع</button>
                {branches.map((name) => (
                  <button key={name} type="button" onClick={() => setBranchScope(name)} className={branchScope === name ? 'dawaa-badge dawaa-badge--info px-3 py-2' : 'dawaa-button dawaa-button--ghost text-xs'}>{name}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="dawaa-muted text-[11px]">
            {scopedRows.length.toLocaleString('ar-EG')} حالة في النطاق الحالي
          </div>
        </div>
      </section>

      {selectedCycle && activeSection === 'overview' ? (
        <SalesIntelligenceManagementOverviewV1
          rows={scopedRows}
          previousRows={previousScopedRows}
          cycle={selectedCycle}
          previousCycle={previousCycle}
          branch={branchScope}
        />
      ) : null}
      {selectedCycle && activeSection === 'demand' ? <ProductDemandLeakageV22 cycleStart={selectedCycle.start} branch={branchScope} /> : null}
      {selectedCycle && activeSection === 'staff' ? <SalesIntelligenceStaffPerformanceV1 cycle={selectedCycle} branch={branchScope} /> : null}

      {activeSection === 'qa' ? (
        <div className="space-y-4">
          <div className="dawaa-alert dawaa-alert--info text-xs leading-6">
            مساحة QA للقراءة والمراجعة فقط. الحالات غير المحسومة أو المتناقضة لا تتحول تلقائيًا إلى تقييم موظف.
          </div>

          <section className="dawaa-card">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="relative xl:col-span-2">
                <Search className="dawaa-muted absolute right-3 top-1/2 -translate-y-1/2" size={16} />
                <input
                  className="dawaa-input w-full pr-9"
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="بحث بالعميل أو الكود أو الهاتف أو رقم الفاتورة..."
                />
              </label>
              <div className="dawaa-input flex items-center text-sm">
                الفرع: <b className="mr-1">{branchScope === 'all' ? 'كل الفروع' : branchScope}</b>
              </div>
              <select className="dawaa-select" value={filters.saleProofState} onChange={(event) => setFilters((current) => ({ ...current, saleProofState: event.target.value as QaListFilters['saleProofState'] }))}>
                <option value="all">كل حالات إثبات البيع</option>
                <option value="proven">{saleProofStateLabelFor('proven')}</option>
                <option value="strongly_supported">{saleProofStateLabelFor('strongly_supported')}</option>
                <option value="weakly_supported">{saleProofStateLabelFor('weakly_supported')}</option>
                <option value="unknown">{saleProofStateLabelFor('unknown')}</option>
                <option value="contradicted">{saleProofStateLabelFor('contradicted')}</option>
              </select>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowAdvancedFilters((value) => !value)} className="dawaa-button dawaa-button--ghost text-xs">
                <SlidersHorizontal size={14} /> {showAdvancedFilters ? 'إخفاء الفلاتر المتقدمة' : 'فلاتر متقدمة'}
              </button>
              <button type="button" onClick={() => setShowTechnicalColumns((value) => !value)} className="dawaa-button dawaa-button--ghost text-xs">
                <Columns3 size={14} /> {showTechnicalColumns ? 'إخفاء الأعمدة الفنية' : 'إظهار الأعمدة الفنية'}
              </button>
              <button type="button" onClick={resetFilters} className="dawaa-button dawaa-button--ghost text-xs">إعادة تعيين</button>
            </div>

            {showAdvancedFilters ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <select className="dawaa-select" value={filters.caseType} onChange={(event) => setFilters((current) => ({ ...current, caseType: event.target.value }))}>
                  <option value="all">كل أنواع الحالات</option>
                  <option value="sales_opportunity">فرصة بيعية</option>
                  <option value="information_only">استفسار / معلومات فقط</option>
                  <option value="complaint">شكوى</option>
                  <option value="follow_up">متابعة</option>
                  <option value="mixed">مختلطة</option>
                </select>
                <select className="dawaa-select" value={filters.historicalClosureLevel} onChange={(event) => setFilters((current) => ({ ...current, historicalClosureLevel: event.target.value }))}>
                  <option value="all">كل مستويات الإغلاق</option>
                  <option value="explicit">صريح</option>
                  <option value="strongly_inferred">مُستدل بقوة</option>
                  <option value="weakly_inferred">مُستدل بضعف</option>
                  <option value="not_closed">لم يُغلق</option>
                  <option value="unknown">غير معروف</option>
                </select>
                <select className="dawaa-select" value={filters.protocolApplicability} onChange={(event) => setFilters((current) => ({ ...current, protocolApplicability: event.target.value }))}>
                  <option value="all">انطباق البروتوكول: الكل</option>
                  <option value="applicable">ينطبق</option>
                  <option value="not_reached">لم تصل لهذه المرحلة</option>
                  <option value="not_applicable">لا ينطبق</option>
                  <option value="unknown">غير معروف</option>
                </select>
                <select className="dawaa-select" value={filters.attributionLevel} onChange={(event) => setFilters((current) => ({ ...current, attributionLevel: event.target.value }))}>
                  <option value="all">كل مستويات الإسناد</option>
                  <option value="proven">مؤكد</option>
                  <option value="strongly_inferred">مُستدل بقوة</option>
                  <option value="weakly_inferred">مُستدل بضعف</option>
                  <option value="unknown">غير معروف</option>
                </select>
                <select className="dawaa-select" value={filters.needsHumanReview} onChange={(event) => setFilters((current) => ({ ...current, needsHumanReview: event.target.value as QaListFilters['needsHumanReview'] }))}>
                  <option value="all">المراجعة البشرية: الكل</option>
                  <option value="yes">تحتاج مراجعة</option>
                  <option value="no">لا تحتاج مراجعة</option>
                </select>
                <select className="dawaa-select" value={filters.competingAttribution} onChange={(event) => setFilters((current) => ({ ...current, competingAttribution: event.target.value as QaListFilters['competingAttribution'] }))}>
                  <option value="all">منافسة الإسناد: الكل</option>
                  <option value="yes">يوجد منافسة</option>
                  <option value="no">لا يوجد منافسة</option>
                </select>
                <select className="dawaa-select" value={filters.invoiceStatus} onChange={(event) => setFilters((current) => ({ ...current, invoiceStatus: event.target.value as QaListFilters['invoiceStatus'] }))}>
                  <option value="all">الفاتورة: الكل</option>
                  <option value="has_invoice">توجد فاتورة</option>
                  <option value="no_invoice">بدون فاتورة</option>
                </select>
              </div>
            ) : null}
          </section>

          <section className="flex flex-wrap gap-2">
            {QUICK_FILTERS.map((quick) => (
              <button
                key={quick.key}
                type="button"
                onClick={() => toggleQuickFilter(quick.key)}
                className={filters.quickFilter === quick.key ? 'dawaa-badge dawaa-badge--info px-3 py-1.5 text-xs font-black' : 'dawaa-button dawaa-button--secondary text-xs'}
              >
                {quick.label}
              </button>
            ))}
          </section>

          <section className="dawaa-card overflow-hidden p-0">
            {loading ? (
              <div className="dawaa-muted py-16 text-center"><RefreshCw className="mx-auto mb-3 animate-spin" /> جاري التحميل...</div>
            ) : !filteredRows.length ? (
              <div className="dawaa-empty-state py-16 text-center">لا توجد حالات مطابقة للفلاتر الحالية.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                      <th className="p-3">العميل</th>
                      <th className="p-3">الفرع</th>
                      <th className="p-3">نوع الحالة</th>
                      <th className="p-3">الفاتورة</th>
                      <th className="p-3">إثبات البيع</th>
                      <th className="p-3">أدلة الأصناف</th>
                      <th className="p-3">مراجعة بشرية</th>
                      {showTechnicalColumns ? (
                        <>
                          <th className="p-3">الوقت</th>
                          <th className="p-3">الإغلاق</th>
                          <th className="p-3">البروتوكول</th>
                          <th className="p-3">الإسناد</th>
                          <th className="p-3">مرشحون</th>
                          <th className="p-3">منافسة</th>
                          <th className="p-3">نطاق التكامل</th>
                          <th className="p-3">نطاق الفاتورة</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.caseId}
                        className="cursor-pointer border-b border-[var(--dawaa-theme-border)]/60 hover:bg-[var(--dawaa-theme-soft)]"
                        onClick={() => navigate(`/sales-intelligence/qa/${encodeURIComponent(row.caseId)}`)}
                      >
                        <td className="p-3">
                          <div className="dawaa-heading font-bold">{row.customerName || 'عميل غير مسمى'}</div>
                          <div className="dawaa-muted mt-1 text-[11px]">
                            {row.customerCode ? `كود: ${row.customerCode}` : 'كود غير متاح'}
                            {row.customerPhone ? ` • ${row.customerPhone}` : ''}
                          </div>
                          {row.conversationCaseCount > 1 ? <div className="dawaa-muted mt-1 text-[10px]">{row.conversationCaseCount.toLocaleString('ar-EG')} أجزاء في المحادثة</div> : null}
                        </td>
                        <td className="p-3">{branchLabelFor(row.branchNameRaw)}</td>
                        <td className="p-3">{caseTypeLabelFor(row.caseType)}</td>
                        <td className="p-3">{row.selectedInvoiceNumber || '—'}</td>
                        <td className="p-3">{saleProofStateBadge(row.saleProofState)}</td>
                        <td className="p-3">{row.itemEvidenceReady ? <span className="dawaa-badge dawaa-badge--success">متاحة</span> : <span className="dawaa-badge dawaa-badge--warning">غير متاحة</span>}</td>
                        <td className="p-3">
                          {row.needsHumanReview ? <span className="dawaa-badge dawaa-badge--warning" title={reviewReasonsSummary(row.humanReviewReasons)}>نعم</span> : <span className="dawaa-badge dawaa-badge--success">لا</span>}
                        </td>
                        {showTechnicalColumns ? (
                          <>
                            <td className="dawaa-muted whitespace-nowrap p-3 text-xs">{formatDateTime(row.caseStartedAt)}</td>
                            <td className="p-3">{historicalClosureBadge(row.historicalClosureLevel)}</td>
                            <td className="p-3">{protocolApplicabilityLabelFor(row.protocolApplicability)}</td>
                            <td className="p-3">{attributionLevelBadge(row.attributionLevel)}</td>
                            <td className="p-3">{row.candidateCount.toLocaleString('ar-EG')}</td>
                            <td className="p-3">{row.competingCaseCount ? <span className="dawaa-badge dawaa-badge--warning">{row.competingCaseCount}</span> : '0'}</td>
                            <td className="p-3">{integrityScopeBadge(row.integrityEvaluationScope)}</td>
                            <td className="p-3">{integrityScopeBadge(row.invoiceEvidenceScope)}</td>
                          </>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="dawaa-muted text-xs">{filteredRows.length.toLocaleString('ar-EG')} من أصل {scopedRows.length.toLocaleString('ar-EG')} حالة في النطاق الحالي</div>
        </div>
      ) : null}
    </div>
  );
}
