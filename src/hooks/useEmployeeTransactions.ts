import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';

type EmployeeTransactionQueryOptions = {
  startDate?: string;
  endDate?: string;
  realtimeEnabled?: boolean;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function useEmployeeTransactions<T>(options: EmployeeTransactionQueryOptions = {}) {
  const queryClient = useQueryClient();
  const cycle = useMemo(() => getCurrentCycle(), []);
  const startDate = options.startDate || isoDate(cycle.start);
  const endDate = options.endDate || isoDate(cycle.end);
  const realtimeEnabled = options.realtimeEnabled !== false;
  const queryKey = ['employee-transactions-cycle', startDate, endDate] as const;

  const query = useQuery<T[], Error>({
    queryKey,
    queryFn: async () => {
      if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');
      const { data, error } = await supabase.rpc('get_employee_transactions_for_cycle_v1', {
        p_start: startDate,
        p_end: endDate,
      });
      if (error) throw error;
      return ((data || []) as T[]).filter(Boolean);
    },
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isSupabaseConfigured || !realtimeEnabled) return;
    const channel = supabase
      .channel(`employee-transactions:${startDate}:${endDate}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLES.employeeTransactions },
        () => {
          void queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [endDate, queryClient, realtimeEnabled, startDate]);

  return {
    data: query.data || [],
    loading: query.isLoading,
    error: query.error?.message || null,
    refetch: () => queryClient.invalidateQueries({ queryKey }),
  };
}
