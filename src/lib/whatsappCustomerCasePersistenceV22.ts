import { supabase } from '@/lib/supabase';
import type { WhatsAppCustomerCaseEngineV22 } from './whatsappCustomerCaseEngineV22';
import type { JourneySessionSourceV15 } from './whatsappCustomerJourneyPersistenceV15';

export interface SyncWhatsAppCustomerCasesV22Context {
  branch?: string | null;
  createdBy?: string | null;
  sessionSources: JourneySessionSourceV15[];
}

export interface SyncWhatsAppCustomerCasesV22Result {
  saved: number;
  skipped: number;
  failed: number;
}

export async function syncWhatsAppCustomerCasesV22(
  model: WhatsAppCustomerCaseEngineV22,
  context: SyncWhatsAppCustomerCasesV22Context,
): Promise<SyncWhatsAppCustomerCasesV22Result> {
  const sourceBySession = new Map(context.sessionSources.map((x) => [x.sessionId, x.sourceId]));
  const result: SyncWhatsAppCustomerCasesV22Result = { saved: 0, skipped: 0, failed: 0 };

  for (const caseItem of model.cases) {
    const sourceIds = caseItem.sessionIds.map((id) => sourceBySession.get(id)).filter((id): id is string => Boolean(id));
    const rootSourceId = sourceIds[0];
    if (!rootSourceId) {
      result.skipped += 1;
      continue;
    }

    try {
      const { data: rootSource, error: sourceError } = await supabase
        .from('whatsapp_review_sources')
        .select('id,branch,customer_id,customer_code,customer_name,customer_phone')
        .eq('id', rootSourceId)
        .maybeSingle();
      if (sourceError) throw sourceError;

      const caseKey = `v22:${rootSourceId}:${caseItem.startedAt}`;
      const payload = {
        case_key: caseKey,
        root_source_id: rootSourceId,
        source_ids: sourceIds,
        branch: rootSource?.branch || context.branch || null,
        customer_id: rootSource?.customer_id || null,
        customer_code: rootSource?.customer_code || null,
        customer_name: rootSource?.customer_name || null,
        customer_phone: rootSource?.customer_phone || null,
        case_type: caseItem.type,
        case_state: caseItem.state,
        started_at: caseItem.startedAt,
        last_event_at: caseItem.lastEventAt,
        session_count: caseItem.sessionIds.length,
        staff_names: caseItem.staffNames,
        order_intent: caseItem.orderIntent,
        order_confirmed: caseItem.orderConfirmed,
        failure_detected: caseItem.failure,
        complaint_detected: caseItem.complaint,
        recommendation_detected: caseItem.recommendation,
        recovery_attempts: caseItem.recoveryAttempts,
        customer_reengaged: caseItem.customerReengaged,
        media_referenced: caseItem.mediaReferenced,
        media_available: caseItem.mediaAvailable,
        media_missing: caseItem.mediaMissing,
        media_coverage_percent: caseItem.mediaCoveragePercent,
        semantic_coverage: caseItem.semanticCoverage,
        needs_human_review: caseItem.needsHumanReview,
        next_action: caseItem.nextAction,
        summary: caseItem.summary,
        case_json: caseItem,
        created_by: context.createdBy || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('whatsapp_customer_cases_v22')
        .upsert(payload, { onConflict: 'case_key' });
      if (error) throw error;
      result.saved += 1;
    } catch (error) {
      console.warn('[whatsapp-case-v22] failed to persist case', caseItem.id, error);
      result.failed += 1;
    }
  }

  return result;
}
