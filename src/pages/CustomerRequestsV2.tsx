import { lazy, Suspense, useEffect, useState } from 'react';
import { BarChart3, Boxes, DatabaseZap, ExternalLink, ListChecks, PackageSearch, ShieldAlert, UsersRound } from 'lucide-react';
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
    <div className="mx-auto w-full max-w-[1680px] space-y-3 pb-6" dir="rtl">
      <section className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--dawaa-theme-surface)] p-1" aria-label="أقسام طلبات العملاء">
          <WorkspaceTab active={tab === 'operations'} onClick={() => selectTab('operations')} icon={ListChecks} title="التنفيذ" />
          <WorkspaceTab active={tab === 'sourcing'} onClick={() => selectTab('sourcing')} icon={PackageSearch} title="التوفير" />
          <WorkspaceTab active={tab === 'analytics'} onClick={() => selectTab('analytics')} icon={BarChart3} title="التحليلات" />
          <WorkspaceTab active={tab === 'quality'} onClick={() => selectTab('quality')} icon={ShieldAlert} title="جودة البيانات" />
        </nav>

        <div className="flex flex-wrap gap-1 text-[11px] font-black">
          <a href="https://dawaawael.base44.app/customer-orders" target="_blank" rel="noreferrer" className="dawaa-tab inline-flex items-center gap-1.5 !py-1"><ExternalLink size={13} /> دواء وائل</a>
          <Link to="/customers" className="dawaa-tab inline-flex items-center gap-1.5 !py-1"><UsersRound size={13} /> العملاء</Link>
          <Link to="/shortages" className="dawaa-tab inline-flex items-center gap-1.5 !py-1"><Boxes size={13} /> النواقص</Link>
          <Link to="/points" className="dawaa-tab inline-flex items-center gap-1.5 !py-1"><DatabaseZap size={13} /> النقاط</Link>
        </div>
      </section>

      {tab === 'operations' ? <CustomerRequestsWorkspace /> : null}

      {tab === 'sourcing' ? (
        <Suspense fallback={<WorkspaceLoading />}>
        <div className="space-y-4">
          <ScopeBranch value={effectiveAnalyticsBranch} onChange={setAnalyticsBranch} canAccessAll={canAccessAllBranches} ownBranch={userBranch} />
          <CustomerRequestCriticalToday branch={effectiveAnalyticsBranch} onOpenRequest={openRequest} />
          <CustomerRequestWarehousePanel branch={effectiveAnalyticsBranch} />
          <section className="grid gap-3 md:grid-cols-3">
            <RouteCard to="/shortages" title="النواقص" description="فتح قائمة النواقص المرتبطة بالتوفير ومراجعة الأصناف غير المتاحة." />
            <RouteCard to="/purchases" title="المشتريات" description="متابعة مسار الشراء والموردين بدون تكرار بيانات طلب العميل." />
            <RouteCard to="/supplier-performance" title="أداء الموردين" description="مراجعة مصادر التوفير والأداء من المسار التحليلي المتخصص." />
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
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`dawaa-tab inline-flex items-center gap-2 whitespace-nowrap text-xs ${active ? 'is-active' : ''}`}><Icon size={15} /> {title}</button>;
}

function ScopeBranch({ value, onChange, canAccessAll, ownBranch }: { value: string; onChange: (value: string) => void; canAccessAll: boolean; ownBranch: string }) {
  return <div className="flex justify-end"><select className="input-dark w-auto min-w-44" value={value} disabled={!canAccessAll} onChange={(event) => onChange(event.target.value)}>{canAccessAll ? <option value="all">كل الفروع</option> : null}{canAccessAll || ownBranch === 'فرع شكري' ? <option value="فرع شكري">دواء شكري</option> : null}{canAccessAll || ownBranch === 'فرع الشامي' ? <option value="فرع الشامي">دواء الشامي</option> : null}</select></div>;
}

function RouteCard({ to, title, description }: { to: string; title: string; description: string }) {
  return <Link to={to} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 transition hover:border-[var(--dawaa-theme-accent-border)]"><div className="font-black text-[var(--dawaa-theme-heading)]">{title}</div><p className="mt-1 text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">{description}</p></Link>;
}


function WorkspaceLoading() {
  return (
    <div className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-8 text-center text-sm font-black text-[var(--dawaa-theme-muted)]">
      جاري تحميل مساحة العمل المطلوبة...
    </div>
  );
}
