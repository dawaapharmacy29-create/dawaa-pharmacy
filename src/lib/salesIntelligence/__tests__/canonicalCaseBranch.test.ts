import { describe, expect, it } from 'vitest';
import {
  canonicalCaseBranchFromRecommendation,
  linkSiblingServiceCaseBranches,
  type CaseBranchLinkInput,
} from '../canonicalCaseBranch';

const unresolved = {
  branch: null,
  decided: false,
  basis: 'unresolved' as const,
  linkedCaseId: null,
  linkedInvoiceId: null,
  reasons: ['دليل واحد فقط؛ غير كافٍ لحسم الفرع'],
};
const proven = {
  branch: 'فرع شكري',
  decided: true,
  basis: 'proven_invoice' as const,
  linkedCaseId: null,
  linkedInvoiceId: 'inv-1',
  reasons: ['فرع فاتورة مرتبطة ومثبتة لهذه الحالة'],
};

const sale = (over: Partial<CaseBranchLinkInput> = {}): CaseBranchLinkInput => ({
  caseId: 'src:interaction:0:session:2',
  caseType: 'sales_opportunity',
  department: 'pharmacy',
  customerId: 'cust-1',
  customerResolved: true,
  startedAt: '2026-09-27T21:56:27Z',
  endedAt: '2026-09-27T22:28:43Z',
  coarseSessionIndexes: [2],
  pharmacistOwnerIds: ['shebl'],
  ownerIds: ['shebl'],
  suggestedStaffBranch: 'فرع شكري',
  ownSelectedInvoiceId: 'inv-1',
  provenInvoice: { invoiceId: 'inv-1', branch: 'فرع شكري' },
  caseBranch: proven,
  ...over,
});
const nursing = (over: Partial<CaseBranchLinkInput> = {}): CaseBranchLinkInput => ({
  caseId: 'src:interaction:1:session:2',
  caseType: 'follow_up',
  department: 'pharmacy',
  customerId: 'cust-1',
  customerResolved: true,
  startedAt: '2026-09-27T23:17:35Z',
  endedAt: '2026-09-28T01:08:40Z',
  coarseSessionIndexes: [2],
  pharmacistOwnerIds: ['shebl'],
  ownerIds: ['shebl'],
  suggestedStaffBranch: 'فرع شكري',
  ownSelectedInvoiceId: null,
  provenInvoice: null,
  caseBranch: unresolved,
  ...over,
});
const service = (over: Partial<CaseBranchLinkInput> = {}): CaseBranchLinkInput => ({
  ...nursing(),
  caseId: 'src:interaction:0:session:0',
  caseType: 'information_only',
  department: 'customer_service',
  startedAt: '2026-09-27T07:54:07Z',
  coarseSessionIndexes: [0],
  pharmacistOwnerIds: [],
  ownerIds: ['heba'],
  suggestedStaffBranch: null,
  caseBranch: {
    ...unresolved,
    basis: 'customer_service',
    reasons: ['حالة خدمة عملاء؛ لا تُنسب لفرع بيع'],
  },
  ...over,
});
const branchOf = (cases: CaseBranchLinkInput[], id: string) =>
  linkSiblingServiceCaseBranches(cases).get(id)!;
const lastReason = (cases: CaseBranchLinkInput[], id: string) => branchOf(cases, id).reasons.at(-1);

describe('linkSiblingServiceCaseBranches', () => {
  it('1. links the nursing case to the operation branch of the one proven sale case', () => {
    const result = branchOf([service(), sale(), nursing()], nursing().caseId);
    expect(result).toMatchObject({
      branch: 'فرع شكري',
      decided: true,
      basis: 'linked_sale_case',
      linkedCaseId: sale().caseId,
      linkedInvoiceId: 'inv-1',
    });
  });

  it('2. never moves the branch to a customer-service case, even with the same customer and session', () => {
    const cases = [
      service({ coarseSessionIndexes: [2], startedAt: '2026-09-27T23:00:00Z' }),
      sale(),
      nursing(),
    ];
    expect(branchOf(cases, service().caseId)).toMatchObject({
      branch: null,
      decided: false,
      basis: 'customer_service',
    });
    // A pharmacy information-only case is not a service follow-up either.
    expect(
      branchOf([sale(), nursing({ caseType: 'information_only' })], nursing().caseId).decided
    ).toBe(false);
  });

  it('3. a different or unresolved customer, a different doctor or another conversation moves nothing', () => {
    expect(lastReason([sale(), nursing({ customerId: 'cust-2' })], nursing().caseId)).toMatch(
      /هوية العميل غير محسومة أو مختلفة/
    );
    expect(lastReason([sale(), nursing({ customerResolved: false })], nursing().caseId)).toMatch(
      /هوية العميل/
    );
    expect(
      lastReason(
        [sale(), nursing({ pharmacistOwnerIds: ['omar'], ownerIds: ['omar'] })],
        nursing().caseId
      )
    ).toMatch(/لا يوجد دكتور مسؤول محسوم مشترك/);
    expect(
      lastReason([sale(), nursing({ pharmacistOwnerIds: [], ownerIds: [] })], nursing().caseId)
    ).toMatch(/لا يوجد دكتور مسؤول/);
    expect(
      lastReason([sale(), nursing({ ownerIds: ['shebl', 'heba'] })], nursing().caseId)
    ).toMatch(/لا يوجد دكتور مسؤول/);
    // The pass sees ONE conversation: a proven sale of another source is simply not an input.
    expect(branchOf([nursing()], nursing().caseId)).toEqual(unresolved);
    // Not the same raw session, or before the order: no direct temporal link.
    expect(lastReason([sale(), nursing({ coarseSessionIndexes: [3] })], nursing().caseId)).toMatch(
      /لا يوجد ارتباط زمني مباشر/
    );
    expect(
      lastReason([sale(), nursing({ startedAt: '2026-09-27T20:00:00Z' })], nursing().caseId)
    ).toMatch(/لا يوجد ارتباط زمني مباشر/);
  });

  it('4. two proven sale cases, a competing invoice, a conflicting doctor branch or an explicit conflict stay unresolved', () => {
    const second = sale({
      caseId: 'src:interaction:2:session:2',
      ownSelectedInvoiceId: 'inv-2',
      provenInvoice: { invoiceId: 'inv-2', branch: 'فرع الشامي' },
    });
    expect(lastReason([sale(), second, nursing()], nursing().caseId)).toMatch(
      /أكثر من حالة بيع بفاتورة مثبتة/
    );
    expect(
      lastReason([sale(), nursing({ ownSelectedInvoiceId: 'inv-9' })], nursing().caseId)
    ).toMatch(/فاتورة مرشحة أخرى/);
    expect(
      lastReason([sale(), nursing({ suggestedStaffBranch: 'فرع الشامي' })], nursing().caseId)
    ).toMatch(/فرع الدكتور \(فرع الشامي\) يخالف/);
    const conflict = {
      ...unresolved,
      basis: 'conflict' as const,
      reasons: ['تعارض بين تعريف الموظف وفرع المصدر'],
    };
    expect(branchOf([sale(), nursing({ caseBranch: conflict })], nursing().caseId)).toEqual(
      conflict
    );
  });

  it('5. without a proven sale (weak or unproven invoice) there is nothing to inherit', () => {
    const weak = sale({ caseBranch: { ...unresolved }, provenInvoice: null });
    expect(branchOf([weak, nursing()], nursing().caseId)).toEqual(unresolved);
    // A non-operating invoice branch never becomes an operation branch.
    expect(
      lastReason(
        [sale({ provenInvoice: { invoiceId: 'inv-1', branch: 'المخزن' } }), nursing()],
        nursing().caseId
      )
    ).toMatch(/ليس فرع تشغيل/);
  });

  it('a case that already has its own decided branch keeps it', () => {
    const explicit = {
      ...proven,
      basis: 'explicit_introduction' as const,
      branch: 'فرع الشامي',
      linkedInvoiceId: null,
    };
    expect(branchOf([sale(), nursing({ caseBranch: explicit })], nursing().caseId)).toEqual(
      explicit
    );
  });
});

describe('canonicalCaseBranchFromRecommendation', () => {
  const ownership = (o: Record<string, unknown> = {}) =>
    ({ department: 'pharmacy', operationalBranch: null, branchBasis: 'none', ...o }) as any;
  it('names the basis of a decided branch and never decides customer service or a conflict', () => {
    const decided = { branch: 'فرع شكري', strength: 'decided' as const, reasons: ['x'] };
    expect(
      canonicalCaseBranchFromRecommendation({
        recommendation: decided,
        ownership: ownership(),
        provenInvoiceId: 'inv-1',
      })
    ).toMatchObject({ basis: 'proven_invoice', linkedInvoiceId: 'inv-1', decided: true });
    expect(
      canonicalCaseBranchFromRecommendation({
        recommendation: decided,
        ownership: ownership({
          operationalBranch: 'فرع شكري',
          branchBasis: 'explicit_introduction',
        }),
        provenInvoiceId: null,
      }).basis
    ).toBe('explicit_introduction');
    expect(
      canonicalCaseBranchFromRecommendation({
        recommendation: decided,
        ownership: ownership({ operationalBranch: 'فرع شكري', branchBasis: 'source' }),
        provenInvoiceId: null,
      }).basis
    ).toBe('operating_source');
    expect(
      canonicalCaseBranchFromRecommendation({
        recommendation: decided,
        ownership: ownership({ department: 'customer_service' }),
        provenInvoiceId: null,
      })
    ).toMatchObject({ basis: 'customer_service', branch: null, decided: false });
    expect(
      canonicalCaseBranchFromRecommendation({
        recommendation: { branch: null, strength: 'conflict', reasons: ['y'] },
        ownership: ownership(),
        provenInvoiceId: null,
      }).basis
    ).toBe('conflict');
    // A supporting signal (doctor home branch alone) is never a decided branch.
    expect(
      canonicalCaseBranchFromRecommendation({
        recommendation: { branch: 'فرع شكري', strength: 'supporting_only', reasons: ['z'] },
        ownership: ownership(),
        provenInvoiceId: null,
      })
    ).toMatchObject({ branch: null, decided: false, basis: 'unresolved' });
  });
});
