import { supabase } from '@/lib/supabase';
import { getStaffSessionToken } from '@/lib/auth/staffSession';
import { DERIVED_EVALUATION_FLAG_COLUMNS } from '@/lib/reviews/conversationReviewEvaluationColumns';

// Manager "full correction" of a versioned conversation review (an automatic review, or an
// earlier manager correction) is VERSIONING, never an overwrite: automatic evidence is immutable
// for client writes (dawaa_guard_automatic_conversation_review_writer_v2). One staff-session
// command validates session/permission/scope, supersedes the current version, inserts the new
// manager_correction version (FK lineage via supersedes_review_id) and reverses/applies points
// exactly once, all in one transaction. A retry with the same idempotency key returns the same
// version. The browser never writes the review or the points ledger directly on this path.
export const CONVERSATION_REVIEW_CORRECTION_COMMAND =
  'dawaa_correct_conversation_review_session_v1';

/**
 * Evaluation keys the command accepts. Every key is REQUIRED (a missing key is rejected, never
 * inherited from the superseded version) and any other key is rejected. Provenance is server-owned.
 */
export const CORRECTION_EVALUATION_KEYS = [
  'level',
  'conversation_level',
  'final_score',
  'doctor_points_impact',
  'base_points_impact',
  'extra_penalty_points',
  'impact_status',
  'total_applicable_items',
  'total_not_applicable_items',
  'total_applicable_points',
  'earned_points',
  'positive_points',
  'negative_points',
  'severe_error_points',
  'main_positive_reason',
  'main_negative_reason',
  'top_positive_reason',
  'top_deduction_reason',
  'forgotten_customer',
  'missed_sales_opportunity',
  'missed_sale_opportunity',
  'successful_cross_sell',
  'handled_angry_customer_well',
  'excellent_case',
  'has_critical_error',
  'repeated_error_type',
  'raw_scores',
  'review_items',
  'response_speed_score',
  'greeting_score',
  'greeting_message_used',
  'doctor_name_used_in_greeting',
  'doctor_name_used',
  'doctor_name_score',
  'customer_name_used',
  'customer_name_score',
  'tone_language_score',
  'understanding_score',
  'follow_up_score',
  'consultation_quality_score',
  'dosage_explanation_score',
  'alternative_handling_score',
  'sales_quality_score',
  'upsell_cross_sell_score',
  'complaint_handling_score',
  'order_confirmation_score',
  'closing_message_score',
  'reviewer_notes',
  'training_recommendation',
  'evaluation_reason',
  // flag columns derived from the same criteria/severe errors as raw_scores (re-checked server-side)
  ...DERIVED_EVALUATION_FLAG_COLUMNS,
] as const;

const VERSIONED_KINDS = new Set(['automatic', 'manager_correction']);

/** Automatic reviews and manager corrections are corrected by versioning, never by UPDATE. */
export function isVersionedConversationReview(row: { evaluation_kind?: string | null } | null) {
  return VERSIONED_KINDS.has(
    String(row?.evaluation_kind ?? '')
      .trim()
      .toLowerCase()
  );
}

/** Display label for the review kind column; a correction version is named as such. */
export function conversationReviewKindLabel(row: {
  evaluation_kind?: string | null;
  conversation_type?: string | null;
}) {
  const kind = String(row.evaluation_kind ?? '').trim();
  if (kind.toLowerCase() === 'manager_correction')
    return row.conversation_type ? `تصحيح إداري · ${row.conversation_type}` : 'تصحيح إداري';
  return kind || row.conversation_type || '-';
}

/**
 * Picks exactly the whitelisted evaluation keys (all of them) from the editor's recalculated payload
 * and adds the responsible staff id. Identity, customer, conversation, branch and provenance fields are dropped:
 * the command copies them from the version being corrected.
 */
export function buildConversationReviewCorrection(
  payload: Record<string, unknown>,
  staffId: string
): Record<string, unknown> {
  const correction: Record<string, unknown> = { staff_id: staffId };
  // Every key is sent (undefined -> null, which JSON would otherwise drop): the command rejects a
  // missing key instead of inheriting the superseded version's value.
  for (const key of CORRECTION_EVALUATION_KEYS) correction[key] = payload[key] ?? null;
  return correction;
}

export interface ConversationReviewCorrectionParams {
  reviewId: string;
  idempotencyKey: string;
  reason: string;
  correction: Record<string, unknown>;
}

export interface ConversationReviewCorrectionDeps {
  client?: {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  getSessionToken?: () => string | null;
}

export interface ConversationReviewCorrectionResult {
  ok: boolean;
  /** Set when ok: 'created' for a new version, 'already_applied' for an idempotent replay. */
  status?: 'created' | 'already_applied';
  /**
   * When ok: the id of the NEW current version. When not ok: the version that replaced the edited
   * review (only for review_version_not_current), otherwise null — nothing was written.
   */
  currentReviewId: string | null;
  supersededReviewId?: string;
  error?: string;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

function errorDetail(error: unknown) {
  if (error && typeof error === 'object' && 'details' in error)
    return String((error as { details: unknown }).details ?? '');
  return '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Never throws. On failure nothing was written (the command is all-or-nothing). */
export async function correctConversationReviewVersion(
  params: ConversationReviewCorrectionParams,
  deps: ConversationReviewCorrectionDeps = {}
): Promise<ConversationReviewCorrectionResult> {
  if (!params.reviewId || !params.idempotencyKey)
    return { ok: false, error: 'review_id_required', currentReviewId: null };
  if (!params.reason.trim())
    return { ok: false, error: 'correction_reason_required', currentReviewId: null };

  const token = (deps.getSessionToken ?? getStaffSessionToken)();
  if (!token) return { ok: false, error: 'staff_session_required', currentReviewId: null };

  try {
    const client = deps.client ?? supabase;
    const { data, error } = await client.rpc(CONVERSATION_REVIEW_CORRECTION_COMMAND, {
      p_session_token: token,
      p_review_id: params.reviewId,
      p_idempotency_key: params.idempotencyKey,
      p_reason: params.reason.trim(),
      p_correction: params.correction,
    });
    if (error) {
      const message = errorText(error);
      const detail = errorDetail(error).trim();
      return {
        ok: false,
        error: message,
        currentReviewId:
          message.includes('review_version_not_current') && UUID_RE.test(detail) ? detail : null,
      };
    }
    const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const currentReviewId = String(row.review_id ?? '');
    const status = row.status === 'already_applied' ? 'already_applied' : 'created';
    if (!UUID_RE.test(currentReviewId))
      return { ok: false, error: 'correction_result_invalid', currentReviewId: null };
    return {
      ok: true,
      status,
      currentReviewId,
      supersededReviewId: String(row.superseded_review_id ?? params.reviewId),
    };
  } catch (error) {
    return { ok: false, error: errorText(error), currentReviewId: null };
  }
}

const ERROR_MESSAGES: Array<[string, string]> = [
  ['staff_session_required', 'جلسة الموظف غير متاحة أو انتهت. سجّل الدخول مرة أخرى ثم أعد الحفظ.'],
  [
    'invalid_or_expired_staff_session',
    'جلسة الموظف غير متاحة أو انتهت. سجّل الدخول مرة أخرى ثم أعد الحفظ.',
  ],
  ['not_authorized', 'لا توجد صلاحية لتصحيح التقييم.'],
  ['review_scope_denied', 'هذا التقييم خارج نطاق فرعك.'],
  ['review_source_scope_denied', 'مصدر المحادثة خارج نطاق فرعك.'],
  ['correction_staff_scope_denied', 'الموظف المختار خارج نطاق فرعك.'],
  ['self_correction_forbidden', 'لا يمكنك تصحيح تقييم محادثة تخصك.'],
  ['correction_reason_required', 'اكتب سبب التعديل لحفظ نسخة التصحيح.'],
  [
    'review_version_not_current',
    'هذا التقييم تم استبداله بنسخة أحدث. افتح النسخة الحالية ثم عدّلها.',
  ],
  ['review_not_versioned', 'هذا التقييم ليس تقييمًا آليًا أو نسخة تصحيح.'],
  ['correction_staff', 'اختر الموظف المسؤول عن المحادثة.'],
  ['correction_payload', 'بيانات التقييم غير مكتملة أو خارج الحدود المسموحة.'],
  [
    'conversation_review_points_require_official_review',
    'تعذر ربط النقاط لأن مصدر المحادثة لم يعد رسميًا. لم يتم حفظ أي تغيير.',
  ],
  ['not_authorized_for_branch', 'لا توجد صلاحية نقاط لهذا الفرع. لم يتم حفظ أي تغيير.'],
];

export function correctionErrorMessage(error: string) {
  const match = ERROR_MESSAGES.find(([code]) => error.includes(code));
  return match ? match[1] : `تعذر حفظ نسخة التصحيح. لم يتم حفظ أي تغيير: ${error}`;
}

/** One key per correction attempt: kept across retries of a failed save, renewed per editor open. */
export function newCorrectionIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
