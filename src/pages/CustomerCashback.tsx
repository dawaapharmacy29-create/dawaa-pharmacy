import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Gauge, GitCompareArrows, SlidersHorizontal } from 'lucide-react';
import CustomerCashbackFast from '@/pages/CustomerCashbackFast';
import CustomerCashbackComparison from '@/pages/CustomerCashbackComparison';
import CustomerCashbackExecutiveExportButtons from '@/components/customers/CustomerCashbackExecutiveExportButtons';
import CustomerCashbackHealthPanel from '@/components/customers/CustomerCashbackHealthPanel';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';

const CustomerCashbackAdvancedSafe = lazy(() => import('@/pages/CustomerCashbackAdvancedSafe'));
const BRANCH_SCOPED_ROLES = new Set(['customer_service_manager', 'customer_service']);
type Mode = 'fast' | 'comparison' | 'advanced';

export default function CustomerCashback() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>('fast');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scopedBranch = useMemo(() => {
    if (!user || !BRANCH_SCOPED_ROLES.has(String(user.role || ''))) return '';
    const normalized = normalizeBranchName(user.branch || '');
    return BRANCHES.includes(normalized) ? normalized : '';
  }, [user?.branch, user?.role]);

  // Keep the old raw one-sheet exporter hidden on the fast page. The canonical
  // executive workbook is exposed above the operational list.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || mode !== 'fast') return;
    const hideLegacyExcel = () => {
      root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        if (button.textContent?.trim() === 'Excel') {
          button.style.display = 'none';
          button.dataset.legacyCashbackExport = 'hidden';
          button.setAttribute('aria-hidden', 'true');
        }
      });
    };
    hideLegacyExcel();
    const observer = new MutationObserver(hideLegacyExcel);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mode]);

  return (
    <div ref={rootRef}>
      <div dir="rtl" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-teal-400/20 bg-teal-500/5 px-4 py-3">
        <div className="text-sm font-black text-teal-100">
          {scopedBranch ? `نطاق خدمة العملاء: ${scopedBranch} فقط` : 'نقاط العملاء — تحميل سريع وتحليل دورات'}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={mode === 'fast' ? 'dawaa-button-primary' : 'btn-secondary'} onClick={() => setMode('fast')}>
            <Gauge className="h-4 w-4" /> الدورة الحالية
          </button>
          <button type="button" className={mode === 'comparison' ? 'dawaa-button-primary' : 'btn-secondary'} onClick={() => setMode('comparison')}>
            <GitCompareArrows className="h-4 w-4" /> مقارنة الدورات
          </button>
          <button type="button" className={mode === 'advanced' ? 'dawaa-button-primary' : 'btn-secondary'} onClick={() => setMode('advanced')}>
            <SlidersHorizontal className="h-4 w-4" /> أدوات متقدمة
          </button>
        </div>
      </div>

      {mode === 'fast' ? <CustomerCashbackHealthPanel forcedBranch={scopedBranch} /> : null}
      {mode === 'fast' ? <CustomerCashbackExecutiveExportButtons forcedBranch={scopedBranch} /> : null}

      {mode === 'advanced' ? (
        <Suspense fallback={<div dir="rtl" className="dawaa-panel p-8 text-center font-bold">جارٍ تحميل الأدوات المتقدمة الآمنة…</div>}>
          <CustomerCashbackAdvancedSafe forcedBranch={scopedBranch} />
        </Suspense>
      ) : mode === 'comparison' ? (
        <CustomerCashbackComparison forcedBranch={scopedBranch} />
      ) : (
        <CustomerCashbackFast forcedBranch={scopedBranch} />
      )}
    </div>
  );
}
