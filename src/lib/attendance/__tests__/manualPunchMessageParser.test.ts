import { describe, expect, it } from 'vitest';
import { parseManualPunchMessage as parse, resolveAmbiguousTime } from '../manualPunchMessageParser';

const today = '2026-11-09'; // Monday

describe('parseManualPunchMessage', () => {
  it('reads a check-in with a morning hour', () => {
    expect(parse('حضرت الساعة ٩ الصبح', today)[0]).toMatchObject({ type: 'check_in', time: '09:00', ambiguous: false });
  });
  it('reads yesterday and half past in the evening', () => {
    expect(parse('امبارح مشيت الساعة 10 ونص بليل', today)[0]).toMatchObject({ type: 'check_out', date: '2026-11-08', time: '22:30' });
  });
  it('treats 2 at night as after midnight', () => {
    expect(parse('قفلت الساعة 2 بليل', today)[0]).toMatchObject({ type: 'check_out', time: '02:00' });
  });
  it('reads hour words and minus a quarter', () => {
    expect(parse('وصلت الساعة تسعة الا ربع الصبح', today)[0]).toMatchObject({ type: 'check_in', time: '08:45' });
  });
  it('reads two punches from one message without reusing a time', () => {
    expect(parse('حضرت 9 الصبح ومشيت 5 العصر', today)).toMatchObject([
      { type: 'check_in', time: '09:00' },
      { type: 'check_out', time: '17:00' },
    ]);
  });
  it('leaves the second time empty when only one was said', () => {
    expect(parse('حضرت 9 الصبح ومشيت', today)[1]).toMatchObject({ type: 'check_out', time: null });
  });
  it('does not read a date as a time', () => {
    expect(parse('يوم 5/11 حضرت الساعة 2:30 العصر', today)[0]).toMatchObject({ date: '2026-11-05', time: '14:30' });
  });
  it('takes the most recent named weekday', () => {
    expect(parse('يوم الخميس جيت 10 الصبح', today)[0]).toMatchObject({ date: '2026-11-05', time: '10:00' });
  });
  it('rolls a later day number back to last month', () => {
    expect(parse('يوم 28 خرجت الساعة 11 مساء', today)[0]).toMatchObject({ date: '2026-10-28', time: '23:00' });
  });
  it('does not take a formal "you" as attendance', () => {
    expect(parse('لو سمحت حضرتك الساعة 9', today)[0].type).toBeNull();
  });
  it('does not take a duration as the time', () => {
    expect(parse('مشيت بعد 3 ساعات', today)[0].time).toBeNull();
  });
  it('flags an hour with no morning or evening', () => {
    expect(parse('حضرت الساعة 9', today)[0]).toMatchObject({ time: '09:00', ambiguous: true });
  });
  it('reports nothing it cannot find', () => {
    expect(parse('نسيت ابصم', today)).toEqual([{ type: null, date: null, time: null, ambiguous: false }]);
  });
});

describe('resolveAmbiguousTime', () => {
  it('uses an evening shift to read 9 as 21:00', () => {
    expect(resolveAmbiguousTime('09:00', '22:00')).toEqual({ time: '21:00', resolved: true });
  });
  it('uses a morning shift to keep 9 as 09:00', () => {
    expect(resolveAmbiguousTime('09:00', '09:30')).toEqual({ time: '09:00', resolved: true });
  });
  it('stays unresolved with no shift', () => {
    expect(resolveAmbiguousTime('09:00', null).resolved).toBe(false);
  });
});
