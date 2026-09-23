import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Clock3, MessageSquareText, ShoppingCart, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Mode = 'doctors' | 'customers' | 'service';
type AnyRow = Record<string, any>;

const fmtMoney = (value: unknown) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
const fmtPct = (value: unknown) => value == null ? '—' : `${Number(value).toFixed(1)}%`;
const fmtMinutes = (value: unknown) => value == null ? '—' : `${Number(value).toFixed(1)} د`;

function isoDateLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentCycle26to25(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - (now.getDate() < 26 ? 1 : 0), 26);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 25);
  return { start: isoDateLocal(start), end: isoDateLocal(end) };
}

function sameIdentity(a: AnyRow, b: AnyRow) {
  if (a.staff_id && b.staff_id) return String(a.staff_id) === String(b.staff_id) && String(a.branch || '') === String(b.branch || '');
  return String(a.staff_name || '') === String(b.staff_name || '') && String(a.branch || '') === String(b.branch || '');
}

export default function WhatsAppCycleEvidenceDashboardV17({ mode }: { mode: Mode }) {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [responseRows, setResponseRows] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const cycle = useMemo(() => currentCycle26to25(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      const view = mode === 'doctors'
        ? 'whatsapp_doctor_cycle_performance_v17'
        : mode === 'customers'
          ? 'whatsapp_customer_cycle_performance_v17'
          : 'whatsapp_customer_service_cycle_performance_v17';
      const mainPromise = supabase.from(view).select('*').eq('cycle_start', cycle.start).limit(500);
      const responsePromise = mode === 'doctors'
        ? supabase.from('whatsapp_doctor_response_cycle_v18').select('*').eq('cycle_start', cycle.start).limit(500)
        : Promise.resolve({ data: [], error: null } as any);
      const [main, response] = await Promise.all([mainPromise, responsePromise]);
      if (cancelled) return;
      if (main.error || response.error) {
        setError(main.error?.message || response.error?.message || 'تعذر تحميل مؤشرات الدورة');
        setRows([]); setResponseRows([]);
      } else {
        setRows(main.data || []);
        setResponseRows(response.data || []);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [mode, cycle.start]);

  const current = useMemo<AnyRow[]>(() => {
    if (mode !== 'doctors') return rows;
    return rows.map((row) => ({ ...row, responseTiming: responseRows.find((timing) => sameIdentity(row, timing)) || null }));
  }, [rows, responseRows, mode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return current;
    return current.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [current, query]);

  const totals = useMemo(() => {
    if (mode === 'doctors') return {
      first: current.reduce((s, r) => s + Number(r.conversation_count || 0), 0),
      second: current.reduce((s, r) => s + Number(r.commercial_conversations || 0), 0),
      third: current.reduce((s, r) => s + Number(r.verified_invoice_count || 0), 0),
      money: current.reduce((s, r) => s + Number(r.verified_revenue || 0), 0),
    };
    if (mode === 'customers') return {
      first: current.length,
      second: current.reduce((s, r) => s + Number(r.open_request_count || 0), 0),
      third: current.reduce((s, r) => s + Number(r.verified_invoice_count || 0), 0),
      money: current.reduce((s, r) => s + Number(r.verified_revenue || 0), 0),
    };
    return {
      first: current.reduce((s, r) => s + Number(r.assigned_tasks || 0), 0),
      second: current.reduce((s, r) => s + Number(r.completed_tasks || 0), 0),
      third: current.reduce((s, r) => s + Number(r.verified_recovered_sales || 0), 0),
      money: current.reduce((s, r) => s + Number(r.verified_recovered_revenue || 0), 0),
    };
  }, [current, mode]);

  const title = mode === 'doctors' ? 'أداء الدكاترة الموثق V18' : mode === 'customers' ? 'سايكل العميل الموثق V17' : 'أداء متابعة خدمة العملاء V18';
  const subtitle = mode === 'doctors'
    ? 'Conversion بالفاتورة + طلبات وترشيحات موثقة + زمن رد محسوب من الـTurns الفعلية للرسائل.'
    : mode === 'customers'
      ? 'رحلة العميل خلال 26→25: المحادثات، الطلبات المفتوحة، الاسترجاع، والمبيعات المؤكدة.'
      : 'المهام والـSLA والاسترجاع، مع احتساب كل فاتورة مسترجعة مرة واحدة فقط مهما تعددت المهام.';

  return (
    <section className="dawaa-card dawaa-card--raised p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><BadgeCheck size={18}/>{title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</div>
          <div className="mt-1 text-[10px] text-slate-500">الدورة الحالية الفعلية: {cycle.start} → {cycle.end}</div>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث..." className="w-full rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none lg:w-64" />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={MessageSquareText} label={mode === 'doctors' ? 'المحادثات' : mode === 'customers' ? 'عملاء بالدورة' : 'مهام مسندة'} value={totals.first} />
        <Metric icon={ShoppingCart} label={mode === 'doctors' ? 'محادثات تجارية' : mode === 'customers' ? 'طلبات مفتوحة' : 'مهام مكتملة'} value={totals.second} />
        <Metric icon={UsersRound} label={mode === 'service' ? 'استرجاع بفاتورة فريدة' : 'فواتير مؤكدة'} value={totals.third} />
        <Metric icon={BadgeCheck} label={mode === 'service' ? 'إيراد مسترجع مؤكد' : 'إيراد مؤكد'} value={fmtMoney(totals.money)} />
      </div>

      {loading ? <div className="mt-4 text-sm text-slate-400">جاري تحميل مؤشرات الدورة الحالية...</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-xs text-rose-200">تعذر تحميل المؤشرات: {error}</div> : null}
      {!loading && !error && !filtered.length ? <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/20 p-3 text-sm text-slate-400">لا توجد بيانات موثقة كافية في الدورة الحالية لهذه اللوحة. لن يتم عرض دورة قديمة بدلًا منها.</div> : null}

      <div className="mt-4 space-y-2">
        {filtered.map((row, index) => mode === 'doctors' ? <DoctorRow key={`${row.staff_id || row.staff_name}-${index}`} row={row} /> : mode === 'customers' ? <CustomerRow key={`${row.customer_id || row.customer_code}-${index}`} row={row} /> : <ServiceRow key={`${row.staff_id || row.staff_name}-${index}`} row={row} />)}
      </div>
      <div className="mt-3 text-[10px] leading-5 text-slate-500">مهم: التقييمات المبدئية ليست نقاطًا رسمية. Conversion المؤكد يعتمد على الفاتورة. قبول صنف أو ترشيح يعتمد على Evidence مستقل، وزمن الرد يُحسب من آخر رسالة في Turn العميل إلى أول رد صيدلية بعدها.</div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3"><div className="flex items-center gap-2 text-[10px] text-slate-500"><Icon size={14}/>{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>;
}

function DoctorRow({ row }: { row: AnyRow }) {
  const t = row.responseTiming;
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{row.staff_name || 'دكتور غير محدد'}</div><div className="text-[10px] text-slate-500">{row.branch || '—'}</div></div>
    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-6">
      <K label="Conversion مؤكد" value={fmtPct(row.verified_conversation_conversion_rate)} />
      <K label="إيراد مؤكد" value={fmtMoney(row.verified_revenue)} />
      <K label="طلبات" value={row.customer_requests || 0} />
      <K label="تسجيل الطلب" value={fmtPct(row.request_registration_rate)} />
      <K label="قبول الترشيح" value={fmtPct(row.recommendation_acceptance_rate)} />
      <K label="تأخير/فشل" value={`${Number(row.delay_signals || 0) + Number(row.failed_order_signals || 0)}`} />
    </div>
    <div className="mt-3 rounded-xl border border-cyan-400/10 bg-cyan-500/5 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-black text-cyan-100"><Clock3 size={13}/>زمن الرد من الرسائل الفعلية</div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3 xl:grid-cols-6">
        <K label="Turns العملاء" value={t?.customer_turns ?? '—'} />
        <K label="Median" value={fmtMinutes(t?.median_response_minutes)} />
        <K label="P90" value={fmtMinutes(t?.p90_response_minutes)} />
        <K label="≤ 5 دقائق" value={fmtPct(t?.within_5m_rate)} />
        <K label="≤ 10 دقائق" value={fmtPct(t?.within_10m_rate)} />
        <K label="نسبة الرد" value={fmtPct(t?.answer_rate)} />
      </div>
    </div>
  </div>;
}

function CustomerRow({ row }: { row: AnyRow }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{row.customer_name || row.customer_code || 'عميل غير محدد'}</div><div className="text-[10px] text-slate-500">{row.story_status || '—'} · {row.risk_level || '—'}</div></div>
    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-6">
      <K label="محادثات" value={row.conversation_count || 0} />
      <K label="محادثات تجارية" value={row.commercial_conversations || 0} />
      <K label="طلبات مفتوحة" value={row.open_request_count || 0} />
      <K label="ترشيحات مقبولة" value={row.accepted_recommendation_count || 0} />
      <K label="فواتير مؤكدة" value={row.verified_invoice_count || 0} />
      <K label="إيراد مؤكد" value={fmtMoney(row.verified_revenue)} />
    </div>
  </div>;
}

function ServiceRow({ row }: { row: AnyRow }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{row.staff_name || 'مسئول غير محدد'}</div><div className="text-[10px] text-slate-500">{row.branch || '—'}</div></div>
    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-7">
      <K label="مهام" value={row.assigned_tasks || 0} />
      <K label="مكتملة" value={row.completed_tasks || 0} />
      <K label="SLA" value={fmtPct(row.sla_compliance_rate)} />
      <K label="محاولات متابعة" value={row.followup_attempts || 0} />
      <K label="مهام نتيجتها بيع" value={row.verified_recovered_task_outcomes || 0} />
      <K label="فواتير استرجاع فريدة" value={row.verified_recovered_sales || 0} />
      <K label="إيراد مسترجع" value={fmtMoney(row.verified_recovered_revenue)} />
    </div>
  </div>;
}

function K({ label, value }: { label: string; value: any }) { return <div><div className="text-[10px] text-slate-500">{label}</div><div className="mt-0.5 font-black text-slate-100">{value}</div></div>; }
