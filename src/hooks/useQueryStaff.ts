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

export const STAFF_QUERY_KEY = ['staff', 'active'] as const;

async function fetchActiveStaff() {
  if (!isSupabaseConfigured) return [];

  const filters = isActiveStaffFilter();
  let query = supabase.from(TABLES.staff).select('*').order('name', { ascending: true });

  for (const f of filters) {
    if (f.operator === 'eq') query = query.eq(f.column, f.value as string);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[useQueryStaff] fetch error:', error.message);
    return [];
  }
  return data ?? [];
}

export function useQueryStaff(options?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: STAFF_QUERY_KEY,
    queryFn: fetchActiveStaff,
    staleTime: 5 * 60 * 1000, // 5 min — don't refetch if data is fresh
    gcTime: 30 * 60 * 1000, // 30 min — keep in memory
    enabled: isSupabaseConfigured,
  });
}
