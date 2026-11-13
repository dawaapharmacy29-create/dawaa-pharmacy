import { useMemo } from 'react';
import { BarChart3, Clock, CreditCard, Users, Wallet } from 'lucide-react';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import { SHIFT_TYPES } from '@/lib/shiftHandoverCoverage';
import {
  change,
  closerKey,
  dailySeries,
  groupBy,
  pct,
  totalsOf,
  type MoneyTotals,
} from '@/lib/shiftHandoverLedger';
import {
  BRANCH_TONE,
  Bar,
  Kpi,
  money,
  pctLabel,
  shortBranch,
  shortDay,
  type LiveRow,
} from './shared';

// «الإحصائيات»: the period's numbers against the same number of days before it, the day-by-day
// sales, and the comparison of branches, shifts and the doctors who closed.

const PAYMENT_ROWS: [keyof MoneyTotals, string, 'success' | 'info' | 'warning'][] = [
  ['cash', 'كاش', 'success'],
  ['visa', 'فيزا', 'info'],
  ['insta', 'إنستا باي', 'info'],
  ['vodafone', 'فودافون كاش', 'info'],
  ['other', 'تحويلات أخرى', 'warning'],
];

export default function HandoverStats({
  rows,
  previous,
  range,
  branches,
  missingCount,
  today,
}: {
  rows: LiveRow[];
  /** The same number of days before the range; null when the data does not reach that far back. */
  previous: LiveRow[] | null;
  range: { from: string; to: string };
  branches: string[];
  missingCount: number;
  today: string;
}) {
  const t = useMemo(() => totalsOf(rows), [rows]);
  const p = useMemo(() => (previous ? totalsOf(previous) : null), [previous]);
  const d = (now: number, before: number | undefined) => (p ? change(now, before ?? 0) : null);
  const series = useMemo(() => dailySeries(rows, range, branches), [rows, range, branches]);
  const maxDay = Math.max(1, ...series.map((s) => s.sales));
  const byBranch = useMemo(() => groupBy(rows, (r) => r.branch), [rows]);
  const byShift = useMemo(() => {
    const g = groupBy(rows, (r) => r.shift_type);
    return SHIFT_TYPES.map((s) => g.find((x) => x.key === s)).filter(Boolean) as typeof g;
  }, [rows]);
  const byPerson = useMemo(
    () =>
      groupBy(
        rows,
        (r) => closerKey(r.submitted_by),
        (r) => r.submitted_by?.trim() || 'غير معروف'
      ).sort((a, b) => b.count - a.count || b.sales - a.sales),
    [rows]
  );
  const flagsOf = (key: string) =>
    rows.filter((r) => closerKey(r.submitted_by) === key && r.duplicate).length;
  // Today is still running, so it is never the best or the worst day.
  const ranked = [...series]
    .filter((s) => s.shifts && s.day !== today)
    .sort((a, b) => b.sales - a.sales);
  const avgShift = t.count ? t.sales / t.count : 0;

  if (!rows.length) return <EmptyState label="مفيش تسليمات في الفترة دي" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="المبيعات"
          value={money(t.sales)}
          delta={d(t.sales, p?.sales)}
          hint={p ? 'عن الفترة اللي قبلها' : undefined}
        />
        <Kpi
          label="متوسط اليوم"
          value={money(t.days ? t.sales / t.days : 0)}
          delta={p ? change(t.days ? t.sales / t.days : 0, p.days ? p.sales / p.days : 0) : null}
          hint={`${t.days.toLocaleString('ar-EG')} يوم`}
        />
        <Kpi
          label="كاش للمحاسب"
          value={money(t.toAccountant)}
          tone="success"
          delta={d(t.toAccountant, p?.toAccountant)}
        />
        <Kpi
          label="تحويلات (فيزا وإنستا وفودافون)"
          value={money(t.transfers)}
          tone="info"
          delta={d(t.transfers, p?.transfers)}
          hint={`${pctLabel(pct(t.transfers, t.sales))} من المبيعات`}
        />
        <Kpi
          label="المصروفات"
          value={money(t.expenses)}
          tone="warning"
          inverse
          delta={d(t.expenses, p?.expenses)}
          hint={`${pct(t.expenses, t.sales).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}٪ من المبيعات`}
        />
        <Kpi
          label="صافي التشغيل"
          value={money(t.operatingNet)}
          delta={d(t.operatingNet, p?.operatingNet)}
          hint="مبيعات − مصروفات"
        />
        <Kpi
          label="متوسط الشيفت"
          value={money(avgShift)}
          delta={p ? change(avgShift, p.count ? p.sales / p.count : 0) : null}
        />
        <Kpi
          label="الشيفتات"
          value={t.count.toLocaleString('ar-EG')}
          tone={missingCount ? 'danger' : undefined}
          hint={missingCount ? `${missingCount.toLocaleString('ar-EG')} ناقص` : 'مفيش ناقص'}
        />
      </div>

      <Panel className="p-4">
        <SectionTitle
          title="المبيعات يوم بيوم"
          subtitle="كل عمود يوم، ومقسوم على الفرعين"
          icon={<BarChart3 size={18} />}
        />
        <div className="mb-2 flex flex-wrap gap-3 text-xs font-bold">
          {branches.map((b) => (
            <span key={b} className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: `var(--dawaa-status-${BRANCH_TONE[b] ?? 'info'}-text)` }}
              />
              {b}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div
            className="flex h-48 items-end gap-1"
            style={{ minWidth: `${series.length * 18}px` }}
          >
            {series.map((s) => (
              <div
                key={s.day}
                className="flex h-full min-w-[14px] flex-1 flex-col justify-end"
                title={`${shortDay(s.day)}: ${money(s.sales)}${branches.map((b) => `\n${shortBranch(b)} ${money(s.byBranch[b] ?? 0)}`).join('')}`}
              >
                {branches.map((b) => (
                  <div
                    key={b}
                    style={{
                      height: `${((s.byBranch[b] ?? 0) / maxDay) * 100}%`,
                      background: `var(--dawaa-status-${BRANCH_TONE[b] ?? 'info'}-text)`,
                      opacity: 0.85,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1" style={{ minWidth: `${series.length * 18}px` }}>
            {series.map((s, i) => (
              <span
                key={s.day}
                className="dawaa-caption min-w-[14px] flex-1 text-center text-[9px] font-bold"
              >
                {i % Math.max(1, Math.ceil(series.length / 12)) === 0
                  ? Number(s.day.slice(8)).toLocaleString('ar-EG')
                  : ''}
              </span>
            ))}
          </div>
        </div>
        {ranked.length > 2 ? (
          <div className="mt-3 grid gap-2 text-xs font-bold sm:grid-cols-2">
            <p>
              <span className="dawaa-caption">أعلى يوم:</span> {shortDay(ranked[0].day)} —{' '}
              {money(ranked[0].sales)}
            </p>
            <p>
              <span className="dawaa-caption">أقل يوم:</span>{' '}
              {shortDay(ranked[ranked.length - 1].day)} — {money(ranked[ranked.length - 1].sales)}
            </p>
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionTitle title="مقارنة الفروع" icon={<Wallet size={18} />} />
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full text-right text-sm">
              <thead>
                <tr>
                  <th />
                  {byBranch.map((b) => (
                    <th key={b.key}>{b.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['المبيعات', (b) => money(b.sales)],
                    ['نصيب الفرع', (b) => pctLabel(pct(b.sales, t.sales))],
                    ['متوسط اليوم', (b) => money(b.avgPerDay)],
                    ['متوسط الشيفت', (b) => money(b.avgSales)],
                    ['كاش للمحاسب', (b) => money(b.toAccountant)],
                    ['تحويلات', (b) => `${money(b.transfers)} · ${pctLabel(b.transferShare)}`],
                    [
                      'المصروفات',
                      (b) =>
                        `${money(b.expenses)} · ${b.expenseRate.toLocaleString('ar-EG', { maximumFractionDigits: 1 })}٪`,
                    ],
                    [
                      'الشيفتات',
                      (b) =>
                        `${b.count.toLocaleString('ar-EG')} في ${b.days.toLocaleString('ar-EG')} يوم`,
                    ],
                  ] as [string, (b: (typeof byBranch)[number]) => string][]
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td className="dawaa-caption font-bold">{label}</td>
                    {byBranch.map((b) => (
                      <td key={b.key} className="font-black">
                        {value(b)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="p-4">
          <SectionTitle
            title="مقارنة الشيفتات"
            subtitle="ليلي وصباحي ومسائي"
            icon={<Clock size={18} />}
          />
          <div className="space-y-3">
            {byShift.map((s) => (
              <div key={s.key} className="text-xs font-bold">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                    {s.label} · {s.count.toLocaleString('ar-EG')} شيفت
                  </span>
                  <span>
                    {money(s.sales)} · {pctLabel(pct(s.sales, t.sales))}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Bar
                    value={s.sales}
                    max={Math.max(...byShift.map((x) => x.sales))}
                    tone="success"
                  />
                </div>
                <p className="dawaa-caption mt-0.5">
                  متوسط الشيفت {money(s.avgSales)} · تحويلات {pctLabel(s.transferShare)} · مصروفات{' '}
                  {money(s.expenses)}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="p-4">
        <SectionTitle
          title="طرق الدفع"
          subtitle="المبيعات = كاش + فيزا + إنستا + فودافون + تحويلات أخرى"
          icon={<CreditCard size={18} />}
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            {PAYMENT_ROWS.map(([key, label, tone]) => (
              <div key={key} className="flex items-center gap-2 text-xs font-bold">
                <span className="w-24 shrink-0">{label}</span>
                <Bar value={t[key] as number} max={t.sales} tone={tone} />
                <span className="w-40 shrink-0 text-left">
                  {money(t[key] as number)} · {pctLabel(pct(t[key] as number, t.sales))}
                </span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full text-right text-xs">
              <thead>
                <tr>
                  <th />
                  {byBranch.map((b) => (
                    <th key={b.key}>{shortBranch(b.label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PAYMENT_ROWS.map(([key, label]) => (
                  <tr key={key}>
                    <td className="dawaa-caption font-bold">{label}</td>
                    {byBranch.map((b) => (
                      <td key={b.key} className="font-black">
                        {money(b[key] as number)}{' '}
                        <span className="dawaa-caption">
                          {pctLabel(pct(b[key] as number, b.sales))}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionTitle
          title="الدكاترة اللي قفلوا"
          subtitle="كل اسم بتسليماته في الفترة"
          icon={<Users size={18} />}
        />
        <div className="overflow-x-auto">
          <table className="dawaa-table w-full min-w-[640px] text-right text-sm">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>شيفتات</th>
                <th>المبيعات</th>
                <th>متوسط الشيفت</th>
                <th>تحويلات</th>
                <th>مصروفات</th>
                <th>متسجل مرتين</th>
              </tr>
            </thead>
            <tbody>
              {byPerson.map((person) => (
                <tr key={person.key}>
                  <td className="font-black">{person.label}</td>
                  <td>{person.count.toLocaleString('ar-EG')}</td>
                  <td>{money(person.sales)}</td>
                  <td>{money(person.avgSales)}</td>
                  <td>{pctLabel(person.transferShare)}</td>
                  <td>{money(person.expenses)}</td>
                  <td
                    style={{
                      color: flagsOf(person.key) ? 'var(--dawaa-status-danger-text)' : undefined,
                    }}
                  >
                    {flagsOf(person.key) ? flagsOf(person.key).toLocaleString('ar-EG') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dawaa-caption mt-2 text-xs font-bold">
          المتوسط بيعتمد على الشيفت والفرع اللي الدكتور بيقفلهم، فقارن الدكاترة اللي بيقفلوا نفس
          الشيفت.
        </p>
      </Panel>
    </div>
  );
}
