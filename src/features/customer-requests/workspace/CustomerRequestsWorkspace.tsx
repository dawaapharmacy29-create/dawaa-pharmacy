import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Filter, ListTree, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { useAuth, userHasPermission } from '@/hooks/useAuth';
import { canSeeAllBranches, getUserBranch } from '@/lib/core/branchScope';
import { customerRequestBranchKey } from '../domain/branch';
import { exportCustomerRequestItemNames, exportCustomerRequestsWorkspace, getCustomerRequestProductMetrics } from '../data';
import { useCustomerRequestsWorkspace, type CustomerRequestsWorkspaceFilters } from '../hooks';
import CustomerRequestQueueStrip from './CustomerRequestQueueStrip';
import CustomerRequestsOperationsTable, { type CustomerRequestProductMetric } from './CustomerRequestsOperationsTable';
import CanonicalCreateRequestDialog from './CanonicalCreateRequestDialog';
import CustomerRequestDetailsDrawer from './CustomerRequestDetailsDrawer';

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
  const [exportingItems, setExportingItems] = useState(false);
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
    () => Array.from(
      new Set(workspace.rows.map((row) => String(row.product_code || '').trim()).filter(Boolean))
    ).sort(),
    [workspace.rows]
  );
  const visibleProductCodesKey = visibleProductCodes.join('|');
  const visibleProductStateKey = useMemo(
    () => workspace.rows
      .map((row) => `${row.id}:${row.status || 'new'}:${row.product_code || ''}`)
      .sort()
      .join('|'),
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
    workspace.updateFilters({ quickFilter: 'today', status: 'all', requestId: request.id });
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

  const exportItemNames = async () => {
    if (exportingItems) return;
    setExportingItems(true);
    try {
      const result = await exportCustomerRequestItemNames(workspace.filters);
      toast.success(`تم تصدير ${result.rows.toLocaleString('ar-EG')} صنف من ${result.requestsCovered.toLocaleString('ar-EG')} طلب بنفس الفلاتر الحالية`);
    } catch (error) {
      toast.error(`تعذر تصدير أسماء الأصناف: ${(error as Error).message}`);
    } finally {
      setExportingItems(false);
    }
  };

  const clearEntityFilters = {
    requestId: '', customerId: '', customerCode: '', customerPhone: '', productCode: '', medicineName: '', registrar: '', registrarId: '',
  } as const;

  const resetAdvancedFilters = () => workspace.updateFilters({
    status: 'all', urgency: 'all', assignee: 'all', dateFrom: '', dateTo: '', sourceSystem: 'all', sourceChannel: 'all',
  });

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
      <header className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-sm md:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-black text-[var(--dawaa-theme-heading)]">طلبات العملاء</h1><span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-success-text)]">Operations Workspace</span>{!canManageRequests ? <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">عرض فقط</span> : null}{!canAccessAllBranches && scopedBranchKey ? <span className="rounded-full border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-theme-muted)]">نطاق الفرع فقط</span> : null}</div>
            <p className="mt-1 text-xs font-bold leading-6 text-[var(--dawaa-theme-heading)]">
              مفتوحة: <span className="text-[var(--dawaa-theme-primary)]">{Number(workspace.summary.open || 0).toLocaleString('ar-EG')}</span>
              <span className="mx-1.5 text-[var(--dawaa-theme-muted)]">·</span>
              التوفير: <span className="text-[var(--dawaa-theme-primary)]">{Number(workspace.summary.fulfillment_rate || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%</span>
              <span className="mx-1.5 text-[var(--dawaa-theme-muted)]">·</span>
              تم التسليم: <span className="text-[var(--dawaa-theme-primary)]">{Number(workspace.summary.delivered || 0).toLocaleString('ar-EG')}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManageRequests ? <button type="button" className="btn-primary flex items-center gap-2 !py-1.5 text-xs" onClick={() => setCreateOpen(true)}><Plus size={14} /> تسجيل طلب</button> : null}
            <button type="button" className="btn-secondary flex items-center gap-2 !py-1.5 text-xs" onClick={() => void workspace.refresh()} disabled={workspace.loading}><RefreshCw size={14} className={workspace.loading ? 'animate-spin' : ''} /> تحديث</button>
            <button type="button" className="btn-secondary flex items-center gap-2 !py-1.5 text-xs" onClick={() => void exportFiltered()} disabled={exporting || workspace.count === 0}><Download size={14} /> {exporting ? 'جاري التصدير...' : 'تصدير Excel'}</button>
            <button type="button" className="btn-secondary flex items-center gap-2 !py-1.5 text-xs" onClick={() => void exportItemNames()} disabled={exportingItems || workspace.count === 0}><ListTree size={14} /> {exportingItems ? 'جاري التصدير...' : 'تصدير أسماء الأصناف'}</button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_190px_170px_auto]"><input className="input-dark !py-1.5 text-sm" value={workspace.filters.search || ''} onChange={(event) => workspace.updateFilters({ search: event.target.value, ...clearEntityFilters })} placeholder="بحث بالعميل، كود العميل، الهاتف، اسم الصنف أو كود الصنف" /><select className="input-dark !py-1.5 text-sm" value={selectedBranchValue} disabled={!canAccessAllBranches} onChange={(event) => workspace.updateFilters({ branch: event.target.value })}>{canAccessAllBranches ? <option value="all">كل الفروع</option> : null}{canAccessAllBranches || scopedBranchKey === 'shokry' ? <option value="shokry">دواء شكري</option> : null}{canAccessAllBranches || scopedBranchKey === 'elshamy' ? <option value="elshamy">دواء الشامي</option> : null}</select><select className="input-dark !py-1.5 text-sm" value={workspace.pageSize} onChange={(event) => workspace.setPageSize(Number(event.target.value))}><option value={20}>20 طلب / صفحة</option><option value={30}>30 طلب / صفحة</option><option value={50}>50 طلب / صفحة</option></select><button type="button" className="btn-secondary flex items-center justify-center gap-2 !py-1.5 text-xs" onClick={() => setShowAdvancedFilters((value) => !value)}><Filter size={14} /> فلاتر</button></div>

        {showAdvancedFilters ? <div className="mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-2.5"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4"><select className="input-dark !py-1.5 text-sm" value={workspace.filters.status || 'all'} onChange={(event) => workspace.updateFilters({ status: event.target.value, quickFilter: 'all' })}><option value="all">كل الحالات</option><option value="new">تسجيل الطلب</option><option value="purchasing_review">استلام المشتريات</option><option value="searching_suppliers">البحث والتوفير</option><option value="needs_customer_confirmation">يحتاج تأكيد العميل</option><option value="customer_confirmed">تم تأكيد العميل</option><option value="sourcing">جاري التوفير</option><option value="available">تم التوفير</option><option value="arrived">وصل للصيدلية</option><option value="customer_contacted">تم التواصل</option><option value="delivered">تم التسليم</option><option value="not_available">غير متوفر</option><option value="cancelled">ملغي</option></select><select className="input-dark !py-1.5 text-sm" value={workspace.filters.urgency || 'all'} onChange={(event) => workspace.updateFilters({ urgency: event.target.value })}><option value="all">كل الأولويات</option><option value="urgent">عاجل</option><option value="high">مهم</option><option value="normal">عادي</option></select><input className="input-dark !py-1.5 text-sm" value={workspace.filters.assignee === 'all' ? '' : workspace.filters.assignee || ''} onChange={(event) => workspace.updateFilters({ assignee: event.target.value.trim() ? event.target.value : 'all' })} placeholder="المسئول الحالي" /><select className="input-dark !py-1.5 text-sm" value={workspace.filters.sourceChannel || 'all'} onChange={(event) => workspace.updateFilters({ sourceChannel: event.target.value })}><option value="all">كل قنوات الطلب</option><option value="داخل الصيدلية">داخل الصيدلية</option><option value="واتساب">واتساب</option><option value="مكالمة هاتفية">مكالمة هاتفية</option></select><label className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">من تاريخ<input type="date" className="input-dark !py-1.5 text-sm mt-1" value={workspace.filters.dateFrom || ''} onChange={(event) => workspace.updateFilters({ dateFrom: event.target.value })} /></label><label className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">إلى تاريخ<input type="date" className="input-dark !py-1.5 text-sm mt-1" value={workspace.filters.dateTo || ''} onChange={(event) => workspace.updateFilters({ dateTo: event.target.value })} /></label><select className="input-dark !py-1.5 text-sm self-end" value={workspace.filters.sourceSystem || 'all'} onChange={(event) => workspace.updateFilters({ sourceSystem: event.target.value })}><option value="all">كل مصادر البيانات</option><option value="manual">تسجيل التطبيق</option><option value="dawaawael">DawaaWael / Base44</option></select><button type="button" className="btn-secondary self-end flex items-center justify-center gap-2 !py-1.5 text-xs" onClick={resetAdvancedFilters}><RotateCcw size={13} /> مسح الفلاتر المتقدمة</button></div></div> : null}
      </header>

      {workspace.summaryError ? <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-warning-text)]">تعذر تحميل المؤشرات فقط، لكن قائمة التنفيذ مستقلة وما زالت تعمل: {workspace.summaryError}</div> : null}

      <CustomerRequestQueueStrip summary={workspace.summary} activeFilter={workspace.filters.quickFilter} onSelect={(quickFilter) => workspace.updateFilters({ quickFilter, status: 'all', ...clearEntityFilters })} />

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-2.5 shadow-sm md:p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-theme-heading)]"><BarChart3 size={15} className="text-[var(--dawaa-theme-primary)]" /> قائمة التنفيذ</div><div className="mt-0.5 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{workspace.count.toLocaleString('ar-EG')} طلب مطابق</div></div>{workspace.listLoading ? <span className="text-xs font-bold text-[var(--dawaa-theme-primary)]">جاري تحديث القائمة...</span> : null}</div>
        {workspace.listError ? <div className="mb-2 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل القائمة: {workspace.listError}</div> : null}
        <CustomerRequestsOperationsTable rows={workspace.rows} selectedId={workspace.selectedRequestId} onSelect={selectRequest} productMetrics={productMetrics} />
        <div className="mt-2 flex items-center justify-between gap-3 text-xs font-bold text-[var(--dawaa-theme-muted)]"><span>صفحة {workspace.page} من {workspace.pages}</span><div className="flex gap-2"><button type="button" className="btn-secondary !py-1 text-xs" disabled={workspace.page <= 1 || workspace.listLoading} onClick={() => workspace.setPage(Math.max(1, workspace.page - 1))}>السابق</button><button type="button" className="btn-secondary !py-1 text-xs" disabled={workspace.page >= workspace.pages || workspace.listLoading} onClick={() => workspace.setPage(Math.min(workspace.pages, workspace.page + 1))}>التالي</button></div></div>
      </section>

      {canManageRequests && createOpen ? <CanonicalCreateRequestDialog onClose={() => setCreateOpen(false)} onCreated={onCreated} /> : null}
      {canManageRequests && workspace.selectedRequest ? <CustomerRequestDetailsDrawer request={workspace.selectedRequest} onClose={() => workspace.selectRequest(null)} onUpdated={onUpdated} /> : null}
    </section>
  );
}
