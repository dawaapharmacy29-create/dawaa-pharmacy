// Read-only CI audit: the DB owner of operational canonicality
// (public.whatsapp_operational_canonical_sources_v1, V51) and the TS Canonical Source Gate
// resolver (loadCanonicalAnalyticalSources) must admit exactly the same WhatsApp sources.
// Any difference, or any read failure, fails the gate.
import { createClient } from '@supabase/supabase-js';
import { loadCanonicalAnalyticalSources } from '../src/lib/salesIntelligence/persistence/canonicalSourceGate';
import { WHATSAPP_OPERATIONAL_SOURCE_OWNER } from '../src/lib/whatsappOperationalSourceOwner';

const PAGE = 500;
const MAX_ROWS = 20000;

async function main() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, key, { auth: { persistSession: false } });

  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('whatsapp_review_sources')
      .select(
        'id,review_status,source_filename,conversation_started_at,conversation_ended_at,raw_text'
      )
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`source_read_failed: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < PAGE) break;
    if (rows.length >= MAX_ROWS) throw new Error('source_read_unbounded');
  }

  const resolver = await loadCanonicalAnalyticalSources(client, rows);
  const { data: ownerRows, error: ownerError } = await client
    .from(WHATSAPP_OPERATIONAL_SOURCE_OWNER)
    .select('source_id')
    .limit(MAX_ROWS);
  if (ownerError) throw new Error(`owner_read_failed: ${ownerError.message}`);
  const owner = new Set((ownerRows || []).map((row: any) => String(row.source_id)));

  const onlyResolver = [...resolver.canonicalIds].filter((id) => !owner.has(id)).sort();
  const onlyOwner = [...owner].filter((id) => !resolver.canonicalIds.has(id)).sort();
  const summary = {
    sources: rows.length,
    resolverCanonical: resolver.canonicalIds.size,
    ownerCanonical: owner.size,
    onlyResolver,
    onlyOwner,
  };
  console.log('[operational-source-owner-parity]', JSON.stringify(summary));
  if (onlyResolver.length || onlyOwner.length) {
    console.error(
      '[operational-source-owner-parity] FAIL: the DB owner and the TS resolver disagree'
    );
    process.exit(1);
  }
  console.log(
    '[operational-source-owner-parity] PASS: one canonical operational source definition.'
  );
}

main().catch((error) => {
  console.error(
    '[operational-source-owner-parity] FAIL',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
