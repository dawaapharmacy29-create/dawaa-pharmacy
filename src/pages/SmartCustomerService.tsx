import { lazy, Suspense, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerFollowupOperationsCompletionPanel from '@/components/customerService/CustomerFollowupOperationsCompletionPanel';
import CustomerFollowupStructuredActionsPanel from '@/components/customerService/CustomerFollowupStructuredActionsPanel';
import CustomerFollowupFinalQualityPanel from '@/components/customerService/CustomerFollowupFinalQualityPanel';

const CustomerServiceDataTools = lazy(
  () => import('@/components/customerService/CustomerServiceDataTools')
);
const CustomerServiceScriptEditor = lazy(
  () => import('@/components/customerService/CustomerServiceScriptEditor')
);
const CustomerServiceOperationsPanel = lazy(
  () => import('@/components/customerService/CustomerServiceOperationsPanel')
);
const UnifiedCustomerServiceWorkspace = lazy(
  () => import('@/components/customerService/UnifiedCustomerServiceWorkspace')
);

type ServiceView = 'today' | 'operations' | 'data' | 'scripts' | 'export';

const views: Array<{
  id: ServiceView;
  title: string;
  description: string;
}> = [
  {
    id: 'today',
    title: 'المطلوب الآن',
    description: 'قائمة العمل اليومية فقط',
  },
  {
    id: 'operations',
    title: 'المتابعات والسجل',
    description: 'المتأخر والمؤجل والمكتمل والأرشيف',
  },
  {
    id: 'data',
    title: 'تصحيح البيانات',
    description: 'الهواتف والأكواد والفروع والتكرارات',
  },
  {
    id: 'scripts',
    title: 'سكريبتات التواصل',
    description: 'إدارة نصوص المكالمات والواتساب',
  },
  {
    id: 'export',
    title: 'التصدير والتقارير',
    description: 'تصدير السجل الكامل والنتائج',
  },
];

function SectionLoader({ label }: { label: string }) {
  return (
    <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">
      جارٍ تحميل {label}...
    </div>
  );
}

function MissingBranchGuard() {
  return (
    <section className="mx-4 mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 text-center" dir="rtl">
      <AlertTriangle className="mx-auto text-amber-300" size={34} />
      <h2 className="mt-3 text-xl font-black text-white">لا يمكن فتح قائمة المتابعات بدون فرع محدد</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-7 text-amber-100/80">
        حساب خدمة العملاء الحالي غير مربوط بفرع الشامي أو فرع شكري. تم إيقاف تحميل القائمة بدل فتح فرع افتراضي بالخطأ. راجع بيانات الحساب وحدد الفرع الصحيح ثم أعد فتح الصفحة.
      </p>
    </section>
  );
}

export default function SmartCustomerService() {
  const { user } = useAuth();
  const [view, setView] = useState<ServiceView>('today');
  const managerView = canViewAllBranches(user);
  const normalizedUserBranch = useMemo(() => normalizeBranchName(user?.branch || ''), [user?.branch]);
  const hasSafeBranchScope = managerView || Boolean(normalizedUserBranch);

  return (
    <div className="customer-service-page space-y-4" dir="rtl">
      <section className="sticky top-0 z-30 border-b border-cyan-300/15 bg-[#071827]/95 px-3 py-3 shadow-2xl shadow-black/20 backdrop-blur-xl md:px-5">
        <div className="mx-auto max-w-[1800px]">
          <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black text-cyan-300">مركز خدمة العملاء</p>
              <h1 className="text-xl font-black text-white md:text-2xl">شاشة تشغيل واضحة بدون تكديس السجل</h1>
            </div>
            <p className="text-xs font-bold text-slate-400">
              كل قسم منفصل حتى تظل قائمة اليوم سريعة وسهلة الاستخدام
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {views.map((item) => {
              const active = item.id === view;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`rounded-2xl border px-3 py-3 text-right transition ${
                    active
                      ? 'border-cyan-300/60 bg-cyan-400/15 shadow-lg shadow-cyan-950/30'
                      : 'border-white/10 bg-white/[0.035] hover:border-cyan-300/30 hover:bg-white/[0.06]'
                  }`}
                  aria-pressed={active}
                >
                  <span className={`block text-sm font-black ${active ? 'text-cyan-200' : 'text-white'}`}>
                    {item.title}
                  </span>
                  <span className="mt-1 hidden text-[11px] font-bold text-slate-400 md:block">
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1800px] px-0 pb-8">
        {!hasSafeBranchScope ? <MissingBranchGuard /> : null}

        {hasSafeBranchScope && view === 'today' ? (
          <div className="space-y-4">
            <CustomerFollowupStructuredActionsPanel />
            <Suspense fallback={<SectionLoader label="قائمة المتابعات اليومية" />}>
              <UnifiedCustomerServiceWorkspace />
            </Suspense>
          </div>
        ) : null}

        {hasSafeBranchScope && view === 'operations' ? (
          <div className="space-y-4">
            <CustomerFollowupFinalQualityPanel />
            <CustomerFollowupOperationsCompletionPanel />
            <CustomerFollowupStructuredActionsPanel />
            <Suspense fallback={<SectionLoader label="سجل العمليات" />}>
              <CustomerServiceOperationsPanel />
            </Suspense>
          </div>
        ) : null}

        {hasSafeBranchScope && view === 'data' ? (
          <Suspense fallback={<SectionLoader label="أدوات تصحيح البيانات" />}>
            <CustomerServiceDataTools />
          </Suspense>
        ) : null}

        {hasSafeBranchScope && view === 'scripts' ? (
          <Suspense fallback={<SectionLoader label="محرر السكريبتات" />}>
            <CustomerServiceScriptEditor />
          </Suspense>
        ) : null}

        {hasSafeBranchScope && view === 'export' ? <CustomerFollowupFullExportPanel /> : null}
      </main>
    </div>
  );
}
