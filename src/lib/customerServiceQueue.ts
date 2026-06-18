import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface CustomerServiceQueueItem {
  id: string;
  queueDate: string;
  customerId: string | null;
  customerCode: string | null;
  customerName: string;
  customerPhone: string | null;
  customerSegment: string | null;
  lastPurchaseDate: string | null;
  lastInvoiceAmount: number | null;
  totalLifetimeValue: number;
  totalInvoicesCount: number;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  assignedBranch: string | null;
  priorityLevel: 'urgent' | 'high' | 'medium' | 'low';
  priorityReason: string;
  followupStatus: 'pending' | 'in_progress' | 'completed' | 'skipped';
  followupDate: string | null;
  daysSinceLastPurchase: number | null;
  daysSinceLastFollowup: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerServiceQueueSummary {
  urgentCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalCount: number;
  completedCount: number;
  pendingCount: number;
}

export interface CustomerServiceQueueGenerationResult {
  success: boolean;
  queueDate: string;
  itemCount: number;
  summary: CustomerServiceQueueSummary | null;
  error: string | null;
}

/**
 * Generate daily customer service queue for a specific date
 * Uses the SQL function generate_customer_service_daily_queue
 */
export async function generateDailyCustomerServiceQueue(
  targetDate: string = new Date().toISOString().slice(0, 10)
): Promise<CustomerServiceQueueGenerationResult> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      queueDate: targetDate,
      itemCount: 0,
      summary: null,
      error: 'Supabase not configured',
    };
  }

  try {
    const { data, error } = await supabase.rpc('generate_customer_service_daily_queue', {
      target_date: targetDate,
    });

    if (error) throw error;

    const itemCount = data as number;

    // Get summary
    const summary = await getCustomerServiceQueueSummary(targetDate);

    return {
      success: true,
      queueDate: targetDate,
      itemCount,
      summary,
      error: null,
    };
  } catch (error) {
    console.error('Error generating customer service queue:', error);
    return {
      success: false,
      queueDate: targetDate,
      itemCount: 0,
      summary: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get customer service queue items for a specific date
 */
export async function getCustomerServiceQueue(
  queueDate: string = new Date().toISOString().slice(0, 10),
  options: {
    priorityLevel?: 'urgent' | 'high' | 'medium' | 'low';
    followupStatus?: 'pending' | 'in_progress' | 'completed' | 'skipped';
    assignedStaffId?: string;
    limit?: number;
  } = {}
): Promise<CustomerServiceQueueItem[]> {
  if (!isSupabaseConfigured) return [];

  try {
    let query = supabase
      .from('customer_service_daily_queue')
      .select('*')
      .eq('queue_date', queueDate)
      .order('priority_level', { ascending: false })
      .order('created_at', { ascending: false });

    if (options.priorityLevel) {
      query = query.eq('priority_level', options.priorityLevel);
    }

    if (options.followupStatus) {
      query = query.eq('followup_status', options.followupStatus);
    }

    if (options.assignedStaffId) {
      query = query.eq('assigned_staff_id', options.assignedStaffId);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((row) => ({
      id: String(row.id),
      queueDate: String(row.queue_date),
      customerId: row.customer_id ? String(row.customer_id) : null,
      customerCode: row.customer_code ? String(row.customer_code) : null,
      customerName: String(row.customer_name || ''),
      customerPhone: row.customer_phone ? String(row.customer_phone) : null,
      customerSegment: row.customer_segment ? String(row.customer_segment) : null,
      lastPurchaseDate: row.last_purchase_date ? String(row.last_purchase_date) : null,
      lastInvoiceAmount: row.last_invoice_amount ? Number(row.last_invoice_amount) : null,
      totalLifetimeValue: Number(row.total_lifetime_value || 0),
      totalInvoicesCount: Number(row.total_invoices_count || 0),
      assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
      assignedStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
      assignedBranch: row.assigned_branch ? String(row.assigned_branch) : null,
      priorityLevel: row.priority_level as 'urgent' | 'high' | 'medium' | 'low',
      priorityReason: String(row.priority_reason || ''),
      followupStatus: row.followup_status as 'pending' | 'in_progress' | 'completed' | 'skipped',
      followupDate: row.followup_date ? String(row.followup_date) : null,
      daysSinceLastPurchase: row.days_since_last_purchase
        ? Number(row.days_since_last_purchase)
        : null,
      daysSinceLastFollowup: row.days_since_last_followup
        ? Number(row.days_since_last_followup)
        : null,
      notes: row.notes ? String(row.notes) : null,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
    }));
  } catch (error) {
    console.error('Error fetching customer service queue:', error);
    return [];
  }
}

/**
 * Get customer service queue summary for a specific date
 */
export async function getCustomerServiceQueueSummary(
  queueDate: string = new Date().toISOString().slice(0, 10)
): Promise<CustomerServiceQueueSummary | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase.rpc('get_customer_service_queue_summary', {
      queue_date: queueDate,
    });

    if (error) throw error;

    if (!data || Array.isArray(data) === false || data.length === 0) return null;

    const row = data[0] as Record<string, unknown>;

    return {
      urgentCount: Number(row.urgent_count || 0),
      highCount: Number(row.high_count || 0),
      mediumCount: Number(row.medium_count || 0),
      lowCount: Number(row.low_count || 0),
      totalCount: Number(row.total_count || 0),
      completedCount: Number(row.completed_count || 0),
      pendingCount: Number(row.pending_count || 0),
    };
  } catch (error) {
    console.error('Error fetching customer service queue summary:', error);
    return null;
  }
}

/**
 * Update customer service queue item status
 */
export async function updateCustomerServiceQueueItem(
  itemId: string,
  updates: {
    followupStatus?: 'pending' | 'in_progress' | 'completed' | 'skipped';
    followupDate?: string;
    notes?: string;
  }
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const { error } = await supabase
      .from('customer_service_daily_queue')
      .update({
        followup_status: updates.followupStatus,
        followup_date: updates.followupDate,
        notes: updates.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId);

    if (error) throw error;

    return true;
  } catch (error) {
    console.error('Error updating customer service queue item:', error);
    return false;
  }
}

/**
 * Get customer service queue for a specific staff member
 */
export async function getStaffCustomerServiceQueue(
  staffId: string,
  queueDate: string = new Date().toISOString().slice(0, 10)
): Promise<CustomerServiceQueueItem[]> {
  return getCustomerServiceQueue(queueDate, {
    assignedStaffId: staffId,
    followupStatus: 'pending',
  });
}

/**
 * Get high-priority queue items (urgent + high)
 */
export async function getHighPriorityCustomerServiceQueue(
  queueDate: string = new Date().toISOString().slice(0, 10),
  limit: number = 50
): Promise<CustomerServiceQueueItem[]> {
  if (!isSupabaseConfigured) return [];

  try {
    const { data, error } = await supabase
      .from('customer_service_daily_queue')
      .select('*')
      .eq('queue_date', queueDate)
      .in('priority_level', ['urgent', 'high'])
      .eq('followup_status', 'pending')
      .order('priority_level', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row) => ({
      id: String(row.id),
      queueDate: String(row.queue_date),
      customerId: row.customer_id ? String(row.customer_id) : null,
      customerCode: row.customer_code ? String(row.customer_code) : null,
      customerName: String(row.customer_name || ''),
      customerPhone: row.customer_phone ? String(row.customer_phone) : null,
      customerSegment: row.customer_segment ? String(row.customer_segment) : null,
      lastPurchaseDate: row.last_purchase_date ? String(row.last_purchase_date) : null,
      lastInvoiceAmount: row.last_invoice_amount ? Number(row.last_invoice_amount) : null,
      totalLifetimeValue: Number(row.total_lifetime_value || 0),
      totalInvoicesCount: Number(row.total_invoices_count || 0),
      assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
      assignedStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
      assignedBranch: row.assigned_branch ? String(row.assigned_branch) : null,
      priorityLevel: row.priority_level as 'urgent' | 'high' | 'medium' | 'low',
      priorityReason: String(row.priority_reason || ''),
      followupStatus: row.followup_status as 'pending' | 'in_progress' | 'completed' | 'skipped',
      followupDate: row.followup_date ? String(row.followup_date) : null,
      daysSinceLastPurchase: row.days_since_last_purchase
        ? Number(row.days_since_last_purchase)
        : null,
      daysSinceLastFollowup: row.days_since_last_followup
        ? Number(row.days_since_last_followup)
        : null,
      notes: row.notes ? String(row.notes) : null,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
    }));
  } catch (error) {
    console.error('Error fetching high priority customer service queue:', error);
    return [];
  }
}
