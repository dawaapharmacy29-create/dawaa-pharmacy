import { useState } from 'react';
import { BarChart3, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { useCustomerRequestsWorkspace } from '../hooks';
import CustomerRequestQueueStrip from './CustomerRequestQueueStrip';
import CustomerRequestsOperationsTable from './CustomerRequestsOperationsTable';
import CanonicalCreateRequestDialog from './CanonicalCreateRequestDialog';
import CustomerRequestDetailsDrawer from './CustomerRequestDetailsDrawer';

export default function CustomerRequestsWorkspace() {
  const workspace = useCustomerRequestsWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  const onCreated = async (request: CustomerRequest) => {
    workspace.updateSelectedRequest(request);
    workspace.updateFilters({ quickFilter: 'today', status: 'all' });
    await workspace.refresh();
  };

  const onUpdated = async (request: CustomerRequest) => {
    workspace.updateSelectedRequest(request);
    await workspace.refresh();
  };

  return (
    <section className="space-y-4" dir="rtl">
      <header className="rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-lg md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">طلبات العملاء</h1>
              <span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-2.5 py-1 text-[10px] font-black text-[var(--dawaa-status-success-text)]">Operations Workspace</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm font-bold leading-7 text-[var(--dawaa-theme-muted)]">
              العميل والكود والصنف والكود والمرحلة والموعد والدكتور والإجراء التالي في شاشة تنفيذ واحدة مرتبطة بنظام النقاط المركزي.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setCreateOpen(true)}><Plus size={16} /> تسجيل طلب</button>
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void workspace.refresh()} disabled={workspace.loading}><RefreshCw size={16} className={workspace.loading ? 'animate-spin' : ''} /> تحديث</button>
            <Link to="/customer-requests-legacy" className="btn-secondary flex items-center gap-2 text-xs"><ShieldCheck size={15} /> النسخة القديمة</Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_190px_170px]">
          <input
            className="input-dark"
            value={workspace.filters.search || ''}
            onChange={(event) => workspace.updateFilters({ search: event.target.value })}
            placeholder="بحث بالعميل، كود العميل، الهاتف، اسم الصنف أو كود الصنف"
          />
          <select className="input-dark" value={workspace.filters.branch || 'all'} onChange={(event) => workspace.updateFilters({ branch: event.target.value })}>
            <option value="all">كل الفروع</option>
            <option value="shokry">دواء شكري</option>
            <option value="elshamy">دواء الشامي</option>
          </select>
          <select className="input-dark" value={workspace.pageSize} onChange={(event) => workspace.setPageSize(Number(event.target.value))}>
            <option value={20}>20 طلب / صفحة</option>
            <option value={30}>30 طلب / صفحة</option>
            <option value={50}>50 طلب / صفحة</option>
          </select>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['مفتوحة', workspace.summary.open],
          ['عاجلة', workspace.summary.urgent],
          ['متأخرة', workspace.summary.overdue],
          ['جاهزة للتواصل', workspace.summary.ready],
          ['بدون مسئول', workspace.summary.unassigned],
          ['تم التسليم', workspace.summary.delivered],
        ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3"><div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{Number(value).toLocaleString('ar-EG')}</div></div>)}
      </div>

      {workspace.summaryError ? (
        <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-warning-text)]">
          تعذر تحميل المؤشرات فقط، لكن قائمة التنفيذ مستقلة وما زالت تعمل: {workspace.summaryError}
        </div>
      ) : null}

      <CustomerRequestQueueStrip
        summary={workspace.summary}
        activeFilter={workspace.filters.quickFilter}
        onSelect={(quickFilter) => workspace.updateFilters({ quickFilter })}
      />

      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-lg md:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><BarChart3 size={17} className="text-[var(--dawaa-theme-primary)]" /> قائمة التنفيذ</div><div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{workspace.count.toLocaleString('ar-EG')} طلب مطابق · اضغط على أي طلب لفتح التنفيذ والتفاصيل والنقاط.</div></div>
          {workspace.listLoading ? <span className="text-xs font-bold text-[var(--dawaa-theme-primary)]">جاري تحديث القائمة...</span> : null}
        </div>

        {workspace.listError ? <div className="mb-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-2 text-sm font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل القائمة: {workspace.listError}</div> : null}

        <CustomerRequestsOperationsTable rows={workspace.rows} selectedId={workspace.selectedRequestId} onSelect={workspace.selectRequest} />

        <div className="mt-3 flex items-center justify-between gap-3 text-sm font-bold text-[var(--dawaa-theme-muted)]">
          <span>صفحة {workspace.page} من {workspace.pages}</span>
          <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={workspace.page <= 1 || workspace.listLoading} onClick={() => workspace.setPage(Math.max(1, workspace.page - 1))}>السابق</button><button type="button" className="btn-secondary" disabled={workspace.page >= workspace.pages || workspace.listLoading} onClick={() => workspace.setPage(Math.min(workspace.pages, workspace.page + 1))}>التالي</button></div>
        </div>
      </section>

      {createOpen ? <CanonicalCreateRequestDialog onClose={() => setCreateOpen(false)} onCreated={onCreated} /> : null}
      {workspace.selectedRequest ? <CustomerRequestDetailsDrawer request={workspace.selectedRequest} onClose={() => workspace.selectRequest(null)} onUpdated={onUpdated} /> : null}
    </section>
  );
}
