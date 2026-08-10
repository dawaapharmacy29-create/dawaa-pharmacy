/**
 * "يحتاج تدخلك الآن" — قسم الاستثناءات لمركز قيادة مدير الفروع.
 * كل مصدر هنا بيستخدم جداول موجودة بالفعل (مفيش جدول جديد)، وكل استعلام Aggregate/محدود
 * (مش بيجيب آلاف الصفوف في الصفحة الرئيسية) زي ما هو مطلوب في قواعد التنفيذ.
 */
import { supabase } from '@/lib/supabase';

export type ExceptionSeverity = 'حرجة' | 'مهمة' | 'عادية';

export type ManagerException = {
  id: string;
  type:
    | 'sales_below_plan'
    | 'vip_not_followed_up'
    | 'overdue_complaint'
    | 'critical_shortage'
    | 'branch_manager_issue'
    | 'supplier_issue'
    | 'financial_issue';
  branch: string;
  title: string;
  detail: string;
  severity: ExceptionSeverity;
}[];

const BRANCHES = ['فرع الشامي', 'فرع شكري'];

function daysElapsedInCycle(cycleStartDay: number, today: Date): number {
  const day = today.getDate();
  if (day >= cycleStartDay) return day - cycleStartDay + 1;
  // الدورة بدأت الشهر اللي فات
  const lastDayOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  return lastDayOfPrevMonth - cycleStartDay + 1 + day;
}

function cycleStartDate(cycleStartDay: number, today: Date): Date {
  const day = today.getDate();
  if (day >= cycleStartDay) return new Date(today.getFullYear(), today.getMonth(), cycleStartDay);
  return new Date(today.getFullYear(), today.getMonth() - 1, cycleStartDay);
}

/** 1) مبيعات أقل من الخطة — مقارنة وتيرة التحقيق الفعلية بالوتيرة المطلوبة للوصول للتارجت. */
async function fetchSalesBelowPlan(branchScope: string | null): Promise<ManagerException> {
  const { data: targets } = await supabase
    .from('branch_sales_targets')
    .select('branch_name, target_amount, cycle_start_day, active')
    .eq('active', true);
  const rows: ManagerException = [];
  const today = new Date();
  for (const target of targets || []) {
    if (branchScope && target.branch_name !== branchScope) continue;
    const start = cycleStartDate(Number(target.cycle_start_day) || 1, today);
    const elapsed = daysElapsedInCycle(Number(target.cycle_start_day) || 1, today);
    const { data: sumRow } = await supabase.rpc('sum_branch_sales_since', {
      p_branch: target.branch_name,
      p_since: start.toISOString().slice(0, 10),
    }).maybeSingle();
    const actual = Number((sumRow as any)?.total || 0);
    const targetAmount = Number(target.target_amount) || 0;
    if (!targetAmount || elapsed <= 0) continue;
    const daysInCycle = 30; // تقريبي، الدورة شهرية
    const expectedPace = (targetAmount / daysInCycle) * elapsed;
    if (expectedPace > 0 && actual < expectedPace * 0.85) {
      const gapPercent = Math.round(((expectedPace - actual) / expectedPace) * 100);
      rows.push({
        id: `sales-${target.branch_name}`,
        type: 'sales_below_plan',
        branch: target.branch_name,
        title: 'مبيعات أقل من الخطة',
        detail: `متأخر ${gapPercent}% عن الوتيرة المطلوبة للوصول للتارجت (${Math.round(targetAmount).toLocaleString('ar-EG')} ج.م) بعد ${elapsed} يوم من الدورة.`,
        severity: gapPercent >= 25 ? 'حرجة' : 'مهمة',
      });
    }
  }
  return rows;
}

/** 2) عملاء VIP (أهم 20 بالفرع) لم تتم متابعتهم خلال آخر 14 يوم. */
async function fetchVipNotFollowedUp(branchScope: string | null): Promise<ManagerException> {
  const branches = branchScope ? [branchScope] : BRANCHES;
  const rows: ManagerException = [];
  for (const branch of branches) {
    const { data: top } = await supabase.rpc('get_top_customers_per_branch', {
      p_branch: branch,
      p_limit: 20,
    });
    const codes = (top || []).map((c: any) => c.customer_code).filter(Boolean);
    if (!codes.length) continue;
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const { data: recentFollowups } = await supabase
      .from('daily_followups')
      .select('customer_code')
      .in('customer_code', codes)
      .gte('created_at', since.toISOString());
    const followedUpCodes = new Set((recentFollowups || []).map((r: any) => r.customer_code));
    const notFollowedUp = (top || []).filter((c: any) => c.customer_code && !followedUpCodes.has(c.customer_code));
    if (notFollowedUp.length) {
      rows.push({
        id: `vip-${branch}`,
        type: 'vip_not_followed_up',
        branch,
        title: 'عملاء VIP لم تتم متابعتهم',
        detail: `${notFollowedUp.length} من أهم 20 عميل بالفرع من غير أي متابعة مسجّلة خلال آخر 14 يوم.`,
        severity: notFollowedUp.length >= 5 ? 'حرجة' : 'مهمة',
      });
    }
  }
  return rows;
}

/** 3) شكاوى متأخرة — مفتوحة لأكتر من 24 ساعة بدون حل. */
async function fetchOverdueComplaints(branchScope: string | null): Promise<ManagerException> {
  const since = new Date();
  since.setHours(since.getHours() - 24);
  let query = supabase
    .from('complaints')
    .select('id, branch, customer_name, type, created_at', { count: 'exact' })
    .not('status', 'in', '("resolved","closed","تم الحل","مغلقة")')
    .lt('created_at', since.toISOString());
  if (branchScope) query = query.eq('branch', branchScope);
  const { data, count } = await query.limit(20);
  if (!count) return [];
  const byBranch = new Map<string, number>();
  (data || []).forEach((row: any) => byBranch.set(row.branch, (byBranch.get(row.branch) || 0) + 1));
  return Array.from(byBranch.entries()).map(([branch, n]) => ({
    id: `complaints-${branch}`,
    type: 'overdue_complaint' as const,
    branch,
    title: 'شكاوى متأخرة',
    detail: `${n} شكوى مفتوحة من أكتر من 24 ساعة بدون حل.`,
    severity: 'حرجة' as const,
  }));
}

/** 4) نواقص حرجة لسه معلّقة. */
async function fetchCriticalShortages(branchScope: string | null): Promise<ManagerException> {
  let query = supabase
    .from('shortage_items')
    .select('id, branch, item_name, priority, status')
    .ilike('priority', '%حرج%')
    .not('status', 'in', '("resolved","closed","تم التوفير","متوفر")');
  if (branchScope) query = query.eq('branch', branchScope);
  const { data } = await query.limit(50);
  const byBranch = new Map<string, number>();
  (data || []).forEach((row: any) => byBranch.set(row.branch, (byBranch.get(row.branch) || 0) + 1));
  return Array.from(byBranch.entries()).map(([branch, n]) => ({
    id: `shortage-${branch}`,
    type: 'critical_shortage' as const,
    branch,
    title: 'نواقص حرجة',
    detail: `${n} صنف حرج لسه ناقص ومحتاج تدخّل موردين.`,
    severity: 'حرجة' as const,
  }));
}

/** 5) مشكلة تشغيلية مصعّدة من مدير فرع (Priority عاجل/حرجة في branch_daily_tasks). */
async function fetchEscalatedBranchIssues(branchScope: string | null): Promise<ManagerException> {
  let query = supabase
    .from('branch_daily_tasks')
    .select('id, branch, category, title, priority, status')
    .in('priority', ['عاجل', 'حرجة'])
    .not('status', 'in', '("مكتمل","مغلق","تم الحل")');
  if (branchScope) query = query.eq('branch', branchScope);
  const { data } = await query.limit(50);
  return (data || []).map((row: any) => ({
    id: `issue-${row.id}`,
    type:
      row.category === 'موردين' ? 'supplier_issue' : row.category === 'مالية' ? 'financial_issue' : 'branch_manager_issue',
    branch: row.branch,
    title: row.title || 'مشكلة تشغيلية مُصعّدة',
    detail: `أولوية: ${row.priority} — لسه ${row.status || 'مفتوحة'}.`,
    severity: 'حرجة' as const,
  }));
}

export async function fetchBranchesManagerExceptions(branchScope: string | null): Promise<ManagerException> {
  const results = await Promise.allSettled([
    fetchSalesBelowPlan(branchScope),
    fetchVipNotFollowedUp(branchScope),
    fetchOverdueComplaints(branchScope),
    fetchCriticalShortages(branchScope),
    fetchEscalatedBranchIssues(branchScope),
  ]);
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
