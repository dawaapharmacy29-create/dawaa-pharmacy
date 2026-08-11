import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  FileSpreadsheet,
  FileText,
  Link2,
  PackageSearch,
  RefreshCw,
  Search,
  Truck,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  getProductsCatalogSummary,
  importProductsCatalog,
  parseProductsCatalogFile,
  searchProductsCatalog,
  type CatalogProduct,
  type CatalogSummary,
} from '@/lib/api/productsCatalog';

type Supplier = {
  id: string;
  supplier_name: string;
  supplier_type?: string | null;
  active?: boolean | null;
};

type PurchaseInvoice = {
  id: string;
  invoice_no?: string | null;
  branch?: string | null;
  invoice_date?: string | null;
  net_total?: number | null;
  paid_amount?: number | null;
  remaining_amount?: number | null;
  status?: string | null;
};

type ViewMode = 'purchases' | 'catalog';

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function Purchases() {
  const { isAdmin } = useAuth();
  const [view, setView] = useState<ViewMode>('purchases');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogSummary, setCatalogSummary] = useState<CatalogSummary>({ total: 0, with_price: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [suppliersResult, invoicesResult, summary] = await Promise.all([
        supabase.from('purchase_suppliers_v13').select('*').order('supplier_name'),
        supabase
          .from('purchase_invoices_v13')
          .select('*')
          .order('invoice_date', { ascending: false })
          .limit(50),
        getProductsCatalogSummary(),
      ]);
      if (suppliersResult.error) throw suppliersResult.error;
      if (invoicesResult.error) throw invoicesResult.error;
      setSuppliers((suppliersResult.data || []) as Supplier[]);
      setInvoices((invoicesResult.data || []) as PurchaseInvoice[]);
      setCatalogSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المشتريات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = invoices.reduce(
    (acc, row) => ({
      net: acc.net + n(row.net_total),
      paid: acc.paid + n(row.paid_amount),
      remaining: acc.remaining + n(row.remaining_amount),
    }),
    { net: 0, paid: 0, remaining: 0 }
  );

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">المشتريات ودليل الأصناف</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">
              إدارة بسيطة للمشتريات مع دليل موحد يعتمد على كود الصنف والاسم وسعر البيع فقط.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setView('purchases')}
              className={`rounded-xl px-4 py-2 text-sm font-black ${
                view === 'purchases' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              المشتريات
            </button>
            <button
              type="button"
              onClick={() => setView('catalog')}
              className={`rounded-xl px-4 py-2 text-sm font-black ${
                view === 'catalog' ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-700'
              }`}
            >
              دليل الأصناف ({catalogSummary.total.toLocaleString('ar-EG')})
            </button>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {view === 'purchases' ? (
        <PurchasesOverview
          suppliers={suppliers}
          invoices={invoices}
          totals={totals}
          catalogSummary={catalogSummary}
        />
      ) : (
        <ProductCatalogPanel
          isAdmin={isAdmin}
          summary={catalogSummary}
          onImported={() => void load()}
        />
      )}
    </div>
  );
}

function PurchasesOverview({
  suppliers,
  invoices,
  totals,
  catalogSummary,
}: {
  suppliers: Supplier[];
  invoices: PurchaseInvoice[];
  totals: { net: number; paid: number; remaining: number };
  catalogSummary: CatalogSummary;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-5">
        <Card title="دليل الأصناف" value={catalogSummary.total.toLocaleString('ar-EG')} icon={BookOpenCheck} />
        <Card title="الموردون" value={suppliers.length.toLocaleString('ar-EG')} icon={Truck} />
        <Card title="فواتير مشتريات" value={invoices.length.toLocaleString('ar-EG')} icon={FileText} />
        <Card title="إجمالي الفواتير" value={formatCurrency(totals.net)} icon={PackageSearch} />
        <Card title="المتبقي للموردين" value={formatCurrency(totals.remaining)} icon={PackageSearch} />
      </div>

      <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 text-sm font-bold text-teal-900">
        <div className="flex items-start gap-3">
          <Link2 className="mt-0.5 shrink-0" size={18} />
          <div>
            <div className="font-black">الربط الذكي بسيط ومباشر</div>
            <p className="mt-1 leading-7 text-teal-800">
              نفس الصنف يمكن ربطه بطلب العميل والنواقص وبنود أمر الشراء من خلال Product ID واحد، بدون تغيير طريقة العمل الحالية.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-black text-slate-900">آخر فواتير المشتريات</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className="p-3 text-right">رقم الفاتورة</th>
                <th className="p-3 text-right">الفرع</th>
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">الصافي</th>
                <th className="p-3 text-right">المتبقي</th>
                <th className="p-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3 font-bold">{row.invoice_no || '-'}</td>
                  <td className="p-3">{row.branch || '-'}</td>
                  <td className="p-3">{row.invoice_date || '-'}</td>
                  <td className="p-3">{formatCurrency(n(row.net_total))}</td>
                  <td className="p-3">{formatCurrency(n(row.remaining_amount))}</td>
                  <td className="p-3">{row.status || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!invoices.length && (
          <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">
            لا توجد فواتير مشتريات بعد.
          </div>
        )}
      </div>
    </>
  );
}

function ProductCatalogPanel({
  isAdmin,
  summary,
  onImported,
}: {
  isAdmin: boolean;
  summary: CatalogSummary;
  onImported: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CatalogProduct[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CatalogProduct[]>([]);

  const pricedCount = useMemo(() => preview.filter((row) => row.price !== null && row.price > 0).length, [preview]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setPreview([]);
    setMessage(null);
    setParsing(true);
    try {
      const rows = await parseProductsCatalogFile(file);
      if (!rows.length) throw new Error('لم أتعرف على أصناف صالحة داخل الملف');
      setPreview(rows);
      setMessage(`تم التعرف على ${rows.length.toLocaleString('ar-EG')} صنف. راجع العينة ثم اضغط استيراد وتحديث.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر قراءة الملف');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!preview.length || importing) return;
    setImporting(true);
    setMessage(null);
    try {
      const result = await importProductsCatalog(preview);
      setMessage(
        `تم تحديث ${result.processed.toLocaleString('ar-EG')} صنف بنجاح، وربط ${result.linked.toLocaleString('ar-EG')} طلب عميل تلقائيًا بتطابق مؤكد.`
      );
      setPreview([]);
      setSelectedFile(null);
      onImported();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر استيراد الأصناف');
    } finally {
      setImporting(false);
    }
  };

  const handleSearch = useCallback(async () => {
    setSearching(true);
    try {
      setResults(await searchProductsCatalog(search, 30));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر البحث');
    } finally {
      setSearching(false);
    }
  }, [search]);

  useEffect(() => {
    if (!summary.total) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => void handleSearch(), 250);
    return () => window.clearTimeout(timer);
  }, [handleSearch, summary.total]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="إجمالي الأصناف" value={summary.total.toLocaleString('ar-EG')} icon={BookOpenCheck} />
        <Card title="أصناف لها سعر" value={summary.with_price.toLocaleString('ar-EG')} icon={PackageSearch} />
        <Card
          title="آخر تحديث"
          value={summary.last_updated_at ? new Date(summary.last_updated_at).toLocaleDateString('ar-EG') : '-'}
          icon={RefreshCw}
        />
      </div>

      {isAdmin && (
        <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">تحديث دليل الأصناف</h2>
              <p className="mt-1 max-w-2xl text-sm font-bold leading-7 text-slate-500">
                ارفع نفس ملف B-Connect كما هو. النظام يستخرج تلقائيًا كود الصنف والاسم وسعر البيع، ويحدّث الموجود ويضيف الجديد فقط. لا يتم حذف أي صنف قديم.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-black text-white hover:bg-teal-700">
              <FileSpreadsheet size={18} />
              {parsing ? 'جاري قراءة الملف...' : 'اختيار ملف الأصناف'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={parsing || importing}
                onChange={(event) => void handleFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          {selectedFile && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-600">
              الملف: {selectedFile.name}
            </div>
          )}

          {message && (
            <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm font-bold text-teal-900">
              {message}
            </div>
          )}

          {!!preview.length && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-black text-slate-700">
                  {preview.length.toLocaleString('ar-EG')} صنف · {pricedCount.toLocaleString('ar-EG')} بسعر صالح
                </div>
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                >
                  <Upload size={17} /> {importing ? 'جاري الاستيراد...' : 'استيراد وتحديث'}
                </button>
              </div>
              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-3 text-right">الكود</th>
                      <th className="p-3 text-right">اسم الصنف</th>
                      <th className="p-3 text-right">السعر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 12).map((row) => (
                      <tr key={row.code} className="border-t">
                        <td className="p-3 font-black text-slate-700">{row.code}</td>
                        <td className="p-3 font-bold text-slate-900">{row.name}</td>
                        <td className="p-3">{row.price === null ? '-' : formatCurrency(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs font-bold text-slate-400">المعاينة تعرض أول 12 صنف فقط.</div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">بحث سريع في الأصناف</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">ابحث بالكود أو بأي جزء من اسم الصنف.</p>
          </div>
          <div className="relative w-full md:max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="مثال: Valtrex أو 51733"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-3 text-sm font-bold outline-none focus:border-teal-400"
            />
          </div>
        </div>

        <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3 text-right">الكود</th>
                <th className="p-3 text-right">الصنف</th>
                <th className="p-3 text-right">السعر</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.id || row.code} className="border-t">
                  <td className="p-3 font-black text-teal-700">{row.code}</td>
                  <td className="p-3 font-bold text-slate-900">{row.name}</td>
                  <td className="p-3">{row.price === null ? '-' : formatCurrency(row.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!results.length && (
            <div className="p-6 text-center text-sm font-bold text-slate-500">
              {searching ? 'جاري البحث...' : summary.total ? 'لا توجد نتائج مطابقة.' : 'ارفع ملف الأصناف أولًا.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, icon: Icon }: { title: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
        </div>
        <span className="rounded-2xl bg-teal-50 p-3 text-teal-700">
          <Icon size={20} />
        </span>
      </div>
    </div>
  );
}
