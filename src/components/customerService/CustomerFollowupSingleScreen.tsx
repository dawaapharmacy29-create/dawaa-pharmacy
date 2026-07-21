import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Command,
  DatabaseZap,
  History,
  Inbox,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import CustomerFollowupCockpitPanel from '@/components/customerService/CustomerFollowupCockpitPanel';
import CustomerFollowupBranchReviewPanel from '@/components/customerService/CustomerFollowupBranchReviewPanel';
import CustomerBranchTransferPanel from '@/components/customerService/CustomerBranchTransferPanel';
import CustomerFollowupStructuredActionsPanel from '@/components/customerService/CustomerFollowupStructuredActionsPanel';
import CustomerServiceCommandOverview from '@/components/customerService/CustomerServiceCommandOverview';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';

const CustomerServiceOperationsPanel = lazy(() => import('@/components/customerService/CustomerServiceOperationsPanel'));

type Mode = 'cockpit' | 'history';
type ToolsTab = 'overview' | 'review' | 'transfer' | 'actions';

type ModeCard = {
  id: Mode;
  title: string;
  description: string;
  icon: typeof Inbox;
  shortcut: string;
};

type ToolsCard = {
  id: ToolsTab;
  title: string;
  description: string;
  icon: typeof Wrench;
  managerOnly?: boolean;
};

const modes: ModeCard[] = [
  { id: 'cockpit', title: 'قائمة التشغيل', description: 'المطلوب الآن والمتأخر وانتظار الرد والمواعيد القادمة', icon: Inbox, shortcut: '1' },
  { id: 'history', title: 'السجل التاريخي', description: 'المكتمل والملغي والمؤرشف بدون خلطه بقائمة اليوم', icon: History, shortcut: '2' },
];

const tools: ToolsCard[] = [
  { id: 'overview', title: 'نظرة الإدارة', description: 'ملخص الأداء وحالة التشغيل', icon: LayoutDashboard },
  { id: 'review', title: 'مراجعة الفروع', description: 'التدقيق والمراجعة الإدارية', icon: ShieldCheck, managerOnly: true },
  { id: 'transfer', title: 'تحويل العملاء', description: 'نقل العميل للفرع الصحيح', icon: ArrowLeftRight },
  { id: 'actions', title: 'الإجراءات المنظمة', description: 'التصحيح والإغلاق والإجراءات المتقدمة', icon: DatabaseZap },
];

function Loader({ label }: { label: string }) {
  return (
    <div className="rounded-3xl border border-cyan-300/10 bg-[#10243d] p-8 text-center text-sm font-black text-slate-300">
      <Sparkles className="mx-auto mb-3 animate-pulse text-cyan-300" size={24} />
      جارٍ تحميل {label}...
    </div>
  );
}

export default function CustomerFollowupSingleScreen({ version }: { version: number }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const [mode, setMode] = useState<Mode>('cockpit');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<ToolsTab>('overview');
  const [focusMode, setFocusMode] = useState(false);

  const visibleTools = useMemo(() => tools.filter((item) => !item.managerOnly || managerView), [managerView]);

  useEffect(() => {
    if (!toolsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toolsOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === '1') setMode('cockpit');
      if (event.key === '2') setMode('history');
      if (event.key.toLowerCase() === 'a') {
        setToolsTab('overview');
        setToolsOpen(true);
      }
      if (event.key.toLowerCase() === 'f') setFocusMode((value) => !value);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const openTools = (tab: ToolsTab = 'overview') => {
    setToolsTab(tab);
    setToolsOpen(true);
  };

  const refreshWorkspace = () => window.dispatchEvent(new CustomEvent('customer-followup-updated'));

  return (
    <div className={`min-h-[calc(100vh-7rem)] pb-24 md:pb-0 ${focusMode ? 'space-y-2' : 'space-y-3'}`} dir="rtl">
      {!focusMode ? (
        <section className="mx-4 overflow-hidden rounded-3xl border border-cyan-300/15 bg-gradient-to-l from-[#0d263f] via-[#0a2036] to-[#071827] shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-6">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black">
                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-200"><Activity className="ml-1 inline" size={13} /> مركز تشغيل مباشر</span>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-cyan-200">فرع المستخدم: {user?.branch || 'غير محدد'}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300"><Command className="ml-1 inline" size={13} /> اختصارات: 1 تشغيل · 2 سجل · A إدارة · F تركيز</span>
              </div>
              <h2 className="text-2xl font-black text-white md:text-3xl">مركز متابعة العملاء</h2>
              <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-slate-300">شاشة تشغيل واحدة تجمع قائمة العمل، ملف العميل، الإجراءات، السجل، والتحويلات بدون تكرار أو قوائم طويلة أسفل بعضها.</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[34rem]">
              <button type="button" onClick={() => openTools('overview')} className="group flex items-center justify-between gap-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-right transition hover:border-cyan-200/40 hover:bg-cyan-400/15">
                <div><div className="font-black text-white">أدوات الإدارة والتصحيح</div><div className="mt-1 text-xs font-bold text-slate-400">تفتح كمساحة جانبية مستقلة</div></div>
                <Wrench className="text-cyan-300 transition group-hover:rotate-12" size={22} />
              </button>
              <button type="button" onClick={() => setFocusMode(true)} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right transition hover:border-cyan-300/30 hover:bg-white/[0.07]">
                <div><div className="font-black text-white">وضع التركيز</div><div className="mt-1 text-xs font-bold text-slate-400">إخفاء المقدمة وتوسيع مساحة العمل</div></div>
                <Maximize2 className="text-cyan-300" size={22} />
              </button>
            </div>
          </div>

          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:max-w-3xl xl:p-4">
            {modes.map(({ id, title, description, icon: Icon, shortcut }) => {
              const active = mode === id;
              return (
                <button key={id} type="button" onClick={() => setMode(id)} className={`rounded-2xl border px-4 py-3 text-right transition ${active ? 'border-cyan-300/60 bg-cyan-400/15 shadow-lg shadow-cyan-950/30' : 'border-white/10 bg-white/[0.03] hover:border-cyan-300/30 hover:bg-white/[0.06]'}`} aria-pressed={active}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2"><span className={`rounded-xl p-2 ${active ? 'bg-cyan-300/15 text-cyan-200' : 'bg-white/5 text-slate-300'}`}><Icon size={18} /></span><span className={`font-black ${active ? 'text-cyan-100' : 'text-white'}`}>{title}</span></div>
                    <kbd className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-black text-slate-400">{shortcut}</kbd>
                  </div>
                  <p className="mt-2 text-xs font-bold leading-6 text-slate-400">{description}</p>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={`mx-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#091b2d]/95 p-2 shadow-lg backdrop-blur ${focusMode ? 'sticky top-2 z-30' : ''}`}>
        <div className="flex flex-wrap gap-2">
          {modes.map(({ id, title, icon: Icon }) => {
            const active = mode === id;
            return <button key={id} type="button" onClick={() => setMode(id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${active ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300 hover:bg-white/5'}`} aria-pressed={active}><Icon size={16} /> {title}</button>;
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={refreshWorkspace} title="تحديث مساحة المتابعات"><RefreshCw size={16} /> تحديث</button>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => openTools('overview')}><Wrench size={16} /> الإدارة</button>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => setFocusMode((value) => !value)}>{focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {focusMode ? 'إظهار المقدمة' : 'تركيز'}</button>
        </div>
      </section>

      <main className="min-h-0">
        {mode === 'cockpit' ? <CustomerFollowupCockpitPanel key={`cockpit-${version}`} /> : null}
        {mode === 'history' ? <div className="mx-4 rounded-3xl border border-white/10 bg-[#091b2d] p-3 shadow-xl"><Suspense fallback={<Loader label="سجل المتابعات" />}><CustomerServiceOperationsPanel key={`history-${version}`} /></Suspense></div> : null}
      </main>

      <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-3 gap-2 rounded-2xl border border-cyan-300/20 bg-[#071827]/95 p-2 shadow-2xl backdrop-blur md:hidden" aria-label="التنقل السريع في المتابعات">
        <button type="button" onClick={() => setMode('cockpit')} className={`rounded-xl px-3 py-2 text-xs font-black ${mode === 'cockpit' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300'}`}><Inbox size={17} className="mx-auto mb-1"/>التشغيل</button>
        <button type="button" onClick={() => setMode('history')} className={`rounded-xl px-3 py-2 text-xs font-black ${mode === 'history' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300'}`}><History size={17} className="mx-auto mb-1"/>السجل</button>
        <button type="button" onClick={() => openTools('overview')} className="rounded-xl px-3 py-2 text-xs font-black text-slate-300"><Wrench size={17} className="mx-auto mb-1"/>الإدارة</button>
      </nav>

      {toolsOpen ? (
        <div className="fixed inset-0 z-[140] flex bg-black/75" role="dialog" aria-modal="true" aria-label="إجراءات إدارة المتابعات" onMouseDown={(event) => { if (event.target === event.currentTarget) setToolsOpen(false); }}>
          <aside className="mr-auto flex h-full w-full max-w-6xl flex-col overflow-hidden border-r border-cyan-400/20 bg-[#071827] shadow-2xl">
            <header className="border-b border-white/10 bg-[#0b2035] px-4 py-4 md:px-6">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-xs font-black text-cyan-300">مساحة الإدارة والتصحيح</p><h2 className="mt-1 text-2xl font-black text-white">إدارة المتابعات بدون إرباك قائمة التشغيل</h2><p className="mt-1 text-xs font-bold text-slate-400">كل أداة في تاب منفصل مع الحفاظ على كل الوظائف الحالية.</p></div>
                <button type="button" className="btn-secondary" onClick={() => setToolsOpen(false)} aria-label="إغلاق"><X size={18} /></button>
              </div>
              <nav className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="أقسام أدوات المتابعات">
                {visibleTools.map(({ id, title, description, icon: Icon }) => {
                  const active = toolsTab === id;
                  return <button key={id} type="button" onClick={() => setToolsTab(id)} className={`rounded-2xl border p-3 text-right transition ${active ? 'border-cyan-300/60 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`} aria-pressed={active}><div className="flex items-center gap-2"><Icon size={17} className="text-cyan-300" /><span className="font-black text-white">{title}</span></div><p className="mt-1 text-[11px] font-bold leading-5 text-slate-400">{description}</p></button>;
                })}
              </nav>
            </header>
            <div className="flex-1 overflow-y-auto overscroll-contain p-3 md:p-5">
              {toolsTab === 'overview' ? <CustomerServiceCommandOverview key={`overview-${version}`} /> : null}
              {toolsTab === 'review' && managerView ? <CustomerFollowupBranchReviewPanel /> : null}
              {toolsTab === 'transfer' ? <CustomerBranchTransferPanel key={`transfer-${version}`} /> : null}
              {toolsTab === 'actions' ? <CustomerFollowupStructuredActionsPanel key={`actions-${version}`} /> : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
