import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { isActiveStaffFilter } from "@/lib/staffActiveFilter";
import { TABLES } from "@/lib/supabaseTables";

/** Staff list query with active-only filter by default (admin: includeInactive). */
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
    orderBy: opts.orderBy ?? { column: "name", ascending: true },
    select: opts.select,
    limit: opts.limit,
    realtimeEnabled: opts.realtimeEnabled ?? true,
  });
}
