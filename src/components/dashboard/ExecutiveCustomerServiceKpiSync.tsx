import { useCallback, useEffect, useState } from 'react';
import { normalizeRole, useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { ALL_FILTER } from '@/lib/api/customers';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const TODAY = () => new Date().toISOString().slice(0, 10);
const MANAGER_ALL_BRANCH_ROLES = new Set([
  'admin',
  'owner',
  'manager',
  'general_manager',
  'executive_manager',
  'branches_manager',
  'customer_service_manager',
]);

function canSeeAll(role?: string | null) {
  return MANAGER_ALL_BRANCH_ROLES.has(normalizeRole(role || ''));
}

function dashboardBranch(userBranch?: string | null, role?: string | null) {
  const params = new URLSearchParams(window.location.search);
  const requested = normalizeBranchName(params.get('branch') || params.get('p_branch') || '');
  if (requested && requested !== ALL_FILTER && requested !== 'كل الفروع') return requested;
  if (canSeeAll(role)) return ALL_FILTER;
  return normalizeBranchName(userBranch || '') || ALL_FILTER;
}

async function queryActualCustomerServiceCount(branch: string) {
  const today = TODAY();

  try {
    let mixQuery = supabase
      .from('customer_service_daily_queue_mix_v1')
      .select('open_count,rows_count,branch,followup_day')
      .eq('followup_day', today);
    if (branch !== ALL_FILTER) mixQuery = mixQuery.eq('branch', branch);
    const { data, error } = await mixQuery;
    if (!error && Array.isArray(data) && data.length) {
      return data.reduce((sum, row: any) => sum + Number(row.open_count ?? row.rows_count ?? 0), 0);
    }
  } catch {
    // Fall back to the base table below.
  }

  const countQuery = async (column: string) => {
    let query = supabase
      .from('daily_followups')
      .select('id', { count: 'exact', head: true })
      .is('completed_at', null)
      .is('cancelled_at', null)
      .eq(column, today);
    if (branch !== ALL_FILTER) query = query.eq('branch', branch);
    const { count, error } = await query;
    if (error) return null;
    return Number(count || 0);
  };

  const followupDay = await countQuery('followup_day');
  if (followupDay !== null && followupDay > 0) return followupDay;

  const followupDate = await countQuery('followup_date');
  if (followupDate !== null && followupDate > 0) return followupDate;

  const date = await countQuery('date');
  return date ?? 0;
}

function findCustomerServiceKpiCard() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="button"],button,section div,main div'));
  return candidates.find((el) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text.includes('خدمة العملاء')) return false;
    if (!text.includes('اضغط للانتقال داخل الداشبورد')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 160 && rect.height > 80;
  });
}

function patchCustomerServiceKpi(count: number) {
  const card = findCustomerServiceKpiCard();
  if (!card) return false;
  card.setAttribute('data-customer-service-kpi-source', 'actual-customer-service-page');

  const textNodes: HTMLElement[] = Array.from(card.querySelectorAll<HTMLElement>('p,div,span,b'))
    .filter((node) => {
      const txt = (node.textContent || '').trim();
      return /^\d+[\d,\.،]*$/.test(txt) || /^[٠-٩]+$/.test(txt);
    })
    .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);

  const target = textNodes[0];
  if (!target) return false;
  target.textContent = count.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  target.setAttribute('title', 'الرقم الفعلي من قائمة خدمة العملاء الحالية');

  const subtitle = Array.from(card.querySelectorAll<HTMLElement>('p,span,div')).find((node) =>
    (node.textContent || '').includes('اضغط للانتقال داخل الداشبورد')
  );
  if (subtitle) subtitle.textContent = 'الرقم الفعلي من صفحة خدمة العملاء الحالية';
  return true;
}

export default function ExecutiveCustomerServiceKpiSync() {
  const { user } = useAuth();
  const [actualCount, setActualCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !window.location.pathname.includes('executive-2027')) return;
    const branch = dashboardBranch(user?.branch, user?.role);
    const next = await queryActualCustomerServiceCount(branch);
    setActualCount(next);
    window.setTimeout(() => patchCustomerServiceKpi(next), 100);
    window.setTimeout(() => patchCustomerServiceKpi(next), 900);
  }, [user?.branch, user?.role]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (actualCount == null) return;
    const observer = new MutationObserver(() => patchCustomerServiceKpi(actualCount));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [actualCount]);

  return null;
}
