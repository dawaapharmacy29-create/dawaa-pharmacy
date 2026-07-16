import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Headphones, Loader2, Phone, RefreshCw, Search, UserRound, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import { CustomerFlagChips } from '@/lib/customerDisplay';
import {
  fetchFollowupEvents,
  fetchMyRequestedFollowups,
  type DoctorFollowupEvent,
} from '@/lib/api/doctorRequestedFollowups';
import type { FollowupRow } from '@/lib/api/customerServiceCommandCenter';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function formatDate(value: unknown) {
  const raw = text(value);
  if (!raw) return 'غير محدد';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw.slice(0, 16) : date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(value: unknown) {
  const raw = text(value).toLowerCase();
  const labels: Record<string, string> = {
    new: 'جديدة', pending: 'جديدة', معلق: 'جديدة',
    assigned: 'تم استلامها', accepted: 'تم استلامها', 'تم الاستلام': 'تم استلامها',
    in_progress: 'جارٍ التواصل', contacting: 'جارٍ التواصل', 'جارى التواصل': 'جارٍ التواصل',
    no_answer: 'لم يرد العميل', 'لم يرد': 'لم يرد العميل',
    contacted: 'تم التواصل', 'تم التواصل': 'تم التواصل',
    completed: 'تم الحل', resolved: 'تم الحل', done: 'تم الحل', 'تم': 'تم الحل',
    needs_followup: 'تحتاج متابعة أخرى', follow_up: 'تحتاج متابعة أخرى', مؤجل: 'تحتاج متابعة أخرى',
    closed: 'مغلقة', مغلق: 'مغلقة', ملغى: 'مغلقة',
  };
  return labels[raw] || text(value) || 'جديدة';
}

function isClosed(row: FollowupRow) {
  return Boolean(row.closed_at || row.completed_at || row.cancelled_at) || ['تم الحل', 'مغلقة'].includes(statusLabel(row.followup_status || row.status || row.contact_status));
}

function contactAttempts(row: FollowupRow & Record<string, unknown>) {
  const direct = Number(row.contact_attempts || 0);
  return Number.isFinite(direct) ? direct : 0;
}

export default function DoctorRequestedFollowups() {
  const { user } = useAuth();
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [closure, setClosure] = useState<'all' | 'open' | 'closed'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [timeline, setTimeline] = useState<DoctorFollowupEvent[]>([]);
  const [timelineState, setTimelineState] = useState<LoadState>('idle');
  const [createOpen, setCreateOpen] = useState(false);

  const identity = useMemo(() => ({
    staffId: text(user?.staffId),
    userId: text(user?.id),
    doctorName: text(user?.name),
  }), [user?.id, user?.name, user?.staffId]);

  const load = useCallback(async () => {
    if (!identity.staffId && !identity.userId && !identity.doctorName) return;
    setState('loading');
    setError('');
    try {
      const data = await fetchMyRequestedFollowups(identity, { search, status: 'all', closure: 'all', from, to });
      setRows(data);
      setState('success');
    } catch (loadError) {
      setRows([]);
      setState('error');
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل متابعاتك المطلوبة.');
    }
  }, [from, identity, search, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChanged = (event: Event) => {
      const table = (event as CustomEvent<{ table?: string }>).detail?.table;
      if (!table || table === 'daily_followups') void load();
    };
    window.addEventListener('dataChanged', onChanged);
    return () => window.removeEventListener('dataChanged', onChanged);
  }, [load]);

  const filtered = useMemo(() => rows.filter((row) => {
    const label = statusLabel(row.followup_status || row.status || row.contact_status);
    if (status !== 'all' && label !== status) return false;
    if (closure === 'open' && isClosed(row)) return false;
    if (closure === 'closed' && !isClosed(row)) return false;
    return true;
  }), [closure, rows, status]);

  const openDetails = async (row: FollowupRow) => {
    setSelected(row);
    setTimeline([]);
    setTimelineState('loading');
    try {
      const events = await fetchFollowupEvents(String(row.id));
      setTimeline(events);
      setTimelineState('success');
    } catch (timelineError) {
      console.error('[doctor-followups] timeline failed', timelineError);
      setTimelineState('error');
    }
  };

  const openCount = rows.filter((row) => !isClosed(row)).length;

  return (
    <>
      <QuickFollowupModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />
      <section className="rounded-3xl border border-teal-400/20 bg-slate-900/80 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><Headphones className="text-teal-300" /><h2 className="text-2xl font-black text-white">متابعاتي المطلوبة</h2></div>
            <p className="mt-1 text-sm text-slate-400">تعرض فقط المتابعات التي أنشأتها بحسابك، ونتائج خدمة العملاء المسجلة عليها.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary">طلب متابعة جديدة</button>
            <button type="button" onClick={() => void load()} disabled={state === 'loading'} className="btn-secondary disabled:opacity-50"><RefreshCw className={`ml-1 inline h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} /> تحديث</button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-700 p-4"><div className="text-xs text-slate-400">إجمالي طلباتي</div><div className="mt-1 text-2xl font-black text-white">{rows.length}</div></div>
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4"><div className="text-xs text-amber-200">مفتوحة</div><div className="mt-1 text-2xl font-black text-amber-100">{openCount}</div></div>
          <div className="rounded-2xl border border-teal-400/20 bg-teal-500/5 p-4"><div className="text-xs text-teal-200">تم حلها أو إغلاقها</div><div className="mt-1 text-2xl font-black text-teal-100">{rows.length - openCount}</div></div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative xl:col-span-2"><Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-500" /><input className="input-dark pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم العميل أو الكود أو الهاتف" /></label>
          <select className="input-dark" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option>{['جديدة','تم استلامها','جارٍ التواصل','لم يرد العميل','تم التواصل','تم الحل','تحتاج متابعة أخرى','مغلقة'].map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select className="input-dark" value={closure} onChange={(event) => setClosure(event.target.value as 'all' | 'open' | 'closed')}><option value="all">مفتوحة ومغلقة</option><option value="open">المفتوحة فقط</option><option value="closed">المغلقة فقط</option></select>
          <div className="grid grid-cols-2 gap-2"><input className="input-dark" type="date" value={from} onChange={(event) => setFrom(event.target.value)} title="من تاريخ" /><input className="input-dark" type="date" value={to} onChange={(event) => setTo(event.target.value)} title="إلى تاريخ" /></div>
        </div>

        {state === 'loading' ? <div className="mt-6 flex items-center gap-2 text-slate-300"><Loader2 className="animate-spin" /> جاري تحميل متابعاتك…</div> : null}
        {state === 'error' ? <div className="mt-6 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-red-100">{error}</div> : null}
        {state === 'success' && !filtered.length ? <div className="mt-6 rounded-2xl border border-slate-700 p-8 text-center"><div className="font-black text-white">لا توجد متابعات مطابقة</div><div className="mt-1 text-sm text-slate-400">أنشئ متابعة جديدة أو عدّل الفلاتر الحالية.</div></div> : null}

        <div className="mt-4 space-y-3">
          {filtered.map((row) => {
            const label = statusLabel(row.followup_status || row.status || row.contact_status);
            const extended = row as FollowupRow & Record<string, unknown>;
            const result = text(extended.final_result || row.followup_result || row.contact_result || row.followup_summary);
            return (
              <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-white">{row.customer_name || row.name || 'عميل غير محدد'}</h3><span className="rounded-full border border-teal-400/25 bg-teal-500/10 px-2 py-1 text-xs font-black text-teal-100">{label}</span></div>
                    <div className="mt-2 text-sm text-slate-300">كود: {row.customer_code || 'غير مسجل'} · هاتف: {row.customer_phone || row.phone || 'غير مسجل'} · فرع: {row.branch || 'غير محدد'}</div>
                    <CustomerFlagChips row={row} className="mt-2" />
                    <div className="mt-3 text-sm leading-6 text-slate-300"><b className="text-white">الطلب الأصلي:</b> {row.request_details || row.followup_reason || row.notes || 'لم تسجل تفاصيل'}</div>
                    <div className="mt-1 text-sm leading-6 text-sky-200"><b>آخر نتيجة:</b> {result || 'لم تسجل نتيجة حتى الآن'}</div>
                    <div className="mt-1 text-xs text-slate-400">المسؤول: {row.responsible_name || row.assigned_to || row.assigned_doctor || 'لم يتم التعيين'} · المحاولات: {contactAttempts(extended)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2"><div className="text-xs font-bold text-slate-400">آخر تحديث: {formatDate(row.updated_at || row.created_at)}</div><button type="button" onClick={() => void openDetails(row)} className="btn-secondary">عرض التفاصيل</button></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={() => setSelected(null)}>
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-teal-400/25 bg-slate-950 p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-2xl font-black text-white">تفاصيل متابعة {selected.customer_name || selected.name || 'العميل'}</h3><p className="mt-1 text-sm text-slate-400">الحالة: {statusLabel(selected.followup_status || selected.status || selected.contact_status)}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 p-2 text-slate-200"><X /></button></div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Info icon={UserRound} label="العميل" value={`${selected.customer_name || selected.name || 'غير محدد'} — ${selected.customer_code || 'بدون كود'}`} />
              <Info icon={Phone} label="الهاتف والفرع" value={`${selected.customer_phone || selected.phone || 'غير مسجل'} — ${selected.branch || 'غير محدد'}`} />
              <Info icon={Headphones} label="مسؤول خدمة العملاء" value={selected.responsible_name || selected.assigned_to || selected.assigned_doctor || 'لم يحدد'} />
              <Info icon={CalendarClock} label="المتابعة القادمة" value={formatDate(selected.next_followup_date || selected.followup_datetime)} />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Detail title="طلب الدكتور الأصلي" value={selected.request_details || selected.followup_reason || selected.notes || 'لا توجد تفاصيل'} />
              <Detail title="ملاحظات خدمة العملاء" value={selected.service_notes || selected.followup_notes || selected.team_notes || 'لم تسجل ملاحظات'} />
              <Detail title="رد العميل" value={text((selected as FollowupRow & Record<string, unknown>).customer_response || selected.response_status || selected.contact_result) || 'لم يسجل رد'} />
              <Detail title="النتيجة النهائية" value={text((selected as FollowupRow & Record<string, unknown>).final_result || selected.followup_result || selected.followup_summary) || 'لم تغلق المتابعة بعد'} />
            </div>

            <section className="mt-5 rounded-2xl border border-slate-700 p-4">
              <div className="flex items-center gap-2"><Clock3 className="text-teal-300" /><h4 className="text-xl font-black text-white">السجل الزمني الحقيقي</h4></div>
              <p className="mt-1 text-xs text-slate-400">يعرض فقط الأحداث المحفوظة في daily_followup_events؛ لا يتم اختراع Timeline من الحالة الحالية.</p>
              {timelineState === 'loading' ? <div className="mt-4 flex items-center gap-2 text-slate-300"><Loader2 className="animate-spin" /> جاري تحميل السجل…</div> : null}
              {timelineState === 'error' ? <div className="mt-4 text-red-200">تعذر تحميل السجل الزمني.</div> : null}
              {timelineState === 'success' && !timeline.length ? <div className="mt-4 rounded-xl bg-slate-900 p-4 text-slate-400">لا يوجد سجل زمني محفوظ لهذه المتابعة حتى الآن.</div> : null}
              <div className="mt-4 space-y-3">{timeline.map((event) => <div key={event.id} className="relative border-r-2 border-teal-400/30 pr-4"><div className="font-black text-white">{event.title || event.event_type}</div><div className="mt-1 text-xs text-slate-400">{formatDate(event.created_at)} · {event.actor_name || event.responsible_name || 'النظام'}</div>{event.status ? <div className="mt-1 text-sm text-teal-200">الحالة: {statusLabel(event.status)}</div> : null}{event.notes ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{event.notes}</p> : null}{event.result ? <p className="mt-1 whitespace-pre-wrap text-sm text-sky-200">النتيجة: {event.result}</p> : null}{event.customer_response ? <p className="mt-1 text-sm text-amber-100">رد العميل: {event.customer_response}</p> : null}</div>)}</div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-700 p-4"><Icon className="mb-2 text-teal-300" size={18} /><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-sm font-black text-white">{value}</div></div>;
}

function Detail({ title, value }: { title: string; value: string }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4"><div className="flex items-center gap-2 font-black text-white"><CheckCircle2 size={17} className="text-teal-300" />{title}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{value}</p></div>;
}
