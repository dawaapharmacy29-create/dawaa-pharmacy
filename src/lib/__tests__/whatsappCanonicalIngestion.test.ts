import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Canonical ingestion contract shared by the Smart Watcher and automatic folder ingest:
//   raw export -> parse -> canonical segmentation (case units) -> one source per unit
//   -> Customer Case V22 (+ Journey V15) -> Sales Intelligence through the Canonical Source Gate.

const mocks = vi.hoisted(() => ({
  syncCanonicalCaseGraphForFile: vi.fn(),
  requestCanonicalSalesIntelligenceRefresh: vi.fn(),
  syncWhatsAppCustomerJourneyV15: vi.fn(),
  syncWhatsAppCustomerCasesV22: vi.fn(),
  insertedSources: [] as Array<Record<string, any>>,
  exportText: '',
}));

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    let insertPayload: Record<string, any> | null = null;
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      or: () => api,
      ilike: () => api,
      gte: () => api,
      lte: () => api,
      order: () => api,
      limit: () => api,
      update: () => api,
      upsert: () => api,
      insert: (payload: Record<string, any>) => {
        insertPayload = payload;
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => {
        if (table === 'whatsapp_review_sources' && insertPayload) {
          const id = `source-${mocks.insertedSources.length + 1}`;
          mocks.insertedSources.push({ ...insertPayload, id });
          insertPayload = null;
          return Promise.resolve({ data: { id }, error: null });
        }
        return Promise.resolve({ data: { analysis_json: {} }, error: null });
      },
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    return api;
  };
  return { supabase: { from: (table: string) => chain(table) } };
});

vi.mock('@/lib/whatsappExportFileReader', () => ({
  readWhatsAppExportFile: async () => ({
    text: mocks.exportText,
    sourceFileName: 'احمد علي 1234.zip',
    innerFileName: null,
    mediaFiles: [],
  }),
}));
vi.mock('@/lib/whatsappParticipantRoleResolverV15', () => ({
  resolveWhatsAppParticipantRolesV15: async () => ({}),
}));
vi.mock('@/lib/whatsappConversationBranchHint', () => ({
  resolveConversationBranchHint: async () => ({ value: 'فرع شكري' }),
}));
vi.mock('@/lib/whatsappAutomaticReviewPersistence', () => ({
  persistAutomaticWhatsAppReview: async () => ({ status: 'skipped' }),
}));
vi.mock('@/lib/whatsappUnifiedIntelligenceV4', () => ({
  buildUnifiedConversationIntelligence: () => ({}),
  verifySessionAgainstInvoices: async () => ({ status: 'not_found' }),
}));
vi.mock('@/lib/whatsappReviewPersistenceV4', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsappReviewPersistenceV4')>()),
  attachInvoiceVerificationToQueue: async () => undefined,
}));
vi.mock('@/lib/whatsappOperationalIntelligenceV6', () => ({
  buildWhatsAppOperationalIntelligenceV6: () => ({}),
  enrichWhatsAppOperationalProductsV6: async (value: unknown) => value,
  syncWhatsAppOperationalActionsV6: async () => undefined,
}));
vi.mock('@/lib/whatsappProductJourneyV7', () => ({
  enrichWhatsAppOperationalJourneysV7: () => ({
    version: 'test',
    officialScoringEligible: true,
    followupPlan: { priority: 'normal', required: false, reason: null },
    intentConfidence: 80,
    outcomeConfidence: 80,
    operationalOutcome: 'unknown',
  }),
}));
vi.mock('@/lib/whatsappEvidenceLedgerV17', () => ({
  syncWhatsAppEvidenceLedgerV17: async () => undefined,
}));
vi.mock('@/lib/whatsappFollowupSignalDetector', () => ({ detectFollowupSignals: () => [] }));
vi.mock('@/lib/whatsappWatcherCaseGraphSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsappWatcherCaseGraphSync')>()),
  syncCanonicalCaseGraphForFile: mocks.syncCanonicalCaseGraphForFile,
}));
vi.mock('@/lib/salesIntelligence/refresh/refreshClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/salesIntelligence/refresh/refreshClient')>()),
  requestCanonicalSalesIntelligenceRefresh: mocks.requestCanonicalSalesIntelligenceRefresh,
}));
vi.mock('@/lib/whatsappCustomerJourneyPersistenceV15', () => ({
  syncWhatsAppCustomerJourneyV15: mocks.syncWhatsAppCustomerJourneyV15,
}));
vi.mock('@/lib/whatsappCustomerCasePersistenceV22', () => ({
  syncWhatsAppCustomerCasesV22: mocks.syncWhatsAppCustomerCasesV22,
}));

import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { ingestWhatsAppExportFile } from '@/lib/whatsappAutoIngestPipeline';

const EXPORT = [
  '[9/12/26, 9:00:00 AM] احمد علي 1234: عايز بنادول اكسترا علبتين',
  '[9/12/26, 9:02:00 AM] You: متاح يا فندم، الاجمالي 120 جنيه',
  '[9/12/26, 9:05:00 AM] احمد علي 1234: تمام ابعته',
  '[9/12/26, 3:00:00 PM] احمد علي 1234: الاوردر اتأخر',
  '[9/12/26, 3:05:00 PM] You: المندوب في الطريق حالا',
  '[9/14/26, 8:00:00 PM] احمد علي 1234: عايز فيتامين سي',
  '[9/14/26, 8:03:00 PM] You: متاح يا فندم',
].join('\n');
const FILE = 'احمد علي 1234.zip';

const savedCaseGraph = {
  journey: { status: 'synced', error: null },
  customerCase: { status: 'saved', expected: 0, saved: 0, failed: 0, skipped: 0, errors: [] },
};

beforeEach(() => {
  mocks.exportText = EXPORT;
  mocks.insertedSources.length = 0;
  mocks.syncCanonicalCaseGraphForFile.mockReset();
  mocks.syncCanonicalCaseGraphForFile.mockResolvedValue(savedCaseGraph);
  mocks.requestCanonicalSalesIntelligenceRefresh.mockReset();
  mocks.requestCanonicalSalesIntelligenceRefresh.mockResolvedValue({
    bySource: {},
    errors: [],
    authInvalid: false,
  });
});

describe('Canonical Segmentation Contract', () => {
  it('is deterministic: same export -> same case units -> same source hashes', async () => {
    const a = segmentWhatsAppExportCanonical(parseWhatsAppExport(EXPORT), FILE);
    const b = segmentWhatsAppExportCanonical(parseWhatsAppExport(EXPORT), FILE);
    expect(a.caseContexts.contexts.map((c) => c.mergedSession.id)).toEqual(
      b.caseContexts.contexts.map((c) => c.mergedSession.id)
    );
    const hashes = async (seg: typeof a) =>
      Promise.all(seg.caseContexts.contexts.map((c) => hashWhatsAppSession(c.mergedSession)));
    expect(await hashes(a)).toEqual(await hashes(b));
  });

  it('does not use the export filename as canonical source identity', async () => {
    const messages = parseWhatsAppExport(EXPORT);
    const a = segmentWhatsAppExportCanonical(messages, FILE);
    const b = segmentWhatsAppExportCanonical(messages, 'renamed-export-copy.zip');
    const hashes = async (seg: typeof a) =>
      Promise.all(seg.caseContexts.contexts.map((ctx) => hashWhatsAppSession(ctx.mergedSession)));
    expect(await hashes(a)).toEqual(await hashes(b));
  });

  it('partitions the messages: every message belongs to exactly one case unit', () => {
    const messages = parseWhatsAppExport(EXPORT);
    const seg = segmentWhatsAppExportCanonical(messages, FILE);
    const ids = seg.caseContexts.contexts.flatMap((c) => c.mergedSession.messages.map((m) => m.id));
    expect(ids.sort()).toEqual(messages.map((m) => m.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(seg.rawSessionCount).toBeGreaterThanOrEqual(seg.caseContexts.contexts.length);
  });
});

describe('automatic ingest uses the canonical pipeline', () => {
  it('persists one source per canonical case unit with the canonical hash', async () => {
    const seg = segmentWhatsAppExportCanonical(parseWhatsAppExport(EXPORT), FILE);
    const expectedHashes = await Promise.all(
      seg.caseContexts.contexts.map((c) => hashWhatsAppSession(c.mergedSession))
    );
    await ingestWhatsAppExportFile(new File([EXPORT], FILE), { accessToken: 'token' });
    expect(mocks.insertedSources.map((row) => row.source_hash)).toEqual(expectedHashes);
    expect(
      mocks.insertedSources.every((row) => row.parser_version === 'whatsapp-auto-ingest-v3')
    ).toBe(true);
  });

  it('writes Customer Case V22 through the shared case graph and refreshes Sales Intelligence', async () => {
    const result = await ingestWhatsAppExportFile(new File([EXPORT], FILE), {
      accessToken: 'token',
    });
    expect(mocks.syncCanonicalCaseGraphForFile).toHaveBeenCalledTimes(1);
    const [graphInput] = mocks.syncCanonicalCaseGraphForFile.mock.calls[0];
    const sourceIds = mocks.insertedSources.map((row) => row.id);
    expect(graphInput.sessionSources.map((row: any) => row.sourceId)).toEqual(sourceIds);
    expect(graphInput.sessionSources.map((row: any) => row.sessionId)).toEqual(
      graphInput.caseContexts.contexts.map((c: any) => c.mergedSession.id)
    );
    expect(mocks.requestCanonicalSalesIntelligenceRefresh).toHaveBeenCalledWith({
      sourceIds,
      accessToken: 'token',
    });
    expect(result.errors).toEqual([]);
  });

  it('surfaces a Customer Case V22 failure instead of swallowing it', async () => {
    mocks.syncCanonicalCaseGraphForFile.mockResolvedValue({
      journey: { status: 'failed', error: 'journey_down' },
      customerCase: {
        status: 'failed',
        expected: 2,
        saved: 0,
        failed: 2,
        skipped: 0,
        errors: ['boom'],
      },
    });
    const result = await ingestWhatsAppExportFile(new File([EXPORT], FILE), {
      accessToken: 'token',
    });
    expect(result.errors.join(' ')).toContain('Customer Case V22 failed');
    expect(result.errors.join(' ')).toContain('Journey sync failed');
  });

  it('reports a missing staff session instead of silently skipping Sales Intelligence', async () => {
    const result = await ingestWhatsAppExportFile(new File([EXPORT], FILE), {});
    expect(mocks.requestCanonicalSalesIntelligenceRefresh).not.toHaveBeenCalled();
    expect(result.errors.join(' ')).toContain('Sales Intelligence');
  });
});

describe('canonical refresh client', async () => {
  const { requestCanonicalSalesIntelligenceRefresh } = await vi.importActual<
    typeof import('@/lib/salesIntelligence/refresh/refreshClient')
  >('@/lib/salesIntelligence/refresh/refreshClient');

  function fetchReturning(map: Record<string, { status: number; body: unknown }>) {
    return vi.fn(async (_url: string, init: any) => {
      const { sourceId } = JSON.parse(init.body);
      const hit = map[sourceId];
      return { ok: hit.status < 400, status: hit.status, json: async () => hit.body } as Response;
    });
  }

  it('maps allowed, legitimately blocked, broken-chain and auth outcomes', async () => {
    const fetchImpl = fetchReturning({
      ok: { status: 200, body: { derivedCases: [{ saleProofState: 'proven' }] } },
      coarse: {
        status: 409,
        body: {
          error: 'blocked_non_canonical_source',
          reason: 'superseded_by_finer_canonical_sources',
        },
      },
      orphan: {
        status: 409,
        body: { error: 'blocked_missing_canonical_case', reason: 'no_customer_case_v22' },
      },
    });
    const result = await requestCanonicalSalesIntelligenceRefresh({
      sourceIds: ['ok', 'coarse', 'orphan'],
      accessToken: 't',
      fetchImpl: fetchImpl as any,
    });
    expect(result.bySource).toEqual({
      ok: { status: 'allowed', reason: null, saleProofState: 'proven' },
      coarse: {
        status: 'blocked',
        reason: 'superseded_by_finer_canonical_sources',
        saleProofState: null,
      },
      orphan: { status: 'blocked', reason: 'no_customer_case_v22', saleProofState: null },
    });
    expect(result.errors.map((row) => row.sourceId)).toEqual(['orphan']);
  });

  it('stops on an expired staff session', async () => {
    const fetchImpl = fetchReturning({
      a: { status: 401, body: { error: 'invalid_or_expired_staff_session' } },
      b: { status: 401, body: { error: 'invalid_or_expired_staff_session' } },
    });
    const result = await requestCanonicalSalesIntelligenceRefresh({
      sourceIds: ['a', 'b'],
      accessToken: 't',
      concurrency: 1,
      fetchImpl: fetchImpl as any,
    });
    expect(result.authInvalid).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('no ingestion path bypasses the shared canonical steps', () => {
  const read = (file: string) =>
    fs
      .readFileSync(path.resolve(__dirname, '../../..', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const paths = [
    'src/pages/WhatsAppSmartFolderWatcher.tsx',
    'src/lib/whatsappAutoIngestPipeline.ts',
  ];

  it.each(paths)(
    '%s segments, writes V22 and refreshes only through the shared modules',
    (file) => {
      const code = read(file);
      expect(code).toContain('segmentWhatsAppExportCanonical(');
      expect(code).toContain('syncCanonicalCaseGraphForFile(');
      expect(code).toContain('requestCanonicalSalesIntelligenceRefresh(');
      expect(code).not.toMatch(/splitWhatsAppSessions\(|buildWhatsAppCaseContextsV27\(/);
      expect(code).not.toMatch(/syncWhatsAppCustomerCasesV22\(|syncWhatsAppCustomerJourneyV15\(/);
      expect(code).not.toMatch(/JSON\.stringify\(\{\s*sourceId\s*\}\)/);
    }
  );

  it('Smart Watcher fails closed instead of rediscovering canonical sources by filename', () => {
    const code = read('src/pages/WhatsAppSmartFolderWatcher.tsx');
    expect(code).toContain('canonical_source_ids_missing_after_persistence');
    expect(code).not.toContain('sourceFileName: result.fileName');
  });
});

describe('shared case graph sync', () => {
  it('writes one V22 case per canonical unit even when journey sync fails', async () => {
    const actual = await vi.importActual<typeof import('@/lib/whatsappWatcherCaseGraphSync')>(
      '@/lib/whatsappWatcherCaseGraphSync'
    );
    mocks.syncWhatsAppCustomerJourneyV15.mockRejectedValue(new Error('journey_down'));
    mocks.syncWhatsAppCustomerCasesV22.mockImplementation(async (model: any) => ({
      saved: model.cases.length,
      skipped: 0,
      failed: 0,
      failures: [],
    }));
    const seg = segmentWhatsAppExportCanonical(parseWhatsAppExport(EXPORT), FILE);
    const sessionSources = seg.caseContexts.contexts.map((c, i) => ({
      sessionId: c.mergedSession.id,
      sourceId: `source-${i}`,
      contextOnly: false,
    }));
    const result = await actual.syncCanonicalCaseGraphForFile({
      sourceFileName: FILE,
      caseContexts: seg.caseContexts,
      sessionSources,
      branch: null,
      createdBy: null,
    });
    expect(result.journey.status).toBe('failed');
    expect(result.customerCase.status).toBe('saved');
    const [model] = mocks.syncWhatsAppCustomerCasesV22.mock.calls[0];
    expect(model.cases.map((c: any) => c.sessionIds)).toEqual(
      sessionSources.map((row) => [row.sessionId])
    );
  });
});
