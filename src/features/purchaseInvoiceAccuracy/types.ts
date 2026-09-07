export type PageTab = 'invoices' | 'manual' | 'history' | 'reports';
export type Outcome = 'correct' | 'mixup_unregistered' | 'negligence' | 'customer_problem';

export type ReviewRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  invoice_reference: string | null;
  outcome: Outcome;
  points: number;
  notes: string | null;
  review_date: string;
  reviewed_by_name: string | null;
};

export type QueueRow = {
  id: string;
  base44_id: string;
  system_invoice_number: string | null;
  branch: string | null;
  transaction_type: string | null;
  entered_by_raw: string | null;
  entered_by_staff_id: string | null;
  entered_by_staff_name: string | null;
  match_status: 'matched' | 'ambiguous' | 'unmatched' | 'empty';
  invoice_date: string | null;
  total_value: number | null;
};

export type ReportSummary = {
  reviewed_count: number;
  pending_count: number;
  correct_count: number;
  mixup_count: number;
  negligence_count: number;
  customer_problem_count: number;
  unknown_staff_count: number;
  total_points: number;
  accuracy_rate: number;
};

export type StaffReportRow = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  reviewed_count: number;
  correct_count: number;
  mixup_count: number;
  negligence_count: number;
  customer_problem_count: number;
  total_points: number;
  accuracy_rate: number;
  avg_points: number;
};

export type BranchReportRow = {
  branch: string;
  reviewed_count: number;
  pending_count: number;
  correct_count: number;
  negligence_count: number;
  customer_problem_count: number;
  total_points: number;
  accuracy_rate: number;
};

export type DailyReportRow = {
  report_date: string;
  reviewed_count: number;
  correct_count: number;
  total_points: number;
  accuracy_rate: number;
};

export type AccuracyReport = {
  summary: ReportSummary;
  staff: StaffReportRow[];
  branches: BranchReportRow[];
  daily: DailyReportRow[];
};

export type HistoricalSearchResult = {
  pending: QueueRow[];
  reviews: ReviewRow[];
};

export type AccuracyFilters = {
  fromDate?: string;
  toDate?: string;
  employee?: string;
  reviewer?: string;
  branch?: string;
};

export type AccuracyFilterOptions = {
  staff: string[];
  reviewers: string[];
  branches: string[];
};

export const EMPTY_FILTER_OPTIONS: AccuracyFilterOptions = {
  staff: [],
  reviewers: [],
  branches: [],
};

export const EMPTY_REPORT: AccuracyReport = {
  summary: {
    reviewed_count: 0,
    pending_count: 0,
    correct_count: 0,
    mixup_count: 0,
    negligence_count: 0,
    customer_problem_count: 0,
    unknown_staff_count: 0,
    total_points: 0,
    accuracy_rate: 0,
  },
  staff: [],
  branches: [],
  daily: [],
};

export const MATCH_STATUS_LABEL: Record<QueueRow['match_status'], string> = {
  matched: 'تمت مطابقة الموظف',
  ambiguous: 'الاسم محتاج تأكيد',
  unmatched: 'الاسم غير معروف',
  empty: 'لم يتم تسجيل اسم في Base44',
};

export const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  external_purchase: 'شراء خارجي',
  internal_transfer: 'تحويل بين فرعين',
};

export function normalizeSearch(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase('ar');
}

export type StaffStatus = 'insufficient_sample' | 'excellent' | 'very_good' | 'follow_up' | 'operational_risk';

export function getStaffStatusKey(row: StaffReportRow): StaffStatus {
  if (row.reviewed_count < 5) return 'insufficient_sample';
  const severe = row.negligence_count + row.customer_problem_count;
  if (row.accuracy_rate >= 95 && severe === 0) return 'excellent';
  if (row.accuracy_rate >= 85 && severe <= 1) return 'very_good';
  if (row.accuracy_rate >= 70 && severe <= 2) return 'follow_up';
  return 'operational_risk';
}
