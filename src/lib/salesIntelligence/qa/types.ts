// Sales Intelligence QA Review UI — data contracts.
//
// READ ONLY. This module never writes to any sales_intelligence_* table, never touches feature
// flags, and never computes a staff-facing verdict — it exists purely to shape what the QA list
// and detail pages read from the already-persisted CURRENT views/tables (see
// docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md) plus a live, in-memory re-run of the same
// deterministic pipeline for full evidence drill-down (see queries.ts's own module comment).

/** One row of the QA list — deliberately excludes customer name/phone/id (never shown in the list). */
export interface QaCaseListRow {
  caseId: string;
  analysisId: string;
  branchNameRaw: string | null;
  caseStartedAt: string;
  caseEndedAt: string | null;
  caseType: string;
  historicalClosureLevel: string;
  protocolApplicability: string;
  attributionLevel: string;
  integrityEvaluationScope: string;
  selectedInvoiceNumber: string | null;
  competingCaseCount: number;
  needsHumanReview: boolean;
  humanReviewReasons: string[];
}

export interface QaListFilters {
  search: string;
  branch: string | 'all';
  caseType: string | 'all';
  historicalClosureLevel: string | 'all';
  protocolApplicability: string | 'all';
  attributionLevel: string | 'all';
  needsHumanReview: 'all' | 'yes' | 'no';
  competingAttribution: 'all' | 'yes' | 'no';
  invoiceStatus: 'all' | 'has_invoice' | 'no_invoice';
  /** One of the "special QA quick filters" the user asked for, applied on top of everything else. */
  quickFilter:
    | 'none'
    | 'strongly_inferred_closure'
    | 'applicable_cases'
    | 'strongly_inferred_attribution'
    | 'competing_attribution'
    | 'unknown_cases'
    | 'needs_human_review'
    | 'no_basket'
    | 'multiple_unresolved_products';
}

export const DEFAULT_QA_LIST_FILTERS: QaListFilters = {
  search: '',
  branch: 'all',
  caseType: 'all',
  historicalClosureLevel: 'all',
  protocolApplicability: 'all',
  attributionLevel: 'all',
  needsHumanReview: 'all',
  competingAttribution: 'all',
  invoiceStatus: 'all',
  quickFilter: 'none',
};
