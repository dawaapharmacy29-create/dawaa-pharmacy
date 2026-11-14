// نجم الفرع (owner decision 2026-11-14): one doctor per branch wins 1000 EGP a month.
// Who may win (gates): no unexcused absence, fewer than 3 violations, enough working days, and the monthly
// score passed the 60 line (so conversations and the rest still matter).
// Points: own sales against his hours' target 50%, follow-ups against his share of the branch target 35%,
// complete customer requests against 20 a month 15%. Each part is a percentage capped at 150, so going past
// the target still counts. A part that cannot be measured gives its weight to the others.
// Ties: fewer violations, then more follow-ups. Pure: no I/O.

export const STAR_PRIZE = 1000;
export const STAR_RULES = {
  maxViolations: 2,
  /** Working days for a full cycle; a running cycle needs the same share of it. */
  minWorkedDays: 20,
  minScore: 60,
  cap: 150,
  weights: { sales: 50, followups: 35, requests: 15 },
} as const;

export interface StarInput {
  staffId: string;
  name: string;
  branch: string | null;
  /** The monthly score (null when too little was measured). */
  score: number | null;
  /** Percent of target, uncapped; null when not measurable. */
  salesPct: number | null;
  followupPct: number | null;
  requestsPct: number | null;
  /** Projected follow-ups, for the tie-break. */
  followups: number;
  workedDays: number;
  absentDays: number;
  violations: number;
}

export interface BranchStar {
  points: number | null;
  parts: { sales: number | null; followups: number | null; requests: number | null };
  eligible: boolean;
  /** Why the doctor cannot win yet, in Arabic. */
  blockers: string[];
  /** Place among the eligible doctors of the branch (null when not eligible). */
  rank: number | null;
  of: number;
  leader: { name: string; points: number } | null;
  /** Points between this doctor and the leader (0 for the leader). */
  gap: number | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function starPoints(input: Pick<StarInput, 'salesPct' | 'followupPct' | 'requestsPct'>) {
  const cap = (value: number | null) => (value === null ? null : Math.max(0, Math.min(STAR_RULES.cap, value)));
  const parts = { sales: cap(input.salesPct), followups: cap(input.followupPct), requests: cap(input.requestsPct) };
  const weighted = (Object.keys(parts) as Array<keyof typeof parts>)
    .filter((key) => parts[key] !== null)
    .map((key) => ({ value: parts[key] as number, weight: STAR_RULES.weights[key] }));
  const weight = weighted.reduce((s, row) => s + row.weight, 0);
  return { parts, points: weight ? round1(weighted.reduce((s, row) => s + row.value * row.weight, 0) / weight) : null };
}

export function starBlockers(input: StarInput, cycleShare: number): string[] {
  const out: string[] = [];
  const minDays = Math.max(1, Math.ceil(STAR_RULES.minWorkedDays * Math.min(1, Math.max(0, cycleShare))));
  if (input.absentDays > 0) out.push(`غياب من غير إذن (${input.absentDays} يوم)`);
  if (input.violations > STAR_RULES.maxViolations) out.push(`${input.violations} مخالفات (المسموح ${STAR_RULES.maxViolations})`);
  if (input.workedDays < minDays) out.push(`${input.workedDays} يوم شغل (المطلوب ${minDays} لحد دلوقتي)`);
  if (input.score === null) out.push('التقييم الشهري لسه بيانات قليلة');
  else if (input.score < STAR_RULES.minScore) out.push(`التقييم الشهري ${Math.round(input.score)} (لازم ${STAR_RULES.minScore}+)`);
  return out;
}

/** The race of each branch: every doctor's points, place and distance from the leader. */
export function branchStars(inputs: StarInput[], cycleShare: number): Map<string, BranchStar> {
  const out = new Map<string, BranchStar>();
  const branches = new Map<string, StarInput[]>();
  for (const input of inputs) {
    const key = input.branch || '';
    branches.set(key, [...(branches.get(key) || []), input]);
  }
  for (const members of branches.values()) {
    const rows = members.map((input) => {
      const { points, parts } = starPoints(input);
      const blockers = starBlockers(input, cycleShare);
      if (points === null) blockers.push('مفيش بند متقاس في السباق');
      return { input, points, parts, blockers };
    });
    const ranked = rows
      .filter((row) => !row.blockers.length && row.points !== null)
      .sort((a, b) =>
        (b.points as number) - (a.points as number) ||
        a.input.violations - b.input.violations ||
        b.input.followups - a.input.followups ||
        a.input.name.localeCompare(b.input.name, 'ar'));
    const leader = ranked[0] ? { name: ranked[0].input.name, points: ranked[0].points as number } : null;
    for (const row of rows) {
      const place = ranked.indexOf(row);
      out.set(row.input.staffId, {
        points: row.points,
        parts: row.parts,
        eligible: !row.blockers.length,
        blockers: row.blockers,
        rank: place >= 0 ? place + 1 : null,
        of: ranked.length,
        leader,
        gap: leader && row.points !== null ? round1(Math.max(0, leader.points - row.points)) : null,
      });
    }
  }
  return out;
}
