import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { TABLES } from "@/lib/supabaseTables";

export function useStaff<T>() {
  return useSupabaseQuery<T>({
    table: TABLES.staff,
    orderBy: { column: "name", ascending: true },
    realtimeEnabled: true,
  });
}
