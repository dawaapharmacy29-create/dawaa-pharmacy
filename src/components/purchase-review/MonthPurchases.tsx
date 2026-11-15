import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { monthRange, monthSummary, type PurchaseReviewData } from '@/lib/purchaseReview/ledger';
import { count, dayLabel, money, monthLabel } from './shared';

// «مشتريات الشهر»: what each branch bought in a month (or any period), credit and cash apart.

export default function MonthPurchases({
  data,
  today,
  onNeedFrom,
}: {
  data: PurchaseReviewData;
  today: string;
  onNeedFrom: (from: string) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const range = useMemo(
    () => custom ?? monthRange(today, monthOffset),
    [custom, today, monthOffset]
  );
  // A period starting before the loaded data asks the server for more.
  useEffect(() => {
    if (range.from < data.from) onNeedFrom(range.from);
  }, [range.from, data.from, onNeedFrom]);
  const month = useMemo(() => monthSummary(data, range), [data, range]);
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.code, s.name])), [data]);
  const date =
    'dawaa-theme-surface dawaa-theme-border rounded-lg border px-2 py-1 text-xs font-bold';

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="dawaa-title text-lg">
            مشتريات {custom ? 'الفترة' : monthLabel(range.from)}
          </h2>
          <p className="dawaa-caption text-xs font-bold">
            من {dayLabel(range.from)} لـ {dayLabel(range.to > today ? today : range.to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="dawaa-tab text-xs"
            onClick={() => {
              setCustom(null);
              setMonthOffset((m) => m - 1);
            }}
            aria-label="الشهر اللي قبله"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={`dawaa-tab text-xs ${!custom && monthOffset === 0 ? 'is-active' : ''}`}
            onClick={() => {
              setCustom(null);
              setMonthOffset(0);
            }}
          >
            الشهر ده
          </button>
          <button
            type="button"
            className="dawaa-tab text-xs"
            disabled={!custom && monthOffset >= 0}
            onClick={() => {
              setCustom(null);
              setMonthOffset((m) => Math.min(0, m + 1));
            }}
            aria-label="الشهر اللي بعده"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={range.from}
            max={today}
            onChange={(e) =>
              e.target.value &&
              setCustom({
                from: e.target.value,
                to: range.to < e.target.value ? e.target.value : range.to,
              })
            }
            className={date}
            aria-label="من"
          />
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setCustom({ from: range.from, to: e.target.value })}
            className={date}
            aria-label="لحد"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          [
            [
              'صافي المشتريات',
              month.total.net,
              'var(--dawaa-theme-heading)',
              `${count(month.total.invoices)} فاتورة`,
            ],
            [
              'آجل',
              month.total.credit,
              'var(--dawaa-status-danger-text)',
              'بيتدفع في ميعاد كل مورد',
            ],
            ['نقدي', month.total.cash, 'var(--dawaa-status-success-text)', 'اتدفع من الدرج'],
            [
              'مش محسوب',
              month.total.excluded,
              'var(--dawaa-theme-muted, inherit)',
              'تحويلات ما بينّا وجرد ومستثنى',
            ],
          ] as const
        ).map(([label, value, color, note]) => (
          <div
            key={label}
            className="rounded-2xl p-3"
            style={{ background: 'var(--dawaa-theme-surface-raised)' }}
          >
            <p className="dawaa-caption text-[11px] font-black">{label}</p>
            <p className="text-2xl font-black tabular-nums" style={{ color }}>
              {money(value)}
            </p>
            <p className="dawaa-caption text-[11px] font-bold">{note}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {month.branches.map((b) => {
          const top = month.suppliers.filter((s) => s.branch === b.branch).slice(0, 5);
          return (
            <div
              key={b.branch}
              className="rounded-2xl p-3"
              style={{ background: 'var(--dawaa-theme-surface-raised)' }}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-base font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {b.branch}
                </p>
                <p className="text-lg font-black tabular-nums">{money(b.net)}</p>
              </div>
              <table className="w-full text-xs font-bold">
                <thead className="dawaa-caption">
                  <tr>
                    <th className="text-start">المخزن</th>
                    <th className="text-start">آجل</th>
                    <th className="text-start">نقدي</th>
                    <th className="text-start">مش محسوب</th>
                  </tr>
                </thead>
                <tbody>
                  {b.stores.map((s) => (
                    <tr key={s.store}>
                      <td className="py-1">{s.store}</td>
                      <td className="tabular-nums">{money(s.credit)}</td>
                      <td className="tabular-nums">{money(s.cash)}</td>
                      <td className="dawaa-caption tabular-nums">{money(s.excluded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {top.length ? (
                <div className="mt-3">
                  <p className="dawaa-caption mb-1 text-[11px] font-black">أكبر الموردين</p>
                  {top.map((s) => (
                    <div key={s.code} className="mb-1">
                      <div className="flex justify-between text-[11px] font-bold">
                        <span>{names.get(s.code) ?? s.name}</span>
                        <span className="tabular-nums">{money(s.net)}</span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full"
                        style={{ background: 'var(--dawaa-theme-surface)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${b.net ? Math.max(2, (s.net / b.net) * 100) : 0}%`,
                            background: 'var(--dawaa-status-info-text)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
