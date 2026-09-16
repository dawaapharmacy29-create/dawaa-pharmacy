import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, History, Search, ShoppingBag, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type StoryEvent = {
  event_type?: string | null;
  event_at?: string | null;
  title?: string | null;
  detail?: string | null;
  product_name?: string | null;
  invoice_number?: string | null;
  invoice_value?: number | null;
  source_id?: string | null;
  journey_id?: string | null;
};

type StoryRow = {
  id: string;
  story_key: string;
  branch?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  status?: string | null;
  risk_level?: string | null;
  story_started_at?: string | null;
  last_activity_at?: string | null;
  recovery_started_at?: string | null;
  recovered_at?: string | null;
  recovered_invoice_number?: string | null;
  recovered_invoice_value?: number | null;
  last_verified_purchase_at?: string | null;
  last_verified_purchase_value?: number | null;
  open_request_count?: number | null;
  open_complaint_count?: number | null;
  accepted_recommendation_count?: number | null;
  recovery_attempts?: number | null;
  journey_count?: number | null;
  source_count?: number | null;
  open_action_count?: number | null;
  summary?: string | null;
  recent_events?: StoryEvent[] | null;
};

const statusLabel: Record<string, string> = {
  active: 'نشط',
  recovery: 'تحت الاسترجاع',
  recovered: 'تم استرجاعه',
  dormant: 'خامل',
  closed: 'مغلق',
};

const riskLabel: Record<string, string> = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' };

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function eventTone(eventType?: string | null) {
  if (eventType === 'customer_recovered' || eventType === 'verified_purchase') return 'border-emerald-400/25 bg-emerald-500/8';
  if (eventType === 'order_problem' || eventType === 'complaint_followup') return 'border-rose-400/25 bg-rose-500/8';
  if (eventType === 'recovery_attempt' || eventType === 'apology_recovery') return 'border-violet-400/25 bg-violet-500/8';
  if (eventType === 'product_request') return 'border-cyan-400/25 bg-cyan-500/8';
  if (eventType === 'recommendation_followup') return 'border-amber-400/25 bg-amber-500/8';
  return 'border-slate-800 bg-slate-950/30';
}

export default function WhatsAppCustomerStory360V16({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<StoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('whatsapp_customer_story_360_v1')
        .select('*')
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .limit(300);
      if (alive) {
        if (!error) setRows((data || []) as StoryRow[]);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [row.customer_name, row.customer_code, row.customer_phone, row.branch, row.summary].some((x) => String(x || '').toLowerCase().includes(q));
  }), [rows, search, status]);

  const selected = filtered.find((row) => row.id === selectedId) || filtered[0] || null;
  const recoveryCount = rows.filter((x) => x.status === 'recovery').length;
  const recoveredCount = rows.filter((x) => x.status === 'recovered').length;
  const criticalCount = rows.filter((x) => x.risk_level === 'critical').length;

  return (
    <section className="dawaa-card dawaa-card--raised p-4" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-violet-200"><History size={18}/><span className="text-xs font-black">Customer Story 360 — V16</span></div>
          <div className="mt-1 text-xl font-black text-white">قصة العميل المستمرة</div>
          <p className="mt-1 max-w-4xl text-xs leading-6 text-slate-400">كل Export جديد لنفس العميل يدخل تحت نفس القصة: طلبات، شكاوى، ترشيحات، محاولات استرجاع، وفواتير مؤكدة. البيع لا يُثبت إلا بفاتورة حقيقية.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/8 px-3 py-2"><b className="block text-lg text-amber-200">{recoveryCount}</b><span className="text-slate-400">تحت الاسترجاع</span></div>
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/8 px-3 py-2"><b className="block text-lg text-emerald-200">{recoveredCount}</b><span className="text-slate-400">تم استرجاعهم</span></div>
          <div className="rounded-xl border border-rose-400/20 bg-rose-500/8 px-3 py-2"><b className="block text-lg text-rose-200">{criticalCount}</b><span className="text-slate-400">خطر حرج</span></div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_190px]">
        <div className="relative"><Search className="absolute right-3 top-2.5 text-slate-500" size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الكود أو الهاتف أو الفرع..." className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-9 pl-3 text-sm text-white outline-none focus:border-violet-400"/></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="all">كل الحالات</option><option value="recovery">تحت الاسترجاع</option><option value="recovered">تم استرجاعه</option><option value="active">نشط</option><option value="dormant">خامل</option><option value="closed">مغلق</option></select>
      </div>

      {loading ? <div className="mt-5 p-8 text-center text-sm text-slate-500">جاري تحميل قصص العملاء...</div> : !filtered.length ? <div className="mt-5 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">لا توجد Customer Stories بعد. أول Export جديد بهوية عميل مؤكدة سيبدأ بناء القصة تلقائيًا.</div> : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="max-h-[760px] space-y-2 overflow-y-auto">
            {filtered.map((row) => (
              <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full rounded-2xl border p-3 text-right transition ${selected?.id === row.id ? 'border-violet-400/50 bg-violet-500/10' : 'border-slate-800 bg-slate-950/30 hover:border-slate-600'}`}>
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-black text-white">{row.customer_name || 'عميل غير محدد'} {row.customer_code ? <span className="text-xs text-slate-500">#{row.customer_code}</span> : null}</div><div className="mt-1 text-[10px] text-slate-500">{row.branch || 'بدون فرع'} • آخر نشاط {formatDate(row.last_activity_at)}</div></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${row.status === 'recovered' ? 'bg-emerald-500/15 text-emerald-200' : row.status === 'recovery' ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-300'}`}>{statusLabel[row.status || ''] || row.status || '—'}</span></div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400"><span>الخطر: <b className={row.risk_level === 'critical' ? 'text-rose-300' : row.risk_level === 'high' ? 'text-amber-300' : 'text-slate-200'}>{riskLabel[row.risk_level || ''] || row.risk_level || '—'}</b></span><span>Journeys: {row.journey_count || 0}</span><span>متابعات: {row.open_action_count || 0}</span></div>
              </button>
            ))}
          </div>

          {selected ? <div className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-black text-white"><UserRound size={17}/>{selected.customer_name || 'عميل غير محدد'} {selected.customer_code ? <span className="text-xs text-slate-500">#{selected.customer_code}</span> : null}</div><div className="mt-1 text-xs text-slate-400">{selected.summary || 'لا يوجد ملخص بعد.'}</div></div>{selected.status === 'recovered' ? <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-100"><CheckCircle2 className="ml-1 inline" size={14}/>تم استرجاع العميل بفاتورة مؤكدة</div> : selected.status === 'recovery' ? <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-100"><AlertTriangle className="ml-1 inline" size={14}/>المتابعة ما زالت مفتوحة</div> : null}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6 text-center text-xs"><div className="rounded-xl border border-slate-800 p-2"><b className="block text-lg text-cyan-200">{selected.open_request_count || 0}</b>طلبات مفتوحة</div><div className="rounded-xl border border-slate-800 p-2"><b className="block text-lg text-rose-200">{selected.open_complaint_count || 0}</b>شكاوى مفتوحة</div><div className="rounded-xl border border-slate-800 p-2"><b className="block text-lg text-amber-200">{selected.accepted_recommendation_count || 0}</b>ترشيحات مقبولة</div><div className="rounded-xl border border-slate-800 p-2"><b className="block text-lg text-violet-200">{selected.recovery_attempts || 0}</b>محاولات استرجاع</div><div className="rounded-xl border border-slate-800 p-2"><b className="block text-lg text-white">{selected.source_count || 0}</b>جلسات محفوظة</div><div className="rounded-xl border border-slate-800 p-2"><b className="block text-lg text-emerald-200">{selected.last_verified_purchase_value ? `${Number(selected.last_verified_purchase_value).toFixed(0)}ج` : '—'}</b>آخر شراء مؤكد</div></div>
              {selected.recovered_at ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100"><ShoppingBag size={15}/>استرجاع مؤكد بتاريخ {formatDate(selected.recovered_at)} {selected.recovered_invoice_number ? `• فاتورة ${selected.recovered_invoice_number}` : ''} {selected.recovered_invoice_value ? `• ${Number(selected.recovered_invoice_value).toFixed(2)} ج` : ''}</div> : null}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
              <div className="flex items-center gap-2 font-black text-white"><Clock3 size={17}/>Timeline القصة</div>
              <div className="mt-3 space-y-2">
                {(selected.recent_events || []).map((event, index) => <div key={`${event.event_type}-${event.event_at}-${index}`} className={`rounded-xl border p-3 ${eventTone(event.event_type)}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-black text-white">{event.title || event.event_type || 'حدث'}</div><div className="mt-1 text-xs leading-6 text-slate-300">{event.detail || '—'}</div></div><div className="text-[10px] text-slate-500">{formatDate(event.event_at)}</div></div><div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400">{event.product_name ? <span>الصنف: <b className="text-cyan-200">{event.product_name}</b></span> : null}{event.invoice_number ? <span>فاتورة: <b className="text-emerald-200">{event.invoice_number}</b></span> : null}{event.invoice_value ? <span>{Number(event.invoice_value).toFixed(2)} ج</span> : null}{event.source_id && onOpenSource ? <button type="button" onClick={() => onOpenSource(event.source_id!)} className="rounded-lg border border-violet-400/20 px-2 py-0.5 font-black text-violet-200 hover:bg-violet-500/10">فتح المحادثة</button> : null}</div></div>)}
                {!selected.recent_events?.length ? <div className="py-6 text-center text-xs text-slate-500">لا توجد أحداث في القصة بعد.</div> : null}
              </div>
            </div>
          </div> : null}
        </div>
      )}
    </section>
  );
}
