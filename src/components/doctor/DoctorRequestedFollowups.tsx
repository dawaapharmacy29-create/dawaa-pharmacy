import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Headphones, Loader2, Phone, RefreshCw, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type Row = Record<string, unknown>;
type LoadState = 'idle' | 'loading' | 'success' | 'error';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeName(value: unknown) {
  return text(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '')
    .replace(/[\s/_.-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function formatDate(value: unknown) {
  const raw = text(value);
  if (!raw) return 'غير محدد';
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw.slice(0, 16)
    : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(value: unknown) {
  const raw = text(value).toLowerCase();
  const labels: Record<string, string> = {
    new: 'جديدة', pending: 'جديدة', assigned: 'تم استلامها', accepted: 'تم استلامها',
    in_progress: 'جارٍ التواصل', contacting: 'جارٍ التواصل', no_answer: 'لم يرد العميل',
    contacted: 'تم التواصل', completed: 'تم الحل', resolved: 'تم الحل',
    needs_followup: 'تحتاج متابعة أخرى', follow_up: 'تحتاج متابعة أخرى', closed: 'مغلقة',
  };
  return labels[raw] || text(value) || 'جديدة';
}

function value(row: Row, keys: string[]) {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== null && candidate !== undefined && text(candidate)) return text(candidate);
  }
  return '';
}

function isMine(row: Row, staffId: string, userId: string, doctorName: string) {
  const ids = [
    row.requested_by_staff_id,
    row.requester_staff_id,
    row.created_by_staff_id,
    row.doctor_id,
    row.staff_id,
    row.requested_by,
    row.created_by,
    row.user_id,
  ].map(text).filter(Boolean);
  if (staffId && ids.includes(staffId)) return true;
  if (userId && ids.includes(userId)) return true;
  const names = [row.requested_by_name, row.requester_name, row.doctor_name, row.staff_name, row.created_by_name]
    .map(normalizeName)
    .filter(Boolean);
  return Boolean(doctorName && names.includes(normalizeName(doctorName)));
}

export default function DoctorRequestedFollowups() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);

  const staffId = text(user?.staffId || user?.id);
  const userId = text(user?.id);
  const doctorName = text(user?.name);

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('daily_followups')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (loadError) throw new Error(loadError.message);
      const personal = ((data || []) as Row[]).filter((row) => isMine(row, staffId, userId, doctorName));
      setRows(personal);
      setState('success');
    } catch (loadError) {
      setRows([]);
      setState('error');
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل المتابعات المطلوبة.');
    }
  }, [doctorName, staffId, userId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((row) => {
    const status = statusLabel(row.status ?? row.followup_status);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    const haystack = [row.customer_name, row.customer_code, row.customer_phone, row.reason, row.notes]
      .map(text).join(' ').toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [rows, search, statusFilter]);

  const openCount = rows.filter((row) => !['تم الحل', 'مغلقة'].includes(statusLabel(row.status ?? row.followup_status))).length;
  const doneCount = rows.length - openCount;

  return (
    <section className="rounded-3xl border border-teal-400/20 bg-slate-900/80 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><Headphones className="text-teal-300" /><h2 className="text-2xl font-black text-white">متابعاتي المطلوبة</h2></div>
          <p className="mt-1 text-sm text-slate-400">كل متابعة طلبتها بنفسك، مع آخر ما وصلت إليه خدمة العملاء وتفاصيل التواصل.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={state === 'loading'} className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-400/30 px-4 py-2 font-black text-teal-100 disabled:opacity-50">
          <RefreshCw size={17} className={state === 'loading' ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-700 p-4"><div className="text-xs text-slate-400">إجمالي الطلبات</div><div className="mt-1 text-2xl font-black text-white">{rows.length}</div></div>
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4"><div className="text-xs text-amber-200">مفتوحة</div><div className="mt-1 text-2xl font-black text-amber-100">{openCount}</div></div>
        <div className="rounded-2xl border border-teal-400/20 bg-teal-500/5 p-4"><div className="text-xs text-teal-200">تم حلها أو إغلاقها</div><div className="mt-1 text-2xl font-black text-teal-100">{doneCount}</div></div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم العميل أو الكود أو الهاتف" className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-teal-400" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white">
          <option value="all">كل الحالات</option>
          {['جديدة','تم استلامها','جارٍ التواصل','لم يرد العميل','تم التواصل','تم الحل','تحتاج متابعة أخرى','مغلقة'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      {state === 'loading' ? <div className="mt-6 flex items-center gap-2 text-slate-300"><Loader2 className="animate-spin" /> جاري تحميل متابعاتك…</div> : null}
      {state === 'error' ? <div className="mt-6 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-red-100">{error}</div> : null}
      {state === 'success' && !filtered.length ? <div className="mt-6 rounded-2xl border border-slate-700 p-6 text-center text-slate-400">لا توجد متابعات مطابقة حتى الآن.</div> : null}

      <div className="mt-4 space-y-3">
        {filtered.map((row, index) => {
          const id = text(row.id) || `${text(row.created_at)}-${index}`;
          const status = statusLabel(row.status ?? row.followup_status);
          const customer = value(row, ['customer_name', 'name']) || 'عميل غير محدد';
          const result = value(row, ['result', 'followup_result', 'outcome', 'last_result', 'customer_response']);
          return (
            <button key={id} type="button" onClick={() => setSelected(row)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/40 p-4 text-right transition hover:border-teal-400/50">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-black text-white">{customer}</span><span className="rounded-full border border-teal-400/25 bg-teal-500/10 px-2 py-1 text-xs font-black text-teal-100">{status}</span></div>
                  <div className="mt-2 text-sm text-slate-300">كود: {value(row, ['customer_code']) || 'غير مسجل'} · هاتف: {value(row, ['customer_phone', 'phone']) || 'غير مسجل'}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300"><b className="text-slate-100">طلب المتابعة:</b> {value(row, ['reason', 'followup_reason', 'request_text', 'notes']) || 'لم يسجل سبب'}</div>
                  <div className="mt-1 text-sm leading-6 text-sky-200"><b>آخر نتيجة:</b> {result || 'لم تسجل نتيجة حتى الآن'}</div>
                </div>
                <div className="text-xs font-bold text-slate-400">{formatDate(row.updated_at ?? row.created_at)}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setSelected(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-teal-400/25 bg-slate-950 p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-2xl font-black text-white">تفاصيل متابعة {value(selected, ['customer_name', 'name']) || 'العميل'}</h3><p className="mt-1 text-sm text-slate-400">الحالة الحالية: {statusLabel(selected.status ?? selected.followup_status)}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 px-3 py-2 font-black text-slate-200">إغلاق</button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-700 p-4"><UserRound className="mb-2 text-teal-300" size={19}/><div className="text-xs text-slate-400">بيانات العميل</div><div className="mt-1 font-black text-white">{value(selected, ['customer_name', 'name']) || 'غير محدد'}</div><div className="mt-1 text-sm text-slate-300">الكود: {value(selected, ['customer_code']) || 'غير مسجل'}</div><div className="text-sm text-slate-300">الفرع: {value(selected, ['branch', 'customer_branch']) || 'غير محدد'}</div></div>
              <div className="rounded-2xl border border-slate-700 p-4"><Phone className="mb-2 text-teal-300" size={19}/><div className="text-xs text-slate-400">التواصل والمسؤول</div><div className="mt-1 text-sm text-slate-200">الهاتف: {value(selected, ['customer_phone', 'phone']) || 'غير مسجل'}</div><div className="text-sm text-slate-200">مسؤول خدمة العملاء: {value(selected, ['assigned_to_name', 'assigned_staff_name', 'handled_by_name', 'updated_by_name']) || 'لم يحدد بعد'}</div></div>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-slate-700 p-4"><div className="font-black text-white">طلب الدكتور الأصلي</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{value(selected, ['request_text', 'reason', 'followup_reason', 'notes']) || 'لا توجد تفاصيل إضافية'}</p></div>
              <div className="rounded-2xl border border-sky-400/20 bg-sky-500/5 p-4"><div className="flex items-center gap-2 font-black text-sky-100"><CheckCircle2 size={18}/> آخر ما وصلت إليه خدمة العملاء</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-sky-50">{value(selected, ['result', 'followup_result', 'outcome', 'last_result', 'customer_response', 'service_notes']) || 'لم تسجل نتيجة حتى الآن'}</p></div>
              <div className="rounded-2xl border border-slate-700 p-4"><div className="flex items-center gap-2 font-black text-white"><Clock3 size={18}/> سجل وملاحظات المتابعة</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{value(selected, ['timeline', 'history', 'activity_log', 'followup_history', 'team_notes', 'service_notes', 'notes']) || 'لا يوجد سجل نصي إضافي محفوظ في هذه المتابعة.'}</p></div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-700 p-3 text-sm text-slate-300"><CalendarClock className="mb-1 text-teal-300" size={17}/> تاريخ الطلب: {formatDate(selected.created_at ?? selected.followup_date)}</div><div className="rounded-xl border border-slate-700 p-3 text-sm text-slate-300"><CalendarClock className="mb-1 text-teal-300" size={17}/> المتابعة القادمة: {formatDate(selected.next_followup_at ?? selected.next_followup_date ?? selected.scheduled_at)}</div></div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
