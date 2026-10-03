// Browser client for the canonical Sales Intelligence refresh transport.
// Shared by every ingestion path (Smart Watcher, automatic folder ingest) so that a persisted
// source reaches the brain through exactly one request contract and one response mapping.
import { CANONICAL_SOURCE_GATE_CODES } from '../persistence/canonicalSourceGate';

export const CANONICAL_REFRESH_ENDPOINT = '/api/sales-intelligence-refresh-source';

export type SalesIntelligenceStageStatus = {
  status: 'allowed' | 'blocked' | 'failed';
  reason: string | null;
  saleProofState: string | null;
};

export interface ConversationEvaluationRefreshResult {
  caseId: string;
  sourceId: string;
  status: string;
  reviewId: string | null;
  finalScore: number | null;
  evidenceCoveragePercent: number | null;
  automaticReliabilityPercent: number | null;
  warning: string | null;
  error: string | null;
}

export interface CanonicalRefreshClientResult {
  bySource: Record<string, SalesIntelligenceStageStatus>;
  conversationEvaluations: ConversationEvaluationRefreshResult[];
  /** Failures that leave the canonical chain incomplete (never includes legitimate non-canonical skips). */
  errors: Array<{ sourceId: string; message: string }>;
  authInvalid: boolean;
}

const AUTH_INVALID_CODES = new Set(['invalid_or_expired_staff_session', 'missing_user_token']);

function createResult(): CanonicalRefreshClientResult {
  return {
    bySource: {},
    conversationEvaluations: [],
    errors: [],
    authInvalid: false,
  };
}

function appendEvaluations(
  result: CanonicalRefreshClientResult,
  payload: any,
  fallbackSourceId: string
) {
  const evaluations = Array.isArray(payload?.conversationEvaluations)
    ? payload.conversationEvaluations
    : [];
  for (const row of evaluations) {
    result.conversationEvaluations.push({
      caseId: String(row?.caseId || ''),
      sourceId: String(row?.sourceId || fallbackSourceId),
      status: String(row?.status || 'unknown'),
      reviewId: row?.reviewId == null ? null : String(row.reviewId),
      finalScore: Number.isFinite(Number(row?.finalScore)) ? Number(row.finalScore) : null,
      evidenceCoveragePercent: Number.isFinite(Number(row?.evidenceCoveragePercent))
        ? Number(row.evidenceCoveragePercent)
        : null,
      automaticReliabilityPercent: Number.isFinite(Number(row?.automaticReliabilityPercent))
        ? Number(row.automaticReliabilityPercent)
        : null,
      warning: row?.warning == null ? null : String(row.warning),
      error: row?.error == null ? null : String(row.error),
    });
  }
}

function appendSuccessfulPage(
  result: CanonicalRefreshClientResult,
  payload: any,
  fallbackSourceId: string
) {
  appendEvaluations(result, payload, fallbackSourceId);

  const blocked = Array.isArray(payload?.blockedSources) ? payload.blockedSources : [];
  for (const row of blocked) {
    const sourceId = String(row?.sourceId || '');
    if (!sourceId) continue;
    result.bySource[sourceId] = {
      status: 'blocked',
      reason: String(row?.reason || row?.error || 'blocked'),
      saleProofState: null,
    };
  }

  const derived = Array.isArray(payload?.derivedCases) ? payload.derivedCases : [];
  const derivedBySource = new Map<string, any[]>();
  for (const row of derived) {
    const sourceId = String(row?.conversationId || fallbackSourceId || '');
    if (!sourceId) continue;
    const current = derivedBySource.get(sourceId) || [];
    current.push(row);
    derivedBySource.set(sourceId, current);
  }
  for (const [sourceId, rows] of derivedBySource) {
    const proven = rows.some((row: any) => row?.saleProofState === 'proven');
    result.bySource[sourceId] = {
      status: 'allowed',
      reason: null,
      saleProofState: proven ? 'proven' : String(rows[0]?.saleProofState || 'not_proven'),
    };
  }
}

function appendHttpFailure(
  result: CanonicalRefreshClientResult,
  response: { status: number },
  payload: any,
  sourceId: string
) {
  const code = String(payload?.error || response.status);
  const reason = String(payload?.reason || code);
  if (code === CANONICAL_SOURCE_GATE_CODES.nonCanonical) {
    result.bySource[sourceId] = { status: 'blocked', reason, saleProofState: null };
    return;
  }
  result.bySource[sourceId] = {
    status: code.startsWith('blocked_') ? 'blocked' : 'failed',
    reason,
    saleProofState: null,
  };
  if (response.status === 401 && AUTH_INVALID_CODES.has(code)) result.authInvalid = true;
  result.errors.push({
    sourceId,
    message: `${code}${payload?.detail ? ` — ${payload.detail}` : ''}`,
  });
}

export async function requestCanonicalSalesIntelligenceRefresh(input: {
  sourceIds: string[];
  accessToken: string;
  concurrency?: number;
  fetchImpl?: typeof fetch;
}): Promise<CanonicalRefreshClientResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sourceIds = Array.from(new Set(input.sourceIds.filter(Boolean)));
  const concurrency = Math.max(1, input.concurrency ?? 3);
  const result = createResult();

  const refreshOne = async (sourceId: string) => {
    const response = await fetchImpl(CANONICAL_REFRESH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ sourceId }),
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok) {
      appendHttpFailure(result, response, payload, sourceId);
      return;
    }
    appendSuccessfulPage(result, payload, sourceId);
    if (!result.bySource[sourceId]) {
      result.bySource[sourceId] = {
        status: 'allowed',
        reason: null,
        saleProofState: 'not_proven',
      };
    }
  };

  for (let index = 0; index < sourceIds.length; index += concurrency) {
    const batch = sourceIds.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map(refreshOne));
    settled.forEach((item, itemIndex) => {
      if (item.status === 'rejected') {
        const sourceId = batch[itemIndex];
        const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
        result.bySource[sourceId] = { status: 'failed', reason: message, saleProofState: null };
        result.errors.push({ sourceId, message });
      }
    });
    if (result.authInvalid) break;
  }
  return result;
}

/**
 * Refreshes every persisted source row for one WhatsApp export file through the same canonical
 * endpoint. The server-side Canonical Source Gate decides which rows are truly analytical sources;
 * coarse/superseded snapshots are blocked while their finer V22-owned sources are refreshed.
 */
export async function requestCanonicalSalesIntelligenceRefreshForFile(input: {
  sourceFileName: string;
  accessToken: string;
  sourceLimit?: number;
  fetchImpl?: typeof fetch;
}): Promise<CanonicalRefreshClientResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sourceFileName = input.sourceFileName.trim();
  const sourceLimit = Math.max(1, Math.min(10, input.sourceLimit ?? 10));
  const result = createResult();
  if (!sourceFileName) {
    result.errors.push({ sourceId: '', message: 'source_file_name_required' });
    return result;
  }

  let sourceOffset = 0;
  let hasMore = true;
  let pageCount = 0;
  while (hasMore) {
    const response = await fetchImpl(CANONICAL_REFRESH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ sourceFileName, sourceOffset, sourceLimit }),
    });
    const payload: any = await response.json().catch(() => null);
    const pageKey = `file:${sourceFileName}:${sourceOffset}`;
    if (!response.ok) {
      appendHttpFailure(result, response, payload, pageKey);
      break;
    }

    appendSuccessfulPage(result, payload, pageKey);
    hasMore = payload?.hasMore === true;
    if (!hasMore) break;

    const nextOffset = Number(payload?.nextOffset);
    if (!Number.isFinite(nextOffset) || nextOffset <= sourceOffset) {
      result.errors.push({ sourceId: pageKey, message: 'invalid_canonical_refresh_pagination' });
      break;
    }
    sourceOffset = nextOffset;
    pageCount += 1;
    if (pageCount > 100) {
      result.errors.push({ sourceId: pageKey, message: 'canonical_refresh_pagination_limit_exceeded' });
      break;
    }
  }
  return result;
}
