import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, History, Loader2, MessageCircle, PackageCheck, Pencil, Phone, ShoppingCart, Truck, UsersRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { displayEgyptianPhone, generateWhatsAppLink } from '@/lib/whatsapp';
import {
  getCustomerRequestEvents,
  type CustomerRequest,
  type CustomerRequestEvent,
} from '@/lib/api/customerRequests';
import {
  cancelCustomerRequest,
  contactCustomerForRequest,
  executeCustomerRequestPrimaryAction,
  recordCustomerRequestSourcing,
  reopenCustomerRequestSearch,
  sendCustomerRequestToShortages,
  updateCustomerRequestDetailsV2,
} from '../commands';
import { getCustomerRequestIncentiveEvents, type CustomerRequestIncentiveEventRow } from '../data';
import { customerRequestOperationalView } from '../domain/request';
import { customerRequestIsClosedStatus, customerRequestPrimaryAction, customerRequestStatusLabel, normalizeCustomerRequestStatus } from '../domain/status';

const STAGE_RAIL = [
  { label: 'تسجيل', statuses: ['new'] },
  { label: 'مراجعة', statuses: ['purchasing_review'] },
  { label: 'بحث وتوفير', statuses: ['searching_suppliers', 'needs_customer_confirmation', 'customer_confirmed', 'sourcing'] },
  { label: 'جاهز', statuses: ['available', 'arrived'] },
  { label: 'تواصل', statuses: ['customer_contacted'] },
  { label: 'تسليم', statuses: ['delivered', 'closed'] },
] as const;

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function eventLabel(event: CustomerRequestIncentiveEventRow) {
  return event.event_key === 'request_registered' ? 'نقاط تسجيل الطلب' : 'نقاط تحقيق الطلب';
}

function stageIndex(status?: string | null) {
  const normalized = normalizeCustomerRequestStatus(status);
  return STAGE_RAIL.findIndex((stage) => (stage.statuses as readonly string[]).includes(normalized));
}

export default function CustomerRequestDetailsDrawer({
  request,
  onClose,
  onUpdated,
}: {
  request: CustomerRequest;
  onClose: () => void;
  onUpdated: (request: CustomerRequest) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [events, setEvents] = useState<CustomerRequestEvent[]>([]);
  const [pointsEvents, setPointsEvents] = useState<CustomerRequestIncentiveEventRow[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [followupAt, setFollowupAt] = useState('');
  const [sourcingExpectedArrival, setSourcingExpectedArrival] = useState('');
  const [sourcingOutcome, setSourcingOutcome] = useState<'available' | 'needs_customer_confirmation' | 'not_available'>('available');
  const [editing, setEditing] = useState(false);
  const [editQuantity, setEditQuantity] = useState(Number(request.quantity || 1));
  const [editUrgency, setEditUrgency] = useState(String(request.urgency || 'normal'));
  const [editRequestType, setEditRequestType] = useState(String(request.request_type || 'missing_medicine'));
  const [editChannel, setEditChannel] = useState(String(request.source_request_channel || 'داخل الصيدلية'));
  const [editPhone, setEditPhone] = useState(String(request.customer_phone || ''));
  const [editDoctorNotes, setEditDoctorNotes] = useState(String(request.doctor_notes || ''));

  const view = useMemo(() => customerRequestOperationalView(request), [request]);
  const primary = customerRequestPrimaryAction(request.status);
  const currentStageIndex = stageIndex(request.status);
  const actor = { id: user?.id || null, name: user?.name || null };

  useEffect(() => {
    setEditing(false);
    setEditQuantity(Number(request.quantity || 1));
    setEditUrgency(String(request.urgency || 'normal'));
    setEditRequestType(String(request.request_type || 'missing_medicine'));
    setEditChannel(String(request.source_request_channel || 'داخل الصيدلية'));
    setEditPhone(String(request.customer_phone || ''));
    setEditDoctorNotes(String(request.doctor_notes || ''));
  }, [request.id]);

  const reloadDetails = async () => {
    setLoadingDetails(true);
    try {
      const [history, points] = await Promise.all([
        getCustomerRequestEvents(request.id),
        getCustomerRequestIncentiveEvents(request.id).catch(() => []),
      ]);
      setEvents(history);
      setPointsEvents(points);
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => { void reloadDetails(); }, [request.id]);

  const run = async (task: () => Promise<CustomerRequest>, success: string) => {
    setSaving(true);
    try {
      const updated = await task();
      await onUpdated(updated);
      setNotes('');
      toast.success(success);
      await reloadDetails();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const primaryAction = async () => {
    if (primary.action === 'record_sourcing' || primary.action === 'contact_customer' || primary.action === 'review_exception') return;
    await run(() => executeCustomerRequestPrimaryAction(request, { actor, notes }), primary.label);
  };

  const saveDetails = async () => {
    await run(
      () => updateCustomerRequestDetailsV2(request, {
        quantity: editQuantity,
        urgency: editUrgency,
        requestType: editRequestType,
        channel: editChannel,
        customerPhone: editPhone,
        doctorNotes: editDoctorNotes,
      }),
      'تم تحديث بيانات الطلب'
    );
    setEditing(false);
  };

  const openWhatsApp = () => {
    if (!request.customer_phone) return toast.error('لا يوجد رقم هاتف للعميل');
    window.open(
      generateWhatsAppLink(request.customer_phone, `أهلاً ${request.customer_name || 'حضرتك'}، مع حضرتك صيدليات دواء بخصوص طلب ${request.medicine_name}.`),
      '_blank',
      'noopener,noreferrer'
    );
  };

  const copyPhone = async () => {
    const phone = displayEgyptianPhone(request.customer_phone || '') || request.customer_phone || '';
    if (!phone) return toast.error('لا يوجد رقم هاتف للعميل');
    try {
      await navigator.clipboard.writeText(phone);
      toast.success('تم نسخ رقم العميل');
    } catch {
      toast.error('تعذر نسخ رقم العميل تلقائيًا');
    }
  };

  const totalPoints = pointsEvents.reduce((sum, event) => sum + Number(event.points || 0), 0);

  return (
    <div className="fixed inset-0 z-[140] flex justify-end bg-black/30 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-r border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] shadow-2xl" dir="rtl">
        <header className="sticky top-0 z-20 border-b border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]/95 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[var(--dawaa-theme-accent-soft)] px-2.5 py-1 text-[10px] font-black text-[var(--dawaa-theme-primary)]">{customerRequestStatusLabel(request.status)}</span>{view.overdue ? <span className="rounded-full bg-[var(--dawaa-status-danger-bg)] px-2.5 py-1 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">متأخر</span> : null}</div>
              <h2 className="mt-2 truncate text-xl font-black text-[var(--dawaa-theme-heading)]">{view.product.name}</h2>
              <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">كود الصنف: {view.product.code || 'غير مربوط'} · الكمية {request.quantity || 1}</div>
            </div>
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-[var(--dawaa-theme-muted)]"><X size={18} /></button>
          </div>
        </header>

        <div className="space-y-4 p-4 md:p-5">
          <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {STAGE_RAIL.map((stage, index) => {
                const active = currentStageIndex === index;
                const done = currentStageIndex > index || ['delivered', 'closed'].includes(normalizeCustomerRequestStatus(request.status));
                return <div key={stage.label} className={`rounded-xl border px-2 py-2 text-center text-[10px] font-black ${active ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]' : done ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}>{done && !active ? '✓ ' : ''}{stage.label}</div>;
              })}
            </div>
            {normalizeCustomerRequestStatus(request.status) === 'not_available' ? <div className="mt-2 rounded-lg bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">غير متوفر حاليًا — يمكن إعادة فتح البحث عن بديل بسبب موثق أو إلغاء الطلب.</div> : null}
          </section>

          <section className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)]/40 p-4">
            <div className="text-[11px] font-black text-[var(--dawaa-theme-muted)]">المطلوب الآن</div>
            <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-primary)]">{primary.label}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
              <div className="rounded-xl bg-[var(--dawaa-theme-surface)] p-3"><span className="text-[var(--dawaa-theme-muted)]">المسجل</span><strong className="mt-1 block">{view.registrar.name || 'غير مربوط'}</strong></div>
              <div className="rounded-xl bg-[var(--dawaa-theme-surface)] p-3"><span className="text-[var(--dawaa-theme-muted)]">المسئول الحالي</span><strong className="mt-1 block">{view.owner || 'غير مسند'}</strong></div>
              <div className="rounded-xl bg-[var(--dawaa-theme-surface)] p-3"><span className="text-[var(--dawaa-theme-muted)]">عمر الطلب</span><strong className="mt-1 block">{Math.max(0, Math.floor(view.ageHours))} ساعة</strong></div>
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
              <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><UsersRound size={17} className="text-[var(--dawaa-theme-primary)]" /> العميل</div>
              <div className="mt-3 space-y-2 text-sm"><div><span className="text-[var(--dawaa-theme-muted)]">الاسم: </span><strong>{view.customer.name || 'غير مربوط'}</strong></div><div><span className="text-[var(--dawaa-theme-muted)]">الكود: </span><strong>{view.customer.code || '—'}</strong></div><div><span className="text-[var(--dawaa-theme-muted)]">الهاتف: </span><strong>{displayEgyptianPhone(request.customer_phone || '') || '—'}</strong></div><div><span className="text-[var(--dawaa-theme-muted)]">الفرع: </span><strong>{request.branch || '—'}</strong></div></div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={openWhatsApp} className="btn-secondary flex items-center gap-2 text-xs"><MessageCircle size={14} /> واتساب</button>{request.customer_phone ? <a href={`tel:${request.customer_phone}`} className="btn-secondary flex items-center gap-2 text-xs"><Phone size={14} /> اتصال</a> : null}{request.customer_phone ? <button type="button" onClick={() => void copyPhone()} className="btn-secondary flex items-center gap-2 text-xs"><Copy size={14} /> نسخ الرقم</button> : null}{request.customer_id ? <Link to={`/customers/${request.customer_id}`} className="btn-secondary text-xs">ملف العميل</Link> : null}</div>
            </div>
            <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
              <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><PackageCheck size={17} className="text-[var(--dawaa-status-success-text)]" /> الطلب والتوفير</div>
              <div className="mt-3 space-y-2 text-sm"><div><span className="text-[var(--dawaa-theme-muted)]">الأولوية: </span><strong>{request.urgency || request.priority || 'normal'}</strong></div><div><span className="text-[var(--dawaa-theme-muted)]">مطلوب قبل: </span><strong>{request.needed_by_date || '—'}</strong></div><div><span className="text-[var(--dawaa-theme-muted)]">مصدر التوفير: </span><strong>{request.supplier_hint || request.potential_source_text || '—'}</strong></div><div><span className="text-[var(--dawaa-theme-muted)]">موعد الوصول: </span><strong>{request.expected_arrival_date || '—'}</strong></div></div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setEditing((value) => !value)} disabled={saving} className="btn-secondary flex items-center gap-2 text-xs"><Pencil size={14} /> تعديل التفاصيل</button><button type="button" disabled={saving || Boolean(request.shortage_item_id)} onClick={() => void run(async () => (await sendCustomerRequestToShortages(request, actor)).request, 'تم ربط الطلب بالنواقص')} className="btn-secondary flex items-center gap-2 text-xs"><ShoppingCart size={14} /> {request.shortage_item_id ? 'مربوط بالنواقص' : 'إرسال للنواقص'}</button></div>
            </div>
          </section>

          {editing ? <section className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface-2)] p-4"><div className="font-black text-[var(--dawaa-theme-heading)]">تعديل تفاصيل التنفيذ</div><p className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">هوية العميل والصنف والكود لا تتغير من هنا حتى لا ينفصل الطلب عن البيانات المعيارية.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الكمية<input type="number" min={1} className="input-dark mt-1" value={editQuantity} onChange={(event) => setEditQuantity(Number(event.target.value || 1))} /></label><label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الأولوية<select className="input-dark mt-1" value={editUrgency} onChange={(event) => setEditUrgency(event.target.value)}><option value="normal">عادي</option><option value="high">مهم</option><option value="urgent">عاجل</option></select></label><label className="text-xs font-black text-[var(--dawaa-theme-muted)]">التصنيف<select className="input-dark mt-1" value={editRequestType} onChange={(event) => setEditRequestType(event.target.value)}><option value="missing_medicine">صنف ناقص</option><option value="normal_request">طلب عادي</option><option value="urgent_request">طلب عاجل</option><option value="inquiry">استفسار</option></select></label><label className="text-xs font-black text-[var(--dawaa-theme-muted)]">قناة الطلب<select className="input-dark mt-1" value={editChannel} onChange={(event) => setEditChannel(event.target.value)}><option value="داخل الصيدلية">داخل الصيدلية</option><option value="واتساب">واتساب</option><option value="مكالمة هاتفية">مكالمة هاتفية</option></select></label><label className="text-xs font-black text-[var(--dawaa-theme-muted)]">هاتف التواصل<input className="input-dark mt-1" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} /></label><label className="text-xs font-black text-[var(--dawaa-theme-muted)]">ملاحظات الدكتور<input className="input-dark mt-1" value={editDoctorNotes} onChange={(event) => setEditDoctorNotes(event.target.value)} /></label></div><div className="mt-3 flex gap-2"><button type="button" disabled={saving} onClick={() => void saveDetails()} className="btn-primary">حفظ التعديلات</button><button type="button" disabled={saving} onClick={() => setEditing(false)} className="btn-secondary">إلغاء التعديل</button></div></section> : null}

          {view.identityIssues.length ? <section className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4"><div className="flex items-center gap-2 font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={16} /> بيانات تمنع الاعتماد الكامل</div><div className="mt-2 text-xs font-bold leading-6">{view.identityIssues.join(' · ')}</div></section> : null}

          {!customerRequestIsClosedStatus(request.status) ? <section className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
            <div className="font-black text-[var(--dawaa-theme-heading)]">تنفيذ المرحلة الحالية</div>
            <textarea className="input-dark mt-3 min-h-20" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="نتيجة البحث أو التواصل أو ملاحظة التنفيذ..." />

            {(primary.action === 'start_search' || primary.action === 'confirm_customer' || primary.action === 'confirm_delivery') ? <button type="button" disabled={saving} onClick={() => void primaryAction()} className="btn-primary mt-3 flex w-full items-center justify-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{primary.label}</button> : null}

            {primary.action === 'record_sourcing' ? <div className="mt-3 grid gap-2"><select className="input-dark" value={sourcingOutcome} onChange={(event) => setSourcingOutcome(event.target.value as typeof sourcingOutcome)}><option value="available">تم التوفير</option><option value="needs_customer_confirmation">يحتاج تأكيد العميل</option><option value="not_available">غير متوفر</option></select>{sourcingOutcome === 'available' ? <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">موعد الوصول المتوقع للصيدلية<input type="date" className="input-dark mt-1" value={sourcingExpectedArrival} onChange={(event) => setSourcingExpectedArrival(event.target.value)} /></label> : null}<button type="button" disabled={saving || !notes.trim()} onClick={() => void run(() => recordCustomerRequestSourcing(request, { outcome: sourcingOutcome, notes, expectedArrivalDate: sourcingOutcome === 'available' ? sourcingExpectedArrival || null : null, actor }), sourcingOutcome === 'available' ? 'تم تسجيل توفير الصنف' : 'تم تسجيل نتيجة البحث')} className="btn-primary flex items-center justify-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}حفظ نتيجة التوفير</button></div> : null}

            {primary.action === 'contact_customer' ? <div className="mt-3 space-y-2"><div className="grid grid-cols-3 gap-2"><button type="button" disabled={saving} onClick={() => void run(() => contactCustomerForRequest(request, { outcome: 'answered', notes, actor }), 'تم تسجيل تواصل العميل')} className="btn-primary">تم الرد</button><button type="button" disabled={saving} onClick={() => void run(() => contactCustomerForRequest(request, { outcome: 'no_answer', notes, actor }), 'تم تسجيل عدم الرد')} className="btn-secondary">لم يرد</button><button type="button" disabled={saving || !followupAt} onClick={() => void run(() => contactCustomerForRequest(request, { outcome: 'later', notes, followupAt: new Date(followupAt).toISOString(), actor }), 'تم تحديد المتابعة القادمة')} className="btn-secondary">لاحقًا</button></div><label className="block text-xs font-black text-[var(--dawaa-theme-muted)]">موعد المتابعة القادمة<input type="datetime-local" className="input-dark mt-1" value={followupAt} onChange={(event) => setFollowupAt(event.target.value)} /></label></div> : null}

            {primary.action === 'review_exception' ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" disabled={saving || !notes.trim()} onClick={() => void run(() => reopenCustomerRequestSearch(request, notes, actor), 'تم إعادة فتح البحث عن الصنف أو البديل')} className="btn-primary flex items-center justify-center gap-2"><Truck size={15} /> إعادة البحث / بديل</button><button type="button" disabled={saving || !notes.trim()} onClick={() => void run(() => cancelCustomerRequest(request, notes, actor), 'تم إلغاء الطلب بالسبب المسجل')} className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-4 py-3 text-sm font-black text-[var(--dawaa-status-danger-text)]">إلغاء الطلب بسبب موثق</button></div> : null}

            {primary.action !== 'review_exception' ? <button type="button" disabled={saving || !notes.trim()} onClick={() => void run(() => cancelCustomerRequest(request, notes, actor), 'تم إلغاء الطلب بالسبب المسجل')} className="mt-3 w-full rounded-xl border border-[var(--dawaa-status-danger-border)] bg-transparent px-4 py-2.5 text-xs font-black text-[var(--dawaa-status-danger-text)]">إلغاء الطلب بسبب الملاحظة المكتوبة</button> : null}
          </section> : null}

          <section className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><CheckCircle2 size={17} className="text-[var(--dawaa-status-success-text)]" /> نقاط طلب العميل</div><strong className="text-lg text-[var(--dawaa-theme-primary)]">{totalPoints.toLocaleString('ar-EG')} نقطة</strong></div>
            {pointsEvents.length ? <div className="mt-3 space-y-2">{pointsEvents.map((event) => <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3 text-xs"><div><strong>{eventLabel(event)}</strong><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">{formatDateTime(event.event_at)} · {event.policy_version}</div></div><span className="font-black text-[var(--dawaa-status-success-text)]">+{event.points}</span></div>)}</div> : <div className="mt-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد نقاط معتمدة على هذا الطلب حتى الآن. إذا كانت الهوية ناقصة ستظل النقاط غير مسوّاة حتى يتم إصلاح الربط.</div>}
          </section>

          <section className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><History size={17} /> سجل التنفيذ</div>{loadingDetails ? <Loader2 size={15} className="animate-spin text-[var(--dawaa-theme-muted)]" /> : null}</div>
            <div className="mt-3 space-y-2">{events.length ? events.map((event) => <div key={event.id} className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3 text-xs"><div className="flex items-center justify-between gap-2"><strong>{event.action || 'تحديث'}</strong><span className="text-[10px] text-[var(--dawaa-theme-muted)]">{formatDateTime(event.created_at)}</span></div><div className="mt-1 leading-5 text-[var(--dawaa-theme-text)]">{event.notes || 'بدون ملاحظات'}</div><div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">{event.created_by_name || 'النظام'}</div></div>) : <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد أحداث مسجلة بعد.</div>}</div>
          </section>
        </div>
      </aside>
    </div>
  );
}