import { describe, expect, it } from 'vitest';
import { fetchCustomerInvoiceMetricsBatch } from '@/lib/readModels/customerInvoiceMetricsBatchReadModel';

describe('customer downward correction guard', () => {
  it('keeps the legacy invoice patch path inert so summary totals can decrease', async () => {
    const rows = await fetchCustomerInvoiceMetricsBatch(['1001', '1002']);

    expect(rows.length).toBe(0);
  });
});
