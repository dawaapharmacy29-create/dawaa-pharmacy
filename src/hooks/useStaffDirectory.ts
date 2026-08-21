import { useQuery } from '@tanstack/react-query';
import { readStaffDirectory, type StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import { QUERY_FRESHNESS } from '@/lib/queryPolicy';

export const STAFF_DIRECTORY_QUERY_KEY = ['staff-directory'] as const;

/**
 * Canonical UI hook for staff directory reads.
 * Pages/components must not query the physical `staff` table directly.
 */
export function useStaffDirectory() {
  return useQuery<StaffDirectoryIdentity[]>({
    queryKey: STAFF_DIRECTORY_QUERY_KEY,
    queryFn: readStaffDirectory,
    staleTime: QUERY_FRESHNESS.standard.staleTime,
    gcTime: QUERY_FRESHNESS.standard.gcTime,
    refetchOnMount: QUERY_FRESHNESS.standard.refetchOnMount,
    refetchOnReconnect: QUERY_FRESHNESS.standard.refetchOnReconnect,
    refetchOnWindowFocus: QUERY_FRESHNESS.standard.refetchOnWindowFocus,
  });
}
