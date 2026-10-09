import {
  syncWhatsAppCustomerCasesV22,
  type SyncWhatsAppCustomerCasesV22Result,
} from './whatsappCustomerCasePersistenceV22';
import type { WhatsAppCaseContextEngineV27 } from './whatsappCaseContextV27';
import { buildWhatsAppCustomerJourneyIntelligenceV15 } from './whatsappCustomerJourneyIntelligenceV15';
import {
  syncWhatsAppCustomerJourneyV15,
  type JourneySessionSourceV15,
  type JourneySyncResultV15,
} from './whatsappCustomerJourneyPersistenceV15';
import {
  requestCanonicalSalesIntelligenceRefresh,
  type CanonicalCaseSummary,
  type CanonicalRefreshClientResult,
  type ConversationEvaluationRefreshResult,
  type SalesIntelligenceStageStatus,
} from './salesIntelligence/refresh/refreshClient';

// Canonical WhatsApp file orchestrator — the ONE implementation shared by every ingestion path
// (manual Smart Folder and automatic folder ingest):
//
//   Parse -> Canonical Customer Identity -> Durable Source (per case unit)
//     -> Customer Case V22 (critical)
//     -> ONE canonical Sales Intelligence refresh for the V22-owned sources (critical)
//     -> Review draft / Human approval (outside this module)
//
// Side projections — Journey V15, Story V16, evidence links, response timing — are best-effort:
// their failure is reported as a warning and never blocks V22 or Sales Intelligence.
// Sales Intelligence never runs before V22: the Canonical Source Gate refuses sources without
// V22 ownership, so an earlier refresh could only be blocked and would hide the real state.
// A file is "processed" only when every critical stage succeeded (see deriveWhatsAppFileProcessingState).

export type WatcherJourneyStageStatus = 'synced' | 'failed' | 'skipped';
export type WatcherCustomerCaseStageStatus = 'saved' | 'partial' | 'failed' | 'skipped';

export interface WatcherCaseGraphSyncResult {
  journey: { status: WatcherJourneyStageStatus; error: string | null; warnings: string[] };
  customerCase: {
    status: WatcherCustomerCaseStageStatus;
    expected: number;
    saved: number;
    failed: number;
    skipped: number;
    errors: string[];
    /** Sources owned by a saved V22 case — the only sources Sales Intelligence may be asked to admit. */
    savedSourceIds: string[];
  };
}

export interface WatcherCaseGraphSyncDeps {
  syncJourney: () => Promise<JourneySyncResultV15 | null | unknown>;
  syncCustomerCases: () => Promise<SyncWhatsAppCustomerCasesV22Result>;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

function journeyWarnings(value: unknown): string[] {
  const warnings = (value as JourneySyncResultV15 | null)?.warnings;
  return Array.isArray(warnings) ? warnings.map(String) : [];
}

export async function syncWatcherCaseGraph(
  deps: WatcherCaseGraphSyncDeps,
  input: { persistedSourceCount: number; expectedCaseCount: number }
): Promise<WatcherCaseGraphSyncResult> {
  if (input.persistedSourceCount <= 0) {
    return {
      journey: { status: 'skipped', error: null, warnings: [] },
      customerCase: {
        status: input.expectedCaseCount > 0 ? 'failed' : 'skipped',
        expected: input.expectedCaseCount,
        saved: 0,
        failed: 0,
        skipped: input.expectedCaseCount,
        errors: input.expectedCaseCount > 0 ? ['no_persisted_source_for_customer_case'] : [],
        savedSourceIds: [],
      },
    };
  }

  // Journey first only so V22 can link journey/story ids when they exist; a Journey/Story failure
  // is isolated here and the V22 write below always runs.
  let journey: WatcherCaseGraphSyncResult['journey'];
  try {
    const synced = await deps.syncJourney();
    journey = { status: 'synced', error: null, warnings: journeyWarnings(synced) };
  } catch (error) {
    journey = { status: 'failed', error: errorMessage(error), warnings: [] };
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
      savedSourceIds: Array.isArray(result.savedSourceIds) ? [...result.savedSourceIds] : [],
    };
  } catch (error) {
    customerCase = {
      status: 'failed',
      expected: input.expectedCaseCount,
      saved: 0,
      failed: input.expectedCaseCount,
      skipped: 0,
      errors: [errorMessage(error)],
      savedSourceIds: [],
    };
  }

  return { journey, customerCase };
}

function caseModelForFile(caseContexts: WhatsAppCaseContextEngineV27) {
  return {
    ...caseContexts.caseEngine,
    cases: caseContexts.contexts.map((context) => ({
      ...context.caseItem,
      sessionIds: [context.mergedSession.id],
    })),
  };
}

/**
 * Canonical case-graph write for one segmented export, shared by every ingestion path.
 * One V22 case per case context, keyed by its persisted source; Journey V15 is linked independently.
 */
export async function syncCanonicalCaseGraphForFile(input: {
  sourceFileName: string;
  caseContexts: WhatsAppCaseContextEngineV27;
  sessionSources: JourneySessionSourceV15[];
  branch: string | null;
  createdBy: string | null;
}): Promise<WatcherCaseGraphSyncResult> {
  const contexts = input.caseContexts.contexts;
  const caseModel = caseModelForFile(input.caseContexts);
  return syncWatcherCaseGraph(
    {
      syncJourney: () =>
        syncWhatsAppCustomerJourneyV15(
          buildWhatsAppCustomerJourneyIntelligenceV15(contexts.map((context) => context.mergedSession)),
          {
            sourceFileName: input.sourceFileName,
            branch: input.branch,
            createdBy: input.createdBy,
            sessionSources: input.sessionSources,
            sessions: contexts.map((context) => context.mergedSession),
          }
        ),
      syncCustomerCases: () =>
        syncWhatsAppCustomerCasesV22(caseModel, {
          branch: input.branch,
          createdBy: input.createdBy,
          sessionSources: input.sessionSources,
        }),
    },
    { persistedSourceCount: input.sessionSources.length, expectedCaseCount: caseModel.cases.length }
  );
}

// ---------------------------------------------------------------------------------------------
// Canonical Sales Intelligence stage + processing state
// ---------------------------------------------------------------------------------------------

export type CanonicalSalesIntelligenceStageStatus = 'refreshed' | 'partial' | 'failed' | 'skipped';

export interface CanonicalSalesIntelligenceStageResult {
  status: CanonicalSalesIntelligenceStageStatus;
  reason: string | null;
  /** Sources sent in the single refresh request (empty when the stage did not run). */
  requestedSourceIds: string[];
  bySource: Record<string, SalesIntelligenceStageStatus>;
  /** Canonical Product/Need + Operational Disposition per SI case (display truth for ingestion UIs). */
  canonicalCases: CanonicalCaseSummary[];
  conversationEvaluations: ConversationEvaluationRefreshResult[];
  errors: string[];
  authInvalid: boolean;
}

export const WHATSAPP_FILE_PIPELINE_STAGES = [
  'parsed',
  'source_saved',
  'identity_resolved',
  'case_graph_saved',
  'sales_intelligence_refreshed',
  'review_ready',
] as const;
export type WhatsAppFilePipelineStage = (typeof WHATSAPP_FILE_PIPELINE_STAGES)[number];
/** partial = some critical units succeeded (usable, no duplicates) while others failed; never "done". */
export type WhatsAppFilePipelineStageStatus = 'done' | 'partial' | 'failed' | 'skipped';

export interface WhatsAppFileProcessingState {
  stages: Record<WhatsAppFilePipelineStage, WhatsAppFilePipelineStageStatus>;
  /** Human-readable counts per stage, e.g. case_graph_saved: "1/2" (explains partial vs failed). */
  stageDetails?: Partial<Record<WhatsAppFilePipelineStage, string>>;
  /** complete = every critical stage done; partial = something durable exists but the chain is incomplete. */
  outcome: 'complete' | 'partial' | 'failed';
  /** Incomplete files stay retryable; they are never recorded as a full success. */
  retryable: boolean;
  /** Critical-stage failures (block "processed"). */
  blockingErrors: string[];
  /** Side-projection failures (Journey/Story/evidence/timing). Visible, but never block. */
  warnings: string[];
}

export function deriveWhatsAppFileProcessingState(input: {
  parsed: boolean;
  expectedSourceCount: number;
  savedSourceCount: number;
  sourceErrors: string[];
  identityErrors: string[];
  caseGraph: WatcherCaseGraphSyncResult | null;
  salesIntelligence: CanonicalSalesIntelligenceStageResult | null;
  sideWarnings?: string[];
}): WhatsAppFileProcessingState {
  const blockingErrors: string[] = [];
  const warnings = [...(input.sideWarnings || [])];

  const parsed: WhatsAppFilePipelineStageStatus = input.parsed ? 'done' : 'failed';
  if (!input.parsed) blockingErrors.push('parse_failed');

  const allSourcesSaved =
    input.parsed &&
    input.expectedSourceCount > 0 &&
    input.savedSourceCount === input.expectedSourceCount &&
    !input.sourceErrors.length;
  const sourceSaved: WhatsAppFilePipelineStageStatus = !input.parsed
    ? 'skipped'
    : allSourcesSaved
      ? 'done'
      : 'failed';
  if (input.parsed && !allSourcesSaved) {
    blockingErrors.push(
      ...(input.sourceErrors.length
        ? input.sourceErrors
        : [`source_saved ${input.savedSourceCount}/${input.expectedSourceCount}`])
    );
  }

  const identity: WhatsAppFilePipelineStageStatus = !input.parsed
    ? 'skipped'
    : input.identityErrors.length
      ? 'failed'
      : 'done';
  if (input.identityErrors.length) blockingErrors.push(...input.identityErrors);

  const customerCase = input.caseGraph?.customerCase || null;
  const caseGraphDone =
    Boolean(customerCase) &&
    (customerCase!.status === 'saved' || (customerCase!.status === 'skipped' && customerCase!.expected === 0));
  const caseGraph: WhatsAppFilePipelineStageStatus = !input.caseGraph
    ? 'skipped'
    : caseGraphDone
      ? 'done'
      : customerCase!.status === 'partial'
        ? 'partial'
        : 'failed';
  if (input.caseGraph && !caseGraphDone) {
    blockingErrors.push(
      `Customer Case V22 ${customerCase!.status} (${customerCase!.saved}/${customerCase!.expected})${
        customerCase!.errors.length ? ` — ${customerCase!.errors.join(' | ')}` : ''
      }`
    );
  } else if (!input.caseGraph && input.parsed) {
    blockingErrors.push('Customer Case V22 not attempted');
  }

  if (input.caseGraph?.journey.status === 'failed') {
    warnings.push(`Journey V15: ${input.caseGraph.journey.error}`);
  }
  warnings.push(...(input.caseGraph?.journey.warnings || []));

  const si = input.salesIntelligence;
  const siDone = si?.status === 'refreshed';
  const salesIntelligence: WhatsAppFilePipelineStageStatus = !si
    ? 'skipped'
    : siDone
      ? 'done'
      : si.status === 'skipped'
        ? 'skipped'
        : si.status === 'partial'
          ? 'partial'
          : 'failed';
  if (input.parsed && !siDone) {
    blockingErrors.push(
      `Sales Intelligence ${si?.status || 'not_run'}${si?.reason ? ` — ${si.reason}` : ''}${
        si?.errors.length ? ` — ${si.errors.join(' | ')}` : ''
      }`
    );
  }

  const complete =
    parsed === 'done' &&
    sourceSaved === 'done' &&
    identity === 'done' &&
    caseGraph === 'done' &&
    salesIntelligence === 'done';
  const anythingDurable = input.savedSourceCount > 0;

  const stageDetails: Partial<Record<WhatsAppFilePipelineStage, string>> = {};
  if (input.parsed) stageDetails.source_saved = `${input.savedSourceCount}/${input.expectedSourceCount}`;
  if (customerCase) stageDetails.case_graph_saved = `${customerCase.saved}/${customerCase.expected}`;
  if (si && si.requestedSourceIds.length) {
    const allowed = si.requestedSourceIds.filter((id) => si.bySource[id]?.status === 'allowed').length;
    stageDetails.sales_intelligence_refreshed = `${allowed}/${si.requestedSourceIds.length}`;
  }

  return {
    stageDetails,
    stages: {
      parsed,
      source_saved: sourceSaved,
      identity_resolved: identity,
      case_graph_saved: caseGraph,
      sales_intelligence_refreshed: salesIntelligence,
      review_ready: complete ? 'done' : 'skipped',
    },
    outcome: complete ? 'complete' : anythingDurable ? 'partial' : 'failed',
    retryable: !complete,
    blockingErrors: Array.from(new Set(blockingErrors)),
    warnings: Array.from(new Set(warnings.filter(Boolean))),
  };
}

/** The only rule for recording a WhatsApp export as processed in any local/remote ledger. */
export function shouldMarkWhatsAppFileProcessed(state: WhatsAppFileProcessingState) {
  return state.outcome === 'complete';
}

export interface CanonicalFilePipelineDeps {
  syncCaseGraph: () => Promise<WatcherCaseGraphSyncResult>;
  refreshSalesIntelligence: (input: {
    sourceIds: string[];
    accessToken: string;
  }) => Promise<CanonicalRefreshClientResult>;
}

export interface CanonicalFilePipelineResult {
  caseGraph: WatcherCaseGraphSyncResult;
  salesIntelligence: CanonicalSalesIntelligenceStageResult;
}

function emptySalesIntelligence(
  status: CanonicalSalesIntelligenceStageStatus,
  reason: string
): CanonicalSalesIntelligenceStageResult {
  return {
    status,
    reason,
    requestedSourceIds: [],
    bySource: {},
    canonicalCases: [],
    conversationEvaluations: [],
    errors: [],
    authInvalid: false,
  };
}

/**
 * Runs the critical canonical chain for one already-persisted export:
 *   Case Graph (Journey side projection + V22) -> exactly ONE Sales Intelligence refresh.
 * Idempotent: V22 upserts by case_key, the refresh re-derives through semantic hashes, so re-running
 * a partially processed file completes it without duplicating sources, cases or analyses.
 */
export async function runCanonicalCaseGraphAndSalesIntelligence(
  input: { accessToken: string | null },
  deps: CanonicalFilePipelineDeps
): Promise<CanonicalFilePipelineResult> {
  const caseGraph = await deps.syncCaseGraph();
  const sourceIds = Array.from(new Set(caseGraph.customerCase.savedSourceIds.filter(Boolean)));

  if (!sourceIds.length) {
    return {
      caseGraph,
      salesIntelligence: emptySalesIntelligence(
        caseGraph.customerCase.expected > 0 ? 'failed' : 'skipped',
        caseGraph.customerCase.expected > 0 ? 'no_canonical_v22_case_saved' : 'no_case_units'
      ),
    };
  }
  if (!input.accessToken) {
    return {
      caseGraph,
      salesIntelligence: {
        ...emptySalesIntelligence('failed', 'staff_session_unavailable'),
        authInvalid: true,
      },
    };
  }

  let refresh: CanonicalRefreshClientResult;
  try {
    refresh = await deps.refreshSalesIntelligence({ sourceIds, accessToken: input.accessToken });
  } catch (error) {
    return {
      caseGraph,
      salesIntelligence: {
        ...emptySalesIntelligence('failed', 'canonical_refresh_transport_failed'),
        requestedSourceIds: sourceIds,
        errors: [errorMessage(error)],
      },
    };
  }

  const errors = refresh.errors.map((row) => `${row.sourceId}: ${row.message}`);
  const allowed = sourceIds.filter((id) => refresh.bySource[id]?.status === 'allowed').length;
  const status: CanonicalSalesIntelligenceStageStatus = !errors.length
    ? 'refreshed'
    : allowed > 0
      ? 'partial'
      : 'failed';
  return {
    caseGraph,
    salesIntelligence: {
      status,
      reason: refresh.authInvalid ? 'invalid_or_expired_staff_session' : null,
      requestedSourceIds: sourceIds,
      bySource: refresh.bySource,
      canonicalCases: refresh.canonicalCases || [],
      conversationEvaluations: refresh.conversationEvaluations,
      errors,
      authInvalid: refresh.authInvalid,
    },
  };
}

/** Production wiring: canonical case graph for the file, then the single canonical refresh. */
export function runCanonicalWhatsAppFilePipeline(input: {
  sourceFileName: string;
  caseContexts: WhatsAppCaseContextEngineV27;
  sessionSources: JourneySessionSourceV15[];
  branch: string | null;
  createdBy: string | null;
  accessToken: string | null;
}): Promise<CanonicalFilePipelineResult> {
  return runCanonicalCaseGraphAndSalesIntelligence(
    { accessToken: input.accessToken },
    {
      syncCaseGraph: () => syncCanonicalCaseGraphForFile(input),
      refreshSalesIntelligence: ({ sourceIds, accessToken }) =>
        requestCanonicalSalesIntelligenceRefresh({ sourceIds, accessToken }),
    }
  );
}
