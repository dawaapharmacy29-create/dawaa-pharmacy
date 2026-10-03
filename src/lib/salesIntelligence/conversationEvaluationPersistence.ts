import { supabase } from '@/lib/supabase';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import { logSupabaseError } from '@/lib/supabaseError';
import type { CaseIntelligenceView } from './types';
import type {
  ConversationEvaluationFinalItem,
  ConversationEvaluationResult,
} from './conversationEvaluation';

export type CaseConversationReviewPersistStatus =
  | 'saved'
  | 'updated'
  | 'skipped_existing'
  | 'skipped_no_staff'
  | 'skipped_ambiguous_staff'
  | 'skipped_non_current_case'
  | 'skipped_source_mismatch'
  | 'failed';

export interface CaseConversationReviewPersistOutcome {
  status: CaseConversationReviewPersistStatus;
  reviewId: string | null;
  finalScore: number | null;
  error: string | null;
}

export interface PersistCaseConversationReviewInput {
  sourceId: string;
  view: CaseIntelligenceView;
  evaluation: ConversationEvaluationResult;
}

function itemByKey(
  evaluation: ConversationEvaluationResult,
  key: ConversationEvaluationFinalItem['key']
): ConversationEvaluationFinalItem | null {
  return evaluation.items.find((item) => item.key === key) ?? null;
}

function score10(
  evaluation: ConversationEvaluationResult,
  key: ConversationEvaluationFinalItem['key']
): number | null {
  const item = itemByKey(evaluation, key);
  return item?.status === 'assessed' ? item.normalizedScore10 : null;
}

function selected(
  evaluation: ConversationEvaluationResult,
  key: ConversationEvaluationFinalItem['key'],
  values: string[]
): boolean {
  const item = itemByKey(evaluation, key);
  return Boolean(item?.status === 'assessed' && item.selectedOption && values.includes(item.selectedOption));
}

function mainReason(
  evaluation: ConversationEvaluationResult,
  band: 'strength' | 'needs_development'
): string | null {
  const candidates = evaluation.items
    .filter((item) => item.status === 'assessed' && item.performanceBand === band)
    .sort((a, b) => {
      const left = a.normalizedScore10 ?? (band === 'strength' ? -1 : 99);
      const right = b.normalizedScore10 ?? (band === 'strength' ? -1 : 99);
      return band === 'strength' ? right - left : left - right;
    });
  const first = candidates[0];
  return first ? `${first.label}: ${first.reason}` : null;
}

function trainingRecommendation(evaluation: ConversationEvaluationResult): string | null {
  const weak = evaluation.items
    .filter(
      (item) =>
        item.source === 'automatic' &&
        item.status === 'assessed' &&
        item.performanceBand === 'needs_development'
    )
    .slice()
    .sort((a, b) => (a.normalizedScore10 ?? 99) - (b.normalizedScore10 ?? 99))
    .slice(0, 3);

  if (!weak.length) return null;
  return `مراجعة البنود التالية في المحادثة: ${weak.map((item) => item.label).join('، ')}.`;
}

function distinctStaffIds(view: CaseIntelligenceView): string[] {
  return Array.from(
    new Set(
      view.staff.participants
        .map((participant) => String(participant.staffId ?? '').trim())
        .filter(Boolean)
    )
  );
}

export function buildCaseConversationReviewPayload(input: {
  sourceId: string;
  view: CaseIntelligenceView;
  evaluation: ConversationEvaluationResult;
  staffRow: {
    id: string;
    name: string;
    branch?: string | null;
    branch_id?: string | null;
    role?: string | null;
  };
}) {
  const { sourceId, view, evaluation, staffRow } = input;
  const automaticItems = evaluation.items.filter((item) => item.source === 'automatic');
  const assessedAutomatic = automaticItems.filter(
    (item) => item.status === 'assessed' && item.pointsEarned != null
  );
  const manualClinicalRequired = evaluation.items.some(
    (item) => item.status === 'manual_review_required'
  );

  const positive = mainReason(evaluation, 'strength');
  const negative = mainReason(evaluation, 'needs_development');
  const score = evaluation.summary.autoScore;
  const closing = itemByKey(evaluation, 'closing_message');

  return {
    // System-authored conversation analysis. This stage deliberately has NO doctor-points effect.
    reviewer_id: null,
    reviewer_name: null,
    reviewer_role: null,
    staff_id: staffRow.id,
    doctor_id: staffRow.id,
    staff_name: staffRow.name,
    doctor_name: staffRow.name,
    staff_role: staffRow.role ?? null,
    branch: view.branch.branchNameRaw || staffRow.branch || null,
    branch_id: view.branch.branchId || staffRow.branch_id || null,

    customer_id: view.customer.customerId,
    customer_name: view.customer.customerName ?? null,
    customer_code: view.customer.customerCode ?? null,
    customer_phone: view.customer.customerPhone,

    evaluation_kind: 'automatic',
    evaluation_reason:
      'تحليل محادثة آلي Case-level من Sales Intelligence. الدليل الناقص لا يتحول إلى خصم، والاستشارة والجرعة/طريقة الاستخدام خارج الدرجة الآلية.',
    conversation_date: view.interaction.startedAt,
    conversation_type: 'whatsapp',
    review_date: new Date().toISOString().slice(0, 10),
    month_cycle: monthCycleFromDate(view.interaction.startedAt),

    invoice_number: view.sale.selectedInvoiceNumber ?? null,

    final_score: score,
    total_score: score,
    base_score: 100,
    earned_points: evaluation.summary.earnedAutoPoints,
    total_applicable_points: evaluation.summary.assessedAutoMaxPoints,
    total_applicable_items: assessedAutomatic.length,
    total_not_applicable_items: evaluation.summary.notApplicableCount,

    // CRITICAL SCOPE GUARD: conversation analysis only. No doctor/incentive points yet.
    point_impact: 0,
    doctor_points_impact: 0,
    base_points_impact: 0,
    extra_penalty_points: 0,
    positive_points: 0,
    negative_points: 0,
    severe_error_points: 0,
    impact_status: 'approved',

    level: evaluation.summary.level,
    conversation_level: evaluation.summary.level,
    main_positive_reason: positive,
    top_positive_reason: positive,
    main_negative_reason: negative,
    top_deduction_reason: negative,
    training_recommendation: trainingRecommendation(evaluation),

    // These severe/medical conclusions are NOT made automatically by this conversation analyzer.
    has_critical_error: false,
    has_medical_error: false,
    has_invoice_error: false,
    has_delivery_issue: false,

    has_complaint: itemByKey(evaluation, 'angry_customer')?.status === 'assessed',
    missed_sale_opportunity: selected(evaluation, 'sales_closing', ['missed']),
    missed_sales_opportunity: selected(evaluation, 'sales_closing', ['missed']),
    successful_cross_sell: selected(evaluation, 'cross_sell_upsell', ['useful']),
    handled_angry_customer_well: selected(evaluation, 'angry_customer', ['solved', 'good']),
    excellent_case:
      score != null &&
      score >= 95 &&
      evaluation.summary.evidenceCoveragePercent >= 85 &&
      evaluation.summary.automaticReliabilityPercent >= 80,

    repeated_error_type: null,
    repeat_count: 0,
    repeat_multiplier: 1,

    response_speed_score: score10(evaluation, 'first_response_speed'),
    greeting_score: score10(evaluation, 'greeting'),
    doctor_name_score: score10(evaluation, 'doctor_name'),
    customer_name_score: score10(evaluation, 'customer_name'),
    tone_language_score: score10(evaluation, 'tone'),
    understanding_score: score10(evaluation, 'understanding'),
    follow_up_score: score10(evaluation, 'followup_after_wait'),

    // Explicitly NULL: user requested manual review only for clinical consultation/dose/usage.
    consultation_quality_score: null,
    dosage_explanation_score: null,

    alternative_handling_score: score10(evaluation, 'unavailable_items'),
    sales_quality_score: score10(evaluation, 'sales_closing'),
    upsell_cross_sell_score: score10(evaluation, 'cross_sell_upsell'),
    complaint_handling_score: score10(evaluation, 'angry_customer'),
    order_confirmation_score: score10(evaluation, 'order_confirmation'),
    closing_message_score: score10(evaluation, 'closing_message'),
    closing_message_used:
      closing?.status === 'assessed' &&
      ['official', 'respectful'].includes(closing.selectedOption ?? ''),

    raw_scores: {
      engine: evaluation.version,
      caseId: evaluation.caseId,
      summary: evaluation.summary,
      criteria: evaluation.items,
    },
    review_items: evaluation.items.map((item) => ({
      key: item.key,
      label: item.label,
      applies: item.status === 'assessed',
      selectedOption: item.selectedOption ?? '',
      pointsEarned: item.status === 'assessed' ? item.pointsEarned ?? 0 : 0,
      maxPoints: item.maxPoints,
      notes: item.reason,
      evaluationStatus: item.status,
      confidence: item.confidence,
      evidenceMessageIds: item.evidenceMessageIds,
      systemRecordIds: item.systemRecordIds,
    })),

    whatsapp_review_source_id: sourceId,
    sales_intelligence_case_id: view.caseId,
    automatic_evaluation_version: evaluation.version,
    automatic_evaluation_json: evaluation,
    evidence_coverage_percent: evaluation.summary.evidenceCoveragePercent,
    automatic_reliability_percent: evaluation.summary.automaticReliabilityPercent,
    manual_clinical_review_required: manualClinicalRequired,

    submission_fingerprint: `auto-case:${sourceId}:${view.caseId}`,
  };
}

/**
 * Persists ONE canonical Sales Intelligence case/interaction.
 *
 * A stable case_id owns exactly one automatic review row. Re-analysis UPDATES that row in place
 * rather than freezing the first result forever. If the case was retired and later becomes active
 * again, the same row is reactivated only after the current-case gate below succeeds.
 */
export async function persistAutomaticCaseConversationReviewWithClient(
  client: any,
  input: PersistCaseConversationReviewInput
): Promise<CaseConversationReviewPersistOutcome> {
  const { sourceId, view, evaluation } = input;

  if (evaluation.caseId !== view.caseId) {
    return {
      status: 'failed',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: 'evaluation_case_mismatch',
    };
  }

  const { data: currentCase, error: currentError } = await client
    .from('sales_intelligence_current_case_analyses')
    .select('case_id')
    .eq('case_id', view.caseId)
    .maybeSingle();

  if (currentError) {
    logSupabaseError('case conversation review current-case gate', currentError);
    return {
      status: 'failed',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: currentError.message,
    };
  }
  if (!currentCase?.case_id) {
    return {
      status: 'skipped_non_current_case',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: null,
    };
  }

  const { data: owner, error: ownerError } = await client
    .from('sales_intelligence_cases')
    .select('case_id, conversation_id')
    .eq('case_id', view.caseId)
    .maybeSingle();

  if (ownerError) {
    logSupabaseError('case conversation review owner gate', ownerError);
    return {
      status: 'failed',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: ownerError.message,
    };
  }
  if (!owner || String(owner.conversation_id ?? '') !== String(sourceId)) {
    return {
      status: 'skipped_source_mismatch',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: null,
    };
  }

  const staffIds = distinctStaffIds(view);
  if (staffIds.length === 0) {
    return {
      status: 'skipped_no_staff',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: null,
    };
  }
  if (staffIds.length > 1) {
    return {
      status: 'skipped_ambiguous_staff',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: 'multiple_staff_ids_in_case',
    };
  }

  const { data: existing, error: existingError } = await client
    .from('conversation_sales_reviews')
    .select('id, evaluation_kind')
    .eq('whatsapp_review_source_id', sourceId)
    .eq('sales_intelligence_case_id', view.caseId)
    .maybeSingle();

  if (existingError && existingError.code !== 'PGRST116') {
    logSupabaseError('case conversation review existing gate', existingError);
    return {
      status: 'failed',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: existingError.message,
    };
  }
  if (existing?.id && String(existing.evaluation_kind || '') !== 'automatic') {
    return {
      status: 'failed',
      reviewId: String(existing.id),
      finalScore: evaluation.summary.autoScore,
      error: 'existing_case_review_not_automatic',
    };
  }

  const { data: staffRow, error: staffError } = await client
    .from('staff')
    .select('id, name, branch, branch_id, role')
    .eq('id', staffIds[0])
    .maybeSingle();

  if (staffError || !staffRow) {
    if (staffError) logSupabaseError('case conversation review staff gate', staffError);
    return {
      status: 'failed',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: staffError?.message ?? 'staff_not_found',
    };
  }

  const payload = buildCaseConversationReviewPayload({
    sourceId,
    view,
    evaluation,
    staffRow: {
      id: String(staffRow.id),
      name: String(staffRow.name ?? ''),
      branch: staffRow.branch ?? null,
      branch_id: staffRow.branch_id ?? null,
      role: staffRow.role ?? null,
    },
  });
  const currentPayload = {
    ...payload,
    is_current: true,
    superseded_at: null,
    superseded_reason: null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error: updateError } = await client
      .from('conversation_sales_reviews')
      .update(currentPayload)
      .eq('id', existing.id);
    if (updateError) {
      logSupabaseError('case conversation review update', updateError);
      return {
        status: 'failed',
        reviewId: String(existing.id),
        finalScore: evaluation.summary.autoScore,
        error: updateError.message,
      };
    }
    return {
      status: 'updated',
      reviewId: String(existing.id),
      finalScore: evaluation.summary.autoScore,
      error: null,
    };
  }

  const { data: inserted, error: insertError } = await client
    .from('conversation_sales_reviews')
    .insert(currentPayload)
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raced, error: racedError } = await client
        .from('conversation_sales_reviews')
        .select('id, evaluation_kind')
        .eq('whatsapp_review_source_id', sourceId)
        .eq('sales_intelligence_case_id', view.caseId)
        .maybeSingle();
      if (racedError || !raced?.id || String(raced.evaluation_kind || '') !== 'automatic') {
        return {
          status: 'failed',
          reviewId: raced?.id ? String(raced.id) : null,
          finalScore: evaluation.summary.autoScore,
          error: racedError?.message ?? 'automatic_review_race_resolution_failed',
        };
      }
      const { error: racedUpdateError } = await client
        .from('conversation_sales_reviews')
        .update(currentPayload)
        .eq('id', raced.id);
      if (racedUpdateError) {
        return {
          status: 'failed',
          reviewId: String(raced.id),
          finalScore: evaluation.summary.autoScore,
          error: racedUpdateError.message,
        };
      }
      return {
        status: 'updated',
        reviewId: String(raced.id),
        finalScore: evaluation.summary.autoScore,
        error: null,
      };
    }
    logSupabaseError('case conversation review insert', insertError);
    return {
      status: 'failed',
      reviewId: null,
      finalScore: evaluation.summary.autoScore,
      error: insertError.message,
    };
  }

  return {
    status: 'saved',
    reviewId: inserted?.id ? String(inserted.id) : null,
    finalScore: evaluation.summary.autoScore,
    error: null,
  };
}

/**
 * Browser/default client wrapper.
 * The canonical refresh calls persistAutomaticCaseConversationReviewWithClient(service, ...)
 * so the evaluation write happens inside the same authenticated server-side refresh boundary.
 */
export async function persistAutomaticCaseConversationReview(
  input: PersistCaseConversationReviewInput
): Promise<CaseConversationReviewPersistOutcome> {
  return persistAutomaticCaseConversationReviewWithClient(supabase, input);
}
