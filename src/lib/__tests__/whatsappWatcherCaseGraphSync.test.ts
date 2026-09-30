import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncWatcherCaseGraph } from '@/lib/whatsappWatcherCaseGraphSync';

let upsertError: { message: string } | null = null;
const upsertedPayloads: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const state: { rows: unknown[]; upsert: Record<string, unknown> | null } = {
      rows: [],
      upsert: null,
    };
    const api: Record<string, any> = {
      select: () => api,
      in: () => {
        if (table === 'whatsapp_review_sources') {
          state.rows = [
            {
              id: 'source-1',
              branch: 'فرع شكري',
              customer_id: 'customer-1',
              raw_text: 'hello',
              analysis_json: {},
            },
          ];
        }
        return Promise.resolve({ data: state.rows, error: null });
      },
      upsert: (payload: Record<string, unknown>) => {
        state.upsert = payload;
        return api;
      },
      single: () => {
        if (table === 'whatsapp_customer_cases_v22') {
          if (upsertError) return Promise.resolve({ data: null, error: upsertError });
          upsertedPayloads.push(state.upsert || {});
          return Promise.resolve({ data: { id: 'v22-case-1' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return api;
  };
  return { supabase: { from: (table: string) => chain(table) } };
});

const caseItem = {
  id: 'case-1',
  type: 'order',
  state: 'awaiting_customer',
  startedAt: '2026-09-15T06:46:45.000Z',
  lastEventAt: '2026-09-15T07:00:00.000Z',
  sessionIds: ['session-1'],
  staffNames: [],
  orderIntent: false,
  orderConfirmed: false,
  failure: false,
  complaint: false,
  recommendation: false,
  recoveryAttempts: 0,
  customerReengaged: false,
  mediaReferenced: 0,
  mediaAvailable: 0,
  mediaMissing: 0,
  mediaCoveragePercent: 100,
  semanticCoverage: 'full_text',
  needsHumanReview: false,
  nextAction: '',
  summary: '',
};

describe('watcher case graph sync — Customer Case V22 is independent of Journey V15', () => {
  beforeEach(() => {
    upsertError = null;
    upsertedPayloads.length = 0;
  });

  it('persists the V22 case even when journey sync fails, and reports the journey failure', async () => {
    const syncCustomerCases = vi
      .fn()
      .mockResolvedValue({ saved: 1, skipped: 0, failed: 0, failures: [] });
    const result = await syncWatcherCaseGraph(
      { syncJourney: () => Promise.reject(new Error('journey_down')), syncCustomerCases },
      { persistedSourceCount: 1, expectedCaseCount: 1 }
    );
    expect(syncCustomerCases).toHaveBeenCalledTimes(1);
    expect(result.journey).toEqual({ status: 'failed', error: 'journey_down' });
    expect(result.customerCase.status).toBe('saved');
    expect(result.customerCase.saved).toBe(1);
  });

  it('still writes V22 when the journey builder throws synchronously', async () => {
    const syncCustomerCases = vi
      .fn()
      .mockResolvedValue({ saved: 1, skipped: 0, failed: 0, failures: [] });
    const result = await syncWatcherCaseGraph(
      {
        syncJourney: () => {
          throw new Error('builder_crash');
        },
        syncCustomerCases,
      },
      { persistedSourceCount: 1, expectedCaseCount: 1 }
    );
    expect(result.journey.status).toBe('failed');
    expect(result.customerCase.status).toBe('saved');
  });

  it('returns a V22 write failure instead of swallowing it', async () => {
    const result = await syncWatcherCaseGraph(
      {
        syncJourney: async () => undefined,
        syncCustomerCases: () => Promise.reject(new Error('source_lookup_failed')),
      },
      { persistedSourceCount: 2, expectedCaseCount: 2 }
    );
    expect(result.journey.status).toBe('synced');
    expect(result.customerCase.status).toBe('failed');
    expect(result.customerCase.errors).toEqual(['source_lookup_failed']);
  });

  it('marks a partially saved case graph as partial with the per-case reason', async () => {
    const result = await syncWatcherCaseGraph(
      {
        syncJourney: async () => undefined,
        syncCustomerCases: async () => ({
          saved: 1,
          skipped: 0,
          failed: 1,
          failures: [{ caseId: 'case-2', message: 'check violation' }],
        }),
      },
      { persistedSourceCount: 2, expectedCaseCount: 2 }
    );
    expect(result.customerCase.status).toBe('partial');
    expect(result.customerCase.errors).toEqual(['case-2: check violation']);
  });

  it('treats a saved count below the expected case count as incomplete', async () => {
    const result = await syncWatcherCaseGraph(
      {
        syncJourney: async () => undefined,
        syncCustomerCases: async () => ({ saved: 1, skipped: 1, failed: 0, failures: [] }),
      },
      { persistedSourceCount: 1, expectedCaseCount: 2 }
    );
    expect(result.customerCase.status).toBe('partial');
    expect(result.customerCase.errors.join(' ')).toContain('skipped');
  });

  it('fails the case stage when no source was persisted instead of reporting success', async () => {
    const syncJourney = vi.fn();
    const syncCustomerCases = vi.fn();
    const result = await syncWatcherCaseGraph(
      { syncJourney, syncCustomerCases },
      { persistedSourceCount: 0, expectedCaseCount: 3 }
    );
    expect(syncJourney).not.toHaveBeenCalled();
    expect(syncCustomerCases).not.toHaveBeenCalled();
    expect(result.journey.status).toBe('skipped');
    expect(result.customerCase.status).toBe('failed');
  });
});

describe('syncWhatsAppCustomerCasesV22 — failures are returned to the caller', () => {
  beforeEach(() => {
    upsertError = null;
    upsertedPayloads.length = 0;
  });

  it('returns the upsert error message in failures', async () => {
    upsertError = { message: 'new row violates check constraint' };
    const { syncWhatsAppCustomerCasesV22 } =
      await import('@/lib/whatsappCustomerCasePersistenceV22');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await syncWhatsAppCustomerCasesV22({ cases: [caseItem] } as any, {
      sessionSources: [{ sessionId: 'session-1', sourceId: 'source-1', contextOnly: false }],
    });
    warn.mockRestore();
    expect(result.saved).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      { caseId: 'case-1', message: 'new row violates check constraint' },
    ]);
  });

  it('saves the case without writing canonical sale proof fields', async () => {
    const { syncWhatsAppCustomerCasesV22 } =
      await import('@/lib/whatsappCustomerCasePersistenceV22');
    const result = await syncWhatsAppCustomerCasesV22({ cases: [caseItem] } as any, {
      sessionSources: [{ sessionId: 'session-1', sourceId: 'source-1', contextOnly: false }],
    });
    expect(result).toMatchObject({ saved: 1, failed: 0, failures: [] });
    expect(upsertedPayloads[0]).toMatchObject({
      root_source_id: 'source-1',
      source_ids: ['source-1'],
    });
    expect(upsertedPayloads[0]).not.toHaveProperty('verified_invoice_id');
  });
});
