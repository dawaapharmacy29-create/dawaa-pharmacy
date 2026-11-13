import { useMemo, useState } from 'react';
import { PieChart, Receipt, Wallet } from 'lucide-react';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import {
  EXPENSE_SOURCE_LABEL,
  change,
  expenseCategories,
  expenseLines,
  pct,
  totalsOf,
} from '@/lib/shiftHandoverLedger';
import { Bar, Kpi, money, pctLabel, shortBranch, shortDay, type LiveRow } from './shared';

// «المصروفات»: only real spending. Payment methods once typed as expense lines (old handovers) are
// payments and are left out; spending paid by insta or vodafone does not come off the drawer.

export default function HandoverExpenses({
  rows,
  previous,
  branches,
}: {
  rows: LiveRow[];
  previous: LiveRow[] | null;
  branches: string[];
}) {
  const [category, setCategory] = useState<string | null>(null);
  const lines = useMemo(() => expenseLines(rows), [rows]);
  const categories = useMemo(() => expenseCategories(lines), [lines]);
  const prevCategories = useMemo(
    () => (previous ? expenseCategories(expenseLines(previous)) : null),
    [previous]
  );
  const t = useMemo(() => totalsOf(rows), [rows]);
  const before = previous ? totalsOf(previous) : null;
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) map.set(l.source, (map.get(l.source) ?? 0) + l.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [lines]);
  const shownLines = category ? lines.filter((l) => l.category === category) : lines;

  if (!lines.length) return <EmptyState label="مفيش مصروفات في الفترة دي" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="المصروفات"
          value={money(total)}
          tone="warning"
          inverse
          delta={before ? change(total, before.expenses) : null}
          hint={before ? 'عن الفترة اللي قبلها' : undefined}
        />
        <Kpi
          label="من المبيعات"
          value={`${pct(total, t.sales).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}٪`}
        />
        <Kpi
          label="متوسط اليوم"
          value={money(t.days ? total / t.days : 0)}
          hint={`${t.days.toLocaleString('ar-EG')} يوم`}
        />
        <Kpi
          label="عدد البنود"
          value={lines.length.toLocaleString('ar-EG')}
          hint={`${categories.length.toLocaleString('ar-EG')} نوع`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionTitle
            title="حسب البند"
            subtitle="دوس على بند تشوف تفاصيله تحت"
            icon={<PieChart size={18} />}
          />
          <div className="space-y-2">
            {categories.map((c) => {
              const prev = prevCategories?.find((x) => x.name === c.name);
              const delta = prevCategories ? change(c.amount, prev?.amount ?? 0) : null;
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setCategory((v) => (v === c.name ? null : c.name))}
                  aria-pressed={category === c.name}
                  className="block w-full rounded-lg p-1 text-right text-xs font-bold"
                  style={{
                    background:
                      category === c.name ? 'var(--dawaa-theme-surface-raised)' : undefined,
                  }}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>
                      {c.name} · {c.count.toLocaleString('ar-EG')} مرة
                    </span>
                    <span>
                      {money(c.amount)} · {pctLabel(c.share)}
                      {delta != null && Math.abs(delta) >= 1 ? (
                        <span
                          className="mr-1"
                          style={{
                            color:
                              delta > 0
                                ? 'var(--dawaa-status-danger-text)'
                                : 'var(--dawaa-status-success-text)',
                          }}
                        >
                          {delta > 0 ? '▲' : '▼'} {pctLabel(Math.abs(delta))}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1 flex">
                    <Bar value={c.amount} max={categories[0].amount} tone="warning" />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle title="حسب الفرع" icon={<Wallet size={18} />} />
            <div className="grid gap-2 sm:grid-cols-2">
              {branches.map((b) => {
                const own = rows.filter((r) => r.branch === b);
                const bt = totalsOf(own);
                return (
                  <div
                    key={b}
                    className="rounded-xl p-2.5 text-xs font-bold"
                    style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                  >
                    <p className="dawaa-caption">{b}</p>
                    <p
                      className="text-sm font-black"
                      style={{ color: 'var(--dawaa-theme-heading)' }}
                    >
                      {money(bt.expenses)}
                    </p>
                    <p className="dawaa-caption">
                      {pct(bt.expenses, bt.sales).toLocaleString('ar-EG', {
                        maximumFractionDigits: 1,
                      })}
                      ٪ من مبيعاته · متوسط يومي {money(bt.days ? bt.expenses / bt.days : 0)}
                    </p>
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel className="p-4">
            <SectionTitle
              title="اتدفعت منين"
              subtitle="الكاش بس هو اللي بيتخصم من درج الشيفت"
              icon={<Receipt size={18} />}
            />
            <div className="space-y-2">
              {bySource.map(([source, amount]) => (
                <div key={source} className="flex items-center gap-2 text-xs font-bold">
                  <span className="w-20 shrink-0 sm:w-28">
                    {EXPENSE_SOURCE_LABEL[source] ?? source}
                  </span>
                  <Bar value={amount} max={total} tone={source === 'cash' ? 'warning' : 'info'} />
                  <span className="w-28 shrink-0 text-left sm:w-32">
                    {money(amount)} · {pctLabel(pct(amount, total))}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="p-4">
        <SectionTitle
          title={category ? `بنود «${category}»` : 'كل البنود'}
          subtitle={category ? `${shownLines.length.toLocaleString('ar-EG')} بند` : undefined}
          icon={<Receipt size={18} />}
        />
        {category ? (
          <button
            type="button"
            className="dawaa-tab mb-2 text-xs"
            onClick={() => setCategory(null)}
          >
            اعرض كل البنود
          </button>
        ) : null}
        <div className="overflow-x-auto">
          <table className="dawaa-table w-full min-w-[640px] text-right text-sm">
            <thead>
              <tr>
                <th>اليوم</th>
                <th>الفرع</th>
                <th>الشيفت</th>
                <th>البند</th>
                <th>البيان</th>
                <th>المبلغ</th>
                <th>اتدفع من</th>
                <th>اللي قفل</th>
              </tr>
            </thead>
            <tbody>
              {shownLines.map((l, idx) => (
                <tr key={`${l.handoverId}-${idx}`}>
                  <td>{shortDay(l.day)}</td>
                  <td>{shortBranch(l.branch)}</td>
                  <td>{l.shift}</td>
                  <td>{l.category}</td>
                  <td>{l.description || '-'}</td>
                  <td className="font-black">{money(l.amount)}</td>
                  <td>{EXPENSE_SOURCE_LABEL[l.source] ?? l.source}</td>
                  <td>{l.by || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
