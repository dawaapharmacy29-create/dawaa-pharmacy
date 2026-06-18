import type { ApproverRoleKey } from '@/lib/approverRoles';
import { ALL_INCENTIVE_RULES } from '@/lib/incentives/ruleDefinitions';
import type { IncentiveRuleDefinition } from '@/lib/incentives/incentiveRulesEngine';

export type RuleType = 'deduction' | 'bonus';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type RoleScope =
  | 'doctor'
  | 'assistant'
  | 'delivery'
  | 'cleaning'
  | 'customer_service'
  | 'manager'
  | 'all';
export type RepeatPolicy = 'double_per_cycle' | 'none';

export interface EvaluationRuleDef {
  code: string;
  category: string;
  title: string;
  description: string;
  default_points: number;
  type: RuleType;
  severity: Severity;
  role_scope: RoleScope;
  requires_approval: boolean;
  evidence_required: boolean;
  allowed_approver_roles: ApproverRoleKey[];
  repeat_policy: RepeatPolicy;
  active: boolean;
  max_points_cap?: number;
  impact_type?: string;
}

const BM: ApproverRoleKey[] = ['branch_manager'];
const BM_GM: ApproverRoleKey[] = ['branch_manager', 'general_manager'];

function mapIncentiveRoleScope(scope: string): RoleScope {
  if (scope === 'pharmacist' || scope === 'doctor') return 'doctor';
  if (scope === 'assistant') return 'assistant';
  if (scope === 'delivery') return 'delivery';
  if (scope === 'customer_service') return 'customer_service';
  if (scope === 'manager' || scope === 'branch_manager' || scope === 'general_manager')
    return 'manager';
  return 'all';
}

function mapIncentiveSeverity(severity: IncentiveRuleDefinition['severity']): Severity {
  return severity;
}

/** المصدر المعتمد 2027 — قواعد الحوافز التشغيلية (ALL_INCENTIVE_RULES) */
export function incentiveRulesToEvaluationDefs(): EvaluationRuleDef[] {
  return ALL_INCENTIVE_RULES.filter((rule) => rule.visible_to_staff !== false).map((rule) => {
    const points = Math.abs(rule.points_delta);
    const isReward = rule.points_delta > 0;
    return {
      code: rule.rule_code,
      category: rule.category,
      title: rule.title_ar,
      description: rule.description_ar,
      default_points: points,
      type: isReward ? 'bonus' : 'deduction',
      severity: mapIncentiveSeverity(rule.severity),
      role_scope: mapIncentiveRoleScope(rule.role_scope),
      requires_approval: rule.approval_required,
      evidence_required: rule.approval_required,
      allowed_approver_roles: rule.approval_required ? BM_GM : BM,
      repeat_policy: rule.repeat_policy === 'linear_multiplier' ? 'double_per_cycle' : 'none',
      active: rule.active,
      impact_type: rule.impact_type,
    };
  });
}

const ROLE_MAP: Record<RoleScope, string[]> = {
  doctor: ['صيدلاني'],
  assistant: ['مساعد'],
  delivery: ['توصيل'],
  cleaning: ['مساعد', 'صيدلاني'],
  customer_service: ['خدمة عملاء'],
  manager: ['مدير فرع', 'أدمن'],
  all: [],
};

export function ruleAppliesToStaff(scope: RoleScope, staffRole: string): boolean {
  if (scope === 'all') return true;
  return ROLE_MAP[scope]?.includes(staffRole) ?? false;
}

export const CANONICAL_EVALUATION_RULES = incentiveRulesToEvaluationDefs();

/** قواعد الواجهة — نفس مصدر الحوافز 2027 */
export const FULL_EVALUATION_RULES = CANONICAL_EVALUATION_RULES;

export function rulesForStaffRole(staffRole: string): EvaluationRuleDef[] {
  return CANONICAL_EVALUATION_RULES.filter((r) => ruleAppliesToStaff(r.role_scope, staffRole));
}

export function mergeRulesFromSupabase(
  rows: Record<string, unknown>[] | null
): EvaluationRuleDef[] {
  if (!rows?.length) return CANONICAL_EVALUATION_RULES;
  const merged = new Map(CANONICAL_EVALUATION_RULES.map((r) => [r.code, { ...r }]));
  for (const row of rows) {
    const code = String(row.code ?? row.rule_code ?? '');
    if (!code || !merged.has(code)) continue;
    const base = merged.get(code)!;
    merged.set(code, {
      ...base,
      default_points: Number(row.default_points ?? row.base_points ?? base.default_points),
      requires_approval: Boolean(row.requires_approval ?? base.requires_approval),
      evidence_required: Boolean(row.evidence_required ?? base.evidence_required),
      active: row.active !== false,
    });
  }
  return [...merged.values()].filter((r) => r.active);
}
