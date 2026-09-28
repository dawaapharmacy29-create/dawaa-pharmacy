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
}

export interface PersistSessionResult {
  id: string;
  duplicate: boolean;
  sourceHash: string;
  reviewStatus: ReviewQueueStatus;
}

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

export function inferQueueStatus(intelligence: UnifiedConversationIntelligence): ReviewQueueStatus {
  if (intelligence.confidence < 60) return 'needs_context';
  if (intelligence.requiresHumanApproval || intelligence.priority === 'urgent') return 'ready_detailed';
  return 'ready_quick';
}

function serializeIntelligence(value: UnifiedConversationIntelligence) {
  return JSON.parse(JSON.stringify(value));
}

export async function persistAnalyzedWhatsAppSession(
  session: WhatsAppConversationSession,
  intelligence: UnifiedConversationIntelligence,
  context: PersistSessionContext = {},
): Promise<PersistSessionResult> {
  const sourceHash = await hashWhatsAppSession(session);
  const reviewStatus = inferQueueStatus(intelligence);
  const rawText = sessionRawText(session);

  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_review_sources')
    .select('id, source_hash, review_status')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;
  if (existing?.id) {
    const { error: refreshError } = await supabase
      .from('whatsapp_review_sources')
      .update({
        analysis_version: intelligence.version,
        analysis_status: intelligence.requiresHumanApproval ? 'needs_review' : 'analyzed',
        priority: intelligence.priority,
        analysis_confidence: intelligence.confidence,
        service_score: intelligence.serviceScore,
        commercial_score: intelligence.commercialScore,
        commercial_eligible: intelligence.commercialEligible,
        chat_suggested_sold: intelligence.chatSuggestedSold,
        followup_required: intelligence.followupRequired,
        suggested_followup_reason: intelligence.suggestedFollowupReason,
        analysis_json: serializeIntelligence(intelligence),
        raw_text: rawText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (refreshError) throw refreshError;
    return { id: String(existing.id), duplicate: true, sourceHash, reviewStatus: (existing.review_status || reviewStatus) as ReviewQueueStatus };
  }

  const staffName =
    context.staffName ||
    (session.outboundStaffNames.length === 1 ? session.outboundStaffNames[0] : null);
  const customerName = context.customerName || session.customerName || null;
  const { data, error } = await supabase
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
      analysis_version: intelligence.version,
      analysis_status: intelligence.requiresHumanApproval ? 'needs_review' : 'analyzed',
      review_status: reviewStatus,
      priority: intelligence.priority,
      analysis_confidence: intelligence.confidence,
      service_score: intelligence.serviceScore,
      commercial_score: intelligence.commercialScore,
      commercial_eligible: intelligence.commercialEligible,
      chat_suggested_sold: intelligence.chatSuggestedSold,
      followup_required: intelligence.followupRequired,
      suggested_followup_reason: intelligence.suggestedFollowupReason,
      analysis_json: serializeIntelligence(intelligence),
      raw_text: rawText,
      created_by: context.createdBy || null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: dupe, error: dupeError } = await supabase.from('whatsapp_review_sources').select('id, review_status').eq('source_hash', sourceHash).single();
      if (dupeError) throw dupeError;
      return { id: String(dupe.id), duplicate: true, sourceHash, reviewStatus: (dupe.review_status || reviewStatus) as ReviewQueueStatus };
    }
    throw error;
  }

  await appendWhatsAppReviewAudit(String(data.id), 'analysis_created', null, serializeIntelligence(intelligence), context.createdBy || null, null);
  return { id: String(data.id), duplicate: false, sourceHash, reviewStatus };
}

export async function archiveSupersededLegacyWhatsAppSourceV35(args: {
  sourceFileName: string;
  fullConversationStartedAt: string;
  fullConversationEndedAt: string;
  fullMessageCount: number;
  replacementSourceIds: string[];
  actorId?: string | null;
  actorName?: string | null;
}) {
  const replacementIds = Array.from(new Set((args.replacementSourceIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (replacementIds.length < 2) {
    return { archived: 0, deletedCases: 0, skippedReason: 'replacement_sources_less_than_two' as const };
  }

  const { data: candidates, error: candidateError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,source_filename,conversation_started_at,conversation_ended_at,message_count,review_status,reviewer_confirmed,invoice_link_confirmed,invoice_link_confirmed_invoice_id,analysis_json')
    .eq('source_filename', args.sourceFileName)
    .eq('conversation_started_at', args.fullConversationStartedAt)
    .eq('conversation_ended_at', args.fullConversationEndedAt)
    .eq('message_count', args.fullMessageCount)
    .neq('review_status', 'archived');
  if (candidateError) throw candidateError;

  const legacy = (candidates || []).filter((row: any) => !replacementIds.includes(String(row.id || '')));
  if (!legacy.length) {
    return { archived: 0, deletedCases: 0, skippedReason: 'no_legacy_monolithic_source' as const };
  }
  if (legacy.length > 1) {
    return { archived: 0, deletedCases: 0, skippedReason: 'multiple_legacy_candidates' as const };
  }

  const source = legacy[0] as any;
  if (source.reviewer_confirmed || source.invoice_link_confirmed || source.invoice_link_confirmed_invoice_id) {
    return { archived: 0, deletedCases: 0, skippedReason: 'legacy_source_has_human_confirmation' as const };
  }

  const { count: humanReviewCount, error: humanReviewError } = await supabase
    .from('conversation_sales_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp_review_source_id', source.id);
  if (humanReviewError) throw humanReviewError;
  if (Number(humanReviewCount || 0) > 0) {
    return { archived: 0, deletedCases: 0, skippedReason: 'legacy_source_has_official_review' as const };
  }

  const { data: journeyRows, error: journeyError } = await supabase
    .from('whatsapp_customer_journeys')
    .select('id')
    .eq('root_source_id', source.id);
  if (journeyError) throw journeyError;
  const journeyIds = (journeyRows || []).map((row: any) => String(row.id));

  if (journeyIds.length) {
    const { data: journeyLinks, error: journeyLinkError } = await supabase
      .from('whatsapp_customer_journey_sessions')
      .select('journey_id,source_id')
      .in('journey_id', journeyIds);
    if (journeyLinkError) throw journeyLinkError;
    const sharedJourney = (journeyLinks || []).some((row: any) =>
      String(row.source_id || '') !== String(source.id)
    );
    if (sharedJourney) {
      return { archived: 0, deletedCases: 0, skippedReason: 'legacy_journey_shared_with_other_sources' as const };
    }
  }

  const { data: caseRows, error: caseError } = await supabase
    .from('whatsapp_customer_cases_v22')
    .select('id,confirmed_outcome,outcome_reviewed_by,outcome_reviewed_at,confirmed_lost_reason,verified_invoice_id,verified_revenue')
    .or(`root_source_id.eq.${source.id},source_ids.cs.{${source.id}}`);
  if (caseError) throw caseError;

  const unsafeCase = (caseRows || []).find((row: any) =>
    row.confirmed_outcome ||
    row.outcome_reviewed_by ||
    row.outcome_reviewed_at ||
    row.confirmed_lost_reason ||
    row.verified_invoice_id ||
    row.verified_revenue != null
  );
  if (unsafeCase) {
    return { archived: 0, deletedCases: 0, skippedReason: 'legacy_case_has_human_or_verified_state' as const };
  }

  let deletedCases = 0;
  if ((caseRows || []).length) {
    const ids = (caseRows || []).map((row: any) => row.id);
    const { error: deleteError } = await supabase
      .from('whatsapp_customer_cases_v22')
      .delete()
      .in('id', ids);
    if (deleteError) throw deleteError;
    deletedCases = ids.length;
  }

  const derivedDeletes: Array<{ table: string; column: string }> = [
    { table: 'sales_intelligence_cases', column: 'conversation_id' },
    { table: 'whatsapp_conversation_actions', column: 'source_id' },
    { table: 'whatsapp_evidence_facts_v17', column: 'source_id' },
    { table: 'whatsapp_response_turns_v18', column: 'source_id' },
    { table: 'whatsapp_sales_opportunities_v17', column: 'root_source_id' },
    { table: 'whatsapp_customer_story_events', column: 'source_id' },
  ];
  const deletedDerived: Record<string, number> = {};
  for (const target of derivedDeletes) {
    const { data: deletedRows, error: derivedDeleteError } = await supabase
      .from(target.table)
      .delete()
      .eq(target.column, source.id)
      .select('*');
    if (derivedDeleteError) throw derivedDeleteError;
    deletedDerived[target.table] = (deletedRows || []).length;
  }

  if (journeyIds.length) {
    const { error: journeyDeleteError } = await supabase
      .from('whatsapp_customer_journeys')
      .delete()
      .in('id', journeyIds);
    if (journeyDeleteError) throw journeyDeleteError;
    deletedDerived.whatsapp_customer_journeys = journeyIds.length;
  }

  const nowIso = new Date().toISOString();
  const previousAnalysis =
    source.analysis_json && typeof source.analysis_json === 'object' && !Array.isArray(source.analysis_json)
      ? source.analysis_json
      : {};
  const patch = {
    review_status: 'archived',
    analysis_status: 'analyzed',
    analysis_json: {
      ...previousAnalysis,
      supersededLegacySourceV35: {
        archivedAt: nowIso,
        replacementSourceIds: replacementIds,
        reason: 'legacy_monolithic_source_replaced_by_case_scoped_sources',
      },
    },
    updated_at: nowIso,
  };

  const { error: archiveError } = await supabase
    .from('whatsapp_review_sources')
    .update(patch)
    .eq('id', source.id);
  if (archiveError) throw archiveError;

  await appendWhatsAppReviewAudit(
    String(source.id),
    'legacy_source_superseded',
    source,
    patch,
    args.actorId || null,
    args.actorName || null,
    null,
    `Replaced by ${replacementIds.length} case-scoped sources`,
  );

  return {
    archived: 1,
    deletedCases,
    deletedDerived,
    archivedSourceId: String(source.id),
    replacementSourceIds: replacementIds,
    skippedReason: null,
  };
}

export async function attachInvoiceVerificationToQueue(
  sourceId: string,
  verification: UnifiedInvoiceVerification,
  actorId?: string | null,
  actorName?: string | null,
) {
  const best = verification.bestCandidate;
  const { data: before } = await supabase.from('whatsapp_review_sources').select('*').eq('id', sourceId).maybeSingle();
  const { error } = await supabase
    .from('whatsapp_review_sources')
    .update({
      invoice_match_status: verification.status,
      matched_invoice_id: best?.invoiceId || null,
      matched_invoice_number: best?.invoiceNumber || null,
      matched_invoice_date: best?.invoiceDate || null,
      matched_invoice_value: verification.revenue,
      invoice_match_confidence: verification.verificationConfidence,
      invoice_match_reason: verification.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId);
  if (error) throw error;
  await appendWhatsAppReviewAudit(sourceId, 'invoice_verification', before, verification, actorId || null, actorName || null);
}

export async function confirmWhatsAppInvoiceLinkV34(
  sourceId: string,
  invoiceId: string,
  actorId?: string | null,
  actorName?: string | null,
  note?: string | null,
) {
  const cleanSourceId = String(sourceId || '').trim();
  const cleanInvoiceId = String(invoiceId || '').trim();
  if (!cleanSourceId || !cleanInvoiceId) throw new Error('source_id_and_invoice_id_required');

  const { data: source, error: sourceError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,customer_id,customer_code,customer_name,branch,matched_invoice_id,matched_invoice_number,invoice_link_confirmed,invoice_link_confirmed_invoice_id')
    .eq('id', cleanSourceId)
    .single();
  if (sourceError) throw sourceError;

  const { data: invoice, error: invoiceError } = await supabase
    .from('sales_invoices')
    .select('id,invoice_number,invoice_datetime,customer_id,customer_code,customer_name,branch,net_amount,total_amount,amount')
    .eq('id', cleanInvoiceId)
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error('invoice_not_found');

  const sourceCustomerId = String(source.customer_id || '').trim();
  const invoiceCustomerId = String(invoice.customer_id || '').trim();
  if (sourceCustomerId && invoiceCustomerId && sourceCustomerId !== invoiceCustomerId) {
    throw new Error('invoice_customer_identity_conflict');
  }

  const normalizeCode = (value: unknown) =>
    String(value ?? '').trim().replace(/\.0+$/, '');
  const sourceCode = normalizeCode(source.customer_code);
  const invoiceCode = normalizeCode(invoice.customer_code);
  if (!sourceCustomerId && sourceCode && invoiceCode && sourceCode !== invoiceCode) {
    throw new Error('invoice_customer_code_conflict');
  }

  const nowIso = new Date().toISOString();
  const revenue = Number(invoice.net_amount ?? invoice.total_amount ?? invoice.amount ?? 0);
  const patch = {
    invoice_link_confirmed: true,
    invoice_link_confirmed_invoice_id: String(invoice.id),
    invoice_link_confirmed_invoice_number: invoice.invoice_number || null,
    invoice_link_confirmed_by: actorId || actorName || 'manual-review',
    invoice_link_confirmed_by_name: actorName || null,
    invoice_link_confirmed_at: nowIso,
    invoice_link_confirmation_note: note || 'تم اعتماد ربط الفاتورة المحددة يدويًا من شاشة مراجعة واتساب.',
    matched_invoice_id: invoice.id,
    matched_invoice_number: invoice.invoice_number || null,
    matched_invoice_date: invoice.invoice_datetime || null,
    matched_invoice_value: Number.isFinite(revenue) ? revenue : null,
    invoice_match_status: 'verified',
    invoice_match_confidence: 1,
    invoice_match_reason: 'manual_invoice_link_confirmation',
    updated_at: nowIso,
  };

  const { error: updateError } = await supabase
    .from('whatsapp_review_sources')
    .update(patch)
    .eq('id', cleanSourceId);
  if (updateError) throw updateError;

  await appendWhatsAppReviewAudit(
    cleanSourceId,
    'invoice_link_confirmed',
    source,
    { ...patch, invoice_customer_id: invoice.customer_id || null, invoice_customer_code: invoice.customer_code || null },
    actorId || null,
    actorName || null,
    null,
    note || null,
  );

  return {
    sourceId: cleanSourceId,
    invoiceId: String(invoice.id),
    invoiceNumber: invoice.invoice_number || null,
    invoiceDate: invoice.invoice_datetime || null,
    revenue: Number.isFinite(revenue) ? revenue : null,
    branch: invoice.branch || null,
  };
}

export async function revokeWhatsAppInvoiceLinkV34(
  sourceId: string,
  actorId?: string | null,
  actorName?: string | null,
  note?: string | null,
) {
  const { data: before, error: readError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,invoice_link_confirmed,invoice_link_confirmed_invoice_id,invoice_link_confirmed_invoice_number')
    .eq('id', sourceId)
    .single();
  if (readError) throw readError;

  const patch = {
    invoice_link_confirmed: false,
    invoice_link_confirmed_invoice_id: null,
    invoice_link_confirmed_invoice_number: null,
    invoice_link_confirmed_by: null,
    invoice_link_confirmed_by_name: null,
    invoice_link_confirmed_at: null,
    invoice_link_confirmation_note: note || 'تم إلغاء اعتماد ربط الفاتورة يدويًا.',
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('whatsapp_review_sources').update(patch).eq('id', sourceId);
  if (error) throw error;
  await appendWhatsAppReviewAudit(sourceId, 'invoice_link_revoked', before, patch, actorId || null, actorName || null, null, note || null);
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
) {
  const { error } = await supabase.from('whatsapp_review_audit').insert({
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
