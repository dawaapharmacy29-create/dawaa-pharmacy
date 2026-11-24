import { describe, expect, it } from 'vitest';
import { invoiceTimingVerdict } from '@/lib/whatsappUnifiedIntelligenceV4';

// Conversation on 22 Nov 2026, 14:00–14:30 Cairo (UTC+2).
const session = {
  startedAt: new Date('2026-11-22T12:00:00Z'),
  endedAt: new Date('2026-11-22T12:30:00Z'),
};

describe('invoice must follow the conversation', () => {
  it('rejects an invoice issued days before the chat', () => {
    expect(invoiceTimingVerdict({ invoice_datetime: '2026-11-17T10:00:00Z' }, session)).toBe('before_chat');
    expect(invoiceTimingVerdict({ invoice_datetime: '2026-11-22T08:00:00Z' }, session)).toBe('before_chat');
  });

  it('accepts an invoice during, right after, or within three days', () => {
    expect(invoiceTimingVerdict({ invoice_datetime: '2026-11-22T11:00:00Z' }, session)).toBe('ok');
    expect(invoiceTimingVerdict({ invoice_datetime: '2026-11-22T13:15:00Z' }, session)).toBe('ok');
    expect(invoiceTimingVerdict({ invoice_datetime: '2026-11-25T10:00:00Z' }, session)).toBe('ok');
  });

  it('rejects an invoice more than three days after the chat', () => {
    expect(invoiceTimingVerdict({ invoice_datetime: '2026-11-26T18:00:00Z' }, session)).toBe('too_late');
  });

  it('compares a bare invoice day by Cairo calendar day, not as midnight', () => {
    expect(invoiceTimingVerdict({ sale_date: '2026-11-22' }, session)).toBe('ok');
    expect(invoiceTimingVerdict({ invoice_date: '2026-11-21T22:00:00Z' }, session)).toBe('ok'); // 00:00 Cairo on the 22nd
    expect(invoiceTimingVerdict({ sale_date: '2026-11-21' }, session)).toBe('before_chat');
    expect(invoiceTimingVerdict({ sale_date: '2026-11-25' }, session)).toBe('ok');
    expect(invoiceTimingVerdict({ sale_date: '2026-11-26' }, session)).toBe('too_late');
  });

  it('leaves an invoice without a date to the scoring', () => {
    expect(invoiceTimingVerdict({}, session)).toBe('unknown');
  });
});
