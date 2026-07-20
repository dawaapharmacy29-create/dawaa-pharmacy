import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  PhoneOff,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { fetchCustomerServiceFollowupPage } from '@/lib/api/customerServiceFollowupPagination';
import { isValidEgyptianMobile, normalizeEgyptianPhone } from '@/lib/customerFollowupCore';
import { readFollowupResult } from '@/lib/customerServiceFollowupStatus';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';

type FollowupRow = Record<string, unknown> & {
  id: string;
  customer_name?: string | null;
  name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
  branch?: string | null;
  priority?: string | null;
  needs_manager?: boolean | null;
  next_followup_date?: string | null;
  created_at?: string | null;
  contact_status?: string | null;
};

type ActionKind = 'postpone' | 'cancel' | 'archive';

type ActionForm = {
  kind: ActionKind;
  nextDate: string;
  reason: string;
  notes: string;
};

const EMPTY_ACTION: ActionForm = {
  kind: 'postpone',
  nextDate: '',
  reason: '',
  notes: '',
};

function customerName(row: FollowupRow) {
  return String(row.customer_name || row.name || 'عميل غير مسجل');
}

function customerPhone(row: FollowupRow) {
  return normalizeEgyptianPhone(String(row.customer_phone || row.phone || ''));
}

function statusBadges(row: FollowupRow) {
  const badges: Array<{ label: string; tone: string }> = [];
  const result = readFollowupResult(row);
  const phone = customerPhone(row);
  if (row.needs_manager || result === 'يحتاج متابعة مدير') {
    badges.push({ label: 'يحتاج مدير', tone: 'border-red-400/30 bg-red-500/15 text-red-200' });
  }
  if (result === 'مؤجل' || row.next_followup_date) {
    badges.push({ label: 'موعد قادم', tone: 'border-cyan-400/30 bg-cyan-500/15 text-cyan-200' });
  }
  if (!isValidEgyptianMobile(phone) || row.contact_status === 'invalid_phone') {
    badges.push({ label: 'رقم يحتاج مراجعة', tone: 'border-amber-400/30 bg-amber-500/15 text-amber-200' });
  }
  if (/عاجل|urgent|high/i.test(String(row.priority || ''))) {
    badges.push({ label: 'أولوية عالية', tone: 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200' });
  }
  if (!badges.length) {
    badges.push({ label: 'مفتوحة الآن', tone: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' });
  }
  return badges;
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export default function CustomerFollowupStructuredActionsPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '') || 'فرع الشامي';
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [action, setAction] = useState<ActionForm>(EMPTY_ACTION);
  const [saving, setSaving] = useState(false);

  const actorStaffId = String(user?.staffId || user?.id || '');
  const actorName = String(user?.name || 'مستخدم خدمة العملاء');

  async function loadOpenFollowups() {
    setLoading(true);
    try {
      const result = await fetchCustomerServiceFollowupPage<FollowupRow>({
        branch: branch === ALL_BRANCHES ? null : branch,
        completed: false,
        includeHidden: false,
        search,
        page: 0,
        pageSize: 100,
      });
      setRows(result.rows);
    } catch (error) {
      toast.error(`تعذر تحميل المتابعات المفتوحة: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOpenFollowups(), search ? 350 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, search]);

  const visibleRows = useMemo(() => rows.slice(0, 100), [rows]);

  function openAction(row: FollowupRow, kind: ActionKind) {
    setSelected(row);
    setAction({ ...EMPTY_ACTION, kind, nextDate: kind === 'postpone' ? todayKey() : '' });
  }

  async function saveAction() {
    if (!selected) return;
    if (action.kind === 'postpone' && (!action.nextDate || action.nextDate < todayKey())) {
      toast.error('حدد موعدًا صحيحًا اليوم أو بعده');
      return;
    }
    if (action.kind !== 'postpone' && !action.reason.trim()) {
      toast.error('اكتب سببًا واضحًا قبل الحفظ');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        updated_by: actorStaffId || null,
        updated_at: now,
      };
      let eventType = 'scheduled';
      let eventStatus = 'مؤجل';

      if (action.kind === 'postpone') {
        payload.postponed_until = `${action.nextDate}T10:00:00`;
        payload.next_followup_date = action.nextDate;
        payload.needs_next_followup = true;
        payload.status = 'مؤجل';
        payload.followup_status = 'مؤجل';
        if (action.notes.trim()) payload.followup_notes = action.notes.trim();
      } else if (action.kind === 'cancel') {
        eventType = 'cancelled';
        eventStatus = 'ملغي';
        payload.cancelled_at = now;
        payload.cancelled_by = actorStaffId || null;
        payload.cancelled_reason = action.reason.trim();
        payload.completed_at = now;
        payload.status = 'ملغي';
        payload.followup_status = 'ملغي';
        payload.followup_result = 'تم إلغاء المتابعة';
        payload.contact_result = 'تم إلغاء المتابعة';
        payload.followup_notes = action.notes.trim() || action.reason.trim();
        payload.needs_next_followup = false;
        payload.next_followup_date = null;
      } else {
        eventType = 'archived';
        eventStatus = 'مؤرشف';
        payload.archived_at = now;
        payload.archive_reason = action.reason.trim();
        payload.is_hidden = true;
        payload.hidden_at = now;
        payload.hidden_by = actorStaffId || null;
        payload.hidden_reason = action.reason.trim();
        payload.status = 'archived';
        payload.followup_status = 'archived';
        if (action.notes.trim()) payload.followup_notes = action.notes.trim();
      }

      const { error: updateError } = await supabase
        .from('daily_followups')
        .update(payload)
        .eq('id', selected.id);
      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from('customer_service_followup_events').insert({
        followup_id: selected.id,
        event_type: eventType,
        event_status: eventStatus,
        actor_staff_id: actorStaffId || null,
        actor_name: actorName,
        notes: action.notes.trim() || action.reason.trim() || null,
        metadata: {
          action: action.kind,
          next_date: action.nextDate || null,
          reason: action.reason || null,
          source: 'structured_actions_panel',
        },
      });
      if (eventError) throw eventError;

      toast.success(
        action.kind === 'postpone'
          ? `تم تأجيل المتابعة إلى ${action.nextDate}`
          : action.kind === 'cancel'
            ? 'تم إلغاء المتابعة والاحتفاظ بها في السجل'
            : 'تمت أرشفة المتابعة'
      );
      setSelected(null);
      setAction(EMPTY_ACTION);
      await loadOpenFollowups();
    } catch (error) {
      toast.error(`تعذر حفظ الإجراء: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-4 mt-4 rounded-3xl border border-emerald-400/20 bg-[#0e253c] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-black text-white">
            <ShieldAlert size={22} className="text-emerald-300" />
            إجراءات المتابعات المفتوحة
          </div>
          <p className="mt-1 text-sm font-bold text-slate-400">
            القائمة تعرض المفتوح فقط افتراضيًا، مع إجراءات منظمة بدل نوافذ المتصفح البسيطة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? (
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option>{ALL_BRANCHES}</option>
              <option>فرع الشامي</option>
              <option>فرع شكري</option>
            </select>
          ) : (
            <div className="input-dark font-black text-emerald-100">{userBranch}</div>
          )}
          <div className="relative">
            <Search size={16} className="absolute right-3 top-3 text-slate-400" />
            <input
              className="input-dark pr-9"
              placeholder="اسم / كود / هاتف"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void loadOpenFollowups()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {visibleRows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-black text-white">{customerName(row)}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">
                  {String(row.customer_code || 'بدون كود')} · {customerPhone(row) || 'بدون هاتف'} · {String(row.branch || 'غير محدد')}
                </div>
              </div>
              <span className="rounded-full bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-400">{row.id.slice(0, 8)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {statusBadges(row).map((badge) => (
                <span key={badge.label} className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${badge.tone}`}>
                  {badge.label}
                </span>
              ))}
            </div>
            <div className="mt-3 text-xs font-bold text-slate-300">
              الحالة: {readFollowupResult(row)}
              {row.next_followup_date ? ` · الموعد: ${String(row.next_followup_date).slice(0, 10)}` : ''}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" className="btn-secondary flex items-center justify-center gap-1 text-xs" onClick={() => openAction(row, 'postpone')}>
                <CalendarClock size={14} /> تأجيل
              </button>
              <button type="button" className="btn-secondary flex items-center justify-center gap-1 text-xs" onClick={() => openAction(row, 'cancel')}>
                <Ban size={14} /> إلغاء
              </button>
              <button type="button" className="btn-secondary flex items-center justify-center gap-1 text-xs" onClick={() => openAction(row, 'archive')}>
                <Archive size={14} /> أرشفة
              </button>
            </div>
          </article>
        ))}
        {!loading && visibleRows.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-8 text-center font-black text-emerald-200">
            <CheckCircle2 size={28} className="mx-auto mb-2" />
            لا توجد متابعات مفتوحة مطابقة
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl rounded-3xl border border-white/15 bg-[#10243d] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xl font-black text-white">
                  {action.kind === 'postpone' ? 'تأجيل المتابعة' : action.kind === 'cancel' ? 'إلغاء المتابعة' : 'أرشفة المتابعة'}
                </div>
                <div className="mt-1 text-sm font-bold text-slate-400">{customerName(selected)}</div>
              </div>
              <button type="button" className="rounded-xl p-2 text-slate-300 hover:bg-white/10" onClick={() => setSelected(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {action.kind === 'postpone' ? (
                <label className="block text-sm font-black text-slate-200">
                  موعد المتابعة القادمة
                  <input
                    type="date"
                    min={todayKey()}
                    className="input-dark mt-2 w-full"
                    value={action.nextDate}
                    onChange={(event) => setAction((current) => ({ ...current, nextDate: event.target.value }))}
                  />
                </label>
              ) : (
                <label className="block text-sm font-black text-slate-200">
                  السبب
                  <textarea
                    className="input-dark mt-2 min-h-24 w-full"
                    value={action.reason}
                    onChange={(event) => setAction((current) => ({ ...current, reason: event.target.value }))}
                    placeholder={action.kind === 'cancel' ? 'سبب إلغاء المتابعة' : 'سبب الأرشفة'}
                  />
                </label>
              )}
              <label className="block text-sm font-black text-slate-200">
                ملاحظات إضافية
                <textarea
                  className="input-dark mt-2 min-h-24 w-full"
                  value={action.notes}
                  onChange={(event) => setAction((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="تفاصيل تساعد في فهم الإجراء لاحقًا"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>رجوع</button>
              <button type="button" className="btn-primary flex items-center gap-2" onClick={() => void saveAction()} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : action.kind === 'postpone' ? <Clock3 size={16} /> : action.kind === 'cancel' ? <PhoneOff size={16} /> : <Archive size={16} />}
                حفظ الإجراء
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
