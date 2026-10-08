// Story V16 event refresh — reanalysis idempotency under RLS.
// The fake client models the live contract: UNIQUE (story_id, event_key); INSERT allowed by the
// insert policy (add permissions); the ON CONFLICT DO UPDATE path allowed ONLY by
// whatsapp_customer_story_events_update_v16 (edit permissions + story visible, USING and WITH CHECK).
// Without that policy the update path is default-denied exactly like production (42501).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { storyEventWriteError, syncPersistentCustomerStoryV16 } from '@/lib/whatsappCustomerStoryV16';
import { deriveWhatsAppFileProcessingState, shouldMarkWhatsAppFileProcessed, syncWatcherCaseGraph } from '@/lib/whatsappWatcherCaseGraphSync';

const ADD = ['add_reviews', 'reviews.action.create', 'manage_conversation_evaluations'];
const EDIT = ['edit_reviews', 'approve_reviews', 'manage_conversation_evaluations'];

function fakeDb(opts: { updatePolicy: boolean; perms: string[]; storyVisible?: boolean }) {
  const events: Array<Record<string, any>> = [];
  const stories: Array<Record<string, any>> = [];
  const ops: string[] = [];
  const can = (list: string[]) => list.some((p) => opts.perms.includes(p));
  const client = {
    events,
    stories,
    ops,
    rpc: () => {
      throw new Error('browser must not call story RPC');
    },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'upsert' | 'update' = 'select';
      let payload: any = null;
      const run = () => {
        if (table === 'whatsapp_customer_stories') {
          if (mode === 'upsert') {
            let row = stories.find((s) => s.story_key === payload.story_key);
            if (row) Object.assign(row, payload);
            else stories.push((row = { id: `story-${stories.length + 1}`, ...payload }));
            return { data: row, error: null };
          }
          return { data: stories.find((s) => filters.every(([k, v]) => s[k] === v)) ?? null, error: null };
        }
        if (table === 'whatsapp_customer_journeys') return { data: null, error: null };
        if (table === 'whatsapp_conversation_actions') return { data: [], error: null };
        if (table === 'whatsapp_customer_story_events' && mode === 'upsert') {
          ops.push('upsert');
          const rows: any[] = payload;
          // Statement-level: any row on the conflict path must pass the UPDATE policy.
          for (const row of rows) {
            const existing = events.find((e) => e.story_id === row.story_id && e.event_key === row.event_key);
            const storyVisible = opts.storyVisible !== false;
            if (existing) {
              if (!opts.updatePolicy || !can(EDIT) || !storyVisible) {
                return { data: null, error: { code: '42501', message: 'new row violates row-level security policy (USING expression) for table "whatsapp_customer_story_events"' } };
              }
            } else if (!can(ADD)) {
              return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "whatsapp_customer_story_events"' } };
            }
          }
          for (const row of rows) {
            const existing = events.find((e) => e.story_id === row.story_id && e.event_key === row.event_key);
            if (existing) Object.assign(existing, row);
            else events.push({ id: `event-${events.length + 1}`, ...row });
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
        in: () => chain,
        upsert: (p: any, o: any) => {
          if (o?.ignoreDuplicates) throw new Error('ignoreDuplicates would leave stale story events');
          mode = 'upsert';
          payload = p;
          return chain;
        },
        update: (p: any) => ((mode = 'update'), (payload = p), chain),
        delete: () => {
          throw new Error('story events are never deleted/reinserted');
        },
        maybeSingle: async () => run(),
        single: async () => run(),
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return chain;
    },
  };
  return client;
}

function model(summary = 'تم تسجيل طلب العميل') {
  return {
    version: 'whatsapp-customer-journey-v15',
    sessions: [
      {
        sessionId: 's1', role: 'order_request', startedAt: '2026-10-06T06:00:00.000Z', staffNames: ['نور'], confidence: 90,
        label: 'طلب منتج', orderFailed: false, customerSilentAfterOutbound: false, apologyDetected: false, feedbackRequestDetected: false,
      },
    ],
    summary,
    customerRisk: 'low',
    customerState: 'active',
    unresolvedOrder: false,
    unresolvedComplaint: false,
    recoveryAttempts: 0,
    improvementInsights: [],
  } as any;
}

const sources = [{ id: 'src-1', customer_id: 'cust-5179', customer_code: '5179', customer_name: 'محمد الجندي', branch: 'فرع شكري', conversation_started_at: '2026-10-06T06:00:00.000Z', conversation_ended_at: '2026-10-06T06:05:00.000Z' }];
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as Error)?.message || error);
  }
  return 'no_error';
}

const sync = (client: any, summary?: string) =>
  syncPersistentCustomerStoryV16({ journeyId: 'journey-1', model: model(summary), sources, sessionSources: [{ sessionId: 's1', sourceId: 'src-1', contextOnly: false }], branch: 'فرع شكري', client });

describe('Story V16 events — reanalysis with the update policy', () => {
  it('A. first analysis inserts the events', async () => {
    const db = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT] });
    const result = await sync(db);
    expect(result?.events).toBe(db.events.length);
    expect(db.events.length).toBeGreaterThan(0);
  });

  it('B. identical reanalysis updates the same events, no duplicates', async () => {
    const db = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT] });
    await sync(db);
    const before = db.events.map((e) => `${e.story_id}|${e.event_key}`);
    await sync(db);
    expect(db.events.map((e) => `${e.story_id}|${e.event_key}`)).toEqual(before);
  });

  it('C. a changed derived payload refreshes the existing event in place', async () => {
    const db = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT] });
    await sync(db, 'ملخص قديم');
    const summaryEvent = () => db.events.find((e) => e.event_key === 'journey:journey-1:summary')!;
    const id = summaryEvent().id;
    await sync(db, 'ملخص محدث بعد إعادة التحليل');
    expect(summaryEvent().id).toBe(id);
    expect(summaryEvent().detail).toBe('ملخص محدث بعد إعادة التحليل');
  });

  it('F. repeated reanalysis is idempotent', async () => {
    const db = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT] });
    await sync(db);
    const snapshot = JSON.stringify(db.events);
    await sync(db);
    await sync(db);
    expect(JSON.stringify(db.events)).toBe(snapshot);
  });
});

describe('Story V16 events — authorization', () => {
  it('reproduces production: without the update policy, reanalysis is denied (42501) and reported explicitly', async () => {
    const db = fakeDb({ updatePolicy: false, perms: [...ADD, ...EDIT] });
    await sync(db);
    let error: unknown = null;
    try {
      await sync(db);
    } catch (caught) {
      error = caught;
    }
    expect(String((error as Error).message)).toMatch(/^story_events_update_not_permitted:/);
  });

  it('D. an actor without edit permissions cannot update existing events', async () => {
    const seed = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT] });
    await sync(seed);
    const limited = fakeDb({ updatePolicy: true, perms: ['add_reviews'] });
    limited.events.push(...seed.events.map((e) => ({ ...e })));
    limited.stories.push(...seed.stories.map((s) => ({ ...s })));
    expect(await failure(sync(limited))).toMatch(/story_events_update_not_permitted/);
  });

  it('E. an editor can update only stories visible to them (branch scope via the stories SELECT policy)', async () => {
    const seed = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT] });
    await sync(seed);
    const otherBranch = fakeDb({ updatePolicy: true, perms: [...ADD, ...EDIT], storyVisible: false });
    otherBranch.events.push(...seed.events.map((e) => ({ ...e })));
    otherBranch.stories.push(...seed.stories.map((s) => ({ ...s })));
    expect(await failure(sync(otherBranch))).toMatch(/story_events_update_not_permitted/);
    const sameBranch = fakeDb({ updatePolicy: true, perms: ['edit_reviews', 'add_reviews'] });
    sameBranch.events.push(...seed.events.map((e) => ({ ...e })));
    sameBranch.stories.push(...seed.stories.map((s) => ({ ...s })));
    await sync(sameBranch);
    expect(sameBranch.events).toHaveLength(seed.events.length);
  });

  it('classifies only RLS denials as the explicit permission warning', () => {
    expect(storyEventWriteError({ code: '42501', message: 'x' }).message).toMatch(/^story_events_update_not_permitted/);
    expect(storyEventWriteError({ code: '23503', message: 'fk' }).message).toBe('fk');
  });
});

describe('Story V16 events — migration contract (prepared, not applied)', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261008073930_whatsapp_story_events_update_policy_v16.sql'), 'utf8');
  const body = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

  it('adds exactly one UPDATE policy with both USING and WITH CHECK', () => {
    expect(body).toMatch(/create policy whatsapp_customer_story_events_update_v16\s+on public\.whatsapp_customer_story_events\s+for update/);
    expect(body).toMatch(/\busing\s*\(/);
    expect(body).toMatch(/with check\s*\(/);
    expect((body.match(/create policy/g) || []).length).toBe(1);
  });

  it('uses the same edit permission set as the sibling Story/Journey update policies, and story visibility', () => {
    const permission = "public.dawaa_current_actor_can(array['edit_reviews', 'approve_reviews', 'manage_conversation_evaluations'])";
    expect(body.split(permission).length - 1).toBe(2);
    expect(body.split('from public.whatsapp_customer_stories s').length - 1).toBe(2);
  });

  it('does not weaken security', () => {
    for (const forbidden of [/disable row level security/i, /\bgrant\b/i, /security definer/i, /\bto anon\b/i, /for delete/i, /for all/i, /using\s*\(\s*true\s*\)/i]) {
      expect(forbidden.test(body)).toBe(false);
    }
  });

  it('the Story writer keeps a real upsert (no ignoreDuplicates, no delete/reinsert)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/whatsappCustomerStoryV16.ts'), 'utf8');
    expect(source).toMatch(/onConflict: 'story_id,event_key', ignoreDuplicates: false/);
    expect(source).not.toMatch(/ignoreDuplicates:\s*true/);
    expect(source).not.toMatch(/\.delete\(/);
  });
});

describe('Story V16 events — G. side projection never blocks canonical completion', () => {
  it('a Story event refresh denial is a warning; V22 + Sales Intelligence still complete the file', async () => {
    const warning = `Story V16: ${storyEventWriteError({ code: '42501', message: 'new row violates row-level security policy (USING expression)' }).message}`;
    const graph = await syncWatcherCaseGraph(
      {
        syncJourney: async () => ({ warnings: [warning] }),
        syncCustomerCases: async () => ({ saved: 1, skipped: 0, failed: 0, failures: [], savedSourceIds: ['src-1'] }),
      },
      { persistedSourceCount: 1, expectedCaseCount: 1 }
    );
    const state = deriveWhatsAppFileProcessingState({
      parsed: true, expectedSourceCount: 1, savedSourceCount: 1, sourceErrors: [], identityErrors: [],
      caseGraph: graph,
      salesIntelligence: {
        status: 'refreshed', reason: null, requestedSourceIds: ['src-1'],
        bySource: { 'src-1': { status: 'allowed', reason: null, saleProofState: 'not_proven' } },
        canonicalCases: [], conversationEvaluations: [], errors: [], authInvalid: false,
      },
    });
    expect(state.outcome).toBe('complete');
    expect(state.stages.review_ready).toBe('done');
    expect(state.warnings.some((w) => w.includes('story_events_update_not_permitted'))).toBe(true);
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(true);
  });
});
