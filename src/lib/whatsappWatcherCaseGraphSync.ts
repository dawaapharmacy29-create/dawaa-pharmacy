import {
  syncWhatsAppCustomerCasesV22,
  type SyncWhatsAppCustomerCasesV22Result,
} from './whatsappCustomerCasePersistenceV22';
import type { WhatsAppCaseContextEngineV27 } from './whatsappCaseContextV27';
import { buildWhatsAppCustomerJourneyIntelligenceV15 } from './whatsappCustomerJourneyIntelligenceV15';
import {
  syncWhatsAppCustomerJourneyV15,
  type JourneySessionSourceV15,
} from './whatsappCustomerJourneyPersistenceV15';

// Canonical chain written by the watcher for one analyzed export file:
//   Active Canonical Source -> Customer Case V22 -> (server) Sales Intelligence Case -> Canonical Outcome/Proof
// Journey V15 is a side projection. Its failure must never prevent the Customer Case V22 write,
// and a Customer Case V22 failure must be returned to the caller, never only logged.

export type WatcherJourneyStageStatus = 'synced' | 'failed' | 'skipped';
export type WatcherCustomerCaseStageStatus = 'saved' | 'partial' | 'failed' | 'skipped';

export interface WatcherCaseGraphSyncResult {
  journey: { status: WatcherJourneyStageStatus; error: string | null };
  customerCase: {
    status: WatcherCustomerCaseStageStatus;
    expected: number;
    saved: number;
    failed: number;
    skipped: number;
    errors: string[];
  };
}

export interface WatcherCaseGraphSyncDeps {
  syncJourney: () => Promise<unknown>;
  syncCustomerCases: () => Promise<SyncWhatsAppCustomerCasesV22Result>;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

export async function syncWatcherCaseGraph(
  deps: WatcherCaseGraphSyncDeps,
  input: { persistedSourceCount: number; expectedCaseCount: number }
): Promise<WatcherCaseGraphSyncResult> {
  if (input.persistedSourceCount <= 0) {
    return {
      journey: { status: 'skipped', error: null },
      customerCase: {
        status: input.expectedCaseCount > 0 ? 'failed' : 'skipped',
        expected: input.expectedCaseCount,
        saved: 0,
        failed: 0,
        skipped: input.expectedCaseCount,
        errors: input.expectedCaseCount > 0 ? ['no_persisted_source_for_customer_case'] : [],
      },
    };
  }

  let journey: WatcherCaseGraphSyncResult['journey'];
  try {
    await deps.syncJourney();
    journey = { status: 'synced', error: null };
  } catch (error) {
    journey = { status: 'failed', error: errorMessage(error) };
  }

  let customerCase: WatcherCaseGraphSyncResult['customerCase'];
  try {
    const result = await deps.syncCustomerCases();
    const errors = (result.failures || []).map((row) => `${row.caseId}: ${row.message}`);
    if (result.skipped > 0)
      errors.push(`${result.skipped} case(s) skipped: no persisted root source`);
    const complete =
      result.failed === 0 && result.skipped === 0 && result.saved === input.expectedCaseCount;
    customerCase = {
      status: complete ? 'saved' : result.saved > 0 ? 'partial' : 'failed',
      expected: input.expectedCaseCount,
      saved: result.saved,
      failed: result.failed,
      skipped: result.skipped,
      errors:
        complete || errors.length
          ? errors
          : [`saved ${result.saved} of ${input.expectedCaseCount} expected cases`],
    };
  } catch (error) {
    customerCase = {
      status: 'failed',
      expected: input.expectedCaseCount,
      saved: 0,
      failed: input.expectedCaseCount,
      skipped: 0,
      errors: [errorMessage(error)],
    };
  }

  return { journey, customerCase };
}

/**
 * Canonical case-graph write for one segmented export, shared by every ingestion path
 * (Smart Watcher and automatic folder ingest). One V22 case per case context, keyed by its
 * persisted source; Journey V15 is linked independently.
 */
export async function syncCanonicalCaseGraphForFile(input: {
  sourceFileName: string;
  caseContexts: WhatsAppCaseContextEngineV27;
  sessionSources: JourneySessionSourceV15[];
  branch: string | null;
  createdBy: string | null;
}): Promise<WatcherCaseGraphSyncResult> {
  const contexts = input.caseContexts.contexts;
  const caseModel = {
    ...input.caseContexts.caseEngine,
    cases: contexts.map((context) => ({
      ...context.caseItem,
      sessionIds: [context.mergedSession.id],
    })),
  };
  return syncWatcherCaseGraph(
    {
      syncJourney: () =>
        syncWhatsAppCustomerJourneyV15(
          buildWhatsAppCustomerJourneyIntelligenceV15(
            contexts.map((context) => context.mergedSession)
          ),
          {
            sourceFileName: input.sourceFileName,
            branch: input.branch,
            createdBy: input.createdBy,
            sessionSources: input.sessionSources,
          }
        ),
      syncCustomerCases: () =>
        syncWhatsAppCustomerCasesV22(caseModel, {
          branch: input.branch,
          createdBy: input.createdBy,
          sessionSources: input.sessionSources,
          // Automatic ingest performs the canonical refresh immediately after the case graph and
          // owns the returned stage/evaluation status, so the nested V22 call must not run it twice.
          skipCanonicalSalesIntelligenceRefresh: true,
        }),
    },
    { persistedSourceCount: input.sessionSources.length, expectedCaseCount: caseModel.cases.length }
  );
}
