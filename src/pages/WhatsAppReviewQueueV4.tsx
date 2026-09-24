import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileText, Filter, RefreshCw, Search, ShieldAlert, ShoppingCart, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import WhatsAppCycleEvidenceDashboardV17 from '@/components/reviews/WhatsAppCycleEvidenceDashboardV17';

type QueueRow = {
  id: string;
  branch: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  staff_name: string | null;
  conversation_started_at: string | null;
  conversation_ended_at: string | null;
  message_count: number | null;
  review_status: string;
  priority: 'normal' | 'important' | 'urgent';
  analysis_confidence: number | null;
  service_score: number | null;
  commercial_score: number | null;
  commercial_eligible: boolean | null;
  chat_suggested_sold: boolean | null;
  followup_required: boolean | null;
  suggested_followup_reason: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  invoice_match_confidence: number | null;
  analysis_json: any;
  raw_text: string | null;
  source_filename: string | null;
  created_at: string | null;
};

const statusLabel: Record<string, string> = {
  new: 'جديدة',
  ready_quick: 'مراجعة سريعة',
  ready_detailed: 'مراجعة تفصيلية',
  needs_context: 'تحتاج بيانات',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
  archived: 'مؤرشفة',
};

const invoiceLabel: Record<string, string> = {
  pending: 'لم تُراجع',
  verified: 'مطابقة آلية قوية — غير مؤكدة رسميًا',
  probable: 'فاتورة مرجحة',
  not_found: 'لم توجد فاتورة',
  needs_review: 'تحتاج مراجعة',
  not_applicable: 'غير منطبق',
  rejected: 'تم رفض الربط',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function Metric({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-center">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

export default function WhatsAppReviewQueueV4() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [status, setStatus] = useState('pending');
  const [priority, setPriority] = useState('all');
  const [activeView, setActiveView] = useState<'queue' | 'doctors'>('queue');

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_review_sources')
        .select('id,branch,customer_name,customer_code,customer_phone,staff_name,conversation_started_at,conversation_ended_at,message_count,review_status,priority,analysis_confidence,service_score,commercial_score,commercial_eligible,chat_suggested_sold,followup_required,suggested_followup_reason,invoice_match_status,matched_invoice_number,matched_invoice_value,invoice_match_confidence,analysis_json,raw_text,source_filename,created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as QueueRow[]);
      setSelectedId((current) => current && (data || []).some((row: any) => row.id === current) ? current : String((data || [])[0]?.id || ''));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل قائمة مراجعة واتساب');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (priority !== 'all' && row.priority !== priority) return false;
      if (status === 'pending' && !['new', 'ready_quick', 'ready_detailed', 'needs_context'].includes(row.review_status)) return false;
      if (status !== 'all' && status !== 'pending' && row.review_status !== status) return false;
      if (!q) return true;
      return [row.customer_name, row.customer_code, row.customer_phone, row.staff_name, row.source_filename]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, search, branch, status, priority]);

  const selected = filtered.find((row) => row.id === selectedId) || filtered[0] || null;
  const stats = useMemo(() => ({
    total: filtered.length,
    urgent: filtered.filter((row) => row.priority === 'urgent').length,
    followup: filtered.filter((row) => row.followup_required).length,
    quick: filtered.filter((row) => row.review_status === 'ready_quick').length,
    detailed: filtered.filter((row) => row.review_status === 'ready_detailed').length,
    invoiceAutoStrong: filtered.filter((row) => row.invoice_match_status === 'verified').length,
  }), [filtered]);

  const model = selected?.analysis_json || {};
  const lostSales = Array.isArray(model?.lostSales) ? model.lostSales : [];
  const medicalFlags = Array.isArray(model?.medicalSafetyFlags) ? model.medicalSafetyFlags : [];
  const journeyStages = Array.isArray(model?.journeyStages) ? model.journeyStages : [];

  return (
    <div dir="rtl" className="space-y-5">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black text-violet-200">WhatsApp Review V4</div>
            <h1 className="mt-1 text-2xl font-black text-white">قائمة مراجعة المحادثات</h1>
            <p className="mt-2 text-sm text-slate-400">الأولوية، المتابعة، فرص البيع، الأمان الطبي ومطابقة الفاتورة في مكان واحد. حالة verified هنا مطابقة آلية إحصائية وليست إثبات بيع أو تأكيد فاتورة رسمي.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="المعروض" value={stats.total} />
          <Metric label="عاجلة" value={stats.urgent} tone="text-rose-300" />
          <Metric label="متابعة" value={stats.followup} tone="text-violet-300" />
          <Metric label="Quick Review" value={stats.quick} tone="text-emerald-300" />
          <Metric label="تفصيلية" value={stats.detailed} tone="text-amber-300" />
          <Metric label="مطابقة فاتورة آلية قوية" value={stats.invoiceAutoStrong} tone="text-cyan-300" />
        </div>
      </section>

      <section className="dawaa-card dawaa-card--soft p-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveView('queue')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${activeView === 'queue' ? 'bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40' : 'bg-slate-950/40 text-slate-400 hover:text-white'}`}
          >
            مراجعة المحادثات
          </button>
          <button
            type="button"
            onClick={() => setActiveView('doctors')}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${activeView === 'doctors' ? 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/35' : 'bg-slate-950/40 text-slate-400 hover:text-white'}`}
          >
            أداء الدكاترة والمبيعات
          </button>
        </div>
      </section>

      {activeView === 'queue' ? (
        <>
      <section className="dawaa-card dawaa-card--soft p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative xl:col-span-2">
            <Search size={16} className="absolute right-3 top-3 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالعميل، الكود، الهاتف أو الدكتور" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white" />
          </label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
            <option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
            <option value="pending">المعلقة فقط</option><option value="all">كل الحالات</option><option value="ready_quick">Quick Review</option><option value="ready_detailed">تفصيلية</option><option value="needs_context">تحتاج بيانات</option><option value="approved">معتمدة</option><option value="rejected">مرفوضة</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
            <option value="all">كل الأولويات</option><option value="urgent">عاجلة</option><option value="important">مهمة</option><option value="normal">عادية</option>
          </select>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="dawaa-card dawaa-card--soft max-h-[950px] space-y-2 overflow-y-auto p-3">
          <div className="flex items-center gap-2 px-1 pb-2 text-sm font-black text-white"><Filter size={15} />{filtered.length} جلسة</div>
          {filtered.map((row) => (
            <button key={row.id} onClick={() => setSelectedId(row.id)} className={`w-full rounded-2xl border p-3 text-right ${selected?.id === row.id ? 'border-violet-400/50 bg-violet-500/10' : 'border-slate-800 bg-slate-950/35 hover:border-slate-600'}`}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-black text-white">{row.customer_name || 'عميل غير محدد'}</div><div className="mt-1 text-[11px] text-slate-400">{row.staff_name || 'الدكتور غير محدد'} • {row.branch || 'فرع غير محدد'}</div></div><span className={`rounded-lg px-2 py-1 text-[10px] font-black ${row.priority === 'urgent' ? 'bg-rose-500/15 text-rose-200' : row.priority === 'important' ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/10 text-emerald-200'}`}>{row.priority === 'urgent' ? 'عاجلة' : row.priority === 'important' ? 'مهمة' : 'عادية'}</span></div>
              <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-300"><span>{statusLabel[row.review_status] || row.review_status}</span>{row.followup_required ? <span className="text-violet-300">• متابعة</span> : null}<span className="text-cyan-300">• {invoiceLabel[row.invoice_match_status || 'pending'] || row.invoice_match_status}</span></div>
              <div className="mt-2 text-[10px] text-slate-500">{formatDate(row.conversation_started_at)}</div>
            </button>
          ))}
          {!filtered.length ? <div className="p-8 text-center text-sm text-slate-500">لا توجد جلسات بهذه الفلاتر.</div> : null}
        </aside>

        <main className="space-y-4">
          {!selected ? <section className="dawaa-card dawaa-card--soft p-10 text-center text-slate-500">اختار جلسة من القائمة.</section> : <>
            <section className="dawaa-card dawaa-card--raised p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2 text-xl font-black text-white"><UserRound size={20}/>{selected.customer_name || 'عميل غير محدد'}</div><div className="mt-2 text-xs text-slate-400">{selected.customer_code ? `كود ${selected.customer_code} • ` : ''}{selected.customer_phone || ''}</div><div className="mt-1 text-xs text-slate-400">{selected.staff_name || 'الدكتور غير محدد'} • {selected.branch || 'الفرع غير محدد'} • {selected.message_count || 0} رسالة</div></div><div className="text-left text-xs text-slate-400">{formatDate(selected.conversation_started_at)}<br/>{statusLabel[selected.review_status] || selected.review_status}</div></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="ثقة التحليل" value={`${Math.round(Number(selected.analysis_confidence || 0))}%`} tone="text-cyan-300"/><Metric label="الخدمة" value={`${Math.round(Number(selected.service_score || 0))}%`} tone="text-sky-300"/><Metric label="البيع" value={`${Math.round(Number(selected.commercial_score || 0))}%`} tone="text-violet-300"/><Metric label="مطابقة الفاتورة" value={invoiceLabel[selected.invoice_match_status || 'pending'] || '—'} tone={selected.invoice_match_status === 'verified' ? 'text-cyan-300' : 'text-amber-300'}/><Metric label="قيمة الفاتورة" value={selected.matched_invoice_value ? `${Number(selected.matched_invoice_value).toFixed(2)} ج` : '—'} tone="text-emerald-300"/></div>
            </section>

            <section className="dawaa-card dawaa-card--soft p-4"><div className="font-black text-white">ملخص القرار</div><div className="mt-2 text-sm leading-7 text-slate-300">{model?.executiveSummary || 'لا يوجد ملخص محفوظ.'}</div>{selected.followup_required ? <div className="mt-3 rounded-xl border border-violet-400/25 bg-violet-500/10 p-3 text-sm text-violet-100"><Clock3 size={16} className="ml-2 inline"/>{selected.suggested_followup_reason || 'المتابعة مطلوبة'}</div> : null}</section>

            {lostSales.length ? <section className="rounded-2xl border border-rose-400/25 bg-rose-500/8 p-4"><div className="flex items-center gap-2 font-black text-rose-100"><ShoppingCart size={17}/>فرص بيع ضائعة/مهددة</div><div className="mt-2 space-y-2 text-sm text-rose-100/90">{lostSales.map((item: any, i: number) => <div key={i}>• {item.summary}</div>)}</div></section> : null}
            {medicalFlags.length ? <section className="rounded-2xl border border-amber-400/25 bg-amber-500/8 p-4"><div className="flex items-center gap-2 font-black text-amber-100"><ShieldAlert size={17}/>حواجز الأمان الطبي</div><div className="mt-2 space-y-2 text-sm text-amber-100/90">{medicalFlags.map((item: any, i: number) => <div key={i}>• {item.summary}</div>)}</div></section> : null}

            <section className="dawaa-card dawaa-card--soft p-4"><div className="font-black text-white">رحلة المحادثة</div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{journeyStages.map((stage: any) => <div key={stage.key} className={`rounded-xl border p-3 ${stage.detected ? 'border-emerald-400/20 bg-emerald-500/8' : 'border-slate-800 bg-slate-950/30 opacity-60'}`}><div className="text-sm font-black text-white">{stage.label}</div><div className="mt-1 text-xs leading-5 text-slate-400">{stage.reason}</div></div>)}</div></section>

            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>النص الأصلي</div><pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs leading-6 text-slate-300">{selected.raw_text || 'لا يوجد نص محفوظ.'}</pre></section>

            <section className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4 text-xs leading-6 text-cyan-100"><CheckCircle2 size={16} className="ml-2 inline"/>المستخدم الحالي: {String(user?.name || user?.username || 'غير محدد')}. زر الاعتماد النهائي سيظهر بعد إنشاء التقييم الرسمي وربطه بهذه الجلسة؛ لن يتم اعتماد Queue بدون سجل تقييم رسمي.</section>
          </>}
        </main>
      </div>
        </>
      ) : (
        <WhatsAppCycleEvidenceDashboardV17 mode="doctors" />
      )}
    </div>
  );
}
