import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  Inbox,
  Loader2,
  MessageCircle,
  PhoneOff,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { generateTodayFollowupsSmartReport } from '@/lib/api/customerServiceCommandCenter';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeEgyptianPhone } from '@/lib/customerFollowupCore';
import { classifyCustomer, customerStatus } from '@/lib/customerMetrics';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { SectionEmptyState } from '@/components/customerService/SectionBoundary';

const CustomerQuickDetailsModal = lazy(() => import('@/components/customers/CustomerQuickDetailsModal'));

const ALL_BRANCHES = 'كل الفروع';
const PER_BRANCH_QUEUE_LIMIT = 25;
const FETCH_BATCH = 1000;
const MAX_FETCH_BATCHES = 20; // سقف أمان يمنع لوب لا نهائي لو حصل خلل غير متوقع في الترقيم

// تبويبات تنفيذ اليوم فقط. سجل المتابعات/الأداء/سجل التواصل بقوا في مساحات عمل
// منفصلة (السجل والمتابعات / التقارير والإدارة) عشان محدش يتكرر ومحدش يزحم هنا.
type WorkspaceTab = 'queue' | 'waiting' | 'review';
type QuickAction = 'message_sent' | 'no_answer' | 'replied' | 'scheduled' | 'completed';
type ReviewAction = 'approved' | 'returned_for_completion' | 'escalated';
type QueueFocus = 'all' | 'critical' | 'overdue' | 'uncontacted';
type ContactOutcome = '' | 'purchased' | 'interested' | 'postponed' | 'needs_followup' | 'not_interested' | 'issue';

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
  last_purchase_date: string | null;
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

type StaffDirectoryEntry = { name: string; normalized: string; branch: string | null; role: ActorProfile['role'] };

type OutcomeOption = {
  id: Exclude<ContactOutcome, ''>;
  label: string;
  note: string;
  tone: string;
  defaultNextDay?: boolean;
};

const text = (value: unknown) => String(value ?? '').trim();
const dayKey = (value?: string | null) => text(value).slice(0, 10);
const localDayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tomorrowKey = () => { const date = new Date(); date.setDate(date.getDate() + 1); return localDayKey(date); };
const customerName = (row: FollowupRow) => text(row.customer_name || row.name || 'عميل غير مسجل');
const customerPhone = (row: FollowupRow) => normalizeEgyptianPhone(text(row.customer_phone || row.phone));
const rawStatus = (row: FollowupRow) => text(row.contact_status || row.followup_status || row.response_status || row.status || row.followup_result);
const normalizedActor = (value: unknown) => text(value).toLowerCase().replace(/[/._-]/g, ' ').replace(/\s+/g, ' ').trim();
const metricNumber = (row: FollowupRow, key: string, fallback = 0) => {
  const value = Number(row.customer_metrics?.[key] ?? fallback ?? 0);
  return Number.isFinite(value) ? value : 0;
};
const monthlyAverage = (row: FollowupRow) => metricNumber(row, 'avg_monthly', metricNumber(row, 'monthly_average'));
const lastPurchase = (row: FollowupRow) => dayKey(row.last_purchase_date) || dayKey(text(row.customer_metrics?.last_purchase));
const importance = (row: FollowupRow) => classifyCustomer(monthlyAverage(row));
const activity = (row: FollowupRow) => customerStatus(lastPurchase(row));
const isWaiting = (row: FollowupRow) => /في انتظار الرد|message_sent|waiting_reply/i.test(rawStatus(row));
const isNoAnswer = (row: FollowupRow) => /لم يرد|no_answer/i.test(rawStatus(row));
const isUrgent = (row: FollowupRow) => Boolean(row.needs_manager || /عاجل|urgent|high|شكوى|تصعيد/i.test(`${row.priority || ''} ${rawStatus(row)} ${row.followup_reason || ''}`));
const isOverdue = (row: FollowupRow) => Boolean(dayKey(row.next_followup_date) && dayKey(row.next_followup_date) < localDayKey());
const isDueNow = (row: FollowupRow) => !dayKey(row.next_followup_date) || dayKey(row.next_followup_date) <= localDayKey();
const isPendingReview = (row: FollowupRow) => /pending_review|انتظار مراجعة|في انتظار المراجعة/i.test(rawStatus(row));
const lastTouchAt = (row: FollowupRow) => row.last_attempt_at || row.contacted_at || row.first_attempt_at || null;

const outcomeOptions: OutcomeOption[] = [
  { id: 'purchased', label: 'اشترى', note: 'العميل أتم عملية شراء بعد المتابعة.', tone: 'border-emerald-300/40 bg-emerald-400/15 text-emerald-100' },
  { id: 'interested', label: 'مهتم', note: 'العميل مهتم ويحتاج استكمال التواصل.', tone: 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100', defaultNextDay: true },
  { id: 'postponed', label: 'مؤجل', note: 'العميل طلب تأجيل المتابعة لموعد لاحق.', tone: 'border-amber-300/40 bg-amber-400/15 text-amber-100', defaultNextDay: true },
  { id: 'needs_followup', label: 'يحتاج متابعة', note: 'العميل يحتاج متابعة أخرى لاستكمال الطلب أو القرار.', tone: 'border-violet-300/40 bg-violet-400/15 text-violet-100', defaultNextDay: true },
  { id: 'not_interested', label: 'غير مهتم', note: 'العميل غير مهتم حاليًا ولا يحتاج متابعة مباشرة.', tone: 'border-slate-300/30 bg-white/5 text-slate-200' },
  { id: 'issue', label: 'مشكلة / تصعيد', note: 'العميل لديه مشكلة تحتاج مراجعة أو تصعيد للإدارة.', tone: 'border-rose-300/40 bg-rose-400/15 text-rose-100' },
];

function actorProfile(name: unknown, directory: StaffDirectoryEntry[] = []): ActorProfile {
  const normalized = normalizedActor(name);
  if (!normalized) return { role: 'other', displayName: 'النظام / غير محدد', branch: null };
  const match = directory.find((entry) => normalized.includes(entry.normalized) || entry.normalized.includes(normalized));
  if (match) return { role: match.role, displayName: match.name, branch: match.branch };
  if (normalized.includes('المدير العام') || normalized.includes('معاذ')) return { role: 'general_manager', displayName: 'المدير العام', branch: null };
  return { role: 'other', displayName: text(name) || 'النظام / غير محدد', branch: null };
}

function assignedExecutor(branch: string | null | undefined, directory: StaffDirectoryEntry[] = []) {
  const normalized = normalizeBranchName(branch || '');
  return directory.find((entry) => entry.role === 'executor' && entry.branch && normalizeBranchName(entry.branch) === normalized)?.name || 'غير محدد';
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
    const rowAttempts = Number(row.attempt_count || 0);
    const currentAttempts = Number(current?.attempt_count || 0);
    const rowDate = new Date(row.last_attempt_at || row.created_at || 0).getTime();
    const currentDate = new Date(current?.last_attempt_at || current?.created_at || 0).getTime();
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

function priorityInfo(row: FollowupRow) {
  if (isUrgent(row)) return { label: 'حرجة الآن', reason: row.needs_manager ? 'تحتاج تدخل مدير' : 'طلب عاجل أو شكوى', next: 'تواصل فورًا وسجل النتيجة', tone: 'border-rose-300/35 bg-rose-400/10 text-rose-100', level: 'critical' };
  if (isOverdue(row)) return { label: 'أولوية عالية', reason: 'موعد المتابعة فات بدون إغلاق', next: 'أعد التواصل وحدد نتيجة أو موعدًا جديدًا', tone: 'border-orange-300/35 bg-orange-400/10 text-orange-100', level: 'high' };
  if (isNoAnswer(row)) return { label: 'إعادة محاولة', reason: 'العميل لم يرد في المحاولة السابقة', next: 'حاول مرة أخرى أو ثبّت موعدًا مناسبًا', tone: 'border-amber-300/35 bg-amber-400/10 text-amber-100', level: 'high' };
  if (!lastTouchAt(row)) return { label: 'ابدأ الآن', reason: 'لا توجد محاولة تواصل مسجلة', next: 'ابدأ أول محاولة وسجل النتيجة', tone: 'border-cyan-300/35 bg-cyan-400/10 text-cyan-100', level: monthlyAverage(row) >= 3000 ? 'high' : 'medium' };
  return { label: 'متابعة مستحقة', reason: 'الحالة ضمن قائمة اليوم', next: 'استكمل من آخر نتيجة وسجل الخطوة التالية', tone: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100', level: 'normal' };
}

export default function CustomerFollowupCockpitPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [directory, setDirectory] = useState<StaffDirectoryEntry[]>([]);
  const [tab, setTab] = useState<WorkspaceTab>('queue');
  const [queueFocus, setQueueFocus] = useState<QueueFocus>('all');
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [generatingSmart, setGeneratingSmart] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [contactChannel, setContactChannel] = useState('واتساب');
  const [outcome, setOutcome] = useState<ContactOutcome>('');
  const [purchaseValue, setPurchaseValue] = useState('');

  useEffect(() => {
    let cancelled = false;
    // staff_accounts محمي بـ RLS (المدراء بس بيشوفوا كل الحسابات مباشرة) —
    // بنستخدم دالة آمنة بدل القراءة المباشرة عشان الدليل يفضل كامل لأي حد.
    supabase.rpc('get_staff_accounts_directory', { p_roles: ['customer_service_manager', 'branches_manager', 'general_manager'] }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error('[customer-followup-cockpit] staff directory failed', error); return; }
      if (!data) return;
      const filtered = (data as Array<{ name: string; branch: string | null; role: string; active: boolean; can_login: boolean; status: string | null }>)
        .filter((row) => row.active !== false && row.can_login !== false);
      setDirectory(filtered.map((row) => ({
        name: text(row.name), normalized: normalizedActor(row.name), branch: row.role === 'customer_service_manager' ? normalizeBranchName(row.branch || '') : null,
        role: row.role === 'customer_service_manager' ? 'executor' : row.role === 'branches_manager' ? 'reviewer' : 'general_manager',
      })));
    }).catch((error) => { if (!cancelled) console.error('[customer-followup-cockpit] staff directory failed', error); });
    return () => { cancelled = true; };
  }, []);

  const currentProfile = actorProfile(user?.name, directory);
  const canExecute = ['executor', 'reviewer', 'general_manager'].includes(currentProfile.role);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    setLoadError('');
    try {
      const fetchRows = async () => {
        const allRows: FollowupRow[] = [];
        for (let start = 0, batches = 0; batches < MAX_FETCH_BATCHES; start += FETCH_BATCH, batches += 1) {
          let query = supabase.from('daily_followups')
            .select('id,customer_id,customer_name,name,customer_code,customer_phone,phone,branch,priority,status,followup_status,contact_status,response_status,followup_result,contact_result,followup_summary,followup_reason,request_details,notes,next_followup_date,created_at,contacted_at,first_attempt_at,last_attempt_at,attempt_count,needs_next_followup,needs_manager,total_spent,last_purchase_date,customer_metrics')
            .eq('is_hidden', false).is('completed_at', null).is('cancelled_at', null).is('archived_at', null)
            .or('is_duplicate.is.null,is_duplicate.eq.false').is('duplicate_of', null)
            .order('created_at', { ascending: false }).range(start, start + FETCH_BATCH - 1);
          if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);
          const { data, error } = await query;
          if (error) throw error;
          const batch = (data || []) as FollowupRow[];
          allRows.push(...batch);
          if (batch.length < FETCH_BATCH) break;
        }
        return allRows;
      };
      const fetchAudit = async () => {
        const since = new Date(); since.setDate(since.getDate() - 30);
        let auditQuery = supabase.from('customer_followup_audit_log').select('id,followup_id,action,actor_name,created_at,branch,metadata').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(5000);
        if (branch !== ALL_BRANCHES) auditQuery = auditQuery.eq('branch', branch);
        const { data, error } = await auditQuery;
        if (error) throw error;
        return (data || []) as AuditEvent[];
      };
      // allSettled بدل all: query السجل (آخر 30 يوم، مستخدم بس لمؤشر "مكتمل اليوم") لو فشل
      // منفصل عن query الصفوف الأساسية — قائمة اليوم تفضل شغالة حتى لو السجل فشل مؤقتًا.
      const [rowsResult, auditResult] = await Promise.allSettled([fetchRows(), fetchAudit()]);
      if (rowsResult.status === 'fulfilled') {
        setRows(dedupeRows(rowsResult.value));
      } else {
        setLoadError(`تعذر تحميل قائمة المتابعات: ${(rowsResult.reason as Error)?.message || 'خطأ غير معروف'}`);
        toast.error(`تعذر تحميل قائمة المتابعات: ${(rowsResult.reason as Error)?.message || 'خطأ غير معروف'}`);
      }
      if (auditResult.status === 'fulfilled') {
        setEvents(auditResult.value);
      } else {
        console.error('[customer-followup-cockpit] audit log fetch failed', auditResult.reason);
        setEvents([]);
      }
    } finally { setLoading(false); }
  }, [branch, managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const waitingRows = useMemo(() => rows.filter(isWaiting).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);
  const reviewRows = useMemo(() => rows.filter(isPendingReview).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);
  const queue = useMemo(() => rows.filter((row) => !isWaiting(row) && !isPendingReview(row) && isDueNow(row)).sort((a, b) => smartScore(b) - smartScore(a)).slice(0, branch === ALL_BRANCHES ? PER_BRANCH_QUEUE_LIMIT * 2 : PER_BRANCH_QUEUE_LIMIT), [rows, branch]);
  const visibleRows = useMemo(() => {
    let source = tab === 'waiting' ? waitingRows : tab === 'review' ? reviewRows : queue;
    if (tab === 'queue') {
      if (queueFocus === 'critical') source = source.filter((row) => ['critical', 'high'].includes(priorityInfo(row).level));
      if (queueFocus === 'overdue') source = source.filter(isOverdue);
      if (queueFocus === 'uncontacted') source = source.filter((row) => !lastTouchAt(row));
    }
    const q = search.trim().toLowerCase();
    return q ? source.filter((row) => `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''} ${row.followup_reason || ''}`.toLowerCase().includes(q)) : source;
  }, [queue, queueFocus, reviewRows, search, tab, waitingRows]);

  const openExecution = (row: FollowupRow) => {
    setSelected(row); setScheduledDate(dayKey(row.next_followup_date)); setActionNote(''); setOutcome(''); setPurchaseValue(''); setHistoryOpen(false);
  };

  const chooseOutcome = (option: OutcomeOption) => {
    setOutcome(option.id);
    setActionNote(option.note);
    if (option.defaultNextDay && !scheduledDate) setScheduledDate(tomorrowKey());
    if (option.id !== 'purchased') setPurchaseValue('');
  };

  const audit = async (row: FollowupRow, action: string, metadata: Record<string, unknown>) => {
    const { error } = await supabase.from('customer_followup_audit_log').insert({
      followup_id: row.id, customer_id: row.customer_id || null, action,
      actor_staff_id: user?.staffId || user?.id || null, actor_name: currentProfile.displayName,
      branch: row.branch || branch,
      metadata: { ...metadata, actor_role: currentProfile.role, assigned_executor: assignedExecutor(row.branch, directory), contact_outcome: outcome || null, purchase_value: purchaseValue ? Number(purchaseValue) : null },
    });
    if (error) throw error;
  };

  const executeAction = async (action: QuickAction) => {
    if (!selected) return;
    if (!canExecute) return toast.error('حسابك لا يملك صلاحية تنفيذ المتابعات.');
    if (currentProfile.branch && normalizeBranchName(selected.branch || '') !== normalizeBranchName(currentProfile.branch)) return toast.error('هذه الحالة خارج فرعك.');
    if ((action === 'replied' || action === 'completed') && actionNote.trim().length < 3) return toast.error('اكتب أو اختر نتيجة واضحة قبل الحفظ.');
    if (outcome === 'purchased' && purchaseValue && Number(purchaseValue) < 0) return toast.error('قيمة الشراء غير صحيحة.');
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const isAttempt = ['message_sent', 'no_answer', 'replied'].includes(action);
      const attempts = Number(selected.attempt_count || 0) + (isAttempt ? 1 : 0);
      let payload: Record<string, unknown> = { updated_by: user?.id || null };
      let result = '';
      let nextDate: string | null = null;
      if (action === 'message_sent') {
        nextDate = tomorrowKey(); result = 'في انتظار رد العميل';
        payload = { ...payload, contact_status: 'في انتظار الرد', followup_status: 'في انتظار الرد', response_status: 'waiting_reply', status: 'في انتظار الرد', contacted_at: now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
      } else if (action === 'no_answer') {
        nextDate = tomorrowKey(); result = 'لم يرد العميل';
        payload = { ...payload, contact_status: 'لم يرد', followup_status: 'لم يرد', response_status: 'no_answer', status: 'لم يرد', last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
      } else if (action === 'replied') {
        nextDate = scheduledDate || localDayKey(); result = 'تم تسجيل رد العميل';
        payload = { ...payload, contact_status: 'تم الرد', followup_status: 'جارٍ التواصل', response_status: 'replied', status: 'جارٍ التواصل', last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim(), followup_result: actionNote.trim() };
      } else if (action === 'scheduled') {
        nextDate = scheduledDate; result = 'تم تحديد موعد متابعة جديد';
        payload = { ...payload, next_followup_date: nextDate, followup_status: 'scheduled', status: 'open', needs_next_followup: true };
      } else {
        result = 'تم إكمال المتابعة';
        payload = { ...payload, status: 'pending_review', followup_status: 'pending_review', contact_status: 'في انتظار المراجعة', followup_result: actionNote.trim(), followup_summary: actionNote.trim(), needs_next_followup: false, is_hidden: false, needs_manager: outcome === 'issue' ? true : selected.needs_manager };
      }
      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, { attempt_count: attempts, contact_channel: contactChannel, result, notes: actionNote.trim() || null, next_followup_date: nextDate, customer_name: customerName(selected), customer_code: selected.customer_code });
      toast.success(action === 'completed' ? 'تم إرسال المتابعة للمراجعة وظهر العميل التالي.' : 'تم حفظ الإجراء.');
      setSelected(null); setActionNote(''); setScheduledDate(''); setOutcome(''); setPurchaseValue('');
      await load();
    } catch (error) { toast.error(`تعذر حفظ الإجراء: ${(error as Error).message}`); }
    finally { setSaving(false); }
  };

  const loadHistory = async (row: FollowupRow) => {
    setSelected(row); setHistoryOpen(true);
    const { data } = await supabase.from('customer_followup_audit_log').select('id,followup_id,action,actor_name,created_at,branch,metadata').eq('followup_id', row.id).order('created_at', { ascending: false }).limit(200);
    setHistory((data || []) as AuditEvent[]);
  };

  const executeReviewAction = async (action: ReviewAction) => {
    if (!selected || !isPendingReview(selected)) return;
    if (!['reviewer', 'general_manager'].includes(currentProfile.role)) return toast.error('الاعتماد أو الإعادة غير متاحين لهذا الحساب.');
    if (action !== 'approved' && actionNote.trim().length < 3) return toast.error('اكتب سبب القرار قبل الحفظ.');
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = action === 'approved'
        ? { completed_at: now, status: 'completed', followup_status: 'completed', contact_status: 'تم الاعتماد', needs_next_followup: false, is_hidden: true, hidden_at: now, hidden_by: currentProfile.displayName, hidden_reason: 'تم اعتماد المتابعة بعد المراجعة', updated_by: user?.id || null }
        : action === 'returned_for_completion'
          ? { status: 'open', followup_status: 'returned_for_completion', contact_status: 'أُعيدت للاستكمال', needs_next_followup: true, next_followup_date: localDayKey(), is_hidden: false, followup_summary: actionNote.trim(), updated_by: user?.id || null }
          : { status: 'pending_review', followup_status: 'pending_review', contact_status: 'تم التصعيد', needs_manager: true, is_hidden: false, followup_summary: actionNote.trim(), updated_by: user?.id || null };
      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, { notes: actionNote.trim() || null, customer_name: customerName(selected), customer_code: selected.customer_code });
      toast.success('تم حفظ قرار المراجعة.'); setSelected(null); setActionNote(''); await load();
    } catch (error) { toast.error(`تعذر حفظ القرار: ${(error as Error).message}`); }
    finally { setSaving(false); }
  };

  const todayKeyValue = localDayKey();
  const completedToday = events.filter((event) => event.action === 'completed' && dayKey(event.created_at) === todayKeyValue).length;
  const overdueOpen = rows.filter((row) => isOverdue(row) && !isPendingReview(row)).length;
  const notStarted = queue.filter((row) => !lastTouchAt(row)).length;
  const kpis: Array<[string, number, typeof Inbox, string]> = [
    ['المطلوب اليوم', queue.length, Inbox, 'text-cyan-200'],
    ['لم يبدأ', notStarted, UserX, 'text-slate-200'],
    ['انتظار الرد', waitingRows.length, Clock3, 'text-amber-200'],
    ['متأخر', overdueOpen, PhoneOff, 'text-rose-200'],
    ['انتظار مراجعة', reviewRows.length, ShieldCheck, 'text-violet-200'],
    ['مكتمل اليوم', completedToday, CheckCircle2, 'text-emerald-200'],
  ];
  const tabs: Array<[WorkspaceTab, string, number, typeof Inbox]> = [
    ['queue', 'قائمة اليوم', queue.length, Inbox],
    ['waiting', 'انتظار الرد', waitingRows.length, Clock3],
    ['review', 'مراجعة', reviewRows.length, ShieldCheck],
  ];

  return <>
    <section className="space-y-3 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div><p className="text-xs font-black text-cyan-300">مركز التنفيذ</p><h2 className="text-lg font-black text-white">نفّذ المتابعة وسجّل النتيجة بأقل عدد ضغطات</h2></div>
        <div className="flex flex-wrap gap-2">
          {managerView ? <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option>{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option></select> : <div className="input-dark font-black text-cyan-100">{userBranch}</div>}
          <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>} تحديث</button>
          <button className="flex items-center gap-2 rounded-xl border-2 border-amber-200 bg-amber-500 px-4 py-2 text-sm font-black text-slate-950" disabled={generatingSmart} onClick={async () => { setGeneratingSmart(true); try { const targets = branch === ALL_BRANCHES ? ['فرع الشامي', 'فرع شكري'] : [branch]; for (const target of targets) await generateTodayFollowupsSmartReport(target, user?.name || null); await load(); toast.success('تم تحديث قائمة المتابعات الذكية.'); } catch (error) { toast.error((error as Error).message); } finally { setGeneratingSmart(false); } }}>{generatingSmart ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>} توليد ذكي</button>
        </div>
      </div>

      {loadError ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3" role="alert"><div className="flex items-center gap-2 text-sm font-black text-red-100"><AlertTriangle size={16}/> {loadError}</div><button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => void load()}><RefreshCw size={14}/> إعادة المحاولة</button></div> : null}

      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">{kpis.map(([label, value, Icon, tone]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5"><Icon size={15} className={`mb-1.5 ${tone}`}/><div className="text-[10px] font-black text-slate-400">{label}</div><div className="text-xl font-black text-white">{value}</div></div>)}</div>

      <div className="grid grid-cols-3 gap-2">{tabs.map(([id, label, count, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-black ${tab === id ? 'border-cyan-300 bg-cyan-400/15 text-cyan-100' : 'border-white/10 bg-white/[0.03] text-slate-300'}`}><Icon size={16}/>{label}<span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px]">{count}</span></button>)}</div>

      {tab === 'queue' ? <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-black/15 p-2">{([['all','الكل'],['critical','حرجة وعالية'],['overdue','متأخرة'],['uncontacted','لم يبدأ التواصل']] as Array<[QueueFocus,string]>).map(([id,label]) => <button key={id} onClick={() => setQueueFocus(id)} className={`rounded-xl px-3 py-2 text-xs font-black ${queueFocus === id ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-300 hover:bg-white/5'}`}>{label}</button>)}</div> : null}
      <div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400"/><input className="input-dark w-full pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
      {loading && !rows.length ? <div className="animate-pulse space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 rounded-2xl bg-white/[0.04]" />)}</div> : null}
      <div className="space-y-2">{visibleRows.map((row, index) => { const info = priorityInfo(row); const tier = importance(row); const responsible = assignedExecutor(row.branch, directory); return <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between"><button className="min-w-0 flex-1 text-right" onClick={() => openExecution(row)}><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-white/5 px-2 py-1 text-xs font-black text-slate-400">#{index + 1}</span><span className="font-black text-white">{customerName(row)}</span><span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${info.tone}`}>{info.label}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${tier.bg} ${tier.color}`}>{tier.label}</span></div><div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'} · المسؤول {responsible} · {info.reason} · آخر تواصل {lastTouchAt(row) ? formatDateTime(lastTouchAt(row) as string) : 'لا يوجد'}{row.next_followup_date ? ` · موعد ${dayKey(row.next_followup_date)}` : ''}</div></button><div className="flex shrink-0 gap-2"><button className="btn-primary text-xs" onClick={() => openExecution(row)}>تنفيذ الآن</button><button className="btn-secondary text-xs" onClick={() => void loadHistory(row)}>سجل العميل</button><button className="btn-secondary flex items-center gap-1 px-2 text-xs" onClick={() => { setSelected(row); setDetailsOpen(true); }}><Eye size={16}/> تفاصيل</button></div></div></article>; })}</div>
      {!loading && !visibleRows.length ? <SectionEmptyState title="لا توجد حالات مطابقة هنا" description="جرّب تغيير البحث أو الفلتر، أو راجع تبويب آخر." icon={Inbox} /> : null}
    </section>

    {selected && !detailsOpen ? <div className="fixed inset-0 z-[100] flex justify-end bg-black/65" dir="rtl"><aside className="h-full w-full max-w-2xl overflow-y-auto bg-[#091b2d] p-5">
      <div className="flex justify-between gap-3"><div><p className="text-xs font-black text-cyan-300">بطاقة التنفيذ · {assignedExecutor(selected.branch, directory)}</p><h3 className="text-2xl font-black text-white">{customerName(selected)}</h3><p className="text-sm text-slate-400">{selected.branch} · {selected.customer_code || 'بدون كود'}</p></div><button className="btn-secondary" onClick={() => setSelected(null)}><X size={18}/></button></div>

      <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.06] p-4"><div className="text-xs font-black text-cyan-300">1) تواصل مع العميل</div><div className="mt-3 grid gap-2 sm:grid-cols-3">{customerPhone(selected) ? <a className="btn-primary text-center" href={generateWhatsAppLink(customerPhone(selected), `أهلًا أ/ ${customerName(selected)}، مع حضرتك صيدليات دواء. حابين نطمن على حضرتك ونعرف هل في أي احتياج نقدر نساعد فيه؟`)} target="_blank" rel="noreferrer">فتح واتساب</a> : null}<button className="btn-secondary" disabled={saving || !canExecute || isPendingReview(selected)} onClick={() => void executeAction('message_sent')}><Send size={16} className="inline ms-2"/> أرسلت رسالة</button><button className="btn-secondary" disabled={saving || !canExecute || isPendingReview(selected)} onClick={() => void executeAction('no_answer')}><PhoneOff size={16} className="inline ms-2"/> لم يرد</button></div></div>

      {!isPendingReview(selected) ? <>
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-xs font-black text-slate-300">2) اختر نتيجة التواصل</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{outcomeOptions.map((option) => <button key={option.id} type="button" onClick={() => chooseOutcome(option)} className={`rounded-xl border px-3 py-3 text-sm font-black transition ${outcome === option.id ? option.tone : 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]'}`}>{option.label}</button>)}</div>{outcome === 'purchased' ? <label className="mt-3 block text-sm font-black text-white">قيمة عملية الشراء<input type="number" min="0" step="0.01" className="input-dark mt-2 w-full" value={purchaseValue} onChange={(event) => setPurchaseValue(event.target.value)} placeholder="مثال: 650"/></label> : null}</div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-xs font-black text-slate-300">3) الموعد والتفاصيل</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-black text-white">وسيلة التواصل<select className="input-dark mt-2 w-full" value={contactChannel} onChange={(event) => setContactChannel(event.target.value)}><option>واتساب</option><option>اتصال هاتفي</option><option>رسالة SMS</option><option>زيارة داخل الفرع</option></select></label><label className="text-sm font-black text-white">المتابعة القادمة<input type="date" className="input-dark mt-2 w-full" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)}/></label></div><textarea className="input-dark mt-3 min-h-24 w-full" value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="ملخص النتيجة أو ملاحظة إضافية..."/></div>

        <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4"><div className="text-xs font-black text-emerald-200">4) احفظ النتيجة</div><div className="mt-3 grid gap-2 sm:grid-cols-3"><button className="btn-secondary" disabled={saving || !canExecute || actionNote.trim().length < 3} onClick={() => void executeAction('replied')}><MessageCircle size={16} className="inline ms-2"/> حفظ الرد والاستمرار</button><button className="btn-secondary" disabled={saving || !canExecute || !scheduledDate} onClick={() => void executeAction('scheduled')}>حفظ الموعد فقط</button><button className="btn-primary" disabled={saving || !canExecute || actionNote.trim().length < 3} onClick={() => void executeAction('completed')}><CheckCircle2 size={16} className="inline ms-2"/> إكمال وإرسال للمراجعة</button></div></div>
      </> : null}

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-xs font-black text-slate-400">سبب المتابعة</div><div className="mt-1 text-sm font-bold text-white">{selected.followup_reason || selected.request_details || selected.notes || 'غير مسجل'}</div><div className="mt-3 text-xs font-black text-slate-400">آخر نتيجة</div><div className="mt-1 text-sm font-bold text-white">{selected.followup_result || selected.contact_result || selected.followup_summary || 'لم تسجل نتيجة بعد'}</div></div>

      {historyOpen ? <div className="mt-3 space-y-2 rounded-2xl bg-black/20 p-4">{history.map((event) => <div key={event.id} className="rounded-xl border border-white/10 p-3"><div className="font-black text-cyan-100">{event.action}</div><div className="text-xs text-slate-400">{actorProfile(event.actor_name, directory).displayName} · {formatDateTime(event.created_at)}</div><div className="mt-2 text-sm text-white">{text(event.metadata?.notes) || text(event.metadata?.result) || 'بدون تفاصيل'}</div></div>)}</div> : null}

      {isPendingReview(selected) && ['reviewer', 'general_manager'].includes(currentProfile.role) ? <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4"><div className="font-black text-violet-100">قرار المراجعة</div><textarea className="input-dark mt-3 min-h-20 w-full" value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="سبب الإعادة أو التصعيد..."/><div className="mt-3 grid gap-2 sm:grid-cols-3"><button className="btn-primary" disabled={saving} onClick={() => void executeReviewAction('approved')}>اعتماد وإغلاق</button><button className="btn-secondary" disabled={saving} onClick={() => void executeReviewAction('returned_for_completion')}>إعادة للاستكمال</button><button className="btn-secondary" disabled={saving} onClick={() => void executeReviewAction('escalated')}>تصعيد للإدارة</button></div></div> : null}

      <button className="mt-4 w-full rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 font-black text-emerald-100" onClick={() => setDetailsOpen(true)}>فتح ملف العميل 360</button>
    </aside></div> : null}

    {detailsOpen && selected ? <Suspense fallback={<div className="fixed inset-0 z-[110] grid place-items-center bg-black/70"><Loader2 className="animate-spin text-cyan-300"/></div>}><CustomerQuickDetailsModal followupId={selected.id} customerId={selected.customer_id} customerCode={selected.customer_code} customerPhone={customerPhone(selected)} customerName={customerName(selected)} branch={selected.branch} fallbackMetric={{ ...selected.customer_metrics, total_spent: selected.total_spent, avg_monthly: monthlyAverage(selected), last_purchase: lastPurchase(selected) }} onClose={() => setDetailsOpen(false)}/></Suspense> : null}
  </>;
}
