import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Database,
  FileSpreadsheet,
  History,
  ListChecks,
  MessageSquareText,
  Plus,
  Sparkles,
  Target,
  Workflow,
  Wrench,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import CustomerFollowupCockpitPanel from '@/components/customerService/CustomerFollowupCockpitPanel';
import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerFollowupOperationsCompletionPanel from '@/components/customerService/CustomerFollowupOperationsCompletionPanel';
import CustomerFollowupFinalQualityPanel from '@/components/customerService/CustomerFollowupFinalQualityPanel';
import CustomerFollowupRecordsAndPerformance from '@/components/customerService/CustomerFollowupRecordsAndPerformance';
import CustomerDailyPriorityQueues from '@/components/customerService/CustomerDailyPriorityQueues';
import CustomerServiceDoctorWorkbookCenter from '@/components/customerService/CustomerServiceDoctorWorkbookCenter';
import ExceptionalFollowupCenter from '@/components/customerService/ExceptionalFollowupCenter';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import ExceptionalFollowupModal from '@/components/customerService/ExceptionalFollowupModal';
import '@/styles/customerServiceTheme.css';

const CustomerServiceDataTools = lazy(() => import('@/components/customerService/CustomerServiceDataTools'));
const CustomerServiceScriptEditor = lazy(() => import('@/components/customerService/CustomerServiceScriptEditor'));
const CustomerCashback = lazy(() => import('@/pages/CustomerCashback'));

type MainSection = 'operations' | 'priorities' | 'followups' | 'tools' | 'reports';
type PriorityView = 'queues' | 'workbook';
type FollowupView = 'exceptional' | 'completed';
type ToolsView = 'data' | 'content';
type ReportsView = 'exports' | 'cashback';

const workspaces: Array<{ id: 'operations' | 'priorities'; title: string; description: string; icon: typeof Workflow }> = [
  { id: 'operations', title: 'مركز متابعة العملاء', description: 'تنفيذ المتابعات الحالية، انتظار الرد، المراجعة، سجل التواصل والأداء', icon: Workflow },
  { id: 'priorities', title: 'قائمة عمل مسؤول خدمة العملاء', description: 'الاسترجاع والنمو والعملاء المستقرون وVIP و+500 والنقاط وملف الدكاترة', icon: Target },
];

const supportSections: Array<{ id: 'followups' | 'tools' | 'reports'; title: string; description: string; icon: typeof Workflow }> = [
  { id: 'followups', title: 'الحالات الخاصة', description: 'الاستثنائي والمكتمل', icon: Sparkles },
  { id: 'tools', title: 'الأدوات والإدارة', description: 'الجودة والتصحيح والسكريبتات', icon: Wrench },
  { id: 'reports', title: 'التقارير والنقاط', description: 'التصدير والكاش باك', icon: History },
];

const priorityViews: Array<{ id: PriorityView; title: string; description: string; icon: typeof ListChecks }> = [
  { id: 'queues', title: 'أولويات العملاء', description: 'الاسترجاع والنمو والمستقرون وVIP و+500 والنقاط', icon: ListChecks },
  { id: 'workbook', title: 'ملف الدكاترة', description: 'تصدير ومراجعة واستيراد ملف التنفيذ', icon: FileSpreadsheet },
];

const followupViews: Array<{ id: FollowupView; title: string; description: string; icon: typeof Sparkles }> = [
  { id: 'exceptional', title: 'متابعة استثنائية', description: 'طلبات الدكاترة والحالات الخاصة التي تحتاج متابعة منفصلة', icon: Sparkles },
  { id: 'completed', title: 'المكتمل', description: 'المتابعات المنفذة والمؤرشفة للمراجعة والرجوع', icon: History },
];

const toolsViews: Array<{ id: ToolsView; title: string; description: string; icon: typeof Database }> = [
  { id: 'data', title: 'البيانات والجودة', description: 'التصحيح والفروع والتكرارات واستكمال التشغيل', icon: Database },
  { id: 'content', title: 'سكريبتات التواصل', description: 'نصوص المكالمات والواتساب المعتمدة', icon: MessageSquareText },
];

const reportsViews: Array<{ id: ReportsView; title: string; description: string; icon: typeof History }> = [
  { id: 'exports', title: 'التقارير والتصدير', description: 'تصدير البيانات والتقارير التشغيلية', icon: History },
  { id: 'cashback', title: 'النقاط والكاش باك', description: 'استحقاقات العملاء ومتابعة الكاش باك', icon: BarChart3 },
];

function SectionLoader({ label }: { label: string }) {
  return <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">جارٍ تحميل {label}...</div>;
}

function MissingBranchGuard() {
  return <section className="mx-4 mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 text-center" dir="rtl"><AlertTriangle className="mx-auto text-amber-300" size={34}/><h2 className="mt-3 text-xl font-black text-white">لا يمكن فتح مساحة التشغيل بدون فرع محدد</h2><p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-7 text-amber-100/80">الحساب الحالي غير مربوط بفرع الشامي أو فرع شكري. تم إيقاف تحميل بيانات العملاء بدل فتح فرع افتراضي أو إظهار بيانات فرع آخر.</p></section>;
}

function SecondaryNav<T extends string>({ items, value, onChange, tone = 'cyan', label }: {
  items: Array<{ id: T; title: string; description: string; icon: typeof Workflow }>;
  value: T;
  onChange: (value: T) => void;
  tone?: 'cyan' | 'amber' | 'violet';
  label: string;
}) {
  const activeClass = tone === 'amber'
    ? 'border-amber-300/50 bg-amber-400/10 text-amber-100'
    : tone === 'violet'
      ? 'border-violet-300/50 bg-violet-400/10 text-violet-100'
      : 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100';

  return <nav className={`mt-2 grid gap-2 rounded-2xl border border-white/10 bg-black/15 p-2 ${items.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`} aria-label={label}>
    {items.map(({ id, title, description, icon: Icon }) => {
      const active = id === value;
      return <button key={id} type="button" onClick={() => onChange(id)} className={`rounded-xl border px-3 py-2.5 text-right transition ${active ? activeClass : 'border-white/5 bg-white/[0.025] text-slate-200 hover:border-white/15 hover:bg-white/[0.05]'}`} aria-pressed={active}>
        <span className="flex items-center gap-2"><Icon size={15}/><span className="text-xs font-black">{title}</span></span>
        <span className="mt-1 hidden text-[10px] font-bold text-slate-500 md:block">{description}</span>
      </button>;
    })}
  </nav>;
}

export default function SmartCustomerService() {
  const { user } = useAuth();
  const [section, setSection] = useState<MainSection>('operations');
  const [priorityView, setPriorityView] = useState<PriorityView>('queues');
  const [followupView, setFollowupView] = useState<FollowupView>('exceptional');
  const [toolsView, setToolsView] = useState<ToolsView>('data');
  const [reportsView, setReportsView] = useState<ReportsView>('exports');
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
      if (detail && (detail.code || detail.name || detail.phone)) setPendingCustomer({ code: detail.code || '', name: detail.name || '', phone: detail.phone || '' });
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
          if (parsed.code || parsed.name || parsed.phone) customer = { code: parsed.code || '', name: parsed.name || '', phone: parsed.phone || '' };
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
              <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">اختيار مساحة العمل</span>
            </div>
            <h1 className="text-xl font-black text-white md:text-2xl">خدمة العملاء — اختار مساحة العمل ثم نفّذ</h1>
            <p className="mt-1 max-w-5xl text-xs font-bold leading-6 text-slate-400">اختيار رئيسي بين مركز المتابعة للتنفيذ الفعلي، وقائمة عمل المسؤول لتحليل فرص الاسترجاع والنمو والعملاء المهمين. باقي الأدوات منفصلة أسفل الاختيار الرئيسي.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setQuickOpen(true)} className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-400/20"><Plus className="ml-1 inline" size={16}/> متابعة سريعة</button>
            <button type="button" onClick={openExceptional} className="rounded-xl border-2 border-amber-200 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 shadow-lg hover:bg-amber-400"><Sparkles className="ml-1 inline" size={16}/> متابعة استثنائية</button>
          </div>
        </div>

        <nav className="grid gap-2 md:grid-cols-2" aria-label="مساحات العمل الرئيسية لخدمة العملاء">
          {workspaces.map(({ id, title, description, icon: Icon }) => {
            const active = id === section;
            return <button key={id} type="button" onClick={() => selectSection(id)} className={`rounded-2xl border px-4 py-3 text-right transition ${active ? 'border-cyan-300/70 bg-cyan-400/15 shadow-lg shadow-cyan-950/30' : 'border-white/10 bg-white/[0.035] hover:border-cyan-300/30 hover:bg-white/[0.06]'}`} aria-pressed={active}>
              <span className="flex items-center gap-3"><span className={`rounded-xl p-2 ${active ? 'bg-cyan-300/15 text-cyan-200' : 'bg-white/5 text-slate-300'}`}><Icon size={20}/></span><span><span className={`block text-sm font-black md:text-base ${active ? 'text-cyan-100' : 'text-white'}`}>{title}</span><span className="mt-1 block text-[11px] font-bold text-slate-400">{description}</span></span></span>
            </button>;
          })}
        </nav>

        <nav className="mt-2 grid grid-cols-3 gap-2" aria-label="المساحات المساعدة لخدمة العملاء">
          {supportSections.map(({ id, title, description, icon: Icon }) => {
            const active = id === section;
            return <button key={id} type="button" onClick={() => selectSection(id)} className={`rounded-xl border px-3 py-2 text-right transition ${active ? 'border-violet-300/50 bg-violet-400/10' : 'border-white/5 bg-black/10 hover:border-white/15 hover:bg-white/[0.04]'}`} aria-pressed={active}>
              <span className="flex items-center gap-2"><Icon size={15} className={id === 'followups' ? 'text-amber-200' : id === 'tools' ? 'text-violet-300' : 'text-cyan-300'}/><span className="text-xs font-black text-white">{title}</span></span>
              <span className="mt-1 hidden text-[10px] font-bold text-slate-500 md:block">{description}</span>
            </button>;
          })}
        </nav>

        {section === 'priorities' ? <SecondaryNav items={priorityViews} value={priorityView} onChange={(value) => setPriorityView(value as PriorityView)} label="قائمة عمل مسؤول خدمة العملاء"/> : null}
        {section === 'followups' ? <SecondaryNav items={followupViews} value={followupView} onChange={(value) => setFollowupView(value as FollowupView)} tone="amber" label="الحالات الخاصة"/> : null}
        {section === 'tools' ? <SecondaryNav items={toolsViews} value={toolsView} onChange={(value) => setToolsView(value as ToolsView)} tone="violet" label="أدوات خدمة العملاء"/> : null}
        {section === 'reports' ? <SecondaryNav items={reportsViews} value={reportsView} onChange={(value) => setReportsView(value as ReportsView)} label="التقارير والنقاط"/> : null}
      </div>
    </section>

    <main className="mx-auto max-w-[1800px] px-0 pb-8">
      {!hasSafeBranchScope && section !== 'reports' ? <MissingBranchGuard/> : null}
      {hasSafeBranchScope && section === 'operations' ? <CustomerFollowupCockpitPanel key={`operations-${workspaceVersion}`} /> : null}
      {hasSafeBranchScope && section === 'priorities' && priorityView === 'queues' ? <CustomerDailyPriorityQueues/> : null}
      {hasSafeBranchScope && section === 'priorities' && priorityView === 'workbook' ? <CustomerServiceDoctorWorkbookCenter onImported={refreshWorkspace}/> : null}
      {hasSafeBranchScope && section === 'followups' && followupView === 'exceptional' ? <ExceptionalFollowupCenter key={`exceptional-${workspaceVersion}`} /> : null}
      {hasSafeBranchScope && section === 'followups' && followupView === 'completed' ? <CustomerFollowupRecordsAndPerformance key={`completed-${workspaceVersion}`} mode="completed" /> : null}
      {hasSafeBranchScope && section === 'tools' && toolsView === 'data' ? <div className="space-y-4"><CustomerFollowupFinalQualityPanel/><CustomerFollowupOperationsCompletionPanel/><Suspense fallback={<SectionLoader label="أدوات تصحيح البيانات"/>}><CustomerServiceDataTools/></Suspense></div> : null}
      {hasSafeBranchScope && section === 'tools' && toolsView === 'content' ? <Suspense fallback={<SectionLoader label="محرر السكريبتات"/>}><CustomerServiceScriptEditor/></Suspense> : null}
      {section === 'reports' && reportsView === 'exports' ? <CustomerFollowupFullExportPanel/> : null}
      {section === 'reports' && reportsView === 'cashback' && hasSafeBranchScope ? <Suspense fallback={<SectionLoader label="نقاط العملاء والكاش باك"/>}><CustomerCashback/></Suspense> : null}
      {section === 'reports' && reportsView === 'cashback' && !hasSafeBranchScope ? <MissingBranchGuard/> : null}
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
