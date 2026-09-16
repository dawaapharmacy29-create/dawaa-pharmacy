import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpLeft, CheckCircle2, Clock3, ImageOff, RefreshCw, ReceiptText, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type CaseRow = {
  id: string;
  root_source_id: string;
  customer_name: string | null;
  customer_code: string | null;
  branch: string | null;
  case_type: 'order' | 'complaint' | 'recommendation' | 'followup' | 'mixed';
  case_state: 'open' | 'awaiting_customer' | 'awaiting_pharmacy' | 'confirmed_order' | 'failed' | 'recovery' | 'reengaged' | 'closed';
  started_at: string;
  last_event_at: string;
  session_count: number;
  staff_names: string[] | null;
  media_referenced: number;
  media_available: number;
  media_missing: number;
  media_coverage_percent: number;
  needs_human_review: boolean;
  next_action: string | null;
  summary: string | null;
  is_open: boolean;
  hours_since_last_event: number;
  work_bucket: 'recovery' | 'pharmacy_action' | 'customer_followup' | 'monitor';
  effective_outcome: string | null;
  outcome_source: 'human_confirmed' | 'invoice_verified' | 'ai_proposed' | null;
  outcome_confidence: number | null;
  effective_lost_reason: string | null;
  lost_reason_source: 'human_confirmed' | 'ai_proposed' | 'none' | null;
  lost_reason_confidence: number | null;
  commercial_opportunity: boolean;
  verified_revenue: number | null;
  verified_invoice_number: string | null;
  responsibility_status?: string | null;
  responsibility_note?: string | null;
};

const stateLabel: Record<CaseRow['case_state'], string> = {
  open: 'مفتوحة', awaiting_customer: 'بانتظار العميل', awaiting_pharmacy: 'بانتظار الصيدلية', confirmed_order: 'أوردر مؤكد', failed: 'متعثر', recovery: 'استرجاع', reengaged: 'عاد للتفاعل', closed: 'مغلقة',
};
const typeLabel: Record<CaseRow['case_type'], string> = {
  order: 'طلب', complaint: 'شكوى/تعثر', recommendation: 'ترشيح', followup: 'متابعة', mixed: 'متعددة المراحل',
};
const outcomeLabel: Record<string, string> = {
  verified_sale: 'بيع مؤكد بالفاتورة', order_confirmed_waiting_invoice: 'أوردر مؤكد — ينتظر الفاتورة', customer_reengaged: 'العميل عاد للتفاعل', followup_needed: 'متابعة مطلوبة', awaiting_pharmacy: 'بانتظار الصيدلية', awaiting_customer: 'بانتظار العميل', lost_opportunity: 'فرصة مفقودة', complaint_resolved: 'الشكوى تم حلها', open: 'قيد المتابعة',
};
const lostReasonLabel: Record<string, string> = {
  unavailable: 'الصنف غير متوفر', delivery_or_fulfillment_failure: 'تعثر التوصيل/التنفيذ', price_objection: 'اعتراض على السعر', no_response_after_followup: 'لم يرد بعد المتابعة', not_interested: 'غير مهتم', alternative_rejected: 'البديل غير مقبول', other: 'سبب آخر',
};
const responsibilityLabel: Record<string, string> = {
  unreviewed: 'لم تُراجع المسؤولية', reviewed_no_fault: 'لا يوجد خطأ منسوب لموظف', reviewed_process_issue: 'مشكلة في العملية/التنفيذ', reviewed_staff_issue: 'تحتاج مراجعة أداء موظف',
};

function tone(state: CaseRow['case_state']) {
  if (state === 'failed' || state === 'recovery') return 'border-rose-400/30 bg-rose-500/5';
  if (state === 'awaiting_pharmacy') return 'border-amber-400/30 bg-amber-500/5';
  if (state === 'confirmed_order' || state === 'reengaged') return 'border-emerald-400/25 bg-emerald-500/5';
  return 'border-slate-800 bg-slate-950/30';
}
function sourceLabel(source: CaseRow['outcome_source']) {
  if (source === 'invoice_verified') return 'فاتورة مؤكدة';
  if (source === 'human_confirmed') return 'مراجعة بشرية';
  return 'تحليل مبدئي';
}

export default function WhatsAppCustomerCasesV22({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'open' | 'recovery' | 'pharmacy' | 'customer' | 'media' | 'sales' | 'all'>('open');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [draftOutcome, setDraftOutcome] = useState('open');
  const [draftLostReason, setDraftLostReason] = useState('');
  const [draftResponsibility, setDraftResponsibility] = useState('unreviewed');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_customer_case_queue_v23')
        .select('id,root_source_id,customer_name,customer_code,branch,case_type,case_state,started_at,last_event_at,session_count,staff_names,media_referenced,media_available,media_missing,media_coverage_percent,needs_human_review,next_action,summary,is_open,hours_since_last_event,work_bucket,effective_outcome,outcome_source,outcome_confidence,effective_lost_reason,lost_reason_source,lost_reason_confidence,commercial_opportunity,verified_revenue,verified_invoice_number,responsibility_status,responsibility_note')
        .order('last_event_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data || []) as CaseRow[]);
    } catch (error) {
      console.warn('[whatsapp-case-v23] failed to load customer case board', error);
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openReview = (row: CaseRow) => {
    setReviewingId(row.id);
    setDraftOutcome(row.effective_outcome || 'open');
    setDraftLostReason(row.effective_lost_reason || '');
    setDraftResponsibility(row.responsibility_status || 'unreviewed');
    setDraftNote(row.responsibility_note || '');
  };

  const saveReview = async (row: CaseRow) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('dawaa_review_whatsapp_case_v23', {
        p_case_id: row.id,
        p_confirmed_outcome: draftOutcome,
        p_confirmed_lost_reason: draftLostReason || null,
        p_responsibility_status: draftResponsibility,
        p_responsibility_note: draftNote || null,
      });
      if (error) throw error;
      toast.success('تم اعتماد نتيجة الـCase وتسجيل القرار في سجل المراجعة');
      setReviewingId(null);
      await load();
    } catch (error: any) {
      const message = String(error?.message || 'تعذر اعتماد النتيجة');
      if (message.includes('verified_sale_requires_invoice')) toast.error('لا يمكن اعتماد بيع مؤكد بدون فاتورة مرتبطة فعليًا.');
      else if (message.includes('lost_opportunity_requires_reason')) toast.error('اختار سبب فقد الفرصة قبل الاعتماد.');
      else toast.error('تعذر اعتماد النتيجة؛ تأكد من صلاحية المراجعة والبيانات.');
    } finally { setSaving(false); }
  };

  const summary = useMemo(() => ({
    open: rows.filter((x) => x.is_open).length,
    recovery: rows.filter((x) => x.work_bucket === 'recovery').length,
    pharmacy: rows.filter((x) => x.work_bucket === 'pharmacy_action').length,
    customer: rows.filter((x) => x.work_bucket === 'customer_followup').length,
    media: rows.filter((x) => x.media_missing > 0).length,
    sales: rows.filter((x) => x.effective_outcome === 'verified_sale').length,
  }), [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    if (filter === 'open') return row.is_open;
    if (filter === 'recovery') return row.work_bucket === 'recovery';
    if (filter === 'pharmacy') return row.work_bucket === 'pharmacy_action';
    if (filter === 'customer') return row.work_bucket === 'customer_followup';
    if (filter === 'media') return row.media_missing > 0;
    if (filter === 'sales') return row.effective_outcome === 'verified_sale';
    return true;
  }), [rows, filter]);

  const chips: Array<[typeof filter, string, number]> = [
    ['open', 'مفتوحة', summary.open], ['recovery', 'Recovery', summary.recovery], ['pharmacy', 'بانتظار الصيدلية', summary.pharmacy], ['customer', 'بانتظار العميل', summary.customer], ['sales', 'بيع مؤكد', summary.sales], ['media', 'ميديا ناقصة', summary.media], ['all', 'الكل', rows.length],
  ];

  return (
    <section className="dawaa-card dawaa-card--raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs font-black text-cyan-200">Customer Cases V23</div><div className="mt-1 text-xl font-black text-white">الحالات التشغيلية + النتيجة التجارية</div><div className="mt-1 text-xs leading-6 text-slate-400">الـOutcome وسبب فقد الفرصة يظهران بمصدر الدليل. لا توجد مسؤولية أو خصومات رسمية تلقائية.</div></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-black text-slate-200 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'ml-1 inline animate-spin' : 'ml-1 inline'} /> تحديث</button>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{chips.map(([key, label, count]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-black ${filter === key ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 bg-slate-950/30 text-slate-400'}`}>{label} <span className="mr-1 text-white">{count.toLocaleString('ar-EG')}</span></button>)}</div>

      <div className="mt-4 space-y-2">
        {filtered.slice(0, 80).map((row) => (
          <div key={row.id} className={`rounded-2xl border p-3 ${tone(row.case_state)}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-white">{row.customer_name || 'عميل غير محدد'}</span>{row.customer_code ? <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300">{row.customer_code}</span> : null}<span className="text-[11px] text-cyan-300">{typeLabel[row.case_type]}</span><span className="text-[11px] font-black text-slate-200">{stateLabel[row.case_state]}</span></div><div className="mt-1 text-[11px] text-slate-500">{row.branch || 'فرع غير محدد'} • آخر حدث {new Date(row.last_event_at).toLocaleString('ar-EG')} • {row.session_count} جلسة</div></div><div className="flex items-center gap-2">{row.needs_human_review ? <span title="تحتاج مراجعة بشرية"><AlertTriangle size={16} className="text-amber-300" /></span> : <CheckCircle2 size={16} className="text-emerald-300" />}{onOpenSource ? <button type="button" onClick={() => onOpenSource(row.root_source_id)} className="rounded-lg border border-slate-700 bg-slate-950/40 p-2 text-cyan-200" title="فتح المحادثة الأصلية"><ArrowUpLeft size={15} /></button> : null}</div></div>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2 text-xs"><div className="text-[10px] text-slate-500">النتيجة</div><div className="mt-1 font-black text-white">{outcomeLabel[row.effective_outcome || ''] || row.effective_outcome || 'غير محسومة'}</div><div className="mt-1 text-[10px] text-slate-400">{sourceLabel(row.outcome_source)}{row.outcome_confidence != null && row.outcome_source === 'ai_proposed' ? ` • ثقة ${Math.round(Number(row.outcome_confidence))}%` : ''}</div>{row.effective_outcome === 'verified_sale' ? <div className="mt-1 flex items-center gap-1 text-emerald-300"><ReceiptText size={12} /> {Number(row.verified_revenue || 0).toLocaleString('ar-EG')} ج{row.verified_invoice_number ? ` • فاتورة ${row.verified_invoice_number}` : ''}</div> : null}</div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2 text-xs"><div className="text-[10px] text-slate-500">سبب الفقد/التعثر</div><div className="mt-1 font-black text-white">{row.effective_lost_reason ? (lostReasonLabel[row.effective_lost_reason] || row.effective_lost_reason) : 'لا يوجد سبب مثبت'}</div>{row.effective_lost_reason ? <div className="mt-1 text-[10px] text-slate-400">{row.lost_reason_source === 'human_confirmed' ? 'مراجعة بشرية' : 'اقتراح تحليلي'}{row.lost_reason_confidence != null && row.lost_reason_source === 'ai_proposed' ? ` • ثقة ${Math.round(Number(row.lost_reason_confidence))}%` : ''}</div> : null}</div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{(row.staff_names || []).length ? <span className="text-emerald-300">الموظفون: {(row.staff_names || []).join('، ')}</span> : null}{row.commercial_opportunity ? <span className="text-cyan-300">• فرصة تجارية</span> : null}{row.media_missing > 0 ? <span className="flex items-center gap-1 text-amber-300"><ImageOff size={12} /> ميديا ناقصة {row.media_missing}/{row.media_referenced}</span> : null}{row.is_open ? <span className="flex items-center gap-1 text-violet-300"><Clock3 size={12} /> مفتوحة منذ آخر حدث {Math.max(0, Math.round(Number(row.hours_since_last_event || 0)))} س</span> : null}</div>
            {row.next_action ? <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/35 px-3 py-2 text-xs leading-6 text-slate-300">التالي: {row.next_action}</div> : null}

            <div className="mt-2 flex justify-end"><button type="button" onClick={() => reviewingId === row.id ? setReviewingId(null) : openReview(row)} className="rounded-lg border border-violet-400/25 bg-violet-500/5 px-3 py-1.5 text-[11px] font-black text-violet-100">{reviewingId === row.id ? 'إغلاق المراجعة' : 'مراجعة النتيجة'}</button></div>
            {reviewingId === row.id ? <div className="mt-2 grid gap-2 rounded-2xl border border-violet-400/20 bg-slate-950/45 p-3 md:grid-cols-2">
              <label className="text-[11px] text-slate-400">النتيجة المعتمدة<select value={draftOutcome} onChange={(e) => setDraftOutcome(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white">{Object.entries(outcomeLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-[11px] text-slate-400">سبب الفقد/التعثر<select value={draftLostReason} onChange={(e) => setDraftLostReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white"><option value="">بدون سبب معتمد</option>{Object.entries(lostReasonLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-[11px] text-slate-400">مراجعة المسؤولية<select value={draftResponsibility} onChange={(e) => setDraftResponsibility(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white">{Object.entries(responsibilityLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-[11px] text-slate-400">ملاحظة المراجع<input value={draftNote} onChange={(e) => setDraftNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white" placeholder="اختياري — لماذا تم اعتماد النتيجة؟" /></label>
              <div className="md:col-span-2 flex justify-end"><button type="button" disabled={saving} onClick={() => void saveReview(row)} className="rounded-xl bg-violet-500/20 px-4 py-2 text-xs font-black text-violet-100 disabled:opacity-50"><Save size={14} className="ml-1 inline" /> اعتماد وتوثيق</button></div>
            </div> : null}
          </div>
        ))}
        {!loading && filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">لا توجد حالات في الفلتر الحالي.</div> : null}
      </div>
      {filtered.length > 80 ? <div className="mt-3 text-center text-xs text-slate-500">يعرض أول 80 حالة حسب آخر نشاط.</div> : null}
    </section>
  );
}
