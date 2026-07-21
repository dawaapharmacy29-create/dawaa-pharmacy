import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  History,
  Loader2,
  MessageCircle,
  PhoneOff,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserRoundSearch,
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
const PAGE_SIZE = 50;
const FETCH_BATCH = 1000;

type WorkflowStatus = 'open' | 'waiting_reply' | 'no_answer' | 'scheduled' | 'needs_manager';
type QueueFilter = 'all' | WorkflowStatus | 'urgent' | 'overdue' | 'missing_data';
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
  action: string;
  actor_name: string | null;
  created_at: string;
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

function workflowStatus(row: FollowupRow): WorkflowStatus {
  const status = rawStatus(row);
  if (row.needs_manager || /يحتاج مدير|تصعيد|needs_manager/i.test(status)) return 'needs_manager';
  if (/لم يرد|no_answer/i.test(status)) return 'no_answer';
  if (/في انتظار الرد|تم إرسال رسالة|message_sent|waiting_reply/i.test(status)) return 'waiting_reply';
  if (dayKey(row.next_followup_date) > localDayKey() || /مؤجل|scheduled|postponed/i.test(status)) return 'scheduled';
  return 'open';
}

const isUrgent = (row: FollowupRow) => /عاجل|urgent|high|شكوى|تصعيد/i.test(`${row.priority || ''} ${rawStatus(row)}`);
const isMissingData = (row: FollowupRow) => !text(row.customer_code) || !isValidEgyptianMobile(customerPhone(row));
const isOverdue = (row: FollowupRow) => Boolean(dayKey(row.next_followup_date) && dayKey(row.next_followup_date) < localDayKey());

const labels: Record<WorkflowStatus, string> = {
  open: 'مطلوب الآن',
  waiting_reply: 'في انتظار الرد',
  no_answer: 'لم يرد',
  scheduled: 'موعد قادم',
  needs_manager: 'يحتاج مديرًا',
};

const actionLabels: Record<string, string> = {
  message_sent: 'تم إرسال رسالة للعميل',
  no_answer: 'تم تسجيل عدم رد العميل',
  replied: 'تم تسجيل رد العميل',
  scheduled: 'تم تحديد موعد متابعة',
  completed: 'تم إكمال المتابعة',
  customer_data_corrected: 'تم تصحيح بيانات العميل',
  branch_transferred: 'تم تحويل العميل إلى فرع آخر',
  updated: 'تم تحديث المتابعة',
  created: 'تم إنشاء المتابعة',
};

function dedupeRows(rows: FollowupRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = text(row.customer_id || row.customer_code || customerPhone(row) || customerName(row)).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CustomerFollowupCockpitPanel({ onOpenTools }: { onOpenTools?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');

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
      setRows(dedupeRows(allRows));
    } catch (error) {
      toast.error(`تعذر تحميل مركز المتابعات: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [branch, managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [branch, filter, search]);

  const counts = useMemo(() => ({
    all: rows.length,
    open: rows.filter((row) => workflowStatus(row) === 'open').length,
    waiting_reply: rows.filter((row) => workflowStatus(row) === 'waiting_reply').length,
    no_answer: rows.filter((row) => workflowStatus(row) === 'no_answer').length,
    scheduled: rows.filter((row) => workflowStatus(row) === 'scheduled').length,
    needs_manager: rows.filter((row) => workflowStatus(row) === 'needs_manager').length,
    urgent: rows.filter(isUrgent).length,
    overdue: rows.filter(isOverdue).length,
    missing_data: rows.filter(isMissingData).length,
  }), [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'urgent' && !isUrgent(row)) return false;
      if (filter === 'overdue' && !isOverdue(row)) return false;
      if (filter === 'missing_data' && !isMissingData(row)) return false;
      if (['open', 'waiting_reply', 'no_answer', 'scheduled', 'needs_manager'].includes(filter) && workflowStatus(row) !== filter) return false;
      if (!query) return true;
      return `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''} ${rawStatus(row)} ${importance(row).label} ${activity(row).label}`.toLowerCase().includes(query);
    });
  }, [filter, rows, search]);

  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasMore = (page + 1) * PAGE_SIZE < filteredRows.length;

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
        .select('id,action,actor_name,created_at')
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
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const attempts = Number(selected.attempt_count || 0) + (action === 'message_sent' || action === 'no_answer' ? 1 : 0);
      let payload: Record<string, unknown> = { updated_by: user?.id || null };
      let successMessage = '';
      if (action === 'message_sent') {
        payload = { ...payload, contact_status: 'في انتظار الرد', followup_status: 'في انتظار الرد', response_status: 'waiting_reply', status: 'في انتظار الرد', contacted_at: now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: tomorrowKey(), needs_next_followup: true };
        successMessage = 'تم تسجيل إرسال الرسالة وترحيل المتابعة للغد';
      } else if (action === 'no_answer') {
        payload = { ...payload, contact_status: 'لم يرد', followup_status: 'لم يرد', response_status: 'no_answer', status: 'لم يرد', contacted_at: selected.contacted_at || now, first_attempt_at: selected.first_attempt_at || now, last_attempt_at: now, attempt_count: attempts, next_followup_date: tomorrowKey(), needs_next_followup: true };
        successMessage = 'تم تسجيل عدم الرد وترحيل المتابعة للغد';
      } else if (action === 'replied') {
        payload = { ...payload, contact_status: 'تم الرد', followup_status: 'جارٍ التواصل', response_status: 'replied', status: 'جارٍ التواصل', last_attempt_at: now, next_followup_date: localDayKey(), needs_next_followup: true };
        successMessage = 'تم تسجيل رد العميل';
      } else if (action === 'scheduled') {
        payload = { ...payload, next_followup_date: scheduledDate, followup_status: 'scheduled', status: 'open', needs_next_followup: true };
        successMessage = 'تم تحديد موعد المتابعة';
      } else {
        payload = { ...payload, completed_at: now, status: 'completed', followup_status: 'completed', needs_next_followup: false, is_hidden: true, hidden_at: now, hidden_by: user?.name || user?.id || null, hidden_reason: 'تم إكمال المتابعة من مركز المتابعات' };
        successMessage = 'تم إكمال المتابعة ونقلها للسجل التاريخي';
      }
      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, { next_followup_date: payload.next_followup_date || null, attempt_count: attempts });
      toast.success(successMessage);
      setSelected(null);
      setScheduledDate('');
      await load();
      window.dispatchEvent(new CustomEvent('customer-followup-updated'));
    } catch (error) {
      toast.error(`تعذر حفظ الإجراء: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const filters: Array<[QueueFilter, string, number, typeof Sparkles]> = [
    ['all', 'كل المفتوح', counts.all, Sparkles],
    ['open', 'مطلوب الآن', counts.open, Sparkles],
    ['waiting_reply', 'انتظار رد', counts.waiting_reply, Clock3],
    ['no_answer', 'لم يرد', counts.no_answer, PhoneOff],
    ['scheduled', 'موعد قادم', counts.scheduled, CalendarClock],
    ['needs_manager', 'يحتاج مديرًا', counts.needs_manager, ShieldAlert],
    ['urgent', 'عاجل', counts.urgent, AlertTriangle],
    ['overdue', 'متأخر', counts.overdue, AlertTriangle],
    ['missing_data', 'بيانات ناقصة', counts.missing_data, UserRoundSearch],
  ];

  if (!managerView && !userBranch) {
    return <section className="mx-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-6 text-center font-black text-amber-100">حساب خدمة العملاء غير مربوط بفرع.</section>;
  }

  return <>
    <section className="mx-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-xs font-black text-cyan-300">Customer Follow-up Cockpit</p><h2 className="text-xl font-black text-white">قائمة واحدة لكل حالات العملاء</h2><p className="mt-1 text-sm font-bold text-slate-400">التصنيف، حالة النشاط، آخر تعامل، ملف العميل والسجل من نفس المسار.</p></div>
        <div className="flex flex-wrap gap-2">
          {managerView ? <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option>{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option></select> : <div className="input-dark font-black text-cyan-100">{userBranch}</div>}
          <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>} تحديث</button>
          {onOpenTools ? <button className="btn-secondary flex items-center gap-2" onClick={onOpenTools}><Wrench size={16}/> أدوات متقدمة</button> : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">{filters.map(([id, label, count, Icon]) => <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-2xl border p-3 text-right transition ${filter === id ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}><Icon size={17} className="mb-2 text-cyan-300"/><div className="text-xs font-black text-slate-400">{label}</div><div className="text-2xl font-black text-white">{count}</div></button>)}</div>
      <div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400"/><input className="input-dark w-full pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف أو التصنيف أو الحالة" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
      <div className="flex items-center justify-between text-sm font-black"><span className="text-cyan-200">النتائج: {filteredRows.length} عميل</span><span className="text-slate-400">صفحة {page + 1}</span></div>
      <div className="space-y-2">
        {pageRows.map((row) => {
          const tier = importance(row);
          const state = activity(row);
          return <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.06]">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <button type="button" onClick={() => { setSelected(row); setScheduledDate(dayKey(row.next_followup_date)); setHistoryOpen(false); }} className="min-w-0 flex-1 text-right">
                <div className="font-black text-white">{customerName(row)}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                  <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-cyan-200">{labels[workflowStatus(row)]}</span>
                  <span className={`rounded-full border px-3 py-1 ${tier.bg} ${tier.color}`}>{tier.label}</span>
                  <span className={`rounded-full bg-white/5 px-3 py-1 ${state.color}`}>{state.label}{state.days === null ? '' : ` · ${state.days} يوم`}</span>
                  {isUrgent(row) ? <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">أولوية عالية</span> : null}
                  {isOverdue(row) ? <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">متأخر</span> : null}
                  {isMissingData(row) ? <span className="rounded-full bg-fuchsia-500/15 px-3 py-1 text-fuchsia-200">بيانات ناقصة</span> : null}
                </div>
                <div className="mt-2 text-xs font-bold text-slate-500">آخر تعامل: {lastPurchase(row) || 'غير معروف'} · المتوسط الشهري: {formatCurrency(monthlyAverage(row))}</div>
              </button>
              <div className="flex items-center gap-2"><div className="text-xs font-bold text-slate-400">الموعد: {dayKey(row.next_followup_date) || 'غير محدد'} · المحاولات: {row.attempt_count || 0}</div><button type="button" title="فتح ملف العميل الكامل" className="btn-secondary p-2" onClick={() => { setSelected(row); setDetailsOpen(true); }}><Eye size={18}/></button></div>
            </div>
          </article>;
        })}
        {!loading && pageRows.length === 0 ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-8 text-center font-black text-emerald-200"><CheckCircle2 size={28} className="mx-auto mb-2"/> لا توجد حالات مطابقة</div> : null}
      </div>
      <div className="flex items-center justify-between"><button className="btn-secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>السابق</button><button className="btn-secondary" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
    </section>

    {selected && !detailsOpen ? <div className="fixed inset-0 z-[100] flex justify-end bg-black/65" dir="rtl" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="h-full w-full max-w-2xl overflow-y-auto border-r border-cyan-300/20 bg-[#091b2d] p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-cyan-300">بطاقة العميل الموحدة</p><h3 className="mt-1 text-2xl font-black text-white">{customerName(selected)}</h3><p className="mt-1 text-sm font-bold text-slate-400">{selected.customer_code || 'بدون كود'} · {customerPhone(selected) || 'بدون هاتف'} · {selected.branch || 'فرع غير محدد'}</p></div><button className="btn-secondary" onClick={() => setSelected(null)}><X size={18}/></button></div>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">الأهمية</div><div className={`mt-1 font-black ${importance(selected).color}`}>{importance(selected).label}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">حالة النشاط</div><div className={`mt-1 font-black ${activity(selected).color}`}>{activity(selected).label}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">آخر تعامل</div><div className="mt-1 font-black text-white">{lastPurchase(selected) || 'غير معروف'}</div><div className="text-xs text-slate-500">{activity(selected).days === null ? '' : `منذ ${activity(selected).days} يوم`}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">المتوسط الشهري</div><div className="mt-1 font-black text-white">{formatCurrency(monthlyAverage(selected))}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">حالة المتابعة</div><div className="mt-1 font-black text-cyan-200">{labels[workflowStatus(selected)]}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">المحاولات</div><div className="mt-1 font-black text-white">{selected.attempt_count || 0}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">إجمالي المشتريات</div><div className="mt-1 font-black text-white">{formatCurrency(Number(selected.total_spent || metricNumber(selected, 'total_spent')))}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-bold text-slate-400">متوسط مرات الشراء</div><div className="mt-1 font-black text-white">{selected.average_monthly_purchase_count || metricNumber(selected, 'average_monthly_purchase_count')}</div></div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-7 text-slate-300"><div><b className="text-white">سبب المتابعة:</b> {selected.followup_reason || selected.request_details || selected.notes || 'غير مسجل'}</div><div><b className="text-white">آخر نتيجة:</b> {selected.followup_result || selected.contact_result || selected.followup_summary || 'لم تسجل نتيجة بعد'}</div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><button className="btn-primary flex items-center justify-center gap-2" onClick={() => setDetailsOpen(true)}><Eye size={17}/> ملف العميل الكامل</button><button className="btn-secondary flex items-center justify-center gap-2" onClick={() => void loadHistory(selected)}><History size={17}/> تاريخ المتابعات</button></div>
      {historyOpen ? <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-black/15 p-4"><div className="mb-3 font-black text-white">تاريخ المتابعة</div>{historyLoading ? <div className="flex items-center gap-2 text-slate-300"><Loader2 size={16} className="animate-spin"/> جاري التحميل...</div> : history.length ? <div className="space-y-2">{history.map((event) => <div key={event.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><div className="font-black text-cyan-100">{actionLabels[event.action] || event.action}</div><div className="mt-1 text-xs text-slate-400">{event.actor_name || 'النظام'} · {formatDateTime(event.created_at)}</div></div>)}</div> : <div className="text-sm font-bold text-slate-400">لا توجد أحداث مسجلة لهذه المتابعة حتى الآن.</div>}</div> : null}
      <div className="mt-5 grid gap-2 sm:grid-cols-2"><button className="btn-secondary flex items-center justify-center gap-2" disabled={saving} onClick={() => void executeAction('message_sent')}><Send size={16}/> أرسلت رسالة</button><button className="btn-secondary flex items-center justify-center gap-2" disabled={saving} onClick={() => void executeAction('no_answer')}><PhoneOff size={16}/> لم يرد</button><button className="btn-secondary flex items-center justify-center gap-2" disabled={saving} onClick={() => void executeAction('replied')}><MessageCircle size={16}/> تم الرد</button>{customerPhone(selected) ? <a className="btn-secondary flex items-center justify-center gap-2" href={generateWhatsAppLink(customerPhone(selected), 'أهلًا بحضرتك، مع حضرتك صيدليات دواء. حابين نطمن إن كل شيء تمام، وإحنا تحت أمرك في أي وقت.')} target="_blank" rel="noreferrer"><MessageCircle size={16}/> واتساب</a> : <button className="btn-secondary" disabled>لا يوجد هاتف صالح</button>}</div>
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><label className="text-sm font-black text-white">تحديد موعد المتابعة التالي</label><div className="mt-2 flex gap-2"><input type="date" className="input-dark flex-1" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)}/><button className="btn-primary" disabled={saving || !scheduledDate} onClick={() => void executeAction('scheduled')}>حفظ الموعد</button></div></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2"><button className="btn-primary" disabled={saving} onClick={() => void executeAction('completed')}><CheckCircle2 size={16} className="inline ms-2"/> إكمال المتابعة</button>{onOpenTools ? <button className="btn-secondary" onClick={() => { setSelected(null); onOpenTools(); }}><Wrench size={16} className="inline ms-2"/> التحويل والتصحيح والإجراءات</button> : null}</div>
    </aside></div> : null}

    {detailsOpen && selected ? <Suspense fallback={<div className="fixed inset-0 z-[110] grid place-items-center bg-black/70"><Loader2 className="animate-spin text-cyan-300"/></div>}><CustomerQuickDetailsModal followupId={selected.id} customerId={selected.customer_id} customerCode={selected.customer_code} customerPhone={customerPhone(selected)} customerName={customerName(selected)} branch={selected.branch} fallbackMetric={{ ...selected.customer_metrics, customer_code: selected.customer_code, customer_phone: customerPhone(selected), customer_name: customerName(selected), branch: selected.branch, total_spent: selected.total_spent, avg_monthly: monthlyAverage(selected), last_purchase: lastPurchase(selected), segment: importance(selected).label, customer_status: activity(selected).label }} onClose={() => setDetailsOpen(false)}/></Suspense> : null}
  </>;
}
