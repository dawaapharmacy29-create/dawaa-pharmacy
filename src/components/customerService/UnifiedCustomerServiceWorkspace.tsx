import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Eye,
  HeartHandshake,
  History,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ShoppingBag,
  Sparkles,
  UserRoundSearch,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getCustomers, type CustomerMetric } from '@/lib/api/customers';
import {
  calculateFollowupStats,
  createExceptionalFollowup,
  fetchCustomerServiceFollowups,
  updateFollowupResult,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { formatCurrency } from '@/lib/utils';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import FollowupResultModal, {
  type FollowupResultData,
} from '@/components/customerService/FollowupResultModal';
import CustomerServiceExecutionDashboard from '@/components/customerService/CustomerServiceExecutionDashboard';
import type { DailyFollowup } from '@/types/database';
import {
  contactAttemptLabel,
  getFollowupSla,
  recordContactAttempt,
  type ContactAttemptType,
} from '@/lib/customerServiceAttempts';
import {
  appendFollowupEvent,
  loadOrCreateDailyQueue,
  notifyIncompleteDailyQueue,
  updateDailyQueueItem,
} from '@/lib/customerServiceDailyExecution';
import { buildFollowupScript, followupPriorityScore } from '@/lib/customerServiceScriptEngine';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { supabase } from '@/lib/supabase';

type QueueSource = 'doctor_request' | 'yesterday' | 'at_risk' | 'important';
type WorkspaceTab =
  | 'today'
  | 'doctor-requests'
  | 'upcoming'
  | 'manager'
  | 'care'
  | 'history'
  | 'performance';
type HistoryPeriod = 'all' | 'today' | '7d' | 'cycle';

type QueueItem = {
  key: string;
  source: QueueSource;
  row: FollowupRow | null;
  customer: CustomerMetric | null;
  name: string;
  code: string;
  phone: string;
  branch: string;
  segment: string;
  status: string;
  priority: string;
  reason: string;
  avgMonthly: number;
  totalSpent: number;
  avgInvoice: number;
  lastPurchase: string;
  completed: boolean;
  queueItemId?: string | null;
  requestedBy: string;
  branchEvidence: string;
  branchNeedsReview: boolean;
  priorityScore: number;
  priorityReason: string;
  openRequestCount?: number;
  relatedRequests?: FollowupRow[];
};

const BRANCHES = ['فرع الشامي', 'فرع شكري'];
const BRANCH_OWNER: Record<string, string> = {
  'فرع الشامي': 'د/ ضحى',
  'فرع شكري': 'د/ دنيا',
};

const FINAL_RESULTS = new Set([
  'تم الرد والعميل راضي',
  'تم الرد ولا يحتاج الآن',
  'تم الشراء بعد المتابعة',
  'تم حل الشكوى',
  'تم تنفيذ الطلب والتأكد من العميل',
]);

const OPEN_RESULTS = new Set([
  'تم الرد ويحتاج طلب',
  'تم الرد ويوجد شكوى',
  'طلب صنف',
  'طلب توصيل',
  'يحتاج متابعة مدير',
  'لم يرد',
  'طلب التواصل لاحقًا',
  'الرقم غير صحيح',
]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function cycleStartIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = now.getDate() >= 26 ? new Date(year, month, 26) : new Date(year, month - 1, 26);
  return start.toISOString().slice(0, 10);
}

function normalizeKey(...values: Array<string | null | undefined>) {
  return (
    values
      .map((value) =>
        String(value || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '')
      )
      .find(Boolean) || crypto.randomUUID()
  );
}

function rowValue(row: FollowupRow | null | undefined, ...keys: string[]) {
  const source = (row || {}) as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return '';
}

function rowNumber(row: FollowupRow | null | undefined, ...keys: string[]) {
  const value = Number(rowValue(row, ...keys));
  return Number.isFinite(value) ? value : 0;
}

function resultOf(row?: FollowupRow | null) {
  return (
    rowValue(row, 'followup_result', 'contact_result', 'followup_status', 'status') || 'غير محدد'
  );
}

function displayStatus(value?: string | null) {
  const status = String(value || '').trim();
  const labels: Record<string, string> = {
    not_started: 'لم تبدأ',
    in_progress: 'جارٍ التواصل',
    attempted: 'تمت محاولة',
    scheduled: 'موعد قادم',
    needs_manager: 'تحتاج مديرًا',
    completed: 'مكتملة',
  };
  return labels[status] || status || 'غير محددة';
}

function cleanCustomerName(value?: string | null) {
  return String(value || 'عميل غير مسجل')
    .replace(/\++/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanReason(value?: string | null) {
  return String(value || 'متابعة العميل')
    .replace(/\[بدون رقم صحيح\]|المصدر\s*:[^\n|]+/gi, '')
    .replace(/[|]+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

function moneyOrUnavailable(value: number) {
  return value > 0 ? formatCurrency(value) : 'لا توجد بيانات';
}

function isCompleted(row?: FollowupRow | null) {
  const result = resultOf(row);
  if (OPEN_RESULTS.has(result)) return false;
  return FINAL_RESULTS.has(result) || (Boolean(row?.completed_at) && !OPEN_RESULTS.has(result));
}

function sourceFromRow(row: FollowupRow): QueueSource {
  const text = `${row.request_type || ''} ${row.notes || ''} ${row.followup_reason || ''} ${rowValue(row, 'source')}`;
  if (/doctor_requested_followup|طلب دكتور|سريع\/طلب دكتور/i.test(text)) return 'doctor_request';
  if (/أمس|yesterday/i.test(text)) return 'yesterday';
  if (/مهدد|قلل|استرجاع|متوقف/i.test(text)) return 'at_risk';
  return 'important';
}

function followupToItem(row: FollowupRow, source = sourceFromRow(row)): QueueItem {
  const metric = row.customer_metrics || null;
  const metricData = (metric || {}) as unknown as Record<string, unknown>;
  const requestBranch = normalizeBranchName(row.branch || '');
  const profileBranch = normalizeBranchName(String(metric?.branch || ''));
  const lastPurchaseBranch = normalizeBranchName(String(metricData.branch_last_purchase || ''));
  const frequentBranch = normalizeBranchName(String(metricData.branch_most_frequent || ''));
  const highestValueBranch = normalizeBranchName(String(metricData.branch_highest_value || ''));
  const branch = requestBranch || lastPurchaseBranch || frequentBranch || profileBranch;
  const evidenceBranches = [
    profileBranch,
    lastPurchaseBranch,
    frequentBranch,
    highestValueBranch,
  ].filter(Boolean);
  const conflictingBranches = [...new Set(evidenceBranches.filter((value) => value !== branch))];
  const branchNeedsReview = !branch || conflictingBranches.length > 0;
  const priority = followupPriorityScore({
    source,
    priority: row.priority,
    reason: row.request_details || row.followup_reason,
    createdAt: row.created_at,
    nextDate: row.next_followup_date,
  });
  return {
    key: normalizeKey(
      row.customer_code,
      row.customer_phone,
      row.phone,
      row.customer_id,
      row.customer_name
    ),
    source,
    row,
    customer: metric,
    name: cleanCustomerName(row.customer_name || row.name || metric?.customer_name),
    code: row.customer_code || metric?.customer_code || '',
    phone: row.customer_phone || row.phone || metric?.customer_phone || metric?.phone || '',
    branch,
    segment: row.segment || row.classification || metric?.segment || 'غير مصنف',
    status: displayStatus(row.customer_status || row.status || metric?.customer_status),
    priority: row.priority || 'مهم',
    reason: cleanReason(row.request_details || row.followup_reason || row.request_type),
    avgMonthly: Number(metric?.avg_monthly || 0),
    totalSpent: Number(row.total_spent || metric?.total_spent || 0),
    avgInvoice: Number(metric?.avg_invoice || 0),
    lastPurchase: row.last_purchase_date || metric?.last_purchase || '',
    completed: isCompleted(row),
    requestedBy: row.created_by_name || row.assigned_doctor || 'غير محدد',
    branchEvidence: branchNeedsReview
      ? `فرع المتابعة: ${branch || 'غير محدد'}${lastPurchaseBranch ? ` · آخر شراء: ${lastPurchaseBranch}` : ''}${frequentBranch ? ` · الأكثر تعاملًا: ${frequentBranch}` : ''}${profileBranch ? ` · ملف العميل: ${profileBranch}` : ''}`
      : lastPurchaseBranch
        ? `مؤكد من آخر شراء: ${lastPurchaseBranch}`
        : branch
          ? 'متوافق مع ملف العميل'
          : 'الفرع غير مؤكد',
    branchNeedsReview,
    priorityScore: priority.score,
    priorityReason: priority.label,
  };
}

function followupRequestToItem(row: FollowupRow, source = sourceFromRow(row)): QueueItem {
  const item = followupToItem(row, source);
  return { ...item, key: `followup:${row.id}` };
}

function groupOpenRequests(rows: FollowupRow[], forcedSource?: QueueSource) {
  const groups = new Map<string, FollowupRow[]>();
  for (const row of rows) {
    const identity = followupToItem(row).key;
    const current = groups.get(identity) || [];
    current.push(row);
    groups.set(identity, current);
  }
  return [...groups.values()].map((related) => {
    const sorted = [...related].sort(
      (a, b) =>
        new Date(b.created_at || b.followup_date || b.date || 0).getTime() -
        new Date(a.created_at || a.followup_date || a.date || 0).getTime()
    );
    return {
      ...followupRequestToItem(sorted[0], forcedSource || sourceFromRow(sorted[0])),
      openRequestCount: sorted.length,
      relatedRequests: sorted,
    };
  });
}

function customerToItem(customer: CustomerMetric, source: QueueSource, reason: string): QueueItem {
  const priority = followupPriorityScore({
    source,
    priority: source === 'at_risk' ? 'مهم' : 'عادي',
    reason,
  });
  return {
    key: normalizeKey(
      customer.customer_code,
      customer.customer_phone,
      customer.phone,
      customer.customer_id,
      customer.customer_name
    ),
    source,
    row: null,
    customer,
    name: cleanCustomerName(customer.customer_name || customer.name),
    code: customer.customer_code || '',
    phone: customer.customer_phone || customer.phone || '',
    branch: normalizeBranchName(customer.branch || ''),
    segment: customer.segment || customer.type || 'غير مصنف',
    status: displayStatus(customer.customer_status || customer.status),
    priority: source === 'at_risk' ? 'مهم' : 'عادي',
    reason,
    avgMonthly: Number(customer.avg_monthly || 0),
    totalSpent: Number(customer.total_spent || customer.total_purchases || 0),
    avgInvoice: Number(customer.avg_invoice || 0),
    lastPurchase: customer.last_purchase || '',
    completed: false,
    requestedBy: 'النظام الذكي',
    branchEvidence: customer.branch ? 'الفرع المسجل في ملف العميل' : 'الفرع غير مؤكد',
    branchNeedsReview: !customer.branch,
    priorityScore: priority.score,
    priorityReason: priority.label,
  };
}

function sourceLabel(source: QueueSource) {
  if (source === 'doctor_request') return 'طلب دكتور';
  if (source === 'yesterday') return 'اشترى أمس';
  if (source === 'at_risk') return 'مهدد بالتوقف';
  return 'عميل مهم';
}

function scriptFor(item: QueueItem) {
  const owner = BRANCH_OWNER[item.branch] || 'فريق خدمة العملاء';
  return buildFollowupScript({
    customerName: item.name,
    agentName: owner,
    doctorName: item.requestedBy,
    reason: item.reason,
    source: item.source,
    result: item.status,
    branch: item.branch,
    lastPurchase: item.lastPurchase,
  }).whatsapp;
}

function scriptPackFor(item: QueueItem) {
  return buildFollowupScript({
    customerName: item.name,
    agentName: BRANCH_OWNER[item.branch] || 'فريق خدمة العملاء',
    doctorName: item.requestedBy,
    reason: item.reason,
    source: item.source,
    result: item.status,
    branch: item.branch,
    lastPurchase: item.lastPurchase,
  });
}

export default function UnifiedCustomerServiceWorkspace() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const lockedBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? 'فرع الشامي' : lockedBranch || 'فرع الشامي');
  const [tab, setTab] = useState<WorkspaceTab>('today');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [allFollowups, setAllFollowups] = useState<FollowupRow[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | QueueSource>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [requesterFilter, setRequesterFilter] = useState('all');
  const [dataFilter, setDataFilter] = useState('all');
  const [slaFilter, setSlaFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scriptSection, setScriptSection] = useState<
    'call' | 'questions' | 'objections' | 'whatsapp'
  >('call');
  const [historySearch, setHistorySearch] = useState('');
  const [historyResult, setHistoryResult] = useState('all');
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('cycle');
  const [quickOpen, setQuickOpen] = useState(false);
  const [resultRow, setResultRow] = useState<FollowupRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<FollowupRow | null>(null);

  async function loadWorkspace() {
    setLoading(true);
    setLoadError('');
    try {
      const [followups, importantResult, atRiskResult, recentResult] = await Promise.all([
        fetchCustomerServiceFollowups({ branch, limit: 1000 }),
        getCustomers({ branch, type: 'مهم جدًا', limit: 100, offset: 0 }),
        getCustomers({ branch, status: 'مهدد بالتوقف', limit: 100, offset: 0 }),
        getCustomers({ branch, limit: 100, offset: 0 }),
      ]);
      setAllFollowups(followups);
      const doctorRequests = followups
        .filter((row) => !isCompleted(row) && sourceFromRow(row) === 'doctor_request')
        .map((row) => followupToItem(row, 'doctor_request'));
      const scheduledToday = followups
        .filter(
          (row) =>
            !isCompleted(row) && String(row.next_followup_date || '').slice(0, 10) === todayIso()
        )
        .map((row) => followupToItem(row, sourceFromRow(row)));
      const yesterday = recentResult.customers
        .filter((customer) => String(customer.last_purchase || '').slice(0, 10) === yesterdayIso())
        .filter(
          (customer) =>
            Number(customer.avg_invoice || 0) >= 500 || Number(customer.total_spent || 0) >= 1000
        )
        .sort((a, b) => Number(b.avg_invoice || 0) - Number(a.avg_invoice || 0))
        .map((customer) =>
          customerToItem(
            customer,
            'yesterday',
            `متابعة شراء أمس بمتوسط فاتورة ${formatCurrency(Number(customer.avg_invoice || 0))}`
          )
        );
      const atRisk = atRiskResult.customers
        .sort((a, b) => Number(b.avg_monthly || 0) - Number(a.avg_monthly || 0))
        .map((customer) =>
          customerToItem(customer, 'at_risk', 'قلل التعامل أو مهدد بالتوقف ويحتاج متابعة استرجاع')
        );
      const important = importantResult.customers
        .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
        .map((customer) =>
          customerToItem(customer, 'important', 'عميل مهم يحتاج متابعة دورية ودلع')
        );
      const map = new Map<string, QueueItem>();
      const add = (items: QueueItem[], limit: number) => {
        let added = 0;
        for (const item of items) {
          if (map.has(item.key)) continue;
          map.set(item.key, item);
          added += 1;
          if (added >= limit) break;
        }
      };
      add(scheduledToday, scheduledToday.length);
      add(doctorRequests, doctorRequests.length);
      add(yesterday, 10);
      add(atRisk, 10);
      add(important, 30);
      const proposedQueue = [...map.values()];
      const snapshot = await loadOrCreateDailyQueue(
        branch,
        proposedQueue.map((item) => ({
          key: item.key,
          source: item.source,
          customerId:
            item.customer?.customer_id || item.customer?.id || item.row?.customer_id || null,
          code: item.code || null,
          name: item.name,
          phone: item.phone || null,
          branch: item.branch,
          priority: item.priority,
          reason: item.reason,
          nextFollowupDate: item.row?.next_followup_date || null,
          linkedFollowupId: item.row?.id || null,
        })),
        { id: user?.id || null, name: user?.name || null }
      );
      const proposedByKey = new Map(proposedQueue.map((item) => [item.key, item]));
      const finalQueue = snapshot.items.map((saved) => {
        const original = proposedByKey.get(saved.key);
        if (original)
          return {
            ...original,
            queueItemId: saved.id,
            completed: saved.status === 'completed' || original.completed,
          };
        return {
          key: saved.key,
          source: saved.source as QueueSource,
          row: followups.find((row) => row.id === saved.linkedFollowupId) || null,
          customer: null,
          name: saved.name,
          code: saved.code || '',
          phone: saved.phone || '',
          branch: saved.branch,
          segment: 'غير مصنف',
          status: saved.status,
          priority: saved.priority || 'مهم',
          reason: saved.reason || 'متابعة اليوم',
          avgMonthly: 0,
          totalSpent: 0,
          avgInvoice: 0,
          lastPurchase: '',
          completed: saved.status === 'completed',
          queueItemId: saved.id,
          requestedBy: 'غير محدد',
          branchEvidence: saved.branch ? 'فرع القائمة اليومية' : 'الفرع غير مؤكد',
          branchNeedsReview: !saved.branch,
          priorityScore: followupPriorityScore({
            source: saved.source,
            priority: saved.priority,
            reason: saved.reason,
          }).score,
          priorityReason: followupPriorityScore({
            source: saved.source,
            priority: saved.priority,
            reason: saved.reason,
          }).label,
        };
      });
      setQueue(finalQueue);
      const completedCount = finalQueue.filter((item) => item.completed).length;
      const needsManagerCount = followups.filter(
        (row) => row.needs_manager && !isCompleted(row)
      ).length;
      void notifyIncompleteDailyQueue({
        branch,
        ownerName: BRANCH_OWNER[branch] || 'مسئول خدمة العملاء',
        total: finalQueue.length,
        completed: completedCount,
        needsManager: needsManagerCount,
      });
      setSelectedKey((current) =>
        current && finalQueue.some((item) => item.key === current)
          ? current
          : finalQueue[0]?.key || ''
      );
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error(error);
      setLoadError((error as Error).message || 'تعذر تحميل البيانات');
      toast.error('تعذر تحميل قائمة خدمة العملاء اليومية');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [branch]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void loadWorkspace(), 700);
    };
    const onLocalDataChange = (event: Event) => {
      const table = (event as CustomEvent<{ table?: string }>).detail?.table;
      if (!table || table === 'daily_followups') scheduleRefresh();
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    }, 90_000);
    const channel = supabase
      .channel(`customer-followups-live:${branch}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_followups' },
        scheduleRefresh
      )
      .subscribe();

    window.addEventListener('dataChanged', onLocalDataChange);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
      window.removeEventListener('dataChanged', onLocalDataChange);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [branch]);

  const owner = BRANCH_OWNER[branch] || 'مسئول خدمة العملاء';
  const todayRows = useMemo(
    () =>
      allFollowups.filter(
        (row) => String(row.date || row.followup_date || '').slice(0, 10) === todayIso()
      ),
    [allFollowups]
  );
  const stats = useMemo(() => calculateFollowupStats(todayRows), [todayRows]);
  const completedHistory = useMemo(
    () =>
      allFollowups
        .filter(isCompleted)
        .sort(
          (a, b) =>
            new Date(
              rowValue(b, 'completed_at', 'updated_at', 'followup_date', 'date') || 0
            ).getTime() -
            new Date(
              rowValue(a, 'completed_at', 'updated_at', 'followup_date', 'date') || 0
            ).getTime()
        ),
    [allFollowups]
  );
  const filteredQueue = useMemo(
    () =>
      queue.filter((item) => {
        if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
        if (statusFilter === 'completed' && !item.completed) return false;
        if (statusFilter === 'open' && item.completed) return false;
        const haystack = `${item.name} ${item.code} ${item.phone} ${item.reason}`.toLowerCase();
        return !search.trim() || haystack.includes(search.trim().toLowerCase());
      }),
    [queue, search, sourceFilter, statusFilter]
  );
  const doctorRequestQueue = useMemo(
    () =>
      groupOpenRequests(
        allFollowups.filter((row) => !isCompleted(row) && sourceFromRow(row) === 'doctor_request'),
        'doctor_request'
      ).sort((a, b) => b.priorityScore - a.priorityScore),
    [allFollowups]
  );
  const upcomingQueue = useMemo(
    () =>
      groupOpenRequests(
        allFollowups.filter((row) => !isCompleted(row) && Boolean(row.next_followup_date))
      ).sort((a, b) =>
        String(a.row?.next_followup_date || '').localeCompare(
          String(b.row?.next_followup_date || '')
        )
      ),
    [allFollowups]
  );
  const managerQueue = useMemo(
    () =>
      groupOpenRequests(
        allFollowups.filter(
          (row) =>
            !isCompleted(row) &&
            (row.needs_manager ||
              /يحتاج.*مدير|تصعيد|شكوى/i.test(
                `${resultOf(row)} ${row.followup_reason || ''} ${row.request_details || ''}`
              ))
        )
      ).sort((a, b) => b.priorityScore - a.priorityScore),
    [allFollowups]
  );
  const selected =
    [...queue, ...doctorRequestQueue, ...upcomingQueue, ...managerQueue].find(
      (item) => item.key === selectedKey
    ) || null;
  const selectedDataIssues = selected
    ? [
        !selected.code ? 'كود العميل غير موجود' : '',
        !selected.phone ? 'رقم الهاتف غير موجود' : '',
        !selected.branch ? 'الفرع غير محدد' : '',
        selected.branchNeedsReview ? 'بيانات الفرع تحتاج مراجعة' : '',
      ].filter(Boolean)
    : [];
  const dataReviewCount = allFollowups.filter(
    (row) => !row.customer_code || !(row.customer_phone || row.phone) || !row.branch
  ).length;
  const requesterOptions = useMemo(
    () =>
      [
        ...new Set(
          allFollowups
            .map((row) => row.created_by_name || row.assigned_doctor || '')
            .filter(Boolean)
        ),
      ].sort(),
    [allFollowups]
  );

  const historyRows = useMemo(
    () =>
      completedHistory.filter((row) => {
        const completedAt = rowValue(
          row,
          'completed_at',
          'updated_at',
          'followup_date',
          'date'
        ).slice(0, 10);
        if (historyPeriod === 'today' && completedAt !== todayIso()) return false;
        if (historyPeriod === '7d') {
          const start = new Date();
          start.setDate(start.getDate() - 6);
          if (completedAt < start.toISOString().slice(0, 10)) return false;
        }
        if (historyPeriod === 'cycle' && completedAt < cycleStartIso()) return false;
        if (historyResult !== 'all' && resultOf(row) !== historyResult) return false;
        const text =
          `${row.customer_name || row.name || ''} ${row.customer_code || ''} ${row.customer_phone || row.phone || ''} ${resultOf(row)} ${row.followup_summary || row.followup_notes || ''}`.toLowerCase();
        return !historySearch.trim() || text.includes(historySearch.trim().toLowerCase());
      }),
    [completedHistory, historyPeriod, historyResult, historySearch]
  );

  const historySummary = useMemo(
    () => ({
      total: historyRows.length,
      purchases: historyRows.filter(
        (row) => row.purchase_after_followup || rowNumber(row, 'purchase_amount') > 0
      ).length,
      sales: historyRows.reduce((sum, row) => sum + rowNumber(row, 'purchase_amount'), 0),
      needsManager: historyRows.filter((row) => row.needs_manager).length,
      nextFollowup: historyRows.filter((row) => row.needs_next_followup || row.next_followup_date)
        .length,
    }),
    [historyRows]
  );

  async function ensureFollowup(item: QueueItem) {
    if (item.row) return item.row;
    const created = await createExceptionalFollowup({
      customer: item.customer,
      customerName: item.name,
      customerPhone: item.phone || null,
      customerCode: item.code || null,
      branch: item.branch,
      priority: item.priority,
      requestType: sourceLabel(item.source),
      followupReason: item.reason,
      requestDetails: item.reason,
      createdBy: user?.id || null,
      createdByName: user?.name || null,
      source: 'unified_customer_service_workspace',
    });
    await updateDailyQueueItem(item.queueItemId || '', {
      linkedFollowupId: created.id,
      status: 'in_progress',
      started: true,
    });
    await appendFollowupEvent({
      followupId: created.id,
      queueItemId: item.queueItemId,
      eventType: 'started',
      status: 'in_progress',
      actorStaffId: user?.staffId || user?.id || null,
      actorName: user?.name || null,
    });
    setQueue((current) =>
      current.map((row) =>
        row.key === item.key ? { ...row, row: created, status: 'جارٍ التواصل' } : row
      )
    );
    return created;
  }

  async function openResult(item: QueueItem) {
    try {
      setResultRow(await ensureFollowup(item));
    } catch (error) {
      toast.error(`تعذر تجهيز المتابعة: ${(error as Error).message}`);
    }
  }

  async function saveContactAttempt(item: QueueItem, attemptType: ContactAttemptType) {
    try {
      const followup = await ensureFollowup(item);
      const notes =
        attemptType === 'callback_requested'
          ? window.prompt('اكتب الموعد أو ملاحظة طلب العميل:') || ''
          : '';
      const result = await recordContactAttempt({
        followupId: followup.id,
        queueItemId: item.queueItemId || null,
        attemptType,
        notes: notes || null,
        actorStaffId: user?.staffId || user?.id || null,
        actorName: user?.name || null,
      });
      toast.success(`تم تسجيل المحاولة رقم ${result.attemptCount}: ${result.label}`);
      setQueue((current) =>
        current.map((row) => (row.key === item.key ? { ...row, status: result.label } : row))
      );
      await loadWorkspace();
    } catch (error) {
      toast.error(`تعذر تسجيل المحاولة: ${(error as Error).message}`);
    }
  }

  async function saveResult(data: FollowupResultData) {
    if (!resultRow) return;
    const completed = FINAL_RESULTS.has(data.result);
    const needsNext = data.needsNextFollowup || !completed;
    const payload = {
      contact_result: data.result,
      followup_result: data.result,
      followup_summary: data.notes,
      followup_notes: data.notes,
      quality_rating: data.qualityRating,
      internal_rating: data.internalRating,
      needs_next_followup: needsNext,
      next_followup_date: data.nextFollowupDate || null,
      purchase_after_followup: data.result === 'تم الشراء بعد المتابعة' || data.purchaseAmount > 0,
      purchase_amount: data.purchaseAmount,
      purchase_invoice_no: data.invoiceNumber || null,
      customer_satisfaction: data.customerSatisfaction,
      need_understood: data.needUnderstood,
      cross_sell_offered: data.crossSellOffered,
      up_sell_offered: data.upSellOffered,
      no_purchase_reason: data.noPurchaseReason || null,
      doctor_internal_note: data.doctorInternalNote || null,
      needs_manager: data.result === 'يحتاج متابعة مدير',
      problem_solved: data.problemSolved,
      customer_satisfied: data.customerSatisfied,
      status: completed ? 'تم' : data.result,
      followup_status: completed ? 'تم' : data.result,
      completed_at: completed ? new Date().toISOString() : null,
      updated_by: user?.id || null,
    } as Parameters<typeof updateFollowupResult>[1] & Record<string, unknown>;
    if (!completed && !data.nextFollowupDate && data.result !== 'الرقم غير صحيح') {
      toast.error('حدد موعد المتابعة القادمة للحالات غير المكتملة');
      return;
    }
    await updateFollowupResult(resultRow.id, payload);
    const queueItem = queue.find(
      (item) =>
        item.row?.id === resultRow.id ||
        item.key ===
          normalizeKey(
            resultRow.customer_code,
            resultRow.customer_phone,
            resultRow.phone,
            resultRow.customer_id,
            resultRow.customer_name
          )
    );
    await updateDailyQueueItem(queueItem?.queueItemId || '', {
      status: completed
        ? 'completed'
        : data.result === 'يحتاج متابعة مدير'
          ? 'needs_manager'
          : 'scheduled',
      nextFollowupDate: data.nextFollowupDate || null,
      completed,
    });
    await appendFollowupEvent({
      followupId: resultRow.id,
      queueItemId: queueItem?.queueItemId,
      eventType: completed ? 'completed' : 'result_saved',
      status: data.result,
      actorStaffId: user?.staffId || user?.id || null,
      actorName: user?.name || null,
      notes: data.notes,
      metadata: {
        nextFollowupDate: data.nextFollowupDate || null,
        purchaseAmount: data.purchaseAmount,
      },
    });
    const requesterStaffId = rowValue(resultRow, 'requested_by_staff_id');
    if (requesterStaffId && requesterStaffId !== user?.staffId && requesterStaffId !== 'admin') {
      try {
        await createStaffNotification({
          recipientStaffId: requesterStaffId,
          type: 'doctor_followup_result',
          title: `تحديث متابعة: ${resultRow.customer_name || resultRow.name || 'عميل'}`,
          message: `تم تسجيل النتيجة: ${data.result}${data.notes ? ` — ${data.notes}` : ''}`,
          priority: data.result === 'يحتاج متابعة مدير' ? 'high' : 'normal',
          entityType: 'daily_followup',
          entityId: resultRow.id,
          actionUrl: `/doctor-dashboard?tab=followups&followupId=${encodeURIComponent(resultRow.id)}`,
          metadata: { branch, result: data.result, updated_by: user?.name || null },
        });
      } catch (notificationError) {
        console.warn('Doctor followup result notification skipped', notificationError);
      }
    }
    setResultRow(null);
    await loadWorkspace();
  }

  function copyScript(item: QueueItem) {
    void navigator.clipboard.writeText(scriptFor(item));
    toast.success('تم نسخ السكريبت');
  }

  function exportCurrentQueue() {
    const headers = [
      'العميل',
      'الكود',
      'الهاتف',
      'الفرع',
      'حالة الفرع',
      'النوع',
      'الأولوية',
      'سبب الأولوية',
      'مقدم الطلب',
      'سبب المتابعة',
      'الحالة',
      'الموعد القادم',
    ];
    const rows = visibleQueue.map((item) => [
      item.name,
      item.code,
      item.phone,
      item.branch,
      item.branchEvidence,
      sourceLabel(item.source),
      item.priority,
      item.priorityReason,
      item.requestedBy,
      item.reason,
      resultOf(item.row),
      item.row?.next_followup_date || '',
    ]);
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer-followups-${branch}-${new Date().toLocaleDateString('en-CA')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`تم تصدير ${rows.length} متابعة`);
  }

  const visibleQueue = (
    tab === 'doctor-requests'
      ? doctorRequestQueue
      : tab === 'upcoming'
        ? upcomingQueue
        : tab === 'manager'
          ? managerQueue
          : filteredQueue
  )
    .filter((item) => {
      if (tab === 'care' && !['important', 'at_risk'].includes(item.source)) return false;
      if (statusFilter === 'completed' && !item.completed) return false;
      if (statusFilter === 'open' && item.completed) return false;
      if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false;
      if (requesterFilter !== 'all' && item.requestedBy !== requesterFilter) return false;
      if (
        dataFilter === 'issues' &&
        !item.branchNeedsReview &&
        item.code &&
        item.phone &&
        item.branch
      )
        return false;
      if (
        dataFilter === 'complete' &&
        (item.branchNeedsReview || !item.code || !item.phone || !item.branch)
      )
        return false;
      if (slaFilter !== 'all') {
        const sla = getFollowupSla({
          source: item.source,
          priority: item.priority,
          createdAt: item.row?.created_at || item.row?.date || item.row?.followup_date || null,
          startedAt: rowValue(item.row, 'first_attempt_at') || null,
          completed: item.completed,
        });
        if (sla.state !== slaFilter) return false;
      }
      const haystack = `${item.name} ${item.code} ${item.phone} ${item.reason}`.toLowerCase();
      return !search.trim() || haystack.includes(search.trim().toLowerCase());
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
  useEffect(() => {
    setSelectedKey((current) =>
      visibleQueue.some((item) => item.key === current) ? current : visibleQueue[0]?.key || ''
    );
  }, [
    tab,
    branch,
    search,
    sourceFilter,
    statusFilter,
    priorityFilter,
    requesterFilter,
    dataFilter,
    slaFilter,
    visibleQueue.length,
  ]);
  const slaFor = (item: QueueItem) =>
    getFollowupSla({
      source: item.source,
      priority: item.priority,
      createdAt: item.row?.created_at || item.row?.date || item.row?.followup_date || null,
      startedAt: rowValue(item.row, 'first_attempt_at') || null,
      completed: item.completed,
    });

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-teal-400/25 bg-gradient-to-l from-[#0b1c2f] to-[#12334a] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black text-teal-200">صيدليات دواء</div>
            <h1 className="mt-1 text-3xl font-black text-white">متابعة العملاء</h1>
            <p className="mt-2 text-sm font-bold text-slate-300">
              كل طلب له مسؤول وخطوة قادمة ونتيجة واضحة · {owner} · {branch}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-400">
              مزامنة مباشرة بين المستخدمين
              {lastSyncedAt ? ` · آخر تحديث ${lastSyncedAt.toLocaleTimeString('ar-EG')}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {managerView ? (
              <select
                className="input-dark"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
              >
                {BRANCHES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            ) : (
              <span className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-4 py-3 text-sm font-black text-teal-100">
                {branch} · {owner}
              </span>
            )}
            <button
              className="btn-secondary flex items-center gap-2"
              onClick={() => void loadWorkspace()}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              {loading ? 'جارٍ التحديث' : 'تحديث'}
            </button>
            <button className="btn-primary" onClick={() => setQuickOpen(true)}>
              إضافة متابعة
            </button>
            <a className="btn-secondary" href="/customer-data-review">
              مراجعة البيانات {dataReviewCount ? `(${dataReviewCount})` : ''}
            </a>
            <button className="btn-secondary flex items-center gap-2" onClick={exportCurrentQueue}>
              <Download size={16} /> تصدير القائمة
            </button>
          </div>
        </div>
      </section>

      {loadError && (
        <div className="flex items-center justify-between rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
          <span>تعذر تحميل البيانات: {loadError}</span>
          <button className="btn-secondary" onClick={() => void loadWorkspace()}>
            إعادة المحاولة
          </button>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <button
          type="button"
          className="text-right"
          onClick={() => {
            setTab('today');
            setSourceFilter('all');
            setStatusFilter('all');
          }}
        >
          <Stat icon={Users} label={`قائمة ${owner}`} value={queue.length} />
        </button>
        <button
          type="button"
          className="text-right"
          onClick={() => {
            setTab('today');
            setSourceFilter('all');
            setStatusFilter('completed');
          }}
        >
          <Stat icon={CheckCircle2} label="مكتمل اليوم" value={stats.completed} />
        </button>
        <button type="button" className="text-right" onClick={() => setTab('history')}>
          <Stat icon={History} label="إجمالي السجل المكتمل" value={completedHistory.length} />
        </button>
        <button
          type="button"
          className="text-right"
          onClick={() => {
            setTab('doctor-requests');
            setSourceFilter('doctor_request');
            setStatusFilter('all');
          }}
        >
          <Stat icon={UserRoundSearch} label="طلبات دكاترة" value={doctorRequestQueue.length} />
        </button>
        <button
          type="button"
          className="text-right"
          onClick={() => {
            setTab('care');
            setSourceFilter('at_risk');
            setStatusFilter('all');
          }}
        >
          <Stat
            icon={HeartHandshake}
            label="مهددون"
            value={queue.filter((item) => item.source === 'at_risk').length}
          />
        </button>
        <button
          type="button"
          className="text-right"
          onClick={() => {
            setTab('care');
            setSourceFilter('important');
            setStatusFilter('all');
          }}
        >
          <Stat
            icon={Sparkles}
            label="عملاء مهمون"
            value={queue.filter((item) => item.source === 'important').length}
          />
        </button>
      </section>

      <section className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#10243d] p-2">
        <Tab active={tab === 'today'} onClick={() => setTab('today')} icon={ClipboardList}>
          المطلوب الآن
        </Tab>
        <Tab
          active={tab === 'doctor-requests'}
          onClick={() => setTab('doctor-requests')}
          icon={UserRoundSearch}
        >
          طلبات الدكاترة
        </Tab>
        <Tab active={tab === 'upcoming'} onClick={() => setTab('upcoming')} icon={Clock3}>
          متابعة قادمة ({upcomingQueue.length})
        </Tab>
        <Tab active={tab === 'manager'} onClick={() => setTab('manager')} icon={AlertTriangle}>
          يحتاج مدير ({managerQueue.length})
        </Tab>
        <Tab active={tab === 'care'} onClick={() => setTab('care')} icon={HeartHandshake}>
          الاهتمام والاسترجاع
        </Tab>
        <Tab active={tab === 'history'} onClick={() => setTab('history')} icon={History}>
          تم الانتهاء
        </Tab>
        <Tab active={tab === 'performance'} onClick={() => setTab('performance')} icon={BarChart3}>
          التقارير
        </Tab>
      </section>

      {(tab === 'today' ||
        tab === 'doctor-requests' ||
        tab === 'upcoming' ||
        tab === 'manager' ||
        tab === 'care') && (
        <section className="grid gap-4 xl:grid-cols-[minmax(340px,.8fr)_minmax(0,1.2fr)]">
          <div className="stat-card min-h-[620px]">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="relative">
                <Search className="absolute right-3 top-3 text-slate-500" size={17} />
                <input
                  className="input-dark pr-10"
                  placeholder="اسم / كود / هاتف / سبب"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <button
                type="button"
                className={`btn-secondary flex items-center justify-center gap-2 ${filtersOpen ? 'border-teal-400/40 bg-teal-500/10 text-teal-100' : ''}`}
                onClick={() => setFiltersOpen((current) => !current)}
              >
                <SlidersHorizontal size={17} />
                {filtersOpen ? 'إخفاء الفلاتر' : 'فلاتر متقدمة'}
              </button>
            </div>
            {filtersOpen && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                <select
                  className="input-dark"
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value as 'all' | QueueSource)}
                >
                  <option value="all">كل أنواع المتابعة</option>
                  <option value="doctor_request">طلبات الدكاترة</option>
                  <option value="yesterday">متابعة بعد الشراء</option>
                  <option value="at_risk">استرجاع عميل</option>
                  <option value="important">عميل مهم</option>
                </select>
                <select
                  className="input-dark"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">كل الحالات</option>
                  <option value="open">مفتوح الآن</option>
                  <option value="completed">تم الانتهاء</option>
                </select>
                <select
                  className="input-dark"
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value)}
                >
                  <option value="all">كل الأولويات</option>
                  <option value="عاجل">عاجل</option>
                  <option value="مهم">مهم</option>
                  <option value="عادي">عادي</option>
                </select>
                <select
                  className="input-dark"
                  value={requesterFilter}
                  onChange={(event) => setRequesterFilter(event.target.value)}
                >
                  <option value="all">كل مقدمي الطلب</option>
                  {requesterOptions.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <select
                  className="input-dark"
                  value={dataFilter}
                  onChange={(event) => setDataFilter(event.target.value)}
                >
                  <option value="all">كل حالات البيانات</option>
                  <option value="complete">بيانات مكتملة</option>
                  <option value="issues">تحتاج مراجعة</option>
                </select>
                <select
                  className="input-dark"
                  value={slaFilter}
                  onChange={(event) => setSlaFilter(event.target.value)}
                >
                  <option value="all">كل أوقات التنفيذ</option>
                  <option value="overdue">متأخرة</option>
                  <option value="warning">اقترب الموعد</option>
                  <option value="active">داخل الوقت</option>
                </select>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-400">
              <span>{visibleQueue.length} متابعة في النطاق الحالي</span>
              <button
                className="text-teal-200"
                onClick={() => {
                  setSearch('');
                  setSourceFilter('all');
                  setStatusFilter('all');
                  setPriorityFilter('all');
                  setRequesterFilter('all');
                  setDataFilter('all');
                  setSlaFilter('all');
                }}
              >
                مسح الفلاتر
              </button>
            </div>
            <div className="mt-3 max-h-[540px] space-y-2 overflow-y-auto pl-1">
              {loading ? (
                <Empty text="جاري تجهيز المطلوب الآن..." />
              ) : (
                visibleQueue.map((item, index) => (
                  <button
                    key={`${item.key}-${item.row?.id || index}`}
                    onClick={() => setSelectedKey(item.key)}
                    className={`w-full rounded-2xl border p-3 text-right transition ${selectedKey === item.key ? 'border-teal-300/50 bg-teal-500/15' : item.branchNeedsReview ? 'border-amber-400/30 bg-amber-500/5' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-white">
                          {index + 1}. {item.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {item.code || 'بدون كود'} · {item.phone || 'بدون رقم'} ·{' '}
                          {item.branch || 'فرع غير مؤكد'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge>{sourceLabel(item.source)}</Badge>
                        {Number(item.openRequestCount || 0) > 1 && (
                          <span className="rounded-lg bg-violet-500/20 px-2 py-1 text-[10px] font-black text-violet-100">
                            {item.openRequestCount} طلبات مفتوحة
                          </span>
                        )}
                        <span
                          className={`rounded-lg px-2 py-1 text-[10px] font-black ${slaFor(item).state === 'overdue' ? 'bg-red-500/20 text-red-200' : slaFor(item).state === 'warning' ? 'bg-amber-500/20 text-amber-200' : 'bg-teal-500/15 text-teal-200'}`}
                        >
                          {slaFor(item).label}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs font-black text-cyan-200">
                      {item.priorityReason}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs font-bold text-slate-300">
                      {item.reason}
                    </div>
                    {item.branchNeedsReview && (
                      <div className="mt-2 text-xs font-black text-amber-200">
                        ⚠ فرع العميل يحتاج مراجعة
                      </div>
                    )}
                  </button>
                ))
              )}
              {!loading && !visibleQueue.length && <Empty text="لا توجد نتائج مطابقة." />}
            </div>
          </div>
          <div className="stat-card min-h-[620px]">
            {selected ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-black text-white">{selected.name}</h2>
                      <Badge>{sourceLabel(selected.source)}</Badge>
                      <Badge>{displayStatus(selected.status)}</Badge>
                      <Badge>{selected.segment}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-400">
                      {selected.code || 'بدون كود'} · {selected.phone || 'بدون رقم'} ·{' '}
                      {selected.branch || 'فرع غير مؤكد'}
                    </p>
                    <p className="mt-1 text-xs font-black text-cyan-200">
                      الأولوية: {selected.priorityReason}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      className="btn-secondary"
                      href={`/customer-360?customerId=${encodeURIComponent(selected.customer?.customer_id || selected.customer?.id || selected.row?.customer_id || '')}&code=${encodeURIComponent(selected.code)}`}
                    >
                      ملف العميل
                    </a>
                    <button className="btn-primary" onClick={() => void openResult(selected)}>
                      تسجيل النتيجة
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Info label="مقدم الطلب" value={selected.requestedBy} />
                  <Info label="حالة الفرع" value={selected.branchEvidence} />
                  <Info label="آخر نتيجة" value={resultOf(selected.row)} />
                  <Info label="إجمالي المشتريات" value={moneyOrUnavailable(selected.totalSpent)} />
                  <Info label="متوسط الفاتورة" value={moneyOrUnavailable(selected.avgInvoice)} />
                  <Info
                    label="آخر شراء"
                    value={
                      selected.lastPurchase
                        ? new Date(selected.lastPurchase).toLocaleDateString('ar-EG')
                        : 'غير متاح'
                    }
                  />
                </div>
                {selectedDataIssues.length > 0 && (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm font-black text-amber-100">
                    <div>⚠ بيانات تحتاج مراجعة</div>
                    <ul className="mt-2 space-y-1 text-xs font-bold">
                      {selectedDataIssues.map((issue) => (
                        <li key={issue}>• {issue}</li>
                      ))}
                    </ul>
                    <div className="mt-2 text-xs font-bold">
                      لن يتم تعديل ملف العميل تلقائيًا أو نقل المتابعة بين الفروع.
                    </div>
                  </div>
                )}
                {Number(selected.openRequestCount || 0) > 1 && (
                  <div className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4">
                    <div className="font-black text-violet-100">
                      لهذا العميل {selected.openRequestCount} طلبات مفتوحة
                    </div>
                    <p className="mt-1 text-xs font-bold text-violet-200/80">
                      تم تجميعها في بطاقة واحدة دون حذف أي سجل. المعروض بالأعلى هو أحدث طلب.
                    </p>
                    <div className="mt-3 space-y-2">
                      {selected.relatedRequests?.slice(0, 5).map((request) => (
                        <div
                          key={request.id}
                          className="rounded-xl border border-white/10 bg-black/10 p-3 text-xs font-bold text-slate-200"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {cleanReason(request.request_details || request.followup_reason)}
                            </span>
                            <span className="text-slate-400">
                              {request.created_at
                                ? new Date(request.created_at).toLocaleDateString('ar-EG')
                                : 'بدون تاريخ'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                  <div className="text-xs font-black text-amber-200">سبب المتابعة</div>
                  <div className="mt-2 text-base font-bold leading-7 text-amber-50">
                    {selected.reason}
                  </div>
                </div>
                <div className="rounded-2xl border border-teal-400/20 bg-teal-500/10 p-4">
                  <div className="text-xs font-black text-teal-200">
                    دليل التواصل · {scriptPackFor(selected).title}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        ['call', 'المكالمة'],
                        ['questions', 'الأسئلة'],
                        ['objections', 'الاعتراضات'],
                        ['whatsapp', 'واتساب'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setScriptSection(key)}
                        className={`rounded-xl px-3 py-2 text-xs font-black ${scriptSection === key ? 'bg-teal-400 text-slate-950' : 'border border-white/10 bg-black/10 text-teal-50'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {scriptSection === 'call' && (
                    <div className="mt-3">
                      <div className="mt-2 rounded-xl border border-teal-300/15 bg-black/10 p-3 text-sm font-bold text-teal-50">
                        <span className="text-teal-200">هدف المكالمة: </span>
                        {scriptPackFor(selected).objective}
                      </div>
                      <p className="mt-2 text-sm font-bold leading-7 text-teal-50">
                        {scriptPackFor(selected).opening}
                      </p>
                      <p className="mt-3 text-sm font-bold leading-7 text-teal-50">
                        <span className="text-teal-200">إنهاء مناسب:</span>{' '}
                        {scriptPackFor(selected).closing}
                      </p>
                      <p className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/10 p-3 text-sm font-bold text-cyan-50">
                        <span className="text-cyan-200">الخطوة التالية: </span>
                        {scriptPackFor(selected).nextStep}
                      </p>
                    </div>
                  )}
                  {scriptSection === 'questions' && (
                    <ol className="mt-3 space-y-2">
                      {scriptPackFor(selected).questions.map((question, index) => (
                        <li
                          key={question}
                          className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm font-bold text-teal-50"
                        >
                          <span className="ml-2 text-teal-200">{index + 1}.</span> {question}
                        </li>
                      ))}
                    </ol>
                  )}
                  {scriptSection === 'objections' && (
                    <div className="mt-3 space-y-2">
                      {scriptPackFor(selected).objections.map((item) => (
                        <div
                          key={item.objection}
                          className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm font-bold text-teal-50"
                        >
                          <div className="text-amber-200">العميل: {item.objection}</div>
                          <div className="mt-2">الرد: {item.response}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {scriptSection === 'whatsapp' && (
                    <div className="mt-3">
                      <p className="whitespace-pre-wrap rounded-xl border border-white/10 bg-black/10 p-4 text-sm font-bold leading-7 text-teal-50">
                        {scriptPackFor(selected).whatsapp}
                      </p>
                      <button
                        className="btn-secondary mt-3 flex items-center gap-1"
                        onClick={() => copyScript(selected)}
                      >
                        <Copy size={15} /> نسخ رسالة واتساب
                      </button>
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 text-xs font-black text-slate-300">
                    تسجيل محاولة تواصل سريعة
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <button
                      className="btn-secondary"
                      onClick={() => void saveContactAttempt(selected, 'call_no_answer')}
                    >
                      اتصال ولم يرد
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => void saveContactAttempt(selected, 'whatsapp_sent')}
                    >
                      تم إرسال واتساب
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => void saveContactAttempt(selected, 'phone_off')}
                    >
                      الهاتف مغلق
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => void saveContactAttempt(selected, 'invalid_number')}
                    >
                      الرقم غير صحيح
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => void saveContactAttempt(selected, 'callback_requested')}
                    >
                      طلب التواصل لاحقًا
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => void saveContactAttempt(selected, 'connected')}
                    >
                      تم التواصل بنجاح
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <button className="btn-primary" onClick={() => void openResult(selected)}>
                    تسجيل نتيجة
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={!selected.phone}
                    onClick={() =>
                      selected.phone &&
                      window.open(
                        generateWhatsAppLink(selected.phone, scriptFor(selected)),
                        '_blank'
                      )
                    }
                  >
                    واتساب
                  </button>
                  <a
                    className="btn-secondary text-center"
                    href={selected.phone ? `tel:${selected.phone}` : undefined}
                  >
                    اتصال
                  </a>
                  <button className="btn-secondary" onClick={() => setQuickOpen(true)}>
                    إضافة ملاحظة/متابعة
                  </button>
                </div>
              </div>
            ) : (
              <Empty text="اختر عميلًا من القائمة لعرض ملفه." />
            )}
          </div>
        </section>
      )}

      {tab === 'history' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat icon={History} label="إجمالي النتائج" value={historySummary.total} />
            <Stat icon={ShoppingBag} label="اشتروا بعد المتابعة" value={historySummary.purchases} />
            <MoneyStat label="مبيعات المتابعات" value={historySummary.sales} />
            <Stat icon={AlertTriangle} label="احتاجت مدير" value={historySummary.needsManager} />
            <Stat icon={Clock3} label="متابعة قادمة" value={historySummary.nextFollowup} />
          </div>
          <div className="stat-card">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-2xl font-black text-white">
                  سجل المتابعات المكتملة — {branch}
                </h2>
                <p className="text-sm font-bold text-slate-400">
                  تفاصيل النتيجة والتقييم والشراء والخطوة التالية.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="relative">
                  <Search className="absolute right-3 top-3 text-slate-500" size={17} />
                  <input
                    className="input-dark pr-10"
                    placeholder="اسم / كود / هاتف"
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                  />
                </div>
                <select
                  className="input-dark"
                  value={historyPeriod}
                  onChange={(event) => setHistoryPeriod(event.target.value as HistoryPeriod)}
                >
                  <option value="cycle">الدورة الحالية 26–25</option>
                  <option value="today">اليوم</option>
                  <option value="7d">آخر 7 أيام</option>
                  <option value="all">كل السجل المحمل</option>
                </select>
                <select
                  className="input-dark"
                  value={historyResult}
                  onChange={(event) => setHistoryResult(event.target.value)}
                >
                  <option value="all">كل النتائج</option>
                  {[...new Set(completedHistory.map(resultOf))].map((result) => (
                    <option key={result}>{result}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-[1180px] w-full text-sm">
                <thead className="sticky top-0 bg-[#173252] text-slate-300">
                  <tr>
                    <th className="p-3 text-right">العميل</th>
                    <th className="p-3 text-right">التنفيذ</th>
                    <th className="p-3 text-right">المسؤول</th>
                    <th className="p-3 text-right">النتيجة</th>
                    <th className="p-3 text-right">الرضا</th>
                    <th className="p-3 text-right">المتابعة القادمة</th>
                    <th className="p-3 text-right">الشراء</th>
                    <th className="p-3 text-right">التقييم</th>
                    <th className="p-3 text-right">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => {
                    const item = followupToItem(row);
                    const completedAt = rowValue(
                      row,
                      'completed_at',
                      'updated_at',
                      'followup_date',
                      'date'
                    );
                    return (
                      <tr
                        key={row.id}
                        className="border-t border-white/5 text-slate-200 hover:bg-white/5"
                      >
                        <td className="p-3">
                          <div className="font-black text-white">{item.name}</div>
                          <div className="text-xs text-slate-400">
                            {item.code || 'بدون كود'} · {item.phone || 'بدون رقم'}
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {completedAt ? new Date(completedAt).toLocaleString('ar-EG') : '—'}
                        </td>
                        <td className="p-3">
                          {row.responsible_name ||
                            row.assigned_to ||
                            row.assigned_doctor ||
                            row.created_by_name ||
                            'غير محدد'}
                        </td>
                        <td className="p-3">
                          <Badge>{resultOf(row)}</Badge>
                        </td>
                        <td className="p-3">{row.customer_satisfaction || 'غير واضح'}</td>
                        <td className="p-3 whitespace-nowrap">
                          {row.next_followup_date
                            ? new Date(row.next_followup_date).toLocaleDateString('ar-EG')
                            : '—'}
                        </td>
                        <td className="p-3">
                          <div className="font-black text-emerald-200">
                            {formatCurrency(rowNumber(row, 'purchase_amount'))}
                          </div>
                          <div className="text-xs text-slate-400">
                            {row.purchase_invoice_no || 'بدون فاتورة'}
                          </div>
                        </td>
                        <td className="p-3">{row.quality_rating ?? '—'} / 5</td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button
                              className="btn-secondary flex items-center gap-1"
                              onClick={() => setDetailsRow(row)}
                            >
                              <Eye size={15} /> التفاصيل
                            </button>
                            <a
                              className="btn-secondary"
                              href={`/customer-360?customerId=${encodeURIComponent(item.customer?.customer_id || item.customer?.id || row.customer_id || '')}&code=${encodeURIComponent(item.code)}`}
                            >
                              360
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!historyRows.length && <Empty text="لا توجد متابعات مطابقة للفلاتر الحالية." />}
            </div>
          </div>
        </section>
      )}

      {tab === 'performance' && <CustomerServiceExecutionDashboard branch={branch} />}

      <QuickFollowupModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onCreated={() => void loadWorkspace()}
        defaultBranch={branch}
      />
      {resultRow && (
        <FollowupResultModal
          followup={resultRow as unknown as DailyFollowup}
          onClose={() => setResultRow(null)}
          onSave={saveResult}
        />
      )}
      {detailsRow && <FollowupDetails row={detailsRow} onClose={() => setDetailsRow(null)} />}
    </div>
  );
}

function FollowupDetails({ row, onClose }: { row: FollowupRow; onClose: () => void }) {
  const item = followupToItem(row);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-start bg-black/65 backdrop-blur-sm"
      dir="rtl"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0d2038] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-xs font-black text-teal-300">تفاصيل المتابعة</div>
            <h2 className="mt-1 text-2xl font-black text-white">{item.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {item.code || 'بدون كود'} · {item.phone || 'بدون رقم'} · {item.branch}
            </p>
          </div>
          <button
            className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Info label="سبب المتابعة" value={item.reason} />
          <Info label="النتيجة" value={resultOf(row)} />
          <Info
            label="المسؤول"
            value={
              row.responsible_name ||
              row.assigned_to ||
              row.assigned_doctor ||
              row.created_by_name ||
              'غير محدد'
            }
          />
          <Info label="وسيلة التواصل" value={row.contact_method || 'غير محددة'} />
          <Info label="رضا العميل" value={row.customer_satisfaction || 'غير واضح'} />
          <Info
            label="تقييم الجودة"
            value={row.quality_rating == null ? 'غير مقيم' : `${row.quality_rating} / 5`}
          />
          <Info
            label="متابعة قادمة"
            value={
              row.next_followup_date
                ? new Date(row.next_followup_date).toLocaleString('ar-EG')
                : 'لا توجد'
            }
          />
          <Info label="قيمة الشراء" value={formatCurrency(rowNumber(row, 'purchase_amount'))} />
        </div>
        <div className="mt-4 space-y-4">
          <Panel title="ملخص المتابعة">
            <p>
              {row.followup_summary || row.followup_notes || row.notes || 'لا توجد ملاحظات مسجلة.'}
            </p>
          </Panel>
          <Panel title="التقييم التجاري">
            <p>
              فهم الاحتياج:{' '}
              {row.need_understood == null ? 'غير محدد' : row.need_understood ? 'نعم' : 'لا'} ·
              Cross Sell: {row.cross_sell_offered ? 'تم' : 'لا'} · Up Sell:{' '}
              {row.up_sell_offered ? 'تم' : 'لا'}
            </p>
          </Panel>
          <Panel title="الشراء بعد المتابعة">
            <p>
              رقم الفاتورة: {row.purchase_invoice_no || 'غير مسجل'} · سبب عدم الشراء:{' '}
              {row.no_purchase_reason || 'غير مسجل'}
            </p>
          </Panel>
          <Panel title="ملاحظة داخلية">
            <p>{row.doctor_internal_note || 'لا توجد ملاحظة داخلية.'}</p>
          </Panel>
        </div>
      </aside>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-teal-500/15 p-2 text-teal-300">
          <Icon size={19} />
        </div>
        <div>
          <div className="text-xs font-bold text-slate-400">{label}</div>
          <div className="text-2xl font-black text-white">{value}</div>
        </div>
      </div>
    </div>
  );
}
function MoneyStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-300">
          <ShoppingBag size={19} />
        </div>
        <div>
          <div className="text-xs font-bold text-slate-400">{label}</div>
          <div className="text-xl font-black text-white">{formatCurrency(value)}</div>
        </div>
      </div>
    </div>
  );
}
function Tab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${active ? 'bg-teal-500 text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}
    >
      <Icon size={17} />
      {children}
    </button>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-teal-400/20 bg-teal-500/10 px-2 py-1 text-xs font-black text-teal-100">
      {children}
    </span>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/5 p-3">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-1 break-words font-black text-white">{value}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 text-sm font-black text-white">{title}</div>
      <div className="text-sm font-bold leading-7 text-slate-300">{children}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm font-bold text-slate-400">
      {text}
    </div>
  );
}
