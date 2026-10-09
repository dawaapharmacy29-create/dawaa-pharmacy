import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession } from './whatsappConversationParser';
import type { UnifiedConversationIntelligence, UnifiedInvoiceVerification } from './whatsappUnifiedIntelligenceV4';

export type ReviewQueueStatus = 'new' | 'ready_quick' | 'ready_detailed' | 'needs_context' | 'approved' | 'rejected' | 'archived';

export interface PersistSessionContext {
  sourceFileName?: string | null;
  innerFileName?: string | null;
  branch?: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  createdBy?: string | null;
  /**
   * Version of the full derived analysis written into analysis_version. Defaults to the
   * intelligence engine version. Callers that persist a composite analysis (Smart Folder) pass
   * their composite version so a reanalysis is observable in the database.
   */
  analysisVersion?: string | null;
}

/**
 * ingest:     a source with the same hash is never duplicated; the existing row is returned as is.
 * reanalyze:  the same durable source is kept and only its derived analysis fields are rebuilt with
 *             the current engines. Human/reviewer/invoice-confirmation fields are never touched.
 */
export type PersistSessionMode = 'ingest' | 'reanalyze';

export interface PersistSessionOptions {
  mode?: PersistSessionMode;
  /** Injected for tests; defaults to the browser Supabase client. */
  client?: any;
}

export interface PersistSessionResult {
  id: string;
  duplicate: boolean;
  sourceHash: string;
  reviewStatus: ReviewQueueStatus;
  /** Only for mode=reanalyze on an existing source. */
  reanalysis?: {
    status: 'updated' | 'unchanged';
    fromVersion: string | null;
    toVersion: string;
  };
}

/**
 * Derived-analysis columns a reanalysis may rewrite. Everything else on whatsapp_review_sources is
 * either durable source identity (hash, raw text, timestamps), human workflow (review_status,
 * official_review_id, reviewer_*), manual invoice confirmation (invoice_link_confirmed*) or a
 * manual correction (staff_id/staff_name/customer identity once set) and is preserved.
 */
export const REANALYSIS_DERIVED_COLUMNS = [
  'analysis_version',
  'analysis_status',
  'priority',
  'analysis_confidence',
  'service_score',
  'commercial_score',
  'commercial_eligible',
  'chat_suggested_sold',
  'followup_required',
  'suggested_followup_reason',
  'analysis_json',
] as const;

/** Fields a reanalysis may only fill when they are still empty (never overwrite a correction). */
const REANALYSIS_FILL_ONLY_COLUMNS = [
  'branch',
  'customer_id',
  'customer_code',
  'customer_name',
  'customer_phone',
  'staff_id',
  'staff_name',
] as const;

/** Identity groups: [id column, ...columns that must belong to that same id]. */
const CUSTOMER_IDENTITY_COLUMNS = ['customer_id', 'customer_code', 'customer_name', 'customer_phone'] as const;
const STAFF_IDENTITY_COLUMNS = ['staff_id', 'staff_name'] as const;

const EXISTING_SOURCE_COLUMNS = [
  'id',
  'source_hash',
  'review_status',
  ...REANALYSIS_DERIVED_COLUMNS,
  ...REANALYSIS_FILL_ONLY_COLUMNS,
].join(',');

function sessionRawText(session: WhatsAppConversationSession) {
  return session.messages.map((m) => m.raw || `${m.rawTimestamp} ${m.sender}: ${m.text}`).join('\n');
}

function fallbackHash(input: string) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export async function hashWhatsAppSession(session: WhatsAppConversationSession) {
  const raw = sessionRawText(session);
  const payload = `${session.startedAt.toISOString()}|${session.endedAt.toISOString()}|${raw}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  return `fallback-${fallbackHash(payload)}`;
}

/**
 * The branch already stored on this conversation's source row (same source_hash), or null for a
 * conversation never saved before. It is the conversation's branch provenance: a re-import or the
 * Smart Folder must pass it to resolveConversationBranchHint so a staff home branch never replaces it.
 */
export async function readStoredSourceBranch(session: WhatsAppConversationSession, client: any = supabase): Promise<string | null> {
  const sourceHash = await hashWhatsAppSession(session);
  const { data, error } = await client
    .from('whatsapp_review_sources')
    .select('branch')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  const branch = typeof data?.branch === 'string' ? data.branch.trim() : '';
  return branch || null;
}

export function inferQueueStatus(intelligence: UnifiedConversationIntelligence): ReviewQueueStatus {
  if (intelligence.confidence < 60) return 'needs_context';
  if (intelligence.requiresHumanApproval || intelligence.priority === 'urgent') return 'ready_detailed';
  return 'ready_quick';
}

function serializeIntelligence(value: UnifiedConversationIntelligence) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function blank(value: unknown) {
  return value == null || String(value).trim() === '';
}

function derivedAnalysisPatch(
  intelligence: UnifiedConversationIntelligence,
  analysisVersion: string,
  existingAnalysisJson: unknown
) {
  // Keys written by other derived writers on the same source (e.g. automatic ingest's
  // `operational`, `customerIdentity`) stay; keys this engine produces are replaced.
  const previous =
    existingAnalysisJson && typeof existingAnalysisJson === 'object' && !Array.isArray(existingAnalysisJson)
      ? (existingAnalysisJson as Record<string, unknown>)
      : {};
  return {
    analysis_version: analysisVersion,
    analysis_status: intelligence.requiresHumanApproval ? 'needs_review' : 'analyzed',
    priority: intelligence.priority,
    analysis_confidence: intelligence.confidence,
    service_score: intelligence.serviceScore,
    commercial_score: intelligence.commercialScore,
    commercial_eligible: intelligence.commercialEligible,
    chat_suggested_sold: intelligence.chatSuggestedSold,
    followup_required: intelligence.followupRequired,
    suggested_followup_reason: intelligence.suggestedFollowupReason,
    analysis_json: { ...previous, ...serializeIntelligence(intelligence) },
  };
}

async function reanalyzeExistingSource(
  client: any,
  existing: Record<string, any>,
  intelligence: UnifiedConversationIntelligence,
  context: PersistSessionContext,
  sourceHash: string,
  fallbackReviewStatus: ReviewQueueStatus
): Promise<PersistSessionResult> {
  const id = String(existing.id);
  const reviewStatus = (existing.review_status || fallbackReviewStatus) as ReviewQueueStatus;
  const toVersion = String(context.analysisVersion || intelligence.version);
  const fromVersion = existing.analysis_version == null ? null : String(existing.analysis_version);
  const derived = derivedAnalysisPatch(intelligence, toVersion, existing.analysis_json);

  const fillValues: Record<string, unknown> = {
    branch: context.branch,
    customer_id: context.customerId,
    customer_code: context.customerCode,
    customer_name: context.customerName,
    customer_phone: context.customerPhone,
    staff_id: context.staffId,
    staff_name: context.staffName,
  };
  const patch: Record<string, unknown> = {};
  for (const column of REANALYSIS_DERIVED_COLUMNS) {
    const next = (derived as Record<string, unknown>)[column];
    if (stableJson(next) !== stableJson(existing[column])) patch[column] = next;
  }
  const identityGroups = [CUSTOMER_IDENTITY_COLUMNS, STAFF_IDENTITY_COLUMNS] as const;
  for (const column of REANALYSIS_FILL_ONLY_COLUMNS) {
    if (identityGroups.some((group) => (group as readonly string[]).includes(column))) continue;
    if (blank(existing[column]) && !blank(fillValues[column])) patch[column] = fillValues[column];
  }
  // Identity columns move as ONE group: a newly resolved id brings its own name/code/phone (the
  // earlier unresolved hints are replaced and kept in the audit), an existing id is never touched,
  // and without an id only empty hint columns are filled.
  for (const group of identityGroups) {
    const [idColumn, ...detailColumns] = group;
    if (!blank(existing[idColumn])) continue;
    if (!blank(fillValues[idColumn])) {
      for (const column of group) {
        if (stableJson(fillValues[column] ?? null) !== stableJson(existing[column] ?? null)) patch[column] = fillValues[column] ?? null;
      }
      continue;
    }
    for (const column of detailColumns) {
      if (blank(existing[column]) && !blank(fillValues[column])) patch[column] = fillValues[column];
    }
  }

  if (!Object.keys(patch).length) {
    return { id, duplicate: true, sourceHash, reviewStatus, reanalysis: { status: 'unchanged', fromVersion, toVersion } };
  }

  const { error } = await client
    .from('whatsapp_review_sources')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;

  const before: Record<string, unknown> = {};
  for (const column of Object.keys(patch)) {
    before[column] = column === 'analysis_json' ? { version: existing.analysis_json?.version ?? null } : existing[column];
  }
  const after: Record<string, unknown> = {};
  for (const column of Object.keys(patch)) {
    after[column] = column === 'analysis_json' ? { version: (patch.analysis_json as any)?.version ?? null } : patch[column];
  }
  await appendWhatsAppReviewAudit(
    id,
    'analysis_reanalyzed',
    { from_version: fromVersion, ...before },
    { to_version: toVersion, changed_columns: Object.keys(patch), ...after },
    null,
    context.createdBy || null,
    null,
    null,
    client
  );
  return { id, duplicate: true, sourceHash, reviewStatus, reanalysis: { status: 'updated', fromVersion, toVersion } };
}

export async function persistAnalyzedWhatsAppSession(
  session: WhatsAppConversationSession,
  intelligence: UnifiedConversationIntelligence,
  context: PersistSessionContext = {},
  options: PersistSessionOptions = {},
): Promise<PersistSessionResult> {
  const client = options.client ?? supabase;
  const mode: PersistSessionMode = options.mode ?? 'ingest';
  const sourceHash = await hashWhatsAppSession(session);
  const reviewStatus = inferQueueStatus(intelligence);
  const rawText = sessionRawText(session);
  const analysisVersion = String(context.analysisVersion || intelligence.version);

  const { data: existing, error: existingError } = await client
    .from('whatsapp_review_sources')
    .select(EXISTING_SOURCE_COLUMNS)
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;
  if (existing?.id) {
    if (mode === 'reanalyze') {
      return reanalyzeExistingSource(client, existing, intelligence, context, sourceHash, reviewStatus);
    }
    return { id: String(existing.id), duplicate: true, sourceHash, reviewStatus: (existing.review_status || reviewStatus) as ReviewQueueStatus };
  }

  // A staff name is written only with its resolved staff id; an unresolved/ambiguous owner stays empty
  // (never the first outbound display name).
  const staffName = context.staffId ? context.staffName || null : null;
  const customerName = context.customerName || session.customerName || null;
  const { data, error } = await client
    .from('whatsapp_review_sources')
    .insert({
      source_hash: sourceHash,
      source_type: 'whatsapp_export',
      source_filename: context.sourceFileName || null,
      inner_filename: context.innerFileName || null,
      branch: context.branch || null,
      customer_id: context.customerId || null,
      customer_code: context.customerCode || null,
      customer_name: customerName,
      customer_phone: context.customerPhone || null,
      staff_id: context.staffId || null,
      staff_name: staffName,
      conversation_started_at: session.startedAt.toISOString(),
      conversation_ended_at: session.endedAt.toISOString(),
      message_count: session.messages.length,
      parser_version: 'whatsapp-review-v4',
      review_status: reviewStatus,
      ...derivedAnalysisPatch(intelligence, analysisVersion, null),
      raw_text: rawText,
      created_by: context.createdBy || null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: dupe, error: dupeError } = await client.from('whatsapp_review_sources').select(EXISTING_SOURCE_COLUMNS).eq('source_hash', sourceHash).single();
      if (dupeError) throw dupeError;
      if (mode === 'reanalyze') {
        return reanalyzeExistingSource(client, dupe, intelligence, context, sourceHash, reviewStatus);
      }
      return { id: String(dupe.id), duplicate: true, sourceHash, reviewStatus: (dupe.review_status || reviewStatus) as ReviewQueueStatus };
    }
    throw error;
  }

  await appendWhatsAppReviewAudit(String(data.id), 'analysis_created', null, serializeIntelligence(intelligence), context.createdBy || null, null, null, null, client);
  return { id: String(data.id), duplicate: false, sourceHash, reviewStatus };
}

export async function attachInvoiceVerificationToQueue(
  sourceId: string,
  verification: UnifiedInvoiceVerification,
  actorId?: string | null,
  actorName?: string | null,
  client: any = supabase,
) {
  const best = verification.bestCandidate;
  const next = {
    invoice_match_status: verification.status,
    matched_invoice_id: best?.invoiceId || null,
    matched_invoice_number: best?.invoiceNumber || null,
    matched_invoice_date: best?.invoiceDate || null,
    matched_invoice_value: verification.revenue,
    invoice_match_confidence: verification.verificationConfidence,
    invoice_match_reason: verification.reason,
  };
  const { data: before } = await client.from('whatsapp_review_sources').select('*').eq('id', sourceId).maybeSingle();
  // A human-confirmed invoice link is the stronger truth: a re-import's machine match never
  // overwrites matched_invoice_* under it (the trusted bridge would otherwise drop the proof).
  if (before?.invoice_link_confirmed === true) return;
  // Idempotent: a re-scan or reanalysis that reaches the same machine verification must not write
  // a new audit row. Manual invoice confirmation lives in invoice_link_confirmed* and is never touched.
  if (
    before &&
    Object.entries(next).every(([column, value]) => String(before[column] ?? '') === String(value ?? ''))
  ) {
    return;
  }
  const { error } = await client
    .from('whatsapp_review_sources')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', sourceId);
  if (error) throw error;
  await appendWhatsAppReviewAudit(sourceId, 'invoice_verification', before, verification, actorId || null, actorName || null, null, null, client);
}

export async function confirmWhatsAppReviewQueueItem(
  sourceId: string,
  payload: { officialReviewId?: string | null; reviewerId?: string | null; reviewerName?: string | null; approved: boolean },
) {
  const { data: before, error: readError } = await supabase.from('whatsapp_review_sources').select('*').eq('id', sourceId).single();
  if (readError) throw readError;
  const nextStatus: ReviewQueueStatus = payload.approved ? 'approved' : 'rejected';
  const patch = {
    official_review_id: payload.officialReviewId || null,
    review_status: nextStatus,
    reviewer_confirmed: payload.approved,
    reviewer_id: payload.reviewerId || null,
    reviewer_name: payload.reviewerName || null,
    reviewer_confirmed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('whatsapp_review_sources').update(patch).eq('id', sourceId);
  if (error) throw error;
  await appendWhatsAppReviewAudit(sourceId, payload.approved ? 'review_approved' : 'review_rejected', before, patch, payload.reviewerId || null, payload.reviewerName || null);
}

export async function appendWhatsAppReviewAudit(
  sourceId: string,
  action: string,
  beforeState: unknown,
  afterState: unknown,
  actorId: string | null,
  actorName: string | null,
  actorRole?: string | null,
  note?: string | null,
  client: any = supabase,
) {
  const { error } = await client.from('whatsapp_review_audit').insert({
    source_id: sourceId,
    action,
    actor_id: actorId,
    actor_name: actorName,
    actor_role: actorRole || null,
    before_state: beforeState == null ? null : JSON.parse(JSON.stringify(beforeState)),
    after_state: afterState == null ? null : JSON.parse(JSON.stringify(afterState)),
    note: note || null,
  });
  if (error) throw error;
}

export async function loadWhatsAppReviewQueue(limit = 100) {
  const { data, error } = await supabase
    .from('whatsapp_review_sources')
    .select('*')
    .in('review_status', ['new', 'ready_quick', 'ready_detailed', 'needs_context'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const priorityRank: Record<string, number> = { urgent: 3, important: 2, normal: 1 };
  return [...(data || [])].sort((a, b) => {
    const p = (priorityRank[String(b.priority)] || 0) - (priorityRank[String(a.priority)] || 0);
    if (p) return p;
    return new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime();
  });
}
