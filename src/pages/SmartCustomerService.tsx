import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Database,
  FileSpreadsheet,
  HeadphonesIcon,
  History,
  ListChecks,
  MessageSquareText,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Workflow,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import CustomerFollowupCockpitPanel from '@/components/customerService/CustomerFollowupCockpitPanel';
import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerFollowupOperationsCompletionPanel from '@/components/customerService/CustomerFollowupOperationsCompletionPanel';
import CustomerFollowupFinalQualityPanel from '@/components/customerService/CustomerFollowupFinalQualityPanel';
import CustomerFollowupRecordsAndPerformance from '@/components/customerService/CustomerFollowupRecordsAndPerformance';
import CustomerHistoricalFollowupLedger from '@/components/customerService/CustomerHistoricalFollowupLedger';
import CustomerDailyPriorityQueues from '@/components/customerService/CustomerDailyPriorityQueues';
import CustomerServiceDoctorWorkbookCenter from '@/components/customerService/CustomerServiceDoctorWorkbookCenter';
import ExceptionalFollowupCenter from '@/components/customerService/ExceptionalFollowupCenter';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import ExceptionalFollowupModal from '@/components/customerService/ExceptionalFollowupModal';
import SectionErrorBoundary, { SectionSkeleton } from '@/components/customerService/SectionBoundary';
import '@/styles/customerServiceTheme.css';

const CustomerServiceDataTools = lazy(() => import('@/components/customerService/CustomerServiceDataTools'));
const CustomerServiceScriptEditor = lazy(() => import('@/components/customerService/CustomerServiceScriptEditor'));
const CustomerCashback = lazy(() => import('@/pages/CustomerCashback'));
// lazy عشان مكتبة الرسم البياني (recharts) متتحملش مع الحزمة الأساسية للصفحة إلا لما المستخدم يفتح تبويب الأداء فعلًا
const CustomerFollowupPerformancePanel = lazy(() => import('@/components/customerService/CustomerFollowupPerformancePanel'));

// ============================================================================
// هيكل تنقل مبسّط: 4 مساحات عمل رئيسية فقط بدل 5 أقسام + تابات متداخلة كتير.
// كل مساحة عندها Secondary tabs قليلة (لو محتاجة)، وتنفيذ اليوم نفسه بيدير
// التابات الداخلية بتاعته (قائمة اليوم / انتظار الرد / مراجعة) من جوه الكومبوننت.
// ============================================================================
type Workspace = 'execution' | 'customers' | 'log' | 'reports';
type CustomersTab = 'priorities' | 'doctors';
type LogTab = 'ledger' | 'exceptional' | 'completed';
type ReportsTab = 'performance' | 'exports' | 'quality' | 'scripts' | 'cashback';

type NavItem<T extends string> = { id: T; title: string; icon: typeof Workflow };

// لون شارة زخرفي مميز لكل مساحة عمل (للتفرقة البصرية بسرعة) — منفصل تمامًا عن ألوان
// الحالة الدلالية (Cyan=إجراء رئيسي فعّال، Amber=تنبيه، Red=خطر، Green=نجاح) عشان محدش
// يفهم شارة تنقل عادية على إنها تحذير.
const workspaceItems: Array<NavItem<Workspace> & { chip: string }> = [
  { id: 'execution', title: 'التنفيذ اليومي', icon: Workflow, chip: 'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' },
  { id: 'customers', title: 'العملاء والأولويات', icon: Target, chip: 'bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' },
  { id: 'log', title: 'السجل والمتابعات', icon: History, chip: 'bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' },
  { id: 'reports', title: 'التقارير والإدارة', icon: BarChart3, chip: 'bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' },
];

const customersTabs: NavItem<CustomersTab>[] = [
  { id: 'priorities', title: 'الأولويات', icon: ListChecks },
  { id: 'doctors', title: 'ملف الدكاترة', icon: FileSpreadsheet },
];

const logTabs: NavItem<LogTab>[] = [
  { id: 'ledger', title: 'سجل المتابعات', icon: History },
  { id: 'exceptional', title: 'الاستثنائي', icon: Sparkles },
  { id: 'completed', title: 'المكتمل', icon: Clock3 },
];

const reportsTabs: NavItem<ReportsTab>[] = [
  { id: 'performance', title: 'الأداء', icon: BarChart3 },
  { id: 'exports', title: 'التقارير', icon: FileSpreadsheet },
  { id: 'quality', title: 'البيانات والجودة', icon: Database },
  { id: 'scripts', title: 'السكريبتات', icon: MessageSquareText },
  { id: 'cashback', title: 'الكاش باك', icon: Sparkles },
];

const NAV_STORAGE_KEY = 'dawaa_customer_service_nav_v2';

type StoredNav = { workspace?: Workspace; customersTab?: CustomersTab; logTab?: LogTab; reportsTab?: ReportsTab };

function readStoredNav(): StoredNav {
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredNav) : {};
  } catch {
    return {};
  }
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SectionErrorBoundary label={label}>
      <Suspense fallback={<SectionSkeleton label={label} />}>{children}</Suspense>
    </SectionErrorBoundary>
  );
}

function MissingBranchGuard() {
  return <section className="mt-4 rounded-3xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-6 text-center" dir="rtl"><AlertTriangle className="mx-auto text-[var(--dawaa-status-warning-text)]" size={34}/><h2 className="mt-3 text-xl font-black text-[var(--dawaa-theme-heading)]">لا يمكن فتح مساحة التشغيل بدون فرع محدد</h2><p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-7 text-[var(--dawaa-status-warning-text)]">الحساب الحالي غير مربوط بفرع الشامي أو فرع شكري. تم إيقاف تحميل بيانات العملاء بدل فتح فرع افتراضي أو إظهار بيانات فرع آخر.</p></section>;
}

function TabRow<T extends string>({ items, value, onChange, label }: {
  items: NavItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return <nav className="flex flex-wrap gap-1.5" aria-label={label}>
    {items.map(({ id, title, icon: Icon }) => {
      const active = id === value;
      return <button key={id} type="button" onClick={() => onChange(id)} className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition ${active ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-text)] hover:border-[var(--dawaa-theme-border)] hover:bg-[var(--dawaa-theme-surface-2)]'}`} aria-pressed={active}>
        <Icon size={13}/>{title}
      </button>;
    })}
  </nav>;
}

function formatClock(date: Date | null) {
  if (!date) return '—';
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

export default function SmartCustomerService() {
  const { user } = useAuth();
  const stored = useMemo(readStoredNav, []);
  const [workspace, setWorkspace] = useState<Workspace>(stored.workspace || 'execution');
  const [customersTab, setCustomersTab] = useState<CustomersTab>(stored.customersTab || 'priorities');
  const [logTab, setLogTab] = useState<LogTab>(stored.logTab || 'ledger');
  const [reportsTab, setReportsTab] = useState<ReportsTab>(stored.reportsTab || 'performance');
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [exceptionalOpen, setExceptionalOpen] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<{ code: string; name: string; phone: string } | null>(null);
  const managerView = canViewAllBranches(user);
  const normalizedUserBranch = useMemo(() => normalizeBranchName(user?.branch || ''), [user?.branch]);
  const hasSafeBranchScope = managerView || Boolean(normalizedUserBranch);

  // نحفظ آخر مساحة عمل وتابات فرعية مفتوحة فقط (تنقل بحت، من غير أي بيانات حساسة)
  // عشان المستخدم يرجع لنفس المكان لو قفل التاب أو عمل رفرش.
  useEffect(() => {
    try {
      sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ workspace, customersTab, logTab, reportsTab }));
    } catch {
      // تخزين تفضيل تنقل بس؛ لو فشل (خصوصية متصفح صارمة) نكمل عادي من غير ما نوقف الصفحة.
    }
  }, [workspace, customersTab, logTab, reportsTab]);

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
        const storedCustomer = sessionStorage.getItem('dawaa_pending_followup_customer');
        if (storedCustomer) {
          sessionStorage.removeItem('dawaa_pending_followup_customer');
          const parsed = JSON.parse(storedCustomer) as { code?: string; name?: string; phone?: string };
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
    const refresh = () => { setWorkspaceVersion((current) => current + 1); setLastUpdatedAt(new Date()); };
    const events = ['customer-followup-updated', 'customer-followup-branch-transferred', 'customer-followup-data-corrected', 'customer-followup-imported'];
    events.forEach((eventName) => window.addEventListener(eventName, refresh));
    return () => events.forEach((eventName) => window.removeEventListener(eventName, refresh));
  }, []);

  const refreshWorkspace = () => { setWorkspaceVersion((current) => current + 1); setLastUpdatedAt(new Date()); };
  const openExceptional = () => {
    setWorkspace('log');
    setLogTab('exceptional');
    setExceptionalOpen(true);
  };

  return <div className="customer-service-page min-h-screen space-y-3" dir="rtl">
    <section className="sticky top-0 z-40 rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface-raised)] px-3 py-2.5 shadow-lg  backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]"><HeadphonesIcon size={17}/></span>
          <h1 className="text-lg font-black text-[var(--dawaa-theme-heading)]">متابعة العملاء</h1>
          <span className="rounded-full border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-2.5 py-1 text-[11px] font-black text-[var(--dawaa-theme-primary)]">{normalizedUserBranch || (managerView ? 'كل الفروع' : 'غير محدد')}</span>
          <span className="hidden items-center gap-1 text-[11px] font-bold text-[var(--dawaa-theme-text)] sm:flex"><Clock3 size={12}/> آخر تحديث {formatClock(lastUpdatedAt)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={refreshWorkspace} className="flex items-center gap-1.5 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] px-3 py-1.5 text-xs font-black text-[var(--dawaa-theme-text)] hover:bg-[var(--dawaa-theme-surface-2)]"><RefreshCw size={14}/> تحديث</button>
          <button type="button" onClick={() => setQuickOpen(true)} className="flex items-center gap-1.5 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-3 py-1.5 text-xs font-black text-[var(--dawaa-theme-primary)] hover:bg-[var(--dawaa-theme-accent-soft)]"><Plus size={14}/> متابعة سريعة</button>
          <button type="button" onClick={openExceptional} className="flex items-center gap-1.5 rounded-xl border-2 border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-1.5 text-xs font-black text-[var(--dawaa-theme-heading)] hover:bg-[var(--dawaa-status-warning-bg)]"><Sparkles size={14}/> متابعة استثنائية</button>
        </div>
      </div>

      <nav className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="مساحات العمل الرئيسية لخدمة العملاء">
        {workspaceItems.map(({ id, title, icon: Icon, chip }) => {
          const active = id === workspace;
          return <button key={id} type="button" onClick={() => setWorkspace(id)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-black transition ${active ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)] shadow-lg shadow-cyan-950/20' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-text)] hover:border-[var(--dawaa-theme-accent-border)] hover:bg-[var(--dawaa-theme-surface-2)]'}`} aria-pressed={active}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${active ? 'bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : chip}`}><Icon size={15}/></span>{title}
          </button>;
        })}
      </nav>

      {workspace === 'customers' ? <div className="mt-2"><TabRow items={customersTabs} value={customersTab} onChange={(value: CustomersTab) => setCustomersTab(value)} label="العملاء والأولويات"/></div> : null}
      {workspace === 'log' ? <div className="mt-2"><TabRow items={logTabs} value={logTab} onChange={(value: LogTab) => setLogTab(value)} label="السجل والمتابعات"/></div> : null}
      {workspace === 'reports' ? <div className="mt-2"><TabRow items={reportsTabs} value={reportsTab} onChange={(value: ReportsTab) => setReportsTab(value)} label="التقارير والإدارة"/></div> : null}
    </section>

    <main className="space-y-3 pb-8">
    {/* key بيتغير مع أي تبويب فرعي أو رئيسي عشان المحتوى يظهر بـ fade خفيف بدل القفزة الفجائية */}
    <div key={`${workspace}-${customersTab}-${logTab}-${reportsTab}`} className="animate-fade-in space-y-3">
      {!hasSafeBranchScope && workspace !== 'reports' ? <MissingBranchGuard/> : null}

      {hasSafeBranchScope && workspace === 'execution' ? <Section label="مركز التنفيذ"><CustomerFollowupCockpitPanel key={`execution-${workspaceVersion}`} /></Section> : null}

      {hasSafeBranchScope && workspace === 'customers' && customersTab === 'priorities' ? <Section label="أولويات العملاء"><CustomerDailyPriorityQueues/></Section> : null}
      {hasSafeBranchScope && workspace === 'customers' && customersTab === 'doctors' ? <Section label="ملف الدكاترة"><CustomerServiceDoctorWorkbookCenter onImported={refreshWorkspace}/></Section> : null}

      {hasSafeBranchScope && workspace === 'log' && logTab === 'ledger' ? <Section label="سجل المتابعات"><CustomerHistoricalFollowupLedger key={`ledger-${workspaceVersion}`} /></Section> : null}
      {hasSafeBranchScope && workspace === 'log' && logTab === 'exceptional' ? <Section label="المتابعات الاستثنائية"><ExceptionalFollowupCenter key={`exceptional-${workspaceVersion}`} /></Section> : null}
      {hasSafeBranchScope && workspace === 'log' && logTab === 'completed' ? <Section label="المتابعات المكتملة"><CustomerFollowupRecordsAndPerformance key={`completed-${workspaceVersion}`} mode="completed" /></Section> : null}

      {hasSafeBranchScope && workspace === 'reports' && reportsTab === 'performance' ? <Section label="أداء المتابعات"><CustomerFollowupPerformancePanel/></Section> : null}
      {workspace === 'reports' && reportsTab === 'exports' ? <Section label="التصدير والتقارير"><CustomerFollowupFullExportPanel/></Section> : null}
      {hasSafeBranchScope && workspace === 'reports' && reportsTab === 'quality' ? <div className="space-y-3">
        <Section label="جودة البيانات"><CustomerFollowupFinalQualityPanel/></Section>
        <Section label="استكمال التشغيل"><CustomerFollowupOperationsCompletionPanel/></Section>
        <Section label="أدوات تصحيح البيانات"><CustomerServiceDataTools/></Section>
      </div> : null}
      {hasSafeBranchScope && workspace === 'reports' && reportsTab === 'scripts' ? <Section label="محرر السكريبتات"><CustomerServiceScriptEditor/></Section> : null}
      {workspace === 'reports' && reportsTab === 'cashback' && hasSafeBranchScope ? <Section label="نقاط العملاء والكاش باك"><CustomerCashback/></Section> : null}
      {workspace === 'reports' && reportsTab === 'cashback' && !hasSafeBranchScope ? <MissingBranchGuard/> : null}
    </div>
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
    <ExceptionalFollowupModal open={exceptionalOpen} onClose={() => setExceptionalOpen(false)} onCreated={() => { refreshWorkspace(); setWorkspace('log'); setLogTab('exceptional'); }} />
  </div>;
}
