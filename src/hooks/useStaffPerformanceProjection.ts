import { useQuery } from '@tanstack/react-query';
import {
  readStaffPerformanceProjection,
  type StaffPerformanceProjectionRow,
} from '@/lib/readModels/staffPerformanceProjection';

export const STAFF_PERFORMANCE_PROJECTION_QUERY_KEY = ['staff-performance-projection'] as const;

const STANDARD_STALE_MS = 2 * 60_000;
const STANDARD_GC_MS = 15 * 60_000;

/**
 * Canonical UI hook for staff rows that need points/max_points.
 *
 * Identity-only pages should keep using useStaffDirectory(). This hook exists so
 * performance pages do not query the physical staff table directly just to retain
 * points/max_points and branch metadata.
 */
export function useStaffPerformanceProjection() {
  return useQuery<StaffPerformanceProjectionRow[], Error>({
    queryKey: STAFF_PERFORMANCE_PROJECTION_QUERY_KEY,
    queryFn: readStaffPerformanceProjection,
    staleTime: STANDARD_STALE_MS,
    gcTime: STANDARD_GC_MS,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
}
