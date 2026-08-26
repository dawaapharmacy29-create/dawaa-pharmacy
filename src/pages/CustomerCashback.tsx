import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Gauge, SlidersHorizontal } from 'lucide-react';
import CustomerCashbackFast from '@/pages/CustomerCashbackFast';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';

const CustomerCashbackBase = lazy(() => import('@/pages/CustomerCashbackBase'));
const BRANCH_SCOPED_ROLES = new Set(['customer_service_manager', 'customer_service']);

function forceSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function CustomerCashback() {
  const { user } = useAuth();
  const [advanced, setAdvanced] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scopedBranch = useMemo(() => {
    if (!user || !BRANCH_SCOPED_ROLES.has(String(user.role || ''))) return '';
    const normalized = normalizeBranchName(user.branch || '');
    return BRANCHES.includes(normalized) ? normalized : '';
  }, [user?.branch, user?.role]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !scopedBranch || !advanced) return;

    let applying = false;
    const applyBranchLock = () => {
      if (applying) return;
      applying = true;
      try {
        root.querySelectorAll('select').forEach((select) => {
          const values = Array.from(select.options).map((option) => option.value);
          const hasAllBranches = BRANCHES.every((branch) => values.includes(branch));
          if (!hasAllBranches) return;
          Array.from(select.options).forEach((option) => {
            const allowed = option.value === scopedBranch;
            option.hidden = !allowed;
            option.disabled = !allowed;
          });
          if (select.value !== scopedBranch) forceSelectValue(select, scopedBranch);
          select.disabled = true;
          select.dataset.branchLocked = 'true';
          select.setAttribute('aria-label', `الفرع: ${scopedBranch}`);
          select.title = `هذا الحساب مخصص لـ ${scopedBranch} فقط`;
        });
      } finally {
        applying = false;
      }
    };

    applyBranchLock();
    const observer = new MutationObserver(applyBranchLock);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [advanced, scopedBranch]);

  return (
    <div ref={rootRef}>
      <div dir="rtl" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-teal-400/20 bg-teal-500/5 px-4 py-3">
        <div className="text-sm font-black text-teal-100">
          {scopedBranch ? `نطاق خدمة العملاء: ${scopedBranch} فقط` : 'نقاط العملاء — الوضع السريع مفعل'}
        </div>
        <div className="flex gap-2">
          <button type="button" className={!advanced ? 'dawaa-button-primary' : 'btn-secondary'} onClick={() => setAdvanced(false)}>
            <Gauge className="h-4 w-4" /> الوضع السريع
          </button>
          <button type="button" className={advanced ? 'dawaa-button-primary' : 'btn-secondary'} onClick={() => setAdvanced(true)}>
            <SlidersHorizontal className="h-4 w-4" /> أدوات متقدمة
          </button>
        </div>
      </div>

      {advanced ? (
        <Suspense fallback={<div dir="rtl" className="dawaa-panel p-8 text-center font-bold">جارٍ تحميل أدوات Excel والإدارة المتقدمة…</div>}>
          <CustomerCashbackBase />
        </Suspense>
      ) : (
        <CustomerCashbackFast forcedBranch={scopedBranch} />
      )}
    </div>
  );
}
