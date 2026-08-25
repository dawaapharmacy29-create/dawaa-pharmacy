import { useLayoutEffect, useMemo, useRef } from 'react';
import CustomerCashback from '@/pages/CustomerCashback';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { normalizeBranchName } from '@/lib/branch';

const BRANCH_SCOPED_ROLES = new Set(['customer_service_manager', 'customer_service']);

function forceSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function CustomerCashbackBranchScoped() {
  const { user } = useAuth();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scopedBranch = useMemo(() => {
    if (!user || !BRANCH_SCOPED_ROLES.has(String(user.role || ''))) return '';
    const normalized = normalizeBranchName(user.branch || '');
    return BRANCHES.includes(normalized) ? normalized : '';
  }, [user?.branch, user?.role]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !scopedBranch) return;

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
  }, [scopedBranch]);

  return (
    <div ref={rootRef}>
      {scopedBranch ? (
        <div dir="rtl" className="mb-3 rounded-2xl border border-teal-400/30 bg-teal-500/10 px-4 py-3 text-sm font-black text-teal-100">
          نطاق خدمة العملاء: {scopedBranch} فقط
        </div>
      ) : null}
      <CustomerCashback />
    </div>
  );
}
