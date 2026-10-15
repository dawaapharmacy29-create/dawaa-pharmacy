import { describe, expect, it, vi } from 'vitest';
import {
  buildInvoiceConfirmationDialogText,
  confirmInvoiceCandidate,
  confirmInvoiceCandidateAndRefresh,
  hasConfirmableInvoiceCandidate,
  INVOICE_LINK_CONFIRMATION_RPC,
} from '../invoiceLinkConfirmation';

describe('invoice link confirmation client contract', () => {
  it('offers confirmation only for a canonical source with an unconfirmed invoice candidate', () => {
    const candidate = {
      sourceId: 'source-2490',
      invoiceId: 'invoice-74880',
      invoiceNumber: '74880',
      sourceIsCanonical: true,
      alreadyConfirmed: false,
      alreadyProven: false,
    };
    expect(hasConfirmableInvoiceCandidate(candidate)).toBe(true);
    expect(hasConfirmableInvoiceCandidate({ ...candidate, invoiceId: null })).toBe(false);
    expect(hasConfirmableInvoiceCandidate({ ...candidate, sourceIsCanonical: false })).toBe(false);
    expect(hasConfirmableInvoiceCandidate({ ...candidate, alreadyConfirmed: true })).toBe(false);
    expect(hasConfirmableInvoiceCandidate({
      ...candidate,
      alreadyConfirmed: true,
      alreadyConfirmedInvoiceId: candidate.invoiceId,
    })).toBe(true);
    expect(hasConfirmableInvoiceCandidate({
      ...candidate,
      alreadyConfirmed: true,
      alreadyConfirmedInvoiceId: 'different-invoice',
    })).toBe(false);
    expect(hasConfirmableInvoiceCandidate({ ...candidate, alreadyProven: true })).toBe(false);
  });

  it.each([
    ['2490', '74880'],
    ['2490', '74966'],
  ])('sends only invoice-link confirmation inputs for customer %s invoice %s', async (customerCode, invoiceNumber) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, idempotent: false },
      error: null,
    });

    await expect(confirmInvoiceCandidate({ rpc }, {
      sourceId: `source-${customerCode}`,
      invoiceId: `invoice-${invoiceNumber}`,
      invoiceNumber,
      note: 'Reviewed candidate',
    })).resolves.toEqual({ idempotent: false });

    expect(rpc).toHaveBeenCalledWith(INVOICE_LINK_CONFIRMATION_RPC, {
      p_source_id: `source-${customerCode}`,
      p_invoice_id: `invoice-${invoiceNumber}`,
      p_invoice_number: invoiceNumber,
      p_confirmation_note: 'Reviewed candidate',
    });
    const rpcArgs = rpc.mock.calls[0][1];
    expect(rpcArgs).not.toHaveProperty('confirmed_by');
    expect(rpcArgs).not.toHaveProperty('confirmed_by_name');
    expect(rpcArgs).not.toHaveProperty('confirmed_at');
  });

  it('surfaces RPC failures and rejects success-shaped malformed responses', async () => {
    await expect(confirmInvoiceCandidate({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'review_source_out_of_scope' } }),
    }, { sourceId: 's', invoiceId: 'i', invoiceNumber: '1' })).rejects.toThrow('review_source_out_of_scope');

    await expect(confirmInvoiceCandidate({
      rpc: vi.fn().mockResolvedValue({ data: { idempotent: true }, error: null }),
    }, { sourceId: 's', invoiceId: 'i', invoiceNumber: '1' })).rejects.toThrow('invoice_link_confirmation_invalid_response');
  });

  it('builds an explicit confirmation dialog with invoice details and a deliberate prompt', () => {
    const text = buildInvoiceConfirmationDialogText({
      invoiceNumber: '74880',
      customer: 'الحاج محمود صالح (2490)',
      branch: 'فرع شكري',
      staff: 'د دنيا',
      datetime: '2026-09-27 20:32',
      total: '128 ج.م',
      confidence: '82٪',
      reason: 'تطابق العميل والوقت',
    });
    expect(text).toContain('الفاتورة: 74880');
    expect(text).toContain('العميل: الحاج محمود صالح (2490)');
    expect(text).toContain('تطابق العميل والوقت');
    expect(text).toContain('هل راجعت تطابق هذه الفاتورة مع الحالة');
  });

  it('only starts canonical reanalysis after the confirmation RPC succeeds', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, idempotent: false }, error: null });
    const refreshSource = vi.fn().mockResolvedValue({ status: 'allowed' });
    await expect(confirmInvoiceCandidateAndRefresh(
      { rpc },
      { sourceId: 'source-2490', invoiceId: 'invoice-74966', invoiceNumber: '74966' },
      refreshSource
    )).resolves.toEqual({
      confirmation: { idempotent: false },
      refresh: { status: 'allowed' },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(refreshSource).toHaveBeenCalledWith('source-2490');

    const failedRefresh = vi.fn();
    await expect(confirmInvoiceCandidateAndRefresh({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'denied' } }),
    }, { sourceId: 's', invoiceId: 'i', invoiceNumber: '1' }, failedRefresh)).rejects.toThrow('denied');
    expect(failedRefresh).not.toHaveBeenCalled();
  });

  it('preserves refresh failure for the UI and permits an idempotent retry of the same invoice', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, idempotent: true }, error: null });
    const refreshSource = vi.fn().mockResolvedValue({
      bySource: { 'source-2490': { status: 'failed', reason: 'network_error' } },
      errors: [{ sourceId: 'source-2490', message: 'network_error' }],
    });
    const result = await confirmInvoiceCandidateAndRefresh(
      { rpc },
      { sourceId: 'source-2490', invoiceId: 'invoice-74880', invoiceNumber: '74880' },
      refreshSource
    );
    expect(result.confirmation.idempotent).toBe(true);
    expect(result.refresh.errors[0].message).toBe('network_error');
    expect(hasConfirmableInvoiceCandidate({
      sourceId: 'source-2490',
      invoiceId: 'invoice-74880',
      invoiceNumber: '74880',
      sourceIsCanonical: true,
      alreadyConfirmed: true,
      alreadyConfirmedInvoiceId: 'invoice-74880',
      alreadyProven: false,
    })).toBe(true);
  });
});
