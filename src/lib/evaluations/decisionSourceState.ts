import { logRuntimeError } from '@/lib/appRecovery';

/**
 * Source-state contract for every source shown in the Doctor Performance Eye (the doctor's own sources and
 * the branch decision layer).
 *
 * - `not_enabled`: the backend endpoint does not exist yet (PostgREST cannot find the RPC/table, e.g. a
 *   migration that has not been applied). An expected rollout state, not a crash.
 * - `failed`: the endpoint exists but the read did not complete (timeout, permission, network, invalid
 *   payload, or any error raised inside the database). A real fault.
 *
 * The user-facing `reason` is always plain Arabic without PostgREST/SQL codes or messages. The technical detail
 * is kept in `diagnostic` and always written to the diagnostic log, so hiding it from the UI never hides it
 * from support.
 */
export type DecisionSourceStatus = 'available' | 'not_enabled' | 'failed';
export type DecisionSourceDiagnostic = {
  source: string;
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};
export type DecisionSourceResult<T> = {
  status: DecisionSourceStatus;
  value: T | null;
  reason: string | null;
  diagnostic: DecisionSourceDiagnostic | null;
};

/** Only PostgREST's "endpoint not exposed" codes mean "not enabled". Errors raised inside SQL (e.g. 42883 in a function body) are real failures. */
const NOT_ENABLED_CODES = new Set(['PGRST202', 'PGRST205']);

export function sourceAvailable<T>(value: T): DecisionSourceResult<T> {
  return { status: 'available', value, reason: null, diagnostic: null };
}

export function classifyDecisionSourceError(
  error: unknown,
  label: string,
  source: string
): { status: 'not_enabled' | 'failed'; reason: string; diagnostic: DecisionSourceDiagnostic } {
  const e = (error && typeof error === 'object' ? error : { message: String(error ?? '') }) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const code = e.code ? String(e.code) : null;
  const message = String(e.message ?? (error instanceof Error ? error.message : '') ?? '').trim();
  const diagnostic: DecisionSourceDiagnostic = {
    source,
    code,
    message,
    details: e.details ? String(e.details) : null,
    hint: e.hint ? String(e.hint) : null,
  };
  if (code && NOT_ENABLED_CODES.has(code)) {
    return {
      status: 'not_enabled',
      reason: `مصدر «${label}» لم يُفعَّل بعد على قاعدة البيانات.`,
      diagnostic,
    };
  }
  if (code === '57014' || /statement timeout/i.test(message))
    return {
      status: 'failed',
      reason: `انتهت مهلة تحميل مصدر «${label}»؛ أعد المحاولة بعد قليل.`,
      diagnostic,
    };
  if (code === '42501' || /permission denied|not authorized|scope_denied/i.test(message))
    return {
      status: 'failed',
      reason: `لا توجد صلاحية لعرض مصدر «${label}» لهذا الدكتور.`,
      diagnostic,
    };
  if (/Failed to fetch|NetworkError|network|timed out/i.test(message))
    return {
      status: 'failed',
      reason: `تعذر الاتصال لتحميل مصدر «${label}»؛ تحقق من الشبكة ثم أعد التحميل.`,
      diagnostic,
    };
  return { status: 'failed', reason: `تعذر تحميل مصدر «${label}» حاليًا.`, diagnostic };
}

export type DiagnosticSink = {
  warn: (source: string, payload: DecisionSourceDiagnostic) => void;
  error: (source: string, error: Error) => void;
};

const defaultSink: DiagnosticSink = {
  warn: (source, payload) => console.warn(`[Dawaa ${source}] source not enabled`, payload),
  error: (source, error) => logRuntimeError(source, error),
};

/**
 * Writes every non-available source to the diagnostic log with its full technical detail.
 * `failed` goes through the runtime error recorder (console.error + last-runtime-error); `not_enabled`
 * is a rollout state and is logged as a warning.
 */
export function reportDecisionSource<T>(
  result: DecisionSourceResult<T>,
  sink: DiagnosticSink = defaultSink
): DecisionSourceResult<T> {
  if (result.status === 'available' || !result.diagnostic) return result;
  const d = result.diagnostic;
  const key = `doctor-decision:${d.source}`;
  if (result.status === 'not_enabled') sink.warn(key, d);
  else
    sink.error(
      key,
      Object.assign(new Error(`${d.code ? `${d.code}: ` : ''}${d.message || 'unknown error'}`), {
        code: d.code,
        details: d.details,
        hint: d.hint,
      })
    );
  return result;
}

export function sourceProblem<T>(
  error: unknown,
  label: string,
  source: string,
  sink?: DiagnosticSink
): DecisionSourceResult<T> {
  const c = classifyDecisionSourceError(error, label, source);
  return reportDecisionSource<T>(
    { status: c.status, value: null, reason: c.reason, diagnostic: c.diagnostic },
    sink
  );
}

/** Classifies and logs a failed read in one step; returns only what the UI may show plus the kept diagnostic. */
export function describeSourceProblem(error: unknown, label: string, source: string, sink?: DiagnosticSink) {
  const r = sourceProblem<never>(error, label, source, sink);
  return {
    status: r.status as 'not_enabled' | 'failed',
    reason: r.reason as string,
    diagnostic: r.diagnostic as DecisionSourceDiagnostic,
  };
}

/**
 * A message that is safe to show as-is. Any other thrown error is shown with generic text and logged, so a
 * raw PostgREST/SQL/JS message can never reach the screen through a catch block.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function userFacingMessage(
  error: unknown,
  fallback: string,
  source: string,
  sink: DiagnosticSink = defaultSink
): string {
  if (error instanceof UserFacingError) return error.message;
  sink.error(`doctor-eye:${source}`, error instanceof Error ? error : new Error(String(error)));
  return fallback;
}

export const SOURCE_STATUS_LABEL: Record<DecisionSourceStatus, string> = {
  available: 'متاح',
  not_enabled: 'لم يُفعَّل بعد',
  failed: 'تعذر التحميل',
};
