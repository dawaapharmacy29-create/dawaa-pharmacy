import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';

// In-memory whatsapp_conversation_actions with the live unique keys (followup_identity and
// source_id+action_key), covering only the query shapes the action writer uses. Installed on the
// unconfigured test client per test, so it runs under vitest and the repo test runner alike.
type Row = Record<string, any>;
const db = {
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; payload: any }>,
  beforeInsert: null as null | (() => void),
  seq: 0,
};

function fakeFrom(table: string) {
  const uniqueViolation = { code: '23505', message: 'duplicate key value violates unique constraint' };
  const conflicts = (row: Row, ignoreId?: string) =>
    (db.tables[table] || []).some(
      (other) =>
        other.id !== ignoreId &&
        ((row.followup_identity && other.followup_identity === row.followup_identity) ||
          (row.source_id && other.source_id === row.source_id && other.action_key === row.action_key))
    );
  const filters: Array<(row: Row) => boolean> = [];
  let action: { op: string; payload?: any; options?: any } = { op: 'select' };
  let limit = Infinity;
  const run = () => {
    const rows = (db.tables[table] ||= []);
    const matched = () => rows.filter((row) => filters.every((f) => f(row))).slice(0, limit);
    if (action.op === 'select') return { data: matched().map((row) => ({ ...row })), error: null };
    db.writes.push({ table, op: action.op, payload: action.payload });
    if (action.op === 'update') {
      const hits = matched();
      for (const row of hits) {
        if (conflicts({ ...row, ...action.payload }, row.id)) return { data: null, error: uniqueViolation };
        Object.assign(row, action.payload);
      }
      return { data: hits.map((row) => ({ ...row })), error: null };
    }
    const payload: Row[] = Array.isArray(action.payload) ? action.payload : [action.payload];
    if (action.op === 'insert') {
      const hook = db.beforeInsert;
      db.beforeInsert = null;
      hook?.();
      for (const row of payload) if (conflicts(row)) return { data: null, error: uniqueViolation };
      const created = payload.map((row) => ({ id: `row-${++db.seq}`, ...row }));
      rows.push(...created);
      return { data: created.map((row) => ({ ...row })), error: null };
    }
    const byId = String(action.options?.onConflict || 'id') === 'id';
    const out: Row[] = [];
    for (const row of payload) {
      const existing = rows.find((other) =>
        byId ? other.id === row.id : other.source_id === row.source_id && other.action_key === row.action_key
      );
      if (existing) {
        if (conflicts({ ...existing, ...row }, existing.id)) return { data: null, error: uniqueViolation };
        Object.assign(existing, row);
        out.push({ ...existing });
      } else {
        if (conflicts(row)) return { data: null, error: uniqueViolation };
        const created = { id: `row-${++db.seq}`, ...row };
        rows.push(created);
        out.push({ ...created });
      }
    }
    return { data: out, error: null };
  };
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
    is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
    in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
    limit: (value: number) => ((limit = value), builder),
    insert: (payload: any) => ((action = { op: 'insert', payload }), builder),
    upsert: (payload: any, options: any) => ((action = { op: 'upsert', payload, options }), builder),
    update: (payload: any) => ((action = { op: 'update', payload }), builder),
    then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
  };
  return builder;
}

import {
  parseWhatsAppExport,
  splitWhatsAppSessions,
  type WhatsAppConversationSession,
} from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import {
  buildFollowupIdentity,
  conversationEpisodeAnchor,
  episodeStartedAt,
  followupCustomerAnchor,
  operationalActionFollowupIdentity,
  stableOperationIdentity,
} from '@/lib/whatsappFollowupIdentity';
import { syncWhatsAppOperationalActionsV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveFollowUpOpportunities } from '@/lib/salesIntelligence/followUpOpportunityEngine';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';

// Synthetic fixtures only: no customer data, no real UUIDs.
const EPISODE_ONE = `[9/15/26, 6:00:00 AM] Customer: صباح الخير
[9/15/26, 6:01:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 6:02:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 6:03:00 AM] Customer: طيب لما يتوفر كلمني`;
// A second, real request for the same product after a >120-minute silence: a new operation.
const EPISODE_TWO = `[9/15/26, 10:30:00 AM] Customer: لسه محتاج كونجستال
[9/15/26, 10:31:00 AM] You: لسه مش موجود`;
// Earlier history that only a longer export contains (shifts every positional session/case index).
const EARLIER_HISTORY = `[9/14/26, 8:00:00 PM] Customer: شكرا
[9/14/26, 8:01:00 PM] You: العفو`;

const EXPORT = `${EPISODE_ONE}\n${EPISODE_TWO}`;
const LONGER_EXPORT = `${EARLIER_HISTORY}\n${EXPORT}`;
const RESOLVED = { status: 'resolved' as const, customerId: 'customer-fixture-1', normalizedPhone: null, customerCode: null };
const UNRESOLVED = { status: 'unresolved' as const, customerId: null, normalizedPhone: null, customerCode: null };

const parse = (raw: string) => parseWhatsAppExport(raw);
const at = (iso: string) => new Date(iso);
const messageAt = (session: WhatsAppConversationSession, text: string) =>
  session.messages.find((message) => message.text.includes(text))!;

/** Identity of the "عايز 2 علبة كونجستال" request inside a given session (any segmentation). */
function requestIdentity(session: WhatsAppConversationSession, customer = UNRESOLVED, text = 'عايز 2 علبة كونجستال') {
  return operationalActionFollowupIdentity(
    { customer, session, legacyCaseAnchor: session.id },
    { action_type: 'customer_request', product_name: 'كونجستال', evidence: [messageAt(session, text).id] }
  )!;
}

describe('Stable Operation Identity contract', () => {
  it('import twice, retry and re-processing produce the same operation identity', () => {
    const first = segmentWhatsAppExportCanonical(parse(EXPORT), 'chat.txt').caseContexts.contexts[0].mergedSession;
    const second = segmentWhatsAppExportCanonical(parse(EXPORT), 'chat.txt').caseContexts.contexts[0].mergedSession;
    expect(requestIdentity(first)).toEqual(requestIdentity(second));
    expect(requestIdentity(first).identity).toBe(requestIdentity(first).identity);
  });

  it('different segmentation boundaries and export ranges keep the same identity', () => {
    const whole = splitWhatsAppSessions(parse(EXPORT), Number.MAX_SAFE_INTEGER)[0];
    const raw = splitWhatsAppSessions(parse(EXPORT), 120)[0];
    const canonical = segmentWhatsAppExportCanonical(parse(EXPORT), 'chat.txt').caseContexts.contexts;
    const canonicalUnit = canonical.find((context) =>
      context.mergedSession.messages.some((message) => message.text.includes('عايز 2 علبة'))
    )!.mergedSession;
    const longer = segmentWhatsAppExportCanonical(parse(LONGER_EXPORT), 'chat (1).txt').caseContexts.contexts;
    const longerUnit = longer.find((context) =>
      context.mergedSession.messages.some((message) => message.text.includes('عايز 2 علبة'))
    )!.mergedSession;

    const expected = requestIdentity(whole).identity;
    expect(requestIdentity(raw).identity).toBe(expected);
    expect(requestIdentity(canonicalUnit).identity).toBe(expected);
    expect(requestIdentity(longerUnit).identity).toBe(expected);
    // The pre-contract unresolved anchor was the positional case/session id: it moved with the
    // export range, which is exactly the duplicate path this contract closes.
    expect(longerUnit.id).not.toBe(canonicalUnit.id);
    expect(followupCustomerAnchor(null, longerUnit.id)).not.toBe(followupCustomerAnchor(null, canonicalUnit.id));
  });

  it('message and processing order do not change the identity', () => {
    const messages = parse(EXPORT);
    const evidenceAt = messages[1].timestamp;
    const forward = stableOperationIdentity({ customer: null, timeline: messages, evidenceAt, operationType: 'customer_request', reasonKey: 'كونجستال' });
    const reversed = stableOperationIdentity({ customer: null, timeline: [...messages].reverse(), evidenceAt, operationType: 'customer_request', reasonKey: 'كونجستال' });
    const shuffled = stableOperationIdentity({ customer: null, timeline: [messages[3], messages[0], messages[5], messages[1], messages[4], messages[2]], evidenceAt, operationType: 'customer_request', reasonKey: 'كونجستال' });
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('two real operations in the same conversation stay two identities', () => {
    const session = splitWhatsAppSessions(parse(EXPORT), Number.MAX_SAFE_INTEGER)[0];
    const firstEpisode = requestIdentity(session, RESOLVED).identity;
    const secondEpisode = requestIdentity(session, RESOLVED, 'لسه محتاج كونجستال').identity;
    expect(secondEpisode).not.toBe(firstEpisode);
    const otherProduct = operationalActionFollowupIdentity(
      { customer: RESOLVED, session },
      { action_type: 'customer_request', product_name: 'بنادول', evidence: [messageAt(session, 'عايز 2 علبة').id] }
    )!.identity;
    const otherType = operationalActionFollowupIdentity(
      { customer: RESOLVED, session },
      { action_type: 'customer_followup', product_name: 'كونجستال', evidence: [messageAt(session, 'عايز 2 علبة').id] }
    )!.identity;
    expect(new Set([firstEpisode, otherProduct, otherType]).size).toBe(3);
  });

  it('no collision across customers or conversations, even for a same-minute broadcast', () => {
    const broadcast = (contact: string) =>
      parse(`[9/15/26, 6:00:00 AM] You: عروض اليوم على الفيتامينات\n[9/15/26, 6:05:00 AM] ${contact}: عايز كونجستال`);
    const chatA = broadcast('Customer A');
    const chatB = broadcast('Customer B');
    const evidenceAt = chatA[1].timestamp;
    const key = (timeline: ReturnType<typeof parse>, customer: typeof RESOLVED | null) =>
      stableOperationIdentity({ customer, timeline, evidenceAt, operationType: 'customer_request', reasonKey: 'كونجستال' }).identity;
    expect(conversationEpisodeAnchor(chatA, evidenceAt)).not.toBe(conversationEpisodeAnchor(chatB, evidenceAt));
    expect(key(chatA, null)).not.toBe(key(chatB, null));
    expect(key(chatA, RESOLVED)).not.toBe(key(chatA, { ...RESOLVED, customerId: 'customer-fixture-2' }));
  });

  it('a customer resolved after the first import still matches the earlier operation', () => {
    const session = splitWhatsAppSessions(parse(EXPORT), Number.MAX_SAFE_INTEGER)[0];
    const before = requestIdentity(session, UNRESOLVED);
    const after = requestIdentity(session, RESOLVED);
    expect(after.identity).toMatch(/^fu1\|customer:customer-fixture-1\|/);
    expect(after.aliases).toContain(before.identity);
    // The pre-contract case-anchored key is matched too, so existing rows are reused, not duplicated.
    expect(before.aliases).toEqual([
      buildFollowupIdentity({
        customerAnchor: followupCustomerAnchor(null, session.id),
        episodeStartedAt: episodeStartedAt(session.messages, messageAt(session, 'عايز 2 علبة').timestamp),
        followupType: 'customer_request',
        reasonKey: 'كونجستال',
      }),
    ]);
  });

  it('fails closed without a customer or any conversation evidence', () => {
    expect(() =>
      stableOperationIdentity({ customer: UNRESOLVED, timeline: [], evidenceAt: at('2026-09-15T06:00:00Z'), operationType: 'customer_request' })
    ).toThrow('followup_customer_anchor_unresolved');
  });
});

describe('Sales Intelligence follow-up keys use the same contract', () => {
  const analyze = (conversationId: string, raw: string, resolved: boolean) =>
    runSalesIntelligencePipeline({
      conversationId,
      rawWhatsAppExportText: raw,
      resolveInvoiceCandidates: () => [],
      customerIdHint: resolved ? 'customer-fixture-1' : null,
      customerIdentityStatus: resolved ? 'resolved' : 'unresolved',
    });
  const keys = (conversationId: string, raw: string, resolved: boolean) =>
    analyze(conversationId, raw, resolved)
      .caseAnalyses.flatMap((row) => row.followUp.opportunities.map((o) => o.followUpKey))
      .sort();

  it('re-import under a new source id and re-processing keep the same follow-up keys', () => {
    const first = keys('source-fixture-a', EPISODE_ONE, false);
    expect(first.length).toBeGreaterThan(0);
    expect(keys('source-fixture-b', EPISODE_ONE, false)).toEqual(first);
    expect(keys('source-fixture-a', EPISODE_ONE, false)).toEqual(first);
    expect(first.every((key) => !key.includes('source-fixture'))).toBe(true);
  });

  it('a case that starts mid-episode after resegmentation keeps the key (06:00 vs 06:01)', () => {
    const analysis = analyze('source-fixture-a', EPISODE_ONE, true).caseAnalyses[0];
    const all = buildConversationUnderstandingV32(
      splitWhatsAppSessions(parse(EPISODE_ONE), Number.MAX_SAFE_INTEGER)[0]
    ).messages;
    const late = all.slice(1); // the resegmented case starts one minute later (06:01)
    const derive = (messages: typeof all, conversationTimeline?: typeof all) =>
      deriveFollowUpOpportunities({
        conversationCase: { ...analysis.conversationCase, startedAt: messages[0].timestamp.toISOString() },
        messages,
        conversationTimeline,
        customerNeed: analysis.customerNeed,
        unavailableDemand: analysis.unavailableDemand,
        lostOpportunity: analysis.lostOpportunity,
        salesOutcome: analysis.salesOutcome,
        customerIdentityStatus: 'resolved',
      }).opportunities.map((o) => o.followUpKey);
    const original = derive(all, all);
    expect(original.length).toBeGreaterThan(0);
    expect(original).toEqual(analysis.followUp.opportunities.map((o) => o.followUpKey));
    expect(derive(late, all)).toEqual(original);
    // Without the source timeline the case start leaks into the key: the documented counterexample.
    expect(derive(late)).not.toEqual(original);
  });
});

describe('operational action writer: one row per real operation', () => {
  const ACTIONS = 'whatsapp_conversation_actions';
  const exportSession = (raw: string) =>
    segmentWhatsAppExportCanonical(parse(raw), 'chat.txt').caseContexts.contexts.find((context) =>
      context.mergedSession.messages.some((message) => message.text.includes('عايز 2 علبة'))
    )!.mergedSession;
  const model = (session: WhatsAppConversationSession, requests: Array<{ product: string; text: string }>) =>
    ({
      customerRequests: requests.map(({ product, text }) => ({
        productName: product,
        unresolved: true,
        confidence: 90,
        quantity: 2,
        urgency: 'normal',
        evidenceMessageIds: [messageAt(session, text).id],
      })),
      products: [],
      recommendations: [],
      operationalOutcome: 'open_request',
      followupPlan: { required: false, dueInDays: 1, reason: '', evidenceMessageIds: [] },
      officialScoringEligible: true,
      evidence: { complaint: { messageIds: [] } },
    }) as any;
  const sync = (session: WhatsAppConversationSession, sourceId: string, requests: Array<{ product: string; text: string }>, customer: any = UNRESOLVED) =>
    syncWhatsAppOperationalActionsV6(model(session, requests), {
      sourceId,
      customerId: customer.customerId,
      followupIdentity: { customer, session, caseStartedAt: session.startedAt, legacyCaseAnchor: session.id },
    });
  const rows = () => db.tables[ACTIONS] || [];

  const client = supabase as any;
  let originalFrom: any;
  beforeEach(() => {
    db.tables = {};
    db.writes = [];
    db.beforeInsert = null;
    db.seq = 0;
    originalFrom = client.from;
    client.from = fakeFrom;
  });
  afterEach(() => {
    client.from = originalFrom;
  });

  it('import twice / retry / re-processing on a new source id reuse the first row', async () => {
    const session = exportSession(EXPORT);
    await sync(session, 'source-fixture-a', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    const first = { ...rows()[0] };
    Object.assign(rows()[0], { status: 'in_progress', work_status: 'assigned', target_table: 'customer_requests', target_id: 'request-fixture-1' });
    await sync(session, 'source-fixture-a', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    await sync(exportSession(EXPORT), 'source-fixture-b', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    await sync(exportSession(LONGER_EXPORT), 'source-fixture-c', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    expect(rows()).toHaveLength(1);
    // Same row id => the materialization client key whatsapp-action:<id> and its lineage hold.
    expect(rows()[0]).toMatchObject({
      id: first.id,
      source_id: 'source-fixture-a',
      followup_identity: first.followup_identity,
      work_status: 'assigned',
      target_table: 'customer_requests',
      target_id: 'request-fixture-1',
    });
    // Re-import on another source only refreshes evidence: workflow state and lineage stay owned
    // by the existing task. (Same-source re-analysis keeps its pre-existing full refresh.)
    const evidenceRefreshes = db.writes.filter((w) => w.op === 'upsert' && w.payload.some((row: any) => row.source_id === 'source-fixture-a' && row.id));
    for (const write of evidenceRefreshes)
      for (const row of write.payload)
        for (const owned of ['status', 'work_status', 'target_table', 'target_id']) expect(Object.keys(row).includes(owned)).toBe(false);
  });

  it('reordered requests (positional action_key shift) keep one row per operation', async () => {
    const session = splitWhatsAppSessions(parse(EXPORT), Number.MAX_SAFE_INTEGER)[0];
    const first = { product: 'كونجستال', text: 'عايز 2 علبة' };
    const second = { product: 'كونجستال', text: 'لسه محتاج كونجستال' };
    await sync(session, 'source-fixture-a', [first, second]);
    expect(rows()).toHaveLength(2);
    const pairs = () => rows().map((row) => `${row.followup_identity}=${row.id}`).sort();
    const before = pairs();
    // Re-analysis drops the first request: request:0:<product> now names the SECOND operation.
    await sync(session, 'source-fixture-a', [second]);
    await sync(session, 'source-fixture-a', [second, first]);
    expect(rows()).toHaveLength(2);
    expect(pairs()).toEqual(before);
    for (const row of rows()) {
      const evidenceText = session.messages.find((message) => row.evidence.includes(message.id))!.text;
      const expected = requestIdentity(session, UNRESOLVED, evidenceText.includes('لسه') ? 'لسه محتاج كونجستال' : 'عايز 2 علبة').identity;
      expect(row.followup_identity).toBe(expected);
    }
  });

  it('a row stored under a legacy or unresolved alias is reused, never duplicated or re-keyed', async () => {
    const session = exportSession(EXPORT);
    const unresolved = requestIdentity(session, UNRESOLVED);
    db.tables[ACTIONS] = [
      { id: 'row-legacy', source_id: 'source-fixture-old', action_key: 'request:0:x', action_type: 'customer_request', followup_identity: unresolved.aliases[0], evidence: [] },
    ];
    await sync(session, 'source-fixture-a', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    expect(rows()).toHaveLength(1);
    // Customer resolved later: the conversation-anchored row is the same operation.
    db.tables[ACTIONS] = [
      { id: 'row-unresolved', source_id: 'source-fixture-old', action_key: 'request:0:x', action_type: 'customer_request', followup_identity: unresolved.identity, evidence: [] },
    ];
    await sync(session, 'source-fixture-a', [{ product: 'كونجستال', text: 'عايز 2 علبة' }], RESOLVED);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: 'row-unresolved', followup_identity: unresolved.identity });
  });

  it('a concurrent writer of the same identity converges instead of failing or duplicating', async () => {
    const session = exportSession(EXPORT);
    const identity = requestIdentity(session).identity;
    db.beforeInsert = () =>
      rows().push({ id: 'row-concurrent', source_id: 'source-fixture-b', action_key: 'request:0:x', action_type: 'customer_request', followup_identity: identity, evidence: [] });
    await sync(session, 'source-fixture-a', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].id).toBe('row-concurrent');
  });

  it('two customers with the same request at the same minute keep separate rows', async () => {
    const chat = (contact: string) =>
      splitWhatsAppSessions(parse(`[9/15/26, 6:00:00 AM] You: عروض اليوم\n[9/15/26, 6:01:00 AM] ${contact}: عايز 2 علبة كونجستال`), 120)[0];
    await sync(chat('Customer A'), 'source-fixture-a', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    await sync(chat('Customer B'), 'source-fixture-b', [{ product: 'كونجستال', text: 'عايز 2 علبة' }]);
    expect(rows()).toHaveLength(2);
    expect(new Set(rows().map((row) => row.followup_identity)).size).toBe(2);
  });
});
