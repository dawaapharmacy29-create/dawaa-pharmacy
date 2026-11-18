import { describe, expect, it } from 'vitest';
import {
  handoverDutyByPerson,
  onDutyAt,
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

  // Real hours in Cairo (UTC+2): the evening of 8/11 is handed over at 1:30 am on 9/11.
  const span = (name: string, kind: PunchInterval['kind'], from: string, to: string, branches = [SHOKRY]) =>
    ({
      staff_id: name,
      name,
      kind,
      home_branch: SHOKRY,
      branches,
      first_in: from,
      last_out: to,
      scheduled_end: null,
    }) satisfies PunchInterval;

  it('puts a missing evening on the evening doctor, not the night doctor or the morning one who stayed late', () => {
    const punches = [
      span('د المسائي', 'doctor', '2026-11-08T15:00:00Z', '2026-11-08T23:40:00Z'),
      span('د الليلي', 'doctor', '2026-11-08T21:30:00Z', '2026-11-09T06:30:00Z'),
      span('د الصباحي', 'doctor', '2026-11-08T07:00:00Z', '2026-11-08T16:00:00Z'),
    ];
    const duty = handoverDutyByPerson([slot('2026-11-08', 'مسائي', [])], punches, '2026-10-26');
    expect(duty.map((d) => [d.name, d.missed.length])).toEqual([['د المسائي', 1]]);
  });

  it('counts a doctor at the branch whose device took their last punch before the handover', () => {
    const moved = {
      ...span('د اميرة', 'doctor', '2026-11-08T15:00:00Z', '2026-11-08T23:30:00Z', [SHOKRY, 'فرع الشامي']),
      punches: [
        { at: '2026-11-08T15:00:00Z', branch: 'فرع الشامي' },
        { at: '2026-11-08T18:00:00Z', branch: SHOKRY },
        { at: '2026-11-08T23:30:00Z', branch: SHOKRY },
      ],
    };
    expect(onDutyAt([moved], SHOKRY, '2026-11-08T23:30:00Z').map((p) => p.name)).toEqual(['د اميرة']);
    expect(onDutyAt([moved], 'فرع الشامي', '2026-11-08T23:30:00Z')).toEqual([]);
  });
});
