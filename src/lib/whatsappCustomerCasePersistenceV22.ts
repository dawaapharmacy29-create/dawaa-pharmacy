import { supabase } from '@/lib/supabase';
import type { WhatsAppCustomerCaseEngineV22 } from './whatsappCustomerCaseEngineV22';
import type { JourneySessionSourceV15 } from './whatsappCustomerJourneyPersistenceV15';
import { deriveProposedCaseLostReasonV23 } from './whatsappCaseLostReasonV23';

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

type ParticipantStaff = {
  accountId: string | null;
  staffName: string | null;
  role: string | null;
  confidence: number;
};

type SourceRow = {
  id: string;
  branch?: string | null;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  conversation_started_at?: string | null;
  analysis_json?: any;
  raw_text?: string | null;
  invoice_match_status?: string | null;
  matched_invoice_id?: string | null;
  matched_invoice_number?: string | null;
  matched_invoice_date?: string | null;
  matched_invoice_value?: number | string | null;
  invoice_match_confidence?: number | string | null;
};

const AVAILABILITY_RX = /(متوفر|موجود|غير متوفر|مش متوفر|ناقص|ناقصة|النواقص|هنوفر|نوفره)/i;
const RECOMMENDATION_RX = /(ارشح|أرشح|نرشح|ترشيح|بديل|انصح|أنصح|ممكن تستخدم|ممكن تاخد|ممكن تاخدي)/i;
const CONFIRMATION_RX = /(تم تأكيد|تم التاكيد|الأوردر اتأكد|الاوردر اتاكد|جاري الارسال|جاري الإرسال|خرج لحضرتك|اتعملت الفاتور)/i;
const COMPLAINT_RX = /(شكوى|شكوي|مشكلة|مشكله|اتضايقت|زعلت|مش راضي|محدش رد|التأخير|التاخير|ماوصلش|موصلش)/i;
const RECOVERY_RX = /(بنعتذر|نعتذر|متابعة|متابعه|حابين نطمن|حبيت اطمن|حبيت أطمن|تقييم الخدمة|تقييم الخدمه|رأي حضرتك|راي حضرتك)/i;
const DELIVERY_FAILURE_RX = /(مندوب|دليفري|توصيل|ماوصلش|موصلش|محدش جه|ماجاش|مجاش|اتأخر|اتاخرت|التأخير|التاخير)/i;

function participantStaffFromAnalysis(analysis: any): ParticipantStaff[] {
  const rows = analysis?.participantRoles?.staff;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: any) => ({
      accountId: row?.accountId ? String(row.accountId) : null,
      staffName: row?.staffName ? String(row.staffName) : null,
      role: row?.role ? String(row.role) : null,
      confidence: Number(row?.confidence || 0),
    }))
    .filter((row: ParticipantStaff) => row.staffName || row.accountId);
}

function pickOwner(source: SourceRow, preferredRoles: string[]): ParticipantStaff | null {
  const rows = participantStaffFromAnalysis(source.analysis_json)
    .filter((row) => row.accountId)
    .sort((a, b) => {
      const ar = preferredRoles.includes(String(a.role || '')) ? 1 : 0;
      const br = preferredRoles.includes(String(b.role || '')) ? 1 : 0;
      return br - ar || b.confidence - a.confidence;
    });
  return rows[0] || null;
}

function proposedLostReason(caseItem: any, sourceRows: SourceRow[]) {
  const canonical = deriveProposedCaseLostReasonV23(
    caseItem,
    sourceRows.map((row) => ({
      rawText: row.raw_text || null,
      analysisJson: row.analysis_json || null,
    }))
  );
  if (canonical.reason) return canonical;

  const text = sourceRows.map((row) => String(row.raw_text || '')).join('\n');
  if (caseItem.failure && DELIVERY_FAILURE_RX.test(text)) return { reason: 'delivery_or_fulfillment_failure', confidence: 84 };
  if ((caseItem.state === 'recovery' || caseItem.state === 'awaiting_customer') && Number(caseItem.recoveryAttempts || 0) >= 2) {
    return { reason: 'no_response_after_followup', confidence: 76 };
  }
  return { reason: null, confidence: null };
}

function proposedOutcome(caseItem: any, verifiedInvoice: SourceRow | null) {
  if (verifiedInvoice?.matched_invoice_id) return { outcome: 'verified_sale', confidence: 100 };
  if (caseItem.orderConfirmed) return { outcome: 'order_confirmed_waiting_invoice', confidence: 92 };
  if (caseItem.customerReengaged) return { outcome: 'customer_reengaged', confidence: 90 };
  if (caseItem.failure || caseItem.complaint || caseItem.state === 'recovery') return { outcome: 'followup_needed', confidence: 88 };
  if (caseItem.state === 'awaiting_pharmacy') return { outcome: 'awaiting_pharmacy', confidence: 95 };
  if (caseItem.state === 'awaiting_customer') return { outcome: 'awaiting_customer', confidence: 95 };
  return { outcome: 'open', confidence: 70 };
}

function stageCandidates(caseItem: any, rows: SourceRow[]) {
  const stages: Array<{ stage: string; source: SourceRow; preferred: string[] }> = [];
  const sorted = [...rows].sort((a, b) => String(a.conversation_started_at || '').localeCompare(String(b.conversation_started_at || '')));
  const commercialPreferred = ['pharmacist', 'pharmacy_unknown', 'assistant', 'branch_manager'];
  const recoveryPreferred = ['customer_service', 'management', 'pharmacist'];

  if (caseItem.orderIntent && sorted[0]) stages.push({ stage: 'intake', source: sorted[0], preferred: commercialPreferred });
  const availability = sorted.find((row) => AVAILABILITY_RX.test(String(row.raw_text || '')));
  if (availability) stages.push({ stage: 'availability', source: availability, preferred: commercialPreferred });
  const recommendation = sorted.find((row) => RECOMMENDATION_RX.test(String(row.raw_text || '')));
  if (recommendation) stages.push({ stage: 'recommendation', source: recommendation, preferred: commercialPreferred });
  const confirmation = [...sorted].reverse().find((row) => CONFIRMATION_RX.test(String(row.raw_text || '')));
  if (confirmation) stages.push({ stage: 'confirmation', source: confirmation, preferred: commercialPreferred });
  const complaint = sorted.find((row) => COMPLAINT_RX.test(String(row.raw_text || '')));
  if (complaint) stages.push({ stage: 'complaint', source: complaint, preferred: recoveryPreferred });
  const recovery = [...sorted].reverse().find((row) => RECOVERY_RX.test(String(row.raw_text || '')));
  if (recovery) stages.push({ stage: 'recovery', source: recovery, preferred: recoveryPreferred });
  return stages;
}

export async function syncWhatsAppCustomerCasesV22(
  model: WhatsAppCustomerCaseEngineV22,
  context: SyncWhatsAppCustomerCasesV22Context,
): Promise<SyncWhatsAppCustomerCasesV22Result> {
  const sourceBySession = new Map(context.sessionSources.map((x) => [x.sessionId, x.sourceId]));
  const result: SyncWhatsAppCustomerCasesV22Result = { saved: 0, skipped: 0, failed: 0 };
  const allSourceIds = [...new Set(context.sessionSources.map((x) => x.sourceId).filter(Boolean))];

  const sourceMap = new Map<string, SourceRow>();
  if (allSourceIds.length) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from('whatsapp_review_sources')
      .select('id,branch,customer_id,customer_code,customer_name,customer_phone,conversation_started_at,analysis_json,raw_text,invoice_match_status,matched_invoice_id,matched_invoice_number,matched_invoice_date,matched_invoice_value,invoice_match_confidence')
      .in('id', allSourceIds);
    if (sourceError) throw sourceError;
    for (const row of sourceRows || []) sourceMap.set(String(row.id), row as SourceRow);
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
      const caseSources = sourceIds.map((id) => sourceMap.get(id)).filter((x): x is SourceRow => Boolean(x));
      const rootSource = sourceMap.get(rootSourceId) || null;
      const journeyLink = journeyBySource.get(rootSourceId) || sourceIds.map((id) => journeyBySource.get(id)).find(Boolean) || null;
      const canonicalStaff = new Map<string, ParticipantStaff>();
      for (const source of caseSources) {
        for (const staff of participantStaffFromAnalysis(source.analysis_json)) {
          const key = staff.accountId || `name:${staff.staffName}`;
          const previous = canonicalStaff.get(key);
          if (!previous || staff.confidence > previous.confidence) canonicalStaff.set(key, staff);
        }
      }
      const staffRows = [...canonicalStaff.values()].filter((x) => x.staffName);
      const staffAccountIds = [...new Set(staffRows.map((x) => x.accountId).filter((x): x is string => Boolean(x)))];
      const staffNames = [...new Set(staffRows.map((x) => String(x.staffName)))];

      const verifiedInvoice = caseSources
        .filter((row) => String(row.invoice_match_status || '').toLowerCase() === 'verified' && row.matched_invoice_id)
        .sort((a, b) => Number(b.invoice_match_confidence || 0) - Number(a.invoice_match_confidence || 0))[0] || null;
      const outcome = proposedOutcome(caseItem, verifiedInvoice);
      const lost = proposedLostReason(caseItem, caseSources);
      const commercialOpportunity = Boolean(caseItem.orderIntent || caseItem.recommendation);

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
        proposed_outcome: outcome.outcome,
        outcome_confidence: outcome.confidence,
        outcome_evidence: sourceIds,
        proposed_lost_reason: lost.reason,
        lost_reason_confidence: lost.confidence,
        commercial_opportunity: commercialOpportunity,
        verified_revenue: verifiedInvoice?.matched_invoice_value != null ? Number(verifiedInvoice.matched_invoice_value) : null,
        verified_invoice_id: verifiedInvoice?.matched_invoice_id || null,
        verified_invoice_number: verifiedInvoice?.matched_invoice_number || null,
        verified_sale_at: verifiedInvoice?.matched_invoice_date || null,
        case_json: { ...caseItem, canonicalStaff: staffRows, v23: { proposedOutcome: outcome, proposedLostReason: lost } },
        created_by: context.createdBy || null,
        updated_at: new Date().toISOString(),
      };

      const { data: savedCase, error } = await supabase
        .from('whatsapp_customer_cases_v22')
        .upsert(payload, { onConflict: 'case_key' })
        .select('id')
        .single();
      if (error) throw error;

      const ownershipRows = stageCandidates(caseItem, caseSources)
        .map(({ stage, source, preferred }) => {
          const owner = pickOwner(source, preferred);
          if (!owner?.accountId) return null;
          return {
            case_id: savedCase.id,
            stage,
            owner_account_id: owner.accountId,
            owner_name: owner.staffName,
            owner_role: owner.role,
            ownership_confidence: owner.confidence,
            evidence_source_ids: [source.id],
            evidence_message_ids: [],
            updated_at: new Date().toISOString(),
          };
        })
        .filter(Boolean);
      if (ownershipRows.length) {
        const { error: ownershipError } = await supabase
          .from('whatsapp_case_stage_ownership_v23')
          .upsert(ownershipRows as any[], { onConflict: 'case_id,stage' });
        if (ownershipError) console.warn('[whatsapp-case-v23] stage ownership sync failed; case preserved', savedCase.id, ownershipError);
      }

      result.saved += 1;
    } catch (error) {
      console.warn('[whatsapp-case-v22] failed to persist case', caseItem.id, error);
      result.failed += 1;
    }
  }

  return result;
}
