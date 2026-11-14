import { useMemo, useState } from 'react';
import { CalendarCheck, Fingerprint, UserX } from 'lucide-react';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { SHIFT_TYPES, type ShiftSlot } from '@/lib/shiftHandoverCoverage';
import { addDays, cycleOf, shiftMoney } from '@/lib/shiftHandoverLedger';
import {
  SHIFT_TONE,
  clockLabel,
  money,
  shortBranch,
  shortDay,
  type LiveRow,
  type ResponsibleOf,
} from './shared';

// «اكتمال الشيفتات»: who forgot to hand over (by the fingerprints at handover time, for the deduction)
// and the last two weeks shift by shift, with the name of whoever closed or was there in every cell.

type Slot = ShiftSlot<LiveRow>;

const CELL: Record<Slot['status'], { bg: string; text: string; border: string }> = {
  closed: {
    bg: 'var(--dawaa-status-success-bg)',
    text: 'var(--dawaa-status-success-text)',
    border: 'var(--dawaa-status-success-border)',
  },
  duplicate: {
    bg: 'var(--dawaa-status-warning-bg)',
    text: 'var(--dawaa-status-warning-text)',
    border: 'var(--dawaa-status-warning-border)',
  },
  late: {
    bg: 'var(--dawaa-status-danger-bg)',
    text: 'var(--dawaa-status-danger-text)',
    border: 'var(--dawaa-status-danger-border)',
  },
  pending: {
    bg: 'var(--dawaa-theme-surface-raised)',
    text: 'var(--dawaa-theme-muted)',
    border: 'var(--dawaa-theme-border)',
  },
};

type Owner = {
  key: string;
  name: string;
  assistant: boolean;
  slots: { slot: Slot; shared: number }[];
};

export default function HandoverCoverage({
  slots,
  longSlots,
  days,
  branches,
  today,
  coverageDays,
  responsibleOf,
  namesKnown,
}: {
  /** The last `coverageDays` days. */
  slots: Slot[];
  /** Enough days back to hold the previous cycle. */
  longSlots: Slot[];
  days: string[];
  branches: string[];
  today: string;
  coverageDays: number;
  responsibleOf: ResponsibleOf;
  /** False when the fingerprints are not available to this user. */
  namesKnown: boolean;
}) {
  const [which, setWhich] = useState<'current' | 'previous'>('current');
  const cycle = which === 'current' ? cycleOf(today) : cycleOf(addDays(cycleOf(today).from, -1));

  const { owners, nobody, total } = useMemo(() => {
    const missed = longSlots.filter(
      (s) =>
        s.status === 'late' &&
        s.day >= cycle.from &&
        s.day <= cycle.to &&
        branches.includes(s.branch)
    );
    const byKey = new Map<string, Owner>();
    const unowned: Slot[] = [];
    for (const slot of missed) {
      const responsible = responsibleOf(slot.branch, slot.day, slot.shift);
      if (!responsible?.people.length) {
        unowned.push(slot);
        continue;
      }
      for (const person of responsible.people) {
        const owner = byKey.get(person.staff_id) ?? {
          key: person.staff_id,
          name: person.name,
          assistant: person.kind === 'assistant',
          slots: [],
        };
        owner.slots.push({ slot, shared: responsible.people.length });
        byKey.set(person.staff_id, owner);
      }
    }
    const list = [...byKey.values()].sort(
      (a, b) => b.slots.length - a.slots.length || a.name.localeCompare(b.name, 'ar')
    );
    for (const o of list) o.slots.sort((a, b) => b.slot.day.localeCompare(a.slot.day));
    return { owners: list, nobody: unowned, total: missed.length };
  }, [longSlots, cycle.from, cycle.to, branches, responsibleOf]);

  const slotOf = (day: string, branch: string, shift: string) =>
    slots.find((s) => s.day === day && s.branch === branch && s.shift === shift);

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <SectionTitle title="مين نسي يسلّم الشيفت" icon={<UserX size={18} />} />
          <div
            className="flex gap-1 rounded-xl p-1 print:hidden"
            style={{ background: 'var(--dawaa-theme-surface-raised)' }}
          >
            {(
              [
                ['current', 'الدورة الحالية'],
                ['previous', 'الدورة اللي فاتت'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={which === id}
                className={`dawaa-tab px-3 py-1 text-xs ${which === id ? 'is-active' : ''}`}
                onClick={() => setWhich(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="dawaa-caption mb-3 text-xs font-bold">
          من {shortDay(cycle.from)} لحد {shortDay(cycle.to)} · {total.toLocaleString('ar-EG')} شيفت
          ما اتسلّمش. المسؤول هو الدكتور اللي كان بصمته في الفرع ساعة التسليم (ساعة ونص قبل ما
          الشيفت يتحسب ناقص)، ولو مفيش دكتور يبقى المساعد. لو كانوا اتنين الشيفت بيتكتب على الاتنين.
        </p>
        {!namesKnown ? (
          <p className="dawaa-caption text-xs font-bold">أسماء البصمات بتظهر للإدارة العليا بس.</p>
        ) : !total ? (
          <p className="text-sm font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
            كل الشيفتات اتسلّمت في الدورة دي ✓
          </p>
        ) : (
          <div className="space-y-2">
            {owners.map((o) => (
              <div
                key={o.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3"
                style={{
                  borderColor: 'var(--dawaa-status-danger-border)',
                  background: 'var(--dawaa-theme-surface)',
                }}
              >
                <div className="flex min-w-[9rem] items-center gap-2">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black"
                    style={{
                      background: 'var(--dawaa-status-danger-bg)',
                      color: 'var(--dawaa-status-danger-text)',
                    }}
                  >
                    {o.slots.length.toLocaleString('ar-EG')}
                  </span>
                  <span>
                    <span
                      className="block text-sm font-black"
                      style={{ color: 'var(--dawaa-theme-heading)' }}
                    >
                      {o.name}
                    </span>
                    <span className="dawaa-caption block text-[11px] font-bold">
                      {o.assistant ? 'مساعد · ' : ''}
                      {o.slots.length === 1
                        ? 'شيفت واحد'
                        : `${o.slots.length.toLocaleString('ar-EG')} شيفتات`}
                    </span>
                  </span>
                </div>
                <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {o.slots.map(({ slot, shared }) => (
                    <li
                      key={`${slot.day}${slot.branch}${slot.shift}`}
                      className="dawaa-badge dawaa-badge--neutral inline-flex items-center gap-1 text-[11px]"
                      title={shared > 1 ? 'كان معاه دكتور تاني في نفس الوقت' : undefined}
                    >
                      {shortDay(slot.day)} · {shortBranch(slot.branch)} ·{' '}
                      <span className={`dawaa-badge ${SHIFT_TONE[slot.shift]} px-1.5 py-0`}>
                        {slot.shift}
                      </span>
                      {shared > 1 ? <span className="opacity-70">(مع حد تاني)</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {nobody.length ? (
              <div
                className="rounded-xl border border-dashed p-3 text-xs font-bold"
                style={{ borderColor: 'var(--dawaa-status-warning-border)' }}
              >
                <p className="mb-1.5" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                  {nobody.length.toLocaleString('ar-EG')} شيفت ناقص ومفيش حد بصم في الفرع ساعة
                  التسليم — محتاج مراجعة يدوي من الجدول:
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {nobody.map((slot) => (
                    <li
                      key={`${slot.day}${slot.branch}${slot.shift}`}
                      className="dawaa-badge dawaa-badge--warning text-[11px]"
                    >
                      {shortDay(slot.day)} · {shortBranch(slot.branch)} · {slot.shift}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <SectionTitle
          title={`الشيفتات شيفت بشيفت (آخر ${coverageDays.toLocaleString('ar-EG')} يوم)`}
          icon={<CalendarCheck size={18} />}
        />
        <p className="dawaa-caption mb-3 text-xs font-bold">
          كل خانة فيها اللي قفل الشيفت وساعته، والناقص فيه اسم اللي كان موجود. الشيفت بيتحسب ناقص
          بعد ميعاده بساعتين: الليلي ١٠ الصبح، الصباحي ٧ بالليل، المسائي ٣ الفجر.
        </p>
        <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-bold">
          {(
            [
              ['closed', 'اتسلّم'],
              ['late', 'ناقص'],
              ['duplicate', 'متسجل مرتين'],
              ['pending', 'لسه مجاش ميعاده'],
            ] as const
          ).map(([status, label]) => (
            <span key={status} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded"
                style={{ background: CELL[status].bg, border: `1px solid ${CELL[status].border}` }}
              />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Fingerprint size={12} /> = من البصمة
          </span>
        </div>
        <div className="overflow-x-auto">
          <table
            className="w-full border-separate text-center text-[11px] font-bold"
            style={{ borderSpacing: 4, minWidth: branches.length * 3 * 104 + 80 }}
          >
            <thead>
              <tr>
                <th />
                {branches.map((branch) => (
                  <th
                    key={branch}
                    colSpan={SHIFT_TYPES.length}
                    className="rounded-lg p-1 text-xs font-black"
                    style={{
                      background: 'var(--dawaa-theme-surface-raised)',
                      color: 'var(--dawaa-theme-heading)',
                    }}
                  >
                    {branch}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="p-1 text-right">اليوم</th>
                {branches.map((branch) =>
                  SHIFT_TYPES.map((shift) => (
                    <th key={`${branch}${shift}`} className="p-1">
                      <span className={`dawaa-badge ${SHIFT_TONE[shift]}`}>{shift}</span>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <td className="whitespace-nowrap p-1 text-right text-xs font-black">
                    {shortDay(day)}
                  </td>
                  {branches.map((branch) =>
                    SHIFT_TYPES.map((shift) => {
                      const slot = slotOf(day, branch, shift);
                      if (!slot) return <td key={`${branch}${shift}`} />;
                      const tone = CELL[slot.status];
                      const responsible =
                        slot.status === 'late' ? responsibleOf(branch, day, shift) : null;
                      return (
                        <td
                          key={`${branch}${shift}`}
                          className="rounded-lg border p-1.5 align-top"
                          style={{
                            background: tone.bg,
                            borderColor: tone.border,
                            borderStyle: slot.status === 'late' ? 'dashed' : 'solid',
                          }}
                          title={slot.rows
                            .map(
                              (r) =>
                                `${r.submitted_by || '-'} · ${money(shiftMoney(r).sales)}${r.reread ? ` · مسجل ${r.source_type} ${r.source_date}` : ''}`
                            )
                            .join('\n')}
                        >
                          {slot.rows.length ? (
                            slot.rows.map((r) => (
                              <span key={r.id} className="block leading-tight">
                                <span
                                  className="block truncate"
                                  style={{ color: 'var(--dawaa-theme-heading)', maxWidth: 104 }}
                                >
                                  {r.submitted_by || '-'}
                                </span>
                                <span style={{ color: tone.text }}>
                                  {clockLabel(r.recorded_at)}
                                  {r.reread ? ' ↻' : ''}
                                </span>
                              </span>
                            ))
                          ) : slot.status === 'late' ? (
                            <span className="block leading-tight" style={{ color: tone.text }}>
                              <span className="block font-black">ناقص</span>
                              {responsible ? (
                                <span className="inline-flex items-center gap-0.5">
                                  <Fingerprint size={10} />
                                  {responsible.people.length
                                    ? responsible.people.map((p) => p.name).join('، ')
                                    : 'مفيش بصمة'}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span style={{ color: tone.text }}>…</span>
                          )}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dawaa-caption mt-2 text-[11px] font-bold">
          ↻ = اتحسب من وقت التقفيل مش من اليوم أو الشيفت المكتوب في دواء وائل.
        </p>
      </Panel>
    </div>
  );
}
