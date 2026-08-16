import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import {
  ALL_INCENTIVE_RULES,
  canonicalCategory,
  PERFORMANCE_PILLARS,
  pillarForCanonicalCategory,
  type PerformancePillarKey,
} from '@/lib/incentives/ruleDefinitions';

const RULE_CODE_PATTERN = /[A-Z]+(?:-[A-Z]+)*-\d+[A-Z]?/;

const RULE_CATEGORY_BY_CODE: Record<string, string> = ALL_INCENTIVE_RULES.reduce(
  (map, rule) => {
    map[rule.rule_code] = rule.category;
    return map;
  },
  {} as Record<string, string>
);

export type PillarBreakdown = {
  key: PerformancePillarKey;
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
  unmappedPointsDelta: number; // معاملات مالها فئة معروفة (لسه ما اتحطتش في التقسيم)
  transactionCount: number;
};

/**
 * درجة فرعية لكل محور = 50 (نقطة حياد) + صافي النقاط في المحور، مقيّدة بين
 * 0 و100. البداية من 50 (مش صفر) عشان موظف من غير أي حدث (لا مكافأة ولا خصم)
 * يظهر "متوسط" مش "صفر أداء" — الصفر لازم يبقى دلالة على أداء سيء فعليًا.
 */
function subScoreFromPointsDelta(pointsDelta: number): number {
  return Math.max(0, Math.min(100, 50 + pointsDelta));
}

/**
 * يحسب الدرجة المركّبة الشهرية لدكتور معيّن من معاملات النقاط الفعلية
 * (employee_transactions) خلال دورة محددة، بتوزيعها على المحاور الخمسة حسب
 * كود القاعدة المستخرج من النص (نفس أسلوب sameEventDeductionGuard الموجود
 * أصلًا في pointsPersistence.ts).
 */
export async function calculateCompositeScore(
  staffId: string,
  monthCycle: string
): Promise<CompositeScoreResult> {
  const { data, error } = await supabase
    .from(TABLES.employeeTransactions)
    .select('points_delta, description, reason, status, source, category')
    .eq('staff_id', staffId)
    .eq('month_cycle', monthCycle)
    .eq('status', 'active');

  if (error) throw new Error(error.message);

  const rows = data || [];
  const pillarTotals: Record<PerformancePillarKey, number> = {
    sales: 0,
    conversations: 0,
    customer_service: 0,
    discipline: 0,
  };
  let unmappedPointsDelta = 0;

  for (const row of rows) {
    const delta = Number(row.points_delta) || 0;
    if (!delta) continue;
    const source = String(row.source || '');
    const reason = String(row.reason || '');
    if (source.startsWith('conversation_') || reason.includes('تقييم محادثة')) {
      pillarTotals.conversations += delta;
      continue;
    }
    // الفئة المخزّنة وقت إنشاء المعاملة (لو موجودة) بتتفضّل على أي استنتاج حي —
    // كده تعديل فئة قاعدة في المستقبل (CANONICAL_CATEGORY_MAP) مايأثرش بأثر رجعي
    // على المعاملات اللي اتسجّلت قبله. لو مخزّنش (معاملات قديمة قبل التحديث)، بترجع
    // للاستنتاج من كود القاعدة زي الأول.
    const storedCategory = (row as { category?: string | null }).category;
    let pillarKey: PerformancePillarKey | null = storedCategory
      ? pillarForCanonicalCategory(canonicalCategory(storedCategory))
      : null;
    if (!pillarKey) {
      const text = `${row.description || ''} ${reason}`;
      const ruleCode = text.match(RULE_CODE_PATTERN)?.[0];
      const rawCategory = ruleCode ? RULE_CATEGORY_BY_CODE[ruleCode] : null;
      pillarKey = rawCategory ? pillarForCanonicalCategory(canonicalCategory(rawCategory)) : null;
    }
    if (pillarKey) {
      pillarTotals[pillarKey] += delta;
    } else {
      unmappedPointsDelta += delta;
    }
  }

  const pillars: PillarBreakdown[] = PERFORMANCE_PILLARS.map((pillar) => {
    const rawPointsDelta = pillarTotals[pillar.key];
    const subScore = subScoreFromPointsDelta(rawPointsDelta);
    return {
      key: pillar.key,
      label: pillar.label,
      weight: pillar.weight,
      rawPointsDelta,
      subScore,
      weightedContribution: subScore * pillar.weight,
    };
  });

  const compositeScore = Math.round(pillars.reduce((sum, p) => sum + p.weightedContribution, 0) * 10) / 10;

  return {
    staffId,
    compositeScore,
    pillars,
    unmappedPointsDelta,
    transactionCount: rows.length,
  };
}
