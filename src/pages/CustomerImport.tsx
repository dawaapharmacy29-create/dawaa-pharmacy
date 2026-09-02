import { useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import {
  importCustomersFromArrayBuffer,
  getExistingCustomersCount,
  getExistingCustomerCodes,
} from '@/lib/customerBulkImport';
import { toast } from 'sonner';

export default function CustomerImport() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [existingCount, setExistingCount] = useState<number>(0);
  const [existingCodes, setExistingCodes] = useState<string[]>([]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      // قراءة الملف كـ ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // استخدام دالة الاستيراد
      const importResult = await importCustomersFromArrayBuffer(
        arrayBuffer,
        file.name,
        `import-${Date.now()}`
      );

      setResult(importResult);

      if (importResult.errors.length > 0) {
        toast.error(`حدث ${importResult.errors.length} خطأ أثناء الاستيراد`);
      } else {
        toast.success('تم استيراد البيانات بنجاح');
      }

      // تحديث عدد العملاء الموجودين
      const count = await getExistingCustomersCount();
      setExistingCount(count);
    } catch (error) {
      toast.error(`خطأ: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadExistingData = async () => {
    try {
      const count = await getExistingCustomersCount();
      const codes = await getExistingCustomerCodes();
      setExistingCount(count);
      setExistingCodes(codes);
    } catch (error) {
      toast.error(`خطأ: ${(error as Error).message}`);
    }
  };

  return (
    <div className="dawaa-text p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">استيراد بيانات العملاء</h1>

      <div className="dawaa-surface rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">البيانات الحالية</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="dawaa-surface-soft p-4 rounded">
            <div className="text-sm text-[var(--dawaa-theme-muted)]">عدد العملاء الموجودين</div>
            <div className="text-2xl font-bold">{existingCount}</div>
          </div>
          <div className="dawaa-surface-soft p-4 rounded">
            <div className="text-sm text-[var(--dawaa-theme-muted)]">عدد الأكواد الفريدة</div>
            <div className="text-2xl font-bold">{existingCodes.length}</div>
          </div>
        </div>
        <button
          onClick={loadExistingData}
          className="mt-4 px-4 py-2 dawaa-button dawaa-button--secondary rounded"
        >
          تحديث البيانات
        </button>
      </div>

      <div className="dawaa-surface rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">استيراد ملف Excel</h2>

        <div className="border-2 border-dashed border-[var(--dawaa-theme-border)] rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            disabled={loading}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
            {loading ? (
              <Loader2 className="w-12 h-12 text-[var(--dawaa-status-info-text)] animate-spin mb-4" />
            ) : (
              <Upload className="w-12 h-12 text-[var(--dawaa-theme-muted)] mb-4" />
            )}
            <span className="text-lg font-medium">
              {loading ? 'جاري الاستيراد...' : 'اضغط لرفع ملف Excel'}
            </span>
            <span className="text-sm text-[var(--dawaa-theme-muted)] mt-2">
              يجب أن يحتوي الملف على: الكود، الاسم، الموبايل، التليفون، العنوان
            </span>
          </label>
        </div>

        {result && (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold">نتائج الاستيراد</h3>

            {result.warnings.length > 0 && (
              <div className="bg-[var(--dawaa-status-warning-bg)] border border-[var(--dawaa-status-warning-border)] rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-[var(--dawaa-status-warning-text)]" />
                  <span className="font-semibold text-[var(--dawaa-status-warning-text)]">تحذيرات</span>
                </div>
                <ul className="space-y-1">
                  {result.warnings.map((warning: string, i: number) => (
                    <li key={i} className="text-sm text-[var(--dawaa-status-warning-text)]">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-[var(--dawaa-status-danger-bg)] border border-[var(--dawaa-status-danger-border)] rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-[var(--dawaa-status-danger-text)]" />
                  <span className="font-semibold text-[var(--dawaa-status-danger-text)]">أخطاء</span>
                </div>
                <ul className="space-y-1">
                  {result.errors.map((error: string, i: number) => (
                    <li key={i} className="text-sm text-[var(--dawaa-status-danger-text)]">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.errors.length === 0 && (
              <div className="bg-[var(--dawaa-status-success-bg)] border border-[var(--dawaa-status-success-border)] rounded p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-[var(--dawaa-status-success-text)]" />
                  <span className="font-semibold text-[var(--dawaa-status-success-text)]">تم الاستيراد بنجاح</span>
                </div>
              </div>
            )}

            <div className="dawaa-surface-soft rounded p-4">
              <h4 className="font-semibold mb-2">تفاصيل الاستيراد</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[var(--dawaa-theme-muted)]">عدد الصفوف في الملف:</span>
                  <span className="font-semibold ml-2">{result.parseResult.rows.length}</span>
                </div>
                <div>
                  <span className="text-[var(--dawaa-theme-muted)]">عملاء جدد:</span>
                  <span className="font-semibold ml-2">
                    {result.importSummary.newCustomers || 0}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--dawaa-theme-muted)]">عملاء محدثين:</span>
                  <span className="font-semibold ml-2">
                    {result.importSummary.updatedCustomers || 0}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--dawaa-theme-muted)]">سجلات مكررة:</span>
                  <span className="font-semibold ml-2">
                    {result.importSummary.skippedDuplicates || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
