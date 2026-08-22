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
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-2xl">المشتريات ودليل الأصناف</h1>
            <p className="dawaa-caption mt-1 font-bold">
              إدارة بسيطة للمشتريات مع دليل موحد يعتمد على كود الصنف والاسم وسعر البيع فقط.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="dawaa-tabs">
              <button
                type="button"
                onClick={() => setView('purchases')}
                className={`dawaa-tab ${view === 'purchases' ? 'is-active' : ''}`}
                aria-selected={view === 'purchases'}
              >
                المشتريات
              </button>
              <button
                type="button"
                onClick={() => setView('catalog')}
                className={`dawaa-tab ${view === 'catalog' ? 'is-active' : ''}`}
                aria-selected={view === 'catalog'}
              >
                دليل الأصناف ({catalogSummary.total.toLocaleString('ar-EG')})
              </button>
            </div>
            <button type="button" onClick={() => void load()} className="dawaa-button dawaa-button--secondary">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm font-bold">{error}</div> : null}

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

      <div className="dawaa-card dawaa-card--soft p-4 text-sm font-bold">
        <div className="flex items-start gap-3">
          <span className="dawaa-icon-tile h-9 w-9 shrink-0"><Link2 size={18} /></span>
          <div>
            <div className="dawaa-title text-sm">الربط الذكي بسيط ومباشر</div>
            <p className="dawaa-body mt-1 leading-7">
              نفس الصنف يمكن ربطه بطلب العميل والنواقص وبنود أمر الشراء من خلال Product ID واحد، بدون تغيير طريقة العمل الحالية.
            </p>
          </div>
        </div>
      </div>

      <section className="dawaa-card">
        <h2 className="dawaa-title mb-3 text-lg">آخر فواتير المشتريات</h2>
        {invoices.length ? (
          <div className="dawaa-table-shell shadow-none">
            <table className="dawaa-table-semantic min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-right">رقم الفاتورة</th>
                  <th className="text-right">الفرع</th>
                  <th className="text-right">التاريخ</th>
                  <th className="text-right">الصافي</th>
                  <th className="text-right">المتبقي</th>
                  <th className="text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((row) => (
                  <tr key={row.id}>
                    <td className="font-bold">{row.invoice_no || '-'}</td>
                    <td>{row.branch || '-'}</td>
                    <td>{row.invoice_date || '-'}</td>
                    <td>{formatCurrency(n(row.net_total))}</td>
                    <td>{formatCurrency(n(row.remaining_amount))}</td>
                    <td>{row.status || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dawaa-empty-state p-5 text-sm font-bold">لا توجد فواتير مشتريات بعد.</div>
        )}
      </section>
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

      {isAdmin ? (
        <section className="dawaa-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="dawaa-title text-lg">تحديث دليل الأصناف</h2>
              <p className="dawaa-caption mt-1 max-w-2xl font-bold leading-7">
                ارفع نفس ملف B-Connect كما هو. النظام يستخرج تلقائيًا كود الصنف والاسم وسعر البيع، ويحدّث الموجود ويضيف الجديد فقط. لا يتم حذف أي صنف قديم.
              </p>
            </div>
            <label className="dawaa-button dawaa-button--primary cursor-pointer">
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

          {selectedFile ? <div className="dawaa-card dawaa-card--soft mt-3 p-3 text-sm font-bold">الملف: {selectedFile.name}</div> : null}
          {message ? <div className="dawaa-alert dawaa-alert--info mt-3 text-sm font-bold">{message}</div> : null}

          {preview.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="dawaa-body text-sm font-black">
                  {preview.length.toLocaleString('ar-EG')} صنف · {pricedCount.toLocaleString('ar-EG')} بسعر صالح
                </div>
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing}
                  className="dawaa-button dawaa-button--primary disabled:opacity-50"
                >
                  <Upload size={17} /> {importing ? 'جاري الاستيراد...' : 'استيراد وتحديث'}
                </button>
              </div>
              <div className="dawaa-table-shell shadow-none">
                <table className="dawaa-table-semantic min-w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-right">الكود</th>
                      <th className="text-right">اسم الصنف</th>
                      <th className="text-right">السعر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 12).map((row) => (
                      <tr key={row.code}>
                        <td className="font-black">{row.code}</td>
                        <td className="font-bold">{row.name}</td>
                        <td>{row.price === null ? '-' : formatCurrency(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dawaa-caption text-xs font-bold">المعاينة تعرض أول 12 صنف فقط.</div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="dawaa-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="dawaa-title text-lg">بحث سريع في الأصناف</h2>
            <p className="dawaa-caption mt-1 font-bold">ابحث بالكود أو بأي جزء من اسم الصنف.</p>
          </div>
          <div className="relative w-full md:max-w-md">
            <Search className="dawaa-caption absolute right-3 top-1/2 -translate-y-1/2" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="مثال: Valtrex أو 51733"
              className="dawaa-input py-2.5 pr-10 pl-3 text-sm font-bold"
            />
          </div>
        </div>

        <div className="mt-4">
          {results.length ? (
            <div className="dawaa-table-shell shadow-none">
              <table className="dawaa-table-semantic min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-right">الكود</th>
                    <th className="text-right">الصنف</th>
                    <th className="text-right">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={row.id || row.code}>
                      <td className="font-black">{row.code}</td>
                      <td className="font-bold">{row.name}</td>
                      <td>{row.price === null ? '-' : formatCurrency(row.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dawaa-empty-state p-6 text-sm font-bold">
              {searching ? 'جاري البحث...' : summary.total ? 'لا توجد نتائج مطابقة.' : 'ارفع ملف الأصناف أولًا.'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Card({ title, value, icon: Icon }: { title: string; value: string; icon: LucideIcon }) {
  return (
    <div className="dawaa-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="dawaa-caption text-xs font-bold">{title}</div>
          <div className="dawaa-title mt-2 text-2xl">{value}</div>
        </div>
        <span className="dawaa-icon-tile h-11 w-11 shrink-0"><Icon size={20} /></span>
      </div>
    </div>
  );
}
