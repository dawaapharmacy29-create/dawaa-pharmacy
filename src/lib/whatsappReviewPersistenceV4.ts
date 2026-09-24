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
