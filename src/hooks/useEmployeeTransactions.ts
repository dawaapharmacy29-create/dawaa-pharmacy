import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { TABLES } from '@/lib/supabaseTables';

export function useEmployeeTransactions<T>() {
  return useSupabaseQuery<T>({
    table: TABLES.employeeTransactions,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });
}
