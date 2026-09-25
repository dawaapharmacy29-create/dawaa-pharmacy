// Sales Intelligence Phase G — Invoice Candidate Retrieval Boundary.
//
// Deliberately split from salesIntelligencePipeline.ts's pure orchestration. All invoice-table I/O
// is delegated to the approved invoiceRecordReadModel boundary. buildInvoiceCandidateQuery()
// is a pure, deterministic, testable function; fetchInvoiceCandidates() is the thin I/O boundary
// around it. Neither function scores, ranks, or selects an invoice — that is Phase D's job alone
// (deriveSaleAttributionAssessment). This module only narrows "which invoices are even worth
// asking Phase D about" using conservative, always-bounded constraints, so a case-level lookup
// never becomes a full-table scan.
import { normalizeEgyptianCustomerPhone, isValidEgyptianCustomerMobile } from '../customers/customerIdentity';
import { getInvoiceId, type InvoiceLike } from '../invoices/invoiceCore';
import { readInvoiceRecordsByIdentityWindow } from '../readModels/invoiceRecordReadModel';

/**
 * Real-data-informed window (read-only investigation, Supabase project jkjqeqkshllustwlzzbf,
 * `whatsapp_review_sources` rows with `invoice_match_status = 'verified'`, n=40): the gap between
 * `conversation_ended_at` and `matched_invoice_date` has a median of ~7h and a p90 of ~122h
 * (~5 days), with a small negative tail (an invoice recorded slightly before the conversation's
 * own end — clock skew / mid-conversation invoice creation). `afterCaseEndHours: 168` (7 days)
 * comfortably covers the observed p90 with margin; `beforeCaseStartHours: 24` covers that
 * pre-dating tail without opening the window to unrelated older purchases.
 */
export const CANDIDATE_RETRIEVAL_TIME_WINDOW = {
  beforeCaseStartHours: 24,
  afterCaseEndHours: 168,
} as const;

/** A hard ceiling — this boundary must never return an unbounded result set. */
export const CANDIDATE_RETRIEVAL_MAX_ROWS = 200;

/**
 * Everything this boundary needs about ONE case to build a conservative query. Deliberately takes
 * the case's own SEGMENTED `startedAt`/`endedAt` (ConversationCase, Phase B) — never a coarse
 * whole-thread timestamp like `whatsapp_review_sources.conversation_ended_at` — so the time window
 * is anchored to the actual commercial interaction, not the entire multi-day WhatsApp thread it
 * came from.
 */
export interface InvoiceCandidateQueryContext {
  caseId: string;
  customerId: string | null;
  customerPhone: string | null;
  branchNameRaw: string | null;
  /** == ConversationCase.startedAt for this exact case — never a conversation-level timestamp. */
  caseStartedAt: string;
  /** == ConversationCase.endedAt for this exact case — never a conversation-level timestamp. */
  caseEndedAt: string | null;
}

export interface InvoiceCandidateQuery {
  caseId: string;
  customerId: string | null;
  customerPhoneNormalized: string | null;
  /** Carried through for visibility/logging only — this boundary never filters by branch (see buildInvoiceCandidateQuery's own comment). */
  branchNameRaw: string | null;
  windowStartIso: string;
  windowEndIso: string;
  limit: number;
}

/**
 * Pure query-spec builder — no I/O, fully deterministic, unit-testable without a database.
 * Branch is deliberately NOT used as a hard filter: it is a real signal but not always reliable
 * (a customer may message from one branch's number and buy at another), and Phase D already scores
 * branch match at the candidate level (classifyBranch). Narrowing retrieval by branch risks a false
 * negative (excluding the real invoice) for a cost this boundary doesn't need to pay — the
 * identity + time-window constraints already keep the query bounded.
 */
export function buildInvoiceCandidateQuery(context: InvoiceCandidateQueryContext): InvoiceCandidateQuery {
  const startMs = new Date(context.caseStartedAt).getTime();
  const endMsRaw = context.caseEndedAt ? new Date(context.caseEndedAt).getTime() : NaN;
  const endMs = Number.isFinite(endMsRaw) ? Math.max(endMsRaw, startMs) : startMs;

  const windowStart = new Date(startMs - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 3600_000);
  const windowEnd = new Date(endMs + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 3600_000);

  const normalizedPhone = context.customerPhone ? normalizeEgyptianCustomerPhone(context.customerPhone) : '';
  const customerPhoneNormalized = isValidEgyptianCustomerMobile(normalizedPhone) ? normalizedPhone : null;

  return {
    caseId: context.caseId,
    customerId: context.customerId,
    customerPhoneNormalized,
    branchNameRaw: context.branchNameRaw,
    windowStartIso: windowStart.toISOString(),
    windowEndIso: windowEnd.toISOString(),
    limit: CANDIDATE_RETRIEVAL_MAX_ROWS,
  };
}

/**
 * The read-only I/O boundary. Requires a resolved identity (customer id or a valid Egyptian
 * mobile) — with neither, this NEVER falls back to scanning the whole `sales_invoices` table; it
 * returns an empty candidate set instead (an honest `insufficient_data` upstream, never a guess).
 * `supabaseClient` is injected (rather than imported directly) so this stays trivially testable and
 * so callers reuse the app's single existing `@/lib/supabase` client instance.
 */
// Kept as `any` deliberately: the real @supabase/supabase-js query-builder type is a long
// generic chain that adds no real safety here (every .gte/.lte/.eq/.or/.limit call already
// narrows nothing useful across a raw `sales_invoices` table with no generated TS schema — see
// InvoiceLike's own module comment in invoiceCore.ts). Injected so callers reuse the app's single
// existing `@/lib/supabase` client instance and this boundary stays trivially fakeable in tests.
export async function fetchInvoiceCandidates(supabaseClient: any, query: InvoiceCandidateQuery): Promise<InvoiceLike[]> {
  if (!query.customerId && !query.customerPhoneNormalized) return [];

  // Keep each identity lookup index-friendly. A single PostgREST OR across customer_phone and
  // whatsapp_phone has repeatedly hit PostgreSQL statement_timeout on the production invoice
  // table even with bounded dates. These independent lookups preserve the same identity surface,
  // then merge duplicate invoices before Phase D scores anything.
  async function fetchByIdentity(
    column: 'customer_id' | 'customer_phone' | 'whatsapp_phone',
    value: string
  ): Promise<InvoiceLike[]> {
    return (await readInvoiceRecordsByIdentityWindow({
      column,
      value,
      windowStartIso: query.windowStartIso,
      windowEndIso: query.windowEndIso,
      limit: query.limit,
      client: supabaseClient,
    })) as InvoiceLike[];
  }

  const lookups: Array<Promise<InvoiceLike[]>> = [];
  if (query.customerId) {
    lookups.push(fetchByIdentity('customer_id', query.customerId));
  }
  if (query.customerPhoneNormalized) {
    lookups.push(fetchByIdentity('customer_phone', query.customerPhoneNormalized));
    lookups.push(fetchByIdentity('whatsapp_phone', query.customerPhoneNormalized));
  }

  const resultSets = await Promise.all(lookups);
  const merged = new Map<string, InvoiceLike>();
  let fallbackIndex = 0;

  // Identity priority only matters in the pathological case where the merged candidate pool
  // exceeds the global hard cap: customer_id first, then customer_phone, then whatsapp_phone.
  for (const rows of resultSets) {
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      const rawId = String(record.id ?? '').trim();
      const invoiceId = getInvoiceId(row);
      const invoiceDatetime = String(record.invoice_datetime ?? '').trim();
      const branch = String(record.branch ?? record.branch_name ?? '').trim();
      const stableKey = rawId
        || (invoiceId ? `${invoiceId}|${invoiceDatetime}|${branch}` : '')
        || `fallback:${fallbackIndex++}`;

      if (!merged.has(stableKey)) merged.set(stableKey, row);
      if (merged.size >= query.limit) return Array.from(merged.values());
    }
  }

  return Array.from(merged.values());
}
