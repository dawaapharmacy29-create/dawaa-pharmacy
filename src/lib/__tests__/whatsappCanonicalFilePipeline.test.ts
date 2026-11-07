// Canonical WhatsApp file orchestrator — regression for the A1 partial-pipeline incident
// (Source saved, Journey/Story partial, V22 missing, Sales Intelligence never ran, file still
// recorded as processed). Pure dependency injection; no network, no database.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveWhatsAppFileProcessingState,
  runCanonicalCaseGraphAndSalesIntelligence,
  shouldMarkWhatsAppFileProcessed,
  syncWatcherCaseGraph,
  type WatcherCaseGraphSyncResult,
} from '@/lib/whatsappWatcherCaseGraphSync';
import type { CanonicalRefreshClientResult } from '@/lib/salesIntelligence/refresh/refreshClient';

const SOURCE_ID = '4b2f3e27-6847-48f8-b2ef-dea4b319df0b';

function refreshOk(sourceIds: string[]): CanonicalRefreshClientResult {
  return {
    bySource: Object.fromEntries(
      sourceIds.map((id) => [id, { status: 'allowed', reason: null, saleProofState: 'not_proven' }])
    ),
    canonicalCases: [],
    conversationEvaluations: [],
    errors: [],
    authInvalid: false,
  };
}

function v22Saved(sourceIds: string[]) {
  return async () => ({ saved: 1, skipped: 0, failed: 0, failures: [], savedSourceIds: sourceIds });
}

describe('canonical file pipeline — Story/Journey are side projections', () => {
  it('Story RPC failure inside Journey: V22 still persists and canonical SI still runs', async () => {
    const calls: string[] = [];
    const result = await runCanonicalCaseGraphAndSalesIntelligence(
      { accessToken: 'staff-token' },
      {
        syncCaseGraph: () =>
          syncWatcherCaseGraph(
            {
              syncJourney: async () => {
                calls.push('journey');
                // dawaa_refresh_whatsapp_customer_story_v16 is not executable by anon (401/42501)
                throw new Error('permission denied for function dawaa_refresh_whatsapp_customer_story_v16');
              },
              syncCustomerCases: async () => {
                calls.push('v22');
                return { saved: 1, skipped: 0, failed: 0, failures: [], savedSourceIds: [SOURCE_ID] };
              },
            },
            { persistedSourceCount: 1, expectedCaseCount: 1 }
          ),
        refreshSalesIntelligence: async ({ sourceIds }) => {
          calls.push('si');
          return refreshOk(sourceIds);
        },
      }
    );
    expect(calls).toEqual(['journey', 'v22', 'si']);
    expect(result.caseGraph.journey.status).toBe('failed');
    expect(result.caseGraph.customerCase.status).toBe('saved');
    expect(result.salesIntelligence.status).toBe('refreshed');

    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 1,
      savedSourceCount: 1,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: result.caseGraph,
      salesIntelligence: result.salesIntelligence,
    });
    // The side failure is visible, but the canonical chain is complete.
    expect(state.outcome).toBe('complete');
    expect(state.warnings.length).toBeGreaterThan(0);
    expect(state.warnings[0]).toMatch(/Journey V15/);
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(true);
  });

  it('a Story warning returned by Journey (no throw) is surfaced as a warning only', async () => {
    const graph = await syncWatcherCaseGraph(
      {
        syncJourney: async () => ({ warnings: ['Story V16: permission denied'] }),
        syncCustomerCases: v22Saved([SOURCE_ID]),
      },
      { persistedSourceCount: 1, expectedCaseCount: 1 }
    );
    expect(graph.journey.status).toBe('synced');
    expect(graph.journey.warnings).toEqual(['Story V16: permission denied']);
  });
});

describe('canonical file pipeline — Sales Intelligence ordering', () => {
  it('never refreshes Sales Intelligence before or without a saved V22 case', async () => {
    let refreshCalls = 0;
    const result = await runCanonicalCaseGraphAndSalesIntelligence(
      { accessToken: 'staff-token' },
      {
        syncCaseGraph: () =>
          syncWatcherCaseGraph(
            {
              syncJourney: async () => null,
              syncCustomerCases: async () => {
                throw new Error('v22 upsert failed');
              },
            },
            { persistedSourceCount: 1, expectedCaseCount: 1 }
          ),
        refreshSalesIntelligence: async ({ sourceIds }) => {
          refreshCalls += 1;
          return refreshOk(sourceIds);
        },
      }
    );
    expect(refreshCalls).toBe(0);
    expect(result.caseGraph.customerCase.status).toBe('failed');
    expect(result.salesIntelligence.status).toBe('failed');
    expect(result.salesIntelligence.reason).toBe('no_canonical_v22_case_saved');
  });

  it('runs exactly one canonical refresh, after the case graph, for the V22-owned sources only', async () => {
    const order: string[] = [];
    const requested: string[][] = [];
    await runCanonicalCaseGraphAndSalesIntelligence(
      { accessToken: 'staff-token' },
      {
        syncCaseGraph: async () => {
          order.push('case_graph');
          return {
            journey: { status: 'synced', error: null, warnings: [] },
            customerCase: {
              status: 'partial',
              expected: 2,
              saved: 1,
              failed: 1,
              skipped: 0,
              errors: ['case-2: failed'],
              savedSourceIds: ['src-1', 'src-1'],
            },
          } satisfies WatcherCaseGraphSyncResult;
        },
        refreshSalesIntelligence: async ({ sourceIds }) => {
          order.push('si');
          requested.push(sourceIds);
          return refreshOk(sourceIds);
        },
      }
    );
    expect(order).toEqual(['case_graph', 'si']);
    expect(requested).toEqual([['src-1']]);
  });

  it('a missing staff session fails the SI stage visibly instead of being skipped silently', async () => {
    const result = await runCanonicalCaseGraphAndSalesIntelligence(
      { accessToken: null },
      {
        syncCaseGraph: () =>
          syncWatcherCaseGraph(
            { syncJourney: async () => null, syncCustomerCases: v22Saved([SOURCE_ID]) },
            { persistedSourceCount: 1, expectedCaseCount: 1 }
          ),
        refreshSalesIntelligence: async () => {
          throw new Error('must not be called');
        },
      }
    );
    expect(result.salesIntelligence.status).toBe('failed');
    expect(result.salesIntelligence.reason).toBe('staff_session_unavailable');
  });
});

describe('canonical file pipeline — processed ledger only on full success', () => {
  const savedGraph: WatcherCaseGraphSyncResult = {
    journey: { status: 'synced', error: null, warnings: [] },
    customerCase: { status: 'saved', expected: 1, saved: 1, failed: 0, skipped: 0, errors: [], savedSourceIds: [SOURCE_ID] },
  };

  it('A1 incident shape (source saved, V22 missing, SI not run) is partial and retryable', () => {
    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 1,
      savedSourceCount: 1,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: {
        journey: { status: 'failed', error: 'Story RPC 401', warnings: [] },
        customerCase: { status: 'failed', expected: 1, saved: 0, failed: 1, skipped: 0, errors: ['not attempted'], savedSourceIds: [] },
      },
      salesIntelligence: null,
    });
    expect(state.outcome).toBe('partial');
    expect(state.retryable).toBe(true);
    expect(state.stages.source_saved).toBe('done');
    expect(state.stages.case_graph_saved).toBe('failed');
    expect(state.stages.review_ready).toBe('skipped');
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(false);
  });

  it('SI refresh failure after V22 keeps the file unprocessed', () => {
    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 1,
      savedSourceCount: 1,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: savedGraph,
      salesIntelligence: {
        status: 'failed',
        reason: null,
        requestedSourceIds: [SOURCE_ID],
        bySource: {},
        canonicalCases: [],
        conversationEvaluations: [],
        errors: [`${SOURCE_ID}: canonical_refresh_failed`],
        authInvalid: false,
      },
    });
    expect(state.stages.case_graph_saved).toBe('done');
    expect(state.stages.sales_intelligence_refreshed).toBe('failed');
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(false);
  });

  it('a source that failed to persist blocks completion even if the others succeeded', () => {
    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 2,
      savedSourceCount: 1,
      sourceErrors: ['حفظ المصدر (case-2): timeout'],
      identityErrors: [],
      caseGraph: savedGraph,
      salesIntelligence: {
        status: 'refreshed', reason: null, requestedSourceIds: [SOURCE_ID], bySource: {}, canonicalCases: [], conversationEvaluations: [], errors: [], authInvalid: false,
      },
    });
    expect(state.stages.source_saved).toBe('failed');
    expect(state.outcome).toBe('partial');
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(false);
  });

  it('every critical stage done -> complete, review_ready', () => {
    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 1,
      savedSourceCount: 1,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: savedGraph,
      salesIntelligence: {
        status: 'refreshed', reason: null, requestedSourceIds: [SOURCE_ID], bySource: {}, canonicalCases: [], conversationEvaluations: [], errors: [], authInvalid: false,
      },
    });
    expect(state.outcome).toBe('complete');
    expect(state.stages.review_ready).toBe('done');
    expect(state.blockingErrors).toEqual([]);
  });
});

describe('canonical file pipeline — architecture guards', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

  it('Journey V15 and Customer Case V22 never trigger Sales Intelligence themselves', () => {
    for (const file of [
      'src/lib/whatsappCustomerJourneyPersistenceV15.ts',
      'src/lib/whatsappCustomerCasePersistenceV22.ts',
      'src/lib/whatsappCustomerStoryV16.ts',
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/requestCanonicalSalesIntelligenceRefresh/);
      expect(source).not.toMatch(/skipCanonicalSalesIntelligenceRefresh/);
    }
  });

  it('the browser never calls the SECURITY DEFINER story aggregate RPC', () => {
    const story = read('src/lib/whatsappCustomerStoryV16.ts');
    expect(story).not.toMatch(/rpc\(\s*'dawaa_refresh_whatsapp_customer_story_v16'/);
    const server = read('src/lib/salesIntelligence/refresh/storyProjectionRefresh.ts');
    expect(server).toMatch(/dawaa_refresh_whatsapp_customer_story_v16/);
  });

  it('Smart Folder and automatic ingest share the same orchestrator and segmentation', () => {
    for (const file of ['src/pages/WhatsAppSmartFolderWatcher.tsx', 'src/lib/whatsappAutoIngestPipeline.ts']) {
      const source = read(file);
      expect(source).toMatch(/runCanonicalWhatsAppFilePipeline/);
      expect(source).toMatch(/segmentWhatsAppExportCanonical/);
      expect(source).toMatch(/deriveWhatsAppFileProcessingState/);
      expect(source).not.toMatch(/syncWhatsAppCustomerJourneyV15\(/);
      expect(source).not.toMatch(/syncWhatsAppCustomerCasesV22\(/);
      expect(source).not.toMatch(/requestCanonicalSalesIntelligenceRefresh\(/);
    }
  });

  it('Smart Folder identity comes from the canonical resolver, never the name-search resolver', () => {
    const page = read('src/pages/WhatsAppSmartFolderWatcher.tsx');
    expect(page).toMatch(/resolveCanonicalCustomerContexts/);
    const resolver = read('src/lib/whatsappCustomerContextResolver.ts');
    expect(resolver).toMatch(/resolveCanonicalCustomerIdentities/);
    expect(resolver).not.toMatch(/resolveWhatsAppCustomerIdentity\(/);
  });

  it('processed ledgers are written only through shouldMarkWhatsAppFileProcessed', () => {
    for (const file of ['src/pages/WhatsAppSmartFolderWatcher.tsx', 'src/pages/WhatsAppFolderWatcher.tsx']) {
      const source = read(file);
      const marks = source.split('markLocalWhatsAppFileProcessed(candidate.key)').length - 1;
      expect(marks).toBe(1);
      expect(source).toMatch(/shouldMarkWhatsAppFileProcessed\(result\.processing\)\)\s*\{\s*markLocalWhatsAppFileProcessed/);
    }
  });
});
