import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Edit3, Eye, PhoneCall, PhoneMissed, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { formatFollowupDetailText } from '@/lib/followupFormat';
import { Drawer, DrawerFieldGrid, SectionSkeleton } from '@/components/customerService/SectionBoundary';

const PAGE_SIZE = 25;
type ViewMode = 'exceptional' | 'waiting' | 'no_answer' | 'completed' | 'performance';
type Row = Record<string, any>;
type EditState = { result: string; notes: string; nextDate: string; needsNext: boolean };

const text = (value: unknown) => String(value ?? '').trim();
const dateKey = (value: unknown) => text(value).slice(0, 10);
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const combinedStatus = (row: Row) => text(`${row.followup_status || ''} ${row.status || ''} ${row.contact_status || ''} ${row.response_status || ''} ${row.followup_result || ''} ${row.contact_result || ''}`).toLowerCase();
const cancelled = (row: Row) => /cancel|cancelled|archived|ملغي|ملغاة|مؤرشف|الأرشيف/.test(combinedStatus(row));
const hasNextFollowup = (row: Row) => row.needs_next_followup === true && Boolean(dateKey(row.next_followup_date));
const completed = (row: Row) => !cancelled(row) && !hasNextFollowup(row) && (
  Boolean(row.completed_at || row.closed_at) ||
  /completed|closed|resolved|مكتمل|تم الشراء|تم الحل|العميل راضي|تم التنفيذ|تم الرد|رد العميل|replied|customer_replied/.test(combinedStatus(row))
);
const waiting = (row: Row) => !completed(row) && !cancelled(row) && /waiting|awaiting|sent|message_sent|انتظار الرد|في انتظار|تم الإرسال|تم ارسال|بعتنا|أرسلنا/.test(combinedStatus(row));
const noAnswer = (row: Row) => !completed(row) && !cancelled(row) && /no.?answer|unreachable|لم يرد|لا يرد|مغلق|غير متاح/.test(combinedStatus(row));
const exceptional = (row: Row) => /exceptional_followup|متابعة استثنائية/i.test(`${row.request_type || ''} ${row.source || ''} ${row.followup_reason || ''} ${row.notes || ''}`);
// السجلات التاريخية المستوردة من الإكسل ليها شاشة مخصصة أوضح («سجل المتابعات»)
// فبنستبعدها هنا عشان محدش يشوفها متكررة في «المكتمل».
const isHistoricalImport = (row: Row) => row.import_source === 'historical_excel_import';
const actor = (row: Row) => text(row.assigned_doctor || row.responsible_name || row.completed_by_name || row.updated_by_name || 'غير محدد');
const actorId = (row: Row) => text(row.assigned_staff_id || row.responsible_staff_id || row.completed_by_staff_id || row.updated_by_staff_id || row.staff_id);
const normalizePersonName = (value: unknown) => text(value).replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/^\s*(دكتور|دكتوره|د\.?|dr\.?)[\s/.-]*/i, '').replace(/[\s/_.-]+/g, ' ').trim().toLowerCase();
const displayPersonName = (value: unknown) => { const clean = text(value).replace(/^\s*(دكتور|دكتوره|د\.?|dr\.?)[\s/.-]*/i, '').replace(/\s+/g, ' ').trim(); return clean ? `د/ ${clean}` : 'غير محدد'; };
const requester = (row: Row) => text(row.requested_by_name || row.created_by_name || 'غير محدد');
const customer = (row: Row) => text(row.customer_name || row.name || 'عميل غير مسجل');
const phone = (row: Row) => text(row.customer_phone || row.phone);
const resultText = (row: Row) => formatFollowupDetailText(text(row.followup_result || row.contact_result || row.followup_summary || row.response_status || row.followup_status || row.status));
const createdAt = (row: Row) => text(row.created_at);
const completedAt = (row: Row) => text(row.completed_at || row.closed_at || row.updated_at || row.created_at);
const lastActivityAt = (row: Row) => text(row.last_event_at || row.updated_at || row.created_at);
const attempts = (row: Row) => Number(row.contact_attempts || row.attempts_count || row.followup_attempts || row.attempt_count || 0);
const formatDate = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value || 'غير محدد' : d.toLocaleString('ar-EG'); };
const positiveOutcome = (row: Row) => /تم الشراء|اشترى|تم الطلب|أكد الطلب|راضي|تم الحل|تم تنفيذ|نجاح|استمر|روشتة|ارسل الروشتة|حجز|completed|resolved|purchased|converted/i.test(resultText(row));

const VIEW_COPY: Record<Exclude<ViewMode, 'performance'>, { title: string; description: string; empty: string }> = {
  exceptional: { title: 'المتابعات الاستثنائية المطلوبة', description: 'طلبات الدكاترة المفتوحة فقط، مع مقدم الطلب والمسؤول.', empty: 'لا توجد طلبات استثنائية مفتوحة.' },
  waiting: { title: 'في انتظار رد العميل', description: 'تم إرسال رسالة أو بدء التواصل، وننتظر رد العميل.', empty: 'لا توجد حالات في انتظار الرد.' },
  no_answer: { title: 'العميل لم يرد', description: 'محاولات تواصل فعلية لم يرد عليها العميل، ويمكن تنفيذ المتابعة وإكمالها مباشرة من هنا.', empty: 'لا توجد حالات مسجلة كعدم رد.' },
  completed: { title: 'سجل المتابعات المكتملة', description: 'يشمل المتابعات المكتملة يدويًا والمستوردة من ملفات خدمة العملاء، مع إمكانية التعديل أو إعادة المتابعة.', empty: 'لا توجد متابعات مكتملة مطابقة.' },
};

export default function CustomerFollowupRecordsAndPerformance({ mode }: { mode: ViewMode }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editState, setEditState] = useState<EditState>({ result: '', notes: '', nextDate: '', needsNext: false });
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const RECORD_COLUMNS = 'id,customer_code,customer_phone,phone,customer_name,name,branch,status,followup_status,contact_status,response_status,followup_result,contact_result,followup_summary,followup_reason,request_details,notes,next_followup_date,created_at,completed_at,closed_at,updated_at,last_event_at,contact_attempts,attempts_count,followup_attempts,attempt_count,needs_next_followup,assigned_doctor,responsible_name,completed_by_name,updated_by_name,assigned_staff_id,responsible_staff_id,completed_by_staff_id,updated_by_staff_id,staff_id,requested_by_name,created_by_name,source,request_type,import_source';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // نجيب أعمدة محددة بدل select('*') عشان نتفادى نقل أعمدة JSON التقيلة اللي مش مستخدمة هنا (زي customer_metrics)
      let query = supabase.from('daily_followups').select(RECORD_COLUMNS).order('created_at', { ascending: false }).limit(5000);
      if (!managerView && userBranch) query = query.eq('branch', userBranch);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (error) {
      const message = (error as Error).message;
      setError(message);
      toast.error(`تعذر تحميل سجل المتابعات: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [managerView, userBranch]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener('dataChanged', handler);
    return () => window.removeEventListener('dataChanged', handler);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let source = rows;
    if (mode === 'exceptional') source = source.filter((row) => exceptional(row) && !completed(row) && !cancelled(row));
    if (mode === 'waiting') source = source.filter(waiting);
    if (mode === 'no_answer') source = source.filter(noAnswer);
    if (mode === 'completed') source = source.filter((row) => completed(row) && !isHistoricalImport(row));
    if (q) source = source.filter((row) => `${customer(row)} ${row.customer_code || ''} ${phone(row)}`.toLowerCase().includes(q));
    return source;
  }, [mode, rows, search]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [mode, search]);
  const paged = filtered.slice(0, visibleCount);

  const performance = useMemo(() => {
    const monthlyRows = rows.filter((row) => completedAt(row).slice(0, 7) === month && completed(row));
    const groups = new Map<string, { names: string[]; items: Row[] }>();
    monthlyRows.forEach((row) => {
      const name = actor(row);
      const normalized = normalizePersonName(name);
      const key = actorId(row) ? `id:${actorId(row)}` : `name:${normalized}`;
      if (!normalized || normalized === 'غير محدد') return;
      const current = groups.get(key) || { names: [], items: [] };
      current.names.push(name); current.items.push(row); groups.set(key, current);
    });
    return Array.from(groups.values()).map(({ names, items }) => {
      const preferredName = names.sort((a, b) => b.length - a.length)[0] || 'غير محدد';
      const documented = items.filter((row) => text(row.notes || row.followup_summary || row.request_details).length >= 12).length;
      const positive = items.filter(positiveOutcome).length;
      const timely = items.filter((row) => { const start = new Date(createdAt(row)).getTime(); const end = new Date(completedAt(row)).getTime(); return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 48 * 60 * 60 * 1000; }).length;
      const real = items.filter((row) => resultText(row).length >= 3).length;
      const total = Math.max(items.length, 1);
      const rawScore = (real / total) * 35 + (positive / total) * 30 + (documented / total) * 20 + (timely / total) * 15;
      const confidence = Math.min(total / 10, 1);
      const score = Math.round(60 + (rawScore - 60) * confidence);
      const incentive = Math.round(500 * (score / 100) * Math.min(total / 10, 1));
      return { name: displayPersonName(preferredName), total: items.length, real, positive, documented, timely, rawScore: Math.round(rawScore), score, incentive, provisional: total < 10 };
    }).sort((a, b) => b.score - a.score || b.total - a.total);
  }, [month, rows]);

  function openEdit(row: Row) {
    setEditing(row);
    setEditState({
      result: mode === 'completed' ? resultText(row) : '',
      notes: text(row.notes || row.followup_summary),
      nextDate: dateKey(row.next_followup_date),
      needsNext: row.needs_next_followup === true,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editState.result.trim()) return toast.error('اكتب نتيجة المتابعة أولًا');
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        followup_result: editState.result.trim(),
        followup_summary: editState.result.trim(),
        notes: editState.notes.trim() || null,
        needs_next_followup: editState.needsNext,
        next_followup_date: editState.needsNext ? (editState.nextDate || todayKey()) : null,
        updated_at: now,
      };
      if (editState.needsNext) {
        Object.assign(payload, { completed_at: null, closed_at: null, status: 'متابعة مفتوحة', followup_status: 'متابعة مفتوحة', contact_status: 'متابعة مطلوبة', response_status: 'pending' });
      } else {
        Object.assign(payload, { completed_at: editing.completed_at || now, closed_at: editing.closed_at || now, status: 'مكتمل', followup_status: 'مكتمل', contact_status: 'تم الرد', response_status: 'replied' });
      }
      const { error } = await supabase.from('daily_followups').update(payload).eq('id', editing.id);
      if (error) throw error;
      toast.success(editState.needsNext ? 'تم تسجيل المحاولة وتحديد متابعة أخرى' : 'تم إكمال المتابعة وحفظ النتيجة');
      setEditing(null); setSelected(null); await load();
      window.dispatchEvent(new CustomEvent('dataChanged'));
    } catch (error) {
      toast.error(`تعذر حفظ المتابعة: ${(error as Error).message}`);
    } finally { setSaving(false); }
  }

  async function reopen(row: Row) {
    if (!window.confirm(`إعادة فتح متابعة ${customer(row)} وإظهارها في قائمة المتابعات؟`)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const oldNotes = text(row.notes || row.followup_summary);
      const { error } = await supabase.from('daily_followups').update({
        completed_at: null,
        closed_at: null,
        status: 'متابعة مفتوحة',
        followup_status: 'متابعة مفتوحة',
        contact_status: 'متابعة مطلوبة',
        response_status: 'pending',
        needs_next_followup: true,
        next_followup_date: todayKey(),
        notes: [oldNotes, `أعيد فتح المتابعة بواسطة ${user?.name || 'المستخدم'} في ${new Date().toLocaleString('ar-EG')}`].filter(Boolean).join(' — '),
        updated_at: now,
      }).eq('id', row.id);
      if (error) throw error;
      toast.success('تمت إعادة المتابعة وستظهر في القائمة المفتوحة');
      setSelected(null); await load();
    } catch (error) {
      toast.error(`تعذر إعادة المتابعة: ${(error as Error).message}`);
    } finally { setSaving(false); }
  }

  if (loading && !rows.length) return <SectionSkeleton label={mode === 'performance' ? 'تحليل الأداء' : VIEW_COPY[mode as Exclude<ViewMode, 'performance'>]?.title || 'السجل'} />;

  if (mode === 'performance') return (
    <section className="rounded-3xl border border-white/10 bg-[#091b2d] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-white">تحليل أداء خدمة العملاء</h2><p className="mt-1 text-xs font-bold text-slate-400">الحافز الأقصى 500 جنيه. الأسماء المكررة تُدمج، وأقل من 10 متابعات يُعرض كتقييم مبدئي.</p></div><input className="input-dark max-w-44" type="month" value={month} onChange={(e)=>setMonth(e.target.value)} /></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{performance.map((item, index)=><article key={item.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center justify-between gap-2"><div className="font-black text-white">#{index+1} {item.name}</div><div className="flex items-center gap-2"><span className="rounded-full bg-cyan-400/15 px-3 py-1 text-sm font-black text-cyan-200">{item.score}/100</span>{item.provisional ? <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-200">تقييم مبدئي</span> : null}</div></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300"><div>المكتمل الحقيقي: {item.real}/{item.total}</div><div>نتيجة إيجابية: {item.positive}</div><div>موثق جيدًا: {item.documented}</div><div>خلال 48 ساعة: {item.timely}</div></div><div className="mt-3 rounded-xl bg-emerald-400/10 p-3 text-center font-black text-emerald-200">الحافز المقترح: {item.incentive} جنيه</div></article>)}</div>
      {!performance.length ? <div className="mt-4 rounded-2xl border border-white/10 p-8 text-center text-slate-400">لا توجد متابعات مكتملة في الشهر المحدد.</div> : null}
    </section>
  );

  const copy = VIEW_COPY[mode];
  const actionable = mode !== 'completed';
  return (
    <section className="rounded-3xl border border-white/10 bg-[#091b2d] p-4 shadow-xl" dir="rtl">
      {error ? <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3" role="alert"><div className="flex items-center gap-2 text-sm font-black text-red-100"><AlertTriangle size={16}/> تعذر تحميل البيانات: {error.slice(0, 160)}</div><button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => void load()}><RefreshCw size={14}/> إعادة المحاولة</button></div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-white">{copy.title}</h2><p className="mt-1 text-xs font-bold text-slate-400">{copy.description}</p></div><div className="flex min-w-64 flex-1 items-center gap-2 max-w-2xl"><label className="relative flex-1"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17}/><input className="input-dark w-full pr-10" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث باسم العميل أو الكود أو الهاتف" /></label><button className="btn-secondary flex items-center gap-1" onClick={()=>void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> تحديث</button></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm font-black text-white">عدد الحالات: {filtered.length.toLocaleString('ar-EG')}</div>{mode === 'waiting' ? <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-black text-amber-100"><Clock3 className="ml-1 inline" size={16}/> تحتاج متابعة الرد</div> : null}{mode === 'no_answer' ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-black text-rose-100"><PhoneMissed className="ml-1 inline" size={16}/> تحتاج محاولة جديدة</div> : null}</div>
      <div className="mt-3 grid gap-3">{paged.map((row)=><article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-white">{customer(row)}</h3><p className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {phone(row) || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</p></div><div className="flex flex-wrap gap-2">{phone(row) ? <a className="btn-secondary flex items-center gap-2" href={`tel:${phone(row)}`}><PhoneCall size={16}/> اتصال</a> : null}<button className="btn-secondary flex items-center gap-2" onClick={()=>setSelected(row)}><Eye size={16}/> التفاصيل</button>{actionable ? <button className="btn-primary flex items-center gap-2" disabled={saving} onClick={()=>openEdit(row)}><CheckCircle2 size={16}/> تنفيذ المتابعة</button> : <><button className="btn-secondary flex items-center gap-2" onClick={()=>openEdit(row)}><Edit3 size={16}/> تعديل</button><button className="btn-primary flex items-center gap-2" disabled={saving} onClick={()=>void reopen(row)}><RotateCcw size={16}/> إعادة متابعة</button></>}</div></div><div className="mt-3 grid gap-2 text-sm font-bold text-slate-300 md:grid-cols-4"><div>مقدم الطلب: {requester(row)}</div><div>المسؤول: {actor(row)}</div><div>آخر نشاط: {formatDate(lastActivityAt(row))}</div><div>المحاولات: {attempts(row)}</div></div><p className="mt-3 rounded-xl bg-black/15 p-3 text-sm font-bold text-slate-200">{resultText(row) || text(row.request_details || row.notes) || 'لا توجد نتيجة مسجلة'}</p></article>)}</div>
      {filtered.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn-secondary mt-2 w-full text-xs">عرض {Math.min(PAGE_SIZE, filtered.length - visibleCount)} أخرى (من إجمالي {filtered.length.toLocaleString('ar-EG')})</button> : null}
      {!loading && !filtered.length ? <div className="mt-4 rounded-2xl border border-white/10 p-8 text-center text-slate-400">{copy.empty}</div> : null}
      {loading ? <div className="mt-4 text-center font-black text-cyan-200">جارٍ التحميل...</div> : null}

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? customer(selected) : ''} subtitle="تفاصيل المتابعة كاملة">
        {selected ? <>
          <DrawerFieldGrid fields={[['الكود', selected.customer_code || 'غير مسجل'],['الهاتف', phone(selected) || 'غير مسجل'],['الفرع', selected.branch || 'غير محدد'],['مقدم الطلب', requester(selected)],['المسؤول', actor(selected)],['تاريخ الإنشاء', formatDate(createdAt(selected))],['آخر نشاط', formatDate(lastActivityAt(selected))],['عدد المحاولات', attempts(selected)],['الحالة', selected.followup_status || selected.status || selected.contact_status || 'غير محددة']]} />
          <div className="mt-4 space-y-3"><div className="rounded-xl bg-white/[0.04] p-4"><div className="text-xs font-black text-cyan-300">سبب الطلب</div><div className="mt-2 whitespace-pre-wrap text-sm font-bold text-white">{selected.followup_reason || formatFollowupDetailText(selected.request_details) || 'غير مسجل'}</div></div><div className="rounded-xl bg-white/[0.04] p-4"><div className="text-xs font-black text-cyan-300">ما تم مع العميل</div><div className="mt-2 whitespace-pre-wrap text-sm font-bold text-white">{resultText(selected) || 'لا توجد نتيجة تفصيلية مسجلة'}</div></div><div className="rounded-xl bg-white/[0.04] p-4"><div className="text-xs font-black text-cyan-300">الملاحظات</div><div className="mt-2 whitespace-pre-wrap text-sm font-bold text-white">{formatFollowupDetailText(selected.notes) || selected.followup_summary || 'لا توجد ملاحظات'}</div></div></div>
          <div className="mt-4 flex flex-wrap gap-2">{phone(selected) ? <a className="btn-secondary flex items-center gap-2" href={`tel:${phone(selected)}`}><PhoneCall size={16}/> اتصال بالعميل</a> : null}{actionable ? <button className="btn-primary flex items-center gap-2" onClick={()=>{const row=selected;setSelected(null);openEdit(row);}}><CheckCircle2 size={16}/> تنفيذ وإكمال المتابعة</button> : <><button className="btn-secondary flex items-center gap-2" onClick={()=>{const row=selected;setSelected(null);openEdit(row);}}><Edit3 size={16}/> تعديل التفاصيل</button><button className="btn-primary flex items-center gap-2" disabled={saving} onClick={()=>void reopen(selected)}><RotateCcw size={16}/> إعادة متابعة العميل</button></>}</div>
        </> : null}
      </Drawer>

      {editing ? <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-3"><section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-cyan-300/20 bg-[#071827] p-5"><div className="flex items-start justify-between"><div><h2 className="text-xl font-black text-white">{mode === 'completed' ? 'تعديل متابعة' : 'تنفيذ متابعة'} {customer(editing)}</h2><p className="mt-1 text-xs font-bold text-slate-400">سجّل نتيجة التواصل، ثم أكمل المتابعة أو حدد موعدًا لمحاولة أخرى.</p></div><button className="btn-secondary" onClick={()=>setEditing(null)} disabled={saving}><X size={18}/></button></div><div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-bold text-slate-200 sm:grid-cols-2"><div>الكود: {editing.customer_code || 'غير مسجل'}</div><div>الهاتف: {phone(editing) || 'غير مسجل'}</div><div>الفرع: {editing.branch || 'غير محدد'}</div><div>المحاولات السابقة: {attempts(editing)}</div></div><div className="mt-4 space-y-4"><label className="block"><span className="mb-2 block text-sm font-black text-slate-200">نتيجة المتابعة وما تم مع العميل</span><textarea className="input-dark min-h-28 w-full" value={editState.result} onChange={(e)=>setEditState((s)=>({...s,result:e.target.value}))} placeholder="مثال: تم الرد وطلب العميل إعادة التواصل غدًا، أو تم تنفيذ الطلب..." /></label><label className="block"><span className="mb-2 block text-sm font-black text-slate-200">ملاحظات إضافية</span><textarea className="input-dark min-h-24 w-full" value={editState.notes} onChange={(e)=>setEditState((s)=>({...s,notes:e.target.value}))} /></label><label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-black text-white"><input type="checkbox" checked={editState.needsNext} onChange={(e)=>setEditState((s)=>({...s,needsNext:e.target.checked}))} /> يحتاج متابعة أخرى</label>{editState.needsNext ? <label className="block"><span className="mb-2 block text-sm font-black text-slate-200">موعد المتابعة القادمة</span><input type="date" className="input-dark w-full" value={editState.nextDate} onChange={(e)=>setEditState((s)=>({...s,nextDate:e.target.value}))} /></label> : <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm font-black text-emerald-100">سيتم اعتبار المتابعة مكتملة وإزالتها من قائمة «العميل لم يرد» بعد الحفظ.</div>}</div><div className="mt-5 flex flex-wrap justify-end gap-2">{phone(editing) ? <a className="btn-secondary flex items-center gap-2" href={`tel:${phone(editing)}`}><PhoneCall size={16}/> اتصال</a> : null}<button className="btn-secondary" onClick={()=>setEditing(null)} disabled={saving}>إلغاء</button><button className="btn-primary flex items-center gap-2" onClick={()=>void saveEdit()} disabled={saving}><Save size={16}/>{saving ? 'جارٍ الحفظ...' : editState.needsNext ? 'حفظ ومحاولة أخرى' : 'إكمال المتابعة'}</button></div></section></div> : null}
    </section>
  );
}
