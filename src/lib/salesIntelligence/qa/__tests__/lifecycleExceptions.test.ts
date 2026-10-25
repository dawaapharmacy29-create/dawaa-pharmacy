import { describe, it, expect } from 'vitest';
import { lifecycleState, type LifecycleCase } from '../lifecycleExceptions';
const c: LifecycleCase = {
  case_id: 'a',
  conversation_id: 's',
  is_active: true,
  published_analysis_id: 'current',
  branch_name_raw: null,
};
const a = { case_id: 'a', analysis_id: 'current', is_current: true, superseded_at: null };
describe('lifecycle exceptions never silently enter current truth', () => {
  it('requires exactly one unsuperseded current matching publication', () =>
    expect(lifecycleState(c, [a], false)).toBe('CURRENT_ANALYSIS_AVAILABLE'));
  it('shows pointer drift as historical rather than current', () =>
    expect(lifecycleState({ ...c, published_analysis_id: 'old' }, [a], false)).toBe(
      'HISTORICAL_ONLY'
    ));
  it('does not accept duplicate current analyses', () =>
    expect(lifecycleState(c, [a, { ...a, analysis_id: 'other' }], false)).toBe('HISTORICAL_ONLY'));
  it('makes a newly staged case pending', () =>
    expect(lifecycleState(c, [{ ...a, is_current: false }], false)).toBe('ANALYSIS_PENDING'));
  it('shows a superseded analysis as historical only', () =>
    expect(
      lifecycleState(c, [{ ...a, is_current: false, superseded_at: '2026-10-01' }], false)
    ).toBe('HISTORICAL_ONLY'));
  it('shows missing readable analysis explicitly', () =>
    expect(lifecycleState(c, [], false)).toBe('NOT_ANALYZED'));
  it('reports failure only from persisted failure status', () =>
    expect(
      lifecycleState(
        c,
        [{ ...a, is_current: false, superseded_at: '2026-10-01', pipeline_status: 'failed' }],
        false
      )
    ).toBe('ANALYSIS_FAILED'));
  it('keeps archival outside operational work', () =>
    expect(lifecycleState(c, [a], true)).toBe('ARCHIVED_SOURCE'));
});
