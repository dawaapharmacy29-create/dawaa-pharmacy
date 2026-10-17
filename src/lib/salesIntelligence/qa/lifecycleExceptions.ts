// Read-only lifecycle visibility. A missing readable analysis is never a sale/loss decision.
export type LifecycleState =
  | 'CURRENT_ANALYSIS_AVAILABLE'
  | 'ANALYSIS_PENDING'
  | 'ANALYSIS_FAILED'
  | 'NOT_ANALYZED'
  | 'HISTORICAL_ONLY'
  | 'ARCHIVED_SOURCE';
export type LifecycleCase = {
  case_id: string;
  conversation_id: string;
  is_active: boolean;
  published_analysis_id: string | null;
  branch_name_raw: string | null;
};
export type LifecycleAnalysis = {
  case_id: string;
  analysis_id: string;
  is_current: boolean;
  superseded_at: string | null;
  pipeline_status?: string | null;
};
export function lifecycleState(
  c: LifecycleCase,
  analyses: LifecycleAnalysis[],
  archived: boolean
): LifecycleState {
  if (archived) return 'ARCHIVED_SOURCE';
  const own = analyses.filter((a) => a.case_id === c.case_id);
  const current = own.filter((a) => a.is_current && !a.superseded_at);
  if (c.is_active && current.length === 1 && current[0].analysis_id === c.published_analysis_id)
    return 'CURRENT_ANALYSIS_AVAILABLE';
  if (own.some((a) => !a.is_current && !a.superseded_at)) return 'ANALYSIS_PENDING';
  if (own.some((a) => a.pipeline_status === 'failed')) return 'ANALYSIS_FAILED';
  return own.length ? 'HISTORICAL_ONLY' : 'NOT_ANALYZED';
}
export const lifecycleLabels: Record<LifecycleState, string> = {
  CURRENT_ANALYSIS_AVAILABLE: 'تحليل حالي منشور',
  ANALYSIS_PENDING: 'تحليل محفوظ ينتظر النشر',
  ANALYSIS_FAILED: 'تحليل تعذر إكماله',
  NOT_ANALYZED: 'لا يظهر تحليل محفوظ',
  HISTORICAL_ONLY: 'تحليل تاريخي أو نشر غير متوافق',
  ARCHIVED_SOURCE: 'مصدر مؤرشف — خارج العمل الحالي',
};
