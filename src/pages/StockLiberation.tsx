import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import LiberationTrend from '@/components/inventory/LiberationTrend';
import { download, exportSheets, type Col } from '@/lib/inventory/stock';
import {
  ACTIONS,
  libTotals,
  liberationPlan,
  liberationTicker,
  loadLiberation,
  type LibAction,
  type Liberation,
  type PlanRow,
} from '@/lib/inventory/liberation';

// «تحرير المخزون»: رأس المال، ونسبة نشاط الأصناف، والرواكد، وقرب الانتهاء (٦ شهور من النهارده)، والمنتهي في الفروع
// ومخازنها، ومين بيصرف التقيل. الهدف: كل جنيه واقف يتحرر بخطوة واضحة (تحويل، مرتجع، أولوية صرف، سحب).

const n = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : Number(v).toLocaleString('ar-EG', { maximumFractionDigits: d });
const money = (v: number | null | undefined) => (v == null ? '—' : `${n(Math.round(v))} ج`);
const pct = (v: number) => `${Math.round(v * 100).toLocaleString('ar-EG')}%`;
const short = (b: string) => b.replace(/^فرع\s*/, '');
const dm = (iso: string | null | undefined) =>
  iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(2, 4)}` : '—';

const TONE: Record<string, string> = {
  danger: 'bg-[var(--dawaa-status-danger-bg,#fee2e2)] text-[var(--dawaa-status-danger-text)]',
  warning:
    'bg-[var(--dawaa-status-warning-bg,#fef3c7)] text-[var(--dawaa-status-warning-text,#b45309)]',
  success: 'bg-[var(--dawaa-theme-soft)] text-[var(--dawaa-status-success-text)]',
};
const KIND: Record<string, string> = {
  main: 'المخزن الرئيسي',
  doctor: 'مخزن دكتور',
  expiry: 'الإكسبير',
  office: 'المكتب',
};

const TABS = {
  plan: 'الخطة',
  near: 'قرب الانتهاء',
  expired: 'المنتهي والإكسبير',
  dead: 'الرواكد والبطيء',
  doctors: 'الدكاترة',
} as const;
type Tab = keyof typeof TABS;

function ActionChip({ a }: { a: LibAction }) {
  const x = ACTIONS[a];
  return (
    <span
      title={x.hint}
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black ${TONE[x.tone]}`}
    >
      {x.label}
    </span>
  );
}

/** The ticker that runs across the top with what to look at first. Stops on hover; still for reduced motion. */
function Ticker({ items }: { items: string[] }) {
  if (!items.length) return null;
  const line = items.join('   •   ');
  return (
    <div
      className="dawaa-ticker group relative overflow-hidden rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] py-2"
      aria-label="أهم حاجات المخزون"
    >
      <div className="dawaa-ticker-track flex w-max gap-12 whitespace-nowrap text-sm font-bold group-hover:[animation-play-state:paused]">
        <span>{line}</span>
        <span aria-hidden>{line}</span>
      </div>
    </div>
  );
}

export default function StockLiberation() {
  const [branch, setBranch] = useState<string>('');
  const [data, setData] = useState<Liberation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('plan');
  const [actionFilter, setActionFilter] = useState<LibAction | ''>('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await loadLiberation(branch || null));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [branch]);
  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => (data && !data.empty ? libTotals(data) : null), [data]);
  const plan = useMemo(() => (data && !data.empty ? liberationPlan(data) : []), [data]);
  const ticker = useMemo(() => (data && !data.empty ? liberationTicker(data) : []), [data]);
  const shownPlan = actionFilter ? plan.filter((r) => r.action === actionFilter) : plan;

  async function exportAll() {
    if (!data) return;
    const planCols: Col<PlanRow>[] = [
      { header: 'الفرع', width: 10, value: (r) => short(r.branch) },
      { header: 'الكود', width: 9, value: (r) => r.code },
      { header: 'الصنف', width: 34, value: (r) => r.name },
      { header: 'المطلوب', width: 18, value: (r) => ACTIONS[r.action].label },
      { header: 'ليه', width: 50, value: (r) => r.why },
      { header: 'القيمة', width: 11, value: (r) => Math.round(r.value) },
      { header: 'المورد', width: 18, value: (r) => r.supplier },
    ];
    const blob = await exportSheets(
      [
        { name: 'الخطة', rows: plan, cols: planCols as Col<never>[] },
        {
          name: 'الدكاترة',
          rows: data.doctors,
          cols: [
            {
              header: 'الفرع',
              width: 10,
              value: (r: Liberation['doctors'][number]) => short(r.branch),
            },
            { header: 'الدكتور', width: 20, value: (r: Liberation['doctors'][number]) => r.seller },
            {
              header: 'صرف تقيل (ج)',
              width: 13,
              value: (r: Liberation['doctors'][number]) => r.value,
            },
            {
              header: 'منه قرب الانتهاء',
              width: 14,
              value: (r: Liberation['doctors'][number]) => r.near_value,
            },
            {
              header: '% من بيعه',
              width: 10,
              value: (r: Liberation['doctors'][number]) => r.share,
            },
            {
              header: 'أكتر أصناف',
              width: 50,
              value: (r: Liberation['doctors'][number]) =>
                r.top.map((x) => x.name ?? x.code).join('، '),
            },
          ] as Col<never>[],
        },
      ],
      `تحرير المخزون — ملف ${data.upload.day}`
    );
    download(blob, `تحرير-المخزون-${data.upload.day}.xlsx`);
  }

  if (error)
    return (
      <div className="space-y-4 p-4">
        <Panel>
          <EmptyState label={error} error onRetry={() => void load()} />
        </Panel>
      </div>
    );
  if (!data)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (data.empty)
    return (
      <div className="space-y-4 p-4">
        <Panel>
          <SectionTitle title="تحرير المخزون" />
          <p className="mt-3 text-sm">
            لسه مفيش ملف رصيد اترفع. ارفعوا «رصيد الأصناف في المخازن» من بي كونكت (بالتشغيلات
            والصلاحية) من صفحة{' '}
            <Link className="font-black underline" to="/inventory-stock">
              رصيد المخازن
            </Link>{' '}
            والصفحة دي هتتملي لوحدها.
          </p>
        </Panel>
      </div>
    );

  const t = totals!;
  const capitalByBranch = ['فرع شكري', 'فرع الشامي']
    .filter((b) => !branch || b === branch)
    .map((b) => ({
      branch: b,
      stores: data.capital.filter((c) => c.branch === b),
      activity: data.activity.find((a) => a.branch === b),
    }));

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <Ticker items={ticker} />

      <Panel>
        <SectionTitle
          title="تحرير المخزون: الرواكد وقرب الانتهاء"
          subtitle={`من ملف ${dm(data.upload.day)}${data.upload.day < new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()) ? ' (معتمد لحد ما يترفع ملف جديد)' : ''}${data.upload.batches_day && data.upload.batches_day !== data.upload.day ? ` (الصلاحيات من ملف ${dm(data.upload.batches_day)})` : ''} · قرب الانتهاء = من النهارده لحد ٦ شهور`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {['', 'فرع شكري', 'فرع الشامي'].map((b) => (
            <button
              key={b || 'all'}
              type="button"
              className={branch === b ? 'btn-primary !py-1' : 'btn-secondary !py-1'}
              onClick={() => setBranch(b)}
            >
              {b ? short(b) : 'الفرعين'}
            </button>
          ))}
          <button
            className="btn-secondary inline-flex items-center gap-1 !py-1"
            onClick={() => void load()}
            disabled={busy}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} تحديث
          </button>
          <button
            className="btn-secondary mr-auto inline-flex items-center gap-1 !py-1"
            onClick={() => void exportAll()}
          >
            <Download size={14} /> إكسيل الخطة
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MiniBox label="رأس المال في المخزون (بالتكلفة)" value={money(t.capital)} tone="blue" />
          <MiniBox
            label="نشاط الأصناف (القيمة اللي اتحركت آخر ٣٠ يوم)"
            value={`${pct(t.activeShare)} · ${pct(t.activeItemShare)} من الأصناف`}
            tone={t.activeShare >= 0.7 ? 'green' : t.activeShare >= 0.5 ? 'amber' : 'red'}
          />
          <MiniBox label="فلوس واقفة ممكن تتحرر" value={money(t.stuck)} tone="amber" />
          <MiniBox
            label="منتهي لسه على الرف"
            value={money(t.expiredShelf)}
            tone={t.expiredShelf > 0 ? 'red' : 'green'}
          />
          <MiniBox label="رواكد (٩٠ يوم من غير بيع)" value={money(t.dead)} tone="red" />
          <MiniBox label="بطيء (مااتباعش آخر ٣٠ يوم)" value={money(t.slow)} tone="amber" />
          <MiniBox
            label="قرب الانتهاء (٦ شهور) · منه في خطر"
            value={`${money(t.nearValue)} · ${money(t.nearRisk)}`}
            tone="amber"
          />
          <MiniBox label="مخزن الإكسبير" value={money(t.expiryStore)} tone="cyan" />
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="رأس المال والرواكد يوم بيوم"
          subtitle="من كل ملف رصيد اترفع: لو الخط البرتقاني نازل يبقى التحرير ماشي"
        />
        <div className="mt-2">
          <LiberationTrend trend={data.trend} />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {capitalByBranch.map(({ branch: b, stores, activity }) => {
          const total = activity?.value || 0;
          const bar = activity
            ? [
                { k: 'نشط', v: activity.active_value, c: 'bg-[var(--dawaa-status-success-text)]' },
                { k: 'جديد', v: activity.new_value, c: 'bg-sky-500' },
                { k: 'بطيء', v: activity.slow_value, c: 'bg-amber-500' },
                { k: 'راكد', v: activity.dead_value, c: 'bg-[var(--dawaa-status-danger-text)]' },
              ]
            : [];
          return (
            <Panel key={b}>
              <SectionTitle title={b} subtitle="رأس المال في كل مخزن ونشاط الأصناف" />
              {total > 0 ? (
                <>
                  <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[var(--dawaa-theme-soft)]">
                    {bar.map((x) => (
                      <div
                        key={x.k}
                        className={x.c}
                        style={{ width: `${(100 * x.v) / total}%` }}
                        title={`${x.k}: ${money(x.v)}`}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {bar.map((x) => (
                      <span key={x.k}>
                        {x.k} {pct(x.v / total)} ({money(x.v)})
                      </span>
                    ))}
                  </div>
                  {activity!.over_value > 0 ? (
                    <p className="mt-1 text-xs opacity-75">
                      {n(activity!.over_items)} صنف أوفر ستوك (بيكفي أكتر من ٤ شهور): زيادة{' '}
                      {money(activity!.over_value)} فوق احتياج شهرين
                    </p>
                  ) : null}
                </>
              ) : null}
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-right text-xs opacity-70">
                    <th className="p-1">المخزن</th>
                    <th className="p-1">أصناف</th>
                    <th className="p-1">بالتكلفة</th>
                    <th className="p-1">قرب الانتهاء</th>
                    <th className="p-1">منتهي</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s) => (
                    <tr key={s.store} className="border-t border-[var(--dawaa-theme-border)]">
                      <td className="p-1">
                        <span className="font-bold">{s.store}</span>
                        <span className="block text-[11px] opacity-60">
                          {KIND[s.kind] ?? s.kind}
                        </span>
                      </td>
                      <td className="p-1">{n(s.items)}</td>
                      <td className="p-1 font-black">{money(s.value)}</td>
                      <td className="p-1">{s.near_expiry ? money(s.near_expiry) : '—'}</td>
                      <td
                        className={`p-1 ${s.expired && s.kind !== 'expiry' ? 'font-black text-[var(--dawaa-status-danger-text)]' : ''}`}
                      >
                        {s.expired ? money(s.expired) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          );
        })}
      </div>

      <Panel>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TABS) as Tab[]).map((k) => (
            <button
              key={k}
              type="button"
              className={tab === k ? 'btn-primary !py-1' : 'btn-secondary !py-1'}
              onClick={() => setTab(k)}
            >
              {TABS[k]}
            </button>
          ))}
        </div>

        {tab === 'plan' ? (
          <div className="mt-3">
            <p className="text-xs opacity-75">
              كل صنف واقف وخطوته، مترتب باللي يتعمل الأول: المنتهي على الرف، بعدين اللي بينتهي
              الأقرب، بعدين الرواكد بالأغلى. الفلوس = اللي في خطر (أو قيمة الراكد كله).
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(['', 'pull', 'return', 'transfer', 'push_now', 'push'] as const).map((a) => (
                <button
                  key={a || 'all'}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${actionFilter === a ? 'bg-[var(--dawaa-theme-primary,#0f766e)] text-white' : 'border border-[var(--dawaa-theme-border)]'}`}
                  onClick={() => setActionFilter(a)}
                >
                  {a ? ACTIONS[a].label : 'الكل'} (
                  {n(a ? plan.filter((r) => r.action === a).length : plan.length)})
                </button>
              ))}
            </div>
            <ul className="mt-2 space-y-1.5">
              {shownPlan.slice(0, 150).map((r) => (
                <li
                  key={r.key}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[var(--dawaa-theme-soft)] px-2.5 py-2"
                >
                  <ActionChip a={r.action} />
                  <span className="min-w-0 flex-1 text-sm font-black break-words" dir="auto">
                    {r.name}
                  </span>
                  <span className="font-mono text-[11px] opacity-60">كود {r.code}</span>
                  <span className="text-xs opacity-70">{short(r.branch)}</span>
                  <span className="text-sm font-black">{money(r.value)}</span>
                  <span className="basis-full text-xs opacity-75">
                    {r.why}
                    {r.supplier && (r.action === 'return' || r.action === 'pull')
                      ? ` · المورد: ${r.supplier}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            {shownPlan.length > 150 ? (
              <p className="mt-2 text-xs opacity-70">
                و{n(shownPlan.length - 150)} كمان في ملف الإكسيل.
              </p>
            ) : null}
            {!shownPlan.length ? <EmptyState label="مفيش حاجة واقفة هنا 👌" /> : null}
          </div>
        ) : null}

        {tab === 'near' ? (
          <>
            <p className="mt-3 text-xs opacity-75">
              الصلاحية في بي كونكت بالشهر، فبنحسبها لآخر يوم في الشهر.{' '}
              {data.totals && data.totals.near_rows > data.near_expiry.length
                ? `ظاهر أقرب ${n(Math.min(data.near_expiry.length, 300))} تشغيلة من ${n(data.totals.near_rows)}.`
                : ''}
            </p>
            <Table
              rows={data.near_expiry}
              empty="مفيش حاجة بتنتهي خلال ٦ شهور"
              cols={[
                ['الصنف', (r) => <Name name={r.name} code={r.code} />],
                ['الفرع / المخزن', (r) => `${short(r.branch)} · ${r.store}`],
                ['ينتهي', (r) => `${dm(r.expiry)} (${n(r.days)} يوم)`],
                ['الكمية', (r) => n(r.qty, 1)],
                ['بيبيع في الشهر', (r) => `${n(r.rate30, 1)} هنا · ${n(r.other_rate30, 1)} هناك`],
                [
                  'في خطر',
                  (r) => (r.risk_value ? `${n(r.risk_qty, 1)} · ${money(r.risk_value)}` : '—'),
                ],
                ['المطلوب', (r) => <ActionChip a={r.action} />],
                ['المورد', (r) => r.supplier ?? 'مش معروف'],
              ]}
            />
          </>
        ) : null}

        {tab === 'expired' ? (
          <Table
            rows={data.expired}
            empty="مفيش منتهي 👌"
            cols={[
              ['الصنف', (r) => <Name name={r.name} code={r.code} />],
              ['الفرع / المخزن', (r) => `${short(r.branch)} · ${r.store}`],
              ['انتهى', (r) => dm(r.expiry)],
              ['الكمية', (r) => n(r.qty, 1)],
              ['القيمة', (r) => money(r.value)],
              ['المطلوب', (r) => <ActionChip a={r.action} />],
              ['المورد', (r) => r.supplier ?? 'مش معروف'],
            ]}
          />
        ) : null}

        {tab === 'dead' ? (
          <Table
            rows={data.dead}
            empty="مفيش رواكد 👌"
            cols={[
              ['الصنف', (r) => <Name name={r.name} code={r.code} />],
              ['الفرع', (r) => short(r.branch)],
              ['الحالة', (r) => (r.status === 'dead' ? 'راكد ٩٠ يوم' : 'بطيء')],
              ['الكمية', (r) => n(r.qty, 1)],
              ['القيمة', (r) => money(r.value)],
              ['آخر بيع / شراء', (r) => `${dm(r.last_sale)} / ${dm(r.last_buy)}`],
              [
                'الفرع التاني',
                (r) => (r.other_rate30 ? `بيبيع ${n(r.other_rate30, 1)} في الشهر` : '—'),
              ],
              ['المطلوب', (r) => <ActionChip a={r.action} />],
            ]}
          />
        ) : null}

        {tab === 'doctors' ? (
          <div className="mt-3">
            <p className="text-xs opacity-75">
              آخر ٣٠ يوم: مين صرف أكتر من الأصناف التقيلة (البطيئة والأوفر ستوك) واللي قرب ينتهي. ده
              اللي بيحرّر المخزون فعلاً.
            </p>
            <ol className="mt-2 space-y-1.5">
              {data.doctors.map((d, i) => (
                <li
                  key={`${d.branch}|${d.seller}`}
                  className="rounded-lg bg-[var(--dawaa-theme-soft)] px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-lg font-black">
                      {i < 3 ? ['🥇', '🥈', '🥉'][i] : `${n(i + 1)}.`}
                    </span>
                    <span className="font-black">{d.seller}</span>
                    <span className="text-xs opacity-70">{short(d.branch)}</span>
                    <span className="mr-auto text-sm font-black">{money(d.value)}</span>
                    <span className="text-xs opacity-75">{n(d.share, 1)}% من بيعه</span>
                  </div>
                  <div className="mt-0.5 text-xs opacity-80">
                    منه قرب الانتهاء {money(d.near_value)} · {n(d.items)} صنف ·{' '}
                    {d.top.map((x) => `${x.name ?? x.code} (${n(x.qty)})`).join('، ')}
                  </div>
                </li>
              ))}
            </ol>
            {!data.doctors.length ? <EmptyState label="لسه مفيش بيع للأصناف التقيلة" /> : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function Name({ name, code }: { name: string | null; code: string }) {
  return (
    <span>
      <span className="font-bold" dir="auto">
        {name ?? code}
      </span>
      <span className="block font-mono text-[11px] opacity-60">كود {code}</span>
    </span>
  );
}

function Table<T>({
  rows,
  cols,
  empty,
}: {
  rows: T[];
  cols: Array<[string, (r: T) => React.ReactNode]>;
  empty: string;
}) {
  if (!rows.length) return <EmptyState label={empty} />;
  return (
    <div className="mt-3 max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--dawaa-theme-surface)]">
          <tr className="text-right text-xs opacity-70">
            {cols.map(([h]) => (
              <th key={h} className="p-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 300).map((r, i) => (
            <tr key={i} className="border-t border-[var(--dawaa-theme-border)] align-top">
              {cols.map(([h, f]) => (
                <td key={h} className="p-1.5">
                  {f(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
