import type { ApproverRoleKey } from '@/lib/approverRoles';
import { ALL_INCENTIVE_RULES } from '@/lib/incentives/ruleDefinitions';
import { ROLE_OPERATIONAL_RULES_V2 } from '@/lib/incentives/roleOperationalRulesV2';
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

function normalizeRoleText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mapIncentiveRoleScope(scope: string): RoleScope {
  const value = normalizeRoleText(scope);
  if (
    ['pharmacist', 'doctor', 'صيدلاني', 'صيدلي', 'دكتور'].includes(value)
  ) return 'doctor';
  if (
    ['assistant', 'مساعد', 'مساعد صيدلي', 'pharmacy_assistant'].includes(value)
  ) return 'assistant';
  if (
    ['delivery', 'rider', 'توصيل', 'دليفري'].includes(value)
  ) return 'delivery';
  if (
    ['cleaning', 'cleaner', 'cleaning_supervisor', 'مسؤول النظافة', 'مسؤولة النظافة', 'نظافة'].includes(value)
  ) return 'cleaning';
  if (
    ['customer_service', 'customer service', 'خدمة عملاء', 'مسؤولة خدمة العملاء', 'مسؤول خدمة العملاء'].includes(value)
  ) return 'customer_service';
  if (
    ['manager', 'branch_manager', 'general_manager', 'branches_manager', 'مدير فرع', 'مديرة فرع', 'مدير الفروع', 'مديرة الفروع', 'مدير عام'].includes(value)
  ) return 'manager';
  return 'all';
}

function mapIncentiveSeverity(severity: IncentiveRuleDefinition['severity']): Severity {
  return severity;
}

const CANONICAL_SOURCE_RULES = [...ALL_INCENTIVE_RULES, ...ROLE_OPERATIONAL_RULES_V2];

/** المصدر المعتمد: قواعد الكود المراجعة + قواعد التشغيل v2. */
export function incentiveRulesToEvaluationDefs(): EvaluationRuleDef[] {
  const byCode = new Map<string, IncentiveRuleDefinition>();
  for (const rule of CANONICAL_SOURCE_RULES) byCode.set(rule.rule_code, rule);
  return [...byCode.values()]
    .filter((rule) => rule.visible_to_staff !== false)
    .map((rule) => {
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
  doctor: ['صيدلاني', 'صيدلي', 'doctor', 'pharmacist', 'دكتور'],
  assistant: ['مساعد', 'مساعد صيدلي', 'assistant', 'pharmacy_assistant'],
  delivery: ['توصيل', 'دليفري', 'delivery', 'rider'],
  cleaning: ['مسؤول النظافة', 'مسؤولة النظافة', 'نظافة', 'cleaning', 'cleaner', 'cleaning_supervisor'],
  customer_service: ['خدمة عملاء', 'مسؤولة خدمة العملاء', 'مسؤول خدمة العملاء', 'customer_service'],
  manager: ['مدير فرع', 'مديرة فرع', 'مدير الفروع', 'مديرة الفروع', 'مدير عام', 'branch_manager', 'branches_manager', 'general_manager', 'أدمن'],
  all: [],
};

export function ruleAppliesToStaff(scope: RoleScope, staffRole: string): boolean {
  if (scope === 'all') return true;
  const normalized = normalizeRoleText(staffRole);
  return ROLE_MAP[scope].some((role) => normalizeRoleText(role) === normalized);
}

export const CANONICAL_EVALUATION_RULES = incentiveRulesToEvaluationDefs();
export const FULL_EVALUATION_RULES = CANONICAL_EVALUATION_RULES;

export function rulesForStaffRole(staffRole: string): EvaluationRuleDef[] {
  return CANONICAL_EVALUATION_RULES.filter((r) => ruleAppliesToStaff(r.role_scope, staffRole));
}

function explicitRuleType(row: Record<string, unknown>, rawPoints: number): RuleType {
  const rawType = normalizeRoleText(row.type ?? row.impact_type);
  if (
    rawType === 'penalty' ||
    rawType === 'deduction' ||
    rawType === 'monthly_points_deduction' ||
    rawType === 'quarterly_money_deduction'
  ) return 'deduction';
  if (
    rawType === 'reward' ||
    rawType === 'bonus' ||
    rawType === 'monthly_exceptional_reward' ||
    rawType === 'quarterly_money_reward'
  ) return 'bonus';
  return rawPoints < 0 ? 'deduction' : 'bonus';
}

function rowToEvaluationDef(row: Record<string, unknown>): EvaluationRuleDef | null {
  const code = String(row.rule_code ?? row.code ?? '').trim();
  if (!code) return null;
  const rawPoints = Number(row.points ?? row.default_points ?? row.base_points ?? 0);
  const type = explicitRuleType(row, rawPoints);
  return {
    code,
    category: String(row.category ?? 'تشغيل'),
    title: String(row.title ?? row.name ?? code),
    description: String(row.description ?? row.title ?? row.name ?? ''),
    default_points: Math.abs(rawPoints),
    type,
    severity: (String(row.severity ?? 'medium') as Severity) || 'medium',
    role_scope: mapIncentiveRoleScope(
      String(row.target_role ?? row.role_scope ?? row.applies_to_role ?? row.role ?? 'all')
    ),
    requires_approval: Boolean(row.requires_approval ?? true),
    evidence_required: Boolean(row.requires_approval ?? true),
    allowed_approver_roles: row.requires_approval ? BM_GM : BM,
    repeat_policy: row.repeat_multiplier || row.is_repeatable ? 'double_per_cycle' : 'none',
    active: row.active !== false && row.is_active !== false,
    impact_type: row.impact_type ? String(row.impact_type) : undefined,
    pillar_key: row.pillar_key ? String(row.pillar_key) : undefined,
  };
}

function isLegacyGeneratedRule(row: Record<string, unknown>) {
  const code = String(row.rule_code ?? row.code ?? '').trim();
  return code.startsWith('legacy_rule_');
}

/**
 * قواعد الكود هي مصدر الحقيقة للقواعد المعروفة. قاعدة Supabase لا تستطيع تغيير
 * نوع القاعدة أو قيمتها لو الكود موجود أصلًا؛ يمكنها فقط تعطيلها. القواعد الجديدة
 * ذات code واضح تُقبل، أما legacy_rule_* القديمة فلا تُعاد إلى الكتالوج.
 */
export function mergeRulesFromSupabase(
  rows: Record<string, unknown>[] | null
): EvaluationRuleDef[] {
  if (!rows?.length) return CANONICAL_EVALUATION_RULES;
  const merged = new Map(CANONICAL_EVALUATION_RULES.map((r) => [r.code, { ...r }]));
  for (const row of rows) {
    const code = String(row.code ?? row.rule_code ?? '').trim();
    if (!code || isLegacyGeneratedRule(row)) continue;
    if (merged.has(code)) {
      const base = merged.get(code)!;
      merged.set(code, {
        ...base,
        active: row.active !== false && row.is_active !== false,
      });
      continue;
    }
    const fresh = rowToEvaluationDef(row);
    if (fresh) merged.set(code, fresh);
  }
  return [...merged.values()].filter((r) => r.active);
}
