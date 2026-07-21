import { lazy, Suspense, useState } from 'react';
import { ChevronDown, ChevronUp, History, Inbox, MessageCircle, Wrench } from 'lucide-react';
import CustomerFollowupCompactQueuePanel from '@/components/customerService/CustomerFollowupCompactQueuePanel';
import CustomerBranchTransferPanel from '@/components/customerService/CustomerBranchTransferPanel';
import CustomerFollowupStructuredActionsPanel from '@/components/customerService/CustomerFollowupStructuredActionsPanel';
import CustomerServiceCommandOverview from '@/components/customerService/CustomerServiceCommandOverview';

const WaitingCustomerRepliesPanel = lazy(() => import('@/components/customerService/WaitingCustomerRepliesPanel'));
const CustomerServiceOperationsPanel = lazy(() => import('@/components/customerService/CustomerServiceOperationsPanel'));
const UnifiedCustomerServiceWorkspace = lazy(() => import('@/components/customerService/UnifiedCustomerServiceWorkspace'));

type Mode = 'today' | 'waiting' | 'history';

function Loader({ label }: { label: string }) {
  return <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">جارٍ تحميل {label}...</div>;
}

const modes: Array<{ id: Mode; label: string; hint: string; icon: typeof Inbox }> = [
  { id: 'today', label: 'قائمة اليوم', hint: 'العمل المفتوح والفلاتر السريعة', icon: Inbox },
  { id: 'waiting', label: 'انتظار الرد', hint: 'الرسائل المرسلة ولم يرد', icon: MessageCircle },
  { id: 'history', label: 'السجل', hint: 'المؤجل والمكتمل والأرشيف', icon: History },
];

export default function CustomerFollowupOperationsHub({ version }: { version: number }) {
  const [mode, setMode] = useState<Mode>('today');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [fullQueueOpen, setFullQueueOpen] = useState(false);

  return <div className="space-y-4">
    <section className="mx-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-3" dir="rtl">
      <div className="grid gap-2 md:grid-cols-3">
        {modes.map(({ id, label, hint, icon: Icon }) => {
          const active = mode === id;
          return <button key={id} type="button" onClick={() => setMode(id)} className={`rounded-2xl border p-3 text-right transition ${active ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
            <div className="flex items-center gap-2"><Icon size={18} className="text-cyan-300"/><span className="font-black text-white">{label}</span></div>
            <p className="mt-1 text-xs font-bold text-slate-400">{hint}</p>
          </button>;
        })}
      </div>
      <button type="button" onClick={() => setToolsOpen((value) => !value)} className="btn-secondary mt-3 flex w-full items-center justify-center gap-2">
        <Wrench size={17}/> أدوات العميل والتحويل {toolsOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} 
      </button>
    </section>

    {toolsOpen ? <div className="space-y-4">
      <CustomerServiceCommandOverview key={`overview-${version}`}/>
      <CustomerBranchTransferPanel key={`transfer-${version}`}/>
      <CustomerFollowupStructuredActionsPanel key={`actions-${version}`}/>
    </div> : null}

    {mode === 'today' ? <div className="space-y-4">
      <CustomerFollowupCompactQueuePanel key={`compact-${version}`} onOpenFull={() => setFullQueueOpen(true)}/>
      <button type="button" className="btn-secondary mx-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2" onClick={() => setFullQueueOpen((value) => !value)}>
        {fullQueueOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} {fullQueueOpen ? 'إخفاء التفاصيل الموسعة' : 'فتح التفاصيل الموسعة'}
      </button>
      {fullQueueOpen ? <Suspense fallback={<Loader label="تفاصيل قائمة اليوم"/>}><UnifiedCustomerServiceWorkspace key={`workspace-${version}`}/></Suspense> : null}
    </div> : null}

    {mode === 'waiting' ? <Suspense fallback={<Loader label="قائمة انتظار الرد"/>}><WaitingCustomerRepliesPanel key={`waiting-${version}`}/></Suspense> : null}
    {mode === 'history' ? <Suspense fallback={<Loader label="سجل المتابعات"/>}><CustomerServiceOperationsPanel key={`history-${version}`}/></Suspense> : null}
  </div>;
}
