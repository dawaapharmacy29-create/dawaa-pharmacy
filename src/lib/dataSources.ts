export const TRANSACTIONAL_DATA_SOURCES = {
  customerSales: 'sales_invoices',
  customerBasics: 'customers',
  customerNotes: 'customers',
  followups: ['daily_followups', 'customer_followups'],
  customerRequests: ['customer_requests', 'customer_request_events'],
  pointsLedger: 'employee_transactions',
  conversationReviews: 'conversation_sales_reviews',
  stagnantMedicines: ['stagnant_medicines', 'stagnant_medicine_dispenses'],
  incentiveMedicines: 'incentive_medicines',
  delivery: 'delivery_orders',
} as const;

export const ANALYTICS_DATA_SOURCES = {
  salesInvoices: 'dawaa_sales_invoices_dashboard_v1',
} as const;

/**
 * Backwards-compatible alias while call sites migrate to the explicit
 * transactional/read contracts above. New analytics code should use
 * ANALYTICS_DATA_SOURCES and the shared sales truth reader, not direct
 * `sales_invoices` queries.
 */
export const CANONICAL_DATA_SOURCES = TRANSACTIONAL_DATA_SOURCES;

export function isLegacySalesCache(table: string) {
  return ['customer_analysis'].includes(table);
}

export function isLegacyPointsTable(table: string) {
  return [
    'point_records',
    'points_transactions',
    'points_log',
    'archive_point_records',
    'archive_points_transactions',
    'archive_points_log',
  ].includes(table);
}
