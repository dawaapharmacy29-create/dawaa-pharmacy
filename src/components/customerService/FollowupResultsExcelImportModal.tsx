import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type ParsedRow = {
  rowNumber: number;
  customerName: string;
  customerCode: string;
  invoiceDate: string;
  invoiceAmount: number;
  followedUp: boolean;
  responded: boolean;
  responseRaw: string;
  purchaseAfterFollowup: boolean;
  purchaseAmount: number;
  needsNextFollowup: boolean;
  nextFollowupDate: string;
  mergedRows: number[];
  warnings: string[];
  errors: string[];
};

type ImportSummary = {
  batchId?: string;
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
  warnings: number;
};

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s_\-/—–]+/g, '');

function yes(value: unknown) {
  const v = norm(value);
  return ['نعم', 'yes', 'y', 'true', 'تم', 'اه', 'ايوه'].includes(v);
}

function no(value: unknown) {
  const v = norm(value);
  return ['لا', 'no', 'n', 'false', 'لم', 'لميرد'].includes(v);
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function excelDate(value: unknown) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const valueText = text(value);
  const date = new Date(valueText);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function columnIndex(headers: unknown[], aliases: string[]) {
  const normalized = headers.map(norm);
  return aliases.map(norm).map((alias) => normalized.indexOf(alias)).find((index) => index >= 0) ?? -1;
}

function parseSheet(matrix: unknown[][]) {
  const headerIndex = matrix.findIndex((row) => {
    const keys = row.map(norm);
    return keys.includes(norm('اسم العميل')) && keys.includes(norm('تمت المتابعة'));
  });
  if (headerIndex < 0) throw new Error('لم يتم العثور على عناوين ملف المتابعة');
  const headers = matrix[headerIndex] || [];
  const indexes = {
    name: columnIndex(headers, ['اسم العميل', 'العميل']),
    code: columnIndex(headers, ['كود العميل', 'الكود']),
    invoiceDate: columnIndex(headers, ['تاريخ عملية الشراء', 'تاريخ الشراء', 'تاريخ الفاتورة']),
    invoiceAmount: columnIndex(headers, ['قيمة الفاتورة', 'اجمالي الفاتورة']),
    followed: columnIndex(headers, ['تمت المتابعة', 'تم المتابعة']),
    responded: columnIndex(headers, ['تم الرد', 'رد العميل']),
    purchase: columnIndex(headers, ['عملية شراء', 'تمت عملية شراء']),
    purchaseAmount: columnIndex(headers, ['قيمة عملية الشراء', 'قيمة الشراء بعد المتابعة']),
    needsNext: columnIndex(headers, ['هل يحتاج متابعة أخرى', 'يحتاج متابعة اخرى']),
    nextDate: columnIndex(headers, ['موعد المتابعة القادمة', 'موعد المتابعة التالي']),
  };
  if (indexes.name < 0 || indexes.code < 0 || indexes.followed < 0)
    throw new Error('الملف لا يحتوي على الأعمدة الأساسية المطلوبة');

  const parsed: ParsedRow[] = [];
  matrix.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const customerName = text(row[indexes.name]);
    const customerCode = text(row[indexes.code]);
    if (!customerName && !customerCode) return;
    const followedRaw = row[indexes.followed];
    const responseRaw = indexes.responded >= 0 ? text(row[indexes.responded]) : '';
    const followedUp = yes(followedRaw);
    const responded = yes(responseRaw) || (!!responseRaw && !no(responseRaw));
    const purchaseAfterFollowup = indexes.purchase >= 0 ? yes(row[indexes.purchase]) : false;
    const needsNextFollowup = indexes.needsNext >= 0 ? yes(row[indexes.needsNext]) : false;
    const warnings: string[] = [];
    const errors: string[] = [];
    if (!customerCode) warnings.push('بدون كود عميل؛ المطابقة ستكون بالاسم');
    if (!followedUp && responseRaw) warnings.push('يوجد رد مسجل رغم أن المتابعة غير محددة كنعم');
    if (responded && responseRaw && !yes(responseRaw)) warnings.push(`رد غير قياسي محفوظ كما هو: ${responseRaw}`);
    parsed.push({
      rowNumber,
      customerName,
      customerCode,
      invoiceDate: indexes.invoiceDate >= 0 ? excelDate(row[indexes.invoiceDate]) : '',
      invoiceAmount: indexes.invoiceAmount >= 0 ? numberValue(row[indexes.invoiceAmount]) : 0,
      followedUp,
      responded,
      responseRaw,
      purchaseAfterFollowup,
      purchaseAmount: indexes.purchaseAmount >= 0 ? numberValue(row[indexes.purchaseAmount]) : 0,
      needsNextFollowup,
      nextFollowupDate: indexes.nextDate >= 0 ? excelDate(row[indexes.nextDate]) : '',
      mergedRows: [rowNumber],
      warnings,
      errors,
    });
  });

  const grouped = new Map<string, ParsedRow>();
  for (const row of parsed) {
    const key = `${row.customerCode || norm(row.customerName)}|${row.invoiceDate || 'no-date'}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, row);
      continue;
    }
    current.invoiceAmount += row.invoiceAmount;
    current.purchaseAmount += row.purchaseAmount;
    current.followedUp = current.followedUp || row.followedUp;
    current.responded = current.responded || row.responded;
    current.purchaseAfterFollowup = current.purchaseAfterFollowup || row.purchaseAfterFollowup;
    current.needsNextFollowup = current.needsNextFollowup || row.needsNextFollowup;
    current.responseRaw = [current.responseRaw, row.responseRaw].filter(Boolean).join(' · ');
    current.nextFollowupDate = [current.nextFollowupDate, row.nextFollowupDate].filter(Boolean).sort()[0] || '';
    current.mergedRows.push(...row.mergedRows);
    current.warnings.push(`تم دمج ${current.mergedRows.length} صفوف لنفس العميل والتاريخ`);
  }
  return [...grouped.values()];
}

export default function FollowupResultsExcelImportModal({
  open,
  onClose,
  onImported,
  branch,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  branch: string;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const counts = useMemo(() => ({
    total: rows.length,
    followed: rows.filter((row) => row.followedUp).length,
    responded: rows.filter((row) => row.responded).length,
    noAnswer: rows.filter((row) => row.followedUp && !row.responded).length,
    pending: rows.filter((row) => !row.followedUp).length,
    next: rows.filter((row) => row.needsNextFollowup).length,
    warnings: rows.filter((row) => row.warnings.length).length,
  }), [rows]);

  if (!open) return null;

  async function readFile(file: File) {
    setLoading(true);
    setSummary(null);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
      const parsed = parseSheet(matrix);
      setRows(parsed);
      setFileName(file.name);
      toast.success(`تمت قراءة ${parsed.length} عميلًا بعد دمج التكرارات`);
    } catch (error) {
      setRows([]);
      toast.error(`تعذر قراءة الملف: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function importRows() {
    if (!rows.length) return;
    if (!user?.id) return toast.error('تعذر تحديد الحساب الحالي');
    if (!window.confirm(`سيتم استيراد نتائج ${rows.length} عميل إلى سجل المتابعات. هل تريد المتابعة؟`)) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('import_customer_followup_results_v1', {
        p_actor_id: user.id,
        p_branch: branch,
        p_file_name: fileName,
        p_rows: rows,
      });
      if (error) throw error;
      const result = data as ImportSummary;
      setSummary(result);
      toast.success(`تم استيراد ${result.imported} متابعة · المكرر ${result.duplicates} · المتوقف ${result.skipped}`);
      window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
      onImported();
    } catch (error) {
      toast.error(`تعذر استيراد النتائج: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4" dir="rtl">
      <div className="max-h-[94vh] w-full max-w-7xl overflow-y-auto rounded-3xl border border-white/10 bg-[#0d2038] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-white">استيراد نتائج متابعة فواتير 500+</h2>
            <p className="mt-1 text-sm font-bold text-slate-400">يسجل ما تم فعليًا مع العميل، ويحوّل غير المتابع أو لم يرد إلى قائمة مفتوحة، ويحفظ المتابعة القادمة والشراء.</p>
          </div>
          <button className="btn-secondary" onClick={onClose} disabled={loading}><X size={18} /></button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="btn-primary flex cursor-pointer items-center justify-center gap-2">
            <Upload size={17} /> {loading ? 'جارٍ المعالجة...' : 'اختيار ملف خدمة العملاء'}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={loading} onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} />
          </label>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-300"><FileSpreadsheet className="ml-2 inline" size={17} /> {fileName || 'لم يتم اختيار ملف'} · {branch}</div>
        </div>

        {!!rows.length && (
          <>
            <div className="my-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              {[['العملاء', counts.total], ['تمت المتابعة', counts.followed], ['تم الرد', counts.responded], ['لم يرد', counts.noAnswer], ['لم تتم', counts.pending], ['متابعة قادمة', counts.next], ['تحذيرات', counts.warnings]].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center"><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-1 text-xl font-black text-white">{value}</div></div>
              ))}
            </div>
            <div className="max-h-[48vh] overflow-auto rounded-2xl border border-white/10">
              <table className="min-w-[1250px] w-full text-sm">
                <thead className="sticky top-0 bg-[#173252] text-slate-300"><tr>{['الصف','العميل','الكود','الفاتورة','تمت المتابعة','الرد','شراء','متابعة أخرى','النتيجة المتوقعة','ملاحظات'].map((label) => <th key={label} className="p-3 text-right">{label}</th>)}</tr></thead>
                <tbody>{rows.map((row) => {
                  const expected = !row.followedUp ? 'مفتوحة — لم تبدأ' : !row.responded ? 'مفتوحة — لم يرد' : row.purchaseAfterFollowup ? 'مكتملة — تم شراء' : row.needsNextFollowup ? 'مفتوحة — موعد قادم' : 'مكتملة — تم الرد';
                  return <tr key={`${row.rowNumber}-${row.customerCode}`} className="border-t border-white/5 text-slate-200">
                    <td className="p-3">{row.mergedRows.join(', ')}</td><td className="p-3 font-black text-white">{row.customerName}</td><td className="p-3">{row.customerCode || '—'}</td>
                    <td className="p-3">{row.invoiceAmount ? `${row.invoiceAmount.toLocaleString('ar-EG')} ج` : 'بدون فاتورة'}</td><td className="p-3">{row.followedUp ? 'نعم' : 'لا'}</td><td className="p-3">{row.responseRaw || (row.responded ? 'نعم' : 'لا')}</td>
                    <td className="p-3">{row.purchaseAfterFollowup ? `${row.purchaseAmount || 0} ج` : 'لا'}</td><td className="p-3">{row.needsNextFollowup ? row.nextFollowupDate || 'موعد تلقائي' : 'لا'}</td><td className="p-3 font-black text-teal-200">{expected}</td><td className="p-3 text-xs text-amber-200">{row.warnings.join(' · ') || 'جاهز'}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <button className="btn-primary mt-4 w-full" disabled={loading} onClick={() => void importRows()}>{loading ? 'جارٍ تسجيل المتابعات...' : `اعتماد واستيراد ${rows.length} عميل`}</button>
          </>
        )}

        {summary && <div className="mt-4 rounded-2xl border border-teal-400/25 bg-teal-500/10 p-4 font-bold text-teal-100">تمت الدفعة: مستورد {summary.imported} · مكرر {summary.duplicates} · متوقف {summary.skipped} · يحتاج مراجعة بيانات {summary.warnings}</div>}
      </div>
    </div>
  );
}
