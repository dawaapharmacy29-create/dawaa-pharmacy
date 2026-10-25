// Re-upload after an audited source correction (in-memory client, no network). The client enforces
// the database contracts this path relies on: unique source_hash, and the retired-hash guard that
// refuses a new source for a hash in whatsapp_review_source_hash_aliases (23505).
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import {
  findReviewSourceByHash,
  hashWhatsAppSession,
  persistAnalyzedWhatsAppSession,
  readStoredSourceBranch,
} from '@/lib/whatsappReviewPersistenceV4';

type Row = Record<string, any>;

function createClient(options: { registryInstalled?: boolean; hiddenSourceIds?: string[] } = {}) {
  const registryInstalled = options.registryInstalled ?? true;
  const hidden = new Set(options.hiddenSourceIds ?? []);
  const tables: Record<string, Row[]> = { whatsapp_review_sources: [], whatsapp_review_audit: [], whatsapp_review_source_hash_aliases: [] };
  let seq = 0;
  let inserts = 0;
  const client = {
    tables,
    get inserts() { return inserts; },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'update' | 'insert' = 'select';
      let payload: Row | null = null;
      let failure: Row | null = null;
      const visible = () => (tables[table] || []).filter((row) => table !== 'whatsapp_review_sources' || !hidden.has(row.id));
      const match = () => visible().filter((row) => filters.every(([key, value]) => row[key] === value));
      const missing = { code: 'PGRST205', message: `Could not find the table 'public.${table}'` };
      const chain: any = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
        maybeSingle: async () => {
          if (table === 'whatsapp_review_source_hash_aliases' && !registryInstalled) return { data: null, error: missing };
          return { data: match()[0] ?? null, error: null };
        },
        single: async () => {
          if (mode === 'insert') return failure ? { data: null, error: failure } : { data: payload, error: null };
          const found = match()[0];
          return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116', message: 'none' } };
        },
        insert: (row: Row) => {
          mode = 'insert';
          const rows = tables[table];
          if (table === 'whatsapp_review_sources') {
            if (rows.some((existing) => existing.source_hash === row.source_hash)) {
              failure = { code: '23505', message: 'duplicate key value violates unique constraint "whatsapp_review_sources_hash_uk"' };
              return chain;
            }
            if (tables.whatsapp_review_source_hash_aliases.some((alias) => alias.source_hash === row.source_hash)) {
              failure = { code: '23505', message: 'source_hash_superseded_by_correction' };
              return chain;
            }
            inserts += 1;
          }
          payload = { id: `src-${++seq}`, ...row };
          rows.push(payload);
          return chain;
        },
        update: (patch: Row) => { mode = 'update'; payload = patch; return chain; },
        then: (resolve: (value: unknown) => void) => {
          if (mode === 'update') for (const row of match()) Object.assign(row, payload);
          resolve({ data: null, error: null });
        },
      };
      return chain;
    },
    /** Mirrors dawaa_correct_whatsapp_source_attribution_v1's effect on identity (synthetic). */
    applyCorrection(sourceId: string, newHash: string, patch: Row) {
      const source = tables.whatsapp_review_sources.find((row) => row.id === sourceId)!;
      tables.whatsapp_review_source_hash_aliases.push({ source_hash: source.source_hash, source_id: sourceId, correction_id: 'c1' });
      Object.assign(source, patch, { source_hash: newHash });
    },
  };
  return client;
}

const FILE = 'synthetic-export.txt';
const conversation = (intro: string) => [
  '[10/20/26, 5:00:00 AM] عميل تجريبي: عندكم كاتفلام 50 مجم؟',
  `[10/20/26, 5:00:30 AM] You: مع حضرتك ${intro} من فرع شكري. غير متوفر حاليًا.`,
  '[10/20/26, 5:01:00 AM] عميل تجريبي: كلمني أول ما يتوفر.',
].join('\n');

function session(text: string) {
  return segmentWhatsAppExportCanonical(parseWhatsAppExport(text), FILE).caseContexts.contexts[0].mergedSession;
}

const intelligence = {
  version: 'whatsapp-review-v4', confidence: 80, requiresHumanApproval: false, priority: 'normal', serviceScore: 70,
  commercialScore: 60, commercialEligible: true, chatSuggestedSold: false, followupRequired: true, suggestedFollowupReason: null,
} as any;

const ORIGINAL = session(conversation('د سامي'));
const CORRECTED = session(conversation('د هالة'));

async function correctedWorld(options?: Parameters<typeof createClient>[0]) {
  const client = createClient(options);
  const first = await persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, { branch: 'كل الفروع' }, { client });
  client.applyCorrection(first.id, await hashWhatsAppSession(CORRECTED), { branch: 'فرع شكري', staff_id: 'staff-hala', staff_name: 'د هالة' });
  return { client, sourceId: first.id };
}

describe('re-upload after an audited source correction', () => {
  it('first upload creates one source and an identical re-upload is a duplicate', async () => {
    const client = createClient();
    const first = await persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client });
    const again = await persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client });
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ id: first.id, duplicate: true });
    expect(client.inserts).toBe(1);
  });

  it('re-uploading the pre-correction export resolves to the corrected source and never reverts it', async () => {
    const { client, sourceId } = await correctedWorld();
    const before = JSON.stringify(client.tables.whatsapp_review_sources);
    for (const mode of ['ingest', 'reanalyze'] as const) {
      const result = await persistAnalyzedWhatsAppSession(ORIGINAL, { ...intelligence, serviceScore: 1 }, { branch: 'كل الفروع', staffId: 'staff-old' }, { client, mode });
      expect(result).toMatchObject({ id: sourceId, duplicate: true, supersededByCorrection: true });
    }
    expect(client.inserts).toBe(1);
    expect(JSON.stringify(client.tables.whatsapp_review_sources)).toBe(before);
    // Branch provenance for the old export is the corrected branch.
    expect(await readStoredSourceBranch(ORIGINAL, client)).toBe('فرع شكري');
  });

  it('re-uploading the corrected export is a plain duplicate of the same source', async () => {
    const { client, sourceId } = await correctedWorld();
    const result = await persistAnalyzedWhatsAppSession(CORRECTED, intelligence, {}, { client });
    expect(result).toMatchObject({ id: sourceId, duplicate: true });
    expect(result.supersededByCorrection).toBeUndefined();
    expect(client.inserts).toBe(1);
  });

  it('uploading both exports together never creates a second source', async () => {
    const { client, sourceId } = await correctedWorld();
    const results = await Promise.all([
      persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client }),
      persistAnalyzedWhatsAppSession(CORRECTED, intelligence, {}, { client }),
      persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client }),
    ]);
    expect(new Set(results.map((row) => row.id))).toEqual(new Set([sourceId]));
    expect(client.inserts).toBe(1);
  });

  it('a lookup that misses the alias still cannot insert: the database refusal resolves to the source', async () => {
    const { client, sourceId } = await correctedWorld();
    // Simulate a stale read: the first lookup sees nothing, the insert is refused as superseded.
    const realFrom = client.from.bind(client);
    let aliasReads = 0;
    (client as any).from = (table: string) => {
      const chain = realFrom(table);
      if (table !== 'whatsapp_review_source_hash_aliases') return chain;
      aliasReads += 1;
      if (aliasReads === 1) chain.maybeSingle = async () => ({ data: null, error: null });
      return chain;
    };
    const result = await persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client });
    expect(result).toMatchObject({ id: sourceId, duplicate: true, supersededByCorrection: true });
    expect(client.inserts).toBe(1);
  });

  it('a retired hash whose source is hidden from this session fails visibly instead of duplicating', async () => {
    const { client, sourceId } = await correctedWorld();
    const hiddenClient = createClient({ hiddenSourceIds: [sourceId] });
    Object.assign(hiddenClient.tables, client.tables);
    await expect(persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client: hiddenClient }))
      .rejects.toThrow('source_hash_superseded_by_correction');
    expect(hiddenClient.inserts).toBe(0);
  });

  it('before the registry migration exists, ingest keeps its previous behavior', async () => {
    const client = createClient({ registryInstalled: false });
    expect(await findReviewSourceByHash(client, await hashWhatsAppSession(ORIGINAL), 'id')).toBeNull();
    const first = await persistAnalyzedWhatsAppSession(ORIGINAL, intelligence, {}, { client });
    expect(first.duplicate).toBe(false);
  });

  it('matches by exact hash only, never by similar text or names', async () => {
    const { client } = await correctedWorld();
    const similar = session(conversation('د سامي').replace('كلمني أول ما يتوفر.', 'كلمني لما يتوفر.'));
    const result = await persistAnalyzedWhatsAppSession(similar, intelligence, {}, { client });
    expect(result.duplicate).toBe(false);
    expect(client.inserts).toBe(2);
  });
});
