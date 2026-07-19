import { supabase } from '@/lib/supabase';
import type { FollowupRow } from '@/lib/api/customerServiceCommandCenter';

export type CustomerServiceOperationalStatus =
  | 'open'
  | 'postponed'
  | 'needs_manager'
  | 'completed'
  | 'cancelled'
  | 'archived';

export type CustomerServiceDueBucket =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'upcoming'
  | 'unscheduled';

export type CustomerServiceOperationsRow = FollowupRow & {
  display_customer_name: string;
  display_phone: string | null;
  operational_status: CustomerServiceOperationalStatus;
  due_bucket: CustomerServiceDueBucket;
  days_until_due: number | null;
  events_count: number;
  last_event_at: string | null;
};

export type CustomerServiceStats = {
  total: number;
  open: number;
  postponed: number;
  needs_manager: number;
  completed: number;
  cancelled: number;
  archived: number;
  overdue: number;
  due_today: number;
  without_schedule: number;
};

type OperationsFilters = {
  branch?: string | null;
  status?: CustomerServiceOperationalStatus | 'all';
  due?: CustomerServiceDueBucket | 'all';
  search?: string;
  limit?: number;
};

function throwDatabaseError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message?.trim() || fallback);
}

export async function fetchCustomerServiceStats(branch?: string | null) {
  const { data, error } = await supabase.rpc('dawaa_customer_service_stats_v2', {
    p_branch: branch?.trim() || null,
  });
  if (error) throwDatabaseError(error, 'تعذر تحميل إحصائيات خدمة العملاء');
  return data as CustomerServiceStats;
}

export async function fetchCustomerServiceOperations(filters: OperationsFilters = {}) {
  const limit = Math.min(Math.max(filters.limit || 500, 1), 2000);
  let query = supabase
    .from('customer_followup_operations_v2')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters.branch?.trim()) query = query.eq('branch', filters.branch.trim());
  if (filters.status && filters.status !== 'all') {
    query = query.eq('operational_status', filters.status);
  }
  if (filters.due && filters.due !== 'all') query = query.eq('due_bucket', filters.due);

  const search = filters.search?.trim();
  if (search) {
    const escaped = search.replace(/[%,]/g, '');
    query = query.or(
      `display_customer_name.ilike.%${escaped}%,customer_code.ilike.%${escaped}%,display_phone.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) throwDatabaseError(error, 'تعذر تحميل مركز عمليات خدمة العملاء');
  return (data || []) as CustomerServiceOperationsRow[];
}
