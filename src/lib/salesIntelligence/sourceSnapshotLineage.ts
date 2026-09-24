// Sales Intelligence review-source snapshot lineage.
//
// A single WhatsApp export filename can be ingested repeatedly as the same chat grows. That
// creates partial snapshots (e.g. morning-only / evening-only) plus a later fuller snapshot.
// Treating every snapshot as an independent conversation duplicates cases and lets one invoice
// appear to "belong" to several copies of the same underlying chat.
//
// This module is PURE. It does not delete or mutate historical sources. It only chooses which
// source ids are canonical for current QA/backfill processing. A source is suppressed only when a
// clearly fuller source for the SAME customer + SAME source filename contains its entire time
// interval and has at least as many messages (strictly more messages or a later created_at tie).
// Non-overlapping snapshots remain independent.
export interface ReviewSourceSnapshotLike {
  id: string;
  source_filename?: string | null;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  conversation_started_at?: string | null;
  conversation_ended_at?: string | null;
  message_count?: number | null;
  created_at?: string | null;
}

function clean(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function identityKey(row: ReviewSourceSnapshotLike): string {
  const id = clean(row.customer_id);
  if (id) return `id:${id}`;
  const code = clean(row.customer_code);
  if (code) return `code:${code}`;
  const phone = clean(row.customer_phone).replace(/\D/g, '');
  if (phone) return `phone:${phone}`;
  return `name:${clean(row.customer_name)}`;
}

function timeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function groupKey(row: ReviewSourceSnapshotLike): string | null {
  const filename = clean(row.source_filename);
  const identity = identityKey(row);
  if (!filename || identity.endsWith(':')) return null;
  return `${identity}|file:${filename}`;
}

function contains(outer: ReviewSourceSnapshotLike, inner: ReviewSourceSnapshotLike): boolean {
  const outerStart = timeMs(outer.conversation_started_at);
  const outerEnd = timeMs(outer.conversation_ended_at);
  const innerStart = timeMs(inner.conversation_started_at);
  const innerEnd = timeMs(inner.conversation_ended_at);
  if (outerStart == null || outerEnd == null || innerStart == null || innerEnd == null) return false;
  return outerStart <= innerStart && outerEnd >= innerEnd;
}

function isClearlyFuller(outer: ReviewSourceSnapshotLike, inner: ReviewSourceSnapshotLike): boolean {
  if (!contains(outer, inner)) return false;
  const outerCount = Number(outer.message_count ?? 0);
  const innerCount = Number(inner.message_count ?? 0);
  if (outerCount > innerCount) return true;
  if (outerCount < innerCount) return false;

  const outerCreated = timeMs(outer.created_at) ?? 0;
  const innerCreated = timeMs(inner.created_at) ?? 0;
  return outerCreated > innerCreated;
}

export function selectCanonicalReviewSourceIds(rows: ReviewSourceSnapshotLike[]): Set<string> {
  const canonical = new Set(rows.map((row) => row.id));
  const groups = new Map<string, ReviewSourceSnapshotLike[]>();

  for (const row of rows) {
    const key = groupKey(row);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  for (const bucket of groups.values()) {
    for (const inner of bucket) {
      const superseded = bucket.some((outer) => outer.id !== inner.id && isClearlyFuller(outer, inner));
      if (superseded) canonical.delete(inner.id);
    }
  }

  return canonical;
}

export function isSupersededReviewSourceSnapshot(
  row: ReviewSourceSnapshotLike,
  allRows: ReviewSourceSnapshotLike[]
): boolean {
  return !selectCanonicalReviewSourceIds(allRows).has(row.id);
}


export interface ReviewSourceSnapshotResolution {
  isCanonical: boolean;
  canonicalSourceId: string;
}

export function resolveReviewSourceSnapshotLineage(
  row: ReviewSourceSnapshotLike,
  allRows: ReviewSourceSnapshotLike[]
): ReviewSourceSnapshotResolution {
  const sameGroup = allRows.filter((candidate) => groupKey(candidate) === groupKey(row));
  if (sameGroup.length === 0) return { isCanonical: true, canonicalSourceId: row.id };

  const canonicalIds = selectCanonicalReviewSourceIds(sameGroup);
  if (canonicalIds.has(row.id)) return { isCanonical: true, canonicalSourceId: row.id };

  const containingCanonical = sameGroup
    .filter((candidate) => canonicalIds.has(candidate.id) && contains(candidate, row))
    .sort((a, b) => {
      const countDiff = Number(b.message_count ?? 0) - Number(a.message_count ?? 0);
      if (countDiff !== 0) return countDiff;
      return (timeMs(b.created_at) ?? 0) - (timeMs(a.created_at) ?? 0);
    })[0];

  return {
    isCanonical: false,
    canonicalSourceId: containingCanonical?.id ?? row.id,
  };
}
