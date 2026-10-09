import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';
import { saveFollowupSignals } from '@/lib/whatsappAutoIngestPipeline';
import { OPERATION_ATTRIBUTION_COMMAND } from '@/lib/whatsappOperationAttribution';

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
  let single = false;
  const run = () => {
    const rows = (db.tables[table] ||= []);
    const matched = () => rows.filter((row) => filters.every((f) => f(row))).slice(0, limit);
    if (action.op === 'select') {
      const data = matched().map((row) => ({ ...row }));
      return { data: single ? data[0] ?? null : data, error: null };
    }
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
    return { data: single ? out[0] ?? null : out, error: null };
  };
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
    is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
    in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
    contains: (column: string, values: unknown[]) => (filters.push((row) => Array.isArray(row[column]) && values.every((value) => row[column].includes(value))), builder),
    gte: (column: string, value: any) => (filters.push((row) => row[column] >= value), builder),
    lte: (column: string, value: any) => (filters.push((row) => row[column] <= value), builder),
    or: (expression: string) => {
      const patterns = expression.split(',').map((part) => {
        const [column, op, ...rest] = part.split('.');
        const escaped = rest.join('.').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
        if (op === 'is' && rest.join('.') === 'null') return { column, pattern: /^$/ };
        if (op !== 'like') throw new Error('Unsupported fake query');
        return { column, pattern: new RegExp(`^${escaped}$`) };
      });
      filters.push((row) => patterns.some(({column, pattern}) => pattern.test(String(row[column] || ''))));
      return builder;
    },
    limit: (value: number) => ((limit = value), builder),
    order: () => builder,
    single: () => ((single = true), builder),
    maybeSingle: () => ((single = true), builder),
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
  type WhatsAppParsedMessage,
} from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import {
  buildFollowupIdentity,
  conversationEpisodeAnchor,
  episodeStartedAt,
  followupCustomerAnchor,
  legacyAliasMatches,
  operationalActionFollowupIdentity,
  resolveOperationOwner,
  stableOperationIdentity,
} from '@/lib/whatsappFollowupIdentity';
import { syncWhatsAppOperationalActionsV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveFollowUpOpportunities } from '@/lib/salesIntelligence/followUpOpportunityEngine';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { buildWhatsAppCustomerJourneyIntelligenceV15 } from '@/lib/whatsappCustomerJourneyIntelligenceV15';
import { syncWhatsAppCustomerJourneyV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';

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
const RESOLVED_B = { ...RESOLVED, customerId: 'customer-fixture-2' };
const UNRESOLVED = { status: 'unresolved' as const, customerId: null, normalizedPhone: null, customerCode: null };
type Customer = typeof RESOLVED | typeof UNRESOLVED;

const parse = (raw: string) => parseWhatsAppExport(raw);
const whole = (raw: string) => splitWhatsAppSessions(parse(raw), Number.MAX_SAFE_INTEGER)[0];
const at = (iso: string) => new Date(iso);
const messageAt = (session: WhatsAppConversationSession, text: string) =>
  session.messages.find((message) => message.text.includes(text))!;
/** Same chat, other device: rename the customer's contact label (and optionally the staff label). */
const relabel = (raw: string, contact: string, staff = 'You') =>
  raw.replace(/\] Customer:/g, `] ${contact}:`).replace(/\] You:/g, `] ${staff}:`);

/** Identity of a request inside a given session (any segmentation). */
function requestIdentity(session: WhatsAppConversationSession, customer: Customer = UNRESOLVED, text = 'عايز 2 علبة كونجستال') {
  return operationalActionFollowupIdentity(
    { session, legacy: { customer, caseAnchor: session.id } },
    { action_type: 'customer_request', product_name: 'كونجستال', evidence: [messageAt(session, text).id] }
  )!;
}
const keyOf = (timeline: WhatsAppParsedMessage[], evidenceAt: Date, reasonKey = 'كونجستال') =>
  stableOperationIdentity({ timeline, evidenceAt, operationType: 'customer_request', reasonKey }).identity;

describe('Stable Operation Identity contract', () => {
  it('import twice, retry and re-processing produce the same operation identity', () => {
    const first = segmentWhatsAppExportCanonical(parse(EXPORT), 'chat.txt').caseContexts.contexts[0].mergedSession;
    const second = segmentWhatsAppExportCanonical(parse(EXPORT), 'chat.txt').caseContexts.contexts[0].mergedSession;
    expect(requestIdentity(first)).toEqual(requestIdentity(second));
    expect(requestIdentity(first).identity).toBe(requestIdentity(first).identity);
  });

  it('different segmentation boundaries and export ranges keep the same identity', () => {
    const unitOf = (raw: string, name: string) =>
      segmentWhatsAppExportCanonical(parse(raw), name).caseContexts.contexts.find((context) =>
        context.mergedSession.messages.some((message) => message.text.includes('عايز 2 علبة'))
      )!.mergedSession;
    const canonicalUnit = unitOf(EXPORT, 'chat.txt');
    const longerUnit = unitOf(LONGER_EXPORT, 'chat (1).txt');
    const expected = requestIdentity(whole(EXPORT)).identity;
    expect(requestIdentity(splitWhatsAppSessions(parse(EXPORT), 120)[0]).identity).toBe(expected);
    expect(requestIdentity(canonicalUnit).identity).toBe(expected);
    expect(requestIdentity(longerUnit).identity).toBe(expected);
    // The pre-contract unresolved anchor was the positional case/session id: it moved with the
    // export range, which is exactly the duplicate path this contract closes.
    expect(longerUnit.id).not.toBe(canonicalUnit.id);
    expect(followupCustomerAnchor(null, longerUnit.id)).not.toBe(followupCustomerAnchor(null, canonicalUnit.id));
  });

  it('is pure: message order, repeated calls and the input array never change the identity', () => {
    const messages = parse(EXPORT);
    const evidenceAt = messages[1].timestamp;
    const snapshot = messages.map((message) => message.id);
    const forward = keyOf(messages, evidenceAt);
    expect(keyOf([...messages].reverse(), evidenceAt)).toBe(forward);
    expect(keyOf([messages[3], messages[0], messages[5], messages[1], messages[4], messages[2]], evidenceAt)).toBe(forward);
    expect(keyOf(messages, evidenceAt)).toBe(forward);
    expect(messages.map((message) => message.id)).toEqual(snapshot);
  });

  it('two real operations in the same conversation stay two identities', () => {
    const session = whole(EXPORT);
    const firstEpisode = requestIdentity(session).identity;
    const secondEpisode = requestIdentity(session, UNRESOLVED, 'لسه محتاج كونجستال').identity;
    expect(secondEpisode).not.toBe(firstEpisode);
    const evidence = [messageAt(session, 'عايز 2 علبة').id];
    const otherProduct = operationalActionFollowupIdentity({ session }, { action_type: 'customer_request', product_name: 'بنادول', evidence })!.identity;
    const otherType = operationalActionFollowupIdentity({ session }, { action_type: 'customer_followup', product_name: 'كونجستال', evidence })!.identity;
    expect(new Set([firstEpisode, otherProduct, otherType]).size).toBe(3);
  });

  it('two customers answering the same broadcast in the same minute never collide', () => {
    const chat = (contact: string, reply = 'عايز كونجستال') =>
      parse(`[9/15/26, 6:00:00 AM] You: عروض اليوم على الفيتامينات\n[9/15/26, 6:05:00 AM] ${contact}: ${reply}`);
    const evidenceAt = chat('A')[1].timestamp;
    // Same words, same minute, different customers: only the contact label tells them apart.
    expect(conversationEpisodeAnchor(chat('Customer A'), evidenceAt)).not.toBe(conversationEpisodeAnchor(chat('Customer B'), evidenceAt));
    expect(keyOf(chat('Customer A'), evidenceAt)).not.toBe(keyOf(chat('Customer B'), evidenceAt));
  });

  it('two conversations with the same contact name and the same first text never collide', () => {
    const chat = (time: string, reply: string) =>
      parse(`[9/15/26, ${time}] You: السلام عليكم\n[9/15/26, 6:05:00 AM] Ahmed: ${reply}`);
    const evidenceAt = chat('6:00:00 AM', 'x')[1].timestamp;
    // Different opening minute.
    expect(keyOf(chat('6:00:00 AM', 'عايز كونجستال'), evidenceAt)).not.toBe(keyOf(chat('6:02:00 AM', 'عايز كونجستال'), evidenceAt));
    // Same opening minute and text, different first customer message.
    expect(keyOf(chat('6:00:00 AM', 'عايز كونجستال'), evidenceAt)).not.toBe(keyOf(chat('6:00:00 AM', 'محتاج كونجستال ضروري'), evidenceAt));
  });

  it('same chat from two devices: phone format and staff label do not matter; a saved name vs a number stays separate', () => {
    const evidenceAt = parse(EXPORT)[1].timestamp;
    const base = keyOf(parse(relabel(EXPORT, '+20 100 123 4567')), evidenceAt);
    expect(keyOf(parse(relabel(EXPORT, '01001234567')), evidenceAt)).toBe(base);
    expect(keyOf(parse(relabel(EXPORT, '+20 100 123 4567', 'Pharmacy Desk')), evidenceAt)).toBe(base);
    // Conservative by design: nothing in the export proves "Ahmed" is +20 100 123 4567.
    expect(keyOf(parse(relabel(EXPORT, 'Ahmed')), evidenceAt)).not.toBe(base);
  });

  it('a WhatsApp system/metadata line added before the real evidence does not move the identity', () => {
    const withNotice = `[9/15/26, 5:59:00 AM] Messages and calls are end-to-end encrypted.\n${EXPORT}`;
    const evidenceAt = parse(EXPORT)[1].timestamp;
    expect(parse(withNotice)[0].direction).toBe('system');
    expect(keyOf(parse(withNotice), evidenceAt)).toBe(keyOf(parse(EXPORT), evidenceAt));
  });

  it('media lines count by kind, so exports with and without attachments agree', () => {
    const opened = (line: string) => parse(`[9/15/26, 6:00:00 AM] Customer: ${line}\n[9/15/26, 6:01:00 AM] Customer: عايز كونجستال`);
    const evidenceAt = opened('x')[1].timestamp;
    expect(keyOf(opened('<Media omitted>'), evidenceAt)).toBe(keyOf(opened('IMG-20260915-WA0001.jpg (file attached)'), evidenceAt));
  });

  it('partial export: a missing evidence message inside the episode keeps the identity; a missing episode opener does not (conservative)', () => {
    const full = parse(EPISODE_ONE);
    const withoutRequest = parse(EPISODE_ONE.split('\n').filter((line) => !line.includes('عايز 2 علبة')).join('\n'));
    const laterEvidence = withoutRequest.find((message) => message.text.includes('لما يتوفر'))!.timestamp;
    expect(keyOf(withoutRequest, laterEvidence)).toBe(keyOf(full, full[1].timestamp));
    const withoutOpener = parse(EPISODE_ONE.split('\n').slice(1).join('\n'));
    // The opening message is evidence of WHICH conversation this is; without it the export cannot
    // prove it is the same one, so it becomes a separate operation instead of a guessed merge.
    expect(keyOf(withoutOpener, withoutOpener[0].timestamp)).not.toBe(keyOf(full, full[1].timestamp));
  });

  it('the identity is immutable across customer resolution: unresolved, resolved, re-linked', () => {
    const session = whole(EXPORT);
    const unresolved = requestIdentity(session, UNRESOLVED);
    const resolvedA = requestIdentity(session, RESOLVED);
    const resolvedB = requestIdentity(session, RESOLVED_B);
    expect(resolvedA.identity).toBe(unresolved.identity);
    expect(resolvedB.identity).toBe(unresolved.identity);
    expect(unresolved.identity).toMatch(/^fu1\|chat:/);
    // Resolution only selects which pre-contract key could hold a legacy row.
    expect(resolvedA.aliases.map((alias) => alias.kind)).toEqual(['legacy_customer', 'legacy_case']);
    expect(resolvedA.aliases[0].key).toBe(
      buildFollowupIdentity({
        customerAnchor: 'customer:customer-fixture-1',
        episodeStartedAt: episodeStartedAt(session.messages, messageAt(session, 'عايز 2 علبة').timestamp),
        followupType: 'customer_request',
        reasonKey: 'كونجستال',
      })
    );
    expect(unresolved.aliases.map((alias) => alias.kind)).toEqual(['legacy_case']);
  });

  it('fails closed without any conversation evidence', () => {
    expect(() => stableOperationIdentity({ timeline: [], evidenceAt: at('2026-09-15T06:00:00Z'), operationType: 'customer_request' })).toThrow(
      'followup_customer_anchor_unresolved'
    );
  });

  it('legacy aliases are reused only with confirming evidence, and two confirmed rows are ambiguous', () => {
    const ids = ['1789452060000-1-Customer'];
    expect(legacyAliasMatches('legacy_case', { evidenceIds: ids }, { evidence: ids })).toBe(true);
    // Same minute, different chat (different message id): a positional case key is not proof.
    expect(legacyAliasMatches('legacy_case', { evidenceIds: ids }, { evidence: ['1789452060000-4-Other'] })).toBe(false);
    expect(legacyAliasMatches('legacy_case', { evidenceIds: [] }, { evidence: [] })).toBe(false);
    expect(legacyAliasMatches('legacy_customer', { evidenceIds: ids }, { evidence: ['1789452060000-4-Other'] })).toBe(true);
    expect(legacyAliasMatches('legacy_customer', { evidenceIds: ids }, { evidence: ['1789452999000-1-Customer'] })).toBe(false);
    const evidenceAt = new Date(1789452060000);
    expect(legacyAliasMatches('legacy_case', { evidenceAt, evidenceQuote: 'عايز كونجستال' }, { evidence_timestamp: evidenceAt.toISOString(), evidence_quote: 'عايز  كونجستال' })).toBe(true);
    expect(legacyAliasMatches('legacy_case', { evidenceAt, evidenceQuote: 'عايز كونجستال' }, { evidence_timestamp: evidenceAt.toISOString(), evidence_quote: 'شكرا' })).toBe(false);

    const stable = { identity: 'current', aliases: [{ key: 'old-customer', kind: 'legacy_customer' as const }, { key: 'old-case', kind: 'legacy_case' as const }] };
    const confirm = () => true;
    expect(resolveOperationOwner(stable, [{ id: 'a', followup_identity: 'old-case' }, { id: 'b', followup_identity: 'current' }], confirm)).toEqual({ status: 'current', row: { id: 'b', followup_identity: 'current' } });
    expect(resolveOperationOwner(stable, [{ id: 'a', followup_identity: 'old-customer' }, { id: 'b', followup_identity: 'old-case' }], confirm).status).toBe('ambiguous');
    expect(resolveOperationOwner(stable, [{ id: 'a', followup_identity: 'old-case' }], () => false).status).toBe('none');
  });
});

describe('Sales Intelligence follow-up keys use the same contract', () => {
  const analyze = (conversationId: string, raw: string, resolved: boolean, customerId = 'customer-fixture-1') =>
    runSalesIntelligencePipeline({
      conversationId,
      rawWhatsAppExportText: raw,
      resolveInvoiceCandidates: () => [],
      customerIdHint: resolved ? customerId : null,
      customerIdentityStatus: resolved ? 'resolved' : 'unresolved',
    });
  const keys = (conversationId: string, raw: string, resolved: boolean, customerId?: string) =>
    analyze(conversationId, raw, resolved, customerId)
      .caseAnalyses.flatMap((row) => row.followUp.opportunities.map((o) => o.followUpKey))
      .sort();

  it('re-import under a new source id, re-processing and any resolution keep the same follow-up keys', () => {
    const first = keys('source-fixture-a', EPISODE_ONE, false);
    expect(first.length).toBeGreaterThan(0);
    expect(keys('source-fixture-b', EPISODE_ONE, false)).toEqual(first);
    expect(keys('source-fixture-a', EPISODE_ONE, false)).toEqual(first);
    expect(keys('source-fixture-a', EPISODE_ONE, true)).toEqual(first);
    expect(keys('source-fixture-a', EPISODE_ONE, true, 'customer-fixture-2')).toEqual(first);
    expect(first.every((key) => !key.includes('source-fixture') && !key.includes('customer-fixture'))).toBe(true);
  });

  it('a case that starts mid-episode after resegmentation keeps the key (06:00 vs 06:01)', () => {
    const analysis = analyze('source-fixture-a', EPISODE_ONE, true).caseAnalyses[0];
    const all = buildConversationUnderstandingV32(whole(EPISODE_ONE)).messages;
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
  const unitOf = (raw: string) =>
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
  const REQUEST = { product: 'كونجستال', text: 'عايز 2 علبة' };
  const sync = (session: WhatsAppConversationSession, sourceId: string, requests = [REQUEST], customer: Customer = UNRESOLVED) =>
    syncWhatsAppOperationalActionsV6(model(session, requests), {
      sourceId,
      customerId: customer.customerId,
      followupIdentity: { session, caseStartedAt: session.startedAt, legacy: { customer, caseAnchor: session.id } },
    });
  const rows = () => db.tables[ACTIONS] || [];
  const legacyRow = (id: string, key: string, evidence: string[], extra: Row = {}) => ({
    id,
    source_id: `source-${id}`,
    action_key: 'request:0:x',
    action_type: 'customer_request',
    followup_identity: key,
    evidence,
    ...extra,
  });

  const client = supabase as any;
  let originalFrom: any;
  let originalRpc: any;
  let oldWindow: any;
  let oldStorage: any;
  beforeEach(() => {
    db.tables = {};
    db.writes = [];
    db.beforeInsert = null;
    db.seq = 0;
    originalFrom = client.from;
    client.from = fakeFrom;
    originalRpc = client.rpc;
    oldWindow = (globalThis as any).window;
    oldStorage = (globalThis as any).localStorage;
    (globalThis as any).window = {};
    (globalThis as any).localStorage = { getItem: () => 'synthetic-staff-session-token-000000000000' };
    client.rpc = async (fn: string, args: any) => {
      if (fn !== OPERATION_ATTRIBUTION_COMMAND) return { data: null, error: null };
      const table = args.p_kind === 'action' ? ACTIONS : 'whatsapp_auto_followup_requests';
      const row = (db.tables[table] || []).find((entry) => entry.id === args.p_row_id);
      if (!row || row.followup_identity !== args.p_expected_identity)
        return { data: null, error: { code: '40001', message: 'operation_identity_changed' } };
      if ((row.customer_id || null) !== args.p_expected_customer_id)
        return { data: null, error: { code: '40001', message: 'operation_attribution_changed' } };
      db.writes.push({ table, op: 'rpc', payload: args });
      Object.assign(row, args.p_attribution);
      return { data: { id: row.id, followup_identity: row.followup_identity }, error: null };
    };
  });
  afterEach(() => {
    client.from = originalFrom;
    client.rpc = originalRpc;
    (globalThis as any).window = oldWindow;
    (globalThis as any).localStorage = oldStorage;
  });

  it('import twice / retry / re-processing on a new source id reuse the first row', async () => {
    const session = unitOf(EXPORT);
    await sync(session, 'source-fixture-a');
    const first = { ...rows()[0] };
    Object.assign(rows()[0], { work_status: 'assigned', target_table: 'customer_requests', target_id: 'request-fixture-1' });
    await sync(session, 'source-fixture-a');
    await sync(unitOf(EXPORT), 'source-fixture-b');
    await sync(unitOf(LONGER_EXPORT), 'source-fixture-c');
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
    // Re-import on another source keeps source evidence: workflow state and lineage stay owned
    // by the existing task. Attribution correction never discards that provenance.
    for (const write of db.writes.filter((w) => w.op === 'upsert' && w.payload.some((row: any) => row.id)))
      for (const row of write.payload)
        for (const owned of ['status', 'work_status', 'target_table', 'target_id']) expect(Object.keys(row).includes(owned)).toBe(false);
  });

  it('reordered requests (positional action_key shift) keep one row per operation', async () => {
    const session = whole(EXPORT);
    const second = { product: 'كونجستال', text: 'لسه محتاج كونجستال' };
    await sync(session, 'source-fixture-a', [REQUEST, second]);
    expect(rows()).toHaveLength(2);
    const pairs = () => rows().map((row) => `${row.followup_identity}=${row.id}`).sort();
    const before = pairs();
    // Re-analysis drops the first request: request:0:<product> now names the SECOND operation.
    await sync(session, 'source-fixture-a', [second]);
    await sync(session, 'source-fixture-a', [second, REQUEST]);
    expect(rows()).toHaveLength(2);
    expect(pairs()).toEqual(before);
  });

  it('unresolved -> resolved -> unresolved -> re-linked keeps one row under one identity', async () => {
    const session = unitOf(EXPORT);
    await sync(session, 'source-fixture-a', [REQUEST], UNRESOLVED);
    const original = { ...rows()[0] };
    await sync(session, 'source-fixture-b', [REQUEST], RESOLVED);
    await sync(session, 'source-fixture-c', [REQUEST], UNRESOLVED);
    await sync(session, 'source-fixture-d', [REQUEST], RESOLVED_B);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: original.id, followup_identity: original.followup_identity, customer_id: RESOLVED_B.customerId });
  });

  it('A -> unresolved -> B -> A, with repeated imports, updates attribution on one row', async () => {
    const session = unitOf(EXPORT);
    await sync(session, 'source-a', [REQUEST], RESOLVED);
    const original = { ...rows()[0] };
    Object.assign(rows()[0], { work_status: 'assigned', target_table: 'customer_requests', target_id: 'request-one' });
    for (const [index, customer] of [UNRESOLVED, RESOLVED_B, RESOLVED, RESOLVED].entries()) {
      await sync(session, `source-correction-${index}`, [REQUEST], customer);
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ id: original.id, followup_identity: original.followup_identity,
        customer_id: customer.customerId, work_status: 'assigned', target_id: 'request-one' });
    }
    expect(db.writes.filter((write) => write.op === 'rpc')).toHaveLength(3);
  });

  it('unresolved -> A updates the persisted attribution, not only the generated key', async () => {
    const session = unitOf(EXPORT);
    await sync(session, 'source-a');
    const original = { ...rows()[0] };
    await sync(session, 'source-b', [REQUEST], RESOLVED);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: original.id, followup_identity: original.followup_identity, customer_id: RESOLVED.customerId });
  });

  it('legacy A -> B -> unresolved -> A preserves the immutable legacy key', async () => {
    const session = unitOf(EXPORT);
    const key = requestIdentity(session, RESOLVED).aliases[0].key;
    db.tables[ACTIONS] = [legacyRow('old-a', key, [messageAt(session, REQUEST.text).id], { customer_id: RESOLVED.customerId })];
    for (const [index, customer] of [RESOLVED_B, UNRESOLVED, RESOLVED].entries()) {
      await sync(session, `source-${index}`, [REQUEST], customer);
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ id: 'old-a', followup_identity: key, customer_id: customer.customerId });
    }
  });

  it('two historical customer keys confirmed by evidence are ambiguous after correction', async () => {
    const session = unitOf(EXPORT);
    const evidence = [messageAt(session, REQUEST.text).id];
    db.tables[ACTIONS] = [
      legacyRow('old-a', requestIdentity(session, RESOLVED).aliases[0].key, evidence, { customer_id: RESOLVED.customerId }),
      legacyRow('old-b', requestIdentity(session, RESOLVED_B).aliases[0].key, evidence, { customer_id: RESOLVED_B.customerId }),
    ];
    const result = await sync(session, 'source-new');
    expect(result[0].status).toBe('followup_identity_alias_ambiguous');
    expect(rows()).toHaveLength(2);
    expect(db.writes).toHaveLength(0);
  });

  it('a NULL-key historical action is adopted by exact evidence after customer correction', async () => {
    const session = unitOf(EXPORT);
    db.tables[ACTIONS] = [legacyRow('old-null', null as any, [messageAt(session, REQUEST.text).id],
      { customer_id: RESOLVED.customerId, payload: { productName: REQUEST.product }, status: 'proposed' })];
    await sync(session, 'source-new', [REQUEST], RESOLVED_B);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: 'old-null', followup_identity: requestIdentity(session).identity, customer_id: RESOLVED_B.customerId });
  });

  it('changed export positions reuse historical A through its saved conversation evidence', async () => {
    const session = unitOf(LONGER_EXPORT);
    const oldSession = unitOf(EXPORT);
    const key = requestIdentity(oldSession, RESOLVED).aliases[0].key;
    db.tables[ACTIONS] = [legacyRow('old-source-evidence', key, [messageAt(oldSession, REQUEST.text).id], { customer_id: RESOLVED.customerId })];
    db.tables.whatsapp_review_sources = [{ id: 'source-old-source-evidence', raw_text: EXPORT }];
    await sync(session, 'source-new', [REQUEST], RESOLVED_B);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: 'old-source-evidence', followup_identity: key, customer_id: RESOLVED_B.customerId });
  });

  it('same-minute evidence in another saved chat does not identify a historical operation', async () => {
    const session = unitOf(EXPORT);
    const key = requestIdentity(session, RESOLVED).aliases[0].key;
    db.tables[ACTIONS] = [legacyRow('other-customer', key, [messageAt(whole(relabel(EXPORT, 'Someone Else')), REQUEST.text).id], { customer_id: RESOLVED.customerId })];
    db.tables.whatsapp_review_sources = [{ id: 'source-other-customer', raw_text: relabel(EXPORT, 'Someone Else') }];
    await sync(session, 'source-new', [REQUEST], RESOLVED_B);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].customer_id).toBe(RESOLVED.customerId);
  });

  it('an attribution RPC rejection never falls back to an insert or direct customer update', async () => {
    const session = unitOf(EXPORT);
    await sync(session, 'source-a', [REQUEST], RESOLVED);
    client.rpc = async () => ({ data: null, error: { code: '42501', message: 'not_authorized' } });
    let code = '';
    try { await sync(session, 'source-b', [REQUEST], RESOLVED_B); } catch (e: any) { code = e.code; }
    expect(code).toBe('42501');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].customer_id).toBe(RESOLVED.customerId);
  });

  it('a correction without a staff session fails closed without an insert or attribution write', async () => {
    const session = unitOf(EXPORT);
    await sync(session, 'source-a', [REQUEST], RESOLVED);
    (globalThis as any).localStorage = { getItem: () => null };
    let error = '';
    try { await sync(session, 'source-b', [REQUEST], RESOLVED_B); } catch (e) { error = String(e); }
    expect(error).toContain('operation_attribution_staff_session_required');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].customer_id).toBe(RESOLVED.customerId);
  });

  it('saved contact and bare number stay separate in persistence after resolution changes', async () => {
    await sync(whole(relabel(EPISODE_ONE, 'Ahmed Mohamed')), 'source-name', [REQUEST], RESOLVED);
    await sync(whole(relabel(EPISODE_ONE, '+201012345678')), 'source-number', [REQUEST], RESOLVED);
    expect(rows()).toHaveLength(2);
  });

  it('signals update attribution in place through the same command and preserve task evidence/status', async () => {
    const session = unitOf(EXPORT);
    const identity = (customer: Customer) => ({ customerId: customer.customerId, customerCode: null,
      customerName: 'Customer', customerPhone: null, branch: null, matchedBy: 'none',
      resolutionStatus: customer.status, resolutionReason: 'synthetic', canonical: customer }) as any;
    await saveFollowupSignals(session, 'chat.txt', identity(UNRESOLVED), null);
    const originals = (db.tables.whatsapp_auto_followup_requests || []).map((row) => ({ ...row }));
    expect(originals.length).toBeGreaterThan(0);
    for (const row of db.tables.whatsapp_auto_followup_requests) row.status = 'قيد المتابعة';
    for (const customer of [RESOLVED, RESOLVED_B, UNRESOLVED, RESOLVED]) {
      await saveFollowupSignals(session, 'chat-new.txt', identity(customer), null);
      expect(db.tables.whatsapp_auto_followup_requests).toHaveLength(originals.length);
      for (let i = 0; i < originals.length; i++)
        expect(db.tables.whatsapp_auto_followup_requests[i]).toMatchObject({ id: originals[i].id,
          followup_identity: originals[i].followup_identity, evidence_quote: originals[i].evidence_quote,
          status: 'قيد المتابعة', customer_id: customer.customerId, customer_identity_status: customer.status });
    }
  });

  it('historical customer-key signals survive A -> B -> unresolved -> A using source evidence', async () => {
    const session = unitOf(EXPORT);
    const identity = (customer: Customer) => ({ customerId: customer.customerId, customerCode: null,
      customerName: 'Customer', customerPhone: null, branch: null, matchedBy: 'none',
      resolutionStatus: customer.status, resolutionReason: 'synthetic', canonical: customer }) as any;
    await saveFollowupSignals(session, 'chat.txt', identity(RESOLVED), null);
    const originals = db.tables.whatsapp_auto_followup_requests;
    for (const row of originals) row.followup_identity = stableOperationIdentity({ timeline: session.messages,
      evidenceAt: new Date(row.evidence_timestamp), operationType: `signal:${row.signal_type}`,
      reasonKey: row.requested_product_name, legacy: { customer: RESOLVED }, }).aliases[0].key;
    const keys = originals.map((row) => `${row.id}=${row.followup_identity}`);
    db.tables.whatsapp_review_sources = [{ id: 'old-signal-source', source_filename: 'chat.txt', raw_text: EXPORT,
      conversation_started_at: session.startedAt.toISOString(), conversation_ended_at: session.endedAt.toISOString() }];
    for (const customer of [RESOLVED_B, UNRESOLVED, RESOLVED]) {
      await saveFollowupSignals(session, 'new-chat.txt', identity(customer), null);
      expect(db.tables.whatsapp_auto_followup_requests.map((row) => `${row.id}=${row.followup_identity}`)).toEqual(keys);
      for (const row of db.tables.whatsapp_auto_followup_requests) expect(row.customer_id).toBe(customer.customerId);
    }
  });

  it('NULL-key historical signals use saved conversation evidence before correcting customer', async () => {
    const session = unitOf(EXPORT);
    const identity = (customer: Customer) => ({ customerId: customer.customerId, customerCode: null,
      customerName: 'Customer', customerPhone: null, branch: null, matchedBy: 'none',
      resolutionStatus: customer.status, resolutionReason: 'synthetic', canonical: customer }) as any;
    await saveFollowupSignals(session, 'chat.txt', identity(RESOLVED), null);
    const ids = db.tables.whatsapp_auto_followup_requests.map((row) => row.id);
    for (const row of db.tables.whatsapp_auto_followup_requests) row.followup_identity = null;
    db.tables.whatsapp_review_sources = [{ id: 'old-signal-source', source_filename: 'chat.txt', raw_text: EXPORT,
      conversation_started_at: session.startedAt.toISOString(), conversation_ended_at: session.endedAt.toISOString() }];
    await saveFollowupSignals(session, 'new-chat.txt', identity(RESOLVED_B), null);
    expect(db.tables.whatsapp_auto_followup_requests.map((row) => row.id)).toEqual(ids);
    for (const row of db.tables.whatsapp_auto_followup_requests) expect(row.customer_id).toBe(RESOLVED_B.customerId);
  });

  it('pre-contract rows: unresolved and resolved legacy keys are reused when evidence confirms', async () => {
    const session = unitOf(EXPORT);
    const stable = requestIdentity(session, RESOLVED);
    const evidence = [messageAt(session, 'عايز 2 علبة').id];
    db.tables[ACTIONS] = [legacyRow('legacy-case', stable.aliases[1].key, evidence)];
    await sync(session, 'source-fixture-a', [REQUEST], RESOLVED); // resolved after an unresolved legacy write
    expect(rows().map((row) => row.id)).toEqual(['legacy-case']);
    db.tables[ACTIONS] = [legacyRow('legacy-customer', stable.aliases[0].key, evidence, { customer_id: 'customer-fixture-1' })];
    await sync(session, 'source-fixture-a', [REQUEST], RESOLVED);
    expect(rows().map((row) => row.id)).toEqual(['legacy-customer']);
    expect(rows()[0].followup_identity).toBe(stable.aliases[0].key); // never re-keyed
  });

  it('a confirmed historical operation preserves its row and old identity across customer correction', async () => {
    const session = unitOf(EXPORT);
    const evidence = [messageAt(session, 'عايز 2 علبة').id];
    const keyForA = requestIdentity(session, RESOLVED).aliases[0].key;
    db.tables[ACTIONS] = [legacyRow('legacy-a', keyForA, evidence, { customer_id: 'customer-fixture-1' })];
    // Evidence proves this is the same operation despite the old customer-dependent key.
    await sync(session, 'source-fixture-a', [REQUEST], RESOLVED_B);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: 'legacy-a', followup_identity: keyForA, customer_id: RESOLVED_B.customerId });
  });

  it('a legacy case key from another chat (same position, other evidence) is not reused', async () => {
    const session = unitOf(EXPORT);
    const caseKey = requestIdentity(session).aliases[0].key;
    db.tables[ACTIONS] = [legacyRow('other-chat', caseKey, ['1789452060000-1-Someone Else'])];
    await sync(session, 'source-fixture-a');
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toMatchObject({ id: 'other-chat', followup_identity: caseKey });
  });

  it('two legacy aliases confirming two different rows fail safe: nothing picked, merged or inserted', async () => {
    const session = unitOf(EXPORT);
    const stable = requestIdentity(session, RESOLVED);
    const evidence = [messageAt(session, 'عايز 2 علبة').id];
    db.tables[ACTIONS] = [
      legacyRow('legacy-customer', stable.aliases[0].key, evidence),
      legacyRow('legacy-case', stable.aliases[1].key, evidence),
    ];
    const result = await sync(session, 'source-fixture-a', [REQUEST], RESOLVED);
    expect(rows()).toHaveLength(2);
    expect(result.map((row: any) => row.status)).toEqual(['followup_identity_alias_ambiguous']);
    expect(db.writes).toHaveLength(0);
  });

  it('a concurrent writer of the same identity converges instead of failing or duplicating', async () => {
    const session = unitOf(EXPORT);
    const identity = requestIdentity(session).identity;
    db.beforeInsert = () => rows().push(legacyRow('row-concurrent', identity, []));
    await sync(session, 'source-fixture-a');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].id).toBe('row-concurrent');
  });

  it('two customers with the same request at the same minute keep separate rows', async () => {
    const chat = (contact: string) =>
      splitWhatsAppSessions(parse(`[9/15/26, 6:00:00 AM] You: عروض اليوم\n[9/15/26, 6:01:00 AM] ${contact}: عايز 2 علبة كونجستال`), 120)[0];
    await sync(chat('Customer A'), 'source-fixture-a');
    await sync(chat('Customer B'), 'source-fixture-b');
    expect(rows()).toHaveLength(2);
    expect(new Set(rows().map((row) => row.followup_identity)).size).toBe(2);
  });

  it('Journey V15 (reachable from every file ingest) writes its recovery follow-up through the same identity', async () => {
    const raw = `[9/15/26, 6:00:00 AM] Customer: عايز اوردر كونجستال
[9/15/26, 6:05:00 AM] You: تمام
[9/15/26, 9:30:00 AM] Customer: الاوردر ماوصلش ومحدش رد`;
    const contexts = segmentWhatsAppExportCanonical(parse(raw), 'chat.txt').caseContexts.contexts;
    const sessions = contexts.map((context) => context.mergedSession);
    const journeyModel = buildWhatsAppCustomerJourneyIntelligenceV15(sessions);
    const recovery = journeyModel.actions.find((action) => action.key === 'journey-recovery-followup')!;
    expect(recovery).toBeTruthy();
    db.tables.whatsapp_review_sources = [{ id: 'source-fixture-a', branch: 'branch-fixture', customer_id: null }];
    let sourceId = 'source-fixture-a';
    const run = () =>
      syncWhatsAppCustomerJourneyV15(journeyModel, {
        sessionSources: sessions.map((session) => ({ sessionId: session.id, sourceId, contextOnly: false })),
        sessions,
      });
    await run();
    await run();
    const firstRecovery = { ...rows()[0] };
    for (const customer of [RESOLVED_B, UNRESOLVED, RESOLVED]) {
      db.tables.whatsapp_review_sources[0].customer_id = customer.customerId;
      await run();
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ id: firstRecovery.id, followup_identity: firstRecovery.followup_identity, customer_id: customer.customerId });
    }
    for (const [index, customer] of [RESOLVED, RESOLVED_B, UNRESOLVED, RESOLVED].entries()) {
      sourceId = `source-journey-${index}`;
      db.tables.whatsapp_review_sources.push({ id: sourceId, branch: 'branch-fixture', customer_id: customer.customerId });
      await run();
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ id: firstRecovery.id, followup_identity: firstRecovery.followup_identity, customer_id: customer.customerId });
    }
    const actions = rows();
    expect(actions).toHaveLength(1);
    const evidenceSession = sessions.find((session) => recovery.evidenceSessionIds.includes(session.id))!;
    const expected = stableOperationIdentity({
      timeline: sessions.flatMap((session) => session.messages),
      evidenceAt: evidenceSession.startedAt,
      operationType: recovery.type,
    }).identity;
    expect(actions[0]).toMatchObject({ source_id: 'source-fixture-a', action_type: recovery.type, followup_identity: expected });
    // Without the conversation messages it fails closed: no identity-less row is written.
    db.tables[ACTIONS] = [];
    const result = await syncWhatsAppCustomerJourneyV15(journeyModel, {
      sessionSources: sessions.map((session) => ({ sessionId: session.id, sourceId: 'source-fixture-a', contextOnly: false })),
    });
    expect(rows()).toHaveLength(0);
    expect(result?.warnings).toContain('journey_recovery_followup_identity_unresolved');
  });
});
