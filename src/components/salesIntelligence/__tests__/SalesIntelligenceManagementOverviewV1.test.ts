import { describe, expect, it } from 'vitest';
import { countConfirmedSales } from '../SalesIntelligenceManagementOverviewV1';
import type { QaCaseListRow } from '@/lib/salesIntelligence/qa/types';

function row(
  outcome: NonNullable<QaCaseListRow['canonicalSalesOutcome']>['outcome'],
  isSaleCountable: boolean,
  saleProofState: QaCaseListRow['saleProofState'] = 'proven',
  selectedInvoiceId: string | null = null
): Pick<QaCaseListRow, 'canonicalSalesOutcome' | 'saleProofState' | 'selectedInvoiceId'> {
  return {
    canonicalSalesOutcome: { outcome, isSaleCountable },
    saleProofState,
    selectedInvoiceId,
  };
}

describe('management overview confirmed-sale KPI', () => {
  it('does not count proven invoice attribution while the canonical outcome needs review', () => {
    expect(countConfirmedSales([row('needs_review', false)])).toBe(0);
  });

  it('counts a canonical sale_proven outcome only when it is countable', () => {
    expect(countConfirmedSales([row('sale_proven', true)])).toBe(1);
  });

  it('does not count strong evidence without a canonical proven sale', () => {
    expect(countConfirmedSales([row('order_confirmed_unproven', false, 'strongly_supported')])).toBe(0);
  });

  it('does not count an invoice candidate when the conversation outcome is not countable', () => {
    expect(countConfirmedSales([row('needs_review', false, 'proven', 'invoice-1')])).toBe(0);
  });
});
