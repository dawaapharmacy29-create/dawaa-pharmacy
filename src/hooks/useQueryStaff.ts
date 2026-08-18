/**
 * useQueryStaff.ts
 * TanStack React Query wrapper for staff data.
 *
 * USAGE: Prefer this over useStaff() for pages that don't need realtime.
 * Benefits: automatic cache sharing, background refetch, no redundant DB calls.
 *
 * Example:
 *   const { data: staff, isLoading } = useQueryStaff();
 */

import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { TABLES } from '@/lib/supabaseTables';
import { QUERY_KEYS } from '@/lib/queryKeys';

async function fetchActiveStaff() {
  if (!isSupabaseConfigured) return [];

  const filters = isActiveStaffFilter();
  let query = supabase
    .from(TABLES.staff)
    .select('id,name,username,role,branch,phone,active,created_at,updated_at')
    .order('name', { ascending: true });

  for (const f of filters) {
    if (f.operator === 'eq') query = query.eq(f.column, f.value as string);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[useQueryStaff] fetch error:', error.message);
    return [];
  }
  return (data ?? []).map((staff) => ({
    ...staff,
    name: staff.name ?? staff.username ?? 'غير محدد',
  }));
}

export const STAFF_QUERY_KEY = QUERY_KEYS.staff.active;

export function useQueryStaff(options?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: STAFF_QUERY_KEY,
    queryFn: fetchActiveStaff,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: isSupabaseConfigured,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      if (error instanceof Error && /timed out|network|failed to fetch/i.test(error.message)) {
        return failureCount < 1;
      }
      return false;
    },
  });
}
