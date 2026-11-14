import { buildCycleScores, type LabPersonScore } from '../buildCycleScores';
import { DOCTOR_LEVELS, LAB_PUBLISHED_VERSION } from '../catalog';
import { loadCycleEvidence, type LabCycle } from '../loadCycleEvidence';

// The monthly evaluation (lab engine, current version) computed on the server for the doctor
// dashboard. Same evidence and scoring as /evaluation-lab; only the running cycle is cut at today.

const DAY = 864e5;
const cairoToday = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export interface ServerCycle extends LabCycle {
  kind: 'running' | 'closed';
  /** The cycle's real end (the next 26th); equals endExclusive for a closed cycle. */
  fullEndExclusive: string;
  elapsedDays: number;
  totalDays: number;
}

/** The 26→25 cycle that contains `day` (YYYY-MM-DD). */
function cycleOf(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const startMonth = d >= 26 ? m - 1 : m - 2;
  const start = new Date(Date.UTC(y, startMonth, 26)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, startMonth + 1, 26)).toISOString().slice(0, 10);
  return { start, end };
}

/**
 * The running cycle up to yesterday (today's sales file is uploaded at the end of the day), or
 * null on the cycle's first day. The last closed cycle is the one before it.
 */
export function serverCycle(kind: 'running' | 'closed', now = new Date()): ServerCycle | null {
  const today = cairoToday(now);
  const running = cycleOf(today);
  if (kind === 'closed') {
    const closed = cycleOf(addDays(running.start, -1));
    const totalDays = daysBetween(closed.start, closed.end);
    return { kind, start: closed.start, endExclusive: closed.end, fullEndExclusive: closed.end, elapsedDays: totalDays, totalDays };
  }
  const elapsedDays = daysBetween(running.start, today);
  if (elapsedDays < 1) return null;
  return { kind, start: running.start, endExclusive: today, fullEndExclusive: running.end, elapsedDays, totalDays: daysBetween(running.start, running.end) };
}

export type DoctorLevelKey = (typeof DOCTOR_LEVELS)[number]['key'];

export async function computeCycleScores(cycle: ServerCycle, levels: Record<string, DoctorLevelKey>): Promise<LabPersonScore[]> {
  const doctorWeights = Object.fromEntries(Object.entries(levels).map(([id, key]) => [id, DOCTOR_LEVELS.find((l) => l.key === key)?.weight ?? 1]));
  const evidence = await loadCycleEvidence({ start: cycle.start, endExclusive: cycle.endExclusive }, { doctorWeights });
  // A running cycle covers only part of the month: the monthly branch target shrinks with it, so
  // the hours worked so far are measured against their own part of the target.
  const share = cycle.totalDays ? cycle.elapsedDays / cycle.totalDays : 1;
  const targets = share < 1 ? evidence.targets.map((t) => ({ ...t, targetAmount: t.targetAmount * share })) : evidence.targets;
  return buildCycleScores({ ...evidence, targets, doctorWeights, cycleShare: share }, LAB_PUBLISHED_VERSION);
}

// The dashboard shows the published version, not the one under trial in the lab.
export { LAB_PUBLISHED_VERSION as LAB_CURRENT_VERSION };
