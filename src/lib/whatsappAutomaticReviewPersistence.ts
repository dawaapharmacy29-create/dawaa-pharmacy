import { supabase } from '@/lib/supabase';
import { persistPointsTransaction } from '@/lib/pointsPersistence';
import { resolveStaffNameToStaffId } from '@/lib/staffIdentityMapping';
import { appendWhatsAppReviewAudit } from '@/lib/whatsappReviewPersistenceV4';
import { AUTOMATIC_REVIEW_REVIEWER_LABEL, monthCycleFromDate } from '@/lib/conversationReviews';
import { logSupabaseError } from '@/lib/supabaseError';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { evaluateAutomaticWhatsAppReview } from '@/lib/whatsappAutomaticReviewScoring';

export interface AutomaticReviewSourceContext {
  sourceId: string;
  session: WhatsAppConversationSession;
  branch: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  staffName: string | null;
  reviewCycle: PharmacyCycle;
}

export type AutomaticReviewPersistStatus =
  | 'saved'
  | 'skipped_no_staff'
  | 'skipped_ambiguous_staff'
  | 'skipped_existing'
  | 'failed';

export interface AutomaticReviewPersistOutcome {
  status: AutomaticReviewPersistStatus;
  reviewId: string | null;
  finalScore: number | null;
  pointsImpact: number;
  /** true فقط لو أثر النقاط اتسجل فعلاً في جدول الحركات (أو مفيش أثر أصلاً) */
  pointsRecorded: boolean;
  /** رسالة الخطأ الحقيقية من persistPointsTransaction لو الـ RPC المعتمد فشل */
  pointsError: string | null;
  error: string | null;
  suspicions: string[];
}

const SYSTEM_REVIEWER_NAME = AUTOMATIC_REVIEW_REVIEWER_LABEL;
const SYSTEM_REVIEWER_ROLE = 'automatic_system';
const SYSTEM_ACTOR_ID = 'system:whatsapp-automatic-review';

function outcome(
  partial: Partial<AutomaticReviewPersistOutcome> & { status: AutomaticReviewPersistStatus }
): AutomaticReviewPersistOutcome {
  return {
    status: partial.status,
    reviewId: partial.reviewId ?? null,
    finalScore: partial.finalScore ?? null,
    pointsImpact: partial.pointsImpact ?? 0,
    pointsRecorded: partial.pointsRecorded ?? false,
    pointsError: partial.pointsError ?? null,
    error: partial.error ?? null,
    suspicions: partial.suspicions ?? [],
  };
}

/**
 * يبني تقييم محادثة واتساب آليًا كاملًا ويحفظه في conversation_sales_reviews،
 * مع حمايتين أساسيتين لا يجوز التنازل عنهما:
 *
 * 1) التقييم الآلي ممنوع يعتمد قرار "خطأ جسيم" (طبي/فاتورة/إساءة...) بنفسه.
 *    has_critical_error / has_medical_error / has_invoice_error / has_delivery_issue
 *    بتتسجل false دايمًا هنا، وأي اشتباه بيظهر في evaluation_reason فقط كتنبيه
 *    للمراجع البشري (انظر whatsappAutomaticReviewScoring.ts).
 * 2) أي تأثير نقاط ناتج عن هذا التقييم بيتسجل بحالة "pending" دايمًا في
 *    persistPointsTransaction، بصرف النظر عن impactStatus المحسوب، لحد ما
 *    مدير يعتمده يدويًا. ونتأكد فعليًا من نتيجة الخطأ اللي بترجعها
 *    persistPointsTransaction قبل ما نعتبر أثر النقاط اتسجل.
 */
export async function persistAutomaticWhatsAppReview(
  ctx: AutomaticReviewSourceContext
): Promise<AutomaticReviewPersistOutcome> {
  const { data: existingReview, error: existingError } = await supabase
    .from('conversation_sales_reviews')
    .select('id')
    .eq('whatsapp_review_source_id', ctx.sourceId)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') {
    logSupabaseError('automatic whatsapp review existing check', existingError);
    return outcome({ status: 'failed', error: existingError.message });
  }
  if (existingReview?.id) {
    return outcome({ status: 'skipped_existing', reviewId: String(existingReview.id) });
  }

  const introducedStaffNames = [...new Set(
    (ctx.session.outboundStaffNames || [])
      .map((name) => String(name || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
  )];

  // Automatic scoring must never guess which doctor owns the session when more than one
  // introduced staff identity appears. This is especially important for first-response speed:
  // attributing the session to outboundStaffNames[0] could penalize the wrong doctor.
  if (introducedStaffNames.length > 1) {
    return outcome({
      status: 'skipped_ambiguous_staff',
      error: `توجد أكثر من هوية موظف في نفس الجلسة: ${introducedStaffNames.join('، ')}. يلزم تقييم بشري لتحديد المسؤول.`,
    });
  }

  const staffId = ctx.staffName ? await resolveStaffNameToStaffId(ctx.staffName) : null;
  if (!staffId) {
    return outcome({ status: 'skipped_no_staff' });
  }

  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id, name, branch, branch_id, role')
    .eq('id', staffId)
    .maybeSingle();
  if (staffError || !staffRow) {
    return outcome({
      status: 'failed',
      error: staffError?.message || 'تعذر تحميل بيانات الموظف لهذا الاسم.',
    });
  }

  const { build, result } = evaluateAutomaticWhatsAppReview(ctx.session, ctx.customerName);
  const branch = ctx.branch || staffRow.branch || null;
  const monthCycle = monthCycleFromDate(ctx.reviewCycle.end);
  const suspicionLabels = build.suspicions.map((s) => `${s.key}: "${s.evidenceQuote}"`);

  const evaluationReasonParts = [
    `تقييم آلي كامل (${build.signalResolvedCount} بندًا من أدلة نصية، ${build.defaultFallbackCount} بالإعداد الافتراضي الآمن).`,
  ];
  if (suspicionLabels.length) {
    evaluationReasonParts.push(
      `⚠ اشتباه بخطأ جسيم يحتاج تأكيد بشري قبل اعتماده: ${suspicionLabels.join(' | ')}`
    );
  }

  const payload = {
    reviewer_name: SYSTEM_REVIEWER_NAME,
    reviewer_role: SYSTEM_REVIEWER_ROLE,
    staff_id: staffRow.id,
    staff_name: staffRow.name,
    staff_role: staffRow.role || null,
    branch,
    branch_id: staffRow.branch_id || null,
    customer_id: ctx.customerId,
    customer_name: ctx.customerName || ctx.session.customerName,
    customer_code: ctx.customerCode,
    customer_phone: ctx.customerPhone,
    evaluation_kind: 'automatic',
    evaluation_reason: evaluationReasonParts.join(' '),
    conversation_date: ctx.session.startedAt.toISOString(),
    conversation_type: 'whatsapp',
    review_date: new Date().toISOString().slice(0, 10),
    month_cycle: monthCycle,
    final_score: result.finalScore,
    total_score: result.finalScore,
    base_score: 100,
    earned_points: result.earnedPoints,
    total_applicable_points: result.totalApplicablePoints,
    total_applicable_items: result.totalApplicableItems,
    total_not_applicable_items: result.totalNotApplicableItems,
    base_points_impact: result.baseDoctorImpact,
    extra_penalty_points: result.extraPenaltyPoints,
    doctor_points_impact: result.doctorPointsImpact,
    point_impact: result.doctorPointsImpact,
    // حماية (2): أي أثر نقاط بيتسجل pending دايمًا لحد اعتماد مدير، بصرف
    // النظر عن impactStatus المحسوب.
    impact_status: result.doctorPointsImpact !== 0 ? 'pending' : 'approved',
    level: result.level,
    conversation_level: result.level,
    main_positive_reason: result.mainPositiveReason,
    main_negative_reason: result.mainNegativeReason,
    top_positive_reason: result.mainPositiveReason,
    top_deduction_reason: result.mainNegativeReason,
    training_recommendation: result.trainingRecommendation,
    forgotten_customer: result.forgottenCustomer,
    missed_sale_opportunity: result.missedSalesOpportunity,
    missed_sales_opportunity: result.missedSalesOpportunity,
    successful_cross_sell: result.successfulCrossSell,
    handled_angry_customer_well: result.handledAngryCustomerWell,
    excellent_case: result.excellentCase,
    // حماية (1): التقييم الآلي ممنوع يفعّل خطأ جسيم بنفسه، مهما كانت الاشتباهات
    // (المسجلة في evaluation_reason فقط أعلاه).
    has_critical_error: false,
    has_medical_error: false,
    has_invoice_error: false,
    has_delivery_issue: false,
    has_complaint: build.suggestion.items.some(
      (item) => item.key === 'angry_customer' && item.status !== 'not_applicable'
    ),
    repeated_error_type: result.repeatErrorType,
    repeat_count: 0,
    repeat_multiplier: 1,
    raw_scores: {
      engine: 'whatsapp-automatic-review-v1',
      criteria: build.state,
      trace: build.trace,
      suspicions: build.suspicions,
      result,
    },
    review_items: result.reviewItems,
    whatsapp_review_source_id: ctx.sourceId,
    submission_fingerprint: `auto:${ctx.sourceId}`,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('conversation_sales_reviews')
    .insert(payload)
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raced } = await supabase
        .from('conversation_sales_reviews')
        .select('id')
        .eq('whatsapp_review_source_id', ctx.sourceId)
        .maybeSingle();
      return outcome({
        status: 'skipped_existing',
        reviewId: raced?.id ? String(raced.id) : null,
        finalScore: result.finalScore,
        pointsImpact: result.doctorPointsImpact,
        suspicions: suspicionLabels,
      });
    }
    logSupabaseError('automatic whatsapp review insert', insertError);
    return outcome({
      status: 'failed',
      error: insertError.message,
      finalScore: result.finalScore,
      pointsImpact: result.doctorPointsImpact,
      suspicions: suspicionLabels,
    });
  }

  const reviewId = String(inserted.id);
  let pointsRecorded = result.doctorPointsImpact === 0;
  let pointsError: string | null = null;

  if (result.doctorPointsImpact !== 0) {
    const pointsResult = await persistPointsTransaction({
      employeeId: staffRow.id,
      employeeName: staffRow.name,
      branch: branch || '',
      branchId: staffRow.branch_id || null,
      operation: result.doctorPointsImpact > 0 ? 'bonus' : 'deduction',
      rule: null,
      pointsToStore: Math.abs(result.doctorPointsImpact),
      basePoints: Math.abs(result.baseDoctorImpact),
      finalPoints: Math.abs(result.doctorPointsImpact),
      reasonLabel: `تقييم محادثة واتساب آلي - النتيجة ${result.finalScore}/100`,
      userNote: [
        `تقييم آلي — ${build.signalResolvedCount}/${build.trace.length} بندًا من أدلة نصية`,
        result.mainNegativeReason
          ? `سبب التأثير: ${result.mainNegativeReason}`
          : result.mainPositiveReason,
        `review_id:${reviewId}`,
      ]
        .filter(Boolean)
        .join(' | '),
      createdByName: SYSTEM_REVIEWER_NAME,
      createdById: SYSTEM_ACTOR_ID,
      createdByRole: SYSTEM_REVIEWER_ROLE,
      // إجباري "pending" دايمًا — التقييم الآلي ممنوع يعتمد حركة نقاط بنفسه
      // حتى لو evaluateConversationReview حسب impactStatus = 'approved'.
      status: 'pending',
      cycle: ctx.reviewCycle,
      source: 'whatsapp_automatic_review',
      sourceModule: 'whatsapp_automatic_review',
      sourceRecordId: reviewId,
      description: result.mainNegativeReason || result.mainPositiveReason,
    });

    // === إصلاح الخلل الأساسي (2) ===
    // الكود القديم كان بيستدعي persistPointsTransaction من غير ما يتأكد من
    // نتيجة الخطأ اللي بترجعها: لو الـ RPC المعتمد (record_employee_points_
    // transaction_v3) فشل، صف التقييم كان بيتسجل وكأن فيه أثر نقاط pending
    // حقيقي بينما مفيش أي حركة فعلية في جدول النقاط. هنا بنتأكد من
    // pointsResult.error ونرجّعه بوضوح بدل ما نفترض النجاح.
    if (pointsResult.error) {
      pointsError = pointsResult.error;
      pointsRecorded = false;
      logSupabaseError(
        'automatic whatsapp review points transaction',
        new Error(pointsResult.error)
      );
    } else {
      pointsRecorded = true;
    }
  }

  try {
    await supabase
      .from('whatsapp_review_sources')
      .update({
        official_review_id: reviewId,
        review_status: 'ready_detailed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.sourceId);
    await appendWhatsAppReviewAudit(
      ctx.sourceId,
      'automatic_review_created',
      null,
      {
        reviewId,
        finalScore: result.finalScore,
        pointsImpact: result.doctorPointsImpact,
        pointsRecorded,
        pointsError,
      },
      SYSTEM_ACTOR_ID,
      SYSTEM_REVIEWER_NAME
    );
  } catch (linkError) {
    // ربط المصدر بالتقييم + سجل الـ audit تحسين إضافي، فشلهم لا يُسقط العملية
    // بعد ما التقييم (ونقاطه لو نجحت) اتسجلوا فعلاً.
    console.warn('[whatsappAutomaticReviewPersistence] failed to link source to review', linkError);
  }

  return outcome({
    status: 'saved',
    reviewId,
    finalScore: result.finalScore,
    pointsImpact: result.doctorPointsImpact,
    pointsRecorded,
    pointsError,
    suspicions: suspicionLabels,
  });
}
