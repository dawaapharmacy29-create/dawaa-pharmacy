import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Clock3, Database, History, MessageSquareText, PhoneMissed, Plus, Sparkles, Workflow, Wrench } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerFollowupOperationsCompletionPanel from '@/components/customerService/CustomerFollowupOperationsCompletionPanel';
import CustomerFollowupFinalQualityPanel from '@/components/customerService/CustomerFollowupFinalQualityPanel';
import CustomerFollowupOperationsHub from '@/components/customerService/CustomerFollowupOperationsHub';
import CustomerFollowupRecordsAndPerformance from '@/components/customerService/CustomerFollowupRecordsAndPerformance';
import CustomerServiceStaffPerformancePanel from '@/components/customerService/CustomerServiceStaffPerformancePanel';
import CustomerDailyPriorityQueues from '@/components/customerService/CustomerDailyPriorityQueues';
import CustomerServiceDoctorWorkbookCenter from '@/components/customerService/CustomerServiceDoctorWorkbookCenter';
import ExceptionalFollowupCenter from '@/components/customerService/ExceptionalFollowupCenter';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import ExceptionalFollowupModal from '@/components/customerService/ExceptionalFollowupModal';
import '@/styles/customerServiceTheme.css';

const CustomerServiceDataTools = lazy(() => import('@/components/customerService/CustomerServiceDataTools'));
const CustomerServiceScriptEditor = lazy(() => import('@/components/customerService/CustomerServiceScriptEditor'));
const CustomerCashback = lazy(() => import('@/pages/CustomerCashback'));

type MainSection = 'today' | 'followups' | 'performance' | 'tools' | 'reports';
type FollowupView = 'waiting' | 'no_answer' | 'exceptional' | 'completed';
type ToolsView = 'data' | 'content';

const mainSections: Array<{ id: MainSection; title: string; description: string; icon: typeof Workflow }> = [
  { id: 'today', title: 'اليوم', description: 'قائمة التنفيذ وملف الدكاترة', icon: Workflow },
  { id: 'followups', title: 'المتابعات', description: 'انتظار الرد ولم يرد والاستثنائي والمكتمل', icon: Clock3 },
  { id: 'performance', title: 'الأداء', description: 'تنفيذ وردود و+500 ونقاط وVIP', icon: BarChart3 },
  { id: 'tools', title: 'الأدوات', description: 'جودة البيانات وسكريبتات التواصل', icon: Wrench },
  { id: 'reports', title: 'التقارير والنقاط', description: 'التصدير والكاش باك والاستحقاق', icon: History },
];

const followupViews: Array<{ id: FollowupView; title: string; description: string; icon: typeof Clock3 }> = [
  { id: 'waiting', title: 'في انتظار الرد', description: 'تم التواصل وننتظر العميل', icon: Clock3 },
  { id: 'no_answer', title: 'لم يرد العميل', description: 'محاولات بدون رد وتحتاج إعادة تواصل', icon: PhoneMissed },
  { id: 'exceptional', title: 'متابعة استثنائية', description: 'طلبات الدكاترة والحالات الخاصة', icon: Sparkles },
  { id: 'completed', title: 'المكتمل', description: 'المتابعات المنفذة والمؤرشفة', icon: History },
];

const toolsViews: Array<{ id: ToolsView; title: string; description: string; icon: typeof Database }> = [
  { id: 'data', title: 'البيانات والجودة', description: 'التصحيح والفروع والتكرارات', icon: Database },
  { id: 'content', title: 'سكريبتات التواصل', description: 'نصوص المكالمات والواتساب', icon: MessageSquareText },
];

function SectionLoader({ label }: { label: string }) {
  return <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">جارٍ تحميل {label}...</div>;
}

function MissingBranchGuard() {
  return <section className="mx-4 mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 text-center" dir="rtl"><AlertTriangle className="mx-auto text-amber-300" size={34}/><h2 className="mt-3 text-xl font-black text-white">لا يمكن فتح قائمة المتابعات بدون فرع محدد</h2><p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-7 text-amber-100/80">الحساب الحالي غير مربوط بفرع الشامي أو فرع شكري. تم إيقاف تحميل البيانات بدل فتح فرع افتراضي أو إظهار بيانات فرع آخر.</p></section>;
}

export default function SmartCustomerService() {
  const { user } = useAuth();
  const [section, setSection] = useState<MainSection>('today');
  const [followupView, setFollowupView] = useState<FollowupView>('waiting');
  const [toolsView, setToolsView] = useState<ToolsView>('data');
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [exceptionalOpen, setExceptionalOpen] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<{ code: string; name: string; phone: string } | null>(null);
  const managerView = canViewAllBranches(user);
  const normalizedUserBranch = useMemo(() => normalizeBranchName(user?.branch || ''), [user?.branch]);
  const hasSafeBranchScope = managerView || Boolean(normalizedUserBranch);

  useEffect(() => {
    const openQuick = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string; name?: string; phone?: string }>).detail;
      if (detail && (detail.code || detail.name || detail.phone)) {
        setPendingCustomer({ code: detail.code || '', name: detail.name || '', phone: detail.phone || '' });
      }
      setQuickOpen(true);
    };
    const params = new URLSearchParams(window.location.search);
    if (params.get('quickFollowup') === '1') {
      let customer: { code: string; name: string; phone: string } | null = null;
      try {
        const stored = sessionStorage.getItem('dawaa_pending_followup_customer');
        if (stored) {
          sessionStorage.removeItem('dawaa_pending_followup_customer');
          const parsed = JSON.parse(stored) as { code?: string; name?: string; phone?: string };
          if (parsed.code || parsed.name || parsed.phone) {
            customer = { code: parsed.code || '', name: parsed.name || '', phone: parsed.phone || '' };
          }
        }
      } catch {
        // نكمل على بارامترات الرابط
      }
      if (!customer) {
        const code = params.get('code') || '';
        const name = params.get('name') || '';
        const phone = params.get('phone') || '';
        if (code || name || phone) customer = { code, name, phone };
      }
      setPendingCustomer(customer);
      setQuickOpen(true);
    }
    window.addEventListener('open-quick-followup', openQuick);
    return () => window.removeEventListener('open-quick-followup', openQuick);
  }, []);

  useEffect(() => {
    const refresh = () => setWorkspaceVersion((current) => current + 1);
    const events = ['customer-followup-updated', 'customer-followup-branch-transferred', 'customer-followup-data-corrected', 'customer-followup-imported'];
    events.forEach((eventName) => window.addEventListener(eventName, refresh));
    return () => events.forEach((eventName) => window.removeEventListener(eventName, refresh));
  }, []);

  const refreshWorkspace = () => setWorkspaceVersion((current) => current + 1);
  const openExceptional = () => {
    setSection('followups');
    setFollowupView('exceptional');
    setExceptionalOpen(true);
  };

  const selectSection = (next: MainSection) => {
    setSection(next);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  return <div className="customer-service-page min-h-screen space-y-4" dir="rtl">
    <section className="sticky top-0 z-40 border-b border-cyan-300/15 bg-[#071827]/95 px-3 py-3 shadow-2xl shadow-black/20 backdrop-blur-xl md:px-5">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-400">
              <span className="rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2.5 py-1 text-cyan-200">مركز خدمة العملاء</span>
              <span>الفرع: {normalizedUserBranch || (managerView ? 'كل الفروع حسب الصلاحية' : 'غير محدد')}</span>
            </div>
            <h1 className="text-xl font-black text-white md:text-2xl">تنفيذ يومي واضح وسريع للدكاترة وخدمة العملاء</h1>
            <p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-slate-400">تم تجميع الصفحة في خمس مساحات فقط. ابدأ من «اليوم»، ثم انتقل للمتابعات أو الأداء أو الأدوات عند الحاجة. كل الوظائف القديمة ما زالت موجودة لكن بدون ازدحام في شريط واحد.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {section !== 'today' ? <button type="button" onClick={() => selectSection('today')} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-black text-slate-200 hover:border-cyan-300/30 hover:bg-white/[0.07]"><Workflow className="ml-1 inline" size={16}/> الرجوع لقائمة اليوم</button> : null}
            <button type="button" onClick={() => setQuickOpen(true)} className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-400/20"><Plus className="ml-1 inline" size={16}/> متابعة سريعة</button>
            <button type="button" onClick={openExceptional} className="rounded-xl border-2 border-amber-200 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 shadow-lg hover:bg-amber-400"><Sparkles className="ml-1 inline" size={16}/> متابعة استثنائية</button>
          </div>
        </div>

        <nav className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="أقسام خدمة العملاء الرئيسية">
          {mainSections.map(({ id, title, description, icon: Icon }) => {
            const active = id === section;
            return <button key={id} type="button" onClick={() => selectSection(id)} className={`rounded-2xl border px-3 py-3 text-right transition ${active ? 'border-cyan-300/60 bg-cyan-400/15 shadow-lg shadow-cyan-950/30' : 'border-white/10 bg-white/[0.035] hover:border-cyan-300/30 hover:bg-white/[0.06]'}`} aria-pressed={active}>
              <span className="flex items-center gap-2"><Icon size={17} className={id === 'followups' ? 'text-amber-200' : id === 'tools' ? 'text-violet-300' : 'text-cyan-300'}/><span className={`block text-sm font-black ${active ? 'text-cyan-200' : 'text-white'}`}>{title}</span></span>
              <span className="mt-1 hidden text-[11px] font-bold text-slate-400 md:block">{description}</span>
            </button>;
          })}
        </nav>

        {section === 'followups' ? <nav className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/15 p-2 md:grid-cols-4" aria-label="حالات المتابعة">
          {followupViews.map(({ id, title, description, icon: Icon }) => {
            const active = id === followupView;
            return <button key={id} type="button" onClick={() => setFollowupView(id)} className={`rounded-xl border px-3 py-2.5 text-right transition ${active ? 'border-amber-300/50 bg-amber-400/10' : 'border-white/5 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]'}`} aria-pressed={active}>
              <span className="flex items-center gap-2"><Icon size={15} className={id === 'exceptional' ? 'text-amber-300' : id === 'no_answer' ? 'text-rose-300' : 'text-slate-300'}/><span className={`text-xs font-black ${active ? 'text-amber-100' : 'text-slate-200'}`}>{title}</span></span>
              <span className="mt-1 hidden text-[10px] font-bold text-slate-500 xl:block">{description}</span>
            </button>;
          })}
        </nav> : null}

        {section === 'tools' ? <nav className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/15 p-2" aria-label="أدوات خدمة العملاء">
          {toolsViews.map(({ id, title, description, icon: Icon }) => {
            const active = id === toolsView;
            return <button key={id} type="button" onClick={() => setToolsView(id)} className={`rounded-xl border px-3 py-2.5 text-right transition ${active ? 'border-violet-300/50 bg-violet-400/10' : 'border-white/5 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]'}`} aria-pressed={active}>
              <span className="flex items-center gap-2"><Icon size={15} className="text-violet-300"/><span className={`text-xs font-black ${active ? 'text-violet-100' : 'text-slate-200'}`}>{title}</span></span>
              <span className="mt-1 hidden text-[10px] font-bold text-slate-500 md:block">{description}</span>
            </button>;
          })}
        </nav> : null}
      </div>
    </section>

    <main className="mx-auto max-w-[1800px] px-0 pb-8">
      {!hasSafeBranchScope && section !== 'reports' ? <MissingBranchGuard/> : null}

      {hasSafeBranchScope && section === 'today' ? <div className="space-y-4"><CustomerServiceDoctorWorkbookCenter onImported={refreshWorkspace}/><CustomerDailyPriorityQueues/><CustomerFollowupOperationsHub version={workspaceVersion}/></div> : null}

      {hasSafeBranchScope && section === 'followups' && followupView === 'waiting' ? <CustomerFollowupRecordsAndPerformance key={`waiting-${workspaceVersion}`} mode="waiting" /> : null}
      {hasSafeBranchScope && section === 'followups' && followupView === 'no_answer' ? <CustomerFollowupRecordsAndPerformance key={`no-answer-${workspaceVersion}`} mode="no_answer" /> : null}
      {hasSafeBranchScope && section === 'followups' && followupView === 'exceptional' ? <ExceptionalFollowupCenter key={`exceptional-${workspaceVersion}`} /> : null}
      {hasSafeBranchScope && section === 'followups' && followupView === 'completed' ? <CustomerFollowupRecordsAndPerformance key={`completed-${workspaceVersion}`} mode="completed" /> : null}

      {hasSafeBranchScope && section === 'performance' ? <CustomerServiceStaffPerformancePanel key={`performance-${workspaceVersion}`} /> : null}

      {hasSafeBranchScope && section === 'tools' && toolsView === 'data' ? <div className="space-y-4"><CustomerFollowupFinalQualityPanel/><CustomerFollowupOperationsCompletionPanel/><Suspense fallback={<SectionLoader label="أدوات تصحيح البيانات"/>}><CustomerServiceDataTools/></Suspense></div> : null}
      {hasSafeBranchScope && section === 'tools' && toolsView === 'content' ? <Suspense fallback={<SectionLoader label="محرر السكريبتات"/>}><CustomerServiceScriptEditor/></Suspense> : null}

      {section === 'reports' ? <div className="space-y-4"><CustomerFollowupFullExportPanel/>{hasSafeBranchScope ? <Suspense fallback={<SectionLoader label="نقاط العملاء والكاش باك"/>}><CustomerCashback/></Suspense> : null}</div> : null}
    </main>

    <QuickFollowupModal
      key={`${quickOpen}-${pendingCustomer?.code || ''}`}
      open={quickOpen}
      onClose={() => { setQuickOpen(false); setPendingCustomer(null); }}
      onCreated={refreshWorkspace}
      defaultBranch={normalizedUserBranch}
      initialCustomerCode={pendingCustomer?.code || null}
      initialCustomerName={pendingCustomer?.name || null}
      initialCustomerPhone={pendingCustomer?.phone || null}
    />
    <ExceptionalFollowupModal open={exceptionalOpen} onClose={() => setExceptionalOpen(false)} onCreated={() => { refreshWorkspace(); setSection('followups'); setFollowupView('exceptional'); }} />
  </div>;
}
