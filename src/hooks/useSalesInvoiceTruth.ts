import { useQuery } from '@tanstack/react-query';
import {
  fetchSalesInvoicesPagedSafe,
  type SalesInvoiceQueryRow,
} from '@/lib/salesInvoiceQueries';

export type SalesInvoiceTruthOptions = {
  startDate: string;
  endDate: string;
  branch?: string;
  enabled?: boolean;
};

/**
 * Canonical UI boundary for bounded sales-invoice reads.
 *
 * Keeps pages off the physical sales_invoices table and routes them through the
 * dashboard sales-truth view, paging/cache/fallback policy owned by
 * salesInvoiceQueries.
 */
export function useSalesInvoiceTruth<T extends SalesInvoiceQueryRow = SalesInvoiceQueryRow>(
  options: SalesInvoiceTruthOptions
) {
  const startDate = String(options.startDate || '').slice(0, 10);
  const endDate = String(options.endDate || '').slice(0, 10);
  const branch = String(options.branch || 'كل الفروع').trim() || 'كل الفروع';
  const enabled = options.enabled !== false && Boolean(startDate && endDate && startDate <= endDate);

  const query = useQuery<SalesInvoiceQueryRow[], Error>({
    queryKey: ['sales-invoice-truth', startDate, endDate, branch],
    enabled,
    queryFn: () =>
      fetchSalesInvoicesPagedSafe({
        startDate,
        endDate,
        branch,
        pageSize: 1000,
        maxPages: 50,
      }),
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });

  return {
    data: (query.data || []) as T[],
    loading: query.isLoading || query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
