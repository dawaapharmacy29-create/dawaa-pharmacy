import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stable Follow-up Identity / idempotency (STEP 2.7 Checkpoint I).
// An in-memory table enforces the same unique keys as the database:
//   whatsapp_conversation_actions: (source_id, action_key) and followup_identity (V48)
//   whatsapp_auto_followup_requests: followup_identity (V48)

const db = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const calls: string[] = [];
  let nextId = 1;
  const table = (name: string) => (tables[name] ||= []);
  const uniqueViolation = (name: string, row: any, ignoreId?: string) =>
    table(name).some(
      (existing) =>
        existing.id !== ignoreId &&
        ((row.followup_identity && existing.followup_identity === row.followup_identity) ||
          (name === 'whatsapp_conversation_actions' &&
            existing.source_id === row.source_id &&
            existing.action_key === row.action_key))
    );
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let pending: any[] | null = null;
    let failure: any = null;
    let updatePayload: Record<string, any> | null = null;
    let limitCount: number | null = null;
    const matched = () => {
      const rows = table(name).filter((row) => filters.every((f) => f(row)));
      return limitCount == null ? rows : rows.slice(0, limitCount);
    };
    const result = () => {
      if (failure) return { data: null, error: failure };
      if (updatePayload) {
        const written: any[] = [];
        for (const target of matched()) {
          const candidate = { ...target, ...updatePayload };
          if (uniqueViolation(name, candidate, target.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          Object.assign(target, updatePayload);
          written.push(target);
        }
        updatePayload = null;
        pending = written;
      }
      return { data: pending ?? matched(), error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      limit: (value: number) => {
        limitCount = value;
        return chain;
      },
      update: (payload: Record<string, any>) => {
        calls.push(`${name}:update`);
        updatePayload = payload;
        return chain;
      },
      insert: (rows: any[]) => {
        calls.push(`${name}:insert`);
        const written: any[] = [];
        for (const row of rows) {
          if (uniqueViolation(name, row)) {
            failure = { code: '23505', message: 'duplicate key' };
            return chain;
          }
          const stored = { id: `row-${nextId++}`, ...row };
          table(name).push(stored);
          written.push(stored);
        }
        pending = written;
        return chain;
      },
      upsert: (rows: any[], options: { onConflict: string }) => {
        calls.push(`${name}:upsert:${options.onConflict}`);
        const written: any[] = [];
        for (const row of rows) {
          const target =
            options.onConflict === 'id'
              ? table(name).find((existing) => existing.id === row.id)
              : table(name).find(
                  (existing) =>
                    existing.source_id === row.source_id && existing.action_key === row.action_key
                );
          if (uniqueViolation(name, row, target?.id)) {
            failure = { code: '23505', message: 'duplicate key' };
            return chain;
          }
          if (target) Object.assign(target, row);
          else table(name).push({ id: `row-${nextId++}`, ...row });
          written.push(target ?? table(name)[table(name).length - 1]);
        }
        pending = written;
        return chain;
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (pending === null && !failure && !updatePayload) calls.push(`${name}:read`);
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    tables,
    calls,
    reset() {
      for (const key of Object.keys(tables)) delete tables[key];
      calls.length = 0;
      nextId = 1;
    },
    client: { from },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: db.client }));

import {
  syncWhatsAppOperationalActionsV6,
  type WhatsAppOperationalIntelligenceV6,
} from '../whatsappOperationalIntelligenceV6';
import { saveFollowupSignals } from '../whatsappAutoIngestPipeline';
import {
  buildFollowupIdentity,
  episodeStartedAt,
  followupCustomerAnchor,
  operationalActionFollowupIdentity,
} from '../whatsappFollowupIdentity';
import type {
  WhatsAppConversationSession,
  WhatsAppParsedMessage,
} from '../whatsappConversationParser';
import type { CanonicalCustomerIdentity } from '../customers/canonicalCustomerIdentityResolver';

const FILE = 'محادثة واتساب مع أحمد 4250.zip';

function message(
  index: number,
  iso: string,
  direction: 'inbound' | 'outbound',
  text: string
): WhatsAppParsedMessage {
  return {
    id: `m-${index}`,
    timestamp: new Date(iso),
    rawTimestamp: iso,
    sender: direction === 'inbound' ? 'أحمد' : 'د. سارة',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: `${iso} ${text}`,
  } as WhatsAppParsedMessage;
}

// Two real episodes separated by > 120 minutes.
const MORNING = [
  message(0, '2026-01-02T09:00:00Z', 'inbound', 'عايز بانادول اكسترا'),
  message(1, '2026-01-02T09:02:00Z', 'outbound', 'حاضر هشوف المتاح'),
  message(2, '2026-01-02T09:05:00Z', 'inbound', 'اتأخر الطلب ومحدش رد'),
];
const EVENING = [
  message(3, '2026-01-02T18:00:00Z', 'inbound', 'عايز بانادول اكسترا تاني'),
  message(4, '2026-01-02T18:03:00Z', 'inbound', 'اتأخر الطلب ومحدش رد'),
];

function session(id: string, messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id,
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['أحمد', 'د. سارة'],
    outboundStaffNames: ['د. سارة'],
    customerName: 'أحمد',
    mediaCount: 0,
  };
}

function identity(
  status: CanonicalCustomerIdentity['status'] = 'resolved'
): CanonicalCustomerIdentity {
  return {
    status,
    customerId: status === 'resolved' ? 'cust-1' : null,
    customerCode: status === 'resolved' ? '4250' : null,
    normalizedPhone: null,
    customerName: 'أحمد',
    branch: null,
    resolvedBy: status === 'resolved' ? 'customer_code' : 'none',
    reason: status,
    confidence: status === 'resolved' ? 95 : 0,
    evidence: {} as any,
    candidates: [],
  } as unknown as CanonicalCustomerIdentity;
}

function model(
  requests: Array<{ productName: string; evidence: string[] }>
): WhatsAppOperationalIntelligenceV6 {
  return {
    version: 'whatsapp-operational-v6',
    primaryIntent: 'product_request',
    secondaryIntents: [],
    initiator: 'customer',
    operationalOutcome: 'unknown',
    customerState: 'unknown',
    products: [],
    customerRequests: requests.map((request) => ({
      productName: request.productName,
      quantity: 1,
      unresolved: true,
      confidence: 90,
      urgency: 'normal',
      evidenceMessageIds: request.evidence,
    })),
    recommendations: [],
    followupPlan: {
      required: false,
      reason: null,
      ownerRole: null,
      dueInDays: null,
      priority: 'normal',
      evidenceMessageIds: [],
    },
    nextBestAction: '',
    officialScoringEligible: true,
    intentConfidence: 90,
    outcomeConfidence: 90,
    evidence: {},
  } as unknown as WhatsAppOperationalIntelligenceV6;
}

const anchor = followupCustomerAnchor(identity(), FILE);
const actions = () => db.tables.whatsapp_conversation_actions || [];
const queue = () => db.tables.whatsapp_auto_followup_requests || [];

async function syncAction(
  sourceId: string,
  unit: WhatsAppConversationSession,
  productName = 'بانادول اكسترا',
  evidence = ['m-0']
) {
  return syncWhatsAppOperationalActionsV6(model([{ productName, evidence }]), {
    sourceId,
    customerId: 'cust-1',
    customerCode: '4250',
    followupIdentity: { customerAnchor: anchor, session: unit },
  });
}

function ingestIdentity(canonical = identity()) {
  return {
    customerId: canonical.customerId,
    customerCode: canonical.customerCode,
    customerName: 'أحمد',
    customerPhone: null,
    branch: null,
    matchedBy: canonical.status === 'resolved' ? 'code' : 'none',
    resolutionStatus: canonical.status,
    resolutionReason: canonical.reason,
    canonical,
  } as any;
}

beforeEach(() => db.reset());

describe('Stable Follow-up Identity — idempotency', () => {
  it('1. the same file imported twice produces one follow-up and one action', async () => {
    const unit = session('import-1-session-0', MORNING);
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    await syncAction('source-a', unit);
    const again = session('import-2-session-0', MORNING);
    const second = await saveFollowupSignals(again, FILE, ingestIdentity(), null);
    await syncAction('source-a-reimport', again);

    expect(queue()).toHaveLength(1);
    expect(second).toEqual({
      created: 0,
      duplicate: 1,
      legacyAdopted: 0,
      legacyAmbiguous: 0,
    });
    expect(actions()).toHaveLength(1);
  });

  it('2. a coarse and a fine segmentation of the same messages share one follow-up', async () => {
    const coarse = session('coarse', [...MORNING, ...EVENING]);
    const fine = session('fine-morning', MORNING);
    await saveFollowupSignals(coarse, FILE, ingestIdentity(), null);
    await saveFollowupSignals(fine, FILE, ingestIdentity(), null);
    await syncAction('source-coarse', coarse);
    await syncAction('source-fine', fine);

    // Morning complaint once + evening complaint once; the morning action once.
    expect(
      queue()
        .map((row) => row.evidence_timestamp)
        .sort()
    ).toEqual(['2026-01-02T09:05:00.000Z', '2026-01-02T18:03:00.000Z']);
    expect(actions()).toHaveLength(1);
  });

  it('3. the Smart Watcher and automatic ingest converge on one task', async () => {
    const watcherUnit = session('watcher-unit', MORNING);
    const ingestUnit = session('ingest-unit', MORNING);
    await syncAction('watcher-source', watcherUnit);
    await syncAction('auto-ingest-source', ingestUnit);
    expect(actions()).toHaveLength(1);

    const root = path.resolve(__dirname, '../../..');
    for (const file of [
      'src/pages/WhatsAppSmartFolderWatcher.tsx',
      'src/lib/whatsappAutoIngestPipeline.ts',
    ]) {
      const code = fs.readFileSync(path.join(root, file), 'utf8');
      expect(code).toMatch(/followupIdentity: \{\s*customerAnchor: followupCustomerAnchor\(/);
    }
  });

  it('4. the same customer in two different episodes gets separate follow-ups', async () => {
    await syncAction('source-morning', session('morning', MORNING), 'بانادول اكسترا', ['m-0']);
    await syncAction('source-evening', session('evening', EVENING), 'بانادول اكسترا', ['m-3']);
    expect(actions()).toHaveLength(2);
    expect(new Set(actions().map((row) => row.followup_identity)).size).toBe(2);
  });

  it('5. a different reason in the same episode is a different follow-up', async () => {
    const unit = session('morning', MORNING);
    await syncAction('source-a', unit, 'بانادول اكسترا');
    await syncAction('source-b', unit, 'فيتامين سي');
    expect(actions()).toHaveLength(2);
  });

  it('6. a resolved follow-up does not block a new real episode', async () => {
    await syncAction('source-morning', session('morning', MORNING), 'بانادول اكسترا', ['m-0']);
    actions()[0].status = 'done';
    await syncAction('source-evening', session('evening', EVENING), 'بانادول اكسترا', ['m-3']);
    expect(
      actions()
        .map((row) => row.status)
        .sort()
    ).toEqual(['done', 'proposed']);
  });

  it('7. rerunning is idempotent and never resets the workflow state of a reused task', async () => {
    const unit = session('morning', MORNING);
    await syncAction('source-a', unit);
    Object.assign(actions()[0], {
      status: 'in_progress',
      work_status: 'assigned',
      assigned_to: 'cs-1',
    });
    for (let run = 0; run < 3; run += 1)
      await syncAction('source-b', session(`rerun-${run}`, MORNING));

    expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({
      source_id: 'source-a',
      status: 'in_progress',
      work_status: 'assigned',
      assigned_to: 'cs-1',
    });
  });

  it('8. no duplicate actions or queue rows, with bounded lookups per call', async () => {
    const unit = session('morning', MORNING);
    const many = model(
      Array.from({ length: 6 }, () => ({ productName: 'بانادول اكسترا', evidence: ['m-0'] }))
    );
    await syncWhatsAppOperationalActionsV6(many, {
      sourceId: 'source-a',
      followupIdentity: { customerAnchor: anchor, session: unit },
    });
    await syncWhatsAppOperationalActionsV6(many, {
      sourceId: 'source-b',
      followupIdentity: { customerAnchor: anchor, session: unit },
    });
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);

    expect(actions()).toHaveLength(1);
    expect(queue()).toHaveLength(1);
    const identities = [...actions(), ...queue()].map((row) => row.followup_identity);
    expect(new Set(identities).size).toBe(identities.length);
    const actionReads = db.calls.filter(
      (call) => call === 'whatsapp_conversation_actions:read'
    ).length;
    expect(actionReads).toBe(6); // three bounded action lookups per sync call, independent of action count
    expect(
      db.calls.filter(
        (call) => call.startsWith('whatsapp_conversation_actions:') && !call.endsWith(':read')
      )
    ).toHaveLength(2);
  });
});


describe('Legacy NULL follow-up adoption — STEP 2.8 K', () => {
  it('adopts one deterministic legacy auto-followup instead of inserting a duplicate', async () => {
    const unit = session('canonical-case', MORNING);
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(1);
    queue()[0].followup_identity = null;

    const second = await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(1);
    expect(queue()[0].followup_identity).toMatch(/^fu1\|/);
    expect(second).toMatchObject({
      created: 0,
      duplicate: 1,
      legacyAdopted: 1,
      legacyAmbiguous: 0,
    });
  });

  it('does not guess when two legacy auto-followups match the same deterministic identity', async () => {
    const unit = session('canonical-case', MORNING);
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    const original = queue()[0];
    original.followup_identity = null;
    queue().push({ ...original, id: 'legacy-copy' });

    const result = await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(2);
    expect(queue().every((row) => row.followup_identity == null)).toBe(true);
    expect(result).toMatchObject({ created: 0, legacyAdopted: 0, legacyAmbiguous: 1 });
  });

  it('does not adopt a legacy auto-followup for another reason or another customer', async () => {
    const unit = session('canonical-case', MORNING);
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    queue()[0].followup_identity = null;
    queue()[0].requested_product_name = 'سبب مختلف';
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(2);

    db.reset();
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    queue()[0].followup_identity = null;
    queue()[0].customer_id = 'cust-other';
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(2);
  });

  it('keeps a closed historical follow-up separate from a genuine later episode', async () => {
    const morning = session('morning', MORNING);
    await saveFollowupSignals(morning, FILE, ingestIdentity(), null);
    queue()[0].followup_identity = null;
    queue()[0].status = 'مغلق';

    await saveFollowupSignals(session('evening', EVENING), FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(2);
    expect(queue().some((row) => row.status === 'مغلق')).toBe(true);
  });

  it('is idempotent after lazy adoption', async () => {
    const unit = session('canonical-case', MORNING);
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    queue()[0].followup_identity = null;
    await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    const third = await saveFollowupSignals(unit, FILE, ingestIdentity(), null);
    expect(queue()).toHaveLength(1);
    expect(third).toMatchObject({ created: 0, duplicate: 1, legacyAdopted: 0 });
  });

  it('adopts one deterministic legacy conversation action and preserves its workflow state', async () => {
    const unit = session('canonical-case', MORNING);
    await syncAction('legacy-source', unit);
    const legacy = actions()[0];
    legacy.followup_identity = null;
    legacy.status = 'in_progress';
    legacy.assigned_to = 'cs-1';
    db.tables.whatsapp_review_sources = [
      {
        id: 'legacy-source',
        conversation_started_at: '2026-01-02T09:00:00.000Z',
        conversation_ended_at: '2026-01-02T09:05:00.000Z',
      },
    ];

    await syncAction('canonical-source', session('reimport', MORNING));
    expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({
      source_id: 'legacy-source',
      status: 'in_progress',
      assigned_to: 'cs-1',
    });
    expect(actions()[0].followup_identity).toMatch(/^fu1\|/);
  });

  it('fails closed when multiple legacy actions match one new identity', async () => {
    const unit = session('canonical-case', MORNING);
    await syncAction('legacy-a', unit);
    const first = actions()[0];
    first.followup_identity = null;
    actions().push({ ...first, id: 'legacy-b-row', source_id: 'legacy-b' });
    db.tables.whatsapp_review_sources = [
      {
        id: 'legacy-a',
        conversation_started_at: '2026-01-02T09:00:00.000Z',
        conversation_ended_at: '2026-01-02T09:05:00.000Z',
      },
      {
        id: 'legacy-b',
        conversation_started_at: '2026-01-02T09:00:00.000Z',
        conversation_ended_at: '2026-01-02T09:05:00.000Z',
      },
    ];

    const result = await syncAction('canonical-source', unit);
    expect(actions()).toHaveLength(2);
    expect(actions().every((row) => row.followup_identity == null)).toBe(true);
    expect(result).toContainEqual(
      expect.objectContaining({ status: 'legacy_identity_ambiguous' })
    );
  });
});

describe('Evidence-free manual-review identity — STEP 2.8 L', () => {
  const manualModel = () => {
    const value = model([]);
    value.officialScoringEligible = false;
    value.primaryIntent = 'general_service';
    return value;
  };

  const syncManual = (
    sourceId: string,
    unit: WhatsAppConversationSession,
    caseStartedAt?: string
  ) =>
    syncWhatsAppOperationalActionsV6(manualModel(), {
      sourceId,
      customerId: 'cust-1',
      customerCode: '4250',
      followupIdentity: {
        customerAnchor: anchor,
        session: unit,
        caseStartedAt: caseStartedAt ?? null,
      },
    });

  it('coarse and fine imports share one manual-review task when the canonical case anchor is the same', async () => {
    const coarse = session('coarse', [...MORNING, ...EVENING]);
    const fine = session('fine', MORNING);
    await syncManual('coarse-source', coarse, '2026-01-02T09:00:00.000Z');
    await syncManual('fine-source', fine, '2026-01-02T09:00:00.000Z');
    expect(actions()).toHaveLength(1);
  });

  it('a later genuine canonical case gets a new manual-review task', async () => {
    await syncManual('morning-source', session('morning', MORNING), '2026-01-02T09:00:00.000Z');
    await syncManual('evening-source', session('evening', EVENING), '2026-01-02T18:00:00.000Z');
    expect(actions()).toHaveLength(2);
  });

  it('fails closed instead of deriving manual-review identity from session/source when no stable anchor exists', async () => {
    const unit = session('arbitrary-import-session', MORNING);
    const direct = operationalActionFollowupIdentity(
      { customerAnchor: anchor, session: unit },
      { action_type: 'manual_review', evidence: [] }
    );
    expect(direct).toBeNull();

    const result = await syncManual('source-without-case-anchor', unit);
    expect(actions()).toHaveLength(0);
    expect(result).toContainEqual(
      expect.objectContaining({ status: 'followup_identity_unresolved' })
    );
  });
});

describe('Stable Follow-up Identity — key rules', () => {
  it('ignores the import/session instance and moves only with a new episode', () => {
    const morningStart = episodeStartedAt([...MORNING, ...EVENING], MORNING[2].timestamp);
    const eveningStart = episodeStartedAt([...MORNING, ...EVENING], EVENING[1].timestamp);
    expect(morningStart.toISOString()).toBe('2026-01-02T09:00:00.000Z');
    expect(eveningStart.toISOString()).toBe('2026-01-02T18:00:00.000Z');
    expect(episodeStartedAt(MORNING, MORNING[2].timestamp)).toEqual(morningStart);

    const key = (at: Date) =>
      buildFollowupIdentity({
        customerAnchor: anchor,
        episodeStartedAt: at,
        followupType: 'customer_request',
        reasonKey: 'بانادول',
      });
    expect(key(morningStart)).toBe(key(new Date(morningStart.getTime() + 20_000)));
    expect(key(morningStart)).not.toBe(key(eveningStart));
  });

  it('anchors unresolved identities to the canonical case, never filename or ambiguous customer evidence', () => {
    expect(followupCustomerAnchor(identity('resolved'), 'case-1')).toBe('customer:cust-1');
    for (const status of ['unresolved', 'ambiguous', 'contradicted'] as const) {
      expect(followupCustomerAnchor(identity(status), 'case-1')).toBe('case:case-1');
    }
    expect(() => followupCustomerAnchor(identity('unresolved'), null)).toThrow(
      'followup_customer_anchor_unresolved'
    );
  });

  it('V48 declares unique deterministic keys and leaves existing rows untouched', () => {
    const root = path.resolve(__dirname, '../../..');
    const sql = fs.readFileSync(
      path.join(
        root,
        'supabase/migrations/20260929113627_whatsapp_followup_stable_identity_v48.sql'
      ),
      'utf8'
    );
    expect(sql).toMatch(
      /create unique index[^;]*whatsapp_auto_followup_requests_followup_identity_uk/i
    );
    expect(sql).toMatch(
      /create unique index[^;]*whatsapp_conversation_actions_followup_identity_uk/i
    );
    expect(sql).not.toMatch(/^\s*(update|delete)\s/im);
  });
});
