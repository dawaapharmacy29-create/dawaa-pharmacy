import { useState } from 'react';
import { BarChart3, Boxes, DatabaseZap, ListChecks, ShieldAlert, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import CustomerRequestInsightsPanel from '@/components/customer-requests/CustomerRequestInsightsPanel';
import CustomerRequestQualityCenter from '@/components/customer-requests/CustomerRequestQualityCenter';
import { CustomerRequestsWorkspace } from '@/features/customer-requests';

type Tab = 'operations' | 'analytics' | 'quality';

export default function CustomerRequestsV2() {
  const [tab, setTab] = useState<Tab>('operations');
  const [analyticsBranch, setAnalyticsBranch] = useState('all');

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-4 pb-10" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <nav className="grid flex-1 grid-cols-3 gap-2">
            <button type="button" onClick={() => setTab('operations')} className={`rounded-2xl border px-4 py-3 text-right transition ${tab === 'operations' ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-text)]'}`}><span className="flex items-center gap-2 text-sm font-black"><ListChecks size={17} /> التنفيذ</span><small className="mt-1 block text-[10px] font-bold opacity-70">التسجيل والمتابعة والتوفير والتسليم</small></button>
            <button type="button" onClick={() => setTab('analytics')} className={`rounded-2xl border px-4 py-3 text-right transition ${tab === 'analytics' ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-text)]'}`}><span className="flex items-center gap-2 text-sm font-black"><BarChart3 size={17} /> التحليلات</span><small className="mt-1 block text-[10px] font-bold opacity-70">معدلات التوفير والأصناف والفروع</small></button>
            <button type="button" onClick={() => setTab('quality')} className={`rounded-2xl border px-4 py-3 text-right transition ${tab === 'quality' ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-text)]'}`}><span className="flex items-center gap-2 text-sm font-black"><ShieldAlert size={17} /> جودة البيانات</span><small className="mt-1 block text-[10px] font-bold opacity-70">العملاء والأكواد والمزامنة</small></button>
          </nav>

          <div className="flex flex-wrap gap-2 text-xs font-black">
            <Link to="/customers" className="btn-secondary flex items-center gap-1.5"><UsersRound size={14} /> العملاء</Link>
            <Link to="/shortages" className="btn-secondary flex items-center gap-1.5"><Boxes size={14} /> النواقص</Link>
            <Link to="/points" className="btn-secondary flex items-center gap-1.5"><DatabaseZap size={14} /> النقاط</Link>
          </div>
        </div>
      </section>

      {tab === 'operations' ? <CustomerRequestsWorkspace /> : null}

      {tab === 'analytics' ? (
        <div className="space-y-3">
          <div className="flex justify-end"><select className="input-dark w-auto min-w-44" value={analyticsBranch} onChange={(event) => setAnalyticsBranch(event.target.value)}><option value="all">كل الفروع</option><option value="دواء شكري">دواء شكري</option><option value="دواء الشامي">دواء الشامي</option></select></div>
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
              window.location.href = `/customer-requests?${params.toString()}`;
            }}
          />
        </div>
      ) : null}

      {tab === 'quality' ? <CustomerRequestQualityCenter branch={analyticsBranch} /> : null}
    </div>
  );
}
