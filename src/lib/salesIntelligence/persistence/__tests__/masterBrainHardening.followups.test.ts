// WhatsApp Master Brain hardening — follow-up lifecycle regressions.
// Isolated PGlite only: no URLs, secrets, real customers or operational records.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveCanonicalComplaintAssessment } from '../../complaintAssessmentEngine';
import { buildCanonicalComplaintActionRows } from '../canonicalComplaintProjector';
import { operationalActionLifecycle } from '../../operations/proposalApprovalReadiness';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const RAW = [
  '[10/17/26, 10:00:00 AM] Customer: انا زعلان من مشكلة التوصيل',
  '[10/17/26, 10:01:00 AM] You: حقك علينا هتابع بنفسي',
  '[10/17/26, 10:20:00 AM] Customer: انا زعلان من مشكلة العلبة المفتوحة',
  '[10/17/26, 10:21:00 AM] You: حقك علينا هنبدلها',
].join('\n');

function complaintAnalysis(caseId: string, messages: Array<{ id: string; role: 'customer' | 'staff'; at: string; text: string }>) {
  return {
    caseId,
    complaintAssessment: deriveCanonicalComplaintAssessment({ caseId, messages: messages.map((m) => ({ ...m, meaningful: true })) }),
    conversationId: SOURCE_ID,
    conversationCase: { customerId: CUSTOMER_ID, customerPhone: '01000000000', branchNameRaw: 'فرع شكري' },
    caseIntelligence: {
      interaction: { messages: messages.map((m) => ({ ...m, sender: m.role === 'customer' ? 'Customer' : 'You', meaningful: true })) },
    },
  } as any;
}

const FIRST = complaintAnalysis('src:interaction:0:session:0', [
  { id: 'c1', role: 'customer', at: '2026-10-17T07:00:00.000Z', text: 'انا زعلان من مشكلة التوصيل' },
  { id: 's1', role: 'staff', at: '2026-10-17T07:01:00.000Z', text: 'حقك علينا هتابع بنفسي' },
]);
const SECOND = complaintAnalysis('src:interaction:0:session:1', [
  { id: 'c2', role: 'customer', at: '2026-10-17T07:20:00.000Z', text: 'انا زعلان من مشكلة العلبة المفتوحة' },
  { id: 's2', role: 'staff', at: '2026-10-17T07:21:00.000Z', text: 'حقك علينا هنبدلها' },
]);
const SOURCE = { id: SOURCE_ID, raw_text: RAW, customer_name: 'عميل اختبار', customer_code: '17' };

describe('follow-ups: independent complaints are never merged', () => {
  it('two complaint cases in one conversation episode project two distinct actions', () => {
    expect(FIRST.complaintAssessment.state).not.toBe('none');
    expect(SECOND.complaintAssessment.state).not.toBe('none');
    const result = buildCanonicalComplaintActionRows([SECOND, FIRST], [SOURCE]);
    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.followup_identity)).size).toBe(2);
    expect(result.rows.map((row) => row.payload.caseId).sort()).toEqual([FIRST.caseId, SECOND.caseId].sort());
    // Same conversation episode: alone, each complaint would get the SAME episode key (the old merge).
    const firstAlone = buildCanonicalComplaintActionRows([FIRST], [SOURCE]).rows[0].followup_identity;
    const secondAlone = buildCanonicalComplaintActionRows([SECOND], [SOURCE]).rows[0].followup_identity;
    expect(secondAlone).toBe(firstAlone);
  });

  it('a single complaint keeps its stable episode identity (existing rows stay idempotent)', () => {
    const alone = buildCanonicalComplaintActionRows([FIRST], [SOURCE]).rows[0];
    const together = buildCanonicalComplaintActionRows([SECOND, FIRST], [SOURCE]).rows.find((row) => row.payload.caseId === FIRST.caseId);
    expect(together?.followup_identity).toBe(alone.followup_identity);
    // Re-running the same input is deterministic.
    expect(buildCanonicalComplaintActionRows([FIRST, SECOND], [SOURCE]).rows.map((r) => r.followup_identity).sort())
      .toEqual(buildCanonicalComplaintActionRows([SECOND, FIRST], [SOURCE]).rows.map((r) => r.followup_identity).sort());
  });
});

describe('follow-ups: ready is not materialized', () => {
  it('only created WITH a target is materialized work', () => {
    expect(operationalActionLifecycle({ status: 'ready', targetTable: null, targetId: null })).toBe('proposal');
    expect(operationalActionLifecycle({ status: 'created', targetTable: 'daily_followups', targetId: 'f-1' })).toBe('materialized');
    expect(operationalActionLifecycle({ status: 'created', targetTable: null, targetId: null })).toBe('materialized_without_target');
    expect(operationalActionLifecycle({ status: 'dismissed', targetTable: null, targetId: null })).toBe('withdrawn');
  });
});

// ---------------------------------------------------------------------------------------------
// Materializer migration in isolated PGlite.
// ---------------------------------------------------------------------------------------------
const CASE_ID = 'src:interaction:0:session:0';
const ANALYSIS_ID = '22222222-2222-4222-8222-222222222222';

async function harness(coreBody?: string) {
  const db = new PGlite();
  await db.exec(readFileSync(resolve('scripts/staging/fixtures/canonical-followup-lifecycle.sql'), 'utf8'));
  await db.exec(`
    create function dawaa_is_transaction_branch_v1(text) returns boolean language sql as $$ select $1 in ('فرع شكري','فرع الشامي') $$;
    create table followup_targets(id text primary key, action_id uuid unique);
  `);
  // Idempotent core double: one operational record per action, like the real per-action key.
  await db.exec(coreBody ?? `
    create or replace function dawaa_materialize_whatsapp_action_core_v2(uuid) returns jsonb language plpgsql as $$
    declare v_status text; v_target text;
    begin
      select status, target_id into v_status, v_target from whatsapp_conversation_actions where id=$1 for update;
      if v_status='created' then return jsonb_build_object('already_created',true,'target_id',v_target); end if;
      insert into followup_targets(id, action_id) values ('fu-'||$1::text, $1) on conflict (action_id) do nothing;
      update whatsapp_conversation_actions set status='created',target_table='daily_followups',target_id='fu-'||$1::text where id=$1;
      return jsonb_build_object('already_created',false,'target_id','fu-'||$1::text);
    end $$;`);
  await db.exec(readFileSync(resolve('supabase/migrations/20261026090000_whatsapp_action_materialization_lifecycle_v1.sql'), 'utf8'));
  await db.query(`insert into whatsapp_review_sources(id,customer_id,customer_name,branch) values($1,$2,'عميل اختبار','فرع شكري')`, [SOURCE_ID, CUSTOMER_ID]);
  await db.query(`insert into sales_intelligence_case_analyses(analysis_id,case_id,evidence_snapshot) values($1,$2,$3)`, [
    ANALYSIS_ID, CASE_ID, JSON.stringify({ canonicalComplaintAssessment: { caseId: CASE_ID, state: 'recovery_attempted', complaintMessageIds: ['c1'] } }),
  ]);
  await db.query(`insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values($1,$2,$3)`, [CASE_ID, SOURCE_ID, ANALYSIS_ID]);
  const insertAction = async (overrides: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      source_id: SOURCE_ID, action_key: 'canonical-complaint:k1', action_type: 'complaint_followup', status: 'ready',
      branch: 'فرع شكري', customer_id: CUSTOMER_ID, customer_name: 'عميل اختبار', followup_identity: 'k1',
      created_by: 'si-canonical-complaint-projection-v1',
      payload: JSON.stringify({ caseId: CASE_ID, complaintMessageIds: ['c1'] }),
      ...overrides,
    };
    const keys = Object.keys(row);
    const result = await db.query<{ id: string }>(
      `insert into whatsapp_conversation_actions(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
      keys.map((key) => row[key]));
    return result.rows[0].id;
  };
  await db.exec(`set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';set test.permission='true';set test.source_access='true';set test.branch_access='true';`);
  return {
    db, insertAction,
    materialize: (id: string) => db.query<{ r: any }>('select dawaa_materialize_whatsapp_action_v1($1) r', [id]),
    action: async (id: string) => (await db.query<any>('select status,target_table,target_id from whatsapp_conversation_actions where id=$1', [id])).rows[0],
  };
}

let open: PGlite | null = null;
afterEach(async () => { await open?.close(); open = null; });

describe('follow-ups: materializer lifecycle (isolated PGlite)', () => {
  it('materializes a current complaint once, links its target, and is idempotent on retry', async () => {
    const h = await harness(); open = h.db;
    const id = await h.insertAction();
    await h.materialize(id);
    expect(await h.action(id)).toMatchObject({ status: 'created', target_table: 'daily_followups', target_id: `fu-${id}` });
    const retry = await h.materialize(id);
    expect(retry.rows[0].r.already_created).toBe(true);
    expect((await h.db.query<{ n: number }>('select count(*)::int n from followup_targets')).rows[0].n).toBe(1);
  });

  it('refuses a complaint proposal the current analysis no longer holds', async () => {
    const h = await harness(); open = h.db;
    const id = await h.insertAction();
    await h.db.query(`update sales_intelligence_case_analyses set evidence_snapshot=$1`, [
      JSON.stringify({ canonicalComplaintAssessment: { caseId: CASE_ID, state: 'resolved', complaintMessageIds: ['c1'] } }),
    ]);
    await expect(h.materialize(id)).rejects.toThrow('canonical_complaint_requires_current_projection');
    expect(await h.action(id)).toMatchObject({ status: 'ready', target_id: null });
  });

  it('refuses a complaint whose evidence messages belong to a different (re-segmented) complaint', async () => {
    const h = await harness(); open = h.db;
    const id = await h.insertAction({ payload: JSON.stringify({ caseId: CASE_ID, complaintMessageIds: ['c-other'] }) });
    await expect(h.materialize(id)).rejects.toThrow('canonical_complaint_requires_current_projection');
  });

  it('refuses a complaint whose case is no longer active', async () => {
    const h = await harness(); open = h.db;
    const id = await h.insertAction();
    await h.db.query('update sales_intelligence_cases set is_active=false');
    await expect(h.materialize(id)).rejects.toThrow('canonical_complaint_requires_current_projection');
  });

  it('keeps the existing authorization gates in front of the new checks', async () => {
    const h = await harness(); open = h.db;
    const id = await h.insertAction();
    await h.db.exec(`set test.permission='false'`);
    await expect(h.materialize(id)).rejects.toThrow('whatsapp_action_execute_permission_denied');
    await h.db.exec(`set test.permission='true'; set test.source_access='false'`);
    await expect(h.materialize(id)).rejects.toThrow('whatsapp_action_access_denied');
  });

  it('a core that flips status without lineage is rolled back by the postcondition', async () => {
    const h = await harness(`
      create or replace function dawaa_materialize_whatsapp_action_core_v2(uuid) returns jsonb language plpgsql as $$
      begin update whatsapp_conversation_actions set status='ready' where id=$1; return '{}'::jsonb; end $$;`);
    open = h.db;
    const id = await h.insertAction();
    await expect(h.materialize(id)).rejects.toThrow('whatsapp_action_materialization_without_target');
  });

  it('the table rejects created without a target', async () => {
    const h = await harness(); open = h.db;
    const id = await h.insertAction();
    await expect(h.db.query(`update whatsapp_conversation_actions set status='created' where id=$1`, [id]))
      .rejects.toThrow(/created_requires_target/);
  });
});
