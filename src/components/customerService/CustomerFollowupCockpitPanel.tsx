import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Eye,
  History,
  Inbox,
  Loader2,
  MessageCircle,
  PhoneOff,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeEgyptianPhone } from '@/lib/customerFollowupCore';
import { classifyCustomer, customerStatus } from '@/lib/customerMetrics';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { generateWhatsAppLink } from '@/lib/whatsapp';

const CustomerQuickDetailsModal = lazy(() => import('@/components/customers/CustomerQuickDetailsModal'));

const ALL_BRANCHES = 'كل الفروع';
const PER_BRANCH_QUEUE_LIMIT = 25;
const TOTAL_DAILY_QUEUE_LIMIT = PER_BRANCH_QUEUE_LIMIT * 2;
const FETCH_BATCH = 1000;
const EXECUTION_ACTIONS = new Set(['message_sent', 'no_answer', 'replied', 'completed', 'scheduled']);
const REVIEW_ACTIONS = new Set(['reviewed', 'approved', 'rejected', 'returned_for_completion', 'escalated']);

type WorkspaceTab = 'queue' | 'waiting' | 'review' | 'contacted' | 'performance';
type QuickAction = 'message_sent' | 'no_answer' | 'replied' | 'scheduled' | 'completed';
type ReviewAction = 'approved' | 'returned_for_completion' | 'escalated';

type FollowupRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  phone: string | null;
  branch: string | null;
  priority: string | null;
  status: string | null;
  followup_status: string | null;
  contact_status: string | null;
  response_status: string | null;
  followup_result: string | null;
  contact_result: string | null;
  followup_summary: string | null;
  followup_reason: string | null;
  request_details: string | null;
  notes: string | null;
  next_followup_date: string | null;
  created_at: string | null;
  contacted_at: string | null;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  attempt_count: number | null;
  needs_next_followup: boolean | null;
  needs_manager: boolean | null;
  total_spent: number | null;
  average_monthly_purchase_count: number | null;
  last_purchase_date: string | null;
  segment: string | null;
  customer_status: string | null;
  customer_metrics: Record<string, unknown> | null;
};

type AuditEvent = {
  id: string;
  followup_id: string | null;
  action: string;
  actor_name: string | null;
  created_at: string;
  branch: string | null;
  metadata: Record<string, unknown> | null;
};

type ActorProfile = {
  role: 'executor' | 'reviewer' | 'general_manager' | 'other';
  displayName: string;
  branch: string | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const dayKey = (value?: string | null) => text(value).slice(0, 10);
const localDayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tomorrowKey = () => { const date = new Date(); date.setDate(date.getDate() + 1); return localDayKey(date); };
const customerName = (row: FollowupRow) => text(row.customer_name || row.name || 'عميل غير مسجل');
const customerPhone = (row: FollowupRow) => normalizeEgyptianPhone(text(row.customer_phone || row.phone));
const rawStatus = (row: FollowupRow) => text(row.contact_status || row.followup_status || row.response_status || row.status || row.followup_result);
const normalizedActor = (value: unknown) => text(value).toLowerCase().replace(/[\/._-]/g, ' ').replace(/\s+/g, ' ').trim();
const metricNumber = (row: FollowupRow, key: string, fallback = 0) => {
  const number = Number(row.customer_metrics?.[key] ?? fallback ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const monthlyAverage = (row: FollowupRow) => metricNumber(row, 'avg_monthly', metricNumber(row, 'monthly_average'));
const lastPurchase = (row: FollowupRow) => dayKey(row.last_purchase_date) || dayKey(text(row.customer_metrics?.last_purchase));
const importance = (row: FollowupRow) => classifyCustomer(monthlyAverage(row));
const activity = (row: FollowupRow) => customerStatus(lastPurchase(row));
const isWaiting = (row: FollowupRow) => /في انتظار الرد|تم إرسال رسالة|message_sent|waiting_reply/i.test(rawStatus(row));
const isNoAnswer = (row: FollowupRow) => /لم يرد|no_answer/i.test(rawStatus(row));
const isUrgent = (row: FollowupRow) => Boolean(row.needs_manager || /عاجل|urgent|high|شكوى|تصعيد/i.test(`${row.priority || ''} ${rawStatus(row)} ${row.followup_reason || ''}`));
const isOverdue = (row: FollowupRow) => Boolean(dayKey(row.next_followup_date) && dayKey(row.next_followup_date) < localDayKey());
const isDueNow = (row: FollowupRow) => !dayKey(row.next_followup_date) || dayKey(row.next_followup_date) <= localDayKey();
const isPendingReview = (row: FollowupRow) => /pending_review|Ã˜Â§Ã™â€ Ã˜ÂªÃ˜Â¸Ã˜Â§Ã˜Â± Ã™â€¦Ã˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹Ã˜Â©|Ã™ÂÃ™Å  Ã˜Â§Ã™â€ Ã˜ÂªÃ˜Â¸Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹Ã˜Â©/i.test(rawStatus(row));

function actorProfile(name: unknown): ActorProfile {
  const normalized = normalizedActor(name);
  if (normalized.includes('ضحى') || normalized.includes('ضحي')) return { role: 'executor', displayName: 'د/ ضحى', branch: 'فرع الشامي' };
  if (normalized.includes('دنيا')) return { role: 'executor', displayName: 'د/ دنيا', branch: 'فرع شكري' };
  if (normalized.includes('علا')) return { role: 'reviewer', displayName: 'د/ علا', branch: null };
  if (normalized.includes('المدير العام') || normalized.includes('معاذ')) return { role: 'general_manager', displayName: 'المدير العام', branch: null };
  return { role: 'other', displayName: text(name) || 'النظام / غير محدد', branch: null };
}

function assignedExecutor(branch: string | null | undefined) {
  const normalized = normalizeBranchName(branch || '');
  return normalized.includes('الشامي') ? 'د/ ضحى' : normalized.includes('شكري') ? 'د/ دنيا' : 'غير محدد';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function dedupeRows(rows: FollowupRow[]) {
  const selected = new Map<string, FollowupRow>();
  rows.forEach((row) => {
    const key = text(row.customer_code || customerPhone(row) || customerName(row)).toLowerCase();
    if (!key) return;
    const current = selected.get(key);
    const currentAttempts = Number(current?.attempt_count || 0);
    const rowAttempts = Number(row.attempt_count || 0);
    const currentDate = new Date(current?.last_attempt_at || current?.created_at || 0).getTime();
    const rowDate = new Date(row.last_attempt_at || row.created_at || 0).getTime();
    if (!current || rowAttempts > currentAttempts || (rowAttempts === currentAttempts && rowDate > currentDate)) selected.set(key, row);
  });
  return Array.from(selected.values());
}

function smartScore(row: FollowupRow) {
  const days = activity(row).days ?? 0;
  let score = 0;
  if (isUrgent(row)) score += 100000;
  if (isOverdue(row)) score += 50000;
  if (isNoAnswer(row)) score += 12000;
  score += Math.min(monthlyAverage(row), 30000) * 2;
  score += Math.min(Number(row.total_spent || metricNumber(row, 'total_spent')), 100000) / 10;
  score += Math.min(days, 365) * 25;
  score += Math.min(Number(row.attempt_count || 0), 5) * 500;
  return score;
}

const actionLabels: Record<string, string> = {
  message_sent: 'تم إرسال رسالة للعميل',
  no_answer: 'لم يرد العميل',
  replied: 'تم تسجيل رد العميل',
  scheduled: 'تم تحديد موعد متابعة',
  completed: 'تم إكمال المتابعة',
  reviewed: 'تمت مراجعة المتابعة',
  approved: 'تم اعتماد المتابعة',
  rejected: 'تم رفض المتابعة',
  returned_for_completion: 'أُعيدت لاستكمال البيانات',
  escalated: 'تم تصعيد الحالة',
};

export default function CustomerFollowupCockpitPanel({ onOpenTools }: { onOpenTools?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const currentProfile = actorProfile(user?.name);
  const canExecute = ['executor', 'reviewer', 'general_manager'].includes(currentProfile.role);
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<WorkspaceTab>('queue');
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [contactChannel, setContactChannel] = useState('واتساب');
  const [performanceDays, setPerformanceDays] = useState(7);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    try {
      const allRows: FollowupRow[] = [];
      for (let start = 0; ; start += FETCH_BATCH) {
        let query = supabase
          .from('daily_followups')
          .select('id,customer_id,customer_name,name,customer_code,customer_phone,phone,branch,priority,status,followup_status,contact_status,response_status,followup_result,contact_result,followup_summary,followup_reason,request_details,notes,next_followup_date,created_at,contacted_at,first_attempt_at,last_attempt_at,attempt_count,needs_next_followup,needs_manager,total_spent,average_monthly_purchase_count,last_purchase_date,segment,customer_status,customer_metrics')
          .eq('is_hidden', false)
          .is('completed_at', null)
          .is('cancelled_at', null)
          .is('archived_at', null)
          .or('is_duplicate.is.null,is_duplicate.eq.false')
          .is('duplicate_of', null)
          .order('created_at', { ascending: false })
          .range(start, start + FETCH_BATCH - 1);
        if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);
        const { data, error } = await query;
        if (error) throw error;
        const batch = (data || []) as FollowupRow[];
        allRows.push(...batch);
        if (batch.length < FETCH_BATCH) break;
      }

      const since = new Date();
      since.setDate(since.getDate() - 30);
      let auditQuery = supabase
        .from('customer_followup_audit_log')
        .select('id,followup_id,action,actor_name,created_at,branch,metadata')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(5000);
      if (branch !== ALL_BRANCHES) auditQuery = auditQuery.eq('branch', branch);
      const { data: auditData, error: auditError } = await auditQuery;
      if (auditError) throw auditError;

      setRows(dedupeRows(allRows));
      setEvents((auditData || []) as AuditEvent[]);
    } catch (error) {
      toast.error(`تعذر تحميل مركز المتابعات: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [branch, managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const waitingRows = useMemo(() => rows.filter(isWaiting).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);
  const reviewRows = useMemo(() => rows.filter(isPendingReview).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);
  const queueCandidates = useMemo(() => rows.filter((row) => !isWaiting(row) && !isPendingReview(row) && isDueNow(row)).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);
  const smartQueue = useMemo(() => {
    if (branch !== ALL_BRANCHES) {
      return queueCandidates.slice(0, PER_BRANCH_QUEUE_LIMIT);
    }

    const shamyQueue = queueCandidates
      .filter((row) => normalizeBranchName(row.branch || '').includes('Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã™â€¦Ã™Å '))
      .slice(0, PER_BRANCH_QUEUE_LIMIT);

    const shokryQueue = queueCandidates
      .filter((row) => normalizeBranchName(row.branch || '').includes('Ã˜Â´Ã™Æ’Ã˜Â±Ã™Å '))
      .slice(0, PER_BRANCH_QUEUE_LIMIT);

    return [...shamyQueue, ...shokryQueue].sort((a, b) => smartScore(b) - smartScore(a));
  }, [branch, queueCandidates]);
  const backlogCount = Math.max(0, queueCandidates.length - smartQueue.length);
  const visibleRows = useMemo(() => {
    const source = tab === 'waiting' ? waitingRows : tab === 'review' ? reviewRows : smartQueue;
    const q = search.trim().toLowerCase();
    return q ? source.filter((row) => `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''} ${row.followup_reason || ''}`.toLowerCase().includes(q)) : source;
  }, [reviewRows, search, smartQueue, tab, waitingRows]);

  const periodEvents = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - performanceDays);
    return events.filter((event) => new Date(event.created_at) >= since);
  }, [events, performanceDays]);

  const executionEvents = useMemo(() => periodEvents.filter((event) => EXECUTION_ACTIONS.has(event.action) && actorProfile(event.actor_name).role === 'executor'), [periodEvents]);
  const contactedEvents = useMemo(() => events.filter((event) => EXECUTION_ACTIONS.has(event.action)), [events]);

  const performance = useMemo(() => ['د/ ضحى', 'د/ دنيا'].map((executor) => {
    const relevant = executionEvents.filter((event) => actorProfile(event.actor_name).displayName === executor);
    const customers = new Set(relevant.map((event) => text(event.metadata?.customer_code) || event.followup_id).filter(Boolean));
    const attempts = relevant.filter((event) => ['message_sent', 'no_answer', 'replied'].includes(event.action)).length;
    const messages = relevant.filter((event) => event.action === 'message_sent').length;
    const noAnswer = relevant.filter((event) => event.action === 'no_answer').length;
    const replied = relevant.filter((event) => event.action === 'replied').length;
    const completed = relevant.filter((event) => event.action === 'completed').length;
    return {
      actor: executor,
      branch: executor === 'د/ ضحى' ? 'فرع الشامي' : 'فرع شكري',
      customers: customers.size,
      attempts,
      messages,
      noAnswer,
      replied,
      completed,
      responseRate: attempts ? replied / attempts : 0,
      completionRate: customers.size ? completed / customers.size : 0,
    };
  }), [executionEvents]);

  const reviewSummary = useMemo(() => {
    const reviewEvents = periodEvents.filter((event) => REVIEW_ACTIONS.has(event.action) && actorProfile(event.actor_name).role === 'reviewer');
    return {
      reviewed: reviewEvents.length,
      approved: reviewEvents.filter((event) => event.action === 'approved').length,
      returned: reviewEvents.filter((event) => event.action === 'returned_for_completion' || event.action === 'rejected').length,
      escalated: reviewEvents.filter((event) => event.action === 'escalated').length,
    };
  }, [periodEvents]);

  const audit = async (row: FollowupRow, action: string, metadata: Record<string, unknown>) => {
    const profile = actorProfile(user?.name);
    const { error } = await supabase.from('customer_followup_audit_log').insert({
      followup_id: row.id,
      customer_id: row.customer_id || null,
      action,
      actor_staff_id: user?.staffId || user?.id || null,
      actor_name: profile.displayName,
      branch: row.branch || branch,
      metadata: { ...metadata, actor_role: profile.role, assigned_executor: assignedExecutor(row.branch) },
    });
    if (error) throw error;
  };

  const loadHistory = async (row: FollowupRow) => {
    setHistoryOpen(true);
    const { data, error } = await supabase
      .from('customer_followup_audit_log')
      .select('id,followup_id,action,actor_name,created_at,branch,metadata')
      .eq('followup_id', row.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error(`تعذر تحميل سجل المتابعة: ${error.message}`);
    setHistory((data || []) as AuditEvent[]);
  };

  const executeAction = async (action: QuickAction) => {
    if (!selected) return;
    if (!canExecute) {
      toast.error('التنفيذ متاح فقط لد/ ضحى لفرع الشامي ود/ دنيا لفرع شكري. حسابك للمراجعة والإشراف.');
      return;
    }
    if (currentProfile.branch && normalizeBranchName(selected.branch || '') !== normalizeBranchName(currentProfile.branch)) {
      toast.error(`هذه الحالة مخصصة لـ ${assignedExecutor(selected.branch)} وليست ضمن فرعك.`);
      return;
    }
    if ((action === 'replied' || action === 'completed') && actionNote.trim().length < 3) {
      toast.error('اكتب ملخصًا واضحًا لما تم مع العميل قبل الحفظ');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const isAttempt = ['message_sent', 'no_answer', 'replied'].includes(action);
      const attempts = Number(selected.attempt_count || 0) + (isAttempt ? 1 : 0);
      let payload: Record<string, unknown> = { updated_by: user?.id || null };
      let result = '';
      let nextDate: string | null = null;

      if (action === 'message_sent') {
        nextDate = tomorrowKey();
        result = 'في انتظار رد العميل';
        payload = { ...payload, contact_status: 'في انتظار الرد', followup_status: 'في انتظار الرد', response_status: 'waiting_reply', status: 'في انتظار الرد', contacted_at: now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
      } else if (action === 'no_answer') {
        nextDate = tomorrowKey();
        result = 'لم يرد العميل';
        payload = { ...payload, contact_status: 'لم يرد', followup_status: 'لم يرد', response_status: 'no_answer', status: 'لم يرد', last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
      } else if (action === 'replied') {
        nextDate = scheduledDate || localDayKey();
        result = 'تم الرد وجارٍ استكمال المتابعة';
        payload = { ...payload, contact_status: 'تم الرد', followup_status: 'جارٍ التواصل', response_status: 'replied', status: 'جارٍ التواصل', last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim(), followup_result: actionNote.trim() };
      } else if (action === 'scheduled') {
        nextDate = scheduledDate;
        result = 'تم تحديد موعد متابعة جديد';
        payload = { ...payload, next_followup_date: nextDate, followup_status: 'scheduled', status: 'open', needs_next_followup: true };
      } else {
        result = 'تم إكمال المتابعة';
        payload = { ...payload, completed_at: now, status: 'completed', followup_status: 'completed', followup_result: actionNote.trim(), followup_summary: actionNote.trim(), needs_next_followup: false, is_hidden: true, hidden_at: now, hidden_by: currentProfile.displayName, hidden_reason: 'تم إكمال المتابعة من قائمة التشغيل الذكية' };
      }

      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, {
        attempt_count: attempts,
        contact_channel: contactChannel,
        result,
        notes: actionNote.trim() || null,
        next_followup_date: nextDate,
        customer_name: customerName(selected),
        customer_code: selected.customer_code,
      });
      toast.success(action === 'completed' ? 'تم الإكمال وظهر العميل التالي تلقائيًا' : 'تم حفظ الإجراء');
      setSelected(null);
      setActionNote('');
      setScheduledDate('');
      await load();
    } catch (error) {
      toast.error(`تعذر حفظ الإجراء: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const executeReviewAction = async (action: ReviewAction) => {
    if (!selected || !isPendingReview(selected)) return;
    if (!['reviewer', 'general_manager'].includes(currentProfile.role)) {
      toast.error('Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¹Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¯ Ã˜Â£Ã™Ë† Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã™â€¦Ã˜ÂªÃ˜Â§Ã˜Â­Ã˜Â§Ã™â€  Ã™â€žÃ˜Â¯/ Ã˜Â¹Ã™â€žÃ˜Â§ Ã™Ë†Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¯Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¹Ã˜Â§Ã™â€¦ Ã™ÂÃ™â€šÃ˜Â·.');
      return;
    }
    if (action !== 'approved' && actionNote.trim().length < 3) {
      toast.error('Ã˜Â§Ã™Æ’Ã˜ÂªÃ˜Â¨ Ã˜Â³Ã˜Â¨Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜Â£Ã™Ë† Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ˜Â¹Ã™Å Ã˜Â¯ Ã™â€šÃ˜Â¨Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â¸.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      let payload: Record<string, unknown>;
      let result: string;

      if (action === 'approved') {
        result = 'Ã˜ÂªÃ™â€¦ Ã˜Â§Ã˜Â¹Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â© Ã™Ë†Ã˜Â¥Ã˜ÂºÃ™â€žÃ˜Â§Ã™â€šÃ™â€¡Ã˜Â§ Ã™â€ Ã™â€¡Ã˜Â§Ã˜Â¦Ã™Å Ã™â€¹Ã˜Â§';
        payload = {
          completed_at: now,
          status: 'completed',
          followup_status: 'completed',
          contact_status: 'Ã˜ÂªÃ™â€¦ Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¹Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¯',
          needs_next_followup: false,
          is_hidden: true,
          hidden_at: now,
          hidden_by: currentProfile.displayName,
          hidden_reason: 'Ã˜ÂªÃ™â€¦ Ã˜Â§Ã˜Â¹Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â© Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹Ã˜Â©',
          updated_by: user?.id || null,
        };
      } else if (action === 'returned_for_completion') {
        result = 'Ã˜Â£Ã™ÂÃ˜Â¹Ã™Å Ã˜Â¯Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â© Ã™â€žÃ™â€žÃ™â€¦Ã™â€ Ã™ÂÃ˜Â°Ã˜Â© Ã™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ™Æ’Ã™â€¦Ã˜Â§Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â£Ã™Ë† Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž';
        payload = {
          status: 'open',
          followup_status: 'returned_for_completion',
          contact_status: 'Ã˜Â£Ã™ÂÃ˜Â¹Ã™Å Ã˜Â¯Ã˜Âª Ã™â€žÃ™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ™Æ’Ã™â€¦Ã˜Â§Ã™â€ž',
          needs_next_followup: true,
          next_followup_date: localDayKey(),
          is_hidden: false,
          followup_summary: actionNote.trim(),
          updated_by: user?.id || null,
        };
      } else {
        result = 'Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜ÂµÃ˜Â¹Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ˜Â© Ã™â€žÃ™â€žÃ˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â©';
        payload = {
          status: 'pending_review',
          followup_status: 'pending_review',
          contact_status: 'Ã˜ÂªÃ™â€¦ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ˜Â¹Ã™Å Ã˜Â¯',
          needs_manager: true,
          is_hidden: false,
          followup_summary: actionNote.trim(),
          updated_by: user?.id || null,
        };
      }

      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, {
        result,
        notes: actionNote.trim() || null,
        customer_name: customerName(selected),
        customer_code: selected.customer_code,
        reviewed_by: currentProfile.displayName,
      });
      toast.success(result);
      setSelected(null);
      setActionNote('');
      await load();
    } catch (error) {
      toast.error(`Ã˜ÂªÃ˜Â¹Ã˜Â°Ã˜Â± Ã˜Â­Ã™ÂÃ˜Â¸ Ã™â€šÃ˜Â±Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹Ã˜Â©: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const tabs: Array<[WorkspaceTab, string, number, typeof Inbox]> = [
    ['queue', 'قائمة اليوم', smartQueue.length, Inbox],
    ['waiting', 'انتظار الرد', waitingRows.length, Clock3],
    ['contacted', 'سجل التواصل', contactedEvents.length, History],
    ['performance', 'أداء خدمة العملاء', 2, BarChart3],
  ];

  return <>
    <section className="mx-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-black text-cyan-300">تشغيل ومراجعة منفصلان</p>
          <h2 className="text-xl font-black text-white">د/ ضحى للشامي · د/ دنيا لشكري · د/ علا للمراجعة · المدير العام للمتابعة العليا</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">لا تُحتسب الإنشاءات أو المشاهدات أو التصحيحات الإدارية ضمن أداء التنفيذ.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option>{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option></select> : <div className="input-dark font-black text-cyan-100">{userBranch}</div>}
          <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>} تحديث</button>
          {onOpenTools ? <button className="btn-secondary flex items-center gap-2" onClick={onOpenTools}><Wrench size={16}/> الإدارة والتصحيح</button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tabs.map(([id, label, count, Icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-2xl border p-3 text-right ${tab === id ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}><Icon size={18} className="mb-2 text-cyan-300"/><div className="text-xs font-black text-slate-400">{label}</div><div className="text-2xl font-black text-white">{count}</div></button>)}
      </div>

      {tab === 'queue' ? <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl bg-emerald-400/10 p-3"><div className="text-xs font-black text-emerald-200">المعروض للتنفيذ</div><div className="text-2xl font-black text-white">{smartQueue.length} / {branch === ALL_BRANCHES ? TOTAL_DAILY_QUEUE_LIMIT : PER_BRANCH_QUEUE_LIMIT}</div></div>
        <div className="rounded-2xl bg-amber-400/10 p-3"><div className="text-xs font-black text-amber-200">قائمة الانتظار</div><div className="text-2xl font-black text-white">{backlogCount}</div></div>
        <div className="rounded-2xl bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">منفذ الفرع</div><div className="text-lg font-black text-white">{branch === ALL_BRANCHES ? 'ضحى + دنيا' : assignedExecutor(branch)}</div></div>
      </div> : null}

      {(tab === 'queue' || tab === 'waiting' || tab === 'review') ? <>
        <div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400"/><input className="input-dark w-full pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
        <div className="space-y-2">{visibleRows.map((row, index) => {
          const tier = importance(row);
          const state = activity(row);
          return <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <button type="button" onClick={() => { setSelected(row); setScheduledDate(dayKey(row.next_followup_date)); setActionNote(''); setHistoryOpen(false); }} className="min-w-0 flex-1 text-right">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-white/5 px-2 py-1 text-xs font-black text-slate-400">#{index + 1}</span><div className="font-black text-white">{customerName(row)}</div><span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-200">{assignedExecutor(row.branch)}</span></div>
                <div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-black"><span className={`rounded-full border px-3 py-1 ${tier.bg} ${tier.color}`}>{tier.label}</span><span className={`rounded-full bg-white/5 px-3 py-1 ${state.color}`}>{state.label}</span>{isOverdue(row) ? <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">متأخر</span> : null}</div>
                <div className="mt-2 text-xs font-bold text-slate-500">سبب المتابعة: {row.followup_reason || row.request_details || row.notes || 'غير مسجل'} · آخر شراء: {lastPurchase(row) || 'غير معروف'} · المتوسط: {formatCurrency(monthlyAverage(row))}</div>
              </button>
              <div className="flex gap-2"><button className="btn-secondary text-xs" onClick={() => { setSelected(row); void loadHistory(row); }}>عرض {row.attempt_count || 0} محاولة</button><button className="btn-secondary p-2" onClick={() => { setSelected(row); setDetailsOpen(true); }}><Eye size={18}/></button></div>
            </div>
          </article>;
        })}</div>
      </> : null}

      {tab === 'contacted' ? <div className="space-y-2">{contactedEvents.slice(0, 500).map((event) => <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex justify-between gap-2"><div className="font-black text-cyan-100">{actionLabels[event.action] || event.action}</div><div className="text-xs text-slate-400">{formatDateTime(event.created_at)}</div></div><div className="mt-2 font-bold text-white">{text(event.metadata?.customer_name) || 'عميل غير محدد'} · {actorProfile(event.actor_name).displayName}</div><div className="mt-1 text-xs text-slate-400">{event.branch || 'فرع غير محدد'} · {text(event.metadata?.result) || 'غير مسجلة'}</div></div>)}</div> : null}

      {tab === 'performance' ? <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black text-white">أداء التنفيذ الفعلي</h3><p className="text-xs font-bold text-slate-400">التنفيذ محسوب على د/ ضحى ود/ دنيا فقط.</p></div><select className="input-dark" value={performanceDays} onChange={(event) => setPerformanceDays(Number(event.target.value))}><option value={7}>آخر 7 أيام</option><option value={14}>آخر 14 يومًا</option><option value={30}>آخر 30 يومًا</option></select></div>
        <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="min-w-full text-right text-sm"><thead className="bg-white/5"><tr><th className="p-3">المنفذة</th><th className="p-3">الفرع</th><th className="p-3">عملاء</th><th className="p-3">محاولات</th><th className="p-3">رسائل</th><th className="p-3">لم يرد</th><th className="p-3">تم الرد</th><th className="p-3">مكتمل</th><th className="p-3">نسبة الرد</th><th className="p-3">نسبة الإكمال</th></tr></thead><tbody>{performance.map((item) => <tr key={item.actor} className="border-t border-white/10 text-white"><td className="p-3 font-black">{item.actor}</td><td className="p-3">{item.branch}</td><td className="p-3">{item.customers}</td><td className="p-3">{item.attempts}</td><td className="p-3">{item.messages}</td><td className="p-3">{item.noAnswer}</td><td className="p-3 text-emerald-200">{item.replied}</td><td className="p-3 text-cyan-200">{item.completed}</td><td className="p-3">{(item.responseRate * 100).toFixed(1)}%</td><td className="p-3">{(item.completionRate * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4"><div className="flex items-center gap-2 font-black text-violet-100"><ShieldCheck size={18}/> مراجعة د/ علا</div><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-white"><div>تمت المراجعة: {reviewSummary.reviewed}</div><div>مقبول: {reviewSummary.approved}</div><div>أُعيد للاستكمال: {reviewSummary.returned}</div><div>تم التصعيد: {reviewSummary.escalated}</div></div></div>
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4"><div className="flex items-center gap-2 font-black text-amber-100"><UserRoundCheck size={18}/> المدير العام</div><p className="mt-3 text-sm leading-7 text-amber-50">عرض ومقارنة واعتماد المؤشرات فقط، ولا يدخل ضمن أرقام تنفيذ المتابعات.</p></div>
        </div>
      </div> : null}
    </section>

    {selected && !detailsOpen ? <div className="fixed inset-0 z-[100] flex justify-end bg-black/65" dir="rtl"><aside className="h-full w-full max-w-2xl overflow-y-auto bg-[#091b2d] p-5">
      <div className="flex justify-between"><div><p className="text-xs font-black text-cyan-300">بطاقة المتابعة · المسؤول {assignedExecutor(selected.branch)}</p><h3 className="text-2xl font-black text-white">{customerName(selected)}</h3><p className="text-sm text-slate-400">{selected.branch}</p></div><button className="btn-secondary" onClick={() => setSelected(null)}><X size={18}/></button></div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">Ã˜Â§Ã™â€žÃ˜Â£Ã™â€¡Ã™â€¦Ã™Å Ã˜Â©</div><div className="mt-1 font-black text-white">{importance(selected).label}</div></div>
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">Ã˜Â­Ã˜Â§Ã™â€žÃ˜Â© Ã˜Â§Ã™â€žÃ™â€ Ã˜Â´Ã˜Â§Ã˜Â·</div><div className="mt-1 font-black text-white">{activity(selected).label}</div></div>
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">Ã˜Â¢Ã˜Â®Ã˜Â± Ã˜Â´Ã˜Â±Ã˜Â§Ã˜Â¡</div><div className="mt-1 font-black text-white">{lastPurchase(selected) || 'Ã˜ÂºÃ™Å Ã˜Â± Ã™â€¦Ã˜Â¹Ã˜Â±Ã™Ë†Ã™Â'}</div></div>
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ™Ë†Ã˜Â³Ã˜Â· Ã˜Â§Ã™â€žÃ˜Â´Ã™â€¡Ã˜Â±Ã™Å </div><div className="mt-1 font-black text-white">{formatCurrency(monthlyAverage(selected))}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">Ã˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å  Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜ÂªÃ˜Â±Ã™Å Ã˜Â§Ã˜Âª</div><div className="mt-1 font-black text-white">{formatCurrency(Number(selected.total_spent || metricNumber(selected, 'total_spent')))}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">Ã˜Â¹Ã˜Â¯Ã˜Â¯ Ã™â€¦Ã˜Â±Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â±Ã˜Â§Ã˜Â¡</div><div className="mt-1 font-black text-white">{metricNumber(selected, 'invoices_count')}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">Ã™â€¦Ã˜ÂªÃ™Ë†Ã˜Â³Ã˜Â· Ã˜Â§Ã™â€žÃ™ÂÃ˜Â§Ã˜ÂªÃ™Ë†Ã˜Â±Ã˜Â©</div><div className="mt-1 font-black text-white">{formatCurrency(metricNumber(selected, 'avg_invoice'))}</div></div>
        <button type="button" className="rounded-2xl border border-emerald-300/30 bg-emerald-400/15 p-3 text-right" onClick={() => setDetailsOpen(true)}><div className="text-xs font-black text-emerald-200">Ã˜Â§Ã™â€žÃ™â€¦Ã™â€žÃ™Â Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã™â€¦Ã™â€ž</div><div className="mt-1 font-black text-white">Ã™â€¦Ã™â€žÃ™Â Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™Å Ã™â€ž 360</div></button>
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="text-xs font-black text-slate-400">Ã˜Â³Ã˜Â¨Ã˜Â¨ Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â©</div>
        <div className="mt-1 text-sm font-bold leading-7 text-white">{selected.followup_reason || selected.request_details || selected.notes || 'Ã˜ÂºÃ™Å Ã˜Â± Ã™â€¦Ã˜Â³Ã˜Â¬Ã™â€ž'}</div>
        <div className="mt-3 text-xs font-black text-slate-400">Ã˜Â¢Ã˜Â®Ã˜Â± Ã™â€ Ã˜ÂªÃ™Å Ã˜Â¬Ã˜Â© Ã™â€¦Ã˜Â³Ã˜Â¬Ã™â€žÃ˜Â©</div>
        <div className="mt-1 text-sm font-bold leading-7 text-white">{selected.followup_result || selected.contact_result || selected.followup_summary || 'Ã™â€žÃ™â€¦ Ã˜ÂªÃ˜Â³Ã˜Â¬Ã™â€ž Ã™â€ Ã˜ÂªÃ™Å Ã˜Â¬Ã˜Â© Ã˜Â¨Ã˜Â¹Ã˜Â¯'}</div>
      </div>

      <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
        <div className="font-black text-amber-100">Ã˜Â³Ã™Æ’Ã˜Â±Ã™Å Ã˜Â¨Ã˜ÂªÃ˜Â§Ã˜Âª Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã™â€šÃ˜ÂªÃ˜Â±Ã˜Â­Ã˜Â©</div>
        <p className="mt-1 text-xs font-bold text-amber-50/70">Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å  Ã˜Â§Ã™â€žÃ˜Â³Ã™Æ’Ã˜Â±Ã™Å Ã˜Â¨Ã˜Âª Ã˜Â«Ã™â€¦ Ã˜Â¹Ã˜Â¯Ã™â€˜Ã™â€žÃ™Å Ã™â€¡ Ã˜Â­Ã˜Â³Ã˜Â¨ Ã˜Â­Ã˜Â§Ã™â€žÃ˜Â© Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™Å Ã™â€ž Ã™â€šÃ˜Â¨Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â±Ã˜Â³Ã˜Â§Ã™â€ž.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'general'))}>Ã˜Â§Ã˜Â·Ã™â€¦Ã˜Â¦Ã™â€ Ã˜Â§Ã™â€  Ã˜Â¹Ã˜Â§Ã™â€¦</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'inactive'))}>Ã˜Â§Ã˜Â³Ã˜ÂªÃ˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜Â¹Ã™â€¦Ã™Å Ã™â€ž Ã™â€¦Ã˜ÂªÃ™Ë†Ã™â€šÃ™Â</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'missing'))}>Ã™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â© Ã˜ÂµÃ™â€ Ã™Â Ã˜Â£Ã™Ë† Ã˜Â·Ã™â€žÃ˜Â¨</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'thanks'))}>Ã˜Â´Ã™Æ’Ã˜Â± Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â±Ã˜Â§Ã˜Â¡</button>
        </div>
      </div>

      {historyOpen ? <div className="mt-4 space-y-2 rounded-2xl bg-black/20 p-4">{history.map((event) => <div key={event.id} className="rounded-xl border border-white/10 p-3"><div className="font-black text-cyan-100">{actionLabels[event.action] || event.action}</div><div className="text-xs text-slate-400">{actorProfile(event.actor_name).displayName} · {formatDateTime(event.created_at)}</div><div className="mt-2 text-sm text-white">{text(event.metadata?.notes) || text(event.metadata?.result) || 'بدون تفاصيل'}</div></div>)}</div> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-black text-white">وسيلة التواصل<select className="input-dark mt-2 w-full" value={contactChannel} onChange={(event) => setContactChannel(event.target.value)}><option>واتساب</option><option>اتصال هاتفي</option><option>رسالة SMS</option><option>زيارة داخل الفرع</option></select></label><label className="text-sm font-black text-white">الموعد التالي<input type="date" className="input-dark mt-2 w-full" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)}/></label></div>
      <textarea className="input-dark mt-3 min-h-28 w-full" value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="اكتب تفاصيل المحاولة والنتيجة..."/>
      {!canExecute ? <div className="mt-3 rounded-xl bg-amber-400/10 p-3 text-sm font-bold text-amber-100">حسابك للمراجعة أو الإدارة؛ أزرار التنفيذ موقوفة.</div> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><button className="btn-secondary" disabled={saving || !canExecute || isPendingReview(selected)} onClick={() => void executeAction('message_sent')}><Send size={16} className="inline ms-2"/> أرسلت رسالة</button><button className="btn-secondary" disabled={saving || !canExecute || isPendingReview(selected)} onClick={() => void executeAction('no_answer')}><PhoneOff size={16} className="inline ms-2"/> لم يرد</button><button className="btn-secondary" disabled={saving || !canExecute || isPendingReview(selected)} onClick={() => void executeAction('replied')}><MessageCircle size={16} className="inline ms-2"/> تم الرد</button>{customerPhone(selected) ? <a className="btn-secondary text-center" href={generateWhatsAppLink(customerPhone(selected), 'أهلًا بحضرتك، مع حضرتك صيدليات دواء. حابين نطمن إن كل شيء تمام.')} target="_blank" rel="noreferrer">فتح واتساب</a> : null}<button className="btn-secondary" disabled={saving || !canExecute || !scheduledDate} onClick={() => void executeAction('scheduled')}>حفظ الموعد</button><button className="btn-primary" disabled={saving || !canExecute || isPendingReview(selected)} onClick={() => void executeAction('completed')}><CheckCircle2 size={16} className="inline ms-2"/> إكمال المتابعة</button></div>
{isPendingReview(selected) && ['reviewer', 'general_manager'].includes(currentProfile.role) ? <div className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4"><div className="mb-3 font-black text-violet-100">Ã™â€šÃ˜Â±Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹Ã˜Â©</div><div className="grid gap-2 sm:grid-cols-3"><button className="btn-primary" disabled={saving} onClick={() => void executeReviewAction('approved')}>Ã˜Â§Ã˜Â¹Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¯ Ã™Ë†Ã˜Â¥Ã˜ÂºÃ™â€žÃ˜Â§Ã™â€š</button><button className="btn-secondary" disabled={saving} onClick={() => void executeReviewAction('returned_for_completion')}>Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ™Æ’Ã™â€¦Ã˜Â§Ã™â€ž</button><button className="btn-secondary" disabled={saving} onClick={() => void executeReviewAction('escalated')}>Ã˜ÂªÃ˜ÂµÃ˜Â¹Ã™Å Ã˜Â¯ Ã™â€žÃ™â€žÃ˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â©</button></div></div> : null}
    </aside></div> : null}

    {detailsOpen && selected ? <Suspense fallback={<div className="fixed inset-0 z-[110] grid place-items-center bg-black/70"><Loader2 className="animate-spin text-cyan-300"/></div>}><CustomerQuickDetailsModal followupId={selected.id} customerId={selected.customer_id} customerCode={selected.customer_code} customerPhone={customerPhone(selected)} customerName={customerName(selected)} branch={selected.branch} fallbackMetric={{ ...selected.customer_metrics, total_spent: selected.total_spent, avg_monthly: monthlyAverage(selected), last_purchase: lastPurchase(selected) }} onClose={() => setDetailsOpen(false)}/></Suspense> : null}
  </>;
}
