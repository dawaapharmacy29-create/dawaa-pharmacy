import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingCart,
  CreditCard,
  Banknote,
  Package,
  Building2,
  Users,
  ClipboardList,
  Handshake,
  TrendingUp,
  User,
  CircleHelp,
  ExternalLink,
  type LucideIcon,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Eye,
  Landmark,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Panel,
  SectionTitle,
  EmptyState,
  MiniBox,
} from '@/components/dashboard/DashboardPrimitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  accountantExportText,
  accountantFilter,
  accountantHistoryRows,
  accountantSyncStale,
  loadAccountantReport,
  type AccountantReport,
  type AccountantTransaction,
} from '@/lib/accountantReport';
import './ConsolidatedReports.css';

const ALL = 'all',
  PAGE_SIZE = 50;
const money = (value: number | null | undefined) =>
  value == null
    ? 'غير متاح'
    : Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
const monthLabel = (month: string) =>
  new Date(month + '-15T12:00:00').toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
const timeLabel = (value?: string | null) =>
  value ? new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : 'لم تتم المزامنة';
const signedClass = (value: number) => (value < 0 ? 'treasury-negative' : 'treasury-positive');
const groupIcons: Record<string, LucideIcon> = {
  مبيعات: ShoppingCart,
  'تحصيل الكتروني': CreditCard,
  سيولة: Banknote,
  مخازن: Package,
  شركات: Building2,
  مرتبات: Users,
  'مصروفات ادارية': ClipboardList,
  جمعيات: Handshake,
  ارباح: TrendingUp,
  'مصروفات شخصية': User,
  'غير مصنف': CircleHelp,
};

export default function ConsolidatedReports() {
  const [report, setReport] = useState<AccountantReport | null>(null);
  const [month, setMonth] = useState<string | null>(null),
    [vault, setVault] = useState(ALL);
  const [tab, setTab] = useState('overview'),
    [direction, setDirection] = useState(''),
    [category, setCategory] = useState('');
  const [itemName, setItemName] = useState('');
  const [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [page, setPage] = useState(1),
    [detail, setDetail] = useState<AccountantTransaction | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [exporting, setExporting] = useState(false);
  const request = useRef(0);
  const load = useCallback(async (target: string | null) => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const next = await loadAccountantReport(target);
      if (id === request.current) setReport(next);
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : 'تعذّر تحميل التقرير');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(month);
    return () => {
      ++request.current;
    };
  }, [load, month]);
  useEffect(() => {
    setPage(1);
  }, [vault, direction, category, query, from, to, month, itemName]);
  const vaults = report?.vaults ?? [];
  const chosenVaults = vaults.filter((v) => vault === ALL || v.code === vault);
  const rows = useMemo(
    () =>
      accountantFilter(report?.transactions ?? [], {
        vault: vault === ALL ? null : vault,
        direction,
        category,
        query,
        from,
        to,
        itemName,
      }),
    [report, vault, direction, category, query, from, to, itemName]
  );
  const history = useMemo(
    () => accountantHistoryRows(report?.history ?? [], vault === ALL ? null : vault),
    [report, vault]
  );
  const totals = rows.reduce(
    (s, t) => ({
      incoming: s.incoming + (t.direction === 'in' ? Number(t.amount) : 0),
      outgoing: s.outgoing + (t.direction === 'out' ? Number(t.amount) : 0),
    }),
    { incoming: 0, outgoing: 0 }
  );
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        direction: string;
        name: string;
        total: number;
        count: number;
        items: Map<string, { total: number; count: number }>;
      }
    >();
    for (const [direction, names] of Object.entries({
      in: ['مبيعات', 'تحصيل الكتروني', 'سيولة'],
      out: ['مخازن', 'شركات', 'مرتبات', 'مصروفات ادارية', 'جمعيات', 'ارباح', 'مصروفات شخصية'],
    }))
      for (const name of names)
        map.set(direction + '|' + name, { direction, name, total: 0, count: 0, items: new Map() });
    for (const t of rows) {
      const key = t.direction + '|' + t.classification;
      const g = map.get(key) ?? {
        direction: t.direction,
        name: t.classification,
        total: 0,
        count: 0,
        items: new Map(),
      };
      g.total += Number(t.amount);
      g.count++;
      const name = t.category_name || 'بدون بند',
        item = g.items.get(name) ?? { total: 0, count: 0 };
      item.total += Number(t.amount);
      item.count++;
      g.items.set(name, item);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows]);
  const daily = useMemo(() => {
    const map = new Map<string, { date: string; incoming: number; outgoing: number }>();
    for (const t of rows) {
      const d = map.get(t.date) ?? { date: t.date, incoming: 0, outgoing: 0 };
      d[t.direction === 'in' ? 'incoming' : 'outgoing'] += Number(t.amount);
      map.set(t.date, d);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);
  const categories = [...new Set((report?.transactions ?? []).map((t) => t.classification))].sort();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    currentPage = Math.min(page, pages);
  const name = (code: string) => vaults.find((v) => v.code === code)?.name ?? code;
  const reset = () => {
    setItemName('');
    setDirection('');
    setCategory('');
    setQuery('');
    setFrom('');
    setTo('');
  };
  const showCategory = (value: string, dir: string) => {
    reset();
    setCategory(value);
    setDirection(dir);
    setTab('ledger');
  };
  const exportRows = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx'),
        wb = XLSX.utils.book_new();
      const data = rows.map((t) => ({
        التاريخ: t.date,
        الخزنة: accountantExportText(name(t.vault_code)),
        البيان: accountantExportText(t.description),
        البند: accountantExportText(t.category_name),
        التصنيف: accountantExportText(t.classification),
        الوارد: t.direction === 'in' ? Number(t.amount) : 0,
        الصادر: t.direction === 'out' ? Number(t.amount) : 0,
        'رصيد الخزنة بعد الحركة': Number(t.running_balance),
        المسجل: accountantExportText(t.created_by_name),
        'البيان الأصلي': accountantExportText(t.source_details?.original_description),
        'صف المصدر': t.source_details?.source_row ?? '',
        'رقم الحركة': accountantExportText(t.id),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [
        { wch: 14 },
        { wch: 24 },
        { wch: 40 },
        { wch: 30 },
        { wch: 22 },
        ...Array.from({ length: 8 }, () => ({ wch: 22 })),
      ];
      if (data.length) ws['!autofilter'] = { ref: ws['!ref']! };
      XLSX.utils.book_append_sheet(wb, ws, 'حركات الفترة');
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          history.map((h) => ({
            الشهر: h.month,
            'رصيد البداية': h.opening ?? 'غير مكتمل',
            الوارد: h.incoming,
            الصادر: h.outgoing,
            الفرق: h.incoming - h.outgoing,
          }))
        ),
        'ستة أشهر'
      );
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(wb, `Dawaa_Treasury_${report?.month}.xlsx`);
    } catch {
      setError('تعذر تصدير الملف؛ حاول مرة أخرى');
    } finally {
      setExporting(false);
    }
  };
  if (loading && !report)
    return (
      <div className="flex justify-center p-12" role="status">
        <Loader2 className="animate-spin" />
        <span className="sr-only">جارٍ تحميل دفتر الخزن</span>
      </div>
    );
  if (!report)
    return (
      <EmptyState label={error || 'تعذر تحميل التقرير'} error onRetry={() => void load(month)} />
    );
  const stale = accountantSyncStale(report.synced_at);
  const monthEnd = new Date(
    Number(report.month.slice(0, 4)),
    Number(report.month.slice(5, 7)),
    0,
    12
  ).getDate();
  return (
    <div className="treasury-report space-y-5" dir="rtl" aria-busy={loading}>
      <header className="treasury-hero">
        <div className="flex items-start gap-3">
          <span className="treasury-hero-icon">
            <Landmark size={28} />
          </span>
          <div>
            <p className="treasury-eyebrow">دواء بيلز / دفتر الخزن</p>
            <h1 className="text-2xl md:text-3xl font-black mt-1">التقارير المجمعة</h1>
            <p className="dawaa-caption mt-2">
              صورة مالية واحدة للخزن الثلاثة، من الملخص إلى تفاصيل كل حركة.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-5">
          <span className={`treasury-badge ${stale ? 'treasury-warning' : ''}`}>
            {stale ? 'المزامنة تحتاج مراجعة' : 'متصل بدواء بيلز'} · {timeLabel(report.synced_at)}
          </span>
          <span className="treasury-badge">تزامن تلقائي كل ١٥ دقيقة</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="treasury-button" disabled={loading} onClick={() => void load(month)}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث العرض
          </button>
          <button
            className="treasury-button"
            disabled={exporting || loading}
            onClick={() => void exportRows()}
          >
            <Download size={16} />
            {exporting ? 'جارٍ التصدير' : 'تصدير Excel'}
          </button>
          <a
            className="treasury-button"
            href="https://dawaabill.base44.app/accountant"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} />
            فتح دواء بيلز
          </a>
        </div>
      </header>
      {error && (
        <div role="alert" className="dawaa-alert dawaa-alert--danger flex justify-between gap-3">
          {error}
          <button onClick={() => void load(month)} className="underline">
            إعادة المحاولة
          </button>
        </div>
      )}
      {stale && (
        <div role="status" className="dawaa-alert dawaa-alert--danger">
          البيانات المعروضة من آخر مزامنة ناجحة.{' '}
          {report.last_error
            ? 'تعذر تحديث المصدر؛ راجع الاتصال بدواء بيلز.'
            : 'لم تصل مزامنة ناجحة خلال الساعة الأخيرة.'}
        </div>
      )}
      <section className="grid md:grid-cols-4 gap-3" aria-label="أرصدة الخزن الحالية">
        <Panel className="p-5 treasury-total">
          <p className="dawaa-caption font-bold text-sm">إجمالي الأرصدة الحالية</p>
          <p
            className={`text-3xl font-black mt-3 ${signedClass(vaults.reduce((s, v) => s + Number(v.balance), 0))}`}
          >
            {money(vaults.reduce((s, v) => s + Number(v.balance), 0))}
          </p>
          <p className="dawaa-caption text-xs mt-3">لكل الفترات · يشمل الأرصدة السالبة</p>
        </Panel>
        {vaults.map((v) => (
          <button
            type="button"
            key={v.code}
            className={`treasury-vault ${vault === v.code ? 'is-selected' : ''}`}
            onClick={() => {
              setVault(vault === v.code ? ALL : v.code);
              reset();
            }}
            aria-pressed={vault === v.code}
          >
            <span className="flex items-center gap-2 font-bold">
              <Wallet size={18} />
              {v.name}
            </span>
            <span className={`block text-2xl font-black mt-3 ${signedClass(Number(v.balance))}`}>
              {money(v.balance)}
            </span>
            <span className="block dawaa-caption text-xs mt-3">
              رصيد البداية {money(v.opening_balance)} · {v.opening_date || 'بدون تاريخ افتتاح'}
            </span>
            <span className="block dawaa-caption text-xs mt-1">آخر حركة {v.last_date || '—'}</span>
          </button>
        ))}
      </section>
      <Panel className="p-4 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="text-sm font-bold space-y-2">
            <span className="block">الخزنة</span>
            <select
              className="dawaa-input w-full"
              value={vault}
              onChange={(e) => {
                setVault(e.target.value);
                reset();
              }}
            >
              <option value={ALL}>كل الخزن</option>
              {vaults.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold space-y-2">
            <span className="block">شهر التقرير</span>
            <select
              className="dawaa-input w-full"
              disabled={loading}
              value={report.month}
              onChange={(e) => {
                reset();
                setMonth(e.target.value);
              }}
            >
              {[...new Set([report.month, ...report.months])]
                .sort()
                .reverse()
                .map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              className="treasury-button"
              disabled={loading}
              onClick={() => {
                reset();
                setMonth(report.today.slice(0, 7));
              }}
            >
              الشهر الحالي
            </button>
            <button
              className="treasury-button"
              disabled={loading}
              onClick={() => {
                const [y, m] = report.month.split('-').map(Number);
                reset();
                setMonth(new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7));
              }}
            >
              الشهر السابق
            </button>
          </div>
        </div>
        <p className="dawaa-caption text-xs">
          التقارير حسب الشهر الميلادي كما في دواء بيلز. الأرصدة الحالية أعلاه تشمل كل الحركات منذ
          رصيد البداية.
        </p>
      </Panel>
      <div className="grid md:grid-cols-3 gap-3">
        {chosenVaults.map((v) => (
          <Panel key={v.code} className="p-4 text-sm">
            <b>
              {v.name} · {monthLabel(report.month)}
            </b>
            <div className="flex justify-between mt-3">
              <span className="dawaa-caption">رصيد بداية الشهر</span>
              <strong>{money(v.period_opening)}</strong>
            </div>
            <div className="flex justify-between mt-2">
              <span className="dawaa-caption">وارد / صادر الشهر</span>
              <strong>
                {money(v.period_incoming)} / {money(v.period_outgoing)}
              </strong>
            </div>
            {v.source_details?.source_closing_date && (
              <p className="dawaa-caption text-xs mt-3">
                آخر رصيد بملف المصدر: {money(v.source_details.source_closing_balance)} ·{' '}
                {v.source_details.source_closing_date}
              </p>
            )}
          </Panel>
        ))}
      </div>
      <nav className="flex gap-2 overflow-x-auto" aria-label="أقسام التقرير">
        {[
          ['overview', 'نظرة عامة والتصنيفات'],
          ['ledger', 'كشف الحركات'],
          ['history', 'مقارنة ٦ أشهر'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`dawaa-tab whitespace-nowrap ${tab === id ? 'is-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab !== 'history' && (
        <>
          <div className="grid sm:grid-cols-4 gap-3">
            <MiniBox label="وارد الفترة المعروضة" value={money(totals.incoming)} tone="green" />
            <MiniBox label="صادر الفترة المعروضة" value={money(totals.outgoing)} tone="amber" />
            <MiniBox label="صافي الحركة" value={money(totals.incoming - totals.outgoing)} />
            <MiniBox label="عدد الحركات" value={String(rows.length)} />
          </div>
          {chosenVaults.some((v) => v.period_opening === null) && (
            <p className="dawaa-caption text-xs">
              الفترة السابقة لتاريخ افتتاح الخزنة غير مكتملة؛ لا يُفترض لها رصيد بداية.
            </p>
          )}
        </>
      )}
      {tab === 'overview' && (
        <>
          <Panel className="p-5">
            <SectionTitle
              title={`تدفق النقد خلال ${monthLabel(report.month)}`}
              icon={<ArrowUpRight size={18} />}
            />
            <p className="dawaa-caption text-xs mt-1">الوارد والصادر اليومي للخزنة المختارة</p>
            {daily.length ? (
              <div className="h-64 mt-4" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--dawaa-theme-border)"
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => String(d).slice(8)}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(n) => Number(n).toLocaleString('en', { notation: 'compact' })}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: number) => money(v)}
                      contentStyle={{
                        background: 'var(--dawaa-theme-surface)',
                        borderColor: 'var(--dawaa-theme-border)',
                        borderRadius: 12,
                        color: 'var(--dawaa-theme-text)',
                      }}
                    />
                    <Legend />
                    <Bar
                      isAnimationActive={false}
                      dataKey="incoming"
                      name="الوارد"
                      fill="#14b8a6"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey="outgoing"
                      name="الصادر"
                      fill="#f59e0b"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState label="لا توجد حركات في هذا الشهر" />
            )}
          </Panel>
          {['in', 'out'].map((dir) => (
            <section key={dir}>
              <h2 className="text-lg font-black flex gap-2 items-center mb-3">
                {dir === 'in' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}توزيع{' '}
                {dir === 'in' ? 'الوارد' : 'الصادر'} حسب التصنيف
              </h2>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {groups
                  .filter((g) => g.direction === dir)
                  .map((g) => (
                    <details key={g.name} className={`treasury-group treasury-group--${dir}`}>
                      <summary>
                        <span className="treasury-group-icon" aria-hidden="true">
                          {createElement(groupIcons[g.name] || Package, { size: 22 })}
                        </span>
                        <span className="font-black">{g.name}</span>
                        <span className="mr-auto text-xs">تفاصيل ▾</span>
                        <strong className="block w-full text-2xl mt-3">{money(g.total)}</strong>
                        <span className="dawaa-caption text-xs">
                          {g.count} حركة ·{' '}
                          {(
                            (g.total / (dir === 'in' ? totals.incoming : totals.outgoing)) * 100 ||
                            0
                          ).toFixed(1)}
                          ٪
                        </span>
                      </summary>
                      <div className="treasury-progress mt-3">
                        <span
                          style={{
                            width: `${Math.min(100, (g.total / (dir === 'in' ? totals.incoming : totals.outgoing)) * 100 || 0)}%`,
                          }}
                        />
                      </div>
                      <div className="space-y-3 mt-4">
                        {[...g.items]
                          .sort((a, b) => b[1].total - a[1].total)
                          .map(([item, v]) => (
                            <button
                              key={item}
                              className="flex w-full items-start justify-between gap-3 text-sm text-right"
                              onClick={() => {
                                showCategory(g.name, dir);
                                setItemName(item);
                              }}
                            >
                              <span>
                                {item}
                                <small className="block dawaa-caption">
                                  {v.count} حركة · عرض السجل
                                </small>
                              </span>
                              <b className="whitespace-nowrap">{money(v.total)}</b>
                            </button>
                          ))}
                        <button
                          className="treasury-button w-full justify-center"
                          onClick={() => showCategory(g.name, dir)}
                        >
                          عرض كل حركات التصنيف <Eye size={15} />
                        </button>
                      </div>
                    </details>
                  ))}
              </div>
              {!groups.some((g) => g.direction === dir) && <EmptyState label="لا توجد حركات" />}
            </section>
          ))}
        </>
      )}
      {tab === 'ledger' && (
        <Panel className="p-4 space-y-4">
          <SectionTitle title="كشف حركة الخزنة" icon={<Landmark size={18} />} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <label className="lg:col-span-2 relative">
              <span className="sr-only">بحث في الحركات</span>
              <Search size={16} className="absolute right-3 top-3" />
              <input
                className="dawaa-input w-full pr-9"
                placeholder="ابحث بالبيان، البند، المسجل أو رقم الحركة"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="نوع الحركة"
              className="dawaa-input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="">وارد وصادر</option>
              <option value="in">وارد فقط</option>
              <option value="out">صادر فقط</option>
            </select>
            <select
              aria-label="التصنيف"
              className="dawaa-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">كل التصنيفات</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label className="text-xs">
              من
              <input
                aria-label="من تاريخ"
                type="date"
                min={report.month + '-01'}
                max={report.month + '-' + monthEnd}
                className="dawaa-input w-full"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-xs">
              إلى
              <input
                aria-label="إلى تاريخ"
                type="date"
                min={report.month + '-01'}
                max={report.month + '-' + monthEnd}
                className="dawaa-input w-full"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          {itemName && (
            <p className="treasury-badge">
              البند المحدد: {itemName}
              <button className="mr-3 underline" onClick={() => setItemName('')}>
                إلغاء تحديد البند
              </button>
            </p>
          )}
          <div className="flex justify-between flex-wrap gap-2 text-xs dawaa-caption">
            <p>الرصيد بعد الحركة هو رصيد خزنتها الفعلي، ويظل ثابتًا عند البحث أو الفلترة.</p>
            <button onClick={reset} className="underline">
              مسح الفلاتر
            </button>
          </div>
          {from && to && from > to ? (
            <p role="alert" className="treasury-negative">
              تاريخ البداية بعد تاريخ النهاية.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="treasury-table">
              <thead>
                <tr>
                  {[
                    'التاريخ',
                    'الخزنة / البيان',
                    'البند والتصنيف',
                    'وارد',
                    'صادر',
                    'الرصيد بعد الحركة',
                    'التفاصيل',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">{t.date}</td>
                    <td>
                      <b className="block">{t.description || 'بدون بيان'}</b>
                      <small className="dawaa-caption">
                        {name(t.vault_code)}
                        {t.created_by_name ? ' · ' + t.created_by_name : ''}
                      </small>
                    </td>
                    <td>
                      <span className="treasury-badge">{t.classification}</span>
                      <small className="block mt-1 dawaa-caption">
                        {t.category_name || 'بدون بند'}
                      </small>
                    </td>
                    <td className="treasury-positive whitespace-nowrap">
                      {t.direction === 'in' ? money(t.amount) : '—'}
                    </td>
                    <td className="treasury-negative whitespace-nowrap">
                      {t.direction === 'out' ? money(t.amount) : '—'}
                    </td>
                    <td
                      className={`font-black whitespace-nowrap ${signedClass(t.running_balance)}`}
                    >
                      {money(t.running_balance)}
                    </td>
                    <td>
                      <button
                        className="treasury-button"
                        aria-label={'تفاصيل حركة ' + t.id}
                        onClick={() => setDetail(t)}
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <EmptyState label="لا توجد حركات مطابقة للفلاتر" />}
          <div className="flex justify-between flex-wrap items-center gap-2 text-sm">
            <span>
              صفحة {currentPage} من {pages} · إجمالي {rows.length} حركة
            </span>
            <div className="flex gap-2">
              <button
                className="treasury-button"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                السابق
              </button>
              <button
                className="treasury-button"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        </Panel>
      )}
      {tab === 'history' && (
        <Panel className="p-5 space-y-4">
          <SectionTitle title="تطور الخزنة خلال ٦ أشهر" icon={<Wallet size={18} />} />
          <p className="dawaa-caption text-sm">
            رصيد البداية يوم ١ قبل حركات اليوم، والشهر الحالي حتى {report.today}. اختر شهرًا من
            الجدول لفتح تفاصيله.
          </p>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--dawaa-theme-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(n) => Number(n).toLocaleString('en', { notation: 'compact' })}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v: number) => money(v)}
                  contentStyle={{
                    background: 'var(--dawaa-theme-surface)',
                    borderRadius: 12,
                    color: 'var(--dawaa-theme-text)',
                  }}
                />
                <Legend />
                <Line
                  dataKey="opening"
                  name="رصيد بداية الشهر"
                  stroke="#14b8a6"
                  strokeWidth={3}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="incoming"
                  name="الوارد"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="outgoing"
                  name="الصادر"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="treasury-table">
              <thead>
                <tr>
                  {['الشهر', 'رصيد بداية الشهر', 'الوارد', 'الصادر', 'الفرق', 'عدد الحركات'].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.month}>
                    <td>
                      <button
                        className="underline font-bold"
                        disabled={loading}
                        onClick={() => {
                          reset();
                          setMonth(h.month);
                          setTab('ledger');
                        }}
                      >
                        {monthLabel(h.month)}
                      </button>
                    </td>
                    <td>
                      {money(h.opening)}
                      {h.opening === null && (
                        <small className="block dawaa-caption">قبل / خلال بداية السجل</small>
                      )}
                    </td>
                    <td className="treasury-positive">{money(h.incoming)}</td>
                    <td className="treasury-negative">{money(h.outgoing)}</td>
                    <td className={signedClass(h.incoming - h.outgoing)}>
                      {money(h.incoming - h.outgoing)}
                    </td>
                    <td>{h.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogTitle>تفاصيل حركة الخزنة</DialogTitle>
          <DialogDescription>
            {detail ? name(detail.vault_code) + ' · ' + detail.date : ''}
          </DialogDescription>
          {detail && (
            <div className="space-y-4">
              <p
                className={`text-3xl font-black ${detail.direction === 'in' ? 'treasury-positive' : 'treasury-negative'}`}
              >
                {detail.direction === 'in' ? '+' : '−'}
                {money(detail.amount)}
              </p>
              <dl className="treasury-detail">
                {[
                  ['البيان', detail.description],
                  ['البند', detail.category_name],
                  ['التصنيف', detail.classification],
                  ['المسجل', detail.created_by_name],
                  ['الرصيد بعد الحركة', money(detail.running_balance)],
                  ['البيان الأصلي', detail.source_details?.original_description],
                  [
                    'مصدر التصنيف',
                    detail.source_details?.source_classification_override
                      ? 'معدّل لهذه الحركة'
                      : detail.source_details?.alias_applied
                        ? 'الدليل الموحد'
                        : 'البند الأصلي',
                  ],
                  ['ورقة المصدر', detail.source_details?.source_sheet],
                  ['صف المصدر', detail.source_details?.source_row],
                  [
                    'تاريخ المصدر الأصلي',
                    detail.source_details?.source_date_adjusted
                      ? detail.source_details?.source_original_date
                      : null,
                  ],
                  [
                    'آخر تعديل للبيان',
                    detail.source_details?.description_edited_at
                      ? timeLabel(detail.source_details.description_edited_at)
                      : null,
                  ],
                  ['عدّل البيان', detail.source_details?.description_edited_by],
                  ['قيد متعادل', detail.is_offset_pair ? 'نعم' : null],
                  ['معرّف الحركة', detail.id],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <a
                className="treasury-button"
                href={
                  'https://dawaabill.base44.app/accountant/' +
                  encodeURIComponent(detail.vault_code) +
                  '?movement=' +
                  encodeURIComponent(detail.id)
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} />
                فتح الحركة في دواء بيلز
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <footer
        className="dawaa-caption text-xs border-t pt-4"
        style={{ borderColor: 'var(--dawaa-theme-border)' }}
      >
        المصدر: دفتر المحاسب في دواء بيلز. الحركات الملغاة والتجريبية مستبعدة. مراجعة البنود
        والتعديلات المالية تتم في المصدر وتظهر بعد المزامنة.
      </footer>
    </div>
  );
}
