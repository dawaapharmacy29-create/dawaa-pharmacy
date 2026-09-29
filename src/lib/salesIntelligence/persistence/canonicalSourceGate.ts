// Canonical Source Gate — the single admission rule for Sales Intelligence persistence.
//
// Contract:
//   Active Canonical Source -> Customer Case V22 -> Sales Intelligence Case
//   -> Canonical Sales Outcome -> Canonical Sale Proof -> Story / Recovery / KPIs
//
// A whatsapp_review_sources row may be analyzed into a Sales Intelligence case only when:
//   1. it is not archived;
//   2. its messages are not already owned by another Customer Case V22 through finer sources
//      of the same export (a coarse re-segmentation of an already represented conversation);
//   3. exactly one Customer Case V22 owns it (root_source_id or source_ids).
// Missing or ambiguous V22 identity is refused explicitly; nothing is guessed.
//
// Reads existing DB truth only (no new tables/migrations). Lookups are batched: at most one
// sibling query plus chunked V22 queries per request, independent of the number of cases.

export const CANONICAL_SOURCE_GATE_CODES = {
  nonCanonical: 'blocked_non_canonical_source',
  missingCase: 'blocked_missing_canonical_case',
  ambiguousCase: 'blocked_ambiguous_canonical_case',
} as const;

export type CanonicalSourceGateDecision =
  | { allowed: true; sourceId: string; v22CaseId: string }
  | {
      allowed: false;
      sourceId: string;
      code: (typeof CANONICAL_SOURCE_GATE_CODES)[keyof typeof CANONICAL_SOURCE_GATE_CODES];
      reason:
        | 'source_archived'
        | 'superseded_by_finer_canonical_sources'
        | 'no_customer_case_v22'
        | 'multiple_customer_cases_v22';
      v22CaseIds: string[];
      supersedingSourceIds: string[];
    };

export interface CanonicalGateSourceRow {
  id: string;
  review_status?: string | null;
  source_filename?: string | null;
  conversation_started_at?: string | null;
  conversation_ended_at?: string | null;
  raw_text?: string | null;
}

export interface CanonicalSourceGateContext {
  /** Active (non-archived) sources of the same export files, within the batch time window. */
  siblings: CanonicalGateSourceRow[];
  /** Customer Case V22 ids owning each source id (root_source_id or source_ids). */
  v22CaseIdsBySource: Map<string, string[]>;
}

const SIBLING_LIMIT = 1000;
const V22_ID_CHUNK = 40;

function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Siblings of the same export whose full text is contained in this source's window and text. */
export function containedSiblingIds(
  source: CanonicalGateSourceRow,
  siblings: CanonicalGateSourceRow[]
): string[] {
  const fileName = String(source.source_filename || '');
  const rawText = String(source.raw_text || '');
  const start = time(source.conversation_started_at);
  const end = time(source.conversation_ended_at);
  if (!fileName || !rawText || start === null || end === null) return [];
  return siblings
    .filter((row) => {
      if (row.id === source.id || row.source_filename !== fileName) return false;
      if (String(row.review_status || '') === 'archived') return false;
      const siblingText = String(row.raw_text || '');
      const siblingStart = time(row.conversation_started_at);
      const siblingEnd = time(row.conversation_ended_at);
      if (!siblingText || siblingStart === null || siblingEnd === null) return false;
      return siblingStart >= start && siblingEnd <= end && rawText.includes(siblingText);
    })
    .map((row) => row.id);
}

export function evaluateCanonicalSourceGate(
  source: CanonicalGateSourceRow,
  context: CanonicalSourceGateContext
): CanonicalSourceGateDecision {
  const sourceId = String(source.id);
  const ownCaseIds = context.v22CaseIdsBySource.get(sourceId) || [];

  if (String(source.review_status || '') === 'archived') {
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.nonCanonical,
      reason: 'source_archived',
      v22CaseIds: ownCaseIds,
      supersedingSourceIds: [],
    };
  }

  // Finer sources only supersede this one when they are canonically represented by V22.
  // Contained sources without a V22 case (e.g. another ingest path) do not own the messages.
  const supersedingSourceIds = containedSiblingIds(source, context.siblings).filter(
    (id) => (context.v22CaseIdsBySource.get(id) || []).length > 0
  );
  if (supersedingSourceIds.length) {
    const supersedingCaseIds = Array.from(
      new Set(supersedingSourceIds.flatMap((id) => context.v22CaseIdsBySource.get(id) || []))
    ).sort();
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.nonCanonical,
      reason: 'superseded_by_finer_canonical_sources',
      v22CaseIds: supersedingCaseIds,
      supersedingSourceIds: supersedingSourceIds.sort(),
    };
  }

  if (ownCaseIds.length === 0) {
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.missingCase,
      reason: 'no_customer_case_v22',
      v22CaseIds: [],
      supersedingSourceIds: [],
    };
  }
  if (ownCaseIds.length > 1) {
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.ambiguousCase,
      reason: 'multiple_customer_cases_v22',
      v22CaseIds: [...ownCaseIds].sort(),
      supersedingSourceIds: [],
    };
  }
  return { allowed: true, sourceId, v22CaseId: ownCaseIds[0] };
}

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

/** Loads the gate context for a batch of sources. Throws on any read failure (fail closed). */
export async function loadCanonicalSourceGateContext(
  service: any,
  sources: CanonicalGateSourceRow[]
): Promise<CanonicalSourceGateContext> {
  const fileNames = Array.from(
    new Set(sources.map((row) => String(row.source_filename || '')).filter(Boolean))
  );
  // One bounded sibling query per export file, scoped to that file's batch time window.
  let siblings: CanonicalGateSourceRow[] = [];
  for (const fileName of fileNames) {
    const fileRows = sources.filter((row) => String(row.source_filename || '') === fileName);
    const fileStarts = fileRows
      .map((row) => time(row.conversation_started_at))
      .filter((x): x is number => x !== null);
    const fileEnds = fileRows
      .map((row) => time(row.conversation_ended_at))
      .filter((x): x is number => x !== null);
    if (!fileStarts.length || !fileEnds.length) continue;
    const { data, error } = (await service
      .from('whatsapp_review_sources')
      .select(
        'id,review_status,source_filename,conversation_started_at,conversation_ended_at,raw_text'
      )
      .eq('source_filename', fileName)
      .gte('conversation_started_at', new Date(Math.min(...fileStarts)).toISOString())
      .lte('conversation_ended_at', new Date(Math.max(...fileEnds)).toISOString())
      .or('review_status.is.null,review_status.neq.archived')
      .limit(SIBLING_LIMIT)) as QueryResult<CanonicalGateSourceRow>;
    if (error) throw new Error(`canonical_source_gate_sibling_lookup_failed: ${error.message}`);
    if ((data || []).length >= SIBLING_LIMIT)
      throw new Error('canonical_source_gate_sibling_lookup_unbounded');
    siblings = siblings.concat((data || []).map((row) => ({ ...row, id: String(row.id) })));
  }

  const lookupIds = new Set(sources.map((row) => String(row.id)));
  for (const source of sources) {
    for (const id of containedSiblingIds(source, siblings)) lookupIds.add(id);
  }

  const v22CaseIdsBySource = await loadV22CaseOwnership(service, Array.from(lookupIds));
  return { siblings, v22CaseIdsBySource };
}

/** Customer Case V22 ids owning each source id (root_source_id or source_ids). Chunked, fail closed. */
export async function loadV22CaseOwnership(
  service: any,
  sourceIds: string[]
): Promise<Map<string, string[]>> {
  const v22CaseIdsBySource = new Map<string, string[]>();
  const ids = Array.from(new Set(sourceIds.map(String).filter(Boolean)));
  for (let index = 0; index < ids.length; index += V22_ID_CHUNK) {
    const chunk = ids.slice(index, index + V22_ID_CHUNK);
    const { data, error } = (await service
      .from('whatsapp_customer_cases_v22')
      .select('id,root_source_id,source_ids')
      .or(
        `root_source_id.in.(${chunk.join(',')}),source_ids.ov.{${chunk.join(',')}}`
      )) as QueryResult<{
      id: string;
      root_source_id: string | null;
      source_ids: string[] | null;
    }>;
    if (error) throw new Error(`canonical_source_gate_case_lookup_failed: ${error.message}`);
    const wanted = new Set(chunk);
    for (const row of data || []) {
      const owners = new Set([
        String(row.root_source_id || ''),
        ...(row.source_ids || []).map(String),
      ]);
      for (const owner of owners) {
        if (!wanted.has(owner)) continue;
        const current = v22CaseIdsBySource.get(owner) || [];
        if (!current.includes(String(row.id)))
          v22CaseIdsBySource.set(owner, [...current, String(row.id)]);
      }
    }
  }
  return v22CaseIdsBySource;
}

// ---------------------------------------------------------------------------------------------
// Canonical Analytical Source Resolver — the single definition used by every reader and writer.
//
//   Canonical analytical source: may be analyzed and counted (sales, opportunities, demand,
//     coverage, doctor performance, customer journey). Exactly the sources the Canonical Source
//     Gate admits: active, not superseded by finer V22-owned sources, owned by exactly one V22 case.
//   Historical/raw snapshot: every other source row (archived, coarse re-segmentation, snapshot
//     without V22, ambiguous identity). Kept for archive/trace, never counted.
//
// Readers pass the rows they already loaded (the sibling set for supersession). raw_text is
// fetched lazily and only for pairs that can actually supersede each other, so a reader does not
// have to load every conversation's text. Replaces the retired snapshot-lineage selector ("fuller snapshot wins"), which contradicted the gate.
// ---------------------------------------------------------------------------------------------

export interface CanonicalAnalyticalResolution {
  canonicalIds: Set<string>;
  decisions: Map<string, CanonicalSourceGateDecision>;
}

/** Pure: resolve with a known V22 ownership map; `rows` are also the supersession siblings. */
export function resolveCanonicalAnalyticalSources(
  rows: CanonicalGateSourceRow[],
  v22CaseIdsBySource: Map<string, string[]>
): CanonicalAnalyticalResolution {
  const siblings = rows.map((row) => ({ ...row, id: String(row.id) }));
  const decisions = new Map<string, CanonicalSourceGateDecision>();
  const canonicalIds = new Set<string>();
  for (const row of siblings) {
    const decision = evaluateCanonicalSourceGate(row, { siblings, v22CaseIdsBySource });
    decisions.set(row.id, decision);
    if (decision.allowed) canonicalIds.add(row.id);
  }
  return { canonicalIds, decisions };
}

/** Loads V22 ownership (and raw_text only where supersession is possible), then resolves. */
export async function loadCanonicalAnalyticalSources(
  service: any,
  rows: CanonicalGateSourceRow[]
): Promise<CanonicalAnalyticalResolution> {
  const normalized = rows.map((row) => ({ ...row, id: String(row.id) }));
  const ownership = await loadV22CaseOwnership(
    service,
    normalized.map((row) => row.id)
  );
  const owned = normalized.filter((row) => (ownership.get(row.id) || []).length > 0);

  // Only a V22-owned outer source can be superseded, and only by a V22-owned inner source of the
  // same export inside its window. Those are the only rows whose text is needed.
  const needText = new Set<string>();
  for (const outer of owned) {
    const start = time(outer.conversation_started_at);
    const end = time(outer.conversation_ended_at);
    if (!outer.source_filename || start === null || end === null) continue;
    for (const inner of owned) {
      if (inner.id === outer.id || inner.source_filename !== outer.source_filename) continue;
      const innerStart = time(inner.conversation_started_at);
      const innerEnd = time(inner.conversation_ended_at);
      if (innerStart === null || innerEnd === null || innerStart < start || innerEnd > end)
        continue;
      needText.add(outer.id);
      needText.add(inner.id);
    }
  }
  const missingText = normalized.filter(
    (row) => needText.has(row.id) && typeof row.raw_text !== 'string'
  );
  if (missingText.length) {
    const textById = new Map<string, string>();
    const ids = missingText.map((row) => row.id);
    for (let index = 0; index < ids.length; index += V22_ID_CHUNK) {
      const { data, error } = (await service
        .from('whatsapp_review_sources')
        .select('id,raw_text')
        .in('id', ids.slice(index, index + V22_ID_CHUNK))) as QueryResult<{
        id: string;
        raw_text: string | null;
      }>;
      if (error) throw new Error(`canonical_source_resolver_text_lookup_failed: ${error.message}`);
      for (const row of data || []) textById.set(String(row.id), String(row.raw_text || ''));
    }
    for (const row of normalized) if (textById.has(row.id)) row.raw_text = textById.get(row.id);
  }
  return resolveCanonicalAnalyticalSources(normalized, ownership);
}
