import { lazy, Suspense, useState } from 'react';
import { ChevronDown, ChevronUp, History, Inbox, Wrench } from 'lucide-react';
import CustomerFollowupCockpitPanel from '@/components/customerService/CustomerFollowupCockpitPanel';
import CustomerBranchTransferPanel from '@/components/customerService/CustomerBranchTransferPanel';
import CustomerFollowupStructuredActionsPanel from '@/components/customerService/CustomerFollowupStructuredActionsPanel';
import CustomerServiceCommandOverview from '@/components/customerService/CustomerServiceCommandOverview';

const CustomerServiceOperationsPanel = lazy(() => import('@/components/customerService/CustomerServiceOperationsPanel'));
const UnifiedCustomerServiceWorkspace = lazy(() => import('@/components/customerService/UnifiedCustomerServiceWorkspace'));

type Mode = 'cockpit' | 'history';

function Loader({ label }: { label: string }) {
  return <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">جارٍ تحميل {label}...</div>;
}

export default function CustomerFollowupOperationsHub({ version }: { version: number }) {
  const [mode, setMode] = useState<Mode>('cockpit');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [legacyDetailsOpen, setLegacyDetailsOpen] = useState(false);

  const openTools = () => {
    setMode('cockpit');
    setToolsOpen(true);
    window.setTimeout(() => document.getElementById('customer-followup-advanced-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return <div className="space-y-4">
    <section className="mx-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-3" dir="rtl">
      <div className="grid gap-2 md:grid-cols-2">
        <button type="button" onClick={() => setMode('cockpit')} className={`rounded-2xl border p-3 text-right transition ${mode === 'cockpit' ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
          <div className="flex items-center gap-2"><Inbox size={18} className="text-cyan-300"/><span className="font-black text-white">مركز المتابعات</span></div>
          <p className="mt-1 text-xs font-bold text-slate-400">قائمة اليوم وانتظار الرد ولم يرد في مكان واحد</p>
        </button>
        <button type="button" onClick={() => setMode('history')} className={`rounded-2xl border p-3 text-right transition ${mode === 'history' ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
          <div className="flex items-center gap-2"><History size={18} className="text-cyan-300"/><span className="font-black text-white">السجل التاريخي</span></div>
          <p className="mt-1 text-xs font-bold text-slate-400">المكتمل والمؤجل والملغي والأرشيف</p>
        </button>
      </div>
    </section>

    {mode === 'cockpit' ? <div className="space-y-4">
      <CustomerFollowupCockpitPanel key={`cockpit-${version}`} onOpenTools={openTools}/>

      <section id="customer-followup-advanced-tools" className="mx-4 rounded-3xl border border-white/10 bg-[#0d2238] p-3" dir="rtl">
        <button type="button" onClick={() => setToolsOpen((value) => !value)} className="btn-secondary flex w-full items-center justify-center gap-2">
          <Wrench size={17}/> التحويل والتصحيح والإجراءات المتقدمة {toolsOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} 
        </button>
      </section>

      {toolsOpen ? <div className="space-y-4">
        <CustomerServiceCommandOverview key={`overview-${version}`}/>
        <CustomerBranchTransferPanel key={`transfer-${version}`}/>
        <CustomerFollowupStructuredActionsPanel key={`actions-${version}`}/>
      </div> : null}

      <button type="button" className="btn-secondary mx-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2" onClick={() => setLegacyDetailsOpen((value) => !value)}>
        {legacyDetailsOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} {legacyDetailsOpen ? 'إخفاء العرض القديم الاحتياطي' : 'فتح العرض القديم الاحتياطي'}
      </button>
      {legacyDetailsOpen ? <Suspense fallback={<Loader label="العرض الاحتياطي لقائمة المتابعات"/>}><UnifiedCustomerServiceWorkspace key={`workspace-${version}`}/></Suspense> : null}
    </div> : null}

    {mode === 'history' ? <Suspense fallback={<Loader label="سجل المتابعات"/>}><CustomerServiceOperationsPanel key={`history-${version}`}/></Suspense> : null}
  </div>;
}
