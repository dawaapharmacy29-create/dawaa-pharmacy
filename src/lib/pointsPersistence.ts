import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';
import { embedRuleCodeInNote, MAX_DEDUCTION_PER_EVENT } from '@/lib/pointsWorkflow';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import type { OperationKind, PointsTxnStatus } from '@/lib/pointsWorkflow';
import { formatApproverList } from '@/lib/approverRoles';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import {
  createEmployeeTransaction,
  updateEmployeeTransaction,
} from '@/services/employeeTransactionService';
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

function isMissingV3Command(message?: string | null) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('record_employee_points_transaction_v3') &&
    (text.includes('schema cache') || text.includes('could not find') || text.includes('does not exist'))
  );
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

function isConversationSource(source: string, sourceType: string) {
  return (
    ['conversation_evaluation', 'conversation_review', 'conversation_sales_reviews'].includes(
      source
    ) ||
    ['conversation_evaluation', 'conversation_review', 'conversation_sales_reviews'].includes(
      sourceType
    )
  );
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
  const manager_note = buildManagerNote(input, ruleCode);
  const requestedPoints = Math.max(0, Math.abs(Number(input.pointsToStore) || 0));
  const signedDelta =
    input.operation === 'admin_adjustment'
      ? (input.adminDeltaSigned ?? 0)
      : input.operation === 'bonus'
        ? requestedPoints
        : -Math.min(MAX_DEDUCTION_PER_EVENT, requestedPoints);
  const month_cycle = monthCycleFromDate(input.cycle.end);
  const source = input.source || input.sourceModule || 'manual_admin';
  const sourceType = input.sourceModule || source;
  const description = input.description ?? (input.userNote.trim() || null);
  const approvedBy =
    input.approvedBy ??
    (input.status === 'approved' ? input.createdById || input.createdByName || null : null);
  const type =
    input.operation === 'bonus' ? 'reward' : input.operation === 'deduction' ? 'penalty' : 'reward';
  const dbStatus =
    input.status === 'rejected' ? 'cancelled' : input.status === 'pending' ? 'pending' : 'active';
  const fullDescription = [description, manager_note].filter(Boolean).join('\n') || null;
  const transactionPayload = {
    staff_id: input.employeeId,
    type,
    points: Math.abs(signedDelta),
    points_delta: signedDelta,
    reason,
    description: fullDescription,
    source,
    source_id: input.sourceRecordId ?? null,
    created_by: input.createdById || null,
    month_cycle,
    branch: input.branch,
    status: dbStatus,
  } as const;

  // Prevent overlapping penalty rules for one source event before reaching either write path.
  if (type === 'penalty' && input.sourceRecordId && ruleCode) {
    const { data: relatedRows, error: relatedError } = await supabase
      .from(TABLES.employeeTransactions)
      .select('id, description, reason, metadata')
      .eq('staff_id', input.employeeId)
      .eq('source_id', input.sourceRecordId)
      .eq('month_cycle', month_cycle)
      .eq('type', 'penalty')
      .limit(20);
    if (!relatedError) {
      const existingRuleCodes = (relatedRows || []).filter(Boolean).flatMap((row) => {
        const metadataCode = String((row.metadata as Record<string, unknown> | null)?.rule_code || '').trim();
        const embedded = String(row.description || row.reason || '').match(/__RULE__:([A-Za-z0-9_-]+)/)?.[1] || '';
        return [metadataCode || embedded].filter(Boolean);
      });
      const guard = sameEventDeductionGuard({ incomingRuleCode: ruleCode, existingRuleCodes });
      if (!guard.allowed && !existingRuleCodes.includes(ruleCode)) {
        console.warn('[points] overlapping deduction blocked', { ruleCode, conflicts: guard.conflictingRuleCodes, sourceRecordId: input.sourceRecordId });
        return { error: `يوجد خصم متداخل لنفس الواقعة (${guard.conflictingRuleCodes.join('، ')}). يلزم اعتماد إداري واضح قبل إضافة بند آخر.` };
      }
    } else if (!isIgnorableSchemaIssue(relatedError.message)) {
      logSupabaseError('same event deduction guard', relatedError);
    }
  }

  // Preferred V3 write path: server validates branch/actor scope and performs semantic idempotency
  // using staff + cycle + source + source_id + rule_code. Keep the legacy write only as a
  // temporary deployment fallback while the migration propagates.
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
      p_month_cycle: month_cycle,
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

  if (!commandError) {
    const row = (commandData || {}) as Record<string, unknown>;
    return { error: null, id: row.id ? String(row.id) : undefined };
  }

  if (!isMissingV3Command(commandError.message)) {
    logSupabaseError('record_employee_points_transaction_v3', commandError);
    return { error: commandError.message };
  }

  console.warn('[points] V3 command unavailable; using temporary legacy persistence fallback');

  if (isConversationSource(source, sourceType) && input.sourceRecordId) {
    const { data: existingRows, error: existingError } = await supabase
      .from(TABLES.employeeTransactions)
      .select('id')
      .eq('staff_id', input.employeeId)
      .eq('source_id', input.sourceRecordId)
      .eq('type', type)
      .limit(1);

    const existingRow = (existingRows || []).filter(Boolean)[0];
    if (!existingError && existingRow?.id) {
      const { error } = await updateEmployeeTransaction(existingRow.id as string, transactionPayload);
      if (error) {
        console.error('Employee transactions error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return { error: error.message };
      }
      return { error: null, id: existingRow.id as string };
    }

    if (existingError && !isIgnorableSchemaIssue(existingError.message)) {
      logSupabaseError('employee transaction duplicate check', existingError);
      return { error: existingError.message };
    }
  }

  const transaction = await createEmployeeTransaction(transactionPayload);
  if (transaction.error) {
    return { error: transaction.error.message };
  }

  return { error: null, id: transaction.data?.id as string | undefined };
}

export function approverHintFromRule(rule: EvaluationRuleDef | null): string | undefined {
  if (!rule?.allowed_approver_roles?.length) return undefined;
  return formatApproverList(rule.allowed_approver_roles);
}
