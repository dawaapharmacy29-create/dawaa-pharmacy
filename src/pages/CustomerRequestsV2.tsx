import { useState } from 'react';
import { BarChart3, Boxes, DatabaseZap, ListChecks, PackageSearch, ShieldAlert, ShoppingCart, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import CustomerRequestInsightsPanel from '@/components/customer-requests/CustomerRequestInsightsPanel';
import CustomerRequestQualityCenter from '@/components/customer-requests/CustomerRequestQualityCenter';
import CustomerRequestCriticalToday from '@/components/customer-requests/CustomerRequestCriticalToday';
import CustomerRequestWarehousePanel from '@/components/customer-requests/CustomerRequestWarehousePanel';
import CustomerRequestStaffAttributionPanel from '@/components/customer-requests/CustomerRequestStaffAttributionPanel';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { CustomerRequestsWorkspace } from '@/features/customer-requests';

type Tab = 'operations' | 'sourcing' | 'analytics' | 'quality';

function openOperations(params: URLSearchParams) {
  window.location.href = `/customer-requests${params.toString() ? `?${params.toString()}` : ''}`;
}

export default function CustomerRequestsV2() {
  const [tab, setTab] = useState<Tab>('operations');
  const [analyticsBranch, setAnalyticsBranch] = useState('all');

  const openRequest = (request: CustomerRequest) => {
    const params = new URLSearchParams();
    params.set('requestId', request.id);
    params.set('quick', 'all');
    openOperations(params);
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-4 pb-10" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <nav className="grid flex-1 grid-cols-2 gap-2 lg:grid-cols-4">
            <WorkspaceTab active={tab === 'operations'} onClick={() => setTab('operations')} icon={ListChecks} title="التنفيذ" description="التسجيل والمتابعة والتسليم" />
            <WorkspaceTab active={tab === 'sourcing'} onClick={() => setTab('sourcing')} icon={PackageSearch} title="التوفير" description="النواقص والمخازن ودورة التوفير" />
            <WorkspaceTab active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={BarChart3} title="التحليلات" description="معدلات التوفير والأصناف والفروع" />
            <WorkspaceTab active={tab === 'quality'} onClick={() => setTab('quality')} icon={ShieldAlert} title="جودة البيانات" description="العملاء والأكواد وهوية الموظفين" />
          </nav>

          <div className="flex flex-wrap gap-2 text-xs font-black">
            <Link to="/customers" className="btn-secondary flex items-center gap-1.5"><UsersRound size={14} /> العملاء</Link>
            <Link to="/shortages" className="btn-secondary flex items-center gap-1.5"><Boxes size={14} /> النواقص</Link>
            <Link to="/purchases" className="btn-secondary flex items-center gap-1.5"><ShoppingCart size={14} /> المشتريات</Link>
            <Link to="/points" className="btn-secondary flex items-center gap-1.5"><DatabaseZap size={14} /> النقاط</Link>
          </div>
        </div>
      </section>

      {tab === 'operations' ? <CustomerRequestsWorkspace /> : null}

      {tab === 'sourcing' ? (
        <div className="space-y-4">
          <ScopeBranch value={analyticsBranch} onChange={setAnalyticsBranch} />
          <CustomerRequestCriticalToday branch={analyticsBranch} onOpenRequest={openRequest} />
          <CustomerRequestWarehousePanel branch={analyticsBranch} />
          <section className="grid gap-3 md:grid-cols-3">
            <RouteCard to="/shortages" title="النواقص" description="فتح قائمة النواقص المرتبطة بالتوفير ومراجعة الأصناف غير المتاحة." />
            <RouteCard to="/purchases" title="المشتريات" description="متابعة مسار الشراء والموردين بدون تكرار بيانات طلب العميل." />
            <RouteCard to="/supplier-performance" title="أداء الموردين" description="مراجعة مصادر التوفير والأداء من المسار التحليلي المتخصص." />
          </section>
        </div>
      ) : null}

      {tab === 'analytics' ? (
        <div className="space-y-3">
          <ScopeBranch value={analyticsBranch} onChange={setAnalyticsBranch} />
          <CustomerRequestInsightsPanel
            branch={analyticsBranch}
            onAction={(action) => {
              const params = new URLSearchParams();
              if (action.branch) params.set('branch', action.branch);
              if (action.status) params.set('status', action.status);
              if (action.quickFilter) params.set('quick', action.quickFilter);
              if (action.assignee) params.set('assignee', action.assignee);
              if (action.search) params.set('search', action.search);
              if (action.customerCode) params.set('customerCode', action.customerCode);
              if (action.customerPhone) params.set('customerPhone', action.customerPhone);
              if (action.customerName) params.set('customerName', action.customerName);
              if (action.productCode) params.set('productCode', action.productCode);
              if (action.medicineName) params.set('medicineName', action.medicineName);
              openOperations(params);
            }}
          />
        </div>
      ) : null}

      {tab === 'quality' ? (
        <div className="space-y-3">
          <ScopeBranch value={analyticsBranch} onChange={setAnalyticsBranch} />
          <CustomerRequestStaffAttributionPanel branch={analyticsBranch} />
          <CustomerRequestQualityCenter branch={analyticsBranch} onOpenRequest={openRequest} />
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceTab({ active, onClick, icon: Icon, title, description }: { active: boolean; onClick: () => void; icon: typeof ListChecks; title: string; description: string }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl border px-4 py-3 text-right transition ${active ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-text)] hover:border-[var(--dawaa-theme-accent-border)]'}`}><span className="flex items-center gap-2 text-sm font-black"><Icon size={17} /> {title}</span><small className="mt-1 block text-[10px] font-bold opacity-70">{description}</small></button>;
}

function ScopeBranch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="flex justify-end"><select className="input-dark w-auto min-w-44" value={value} onChange={(event) => onChange(event.target.value)}><option value="all">كل الفروع</option><option value="فرع شكري">دواء شكري</option><option value="فرع الشامي">دواء الشامي</option></select></div>;
}

function RouteCard({ to, title, description }: { to: string; title: string; description: string }) {
  return <Link to={to} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 transition hover:border-[var(--dawaa-theme-accent-border)]"><div className="font-black text-[var(--dawaa-theme-heading)]">{title}</div><p className="mt-1 text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">{description}</p></Link>;
}
