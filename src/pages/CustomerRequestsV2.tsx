import { lazy, Suspense, useEffect, useState } from 'react';
import { BarChart3, Boxes, DatabaseZap, ListChecks, PackageSearch, ShieldAlert, ShoppingCart, UsersRound } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { useAuth } from '@/hooks/useAuth';
import { canSeeAllBranches, getUserBranch } from '@/lib/core/branchScope';
import { CustomerRequestsWorkspace } from '@/features/customer-requests';

const CustomerRequestInsightsPanel = lazy(() => import('@/components/customer-requests/CustomerRequestInsightsPanel'));
const CustomerRequestQualityCenter = lazy(() => import('@/components/customer-requests/CustomerRequestQualityCenter'));
const CustomerRequestCriticalToday = lazy(() => import('@/components/customer-requests/CustomerRequestCriticalToday'));
const CustomerRequestWarehousePanel = lazy(() => import('@/components/customer-requests/CustomerRequestWarehousePanel'));
const CustomerRequestStaffAttributionPanel = lazy(() => import('@/components/customer-requests/CustomerRequestStaffAttributionPanel'));

type Tab = 'operations' | 'sourcing' | 'analytics' | 'quality';

function tabFromParams(params: URLSearchParams): Tab {
  const value = params.get('workspace');
  return value === 'sourcing' || value === 'analytics' || value === 'quality' ? value : 'operations';
}

export default function CustomerRequestsV2() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => tabFromParams(searchParams));
  const [analyticsBranch, setAnalyticsBranch] = useState('all');
  const canAccessAllBranches = canSeeAllBranches(user?.role);
  const userBranch = getUserBranch(user);
  const effectiveAnalyticsBranch = canAccessAllBranches ? analyticsBranch : userBranch || 'all';

  useEffect(() => {
    setTab(tabFromParams(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (!canAccessAllBranches && userBranch && analyticsBranch !== userBranch) setAnalyticsBranch(userBranch);
  }, [analyticsBranch, canAccessAllBranches, userBranch]);

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab);
    if (nextTab === 'operations') {
      navigate('/customer-requests', { replace: false });
      return;
    }
    const params = new URLSearchParams();
    params.set('workspace', nextTab);
    navigate(`/customer-requests?${params.toString()}`, { replace: false });
  };

  const openOperations = (params: URLSearchParams) => {
    setTab('operations');
    params.delete('workspace');
    navigate(`/customer-requests${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const openRequest = (request: CustomerRequest) => {
    const params = new URLSearchParams();
    params.set('requestId', request.id);
    params.set('quick', 'all');
    openOperations(params);
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-3 pb-8" dir="rtl">
      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-2.5 shadow-sm">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <nav className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5" aria-label="أقسام طلبات العملاء">
            <WorkspaceTab active={tab === 'operations'} onClick={() => selectTab('operations')} icon={ListChecks} title="التنفيذ" />
            <WorkspaceTab active={tab === 'sourcing'} onClick={() => selectTab('sourcing')} icon={PackageSearch} title="التوفير" />
            <WorkspaceTab active={tab === 'analytics'} onClick={() => selectTab('analytics')} icon={BarChart3} title="التحليلات" />
            <WorkspaceTab active={tab === 'quality'} onClick={() => selectTab('quality')} icon={ShieldAlert} title="جودة البيانات" />
          </nav>

          <div className="flex flex-wrap gap-1.5 text-[11px] font-black">
            <Link to="/customers" className="btn-secondary flex items-center gap-1.5 px-2.5 py-2"><UsersRound size={13} /> العملاء</Link>
            <Link to="/shortages" className="btn-secondary flex items-center gap-1.5 px-2.5 py-2"><Boxes size={13} /> النواقص</Link>
            <Link to="/purchases" className="btn-secondary flex items-center gap-1.5 px-2.5 py-2"><ShoppingCart size={13} /> المشتريات</Link>
            <Link to="/points" className="btn-secondary flex items-center gap-1.5 px-2.5 py-2"><DatabaseZap size={13} /> النقاط</Link>
          </div>
        </div>
      </section>

      {tab === 'operations' ? <CustomerRequestsWorkspace /> : null}

      {tab === 'sourcing' ? (
        <Suspense fallback={<WorkspaceLoading />}>
          <div className="space-y-3">
            <ScopeBranch value={effectiveAnalyticsBranch} onChange={setAnalyticsBranch} canAccessAll={canAccessAllBranches} ownBranch={userBranch} />
            <CustomerRequestCriticalToday branch={effectiveAnalyticsBranch} onOpenRequest={openRequest} />
            <CustomerRequestWarehousePanel branch={effectiveAnalyticsBranch} />
            <section className="grid gap-2 md:grid-cols-3">
              <RouteCard to="/shortages" title="النواقص" description="الأصناف غير المتاحة والطلبات المرتبطة بها." />
              <RouteCard to="/purchases" title="المشتريات" description="متابعة التوفير والشراء بدون تكرار بيانات الطلب." />
              <RouteCard to="/supplier-performance" title="أداء الموردين" description="مراجعة مصادر التوفير وأداء الموردين." />
            </section>
          </div>
        </Suspense>
      ) : null}

      {tab === 'analytics' ? (
        <Suspense fallback={<WorkspaceLoading />}>
          <div className="space-y-3">
            <ScopeBranch value={effectiveAnalyticsBranch} onChange={setAnalyticsBranch} canAccessAll={canAccessAllBranches} ownBranch={userBranch} />
            <CustomerRequestInsightsPanel
              branch={effectiveAnalyticsBranch}
              onAction={(action) => {
                const params = new URLSearchParams();
                if (action.branch) params.set('branch', action.branch);
                if (action.status) params.set('status', action.status);
                if (action.quickFilter) params.set('quick', action.quickFilter);
                if (action.assignee) params.set('assignee', action.assignee);
                if (action.search) params.set('search', action.search);
                if (action.customerCode) params.set('customerCode', action.customerCode);
                if (action.customerPhone) params.set('customerPhone', action.customerPhone);
                if (action.customerName && !action.search) params.set('search', action.customerName);
                if (action.productCode) params.set('productCode', action.productCode);
                if (action.medicineName) params.set('medicineName', action.medicineName);
                openOperations(params);
              }}
            />
          </div>
        </Suspense>
      ) : null}

      {tab === 'quality' ? (
        <Suspense fallback={<WorkspaceLoading />}>
          <div className="space-y-3">
            <ScopeBranch value={effectiveAnalyticsBranch} onChange={setAnalyticsBranch} canAccessAll={canAccessAllBranches} ownBranch={userBranch} />
            <CustomerRequestStaffAttributionPanel branch={effectiveAnalyticsBranch} />
            <CustomerRequestQualityCenter branch={effectiveAnalyticsBranch} onOpenRequest={openRequest} />
          </div>
        </Suspense>
      ) : null}
    </div>
  );
}

function WorkspaceTab({ active, onClick, icon: Icon, title }: { active: boolean; onClick: () => void; icon: typeof ListChecks; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-black transition ${
        active
          ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]'
          : 'border-transparent text-[var(--dawaa-theme-muted)] hover:border-[var(--dawaa-theme-border)] hover:text-[var(--dawaa-theme-heading)]'
      }`}
    >
      <Icon size={15} /> {title}
    </button>
  );
}

function ScopeBranch({ value, onChange, canAccessAll, ownBranch }: { value: string; onChange: (value: string) => void; canAccessAll: boolean; ownBranch: string }) {
  return <div className="flex justify-end"><select className="input-dark w-auto min-w-40" value={value} disabled={!canAccessAll} onChange={(event) => onChange(event.target.value)}>{canAccessAll ? <option value="all">كل الفروع</option> : null}{canAccessAll || ownBranch === 'فرع شكري' ? <option value="فرع شكري">دواء شكري</option> : null}{canAccessAll || ownBranch === 'فرع الشامي' ? <option value="فرع الشامي">دواء الشامي</option> : null}</select></div>;
}

function RouteCard({ to, title, description }: { to: string; title: string; description: string }) {
  return <Link to={to} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 transition hover:border-[var(--dawaa-theme-accent-border)]"><div className="text-sm font-black text-[var(--dawaa-theme-heading)]">{title}</div><p className="mt-1 text-[11px] font-bold leading-5 text-[var(--dawaa-theme-muted)]">{description}</p></Link>;
}

function WorkspaceLoading() {
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-6 text-center text-sm font-black text-[var(--dawaa-theme-muted)]">
      جاري تحميل مساحة العمل المطلوبة...
    </div>
  );
}
