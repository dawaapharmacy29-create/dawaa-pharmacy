import { supabase } from '@/lib/supabase';
import type { WhatsAppCustomerJourneyIntelligenceV15 } from './whatsappCustomerJourneyIntelligenceV15';
import { syncPersistentCustomerStoryV16 } from './whatsappCustomerStoryV16';
import { linkWhatsAppEvidenceJourneyV17 } from './whatsappEvidenceJourneyLinkV17';
import type { WhatsAppConversationSession } from './whatsappConversationParser';
import { writeWhatsAppOperationalActionsV6 } from './whatsappOperationalIntelligenceV6';

// Journey V15 (+ Story V16, evidence links) is a SIDE PROJECTION of the canonical chain
//   Source -> Customer Case V22 -> Sales Intelligence.
// It never triggers Sales Intelligence itself: the single canonical refresh is owned by the file
// orchestrator (whatsappWatcherCaseGraphSync.runCanonicalWhatsAppFilePipeline) and runs only after
// the V22 case graph exists, because the Canonical Source Gate refuses sources without V22 ownership.

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
  /** The case-unit sessions the model was built from (the recovery action's identity evidence). */
  sessions?: WhatsAppConversationSession[];
}

export interface JourneySyncResultV15 {
  journeyId: string;
  rootSourceId: string;
  linkedSessions: number;
  storyId: string | null;
  storyKey: string | null;
  /** Story V16 is best-effort; its failure is reported here, never thrown. */
  story: { status: 'synced' | 'skipped' | 'failed'; error: string | null };
  /** Non-blocking projection warnings (story, evidence links). */
  warnings: string[];
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

function dueInHours(hours: number | null) {
  if (hours == null) return null;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export async function syncWhatsAppCustomerJourneyV15(
  model: WhatsAppCustomerJourneyIntelligenceV15,
  context: JourneyPersistenceContextV15,
): Promise<JourneySyncResultV15 | null> {
  if (!context.sessionSources.length) return null;

  const bySession = new Map(context.sessionSources.map((row) => [row.sessionId, row]));
  const problem = model.sessions.find((session) => session.orderFailed || session.complaintDetected);
  const rootMapping = (problem && bySession.get(problem.sessionId)) || context.sessionSources[0];
  if (!rootMapping?.sourceId) return null;

  const sourceIds = [...new Set(context.sessionSources.map((row) => row.sourceId).filter(Boolean))];
  const { data: sources, error: sourceError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,source_filename,branch,customer_id,customer_code,customer_name,customer_phone,conversation_started_at,conversation_ended_at,staff_id,staff_name,analysis_json')
    .in('id', sourceIds);
  if (sourceError) throw sourceError;

  const sourceRows = sources || [];
  const root = sourceRows.find((row: any) => String(row.id) === rootMapping.sourceId) || sourceRows[0];
  if (!root) return null;

  const started = sourceRows.map((row: any) => row.conversation_started_at).filter(Boolean).sort()[0] || null;
  const ended = sourceRows.map((row: any) => row.conversation_ended_at).filter(Boolean).sort().at(-1) || null;

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
    const { error: linkError } = await supabase.from('whatsapp_customer_journey_sessions').upsert(linkRows, { onConflict: 'journey_id,source_id', ignoreDuplicates: false });
    if (linkError) throw linkError;
  }

  const warnings: string[] = [];
  const recoveryAction = model.actions.find((action) => action.key === 'journey-recovery-followup');
  if (recoveryAction) {
    // The recovery follow-up is an operation like any other: written through the same writer and
    // the same Stable Operation Identity (evidence episode of the problem session), never through
    // a separate source+key upsert that could duplicate or overwrite another operation.
    const sessionById = new Map((context.sessions || []).map((session) => [session.id, session]));
    const evidenceSession =
      recoveryAction.evidenceSessionIds.map((id) => sessionById.get(id)).find(Boolean) ||
      sessionById.get(rootMapping.sessionId) ||
      null;
    if (!evidenceSession) {
      // Fail closed: without the conversation messages there is no stable identity to write under.
      warnings.push('journey_recovery_followup_identity_unresolved');
    } else {
      const timelineSession = {
        ...evidenceSession,
        messages: (context.sessions || []).flatMap((session) => session.messages),
      };
      await writeWhatsAppOperationalActionsV6(
        [
          {
            action_key: model.unresolvedComplaint ? 'complaint-followup' : 'customer-followup',
            action_type: recoveryAction.type,
            status: journey.customer_code ? 'ready' : 'proposed',
            confidence: model.customerRisk === 'critical' ? 96 : model.customerRisk === 'high' ? 90 : 80,
            auto_eligible: Boolean(journey.customer_code),
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
          },
        ],
        {
          sourceId: String(journey.root_source_id),
          branch: context.branch || root.branch || null,
          customerId: root.customer_id || null,
          customerCode: root.customer_code || null,
          customerName: root.customer_name || null,
          customerPhone: root.customer_phone || null,
          staffId: root.staff_id || null,
          staffName: root.staff_name || null,
          createdBy: context.createdBy || null,
          followupIdentity: {
            session: timelineSession,
            caseStartedAt: evidenceSession.startedAt,
            legacy: {
              customer: root.customer_id
                ? { status: 'resolved', customerId: String(root.customer_id), normalizedPhone: null, customerCode: null }
                : null,
            },
          },
        }
      );
    }
  }

  let story: Awaited<ReturnType<typeof syncPersistentCustomerStoryV16>> = null;
  let storyStatus: JourneySyncResultV15['story'] = { status: 'skipped', error: null };
  try {
    story = await syncPersistentCustomerStoryV16({
      journeyId: String(journey.id),
      model,
      sources: sourceRows,
      sessionSources: context.sessionSources,
      branch: context.branch || root.branch || null,
      createdBy: context.createdBy || null,
    });
    storyStatus = story ? { status: 'synced', error: null } : { status: 'skipped', error: null };
  } catch (storyError) {
    storyStatus = { status: 'failed', error: errorText(storyError) };
    warnings.push(`Story V16: ${storyStatus.error}`);
  }

  // Only sources that are sessions of this journey are linked; the command re-checks membership.
  const evidenceLink = await linkWhatsAppEvidenceJourneyV17({
    journeyId: String(journey.id),
    storyId: story?.storyId || null,
    sourceIds: [String(journey.root_source_id), ...linkRows.map((row) => row.source_id)],
  });
  if (evidenceLink.status === 'failed') warnings.push(`Evidence V17 link: ${evidenceLink.error}`);

  return {
    journeyId: String(journey.id),
    rootSourceId: String(journey.root_source_id),
    linkedSessions: linkRows.length,
    storyId: story?.storyId || null,
    storyKey: story?.storyKey || null,
    story: storyStatus,
    warnings,
  };
}
