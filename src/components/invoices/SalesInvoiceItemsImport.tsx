import { useState } from 'react';
import {
  parseSalesInvoiceItemsV21,
  previewSalesInvoiceItemsV21,
  saveSalesInvoiceItemsV21,
  type SalesItemPreviewRow,
} from '@/lib/salesInvoiceItemsV21';

const statusLabels = {
  ready: 'جاهز للحفظ',
  existing: 'محفوظ سابقًا',
  duplicate: 'مكرر في الملف',
  conflict: 'سطور متعارضة',
  missing: 'الفاتورة غير موجودة',
  ambiguous: 'أكثر من فاتورة مطابقة',
  wrong_branch: 'الفرع مختلف',
  customer_mismatch: 'كود العميل مختلف عن الفاتورة',
};

const statusExplanations: Record<keyof typeof statusLabels, string> = {
  ready: 'الفاتورة موجودة، والصنف لم يُحفظ من قبل',
  existing: 'نفس سطر الصنف محفوظ بالفعل؛ لن يُضاف مرة أخرى',
  duplicate: 'السطر مكرر داخل ملف Excel',
  conflict: 'نفس رقم السطر وكود الصنف لهما تفاصيل متعارضة',
  missing: 'لم تُعثر على فاتورة ملخص مطابقة في نفس الفرع والتاريخ',
  ambiguous: 'توجد أكثر من فاتورة محتملة؛ يلزم مراجعة يدوية',
  wrong_branch: 'الفرع المكتوب في الملف لا يطابق الفرع المختار',
  customer_mismatch: 'كود العميل في ملف الأصناف مختلف عن فاتورة الملخص',
};

function downloadReviewCsv(rows: readonly SalesItemPreviewRow[]) {
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = [
    'ورقة الملف',
    'رقم السطر',
    'رقم الفاتورة',
    'التاريخ',
    'الفرع',
    'كود العميل',
    'كود الصنف',
    'اسم الصنف',
    'الكمية',
    'الحالة',
    'التفسير',
  ];
  const records = rows.map(({ row, status }) => [
    row.sheetName,
    row.rowIndex,
    row.invoiceNumber,
    row.invoiceDate,
    row.branch,
    row.customerCode,
    row.productCode,
    row.productName,
    row.quantity,
    statusLabels[status],
    statusExplanations[status],
  ]);
  const csv =
    '\uFEFF' + [header, ...records].map((values) => values.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'bconnect-items-import-review.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SalesInvoiceItemsImport({ branches }: { branches: readonly string[] }) {
  const [branch, setBranch] = useState(branches.length === 1 ? branches[0] : '');
  const selectedBranches = branches.filter((name) => name === branch);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SalesItemPreviewRow[] | null>(null);
  const [invalid, setInvalid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const ready = preview?.filter(({ status }) => status === 'ready').length ?? 0;
  const ordered = preview
    ? [...preview].sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready'))
    : [];
  const existing = preview?.filter(({ status }) => status === 'existing').length ?? 0;
  const review = (preview?.length ?? 0) - ready - existing;

  function resetPreview() {
    setPreview(null);
    setInvalid(0);
    setMessage('');
    setPage(0);
  }

  async function inspect(importFile: File | null = file, importBranch = branch) {
    if (!importFile || !importBranch || busy) return;
    resetPreview();
    setBusy(true);
    try {
      const parsed = parseSalesInvoiceItemsV21(await importFile.arrayBuffer(), '');
      setInvalid(parsed.invalidRows);
      if (!parsed.rows.length) {
        setMessage(parsed.warnings.join(' ') || 'الملف لا يحتوي على سطور أصناف صالحة.');
        return;
      }
      setPreview(await previewSalesInvoiceItemsV21(parsed.rows, [importBranch]));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذرت معاينة الملف.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!file || !preview || !ready || busy) return;
    setBusy(true);
    try {
      const result = await saveSalesInvoiceItemsV21(
        preview.map(({ row }) => ({ ...row, branch: row.sourceBranch ?? row.branch })),
        selectedBranches,
        file.name,
        preview
      );
      setMessage(
        `تم حفظ ${result.saved} سطر جديد. ${result.skipped} سطر لم يُضاف (محفوظ مسبقًا أو يحتاج مراجعة أو تغيرت حالته قبل الحفظ). ${invalid} سطر غير صالح بالملف. فشل الحفظ: ${result.failed}.`
      );
      // Refresh instead of hiding the audit trail after saving.
      try {
        const latest = parseSalesInvoiceItemsV21(await file.arrayBuffer(), '');
        setPreview(await previewSalesInvoiceItemsV21(latest.rows, selectedBranches));
        setPage(0);
      } catch {
        setPreview(null);
        setMessage(
          (previous) =>
            `${previous} تم الحفظ لكن تعذّر تحديث كشف المراجعة؛ أعد المعاينة للتأكد من الحالات الحالية.`
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ تفاصيل الأصناف.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-5">
      <h2 className="section-title">استيراد أصناف فواتير المبيعات</h2>
      <p className="mb-4 text-sm">
        اختار الفرع وارفع تقرير BConnect التفصيلي. تبدأ المطابقة تلقائيًا، ويمكنك حفظ السطور السليمة
        بضغطة واحدة بعد استيراد ملخص الفواتير لنفس الفترة.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          فرع الملف
          <select
            className="input-dark"
            value={branch}
            disabled={busy}
            onChange={(event) => {
              const nextBranch = event.target.value;
              setBranch(nextBranch);
              resetPreview();
              if (nextBranch && file) void inspect(file, nextBranch);
            }}
          >
            <option value="">اختار الفرع</option>
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          ملف تفاصيل الأصناف
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setFile(nextFile);
              resetPreview();
              if (nextFile && branch) void inspect(nextFile, branch);
            }}
          />
        </label>
        <button
          type="button"
          className="dawaa-button dawaa-button--secondary"
          disabled={!file || !branch || busy}
          onClick={() => void inspect(file, branch)}
        >
          إعادة فحص الملف
        </button>
      </div>
      {busy && (
        <p role="status" className="mt-3">
          جاري معالجة الأصناف…
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {invalid > 0 && preview && <p className="mt-3 text-sm">سطور ناقصة أو غير صالحة: {invalid}</p>}
      {preview && (
        <div className="mt-4 space-y-3">
          <div
            className="rounded-lg border border-[var(--dawaa-theme-border)] p-3 text-sm"
            role="status"
          >
            إجمالي السطور المقروءة: {preview.length + invalid} — جديد وجاهز للحفظ: {ready} — محفوظ
            سابقًا: {existing} — يحتاج مراجعة: {review} — غير صالح: {invalid}.
            <span className="block mt-1">
              «محفوظ سابقًا» لا يعني فشل الاستيراد؛ أما «يحتاج مراجعة» فلا يُحفظ تلقائيًا لحماية دقة
              الفواتير.
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.entries(statusLabels).map(([key, label]) => (
              <span key={key}>
                {label} ({preview.filter(({ status }) => status === key).length})
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr>
                  <th>سطر الملف</th>
                  <th>الفاتورة</th>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>الحالة</th>
                  <th>سبب الحالة</th>
                </tr>
              </thead>
              <tbody>
                {ordered.slice(page * 25, (page + 1) * 25).map(({ row, status }) => (
                  <tr
                    key={`${row.sheetName}:${row.rowIndex}`}
                    className="border-t border-[var(--dawaa-theme-border)]"
                  >
                    <td>{row.rowIndex}</td>
                    <td>{row.invoiceNumber}</td>
                    <td>{row.invoiceDate}</td>
                    <td>{row.branch || '—'}</td>
                    <td>{row.productName}</td>
                    <td>{row.quantity}</td>
                    <td>{statusLabels[status]}</td>
                    <td>{statusExplanations[status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="dawaa-button dawaa-button--secondary"
              onClick={() => downloadReviewCsv(preview)}
            >
              تحميل كشف المطابقة CSV
            </button>
            <button
              type="button"
              className="dawaa-button dawaa-button--secondary"
              disabled={!page || busy}
              onClick={() => setPage(page - 1)}
            >
              السابق
            </button>
            <button
              type="button"
              className="dawaa-button dawaa-button--secondary"
              disabled={(page + 1) * 25 >= ordered.length || busy}
              onClick={() => setPage(page + 1)}
            >
              التالي
            </button>
            <button
              type="button"
              className="dawaa-button dawaa-button--primary"
              disabled={!ready || busy}
              onClick={() => void save()}
            >
              تأكيد حفظ {ready} سطر مطابق
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
