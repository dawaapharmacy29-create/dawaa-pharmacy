import { describe, expect, it } from 'vitest';
import { buildIndex } from '../productSearch';
import { cleanNote, followupBrief, followupDue, understandFollowup } from '../followupUnderstanding';

const day = '2026-11-24'; // الاتنين
const catalog = buildIndex([
  { code: '1', name: 'AUGMENTIN 1GM 14 TAB', price: 210, sold: 200 },
  { code: '2', name: 'CONCOR 5 30TAB', price: 72, sold: 90 },
  { code: '3', name: 'PANADOL EXTRA 24 TAB', price: 58, sold: 300 },
]);

describe('reading a follow-up message', () => {
  it('reads a family member who is ill as a health check on them', () => {
    const u = understandFollowup('بنتها تعبانه نتطمن عليها 10240 د دنيا', day);
    expect(u.kind).toBe('health');
    expect(u.patient).toBe('بنتها');
    expect(u.female).toBe(true);
    expect(u.action).toContain('على بنتها');
    expect(u.note).toBe('بنتها تعبانه نتطمن عليها');
  });

  it('reads a price question with the item and the day to call', () => {
    const u = understandFollowup('كانت طلبت تسعير اوجمنتين نكلمها بعد يومين', day, catalog);
    expect(u.kind).toBe('price');
    expect(u.items).toEqual(['AUGMENTIN 1GM']);
    expect(u.dueDate).toBe('2026-11-26');
    expect(u.dueLabel).toBe('بعد يومين');
  });

  it('reads chronic treatment running out, shortages and complaints', () => {
    expect(understandFollowup('علاج الضغط الشهري هيخلص الاسبوع ده Concor 5', day).kind).toBe('refill');
    expect(understandFollowup('Concor 5', day).items).toEqual(['Concor 5']);
    expect(understandFollowup('الصنف كان ناقص نبلغه لما يتوفر', day).kind).toBe('shortage');
    expect(understandFollowup('العميل زعلان عشان الطلب اتاخر ضروري', day)).toMatchObject({
      kind: 'complaint',
      urgent: true,
    });
    expect(understandFollowup('صباح الخير', day).kind).toBe('general');
  });

  it('does not take a word inside another one', () => {
    expect(understandFollowup('هيعدي بردو بكرة', day).kind).toBe('general');
  });

  it('reads the day the doctor asked for', () => {
    expect(followupDue('نكلمه بكره', day)?.date).toBe('2026-11-25');
    expect(followupDue('نتابع بعد 3 ايام', day)?.date).toBe('2026-11-27');
    expect(followupDue('يوم الخميس', day)?.date).toBe('2026-11-26');
    expect(followupDue('ميعاد 2/12', day)?.date).toBe('2026-12-02');
    expect(followupDue('نتابع', day)).toBeNull();
  });

  it('takes out the number, the code and the signature, and writes the line for the sheet', () => {
    expect(cleanNote('العميل ده 01012345678 محتاج متابعة د/ علا')).toBe('العميل ده محتاج متابعة');
    const u = understandFollowup('كانت طلبت تسعير اوجمنتين نكلمها بعد يومين', day, catalog);
    expect(followupBrief(u, 'د دنيا').split('\n')).toEqual([
      expect.stringMatching(/^سأل على سعر وماشتراش: /),
      'الأصناف: AUGMENTIN 1GM',
      'الميعاد: بعد يومين',
      'كلام د دنيا: كانت طلبت تسعير اوجمنتين نكلمها بعد يومين',
    ]);
  });
});
