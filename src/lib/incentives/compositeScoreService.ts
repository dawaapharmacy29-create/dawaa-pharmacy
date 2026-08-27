import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import {
  ALL_INCENTIVE_RULES,
  canonicalCategory,
} from '@/lib/incentives/ruleDefinitions';
import { evaluationProfileForRole } from '@/lib/evaluations/staffEvaluationProfilesV3';

const RULE_CODE_PATTERN = /[A-Z]+(?:-[A-Z]+)*-\d+[A-Z]?/;

const RULE_CATEGORY_BY_CODE: Record<string, string> = ALL_INCENTIVE_RULES.reduce(
  (map, rule) => {
    map[rule.rule_code] = rule.category;
    return map;
  },
  {} as Record<string, string>
);

/**
 * Legacy rule categories are retained only as historical classification metadata.
 * They no longer define weights. The active section weights always come from the
 * role-specific V3 evaluation profile.
 */
const DOCTOR_CATEGORY_TO_SECTION: Record<string, string> = {
  'الالتزام والانضباط': 'discipline',
  'الالتزام بالتطبيق': 'discipline',
  'جودة المحادثات': 'conversations',
  'جودة البيع والصرف': 'sales_quality',
  'خدمة العملاء': 'followups_requests',
  'تصنيف البيانات': 'followups_requests',
  'المخزون والرواكد': 'inventory',
  'قوائم النواقص': 'inventory',
};

export type PillarBreakdown = {
  key: string;
  label: string;
  weight: number;
  rawPointsDelta: number;
  subScore: number; // 0-100
  weightedContribution: number; // subScore * weight
};

export type CompositeScoreResult = {
  staffId: string;
  compositeScore: number; // 0-100
  pillars: PillarBreakdown[];
  unmappedPointsDelta: number;
  transactionCount: number;
  profileRole: string;
};

function subScoreFromPointsDelta(pointsDelta: number): number {
  return Math.max(0, Math.min(100, 50 + pointsDelta));
}

function sectionKeyForTransaction(input: {
  source: string;
  reason: string;
  storedCategory?: string | null;
  description?: string | null;
}): string | null {
  if (input.source.startsWith('conversation_') || input.reason.includes('تقييم محادثة')) {
    return 'conversations';
  }

  let rawCategory = input.storedCategory ? canonicalCategory(input.storedCategory) : null;
  if (!rawCategory) {
    const text = `${input.description || ''} ${input.reason}`;
    const ruleCode = text.match(RULE_CODE_PATTERN)?.[0];
    rawCategory = ruleCode ? canonicalCategory(RULE_CATEGORY_BY_CODE[ruleCode] || '') : null;
  }

  return rawCategory ? DOCTOR_CATEGORY_TO_SECTION[rawCategory] || null : null;
}

/**
 * Composite performance score derived from the canonical employee ledger and the
 * active V3 evaluation profile for the employee role.
 *
 * Important architecture rule: legacy ruleDefinitions may classify historical
 * rows, but they never supply weights. This prevents the old 25/25/10/40 doctor
 * model from competing with staffEvaluationProfilesV3.
 */
export async function calculateCompositeScore(
  staffId: string,
  monthCycle: string
): Promise<CompositeScoreResult> {
  const [transactionsResult, staffResult] = await Promise.all([
    supabase
      .from(TABLES.employeeTransactions)
      .select('points_delta, description, reason, status, source, category')
      .eq('staff_id', staffId)
      .eq('month_cycle', monthCycle)
      .eq('status', 'active'),
    supabase
      .from(TABLES.staff)
      .select('role')
      .eq('id', staffId)
      .maybeSingle(),
  ]);

  if (transactionsResult.error) throw new Error(transactionsResult.error.message);
  if (staffResult.error) throw new Error(staffResult.error.message);
  if (!staffResult.data) throw new Error('تعذر تحديد دور الموظف لحساب تقييم الأداء.');

  const profile = evaluationProfileForRole(staffResult.data.role);
  const rows = transactionsResult.data || [];
  const sectionTotals = new Map(profile.sections.map((section) => [section.key, 0]));
  let unmappedPointsDelta = 0;

  for (const row of rows) {
    const delta = Number(row.points_delta) || 0;
    if (!delta) continue;

    const sectionKey = sectionKeyForTransaction({
      source: String(row.source || ''),
      reason: String(row.reason || ''),
      storedCategory: row.category,
      description: row.description,
    });

    if (sectionKey && sectionTotals.has(sectionKey)) {
      sectionTotals.set(sectionKey, (sectionTotals.get(sectionKey) || 0) + delta);
    } else {
      unmappedPointsDelta += delta;
    }
  }

  const pillars: PillarBreakdown[] = profile.sections.map((section) => {
    const rawPointsDelta = sectionTotals.get(section.key) || 0;
    const subScore = subScoreFromPointsDelta(rawPointsDelta);
    const weight = section.weight / 100;
    return {
      key: section.key,
      label: section.title,
      weight,
      rawPointsDelta,
      subScore,
      weightedContribution: subScore * weight,
    };
  });

  const compositeScore = Math.round(
    pillars.reduce((sum, pillar) => sum + pillar.weightedContribution, 0) * 10
  ) / 10;

  return {
    staffId,
    compositeScore,
    pillars,
    unmappedPointsDelta,
    transactionCount: rows.length,
    profileRole: profile.role,
  };
}
