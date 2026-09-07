import { supabase } from '@/lib/supabase';
import type {
  AccuracyFilterOptions,
  AccuracyFilters,
  AccuracyReport,
  HistoricalSearchResult,
  Outcome,
  QueueRow,
  ReviewRow,
} from './types';
import { EMPTY_FILTER_OPTIONS, EMPTY_REPORT } from './types';

function rpcFilters(filters: AccuracyFilters) {
  return {
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null,
    p_staff_name: filters.employee || null,
    p_reviewer_name: filters.reviewer || null,
    p_branch: filters.branch || null,
  };
}

function throwRpcError(error: { message?: string } | null) {
  if (error) throw new Error(error.message || 'تعذّر تنفيذ العملية');
}

export async function listPendingPurchaseInvoiceReviews(limit = 100): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc('list_base44_pending_invoice_reviews_v1', { p_limit: limit });
  throwRpcError(error);
  return (data || []) as QueueRow[];
}

export async function listPurchaseInvoiceReviewHistory(limit = 100): Promise<ReviewRow[]> {
  const { data, error } = await supabase.rpc('list_purchase_invoice_entry_reviews_v1', { p_limit: limit });
  throwRpcError(error);
  return (data || []) as ReviewRow[];
}

export async function getPurchaseInvoiceAccuracyFilterOptions(): Promise<AccuracyFilterOptions> {
  const { data, error } = await supabase.rpc('get_purchase_invoice_accuracy_filter_options_v1');
  throwRpcError(error);
  const result = (data || EMPTY_FILTER_OPTIONS) as AccuracyFilterOptions;
  return {
    staff: result.staff || [],
    reviewers: result.reviewers || [],
    branches: result.branches || [],
  };
}

export async function getPurchaseInvoiceAccuracyReport(filters: AccuracyFilters): Promise<AccuracyReport> {
  const { data, error } = await supabase.rpc('get_purchase_invoice_accuracy_report_v1', rpcFilters(filters));
  throwRpcError(error);
  return (data || EMPTY_REPORT) as AccuracyReport;
}

export async function searchPurchaseInvoiceAccuracy(
  query: string,
  filters: AccuracyFilters,
  limit = 100,
): Promise<HistoricalSearchResult> {
  const { data, error } = await supabase.rpc('query_purchase_invoice_accuracy_v1', {
    p_query: query.trim() || null,
    ...rpcFilters(filters),
    p_limit: limit,
  });
  throwRpcError(error);
  const result = (data || { pending: [], reviews: [] }) as HistoricalSearchResult;
  return {
    pending: result.pending || [],
    reviews: result.reviews || [],
  };
}

export async function classifyPendingPurchaseInvoice(
  syncId: string,
  staffId: string,
  outcome: Outcome,
): Promise<void> {
  const { error } = await supabase.rpc('log_base44_invoice_review_v1', {
    p_sync_id: syncId,
    p_staff_id: staffId,
    p_outcome: outcome,
  });
  throwRpcError(error);
}

export async function resolvePurchaseInvoiceAlias(rawName: string, staffId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_base44_entered_by_alias_v1', {
    p_raw_name: rawName,
    p_staff_id: staffId,
  });
  throwRpcError(error);
}

export async function assignPurchaseInvoiceStaff(syncId: string, staffId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_base44_invoice_entered_by_v1', {
    p_sync_id: syncId,
    p_staff_id: staffId,
  });
  throwRpcError(error);
}

export async function logManualPurchaseInvoiceReview(input: {
  staffId: string;
  outcome: Outcome;
  branch: string | null;
  invoiceReference?: string;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('log_purchase_invoice_entry_review_v1', {
    p_staff_id: input.staffId,
    p_outcome: input.outcome,
    p_branch: input.branch,
    p_invoice_reference: input.invoiceReference?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });
  throwRpcError(error);
}
