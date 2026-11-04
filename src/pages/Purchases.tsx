import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  ClipboardList,
  ExternalLink,
  FileSpreadsheet,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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

// «المشتريات»: the purchase invoices registered in DawaaWael (synced every 15 minutes), laid out like the
// Dawaa Bills pages — one card per branch with the review queue, quick filters, one table.
const DAWAA_WAEL_PENDING = 'https://dawaawael.base44.app/pending-invoices';
const PENDING = 'انتظار المراجعة';

type BranchSummary = {
  branch: string;
  pending: number;
  pending_value: number;
  oldest_pending: string | null;
  yesterday: number;
  yesterday_value: number;
  month: number;
  month_value: number;
};

type PurchaseRow = {
  id: string;
  number: string | null;
  supplier_number: string | null;
  supplier: string | null;
  branch: string | null;
  invoice_date: string | null;
  value: number | null;
  payment: string | null;
  category: string | null;
  type: string | null;
  entered_by: string | null;
  status: string | null;
  notes: string | null;
};

type PurchasesData = {
  synced_at: string | null;
  scoped_branch: string | null;
  branches: BranchSummary[];
  rows: PurchaseRow[];
};

const CATEGORY_LABEL: Record<string, string> = {
  medicines: 'أدوية',
  supplies_accessories: 'مستلزمات',
  unclassified: 'غير مصنّف',
};
const BRANCH_FILTERS = ['الكل', 'فرع شكري', 'فرع الشامي'] as const;
const STATUS_FILTERS = [
  ['pending', 'مستنية مراجعة'],
  ['all', 'كل الفواتير'],
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number][0];

type ViewMode = 'purchases' | 'catalog';

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

const shortDay = (value: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', {
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
      })
    : '-';

/** Whole days between an invoice date and today (Cairo calendar day of the browser). */
function purchaseAgeDays(invoiceDate: string | null, today = new Date()) {
  if (!invoiceDate) return 0;
  const start = new Date(`${invoiceDate.slice(0, 10)}T12:00:00`);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 864e5));
}

export default function Purchases() {
  const { isAdmin } = useAuth();
  const [view, setView] = useState<ViewMode>('purchases');
  const [catalogSummary, setCatalogSummary] = useState<CatalogSummary>({ total: 0, with_price: 0 });

  useEffect(() => {
    void getProductsCatalogSummary()
      .then(setCatalogSummary)
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-2xl">المشتريات</h1>
            <p className="dawaa-caption mt-1 font-bold">
              فواتير الشراء المسجلة في دواء وائل، ودليل الأصناف.
            </p>
          </div>
          <div className="dawaa-tabs">
            <button
              type="button"
              onClick={() => setView('purchases')}
              className={`dawaa-tab ${view === 'purchases' ? 'is-active' : ''}`}
              aria-selected={view === 'purchases'}
            >
              فواتير الشراء
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
        </div>
      </section>

      {view === 'purchases' ? (
        <DawaaWaelPurchases />
      ) : (
        <ProductCatalogPanel
          isAdmin={isAdmin}
          summary={catalogSummary}
          onImported={() =>
            void getProductsCatalogSummary()
              .then(setCatalogSummary)
              .catch(() => undefined)
          }
        />
      )}
    </div>
  );
}

function DawaaWaelPurchases() {
  const [data, setData] = useState<PurchasesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [branch, setBranch] = useState<(typeof BRANCH_FILTERS)[number]>('الكل');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error: rpcError } = await supabase.rpc('get_dawaawael_purchases_v1', {
      p_branch: branch === 'الكل' ? null : branch,
      p_status: status,
      p_search: query || null,
      p_limit: 300,
    });
    if (rpcError) {
      setError(
        rpcError.message.includes('not_authorized')
          ? 'فواتير الشراء لمديرين الفروع والإدارة بس'
          : 'تعذّر تحميل فواتير دواء وائل'
      );
    } else {
      setData(result as PurchasesData);
      setError(null);
    }
    setLoading(false);
  }, [branch, status, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const shown = useMemo(() => rows.reduce((sum, row) => sum + n(row.value), 0), [rows]);
  const synced = data?.synced_at ? new Date(data.synced_at) : null;
  const stale = !synced || Date.now() - synced.getTime() > 3600e3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={`text-xs font-bold ${stale ? 'text-[var(--dawaa-status-danger-text)]' : 'dawaa-caption'}`}
        >
          {stale ? '⚠️ ' : ''}آخر مزامنة مع دواء وائل:{' '}
          {synced
            ? synced.toLocaleString('ar-EG', {
                day: 'numeric',
                month: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
            : '—'}
        </p>
        <div className="flex gap-2">
          <a
            href={DAWAA_WAEL_PENDING}
            target="_blank"
            rel="noreferrer"
            className="dawaa-button dawaa-button--primary"
          >
            <ExternalLink size={16} /> راجع في دواء وائل
          </a>
          <button
            type="button"
            onClick={() => void load()}
            className="dawaa-button dawaa-button--secondary"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error ? (
        <div className="dawaa-alert dawaa-alert--danger text-sm font-bold">{error}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {(data?.branches ?? []).map((b) => (
          <BranchCard
            key={b.branch}
            summary={b}
            onOpen={() => {
              setBranch(b.branch as (typeof BRANCH_FILTERS)[number]);
              setStatus('pending');
            }}
          />
        ))}
      </div>

      <section className="dawaa-card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={STATUS_FILTERS.map(([id, label]) => ({ id, label }))}
            value={status}
            onChange={setStatus}
          />
          {data?.scoped_branch ? null : (
            <Segmented
              options={BRANCH_FILTERS.map((id) => ({ id, label: id.replace('فرع ', '') }))}
              value={branch}
              onChange={setBranch}
            />
          )}
          <div className="relative min-w-52 flex-1">
            <Search className="dawaa-caption absolute right-3 top-1/2 -translate-y-1/2" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="رقم الفاتورة أو المورد أو اللي سجّلها"
              className="dawaa-input py-2 pr-9 pl-3 text-sm font-bold"
            />
          </div>
        </div>
        <p className="dawaa-caption text-xs font-bold">
          {rows.length.toLocaleString('ar-EG')} فاتورة · {formatCurrency(shown)}
          {rows.length >= 300 ? ' · بيظهر أحدث ٣٠٠ بس، ضيّق البحث' : ''}
        </p>

        {rows.length ? (
          <div className="dawaa-table-shell shadow-none">
            <table className="dawaa-table-semantic min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-right">الفاتورة</th>
                  <th className="text-right">المورد</th>
                  <th className="text-right">الفرع</th>
                  <th className="text-right">التاريخ</th>
                  <th className="text-right">القيمة</th>
                  <th className="text-right">سجّلها</th>
                  <th className="text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pending = row.status === PENDING;
                  const age = purchaseAgeDays(row.invoice_date);
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className="font-black">{row.number || '-'}</span>
                        {row.supplier_number ? (
                          <span className="dawaa-caption block text-[11px] font-bold">
                            المورد: {row.supplier_number}
                          </span>
                        ) : null}
                      </td>
                      <td className="font-bold">
                        {row.supplier || '-'}
                        <span className="dawaa-caption block text-[11px]">
                          {[
                            CATEGORY_LABEL[row.category || ''],
                            row.type === 'internal_transfer' ? 'تحويل داخلي' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </td>
                      <td>{(row.branch || '-').replace('فرع ', '')}</td>
                      <td>{shortDay(row.invoice_date)}</td>
                      <td className="font-black">
                        {formatCurrency(n(row.value))}
                        {row.payment ? (
                          <span className="dawaa-caption block text-[11px] font-bold">
                            {row.payment}
                          </span>
                        ) : null}
                      </td>
                      <td>{row.entered_by || '-'}</td>
                      <td>
                        <span
                          className={`dawaa-badge rounded-full px-2 py-0.5 text-[11px] font-black ${
                            !pending
                              ? 'dawaa-badge--success'
                              : age > 2
                                ? 'dawaa-badge--danger'
                                : 'dawaa-badge--warning'
                          }`}
                        >
                          {pending ? `مستنية · ${age} يوم` : row.status || '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dawaa-empty-state p-6 text-sm font-bold">
            {loading
              ? 'جاري التحميل...'
              : status === 'pending'
                ? 'مفيش فواتير مستنية مراجعة ✓'
                : 'مفيش فواتير مطابقة'}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <QuickLink to="/purchase-returns" icon={RotateCcw} label="مرتجعات المشتريات" />
        <QuickLink to="/purchase-cycle-report" icon={PackageSearch} label="دورة المشتريات" />
        <QuickLink to="/supplier-accounts" icon={Wallet} label="حسابات الموردين" />
        <QuickLink to="/purchase-order-log" icon={ClipboardList} label="سجل الطلبيات" />
      </div>
    </div>
  );
}

function BranchCard({ summary, onOpen }: { summary: BranchSummary; onOpen: () => void }) {
  const late = summary.pending > 0 && purchaseAgeDays(summary.oldest_pending) > 2;
  const tone = !summary.pending
    ? 'var(--dawaa-status-success'
    : late
      ? 'var(--dawaa-status-danger'
      : 'var(--dawaa-status-warning';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-2xl border p-4 text-right transition hover:opacity-90"
      style={{ borderColor: `${tone}-border)`, background: `${tone}-bg)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="dawaa-title text-base">{summary.branch}</span>
        <span className="text-xs font-black" style={{ color: `${tone}-text)` }}>
          {summary.pending ? `أقدمهم ${shortDay(summary.oldest_pending)}` : 'مفيش حاجة مستنية'}
        </span>
      </div>
      <p className="mt-2 text-2xl font-black" style={{ color: `${tone}-text)` }}>
        {summary.pending.toLocaleString('ar-EG')} فاتورة مستنية
        <span className="mr-2 text-sm">{formatCurrency(n(summary.pending_value))}</span>
      </p>
      <div className="dawaa-caption mt-2 flex flex-wrap gap-x-4 text-xs font-bold">
        <span>
          امبارح {summary.yesterday.toLocaleString('ar-EG')} ·{' '}
          {formatCurrency(n(summary.yesterday_value))}
        </span>
        <span>
          الشهر {summary.month.toLocaleString('ar-EG')} · {formatCurrency(n(summary.month_value))}
        </span>
      </div>
    </button>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="flex gap-1 rounded-xl p-1"
      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`dawaa-tab px-3 py-1 text-xs ${value === option.id ? 'is-active' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link to={to} className="dawaa-tab inline-flex items-center gap-2 text-xs font-black">
      <Icon size={14} /> {label}
    </Link>
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

  const pricedCount = useMemo(
    () => preview.filter((row) => row.price !== null && row.price > 0).length,
    [preview]
  );

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
      setMessage(
        `تم التعرف على ${rows.length.toLocaleString('ar-EG')} صنف. راجع العينة ثم اضغط استيراد وتحديث.`
      );
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
        <Card
          title="إجمالي الأصناف"
          value={summary.total.toLocaleString('ar-EG')}
          icon={BookOpenCheck}
        />
        <Card
          title="أصناف لها سعر"
          value={summary.with_price.toLocaleString('ar-EG')}
          icon={PackageSearch}
        />
        <Card
          title="آخر تحديث"
          value={
            summary.last_updated_at
              ? new Date(summary.last_updated_at).toLocaleDateString('ar-EG')
              : '-'
          }
          icon={RefreshCw}
        />
      </div>

      {isAdmin ? (
        <section className="dawaa-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="dawaa-title text-lg">تحديث دليل الأصناف</h2>
              <p className="dawaa-caption mt-1 max-w-2xl font-bold leading-7">
                ارفع نفس ملف B-Connect كما هو. النظام يستخرج تلقائيًا كود الصنف والاسم وسعر البيع،
                ويحدّث الموجود ويضيف الجديد فقط. لا يتم حذف أي صنف قديم.
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

          {selectedFile ? (
            <div className="dawaa-card dawaa-card--soft mt-3 p-3 text-sm font-bold">
              الملف: {selectedFile.name}
            </div>
          ) : null}
          {message ? (
            <div className="dawaa-alert dawaa-alert--info mt-3 text-sm font-bold">{message}</div>
          ) : null}

          {preview.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="dawaa-body text-sm font-black">
                  {preview.length.toLocaleString('ar-EG')} صنف ·{' '}
                  {pricedCount.toLocaleString('ar-EG')} بسعر صالح
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
              {searching
                ? 'جاري البحث...'
                : summary.total
                  ? 'لا توجد نتائج مطابقة.'
                  : 'ارفع ملف الأصناف أولًا.'}
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
        <span className="dawaa-icon-tile h-11 w-11 shrink-0">
          <Icon size={20} />
        </span>
      </div>
    </div>
  );
}
