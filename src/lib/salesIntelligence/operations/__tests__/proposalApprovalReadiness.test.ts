import { describe, expect, it } from 'vitest';
import { customerRequestApprovalBlockers } from '../proposalApprovalReadiness';

const source = { customerId: 'c1', staffId: 's1', branch: 'فرع شكري' };
const complete = { customerId: 'c1', productId: 'p1', productCode: '28784', staffId: 's1', branch: 'فرع شكري', confidence: 90 };

describe('customer request approval readiness (display aid)', () => {
  it('lets a complete, consistent proposal be submitted to the database check', () => {
    expect(customerRequestApprovalBlockers(complete, source)).toEqual([]);
  });

  it('explains the live 5728c227 shape: account-wide branch only', () => {
    const live = { ...complete, staffId: 'gm', confidence: 80, branch: 'كل الفروع' };
    expect(customerRequestApprovalBlockers(live, { customerId: 'c1', staffId: 'gm', branch: 'كل الفروع' }))
      .toEqual(['فرع العملية ليس فرع تشغيل معتمد']);
  });

  it('lists every reason for the common legacy shape (no product, no doctor)', () => {
    expect(customerRequestApprovalBlockers({ ...complete, productId: null, productCode: null, staffId: null, confidence: 90 }, source))
      .toEqual(['الصنف غير مربوط بالكتالوج', 'الدكتور المسؤول غير محسوم']);
  });

  it('flags low confidence, missing code, identity mismatches and a missing source', () => {
    expect(customerRequestApprovalBlockers({ ...complete, confidence: 79, productCode: ' ' }, source))
      .toEqual(['كود الصنف غير موجود', 'ثقة الاقتراح أقل من 80%']);
    expect(customerRequestApprovalBlockers({ ...complete, customerId: 'c2', staffId: 's2', branch: 'فرع الشامي' }, source))
      .toEqual(['العميل على الاقتراح يختلف عن عميل المصدر', 'الدكتور على الاقتراح يختلف عن دكتور المصدر', 'فرع الاقتراح يختلف عن فرع المصدر']);
    expect(customerRequestApprovalBlockers(complete, null)).toEqual(['بيانات المصدر غير متاحة للمراجعة']);
  });
});
