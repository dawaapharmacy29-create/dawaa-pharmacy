import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Database, MessageSquareText, Workflow } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerFollowupOperationsCompletionPanel from '@/components/customerService/CustomerFollowupOperationsCompletionPanel';
import CustomerFollowupFinalQualityPanel from '@/components/customerService/CustomerFollowupFinalQualityPanel';
import CustomerFollowupOperationsHub from '@/components/customerService/CustomerFollowupOperationsHub';
import '@/styles/customerServiceTheme.css';

const CustomerServiceDataTools = lazy(() => import('@/components/customerService/CustomerServiceDataTools'));
const CustomerServiceScriptEditor = lazy(() => import('@/components/customerService/CustomerServiceScriptEditor'));
const CustomerCashback = lazy(() => import('@/pages/CustomerCashback'));

type MainView = 'operations' | 'data' | 'content' | 'reports';

const views: Array<{ id: MainView; title: string; description: string; icon: typeof Workflow }> = [
  { id: 'operations', title: 'التشغيل اليومي', description: 'قائمة اليوم وانتظار الرد والسجل', icon: Workflow },
  { id: 'data', title: 'البيانات والجودة', description: 'التصحيح والفروع والتكرارات', icon: Database },
  { id: 'content', title: 'سكريبتات التواصل', description: 'نصوص المكالمات والواتساب', icon: MessageSquareText },
  { id: 'reports', title: 'التقارير والنقاط', description: 'التصدير والكاش باك والاستحقاق', icon: BarChart3 },
];

function SectionLoader({ label }: { label: string }) {
  return <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">جارٍ تحميل {label}...</div>;
}

function MissingBranchGuard() {
  return <section className="mx-4 mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 text-center" dir="rtl"><AlertTriangle className="mx-auto text-amber-300" size={34}/><h2 className="mt-3 text-xl font-black text-white">لا يمكن فتح قائمة المتابعات بدون فرع محدد</h2><p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-7 text-amber-100/80">حساب خدمة العملاء الحالي غير مربوط بفرع الشامي أو فرع شكري. تم إيقاف تحميل القائمة بدل فتح فرع افتراضي بالخطأ.</p></section>;
}

export default function SmartCustomerService() {
  const { user } = useAuth();
  const [view, setView] = useState<MainView>('operations');
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const managerView = canViewAllBranches(user);
  const normalizedUserBranch = useMemo(() => normalizeBranchName(user?.branch || ''), [user?.branch]);
  const hasSafeBranchScope = managerView || Boolean(normalizedUserBranch);

  useEffect(() => {
    const refresh = () => setWorkspaceVersion((current) => current + 1);
    window.addEventListener('customer-followup-branch-transferred', refresh);
    return () => window.removeEventListener('customer-followup-branch-transferred', refresh);
  }, []);

  return <div className="customer-service-page space-y-4" dir="rtl">
    <section className="sticky top-0 z-30 border-b border-cyan-300/15 bg-[#071827]/95 px-3 py-3 shadow-2xl shadow-black/20 backdrop-blur-xl md:px-5">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-black text-cyan-300">مركز خدمة العملاء</p><h1 className="text-xl font-black text-white md:text-2xl">مساحة واحدة لكل متابعة وقرار</h1></div><p className="text-xs font-bold text-slate-400">أربع مساحات واضحة بدل تكرار الأدوات واللوحات</p></div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">{views.map(({ id, title, description, icon: Icon })=>{const active=id===view;return <button key={id} type="button" onClick={()=>setView(id)} className={`rounded-2xl border px-3 py-3 text-right transition ${active?'border-cyan-300/60 bg-cyan-400/15 shadow-lg shadow-cyan-950/30':'border-white/10 bg-white/[0.035] hover:border-cyan-300/30 hover:bg-white/[0.06]'}`} aria-pressed={active}><span className="flex items-center gap-2"><Icon size={17} className="text-cyan-300"/><span className={`block text-sm font-black ${active?'text-cyan-200':'text-white'}`}>{title}</span></span><span className="mt-1 hidden text-[11px] font-bold text-slate-400 md:block">{description}</span></button>;})}</div>
      </div>
    </section>

    <main className="mx-auto max-w-[1800px] px-0 pb-8">
      {!hasSafeBranchScope && view !== 'reports' ? <MissingBranchGuard/> : null}
      {hasSafeBranchScope && view === 'operations' ? <CustomerFollowupOperationsHub version={workspaceVersion}/> : null}
      {hasSafeBranchScope && view === 'data' ? <div className="space-y-4"><CustomerFollowupFinalQualityPanel/><CustomerFollowupOperationsCompletionPanel/><Suspense fallback={<SectionLoader label="أدوات تصحيح البيانات"/>}><CustomerServiceDataTools/></Suspense></div> : null}
      {hasSafeBranchScope && view === 'content' ? <Suspense fallback={<SectionLoader label="محرر السكريبتات"/>}><CustomerServiceScriptEditor/></Suspense> : null}
      {view === 'reports' ? <div className="space-y-4"><CustomerFollowupFullExportPanel/>{hasSafeBranchScope ? <Suspense fallback={<SectionLoader label="نقاط العملاء والكاش باك"/>}><CustomerCashback/></Suspense> : null}</div> : null}
    </main>
  </div>;
}
