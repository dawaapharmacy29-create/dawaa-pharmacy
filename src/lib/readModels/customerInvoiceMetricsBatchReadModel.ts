export type CustomerInvoiceMetricsBatchRow = {
  customerCode: string;
  invoicesCount: number;
  totalSpent: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  activeMonths: number;
};

/**
 * Compatibility shim for the legacy customer-list patch path.
 *
 * Customer list metrics now come from dawAA_customer_metrics_app_view / customer_metrics_summary,
 * which is refreshed incrementally from the canonical operational invoice truth on every affected
 * INSERT/UPDATE/DELETE statement. Re-querying invoice aggregates for every rendered customer page
 * duplicated database work and, historically, the caller merged values with Math.max(), which could
 * hide legitimate downward corrections after returns.
 *
 * Keep the exported function temporarily so older callers remain source-compatible while returning
 * no patch rows. The caller therefore keeps the canonical summary values unchanged and performs no
 * additional network request. Once the large customers API module is split, this shim can be removed
 * together with its legacy patch function/import.
 */
export async function fetchCustomerInvoiceMetricsBatch(
  _customerCodes: string[]
): Promise<CustomerInvoiceMetricsBatchRow[]> {
  return [];
}
