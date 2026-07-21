import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Filter,
  Loader2,
  PhoneOff,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeEgyptianPhone, isValidEgyptianMobile } from '@/lib/customerFollowupCore';

const ALL_BRANCHES = 'كل الفروع';
const PAGE_SIZE = 50;

type QuickFilter =
  | 'now'
  | 'urgent'
  | 'waiting'
  | 'no_answer'
  | 'manager'
  | 'today'
  | 'overdue'
  | 'missing_data'
  | 'branch_review';

type Row = {
  id: string;
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
  next_followup_date: string | null;
  created_at: string | null;
  needs_manager: boolean | null;
  customer_metrics?: Record<string, unknown> | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const rowStatus = (row: Row) =>
  text(row.contact_status || row.followup_status || row.response_status || row.status || row.followup_result);
const customerName = (row: Row) => text(row.customer_name || row.name || 'عميل غير مسجل');
const customerPhone = (row: Row) => normalizeEgyptianPhone(text(row.customer_phone || row.phone));
const isWaiting = (row: Row) => /في انتظار الرد|تم إرسال رسالة|message_sent|waiting_reply/i.test(rowStatus(row));
const isNoAnswer = (row: Row) => /لم يرد|no_answer/i.test(rowStatus(row));
const isUrgent = (row: Row) => /عاجل|urgent|high|شكوى|تصعيد/i.test(`${row.priority || ''} ${rowStatus(row)}`);
const isBranchReview = (row: Row) => {
  const metrics = row.customer_metrics || {};
  const current = normalizeBranchName(row.branch || '');
  const evidence = [
    normalizeBranchName(metrics.branch_last_purchase || ''),
    normalizeBranchName(metrics.branch_most_frequent || ''),
    normalizeBranchName(metrics.branch || ''),
  ].filter(Boolean);
  return !current || evidence.some((value) => value !== current);
};
const dueKey = (row: Row) => text(row.next_followup_date).slice(0, 10);

export default function CustomerFollowupCompactQueuePanel({ onOpenFull }: { onOpenFull?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<QuickFilter>('now');
  const [search, setSearch] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [priority, setPriority] = useState('الكل');
  const [dataState, setDataState] = useState('الكل');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    try {
      let query = supabase
        .from('daily_followups')
        .select(
          'id,customer_name,name,customer_code,customer_phone,phone,branch,priority,status,followup_status,contact_status,response_status,followup_result,next_followup_date,created_at,needs_manager,customer_metrics'
        )
        .eq('is_hidden', false)
        .is('completed_at', null)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);
      const { data, error } = await query;
      if (error) throw error;
      const list = (data || []) as Row[];
      setRows(list.slice(0, PAGE_SIZE));
      setHasMore(list.length > PAGE_SIZE);
    } catch (error) {
      toast.error(`تعذر تحميل القائمة المختصرة: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [branch, managerView, page, userBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [branch, filter, priority, dataState, search]);

  const today = todayKey();
  const counts = useMemo(() => ({
    now: rows.length,
    urgent: rows.filter(isUrgent).length,
    waiting: rows.filter(isWaiting).length,
    no_answer: rows.filter(isNoAnswer).length,
    manager: rows.filter((row) => row.needs_manager).length,
    today: rows.filter((row) => dueKey(row) === today).length,
    overdue: rows.filter((row) => dueKey(row) && dueKey(row) < today).length,
    missing_data: rows.filter((row) => !text(row.customer_code) || !isValidEgyptianMobile(customerPhone(row))).length,
    branch_review: rows.filter(isBranchReview).length,
  }), [rows, today]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'urgent' && !isUrgent(row)) return false;
      if (filter === 'waiting' && !isWaiting(row)) return false;
      if (filter === 'no_answer' && !isNoAnswer(row)) return false;
      if (filter === 'manager' && !row.needs_manager) return false;
      if (filter === 'today' && dueKey(row) !== today) return false;
      if (filter === 'overdue' && (!dueKey(row) || dueKey(row) >= today)) return false;
      if (filter === 'missing_data' && text(row.customer_code) && isValidEgyptianMobile(customerPhone(row))) return false;
      if (filter === 'branch_review' && !isBranchReview(row)) return false;
      if (priority !== 'الكل' && text(row.priority) !== priority) return false;
      if (dataState === 'بدون كود' && text(row.customer_code)) return false;
      if (dataState === 'بدون هاتف' && isValidEgyptianMobile(customerPhone(row))) return false;
      if (dataState === 'بيانات سليمة' && (!text(row.customer_code) || !isValidEgyptianMobile(customerPhone(row)))) return false;
      if (!query) return true;
      return `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''} ${rowStatus(row)}`
        .toLowerCase()
        .includes(query);
    });
  }, [dataState, filter, priority, rows, search, today]);

  const cards: Array<[QuickFilter, string, number, typeof Sparkles]> = [
    ['now', 'المطلوب الآن', counts.now, Sparkles],
    ['urgent', 'عاجل', counts.urgent, AlertTriangle],
    ['waiting', 'انتظار رد', counts.waiting, Clock3],
    ['no_answer', 'لم يرد', counts.no_answer, PhoneOff],
    ['manager', 'يحتاج مديرًا', counts.manager, ShieldAlert],
    ['today', 'موعد اليوم', counts.today, CalendarClock],
    ['overdue', 'متأخر', counts.overdue, AlertTriangle],
    ['missing_data', 'بيانات ناقصة', counts.missing_data, UserRoundSearch],
    ['branch_review', 'فرع يحتاج مراجعة', counts.branch_review, Filter],
  ];

  function clearFilters() {
    setFilter('now');
    setSearch('');
    setPriority('الكل');
    setDataState('الكل');
  }

  if (!managerView && !userBranch) {
    return (
      <section className="mx-4 mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5 text-center font-black text-amber-100" dir="rtl">
        حساب خدمة العملاء غير مربوط بفرع.
      </section>
    );
  }

  return (
    <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white">
            <SlidersHorizontal className="text-cyan-300" /> القائمة المختصرة والفلاتر السريعة
          </h2>
          <p className="mt-1 text-sm font-bold text-slate-400">ابدأ بالحالات المهمة فقط، وافتح التفاصيل الكاملة عند الحاجة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? (
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option>{ALL_BRANCHES}</option>
              <option>فرع الشامي</option>
              <option>فرع شكري</option>
            </select>
          ) : (
            <div className="input-dark font-black text-cyan-100">{userBranch}</div>
          )}
          <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} تحديث
          </button>
          {onOpenFull ? <button className="btn-primary" onClick={onOpenFull}>فتح العرض الكامل</button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(([id, label, count, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-2xl border p-3 text-right transition ${filter === id ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
          >
            <Icon size={18} className="mb-2 text-cyan-300" />
            <div className="text-xs font-black text-slate-400">{label}</div>
            <div className="text-2xl font-black text-white">{count}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search size={17} className="absolute right-3 top-3 text-slate-400" />
          <input className="input-dark w-full pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف أو الحالة" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary flex items-center gap-2" onClick={() => setAdvancedOpen((value) => !value)}>
            <Filter size={16} /> فلاتر إضافية {advancedOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button className="btn-secondary flex items-center gap-2" onClick={clearFilters}><X size={15} /> مسح الفلاتر</button>
        </div>
      </div>

      {advancedOpen ? (
        <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-3 md:grid-cols-2">
          <select className="input-dark" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option>الكل</option><option>عاجل</option><option>مهم جدًا</option><option>مهم</option><option>عادي</option>
          </select>
          <select className="input-dark" value={dataState} onChange={(event) => setDataState(event.target.value)}>
            <option>الكل</option><option>بدون كود</option><option>بدون هاتف</option><option>بيانات سليمة</option>
          </select>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-black">
        <div className="text-cyan-200">المعروض الآن: {visibleRows.length} عميل</div>
        <div className="text-slate-400">الفلتر الحالي: {cards.find(([id]) => id === filter)?.[1] || 'المطلوب الآن'}</div>
      </div>

      <div className="space-y-2">
        {visibleRows.map((row) => {
          const status = rowStatus(row) || 'متابعة مفتوحة';
          return (
            <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="font-black text-white">{customerName(row)}</div>
                  <div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-cyan-200">{status}</span>
                    {row.needs_manager ? <span className="rounded-full bg-red-500/15 px-3 py-1 text-red-200">يحتاج مديرًا</span> : null}
                    {isUrgent(row) ? <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">أولوية عالية</span> : null}
                    {isBranchReview(row) ? <span className="rounded-full bg-fuchsia-500/15 px-3 py-1 text-fuchsia-200">راجع الفرع</span> : null}
                    {!text(row.customer_code) || !isValidEgyptianMobile(customerPhone(row)) ? <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">بيانات ناقصة</span> : null}
                  </div>
                </div>
                <div className="text-xs font-bold text-slate-400">الموعد: {dueKey(row) || 'غير محدد'}</div>
              </div>
            </article>
          );
        })}
        {!loading && visibleRows.length === 0 ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-8 text-center font-black text-emerald-200">
            <CheckCircle2 size={28} className="mx-auto mb-2" /> لا توجد حالات مطابقة للفلاتر الحالية
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>السابق</button>
        <span className="text-sm font-black text-slate-400">صفحة {page + 1}</span>
        <button className="btn-secondary" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>التالي</button>
      </div>
    </section>
  );
}
