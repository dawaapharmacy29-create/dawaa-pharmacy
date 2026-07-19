import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchCustomerServiceOperations,
  fetchCustomerServiceStats,
  type CustomerServiceDueBucket,
  type CustomerServiceOperationalStatus,
  type CustomerServiceOperationsRow,
  type CustomerServiceStats,
} from '@/lib/api/customerServiceOperations';
import {
  archiveCustomerFollowup,
  cancelCustomerFollowup,
  fetchCustomerFollowupEvents,
  postponeCustomerFollowup,
  restoreCustomerFollowup,
  type FollowupEventRow,
} from '@/lib/api/customerServiceSecureActions';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';

const EMPTY_STATS: CustomerServiceStats = {
  total: 0,
  open: 0,
  postponed: 0,
  needs_manager: 0,
  completed: 0,
  cancelled: 0,
  archived: 0,
  overdue: 0,
  due_today: 0,
  without_schedule: 0,
};

const STATUS_LABELS: Record<CustomerServiceOperationalStatus, string> = {
  open: 'مفتوحة',
  postponed: 'مؤجلة',
  needs_manager: 'تحتاج مدير',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  archived: 'الأرشيف',
};

const DUE_LABELS: Record<CustomerServiceDueBucket, string> = {
  overdue: 'متأخرة',
  today: 'مستحقة اليوم',
  tomorrow: 'غدًا',
  upcoming: 'قادمة',
  unscheduled: 'بدون موعد',
};

type ActionKind = 'postpone' | 'cancel' | 'archive' | 'restore';

type ActionState = {
  kind: ActionKind;
  row: CustomerServiceOperationsRow;
} | null;

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function todayInput(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function statusBadge(status: CustomerServiceOperationalStatus) {
  const styles: Record<CustomerServiceOperationalStatus, string> = {
    open: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
    postponed: 'border-blue-400/30 bg-blue-500/10 text-blue-100',
    needs_manager: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    completed: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
    cancelled: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
    archived: 'border-slate-500/40 bg-slate-500/10 text-slate-200',
  };
  return `rounded-full border px-2.5 py-1 text-xs font-black ${styles[status]}`;
}

export default function CustomerServiceOperationsPanel() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(allBranches ? '' : userBranch);
  const [status, setStatus] = useState<CustomerServiceOperationalStatus | 'all'>('all');
  const [due, setDue] = useState<CustomerServiceDueBucket | 'all'>('all');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<CustomerServiceStats>(EMPTY_STATS);
  const [rows, setRows] = useState<CustomerServiceOperationsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [action, setAction] = useState<ActionState>(null);
  const [timelineRow, setTimelineRow] = useState<CustomerServiceOperationsRow | null>(null);
  const [timeline, setTimeline] = useState<FollowupEventRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [nextStats, nextRows] = await Promise.all([
        fetchCustomerServiceStats(branch || null),
        fetchCustomerServiceOperations({ branch: branch || null, status, due, search, limit: 500 }),
      ]);
      setStats(nextStats || EMPTY_STATS);
      setRows(nextRows);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل مركز العمليات';
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [branch, due, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const handler = () => void load(true);
    window.addEventListener('customer-service-followups-changed', handler);
    return () => window.removeEventListener('customer-service-followups-changed', handler);
  }, [load]);

  const cards = useMemo(() => [
    { key: 'all' as const, label: 'كل المتابعات', value: stats.total, icon: History, due: 'all' as const },
    { key: 'open' as const, label: 'مفتوحة', value: stats.open, icon: Clock3, due: 'all' as const },
    { key: 'needs_manager' as const, label: 'تحتاج مدير', value: stats.needs_manager, icon: UserCheck, due: 'all' as const },
    { key: 'postponed' as const, label: 'مؤجلة', value: stats.postponed, icon: CalendarClock, due: 'all' as const },
    { key: 'all' as const, label: 'متأخرة', value: stats.overdue, icon: AlertTriangle, due: 'overdue' as const },
    { key: 'all' as const, label: 'اليوم', value: stats.due_today, icon: ShieldAlert, due: 'today' as const },
    { key: 'completed' as const, label: 'مكتملة', value: stats.completed, icon: CheckCircle2, due: 'all' as const },
    { key: 'archived' as const, label: 'الأرشيف', value: stats.archived, icon: Archive, due: 'all' as const },
  ], [stats]);

  async function openTimeline(row: CustomerServiceOperationsRow) {
    setTimelineRow(row);
    setTimeline([]);
    setTimelineLoading(true);
    try {
      setTimeline(await fetchCustomerFollowupEvents(row.id));
    } catch (timelineError) {
      toast.error(timelineError instanceof Error ? timelineError.message : 'تعذر تحميل السجل');
    } finally {
      setTimelineLoading(false);
    }
  }

  function announceChange() {
    window.dispatchEvent(new CustomEvent('customer-service-followups-changed'));
  }

  return (
    <section className="mb-5 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/45 shadow-xl" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-black text-white"><ShieldAlert size={20} className="text-teal-300" />مركز عمليات خدمة العملاء</div>
          <p className="mt-1 text-xs text-slate-400">متابعة الحالات المتأخرة والمؤجلة وحالات المدير والأرشيف من شاشة واحدة.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="btn-secondary flex items-center gap-2 text-xs"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />تحديث</button>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/5"><ChevronDown size={18} className={`transition ${expanded ? 'rotate-180' : ''}`} /></button>
        </div>
      </header>

      {expanded && <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {cards.map(({ key, label, value, icon: Icon, due: cardDue }) => {
            const active = status === key && due === cardDue;
            return <button key={`${key}-${label}`} type="button" onClick={() => { setStatus(key); setDue(cardDue); }} className={`rounded-2xl border p-3 text-right transition ${active ? 'border-teal-300/60 bg-teal-500/15' : 'border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]'}`}>
              <div className="flex items-center justify-between"><Icon size={17} className="text-teal-200" /><span className="text-2xl font-black text-white">{value}</span></div>
              <div className="mt-2 text-xs font-bold text-slate-300">{label}</div>
            </button>;
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-[180px_180px_minmax(0,1fr)_auto]">
          {allBranches ? <select value={branch} onChange={(event) => setBranch(event.target.value)} className="input-dark"><option value="">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select> : <div className="input-dark flex items-center">{branch || 'فرع الحساب'}</div>}
          <select value={due} onChange={(event) => setDue(event.target.value as CustomerServiceDueBucket | 'all')} className="input-dark"><option value="all">كل المواعيد</option>{Object.entries(DUE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="relative"><Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="input-dark pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف" /></div>
          <button type="button" className="btn-secondary" onClick={() => { setStatus('all'); setDue('all'); setSearch(''); }}>مسح الفلاتر</button>
        </div>

        {error && <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm font-bold text-rose-100">{error}</div>}
        {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-slate-300"><Loader2 className="animate-spin" />جاري تحميل العمليات...</div> : rows.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">لا توجد متابعات مطابقة للفلاتر الحالية.</div> : <div className="max-h-[560px] space-y-2 overflow-y-auto pl-1">
          {rows.map((row) => <article key={row.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-white">{row.display_customer_name || row.customer_name || row.name || 'عميل بدون اسم'}</h3><span className={statusBadge(row.operational_status)}>{STATUS_LABELS[row.operational_status]}</span>{row.due_bucket && <span className="rounded-full border border-white/10 px-2 py-1 text-xs font-bold text-slate-300">{DUE_LABELS[row.due_bucket]}</span>}</div>
                <p className="mt-1 text-xs text-slate-400">{row.customer_code || 'بدون كود'} · {row.display_phone || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</p>
                <p className="mt-2 line-clamp-2 text-sm text-slate-300">{row.followup_reason || row.request_details || row.followup_notes || 'لا توجد ملاحظات'}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><span>الموعد: {formatDate(row.next_followup_date || row.postponed_until)}</span><span>الأحداث: {row.events_count || 0}</span><span>آخر نشاط: {formatDate(row.last_event_at || row.updated_at)}</span></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void openTimeline(row)} className="btn-secondary text-xs"><History size={14} /> السجل</button>
                {!['completed', 'cancelled', 'archived'].includes(row.operational_status) && <button type="button" onClick={() => setAction({ kind: 'postpone', row })} className="btn-secondary text-xs"><CalendarClock size={14} /> تأجيل</button>}
                {!['completed', 'cancelled', 'archived'].includes(row.operational_status) && <button type="button" onClick={() => setAction({ kind: 'cancel', row })} className="btn-secondary text-xs"><X size={14} /> إلغاء</button>}
                {row.operational_status === 'archived' ? <button type="button" onClick={() => setAction({ kind: 'restore', row })} className="btn-secondary text-xs"><RotateCcw size={14} /> استعادة</button> : <button type="button" onClick={() => setAction({ kind: 'archive', row })} className="btn-secondary text-xs"><Archive size={14} /> أرشفة</button>}
              </div>
            </div>
          </article>)}
        </div>}
      </div>}

      {action && <FollowupActionModal state={action} onClose={() => setAction(null)} onDone={() => { setAction(null); announceChange(); void load(true); }} />}
      {timelineRow && <TimelineModal row={timelineRow} events={timeline} loading={timelineLoading} onClose={() => setTimelineRow(null)} />}
    </section>
  );
}

function FollowupActionModal({ state, onClose, onDone }: { state: NonNullable<ActionState>; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayInput(1));
  const [saving, setSaving] = useState(false);
  const labels: Record<ActionKind, string> = { postpone: 'تأجيل المتابعة', cancel: 'إلغاء المتابعة', archive: 'أرشفة المتابعة', restore: 'استعادة المتابعة' };

  async function submit() {
    if (state.kind !== 'restore' && state.kind !== 'postpone' && reason.trim().length < 3) return toast.error('اكتب سببًا واضحًا للإجراء');
    if (state.kind === 'postpone' && !date) return toast.error('اختر تاريخ المتابعة القادمة');
    setSaving(true);
    try {
      if (state.kind === 'postpone') await postponeCustomerFollowup(state.row.id, `${date}T10:00:00`);
      if (state.kind === 'cancel') await cancelCustomerFollowup(state.row.id, reason.trim());
      if (state.kind === 'archive') await archiveCustomerFollowup(state.row.id, reason.trim());
      if (state.kind === 'restore') await restoreCustomerFollowup(state.row.id);
      toast.success(`تم ${labels[state.kind]} بنجاح`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء');
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" dir="rtl"><div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#101b31] p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h3 className="text-xl font-black text-white">{labels[state.kind]}</h3><p className="mt-1 text-sm text-slate-400">{state.row.display_customer_name || state.row.customer_name || state.row.name}</p></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white/10"><X size={20} /></button></div>{state.kind === 'postpone' ? <div className="mt-5 space-y-3"><label className="block text-sm font-bold text-slate-200">موعد المتابعة القادمة</label><input type="date" min={todayInput()} value={date} onChange={(event) => setDate(event.target.value)} className="input-dark" /><div className="grid grid-cols-2 gap-2"><button type="button" className="btn-secondary text-xs" onClick={() => setDate(todayInput(1))}>بكرة</button><button type="button" className="btn-secondary text-xs" onClick={() => setDate(todayInput(2))}>بعد يومين</button></div></div> : state.kind !== 'restore' ? <label className="mt-5 block space-y-2 text-sm font-bold text-slate-200"><span>سبب الإجراء *</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="input-dark min-h-28 resize-y" placeholder="اكتب السبب بوضوح ليظهر في سجل المتابعة" /></label> : <div className="mt-5 rounded-2xl border border-teal-400/25 bg-teal-500/10 p-4 text-sm leading-7 text-teal-100">سيتم إعادة المتابعة إلى القوائم التشغيلية مع الاحتفاظ بسجل الأرشفة السابق.</div>}<div className="mt-6 flex gap-3"><button type="button" onClick={() => void submit()} disabled={saving} className="btn-primary flex-1">{saving ? 'جاري التنفيذ...' : 'تأكيد'}</button><button type="button" onClick={onClose} disabled={saving} className="btn-secondary flex-1">رجوع</button></div></div></div>;
}

function TimelineModal({ row, events, loading, onClose }: { row: CustomerServiceOperationsRow; events: FollowupEventRow[]; loading: boolean; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" dir="rtl"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#101b31] shadow-2xl"><header className="sticky top-0 flex items-start justify-between border-b border-white/10 bg-[#101b31]/95 p-5 backdrop-blur"><div><h3 className="text-xl font-black text-white">سجل المتابعة الكامل</h3><p className="mt-1 text-sm text-slate-400">{row.display_customer_name || row.customer_name || row.name} · {row.customer_code || 'بدون كود'}</p></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white/10"><X size={20} /></button></header><div className="p-5">{loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-slate-300"><Loader2 className="animate-spin" />جاري تحميل السجل...</div> : events.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">لا توجد أحداث مسجلة لهذه المتابعة حتى الآن.</div> : <div className="space-y-3">{events.map((event) => <div key={event.id} className="relative rounded-2xl border border-white/10 bg-slate-950/35 p-4 pr-10"><div className="absolute right-4 top-5 h-3 w-3 rounded-full bg-teal-400" /><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{event.event_type}</div><div className="text-xs text-slate-500">{formatDate(event.created_at)}</div></div><p className="mt-2 text-sm leading-7 text-slate-300">{event.event_note || 'تم تنفيذ الإجراء بدون ملاحظة إضافية'}</p><div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><span>بواسطة: {event.actor_name || 'النظام'}</span>{event.old_status && <span>{event.old_status} ← {event.new_status || '-'}</span>}</div></div>)}</div>}</div></div></div>;
}
