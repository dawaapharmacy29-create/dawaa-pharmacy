export const SALES_DATA_SOURCES = {
  /** Canonical persisted transaction table. Imports and write-side integrity operate here. */
  transactions: 'sales_invoices',
  /** Canonical read model for dashboards/analytics. UI analytics should migrate here. */
  analytics: 'dawaa_sales_invoices_dashboard_v1',
} as const;

export const CANONICAL_DATA_SOURCES = {
  // Backward-compatible alias for modules that need raw customer transactions.
  // Do not use this alias for new dashboard/analytics reads.
  customerSales: SALES_DATA_SOURCES.transactions,
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
