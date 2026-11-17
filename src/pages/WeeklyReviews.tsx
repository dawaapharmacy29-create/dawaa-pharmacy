import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle2, MessageCircle, RefreshCw, Target } from 'lucide-react';
import {
  INVOICE_CRITERIA, cairoToday, cycleStartOf, generateDueBatches, invoiceReviewScore, listCycleTargets, listReviewSamples,
  nextCycleStart, saveCycleTarget, saveInvoiceReview, suggestCycleTargets,
  type CycleTargetRow, type InvoiceCriteria, type ReviewSample, type SampleStatus,
} from '@/lib/evaluationLab/reviewSamples';

// v7.1 weekly random reviews (owner 2026-11-17): cash invoices checked on the cameras (they keep 5 days) and
// delivery conversations the doctor uploads to the Master Brain. The database draws the samples; opening the page
// draws whatever batch is due.

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const BRANCHES = ['شكري', 'الشامي'];

const STATUS: Record<SampleStatus, { label: string; tone: string }> = {
  pending: { label: 'مستنية مراجعتك', tone: 'dawaa-status-warning-text dawaa-status-warning-bg' },
  reviewed: { label: 'اتراجعت', tone: 'dawaa-status-success-text dawaa-status-success-bg' },
  skipped: { label: 'اتشالت (مش باينة)', tone: 'text-slate-500 bg-slate-100' },
  expired: { label: 'الكاميرا مسحتها', tone: 'dawaa-status-danger-text dawaa-status-danger-bg' },
  awaiting_upload: { label: 'مستني الدكتور يرفعها', tone: 'dawaa-status-warning-text dawaa-status-warning-bg' },
  uploaded: { label: 'اترفعت · قيّمها', tone: 'dawaa-status-success-text dawaa-status-success-bg' },
  missing: { label: 'مااترفعتش = صفر', tone: 'dawaa-status-danger-text dawaa-status-danger-bg' },
};
const STRATUM = { small: 'فاتورة صغيرة', medium: 'فاتورة متوسطة', big: 'فاتورة كبيرة' } as const;
const RATINGS: Array<{ value: 0 | 1 | 2 | null; label: string }> = [
  { value: 2, label: 'ممتاز' }, { value: 1, label: 'مقبول' }, { value: 0, label: 'ضعيف' }, { value: null, label: 'مش باينة' },
];

const egp = (n: number) => `${Math.round(n).toLocaleString('ar-EG')} ج`;
const when = (iso: string) => new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'numeric' });

function StatusChip({ status }: { status: SampleStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${s.tone}`}>{s.label}</span>;
}

function InvoiceCard({ sample, onSaved }: { sample: ReviewSample; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [criteria, setCriteria] = useState<InvoiceCriteria>(sample.criteria || {});
  const [notes, setNotes] = useState(sample.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = invoiceReviewScore(criteria);
  const editable = sample.status !== 'expired';

  const save = async (skip: boolean) => {
    setBusy(true); setError('');
    try { await saveInvoiceReview(sample.id, criteria, notes, skip); setOpen(false); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'حصلت مشكلة في الحفظ'); }
    finally { setBusy(false); }
  };

  return <div className="rounded-2xl border p-3" style={surface}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="text-sm font-black">{sample.staffName} <span className="text-xs font-bold text-slate-500">· {sample.branch}</span></div>
        <div className="mt-1 text-xs font-bold text-slate-600">{when(sample.invoiceAt)} · فاتورة {sample.invoiceNumber || '—'}</div>
        <div className="mt-1 text-xs font-bold text-slate-600">{egp(sample.net)} · {sample.items ?? '—'} صنف · {STRATUM[sample.stratum]}{sample.customerName ? ` · ${sample.customerName}` : ''}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusChip status={sample.status} />
        {sample.score != null ? <span className="text-lg font-black text-teal-700">{Math.round(sample.score)}٪</span> : null}
        {sample.status === 'pending' ? <span className="text-[11px] font-bold text-slate-500">آخر يوم: {dayLabel(sample.deadline)}</span> : null}
      </div>
    </div>
    {editable ? <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => setOpen(!open)}>{open ? 'اقفل' : sample.status === 'pending' ? 'راجعها على الكاميرا' : 'عدّل التقييم'}</button> : null}
    {open ? <div className="mt-3 space-y-2">
      {INVOICE_CRITERIA.map((c) => <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2" style={surfaceSoft}>
        <span className="text-xs font-black">{c.label}</span>
        <div className="flex gap-1">
          {RATINGS.map((r) => {
            const active = c.key in criteria && criteria[c.key] === r.value;
            return <button key={r.label} type="button" onClick={() => setCriteria({ ...criteria, [c.key]: r.value })}
              className={`rounded-lg border px-2 py-1 text-[11px] font-black ${active ? 'bg-teal-700 text-white' : ''}`} style={active ? undefined : surface}>{r.label}</button>;
          })}
        </div>
      </div>)}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ملاحظات (اختياري)" className="w-full rounded-xl border p-2 text-xs" style={surface} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || preview == null} onClick={() => void save(false)} className="btn-primary text-xs disabled:opacity-50">احفظ {preview != null ? `(${Math.round(preview)}٪)` : '— قيّم ٣ بنود على الأقل'}</button>
        <button type="button" disabled={busy} onClick={() => void save(true)} className="btn-secondary text-xs">الفاتورة مش باينة في الكاميرا</button>
        {error ? <span className="text-xs font-bold text-red-600">{error}</span> : null}
      </div>
    </div> : null}
  </div>;
}

function ConversationCard({ sample }: { sample: ReviewSample }) {
  return <div className="rounded-2xl border p-3" style={surface}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="text-sm font-black">{sample.staffName} <span className="text-xs font-bold text-slate-500">· {sample.branch}</span></div>
        <div className="mt-1 text-xs font-bold text-slate-600">{sample.customerName || 'عميل'} · {sample.customerPhone || sample.customerCode || '—'}</div>
        <div className="mt-1 text-xs font-bold text-slate-600">أوردر توصيل {when(sample.invoiceAt)} · {egp(sample.net)}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusChip status={sample.status} />
        {sample.score != null ? <span className="text-lg font-black text-teal-700">{Math.round(sample.score)}٪</span> : null}
        {sample.status === 'awaiting_upload' ? <span className="text-[11px] font-bold text-slate-500">آخر يوم للرفع: {dayLabel(sample.deadline)}</span> : null}
      </div>
    </div>
    {sample.status === 'uploaded' ? <Link to="/reviews" className="btn-secondary mt-2 inline-block text-xs">افتح المحادثات وقيّمها</Link> : null}
  </div>;
}

function staffSummary(samples: ReviewSample[]) {
  const map = new Map<string, { name: string; branch: string | null; done: number; total: number; sum: number }>();
  for (const s of samples) {
    const row = map.get(s.staffId) || { name: s.staffName, branch: s.branch, done: 0, total: 0, sum: 0 };
    row.total += 1;
    if (s.score != null) { row.done += 1; row.sum += s.score; }
    map.set(s.staffId, row);
  }
  return [...map.values()].sort((a, b) => (a.branch || '').localeCompare(b.branch || '') || a.name.localeCompare(b.name));
}

function Summary({ samples, title }: { samples: ReviewSample[]; title: string }) {
  const rows = staffSummary(samples);
  if (!rows.length) return null;
  return <div className="rounded-2xl border p-3" style={surfaceSoft}>
    <div className="mb-2 text-xs font-black">{title}</div>
    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => <div key={r.name} className="flex justify-between rounded-lg border px-2 py-1 text-xs font-bold" style={surface}>
        <span>{r.name}</span><span>{r.done}/{r.total}{r.done ? ` · ${Math.round(r.sum / r.done)}٪` : ''}</span>
      </div>)}
    </div>
  </div>;
}

function TargetsTab({ cycle }: { cycle: string }) {
  const [rows, setRows] = useState<CycleTargetRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { followups: string; requests: string }>>({});
  const [msg, setMsg] = useState('');
  const next = nextCycleStart(cycle);

  const load = useCallback(async () => {
    try { setRows(await listCycleTargets()); } catch (e) { setMsg(e instanceof Error ? e.message : 'تعذّر التحميل'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const find = (branch: string, start: string) => rows.find((r) => r.branch === branch && r.cycleStart === start);

  return <div className="space-y-3">
    <p className="text-xs font-bold text-slate-600">تارجت المتابعات والطلبات الكاملة لكل فرع. كل دكتور ياخد نصيبه حسب الزباين اللي بيعدّوا في ساعاته. الاقتراح: المتابعات + ٢٠٠ كل شهر لحد ١٠٠٠، والطلبات + ١٥٪. عدّل قبل ما تحفظ.</p>
    {BRANCHES.map((branch) => {
      const current = find(branch, cycle);
      const saved = find(branch, next);
      const suggestion = suggestCycleTargets({ followups: current?.followups ?? null, requests: current?.requests ?? null });
      const d = draft[branch] || { followups: String(saved?.followups ?? suggestion.followups), requests: String(saved?.requests ?? suggestion.requests ?? '') };
      return <div key={branch} className="rounded-2xl border p-3" style={surface}>
        <div className="text-sm font-black">فرع {branch}</div>
        <div className="mt-1 text-xs font-bold text-slate-600">الدورة الحالية ({dayLabel(cycle)}): متابعات {current?.followups ?? '—'} · طلبات كاملة {current?.requests ?? '—'}</div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs font-black">متابعات دورة {dayLabel(next)}
            <input type="number" value={d.followups} onChange={(e) => setDraft({ ...draft, [branch]: { ...d, followups: e.target.value } })} className="mt-1 block w-28 rounded-lg border p-1" style={surfaceSoft} /></label>
          <label className="text-xs font-black">طلبات كاملة
            <input type="number" value={d.requests} onChange={(e) => setDraft({ ...draft, [branch]: { ...d, requests: e.target.value } })} className="mt-1 block w-28 rounded-lg border p-1" style={surfaceSoft} /></label>
          <button type="button" className="btn-primary text-xs" onClick={async () => {
            try {
              await saveCycleTarget({ branch, cycleStart: next, followups: Number(d.followups), requests: Number(d.requests) });
              setMsg(`اتحفظ تارجت ${branch}`); await load();
            } catch (e) { setMsg(e instanceof Error ? e.message : 'تعذّر الحفظ'); }
          }}>{saved ? 'حدّث' : 'اعتمد'}</button>
          {saved ? <span className="text-[11px] font-bold text-teal-700"><CheckCircle2 className="inline h-3 w-3" /> معتمد</span> : null}
        </div>
      </div>;
    })}
    {msg ? <div className="text-xs font-bold">{msg}</div> : null}
  </div>;
}

export default function WeeklyReviews() {
  const today = cairoToday();
  const [cycle, setCycle] = useState(cycleStartOf(today));
  const [tab, setTab] = useState<'invoice' | 'conversation' | 'targets'>('invoice');
  const [samples, setSamples] = useState<ReviewSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async (draw: boolean) => {
    setLoading(true); setNote('');
    try {
      if (draw) {
        const added = await generateDueBatches(today);
        if (added) setNote(`اتسحبت ${added} عينة جديدة`);
      }
      setSamples(await listReviewSamples(cycle));
    } catch (e) { setNote(e instanceof Error ? e.message : 'تعذّر التحميل'); }
    finally { setLoading(false); }
  }, [cycle, today]);
  useEffect(() => { void load(cycle === cycleStartOf(today)); }, [load, cycle, today]);

  const invoices = useMemo(() => samples.filter((s) => s.kind === 'invoice'), [samples]);
  const conversations = useMemo(() => samples.filter((s) => s.kind === 'conversation'), [samples]);
  const pendingInvoices = invoices.filter((s) => s.status === 'pending').length;
  const shown = (tab === 'invoice' ? invoices : conversations).slice().sort((a, b) => {
    const rank = (s: ReviewSample) => (s.status === 'pending' || s.status === 'uploaded' ? 0 : s.status === 'awaiting_upload' ? 1 : 2);
    return rank(a) - rank(b) || a.deadline.localeCompare(b.deadline);
  });
  const prevCycle = cycleStartOf(new Date(Date.parse(`${cycle}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));

  return <div className="space-y-4 pb-4" dir="rtl">
    <section className="rounded-3xl border p-5" style={{ background: 'linear-gradient(135deg, #1B2B4B 0%, #243558 100%)', borderColor: 'var(--dawaa-theme-border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-black text-white">المراجعات الأسبوعية العشوائية</h1>
        <button type="button" onClick={() => void load(cycle === cycleStartOf(today))} disabled={loading} className="rounded-full p-2 text-amber-300 disabled:opacity-50" style={{ background: 'rgba(0,0,0,0.2)' }} aria-label="تحديث">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <p className="mt-2 text-xs font-bold text-slate-300">التطبيق بيختار فواتير كاش عشوائية (صغيرة ومتوسطة وكبيرة) مرتين في الأسبوع: يوم الأربع (من السبت للتلات) ويوم السبت (من الأربع للجمعة)، عشان تلحق تراجعها قبل ما الكاميرا تمسح بعد ٥ أيام. ومحادثات توصيل عشوائية كل سبت، والدكتور لازم يرفعها على العقل المدبر خلال يومين وإلا تتحسب صفر.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-white">
        <span>الدورة:</span>
        <button type="button" className="rounded-lg px-2 py-1" style={{ background: 'rgba(255,255,255,0.12)' }} onClick={() => setCycle(prevCycle)}>السابقة</button>
        <span>{dayLabel(cycle)}</span>
        {cycle !== cycleStartOf(today) ? <button type="button" className="rounded-lg px-2 py-1" style={{ background: 'rgba(255,255,255,0.12)' }} onClick={() => setCycle(cycleStartOf(today))}>الحالية</button> : null}
        {note ? <span className="text-amber-200">{note}</span> : null}
      </div>
    </section>

    <div className="flex flex-wrap gap-2">
      {([['invoice', `الفواتير على الكاميرا${pendingInvoices ? ` (${pendingInvoices})` : ''}`, Camera], ['conversation', 'المحادثات', MessageCircle], ['targets', 'التارجت الشهري', Target]] as const).map(([key, label, Icon]) =>
        <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-xl border px-3 py-2 text-xs font-black ${tab === key ? 'bg-teal-700 text-white' : ''}`} style={tab === key ? undefined : surface}>
          <Icon className="ml-1 inline h-4 w-4" />{label}</button>)}
    </div>

    {tab === 'targets' ? <TargetsTab cycle={cycleStartOf(today)} /> : <>
      <Summary samples={tab === 'invoice' ? invoices : conversations} title={tab === 'invoice' ? 'كل دكتور: اتراجع/المسحوب · المتوسط (الهدف ١٠ فواتير في الشهر)' : 'كل دكتور: اتقيّم/المسحوب · المتوسط'} />
      {tab === 'conversation' && conversations.some((s) => s.status === 'awaiting_upload') ? <p className="text-xs font-bold text-slate-600">الدكتور بيشوف المطلوب منه في صفحته الرئيسية، ويرفعها من <Link to="/whatsapp-smart-folder-watcher" className="underline">العقل المدبر</Link>.</p> : null}
      {shown.length ? <div className="grid gap-2 lg:grid-cols-2">
        {shown.map((s) => (s.kind === 'invoice' ? <InvoiceCard key={s.id} sample={s} onSaved={() => void load(false)} /> : <ConversationCard key={s.id} sample={s} />))}
      </div> : <div className="rounded-2xl border p-4 text-center text-xs font-bold text-slate-500" style={surface}>{loading ? 'بيحمّل…' : 'مفيش عينات في الدورة دي لسه'}</div>}
    </>}
  </div>;
}
