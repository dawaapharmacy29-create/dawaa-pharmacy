import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, FileUp, Link2, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { linkCustomerRequestProduct } from '@/lib/api/productsCatalog';

type Candidate = {
  product_id: string;
  product_code: string;
  product_name: string;
  price: number | null;
  match_score: number;
  name_similarity: number;
  alias_confirmations: number;
  fulfilled_history: number;
  movement_qty_180: number;
  movement_events_180: number;
  last_movement_date: string | null;
  strength_match: boolean;
  form_match: boolean;
  blocked_reason: string | null;
  confidence_label: string;
};

type MatchRow = {
  id: string;
  order_number: string | null;
  medicine_name: string;
  quantity: number;
  branch: string | null;
  requested_at: string | null;
  best_score: number | null;
  score_gap: number;
  candidates: Candidate[];
};

type Queue = {
  total_unlinked: number;
  movement_evidence_rows: number;
  rows: MatchRow[];
};

type AutoPreview = {
  safe_suggestions: number;
  applied: number;
  mode: string;
  rows: Array<{ request_id: string; product_id: string; score: number; gap: number; reason: string }>;
};

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row);
  const wanted = aliases.map((x) => x.trim().toLowerCase());
  const found = entries.find(([key]) => wanted.includes(key.trim().toLowerCase()));
  return found?.[1];
}

function isReviewableCandidate(candidate: Candidate | undefined, scoreGap: number) {
  if (!candidate || candidate.blocked_reason) return false;
  return n(candidate.match_score) >= 78
    && n(candidate.name_similarity) >= 65
    && n(scoreGap) >= 8;
}

function movementDate(value: unknown) {
  if (value === null || value === undefined || value === '') return new Date().toISOString().slice(0, 10);
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

export default function CustomerRequestProductIntelligencePanel({ branch, onChanged }: { branch: string; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<Queue>({ total_unlinked: 0, movement_evidence_rows: 0, rows: [] });
  const [preview, setPreview] = useState<AutoPreview>({ safe_suggestions: 0, applied: 0, mode: 'preview', rows: [] });
  const [busyId, setBusyId] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const branchArg = branch === 'all' ? null : branch;
      const [{ data: queueData, error: queueError }, { data: previewData, error: previewError }] = await Promise.all([
        supabase.rpc('get_customer_request_product_match_queue_v2', { p_branch: branchArg, p_limit: 80 }),
        supabase.rpc('auto_link_customer_request_products_v2', { p_apply: false, p_branch: branchArg }),
      ]);
      if (queueError) throw new Error(queueError.message);
      if (previewError) throw new Error(previewError.message);
      setQueue((queueData || { total_unlinked: 0, movement_evidence_rows: 0, rows: [] }) as Queue);
      setPreview((previewData || { safe_suggestions: 0, applied: 0, mode: 'preview', rows: [] }) as AutoPreview);
    } catch (error) {
      toast.error(`تعذر تشغيل ذكاء ربط الأصناف: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const strongReview = useMemo(
    () => queue.rows.filter((row) => isReviewableCandidate(row.candidates[0], row.score_gap)),
    [queue.rows]
  );

  const applyCandidate = async (requestId: string, candidate: Candidate, scoreGap: number) => {
    if (candidate.blocked_reason) return toast.error(candidate.blocked_reason);
    if (!isReviewableCandidate(candidate, scoreGap)) {
      return toast.error('درجة المطابقة أو الفارق عن البديل غير كافيين للربط المباشر. استخدم مراجعة الصنف اليدوية بدل التخمين.');
    }
    setBusyId(requestId);
    try {
      await linkCustomerRequestProduct(requestId, candidate.product_id);
      toast.success(`تم ربط الصنف بالكود ${candidate.product_code}`);
      await load();
      onChanged();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId('');
    }
  };

  const applySafe = async () => {
    if (!preview.safe_suggestions) return toast.error('لا توجد روابط تلقائية تجاوزت بوابة الأمان حاليًا.');
    setBusyId('safe');
    try {
      const { data, error } = await supabase.rpc('auto_link_customer_request_products_v2', {
        p_apply: true,
        p_branch: branch === 'all' ? null : branch,
      });
      if (error) throw new Error(error.message);
      const result = data as AutoPreview;
      toast.success(`تم ربط ${n(result.applied).toLocaleString('ar-EG')} طلب بدقة عالية.`);
      await load();
      onChanged();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId('');
    }
  };

  const importMovement = async (file: File) => {
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('الملف لا يحتوي على شيت قابل للقراءة');
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
      const rows = rawRows.map((row, index) => ({
        product_code: String(pick(row, ['كود الصنف', 'الكود', 'code', 'product code', 'item code']) || '').trim(),
        quantity: n(pick(row, ['كمية الحركة', 'الكمية', 'كمية المبيعات', 'المبيعات', 'quantity', 'qty', 'sales qty', 'sold qty', 'movement'])),
        movement_date: movementDate(pick(row, ['تاريخ الحركة', 'التاريخ', 'date', 'movement date', 'sale date'])),
        branch: String(pick(row, ['الفرع', 'branch']) || '').trim(),
        movement_type: String(pick(row, ['نوع الحركة', 'movement type', 'type']) || 'sale').trim(),
        source_ref: `${file.name}:${index + 2}`,
      })).filter((row) => row.product_code && row.quantity !== 0);
      if (!rows.length) throw new Error('لم أجد أعمدة كود الصنف والكمية في الملف.');
      const { data, error } = await supabase.rpc('import_product_movement_evidence_v1', { p_rows: rows, p_source: file.name });
      if (error) throw new Error(error.message);
      const result = data as { imported?: number; rejected?: number };
      toast.success(`تم تحميل حركة ${n(result.imported).toLocaleString('ar-EG')} صف؛ المرفوض ${n(result.rejected).toLocaleString('ar-EG')}.`);
      await load();
    } catch (error) {
      toast.error(`تعذر استيراد حركة الأصناف: ${(error as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="rounded-3xl border border-violet-400/20 bg-violet-500/[0.045] p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><Sparkles size={19} className="text-violet-300" /> ذكاء ربط الصنف بالكود الصحيح</div>
          <div className="mt-1 max-w-4xl text-xs leading-6 text-slate-400">الترتيب لا يعتمد على تشابه الاسم فقط: يراجع الجرعة/التركيز والشكل الدوائي، فرق المرشح الأول عن الثاني، الربطات السابقة، الطلبات الناجحة، وحركة الصنف الفعلية عند توفرها. أي تعارض جرعة أو شكل دوائي يمنع الربط التلقائي.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMovement(file); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="inline-flex h-10 items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 text-xs font-black text-violet-100 hover:bg-violet-500/20">
            {importing ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} رفع حركة الأصناف
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200 hover:bg-slate-900"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> إعادة التحليل</button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="طلبات بلا كود" value={queue.total_unlinked} tone="amber" />
        <Metric label="مرشح قوي للمراجعة" value={strongReview.length} tone="violet" />
        <Metric label="تجاوز بوابة الربط الآمن" value={preview.safe_suggestions} tone={preview.safe_suggestions ? 'green' : 'slate'} />
        <Metric label="صفوف حركة موثقة" value={queue.movement_evidence_rows} tone={queue.movement_evidence_rows ? 'green' : 'slate'} />
      </div>

      {!queue.movement_evidence_rows && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-500/[0.055] p-3 text-[11px] leading-5 text-amber-100">
          <Activity size={15} className="mt-0.5 shrink-0" />
          <span>قاعدة البيانات الحالية لا تحتوي حركة بيع تفصيلية على مستوى الصنف؛ فواتير المبيعات الموجودة هي رؤوس فواتير فقط. لذلك لن أدّعي أن كودًا «عليه حركة» بدون دليل. ارفع تقرير حركة الأصناف بالكود والكمية، وسيصبح النشاط الفعلي جزءًا مباشرًا من Score والربط الآمن.</span>
        </div>
      )}

      {!!preview.safe_suggestions && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.055] p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-xs font-bold text-emerald-100"><CheckCircle2 size={15} className="ml-2 inline" />{preview.safe_suggestions.toLocaleString('ar-EG')} روابط اجتازت الجرعة والشكل والـScore والفارق عن البديل، ومعها دليل حركة/تاريخ مؤكد.</div>
          <button type="button" onClick={() => void applySafe()} disabled={busyId === 'safe'} className="h-9 rounded-xl bg-emerald-500/15 px-4 text-xs font-black text-emerald-100 ring-1 ring-emerald-400/25 hover:bg-emerald-500/25">{busyId === 'safe' ? 'جاري الربط…' : 'تطبيق الروابط الآمنة'}</button>
        </div>
      )}

      {loading ? (
        <div className="flex h-36 items-center justify-center"><Loader2 className="animate-spin text-violet-300" /></div>
      ) : queue.rows.length ? (
        <div className="mt-4 space-y-2">
          {queue.rows.slice(0, 40).map((row) => {
            const best = row.candidates[0];
            const reviewable = isReviewableCandidate(best, row.score_gap);
            return (
              <div key={row.id} className="rounded-2xl border border-slate-700 bg-slate-950/45 p-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-black text-white">{row.medicine_name}</span><span className="text-[10px] font-black text-slate-500">{row.order_number || 'بدون رقم'}</span><span className="rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-black text-slate-300">{row.branch || 'بدون فرع'}</span></div>
                    {best ? (
                      <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/55 p-3">
                        <div className="flex flex-wrap items-center gap-2"><Link2 size={14} className="text-cyan-300" /><strong className="text-cyan-100">{best.product_name}</strong><span className="font-mono text-xs font-black text-emerald-300">#{best.product_code}</span><Score value={best.match_score} /></div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black">
                          <Badge ok={best.strength_match} text={best.strength_match ? 'الجرعة متوافقة' : 'تعارض جرعة'} />
                          <Badge ok={best.form_match} text={best.form_match ? 'الشكل متوافق' : 'تعارض شكل'} />
                          <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">تشابه الاسم {n(best.name_similarity).toFixed(0)}%</span>
                          <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">فارق البديل {n(row.score_gap).toFixed(1)}</span>
                          {!!best.alias_confirmations && <span className="rounded-lg bg-cyan-500/10 px-2 py-1 text-cyan-200">ربطات سابقة {best.alias_confirmations}</span>}
                          {!!best.fulfilled_history && <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-200">طلبات ناجحة {best.fulfilled_history}</span>}
                          {!!best.movement_events_180 && <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-200">حركة 180 يوم: {n(best.movement_qty_180).toLocaleString('ar-EG')}</span>}
                        </div>
                        {best.blocked_reason && <div className="mt-2 flex items-center gap-1.5 text-[11px] font-black text-red-200"><AlertTriangle size={12} />{best.blocked_reason}</div>}
                      </div>
                    ) : <div className="mt-2 text-xs font-bold text-amber-200">لا يوجد مرشح قوي من الكتالوج الحالي.</div>}
                  </div>
                  {best && reviewable ? (
                    <button type="button" onClick={() => void applyCandidate(row.id, best, row.score_gap)} disabled={busyId === row.id} className="h-10 shrink-0 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-4 text-xs font-black text-cyan-100 hover:bg-cyan-500/20">{busyId === row.id ? 'جاري الربط…' : `اعتماد #${best.product_code}`}</button>
                  ) : best ? (
                    <div className="shrink-0 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-[11px] font-black text-[var(--dawaa-status-warning-text)]">مطابقة غير كافية — يحتاج بحث يدوي</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="mt-4 rounded-xl bg-emerald-500/[0.05] p-5 text-center text-sm font-black text-emerald-200">كل الطلبات مرتبطة بأصناف.</div>}
    </section>
  );
}

function Score({ value }: { value: number }) {
  const score = n(value);
  const cls = score >= 90 ? 'bg-emerald-500/15 text-emerald-200' : score >= 78 ? 'bg-violet-500/15 text-violet-200' : score >= 65 ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-400';
  return <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${cls}`}>Score {score.toFixed(1)}</span>;
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`rounded-lg px-2 py-1 ${ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'}`}>{text}</span>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'green' | 'amber' | 'violet' | 'slate' }) {
  const tones = { green: 'border-emerald-400/20 bg-emerald-500/[0.055] text-emerald-200', amber: 'border-amber-400/20 bg-amber-500/[0.055] text-amber-200', violet: 'border-violet-400/20 bg-violet-500/[0.055] text-violet-200', slate: 'border-slate-700 bg-slate-950/40 text-slate-300' };
  return <div className={`rounded-xl border p-3 ${tones[tone]}`}><div className="text-[10px] font-black opacity-80">{label}</div><div className="mt-1 text-2xl font-black">{n(value).toLocaleString('ar-EG')}</div></div>;
}
