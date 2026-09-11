import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Download, Filter, LayoutGrid, Plus, RefreshCw, RotateCcw, Table2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { useAuth, userHasPermission } from '@/hooks/useAuth';
import { canSeeAllBranches, getUserBranch } from '@/lib/core/branchScope';
import { customerRequestBranchKey } from '../domain/branch';
import { exportCustomerRequestsWorkspace, getCustomerRequestProductMetrics } from '../data';
import { useCustomerRequestsWorkspace, type CustomerRequestsWorkspaceFilters } from '../hooks';
import CustomerRequestQueueStrip from './CustomerRequestQueueStrip';
import CustomerRequestsOperationsTable, { type CustomerRequestProductMetric } from './CustomerRequestsOperationsTable';
import CustomerRequestProductCards from './CustomerRequestProductCards';
import CanonicalCreateRequestDialog from './CanonicalCreateRequestDialog';
import CustomerRequestDetailsDrawer from './CustomerRequestDetailsDrawer';

type TimePreset = 'today' | 'yesterday' | 'week' | 'cycle' | 'custom' | 'all';
type ViewMode = 'cards' | 'table';

function filtersFromSearchParams(params: URLSearchParams): CustomerRequestsWorkspaceFilters {
  const quick = params.get('quick') || 'attention';
  return {
    search: params.get('search') || '',
    branch: params.get('branch') || 'all',
    status: params.get('status') || 'all',
    urgency: params.get('urgency') || 'all',
    assignee: params.get('assignee') || 'all',
    dateFrom: params.get('dateFrom') || '',
    dateTo: params.get('dateTo') || '',
    sourceSystem: params.get('sourceSystem') || 'all',
    sourceChannel: params.get('sourceChannel') || 'all',
    registrar: params.get('registrar') || '',
    registrarId: params.get('registrarId') || '',
    requestId: params.get('requestId') || '',
    customerId: params.get('customerId') || '',
    customerCode: params.get('customerCode') || '',
    customerPhone: params.get('customerPhone') || '',
    productCode: params.get('productCode') || '',
    medicineName: params.get('medicineName') || '',
    quickFilter: quick as CustomerRequestsWorkspaceFilters['quickFilter'],
  };
}

function cairoTodayDateText() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateText(dateText: string, days: number) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function cycleRange(today: string) {
  const [year, month, day] = today.split('-').map(Number);
  if (day >= 26) {
    const start = `${year}-${String(month).padStart(2, '0')}-26`;
    const next = new Date(Date.UTC(year, month, 25));
    const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-25`;
    return { from: start, to: end };
  }
  const previous = new Date(Date.UTC(year, month - 2, 26));
  return {
    from: `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-26`,
    to: `${year}-${String(month).padStart(2, '0')}-25`,
  };
}

function presetRange(preset: Exclude<TimePreset, 'custom' | 'all'>) {
  const today = cairoTodayDateText();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const yesterday = shiftDateText(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === 'week') return { from: shiftDateText(today, -6), to: today };
  return cycleRange(today);
}

export default function CustomerRequestsWorkspace() {
  const { user } = useAuth();
  const canManageRequests = userHasPermission(user, 'manage_customer_requests');
  const canAccessAllBranches = canSeeAllBranches(user?.role);
  const scopedBranchKey = customerRequestBranchKey(getUserBranch(user));
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialFilters] = useState<CustomerRequestsWorkspaceFilters>(() => filtersFromSearchParams(searchParams));
  const workspace = useCustomerRequestsWorkspace({ initialFilters });
  const [createOpen, setCreateOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [timePreset, setTimePreset] = useState<TimePreset>(() => initialFilters.dateFrom || initialFilters.dateTo ? 'custom' : 'all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(() => Boolean(
    initialFilters.status !== 'all' ||
    initialFilters.urgency !== 'all' ||
    initialFilters.assignee !== 'all' ||
    initialFilters.dateFrom ||
    initialFilters.dateTo ||
    initialFilters.sourceSystem !== 'all' ||
    initialFilters.sourceChannel !== 'all'
  ));
  const [productMetrics, setProductMetrics] = useState<Record<string, CustomerRequestProductMetric>>({});

  useEffect(() => {
    if (canAccessAllBranches || !scopedBranchKey) return;
    if (workspace.filters.branch !== scopedBranchKey) workspace.updateFilters({ branch: scopedBranchKey });
  }, [canAccessAllBranches, scopedBranchKey, workspace.filters.branch, workspace.updateFilters]);

  useEffect(() => {
    const next = new URLSearchParams();
    const filters = workspace.filters;
    if (filters.search) next.set('search', filters.search);
    if (filters.branch && filters.branch !== 'all') next.set('branch', filters.branch);
    if (filters.status && filters.status !== 'all') next.set('status', filters.status);
    if (filters.urgency && filters.urgency !== 'all') next.set('urgency', filters.urgency);
    if (filters.assignee && filters.assignee !== 'all') next.set('assignee', filters.assignee);
    if (filters.dateFrom) next.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) next.set('dateTo', filters.dateTo);
    if (filters.sourceSystem && filters.sourceSystem !== 'all') next.set('sourceSystem', filters.sourceSystem);
    if (filters.sourceChannel && filters.sourceChannel !== 'all') next.set('sourceChannel', filters.sourceChannel);
    if (filters.registrar) next.set('registrar', filters.registrar);
    if (filters.registrarId) next.set('registrarId', filters.registrarId);
    if (filters.requestId) next.set('requestId', filters.requestId);
    if (filters.customerId) next.set('customerId', filters.customerId);
    if (filters.customerCode) next.set('customerCode', filters.customerCode);
    if (filters.customerPhone) next.set('customerPhone', filters.customerPhone);
    if (filters.productCode) next.set('productCode', filters.productCode);
    if (filters.medicineName) next.set('medicineName', filters.medicineName);
    if (filters.quickFilter && filters.quickFilter !== 'attention') next.set('quick', filters.quickFilter);
    setSearchParams(next, { replace: true });
  }, [setSearchParams, workspace.filters]);

  useEffect(() => {
    if (!canManageRequests || !initialFilters.requestId || workspace.selectedRequestId) return;
    workspace.selectRequest(initialFilters.requestId);
  }, [canManageRequests, initialFilters.requestId, workspace.selectedRequestId, workspace.selectRequest]);

  useEffect(() => {
    if (!canManageRequests && createOpen) setCreateOpen(false);
    if (!canManageRequests && workspace.selectedRequestId) workspace.selectRequest(null);
  }, [canManageRequests, createOpen, workspace.selectedRequestId, workspace.selectRequest]);

  const visibleProductCodes = useMemo(
    () => Array.from(new Set(workspace.rows.map((row) => String(row.product_code || '').trim()).filter(Boolean))).sort(),
    [workspace.rows]
  );
  const visibleProductCodesKey = visibleProductCodes.join('|');
  const visibleProductStateKey = useMemo(
    () => workspace.rows.map((row) => `${row.id}:${row.status || 'new'}:${row.product_code || ''}`).sort().join('|'),
    [workspace.rows]
  );

  useEffect(() => {
    let cancelled = false;
    if (!visibleProductCodes.length) {
      setProductMetrics({});
      return () => { cancelled = true; };
    }

    void getCustomerRequestProductMetrics(visibleProductCodes, workspace.filters.branch || 'all', 90)
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, CustomerRequestProductMetric> = {};
        for (const product of rows) {
          if (!product.product_code) continue;
          next[product.product_code] = {
            requestsCount: product.requests_count,
            fulfilledCount: product.fulfilled_count,
            fulfillmentRate: product.fulfillment_rate,
          };
        }
        setProductMetrics(next);
      })
      .catch(() => { if (!cancelled) setProductMetrics({}); });

    return () => { cancelled = true; };
  }, [visibleProductCodesKey, visibleProductStateKey, workspace.filters.branch]);

  const onCreated = async (request: CustomerRequest) => {
    workspace.updateSelectedRequest(request);
    workspace.updateFilters({ quickFilter: 'all', status: 'all', requestId: request.id, dateFrom: cairoTodayDateText(), dateTo: cairoTodayDateText() });
    setTimePreset('today');
    await workspace.refresh();
  };

  const onUpdated = async (request: CustomerRequest) => {
    workspace.updateSelectedRequest(request);
    await workspace.refresh();
  };

  const exportFiltered = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportCustomerRequestsWorkspace(workspace.filters);
      if (result.truncated) toast.warning(`تم تصدير أول ${result.rows.length.toLocaleString('ar-EG')} طلب من أصل ${result.total.toLocaleString('ar-EG')} لحماية الأداء`);
      else toast.success(`تم تصدير ${result.rows.length.toLocaleString('ar-EG')} طلب بنفس الفلاتر الحالية`);
    } catch (error) {
      toast.error(`تعذر تصدير طلبات العملاء: ${(error as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const clearEntityFilters = {
    requestId: '', customerId: '', customerCode: '', customerPhone: '', productCode: '', medicineName: '', registrar: '', registrarId: '',
  } as const;

  const resetAdvancedFilters = () => {
    setTimePreset('all');
    workspace.updateFilters({
      status: 'all', urgency: 'all', assignee: 'all', dateFrom: '', dateTo: '', sourceSystem: 'all', sourceChannel: 'all',
    });
  };

  const applyTimePreset = (preset: TimePreset) => {
    setTimePreset(preset);
    if (preset === 'custom') {
      setShowAdvancedFilters(true);
      workspace.updateFilters({ quickFilter: 'all', ...clearEntityFilters });
      return;
    }
    if (preset === 'all') {
      workspace.updateFilters({ quickFilter: 'all', dateFrom: '', dateTo: '', ...clearEntityFilters });
      return;
    }
    const range = presetRange(preset);
    workspace.updateFilters({ quickFilter: 'all', dateFrom: range.from, dateTo: range.to, ...clearEntityFilters });
  };

  const selectRequest = (request: CustomerRequest) => {
    if (!canManageRequests) {
      toast.info('الحساب الحالي للعرض فقط ولا يملك صلاحية تنفيذ أو تعديل طلبات العملاء.');
      return;
    }
    workspace.selectRequest(request.id);
  };

  const selectedBranchValue = canAccessAllBranches ? workspace.filters.branch || 'all' : scopedBranchKey || workspace.filters.branch || 'all';

  return (
    <section className="space-y-3" dir="rtl">
      <header className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-sm md:p-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">طلبات العملاء</h1>
              {!canManageRequests ? <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-0.5 text-[9px] font-black text-[var(--dawaa-status-warning-text)]">عرض فقط</span> : null}
              {!canAccessAllBranches && scopedBranchKey ? <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-[9px] font-black text-[var(--dawaa-theme-muted)]">نطاق الفرع</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-black">
              <MetricChip label="مفتوح" value={Number(workspace.summary.open || 0).toLocaleString('ar-EG')} />
              <MetricChip label="تم التسليم" value={Number(workspace.summary.delivered || 0).toLocaleString('ar-EG')} />
              <MetricChip label="نسبة التوفير" value={`${Number(workspace.summary.fulfillment_rate || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%`} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {canManageRequests ? <button type="button" className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs" onClick={() => setCreateOpen(true)}><Plus size={15} /> تسجيل طلب</button> : null}
            <button type="button" className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs" onClick={() => void workspace.refresh()} disabled={workspace.loading}><RefreshCw size={15} className={workspace.loading ? 'animate-spin' : ''} /> تحديث</button>
            <button type="button" className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs" onClick={() => void exportFiltered()} disabled={exporting || workspace.count === 0}><Download size={15} /> {exporting ? 'جاري التصدير...' : 'Excel'}</button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1.5">
          <span className="ml-1 flex items-center gap-1 text-[10px] font-black text-[var(--dawaa-theme-muted)]"><CalendarDays size={13} /> الفترة</span>
          <TimePresetButton active={timePreset === 'today'} onClick={() => applyTimePreset('today')}>اليوم</TimePresetButton>
          <TimePresetButton active={timePreset === 'yesterday'} onClick={() => applyTimePreset('yesterday')}>أمس</TimePresetButton>
          <TimePresetButton active={timePreset === 'week'} onClick={() => applyTimePreset('week')}>آخر 7 أيام</TimePresetButton>
          <TimePresetButton active={timePreset === 'cycle'} onClick={() => applyTimePreset('cycle')}>الدورة 26 → 25</TimePresetButton>
          <TimePresetButton active={timePreset === 'custom'} onClick={() => applyTimePreset('custom')}>تاريخ محدد</TimePresetButton>
          <TimePresetButton active={timePreset === 'all'} onClick={() => applyTimePreset('all')}>الكل</TimePresetButton>
          {(workspace.filters.dateFrom || workspace.filters.dateTo) ? <span className="mr-auto text-[10px] font-black text-[var(--dawaa-theme-primary)]">{workspace.filters.dateFrom || '...'} ← {workspace.filters.dateTo || '...'}</span> : null}
        </div>

        <div className="mt-2.5 grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_190px_auto]">
          <input
            className="input-dark"
            value={workspace.filters.search || ''}
            onChange={(event) => workspace.updateFilters({ search: event.target.value, ...clearEntityFilters })}
            placeholder="بحث باسم العميل، الصنف، كود العميل أو كود الصنف"
          />
          <select className="input-dark" value={selectedBranchValue} disabled={!canAccessAllBranches} onChange={(event) => workspace.updateFilters({ branch: event.target.value })}>
            {canAccessAllBranches ? <option value="all">كل الفروع</option> : null}
            {canAccessAllBranches || scopedBranchKey === 'shokry' ? <option value="shokry">دواء شكري</option> : null}
            {canAccessAllBranches || scopedBranchKey === 'elshamy' ? <option value="elshamy">دواء الشامي</option> : null}
          </select>
          <input className="input-dark" value={workspace.filters.assignee === 'all' ? '' : workspace.filters.assignee || ''} onChange={(event) => workspace.updateFilters({ assignee: event.target.value.trim() ? event.target.value : 'all' })} placeholder="فلتر باسم الموظف" />
          <button type="button" className="btn-secondary flex items-center justify-center gap-1.5 px-3" onClick={() => setShowAdvancedFilters((value) => !value)}>
            <Filter size={14} /> {showAdvancedFilters ? 'إخفاء الفلاتر' : 'فلاتر إضافية'}
          </button>
        </div>

        {showAdvancedFilters ? (
          <div className="mt-2.5 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2.5">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <select className="input-dark" value={workspace.filters.status || 'all'} onChange={(event) => workspace.updateFilters({ status: event.target.value, quickFilter: 'all' })}>
                <option value="all">كل الحالات</option><option value="new">تسجيل الطلب</option><option value="purchasing_review">استلام المشتريات</option><option value="searching_suppliers">البحث والتوفير</option><option value="needs_customer_confirmation">يحتاج تأكيد العميل</option><option value="customer_confirmed">تم تأكيد العميل</option><option value="sourcing">جاري التوفير</option><option value="available">تم التوفير</option><option value="arrived">وصل للصيدلية</option><option value="customer_contacted">تم التواصل</option><option value="delivered">تم التسليم</option><option value="not_available">غير متوفر</option><option value="cancelled">ملغي</option>
              </select>
              <select className="input-dark" value={workspace.filters.urgency || 'all'} onChange={(event) => workspace.updateFilters({ urgency: event.target.value })}>
                <option value="all">كل الأولويات</option><option value="urgent">عاجل</option><option value="high">مهم</option><option value="normal">عادي</option>
              </select>
              <select className="input-dark" value={workspace.filters.sourceChannel || 'all'} onChange={(event) => workspace.updateFilters({ sourceChannel: event.target.value })}>
                <option value="all">كل قنوات الطلب</option><option value="داخل الصيدلية">داخل الصيدلية</option><option value="واتساب">واتساب</option><option value="مكالمة هاتفية">مكالمة هاتفية</option>
              </select>
              <select className="input-dark" value={workspace.filters.sourceSystem || 'all'} onChange={(event) => workspace.updateFilters({ sourceSystem: event.target.value })}>
                <option value="all">كل مصادر البيانات</option><option value="manual">تسجيل التطبيق</option><option value="dawaawael">DawaaWael / Base44</option>
              </select>
              <label className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">من تاريخ<input type="date" className="input-dark mt-1" value={workspace.filters.dateFrom || ''} onChange={(event) => { setTimePreset('custom'); workspace.updateFilters({ dateFrom: event.target.value, quickFilter: 'all' }); }} /></label>
              <label className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">إلى تاريخ<input type="date" className="input-dark mt-1" value={workspace.filters.dateTo || ''} onChange={(event) => { setTimePreset('custom'); workspace.updateFilters({ dateTo: event.target.value, quickFilter: 'all' }); }} /></label>
              <select className="input-dark self-end" value={workspace.pageSize} onChange={(event) => workspace.setPageSize(Number(event.target.value))}>
                <option value={20}>20 طلب / صفحة</option><option value={30}>30 طلب / صفحة</option><option value={50}>50 طلب / صفحة</option>
              </select>
            </div>
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn-secondary flex items-center justify-center gap-1.5 px-3 py-2 text-xs" onClick={resetAdvancedFilters}><RotateCcw size={13} /> مسح الفلاتر</button>
            </div>
          </div>
        ) : null}
      </header>

      {workspace.summaryError ? <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-warning-text)]">تعذر تحميل المؤشرات فقط، لكن قائمة التنفيذ ما زالت تعمل: {workspace.summaryError}</div> : null}

      <CustomerRequestQueueStrip summary={workspace.summary} activeFilter={workspace.filters.quickFilter} onSelect={(quickFilter) => { setTimePreset('all'); workspace.updateFilters({ quickFilter, status: 'all', dateFrom: '', dateTo: '', ...clearEntityFilters }); }} />

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-2.5 shadow-sm md:p-3">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]"><BarChart3 size={15} className="text-[var(--dawaa-theme-primary)]" /> الأصناف المطلوبة <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">({workspace.count.toLocaleString('ar-EG')})</span></div>
            <div className="mt-0.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الترتيب من الأحدث للأقدم داخل الفترة المختارة، واضغط على أي صنف لفتح التفاصيل والتنفيذ.</div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-0.5">
              <button type="button" onClick={() => setViewMode('cards')} className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black ${viewMode === 'cards' ? 'bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-primary)] shadow-sm' : 'text-[var(--dawaa-theme-muted)]'}`}><LayoutGrid size={13} /> كروت</button>
              <button type="button" onClick={() => setViewMode('table')} className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black ${viewMode === 'table' ? 'bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-primary)] shadow-sm' : 'text-[var(--dawaa-theme-muted)]'}`}><Table2 size={13} /> جدول</button>
            </div>
            {workspace.listLoading ? <span className="text-[11px] font-bold text-[var(--dawaa-theme-primary)]">جاري التحديث...</span> : null}
          </div>
        </div>
        {workspace.listError ? <div className="mb-2.5 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل القائمة: {workspace.listError}</div> : null}
        {viewMode === 'cards'
          ? <CustomerRequestProductCards rows={workspace.rows} selectedId={workspace.selectedRequestId} onSelect={selectRequest} productMetrics={productMetrics} />
          : <CustomerRequestsOperationsTable rows={workspace.rows} selectedId={workspace.selectedRequestId} onSelect={selectRequest} productMetrics={productMetrics} />}
        <div className="mt-2.5 flex items-center justify-between gap-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">
          <span>صفحة {workspace.page} من {workspace.pages}</span>
          <div className="flex gap-1.5"><button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={workspace.page <= 1 || workspace.listLoading} onClick={() => workspace.setPage(Math.max(1, workspace.page - 1))}>السابق</button><button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={workspace.page >= workspace.pages || workspace.listLoading} onClick={() => workspace.setPage(Math.min(workspace.pages, workspace.page + 1))}>التالي</button></div>
        </div>
      </section>

      {canManageRequests && createOpen ? <CanonicalCreateRequestDialog onClose={() => setCreateOpen(false)} onCreated={onCreated} /> : null}
      {canManageRequests && workspace.selectedRequest ? <CustomerRequestDetailsDrawer request={workspace.selectedRequest} onClose={() => workspace.selectRequest(null)} onUpdated={onUpdated} /> : null}
    </section>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return <span className="rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] px-2.5 py-1 text-[var(--dawaa-theme-muted)]"><strong className="ml-1 text-[var(--dawaa-theme-heading)]">{value}</strong>{label}</span>;
}

function TimePresetButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black transition ${active ? 'bg-[var(--dawaa-theme-primary)] text-white shadow-sm' : 'text-[var(--dawaa-theme-heading)] hover:bg-[var(--dawaa-theme-surface)]'}`}>{children}</button>;
}
