import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Loader2, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';

type WaitingFilter = 'waiting' | 'no_answer' | 'all';

type FollowupRow = {
  id: string;
  customer_name: string | null;
  name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  phone: string | null;
  branch: string | null;
  status: string | null;
  followup_status: string | null;
  contact_status: string | null;
  followup_result: string | null;
  next_followup_date: string | null;
  contacted_at: string | null;
  created_at: string | null;
  responsible_name: string | null;
};

const ALL_BRANCHES = 'كل الفروع';
const WAITING_STATUSES = ['في انتظار الرد', 'تم إرسال رسالة', 'message_sent', 'waiting_reply'];
const NO_ANSWER_STATUSES = ['لم يرد', 'no_answer'];

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function tomorrowKey() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

function rowStatus(row: FollowupRow) {
  return String(row.contact_status || row.followup_status || row.status || row.followup_result || '').trim();
}

function customerName(row: FollowupRow) {
  return String(row.customer_name || row.name || 'عميل غير مسجل').trim();
}

function customerPhone(row: FollowupRow) {
  return String(row.customer_phone || row.phone || '').trim();
}

export default function WaitingCustomerRepliesPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [filter, setFilter] = useState<WaitingFilter>('waiting');
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    try {
      let query = supabase
        .from('daily_followups')
        .select('id,customer_name,name,customer_code,customer_phone,phone,branch,status,followup_status,contact_status,followup_result,next_followup_date,contacted_at,created_at,responsible_name')
        .eq('is_hidden', false)
        .is('completed_at', null)
        .order('contacted_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as FollowupRow[]);
    } catch (error) {
      toast.error(`تعذر تحميل قائمة انتظار الرد: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [branch, managerView, userBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const waitingCount = rows.filter((row) => WAITING_STATUSES.includes(rowStatus(row))).length;
  const noAnswerCount = rows.filter((row) => NO_ANSWER_STATUSES.includes(rowStatus(row))).length;

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const status = rowStatus(row);
      if (filter === 'waiting' && !WAITING_STATUSES.includes(status)) return false;
      if (filter === 'no_answer' && !NO_ANSWER_STATUSES.includes(status)) return false;
      if (filter === 'all' && !WAITING_STATUSES.includes(status) && !NO_ANSWER_STATUSES.includes(status)) return false;
      if (!query) return true;
      return `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''}`
        .toLowerCase()
        .includes(query);
    });
  }, [filter, rows, search]);

  async function updateStatus(row: FollowupRow, action: 'waiting' | 'no_answer' | 'replied') {
    setUpdatingId(row.id);
    try {
      const now = new Date().toISOString();
      const tomorrow = tomorrowKey();
      const payload =
        action === 'waiting'
          ? {
              contact_status: 'في انتظار الرد',
              followup_status: 'في انتظار الرد',
              status: 'في انتظار الرد',
              contacted_at: now,
              next_followup_date: tomorrow,
              needs_next_followup: true,
              updated_by: user?.id || null,
            }
          : action === 'no_answer'
            ? {
                contact_status: 'لم يرد',
                followup_status: 'لم يرد',
                status: 'لم يرد',
                contacted_at: row.contacted_at || now,
                next_followup_date: tomorrow,
                needs_next_followup: true,
                updated_by: user?.id || null,
              }
            : {
                contact_status: 'تم الرد',
                followup_status: 'جارٍ التواصل',
                status: 'جارٍ التواصل',
                next_followup_date: localDateKey(),
                needs_next_followup: true,
                updated_by: user?.id || null,
              };
      const { error } = await supabase.from('daily_followups').update(payload).eq('id', row.id);
      if (error) throw error;
      await supabase.from('customer_followup_audit_log').insert({
        followup_id: row.id,
        customer_id: null,
        action: action === 'waiting' ? 'message_sent_waiting_reply' : action === 'no_answer' ? 'message_sent_no_answer' : 'customer_replied',
        actor_staff_id: user?.staffId || user?.id || null,
        actor_name: user?.name || null,
        branch: row.branch || branch,
        metadata: { next_followup_date: action === 'replied' ? localDateKey() : tomorrow },
      });
      toast.success(
        action === 'waiting'
          ? 'تم تسجيل إرسال الرسالة وترحيل المتابعة للغد'
          : action === 'no_answer'
            ? 'تم تسجيل عدم الرد وستظل المتابعة ظاهرة للغد'
            : 'تم تسجيل رد العميل وإعادته للمتابعة الحالية'
      );
      await load();
    } catch (error) {
      toast.error(`تعذر تحديث المتابعة: ${(error as Error).message}`);
    } finally {
      setUpdatingId('');
    }
  }

  if (!managerView && !userBranch) {
    return (
      <section className="mx-4 mt-4 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5 text-center font-black text-amber-100" dir="rtl">
        حساب خدمة العملاء غير مربوط بفرع. اربط الحساب بفرع الشامي أو فرع شكري أولًا.
      </section>
    );
  }

  return (
    <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white"><MessageCircle className="text-cyan-300" /> انتظار رد العملاء</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">كل عميل أُرسلت له رسالة يظل ظاهرًا حتى يرد أو يتم تسجيل عدم الرد، ويُرحّل تلقائيًا لليوم التالي.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? (
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option>{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option>
            </select>
          ) : <div className="input-dark font-black text-cyan-100">{userBranch}</div>}
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} تحديث
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => setFilter('waiting')} className={`rounded-2xl border p-4 text-right ${filter === 'waiting' ? 'border-cyan-300 bg-cyan-400/15' : 'border-white/10 bg-white/[0.03]'}`}>
          <Clock3 className="mb-2 text-cyan-300" /><div className="text-xs font-black text-slate-400">في انتظار الرد</div><div className="text-3xl font-black text-white">{waitingCount}</div>
        </button>
        <button type="button" onClick={() => setFilter('no_answer')} className={`rounded-2xl border p-4 text-right ${filter === 'no_answer' ? 'border-amber-300 bg-amber-400/15' : 'border-white/10 bg-white/[0.03]'}`}>
          <CalendarClock className="mb-2 text-amber-300" /><div className="text-xs font-black text-slate-400">أُرسلت الرسالة ولم يرد</div><div className="text-3xl font-black text-white">{noAnswerCount}</div>
        </button>
        <button type="button" onClick={() => setFilter('all')} className={`rounded-2xl border p-4 text-right ${filter === 'all' ? 'border-emerald-300 bg-emerald-400/15' : 'border-white/10 bg-white/[0.03]'}`}>
          <MessageCircle className="mb-2 text-emerald-300" /><div className="text-xs font-black text-slate-400">كل انتظار الرد</div><div className="text-3xl font-black text-white">{waitingCount + noAnswerCount}</div>
        </button>
      </div>

      <div className="relative"><Search size={17} className="absolute right-3 top-3 text-slate-400" /><input className="input-dark w-full pr-10" placeholder="بحث بالاسم أو الكود أو الهاتف" value={search} onChange={(event) => setSearch(event.target.value)} /></div>

      <div className="space-y-2">
        {visibleRows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="font-black text-white">{customerName(row)}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</div>
                <div className="mt-2 inline-flex rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-200">{rowStatus(row) || 'متابعة مفتوحة'}</div>
                <div className="mt-1 text-xs text-slate-500">الموعد القادم: {row.next_followup_date ? String(row.next_followup_date).slice(0, 10) : 'غير محدد'}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={updatingId === row.id} onClick={() => void updateStatus(row, 'waiting')}>تم إرسال رسالة</button>
                <button type="button" className="btn-secondary" disabled={updatingId === row.id} onClick={() => void updateStatus(row, 'no_answer')}>لم يرد</button>
                <button type="button" className="btn-primary flex items-center gap-1" disabled={updatingId === row.id} onClick={() => void updateStatus(row, 'replied')}><CheckCircle2 size={16} /> رد العميل</button>
              </div>
            </div>
          </article>
        ))}
        {!loading && visibleRows.length === 0 ? <div className="rounded-2xl border border-white/10 p-8 text-center font-bold text-slate-400">لا توجد متابعات مطابقة حاليًا</div> : null}
      </div>
    </section>
  );
}
