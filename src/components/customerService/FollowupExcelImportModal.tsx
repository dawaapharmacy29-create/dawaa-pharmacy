import { useState } from 'react';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { createDoctorRequestedFollowup } from '@/lib/api/doctorRequestedFollowups';
import { useAuth } from '@/hooks/useAuth';

type ImportRow = {
  rowNumber: number;
  code: string;
  name: string;
  phone: string;
  branch: string;
  due: string;
  priority: string;
  reason: string;
  doctor: string;
  notes: string;
  errors: string[];
  duplicate: boolean;
};

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[_\s/-]+/g, '');

function pick(row: Record<string, unknown>, aliases: string[]) {
  const entry = Object.entries(row).find(([key]) => aliases.includes(norm(key)));
  return text(entry?.[1]);
}

function dateValue(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export default function FollowupExcelImportModal({
  open,
  onClose,
  onImported,
  defaultBranch,
  allowAllBranches,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  defaultBranch: string;
  allowAllBranches: boolean;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const sample = [
      {
        'كود العميل': '1234',
        'اسم العميل': 'اسم العميل',
        الهاتف: '01000000000',
        الفرع: defaultBranch,
        'موعد المتابعة': new Date().toLocaleDateString('en-CA'),
        الأولوية: 'مهم',
        'سبب المتابعة': 'متابعة احتياج العميل',
        المسؤول: '',
        ملاحظات: '',
      },
    ];
    const sheet = XLSX.utils.json_to_sheet(sample);
    sheet['!cols'] = [12, 24, 16, 14, 18, 12, 30, 20, 35].map((wch) => ({ wch }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'أمر المتابعات');
    XLSX.writeFile(book, 'قالب-أمر-متابعة-العملاء.xlsx');
  }

  async function readFile(file: File) {
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      const source = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
      });
      const parsed = source.map((row, index) => {
        const code = pick(row, ['كودالعميل', 'customercode', 'code']);
        const name = pick(row, ['اسمالعميل', 'customername', 'name']);
        const phone = pick(row, ['الهاتف', 'رقمالهاتف', 'phone', 'mobile']);
        const importedBranch = normalizeBranchName(
          pick(row, ['الفرع', 'branch', 'branchname']) || defaultBranch
        );
        const branch = allowAllBranches ? importedBranch : normalizeBranchName(defaultBranch);
        const dueRaw = pick(row, ['موعدالمتابعه', 'موعدالمتابعة', 'followupdate', 'due', 'date']);
        const due = dateValue(dueRaw);
        const priority = pick(row, ['الاولويه', 'الأولوية', 'priority']) || 'مهم';
        const reason = pick(row, ['سببالمتابعه', 'سببالمتابعة', 'reason']) || 'أمر متابعة Excel';
        const doctor = pick(row, ['المسؤول', 'الدكتور', 'doctor', 'assigneddoctor']);
        const notes = pick(row, ['ملاحظات', 'notes', 'details']);
        const errors: string[] = [];
        if (!code && !phone) errors.push('يلزم كود أو هاتف');
        if (!name) errors.push('اسم العميل غير موجود');
        if (!['فرع الشامي', 'فرع شكري'].includes(branch)) errors.push('الفرع غير صحيح');
        if (!due) errors.push('موعد المتابعة غير صحيح');
        if (!['عادي', 'مهم', 'عاجل'].includes(priority)) errors.push('الأولوية غير صحيحة');
        return {
          rowNumber: index + 2,
          code,
          name,
          phone,
          branch,
          due,
          priority,
          reason,
          doctor,
          notes,
          errors,
          duplicate: false,
        };
      });
      const codes = [...new Set(parsed.map((row) => row.code).filter(Boolean))];
      const existingCodes = new Set<string>();
      if (codes.length) {
        const existing = await supabase
          .from('daily_followups')
          .select('customer_code,completed_at,status,followup_status')
          .in('customer_code', codes)
          .eq('is_hidden', false)
          .limit(2000);
        if (existing.error) throw existing.error;
        for (const row of existing.data || []) {
          const status = text(row.followup_status || row.status);
          if (!row.completed_at && !/^(تم|مكتمل|completed|closed)$/i.test(status))
            existingCodes.add(text(row.customer_code));
        }
      }
      const seen = new Set<string>();
      setRows(
        parsed.map((row) => {
          const identity = row.code ? `code:${row.code}` : `phone:${row.phone.replace(/\D/g, '')}`;
          const duplicate = existingCodes.has(row.code) || seen.has(identity);
          seen.add(identity);
          return { ...row, duplicate };
        })
      );
      setFileName(file.name);
    } catch (error) {
      toast.error(`تعذر قراءة الملف: ${(error as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function importRows() {
    const valid = rows.filter((row) => !row.errors.length && !row.duplicate);
    if (!valid.length) return toast.error('لا توجد صفوف صالحة للاستيراد');
    if (!window.confirm(`سيتم إنشاء ${valid.length} متابعة. هل تريد المتابعة؟`)) return;
    setLoading(true);
    let created = 0;
    try {
      for (const row of valid) {
        await createDoctorRequestedFollowup({
          customerName: row.name,
          customerPhone: row.phone || null,
          customerCode: row.code || null,
          branch: row.branch,
          priority: row.priority,
          requestType: 'excel_followup_command',
          followupReason: row.reason,
          requestDetails: row.notes || row.reason,
          notes: `${row.notes || row.reason}\nالمصدر: Excel followup command · الصف ${row.rowNumber}`,
          assignedDoctor: row.doctor || undefined,
          followupDatetime: row.due,
          createdBy: user?.id || null,
          createdByStaffId: user?.staffId || null,
          createdByName: user?.name || 'مستخدم النظام',
          source: 'excel_followup_command',
        });
        created += 1;
      }
      toast.success(`تم إنشاء ${created} متابعة من الملف`);
      window.dispatchEvent(
        new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } })
      );
      onImported();
      onClose();
    } catch (error) {
      toast.error(`تم إنشاء ${created} ثم توقف الاستيراد: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const validCount = rows.filter((row) => !row.errors.length && !row.duplicate).length;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      dir="rtl"
    >
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-white/10 bg-[#0d2038] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-white">أمر متابعة من Excel</h2>
            <p className="mt-1 text-sm font-bold text-slate-400">
              معاينة وتحقق من الفرع والموعد والتكرار قبل إنشاء أي متابعة.
            </p>
          </div>
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <button
            className="btn-secondary flex items-center justify-center gap-2"
            onClick={() => void downloadTemplate()}
          >
            <Download size={17} /> تنزيل القالب
          </button>
          <label className="btn-primary flex cursor-pointer items-center justify-center gap-2">
            <Upload size={17} /> {loading ? 'جارٍ القراءة...' : 'اختيار ملف Excel'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={loading}
              onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])}
            />
          </label>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-300">
            <FileSpreadsheet className="ml-2 inline" size={17} /> {fileName || 'لم يتم اختيار ملف'}
          </div>
        </div>
        {rows.length > 0 && (
          <>
            <div className="my-4 flex flex-wrap gap-2 text-xs font-black">
              <span className="badge-success">صالح: {validCount}</span>
              <span className="badge-warning">
                مكرر: {rows.filter((row) => row.duplicate).length}
              </span>
              <span className="badge-danger">
                به أخطاء: {rows.filter((row) => row.errors.length).length}
              </span>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="bg-[#173252] text-slate-300">
                  <tr>
                    {[
                      'الصف',
                      'العميل',
                      'الكود/الهاتف',
                      'الفرع',
                      'الموعد',
                      'الأولوية',
                      'السبب',
                      'الحالة',
                    ].map((label) => (
                      <th key={label} className="p-3 text-right">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-white/5 text-slate-200">
                      <td className="p-3">{row.rowNumber}</td>
                      <td className="p-3 font-black">{row.name || '—'}</td>
                      <td className="p-3">{row.code || row.phone || '—'}</td>
                      <td className="p-3">{row.branch || '—'}</td>
                      <td className="p-3">
                        {row.due ? new Date(row.due).toLocaleString('ar-EG') : '—'}
                      </td>
                      <td className="p-3">{row.priority}</td>
                      <td className="p-3">{row.reason}</td>
                      <td className="p-3 font-black">
                        {row.duplicate
                          ? 'مكرر — لن يُنشأ'
                          : row.errors.length
                            ? row.errors.join(' · ')
                            : 'جاهز'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn-primary mt-4 w-full"
              disabled={loading || !validCount}
              onClick={() => void importRows()}
            >
              {loading ? 'جارٍ إنشاء المتابعات...' : `اعتماد وإنشاء ${validCount} متابعة`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
