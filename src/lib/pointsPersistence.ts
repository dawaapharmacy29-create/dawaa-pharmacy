import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';
import { embedRuleCodeInNote, MAX_DEDUCTION_PER_EVENT } from '@/lib/pointsWorkflow';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import type { OperationKind, PointsTxnStatus } from '@/lib/pointsWorkflow';
import { formatApproverList } from '@/lib/approverRoles';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import { TABLES } from '@/lib/supabaseTables';
import { logSupabaseError } from '@/lib/supabaseError';
import { sameEventDeductionGuard } from '@/lib/incentives/incentiveRulesEngine';

export interface PersistPointsInput {
  employeeId: string;
  employeeName: string;
  branch: string;
  branchId?: string | null;
  operation: OperationKind;
  rule: EvaluationRuleDef | null;
  pointsToStore: number;
  basePoints?: number;
  repeatCount?: number;
  multiplier?: number;
  finalPoints?: number;
  userNote: string;
  createdByName: string;
  createdById: string;
  createdByRole: string;
  status: PointsTxnStatus;
  cycle: PharmacyCycle;
  approverRequiredLabel?: string;
  sourceModule?: string;
  source?: string;
  sourceRecordId?: string | null;
  description?: string | null;
  approvedBy?: string | null;
  adminDeltaSigned?: number;
  reasonLabel?: string;
}

function isColumnProblem(message?: string | null) {
  const original = String(message || '');
  const text = original.toLowerCase();
  return (
    /column .* does not exist/i.test(original) ||
    text.includes('schema cache') ||
    text.includes('could not find') ||
    text.includes('does not exist in the schema cache')
  );
}

function isIgnorableSchemaIssue(message?: string | null) {
  const text = String(message || '').toLowerCase();
  return isColumnProblem(message) || text.includes('relation') || text.includes('does not exist');
}

function buildManagerNote(input: PersistPointsInput, ruleCode: string | null): string {
  const parts: string[] = [];
  if (ruleCode) parts.push(embedRuleCodeInNote(ruleCode, ''));
  const meta: string[] = [];
  if (input.basePoints != null) meta.push(`base:${input.basePoints}`);
  if (input.repeatCount != null) meta.push(`repeat:${input.repeatCount}`);
  if (input.multiplier != null) meta.push(`multiplier:${input.multiplier}`);
  if (input.finalPoints != null) meta.push(`final:${input.finalPoints}`);
  if (input.operation === 'admin_adjustment' && input.adminDeltaSigned != null) {
    meta.push(`adjustment:${input.adminDeltaSigned >= 0 ? '+' : ''}${input.adminDeltaSigned}`);
  }
  meta.push(`status:${input.status}`);
  meta.push(`created_by_role:${input.createdByRole}`);
  if (input.approverRequiredLabel) meta.push(`approver:${input.approverRequiredLabel}`);
  if (meta.length) parts.push(`[${meta.join(',')}]`);
  const user = input.userNote.trim();
  if (user) parts.push(user);
  return parts.join('\n').replace(/^\n+/, '').trim();
}

export async function persistPointsTransaction(
  input: PersistPointsInput
): Promise<{ error: string | null; id?: string }> {
  if (!isSupabaseConfigured) return { error: 'إعدادات Supabase غير موجودة.' };
  if (!input.employeeId) {
    return { error: 'الموظف غير موجود أو غير نشط، برجاء تحديث الصفحة واختيار موظف صحيح.' };
  }

  const ruleCode = input.rule?.code ?? null;
  const reason =
    input.reasonLabel ||
    input.rule?.title ||
    (input.operation === 'admin_adjustment' ? 'تعديل إداري' : 'تسوية نقاط');
  const managerNote = buildManagerNote(input, ruleCode);
  const requestedPoints = Math.max(0, Math.abs(Number(input.pointsToStore) || 0));
  const signedDelta =
    input.operation === 'admin_adjustment'
      ? (input.adminDeltaSigned ?? 0)
      : input.operation === 'bonus'
        ? requestedPoints
        : -Math.min(MAX_DEDUCTION_PER_EVENT, requestedPoints);
  const monthCycle = monthCycleFromDate(input.cycle.end);
  const source = input.source || input.sourceModule || 'manual_admin';
  const description = input.description ?? (input.userNote.trim() || null);
  const approvedBy =
    input.approvedBy ??
    (input.status === 'approved' ? input.createdById || input.createdByName || null : null);
  const type =
    input.operation === 'bonus' ? 'reward' : input.operation === 'deduction' ? 'penalty' : 'reward';
  const dbStatus =
    input.status === 'rejected' ? 'cancelled' : input.status === 'pending' ? 'pending' : 'active';
  const fullDescription = [description, managerNote].filter(Boolean).join('\n') || null;

  // Keep the client-side overlap check as fast feedback. The V3 server command remains the
  // authoritative write boundary and performs branch/actor validation plus semantic idempotency.
  if (type === 'penalty' && input.sourceRecordId && ruleCode) {
    const { data: relatedRows, error: relatedError } = await supabase
      .from(TABLES.employeeTransactions)
      .select('id, description, reason, metadata')
      .eq('staff_id', input.employeeId)
      .eq('source_id', input.sourceRecordId)
      .eq('month_cycle', monthCycle)
      .eq('type', 'penalty')
      .limit(20);
    if (!relatedError) {
      const existingRuleCodes = (relatedRows || []).filter(Boolean).flatMap((row) => {
        const metadataCode = String(
          (row.metadata as Record<string, unknown> | null)?.rule_code || ''
        ).trim();
        const embedded =
          String(row.description || row.reason || '').match(/__RULE__:([A-Za-z0-9_-]+)/)?.[1] || '';
        return [metadataCode || embedded].filter(Boolean);
      });
      const guard = sameEventDeductionGuard({ incomingRuleCode: ruleCode, existingRuleCodes });
      if (!guard.allowed && !existingRuleCodes.includes(ruleCode)) {
        console.warn('[points] overlapping deduction blocked', {
          ruleCode,
          conflicts: guard.conflictingRuleCodes,
          sourceRecordId: input.sourceRecordId,
        });
        return {
          error: `يوجد خصم متداخل لنفس الواقعة (${guard.conflictingRuleCodes.join('، ')}). يلزم اعتماد إداري واضح قبل إضافة بند آخر.`,
        };
      }
    } else if (!isIgnorableSchemaIssue(relatedError.message)) {
      logSupabaseError('same event deduction guard', relatedError);
    }
  }

  const { data: commandData, error: commandError } = await supabase.rpc(
    'record_employee_points_transaction_v3',
    {
      p_staff_id: input.employeeId,
      p_signed_points: signedDelta,
      p_reason: reason,
      p_description: fullDescription,
      p_source: source,
      p_source_id: input.sourceRecordId ?? null,
      p_rule_code: ruleCode,
      p_month_cycle: monthCycle,
      p_branch: input.branch,
      p_status: dbStatus,
      p_category: input.rule?.category || null,
      p_metadata: {
        engine_version: 3,
        operation: input.operation,
        base_points: input.basePoints ?? null,
        repeat_count: input.repeatCount ?? null,
        multiplier: input.multiplier ?? null,
        requested_final_points: input.finalPoints ?? null,
        created_by_role: input.createdByRole,
        approved_by: approvedBy,
      },
    }
  );

  if (commandError) {
    logSupabaseError('record_employee_points_transaction_v3', commandError);
    return {
      error:
        'تعذر تسجيل حركة النقاط عبر مسار V3 المعتمد. لم يتم إجراء أي كتابة بديلة لحماية دقة الحوافز. ' +
        commandError.message,
    };
  }

  const row = (commandData || {}) as Record<string, unknown>;
  return { error: null, id: row.id ? String(row.id) : undefined };
}


const CONVERSATION_REVIEW_POINT_SOURCES = [
  'whatsapp_automatic_review',
  'conversation_evaluation',
  'conversation_review',
  'conversation_sales_reviews',
] as const;

export interface ReconcileConversationReviewPointsInput {
  reviewId: string;
  nextStaffId: string;
  nextStaffName: string;
  nextBranch: string;
  nextBranchId?: string | null;
  signedImpact: number;
  cycle: PharmacyCycle;
  automaticReview: boolean;
  actorName: string;
  actorId: string;
  actorRole: string;
  note: string;
}

/**
 * Reconcile the points ledger for a conversation review after a manager edit.
 *
 * The review id is the canonical event identity. Old implementations created separate
 * manager-adjustment events (and even tried to pass synthetic non-UUID source ids to the V3 RPC),
 * which could leave the original pending automatic-review transaction alive and later double-count
 * the incentive. This routine first cancels every live transaction linked to the same review id,
 * preserving each row's original cycle/source while cancelling it, then writes exactly one current
 * approved transaction for the edited review when the resulting impact is non-zero.
 *
 * Manager edits are explicit human decisions, so the replacement transaction is approved.
 */
export async function reconcileConversationReviewPointsAfterManagerEdit(
  input: ReconcileConversationReviewPointsInput
): Promise<{ error: string | null; id?: string }> {
  if (!input.reviewId) return { error: 'معرف تقييم المحادثة غير موجود.' };
  if (!input.nextStaffId) return { error: 'الموظف الصحيح غير محدد بعد تعديل التقييم.' };

  const { data: linkedRows, error: linkedError } = await supabase
    .from(TABLES.employeeTransactions)
    .select('staff_id,source,status,points_delta,month_cycle,branch')
    .eq('source_id', input.reviewId)
    .in('source', [...CONVERSATION_REVIEW_POINT_SOURCES])
    .in('status', ['active', 'approved', 'pending']);

  if (linkedError && !isIgnorableSchemaIssue(linkedError.message)) {
    logSupabaseError('conversation review points reconciliation lookup', linkedError);
    return { error: linkedError.message };
  }

  for (const row of linkedRows || []) {
    const staffId = String(row.staff_id || '').trim();
    const source = String(row.source || '').trim();
    const monthCycle = String(row.month_cycle || '').trim();
    if (!staffId || !source || !monthCycle) continue;

    const existingDelta = Number(row.points_delta || 0);
    const { error: cancelError } = await supabase.rpc('record_employee_points_transaction_v3', {
      p_staff_id: staffId,
      p_signed_points: existingDelta,
      p_reason: 'إلغاء أثر سابق بعد تعديل تقييم محادثة',
      p_description: `تم إلغاء الحركة السابقة المرتبطة بالتقييم ${input.reviewId} قبل تسجيل النسخة المعدلة. ${input.note}`,
      p_source: source,
      p_source_id: input.reviewId,
      p_rule_code: null,
      p_month_cycle: monthCycle,
      p_branch: String(row.branch || ''),
      p_status: 'cancelled',
      p_category: null,
      p_metadata: {
        engine_version: 3,
        reconciliation: 'conversation_review_manager_edit_v1',
        superseded_by_manager_edit: true,
      },
    });

    if (cancelError) {
      logSupabaseError('conversation review points cancellation', cancelError);
      return {
        error:
          'تعذر إلغاء حركة النقاط السابقة المرتبطة بالتقييم قبل تسجيل التعديل. ' +
          cancelError.message,
      };
    }
  }

  if (input.signedImpact === 0) return { error: null };

  const source = input.automaticReview ? 'whatsapp_automatic_review' : 'conversation_evaluation';
  return persistPointsTransaction({
    employeeId: input.nextStaffId,
    employeeName: input.nextStaffName,
    branch: input.nextBranch,
    branchId: input.nextBranchId ?? null,
    operation: input.signedImpact > 0 ? 'bonus' : 'deduction',
    rule: null,
    pointsToStore: Math.abs(input.signedImpact),
    basePoints: Math.abs(input.signedImpact),
    finalPoints: Math.abs(input.signedImpact),
    userNote: input.note,
    createdByName: input.actorName,
    createdById: input.actorId,
    createdByRole: input.actorRole,
    status: 'approved',
    cycle: input.cycle,
    source,
    sourceModule: 'conversation_evaluation',
    sourceRecordId: input.reviewId,
    description: `الأثر النهائي بعد تعديل إداري لتقييم المحادثة ${input.reviewId}`,
    reasonLabel: 'أثر تقييم محادثة بعد مراجعة المدير',
  });
}

export function approverHintFromRule(rule: EvaluationRuleDef | null): string | undefined {
  if (!rule?.allowed_approver_roles?.length) return undefined;
  return formatApproverList(rule.allowed_approver_roles);
}
