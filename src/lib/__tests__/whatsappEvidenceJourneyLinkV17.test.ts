// Evidence V17 journey/story link — client side of the staff-session command.
// DB-side authorization/idempotency (tests A–H) runs against real Postgres in
// supabase/tests/whatsapp_evidence_journey_link_session_v1.test.sql (scripts/test-db-evidence-journey-link.sh).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_JOURNEY_LINK_COMMAND,
  linkWhatsAppEvidenceJourneyV17,
} from '@/lib/whatsappEvidenceJourneyLinkV17';
import {
  deriveWhatsAppFileProcessingState,
  runCanonicalCaseGraphAndSalesIntelligence,
  shouldMarkWhatsAppFileProcessed,
  syncWatcherCaseGraph,
} from '@/lib/whatsappWatcherCaseGraphSync';

const TOKEN = 'a'.repeat(64);
const JOURNEY = '11111111-1111-4111-8111-111111111111';
const STORY = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';

function fakeRpc(result: { data?: unknown; error?: unknown; throws?: Error }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (result.throws) return Promise.reject(result.throws);
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      },
    },
  };
}

describe('Evidence V17 link — staff session command', () => {
  it('passes the existing staff session token to the session command (never the retired V17 RPC)', async () => {
    const rpc = fakeRpc({
      data: { facts_linked: 4, opportunities_linked: 1, session_authorized: true },
    });
    const result = await linkWhatsAppEvidenceJourneyV17(
      { journeyId: JOURNEY, storyId: STORY, sourceIds: [SOURCE, SOURCE] },
      { client: rpc.client, getSessionToken: () => TOKEN }
    );
    expect(result).toEqual({ status: 'linked', factsLinked: 4, opportunitiesLinked: 1 });
    expect(rpc.calls).toEqual([
      {
        fn: 'dawaa_link_whatsapp_evidence_journey_session_v1',
        args: {
          p_session_token: TOKEN,
          p_journey_id: JOURNEY,
          p_story_id: STORY,
          p_source_ids: [SOURCE],
        },
      },
    ]);
    expect(EVIDENCE_JOURNEY_LINK_COMMAND).toBe('dawaa_link_whatsapp_evidence_journey_session_v1');
  });

  it('without a staff session it fails closed and never calls the server', async () => {
    const rpc = fakeRpc({ data: {} });
    const result = await linkWhatsAppEvidenceJourneyV17(
      { journeyId: JOURNEY, storyId: null, sourceIds: [SOURCE] },
      { client: rpc.client, getSessionToken: () => null }
    );
    expect(result.status).toBe('failed');
    expect(rpc.calls).toEqual([]);
  });

  it('a server denial (expired/revoked/no permission/scope) is returned, never thrown', async () => {
    for (const message of [
      'invalid_or_expired_staff_session',
      'not_authorized',
      'source_access_denied',
    ]) {
      const rpc = fakeRpc({ error: { code: '42501', message } });
      const result = await linkWhatsAppEvidenceJourneyV17(
        { journeyId: JOURNEY, storyId: STORY, sourceIds: [SOURCE] },
        { client: rpc.client, getSessionToken: () => TOKEN }
      );
      expect(result).toEqual({ status: 'failed', error: message });
    }
    const thrown = fakeRpc({ throws: new Error('network down') });
    expect(
      await linkWhatsAppEvidenceJourneyV17(
        { journeyId: JOURNEY, storyId: STORY, sourceIds: [SOURCE] },
        { client: thrown.client, getSessionToken: () => TOKEN }
      )
    ).toEqual({ status: 'failed', error: 'network down' });
  });

  it('I. an Evidence link warning stays warning-only: V22 and canonical SI still complete', async () => {
    const calls: string[] = [];
    const result = await runCanonicalCaseGraphAndSalesIntelligence(
      { accessToken: 'staff-token' },
      {
        syncCaseGraph: () =>
          syncWatcherCaseGraph(
            {
              syncJourney: async () => {
                calls.push('journey');
                return { warnings: ['Evidence V17 link: invalid_or_expired_staff_session'] };
              },
              syncCustomerCases: async () => {
                calls.push('v22');
                return { saved: 1, skipped: 0, failed: 0, failures: [], savedSourceIds: [SOURCE] };
              },
            },
            { persistedSourceCount: 1, expectedCaseCount: 1 }
          ),
        refreshSalesIntelligence: async ({ sourceIds }) => {
          calls.push('si');
          return {
            bySource: Object.fromEntries(
              sourceIds.map((id) => [
                id,
                { status: 'allowed', reason: null, saleProofState: 'not_proven' },
              ])
            ),
            canonicalCases: [],
            conversationEvaluations: [],
            errors: [],
            authInvalid: false,
          };
        },
      }
    );
    expect(calls).toEqual(['journey', 'v22', 'si']);
    expect(result.caseGraph.journey.warnings).toEqual([
      'Evidence V17 link: invalid_or_expired_staff_session',
    ]);
    expect(result.salesIntelligence.status).toBe('refreshed');
    const state = deriveWhatsAppFileProcessingState({
      parsed: true,
      expectedSourceCount: 1,
      savedSourceCount: 1,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: result.caseGraph,
      salesIntelligence: result.salesIntelligence,
    });
    expect(state.outcome).toBe('complete');
    expect(shouldMarkWhatsAppFileProcessed(state)).toBe(true);
  });

  it('Phase A: branch source has zero calls to the legacy V17 RPC', () => {
    const root = path.join(process.cwd(), 'src');
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) =>
          e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
        );
    const offenders = walk(root)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes('__tests__'))
      .filter((file) =>
        fs.readFileSync(file, 'utf8').includes('dawaa_link_whatsapp_evidence_journey_v17')
      );
    expect(offenders).toEqual([]);
  });

  it('Phase A migration does not touch the legacy V17 RPC and authenticates fail-closed', () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql'
      ),
      'utf8'
    );
    const code = sql.replace(/--[^\n]*/g, '');
    expect(code.includes('dawaa_link_whatsapp_evidence_journey_v17')).toBe(false);
    for (const clause of [
      'a.active is true',
      'a.is_active is true',
      'a.can_login is true',
      "lower(btrim(coalesce(a.status,'')))='active'",
    ])
      expect(code.includes(clause)).toBe(true);
    expect(/coalesce\(a\.(active|is_active|can_login),\s*true\)/.test(code)).toBe(false);
  });

  it('the journey projection uses the session command and reports failures as warnings', () => {
    const root = process.cwd();
    const persistence = fs.readFileSync(
      path.join(root, 'src/lib/whatsappCustomerJourneyPersistenceV15.ts'),
      'utf8'
    );
    expect(persistence.includes('linkWhatsAppEvidenceJourneyV17(')).toBe(true);
    expect(persistence.includes('Evidence V17 link: ${evidenceLink.error}')).toBe(true);
    expect(persistence.includes("'dawaa_link_whatsapp_evidence_journey_v17'")).toBe(false);
  });
});
