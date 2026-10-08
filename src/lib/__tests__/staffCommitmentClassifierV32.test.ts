// Shared staff-commitment grammar (whatsappSemanticSignalsV32.classifyStaffCommitmentsV32):
// one semantic owner for availability check_pending AND follow-up promises.
import { describe, expect, it } from 'vitest';
import {
  classifyAvailabilityStatementV32,
  classifyStaffCommitmentsV32,
  isStaffFollowUpPromiseV32,
} from '@/lib/whatsappSemanticSignalsV32';

const kinds = (text: string) => classifyStaffCommitmentsV32(text).map((row) => row.kind);

describe('staff commitment grammar — availability checks (generic, no product vocabulary)', () => {
  for (const text of [
    'هراجع التوفر',
    'هراجع لحضرتك التوفر',
    'تحت أمر حضرتك، هراجع لحضرتك التوفر.',
    'هشوف لحضرتك التوفر',
    'هتأكد من المخزن',
    'هسأل عن توفره',
    'هسأل الفرع التاني',
    'هنشوف المخزن يا فندم وأرد على حضرتك',
    'ثواني وأشوف',
    'هشوف لحضرتك موجود ولا لا',
    'تمام يا فندم وهراجع لحضرتك التوفر',
    'فهتأكد من المخزن',
  ]) {
    it(`"${text}" -> availability check_pending + follow-up promise`, () => {
      expect(kinds(text)).toContain('availability_check');
      expect(classifyAvailabilityStatementV32(text)).toBe('check_pending');
      expect(isStaffFollowUpPromiseV32(text)).toBe(true);
    });
  }
});

describe('staff commitment grammar — reply-back promises', () => {
  for (const text of ['هراجع وأرد لحضرتك', 'هتابع مع حضرتك', 'هرد على حضرتك', 'هبلغ حضرتك أول ما يوصل', 'هكلمك بكرة', 'هرجع لحضرتك']) {
    it(`"${text}" -> reply_back promise`, () => {
      expect(kinds(text)).toContain('reply_back');
      expect(isStaffFollowUpPromiseV32(text)).toBe(true);
    });
  }
});

describe('staff commitment grammar — non-commitments', () => {
  for (const text of [
    'راجعت التوفر', // past / completed
    'اتأكدت من المخزن', // past / completed
    'مراجعة التوفر', // noun phrase
    'مش هراجع التوفر', // negated
    'هراجع التوفر؟', // question
    'تم مراجعة الطلب', // unrelated review statement
    'هبعتلك الأوردر حالا', // fulfilment promise, not a come-back obligation
    'متوفر يا فندم',
  ]) {
    it(`"${text}" is not a staff commitment`, () => {
      expect(kinds(text)).toEqual([]);
      expect(isStaffFollowUpPromiseV32(text)).toBe(false);
      expect(classifyAvailabilityStatementV32(text) === 'check_pending').toBe(false);
    });
  }

  it('an availability assertion outside the commitment span still wins ("متوفر، وهتأكد من الكمية" stays available)', () => {
    expect(classifyAvailabilityStatementV32('متوفر وهتأكد من الكمية')).toBe('available');
    expect(classifyAvailabilityStatementV32('مش متوفر، هسأل الفرع')).toBe('unavailable');
  });
});
