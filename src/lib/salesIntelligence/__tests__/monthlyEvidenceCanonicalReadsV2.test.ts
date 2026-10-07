import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261005133000_monthly_evidence_canonical_reads_v2.sql',
  'utf8'
);

describe('monthly evidence canonical reads V2', () => {
  it('retires superseded legacy/current-case review rows without deleting audit history', () => {
    expect(source).toContain('set is_current=false');
    expect(source).toContain('legacy.sales_intelligence_case_id is null');
    expect(source).toContain('sales_intelligence_current_case_analyses');
    expect(source).not.toContain('delete from public.conversation_sales_reviews');
  });

  it('reads canonical reviews rather than the raw review table', () => {
    expect(source).toContain('from public.conversation_sales_reviews_canonical_v2 r');
    expect(source).toContain("'read_model','canonical_v2'");
  });

  it('counts only visible operational follow-ups in the monthly server snapshot', () => {
    expect(source).toContain('from public.customer_followup_operations_v2 f');
    expect(source).toContain('coalesce(f.is_hidden,false)=false');
    expect(source).toContain('f.archived_at is null');
    expect(source).toContain("f.handled_by_staff_id,''" );
  });
});
