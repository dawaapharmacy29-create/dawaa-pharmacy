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

  it('adds reviewer-facing customer display identity when conversation metadata is available', () => {
    const rows = mergeCaseListRows(
      [baseAnalysis],
      [baseAttribution],
      [],
      [{ case_id: 'case-1', conversation_id: 'conv-1', customer_phone: '01000000000' }],
      [{ id: 'conv-1', customer_name: 'أحمد محمد', customer_code: 'C100', customer_phone: '01000000000' }]
    );
    expect(rows[0]).toMatchObject({
      customerName: 'أحمد محمد',
      customerCode: 'C100',
      customerPhone: '01000000000',
      conversationCaseCount: 1,
    });
  });

  it('splits an attached customer code from the WhatsApp source name in list rows', () => {
    const rows = mergeCaseListRows(
      [baseAnalysis],
      [baseAttribution],
      [],
      [{ case_id: 'case-1', conversation_id: 'conv-1' }],
      [{ id: 'conv-1', customer_name: 'محمد الكموني17777', customer_code: null, customer_phone: null }]
    );
    expect(rows[0].customerName).toBe('محمد الكموني');
    expect(rows[0].customerCode).toBe('17777');
  });

  it('hides a partial WhatsApp snapshot when a fuller snapshot of the same customer/file contains it', () => {
    const analyses = [
      baseAnalysis,
      { ...baseAnalysis, analysis_id: 'a2', case_id: 'case-2' },
    ];
    const cases = [
      { case_id: 'case-1', conversation_id: 'partial', customer_phone: '01000000000' },
      { case_id: 'case-2', conversation_id: 'full', customer_phone: '01000000000' },
    ];
    const conversations = [
      {
        id: 'partial',
        source_filename: 'customer.zip',
        customer_code: 'C100',
        customer_phone: '01000000000',
        conversation_started_at: '2026-09-15T06:46:45.000Z',
        conversation_ended_at: '2026-09-15T06:47:59.000Z',
        message_count: 9,
        created_at: '2026-09-16T12:00:00.000Z',
      },
      {
        id: 'full',
        source_filename: 'customer.zip',
        customer_code: 'C100',
        customer_phone: '01000000000',
        conversation_started_at: '2026-09-15T06:46:45.000Z',
        conversation_ended_at: '2026-09-15T17:07:51.000Z',
        message_count: 43,
        created_at: '2026-09-21T05:00:00.000Z',
      },
    ];
    const rows = mergeCaseListRows(analyses, [], [], cases, conversations);
    expect(rows.map((row) => row.caseId)).toEqual(['case-2']);
  });

  it('keeps non-overlapping snapshots from the same customer/file as independent sources', () => {
    const analyses = [baseAnalysis, { ...baseAnalysis, analysis_id: 'a2', case_id: 'case-2' }];
    const cases = [
      { case_id: 'case-1', conversation_id: 'day1' },
      { case_id: 'case-2', conversation_id: 'day2' },
    ];
    const conversations = [
      { id: 'day1', source_filename: 'customer.zip', customer_code: 'C100', conversation_started_at: '2026-09-12T06:00:00.000Z', conversation_ended_at: '2026-09-12T10:00:00.000Z', message_count: 20 },
      { id: 'day2', source_filename: 'customer.zip', customer_code: 'C100', conversation_started_at: '2026-09-15T06:00:00.000Z', conversation_ended_at: '2026-09-15T10:00:00.000Z', message_count: 20 },
    ];
    const rows = mergeCaseListRows(analyses, [], [], cases, conversations);
    expect(rows.map((row) => row.caseId).sort()).toEqual(['case-1', 'case-2']);
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

  it('searches by customer name/code/phone when reviewer-facing identity is present', () => {
    const identityRows = mergeCaseListRows(
      [baseAnalysis],
      [baseAttribution],
      [],
      [{ case_id: 'case-1', conversation_id: 'conv-1', customer_phone: '01000000000' }],
      [{ id: 'conv-1', customer_name: 'أحمد محمد', customer_code: 'C100', customer_phone: '01000000000' }]
    );
    expect(filterCaseListRows(identityRows, withFilters({ search: 'أحمد' }))).toHaveLength(1);
    expect(filterCaseListRows(identityRows, withFilters({ search: 'c100' }))).toHaveLength(1);
    expect(filterCaseListRows(identityRows, withFilters({ search: '01000000000' }))).toHaveLength(1);
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

describe('Final Pilot Readiness — SaleProofState list wiring', () => {
  const proven = { ...baseAnalysis, analysis_id: 'p1', case_id: 'proven-case' };
  const provenAttribution = { analysis_id: 'p1', attribution_level: 'proven', selected_invoice_id: 'inv-p1', selected_invoice_number: '999', competing_case_ids: [], candidate_count: 1, identity_conflict: 'none', branch_conflict: false, is_official_for_staff_evaluation: true };

  const contradicted = { ...baseAnalysis, analysis_id: 'c1', case_id: 'contradicted-case' };
  const contradictedAttribution = { analysis_id: 'c1', attribution_level: 'proven', selected_invoice_id: 'inv-c1', selected_invoice_number: '888', competing_case_ids: ['other'], candidate_count: 2, identity_conflict: 'none', branch_conflict: false, is_official_for_staff_evaluation: true };

  const rows = mergeCaseListRows([proven, contradicted], [provenAttribution, contradictedAttribution]);

  function withFilters(overrides: Partial<QaListFilters>): QaListFilters {
    return { ...DEFAULT_QA_LIST_FILTERS, ...overrides };
  }

  it('never re-derives SaleProofState with its own logic — reuses the real engine and gets the real answer', () => {
    expect(rows.find((r) => r.caseId === 'proven-case')?.saleProofState).toBe('proven');
    // A "competing" attribution is a real, already-computed contradiction — never silently 'proven'.
    expect(rows.find((r) => r.caseId === 'contradicted-case')?.saleProofState).toBe('contradicted');
  });

  it('filters by saleProofState', () => {
    expect(filterCaseListRows(rows, withFilters({ saleProofState: 'proven' })).map((r) => r.caseId)).toEqual(['proven-case']);
    expect(filterCaseListRows(rows, withFilters({ saleProofState: 'contradicted' })).map((r) => r.caseId)).toEqual(['contradicted-case']);
  });

  it('applies the proof_proven / proof_contradicted quick filters', () => {
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'proof_proven' })).map((r) => r.caseId)).toEqual(['proven-case']);
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'proof_contradicted' })).map((r) => r.caseId)).toEqual(['contradicted-case']);
  });

  it('applies the has_invoice / no_invoice quick filters', () => {
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'has_invoice' })).map((r) => r.caseId).sort()).toEqual(['contradicted-case', 'proven-case']);
    expect(filterCaseListRows(rows, withFilters({ quickFilter: 'no_invoice' }))).toHaveLength(0);
  });
});
