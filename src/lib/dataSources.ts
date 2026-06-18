export const CANONICAL_DATA_SOURCES = {
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
