import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readCustomerInvoicesMock } = vi.hoisted(() => ({
  readCustomerInvoicesMock: vi.fn(),
}));

vi.mock('@/lib/readModels/customerInvoiceReadModel', () => ({
  readCustomerInvoices: readCustomerInvoicesMock,
}));

import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';

function session(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions).toHaveLength(1);
  return sessions[0];
}

const baseSession = () =>
  session(`[9/15/26, 9:00:00 AM] Customer: محتاج فيتامين د
[9/15/26, 9:01:00 AM] You: موجود يا فندم
[9/15/26, 9:02:00 AM] Customer: تمام ابعته`);

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoice_number: '73001',
    invoice_date: '2026-09-15T09:30:00.000Z',
    branch: 'فرع شكري',
    customer_id: 'customer-1',
    customer_code: '4250',
    customer_phone: '01000000000',
    customer_name: 'Customer',
    net_total: 250,
    __matched_identity_strategies: ['customer_id', 'code', 'phone'],
    ...overrides,
  };
}

describe('WhatsApp V4 invoice verification safety', () => {
  beforeEach(() => {
    readCustomerInvoicesMock.mockReset();
  });

  it('counts multiple identity strategies only once, so identity+time+branch alone is probable not verified', async () => {
    readCustomerInvoicesMock.mockResolvedValue({
      rows: [invoice()],
      matchedBy: 'mixed',
      matchedStrategies: ['customer_id', 'code', 'phone'],
      source: 'sales_invoices_adapter',
      warnings: [],
    });

    const result = await verifySessionAgainstInvoices(baseSession(), {
      customerId: 'customer-1',
      customerCode: '4250',
      customerPhone: '01000000000',
      branch: 'فرع شكري',
    });

    expect(result.status).toBe('probable');
    expect(result.bestCandidate?.score).toBe(84);
    expect(result.bestCandidate?.matchedIdentityStrategies).toEqual(['customer_id', 'code', 'phone']);
  });

  it('allows verified only when stronger direct invoice evidence is present', async () => {
    readCustomerInvoicesMock.mockResolvedValue({
      rows: [invoice({ invoice_number: '73001' })],
      matchedBy: 'customer_id',
      matchedStrategies: ['customer_id'],
      source: 'sales_invoices_adapter',
      warnings: [],
    });

    const s = session(`[9/15/26, 9:00:00 AM] Customer: محتاج فيتامين د
[9/15/26, 9:01:00 AM] You: موجود وفاتورة 73001 يا فندم
[9/15/26, 9:02:00 AM] Customer: تمام ابعته`);

    const result = await verifySessionAgainstInvoices(s, {
      customerId: 'customer-1',
      customerCode: '4250',
      branch: 'فرع شكري',
    });

    expect(result.status).toBe('verified');
    expect(result.bestCandidate?.reasons).toContain('رقم الفاتورة مذكور بالشات');
  });

  it('forces human review when two different invoices are almost tied', async () => {
    readCustomerInvoicesMock.mockResolvedValue({
      rows: [
        invoice({ id: 'inv-1', invoice_number: '73001', invoice_date: '2026-09-15T09:30:00.000Z' }),
        invoice({ id: 'inv-2', invoice_number: '73002', invoice_date: '2026-09-15T09:35:00.000Z' }),
      ],
      matchedBy: 'customer_id',
      matchedStrategies: ['customer_id'],
      source: 'sales_invoices_adapter',
      warnings: [],
    });

    const result = await verifySessionAgainstInvoices(baseSession(), {
      customerId: 'customer-1',
      customerCode: '4250',
      branch: 'فرع شكري',
    });

    expect(result.status).toBe('needs_review');
    expect(result.reason).toContain('أكثر من فاتورة');
    expect(result.warnings).toContain('ambiguous_top_invoice_candidates');
  });

  it('treats an invoice created during a long conversation as the strongest timing evidence', async () => {
    readCustomerInvoicesMock.mockResolvedValue({
      rows: [
        invoice({ id: 'during', invoice_number: '68466', invoice_date: '2026-08-20T08:27:00.000Z' }),
        invoice({ id: 'later', invoice_number: '68812', invoice_date: '2026-08-22T08:10:00.000Z' }),
      ],
      matchedBy: 'customer_id',
      matchedStrategies: ['customer_id'],
      source: 'sales_invoices_adapter',
      warnings: [],
    });

    const longSession = session(`[8/19/26, 8:37:51 PM] Customer: محتاج المنتج
[8/20/26, 8:09:54 PM] You: موجود يا فندم`);

    const result = await verifySessionAgainstInvoices(longSession, {
      customerId: 'customer-1',
      customerCode: '4250',
      branch: 'فرع شكري',
    });

    expect(result.bestCandidate?.invoiceId).toBe('during');
    expect(result.bestCandidate?.reasons).toContain('الفاتورة تمت أثناء المحادثة');
  });

  it('does not keep a customer invoice as a candidate when it is outside the seven-day window', async () => {
    readCustomerInvoicesMock.mockResolvedValue({
      rows: [invoice({ invoice_date: '2026-10-01T09:30:00.000Z' })],
      matchedBy: 'customer_id',
      matchedStrategies: ['customer_id'],
      source: 'sales_invoices_adapter',
      warnings: [],
    });

    const result = await verifySessionAgainstInvoices(baseSession(), {
      customerId: 'customer-1',
      customerCode: '4250',
      branch: 'فرع شكري',
    });

    expect(result.status).toBe('not_found');
    expect(result.bestCandidate).toBeNull();
  });
});
