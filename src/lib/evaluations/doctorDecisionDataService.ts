import { supabase } from '@/lib/supabase';
import { sourceAvailable, sourceProblem, type DecisionSourceResult } from '@/lib/evaluations/decisionSourceState';
import { evaluationCycleDateKeys, isEvaluationCycleClosed, previousEvaluationCycleLabel } from '@/lib/evaluations/monthlyEvaluationCycle';
import { buildConversationCoaching, loadBranchConversationReviewRows } from '@/lib/staff/employeeMonthlyEvidenceService';
import { buildDecisionIntelligence, groupReviewRowsByDoctorCycle, type DecisionIntelligence, type QualityIndex } from '@/lib/evaluations/doctorDecisionIntelligence';

/**
 * Data boundary for the Doctor Performance Eye decision layer. Everything here is read-only and bounded:
 * - one branch-scoped aggregate RPC (no invoice rows reach the browser),
 * - branch conversation reviews through the canonical monthly-evidence reader,
 * - the previous cycle's evaluation through the canonical v5 evaluation RPC.
 * Each source fails independently with an explicit state (`not_enabled` / `failed`), a plain-language reason and a
 * logged technical diagnostic; nothing missing is returned as an empty success.
 */

export type ShiftKey = 'morning' | 'evening' | 'night' | 'unknown';
export type BranchShiftCell = { hours: number; days: number; pendingDays: number; lateDays: number; sales: number; invoices: number };
export type BranchDoctorCycle = {
  start: string;
  sales: { salesAll: number; invoicesAll: number; customers: number; directInvoices: number; aliasInvoices: number };
  ambiguousInvoices: number;
  unmatched: { invoices: number; sales: number };
  shifts: Partial<Record<ShiftKey, BranchShiftCell>>;
  attendance: null | { available: boolean; workedDays?: number; lateDays?: number; workedHours?: number; pendingReviewDays?: number; cycleOpen?: boolean; error?: string };
};
export type BranchDoctorRow = { staffId: string; name: string; active: boolean; homeBranch: string | null; cycles: BranchDoctorCycle[] };
export type BranchPerformanceWindow = {
  branch: string;
  windowStart: string;
  windowEnd: string;
  dataAsOf: string | null;
  cycles: { start: string; endExclusive: string }[];
  ambiguousNames: string[];
  branchCycles: { start: string; invoices: number; doctorInvoices: number; ambiguousInvoices: number }[];
  doctors: BranchDoctorRow[];
};

export type PreviousEvaluation = {
  cycleLabel: string;
  status: string;
  sections: { key: string; title: string; score: number }[];
  developmentPoints: string[];
  managerNotes: string;
};

export type { DecisionSourceResult } from '@/lib/evaluations/decisionSourceState';

const WINDOW_CYCLES = 4;
const BRANCH_LABEL = 'مقارنة الفرع';
const REVIEWS_LABEL = 'مراجعات محادثات الفرع';
const PREVIOUS_EVALUATION_LABEL = 'تقييم الدورة السابقة';
const CACHE_TTL_MS = 5 * 60_000;
const windowCache = new Map<string, { at: number; promise: Promise<DecisionSourceResult<BranchPerformanceWindow>> }>();
const reviewCache = new Map<string, { at: number; promise: Promise<DecisionSourceResult<Record<string, unknown>[]>> }>();

export function decisionWindowFor(cycleLabel: string) {
  let first = cycleLabel;
  for (let i = 1; i < WINDOW_CYCLES; i += 1) first = previousEvaluationCycleLabel(first);
  return { windowStart: evaluationCycleDateKeys(first).startDate, windowEnd: evaluationCycleDateKeys(cycleLabel).endDateExclusive };
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Strict shape check: a payload that does not match is reported as unavailable, never coerced into zeros. */
export function parseBranchPerformanceWindow(raw: unknown): BranchPerformanceWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.doctors) || !Array.isArray(r.cycles) || !Array.isArray(r.branchCycles) || typeof r.branch !== 'string') return null;
  const shiftCell = (v: unknown): BranchShiftCell => {
    const c = (v || {}) as Record<string, unknown>;
    return { hours: num(c.hours), days: num(c.days), pendingDays: num(c.pendingDays), lateDays: num(c.lateDays), sales: num(c.sales), invoices: num(c.invoices) };
  };
  return {
    branch: r.branch,
    windowStart: String(r.windowStart || ''),
    windowEnd: String(r.windowEnd || ''),
    dataAsOf: r.dataAsOf ? String(r.dataAsOf) : null,
    cycles: (r.cycles as Record<string, unknown>[]).map(c => ({ start: String(c.start), endExclusive: String(c.endExclusive) })),
    ambiguousNames: Array.isArray(r.ambiguousNames) ? (r.ambiguousNames as unknown[]).map(String) : [],
    branchCycles: (r.branchCycles as Record<string, unknown>[]).map(c => ({ start: String(c.start), invoices: num(c.invoices), doctorInvoices: num(c.doctorInvoices), ambiguousInvoices: num(c.ambiguousInvoices) })),
    doctors: (r.doctors as Record<string, unknown>[]).map(d => ({
      staffId: String(d.staffId),
      name: String(d.name || ''),
      active: d.active !== false,
      homeBranch: d.homeBranch ? String(d.homeBranch) : null,
      cycles: (Array.isArray(d.cycles) ? d.cycles as Record<string, unknown>[] : []).map(c => {
        const sales = (c.sales || {}) as Record<string, unknown>;
        const unmatched = (c.unmatched || {}) as Record<string, unknown>;
        const shifts = (c.shifts || {}) as Record<string, unknown>;
        const attendance = c.attendance && typeof c.attendance === 'object' ? c.attendance as Record<string, unknown> : null;
        return {
          start: String(c.start),
          sales: { salesAll: num(sales.salesAll), invoicesAll: num(sales.invoicesAll), customers: num(sales.customers), directInvoices: num(sales.directInvoices), aliasInvoices: num(sales.aliasInvoices) },
          ambiguousInvoices: num(c.ambiguousInvoices),
          unmatched: { invoices: num(unmatched.invoices), sales: num(unmatched.sales) },
          shifts: Object.fromEntries(Object.entries(shifts).map(([k, v]) => [k, shiftCell(v)])) as Partial<Record<ShiftKey, BranchShiftCell>>,
          attendance: attendance ? {
            available: attendance.available === true,
            workedDays: attendance.workedDays === undefined || attendance.workedDays === null ? undefined : num(attendance.workedDays),
            lateDays: attendance.lateDays === undefined || attendance.lateDays === null ? undefined : num(attendance.lateDays),
            workedHours: attendance.workedHours === undefined || attendance.workedHours === null ? undefined : num(attendance.workedHours),
            pendingReviewDays: attendance.pendingReviewDays === undefined || attendance.pendingReviewDays === null ? undefined : num(attendance.pendingReviewDays),
            cycleOpen: attendance.cycleOpen === true,
            error: attendance.error ? String(attendance.error) : undefined,
          } : null,
        };
      }),
    })),
  };
}

export function loadBranchPerformanceWindow(args: { branch: string; cycleLabel: string; force?: boolean }): Promise<DecisionSourceResult<BranchPerformanceWindow>> {
  const { windowStart, windowEnd } = decisionWindowFor(args.cycleLabel);
  const key = `${args.branch}:${windowStart}:${windowEnd}`;
  const cached = windowCache.get(key);
  if (!args.force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = (async (): Promise<DecisionSourceResult<BranchPerformanceWindow>> => {
    const { data, error } = await supabase.rpc('get_branch_doctor_performance_window_v1', { p_branch: args.branch, p_window_start: windowStart, p_window_end: windowEnd });
    if (error) return sourceProblem<BranchPerformanceWindow>(error, BRANCH_LABEL, 'branch_window');
    const parsed = parseBranchPerformanceWindow(data);
    // A payload that does not match the contract is a failure, never zeros.
    return parsed ? sourceAvailable(parsed) : sourceProblem<BranchPerformanceWindow>({ code: 'invalid_payload', message: 'branch window payload failed the shape check' }, BRANCH_LABEL, 'branch_window');
  })()
    // A thrown request or parser error is a failed source (evicted below), never a rejected promise pinned in the cache.
    .catch((e: unknown) => sourceProblem<BranchPerformanceWindow>(e, BRANCH_LABEL, 'branch_window'));
  windowCache.set(key, { at: Date.now(), promise });
  void promise.then(r => { if (r.status !== 'available' && windowCache.get(key)?.promise === promise) windowCache.delete(key); });
  return promise;
}

export function loadBranchReviewRows(args: { branch: string; cycleLabel: string; force?: boolean }): Promise<DecisionSourceResult<Record<string, unknown>[]>> {
  const { windowStart, windowEnd } = decisionWindowFor(args.cycleLabel);
  const key = `${args.branch}:${windowStart}:${windowEnd}`;
  const cached = reviewCache.get(key);
  if (!args.force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = loadBranchConversationReviewRows({ branch: args.branch, startDate: windowStart, endDateExclusive: windowEnd })
    .then(({ rows, error }) => error
      ? sourceProblem<Record<string, unknown>[]>({ message: error }, REVIEWS_LABEL, 'branch_reviews')
      : sourceAvailable(rows))
    .catch((e: unknown) => sourceProblem<Record<string, unknown>[]>(e, REVIEWS_LABEL, 'branch_reviews'));
  reviewCache.set(key, { at: Date.now(), promise });
  void promise.then(r => { if (r.status !== 'available' && reviewCache.get(key)?.promise === promise) reviewCache.delete(key); });
  return promise;
}

/** Previous cycle evaluation through the canonical v5 RPC; only the published snapshot counts as a decision. */
export async function loadPreviousEvaluation(args: { actorId: string; staffId: string; cycleLabel: string }): Promise<DecisionSourceResult<PreviousEvaluation>> {
  const previousLabel = previousEvaluationCycleLabel(args.cycleLabel);
  const { data, error } = await supabase.rpc('get_staff_monthly_evaluation_v5', { p_actor_id: args.actorId, p_staff_id: args.staffId, p_month: `${previousLabel}-01` });
  if (error) return sourceProblem<PreviousEvaluation>(error, PREVIOUS_EVALUATION_LABEL, 'previous_evaluation');
  // No evaluation saved for that cycle is a valid, available answer (not a failure).
  if (!data || typeof data !== 'object') return { status: 'available', value: null, reason: null, diagnostic: null };
  const row = data as Record<string, unknown>;
  const status = String(row.status || 'draft');
  const metrics = row.metrics_snapshot as Record<string, unknown> | null;
  const snapshot = metrics?.final_approval_snapshot && typeof metrics.final_approval_snapshot === 'object' ? metrics.final_approval_snapshot as Record<string, unknown> : null;
  const published = ['sent', 'approved'].includes(status) && snapshot;
  const content = (published || row) as Record<string, unknown>;
  return sourceAvailable<PreviousEvaluation>({
      cycleLabel: previousLabel,
      status: published ? status : 'draft',
      sections: (Array.isArray(content.sections) ? content.sections as Record<string, unknown>[] : []).map(s => ({ key: String(s.key || ''), title: String(s.title || ''), score: num(s.score) })),
      developmentPoints: Array.isArray(content.development_points) ? (content.development_points as unknown[]).map(String).filter(Boolean) : [],
      managerNotes: String(content.manager_notes || ''),
  });
}

export function invalidateDoctorDecisionData() {
  windowCache.clear();
  reviewCache.clear();
}

function nextCycleLabel(label: string) {
  const [y, m] = label.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Canonical rubric summary per doctor/cycle; the same builder the evaluation page uses for its own evidence. */
export function qualityIndexFromRows(rows: Record<string, unknown>[] | null, cycles: { start: string; endExclusive: string }[]): QualityIndex {
  if (!rows) return { available: false, byDoctor: {} };
  const grouped = groupReviewRowsByDoctorCycle(rows, cycles);
  const byDoctor: QualityIndex['byDoctor'] = {};
  for (const [staffId, perCycle] of Object.entries(grouped)) {
    for (const [cycleStart, list] of Object.entries(perCycle)) {
      const c = buildConversationCoaching(list);
      (byDoctor[staffId] ||= {})[cycleStart] = {
        reviewCount: c.reviewCount, sampleSufficient: c.sampleSufficient, coreAverage: c.coreAverage,
        medicalErrors: c.flags.medicalErrors, criticalErrors: c.flags.criticalErrors, complaints: c.flags.complaints, severeBadTone: c.flags.severeBadTone,
      };
    }
  }
  return { available: true, byDoctor };
}

export type DoctorDecisionSources = {
  branch: DecisionSourceResult<BranchPerformanceWindow>;
  reviews: DecisionSourceResult<Record<string, unknown>[]>;
  previousEvaluation: DecisionSourceResult<PreviousEvaluation>;
};

/** Loads the three decision sources in parallel; each fails independently and keeps its own error. */
export async function loadDoctorDecisionSources(args: { staffId: string; branch: string; cycleLabel: string; actorId: string | null; force?: boolean }): Promise<DoctorDecisionSources> {
  const [branch, reviews, previousEvaluation] = await Promise.all([
    loadBranchPerformanceWindow({ branch: args.branch, cycleLabel: args.cycleLabel, force: args.force }),
    loadBranchReviewRows({ branch: args.branch, cycleLabel: args.cycleLabel, force: args.force }),
    args.actorId
      ? loadPreviousEvaluation({ actorId: args.actorId, staffId: args.staffId, cycleLabel: args.cycleLabel })
      : Promise.resolve(sourceProblem<PreviousEvaluation>({ code: 'missing_actor', message: 'no verified actor id for the previous evaluation read' }, PREVIOUS_EVALUATION_LABEL, 'previous_evaluation')),
  ]);
  return { branch, reviews, previousEvaluation };
}

/**
 * Pure: runs the decision engine on loaded sources. Cheap enough to re-run on every rating change so the
 * evaluation-consistency check follows the manager's current axis scores live.
 */
export function buildDoctorDecision(sources: DoctorDecisionSources, args: { staffId: string; cycleLabel: string; sections: { key: string; title: string; score: number }[] }): DecisionIntelligence {
  const cycles = sources.branch.value?.cycles || [];
  return buildDecisionIntelligence({
    staffId: args.staffId,
    window: sources.branch.value,
    windowSource: { status: sources.branch.status, reason: sources.branch.reason },
    quality: sources.reviews.status === 'available' ? qualityIndexFromRows(sources.reviews.value, cycles) : { available: false, byDoctor: {} },
    sections: args.sections,
    previousEvaluation: sources.previousEvaluation.value,
    openCycleStart: isEvaluationCycleClosed(args.cycleLabel) ? null : evaluationCycleDateKeys(args.cycleLabel).startDate,
    evaluatedCycleStart: evaluationCycleDateKeys(args.cycleLabel).startDate,
    nextReviewDate: evaluationCycleDateKeys(nextCycleLabel(args.cycleLabel)).endDate,
  });
}
