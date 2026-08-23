import { useMemo } from 'react';
import { customerRequestOperationalView } from '../domain/request';
import { customerRequestStatusLabel } from '../domain/status';
import { useCustomerRequestsWorkspace } from '../hooks';
import CustomerRequestQueueStrip from './CustomerRequestQueueStrip';
import CustomerRequestsOperationsTable from './CustomerRequestsOperationsTable';

export default function CustomerRequestsWorkspace() {
  const workspace = useCustomerRequestsWorkspace();
  const selectedView = useMemo(
    () => (workspace.selectedRequest ? customerRequestOperationalView(workspace.selectedRequest) : null),
    [workspace.selectedRequest]
  );

  return (
    <section className="space-y-4" dir="rtl">
      <header className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">طلبات العملاء</h1>
          <p className="mt-1 text-sm font-medium text-[var(--dawaa-theme-muted)]">
            شاشة تنفيذ موحدة: العميل والصنف والمرحلة والإجراء التالي في مكان واحد.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input-dark min-w-64"
            value={workspace.filters.search || ''}
            onChange={(event) => workspace.updateFilters({ search: event.target.value })}
            placeholder="بحث باسم العميل، الكود، الهاتف، الصنف أو كود الصنف"
          />
          <select
            className="input-dark min-w-40"
            value={workspace.filters.branch || 'all'}
            onChange={(event) => workspace.updateFilters({ branch: event.target.value })}
          >
            <option value="all">كل الفروع</option>
            <option value="shokry">دواء شكري</option>
            <option value="elshamy">دواء الشامي</option>
          </select>
          <button type="button" className="btn-secondary" onClick={() => void workspace.refresh()}>
            تحديث
          </button>
        </div>
      </header>

      {workspace.summaryError ? (
        <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-sm font-bold">
          تعذر تحميل المؤشرات فقط، لكن قائمة التشغيل ما زالت مستقلة: {workspace.summaryError}
        </div>
      ) : null}

      <CustomerRequestQueueStrip
        summary={workspace.summary}
        activeFilter={workspace.filters.quickFilter}
        onSelect={(quickFilter) => workspace.updateFilters({ quickFilter })}
      />

      <div className={`grid gap-4 ${workspace.selectedRequest ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <div className="min-w-0 space-y-3">
          {workspace.listError ? (
            <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-2 text-sm font-bold">
              تعذر تحميل قائمة الطلبات: {workspace.listError}
            </div>
          ) : null}
          <CustomerRequestsOperationsTable
            rows={workspace.rows}
            selectedId={workspace.selectedRequestId}
            onSelect={workspace.selectRequest}
          />
          <div className="flex items-center justify-between gap-3 text-sm font-bold text-[var(--dawaa-theme-muted)]">
            <span>{workspace.count.toLocaleString('ar-EG')} طلب</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={workspace.page <= 1 || workspace.listLoading}
                onClick={() => workspace.setPage(Math.max(1, workspace.page - 1))}
              >
                السابق
              </button>
              <span>صفحة {workspace.page} من {workspace.pages}</span>
              <button
                type="button"
                className="btn-secondary"
                disabled={workspace.page >= workspace.pages || workspace.listLoading}
                onClick={() => workspace.setPage(Math.min(workspace.pages, workspace.page + 1))}
              >
                التالي
              </button>
            </div>
          </div>
        </div>

        {workspace.selectedRequest && selectedView ? (
          <aside className="h-fit rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 xl:sticky xl:top-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">الطلب المحدد</div>
                <h2 className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">{selectedView.product.name}</h2>
                <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{selectedView.product.code || 'بدون كود صنف'}</div>
              </div>
              <button type="button" className="btn-secondary" onClick={() => workspace.selectRequest(null)}>إغلاق</button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
                <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">العميل</div>
                <div className="mt-1 font-black">{selectedView.customer.name || 'غير مربوط'}</div>
                <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{selectedView.customer.code || 'بدون كود'}</div>
              </div>
              <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
                <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">الحالة</div>
                <div className="mt-1 font-black">{customerRequestStatusLabel(workspace.selectedRequest.status)}</div>
              </div>
              <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
                <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">المسئول</div>
                <div className="mt-1 font-black">{selectedView.owner || 'غير مسند'}</div>
              </div>
              <div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3">
                <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">مسجل الطلب</div>
                <div className="mt-1 font-black">{selectedView.registrar.name || 'غير مربوط'}</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] p-4">
              <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">المطلوب الآن</div>
              <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-primary)]">{selectedView.primaryAction.label}</div>
            </div>

            {selectedView.identityIssues.length ? (
              <div className="mt-4 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3">
                <div className="text-xs font-black">بيانات تحتاج استكمال</div>
                <div className="mt-2 text-xs font-bold">{selectedView.identityIssues.join(' · ')}</div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
