import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
  Sparkles,
  UserRoundCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { isValidEgyptianMobile, normalizeEgyptianPhone } from '@/lib/customerFollowupCore';
import { classifyCustomer, customerStatus } from '@/lib/customerMetrics';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { generateWhatsAppLink } from '@/lib/whatsapp';

const CustomerQuickDetailsModal = lazy(() => import('@/components/customers/CustomerQuickDetailsModal'));

const ALL_BRANCHES = 'كل الفروع';
const DAILY_QUEUE_LIMIT = 45;
const FETCH_BATCH = 1000;

type WorkspaceTab = 'queue' | 'waiting' | 'contacted' | 'performance';
type QuickAction = 'message_sent' | 'no_answer' | 'replied' | 'scheduled' | 'completed';

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

const text = (value: unknown) => String(value ?? '').trim();
const dayKey = (value?: string | null) => text(value).slice(0, 10);
const localDayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tomorrowKey = () => { const date = new Date(); date.setDate(date.getDate() + 1); return localDayKey(date); };
const customerName = (row: FollowupRow) => text(row.customer_name || row.name || 'عميل غير مسجل');
const customerPhone = (row: FollowupRow) => normalizeEgyptianPhone(text(row.customer_phone || row.phone));
const rawStatus = (row: FollowupRow) => text(row.contact_status || row.followup_status || row.response_status || row.status || row.followup_result);
const metricNumber = (row: FollowupRow, key: string, fallback = 0) => {
  const value = row.customer_metrics?.[key] ?? fallback;
  const number = Number(value || 0);
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

const actionLabels: Record<string, string> = {
  message_sent: 'تم إرسال رسالة للعميل',
  no_answer: 'لم يرد العميل',
  replied: 'تم تسجيل رد العميل',
  scheduled: 'تم تحديد موعد متابعة',
  completed: 'تم إكمال المتابعة',
  customer_data_corrected: 'تم تصحيح بيانات العميل',
  branch_transferred: 'تم تحويل العميل',
  updated: 'تم تحديث المتابعة',
  created: 'تم إنشاء المتابعة',
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function dedupeRows(rows: FollowupRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${normalizeBranchName(row.branch || '')}|${text(row.customer_id || row.customer_code || customerPhone(row) || customerName(row)).toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

export default function CustomerFollowupCockpitPanel({ onOpenTools }: { onOpenTools?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<WorkspaceTab>('queue');
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
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
  const queueCandidates = useMemo(() => rows
    .filter((row) => !isWaiting(row) && isDueNow(row))
    .sort((a, b) => smartScore(b) - smartScore(a)), [rows]);
  const smartQueue = useMemo(() => queueCandidates.slice(0, DAILY_QUEUE_LIMIT), [queueCandidates]);
  const backlogCount = Math.max(0, queueCandidates.length - smartQueue.length);

  const visibleRows = useMemo(() => {
    const source = tab === 'waiting' ? waitingRows : smartQueue;
    const query = search.trim().toLowerCase();
    if (!query) return source;
    return source.filter((row) => `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''} ${row.followup_reason || ''} ${rawStatus(row)}`.toLowerCase().includes(query));
  }, [search, smartQueue, tab, waitingRows]);

  const contactedEvents = useMemo(() => events.filter((event) => ['message_sent', 'no_answer', 'replied', 'completed', 'scheduled'].includes(event.action)), [events]);

  const performanceEvents = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - performanceDays);
    return events.filter((event) => new Date(event.created_at) >= since);
  }, [events, performanceDays]);

  const performance = useMemo(() => {
    const map = new Map<string, { actor: string; actions: number; attempts: number; messages: number; noAnswer: number; replied: number; completed: number; scheduled: number; customers: Set<string> }>();
    performanceEvents.forEach((event) => {
      const actor = event.actor_name || 'النظام / غير محدد';
      const row = map.get(actor) || { actor, actions: 0, attempts: 0, messages: 0, noAnswer: 0, replied: 0, completed: 0, scheduled: 0, customers: new Set<string>() };
      row.actions += 1;
      if (event.followup_id) row.customers.add(event.followup_id);
      if (['message_sent', 'no_answer', 'replied'].includes(event.action)) row.attempts += 1;
      if (event.action === 'message_sent') row.messages += 1;
      if (event.action === 'no_answer') row.noAnswer += 1;
      if (event.action === 'replied') row.replied += 1;
      if (event.action === 'completed') row.completed += 1;
      if (event.action === 'scheduled') row.scheduled += 1;
      map.set(actor, row);
    });
    return Array.from(map.values()).sort((a, b) => b.completed - a.completed || b.attempts - a.attempts);
  }, [performanceEvents]);

  const audit = async (row: FollowupRow, action: string, metadata: Record<string, unknown>) => {
    const { error } = await supabase.from('customer_followup_audit_log').insert({
      followup_id: row.id,
      customer_id: row.customer_id || null,
      action,
      actor_staff_id: user?.staffId || user?.id || null,
      actor_name: user?.name || null,
      branch: row.branch || branch,
      metadata,
    });
    if (error) throw error;
  };

  const loadHistory = async (row: FollowupRow) => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer_followup_audit_log')
        .select('id,followup_id,action,actor_name,created_at,branch,metadata')
        .eq('followup_id', row.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory((data || []) as AuditEvent[]);
    } catch (error) {
      toast.error(`تعذر تحميل سجل المتابعة: ${(error as Error).message}`);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const executeAction = async (action: QuickAction) => {
    if (!selected) return;
    if ((action === 'replied' || action === 'completed') && actionNote.trim().length < 3) {
      toast.error('اكتب ملخصًا واضحًا لما تم مع العميل قبل حفظ الإجراء');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const isContactAttempt = ['message_sent', 'no_answer', 'replied'].includes(action);
      const attempts = Number(selected.attempt_count || 0) + (isContactAttempt ? 1 : 0);
      let payload: Record<string, unknown> = { updated_by: user?.id || null };
      let result = '';
      let nextDate: string | null = null;
      let successMessage = '';

      if (action === 'message_sent') {
        nextDate = tomorrowKey();
        result = 'في انتظار رد العميل';
        payload = { ...payload, contact_status: 'في انتظار الرد', followup_status: 'في انتظار الرد', response_status: 'waiting_reply', status: 'في انتظار الرد', contacted_at: now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
        successMessage = 'تم تسجيل الرسالة ونقل العميل إلى انتظار الرد';
      } else if (action === 'no_answer') {
        nextDate = tomorrowKey();
        result = 'لم يرد العميل';
        payload = { ...payload, contact_status: 'لم يرد', followup_status: 'لم يرد', response_status: 'no_answer', status: 'لم يرد', contacted_at: selected.contacted_at || now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
        successMessage = 'تم تسجيل عدم الرد وتأجيل المحاولة للغد';
      } else if (action === 'replied') {
        nextDate = scheduledDate || localDayKey();
        result = 'تم الرد وجارٍ استكمال المتابعة';
        payload = { ...payload, contact_status: 'تم الرد', followup_status: 'جارٍ التواصل', response_status: 'replied', status: 'جارٍ التواصل', contacted_at: selected.contacted_at || now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: nextDate, needs_next_followup: true, followup_summary: actionNote.trim(), followup_result: actionNote.trim() };
        successMessage = 'تم تسجيل رد العميل وتفاصيل المحادثة';
      } else if (action === 'scheduled') {
        nextDate = scheduledDate;
        result = 'تم تحديد موعد متابعة جديد';
        payload = { ...payload, next_followup_date: nextDate, followup_status: 'scheduled', status: 'open', needs_next_followup: true, followup_summary: actionNote.trim() || selected.followup_summary };
        successMessage = 'تم تحديد موعد المتابعة';
      } else {
        result = 'تم إكمال المتابعة';
        payload = { ...payload, completed_at: now, status: 'completed', followup_status: 'completed', followup_result: actionNote.trim(), followup_summary: actionNote.trim(), needs_next_followup: false, is_hidden: true, hidden_at: now, hidden_by: user?.name || user?.id || null, hidden_reason: 'تم إكمال المتابعة من قائمة التشغيل الذكية' };
        successMessage = 'تم إكمال المتابعة وظهر عميل جديد مكانها تلقائيًا';
      }

      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, {
        attempt_count: attempts,
        contact_channel: contactChannel,
        result,
        notes: actionNote.trim() || null,
        next_followup_date: nextDate,
        previous_status: rawStatus(selected),
        new_status: payload.followup_status || payload.status || null,
        customer_name: customerName(selected),
        customer_code: selected.customer_code,
      });
      toast.success(successMessage);
      setSelected(null);
      setScheduledDate('');
      setActionNote('');
      setHistoryOpen(false);
      await load();
      window.dispatchEvent(new CustomEvent('customer-followup-updated'));
    } catch (error) {
      toast.error(`تعذر حفظ الإجراء: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const tabs: Array<[WorkspaceTab, string, number, typeof Inbox]> = [
    ['queue', 'قائمة اليوم', smartQueue.length, Inbox],
    ['waiting', 'انتظار الرد', waitingRows.length, Clock3],
    ['contacted', 'سجل التواصل', contactedEvents.length, History],
    ['performance', 'أداء خدمة العملاء', performance.length, BarChart3],
  ];

  if (!managerView && !userBranch) {
    return <section className="mx-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 text-center font-black text-amber-100">حساب خدمة العملاء غير مربوط بفرع.</section>;
  }

  return <>
    <section className="mx-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-black text-cyan-300">قائمة تشغيل ذكية وثابتة</p>
          <h2 className="text-xl font-black text-white">45 عميلًا فقط أمام الموظفة — والباقي محفوظ في الانتظار</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">يتم اختيار العملاء حسب الأهمية، التأخير، قيمة العميل، آخر شراء وعدد المحاولات. عند إنهاء حالة يظهر التالي تلقائيًا.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option>{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option></select> : <div className="input-dark font-black text-cyan-100">{userBranch}</div>}
          <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>} تحديث</button>
          {onOpenTools ? <button className="btn-secondary flex items-center gap-2" onClick={onOpenTools}><Wrench size={16}/> الإدارة والتصحيح</button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tabs.map(([id, label, count, Icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-2xl border p-3 text-right transition ${tab === id ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}><Icon size={18} className="mb-2 text-cyan-300"/><div className="text-xs font-black text-slate-400">{label}</div><div className="text-2xl font-black text-white">{count}</div></button>)}
      </div>

      {tab === 'queue' ? <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3"><div className="text-xs font-black text-emerald-200">المعروض للتنفيذ</div><div className="mt-1 text-2xl font-black text-white">{smartQueue.length} / {DAILY_QUEUE_LIMIT}</div></div>
        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3"><div className="text-xs font-black text-amber-200">محفوظ في قائمة الانتظار</div><div className="mt-1 text-2xl font-black text-white">{backlogCount}</div></div>
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">آلية الإحلال</div><div className="mt-1 text-sm font-black text-white">كل حالة تُنجز → يظهر التالي فورًا</div></div>
      </div> : null}

      {(tab === 'queue' || tab === 'waiting') ? <>
        <div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400"/><input className="input-dark w-full pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف أو سبب المتابعة" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
        <div className="space-y-2">
          {visibleRows.map((row, index) => {
            const tier = importance(row);
            const state = activity(row);
            return <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.06]">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <button type="button" onClick={() => { setSelected(row); setScheduledDate(dayKey(row.next_followup_date)); setActionNote(''); setHistoryOpen(false); }} className="min-w-0 flex-1 text-right">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-white/5 px-2 py-1 text-xs font-black text-slate-400">#{index + 1}</span><div className="font-black text-white">{customerName(row)}</div></div>
                  <div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                    <span className={`rounded-full border px-3 py-1 ${tier.bg} ${tier.color}`}>{tier.label}</span>
                    <span className={`rounded-full bg-white/5 px-3 py-1 ${state.color}`}>{state.label}{state.days === null ? '' : ` · ${state.days} يوم`}</span>
                    {isUrgent(row) ? <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">أولوية عالية</span> : null}
                    {isOverdue(row) ? <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">متأخر</span> : null}
                    {isWaiting(row) ? <span className="rounded-full bg-violet-500/15 px-3 py-1 text-violet-200">في انتظار الرد</span> : null}
                  </div>
                  <div className="mt-2 text-xs font-bold text-slate-500">سبب المتابعة: {row.followup_reason || row.request_details || row.notes || 'غير مسجل'} · آخر شراء: {lastPurchase(row) || 'غير معروف'} · المتوسط: {formatCurrency(monthlyAverage(row))}</div>
                </button>
                <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary text-xs" onClick={() => { setSelected(row); setHistoryOpen(false); void loadHistory(row); }}>{row.attempt_count ? `عرض ${row.attempt_count} محاولة` : 'لا توجد محاولات'}</button><button type="button" title="فتح ملف العميل الكامل" className="btn-secondary p-2" onClick={() => { setSelected(row); setDetailsOpen(true); }}><Eye size={18}/></button></div>
              </div>
            </article>;
          })}
          {!loading && visibleRows.length === 0 ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-8 text-center font-black text-emerald-200"><CheckCircle2 size={28} className="mx-auto mb-2"/> لا توجد حالات في هذا القسم</div> : null}
        </div>
      </> : null}

      {tab === 'contacted' ? <div className="space-y-2">
        {contactedEvents.slice(0, 500).map((event) => <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-cyan-100">{actionLabels[event.action] || event.action}</div><div className="text-xs font-bold text-slate-400">{formatDateTime(event.created_at)}</div></div><div className="mt-2 text-sm font-bold text-white">{text(event.metadata?.customer_name) || 'عميل غير محدد'} {text(event.metadata?.customer_code) ? `· ${text(event.metadata?.customer_code)}` : ''}</div><div className="mt-1 text-xs text-slate-400">بواسطة: {event.actor_name || 'النظام'} · {event.branch || 'فرع غير محدد'} · النتيجة: {text(event.metadata?.result) || 'غير مسجلة'}</div>{text(event.metadata?.notes) ? <div className="mt-2 rounded-xl bg-black/20 p-3 text-sm leading-7 text-slate-200">{text(event.metadata?.notes)}</div> : null}</div>)}
        {!contactedEvents.length ? <div className="p-8 text-center font-black text-slate-400">لا توجد محاولات تواصل مسجلة.</div> : null}
      </div> : null}

      {tab === 'performance' ? <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black text-white">تحليل أداء مسؤولي خدمة العملاء</h3><p className="text-xs font-bold text-slate-400">يقيس المحاولات والردود والإكمال والعملاء المختلفين، وليس عدد الضغطات فقط.</p></div><select className="input-dark" value={performanceDays} onChange={(event) => setPerformanceDays(Number(event.target.value))}><option value={7}>آخر 7 أيام</option><option value={14}>آخر 14 يومًا</option><option value={30}>آخر 30 يومًا</option></select></div>
        <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="min-w-full text-right text-sm"><thead className="bg-white/5 text-xs text-slate-300"><tr><th className="p-3">المسؤول</th><th className="p-3">عملاء مختلفون</th><th className="p-3">محاولات</th><th className="p-3">رسائل</th><th className="p-3">لم يرد</th><th className="p-3">تم الرد</th><th className="p-3">مكتمل</th><th className="p-3">نسبة الرد</th><th className="p-3">نسبة الإكمال</th></tr></thead><tbody>{performance.map((item) => { const responseRate = item.attempts ? item.replied / item.attempts : 0; const completionRate = item.customers.size ? item.completed / item.customers.size : 0; return <tr key={item.actor} className="border-t border-white/10 text-white"><td className="p-3 font-black">{item.actor}</td><td className="p-3">{item.customers.size}</td><td className="p-3">{item.attempts}</td><td className="p-3">{item.messages}</td><td className="p-3">{item.noAnswer}</td><td className="p-3 text-emerald-200">{item.replied}</td><td className="p-3 text-cyan-200">{item.completed}</td><td className="p-3">{(responseRate * 100).toFixed(1)}%</td><td className="p-3">{(completionRate * 100).toFixed(1)}%</td></tr>; })}</tbody></table></div>
        {!performance.length ? <div className="p-8 text-center font-black text-slate-400">لا توجد بيانات أداء في الفترة المحددة.</div> : null}
      </div> : null}
    </section>

    {selected && !detailsOpen ? <div className="fixed inset-0 z-[100] flex justify-end bg-black/65" dir="rtl" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="h-full w-full max-w-2xl overflow-y-auto border-r border-cyan-300/20 bg-[#091b2d] p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-cyan-300">بطاقة تنفيذ المتابعة</p><h3 className="mt-1 text-2xl font-black text-white">{customerName(selected)}</h3><p className="mt-1 text-sm font-bold text-slate-400">{selected.customer_code || 'بدون كود'} · {customerPhone(selected) || 'بدون هاتف'} · {selected.branch || 'فرع غير محدد'}</p></div><button className="btn-secondary" onClick={() => setSelected(null)}><X size={18}/></button></div>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4"><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">الأهمية</div><div className={`mt-1 font-black ${importance(selected).color}`}>{importance(selected).label}</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">النشاط</div><div className={`mt-1 font-black ${activity(selected).color}`}>{activity(selected).label}</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">آخر شراء</div><div className="mt-1 font-black text-white">{lastPurchase(selected) || 'غير معروف'}</div></div><button type="button" onClick={() => void loadHistory(selected)} className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-3 text-right"><div className="text-xs font-bold text-cyan-200">المحاولات</div><div className="mt-1 font-black text-white">عرض {selected.attempt_count || 0} محاولة</div></button></div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-7 text-slate-300"><div><b className="text-white">سبب المتابعة:</b> {selected.followup_reason || selected.request_details || selected.notes || 'غير مسجل'}</div><div><b className="text-white">آخر نتيجة:</b> {selected.followup_result || selected.contact_result || selected.followup_summary || 'لم تسجل نتيجة بعد'}</div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><button className="btn-primary flex items-center justify-center gap-2" onClick={() => setDetailsOpen(true)}><Eye size={17}/> ملف العميل الكامل</button><button className="btn-secondary flex items-center justify-center gap-2" onClick={() => void loadHistory(selected)}><History size={17}/> تاريخ المتابعات</button></div>
      {historyOpen ? <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-black/15 p-4"><div className="mb-3 font-black text-white">الخط الزمني الكامل</div>{historyLoading ? <div className="flex items-center gap-2 text-slate-300"><Loader2 size={16} className="animate-spin"/> جاري التحميل...</div> : history.length ? <div className="space-y-2">{history.map((event) => <div key={event.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><div className="font-black text-cyan-100">{actionLabels[event.action] || event.action}</div><div className="mt-1 text-xs text-slate-400">{event.actor_name || 'النظام'} · {formatDateTime(event.created_at)}</div><div className="mt-2 grid gap-1 text-xs text-slate-300"><div>وسيلة التواصل: {text(event.metadata?.contact_channel) || 'غير مسجلة'}</div><div>النتيجة: {text(event.metadata?.result) || 'غير مسجلة'}</div><div>رقم المحاولة: {text(event.metadata?.attempt_count) || '—'}</div><div>الموعد التالي: {text(event.metadata?.next_followup_date) || 'غير محدد'}</div></div>{text(event.metadata?.notes) ? <div className="mt-2 rounded-lg bg-black/20 p-2 text-sm leading-6 text-white">{text(event.metadata?.notes)}</div> : <div className="mt-2 text-xs text-slate-500">لم تُسجل ملاحظات تفصيلية لهذه المحاولة.</div>}</div>)}</div> : <div className="text-sm font-bold text-slate-400">لا توجد أحداث مسجلة حتى الآن.</div>}</div> : null}
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-black text-white">وسيلة التواصل<select className="input-dark mt-2 w-full" value={contactChannel} onChange={(event) => setContactChannel(event.target.value)}><option>واتساب</option><option>اتصال هاتفي</option><option>رسالة SMS</option><option>زيارة داخل الفرع</option><option>أخرى</option></select></label><label className="text-sm font-black text-white">موعد المتابعة التالي<input type="date" className="input-dark mt-2 w-full" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)}/></label></div><label className="mt-3 block text-sm font-black text-white">تفاصيل المحاولة والنتيجة<textarea className="input-dark mt-2 min-h-28 w-full resize-y" value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="اكتب ما تم مع العميل، طلباته، سبب عدم الرد، أو نتيجة المحادثة..."/></label></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2"><button className="btn-secondary flex items-center justify-center gap-2" disabled={saving} onClick={() => void executeAction('message_sent')}><Send size={16}/> أرسلت رسالة</button><button className="btn-secondary flex items-center justify-center gap-2" disabled={saving} onClick={() => void executeAction('no_answer')}><PhoneOff size={16}/> لم يرد</button><button className="btn-secondary flex items-center justify-center gap-2" disabled={saving} onClick={() => void executeAction('replied')}><MessageCircle size={16}/> تم الرد</button>{customerPhone(selected) ? <a className="btn-secondary flex items-center justify-center gap-2" href={generateWhatsAppLink(customerPhone(selected), 'أهلًا بحضرتك، مع حضرتك صيدليات دواء. حابين نطمن إن كل شيء تمام، وإحنا تحت أمرك في أي وقت.')} target="_blank" rel="noreferrer"><MessageCircle size={16}/> فتح واتساب</a> : <button className="btn-secondary" disabled>لا يوجد هاتف صالح</button>}<button className="btn-secondary" disabled={saving || !scheduledDate} onClick={() => void executeAction('scheduled')}>حفظ الموعد فقط</button><button className="btn-primary" disabled={saving} onClick={() => void executeAction('completed')}><CheckCircle2 size={16} className="inline ms-2"/> إكمال المتابعة وإظهار التالي</button></div>
    </aside></div> : null}

    {detailsOpen && selected ? <Suspense fallback={<div className="fixed inset-0 z-[110] grid place-items-center bg-black/70"><Loader2 className="animate-spin text-cyan-300"/></div>}><CustomerQuickDetailsModal followupId={selected.id} customerId={selected.customer_id} customerCode={selected.customer_code} customerPhone={customerPhone(selected)} customerName={customerName(selected)} branch={selected.branch} fallbackMetric={{ ...selected.customer_metrics, customer_code: selected.customer_code, customer_phone: customerPhone(selected), customer_name: customerName(selected), branch: selected.branch, total_spent: selected.total_spent, avg_monthly: monthlyAverage(selected), last_purchase: lastPurchase(selected), segment: importance(selected).label, customer_status: activity(selected).label }} onClose={() => setDetailsOpen(false)}/></Suspense> : null}
  </>;
}
