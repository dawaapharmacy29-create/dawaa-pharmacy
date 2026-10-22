import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseInvoiceCard } from '../CaseInvoiceCard';
import { buildCaseInvoiceCard } from '@/lib/salesIntelligence/qa/caseInvoiceCard';

describe('CaseInvoiceCard (Arabic, read-only)', () => {
  it('renders the invoice header, the three verdicts and every line with its Arabic match state', () => {
    const card = buildCaseInvoiceCard({
      view: {
        products: [],
        customer: { customerId: null, customerCode: '18663', identityStatus: 'not_provided' },
        branch: { branchNameRaw: null },
        ownership: { contributions: [] },
        interaction: { startedAt: '2026-09-27T21:56:27Z', endedAt: null },
      } as any,
      attribution: {
        attributionLevel: 'weakly_inferred',
        selectedInvoiceId: 'inv-1',
        selectedInvoiceNumber: '74938',
      },
      automaticProofRule: false,
      humanLinkConfirmed: false,
      outcome: null,
      invoice: {
        id: 'inv-1',
        invoiceNumber: '74938',
        customerName: null,
        customerCode: '18663',
        customerId: null,
        branch: 'فرع شكري',
        staffName: 'د محمد شبل',
        invoiceDatetime: '2026-09-27T22:06:00Z',
        total: 849,
      },
      items: [
        {
          id: 'l1',
          lineNo: 1,
          productId: null,
          productCode: '16467',
          productName: 'RINGER SOLUTION INJECTION 500 ML.',
          quantity: 1,
          returnedQuantity: 0,
          effectiveQuantity: 1,
          unitName: 'علبة',
          unitPrice: 32,
          grossLineAmount: 32,
          itemDiscountAmount: 0,
          netLineAmount: 22.4,
        } as any,
      ],
      invoiceStaff: null,
      source: { branch: 'المخزن', customerId: null, customerCode: '18663' },
      analysisCustomerId: null,
    });
    const html = renderToStaticMarkup(createElement(CaseInvoiceCard, { card }));
    for (const text of [
      'رقم الفاتورة',
      '74938',
      'فرع المعاملة (من الفاتورة)',
      'فرع شكري',
      'فرع مصدر المحادثة',
      'المخزن',
      'هل الفاتورة تخص هذه الحالة؟',
      'مرشحة لهذه الحالة فقط',
      'موجود بالفاتورة فقط',
      'RINGER SOLUTION INJECTION 500 ML.',
      'توقيت القاهرة',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/invoice_only|weakly_inferred|undefined|NaN/);
  });
  it('explains in Arabic when the case has no invoice', () => {
    const card = buildCaseInvoiceCard({
      view: null,
      attribution: null,
      automaticProofRule: false,
      humanLinkConfirmed: false,
      outcome: null,
      invoice: null,
      items: [],
      invoiceStaff: null,
      source: null,
      analysisCustomerId: null,
    });
    expect(renderToStaticMarkup(createElement(CaseInvoiceCard, { card }))).toContain(
      'لا توجد فاتورة مرشحة أو مرتبطة بهذه الحالة.'
    );
  });
});
