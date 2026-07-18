import { supabase } from '@/lib/supabase';

export type CustomerServiceExecutionMetric = {
  queue_date: string;
  branch: string;
  total_count: number;
  completed_count: number;
  remaining_count: number;
  not_started_count: number;
  in_progress_count: number;
  scheduled_count: number;
  needs_manager_count: number;
  doctor_request_count: number;
  at_risk_count: number;
  important_count: number;
  started_count: number;
  completion_rate: number;
  avg_first_attempt_minutes: number | null;
  avg_completion_minutes: number | null;
  first_started_at: string | null;
  last_completed_at: string | null;
  last_activity_at: string | null;
};

export type CustomerServiceQualityIssue = {
  id: string;
  queue_date: string;
  branch: string;
  customer_key: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  source: string;
  status: string;
  linked_followup_id: string | null;
  next_followup_date: string | null;
  issue_type: string;
  created_at: string;
  updated_at: string;
};

const text = (value: unknown) => String(value ?? '').trim();
const missingRelation = (message: string) => /does not exist|schema cache|relation .* not found/i.test(message);

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function fetchCustomerServiceExecutionMetrics(from: string, to: string, branch?: string) {
  let query = supabase
    .from('customer_service_daily_execution_metrics')
    .select('*')
    .gte('queue_date', from)
    .lte('queue_date', to)
    .order('queue_date', { ascending: false });

  if (text(branch) && branch !== 'all') query = query.eq('branch', text(branch));

  const { data, error } = await query;
  if (error) {
    if (missingRelation(error.message)) return [] as CustomerServiceExecutionMetric[];
    throw new Error(error.message);
  }
  return (data || []) as CustomerServiceExecutionMetric[];
}

export async function fetchCustomerServiceQualityIssues(branch?: string, limit = 300) {
  let query = supabase
    .from('customer_service_queue_quality_issues')
    .select('*')
    .order('queue_date', { ascending: false })
    .limit(limit);

  if (text(branch) && branch !== 'all') query = query.eq('branch', text(branch));

  const { data, error } = await query;
  if (error) {
    if (missingRelation(error.message)) return [] as CustomerServiceQualityIssue[];
    throw new Error(error.message);
  }
  return (data || []) as CustomerServiceQualityIssue[];
}

export async function recordCustomerServiceEscalation(input: {
  branch: string;
  alertKey: string;
  alertLevel: 'info' | 'warning' | 'critical';
  alertType: string;
  title: string;
  message: string;
  total: number;
  completed: number;
  needsManager?: number;
  metadata?: Record<string, unknown>;
}) {
  const total = Math.max(0, Number(input.total || 0));
  const completed = Math.max(0, Number(input.completed || 0));
  const payload = {
    alert_date: todayKey(),
    branch: text(input.branch),
    alert_key: text(input.alertKey),
    alert_level: input.alertLevel,
    alert_type: text(input.alertType),
    title: text(input.title),
    message: text(input.message),
    total_count: total,
    completed_count: completed,
    remaining_count: Math.max(0, total - completed),
    needs_manager_count: Math.max(0, Number(input.needsManager || 0)),
    metadata: input.metadata || {},
  };

  const { data, error } = await supabase
    .from('customer_service_escalation_log')
    .upsert(payload, { onConflict: 'alert_date,branch,alert_key', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();

  if (error) {
    if (missingRelation(error.message)) return null;
    throw new Error(error.message);
  }
  return data;
}

export async function acknowledgeCustomerServiceEscalation(input: {
  id: string;
  staffId?: string | null;
  staffName?: string | null;
}) {
  const { error } = await supabase
    .from('customer_service_escalation_log')
    .update({
      acknowledged: true,
      acknowledged_by_staff_id: text(input.staffId) || null,
      acknowledged_by_name: text(input.staffName) || null,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', input.id);

  if (error && !missingRelation(error.message)) throw new Error(error.message);
}
