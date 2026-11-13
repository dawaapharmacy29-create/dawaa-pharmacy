import {
  AVERAGE_FULL_AT_INVOICES,
  SCORE_CRITERIA,
  SCORE_LABELS,
  SCORE_WEIGHTS,
  type ScoreCriterion,
} from '@/lib/doctorCompetitionScorecard';
import type { PackDoctor } from '@/lib/doctorCompetitionDesignPack';

/** "مكانك ووصولك": where a doctor stands in their branch and what moves them up. */
export interface StandingStep {
  criterion: ScoreCriterion;
  label: string;
  /** What to do, e.g. "اعمل ٢٤ طلب متابعة زيادة". */
  action: string;
  /** The same amount spread over the days left; null for attendance or when no days are left. */
  perDay: string | null;
  /** Points this step adds, out of 100. */
  points: number;
  /** This step alone is enough to pass the doctor ahead. */
  passesNext: boolean;
}

export interface StandingPart {
  criterion: ScoreCriterion;
  label: string;
  weight: number;
  /** Points earned out of the weight; null when the criterion was left out for this doctor. */
  points: number | null;
}

export interface Standing {
  rank: number;
  of: number;
  points: number;
  /** The doctor one place up and the points between them; null for the first. */
  ahead: { name: string; points: number; gap: number } | null;
  /** The doctor one place down and the points between them; null for the last. */
  behind: { name: string; points: number; gap: number } | null;
  parts: StandingPart[];
  /** Up to three moves, the biggest first. */
  steps: StandingStep[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const num = (value: number) => Math.ceil(value).toLocaleString('ar-EG');
const money = (value: number) => `${Math.ceil(value).toLocaleString('ar-EG')} ج`;

interface Lever {
  value: number;
  /** The amount that earns the full weight (the branch's best, or the doctor's follow-up target). */
  full: number;
  /** Multiplies the earned fraction (the average invoice counts fully from 30 invoices). */
  scale?: number;
  action: (amount: number) => string;
  perDay?: (amount: number) => string;
}

function leverFor(
  criterion: ScoreCriterion,
  doctor: PackDoctor,
  branch: PackDoctor[]
): Lever | null {
  const best = (pick: (d: PackDoctor) => number) => Math.max(0, ...branch.map(pick));
  switch (criterion) {
    case 'sales':
      return {
        value: doctor.sales,
        full: best((d) => d.sales),
        action: (amount) => `بيع بـ ${money(amount)} زيادة`,
        perDay: (amount) => `${money(amount)} في اليوم`,
      };
    case 'invoices':
      return {
        value: doctor.invoices,
        full: best((d) => d.invoices),
        action: (amount) => `اعمل ${num(amount)} فاتورة زيادة`,
        perDay: (amount) => `${num(amount)} فاتورة في اليوم`,
      };
    case 'average': {
      const steady = branch.filter((d) => d.invoices >= AVERAGE_FULL_AT_INVOICES);
      return {
        value: doctor.average_invoice,
        full: Math.max(0, ...(steady.length ? steady : branch).map((d) => d.average_invoice)),
        scale: Math.min(1, doctor.invoices / AVERAGE_FULL_AT_INVOICES),
        action: (amount) => `زوّد متوسط فاتورتك ${money(amount)}`,
      };
    }
    case 'list':
      return {
        value: doctor.list_value ?? 0,
        full: best((d) => d.list_value ?? 0),
        action: (amount) => `بيع من اللستة بـ ${money(amount)} زيادة`,
        perDay: (amount) => `${money(amount)} في اليوم`,
      };
    case 'followups':
      return {
        value: doctor.followup_requests ?? 0,
        full: doctor.followup_target ?? best((d) => d.followup_requests ?? 0),
        action: (amount) => `اعمل ${num(amount)} طلب متابعة زيادة`,
        perDay: (amount) => `${num(amount)} طلب في اليوم`,
      };
    case 'requests':
      return {
        value: doctor.customer_requests ?? 0,
        full: best((d) => d.customer_requests ?? 0),
        action: (amount) => `سجّل ${num(amount)} طلب عميل زيادة`,
        perDay: (amount) => `${num(amount)} طلب في اليوم`,
      };
    default:
      // The daily average follows sales, and attendance is handled on its own.
      return null;
  }
}

/**
 * Where `doctor` stands among `branch` (one branch's doctors, as the design pack ranks them) and the
 * moves that add the most points. Points are linear in each figure up to the branch's best, so the
 * amounts are close but not exact: the best can move too.
 */
export function competitionStanding(
  doctor: PackDoctor,
  branch: PackDoctor[],
  daysLeft: number
): Standing | null {
  if (doctor.competition_points === null || !doctor.score_parts) return null;
  const ranked = branch
    .filter((d) => d.competition_points !== null)
    .sort((a, b) => (b.competition_points ?? 0) - (a.competition_points ?? 0) || b.sales - a.sales);
  const index = ranked.findIndex((d) => d === doctor);
  if (index < 0) return null;
  const points = doctor.competition_points;
  const above = index > 0 ? ranked[index - 1] : null;
  const below = index < ranked.length - 1 ? ranked[index + 1] : null;

  const parts = doctor.score_parts;
  // A criterion left out for this doctor scales the others up to 100.
  const possible = SCORE_CRITERIA.reduce(
    (total, c) => total + (parts[c] === null ? 0 : SCORE_WEIGHTS[c]),
    0
  );
  const scaleTo100 = possible > 0 ? 100 / possible : 0;
  const gap = above ? round1((above.competition_points ?? 0) - points + 0.1) : null;

  const steps: StandingStep[] = [];
  // How big a step is next to the branch's best (0.2 = a fifth of what the best doctor did); the
  // smaller, the easier. Attendance has no amount and goes after the measurable moves.
  const effort = new Map<ScoreCriterion, number>();
  for (const criterion of SCORE_CRITERIA) {
    const earned = parts[criterion];
    if (earned === null) continue;
    const weight = SCORE_WEIGHTS[criterion];
    const headroom = (weight - earned) * scaleTo100;
    if (headroom < 0.5) continue;

    // Enough to pass the doctor ahead when this criterion can do it alone, else all it can still give.
    const wanted = gap !== null && gap <= headroom ? gap : headroom;

    if (criterion === 'attendance') {
      steps.push({
        criterion,
        label: SCORE_LABELS[criterion],
        action: 'التزم بمواعيد الشيفت: من غير تأخير ولا خروج بدري',
        perDay: null,
        points: round1(wanted),
        passesNext: gap !== null && wanted >= gap,
      });
      continue;
    }

    const lever = leverFor(criterion, doctor, branch);
    if (!lever || lever.full <= 0) continue;
    const pointsPerUnit = (weight / lever.full) * (lever.scale ?? 1) * scaleTo100;
    if (pointsPerUnit <= 0) continue;
    const amount = wanted / pointsPerUnit;
    if (amount <= 0) continue;
    effort.set(criterion, amount / lever.full);
    steps.push({
      criterion,
      label: SCORE_LABELS[criterion],
      action: lever.action(amount),
      perDay: lever.perDay && daysLeft > 0 ? lever.perDay(amount / daysLeft) : null,
      points: round1(wanted),
      passesNext: gap !== null && wanted >= gap,
    });
  }
  // The moves that alone pass the doctor ahead come first, the easiest of them first; then the
  // biggest gains.
  const effortOf = (step: StandingStep) => effort.get(step.criterion) ?? Number.POSITIVE_INFINITY;
  steps.sort((a, b) => {
    if (a.passesNext !== b.passesNext) return Number(b.passesNext) - Number(a.passesNext);
    if (a.passesNext) return effortOf(a) - effortOf(b);
    return b.points - a.points;
  });

  return {
    rank: index + 1,
    of: ranked.length,
    points,
    ahead: above
      ? {
          name: above.name,
          points: above.competition_points ?? 0,
          gap: round1((above.competition_points ?? 0) - points),
        }
      : null,
    behind: below
      ? {
          name: below.name,
          points: below.competition_points ?? 0,
          gap: round1(points - (below.competition_points ?? 0)),
        }
      : null,
    parts: SCORE_CRITERIA.map((criterion) => ({
      criterion,
      label: SCORE_LABELS[criterion],
      weight: SCORE_WEIGHTS[criterion],
      points: parts[criterion],
    })),
    steps: steps.slice(0, 3),
  };
}
