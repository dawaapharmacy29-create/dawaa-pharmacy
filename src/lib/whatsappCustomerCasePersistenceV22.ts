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

function participantStaffFromAnalysis(analysis: any) {
  const rows = analysis?.participantRoles?.staff;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: any) => ({
      accountId: row?.accountId ? String(row.accountId) : null,
      staffName: row?.staffName ? String(row.staffName) : null,
      role: row?.role ? String(row.role) : null,
      confidence: Number(row?.confidence || 0),
    }))
    .filter((row: any) => row.staffName || row.accountId);
}

export async function syncWhatsAppCustomerCasesV22(
  model: WhatsAppCustomerCaseEngineV22,
  context: SyncWhatsAppCustomerCasesV22Context,
): Promise<SyncWhatsAppCustomerCasesV22Result> {
  const sourceBySession = new Map(context.sessionSources.map((x) => [x.sessionId, x.sourceId]));
  const result: SyncWhatsAppCustomerCasesV22Result = { saved: 0, skipped: 0, failed: 0 };
  const allSourceIds = [...new Set(context.sessionSources.map((x) => x.sourceId).filter(Boolean))];

  const sourceMap = new Map<string, any>();
  if (allSourceIds.length) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from('whatsapp_review_sources')
      .select('id,branch,customer_id,customer_code,customer_name,customer_phone,analysis_json')
      .in('id', allSourceIds);
    if (sourceError) throw sourceError;
    for (const row of sourceRows || []) sourceMap.set(String(row.id), row);
  }

  const journeyBySource = new Map<string, { journeyId: string; storyId: string | null }>();
  if (allSourceIds.length) {
    const { data: links } = await supabase
      .from('whatsapp_customer_journey_sessions')
      .select('journey_id,source_id')
      .in('source_id', allSourceIds);
    const journeyIds = [...new Set((links || []).map((x: any) => String(x.journey_id || '')).filter(Boolean))];
    const storyByJourney = new Map<string, string | null>();
    if (journeyIds.length) {
      const { data: journeys } = await supabase
        .from('whatsapp_customer_journeys')
        .select('id,story_id')
        .in('id', journeyIds);
      for (const row of journeys || []) storyByJourney.set(String((row as any).id), (row as any).story_id ? String((row as any).story_id) : null);
    }
    for (const link of links || []) {
      const journeyId = String((link as any).journey_id || '');
      const sourceId = String((link as any).source_id || '');
      if (journeyId && sourceId) journeyBySource.set(sourceId, { journeyId, storyId: storyByJourney.get(journeyId) || null });
    }
  }

  for (const caseItem of model.cases) {
    const sourceIds = caseItem.sessionIds.map((id) => sourceBySession.get(id)).filter((id): id is string => Boolean(id));
    const rootSourceId = sourceIds[0];
    if (!rootSourceId) {
      result.skipped += 1;
      continue;
    }

    try {
      const rootSource = sourceMap.get(rootSourceId) || null;
      const journeyLink = journeyBySource.get(rootSourceId) || sourceIds.map((id) => journeyBySource.get(id)).find(Boolean) || null;
      const canonicalStaff = new Map<string, { accountId: string | null; staffName: string; confidence: number }>();
      for (const sourceId of sourceIds) {
        const source = sourceMap.get(sourceId);
        for (const staff of participantStaffFromAnalysis(source?.analysis_json)) {
          const key = staff.accountId || `name:${staff.staffName}`;
          const previous = canonicalStaff.get(key);
          if (!previous || staff.confidence > previous.confidence) canonicalStaff.set(key, { accountId: staff.accountId, staffName: staff.staffName || '', confidence: staff.confidence });
        }
      }
      const staffRows = [...canonicalStaff.values()].filter((x) => x.staffName);
      const staffAccountIds = [...new Set(staffRows.map((x) => x.accountId).filter((x): x is string => Boolean(x)))];
      const staffNames = [...new Set(staffRows.map((x) => x.staffName))];

      const caseKey = `v22:${rootSourceId}:${caseItem.startedAt}`;
      const payload = {
        case_key: caseKey,
        root_source_id: rootSourceId,
        source_ids: sourceIds,
        story_id: journeyLink?.storyId || null,
        journey_id: journeyLink?.journeyId || null,
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
        staff_account_ids: staffAccountIds,
        staff_names: staffNames.length ? staffNames : caseItem.staffNames,
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
        case_json: { ...caseItem, canonicalStaff: staffRows },
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
