import { describe, it, expect } from 'vitest';
import { mergeCaseListRows, filterCaseListRows } from '../queries';
import { DEFAULT_QA_LIST_FILTERS, type QaListFilters } from '../types';

const baseAnalysis = {
  analysis_id: 'a1',
  case_id: 'case-1',
  case_type: 'sales_opportunity',
  identity_branch_name_raw: 'فرع شكري',
  case_started_at: '2026-01-01T00:00:00.000Z',
  case_ended_at: '2026-01-01T01:00:00.000Z',
  historical_closure_level: 'strongly_inferred',
  protocol_applicability: 'applicable',
  attribution_level: 'strongly_inferred',
  integrity_evaluation_scope: 'insufficient',
  needs_human_review: true,
  human_review_reasons: ['competing_case_attribution'],
};

const baseAttribution = {
  analysis_id: 'a1',
  selected_invoice_number: '12345',
  competing_case_ids: ['case-2'],
};

describe('mergeCaseListRows', () => {
  it('joins analysis + attribution rows by analysis_id', () => {
    const rows = mergeCaseListRows([baseAnalysis], [baseAttribution]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      caseId: 'case-1',
      selectedInvoiceNumber: '12345',
      competingCaseCount: 1,
    });
  });

  it('never exposes customer identity fields (list must stay non-sensitive)', () => {
    const rows = mergeCaseListRows([baseAnalysis], [baseAttribution]);
    const keys = Object.keys(rows[0]);
    expect(keys).not.toContain('customerId');
    expect(keys).not.toContain('customerPhone');
    expect(keys).not.toContain('customerName');
  });

  it('handles a case analysis with no matching attribution row (defensive)', () => {
    const rows = mergeCaseListRows([baseAnalysis], []);
    expect(rows[0].selectedInvoiceNumber).toBeNull();
    expect(rows[0].competingCaseCount).toBe(0);
  });
});

describe('filterCaseListRows', () => {
  const rows = mergeCaseListRows(
    [
      baseAnalysis,
      { ...baseAnalysis, analysis_id: 'a2', case_id: 'case-2', case_type: 'information_only', historical_closure_level: 'unknown', protocol_applicability: 'not_reached', attribution_level: 'unknown', needs_human_review: false, human_review_reasons: ['no_basket_state_for_case'] },
    ],
    [baseAttribution, { analysis_id: 'a2', selected_invoice_number: null, competing_case_ids: [] }]
  );

  function withFilters(overrides: Partial<QaListFilters>): QaListFilters {
    return { ...DEFAULT_QA_LIST_FILTERS, ...overrides };
  }

  it('returns everything with default filters', () => {
    expect(filterCaseListRows(rows, DEFAULT_QA_LIST_FILTERS)).toHaveLength(2);
  });

  it('filters by case type', () => {
    const result = filterCaseListRows(rows, withFilters({ caseType: 'information_only' }));
    expect(result.map((r) => r.caseId)).toEqual(['case-2']);
  });

  it('filters by needs human review', () => {
    expect(filterCaseListRows(rows, withFilters({ needsHumanReview: 'yes' })).map((r) => r.caseId)).toEqual(['case-1']);
    expect(filterCaseListRows(rows, withFilters({ needsHumanReview: 'no' })).map((r) => r.caseId)).toEqual(['case-2']);
  });

  it('filters by invoice status', () => {
    expect(filterCaseListRows(rows, withFilters({ invoiceStatus: 'has_invoice' })).map((r) => r.caseId)).toEqual(['case-1']);
    expect(filterCaseListRows(rows, withFilters({ invoiceStatus: 'no_invoice' })).map((r) => r.caseId)).toEqual(['case-2']);
  });

  it('searches by case id', () => {
    expect(filterCaseListRows(rows, withFilters({ search: 'case-2' })).map((r) => r.caseId)).toEqual(['case-2']);
  });

  it('searches by invoice number', () => {
    expect(filterCaseListRows(rows, withFilters({ search: '12345' })).map((r) => r.caseId)).toEqual(['case-1']);
  });

  it('applies the "unknown cases" quick filter across all three dimensions', () => {
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'unknown_cases' })).map((r) => r.caseId)).toEqual(['case-2']);
  });

  it('applies the "no basket" quick filter via the no_basket_state_for_case reason', () => {
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'no_basket' })).map((r) => r.caseId)).toEqual(['case-2']);
  });

  it('applies the "competing attribution" quick filter', () => {
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'competing_attribution' })).map((r) => r.caseId)).toEqual(['case-1']);
  });

  it('combines a base filter and the search box (AND semantics)', () => {
    const result = filterCaseListRows(rows, withFilters({ caseType: 'sales_opportunity', search: 'case-2' }));
    expect(result).toHaveLength(0);
  });
});
