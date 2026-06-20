import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';
import { embedRuleCodeInNote } from '@/lib/pointsWorkflow';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import type { OperationKind, PointsTxnStatus } from '@/lib/pointsWorkflow';
import { formatApproverList } from '@/lib/approverRoles';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import { createEmployeeTransaction } from '@/services/employeeTransactionService';
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

export function shouldApplyToBalance(status: PointsTxnStatus): boolean {
  return status === 'approved';
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

async function insertPointRecordWithFallback(payloads: Array<Record<string, unknown>>) {
  let lastError: string | null = null;
  for (const payload of payloads) {
    const { data, error } = await supabase
      .from(TABLES.employeeTransactions)
      .insert(payload)
      .select('id')
      .single();
    if (!error) return { error: null, id: data?.id as string | undefined };
    lastError = error.message;
    if (!isColumnProblem(error.message)) return { error: error.message };
  }
  return { error: lastError || 'تعذر حفظ سجل النقاط.' };
}

async function updatePointRecordWithFallback(id: string, payloads: Array<Record<string, unknown>>) {
  let lastError: string | null = null;
  for (const payload of payloads) {
    const { error } = await supabase.from(TABLES.employeeTransactions).update(payload).eq('id', id);
    if (!error) return { error: null, id };
    lastError = error.message;
    if (!isColumnProblem(error.message)) return { error: error.message };
  }
  return { error: lastError || 'تعذر تحديث سجل النقاط.', id };
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
  const signedDelta =
    input.operation === 'admin_adjustment'
      ? (input.adminDeltaSigned ?? 0)
      : input.operation === 'bonus'
        ? Math.abs(input.pointsToStore)
        : -Math.abs(input.pointsToStore);
  const month_cycle = monthCycleFromDate(input.cycle.end);
  const source = input.source || input.sourceModule || 'manual_admin';
  const sourceType = input.sourceModule || source;
  const description = input.description ?? (input.userNote.trim() || null);
  const approvedBy =
    input.approvedBy ??
    (input.status === 'approved' ? input.createdById || input.createdByName || null : null);
  const type =
    input.operation === 'bonus' ? 'reward' : input.operation === 'deduction' ? 'penalty' : 'reward';
  const transactionPayload = {
    staff_id: input.employeeId,
    type,
    points: Math.abs(signedDelta),
    points_delta: signedDelta,
    reason,
    description: [description, manager_note].filter(Boolean).join('\n') || null,
    source,
    source_id: input.sourceRecordId ?? null,
    created_by: input.createdById || null,
    month_cycle,
    branch: input.branch,
    status:
      input.status === 'rejected' ? 'cancelled' : input.status === 'pending' ? 'pending' : 'active',
  } as const;

  // New records only: prevent overlapping penalty rules for one source event without touching history.
  if (type === 'penalty' && input.sourceRecordId && ruleCode) {
    const { data: relatedRows, error: relatedError } = await supabase
      .from(TABLES.employeeTransactions)
      .select('id, description, reason')
      .eq('staff_id', input.employeeId)
      .eq('source_id', input.sourceRecordId)
      .eq('month_cycle', month_cycle)
      .eq('type', 'penalty')
      .limit(20);
    if (!relatedError) {
      const existingRuleCodes = (relatedRows || []).flatMap((row) =>
        String(row.description || row.reason || '').match(/[A-Z]+(?:-[A-Z]+)*-\d+[A-Z]?/g) || []
      );
      const guard = sameEventDeductionGuard({ incomingRuleCode: ruleCode, existingRuleCodes });
      if (!guard.allowed && !existingRuleCodes.includes(ruleCode)) {
        console.warn('[points] overlapping deduction blocked', { ruleCode, conflicts: guard.conflictingRuleCodes, sourceRecordId: input.sourceRecordId });
        return { error: `يوجد خصم متداخل لنفس الواقعة (${guard.conflictingRuleCodes.join('، ')}). يلزم اعتماد إداري واضح قبل إضافة بند آخر.` };
      }
    } else if (!isIgnorableSchemaIssue(relatedError.message)) {
      logSupabaseError('same event deduction guard', relatedError);
    }
  }

  if (isConversationSource(source, sourceType) && input.sourceRecordId) {
    const { data: existingRows, error: existingError } = await supabase
      .from(TABLES.employeeTransactions)
      .select('id')
      .eq('staff_id', input.employeeId)
      .eq('source_id', input.sourceRecordId)
      .eq('type', type)
      .limit(1);

    if (!existingError && existingRows?.[0]?.id) {
      const { error } = await supabase
        .from(TABLES.employeeTransactions)
        .update({ ...transactionPayload, updated_at: new Date().toISOString() })
        .eq('id', existingRows[0].id as string);
      if (error) {
        console.error('Employee transactions error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return { error: error.message };
      }
      return { error: null, id: existingRows[0].id as string };
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

export async function applyStaffDelta(
  staffId: string,
  currentPoints: number,
  maxPoints: number,
  delta: number,
  employeeName?: string,
  branch?: string
): Promise<{ error: string | null }> {
  const cap = maxPoints > 0 ? maxPoints : 500;
  const base = Number.isFinite(currentPoints) && currentPoints > 0 ? currentPoints : cap;
  const next = Math.max(0, Math.min(cap, Math.round(base + delta)));

  if (staffId && !staffId.startsWith('fallback-')) {
    const { error } = await supabase.from('staff').update({ points: next }).eq('id', staffId);
    if (!error) return { error: null };
    if (!isIgnorableSchemaIssue(error.message)) return { error: error.message };
  }

  if (employeeName) {
    let query = supabase.from('staff').update({ points: next }).eq('name', employeeName);
    if (branch) query = query.eq('branch', branch);
    const { error } = await query;
    if (error && !isIgnorableSchemaIssue(error.message)) return { error: error.message };
  }

  return { error: null };
}
