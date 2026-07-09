import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notificationService';
import { normalizeRole, useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';

type AlertRow = {
  id: string;
  customer_name?: string | null;
  name?: string | null;
  customer_code?: string | null;
  branch?: string | null;
  responsible_name?: string | null;
  assigned_to?: string | null;
  assigned_doctor?: string | null;
  followup_datetime?: string | null;
  followup_date?: string | null;
  next_followup_date?: string | null;
  date?: string | null;
  created_at?: string | null;
  status?: string | null;
  followup_status?: string | null;
  contact_status?: string | null;
  completed_at?: string | null;
  postponed_until?: string | null;
  cancelled_at?: string | null;
  source_type?: string | null;
  source_type_label?: string | null;
  appearance_reason?: string | null;
};

const POLL_MS = 60_000;
const LATE_AFTER_MS = 15 * 60_000;
const NOTICE_THROTTLE_MS = 15 * 60_000;
const DISMISS_MS = 5 * 60_000;
const MANAGER_ROLES = new Set([
  'admin',
  'owner',
  'manager',
  'general_manager',
  'executive_manager',
  'branches_manager',
  'customer_service_manager',
  'branch_manager',
]);

function rowStatus(row: AlertRow) {
  return String(row.followup_status || row.status || row.contact_status || '').trim();
}

function isClosed(row: AlertRow) {
  const status = rowStatus(row);
  return Boolean(row.completed_at || row.cancelled_at || ['تم', 'done', 'completed', 'closed'].includes(status));
}

function dueTimestamp(row: AlertRow) {
  const raw = row.followup_datetime || row.followup_date || row.next_followup_date || row.date || row.created_at;
  const time = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

function minutesLate(row: AlertRow) {
  const due = dueTimestamp(row);
  if (!due) return 0;
  return Math.max(0, Math.floor((Date.now() - due) / 60_000));
}

function isOverdue(row: AlertRow) {
  const due = dueTimestamp(row);
  if (!due || isClosed(row) || row.postponed_until) return false;
  return Date.now() - due >= LATE_AFTER_MS;
}

function customerLabel(row: AlertRow) {
  return String(row.customer_name || row.name || row.customer_code || 'عميل غير محدد').trim();
}

function responsibleLabel(row: AlertRow) {
  return String(row.responsible_name || row.assigned_to || row.assigned_doctor || 'غير مسند').trim();
}

function canSeeAllBranches(role: string) {
  return ['admin', 'owner', 'general_manager', 'executive_manager', 'branches_manager', 'customer_service_manager', 'manager'].includes(role);
}

function shouldShowForUser(role: string) {
  return MANAGER_ROLES.has(role);
}

function alertRoute(branch?: string | null) {
  const url = new URL('/customer-service', window.location.origin);
  url.searchParams.set('status', 'متأخرة');
  url.searchParams.set('filter', 'overdue');
  if (branch) url.searchParams.set('branch', branch);
  return `${url.pathname}${url.search}`;
}

async function queryOverdueRows(branch?: string | null, allBranches = false) {
  const branchName = normalizeBranchName(branch || '');

  try {
    let query = supabase
      .from('customer_service_overdue_followup_alerts_v1')
      .select('*')
      .order('minutes_late', { ascending: false })
      .limit(120);
    if (!allBranches && branchName) query = query.eq('branch', branchName);
    const { data, error } = await query;
    if (!error) return (data || []) as AlertRow[];
  } catch {
    // Fallback below keeps old databases working until the migration is applied.
  }

  let fallback = supabase
    .from('daily_followups')
    .select('id,customer_name,name,customer_code,branch,responsible_name,assigned_to,assigned_doctor,followup_datetime,followup_date,next_followup_date,date,created_at,status,followup_status,contact_status,completed_at,postponed_until,cancelled_at,source_type')
    .is('completed_at', null)
    .is('cancelled_at', null)
    .limit(160);
  if (!allBranches && branchName) fallback = fallback.eq('branch', branchName);
  const { data, error } = await fallback;
  if (error) return [];
  return ((data || []) as AlertRow[]).filter(isOverdue).sort((a, b) => minutesLate(b) - minutesLate(a));
}

export default function GlobalCustomerServiceAlerts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [dismissUntil, setDismissUntil] = useState(0);

  const role = normalizeRole(user?.role || '');
  const allBranches = canSeeAllBranches(role);
  const userBranch = normalizeBranchName(user?.branch || '');
  const enabled = Boolean(user && shouldShowForUser(role) && isSupabaseConfigured);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (!isOverdue(row)) return false;
      if (allBranches) return true;
      return normalizeBranchName(row.branch || '') === userBranch;
    });
    const byCustomer = new Map<string, AlertRow>();
    for (const row of filtered) {
      const key = String(row.customer_code || row.id || customerLabel(row)).trim().toLowerCase();
      const current = byCustomer.get(key);
      if (!current || minutesLate(row) > minutesLate(current)) byCustomer.set(key, row);
    }
    return [...byCustomer.values()].sort((a, b) => minutesLate(b) - minutesLate(a)).slice(0, 12);
  }, [allBranches, rows, userBranch]);

  const load = useCallback(async () => {
    if (!enabled) {
      setRows([]);
      return;
    }
    const data = await queryOverdueRows(userBranch, allBranches);
    setRows(data);
  }, [allBranches, enabled, userBranch]);

  useEffect(() => {
    void load();
    if (!enabled) return undefined;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || !visibleRows.length) return;
    const maxLate = Math.max(...visibleRows.map(minutesLate));
    const priority = maxLate >= 60 ? 'critical' : 'urgent';
    const scope = allBranches ? 'all' : userBranch || 'unknown';
    const bucket = Math.floor(Date.now() / NOTICE_THROTTLE_MS);
    const throttleKey = `dawaa_cs_overdue_notice_${scope}_${bucket}`;
    if (window.localStorage.getItem(throttleKey)) return;
    window.localStorage.setItem(throttleKey, '1');

    const byBranch = new Map<string, AlertRow[]>();
    for (const row of visibleRows) {
      const branch = normalizeBranchName(row.branch || '') || 'غير محدد';
      byBranch.set(branch, [...(byBranch.get(branch) || []), row]);
    }

    const createForRole = async (recipientRole: string, branch: string | null, branchRows: AlertRow[]) => {
      await createNotification({
        title: 'تأخر متابعات خدمة العملاء',
        message: `يوجد ${branchRows.length} متابعة متأخرة${branch ? ` في ${branch}` : ''}. أطول تأخير ${Math.max(...branchRows.map(minutesLate))} دقيقة.`,
        type: 'customer_alert',
        priority,
        recipient_role: recipientRole,
        branch,
        target_type: 'customer_service_followup_overdue',
        target_route: alertRoute(branch),
        requires_action: true,
        sound_enabled: true,
        metadata: {
          source: 'global_customer_service_alert_ticker',
          count: branchRows.length,
          max_minutes_late: Math.max(...branchRows.map(minutesLate)),
          branches: [...byBranch.keys()],
        },
      });
    };

    void (async () => {
      try {
        await createForRole('general_manager', null, visibleRows);
        await createForRole('branches_manager', null, visibleRows);
        await createForRole('customer_service_manager', null, visibleRows);
        await Promise.all([...byBranch.entries()].map(([branch, branchRows]) => createForRole('branch_manager', branch, branchRows)));
        toast.warning(`تنبيه خدمة العملاء: ${visibleRows.length} متابعة متأخرة`, { duration: 8000 });
      } catch (error) {
        console.warn('customer service overdue notification skipped', error);
      }
    })();
  }, [allBranches, enabled, userBranch, visibleRows]);

  if (!enabled || !visibleRows.length || Date.now() < dismissUntil) return null;

  const top = visibleRows[0];
  const branchGroups = [...new Set(visibleRows.map((row) => normalizeBranchName(row.branch || '') || 'غير محدد'))];

  return (
    <div className="fixed inset-x-3 bottom-3 z-[90]" dir="rtl">
      <div className="overflow-hidden rounded-2xl border border-red-400/40 bg-red-950/95 text-red-50 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-100">
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black">تنبيه متكرر: متابعات خدمة العملاء متأخرة</div>
              <div className="mt-1 overflow-hidden whitespace-nowrap text-xs font-bold text-red-100/90">
                <div className="animate-[dawaaTicker_22s_linear_infinite]">
                  {visibleRows.map((row) => `${customerLabel(row)} - ${normalizeBranchName(row.branch || '') || 'فرع غير محدد'} - ${minutesLate(row)} دقيقة - ${responsibleLabel(row)}`).join('   •   ')}
                </div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-black">
              {visibleRows.length} متأخرة · {branchGroups.join(' / ')} · الأطول {minutesLate(top)} دقيقة
            </span>
            <button
              type="button"
              onClick={() => window.location.assign(alertRoute(allBranches ? null : userBranch))}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50"
            >
              فتح المتابعات <ExternalLink size={14} />
            </button>
            <button
              type="button"
              aria-label="إخفاء مؤقت"
              onClick={() => setDismissUntil(Date.now() + DISMISS_MS)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-300/30 text-red-100 hover:bg-red-500/20"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
