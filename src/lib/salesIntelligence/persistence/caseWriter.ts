// Sales Intelligence Phase H.1B — stable-case (sales_intelligence_cases) writer.
//
// No RPC needed here (unlike analysis/policyEvaluation/attribution/basketInvoiceMatch — see
// design doc §26): `case_id` is a plain primary key, not a versioned "current row" with a partial
// unique index, so a single `INSERT ... ON CONFLICT (case_id) DO UPDATE` is already atomic under
// Postgres's own MVCC — two concurrent upserts for the same case_id serialize naturally at the
// index level, no advisory lock or RPC required (H.1B instruction #7 only requires the RPC
// treatment where the Supabase client alone cannot express the operation safely; this one can).
import type { CaseRowContent } from './mappers';

export interface CaseUpsertResult {
  caseId: string;
  /** True the first time this exact case_id was ever seen; false on every subsequent upsert. */
  wasCreated: boolean;
  /** True when a canonical pointer (customerId/customerPhone/branchId/branchNameRaw/sourceCaseIdV22/conversationId) actually changed value vs. what was already stored — false on a pure last_seen_at touch. */
  canonicalIdentityChanged: boolean;
}

/**
 * Upserts ONE stable case row. `caseId` is received from the pipeline (conversationCaseEngine's own
 * caseId scheme) — this writer NEVER generates one. Only the approved current canonical pointers +
 * last_seen_at are ever written; no semantic/engine output belongs on this table (design doc H.0.1
 * §3) and none is accepted here — `content`'s type (CaseRowContent) structurally excludes it.
 * `supabaseClient` is injected, mirroring invoiceCandidateRetrieval.ts's own established pattern —
 * callers pass a service-role client; this function has no opinion on which key is used.
 */
export async function upsertSalesIntelligenceCase(
  supabaseClient: any,
  caseId: string,
  content: CaseRowContent
): Promise<CaseUpsertResult> {
  // Best-effort pre-read for the wasCreated/canonicalIdentityChanged REPORTING flags only — the
  // actual write below is atomic regardless of what this read saw. Under a genuine race between two
  // concurrent upserts for a brand-new case_id, both callers may report wasCreated=true; that is a
  // harmless reporting artifact (each RPC-less writer legitimately observed "not there yet" at read
  // time), never a correctness issue, since the write itself never depends on this read's result.
  const { data: existing, error: readError } = await supabaseClient
    .from('sales_intelligence_cases')
    .select('case_id, conversation_id, source_case_id_v22, customer_id, customer_phone, branch_id, branch_name_raw')
    .eq('case_id', caseId)
    .maybeSingle();
  if (readError) throw readError;

  const canonicalIdentityChanged =
    !existing ||
    existing.conversation_id !== content.conversationId ||
    existing.source_case_id_v22 !== content.sourceCaseIdV22 ||
    existing.customer_id !== content.customerId ||
    existing.customer_phone !== content.customerPhone ||
    existing.branch_id !== content.branchId ||
    existing.branch_name_raw !== content.branchNameRaw;

  // first_seen_at is deliberately OMITTED from this payload: on INSERT, the column's own
  // `default now()` (see the H.1A migration) applies; on the ON CONFLICT DO UPDATE path, a column
  // absent from the upsert payload is never touched, so an existing case's first_seen_at can never
  // be overwritten. last_seen_at IS explicit and unconditional — "bumped every re-run" (design
  // doc's own SalesIntelligenceCaseRow field comment) applies on every upsert, insert or update.
  const { error: upsertError } = await supabaseClient
    .from('sales_intelligence_cases')
    .upsert(
      {
        case_id: caseId,
        conversation_id: content.conversationId,
        source_case_id_v22: content.sourceCaseIdV22,
        customer_id: content.customerId,
        customer_phone: content.customerPhone,
        branch_id: content.branchId,
        branch_name_raw: content.branchNameRaw,
        case_started_at: content.caseStartedAt,
        case_ended_at: content.caseEndedAt,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'case_id' }
    );
  if (upsertError) throw upsertError;

  return { caseId, wasCreated: !existing, canonicalIdentityChanged };
}
