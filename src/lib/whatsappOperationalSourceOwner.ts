// Client access to the single owner of operational canonicality for WhatsApp sources:
// public.whatsapp_operational_canonical_sources_v1 (migration V51, mirrors canonicalSourceGate.ts).
// Readers never re-derive the rule; they ask the owner. A failed lookup throws (fail closed):
// callers must show nothing as current rather than guess.

export const WHATSAPP_OPERATIONAL_SOURCE_OWNER = 'whatsapp_operational_canonical_sources_v1';

const CHUNK = 150;

/** Subset of `sourceIds` that are operationally canonical now. Bounded, chunked, fail closed. */
export async function loadOperationalSourceIds(
  client: any,
  sourceIds: string[]
): Promise<Set<string>> {
  const ids = Array.from(new Set(sourceIds.map(String).filter(Boolean)));
  const operational = new Set<string>();
  for (let index = 0; index < ids.length; index += CHUNK) {
    const { data, error } = await client
      .from(WHATSAPP_OPERATIONAL_SOURCE_OWNER)
      .select('source_id')
      .in('source_id', ids.slice(index, index + CHUNK));
    if (error) throw new Error(`operational_source_owner_lookup_failed: ${error.message}`);
    for (const row of data || []) operational.add(String(row.source_id));
  }
  return operational;
}
