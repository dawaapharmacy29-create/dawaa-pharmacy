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

export async function requestCanonicalSalesIntelligenceRefresh(input: {
  sourceIds: string[];
  accessToken: string;
  concurrency?: number;
  fetchImpl?: typeof fetch;
}): Promise<CanonicalRefreshClientResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sourceIds = Array.from(new Set(input.sourceIds.filter(Boolean)));
  const concurrency = Math.max(1, input.concurrency ?? 3);
  const result: CanonicalRefreshClientResult = {
    bySource: {},
    conversationEvaluations: [],
    errors: [],
    authInvalid: false,
  };

  const refreshOne = async (sourceId: string) => {
    const response = await fetchImpl(CANONICAL_REFRESH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ sourceId }),
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok) {
      const code = String(payload?.error || response.status);
      const reason = String(payload?.reason || code);
      if (code === CANONICAL_SOURCE_GATE_CODES.nonCanonical) {
        // Archived/superseded input is refused by design: not analyzed, not a failure.
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
      return;
    }
    const derived = Array.isArray(payload?.derivedCases) ? payload.derivedCases : [];
    const evaluations = Array.isArray(payload?.conversationEvaluations)
      ? payload.conversationEvaluations
      : [];
    for (const row of evaluations) {
      result.conversationEvaluations.push({
        caseId: String(row?.caseId || ''),
        sourceId: String(row?.sourceId || sourceId),
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
    const proven = derived.some((row: any) => row?.saleProofState === 'proven');
    result.bySource[sourceId] = {
      status: 'allowed',
      reason: null,
      saleProofState: proven ? 'proven' : String(derived[0]?.saleProofState || 'not_proven'),
    };
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
