import { describe, expect, it } from 'vitest';
import { findNamedDoctor } from '../namedDoctor';

// The competition doctors on 2026-11-13.
const names = ['د اميرة ', 'د دنيا', 'د رضا', 'د محمد شبل', 'د محمد وليد', 'د وائل', 'د/ أحمد عاطف', 'د/ علا', 'د/ علياء', 'د/ عمر', 'د/ عمرو صلاح', 'د/ مغازي', 'د هدي ', 'د احمد حافظ'];
const doctors = names.map((name, index) => ({ staffId: String(index), name }));
const named = (body: string) => findNamedDoctor(body, doctors)?.name.trim() ?? null;

describe('findNamedDoctor', () => {
  it.each([
    ['د/ مغازي روشتة عيون', 'د/ مغازي'],
    ['د. مغازي / روشتة عظام ممكن نطمن', 'د/ مغازي'],
    ['د.مغازي طفل خارج من عمليه', 'د/ مغازي'],
    ['د* مغازي ممكن نفولو اب معاها', 'د/ مغازي'],
    ['د / مغازي / مكن نطمن ان شاء الله', 'د/ مغازي'],
    ['نطمن ع العميل ان شاء الله من العملاء الدايمين ف المكان د/ مغازي', 'د/ مغازي'],
    ['عميل جديد هنحتاج نكوده ونتابع معاه د/رضا', 'د رضا'],
    ['د امل طلبت الاصناف دي وفرناها من الطحان د/ رضا', 'د رضا'],
    ['د احمد عاطف اخدت جينوفيل', 'د/ أحمد عاطف'],
    ['د عمر عميل جديد', 'د/ عمر'],
    ['د عمرو صلاح عميل جديد', 'د/ عمرو صلاح'],
  ])('reads %s', (body, expected) => {
    expect(named(body)).toBe(expected);
  });

  it('does not credit anyone without a doctor named', () => {
    expect(named('عميل جديد نتابع معاه ان شاء الله')).toBeNull();
  });
  it('does not read a customer called doctor as a doctor', () => {
    expect(named('د بسنت صقر ٩٣٣٠ سوت النقاط')).toBeNull();
  });
  it('needs the full name for a first name two doctors share', () => {
    expect(named('د احمد طلب الروشته')).toBeNull();
    expect(named('د محمد عميل جديد')).toBeNull();
  });
  it('does not read a name without the doctor title', () => {
    expect(named('العميله رضا عنها كويس')).toBeNull();
  });
  it('leaves a message naming two doctors for the manager', () => {
    expect(named('د/ مغازي و د/ رضا اتابعوا معاها')).toBeNull();
  });
});
