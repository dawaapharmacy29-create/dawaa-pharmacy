import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export type SmartQueueImportRow = {
  rowNumber: number;
  queueType: string;
  branch: string;
  customerName: string;
  customerCode: string;
  phone: string;
  invoiceAmount: number;
  pointsBalance: number;
  followedUp: boolean;
  responded: boolean;
  responseRaw: string;
  purchaseAfterFollowup: boolean;
  purchaseAmount: number;
  needsNextFollowup: boolean;
  nextFollowupDate: string;
  notes: string;
};

type ImportSummary = { total: number; imported: number; duplicates: number; skipped: number };

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => text(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\s_\-/—–]+/g, '');
const yes = (value: unknown) => ['نعم', 'yes', 'y', 'true', 'تم', 'اه', 'ايوه'].includes(norm(value));
const no = (value: unknown) => ['لا', 'no', 'n', 'false', 'لم', 'لميرد'].includes(norm(value));
const numberValue = (value: unknown) => {
  const n = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
function excelDate(value: unknown) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const d = new Date(text(value));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function col(headers: unknown[], aliases: string[]) {
  const h = headers.map(norm);
  for (const alias of aliases) {
    const index = h.indexOf(norm(alias));
    if (index >= 0) return index;
  }
  return -1;
}
function queueCode(value: unknown) {
  const v = norm(value);
  if (v.includes('vip') || v.includes('اهم90') || v.includes('اهمعميل')) return 'vip_recent';
  if (v.includes('500')) return 'plus500';
  if (v.includes('نقاط')) return 'points';
  if (v.includes('نشاط') || v.includes('متراجع') || v.includes('متحسن')) return 'activity';
  return text(value) || 'other';
}

function parseMatrix(matrix: unknown[][]): SmartQueueImportRow[] {
  const headerIndex = matrix.findIndex((row) => row.map(norm).includes(norm('اسم العميل')) && row.map(norm).includes(norm('تمت المتابعة')));
  if (headerIndex < 0) throw new Error('لم يتم العثور على صف العناوين. استخدم ملف التصدير من التطبيق.');
  const headers = matrix[headerIndex] || [];
  const ix = {
    queue: col(headers, ['نوع القائمة', 'القائمة', 'نوع المتابعة']),
    branch: col(headers, ['الفرع']),
    name: col(headers, ['اسم العميل', 'العميل']),
    code: col(headers, ['كود العميل', 'الكود']),
    phone: col(headers, ['الهاتف', 'الموبايل']),
    invoice: col(headers, ['قيمة الفاتورة', 'قيمة الفواتير', 'اجمالي الفاتورة']),
    points: col(headers, ['رصيد النقاط', 'النقاط']),
    followed: col(headers, ['تمت المتابعة', 'تم المتابعة']),
    responded: col(headers, ['تم الرد', 'رد العميل؟']),
    response: col(headers, ['رد العميل', 'تفاصيل الرد']),
    purchase: col(headers, ['عملية شراء', 'تمت عملية شراء']),
    purchaseAmount: col(headers, ['قيمة عملية الشراء', 'قيمة الشراء بعد المتابعة']),
    needsNext: col(headers, ['هل يحتاج متابعة أخرى', 'يحتاج متابعة اخرى']),
    nextDate: col(headers, ['موعد المتابعة القادمة', 'موعد المتابعة الاخرى', 'موعد المتابعة التالي']),
    notes: col(headers, ['ملاحظات', 'الملاحظات']),
  };
  if (ix.name < 0 || ix.code < 0 || ix.followed < 0) throw new Error('الأعمدة الأساسية غير موجودة: اسم العميل، الكود، تمت المتابعة.');

  return matrix.slice(headerIndex + 1).flatMap((row, offset) => {
    const customerName = text(row[ix.name]);
    const customerCode = text(row[ix.code]);
    if (!customerName && !customerCode) return [];
    const responseRaw = ix.response >= 0 ? text(row[ix.response]) : ix.responded >= 0 ? text(row[ix.responded]) : '';
    const followedUp = yes(row[ix.followed]);
    const respondedFlag = ix.responded >= 0 ? row[ix.responded] : responseRaw;
    return [{
      rowNumber: headerIndex + offset + 2,
      queueType: ix.queue >= 0 ? queueCode(row[ix.queue]) : 'other',
      branch: ix.branch >= 0 ? text(row[ix.branch]) : '',
      customerName,
      customerCode,
      phone: ix.phone >= 0 ? text(row[ix.phone]) : '',
      invoiceAmount: ix.invoice >= 0 ? numberValue(row[ix.invoice]) : 0,
      pointsBalance: ix.points >= 0 ? numberValue(row[ix.points]) : 0,
      followedUp,
      responded: yes(respondedFlag) || (!!text(respondedFlag) && !no(respondedFlag) && followedUp),
      responseRaw,
      purchaseAfterFollowup: ix.purchase >= 0 ? yes(row[ix.purchase]) : false,
      purchaseAmount: ix.purchaseAmount >= 0 ? numberValue(row[ix.purchaseAmount]) : 0,
      needsNextFollowup: ix.needsNext >= 0 ? yes(row[ix.needsNext]) : false,
      nextFollowupDate: ix.nextDate >= 0 ? excelDate(row[ix.nextDate]) : '',
      notes: ix.notes >= 0 ? text(row[ix.notes]) : '',
    }];
  });
}

export default function SmartQueueExcelImportModal({ open, onClose, onImported, branch }: { open: boolean; onClose: () => void; onImported: () => void; branch: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<SmartQueueImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const counts = useMemo(() => ({
    total: rows.length,
    followed: rows.filter((r) => r.followedUp).length,
    responded: rows.filter((r) => r.responded).length,
    points: rows.filter((r) => r.queueType === 'points').length,
    vip: rows.filter((r) => r.queueType === 'vip_recent').length,
    plus500: rows.filter((r) => r.queueType === 'plus500').length,
  }), [rows]);
  if (!open) return null;

  async function readFile(file: File) {
    setLoading(true); setSummary(null);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const preferred = book.SheetNames.find((name) => norm(name).includes(norm('المتابعة اليومية'))) || book.SheetNames[0];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[preferred], { header: 1, defval: '', raw: true });
      const parsed = parseMatrix(matrix).map((row) => ({ ...row, branch: row.branch || (branch === 'كل الفروع' ? '' : branch) }));
      setRows(parsed); setFileName(file.name);
      toast.success(`تمت قراءة ${parsed.length} صف متابعة`);
    } catch (error) {
      setRows([]); toast.error(`تعذر قراءة الملف: ${(error as Error).message}`);
    } finally { setLoading(false); }
  }

  async function importRows() {
    if (!rows.length || !user?.id) return;
    const invalidBranch = rows.some((row) => !['فرع شكري', 'فرع الشامي'].includes(row.branch));
    if (invalidBranch) return toast.error('يوجد صف بدون فرع صحيح. استخدم ملف التصدير من التطبيق دون حذف عمود الفرع.');
    if (!window.confirm(`سيتم تسجيل نتائج ${rows.length} صف في سجل المتابعات. هل تريد المتابعة؟`)) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('import_customer_service_queue_results_v2', {
        p_actor_id: user.id,
        p_branch: branch,
        p_file_name: fileName,
        p_rows: rows,
      });
      if (error) throw error;
      const result = data as ImportSummary;
      setSummary(result);
      toast.success(`تم استيراد ${result.imported} · مكرر ${result.duplicates} · متوقف ${result.skipped}`);
      window.dispatchEvent(new CustomEvent('customer-followup-imported'));
      onImported();
    } catch (error) {
      toast.error(`تعذر الاستيراد: ${(error as Error).message}`);
    } finally { setLoading(false); }
  }

  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4" dir="rtl">
    <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-cyan-300/15 bg-[#0d2038] p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-xl font-black text-white">استيراد نتائج القوائم الذكية</h2><p className="mt-1 text-sm font-bold text-slate-400">يدعم VIP آخر 90 يوم، +500، والنقاط. استخدم ملف التصدير نفسه بعد تسجيل النتيجة عليه.</p></div>
        <button type="button" onClick={onClose} className="rounded-xl border border-white/10 p-2 text-slate-300"><X size={18}/></button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950">
          <Upload size={17}/> {loading ? 'جارٍ المعالجة...' : 'اختيار ملف Excel المنفذ'}
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={loading} onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}/>
        </label>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-300"><FileSpreadsheet className="ml-2 inline" size={17}/>{fileName || 'لا يوجد ملف'}</div>
      </div>
      {!!rows.length && <>
        <div className="my-4 grid grid-cols-2 gap-2 md:grid-cols-6">
          {[['الإجمالي',counts.total],['تمت المتابعة',counts.followed],['تم الرد',counts.responded],['VIP',counts.vip],['+500',counts.plus500],['نقاط',counts.points]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center"><div className="text-[11px] font-bold text-slate-400">{label}</div><div className="mt-1 text-xl font-black text-white">{value}</div></div>)}
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-[1000px] w-full text-sm"><thead className="sticky top-0 bg-[#173252] text-slate-300"><tr>{['النوع','الفرع','العميل','الكود','تمت','رد','شراء','متابعة أخرى'].map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={`${r.rowNumber}-${r.customerCode}`} className="border-t border-white/5 text-slate-200"><td className="p-3">{r.queueType}</td><td className="p-3">{r.branch || '—'}</td><td className="p-3 font-black text-white">{r.customerName}</td><td className="p-3">{r.customerCode}</td><td className="p-3">{r.followedUp?'نعم':'لا'}</td><td className="p-3">{r.responded?'نعم':'لا'}</td><td className="p-3">{r.purchaseAfterFollowup?'نعم':'لا'}</td><td className="p-3">{r.needsNextFollowup?r.nextFollowupDate || 'نعم':'لا'}</td></tr>)}</tbody></table>
        </div>
        <button type="button" disabled={loading} onClick={() => void importRows()} className="mt-4 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50">اعتماد واستيراد النتائج</button>
      </>}
      {summary && <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-100">تم: {summary.imported} · مكرر: {summary.duplicates} · متوقف: {summary.skipped}</div>}
    </div>
  </div>;
}
