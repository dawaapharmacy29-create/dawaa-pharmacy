import { lazy, Suspense } from 'react';
import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerFollowupOperationsCompletionPanel from '@/components/customerService/CustomerFollowupOperationsCompletionPanel';

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

function SectionLoader({ label }: { label: string }) {
  return (
    <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-[#10243d] p-5 text-center text-sm font-black text-slate-300">
      جارٍ تحميل {label}...
    </div>
  );
}

export default function SmartCustomerService() {
  return (
    <div className="customer-service-page" dir="rtl">
      <CustomerFollowupFullExportPanel />
      <CustomerFollowupOperationsCompletionPanel />
      <Suspense fallback={<SectionLoader label="أدوات البيانات" />}>
        <CustomerServiceDataTools />
      </Suspense>
      <Suspense fallback={<SectionLoader label="محرر السكريبتات" />}>
        <CustomerServiceScriptEditor />
      </Suspense>
      <Suspense fallback={<SectionLoader label="سجل العمليات" />}>
        <CustomerServiceOperationsPanel />
      </Suspense>
      <Suspense fallback={<SectionLoader label="قائمة المتابعات" />}>
        <UnifiedCustomerServiceWorkspace />
      </Suspense>
    </div>
  );
}
