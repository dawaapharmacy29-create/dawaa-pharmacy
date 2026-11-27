import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Boxes, Download, FileUp, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { readStockFile, type StockFile } from '@/lib/inventory/stockFile';
import {
  BRANCH_OWNER,
  download,
  exportSheets,
  loadInventoryOverview,
  uploadStockFile,
  type Col,
  type CountReason,
  type InventoryOverview,
  type RequestAdvice,
  type InvCompany,
  type InvCount,
  type InvDead,
  type InvExpiryStore,
  type InvMover,
  type InvNearExpiry,
  type InvOrder,
  type InvOver,
  type InvRequest,
} from '@/lib/inventory/stock';

// «رصيد المخازن»: ملف بي كونكت بيترفع كل يوم، ومنه إحنا فين (قيمة المخزون وبيكفي كام يوم)، والطلبية المقترحة في حدود
// الميزانية، وطلبات العملاء اللي صنفها اتوفر، واللي قرب يخلص تاريخه، والإكسبير، والرواكد، والأوفر ستوك، والجرد المقترح.

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const n = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : Number(v).toLocaleString('ar-EG', { maximumFractionDigits: d });
const money = (v: number | null | undefined) => (v == null ? '—' : `${n(Math.round(v))} ج`);
const dm = (iso: string | null | undefined) =>
  iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(2, 4)}` : '—';
const short = (b: string) => b.replace('فرع ', '');

const TABS = {
  orders: 'الطلبية المقترحة',
  requests: 'طلبات العملاء اللي اتوفرت',
  expiry: 'قرب الانتهاء (٦ شهور)',
  expiry_store: 'مخزن الإكسبير',
  dead: 'الرواكد',
  over: 'الأوفر ستوك',
  count: 'الجرد المقترح',
  moves: 'الحركة: زاد وقل',
} as const;
type Tab = keyof typeof TABS;

const COUNT_REASON: Record<CountReason, string> = {
  fast: 'سريع الحركة',
  negative: 'رصيد بالسالب',
  value: 'قيمته عالية',
  multi_code: 'أكتر من كود',
  multi_pack: 'أكتر من علبة',
};

const ADVICE: Record<RequestAdvice, { label: string; tone: string }> = {
  release: { label: 'اطلعيه للعميل', tone: 'text-[var(--dawaa-status-success-text)]' },
  release_important: {
    label: 'الكمية قليلة بس العميل مهم: اطلعيه',
    tone: 'text-[var(--dawaa-status-success-text)]',
  },
  low: {
    label: 'الكمية قليلة والعميل طياري: استني الطلبية',
    tone: 'text-[var(--dawaa-status-warning-text)]',
  },
  other_branch: {
    label: 'موجود في الفرع التاني: حوّليه',
    tone: 'text-[var(--dawaa-status-info-text)]',
  },
};

export default function InventoryStock() {
  const [branch, setBranch] = useState('');
  const [cover, setCover] = useState(21);
  const [budgetText, setBudgetText] = useState('');
  const budget = Number(budgetText.replace(/[^\d.]/g, '')) || null;
  const [data, setData] = useState<InventoryOverview | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('orders');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setData(await loadInventoryOverview({ branch: branch || null, budget, coverDays: cover }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [branch, budget, cover]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <Panel>
        <SectionTitle
          icon={<Boxes size={18} />}
          title="رصيد المخازن"
          subtitle="ارفعي «رصيد الأصناف في المخازن» (أو «رصيد الأصناف») من بي كونكت كل يوم: قيمة المخزون، الطلبية، الرواكد، الإكسبير، والجرد."
        />
        <UploadBox onDone={() => void load()} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <select
            className="input-field !w-auto"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">الفرعين</option>
            {Object.entries(BRANCH_OWNER).map(([b, o]) => (
              <option key={b} value={b}>
                {b} · {o}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1 font-bold">
            الطلبية تكفي
            <select
              className="input-field !w-auto"
              value={cover}
              onChange={(e) => setCover(Number(e.target.value))}
            >
              {[7, 14, 21, 30, 45].map((d) => (
                <option key={d} value={d}>
                  {d} يوم
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1 font-bold">
            ميزانية كل فرع
            <input
              className="input-field !w-32"
              inputMode="numeric"
              placeholder="من غير حد"
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
            />
            ج
          </label>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} تحديث
          </button>
        </div>
      </Panel>

      {error ? (
        <Panel>
          <EmptyState label={error} />
        </Panel>
      ) : data === undefined ? (
        <div className="flex justify-center p-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : data === null ? (
        <Panel>
          <EmptyState label="لسه مفيش ملف رصيد اترفع. ارفعي «رصيد الأصناف في المخازن» من فوق." />
        </Panel>
      ) : (
        <>
          <Summary data={data} />
          <Panel>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TABS) as Tab[]).map((t) => (
                <button
                  key={t}
                  className={`rounded-full border px-3 py-1 text-xs font-black ${
                    tab === t
                      ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary)] text-white'
                      : 'border-[var(--dawaa-theme-border)]'
                  }`}
                  onClick={() => setTab(t)}
                >
                  {TABS[t]} <span className="opacity-70">{tabCount(data, t)}</span>
                </button>
              ))}
            </div>
            <div className="relative mt-3">
              <Search size={16} className="absolute top-1/2 right-3 -translate-y-1/2 opacity-50" />
              <input
                className="input-field !pr-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="دوّري بالكود أو اسم الصنف أو الشركة أو المورد أو العميل"
              />
            </div>
            <div className="mt-3">
              <TabBody data={data} tab={tab} q={q} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function tabCount(d: InventoryOverview, t: Tab) {
  const len = {
    orders: d.orders.filter((o) => o.buy_qty > 0 || o.transfer_qty > 0).length,
    requests: d.requests_in_stock.length,
    expiry: d.near_expiry.length,
    expiry_store: d.expiry_store.length,
    dead: d.dead.length,
    over: d.overstock.length,
    count: d.count.length,
    moves: d.movers_up.length + d.movers_down.length,
  }[t];
  return n(len);
}

// ---------- الرفع ----------

function UploadBox({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ file: StockFile; name: string } | null>(null);
  const [day, setDay] = useState(cairoToday());
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string>('');

  async function pick(f: File) {
    setReading(true);
    try {
      const file = await readStockFile(f);
      if (!file.rows.length) throw new Error('الملف مفيهوش أصناف عليها رصيد');
      setParsed({ file, name: f.name });
      if (file.printedDay) setDay(file.printedDay);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 12000 });
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function save() {
    if (!parsed) return;
    setProgress('بنبدأ…');
    try {
      const r = await uploadStockFile(parsed.file, parsed.name, day, (done, total) =>
        setProgress(`${n(done)} من ${n(total)} سطر`)
      );
      toast.success(`اتحفظ رصيد يوم ${dm(r.day)} (${n(r.rows)} سطر)`);
      setParsed(null);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 12000 });
    } finally {
      setProgress('');
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
          }}
        />
        <button
          className="btn-primary inline-flex items-center gap-1"
          disabled={reading || !!progress}
          onClick={() => input.current?.click()}
        >
          {reading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} ارفعي
          ملف الرصيد
        </button>
        {parsed ? (
          <>
            <span className="text-sm font-bold">
              {parsed.file.kind === 'batches'
                ? 'رصيد بالتشغيلات والصلاحية والتكلفة'
                : 'رصيد بالمخازن (من غير تكلفة ولا صلاحية)'}{' '}
              · {n(parsed.file.rows.length)} سطر
            </span>
            <label className="inline-flex items-center gap-1 text-sm font-bold">
              رصيد يوم
              <input
                type="date"
                className="input-field !w-auto"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <button className="btn-primary" disabled={!!progress} onClick={() => void save()}>
              {progress ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 size={14} className="animate-spin" /> {progress}
                </span>
              ) : (
                'احفظي'
              )}
            </button>
            <button className="btn-secondary" disabled={!!progress} onClick={() => setParsed(null)}>
              إلغاء
            </button>
          </>
        ) : (
          <span className="text-xs opacity-70">
            الأحسن «رصيد الأصناف في المخازن» لأنه فيه الصلاحية والتكلفة. «رصيد الأصناف» بيتحسب بآخر
            تكلفة معروفة.
          </span>
        )}
      </div>
      {parsed ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {parsed.file.stores.map((s) => (
            <span
              key={s.store}
              className="rounded-full bg-[var(--dawaa-theme-soft)] px-2 py-0.5 font-bold"
            >
              {s.store}: {n(s.items)} صنف
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- الملخص ----------

function Summary({ data }: { data: InventoryOverview }) {
  const stockOf = (b: string, kind: string) =>
    data.stores.filter((s) => s.branch === b && s.kind === kind).reduce((t, s) => t + s.value, 0);
  const nearOf = (b: string) =>
    data.stores
      .filter((s) => s.branch === b && s.kind !== 'expiry')
      .reduce((t, s) => t + s.near_expiry, 0);
  const orderOf = (b: string) => data.order_totals.find((o) => o.branch === b);
  const days = [...new Set(data.trend.map((t) => t.day))];

  return (
    <>
      <p className="px-1 text-xs opacity-70">
        رصيد يوم {dm(data.upload.day)}
        {data.upload.day < cairoToday() ? ' · معتمد لحد النهارده لحد ما يترفع ملف جديد' : ''}
        {data.upload.by ? ` · رفعه ${data.upload.by}` : ''}
        {data.upload.kind === 'summary' && data.upload.batches_day
          ? ` · الصلاحية من ملف ${dm(data.upload.batches_day)}`
          : ''}
        {' · '}البيع من فواتير الأصناف آخر ٩٠ يوم (من غير التحويلات)
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.branches.map((b) => {
          const dailyCogs = b.cogs_30 / 30;
          const coverDays = dailyCogs > 0 ? Math.round(b.value / dailyCogs) : null;
          const change = b.sold_value_prev30
            ? Math.round(((b.sold_value_30 - b.sold_value_prev30) / b.sold_value_prev30) * 100)
            : null;
          const order = orderOf(b.branch);
          return (
            <Panel key={b.branch}>
              <div className="flex items-baseline justify-between">
                <div className="text-lg font-black">{b.branch}</div>
                <div className="text-xs font-bold opacity-70">مع {BRANCH_OWNER[b.branch]}</div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="قيمة المخزون (تكلفة)"
                  value={money(b.value)}
                  sub={`بسعر البيع ${money(b.sale_value)}`}
                />
                <Stat
                  label="بيكفي"
                  value={coverDays == null ? '—' : `${n(coverDays)} يوم`}
                  sub="على تكلفة بيع آخر ٣٠ يوم"
                  warn={coverDays != null && coverDays > 90}
                />
                <Stat
                  label="بيع آخر أسبوعين"
                  value={money(b.sold_value_30)}
                  sub={change == null ? '' : `${change > 0 ? '+' : ''}${n(change)}% عن اللي قبلهم`}
                  good={change != null && change > 0}
                  warn={change != null && change < -10}
                />
                <Stat
                  label="أصناف عليها رصيد"
                  value={n(b.items)}
                  sub={`${n(b.out_of_stock)} صنف بيتباع وخلص`}
                />
                <Stat
                  label="رواكد (٩٠ يوم)"
                  value={money(b.dead_value)}
                  sub={`${n(b.dead_items)} صنف`}
                  warn
                />
                <Stat
                  label="أوفر ستوك (فوق شهرين)"
                  value={money(b.over_value)}
                  warn={b.over_value > 0}
                />
                <Stat
                  label="بيخلص في ٦ شهور"
                  value={money(nearOf(b.branch))}
                  warn={nearOf(b.branch) > 0}
                />
                <Stat label="مخزن الإكسبير" value={money(stockOf(b.branch, 'expiry'))} />
              </div>
              {order ? (
                <p className="mt-2 text-xs">
                  <span className="font-black">الطلبية: </span>
                  {n(order.lines)} صنف بـ {money(order.cost)}
                  {data.budget
                    ? ` · في حدود الميزانية ${n(order.in_budget_lines)} صنف بـ ${money(order.in_budget_cost)}`
                    : ''}
                  {order.transfer_lines
                    ? ` · ${n(order.transfer_lines)} صنف ممكن ييجي تحويل من الفرع التاني`
                    : ''}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {data.stores
                  .filter((s) => s.branch === b.branch)
                  .map((s) => (
                    <span
                      key={s.store}
                      className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5"
                    >
                      {s.store}: <b>{money(s.value)}</b> · {n(s.items)} صنف
                    </span>
                  ))}
              </div>
            </Panel>
          );
        })}
      </div>
      {days.length > 1 ? (
        <Panel>
          <SectionTitle
            title="قيمة المخزون يوم بيوم"
            subtitle="من الملفات اللي اترفعت (من غير الإكسبير)"
          />
          <div className="mt-3 flex h-36 items-end gap-1 overflow-x-auto">
            {(() => {
              const per = days.map((d) => ({
                d,
                v: data.trend.filter((t) => t.day === d).reduce((s, t) => s + t.value, 0),
              }));
              const max = Math.max(1, ...per.map((p) => p.v));
              return per.map((p) => (
                <div
                  key={p.d}
                  className="flex min-w-[2rem] flex-1 flex-col items-center"
                  title={`${dm(p.d)}: ${money(p.v)}`}
                >
                  <div
                    className="w-full rounded-t bg-[var(--dawaa-theme-primary)]"
                    style={{ height: `${(p.v / max) * 7.5}rem` }}
                  />
                  <span className="mt-1 text-[10px] opacity-60">{dm(p.d).slice(0, -3)}</span>
                </div>
              ));
            })()}
          </div>
        </Panel>
      ) : null}
      {data.stores.some((s) => s.branch === 'المكتب') ? (
        <p className="px-1 text-xs opacity-70">
          مخزن المكتب:{' '}
          {money(data.stores.filter((s) => s.branch === 'المكتب').reduce((t, s) => t + s.value, 0))}{' '}
          (مش محسوب على فرع).
        </p>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
  good,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-2">
      <div className="text-[11px] font-bold opacity-70">{label}</div>
      <div
        className={`text-lg font-black ${
          warn
            ? 'text-[var(--dawaa-status-danger-text)]'
            : good
              ? 'text-[var(--dawaa-status-success-text)]'
              : ''
        }`}
      >
        {value}
      </div>
      {sub ? <div className="text-[11px] opacity-60">{sub}</div> : null}
    </div>
  );
}

// ---------- الجداول ----------

type Column<T> = {
  header: string;
  cell: (r: T) => ReactNode;
  excel?: (r: T) => string | number | null;
  width?: number;
};

function DataTable<T>({
  rows,
  cols,
  q,
  text,
  exportName,
  note,
  rowTone,
}: {
  rows: T[];
  cols: Column<T>[];
  q: string;
  text: (r: T) => string;
  exportName: string;
  note?: ReactNode;
  rowTone?: (r: T) => string;
}) {
  const [limit, setLimit] = useState(100);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => text(r).toLowerCase().includes(t)) : rows;
  }, [rows, q, text]);

  async function exportExcel() {
    const sheetCols: Col<never>[] = cols
      .filter((c) => c.excel)
      .map((c) => ({ header: c.header, width: c.width ?? 14, value: c.excel as never }));
    download(
      await exportSheets([{ name: exportName, rows: shown, cols: sheetCols }], exportName),
      `${exportName}-${cairoToday()}.xlsx`
    );
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {note ? <span className="flex-1 opacity-70">{note}</span> : <span className="flex-1" />}
        <span className="font-bold">{n(shown.length)} سطر</span>
        <button
          className="btn-secondary inline-flex items-center gap-1 !px-2 !py-1 text-xs"
          disabled={!shown.length}
          onClick={() => void exportExcel()}
        >
          <Download size={14} /> إكسيل
        </button>
      </div>
      {shown.length === 0 ? (
        <EmptyState label={q ? 'مفيش حاجة بالبحث ده' : 'مفيش حاجة هنا'} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--dawaa-theme-soft)] text-xs">
              <tr className="text-right">
                {cols.map((c) => (
                  <th key={c.header} className="p-2 whitespace-nowrap">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((r, i) => (
                <tr
                  key={i}
                  className={`border-t border-[var(--dawaa-theme-border)] align-top ${rowTone?.(r) ?? ''}`}
                >
                  {cols.map((c) => (
                    <td key={c.header} className="p-2">
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > limit ? (
        <button className="btn-secondary mt-2 text-xs" onClick={() => setLimit(limit + 200)}>
          اعرضي كمان ({n(shown.length - limit)} فاضلين)
        </button>
      ) : null}
    </>
  );
}

const item = (code: string, name: string, sub?: string | null) => (
  <span>
    <span className="font-bold" dir="auto">
      {name}
    </span>{' '}
    <span className="text-xs opacity-60">({code})</span>
    {sub ? <span className="block text-[11px] opacity-60">{sub}</span> : null}
  </span>
);
const branchCol = <T extends { branch: string }>(): Column<T> => ({
  header: 'الفرع',
  cell: (r) => short(r.branch),
  excel: (r) => r.branch,
  width: 10,
});

function TabBody({ data, tab, q }: { data: InventoryOverview; tab: Tab; q: string }) {
  if (tab === 'orders') {
    const rows = data.orders.filter((o) => o.buy_qty > 0 || o.transfer_qty > 0);
    return (
      <DataTable<InvOrder>
        rows={rows}
        q={q}
        exportName="الطلبية المقترحة"
        text={(r) => `${r.code} ${r.name} ${r.company ?? ''}`}
        note={`الكمية تكفي ${data.cover_days} يوم على معدل البيع. الأول: اللي خلص، وعليه طلبات عملاء، والأكتر حركة. الأحمر برّه الميزانية.`}
        rowTone={(r) => (r.in_budget ? '' : 'opacity-50')}
        cols={[
          branchCol(),
          {
            header: 'الصنف',
            cell: (r) => item(r.code, r.name, r.company),
            excel: (r) => r.name,
            width: 34,
          },
          { header: 'الكود', cell: (r) => r.code, excel: (r) => r.code, width: 9 },
          {
            header: 'الرصيد',
            cell: (r) => (
              <b className={r.out ? 'text-[var(--dawaa-status-danger-text)]' : ''}>{n(r.qty, 1)}</b>
            ),
            excel: (r) => r.qty,
            width: 9,
          },
          {
            header: 'بيتباع في الشهر',
            cell: (r) => n(r.rate30, 1),
            excel: (r) => r.rate30,
            width: 10,
          },
          { header: 'فواتير ٩٠ يوم', cell: (r) => n(r.n90), excel: (r) => r.n90, width: 10 },
          {
            header: 'طلبات عملاء',
            cell: (r) => (r.requests ? <b>{n(r.requests)}</b> : '—'),
            excel: (r) => r.requests,
            width: 9,
          },
          {
            header: 'تحويل من الفرع التاني',
            cell: (r) =>
              r.transfer_qty ? (
                <b className="text-[var(--dawaa-status-info-text)]">{n(r.transfer_qty)}</b>
              ) : (
                '—'
              ),
            excel: (r) => r.transfer_qty,
            width: 12,
          },
          {
            header: 'نشتري',
            cell: (r) => <b>{n(r.buy_qty)}</b>,
            excel: (r) => r.buy_qty,
            width: 8,
          },
          {
            header: 'التكلفة',
            cell: (r) => money(r.buy_cost),
            excel: (r) => r.buy_cost,
            width: 10,
          },
          {
            header: 'في الميزانية',
            cell: (r) => (r.in_budget ? '✓' : 'لأ'),
            excel: (r) => (r.in_budget ? 'أيوه' : 'لأ'),
            width: 9,
          },
        ]}
      />
    );
  }
  if (tab === 'requests') {
    return (
      <DataTable<InvRequest>
        rows={data.requests_in_stock}
        q={q}
        exportName="طلبات العملاء اللي اتوفرت"
        text={(r) =>
          `${r.code} ${r.item} ${r.customer_name ?? ''} ${r.customer_code ?? ''} ${r.customer_phone ?? ''}`
        }
        note="طلبات «جديد» و«بنوفره» (آخر ٦٠ يوم) اللي صنفها عليه رصيد. العميل المهم: صرف ٢٠٠٠ ج أو ٤ فواتير في ٩٠ يوم. غيّري حالة الطلب لـ «اتوفر» من صفحة خدمة العملاء عشان تتعمل مهمة التبليغ."
        cols={[
          branchCol(),
          { header: 'اليوم', cell: (r) => dm(r.day), excel: (r) => r.day, width: 10 },
          {
            header: 'العميل',
            cell: (r) => (
              <span>
                <b>{r.customer_name || '—'}</b> {r.customer_code ? `(${r.customer_code})` : ''}
                {r.important ? (
                  <span className="mr-1 rounded bg-[var(--dawaa-status-success-bg)] px-1 text-[10px] font-black">
                    مهم
                  </span>
                ) : null}
                <span className="block text-[11px] opacity-60">
                  {r.customer_phone ?? ''} · {money(r.spend90)} في ٩٠ يوم
                </span>
              </span>
            ),
            excel: (r) =>
              `${r.customer_name ?? ''} ${r.customer_code ?? ''} ${r.customer_phone ?? ''}`,
            width: 24,
          },
          {
            header: 'الصنف',
            cell: (r) => item(r.code, r.item),
            excel: (r) => `${r.item} (${r.code})`,
            width: 30,
          },
          { header: 'عايز', cell: (r) => n(r.want), excel: (r) => r.want, width: 7 },
          {
            header: 'الرصيد',
            cell: (r) => <b>{n(r.stock, 1)}</b>,
            excel: (r) => r.stock,
            width: 8,
          },
          {
            header: 'الفرع التاني',
            cell: (r) => n(r.other_stock, 1),
            excel: (r) => r.other_stock,
            width: 9,
          },
          {
            header: 'نعمل إيه',
            cell: (r) => <b className={ADVICE[r.advice].tone}>{ADVICE[r.advice].label}</b>,
            excel: (r) => ADVICE[r.advice].label,
            width: 30,
          },
        ]}
      />
    );
  }
  if (tab === 'expiry') {
    return (
      <DataTable<InvNearExpiry>
        rows={data.near_expiry}
        q={q}
        exportName="قرب الانتهاء"
        text={(r) => `${r.code} ${r.name} ${r.supplier ?? ''} ${r.store}`}
        note="التشغيلات اللي صلاحيتها في ٦ شهور في المخزن الرئيسي ومخزن الدكتور. «مش هيتباع» = الكمية اللي فوق معدل البيع لحد قبل الانتهاء بشهر: رجّعيها للمورد أو حوّليها أو اعرضيها."
        rowTone={(r) => (r.days < 0 ? 'bg-[var(--dawaa-status-danger-bg)]' : '')}
        cols={[
          branchCol(),
          { header: 'المخزن', cell: (r) => r.store, excel: (r) => r.store, width: 16 },
          {
            header: 'الصنف',
            cell: (r) => item(r.code, r.name, r.location ? `مكانه: ${r.location}` : null),
            excel: (r) => r.name,
            width: 32,
          },
          { header: 'الكود', cell: (r) => r.code, excel: (r) => r.code, width: 9 },
          {
            header: 'الصلاحية',
            cell: (r) => (
              <b className={r.days < 60 ? 'text-[var(--dawaa-status-danger-text)]' : ''}>
                {dm(r.expiry)}
                {r.days < 0 ? ' (خلصت)' : ` (${n(r.days)} يوم)`}
              </b>
            ),
            excel: (r) => r.expiry,
            width: 11,
          },
          { header: 'الكمية', cell: (r) => n(r.qty, 1), excel: (r) => r.qty, width: 8 },
          {
            header: 'بيتباع في الشهر',
            cell: (r) =>
              `${n(r.rate30, 1)}${r.other_rate30 ? ` · التاني ${n(r.other_rate30, 1)}` : ''}`,
            excel: (r) => r.rate30,
            width: 12,
          },
          {
            header: 'مش هيتباع',
            cell: (r) =>
              r.risk_qty > 0 ? (
                <b className="text-[var(--dawaa-status-danger-text)]">
                  {n(r.risk_qty, 1)} · {money(r.risk_value)}
                </b>
              ) : (
                <span className="text-[var(--dawaa-status-success-text)]">هيتباع</span>
              ),
            excel: (r) => r.risk_qty,
            width: 12,
          },
          { header: 'القيمة', cell: (r) => money(r.value), excel: (r) => r.value, width: 10 },
          { header: 'المورد', cell: (r) => r.supplier ?? '—', excel: (r) => r.supplier, width: 18 },
        ]}
      />
    );
  }
  if (tab === 'expiry_store') {
    return (
      <DataTable<InvExpiryStore>
        rows={data.expiry_store}
        q={q}
        exportName="مخزن الإكسبير"
        text={(r) => `${r.code} ${r.name} ${r.supplier ?? ''}`}
        note="اللي في مخزن الإكسبير بقيمته ومورده، عشان يرجع للمورد أو يتعدم."
        cols={[
          branchCol(),
          { header: 'الصنف', cell: (r) => item(r.code, r.name), excel: (r) => r.name, width: 32 },
          { header: 'الكود', cell: (r) => r.code, excel: (r) => r.code, width: 9 },
          { header: 'الكمية', cell: (r) => n(r.qty, 1), excel: (r) => r.qty, width: 8 },
          { header: 'الصلاحية', cell: (r) => dm(r.expiry), excel: (r) => r.expiry, width: 11 },
          { header: 'القيمة', cell: (r) => money(r.value), excel: (r) => r.value, width: 10 },
          { header: 'المورد', cell: (r) => r.supplier ?? '—', excel: (r) => r.supplier, width: 22 },
        ]}
      />
    );
  }
  if (tab === 'dead') {
    return (
      <DataTable<InvDead>
        rows={data.dead}
        q={q}
        exportName="الرواكد"
        text={(r) => `${r.code} ${r.name} ${r.company ?? ''}`}
        note="عليه رصيد ومااتباعش ولا مرة في ٩٠ يوم (ومادخلش جديد آخر ٣٠ يوم). لو الفرع التاني بيبيعه، حوّليه ليه."
        cols={[
          branchCol(),
          {
            header: 'الصنف',
            cell: (r) => item(r.code, r.name, r.company),
            excel: (r) => r.name,
            width: 32,
          },
          { header: 'الكود', cell: (r) => r.code, excel: (r) => r.code, width: 9 },
          { header: 'الرصيد', cell: (r) => n(r.qty, 1), excel: (r) => r.qty, width: 8 },
          {
            header: 'القيمة',
            cell: (r) => <b>{money(r.value)}</b>,
            excel: (r) => r.value,
            width: 10,
          },
          { header: 'آخر شرا', cell: (r) => dm(r.last_buy), excel: (r) => r.last_buy, width: 10 },
          {
            header: 'الفرع التاني بيبيع في الشهر',
            cell: (r) =>
              r.other_rate30 ? (
                <b className="text-[var(--dawaa-status-info-text)]">
                  {n(r.other_rate30, 1)} ← حوّليه
                </b>
              ) : (
                '—'
              ),
            excel: (r) => r.other_rate30,
            width: 14,
          },
        ]}
      />
    );
  }
  if (tab === 'over') {
    return (
      <DataTable<InvOver>
        rows={data.overstock}
        q={q}
        exportName="الأوفر ستوك"
        text={(r) => `${r.code} ${r.name}`}
        note="الرصيد بيكفي أكتر من ٤ شهور. «الزيادة» = اللي فوق شهرين بيع: ماتطلبيهوش تاني لحد ما ينزل، أو حوّليه."
        cols={[
          branchCol(),
          { header: 'الصنف', cell: (r) => item(r.code, r.name), excel: (r) => r.name, width: 32 },
          { header: 'الكود', cell: (r) => r.code, excel: (r) => r.code, width: 9 },
          { header: 'الرصيد', cell: (r) => n(r.qty, 1), excel: (r) => r.qty, width: 8 },
          {
            header: 'بيتباع في الشهر',
            cell: (r) => n(r.rate30, 1),
            excel: (r) => r.rate30,
            width: 10,
          },
          {
            header: 'بيكفي',
            cell: (r) => `${n(r.cover_days)} يوم`,
            excel: (r) => r.cover_days,
            width: 8,
          },
          {
            header: 'الزيادة',
            cell: (r) => (
              <b>
                {n(r.excess_qty, 1)} · {money(r.excess_value)}
              </b>
            ),
            excel: (r) => r.excess_value,
            width: 12,
          },
          {
            header: 'الفرع التاني',
            cell: (r) => `رصيد ${n(r.other_qty, 1)} · بيبيع ${n(r.other_rate30, 1)}`,
            excel: (r) => r.other_qty,
            width: 16,
          },
        ]}
      />
    );
  }
  if (tab === 'count') {
    return (
      <DataTable<InvCount>
        rows={data.count}
        q={q}
        exportName="الجرد المقترح"
        text={(r) => `${r.code} ${r.name} ${COUNT_REASON[r.reason]} ${r.note}`}
        note="أصناف تتجرد الأول: السريعة الحركة، الرصيد بالسالب، القيمة العالية، والأصناف اللي ليها أكتر من كود أو أكتر من علبة (زي ٣٠ و٤٠ قرص) لأنها بتتلخبط."
        cols={[
          branchCol(),
          {
            header: 'ليه',
            cell: (r) => <b>{COUNT_REASON[r.reason]}</b>,
            excel: (r) => COUNT_REASON[r.reason],
            width: 14,
          },
          { header: 'الصنف', cell: (r) => item(r.code, r.name), excel: (r) => r.name, width: 34 },
          { header: 'الكود', cell: (r) => r.code, excel: (r) => r.code, width: 9 },
          { header: 'رصيد السيستم', cell: (r) => n(r.qty, 2), excel: (r) => r.qty, width: 10 },
          { header: 'الجرد الفعلي', cell: () => '', excel: () => '', width: 10 },
          {
            header: 'ملاحظة',
            cell: (r) => <span className="text-xs">{r.note}</span>,
            excel: (r) => r.note,
            width: 40,
          },
        ]}
      />
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {(['movers_up', 'movers_down'] as const).map((k) => (
        <div key={k}>
          <div className="mb-1 text-sm font-black">
            {k === 'movers_up' ? 'بيعه زاد (آخر أسبوعين عن اللي قبلهم)' : 'بيعه قل'}
          </div>
          <DataTable<InvMover>
            rows={data[k]}
            q={q}
            exportName={k === 'movers_up' ? 'بيعه زاد' : 'بيعه قل'}
            text={(r) => `${r.code} ${r.name}`}
            cols={[
              branchCol(),
              {
                header: 'الصنف',
                cell: (r) => item(r.code, r.name),
                excel: (r) => r.name,
                width: 30,
              },
              { header: 'آخر أسبوعين', cell: (r) => money(r.v30), excel: (r) => r.v30, width: 11 },
              {
                header: 'اللي قبلهم',
                cell: (r) => money(r.vprev30),
                excel: (r) => r.vprev30,
                width: 11,
              },
              {
                header: 'الفرق',
                cell: (r) => (
                  <b
                    className={
                      r.diff > 0
                        ? 'text-[var(--dawaa-status-success-text)]'
                        : 'text-[var(--dawaa-status-danger-text)]'
                    }
                  >
                    {money(r.diff)}
                  </b>
                ),
                excel: (r) => r.diff,
                width: 10,
              },
            ]}
          />
        </div>
      ))}
      <div className="xl:col-span-2">
        <div className="mb-1 text-sm font-black">الشركات: فلوسنا محطوطة فين</div>
        <DataTable<InvCompany>
          rows={data.companies}
          q={q}
          exportName="الشركات"
          text={(r) => r.company}
          cols={[
            {
              header: 'الشركة',
              cell: (r) => <b>{r.company}</b>,
              excel: (r) => r.company,
              width: 24,
            },
            {
              header: 'قيمة المخزون',
              cell: (r) => money(r.value),
              excel: (r) => r.value,
              width: 12,
            },
            {
              header: 'منها رواكد',
              cell: (r) => money(r.dead_value),
              excel: (r) => r.dead_value,
              width: 12,
            },
            {
              header: 'بيع آخر أسبوعين',
              cell: (r) => money(r.v30),
              excel: (r) => r.v30,
              width: 12,
            },
            {
              header: 'اللي قبلهم',
              cell: (r) => money(r.vprev30),
              excel: (r) => r.vprev30,
              width: 12,
            },
          ]}
        />
      </div>
    </div>
  );
}
