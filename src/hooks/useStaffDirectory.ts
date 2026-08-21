import { useQuery } from '@tanstack/react-query';
import { readStaffDirectory, type StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

export const STAFF_DIRECTORY_QUERY_KEY = ['staff-directory'] as const;

// Keep aligned with the current `standard` freshness class in useSupabaseQuery.
const STANDARD_STALE_MS = 2 * 60_000;
const STANDARD_GC_MS = 15 * 60_000;

/**
 * Canonical UI hook for staff directory reads.
 * Pages/components must not query the physical `staff` table directly.
 */
export function useStaffDirectory() {
  return useQuery<StaffDirectoryIdentity[]>({
    queryKey: STAFF_DIRECTORY_QUERY_KEY,
    queryFn: readStaffDirectory,
    staleTime: STANDARD_STALE_MS,
    gcTime: STANDARD_GC_MS,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
}
