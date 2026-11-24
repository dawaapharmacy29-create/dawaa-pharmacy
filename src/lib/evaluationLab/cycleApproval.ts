import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import type { LabPersonScore } from './buildCycleScores';
import { LAB_CURRENT_VERSION, type LabAxisKey } from './catalog';
import { STAR_PRIZE } from './branchStar';

// Owner decision 2026-11-24: the doctors' monthly evaluation is approved once per cycle and payroll pays its
// incentive (approve_evaluation_cycle_v1). What is saved is exactly what the lab shows: score, tier, factors, the
// earned incentive, the branch bonus, the star, the rank and the recommendations printed on the payslip.

export interface EvaluationRecommendation { kind: 'strength' | 'improve' | 'note'; text: string }

export interface EvaluationApprovalRow {
  staff_id: string;
  model_version: string;
  family: string;
  branch: string | null;
  score: number | null;
  tier_label: string | null;
  tier_percent: number | null;
  branch_achievement: number | null;
  branch_factor: number | null;
  hours_factor: number | null;
  absence_days: number;
  absence_cut: number;
  performance_egp: number;
  bonus_egp: number;
  star_egp: number;
  star: unknown;
  rank_in_branch: number | null;
  rank_in_branch_of: number | null;
  rank_overall: number | null;
  rank_overall_of: number | null;
  axes: Array<{ key: string; label: string; weight: number; score: number | null; value: number | null; basis: string; reason?: string }>;
  recommendations: EvaluationRecommendation[];
  details: Record<string, unknown>;
}

export interface SavedEvaluationApproval extends EvaluationApprovalRow {
  id: string;
  month_cycle: string;
  approved_by_name: string | null;
  approved_at: string;
}

/** The payroll month of a lab cycle: the cycle that opens on the 26th is paid under the next month. */
export function monthCycleOf(cycleStart: string) {
  const d = new Date(cycleStart + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 10);
  return d.toISOString().slice(0, 7);
}

const TIPS: Partial<Record<LabAxisKey, string>> = {
  followup_requests: 'طلبات المتابعة: سجّل متابعة لكل عميل علاجه مزمن أو طلبه ناقص قبل ما يمشي، دي أكبر بند في التقييم.',
  conversation_quality: 'المحادثات: رد بسرعة، رحّب بالعميل باسمه، اشرح الجرعة والبديل، واقفل بتأكيد الطلب.',
  invoice_review: 'جودة البيع: اعرض المكمل المناسب واشرح طريقة الاستخدام قبل ما تقفل الفاتورة.',
  complete_requests: 'طلبات العملاء: سجّل الطلب كامل (رقم العميل + اسم الصنف) وتابعه لحد ما العميل يستلم.',
  avg_invoice_target: 'متوسط الفاتورة: اقترح منتج مكمل مع الروشتة المناسبة (فيتامين، عناية، مستلزمات).',
  punctuality: 'المواعيد: التأخير والخروج بدري بيتخصموا من المحفظة.',
  invoices_per_day: 'عدد الفواتير: خلّي كل عميل يطلع بفاتورة متسجلة باسمك.',
  coding_quality: 'التكويد: كوّد كل عميل في الفاتورة؛ أقل من 95٪ بيقسم بند متوسط الفاتورة نصين.',
  uniform_compliance: 'الالتزام: الزي والأذونات والتعليمات، أي مخالفة بتتخصم من المحفظة.',
};

const ar = (value: number) => Math.round(value).toLocaleString('ar-EG');

export function recommendationsFor(person: LabPersonScore): EvaluationRecommendation[] {
  const out: EvaluationRecommendation[] = [];
  const scored = person.axes.filter((axis) => axis.weight > 0 && axis.status === 'measured' && axis.score !== null);
  const best = [...scored].sort((a, b) => (b.score as number) - (a.score as number))[0];
  if (best && (best.score as number) >= 85) out.push({ kind: 'strength', text: `نقطة قوتك: ${best.label} (${ar(best.score as number)} من 100). كمّل كده.` });
  const weak = [...scored].sort((a, b) => (a.score as number) * a.weight - (b.score as number) * b.weight)
    .filter((axis) => (axis.score as number) < 85).slice(0, 3);
  for (const axis of weak) {
    const tip = TIPS[axis.key] || axis.label;
    out.push({ kind: 'improve', text: `${tip} (درجتك فيه ${ar(axis.score as number)} من 100، ووزنه ${ar(axis.weight)}٪).` });
  }
  const earned = person.earned;
  if (earned?.next) out.push({ kind: 'note', text: `ناقصك ${earned.next.points.toLocaleString('ar-EG')} نقطة توصل لشريحة ${ar(earned.next.percent)}٪ من الحافز.` });
  if (earned && earned.absenceCut > 0) out.push({ kind: 'note', text: `الغياب من غير إذن (${ar(earned.absenceDays)} يوم) خصم ${ar(earned.absenceCut * 100)}٪ من الحافز.` });
  if (earned?.hours && earned.hours.factor < 1) out.push({ kind: 'note', text: `ساعاتك ${ar(earned.hours.worked)} من ${ar(earned.hours.needed)} المطلوبة، فالحافز اتحسب ${ar(earned.hours.factor * 100)}٪.` });
  const notMeasured = person.axes.filter((axis) => axis.weight > 0 && axis.status !== 'measured');
  if (notMeasured.length) out.push({ kind: 'note', text: `بنود ماتقاسش الشهر ده ووزنها راح للباقي: ${notMeasured.map((axis) => axis.label).join('، ')}.` });
  return out;
}

const rankable = (p: LabPersonScore) => p.total !== null && p.readiness !== 'insufficient';
const byTotal = (a: LabPersonScore, b: LabPersonScore) => (b.total ?? -1) - (a.total ?? -1);

/** The rows approve_evaluation_cycle_v1 saves: every doctor of the cycle, ranked in his branch and overall. */
export function buildApprovalRows(scores: LabPersonScore[]): EvaluationApprovalRow[] {
  const doctors = scores.filter((person) => person.family === 'doctor');
  const ranked = doctors.filter(rankable).sort(byTotal);
  const branchOf = (p: LabPersonScore) => normalizeBranchName(p.branch || '') || p.branch || '';
  return doctors.map((person) => {
    const peers = ranked.filter((p) => branchOf(p) === branchOf(person));
    const earned = person.earned;
    const starWinner = Boolean(person.star?.eligible && person.star.rank === 1);
    return {
      staff_id: person.staffId,
      model_version: LAB_CURRENT_VERSION,
      family: person.family,
      branch: person.branch,
      score: person.total,
      tier_label: earned?.tierLabel ?? null,
      tier_percent: earned?.tierPercent ?? null,
      branch_achievement: earned?.branchAchievement ?? null,
      branch_factor: earned?.branchFactor ?? null,
      hours_factor: earned?.hours?.factor ?? null,
      absence_days: earned?.absenceDays ?? 0,
      absence_cut: earned?.absenceCut ?? 0,
      performance_egp: earned?.performance ?? 0,
      bonus_egp: earned?.bonus ?? 0,
      star_egp: starWinner ? STAR_PRIZE : 0,
      star: person.star ?? null,
      rank_in_branch: rankable(person) ? peers.findIndex((p) => p.staffId === person.staffId) + 1 : null,
      rank_in_branch_of: peers.length,
      rank_overall: rankable(person) ? ranked.findIndex((p) => p.staffId === person.staffId) + 1 : null,
      rank_overall_of: ranked.length,
      axes: person.axes.map((axis) => ({ key: axis.key, label: axis.label, weight: axis.weight, score: axis.score, value: axis.value, basis: axis.basis, reason: axis.reason })),
      recommendations: recommendationsFor(person),
      details: { readiness: person.readiness, coverage: person.coverage, adjustments: person.adjustments, hours: earned?.hours ?? null, attendance: person.attendance ?? null },
    };
  });
}

export async function approveEvaluationCycle(monthCycle: string, rows: EvaluationApprovalRow[]) {
  const { data, error } = await supabase.rpc('approve_evaluation_cycle_v1' as never, { p_month_cycle: monthCycle, p_rows: rows } as never);
  if (error) throw new Error(error.message);
  return data as unknown as { saved: number; skipped_finalized: number; list_rows: number; approved_by_name: string | null };
}

export async function listEvaluationApprovals(monthCycle: string): Promise<SavedEvaluationApproval[]> {
  const { data, error } = await supabase.rpc('list_evaluation_cycle_approvals_v1' as never, { p_month_cycle: monthCycle } as never);
  if (error) throw new Error(error.message);
  return (data as unknown as SavedEvaluationApproval[]) || [];
}

export async function getEvaluationApproval(staffId: string, monthCycle: string) {
  const { data, error } = await supabase.rpc('get_evaluation_cycle_approval_v1' as never, { p_staff_id: staffId, p_month_cycle: monthCycle } as never);
  if (error) throw new Error(error.message);
  return data as unknown as {
    approved: boolean;
    approval: SavedEvaluationApproval | null;
    list_items: Array<{ product_name: string; quantity: number; incentive_per_unit: number; incentive_total: number }>;
  };
}
