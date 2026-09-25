import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { PharmacyCycle } from '@/lib/pharmacy-cycle';
import { embedRuleCodeInNote, MAX_DEDUCTION_PER_EVENT } from '@/lib/pointsWorkflow';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import type { OperationKind, PointsTxnStatus } from '@/lib/pointsWorkflow';
import { formatApproverList } from '@/lib/approverRoles';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import { logSupabaseError } from '@/lib/supabaseError';

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

  const { data: commandData, error: commandError } = await supabase.rpc(
    'record_employee_points_transaction_v4',
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
        engine_version: 4,
        operation: input.operation,
        base_points: input.basePoints ?? null,
        repeat_count: input.repeatCount ?? null,
        multiplier: input.multiplier ?? null,
        requested_final_points: input.finalPoints ?? null,
        created_by_role: input.createdByRole,
        approved_by: approvedBy,
      },
      p_manager_override: false,
    }
  );

  if (commandError) {
    logSupabaseError('record_employee_points_transaction_v4', commandError);
    return {
      error:
        'تعذر تسجيل حركة النقاط عبر مسار V4 المعتمد. لم يتم إجراء أي كتابة بديلة لحماية دقة الحوافز. ' +
        commandError.message,
    };
  }

  const row = (commandData || {}) as Record<string, unknown>;
  return { error: null, id: row.id ? String(row.id) : undefined };
}

export function approverHintFromRule(rule: EvaluationRuleDef | null): string | undefined {
  if (!rule?.allowed_approver_roles?.length) return undefined;
  return formatApproverList(rule.allowed_approver_roles);
}
