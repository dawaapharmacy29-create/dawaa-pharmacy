import { describe, expect, it } from 'vitest';
import {
  handoverDutyByPerson,
  slotWindow,
  type PunchInterval,
  type ShiftSlot,
} from '../shiftHandoverCoverage';

type Row = {
  id: string;
  branch: string;
  shift_type: string;
  shift_date: string;
  submitted_by: string | null;
};
const SHOKRY = 'فرع شكري';

const slot = (day: string, shift: 'ليلي' | 'صباحي' | 'مسائي', rows: Row[]): ShiftSlot<Row> => ({
  day,
  branch: SHOKRY,
  shift,
  dueAt: new Date(0),
  rows,
  status: rows.length > 1 ? 'duplicate' : rows.length ? 'closed' : 'late',
});
const row = (id: string, by: string | null, day = '2026-11-07', shift = 'صباحي'): Row => ({
  id,
  branch: SHOKRY,
  shift_type: shift,
  shift_date: day,
  submitted_by: by,
});
const inShift = (
  name: string,
  kind: PunchInterval['kind'],
  day: string,
  shift: 'ليلي' | 'صباحي' | 'مسائي'
) => {
  const w = slotWindow(day, shift);
  return {
    staff_id: name,
    name,
    kind,
    home_branch: SHOKRY,
    branches: [SHOKRY],
    first_in: new Date(w.from).toISOString(),
    last_out: new Date(w.to).toISOString(),
    scheduled_end: null,
  } satisfies PunchInterval;
};

describe('who answers for the handovers of a cycle', () => {
  it('counts closings by name and a double entry once per shift', () => {
    const duty = handoverDutyByPerson(
      [
        slot('2026-11-07', 'صباحي', [row('a', 'د/ عمر'), row('b', 'د عمر')]),
        slot('2026-11-07', 'مسائي', [row('c', 'د اميرة')]),
      ],
      [],
      '2026-10-26'
    );
    expect(duty.find((d) => d.key === 'عمر')).toMatchObject({ closed: 2, doubles: 1, missed: [] });
    expect(duty.find((d) => d.key === 'اميره')).toMatchObject({ closed: 1, doubles: 0 });
  });

  it('puts a missing shift on the doctors punched in it, not the assistant', () => {
    const punches = [
      inShift('د وائل', 'doctor', '2026-11-08', 'مسائي'),
      inShift('محمد عمر', 'assistant', '2026-11-08', 'مسائي'),
    ];
    const duty = handoverDutyByPerson([slot('2026-11-08', 'مسائي', [])], punches, '2026-10-26');
    expect(duty.map((d) => [d.key, d.missed.length])).toEqual([['وائل', 1]]);
  });

  it('falls on the assistant when no doctor punched, and on nobody before the punches', () => {
    const punches = [inShift('محمد عمر', 'assistant', '2026-11-08', 'ليلي')];
    expect(
      handoverDutyByPerson([slot('2026-11-08', 'ليلي', [])], punches, '2026-10-26')[0]
    ).toMatchObject({
      key: 'محمد عمر',
    });
    expect(handoverDutyByPerson([slot('2026-11-08', 'ليلي', [])], punches, '2026-11-09')).toEqual(
      []
    );
    expect(handoverDutyByPerson([slot('2026-11-08', 'ليلي', [])], null, '2026-10-26')).toEqual([]);
  });
});
