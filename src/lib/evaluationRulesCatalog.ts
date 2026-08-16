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
  pillar_key?: string;
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
      pillar_key: rule.pillar_key,
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

/**
 * تعديل مهم (17 أغسطس 2026): النسخة القديمة كانت بتتجاهل تمامًا أي صف من
 * جدول evaluation_rules مالوش code متطابق مع الكتالوج الثابت — يعني أي قاعدة
 * جديدة تتضاف من شاشة إدارة القواعد (EvaluationRules2027) كانت بتختفي تمامًا
 * من شاشة تسجيل النقط (Points.tsx) من غير أي تنبيه. دلوقتي أي صف جديد
 * (rule_code مش موجود في الكتالوج) بيتحوّل لقاعدة كاملة وبيتضاف للقائمة.
 */
function rowToEvaluationDef(row: Record<string, unknown>): EvaluationRuleDef | null {
  const code = String(row.rule_code ?? row.code ?? '');
  if (!code) return null;
  const rawPoints = Number(row.points ?? row.default_points ?? row.base_points ?? 0);
  const isReward = String(row.type ?? '') === 'reward' || String(row.type ?? '') === 'bonus' || rawPoints > 0;
  return {
    code,
    category: String(row.category ?? 'خدمة العملاء'),
    title: String(row.title ?? row.name ?? code),
    description: String(row.description ?? row.title ?? ''),
    default_points: Math.abs(rawPoints),
    type: isReward ? 'bonus' : 'deduction',
    severity: (String(row.severity ?? 'medium') as Severity) || 'medium',
    role_scope: mapIncentiveRoleScope(String(row.target_role ?? row.role_scope ?? row.applies_to_role ?? 'all')),
    requires_approval: Boolean(row.requires_approval ?? true),
    evidence_required: Boolean(row.requires_approval ?? true),
    allowed_approver_roles: row.requires_approval ? BM_GM : BM,
    repeat_policy: row.repeat_multiplier || row.is_repeatable ? 'double_per_cycle' : 'none',
    active: row.active !== false && row.is_active !== false,
    impact_type: row.impact_type ? String(row.impact_type) : undefined,
    pillar_key: row.pillar_key ? String(row.pillar_key) : undefined,
  };
}

export function mergeRulesFromSupabase(
  rows: Record<string, unknown>[] | null
): EvaluationRuleDef[] {
  if (!rows?.length) return CANONICAL_EVALUATION_RULES;
  const merged = new Map(CANONICAL_EVALUATION_RULES.map((r) => [r.code, { ...r }]));
  for (const row of rows) {
    const code = String(row.code ?? row.rule_code ?? '');
    if (!code) continue;
    if (merged.has(code)) {
      const base = merged.get(code)!;
      merged.set(code, {
        ...base,
        default_points: Number(row.default_points ?? row.base_points ?? base.default_points),
        requires_approval: Boolean(row.requires_approval ?? base.requires_approval),
        evidence_required: Boolean(row.evidence_required ?? base.evidence_required),
        active: row.active !== false,
        pillar_key: row.pillar_key ? String(row.pillar_key) : base.pillar_key,
      });
    } else {
      // قاعدة جديدة مضافة من الشاشة مباشرة وملهاش نظير في الكتالوج الثابت.
      const fresh = rowToEvaluationDef(row);
      if (fresh) merged.set(code, fresh);
    }
  }
  return [...merged.values()].filter((r) => r.active);
}
