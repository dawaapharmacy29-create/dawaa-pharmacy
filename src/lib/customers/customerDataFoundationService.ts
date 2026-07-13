import { supabase } from '@/lib/supabase';
import { classifyCustomerByAverageMonthly, type CustomerSegment } from './customerDataPolicy';

type Row = Record<string, unknown>;

export type CustomerDataQualityRow = {
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  registered_branch: string | null;
  account_kind: 'real_customer' | 'pseudo_customer' | 'internal_account' | 'invalid_customer';
  quality_issues: string[];
  data_quality_score: number;
};

export type CustomerReviewQueueRow = {
  id: string;
  customer_id: string | null;
  customer_code: string | null;
  issue_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  current_value: Row;
  suggested_value: Row;
  source: string;
  status: 'pending' | 'approved' | 'rejected' | 'resolved';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewDecision = 'approve' | 'reject';

export async function getCustomerDataQuality(options: {
  minimumScore?: number;
  maximumScore?: number;
  accountKind?: CustomerDataQualityRow['account_kind'];
  limit?: number;
  offset?: number;
} = {}): Promise<CustomerDataQualityRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);
  let query = supabase
    .from('customer_data_quality_v2')
    .select('customer_id,customer_code,customer_name,phone,mobile,address,registered_branch,account_kind,quality_issues,data_quality_score')
    .order('data_quality_score', { ascending: true })
    .range(offset, offset + limit - 1);
  if (options.minimumScore !== undefined) query = query.gte('data_quality_score', options.minimumScore);
  if (options.maximumScore !== undefined) query = query.lte('data_quality_score', options.maximumScore);
  if (options.accountKind) query = query.eq('account_kind', options.accountKind);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerDataQualityRow[];
}

export async function getCustomerReviews(options: {
  status?: CustomerReviewQueueRow['status'];
  severity?: CustomerReviewQueueRow['severity'];
  issueType?: string;
  limit?: number;
} = {}): Promise<CustomerReviewQueueRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000);
  let query = supabase
    .from('customer_data_review_queue')
    .select('*')
    .eq('status', options.status ?? 'pending')
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (options.severity) query = query.eq('severity', options.severity);
  if (options.issueType) query = query.eq('issue_type', options.issueType);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerReviewQueueRow[];
}

export const getPendingCustomerReviews = (options: {
  severity?: CustomerReviewQueueRow['severity'];
  limit?: number;
} = {}) => getCustomerReviews({ ...options, status: 'pending' });

export async function decideCustomerReview(input: {
  reviewId: string;
  decision: ReviewDecision;
  reviewer: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('review_customer_data_issue_v2', {
    p_review_id: input.reviewId,
    p_decision: input.decision,
    p_reviewer: input.reviewer,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function classifyCustomerAverageWithDatabase(avgMonthly: number): Promise<CustomerSegment> {
  const { data, error } = await supabase.rpc('classify_customer_avg_monthly_v2', { avg_monthly: avgMonthly });
  if (error || typeof data !== 'string') return classifyCustomerByAverageMonthly(avgMonthly);
  return data as CustomerSegment;
}

export function customerDataQualityLabel(score: number): string {
  if (score >= 90) return 'سليم';
  if (score >= 70) return 'مقبول مع ملاحظة';
  if (score >= 40) return 'يحتاج مراجعة';
  return 'غير صالح للاستخدام الآلي';
}
