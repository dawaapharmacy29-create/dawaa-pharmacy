import { lazy, Suspense, useState } from 'react';
import { History, Inbox, Wrench, X } from 'lucide-react';
import CustomerFollowupCockpitPanel from '@/components/customerService/CustomerFollowupCockpitPanel';
import CustomerFollowupBranchReviewPanel from '@/components/customerService/CustomerFollowupBranchReviewPanel';
import CustomerBranchTransferPanel from '@/components/customerService/CustomerBranchTransferPanel';
import CustomerFollowupStructuredActionsPanel from '@/components/customerService/CustomerFollowupStructuredActionsPanel';
import CustomerServiceCommandOverview from '@/components/customerService/CustomerServiceCommandOverview';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';

const CustomerServiceOperationsPanel = lazy(() => import('@/components/customerService/CustomerServiceOperationsPanel'));

type Mode = 'cockpit' | 'history';

function Loader({ label }: { label: string }) {
  return <div className="rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">جارٍ تحميل {label}...</div>;
}

export default function CustomerFollowupSingleScreen({ version }: { version: number }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const [mode, setMode] = useState<Mode>('cockpit');
  const [toolsOpen, setToolsOpen] = useState(false);

  return <div className="min-h-[calc(100vh-7rem)] space-y-3" dir="rtl">
    <section className="sticky top-0 z-30 mx-4 rounded-2xl border border-cyan-400/20 bg-[#0b1d31]/95 p-2 shadow-xl backdrop-blur">
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => setMode('cockpit')} className={`rounded-xl border px-4 py-3 text-right transition ${mode === 'cockpit' ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}>
          <div className="flex items-center gap-2"><Inbox size={18} className="text-cyan-300"/><span className="font-black text-white">قائمة التشغيل</span></div>
          <p className="mt-1 text-xs font-bold text-slate-400">المطلوب الآن والمتأخر والمواعيد القادمة</p>
        </button>
        <button type="button" onClick={() => setMode('history')} className={`rounded-xl border px-4 py-3 text-right transition ${mode === 'history' ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}>
          <div className="flex items-center gap-2"><History size={18} className="text-cyan-300"/><span className="font-black text-white">السجل المكتمل</span></div>
          <p className="mt-1 text-xs font-bold text-slate-400">المكتمل والمؤجل والملغي والأرشيف</p>
        </button>
        <button type="button" onClick={() => setToolsOpen(true)} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-right transition hover:bg-white/[0.06]">
          <div className="flex items-center gap-2"><Wrench size={18} className="text-cyan-300"/><span className="font-black text-white">إجراءات متقدمة</span></div>
          <p className="mt-1 text-xs font-bold text-slate-400">التحويل والتصحيح والمراجعة الإدارية</p>
        </button>
      </div>
    </section>

    {mode === 'cockpit' ? <CustomerFollowupCockpitPanel key={`cockpit-${version}`} /> : null}
    {mode === 'history' ? <div className="mx-4"><Suspense fallback={<Loader label="سجل المتابعات"/>}><CustomerServiceOperationsPanel key={`history-${version}`}/></Suspense></div> : null}

    {toolsOpen ? <div className="fixed inset-0 z-[140] bg-black/75 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setToolsOpen(false); }}>
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-cyan-400/20 bg-[#091b2d] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div><p className="text-xs font-black text-cyan-300">أدوات الإدارة</p><h2 className="text-xl font-black text-white">التحويل والتصحيح والإجراءات المتقدمة</h2></div>
          <button type="button" className="btn-secondary" onClick={() => setToolsOpen(false)}><X size={18}/></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {managerView ? <CustomerFollowupBranchReviewPanel/> : null}
          <CustomerServiceCommandOverview key={`overview-${version}`}/>
          <CustomerBranchTransferPanel key={`transfer-${version}`}/>
          <CustomerFollowupStructuredActionsPanel key={`actions-${version}`}/>
        </div>
      </div>
    </div> : null}
  </div>;
}
