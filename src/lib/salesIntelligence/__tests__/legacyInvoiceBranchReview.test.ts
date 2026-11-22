import { describe, expect, it, vi } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';

import { readCustomerInvoices } from '@/lib/readModels/customerInvoiceReadModel';

vi.mock('@/lib/readModels/customerInvoiceReadModel', () => ({ readCustomerInvoices: vi.fn() }));

function oneSession(raw: string) {
  const messages = parseWhatsAppExport(raw);
  const sessions = splitWhatsAppSessions(messages, 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

describe('Preliminary WhatsApp invoice review', () => {
  it('keeps a high-scoring cross-branch invoice in review', async () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: فيتامين د متوفر؟ ابعته لو سمحت
[9/15/26, 9:01:00 AM] You: تم تأكيد الطلب، 250 جنيه`);
    vi.mocked(readCustomerInvoices).mockResolvedValue({
      rows: [{
        id: 'invoice-1',
        invoice_date: session.endedAt.toISOString(),
        branch: 'فرع الشامي',
        customer_code: '866',
        net_total: 250,
      }],
      matchedStrategies: ['customer_id', 'code', 'phone'],
      warnings: [],
    } as Awaited<ReturnType<typeof readCustomerInvoices>>);

    const conflicting = await verifySessionAgainstInvoices(session, { customerCode: '866', branch: 'فرع شكري' });
    expect(conflicting.verificationConfidence).toBeGreaterThanOrEqual(0.82);
    expect(conflicting.status).toBe('needs_review');
    expect(conflicting.bestCandidate?.invoiceId).toBe('invoice-1');
    expect(conflicting.revenue).toBeNull();

    const compatible = await verifySessionAgainstInvoices(session, { customerCode: '866', branch: 'الشامي' });
    expect(compatible.status).toBe('verified');
  });
});
