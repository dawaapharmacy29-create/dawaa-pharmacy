import { describe, expect, it } from 'vitest';
import { selectInvoiceChangeImpact, type InvoiceImpactCase, type InvoiceImpactIdentity } from '../invoiceChangeImpact';

const invoice = (overrides: Partial<InvoiceImpactIdentity> = {}): InvoiceImpactIdentity => ({
  invoiceId: 'invoice-1', invoiceAt: '2026-11-25T12:00:00Z', customerId: 'customer-1', ...overrides,
});
const conversation = (overrides: Partial<InvoiceImpactCase> = {}): InvoiceImpactCase => ({
  sourceId: 'source-1', active: true, deleted: false, startedAt: '2026-11-24T12:00:00Z',
  endedAt: '2026-11-24T13:00:00Z', customerId: 'customer-1', ...overrides,
});

describe('Selective invoice evidence impact', () => {
  it('selects a new invoice for a matching customer and bounded case window', () => {
    expect(selectInvoiceChangeImpact([{before:null,after:invoice()}], [
      conversation(), conversation({sourceId:'unrelated',customerId:'customer-2'}),
      conversation({sourceId:'old',startedAt:'2026-10-01T12:00:00Z',endedAt:'2026-10-01T13:00:00Z'}),
    ])).toEqual(['source-1']);
  });
  it('keeps direct dependencies on deletion even when identity and date no longer match', () => {
    expect(selectInvoiceChangeImpact([{before:invoice(),after:null}], [
      conversation({customerId:'other',startedAt:null,endedAt:null,selectedInvoiceId:'invoice-1'}),
    ])).toEqual(['source-1']);
  });
  it('checks both old and corrected identities', () => {
    expect(selectInvoiceChangeImpact([{before:invoice(),after:invoice({customerId:'customer-2'})}], [
      conversation(),conversation({sourceId:'source-2',customerId:'customer-2'}),
    ])).toEqual(['source-1','source-2']);
  });
  it('deduplicates repeated changes and excludes retired or deleted cases', () => {
    const change = {before:null,after:invoice()};
    expect(selectInvoiceChangeImpact([change,change], [
      conversation(),conversation(),conversation({sourceId:'retired',active:false}),
      conversation({sourceId:'deleted',deleted:true,selectedInvoiceId:'invoice-1'}),
    ])).toEqual(['source-1']);
  });
  it('recognizes normalized Egyptian phone and spreadsheet customer code', () => {
    expect(selectInvoiceChangeImpact([{before:null,after:invoice({customerId:null,customerCode:'17777.0',whatsappPhone:'+201001234567'})}], [
      conversation({customerId:null,customerPhone:'01001234567'}),
      conversation({sourceId:'source-2',customerId:null,customerCode:'17777'}),
      conversation({sourceId:'invalid',customerId:null,customerPhone:'123'}),
    ])).toEqual(['source-1','source-2']);
  });
  it('does not select by empty identity or invalid date', () => {
    expect(selectInvoiceChangeImpact([{before:null,after:invoice({customerId:null,invoiceAt:null})}], [
      conversation({customerId:null,customerCode:null,customerPhone:null}),
    ])).toEqual([]);
  });
  it('includes the exact window boundaries and excludes the next second', () => {
    const c = conversation({startedAt:'2026-11-10T12:00:00Z',endedAt:'2026-11-10T13:00:00Z'});
    for (const at of ['2026-11-09T12:00:00Z','2026-11-17T13:00:00Z']) {
      expect(selectInvoiceChangeImpact([{before:null,after:invoice({invoiceAt:at})}],[c])).toEqual(['source-1']);
    }
    expect(selectInvoiceChangeImpact([{before:null,after:invoice({invoiceAt:'2026-11-17T13:00:01Z'})}],[c])).toEqual([]);
  });
});
