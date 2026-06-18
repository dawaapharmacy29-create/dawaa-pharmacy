import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { TABLES } from '@/lib/supabaseTables';

/**
 * Staff list query with active-only filter by default (admin: includeInactive).
 * Realtime is enabled for staff so attendance status stays live.
 */
export function useActiveStaff<T>(options?: {
  includeInactive?: boolean;
  select?: string;
  limit?: number;
  realtimeEnabled?: boolean;
  orderBy?: { column: string; ascending?: boolean };
}) {
  const opts = options || {};
  return useSupabaseQuery<T>({
    table: TABLES.staff,
    filters: opts.includeInactive ? undefined : isActiveStaffFilter(),
    orderBy: opts.orderBy ?? { column: 'name', ascending: true },
    select: opts.select,
    limit: opts.limit,
    // Realtime ON for staff — live attendance/shift updates matter
    // All other tables default to false in useSupabaseQuery
    realtimeEnabled: opts.realtimeEnabled ?? true,
  });
}
