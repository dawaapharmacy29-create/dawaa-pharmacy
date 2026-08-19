import { supabase } from '@/lib/supabase';

export type CustomerCycleCohort = {
  offset: number;
  cycle_start: string;
  period_end: string;
  elapsed_days: number;
  customers_count: number;
  important_count: number;
  very_important_count: number;
  new_count: number;
  continuing_count: number;
  reactivated_count: number;
  invoices_count: number;
  sales_total: number;
  average_invoice: number | null;
  followups_count: number;
  followed_customers: number;
  completed_followups: number;
  followup_completion_rate: number | null;
  purchase_after_followup_count: number;
  recovered_sales: number;
};

export type WatchlistCycle = {
  offset: number;
  cycle_start: string;
  period_end: string;
  sales_total: number;
  invoice_count: number;
  followups_count: number;
  last_purchase_date: string | null;
};

export type WatchlistCustomerPerformance = {
  rank: number;
  customer_code: string;
  customer_name: string | null;
  phone: string | null;
  cycles: WatchlistCycle[];
};

export type WatchlistUploadRow = {
  customer_code: string;
  customer_name?: string;
  phone?: string;
  note?: string;
};

export async function fetchCustomerCycleCohorts(branch: string, asOfDate: string, actorId?: string) {
  const { data, error } = await supabase.rpc('get_customer_service_cycle_cohorts', {
    p_branch: branch,
    p_as_of_date: asOfDate,
    p_cycles: 3,
    p_actor_id: actorId,
  });
  if (error) throw new Error(error.message);
  return (data || []).filter(Boolean) as CustomerCycleCohort[];
}

export async function fetchWatchlistPerformance(branch: string, asOfDate: string, actorId?: string) {
  const { data, error } = await supabase.rpc('get_customer_service_watchlist_performance', {
    p_branch: branch,
    p_as_of_date: asOfDate,
    p_cycles: 3,
    p_actor_id: actorId,
  });
  if (error) throw new Error(error.message);
  return (data || []).filter(Boolean) as WatchlistCustomerPerformance[];
}

export async function replaceCustomerWatchlist(branch: string, rows: WatchlistUploadRow[]) {
  const { data, error } = await supabase.rpc('replace_customer_service_watchlist', {
    p_branch: branch,
    p_customers: rows,
  });
  if (error) throw new Error(error.message);
  return Number(data || 0);
}

export function normalizeWatchlistRows(rows: Array<Record<string, unknown>>): WatchlistUploadRow[] {
  const value = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const found = row[key];
      if (found !== undefined && found !== null && String(found).trim())
        return String(found).trim();
    }
    return '';
  };
  const normalized = rows
    .filter(Boolean)
    .map((row) => ({
      customer_code: value(row, ['كود العميل', 'الكود', 'customer_code', 'code']),
      customer_name: value(row, ['اسم العميل', 'الاسم', 'customer_name', 'name']),
      phone: value(row, ['الهاتف', 'الموبايل', 'phone', 'mobile']),
      note: value(row, ['ملاحظة', 'ملاحظات', 'note', 'notes']),
    }))
    .filter((row) => row.customer_code);

  const unique = new Map(normalized.map((row) => [row.customer_code, row]));
  return [...unique.values()].slice(0, 50);
}
