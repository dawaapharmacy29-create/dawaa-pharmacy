import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ExternalLink, GitCompareArrows, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Panel,
  SectionTitle,
  EmptyState,
  MiniBox,
} from '@/components/dashboard/DashboardPrimitives';
import type { AccountantTransaction } from '@/lib/accountantReport';
import {
  VAULT_BRANCH,
  compareShiftsWithLedger,
  comparisonTotals,
  handedCash,
  handedElectronic,
  loadMonthHandovers,
  type HandoverShift,
} from '@/lib/shiftLedgerComparison';

const money = (value: number) =>
  Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
const diffClass = (value: number) =>
  Math.abs(value) <= 1
    ? 'dawaa-caption'
    : value > 0
      ? 'treasury-warning-text'
      : 'treasury-negative';

function Diff({ value }: { value: number }) {
  return (
    <span className={`font-black whitespace-nowrap ${diffClass(value)}`}>
      {Math.abs(value) <= 1 ? '✓' : (value > 0 ? '+' : '') + money(value)}
    </span>
  );
}

/** «مقارنة تسليم الشيفتات»: shift handovers next to the Dawaa Bills vault, per day, for شكري والشامي. */
export default function ShiftLedgerComparisonPanel({
  month,
  today,
  vaults,
  transactions,
  vaultName,
}: {
  month: string;
  today: string;
  /** The vault codes chosen in the page filter. */
  vaults: string[];
  transactions: AccountantTransaction[];
  vaultName: (code: string) => string;
}) {
  const [shifts, setShifts] = useState<HandoverShift[] | null>(null);
  const [error, setError] = useState('');
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [day, setDay] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setShifts(null);
    setError('');
    try {
      setShifts(await loadMonthHandovers(month));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تحميل تسليم الشيفتات');
    }
  }, [month]);
  useEffect(() => {
    setDay('');
    void load();
  }, [load]);

  // A string key keeps the memo stable: the page passes a new vaults array on every render.
  const comparedKey = vaults.filter((v) => VAULT_BRANCH[v]).join(',');
  const compared = useMemo(() => (comparedKey ? comparedKey.split(',') : []), [comparedKey]);
  const days = useMemo(
    () => compareShiftsWithLedger(transactions, shifts ?? [], compared, month, today),
    [transactions, shifts, compared, month, today]
  );
  const totals = comparisonTotals(days);
  const last = days[days.length - 1];
  const visible = days
    .filter((d) => (!day || d.date === day) && (!onlyMismatch || d.mismatch))
    .reverse();

  if (!compared.length)
    return (
      <EmptyState label="خزنة باقي الفروع مالهاش تسليم شيفتات في السيستم؛ اختار الشامي أو شكري أو كل الخزن." />
    );
  if (error) return <EmptyState label={error} error onRetry={() => void load()} />;
  if (!shifts)
    return (
      <div className="flex justify-center py-8" role="status">
        <Loader2 className="animate-spin" />
        <span className="sr-only">جارٍ تحميل تسليم الشيفتات</span>
      </div>
    );

  return (
    <div className="space-y-4">
      <Panel className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle
            title={`تسليم الشيفتات قدام الخزنة · ${compared.map(vaultName).join(' + ')}`}
            icon={<GitCompareArrows size={18} />}
          />
          <Link to="/shift-handovers" className="treasury-button">
            <ExternalLink size={16} />
            فتح تسليم الشيفتات
          </Link>
        </div>
        <p className="dawaa-caption text-xs">
          الكاش اللي الشيفتات سلّمته قدام «مبيعات» الخزنة، وفودافون كاش وإنستا والفيزا قدام «تحصيل
          الكتروني». الكاش بيتورّد للخزنة على دفعات، فاليوم ممكن يبقى فيه فرق؛ «الفرق المتراكم» هو
          اللي اتسلّم من الشيفتات ولسه ما وصلش الخزنة من أول الشهر (بالسالب: الخزنة استلمت أكتر).
          {vaults.includes('other') ? ' خزنة باقي الفروع مش داخلة في المقارنة.' : ''}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold">
            يوم معيّن
            <input
              type="date"
              className="dawaa-input mt-1 block"
              min={`${month}-01`}
              max={last?.date}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          {day ? (
            <button className="treasury-button" onClick={() => setDay('')}>
              كل أيام الشهر
            </button>
          ) : null}
          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={onlyMismatch}
              onChange={(e) => setOnlyMismatch(e.target.checked)}
            />
            أيام الفرق بس ({totals.mismatchDays})
          </label>
        </div>
      </Panel>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <MiniBox label="كاش الشيفتات" value={money(totals.shiftCash)} tone="green" />
        <MiniBox label="مبيعات الخزنة" value={money(totals.ledgerCash)} />
        <MiniBox
          label="كاش لسه ما وصلش الخزنة"
          value={money(last?.cashRunning ?? 0)}
          tone={Math.abs(last?.cashRunning ?? 0) > 1 ? 'amber' : 'green'}
        />
        <MiniBox
          label="تحويلات لسه ما وصلتش الخزنة"
          value={money(last?.electronicRunning ?? 0)}
          tone={Math.abs(last?.electronicRunning ?? 0) > 1 ? 'amber' : 'green'}
        />
      </div>

      <Panel className="p-4">
        <div className="overflow-x-auto">
          <table className="treasury-table treasury-compare">
            <thead>
              <tr>
                <th rowSpan={2}>اليوم</th>
                <th colSpan={4}>الكاش</th>
                <th colSpan={4}>فودافون كاش · إنستا · فيزا</th>
              </tr>
              <tr>
                <th>الشيفتات</th>
                <th>الخزنة</th>
                <th>فرق اليوم</th>
                <th>متراكم</th>
                <th>الشيفتات</th>
                <th>الخزنة</th>
                <th>فرق اليوم</th>
                <th>متراكم</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <Fragment key={d.date}>
                  <tr className={d.mismatch ? 'is-mismatch' : ''}>
                    <td className="whitespace-nowrap">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-bold"
                        aria-expanded={open === d.date}
                        onClick={() => setOpen(open === d.date ? null : d.date)}
                      >
                        {open === d.date ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
                        {dayLabel(d.date)}
                      </button>
                      <small className="dawaa-caption">
                        {d.shifts.length ? `${d.shifts.length} شيفت` : 'مفيش تسليم'}
                      </small>
                    </td>
                    <td>{money(d.shiftCash)}</td>
                    <td>{money(d.ledgerCash)}</td>
                    <td>
                      <Diff value={d.cashDiff} />
                    </td>
                    <td>
                      <Diff value={d.cashRunning} />
                    </td>
                    <td>{money(d.shiftElectronic)}</td>
                    <td>{money(d.ledgerElectronic)}</td>
                    <td>
                      <Diff value={d.electronicDiff} />
                    </td>
                    <td>
                      <Diff value={d.electronicRunning} />
                    </td>
                  </tr>
                  {open === d.date ? (
                    <tr>
                      <td colSpan={9}>
                        {d.shifts.length ? (
                          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {d.shifts.map((s) => (
                              <div key={s.id} className="treasury-shift">
                                <b>
                                  {s.branch.replace('فرع ', '')} · {s.shift_type}
                                </b>
                                <span className="dawaa-caption text-xs">
                                  {s.submitted_by || 'بدون اسم'}
                                </span>
                                <span className="text-xs">
                                  كاش {money(handedCash(s))} · تحويلات {money(handedElectronic(s))}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="dawaa-caption text-xs">مفيش شيفتات اتقفلت اليوم ده.</p>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <EmptyState label={onlyMismatch ? 'مفيش أيام فيها فرق' : 'مفيش أيام في الفترة دي'} />
        )}
      </Panel>
    </div>
  );
}
