import { describe, expect, it } from 'vitest';
import {
  classifyDecisionSourceError,
  reportDecisionSource,
  sourceAvailable,
  sourceProblem,
  type DecisionSourceDiagnostic,
  type DiagnosticSink,
  UserFacingError,
  userFacingMessage,
} from '@/lib/evaluations/decisionSourceState';
import {
  buildDoctorDecision,
  type DoctorDecisionSources,
} from '@/lib/evaluations/doctorDecisionDataService';

// The exact PostgREST error seen in Preview before migration 20261008090000 is applied.
const PGRST202 = {
  code: 'PGRST202',
  message:
    'Could not find the function public.get_branch_doctor_performance_window_v1(p_branch, p_window_end, p_window_start) in the schema cache',
  details:
    'Searched for the function public.get_branch_doctor_performance_window_v1 with parameters p_branch, p_window_end, p_window_start',
  hint: null,
};
const TECHNICAL_FRAGMENTS = [
  'PGRST',
  'schema cache',
  'Could not find',
  'get_branch_doctor_performance_window_v1',
  'public.',
  '42883',
  '57014',
  '42501',
  'statement timeout',
  'permission denied',
];

function recordingSink() {
  const warnings: { source: string; payload: DecisionSourceDiagnostic }[] = [];
  const errors: { source: string; error: Error }[] = [];
  const sink: DiagnosticSink = {
    warn: (source, payload) => warnings.push({ source, payload }),
    error: (source, error) => errors.push({ source, error }),
  };
  return { sink, warnings, errors };
}

const expectPlain = (text: string | null) => {
  for (const fragment of TECHNICAL_FRAGMENTS) expect(String(text).includes(fragment)).toBe(false);
};

describe('decision source state — classification', () => {
  it('treats a missing PostgREST endpoint (PGRST202) as not enabled, in plain language', () => {
    const c = classifyDecisionSourceError(PGRST202, 'مقارنة الفرع', 'branch_window');
    expect(c.status).toBe('not_enabled');
    expect(c.reason).toContain('لم يُفعَّل بعد');
    expectPlain(c.reason);
  });

  it('treats a missing table endpoint (PGRST205) as not enabled', () => {
    expect(
      classifyDecisionSourceError(
        { code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" },
        'س',
        'x'
      ).status
    ).toBe('not_enabled');
  });

  it('keeps errors raised inside the database as real failures, never as "not enabled"', () => {
    const c = classifyDecisionSourceError(
      { code: '42883', message: 'function public.helper(uuid) does not exist' },
      'مقارنة الفرع',
      'branch_window'
    );
    expect(c.status).toBe('failed');
    expectPlain(c.reason);
    expect(
      classifyDecisionSourceError(
        { code: '42P01', message: 'relation "public.y" does not exist' },
        'س',
        'x'
      ).status
    ).toBe('failed');
  });

  it('explains timeouts, permissions and network failures without technical codes', () => {
    const timeout = classifyDecisionSourceError(
      { code: '57014', message: 'canceling statement due to statement timeout' },
      'مقارنة الفرع',
      'b'
    );
    const permission = classifyDecisionSourceError(
      { code: '42501', message: 'permission denied for function x' },
      'مقارنة الفرع',
      'b'
    );
    const network = classifyDecisionSourceError(
      new TypeError('Failed to fetch'),
      'مقارنة الفرع',
      'b'
    );
    expect([timeout.status, permission.status, network.status]).toEqual([
      'failed',
      'failed',
      'failed',
    ]);
    expect(timeout.reason).toContain('مهلة');
    expect(permission.reason).toContain('صلاحية');
    expect(network.reason).toContain('الاتصال');
    for (const r of [timeout.reason, permission.reason, network.reason]) expectPlain(r);
  });

  it('keeps the full technical detail in the diagnostic', () => {
    const c = classifyDecisionSourceError(PGRST202, 'مقارنة الفرع', 'branch_window');
    expect(c.diagnostic.code).toBe('PGRST202');
    expect(c.diagnostic.message).toBe(PGRST202.message);
    expect(c.diagnostic.details).toBe(PGRST202.details);
    expect(c.diagnostic.source).toBe('branch_window');
  });
});

describe('decision source state — diagnostics are never hidden', () => {
  it('logs a not-enabled source as a warning with the PostgREST code and message', () => {
    const { sink, warnings, errors } = recordingSink();
    const r = sourceProblem(PGRST202, 'مقارنة الفرع', 'branch_window', sink);
    expect(r.status).toBe('not_enabled');
    expect(warnings.length).toBe(1);
    expect(errors.length).toBe(0);
    expect(warnings[0].source).toBe('doctor-decision:branch_window');
    expect(warnings[0].payload.code).toBe('PGRST202');
    expect(warnings[0].payload.message).toContain('get_branch_doctor_performance_window_v1');
  });

  it('logs a real failure as a runtime error carrying code and message', () => {
    const { sink, warnings, errors } = recordingSink();
    const r = sourceProblem(
      { code: '57014', message: 'canceling statement due to statement timeout' },
      'مقارنة الفرع',
      'branch_window',
      sink
    );
    expect(r.status).toBe('failed');
    expect(warnings.length).toBe(0);
    expect(errors.length).toBe(1);
    expect(errors[0].error.message).toContain('57014');
    expect(errors[0].error.message).toContain('statement timeout');
  });

  it('logs nothing for an available source', () => {
    const { sink, warnings, errors } = recordingSink();
    reportDecisionSource(sourceAvailable({ ok: true }), sink);
    expect(warnings.length + errors.length).toBe(0);
  });
});

describe('decision source state — end to end through the Eye decision builder', () => {
  const sources = (branch: DoctorDecisionSources['branch']): DoctorDecisionSources => ({
    branch,
    reviews: sourceAvailable([]),
    previousEvaluation: { status: 'available', value: null, reason: null, diagnostic: null },
  });
  const quietSink = recordingSink().sink;

  it('turns the Preview PGRST202 into a neutral not-enabled state with no decision and no technical text', () => {
    const decision = buildDoctorDecision(
      sources(sourceProblem(PGRST202, 'مقارنة الفرع', 'branch_window', quietSink)),
      { staffId: 'T', cycleLabel: '2026-10', sections: [] }
    );
    expect(decision.availability).toBe('not_enabled');
    expect(decision.decision).toBe(null);
    expect(decision.summary.decision).toBe(null);
    expect(decision.problems.length).toBe(0);
    expectPlain(JSON.stringify(decision));
  });

  it('turns a timeout into a failed state with no decision and no technical text', () => {
    const decision = buildDoctorDecision(
      sources(
        sourceProblem(
          { code: '57014', message: 'canceling statement due to statement timeout' },
          'مقارنة الفرع',
          'branch_window',
          quietSink
        )
      ),
      { staffId: 'T', cycleLabel: '2026-10', sections: [] }
    );
    expect(decision.availability).toBe('failed');
    expect(decision.decision).toBe(null);
    expectPlain(JSON.stringify(decision));
  });
});

describe('doctor eye — no technical text can reach the screen', () => {
  const TECHNICAL_ERRORS: unknown[] = [
    PGRST202,
    { code: 'PGRST205', message: "Could not find the table 'public.whatsapp_doctor_cycle_intelligence_v1' in the schema cache" },
    { code: '42883', message: 'function public.helper(uuid) does not exist', hint: 'No function matches the given name and argument types.' },
    { code: '42P01', message: 'relation "public.attendance_logs" does not exist' },
    { code: '57014', message: 'canceling statement due to statement timeout' },
    { code: '42501', message: 'permission denied for function get_staff_performance_sales_bundle_v1' },
    { code: 'XX000', message: 'internal error: could not open relation with OID 16384' },
    { message: 'staff_sales_branch_scope_denied' },
    { message: 'column sales_invoices.net_total does not exist' },
    new TypeError('Failed to fetch'),
    'canceling statement due to statement timeout',
  ];
  const quiet = { warn: () => undefined, error: () => undefined };
  const RAW = [/PGRST\d/, /\b[0-9A-Z]{5}\b/, /schema cache/i, /does not exist/i, /relation|column|function public\./i, /permission denied/i, /statement timeout/i, /OID/, /_v\d\b/, /scope_denied/, /Failed to fetch/];

  it('maps every technical error to a plain reason while keeping the original in the diagnostic', () => {
    for (const error of TECHNICAL_ERRORS) {
      const result = sourceProblem(error, 'المبيعات', 'sales', quiet);
      expect(['not_enabled', 'failed'].includes(result.status)).toBe(true);
      for (const pattern of RAW) expect(pattern.test(String(result.reason))).toBe(false);
      expect(result.diagnostic === null).toBe(false);
    }
  });

  it('shows a thrown UserFacingError as-is', () => {
    expect(userFacingMessage(new UserFacingError('تعذر تحميل مصدر «رحلات الأصناف» حاليًا.'), 'بديل', 'evidence', quiet)).toBe('تعذر تحميل مصدر «رحلات الأصناف» حاليًا.');
  });

  it('replaces any other exception with generic text and logs the original', () => {
    const { sink, errors } = recordingSink();
    const shown = userFacingMessage(new Error('PGRST202: Could not find the function public.x'), 'تعذر بناء التحليل الآن.', 'load', sink);
    expect(shown).toBe('تعذر بناء التحليل الآن.');
    expect(errors.length).toBe(1);
    expect(errors[0].source).toBe('doctor-eye:load');
    expect(errors[0].error.message).toContain('PGRST202');
    expect(userFacingMessage('plain string failure', 'بديل', 'load', quiet)).toBe('بديل');
  });
});
