import { Fragment, useState } from 'react';
import { Panel, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_TYPES,
  shiftDeadline,
  type PunchInterval,
  type ShiftHandoverCorrection,
} from '@/lib/shiftHandoverCoverage';
import { totalsOf } from '@/lib/shiftHandoverLedger';
import ShiftHandoverCard, { closerNoteOf, handoverFlags } from './ShiftHandoverCard';
import { dayLabel, money, shortDay, type LiveRow } from './shared';

// «التسليمات»: day by day, branch by branch, the three shifts in their order. A shift past its deadline
// with nothing closed shows as missing, so a gap is never hidden by an empty space.

export default function HandoverDays({
  rows,
  days,
  branches,
  shifts,
  showMissing,
  fixesOf,
  punches,
  presenceFrom,
  slotPeople,
  onChanged,
}: {
  rows: LiveRow[];
  days: string[];
  branches: string[];
  shifts: (typeof SHIFT_TYPES)[number][];
  showMissing: boolean;
  fixesOf: (id: string) => ShiftHandoverCorrection[];
  punches: PunchInterval[] | null;
  presenceFrom: string;
  slotPeople: (branch: string, day: string, shift: (typeof SHIFT_TYPES)[number]) => string;
  onChanged: () => void;
}) {
  const [view, setView] = useState<'detail' | 'table'>('detail');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flagged = (r: LiveRow) =>
    fixesOf(r.id).length > 0 ||
    handoverFlags(r, closerNoteOf(r, punches, presenceFrom)).some((f) => f.tone !== 'info');
  const shown = onlyFlagged ? rows.filter(flagged) : rows;
  const flaggedCount = rows.filter(flagged).length;
  const isMissing = (day: string, branch: string, shift: (typeof SHIFT_TYPES)[number]) =>
    showMissing &&
    new Date() >= shiftDeadline(day, shift) &&
    !rows.some((r) => r.shift_date === day && r.branch === branch && r.shift_type === shift);
  const visibleDays = onlyFlagged
    ? days.filter((d) => shown.some((r) => r.shift_date === d))
    : days;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div
          className="flex gap-1 rounded-xl p-1"
          style={{ background: 'var(--dawaa-theme-surface)' }}
        >
          <button
            type="button"
            className={`dawaa-tab ${view === 'detail' ? 'is-active' : ''}`}
            onClick={() => setView('detail')}
          >
            تفصيلي
          </button>
          <button
            type="button"
            className={`dawaa-tab ${view === 'table' ? 'is-active' : ''}`}
            onClick={() => setView('table')}
          >
            جدول يومي
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-black">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          اللي محتاج مراجعة بس ({flaggedCount.toLocaleString('ar-EG')})
        </label>
      </div>

      {!visibleDays.length ? (
        <EmptyState
          label={
            onlyFlagged ? 'مفيش تسليمات محتاجة مراجعة في الفترة دي' : 'مفيش تسليمات في الفترة دي'
          }
        />
      ) : view === 'detail' ? (
        visibleDays.map((day) => {
          const dayRows = shown.filter((r) => r.shift_date === day);
          const t = totalsOf(dayRows);
          return (
            <Panel key={day} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {dayLabel(day)}
                </p>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="dawaa-badge dawaa-badge--neutral">مبيعات {money(t.sales)}</span>
                  <span className="dawaa-badge dawaa-badge--success">
                    للمحاسب {money(t.toAccountant)}
                  </span>
                  <span className="dawaa-badge dawaa-badge--info">
                    تحويلات {money(t.transfers)}
                  </span>
                  {t.expenses ? (
                    <span className="dawaa-badge dawaa-badge--warning">
                      مصروفات {money(t.expenses)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={`grid gap-3 ${branches.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {branches.map((branch) => {
                  const own = dayRows.filter((r) => r.branch === branch);
                  if (onlyFlagged && !own.length) return null;
                  const bt = totalsOf(own);
                  return (
                    <div
                      key={branch}
                      className="rounded-2xl p-3"
                      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                          {branch}
                        </p>
                        <p
                          className="text-xs font-black"
                          style={{ color: 'var(--dawaa-status-success-text)' }}
                        >
                          للمحاسب {money(bt.toAccountant)}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {shifts.map((shift) => {
                          const slotRows = own.filter((r) => r.shift_type === shift);
                          if (slotRows.length)
                            return (
                              <Fragment key={shift}>
                                {slotRows.map((r) => (
                                  <ShiftHandoverCard
                                    key={r.id}
                                    row={r}
                                    fixes={fixesOf(r.id)}
                                    punches={punches}
                                    presenceFrom={presenceFrom}
                                    canReview={Boolean(punches)}
                                    onChanged={onChanged}
                                  />
                                ))}
                              </Fragment>
                            );
                          if (onlyFlagged || !isMissing(day, branch, shift)) return null;
                          const who = slotPeople(branch, day, shift);
                          return (
                            <div
                              key={shift}
                              className="rounded-xl border border-dashed p-3 text-xs font-bold"
                              style={{
                                borderColor: 'var(--dawaa-status-danger-border)',
                                color: 'var(--dawaa-status-danger-text)',
                              }}
                            >
                              <span className="dawaa-badge dawaa-badge--danger">
                                {shift} · ناقص
                              </span>
                              <p className="mt-1">
                                ما اتقفلش{who ? ` — في الشيفت (بصمات): ${who}` : ''}
                              </p>
                            </div>
                          );
                        })}
                        {!own.length && !shifts.some((s) => isMissing(day, branch, s)) ? (
                          <p className="dawaa-caption text-xs font-bold">مفيش تسليمات</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })
      ) : (
        <Panel className="p-4">
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full min-w-[720px] text-right text-sm">
              <thead>
                <tr>
                  <th>اليوم</th>
                  {branches.map((b) => (
                    <th key={b} colSpan={4}>
                      {b}
                    </th>
                  ))}
                  <th>مبيعات اليوم</th>
                  <th>للمحاسب</th>
                </tr>
                <tr>
                  <th />
                  {branches.map((b) => (
                    <Fragment key={b}>
                      <th>شيفتات</th>
                      <th>مبيعات</th>
                      <th>للمحاسب</th>
                      <th>تحويلات</th>
                    </Fragment>
                  ))}
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleDays.map((day) => {
                  const dayRows = shown.filter((r) => r.shift_date === day);
                  const dt = totalsOf(dayRows);
                  return (
                    <tr key={day}>
                      <td className="font-bold">{shortDay(day)}</td>
                      {branches.map((b) => {
                        const own = dayRows.filter((r) => r.branch === b);
                        const t = totalsOf(own);
                        const doubled = own.some((r) => r.duplicate);
                        return (
                          <Fragment key={b}>
                            <td
                              style={{
                                color:
                                  own.length < shifts.length || doubled
                                    ? 'var(--dawaa-status-danger-text)'
                                    : undefined,
                              }}
                            >
                              {own.length}/{shifts.length}
                              {doubled ? ' ×2' : ''}
                            </td>
                            <td>{money(t.sales)}</td>
                            <td>{money(t.toAccountant)}</td>
                            <td>{money(t.transfers)}</td>
                          </Fragment>
                        );
                      })}
                      <td className="font-black">{money(dt.sales)}</td>
                      <td className="font-black">{money(dt.toAccountant)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
