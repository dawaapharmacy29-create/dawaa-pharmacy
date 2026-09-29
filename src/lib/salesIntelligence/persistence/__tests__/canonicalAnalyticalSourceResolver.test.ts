import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateCanonicalSourceGate,
  loadCanonicalAnalyticalSources,
  loadCanonicalSourceGateContext,
  resolveCanonicalAnalyticalSources,
  type CanonicalGateSourceRow,
} from '../canonicalSourceGate';

// One Canonical Analytical Source definition for every reader and writer.

const FILE = 'customer 4250.zip';
const fineA: CanonicalGateSourceRow = {
  id: 'fine-a',
  source_filename: FILE,
  review_status: 'ready_detailed',
  conversation_started_at: '2026-01-02T12:02:21Z',
  conversation_ended_at: '2026-01-02T12:03:48Z',
  raw_text: 'a: hello\nb: hi',
};
const fineB: CanonicalGateSourceRow = {
  id: 'fine-b',
  source_filename: FILE,
  review_status: 'ready_detailed',
  conversation_started_at: '2026-01-02T17:21:18Z',
  conversation_ended_at: '2026-01-02T17:26:10Z',
  raw_text: 'a: evening order',
};
const coarse: CanonicalGateSourceRow = {
  id: 'coarse',
  source_filename: FILE,
  review_status: 'ready_detailed',
  conversation_started_at: '2026-01-02T12:02:21Z',
  conversation_ended_at: '2026-01-02T17:26:10Z',
  raw_text: `${fineA.raw_text}\n${fineB.raw_text}`,
};
const archived: CanonicalGateSourceRow = {
  ...fineA,
  id: 'archived',
  source_filename: 'other.zip',
  review_status: 'archived',
};

const owners = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe('Canonical Analytical Source resolver — rules', () => {
  it('1. coarse + fine for the same messages -> only the fine sources are analytical canonical', () => {
    const { canonicalIds, decisions } = resolveCanonicalAnalyticalSources(
      [fineA, fineB, coarse],
      owners({ 'fine-a': ['v22-1'], 'fine-b': ['v22-1'] })
    );
    expect([...canonicalIds].sort()).toEqual(['fine-a', 'fine-b']);
    expect(decisions.get('coarse')).toMatchObject({
      allowed: false,
      reason: 'superseded_by_finer_canonical_sources',
    });
  });

  it('2. a coarse source alone without V22 is a historical snapshot, not canonical', () => {
    const { canonicalIds, decisions } = resolveCanonicalAnalyticalSources([coarse], owners({}));
    expect(canonicalIds.size).toBe(0);
    expect(decisions.get('coarse')).toMatchObject({ code: 'blocked_missing_canonical_case' });
  });

  it('3. a fine source owned by exactly one V22 case is canonical', () => {
    const { canonicalIds } = resolveCanonicalAnalyticalSources(
      [fineA],
      owners({ 'fine-a': ['v22-1'] })
    );
    expect([...canonicalIds]).toEqual(['fine-a']);
  });

  it('4. an archived source is never canonical, even with a V22 case', () => {
    const { canonicalIds, decisions } = resolveCanonicalAnalyticalSources(
      [archived],
      owners({ archived: ['v22-9'] })
    );
    expect(canonicalIds.size).toBe(0);
    expect(decisions.get('archived')).toMatchObject({ reason: 'source_archived' });
  });

  it('5. a superseded source is never canonical, even when it owns its own V22 case', () => {
    const { canonicalIds, decisions } = resolveCanonicalAnalyticalSources(
      [fineA, fineB, coarse],
      owners({ 'fine-a': ['v22-1'], 'fine-b': ['v22-1'], coarse: ['v22-coarse'] })
    );
    expect(canonicalIds.has('coarse')).toBe(false);
    expect(decisions.get('coarse')).toMatchObject({
      reason: 'superseded_by_finer_canonical_sources',
    });
  });

  it('6. repeated import yields the same canonical identity regardless of row order', () => {
    const ownership = owners({ 'fine-a': ['v22-1'], 'fine-b': ['v22-1'] });
    const first = resolveCanonicalAnalyticalSources([fineA, fineB, coarse], ownership).canonicalIds;
    const again = resolveCanonicalAnalyticalSources([coarse, fineB, fineA], ownership).canonicalIds;
    expect([...again].sort()).toEqual([...first].sort());
  });

  it('never picks one of several V22 cases', () => {
    const { canonicalIds, decisions } = resolveCanonicalAnalyticalSources(
      [fineA],
      owners({ 'fine-a': ['v22-1', 'v22-2'] })
    );
    expect(canonicalIds.size).toBe(0);
    expect(decisions.get('fine-a')).toMatchObject({ code: 'blocked_ambiguous_canonical_case' });
  });
});

function fakeService(
  rows: CanonicalGateSourceRow[],
  cases: Array<{ id: string; root_source_id: string; source_ids: string[] }>
) {
  const textQueries: string[][] = [];
  const service = {
    from(table: string) {
      const state: { filename?: string; ids?: string[] } = {};
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (column === 'source_filename') state.filename = value;
          return chain;
        },
        gte: () => chain,
        lte: () => chain,
        in: (_column: string, ids: string[]) => {
          state.ids = ids;
          textQueries.push(ids);
          return Promise.resolve({
            data: rows
              .filter((row) => ids.includes(row.id))
              .map((row) => ({ id: row.id, raw_text: row.raw_text })),
            error: null,
          });
        },
        or: () =>
          table === 'whatsapp_customer_cases_v22'
            ? Promise.resolve({ data: cases, error: null })
            : chain,
        limit: () =>
          Promise.resolve({
            data: rows.filter((row) => !state.filename || row.source_filename === state.filename),
            error: null,
          }),
      };
      return chain;
    },
  };
  return { service, textQueries };
}

describe('7. every reader and the Sales Intelligence gate return the same source set', () => {
  const rows = [fineA, fineB, coarse, archived];
  const cases = [
    { id: 'v22-1', root_source_id: 'fine-a', source_ids: ['fine-a', 'fine-b'] },
    { id: 'v22-9', root_source_id: 'archived', source_ids: ['archived'] },
  ];

  it('reader resolver (QA / Coverage / Product Demand) == Sales Intelligence admission', async () => {
    const { service } = fakeService(rows, cases);
    const readers = await loadCanonicalAnalyticalSources(service, rows);

    const gateContext = await loadCanonicalSourceGateContext(service, rows);
    const admitted = rows
      .filter((row) => evaluateCanonicalSourceGate(row, gateContext).allowed)
      .map((row) => row.id);

    expect([...readers.canonicalIds].sort()).toEqual(admitted.sort());
    expect(admitted.sort()).toEqual(['fine-a', 'fine-b']);
  });

  it('fetches raw_text lazily, only for V22-owned pairs that can supersede each other', async () => {
    const withoutText = rows.map(({ raw_text: _raw, ...row }) => row);
    const { service, textQueries } = fakeService(rows, [
      { id: 'v22-1', root_source_id: 'fine-a', source_ids: ['fine-a', 'fine-b'] },
      { id: 'v22-c', root_source_id: 'coarse', source_ids: ['coarse'] },
    ]);
    const result = await loadCanonicalAnalyticalSources(service, withoutText);
    expect(textQueries.flat().sort()).toEqual(['coarse', 'fine-a', 'fine-b']);
    expect([...result.canonicalIds].sort()).toEqual(['fine-a', 'fine-b']);
  });

  it('fails closed when V22 ownership cannot be read', async () => {
    const service = {
      from: () => {
        const chain: any = {
          select: () => chain,
          or: () => Promise.resolve({ data: null, error: { message: 'down' } }),
        };
        return chain;
      },
    };
    await expect(loadCanonicalAnalyticalSources(service, [fineA])).rejects.toThrow(
      'canonical_source_gate_case_lookup_failed'
    );
  });
});

describe('no reader keeps a second canonical-source definition', () => {
  const root = path.resolve(__dirname, '../../../../..');
  const readers = [
    'src/components/salesIntelligence/SalesIntelligenceCoveragePanelV1.tsx',
    'src/components/salesIntelligence/ProductDemandLeakageV22.tsx',
    'src/lib/whatsappProductDemandBackfillV22.ts',
    'src/lib/salesIntelligence/qa/queries.ts',
  ];

  it.each(readers)('%s uses the shared resolver', (file) => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    expect(code).toContain('loadCanonicalAnalyticalSources(');
    expect(code).not.toMatch(
      /sourceSnapshotLineage|selectCanonicalReviewSourceIds|resolveReviewSourceSnapshotLineage/
    );
  });

  it('the legacy lineage selector is only used by the read-only backfill dry-run preview', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(full);
        } else if (/\.(ts|tsx|js|cjs)$/.test(entry.name)) {
          const code = fs.readFileSync(full, 'utf8');
          if (
            /selectCanonicalReviewSourceIds|resolveReviewSourceSnapshotLineage|isSupersededReviewSourceSnapshot/.test(
              code
            )
          ) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'server'));
    walk(path.join(root, 'scripts'));
    expect(offenders.sort()).toEqual([
      'scripts/run-sales-intelligence-backfill.cjs',
      'src/lib/salesIntelligence/sourceSnapshotLineage.ts',
    ]);
  });
});
