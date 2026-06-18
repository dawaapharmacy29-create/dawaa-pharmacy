import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { TABLES } from '@/lib/supabaseTables';

export function usePermissions<T>() {
  return useSupabaseQuery<T>({
    table: TABLES.permissionDefinitions,
    orderBy: { column: 'category', ascending: true },
  });
}
