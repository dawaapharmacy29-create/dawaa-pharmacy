import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { TABLES } from '@/lib/supabaseTables';

export function useShiftSchedules<T>() {
  return useSupabaseQuery<T>({
    table: TABLES.shiftSchedules,
    realtimeEnabled: true,
  });
}
