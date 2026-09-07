import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { searchActiveStaffByName, type StaffDirectoryOption } from '@/lib/staffDirectorySearch';
import {
  assignPurchaseInvoiceStaff,
  classifyPendingPurchaseInvoice,
  getPurchaseInvoiceAccuracyFilterOptions,
  getPurchaseInvoiceAccuracyReport,
  listPendingPurchaseInvoiceReviews,
  listPurchaseInvoiceReviewHistory,
  logManualPurchaseInvoiceReview,
  resolvePurchaseInvoiceAlias,
  searchPurchaseInvoiceAccuracy,
} from '@/features/purchaseInvoiceAccuracy/api';
import { FiltersPanel } from '@/features/purchaseInvoiceAccuracy/components/FiltersPanel';
import { HistoryPanel } from '@/features/purchaseInvoiceAccuracy/components/HistoryPanel';
import { QueuePanel } from '@/features/purchaseInvoiceAccuracy/components/QueuePanel';
import { ReportsPanel } from '@/features/purchaseInvoiceAccuracy/components/ReportsPanel';
import {
  EMPTY_FILTER_OPTIONS,
  EMPTY_REPORT,
  MATCH_STATUS_LABEL,
  TRANSACTION_TYPE_LABEL,
  normalizeSearch,
  type AccuracyFilterOptions,
  type HistoricalSearchResult,
  type Outcome,
  type PageTab,
  type QueueRow,
  type ReviewRow,
} from '@/features/purchaseInvoiceAccuracy/types';
import { OUTCOME_CONFIG, OUTCOME_ORDER } from '@/features/purchaseInvoiceAccuracy/ui';

type StaffOption = StaffDirectoryOption;

export default function PurchaseInvoiceAccuracy() {
  const [activeTab, setActiveTab] = useState<PageTab>('invoices');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [reviewerFilter, setReviewerFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [recordSearch, setRecordSearch] = useState('');

  const [search, setSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffOption | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('correct');
  const [invoiceReference, setInvoiceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [history, setHistory] = useState<ReviewRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveSearch, setResolveSearch] = useState('');
  const [resolveOptions, setResolveOptions] = useState<StaffOption[]>([]);
  const [pickedStaffByRow, setPickedStaffByRow] = useState<Record<string, StaffOption>>({});
  const [actingRowId, setActingRowId] = useState<string | null>(null);
  const [detailsRow, setDetailsRow] = useState<QueueRow | null>(null);

  const [report, setReport] = useState(EMPTY_REPORT);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(false);

  const [filterOptions, setFilterOptions] = useState<AccuracyFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [filterOptionsAttempted, setFilterOptionsAttempted] = useState(false);

  const [historicalSearch, setHistoricalSearch] = useState<HistoricalSearchResult | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(false);
    try {
      setQueue(await listPendingPurchaseInvoiceReviews(100));
    } catch {
      setQueueError(true);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(false);
    try {
      setHistory(await listPurchaseInvoiceReviewHistory(100));
      setHistoryLoaded(true);
    } catch {
      setHistoryError(true);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded && !loadingHistory) void loadHistory();
  }, [activeTab, historyLoaded, loadHistory, loadingHistory]);

  const loadFilterOptions = useCallback(async () => {
    if (filterOptionsAttempted) return;
    setFilterOptionsAttempted(true);
    try {
      setFilterOptions(await getPurchaseInvoiceAccuracyFilterOptions());
    } catch {
      // Current queue/history/report rows still provide a safe fallback for visible options.
    }
  }, [filterOptionsAttempted]);

  useEffect(() => {
    if (activeTab === 'history' || activeTab === 'reports') void loadFilterOptions();
  }, [activeTab, loadFilterOptions]);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    setReportError(false);
    try {
      setReport(await getPurchaseInvoiceAccuracyReport({
        fromDate,
        toDate,
        employee: employeeFilter,
        reviewer: reviewerFilter,
        branch: branchFilter,
      }));
    } catch {
      setReportError(true);
    } finally {
      setLoadingReport(false);
    }
  }, [branchFilter, employeeFilter, fromDate, reviewerFilter, toDate]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    const handle = window.setTimeout(() => void loadReport(), 220);
    return () => window.clearTimeout(handle);
  }, [activeTab, loadReport]);

  const recordQuery = normalizeSearch(recordSearch);
  const reviewerFilterApplies = activeTab === 'history' || activeTab === 'reports';
  const hasFilters = Boolean(fromDate || toDate || employeeFilter || branchFilter || (reviewerFilterApplies && reviewerFilter));
  const textSearchActive = recordQuery.length >= 2;
  const serverQueryActive = hasFilters || textSearchActive;

  useEffect(() => {
    if ((activeTab !== 'invoices' && activeTab !== 'history') || !serverQueryActive) {
      setHistoricalSearch(null);
      setLoadingSearch(false);
      setSearchError(false);
      return;
    }

    let cancelled = false;
    setHistoricalSearch(null);
    setSearchError(false);
    setLoadingSearch(true);
    const handle = window.setTimeout(async () => {
      try {
        const result = await searchPurchaseInvoiceAccuracy(
          textSearchActive ? recordSearch : '',
          {
            fromDate,
            toDate,
            employee: employeeFilter,
            reviewer: activeTab === 'history' ? reviewerFilter : '',
            branch: branchFilter,
          },
          100,
        );
        if (!cancelled) setHistoricalSearch(result);
      } catch {
        if (!cancelled) setSearchError(true);
      } finally {
        if (!cancelled) setLoadingSearch(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [activeTab, branchFilter, employeeFilter, fromDate, recordSearch, reviewerFilter, serverQueryActive, textSearchActive, toDate]);

  useEffect(() => {
    const term = resolveSearch.trim();
    if (term.length < 2) {
      setResolveOptions([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const options = await searchActiveStaffByName(term);
      if (!cancelled) setResolveOptions(options);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [resolveSearch]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setStaffOptions([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const options = await searchActiveStaffByName(term);
      if (!cancelled) setStaffOptions(options);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search]);

  const markDerivedDataStale = useCallback(() => {
    setHistoryLoaded(false);
    setHistoricalSearch(null);
    setFilterOptionsAttempted(false);
  }, []);

  const classifyQueueRow = useCallback(async (row: QueueRow, staffId: string, rowOutcome: Outcome) => {
    setActingRowId(row.id);
    try {
      await classifyPendingPurchaseInvoice(row.id, staffId, rowOutcome);
      toast.success('اتسجل');
      setQueue((prev) => prev.filter((item) => item.id !== row.id));
      markDerivedDataStale();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حصل خطأ في الحفظ');
    } finally {
      setActingRowId(null);
    }
  }, [markDerivedDataStale]);

  const resolveAndSaveAlias = useCallback(async (row: QueueRow, staff: StaffOption) => {
    if (!row.entered_by_raw) return;
    try {
      await resolvePurchaseInvoiceAlias(row.entered_by_raw, staff.id);
    } catch {
      // حفظ اختيار الفاتورة نفسها لا يعتمد على نجاح alias العام.
    }
  }, []);

  const persistManualStaffAssignment = useCallback(async (row: QueueRow, staff: StaffOption) => {
    setActingRowId(row.id);
    try {
      await assignPurchaseInvoiceStaff(row.id, staff.id);
      const updateRow = (item: QueueRow): QueueRow => item.id === row.id ? {
        ...item,
        entered_by_staff_id: staff.id,
        entered_by_staff_name: staff.name,
        match_status: 'matched',
      } : item;
      setQueue((prev) => prev.map(updateRow));
      setHistoricalSearch((prev) => prev ? { ...prev, pending: prev.pending.map(updateRow) } : prev);
      setPickedStaffByRow((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setDetailsRow((prev) => prev ? updateRow(prev) : prev);
      setResolvingId(null);
      setResolveSearch('');
      setResolveOptions([]);
      if (row.entered_by_raw && row.match_status === 'unmatched') void resolveAndSaveAlias(row, staff);
      toast.success(`اتحفظ إن ${staff.name} هو مدخل الفاتورة`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذّر حفظ مدخل الفاتورة');
    } finally {
      setActingRowId(null);
    }
  }, [resolveAndSaveAlias]);

  const handleSubmit = useCallback(async () => {
    if (!selectedStaff) {
      toast.error('اختار الموظف الأول');
      return;
    }
    setSubmitting(true);
    try {
      await logManualPurchaseInvoiceReview({
        staffId: selectedStaff.id,
        outcome,
        branch: selectedStaff.branch,
        invoiceReference,
        notes,
      });
      toast.success('اتسجل');
      setSelectedStaff(null);
      setSearch('');
      setInvoiceReference('');
      setNotes('');
      setOutcome('correct');
      markDerivedDataStale();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حصل خطأ في الحفظ');
    } finally {
      setSubmitting(false);
    }
  }, [selectedStaff, outcome, invoiceReference, notes, markDerivedDataStale]);

  const employeeOptions = useMemo(() => {
    const values = new Set(filterOptions.staff);
    queue.forEach((row) => {
      const name = row.entered_by_staff_name || pickedStaffByRow[row.id]?.name || row.entered_by_raw;
      if (name) values.add(name);
    });
    history.forEach((row) => row.staff_name && values.add(row.staff_name));
    report.staff.forEach((row) => row.staff_name && values.add(row.staff_name));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [filterOptions.staff, history, pickedStaffByRow, queue, report.staff]);

  const reviewerOptions = useMemo(() => {
    const values = new Set(filterOptions.reviewers);
    history.forEach((row) => row.reviewed_by_name && values.add(row.reviewed_by_name));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [filterOptions.reviewers, history]);

  const branchOptions = useMemo(() => {
    const values = new Set(filterOptions.branches);
    queue.forEach((row) => row.branch && values.add(row.branch));
    history.forEach((row) => row.branch && values.add(row.branch));
    report.branches.forEach((row) => row.branch && values.add(row.branch));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [filterOptions.branches, history, queue, report.branches]);

  const localFilteredQueue = useMemo(() => queue.filter((row) => {
    if (!recordQuery) return true;
    const haystack = [row.system_invoice_number, row.base44_id, row.entered_by_staff_name, row.entered_by_raw, row.branch]
      .map(normalizeSearch)
      .join(' ');
    return haystack.includes(recordQuery);
  }), [queue, recordQuery]);

  const localFilteredHistory = useMemo(() => history.filter((row) => {
    if (!recordQuery) return true;
    const haystack = [row.invoice_reference, row.staff_name, row.reviewed_by_name, row.notes, row.branch]
      .map(normalizeSearch)
      .join(' ');
    return haystack.includes(recordQuery);
  }), [history, recordQuery]);

  const filteredQueue = serverQueryActive ? (historicalSearch?.pending ?? []) : localFilteredQueue;
  const filteredHistory = serverQueryActive ? (historicalSearch?.reviews ?? []) : localFilteredHistory;

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setEmployeeFilter('');
    setReviewerFilter('');
    setBranchFilter('');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>دقة إدخال فواتير المشتريات</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          مراجعة فواتير Base44 وتسجيل دقة الإدخال وتحليل أداء الموظفين والفروع.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border p-2 sm:grid-cols-4" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
        {([
          ['invoices', `الفواتير (${queue.length})`],
          ['manual', 'تسجيل مراجعة يدوية'],
          ['history', historyLoaded ? `آخر المراجعات (${history.length})` : 'آخر المراجعات'],
          ['reports', 'التقارير الذكية'],
        ] as Array<[PageTab, string]>).map(([key, label]) => {
          const active = activeTab === key;
          return <button key={key} type="button" onClick={() => setActiveTab(key)} className="rounded-xl px-3 py-2 text-xs font-black transition sm:text-sm" style={{ background: active ? 'var(--dawaa-theme-primary)' : 'transparent', color: active ? 'white' : 'var(--dawaa-theme-text)' }}>{label}</button>;
        })}
      </div>

      {activeTab !== 'manual' ? (
        <FiltersPanel
          activeTab={activeTab}
          fromDate={fromDate}
          toDate={toDate}
          employeeFilter={employeeFilter}
          reviewerFilter={reviewerFilter}
          branchFilter={branchFilter}
          recordSearch={recordSearch}
          loadingSearch={loadingSearch}
          searchError={searchError}
          employeeOptions={employeeOptions}
          reviewerOptions={reviewerOptions}
          branchOptions={branchOptions}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
          onEmployeeChange={setEmployeeFilter}
          onReviewerChange={setReviewerFilter}
          onBranchChange={setBranchFilter}
          onSearchChange={setRecordSearch}
          onClearFilters={clearFilters}
        />
      ) : null}

      {activeTab === 'invoices' ? (
        <QueuePanel
          rows={filteredQueue}
          totalLoaded={queue.length}
          loading={loadingQueue || (serverQueryActive && loadingSearch && !historicalSearch)}
          error={queueError && !serverQueryActive}
          serverQueryActive={serverQueryActive}
          textSearchActive={textSearchActive}
          actingRowId={actingRowId}
          resolvingId={resolvingId}
          resolveSearch={resolveSearch}
          resolveOptions={resolveOptions}
          pickedStaffByRow={pickedStaffByRow}
          onRetry={() => void loadQueue()}
          onOpenDetails={setDetailsRow}
          onClassify={(row, staffId, rowOutcome) => void classifyQueueRow(row, staffId, rowOutcome)}
          onStartResolving={setResolvingId}
          onResolveSearchChange={setResolveSearch}
          onAssignStaff={(row, staff) => void persistManualStaffAssignment(row, staff)}
        />
      ) : null}

      {activeTab === 'manual' ? (
        <Panel className="space-y-4 p-4">
          <SectionTitle title="تسجيل مراجعة يدوية" icon={<Users size={18} />} />
          <div>
            <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>مين اللي دخل الفاتورة؟</p>
            {selectedStaff ? (
              <div className="flex items-center justify-between rounded-lg border p-2" style={{ borderColor: 'var(--dawaa-theme-primary)', background: 'var(--dawaa-theme-soft)' }}><span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{selectedStaff.name}</span><button type="button" onClick={() => setSelectedStaff(null)} className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>تغيير</button></div>
            ) : (
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} />
                <input type="text" className="input-dark w-full pr-8 text-sm" placeholder="اكتب اسم الموظف..." value={search} onChange={(event) => setSearch(event.target.value)} />
                {staffOptions.length > 0 ? <div className="mt-1 space-y-1 rounded-lg border p-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}>{staffOptions.map((staff) => <button key={staff.id} type="button" onClick={() => { setSelectedStaff(staff); setStaffOptions([]); }} className="flex w-full items-center justify-between rounded-md p-2 text-right text-sm hover:bg-[var(--dawaa-theme-soft)]"><span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{staff.name}</span><span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{staff.branch}</span></button>)}</div> : null}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>النتيجة</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OUTCOME_ORDER.map((key) => {
                const cfg = OUTCOME_CONFIG[key];
                const Icon = cfg.icon;
                const active = outcome === key;
                return <button key={key} type="button" onClick={() => setOutcome(key)} className="flex items-center justify-between gap-2 rounded-xl border p-3 text-right transition" style={{ borderColor: active ? cfg.borderColor : 'var(--dawaa-theme-border)', background: active ? cfg.bg : 'transparent' }}><span className="flex items-center gap-2 font-black" style={{ color: active ? cfg.color : 'var(--dawaa-theme-text)' }}><Icon size={16} /> {cfg.label}</span><span className="text-xs font-black" style={{ color: cfg.color }}>{cfg.points > 0 ? '+' : ''}{cfg.points} نقطة</span></button>;
              })}
            </div>
          </div>
          <div><p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>رقم الفاتورة/الطلبية (اختياري)</p><input type="text" className="input-dark w-full text-sm" value={invoiceReference} onChange={(event) => setInvoiceReference(event.target.value)} /></div>
          <div><p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة</p><input type="text" className="input-dark w-full text-sm" placeholder="تفاصيل سريعة..." value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white" style={{ background: 'var(--dawaa-theme-primary)' }}>{submitting ? <Loader2 size={16} className="animate-spin" /> : null}تسجيل</button>
        </Panel>
      ) : null}

      {activeTab === 'history' ? (
        <HistoryPanel rows={filteredHistory} totalLoaded={history.length} loading={loadingHistory || (serverQueryActive && loadingSearch && !historicalSearch)} error={historyError} historicalSearchActive={textSearchActive} historyLoaded={historyLoaded} onRetry={() => void loadHistory()} />
      ) : null}

      {activeTab === 'reports' ? (
        <ReportsPanel report={report} loading={loadingReport} error={reportError} reviewerFilterActive={Boolean(reviewerFilter)} onRetry={() => void loadReport()} />
      ) : null}

      {detailsRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => setDetailsRow(null)}>
          <div className="w-full max-w-lg rounded-2xl border p-5 shadow-2xl" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }} role="dialog" aria-modal="true" aria-label="تفاصيل الفاتورة" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>تفاصيل الفاتورة</p><h2 className="text-lg font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{detailsRow.system_invoice_number ? `فاتورة ${detailsRow.system_invoice_number}` : detailsRow.base44_id}</h2></div><button type="button" onClick={() => setDetailsRow(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }} aria-label="إغلاق التفاصيل"><X size={18} /></button></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ['الفرع', detailsRow.branch || 'غير محدد'],
                ['التاريخ', detailsRow.invoice_date || 'غير مسجل'],
                ['نوع العملية', TRANSACTION_TYPE_LABEL[detailsRow.transaction_type || ''] || detailsRow.transaction_type || 'غير محدد'],
                ['قيمة الفاتورة', detailsRow.total_value != null ? `${detailsRow.total_value} جنيه` : 'غير مسجلة'],
                ['الموظف المطابق', detailsRow.entered_by_staff_name || 'غير محدد'],
                ['الاسم المسجل في Base44', detailsRow.entered_by_raw || 'غير مسجل'],
                ['حالة المطابقة', MATCH_STATUS_LABEL[detailsRow.match_status]],
                ['Base44 ID', detailsRow.base44_id],
              ].map(([label, value]) => <div key={label} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}><p className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{label}</p><p className="mt-1 break-words text-sm font-black" style={{ color: 'var(--dawaa-theme-text)' }}>{value}</p></div>)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
