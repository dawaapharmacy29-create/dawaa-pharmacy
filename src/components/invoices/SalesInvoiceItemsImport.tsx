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
};

export function SalesInvoiceItemsImport({ branches }: { branches: readonly string[] }) {
  const [branch, setBranch] = useState(branches.length === 1 ? branches[0] : '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SalesItemPreviewRow[] | null>(null);
  const [invalid, setInvalid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const ready = preview?.filter(({ status }) => status === 'ready').length ?? 0;
  const ordered = preview ? [...preview].sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready')) : [];

  function resetPreview() {
    setPreview(null);
    setInvalid(0);
    setMessage('');
    setPage(0);
  }

  async function inspect() {
    if (!file || !branch || busy) return;
    resetPreview();
    setBusy(true);
    try {
      const parsed = parseSalesInvoiceItemsV21(await file.arrayBuffer(), branch);
      setInvalid(parsed.invalidRows);
      if (!parsed.rows.length) {
        setMessage(parsed.warnings.join(' ') || 'الملف لا يحتوي على سطور أصناف صالحة.');
        return;
      }
      setPreview(await previewSalesInvoiceItemsV21(parsed.rows, branch));
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
      const result = await saveSalesInvoiceItemsV21(preview.filter(({ status }) => status === 'ready').map(({ row }) => row), branch, file.name);
      setPreview(null);
      setMessage(`تم حفظ ${result.saved} سطر. تم تخطي ${preview.length - ready + result.skipped + invalid} سطر. تعذر حفظ ${result.failed} سطر.${result.failed ? ' يمكنك معاينة نفس الملف مرة أخرى وإعادة محاولة السطور المتبقية.' : ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ تفاصيل الأصناف.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-5">
      <h2 className="section-title">استيراد أصناف فواتير المبيعات</h2>
      <p className="mb-4 text-sm">اختار فرع الملف، وارفع تقرير BConnect التفصيلي بعد استيراد ملخص الفواتير لنفس الفترة.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          فرع الملف
          <select className="input-dark" value={branch} disabled={busy} onChange={(event) => { setBranch(event.target.value); resetPreview(); }}>
            <option value="">اختار الفرع</option>
            {branches.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          ملف تفاصيل الأصناف
          <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetPreview(); }} />
        </label>
        <button type="button" className="dawaa-button dawaa-button--secondary" disabled={!file || !branch || busy} onClick={() => void inspect()}>
          معاينة ومطابقة الأصناف
        </button>
      </div>
      {busy && <p role="status" className="mt-3">جاري معالجة الأصناف…</p>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {invalid > 0 && preview && <p className="mt-3 text-sm">سطور ناقصة أو غير صالحة: {invalid}</p>}
      {preview && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.entries(statusLabels).map(([key, label]) => (
              <span key={key}>{label} ({preview.filter(({ status }) => status === key).length})</span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead><tr><th>سطر الملف</th><th>الفاتورة</th><th>التاريخ</th><th>الصنف</th><th>الكمية</th><th>الحالة</th></tr></thead>
              <tbody>
                {ordered.slice(page * 25, (page + 1) * 25).map(({ row, status }) => (
                  <tr key={`${row.sheetName}:${row.rowIndex}`} className="border-t border-[var(--dawaa-theme-border)]">
                    <td>{row.rowIndex}</td><td>{row.invoiceNumber}</td><td>{row.invoiceDate}</td>
                    <td>{row.productName}</td><td>{row.quantity}</td><td>{statusLabels[status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="dawaa-button dawaa-button--secondary" disabled={!page || busy} onClick={() => setPage(page - 1)}>السابق</button>
            <button type="button" className="dawaa-button dawaa-button--secondary" disabled={(page + 1) * 25 >= ordered.length || busy} onClick={() => setPage(page + 1)}>التالي</button>
            <button type="button" className="dawaa-button dawaa-button--primary" disabled={!ready || busy} onClick={() => void save()}>تأكيد حفظ {ready} سطر مطابق</button>
          </div>
        </div>
      )}
    </section>
  );
}
