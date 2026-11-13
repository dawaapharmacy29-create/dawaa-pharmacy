import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_HANDOVER_BRANCHES,
  SHIFT_TYPES,
  shiftDeadline,
  type ShiftSlot,
} from '@/lib/shiftHandoverCoverage';
import { shiftMoney, totalsOf } from '@/lib/shiftHandoverLedger';
import { SHIFT_TONE, clockLabel, dayLabel, money, type LiveRow } from './shared';

// «النهارده وامبارح»: every branch closes three shifts a day. Each slot says at a glance whether it is
// closed, missing, doubled or not due yet, and how much cash it owes the accountant.

const STATUS_TEXT = {
  closed: ['اتقفل', 'success'],
  duplicate: ['متسجل مرتين', 'danger'],
  late: ['ناقص', 'danger'],
  pending: ['لسه', 'info'],
} as const;

export default function TodayBoard({
  days,
  slotOf,
  slotPeople,
  onOpenDay,
}: {
  days: string[];
  slotOf: (day: string, branch: string, shift: string) => ShiftSlot<LiveRow> | undefined;
  slotPeople: (branch: string, day: string, shift: (typeof SHIFT_TYPES)[number]) => string;
  onOpenDay: (day: string) => void;
}) {
  return (
    <div className="space-y-4">
      {days.map((day) => {
        const rows = SHIFT_HANDOVER_BRANCHES.flatMap((b) =>
          SHIFT_TYPES.flatMap((s) => slotOf(day, b, s)?.rows ?? [])
        );
        const t = totalsOf(rows);
        const closedSlots = SHIFT_HANDOVER_BRANCHES.flatMap((b) =>
          SHIFT_TYPES.map((s) => slotOf(day, b, s))
        ).filter((slot) => slot && slot.rows.length).length;
        return (
          <Panel key={day} className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {dayLabel(day)}
                </p>
                <p className="dawaa-caption text-xs font-bold">
                  {closedSlots.toLocaleString('ar-EG')} من ٦ شيفتات اتقفلت
                </p>
              </div>
              <button
                type="button"
                className="dawaa-tab text-xs print:hidden"
                onClick={() => onOpenDay(day)}
              >
                كل تفاصيل اليوم
              </button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ['المبيعات', t.sales, 'var(--dawaa-theme-heading)'],
                ['كاش للمحاسب', t.toAccountant, 'var(--dawaa-status-success-text)'],
                ['تحويلات', t.transfers, 'var(--dawaa-status-info-text)'],
                ['مصروفات', t.expenses, 'var(--dawaa-status-warning-text)'],
              ].map(([label, value, color]) => (
                <div
                  key={label as string}
                  className="rounded-xl p-2 text-center"
                  style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                >
                  <p className="dawaa-caption text-[11px] font-bold">{label}</p>
                  <p className="text-base font-black" style={{ color: color as string }}>
                    {money(value as number)}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {SHIFT_HANDOVER_BRANCHES.map((branch) => {
                const own = SHIFT_TYPES.flatMap((s) => slotOf(day, branch, s)?.rows ?? []);
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
                      <p className="text-xs font-black">
                        مبيعات {money(bt.sales)} ·{' '}
                        <span style={{ color: 'var(--dawaa-status-success-text)' }}>
                          للمحاسب {money(bt.toAccountant)}
                        </span>
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {SHIFT_TYPES.map((shift) => {
                        const slot = slotOf(day, branch, shift);
                        const status = slot?.status ?? 'pending';
                        const [label, tone] = STATUS_TEXT[status];
                        const due = shiftDeadline(day, shift);
                        return (
                          <div
                            key={shift}
                            className="rounded-xl border p-2 text-xs font-bold"
                            style={{
                              background: 'var(--dawaa-theme-surface)',
                              borderColor:
                                tone === 'danger'
                                  ? 'var(--dawaa-status-danger-border)'
                                  : 'var(--dawaa-theme-border)',
                              borderStyle: status === 'late' ? 'dashed' : 'solid',
                            }}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className={`dawaa-badge ${SHIFT_TONE[shift]}`}>{shift}</span>
                              <span className={`dawaa-badge dawaa-badge--${tone}`}>{label}</span>
                            </div>
                            {slot?.rows.length ? (
                              slot.rows.map((r) => {
                                const m = shiftMoney(r);
                                return (
                                  <div key={r.id} className="mt-1.5 space-y-0.5">
                                    <p
                                      className="truncate"
                                      style={{ color: 'var(--dawaa-theme-heading)' }}
                                    >
                                      {r.submitted_by || '-'} · {clockLabel(r.recorded_at)}
                                    </p>
                                    <p>مبيعات {money(m.sales)}</p>
                                    <p style={{ color: 'var(--dawaa-status-success-text)' }}>
                                      للمحاسب {money(m.toAccountant)}
                                    </p>
                                    {m.transfers ? (
                                      <p style={{ color: 'var(--dawaa-status-info-text)' }}>
                                        تحويلات {money(m.transfers)}
                                      </p>
                                    ) : null}
                                  </div>
                                );
                              })
                            ) : status === 'late' ? (
                              <p
                                className="mt-1.5"
                                style={{ color: 'var(--dawaa-status-danger-text)' }}
                              >
                                ما اتقفلش
                                {slotPeople(branch, day, shift)
                                  ? ` — في الشيفت: ${slotPeople(branch, day, shift)}`
                                  : ''}
                              </p>
                            ) : (
                              <p className="dawaa-caption mt-1.5">
                                بيتحسب ناقص بعد {clockLabel(due.toISOString())}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
