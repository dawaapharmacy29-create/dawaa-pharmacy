import { supabase } from '@/lib/supabase';
import type { WhatsAppCustomerJourneyIntelligenceV15 } from './whatsappCustomerJourneyIntelligenceV15';
import { syncPersistentCustomerStoryV16 } from './whatsappCustomerStoryV16';

export interface JourneySessionSourceV15 {
  sessionId: string;
  sourceId: string;
  contextOnly: boolean;
}

export interface JourneyPersistenceContextV15 {
  sourceFileName?: string | null;
  branch?: string | null;
  createdBy?: string | null;
  sessionSources: JourneySessionSourceV15[];
}

function dueInHours(hours: number | null) {
  if (hours == null) return null;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export async function syncWhatsAppCustomerJourneyV15(
  model: WhatsAppCustomerJourneyIntelligenceV15,
  context: JourneyPersistenceContextV15,
) {
  if (!context.sessionSources.length) return null;

  const bySession = new Map(context.sessionSources.map((row) => [row.sessionId, row]));
  const problem = model.sessions.find((session) => session.orderFailed || session.complaintDetected);
  const rootMapping = (problem && bySession.get(problem.sessionId)) || context.sessionSources[0];
  if (!rootMapping?.sourceId) return null;

  const sourceIds = [...new Set(context.sessionSources.map((row) => row.sourceId))];
  const { data: sources, error: sourceError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,source_filename,branch,customer_id,customer_code,customer_name,customer_phone,conversation_started_at,conversation_ended_at,staff_id,staff_name')
    .in('id', sourceIds);
  if (sourceError) throw sourceError;

  const sourceRows = sources || [];
  const root = sourceRows.find((row: any) => String(row.id) === rootMapping.sourceId) || sourceRows[0];
  if (!root) return null;

  const started = sourceRows
    .map((row: any) => row.conversation_started_at)
    .filter(Boolean)
    .sort()[0] || null;
  const ended = sourceRows
    .map((row: any) => row.conversation_ended_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  const journeyKey = `wa:${String(root.id)}`;
  const journeyPayload = {
    journey_key: journeyKey,
    root_source_id: root.id,
    source_filename: context.sourceFileName || root.source_filename || null,
    branch: context.branch || root.branch || null,
    customer_id: root.customer_id || null,
    customer_code: root.customer_code || null,
    customer_name: root.customer_name || null,
    customer_phone: root.customer_phone || null,
    journey_started_at: started,
    journey_ended_at: ended,
    session_count: model.sessionCount,
    meaningful_session_count: model.meaningfulSessionCount,
    customer_risk: model.customerRisk,
    customer_state: model.customerState,
    unresolved_order: model.unresolvedOrder,
    unresolved_complaint: model.unresolvedComplaint,
    recovery_attempts: model.recoveryAttempts,
    customer_reply_after_problem: model.customerReplyAfterProblem,
    summary: model.summary,
    journey_json: model,
    lifecycle_status: model.unresolvedOrder || model.unresolvedComplaint ? 'recovery' : 'open',
    created_by: context.createdBy || null,
    updated_at: new Date().toISOString(),
  };

  const { data: journey, error: journeyError } = await supabase
    .from('whatsapp_customer_journeys')
    .upsert(journeyPayload, { onConflict: 'journey_key', ignoreDuplicates: false })
    .select('id,root_source_id,customer_code')
    .single();
  if (journeyError) throw journeyError;

  const linkRows = model.sessions.flatMap((session, index) => {
    const mapping = bySession.get(session.sessionId);
    if (!mapping) return [];
    const scoringEligible = !mapping.contextOnly && session.role !== 'service_feedback_request' && session.role !== 'apology_recovery' && session.role !== 'general_followup';
    return [{
      journey_id: journey.id,
      source_id: mapping.sourceId,
      session_id: session.sessionId,
      sequence_no: index + 1,
      session_role: session.role,
      context_only: mapping.contextOnly,
      official_scoring_eligible: scoringEligible,
    }];
  });

  if (linkRows.length) {
    const { error: linkError } = await supabase
      .from('whatsapp_customer_journey_sessions')
      .upsert(linkRows, { onConflict: 'journey_id,source_id', ignoreDuplicates: false });
    if (linkError) throw linkError;
  }

  const recoveryAction = model.actions.find((action) => action.key === 'journey-recovery-followup');
  if (recoveryAction) {
    const actionKey = model.unresolvedComplaint ? 'complaint-followup' : 'customer-followup';
    const { error: actionError } = await supabase
      .from('whatsapp_conversation_actions')
      .upsert({
        source_id: journey.root_source_id,
        action_key: actionKey,
        action_type: recoveryAction.type,
        status: journey.customer_code ? 'ready' : 'proposed',
        confidence: model.customerRisk === 'critical' ? 96 : model.customerRisk === 'high' ? 90 : 80,
        auto_eligible: Boolean(journey.customer_code),
        branch: context.branch || root.branch || null,
        customer_id: root.customer_id || null,
        customer_code: root.customer_code || null,
        customer_name: root.customer_name || null,
        customer_phone: root.customer_phone || null,
        staff_id: root.staff_id || null,
        staff_name: root.staff_name || null,
        due_at: dueInHours(recoveryAction.dueInHours),
        reason: recoveryAction.reason,
        evidence: recoveryAction.evidenceSessionIds,
        payload: {
          journey_id: journey.id,
          journey_key: journeyKey,
          journey_version: model.version,
          keep_open_until: recoveryAction.keepOpenUntil,
          recovery_attempts: model.recoveryAttempts,
          customer_state: model.customerState,
          summary: model.summary,
        },
        created_by: context.createdBy || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_id,action_key', ignoreDuplicates: false });
    if (actionError) throw actionError;
  }

  const story = await syncPersistentCustomerStoryV16({
    journeyId: String(journey.id),
    model,
    sources: sourceRows,
    sessionSources: context.sessionSources,
    branch: context.branch || root.branch || null,
    createdBy: context.createdBy || null,
  });

  return {
    journeyId: String(journey.id),
    rootSourceId: String(journey.root_source_id),
    linkedSessions: linkRows.length,
    storyId: story?.storyId || null,
    storyKey: story?.storyKey || null,
  };
}
