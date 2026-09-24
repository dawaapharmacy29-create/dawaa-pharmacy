import { describe, expect, it } from 'vitest';
import {
  resolveReviewSourceSnapshotLineage,
  selectCanonicalReviewSourceIds,
} from '@/lib/salesIntelligence/sourceSnapshotLineage';

describe('Sales Intelligence source snapshot lineage', () => {
  const partial = {
    id: 'partial',
    source_filename: 'customer.zip',
    customer_code: '4250',
    conversation_started_at: '2026-09-15T06:46:45.000Z',
    conversation_ended_at: '2026-09-15T06:47:59.000Z',
    message_count: 9,
    created_at: '2026-09-16T08:00:00.000Z',
  };
  const full = {
    id: 'full',
    source_filename: 'customer.zip',
    customer_code: '4250',
    conversation_started_at: '2026-09-15T06:46:45.000Z',
    conversation_ended_at: '2026-09-15T17:07:51.000Z',
    message_count: 43,
    created_at: '2026-09-21T08:00:00.000Z',
  };

  it('marks a contained partial export as superseded and points to the fuller source', () => {
    const result = resolveReviewSourceSnapshotLineage(partial, [partial, full]);
    expect(result.isCanonical).toBe(false);
    expect(result.canonicalSourceId).toBe('full');
  });

  it('keeps the fuller containing snapshot canonical', () => {
    const result = resolveReviewSourceSnapshotLineage(full, [partial, full]);
    expect(result.isCanonical).toBe(true);
    expect(result.canonicalSourceId).toBe('full');
  });

  it('does not collapse non-overlapping exports for the same customer/file', () => {
    const later = {
      ...partial,
      id: 'later',
      conversation_started_at: '2026-09-16T06:00:00.000Z',
      conversation_ended_at: '2026-09-16T07:00:00.000Z',
      created_at: '2026-09-17T08:00:00.000Z',
    };
    const ids = selectCanonicalReviewSourceIds([partial, later]);
    expect(ids.has('partial')).toBe(true);
    expect(ids.has('later')).toBe(true);
  });

  it('does not collapse two different customers that happen to share a filename', () => {
    const other = { ...full, id: 'other', customer_code: '9999' };
    const ids = selectCanonicalReviewSourceIds([partial, other]);
    expect(ids.has('partial')).toBe(true);
    expect(ids.has('other')).toBe(true);
  });
});
