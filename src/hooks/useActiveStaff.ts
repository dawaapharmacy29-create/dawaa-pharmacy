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
    freshness: 'live',
    // Realtime ON for staff — live attendance/shift updates matter.
    // Reconnect also refetches through the live freshness policy so missed
    // websocket events do not leave an old staff snapshot on screen.
    realtimeEnabled: opts.realtimeEnabled ?? true,
  });
}
