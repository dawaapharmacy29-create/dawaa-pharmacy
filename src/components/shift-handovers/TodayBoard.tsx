import { CheckCircle2, Clock, Copy, XCircle } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_HANDOVER_BRANCHES,
  SHIFT_TYPES,
  shiftDeadline,
  type ShiftSlot,
} from '@/lib/shiftHandoverCoverage';
import { shiftMoney, totalsOf } from '@/lib/shiftHandoverLedger';
import {
  ResponsibleLine,
  SHIFT_TONE,
  clockLabel,
  dayLabel,
  money,
  type LiveRow,
  type ResponsibleOf,
} from './shared';

// «النهارده وامبارح»: every branch closes three shifts a day. Each slot says at a glance whether it is
// closed, missing, doubled or not due yet, who was there when it was handed over, and the cash it owes.

const STATUS = {
  closed: { label: 'اتسلّم', tone: 'success', Icon: CheckCircle2 },
  duplicate: { label: 'متسجل مرتين', tone: 'warning', Icon: Copy },
  late: { label: 'ما اتسلّمش', tone: 'danger', Icon: XCircle },
  pending: { label: 'لسه', tone: 'info', Icon: Clock },
} as const;

export default function TodayBoard({
  days,
  slotOf,
  responsibleOf,
  onOpenDay,
}: {
  days: string[];
  slotOf: (day: string, branch: string, shift: string) => ShiftSlot<LiveRow> | undefined;
  responsibleOf: ResponsibleOf;
  onOpenDay: (day: string) => void;
}) {
  return (
    <div className="space-y-4">
      {days.map((day) => {
        const slots = SHIFT_HANDOVER_BRANCHES.flatMap((b) =>
          SHIFT_TYPES.map((s) => slotOf(day, b, s))
        );
        const t = totalsOf(slots.flatMap((slot) => slot?.rows ?? []));
        const closedSlots = slots.filter((slot) => slot?.rows.length).length;
        const missing = slots.filter((slot) => slot?.status === 'late').length;
        return (
          <Panel key={day} className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-lg font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {dayLabel(day)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div
                    className="h-1.5 w-28 overflow-hidden rounded-full"
                    style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(closedSlots / slots.length) * 100}%`,
                        background: missing
                          ? 'var(--dawaa-status-danger-text)'
                          : 'var(--dawaa-status-success-text)',
                      }}
                    />
                  </div>
                  <span className="dawaa-caption text-xs font-bold">
                    {closedSlots.toLocaleString('ar-EG')} من ٦ اتسلّموا
                    {missing ? (
                      <span style={{ color: 'var(--dawaa-status-danger-text)' }}>
                        {' '}
                        · {missing.toLocaleString('ar-EG')} ناقص
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="dawaa-tab text-xs print:hidden"
                onClick={() => onOpenDay(day)}
              >
                كل تفاصيل اليوم
              </button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ['المبيعات', t.sales, 'var(--dawaa-theme-heading)'],
                ['كاش للمحاسب', t.toAccountant, 'var(--dawaa-status-success-text)'],
                ['تحويلات', t.transfers, 'var(--dawaa-status-info-text)'],
                ['مصروفات', t.expenses, 'var(--dawaa-status-warning-text)'],
              ].map(([label, value, color]) => (
                <div
                  key={label as string}
                  className="rounded-xl p-2.5"
                  style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                >
                  <p className="dawaa-caption text-[11px] font-bold">{label}</p>
                  <p className="text-lg font-black" style={{ color: color as string }}>
                    {money(value as number)}
                  </p>
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {SHIFT_HANDOVER_BRANCHES.map((branch) => {
                const own = SHIFT_TYPES.flatMap((s) => slotOf(day, branch, s)?.rows ?? []);
                const bt = totalsOf(own);
                return (
                  <section key={branch}>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
                      <h3 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                        {branch}
                      </h3>
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
                        const { label, tone, Icon } = STATUS[status];
                        const due = shiftDeadline(day, shift);
                        return (
                          <div
                            key={shift}
                            className="flex flex-col gap-1.5 rounded-xl border p-2.5 text-xs font-bold"
                            style={{
                              background: 'var(--dawaa-theme-surface)',
                              borderColor:
                                status === 'pending'
                                  ? 'var(--dawaa-theme-border)'
                                  : `var(--dawaa-status-${tone}-border)`,
                              borderStyle: status === 'late' ? 'dashed' : 'solid',
                              borderInlineStartWidth: 4,
                            }}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className={`dawaa-badge ${SHIFT_TONE[shift]}`}>{shift}</span>
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-black"
                                style={{ color: `var(--dawaa-status-${tone}-text)` }}
                              >
                                <Icon size={13} /> {label}
                              </span>
                            </div>
                            {slot?.rows.length ? (
                              slot.rows.map((r) => {
                                const m = shiftMoney(r);
                                return (
                                  <div key={r.id} className="space-y-1.5">
                                    <div className="flex items-baseline justify-between gap-2">
                                      <p
                                        className="truncate text-sm font-black"
                                        style={{ color: 'var(--dawaa-theme-heading)' }}
                                      >
                                        {r.submitted_by || '-'}
                                      </p>
                                      <span className="dawaa-caption shrink-0 text-[11px]">
                                        {clockLabel(r.recorded_at)}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                      <p
                                        className="text-lg font-black"
                                        style={{ color: 'var(--dawaa-theme-heading)' }}
                                      >
                                        {money(m.sales)}
                                      </p>
                                      <p style={{ color: 'var(--dawaa-status-success-text)' }}>
                                        للمحاسب {money(m.toAccountant)}
                                      </p>
                                    </div>
                                    {m.transfers ? (
                                      <p
                                        className="text-[11px]"
                                        style={{ color: 'var(--dawaa-status-info-text)' }}
                                      >
                                        تحويلات {money(m.transfers)}
                                      </p>
                                    ) : null}
                                    <ResponsibleLine
                                      compact
                                      responsible={responsibleOf(branch, day, shift, r)}
                                    />
                                  </div>
                                );
                              })
                            ) : status === 'late' ? (
                              <ResponsibleLine
                                compact
                                missing
                                responsible={responsibleOf(branch, day, shift)}
                              />
                            ) : (
                              <p className="dawaa-caption">
                                بيتحسب ناقص بعد {clockLabel(due.toISOString())}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
