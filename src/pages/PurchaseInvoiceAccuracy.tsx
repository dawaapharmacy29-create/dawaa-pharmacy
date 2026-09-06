import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  Filter,
  Link2,
  Loader2,
  Search,
  ThumbsDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import { searchActiveStaffByName, type StaffDirectoryOption } from '@/lib/staffDirectorySearch';

type StaffOption = StaffDirectoryOption;
type PageTab = 'invoices' | 'manual' | 'history' | 'reports';
type Outcome = 'correct' | 'mixup_unregistered' | 'negligence' | 'customer_problem';

const OUTCOME_CONFIG: Record<Outcome, { label: string; points: number; color: string; bg: string; borderColor: string; icon: typeof CheckCircle2 }> = {
  correct: { label: 'إدخال صحيح', points: 2, color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)', icon: CheckCircle2 },
  mixup_unregistered: { label: 'لغبطة أو عدم تسجيل', points: -1, color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)', icon: AlertTriangle },
  negligence: { label: 'إهمال', points: -2, color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)', icon: ThumbsDown },
  customer_problem: { label: 'سبب مشكلة مع عميل', points: -4, color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)', icon: ThumbsDown },
};

const OUTCOME_ORDER: Outcome[] = ['correct', 'mixup_unregistered', 'negligence', 'customer_problem'];

type ReviewRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  invoice_reference: string | null;
  outcome: Outcome;
  points: number;
  notes: string | null;
  review_date: string;
  reviewed_by_name: string | null;
};

type QueueRow = {
  id: string;
  base44_id: string;
  system_invoice_number: string | null;
  branch: string | null;
  transaction_type: string | null;
  entered_by_raw: string | null;
  entered_by_staff_id: string | null;
  entered_by_staff_name: string | null;
  match_status: 'matched' | 'ambiguous' | 'unmatched' | 'empty';
  invoice_date: string | null;
  total_value: number | null;
};

type ReportSummary = {
  reviewed_count: number;
  pending_count: number;
  correct_count: number;
  mixup_count: number;
  negligence_count: number;
  customer_problem_count: number;
  unknown_staff_count: number;
  total_points: number;
  accuracy_rate: number;
};

type StaffReportRow = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  reviewed_count: number;
  correct_count: number;
  mixup_count: number;
  negligence_count: number;
  customer_problem_count: number;
  total_points: number;
  accuracy_rate: number;
  avg_points: number;
};

type BranchReportRow = {
  branch: string;
  reviewed_count: number;
  pending_count: number;
  correct_count: number;
  negligence_count: number;
  customer_problem_count: number;
  total_points: number;
  accuracy_rate: number;
};

type DailyReportRow = {
  report_date: string;
  reviewed_count: number;
  correct_count: number;
  total_points: number;
  accuracy_rate: number;
};

type AccuracyReport = {
  summary: ReportSummary;
  staff: StaffReportRow[];
  branches: BranchReportRow[];
  daily: DailyReportRow[];
};

const EMPTY_REPORT: AccuracyReport = {
  summary: {
    reviewed_count: 0,
    pending_count: 0,
    correct_count: 0,
    mixup_count: 0,
    negligence_count: 0,
    customer_problem_count: 0,
    unknown_staff_count: 0,
    total_points: 0,
    accuracy_rate: 0,
  },
  staff: [],
  branches: [],
  daily: [],
};

const MATCH_STATUS_LABEL: Record<QueueRow['match_status'], string> = {
  matched: 'تمت مطابقة الموظف',
  ambiguous: 'الاسم محتاج تأكيد',
  unmatched: 'الاسم غير معروف',
  empty: 'لم يتم تسجيل اسم في Base44',
};

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  external_purchase: 'شراء خارجي',
  internal_transfer: 'تحويل بين فرعين',
};

function normalizeSearch(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase('ar');
}

function getStaffStatus(row: StaffReportRow) {
  const severe = row.negligence_count + row.customer_problem_count;
  if (row.reviewed_count >= 5 && row.accuracy_rate >= 95 && severe === 0) return { label: 'ممتاز', color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)' };
  if (row.accuracy_rate >= 85 && severe <= 1) return { label: 'جيد جدًا', color: 'var(--dawaa-theme-primary)', bg: 'var(--dawaa-theme-soft)' };
  if (row.accuracy_rate >= 70 && severe <= 2) return { label: 'يحتاج متابعة', color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)' };
  return { label: 'خطر تشغيلي', color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)' };
}

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
  const [loadingHistory, setLoadingHistory] = useState(true);
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

  const [report, setReport] = useState<AccuracyReport>(EMPTY_REPORT);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(false);
    const { data, error } = await supabase.rpc('list_base44_pending_invoice_reviews_v1', { p_limit: 100 });
    if (error) {
      setQueueError(true);
      setLoadingQueue(false);
      return;
    }
    setQueue((data || []) as QueueRow[]);
    setLoadingQueue(false);
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(false);
    const { data, error } = await supabase.rpc('list_purchase_invoice_entry_reviews_v1', { p_limit: 100 });
    if (error) {
      setHistoryError(true);
      setLoadingHistory(false);
      return;
    }
    setHistory((data || []) as ReviewRow[]);
    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    setReportError(false);
    const { data, error } = await supabase.rpc('get_purchase_invoice_accuracy_report_v1', {
      p_from_date: fromDate || null,
      p_to_date: toDate || null,
      p_staff_name: employeeFilter || null,
      p_reviewer_name: reviewerFilter || null,
      p_branch: branchFilter || null,
    });
    if (error) {
      setReportError(true);
      setLoadingReport(false);
      return;
    }
    setReport((data || EMPTY_REPORT) as AccuracyReport);
    setLoadingReport(false);
  }, [branchFilter, employeeFilter, fromDate, reviewerFilter, toDate]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    const handle = setTimeout(() => void loadReport(), 180);
    return () => clearTimeout(handle);
  }, [activeTab, loadReport]);

  useEffect(() => {
    const term = resolveSearch.trim();
    if (term.length < 2) {
      setResolveOptions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const options = await searchActiveStaffByName(term);
      if (!cancelled) setResolveOptions(options);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [resolveSearch]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setStaffOptions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const options = await searchActiveStaffByName(term);
      if (!cancelled) setStaffOptions(options);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search]);

  const classifyQueueRow = useCallback(async (row: QueueRow, staffId: string, rowOutcome: Outcome) => {
    setActingRowId(row.id);
    try {
      const { error } = await supabase.rpc('log_base44_invoice_review_v1', {
        p_sync_id: row.id,
        p_staff_id: staffId,
        p_outcome: rowOutcome,
      });
      if (error) throw error;
      toast.success('اتسجل');
      setQueue((prev) => prev.filter((q) => q.id !== row.id));
      await loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
    } finally {
      setActingRowId(null);
    }
  }, [loadHistory]);

  const resolveAndSaveAlias = useCallback(async (row: QueueRow, staff: StaffOption) => {
    if (!row.entered_by_raw) return;
    try {
      await supabase.rpc('resolve_base44_entered_by_alias_v1', {
        p_raw_name: row.entered_by_raw,
        p_staff_id: staff.id,
      });
    } catch {
      // حفظ اختيار الفاتورة نفسها لا يعتمد على نجاح alias العام.
    }
  }, []);

  const persistManualStaffAssignment = useCallback(async (row: QueueRow, staff: StaffOption) => {
    setActingRowId(row.id);
    try {
      const { error } = await supabase.rpc('assign_base44_invoice_entered_by_v1', {
        p_sync_id: row.id,
        p_staff_id: staff.id,
      });
      if (error) throw error;
      setQueue((prev) => prev.map((q) => q.id === row.id ? {
        ...q,
        entered_by_staff_id: staff.id,
        entered_by_staff_name: staff.name,
        match_status: 'matched',
      } : q));
      setPickedStaffByRow((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setDetailsRow((prev) => prev?.id === row.id ? {
        ...prev,
        entered_by_staff_id: staff.id,
        entered_by_staff_name: staff.name,
        match_status: 'matched',
      } : prev);
      setResolvingId(null);
      setResolveSearch('');
      setResolveOptions([]);
      if (row.entered_by_raw && row.match_status === 'unmatched') void resolveAndSaveAlias(row, staff);
      toast.success(`اتحفظ إن ${staff.name} هو مدخل الفاتورة`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذّر حفظ مدخل الفاتورة');
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
      const { error } = await supabase.rpc('log_purchase_invoice_entry_review_v1', {
        p_staff_id: selectedStaff.id,
        p_outcome: outcome,
        p_branch: selectedStaff.branch,
        p_invoice_reference: invoiceReference.trim() || null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success('اتسجل');
      setSelectedStaff(null);
      setSearch('');
      setInvoiceReference('');
      setNotes('');
      setOutcome('correct');
      await loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
    } finally {
      setSubmitting(false);
    }
  }, [selectedStaff, outcome, invoiceReference, notes, loadHistory]);

  const employeeOptions = useMemo(() => {
    const values = new Set<string>();
    queue.forEach((row) => {
      const name = row.entered_by_staff_name || pickedStaffByRow[row.id]?.name || row.entered_by_raw;
      if (name) values.add(name);
    });
    history.forEach((row) => row.staff_name && values.add(row.staff_name));
    report.staff.forEach((row) => row.staff_name && values.add(row.staff_name));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [history, pickedStaffByRow, queue, report.staff]);

  const reviewerOptions = useMemo(
    () => Array.from(new Set(history.map((row) => row.reviewed_by_name).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b, 'ar')),
    [history]
  );

  const branchOptions = useMemo(() => {
    const values = new Set<string>();
    queue.forEach((row) => row.branch && values.add(row.branch));
    history.forEach((row) => row.branch && values.add(row.branch));
    report.branches.forEach((row) => row.branch && values.add(row.branch));
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [history, queue, report.branches]);

  const recordQuery = normalizeSearch(recordSearch);

  const filteredQueue = useMemo(() => queue.filter((row) => {
    const rowEmployee = row.entered_by_staff_name || pickedStaffByRow[row.id]?.name || row.entered_by_raw || '';
    if (fromDate && (!row.invoice_date || row.invoice_date < fromDate)) return false;
    if (toDate && (!row.invoice_date || row.invoice_date > toDate)) return false;
    if (employeeFilter && rowEmployee !== employeeFilter) return false;
    if (branchFilter && row.branch !== branchFilter) return false;
    if (recordQuery) {
      const haystack = [row.system_invoice_number, row.base44_id, row.entered_by_staff_name, row.entered_by_raw, row.branch]
        .map(normalizeSearch)
        .join(' ');
      if (!haystack.includes(recordQuery)) return false;
    }
    return true;
  }), [branchFilter, employeeFilter, fromDate, pickedStaffByRow, queue, recordQuery, toDate]);

  const filteredHistory = useMemo(() => history.filter((row) => {
    if (fromDate && row.review_date < fromDate) return false;
    if (toDate && row.review_date > toDate) return false;
    if (employeeFilter && row.staff_name !== employeeFilter) return false;
    if (reviewerFilter && row.reviewed_by_name !== reviewerFilter) return false;
    if (branchFilter && row.branch !== branchFilter) return false;
    if (recordQuery) {
      const haystack = [row.invoice_reference, row.staff_name, row.reviewed_by_name, row.notes, row.branch]
        .map(normalizeSearch)
        .join(' ');
      if (!haystack.includes(recordQuery)) return false;
    }
    return true;
  }), [branchFilter, employeeFilter, fromDate, history, recordQuery, reviewerFilter, toDate]);

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setEmployeeFilter('');
    setReviewerFilter('');
    setBranchFilter('');
  };

  const hasFilters = Boolean(fromDate || toDate || employeeFilter || reviewerFilter || branchFilter);

  const topRiskStaff = useMemo(
    () => [...report.staff].sort((a, b) => (b.negligence_count + b.customer_problem_count) - (a.negligence_count + a.customer_problem_count) || a.accuracy_rate - b.accuracy_rate)[0] || null,
    [report.staff]
  );

  const worstBranch = useMemo(
    () => [...report.branches].sort((a, b) => a.accuracy_rate - b.accuracy_rate || b.pending_count - a.pending_count)[0] || null,
    [report.branches]
  );

  const latestDaily = report.daily.length ? report.daily[report.daily.length - 1] : null;

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
          ['history', `آخر المراجعات (${history.length})`],
          ['reports', 'التقارير الذكية'],
        ] as Array<[PageTab, string]>).map(([key, label]) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className="rounded-xl px-3 py-2 text-xs font-black transition sm:text-sm"
              style={{ background: active ? 'var(--dawaa-theme-primary)' : 'transparent', color: active ? 'white' : 'var(--dawaa-theme-text)' }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab !== 'manual' ? (
        <Panel className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}><Filter size={16} /> الفلاتر</div>
            {hasFilters ? (
              <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}><X size={14} /> مسح الفلاتر</button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}><span>من تاريخ</span><input type="date" className="input-dark w-full text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
            <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}><span>إلى تاريخ</span><input type="date" className="input-dark w-full text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
            <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
              <span>الموظف</span>
              <select className="input-dark w-full text-sm" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                <option value="">كل الموظفين</option>
                {employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {activeTab === 'history' || activeTab === 'reports' ? (
              <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
                <span>المراجع</span>
                <select className="input-dark w-full text-sm" value={reviewerFilter} onChange={(e) => setReviewerFilter(e.target.value)}>
                  <option value="">كل المراجعين</option>
                  {reviewerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            ) : <div className="hidden lg:block" />}
            <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
              <span>الفرع</span>
              <select className="input-dark w-full text-sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="">كل الفروع</option>
                {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </label>
          </div>

          {activeTab === 'invoices' || activeTab === 'history' ? (
            <div className="relative mt-3">
              <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} />
              <input
                type="search"
                className="input-dark w-full pr-9 text-sm"
                placeholder="ابحث باسم الموظف أو رقم الفاتورة أو Base44 ID..."
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
              />
              {recordSearch ? (
                <button type="button" onClick={() => setRecordSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} aria-label="مسح البحث"><X size={15} /></button>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {activeTab === 'invoices' ? (
        <Panel className="p-4">
          <SectionTitle title={`فواتير Base44 محتاجة تصنيف (${filteredQueue.length})`} subtitle="متسحبة تلقائي من الدورة الحالية" icon={<Link2 size={18} />} />
          {loadingQueue ? <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
          : queueError ? <EmptyState label="تعذّر تحميل قائمة Base44" error onRetry={() => void loadQueue()} />
          : filteredQueue.length === 0 ? <EmptyState label={queue.length === 0 ? 'مفيش فواتير محتاجة تصنيف دلوقتي' : 'مفيش فواتير مطابقة للبحث والفلاتر الحالية'} />
          : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filteredQueue.map((row) => {
                const resolvedStaff = row.entered_by_staff_id ? { id: row.entered_by_staff_id, name: row.entered_by_staff_name || '', branch: row.branch } : pickedStaffByRow[row.id] || null;
                return (
                  <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.system_invoice_number ? `فاتورة ${row.system_invoice_number}` : row.base44_id}</p>
                        <button type="button" onClick={() => setDetailsRow(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition hover:bg-[var(--dawaa-theme-soft)]" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary)' }} title="عرض تفاصيل الفاتورة" aria-label="عرض تفاصيل الفاتورة"><Eye size={16} /></button>
                      </div>
                      <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{row.branch} — {row.invoice_date} — {TRANSACTION_TYPE_LABEL[row.transaction_type || ''] || row.transaction_type}</span>
                    </div>
                    <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{row.total_value != null ? `${row.total_value} جنيه` : ''}</p>
                    {resolvedStaff ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-text)' }}>دخلها: {resolvedStaff.name}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {OUTCOME_ORDER.map((key) => {
                            const cfg = OUTCOME_CONFIG[key];
                            return <button key={key} type="button" disabled={actingRowId === row.id} onClick={() => void classifyQueueRow(row, resolvedStaff.id, key)} className="rounded-lg border py-2 text-xs font-black" style={{ borderColor: cfg.borderColor, background: cfg.bg, color: cfg.color }}>{cfg.label} ({cfg.points > 0 ? '+' : ''}{cfg.points})</button>;
                          })}
                        </div>
                      </div>
                    ) : resolvingId === row.id ? (
                      <div className="mt-3 space-y-1">
                        <input type="text" className="input-dark w-full text-sm" placeholder="اكتب اسم الموظف اللي دخلها فعلاً..." value={resolveSearch} onChange={(e) => setResolveSearch(e.target.value)} autoFocus />
                        {resolveOptions.length > 0 ? (
                          <div className="space-y-1 rounded-lg border p-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                            {resolveOptions.map((s) => <button key={s.id} type="button" disabled={actingRowId === row.id} onClick={() => void persistManualStaffAssignment(row, s)} className="flex w-full items-center justify-between rounded-md p-2 text-right text-sm hover:bg-[var(--dawaa-theme-soft)] disabled:opacity-60"><span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{s.name}</span><span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{s.branch}</span></button>)}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <button type="button" onClick={() => setResolvingId(row.id)} className="mt-3 flex items-center gap-2 text-sm font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}><AlertTriangle size={14} />{row.entered_by_raw ? `"${row.entered_by_raw}" مش معروف — اختار مين ده` : 'مسجّلش اسم — اختار مين دخلها'}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
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
                <input type="text" className="input-dark w-full pr-8 text-sm" placeholder="اكتب اسم الموظف..." value={search} onChange={(e) => setSearch(e.target.value)} />
                {staffOptions.length > 0 ? <div className="mt-1 space-y-1 rounded-lg border p-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}>{staffOptions.map((s) => <button key={s.id} type="button" onClick={() => { setSelectedStaff(s); setStaffOptions([]); }} className="flex w-full items-center justify-between rounded-md p-2 text-right text-sm hover:bg-[var(--dawaa-theme-soft)]"><span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{s.name}</span><span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{s.branch}</span></button>)}</div> : null}
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
          <div><p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>رقم الفاتورة/الطلبية (اختياري)</p><input type="text" className="input-dark w-full text-sm" value={invoiceReference} onChange={(e) => setInvoiceReference(e.target.value)} /></div>
          <div><p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة</p><input type="text" className="input-dark w-full text-sm" placeholder="تفاصيل سريعة..." value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white" style={{ background: 'var(--dawaa-theme-primary)' }}>{submitting ? <Loader2 size={16} className="animate-spin" /> : null}تسجيل</button>
        </Panel>
      ) : null}

      {activeTab === 'history' ? (
        <Panel className="p-4">
          <SectionTitle title={`آخر المراجعات (${filteredHistory.length})`} />
          {loadingHistory ? <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
          : historyError ? <EmptyState label="تعذّر تحميل السجل" error onRetry={() => void loadHistory()} />
          : filteredHistory.length === 0 ? <EmptyState label={history.length === 0 ? 'لسه مفيش مراجعات مسجّلة' : 'مفيش مراجعات مطابقة للبحث والفلاتر الحالية'} />
          : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {filteredHistory.map((h) => {
                const cfg = OUTCOME_CONFIG[h.outcome];
                return <div key={h.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}><div className="flex items-center justify-between gap-2"><p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{h.staff_name}</p><span className="rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: cfg.borderColor, background: cfg.bg, color: cfg.color }}>{cfg.label} ({h.points > 0 ? '+' : ''}{h.points})</span></div><p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{h.review_date} {h.branch ? `— ${h.branch}` : ''} {h.invoice_reference ? `— فاتورة ${h.invoice_reference}` : ''}</p>{h.reviewed_by_name ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>المراجع: {h.reviewed_by_name}</p> : null}{h.notes ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{h.notes}</p> : null}</div>;
              })}
            </div>
          )}
        </Panel>
      ) : null}

      {activeTab === 'reports' ? (
        <div className="space-y-4">
          {loadingReport ? <Panel className="flex justify-center p-10"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-primary)' }} /></Panel>
          : reportError ? <Panel className="p-4"><EmptyState label="تعذّر تحميل التقارير الذكية" error onRetry={() => void loadReport()} /></Panel>
          : (
            <>
              <Panel className="p-4">
                <SectionTitle title="ملخص الرقابة على دقة الإدخال" subtitle="الأرقام محسوبة من قاعدة البيانات على كل السجلات المطابقة للفلاتر" icon={<BarChart3 size={18} />} />
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {[
                    ['تمت مراجعتها', report.summary.reviewed_count],
                    ['معلقة للمراجعة', report.summary.pending_count],
                    ['نسبة الدقة', `${report.summary.accuracy_rate}%`],
                    ['إجمالي النقاط', report.summary.total_points],
                    ['إدخال صحيح', report.summary.correct_count],
                    ['لخبطة/عدم تسجيل', report.summary.mixup_count],
                    ['إهمال', report.summary.negligence_count],
                    ['مشكلة مع عميل', report.summary.customer_problem_count],
                  ].map(([label, value]) => <div key={label} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}><p className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{label}</p><p className="mt-1 text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{value}</p></div>)}
                </div>
              </Panel>

              <Panel className="p-4">
                <SectionTitle title="تنبيهات الإدارة" subtitle="لفت نظر سريع لأهم نقاط الخطر الحالية" icon={<AlertTriangle size={18} />} />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)' }}><p className="text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>فواتير بدون موظف مؤكد</p><p className="mt-1 text-2xl font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>{report.summary.unknown_staff_count}</p></div>
                  <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}><p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>أعلى موظف يحتاج مراجعة</p><p className="mt-1 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{topRiskStaff ? `${topRiskStaff.staff_name} — ${topRiskStaff.accuracy_rate}%` : 'لا توجد بيانات كافية'}</p></div>
                  <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}><p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>الفرع الأقل دقة</p><p className="mt-1 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{worstBranch ? `${worstBranch.branch} — ${worstBranch.accuracy_rate}%` : 'لا توجد بيانات كافية'}</p></div>
                </div>
              </Panel>

              <Panel className="p-4">
                <SectionTitle title={`أداء الموظفين (${report.staff.length})`} subtitle="ترتيب حسب الدقة وعدد المراجعات" icon={<Users size={18} />} />
                {report.staff.length === 0 ? <EmptyState label="لا توجد مراجعات موظفين مطابقة للفلاتر" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-right text-xs">
                      <thead><tr style={{ color: 'var(--dawaa-theme-muted)' }}><th className="p-2">الموظف</th><th className="p-2">الفرع</th><th className="p-2">مراجعات</th><th className="p-2">صحيح</th><th className="p-2">لخبطة</th><th className="p-2">إهمال</th><th className="p-2">مشكلة عميل</th><th className="p-2">الدقة</th><th className="p-2">النقاط</th><th className="p-2">الحالة</th></tr></thead>
                      <tbody>{report.staff.map((row) => { const status = getStaffStatus(row); return <tr key={row.staff_id} className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}><td className="p-2 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.staff_name}</td><td className="p-2">{row.branch || '—'}</td><td className="p-2">{row.reviewed_count}</td><td className="p-2">{row.correct_count}</td><td className="p-2">{row.mixup_count}</td><td className="p-2">{row.negligence_count}</td><td className="p-2">{row.customer_problem_count}</td><td className="p-2 font-black">{row.accuracy_rate}%</td><td className="p-2 font-black">{row.total_points}</td><td className="p-2"><span className="rounded-full px-2 py-1 font-black" style={{ color: status.color, background: status.bg }}>{status.label}</span></td></tr>; })}</tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel className="p-4">
                <SectionTitle title="مقارنة الفروع" subtitle="دقة الإدخال والمراجعات المعلقة لكل فرع" icon={<BarChart3 size={18} />} />
                {report.branches.length === 0 ? <EmptyState label="لا توجد بيانات فروع مطابقة للفلاتر" /> : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{report.branches.map((row) => <div key={row.branch} className="rounded-xl border p-4" style={{ borderColor: 'var(--dawaa-theme-border)' }}><div className="flex items-center justify-between"><h3 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.branch}</h3><span className="text-lg font-black" style={{ color: 'var(--dawaa-theme-primary)' }}>{row.accuracy_rate}%</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>مراجعات</p><p className="font-black">{row.reviewed_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>معلق</p><p className="font-black">{row.pending_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>النقاط</p><p className="font-black">{row.total_points}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>صحيح</p><p className="font-black">{row.correct_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>إهمال</p><p className="font-black">{row.negligence_count}</p></div><div><p style={{ color: 'var(--dawaa-theme-muted)' }}>مشاكل عملاء</p><p className="font-black">{row.customer_problem_count}</p></div></div></div>)}</div>}
              </Panel>

              <Panel className="p-4">
                <SectionTitle title="الاتجاه اليومي" subtitle={latestDaily ? `آخر يوم مسجل: ${latestDaily.report_date} — الدقة ${latestDaily.accuracy_rate}%` : 'متابعة تحسن أو تراجع جودة الإدخال يومًا بيوم'} icon={<TrendingUp size={18} />} />
                {report.daily.length === 0 ? <EmptyState label="لا توجد بيانات يومية للفترة المختارة" /> : <div className="space-y-2">{report.daily.slice(-14).map((row) => <div key={row.report_date} className="grid grid-cols-4 gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--dawaa-theme-border)' }}><span className="font-black">{row.report_date}</span><span>مراجعات: <b>{row.reviewed_count}</b></span><span>صحيح: <b>{row.correct_count}</b></span><span>الدقة: <b>{row.accuracy_rate}%</b></span></div>)}</div>}
              </Panel>
            </>
          )}
        </div>
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
