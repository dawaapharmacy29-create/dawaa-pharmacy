import { useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, ShieldCheck, Upload, Workflow, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';
import { parseMatrix, type SmartQueueImportRow } from '@/components/customerService/SmartQueueExcelImportModal';

type ImportSummary = { total: number; imported: number; updated?: number; duplicates: number; skipped: number };

type Preview = {
  fileName: string;
  sourceSheets: string[];
  rows: SmartQueueImportRow[];
};

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => text(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\s_\-/—–]+/g, '');

function isResultsSheet(matrix: unknown[][]) {
  return matrix.some((row) => {
    const cells = row.map(norm);
    return cells.includes(norm('اسم العميل')) && cells.includes(norm('تمت المتابعة'));
  });
}

function rowIdentity(row: SmartQueueImportRow) {
  return `${row.branch}|${row.sourceFollowupId || `${row.queueType}|${row.customerCode || row.phone || row.customerName}`}`.toLowerCase();
}

export default function CustomerServiceDoctorWorkbookCenter({ onImported }: { onImported?: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const readyRows = useMemo(() => preview?.rows.filter((row) => row.followedUp) || [], [preview]);
  const incompleteRows = useMemo(() => readyRows.filter((row) => row.notes.trim().length < 10 || (row.needsNextFollowup && !row.nextFollowupDate)), [readyRows]);
  const safeRows = useMemo(() => readyRows.filter((row) => row.notes.trim().length >= 10 && (!row.needsNextFollowup || Boolean(row.nextFollowupDate))), [readyRows]);

  async function readFile(file: File) {
    setLoading(true);
    setSummary(null);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const matrices = book.SheetNames.map((name) => ({
        name,
        matrix: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: true }),
      }));

      const master = matrices.find((sheet) => ['خطهاليوم', 'تنفيذاليوم', 'المتابعهاليوميه'].includes(norm(sheet.name)) && isResultsSheet(sheet.matrix));
      const selected = master ? [master] : matrices.filter((sheet) => isResultsSheet(sheet.matrix));
      if (!selected.length) throw new Error('لم يتم العثور على شيت تنفيذ يحتوي على: اسم العميل + تمت المتابعة.');

      const parsed = selected.flatMap(({ matrix }) => parseMatrix(matrix));
      const branchFallback = managerView ? '' : userBranch;
      const normalized = parsed.map((row) => ({ ...row, branch: normalizeBranchName(row.branch || branchFallback) }));
      const deduped = [...new Map(normalized.map((row) => [rowIdentity(row), row])).values()];

      if (deduped.some((row) => !['فرع الشامي', 'فرع شكري'].includes(row.branch))) {
        throw new Error('يوجد صف بدون فرع صحيح. استخدم ملف فرع منفصل أو تأكد من عدم حذف عمود الفرع.');
      }

      setPreview({ fileName: file.name, sourceSheets: selected.map((sheet) => sheet.name), rows: deduped });
      toast.success(`تمت قراءة ${deduped.length} مهمة بدون تكرار من ${selected.map((s) => s.name).join('، ')}`);
    } catch (error) {
      setPreview(null);
      toast.error(`تعذر قراءة الملف: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function importReadyRows() {
    if (!user?.id || !preview || !safeRows.length) return;
    if (incompleteRows.length) {
      toast.error(`يوجد ${incompleteRows.length} متابعة منفذة ناقصة البيانات. أكمل الملاحظات/الموعد ثم أعد رفع الملف.`);
      return;
    }
    if (!window.confirm(`سيتم تسجيل ${safeRows.length} متابعة منفذة فقط. هل تريد الاستمرار؟`)) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('import_customer_service_queue_results_v4', {
        p_actor_id: user.id,
        p_branch: managerView ? 'كل الفروع' : userBranch,
        p_file_name: preview.fileName,
        p_rows: safeRows,
      });
      if (error) throw error;
      const result = data as ImportSummary;
      setSummary(result);
      toast.success(`تم تسجيل ${result.imported} · تحديث ${result.updated || 0} · مكرر ${result.duplicates} · متوقف ${result.skipped}`);
      window.dispatchEvent(new CustomEvent('customer-followup-imported'));
      onImported?.();
    } catch (error) {
      toast.error(`تعذر الاستيراد: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return <section className="mx-4 mt-4 rounded-3xl border border-cyan-300/15 bg-[#0b2035] p-4 shadow-xl md:p-5" dir="rtl">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <p className="text-xs font-black text-cyan-300">مسار عمل الدكاترة</p>
        <h2 className="mt-1 text-xl font-black text-white">ملف اليوم → تنفيذ → مراجعة → استيراد النتائج</h2>
        <p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-slate-400">الدكتور يشتغل في شيت «تنفيذ اليوم» فقط ويملأ الخانات المخصصة للنتيجة. صفحات النقاط و+500 والاستثنائي والتراجع والنشاط تبقى مرجعًا سريعًا، والاستيراد يسجل المنفذ فقط.</p>
      </div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300">
        <Upload size={17}/>{loading ? 'جارٍ فحص الملف...' : 'استيراد نتائج ملف الدكاترة'}
        <input type="file" accept=".xlsx,.xls" className="hidden" disabled={loading} onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}/>
      </label>
    </div>

    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {[
        [Workflow, '1. ابدأ بالأولوية', 'الاستثنائي ثم خطر الفقد والتراجع ثم +500 ثم النمو والنقاط.'],
        [FileSpreadsheet, '2. سجّل النتيجة فقط', 'تمت المتابعة، الرد، الشراء، المتابعة القادمة والملاحظات.'],
        [ShieldCheck, '3. راجع الجاهزية', 'ملاحظة واضحة 10 حروف على الأقل، وموعد لو توجد متابعة أخرى.'],
        [CheckCircle2, '4. استورد للتطبيق', 'يتم تسجيل المنفذ فقط وتحديث الطلب الاستثنائي الأصلي بدل تكراره.'],
      ].map(([Icon, title, desc]) => {
        const I = Icon as typeof Workflow;
        return <div key={String(title)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="flex items-center gap-2 text-sm font-black text-white"><I size={17} className="text-cyan-300"/>{String(title)}</div><p className="mt-2 text-xs font-bold leading-5 text-slate-400">{String(desc)}</p></div>;
      })}
    </div>

    {preview ? <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="font-black text-white">{preview.fileName}</div><div className="mt-1 text-xs font-bold text-slate-400">مصدر القراءة: {preview.sourceSheets.join('، ')}</div></div>
        <button type="button" onClick={() => setPreview(null)} className="rounded-xl border border-white/10 p-2 text-slate-300"><XCircle size={17}/></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-xl bg-white/5 p-3 text-center"><div className="text-[11px] font-bold text-slate-400">كل المهام</div><div className="mt-1 text-xl font-black text-white">{preview.rows.length}</div></div>
        <div className="rounded-xl bg-emerald-400/10 p-3 text-center"><div className="text-[11px] font-bold text-emerald-200">منفذ</div><div className="mt-1 text-xl font-black text-white">{readyRows.length}</div></div>
        <div className="rounded-xl bg-rose-400/10 p-3 text-center"><div className="text-[11px] font-bold text-rose-200">ناقص بيانات</div><div className="mt-1 text-xl font-black text-white">{incompleteRows.length}</div></div>
        <div className="rounded-xl bg-cyan-400/10 p-3 text-center"><div className="text-[11px] font-bold text-cyan-200">جاهز للتسجيل</div><div className="mt-1 text-xl font-black text-white">{safeRows.length}</div></div>
      </div>
      {incompleteRows.length ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">لن يتم الاستيراد قبل استكمال {incompleteRows.length} صف منفذ ناقص الملاحظات أو موعد المتابعة القادمة.</div> : null}
      <div className="mt-3 flex justify-end"><button type="button" onClick={() => void importReadyRows()} disabled={loading || !safeRows.length || !!incompleteRows.length} className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="ml-1 inline" size={16}/> تسجيل النتائج في التطبيق</button></div>
      {summary ? <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-black text-emerald-100">تم: {summary.imported} · تحديث: {summary.updated || 0} · مكرر: {summary.duplicates} · متوقف: {summary.skipped}</div> : null}
    </div> : null}
  </section>;
}
