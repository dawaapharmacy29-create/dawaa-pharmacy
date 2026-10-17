// Canonical Complaint Assessment -> operational complaint follow-up projection.
//
// Semantic ownership stays in complaintAssessmentEngine.ts. This module only exposes unresolved
// canonical complaint work to whatsapp_conversation_actions; it never decides complaint meaning,
// never writes daily_followups directly and never materializes the action automatically.
import { parseWhatsAppExport } from '../../whatsappConversationParser';
import { stableOperationIdentity } from '../../whatsappFollowupIdentity';
import { deriveCanonicalComplaintAssessment } from '../complaintAssessmentEngine';
import type { SalesIntelligenceCaseAnalysis } from '../types';

export const CANONICAL_COMPLAINT_PROJECTION_VERSION = 'si-canonical-complaint-projection-v1';

export interface CanonicalComplaintSourceMetadata {
  id: string;
  raw_text?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
}

export interface CanonicalComplaintActionRow {
  source_id: string;
  action_key: string;
  action_type: 'complaint_followup';
  status: 'ready' | 'proposed';
  work_status: 'unassigned';
  auto_eligible: false;
  confidence: number;
  branch: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  due_at: string | null;
  reason: string;
  evidence: string[];
  payload: Record<string, unknown>;
  followup_identity: string;
  assigned_to_id: null;
  assigned_to_name: null;
  created_by: string;
}

export interface CanonicalComplaintProjectionSkip {
  caseId: string;
  reason:
    | 'not_actionable'
    | 'missing_source'
    | 'missing_customer_name'
    | 'missing_branch'
    | 'missing_timeline'
    | 'missing_complaint_time';
}

export interface CanonicalComplaintBuildResult {
  rows: CanonicalComplaintActionRow[];
  skipped: CanonicalComplaintProjectionSkip[];
}

export interface CanonicalComplaintProjectionResult extends CanonicalComplaintBuildResult {
  inserted: number;
  existing: number;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function uuidOrNull(value: unknown) {
  const raw = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

function complaintConfidence(value: 'high' | 'medium' | 'low') {
  return value === 'high' ? 95 : value === 'medium' ? 80 : 65;
}

function firstEvidenceAt(
  analysis: SalesIntelligenceCaseAnalysis,
  evidenceIds: readonly string[]
): Date | null {
  const wanted = new Set(evidenceIds.map(String));
  const values = analysis.caseIntelligence.interaction.messages
    .filter((message) => wanted.has(String(message.id)))
    .map((message) => new Date(message.at))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  return values[0] ?? null;
}

export function buildCanonicalComplaintActionRows(
  analyses: readonly SalesIntelligenceCaseAnalysis[],
  sources: readonly CanonicalComplaintSourceMetadata[]
): CanonicalComplaintBuildResult {
  const sourceById = new Map(sources.map((source) => [text(source.id), source]));
  const byIdentity = new Map<string, CanonicalComplaintActionRow>();
  const skipped: CanonicalComplaintProjectionSkip[] = [];

  for (const analysis of analyses) {
    const complaint = deriveCanonicalComplaintAssessment({
      caseId: analysis.caseId,
      messages: analysis.caseIntelligence.interaction.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        meaningful: message.meaningful,
      })),
    });

    if (!['detected', 'recovery_attempted', 'unresolved'].includes(complaint.state)) {
      if (complaint.state !== 'none') {
        skipped.push({ caseId: analysis.caseId, reason: 'not_actionable' });
      }
      continue;
    }

    const sourceId = text(analysis.conversationId);
    const source = sourceById.get(sourceId);
    if (!source) {
      skipped.push({ caseId: analysis.caseId, reason: 'missing_source' });
      continue;
    }

    const customerName = text(source.customer_name);
    const branch = text(analysis.conversationCase.branchNameRaw);
    if (!customerName) {
      skipped.push({ caseId: analysis.caseId, reason: 'missing_customer_name' });
      continue;
    }
    if (!branch) {
      skipped.push({ caseId: analysis.caseId, reason: 'missing_branch' });
      continue;
    }

    const timeline = parseWhatsAppExport(text(source.raw_text));
    if (!timeline.length) {
      skipped.push({ caseId: analysis.caseId, reason: 'missing_timeline' });
      continue;
    }
    const evidenceAt = firstEvidenceAt(analysis, complaint.complaintMessageIds);
    if (!evidenceAt) {
      skipped.push({ caseId: analysis.caseId, reason: 'missing_complaint_time' });
      continue;
    }

    const operation = stableOperationIdentity({
      timeline: timeline.map((message) => ({
        timestamp: message.timestamp,
        direction: message.direction,
        sender: message.sender,
        text: message.text,
        kind: message.kind,
        mediaPlaceholder: message.mediaPlaceholder,
      })),
      evidenceAt,
      operationType: 'complaint_followup',
      reasonKey: null,
    });

    const customerId = uuidOrNull(analysis.conversationCase.customerId);
    const row: CanonicalComplaintActionRow = {
      source_id: sourceId,
      action_key: `canonical-complaint:${operation.identity}`,
      action_type: 'complaint_followup',
      status: customerId || text(source.customer_code) ? 'ready' : 'proposed',
      work_status: 'unassigned',
      auto_eligible: false,
      confidence: complaintConfidence(complaint.confidence),
      branch,
      customer_id: customerId,
      customer_code: text(source.customer_code) || null,
      customer_name: customerName,
      customer_phone: text(analysis.conversationCase.customerPhone) || null,
      due_at: evidenceAt.toISOString(),
      reason:
        complaint.state === 'recovery_attempted'
          ? 'بدأت معالجة شكوى العميل لكن لا يوجد إغلاق صريح؛ تحتاج متابعة رضا العميل.'
          : 'شكوى عميل غير محسومة وتحتاج متابعة خدمة العملاء.',
      evidence: [...complaint.evidenceMessageIds],
      payload: {
        canonicalProjectionVersion: CANONICAL_COMPLAINT_PROJECTION_VERSION,
        caseId: analysis.caseId,
        canonicalComplaintState: complaint.state,
        complaintRuleIds: [...complaint.ruleIds],
        complaintMessageIds: [...complaint.complaintMessageIds],
        staffResponseMessageIds: [...complaint.staffResponseMessageIds],
        apologyMessageIds: [...complaint.apologyMessageIds],
        remedyAttemptMessageIds: [...complaint.remedyAttemptMessageIds],
        hostileResponseMessageIds: [...complaint.hostileResponseMessageIds],
        resolutionMessageIds: [...complaint.resolutionMessageIds],
        ownerRole: 'customer_service',
        priority: complaint.hostileResponseMessageIds.length ? 'urgent' : 'important',
        reviewRequired: true,
      },
      followup_identity: operation.identity,
      assigned_to_id: null,
      assigned_to_name: null,
      created_by: CANONICAL_COMPLAINT_PROJECTION_VERSION,
    };

    const existing = byIdentity.get(operation.identity);
    if (existing) {
      if (existing.source_id !== row.source_id) {
        throw new Error(`canonical_complaint_identity_collision:${operation.identity}`);
      }
      continue;
    }
    byIdentity.set(operation.identity, row);
  }

  return { rows: [...byIdentity.values()], skipped };
}

export async function projectCanonicalComplaintsToActions(
  supabaseClient: any,
  analyses: readonly SalesIntelligenceCaseAnalysis[],
  sources: readonly CanonicalComplaintSourceMetadata[]
): Promise<CanonicalComplaintProjectionResult> {
  const built = buildCanonicalComplaintActionRows(analyses, sources);
  if (!built.rows.length) return { ...built, inserted: 0, existing: 0 };

  const identities = built.rows.map((row) => row.followup_identity);
  const { data: existingRows, error: existingError } = await supabaseClient
    .from('whatsapp_conversation_actions')
    .select('id,followup_identity,status,target_table,target_id')
    .in('followup_identity', identities);
  if (existingError) throw existingError;

  const existing = new Set(
    (existingRows || [])
      .map((row: { followup_identity?: string | null }) => text(row.followup_identity))
      .filter(Boolean)
  );
  let inserted = 0;

  for (const row of built.rows) {
    if (existing.has(row.followup_identity)) continue;
    const { error } = await supabaseClient.from('whatsapp_conversation_actions').insert(row);
    if (!error) {
      inserted += 1;
      existing.add(row.followup_identity);
      continue;
    }
    if (String(error.code || '') !== '23505') throw error;

    const { data: raced, error: raceReadError } = await supabaseClient
      .from('whatsapp_conversation_actions')
      .select('id,followup_identity')
      .eq('followup_identity', row.followup_identity)
      .maybeSingle();
    if (raceReadError) throw raceReadError;
    if (!raced) throw error;
    existing.add(row.followup_identity);
  }

  return {
    ...built,
    inserted,
    existing: built.rows.length - inserted,
  };
}
