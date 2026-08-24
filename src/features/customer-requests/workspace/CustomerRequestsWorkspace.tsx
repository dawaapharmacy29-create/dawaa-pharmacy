import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { getCustomerRequestOperationalInsights } from '@/lib/api/customerRequestInsights';
import { useAuth, userHasPermission } from '@/hooks/useAuth';
import { customerRequestSourceBranch } from '../domain/branch';
import { exportCustomerRequestsWorkspace } from '../data';
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
    assignee: params.get('assignee') || 'all',
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialFilters] = useState<CustomerRequestsWorkspaceFilters>(() => filtersFromSearchParams(searchParams));
  const workspace = useCustomerRequestsWorkspace({ initialFilters });
  const [createOpen, setCreateOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [productMetrics, setProductMetrics] = useState<Record<string, CustomerRequestProductMetric>>({});

  useEffect(() => {
    const next = new URLSearchParams();
    const filters = workspace.filters;
    if (filters.search) next.set('search', filters.search);
    if (filters.branch && filters.branch !== 'all') next.set('branch', filters.branch);
    if (filters.status && filters.status !== 'all') next.set('status', filters.status);
    if (filters.assignee && filters.assignee !== 'all') next.set('assignee', filters.assignee);
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
  }, [canManageRequests, initialFilters.requestId, workspace]);

  useEffect(() => {
    if (!canManageRequests && createOpen) setCreateOpen(false);
    if (!canManageRequests && workspace.selectedRequestId) workspace.selectRequest(null);
  }, [canManageRequests, createOpen, workspace]);

  useEffect(() => {
    let cancelled = false;
    const branch = customerRequestSourceBranch(workspace.filters.branch) || 'all';
    void getCustomerRequestOperationalInsights(branch, 90)
      .then((data) => {
        if (cancelled) return;
        const next: Record<string, CustomerRequestProductMetric> = {};
        for (const product of data.top_products || []) {
          if (!product.product_code) continue;
          next[String(product.product_code)] = {
            requestsCount: Number(product.requests_count || 0),
            fulfilledCount: Number(product.fulfilled_count || 0),
            fulfillmentRate: product.fulfillment_rate === null ? null : Number(product.fulfillment_rate || 0),
          };
        }
        setProductMetrics(next);
      })
      .catch(() => { if (!cancelled) setProductMetrics({}); });
    return () => { cancelled = true; };
  }, [workspace.filters.branch]);

  const fulfillmentContext = useMemo(() => {
    const values = Object.values(productMetrics).filter((item) => item.requestsCount > 0 && item.fulfillmentRate !== null);
    if (!values.length) return null;
    const weightedRequests = values.reduce((sum, item) => sum + item.requestsCount, 0);
    const weightedFulfilled = values.reduce((sum, item) => sum + item.fulfilledCount, 0);
    return weightedRequests ? (weightedFulfilled / weightedRequests) * 100 : null;
  }, [productMetrics]);

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

  const clearEntityFilters = {
    requestId: '', customerId: '', customerCode: '', customerPhone: '', productCode: '', medicineName: '', registrar: '', registrarId: '',
  } as const;

  const selectRequest = (request: CustomerRequest) => {
    if (!canManageRequests) {
      toast.info('الحساب الحالي للعرض فقط ولا يملك صلاحية تنفيذ أو تعديل طلبات العملاء.');
      return;
    }
    workspace.selectRequest(request.id);
  };

  return (
    <section className="space-y-4" dir="rtl">
      <header className="rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-lg md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">طلبات العملاء</h1><span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-2.5 py-1 text-[10px] font-black text-[var(--dawaa-status-success-text)]">Operations Workspace</span>{!canManageRequests ? <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2.5 py-1 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">عرض فقط</span> : null}</div>
            <p className="mt-1 max-w-3xl text-sm font-bold leading-7 text-[var(--dawaa-theme-muted)]">العميل والكود والصنف والكود والمرحلة والموعد والدكتور ومعدل التوفير والإجراء التالي في شاشة تنفيذ واحدة مرتبطة بنظام النقاط المركزي.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManageRequests ? <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setCreateOpen(true)}><Plus size={16} /> تسجيل طلب</button> : null}
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void workspace.refresh()} disabled={workspace.loading}><RefreshCw size={16} className={workspace.loading ? 'animate-spin' : ''} /> تحديث</button>
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void exportFiltered()} disabled={exporting || workspace.count === 0}><Download size={16} /> {exporting ? 'جاري التصدير...' : 'تصدير Excel'}</button>
            <Link to="/customer-requests?legacy=1" className="btn-secondary flex items-center gap-2 text-xs"><ShieldCheck size={15} /> النسخة القديمة</Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_190px_170px]"><input className="input-dark" value={workspace.filters.search || ''} onChange={(event) => workspace.updateFilters({ search: event.target.value, ...clearEntityFilters })} placeholder="بحث بالعميل، كود العميل، الهاتف، اسم الصنف أو كود الصنف" /><select className="input-dark" value={workspace.filters.branch || 'all'} onChange={(event) => workspace.updateFilters({ branch: event.target.value })}><option value="all">كل الفروع</option><option value="shokry">دواء شكري</option><option value="elshamy">دواء الشامي</option></select><select className="input-dark" value={workspace.pageSize} onChange={(event) => workspace.setPageSize(Number(event.target.value))}><option value={20}>20 طلب / صفحة</option><option value={30}>30 طلب / صفحة</option><option value={50}>50 طلب / صفحة</option></select></div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">{[['مفتوحة', workspace.summary.open], ['عاجلة', workspace.summary.urgent], ['متأخرة', workspace.summary.overdue], ['جاهزة للتواصل', workspace.summary.ready], ['بدون مسئول', workspace.summary.unassigned], ['تم التسليم', workspace.summary.delivered], ['توفير الأصناف', fulfillmentContext === null ? '—' : `${fulfillmentContext.toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%`]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3"><div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</div></div>)}</div>

      {workspace.summaryError ? <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-warning-text)]">تعذر تحميل المؤشرات فقط، لكن قائمة التنفيذ مستقلة وما زالت تعمل: {workspace.summaryError}</div> : null}

      <CustomerRequestQueueStrip summary={workspace.summary} activeFilter={workspace.filters.quickFilter} onSelect={(quickFilter) => workspace.updateFilters({ quickFilter, ...clearEntityFilters })} />

      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-lg md:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><BarChart3 size={17} className="text-[var(--dawaa-theme-primary)]" /> قائمة التنفيذ</div><div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{workspace.count.toLocaleString('ar-EG')} طلب مطابق · معدل توفير الصنف مبني على آخر 90 يومًا عندما تتوفر عينة للصنف.</div></div>{workspace.listLoading ? <span className="text-xs font-bold text-[var(--dawaa-theme-primary)]">جاري تحديث القائمة...</span> : null}</div>
        {workspace.listError ? <div className="mb-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل القائمة: {workspace.listError}</div> : null}
        <CustomerRequestsOperationsTable rows={workspace.rows} selectedId={workspace.selectedRequestId} onSelect={selectRequest} productMetrics={productMetrics} />
        <div className="mt-3 flex items-center justify-between gap-3 text-sm font-bold text-[var(--dawaa-theme-muted)]"><span>صفحة {workspace.page} من {workspace.pages}</span><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={workspace.page <= 1 || workspace.listLoading} onClick={() => workspace.setPage(Math.max(1, workspace.page - 1))}>السابق</button><button type="button" className="btn-secondary" disabled={workspace.page >= workspace.pages || workspace.listLoading} onClick={() => workspace.setPage(Math.min(workspace.pages, workspace.page + 1))}>التالي</button></div></div>
      </section>

      {canManageRequests && createOpen ? <CanonicalCreateRequestDialog onClose={() => setCreateOpen(false)} onCreated={onCreated} /> : null}
      {canManageRequests && workspace.selectedRequest ? <CustomerRequestDetailsDrawer request={workspace.selectedRequest} onClose={() => workspace.selectRequest(null)} onUpdated={onUpdated} /> : null}
    </section>
  );
}
