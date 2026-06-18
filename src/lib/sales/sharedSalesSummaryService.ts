import {
  clearSalesAnalyticsSummaryCache,
  loadSalesAnalyticsSummary,
  type SalesAnalyticsFilters,
  type SalesAnalyticsSummary,
} from '@/lib/salesAnalyticsSummaryService';

export type SharedSalesSummary = SalesAnalyticsSummary;

export async function getSharedSalesSummary(filters: SalesAnalyticsFilters, forceRefresh = false) {
  return loadSalesAnalyticsSummary(filters, forceRefresh);
}

export function clearSharedSalesCaches() {
  clearSalesAnalyticsSummaryCache();
}
