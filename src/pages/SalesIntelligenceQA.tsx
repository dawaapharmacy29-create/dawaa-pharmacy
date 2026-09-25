// Sales Intelligence QA Review UI — Phase H.2.
//
// READ ONLY internal audit list. No editing, no staff penalties, no KPI consumption, no automatic
// writes — see src/lib/salesIntelligence/qa/queries.ts's own module comment for the exact
// read-only contract this page and its data layer honor.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, LayoutDashboard, ListChecks, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import { fetchQaBranchOptions, fetchQaCaseList, filterCaseListRows } from '@/lib/salesIntelligence/qa/queries';
import { DEFAULT_QA_LIST_FILTERS, type QaCaseListRow, type QaListFilters } from '@/lib/salesIntelligence/qa/types';
import ProductDemandLeakageV22 from '@/components/salesIntelligence/ProductDemandLeakageV22';
import SalesIntelligenceManagementOverviewV1 from '@/components/salesIntelligence/SalesIntelligenceManagementOverviewV1';
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

/** SaleProofState-specific quick filters first (the primary lens for the pilot), then the rest. */
const QUICK_FILTERS: Array<{ key: QaListFilters['quickFilter']; label: string }> = [
  { key: 'proof_proven', label: 'مؤكد' },
  { key: 'proof_strongly_supported', label: 'مدعوم بقوة' },
  { key: 'proof_weakly_supported', label: 'مدعوم بضعف' },
  { key: 'proof_unknown', label: 'غير معروف' },
  { key: 'proof_contradicted', label: 'متناقض' },
  { key: 'needs_human_review', label: 'تحتاج مراجعة بشرية' },
  { key: 'competing_attribution', label: 'منافسة على فاتورة/حالة' },
  { key: 'no_invoice', label: 'بدون فاتورة' },
  { key: 'has_invoice', label: 'توجد فاتورة' },
  { key: 'strongly_inferred_closure', label: 'إغلاق مُستدل بقوة' },
  { key: 'applicable_cases', label: 'حالات ينطبق عليها البروتوكول' },
  { key: 'strongly_inferred_attribution', label: 'إسناد مُستدل بقوة' },
  { key: 'unknown_cases', label: 'حالات غير معروفة (الأبعاد القديمة)' },
  { key: 'no_basket', label: 'بدون سلة' },
  { key: 'multiple_unresolved_products', label: 'منتجات متعددة غير محسومة' },
];

export default function SalesIntelligenceQA() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<QaCaseListRow[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<QaListFilters>(DEFAULT_QA_LIST_FILTERS);
  const [activeSection, setActiveSection] = useState<'overview' | 'demand' | 'qa'>('overview');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [list, branchOptions] = await Promise.all([fetchQaCaseList(supabase), fetchQaBranchOptions(supabase)]);
        if (cancelled) return;
        setRows(list);
        setBranches(branchOptions);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'تعذر تحميل حالات ذكاء المبيعات.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const filteredRows = useMemo(() => filterCaseListRows(rows, filters), [rows, filters]);

  function toggleQuickFilter(key: QaListFilters['quickFilter']) {
    setFilters((current) => ({ ...current, quickFilter: current.quickFilter === key ? 'none' : key }));
  }

  function resetFilters() {
    setFilters(DEFAULT_QA_LIST_FILTERS);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="dawaa-card dawaa-card--soft">
        <div className="flex items-center gap-3 text-sm">
          <span className="dawaa-icon-tile h-10 w-10 shrink-0"><ShieldCheck className="h-5 w-5" /></span>
          <div className="dawaa-body flex-1">
            أداة مراجعة داخلية <b>للقراءة فقط</b> — لفحص فهم الذكاء الاصطناعي لكل حالة (تقسيم المحادثة، السلة، الإسناد، التطابق مع الفاتورة).
            لا تعديل على نتائج المحرك، ولا احتساب لتقييم الموظفين، ولا استخدام مباشر في مؤشرات الأداء.
          </div>
          <button type="button" onClick={() => window.location.reload()} className="dawaa-button dawaa-button--secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm font-bold">{error}</div> : null}

      <section className="dawaa-card p-2">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['overview', 'الملخص التنفيذي', LayoutDashboard, 'قرار الإدارة والأرقام الرسمية'],
            ['demand', 'الطلب وفقد البيع', BarChart3, 'الأصناف والفرص والتسرب'],
            ['qa', 'مراجعة الحالات', ListChecks, 'QA الفني والتفاصيل الدقيقة'],
          ].map(([key, label, Icon, hint]) => {
            const active = activeSection === key;
            return (
              <button
                key={String(key)}
                type="button"
                onClick={() => setActiveSection(key as 'overview' | 'demand' | 'qa')}
                className={active
                  ? 'rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-3 text-right'
                  : 'rounded-2xl border border-transparent p-3 text-right hover:bg-[var(--dawaa-theme-soft)]'}
              >
                <div className="flex items-center gap-2 font-black">
                  <Icon size={17} />
                  {label}
                </div>
                <div className="dawaa-muted mt-1 text-[11px]">{hint}</div>
              </button>
            );
          })}
        </div>
      </section>

      {activeSection === 'overview' ? <SalesIntelligenceManagementOverviewV1 rows={rows} /> : null}
      {activeSection === 'demand' ? <ProductDemandLeakageV22 /> : null}

      {activeSection === 'qa' ? (
      <>
      <section className="dawaa-card grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="relative xl:col-span-2">
          <Search className="dawaa-muted absolute right-3 top-1/2 -translate-y-1/2" size={16} />
          <input
            className="dawaa-input w-full pr-9"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="بحث باسم العميل أو الكود أو الهاتف أو رقم الفاتورة أو الحالة..."
          />
        </label>
        <select className="dawaa-select" value={filters.branch} onChange={(e) => setFilters((f) => ({ ...f, branch: e.target.value }))}>
          <option value="all">كل الفروع</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="dawaa-select" value={filters.caseType} onChange={(e) => setFilters((f) => ({ ...f, caseType: e.target.value }))}>
          <option value="all">كل أنواع الحالات</option>
          <option value="sales_opportunity">فرصة بيعية</option>
          <option value="information_only">استفسار / معلومات فقط</option>
          <option value="complaint">شكوى</option>
          <option value="follow_up">متابعة</option>
          <option value="mixed">مختلطة</option>
        </select>
        <select className="dawaa-select" value={filters.historicalClosureLevel} onChange={(e) => setFilters((f) => ({ ...f, historicalClosureLevel: e.target.value }))}>
          <option value="all">كل مستويات الإغلاق التاريخي</option>
          <option value="explicit">صريح</option>
          <option value="strongly_inferred">مُستدل بقوة</option>
          <option value="weakly_inferred">مُستدل بضعف</option>
          <option value="not_closed">لم يُغلق</option>
          <option value="unknown">غير معروف</option>
        </select>
        <select className="dawaa-select" value={filters.protocolApplicability} onChange={(e) => setFilters((f) => ({ ...f, protocolApplicability: e.target.value }))}>
          <option value="all">كل حالات انطباق البروتوكول</option>
          <option value="applicable">ينطبق</option>
          <option value="not_reached">لم تصل المحادثة لهذه المرحلة</option>
          <option value="not_applicable">لا ينطبق</option>
          <option value="unknown">غير معروف</option>
        </select>
        <select className="dawaa-select" value={filters.attributionLevel} onChange={(e) => setFilters((f) => ({ ...f, attributionLevel: e.target.value }))}>
          <option value="all">كل مستويات الإسناد</option>
          <option value="proven">مؤكد</option>
          <option value="strongly_inferred">مُستدل بقوة</option>
          <option value="weakly_inferred">مُستدل بضعف</option>
          <option value="unknown">غير معروف</option>
        </select>
        <select
          className="dawaa-select"
          value={filters.saleProofState}
          onChange={(e) => setFilters((f) => ({ ...f, saleProofState: e.target.value as QaListFilters['saleProofState'] }))}
        >
          <option value="all">كل حالات إثبات البيع</option>
          <option value="proven">{saleProofStateLabelFor('proven')}</option>
          <option value="strongly_supported">{saleProofStateLabelFor('strongly_supported')}</option>
          <option value="weakly_supported">{saleProofStateLabelFor('weakly_supported')}</option>
          <option value="unknown">{saleProofStateLabelFor('unknown')}</option>
          <option value="contradicted">{saleProofStateLabelFor('contradicted')}</option>
        </select>
        <select className="dawaa-select" value={filters.needsHumanReview} onChange={(e) => setFilters((f) => ({ ...f, needsHumanReview: e.target.value as QaListFilters['needsHumanReview'] }))}>
          <option value="all">تحتاج مراجعة بشرية؟ (الكل)</option>
          <option value="yes">تحتاج مراجعة</option>
          <option value="no">لا تحتاج مراجعة</option>
        </select>
        <select className="dawaa-select" value={filters.competingAttribution} onChange={(e) => setFilters((f) => ({ ...f, competingAttribution: e.target.value as QaListFilters['competingAttribution'] }))}>
          <option value="all">منافسة على الإسناد؟ (الكل)</option>
          <option value="yes">يوجد منافسة</option>
          <option value="no">لا يوجد منافسة</option>
        </select>
        <select className="dawaa-select" value={filters.invoiceStatus} onChange={(e) => setFilters((f) => ({ ...f, invoiceStatus: e.target.value as QaListFilters['invoiceStatus'] }))}>
          <option value="all">حالة الفاتورة (الكل)</option>
          <option value="has_invoice">توجد فاتورة مختارة</option>
          <option value="no_invoice">بدون فاتورة</option>
        </select>
        <button type="button" onClick={resetFilters} className="dawaa-button dawaa-button--ghost">إعادة تعيين الفلاتر</button>
      </section>

      <section className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((qf) => (
          <button
            key={qf.key}
            type="button"
            onClick={() => toggleQuickFilter(qf.key)}
            className={filters.quickFilter === qf.key ? 'dawaa-badge dawaa-badge--info px-3 py-1.5 text-xs font-black' : 'dawaa-button dawaa-button--secondary text-xs'}
          >
            {qf.label}
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
                  {[
                    'العميل',
                    'تقسيم المحادثة',
                    'الفرع',
                    'البداية / النهاية',
                    'نوع الحالة',
                    'الإغلاق التاريخي',
                    'انطباق البروتوكول',
                    'مستوى الإسناد',
                    'الفاتورة',
                    'إثبات البيع',
                    'عدد المرشحين',
                    'منافسة',
                    'نطاق التكامل',
                    'نطاق أدلة الفاتورة',
                    'أدلة الأصناف',
                    'مراجعة بشرية',
                  ].map((h) => (
                    <th key={h} className="p-3">{h}</th>
                  ))}
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
                      <div className="dawaa-muted mt-1 max-w-[220px] truncate font-mono text-[10px]" title={row.caseId}>{row.caseId}</div>
                    </td>
                    <td className="p-3">
                      {row.conversationCaseCount > 1 ? (
                        <span className="dawaa-badge dawaa-badge--warning">{row.conversationCaseCount.toLocaleString('ar-EG')} أجزاء</span>
                      ) : (
                        <span className="dawaa-badge dawaa-badge--success">محادثة واحدة</span>
                      )}
                    </td>
                    <td className="dawaa-body p-3">{branchLabelFor(row.branchNameRaw)}</td>
                    <td className="dawaa-muted whitespace-nowrap p-3 text-xs">{formatDateTime(row.caseStartedAt)}{row.caseEndedAt ? ` — ${formatDateTime(row.caseEndedAt)}` : ''}</td>
                    <td className="p-3">{caseTypeLabelFor(row.caseType)}</td>
                    <td className="p-3">{historicalClosureBadge(row.historicalClosureLevel)}</td>
                    <td className="p-3">{protocolApplicabilityLabelFor(row.protocolApplicability)}</td>
                    <td className="p-3">{attributionLevelBadge(row.attributionLevel)}</td>
                    <td className="dawaa-body p-3" title={row.selectedInvoiceId ? `selected_invoice_id: ${row.selectedInvoiceId}` : undefined}>
                      {row.selectedInvoiceNumber || '—'}
                    </td>
                    <td className="p-3">{saleProofStateBadge(row.saleProofState)}</td>
                    <td className="p-3">{row.candidateCount > 0 ? row.candidateCount.toLocaleString('ar-EG') : <span className="dawaa-muted">0</span>}</td>
                    <td className="p-3">{row.competingCaseCount > 0 ? <span className="dawaa-badge dawaa-badge--warning">{row.competingCaseCount}</span> : <span className="dawaa-muted">0</span>}</td>
                    <td className="p-3">{integrityScopeBadge(row.integrityEvaluationScope)}</td>
                    <td className="p-3">{integrityScopeBadge(row.invoiceEvidenceScope)}</td>
                    <td className="p-3">
                      {row.itemEvidenceReady ? (
                        <span className="dawaa-badge dawaa-badge--success">متاحة</span>
                      ) : (
                        <span className="dawaa-badge dawaa-badge--warning" title="بيانات أصناف الفاتورة غير متاحة حاليًا — التقييم الحالي يعتمد على بيانات رأس الفاتورة فقط">غير متاحة</span>
                      )}
                    </td>
                    <td className="p-3">
                      {row.needsHumanReview ? <span className="dawaa-badge dawaa-badge--warning" title={reviewReasonsSummary(row.humanReviewReasons)}>نعم</span> : <span className="dawaa-badge dawaa-badge--success">لا</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="dawaa-muted text-xs">{filteredRows.length.toLocaleString('ar-EG')} من أصل {rows.length.toLocaleString('ar-EG')} حالة</div>
      </>
      ) : null}
    </div>
  );
}
