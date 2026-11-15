import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite();
const source = '20000000-0000-4000-8000-000000000005';
const analysis = '70000000-0000-4000-8000-000000000001';
const target = 'LOCAL-INVOICE-74880';
const call = () => db.query(`select dawaa_confirm_whatsapp_invoice_link_v1('${source}','${target}','74880','راجعت العميل والفرع والتوقيت والأصناف') result`);
const migration = readFileSync('supabase/migrations/20261115144115_whatsapp_canonical_invoice_confirmation_parity.sql', 'utf8');

describe('canonical invoice confirmation preserves manager gates and legacy history', () => {
  beforeAll(async () => {
    await db.exec(readFileSync('supabase/tests/whatsapp_invoice_link_confirmation_v1.fixture.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20261012121500_whatsapp_invoice_link_confirmation_v1.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20261027050000_whatsapp_invoice_link_confirmation_staff_name_runtime_fix.sql', 'utf8'));
    await db.exec(`
      create table sales_intelligence_cases(case_id text primary key, conversation_id uuid, published_analysis_id uuid, is_active boolean, deleted_at timestamptz);
      create table sales_intelligence_case_analyses(analysis_id uuid primary key,case_id text,is_current boolean,identity_customer_id uuid);
      create table sales_intelligence_attributions(analysis_id uuid,case_id text,is_current_evaluation boolean,selected_invoice_id text,selected_invoice_number text,identity_conflict text,branch_conflict boolean);
    `);
    await db.exec(migration);
    // Existing verified-session, permission, scope, identity, immutable approval
    // and idempotency SQL scenarios must still pass with the new guard installed.
    await db.exec(readFileSync('supabase/tests/whatsapp_invoice_link_confirmation_v1.test.sql', 'utf8'));
  }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec(`
      truncate sales_intelligence_attributions,sales_intelligence_case_analyses,sales_intelligence_cases;
      delete from whatsapp_review_sources where id='${source}';
      insert into whatsapp_review_sources(id,branch,customer_id,customer_code,customer_phone,matched_invoice_id)
        values('${source}','فرع شكري','40000000-0000-4000-8000-000000000001','2490','01012345678','50000000-0000-4000-8000-000000000002');
      insert into sales_intelligence_cases values('synthetic-case','${source}','${analysis}',true,null);
      insert into sales_intelligence_case_analyses values('${analysis}','synthetic-case',true,'40000000-0000-4000-8000-000000000001');
      insert into sales_intelligence_attributions values('${analysis}','synthetic-case',true,'${target}','74880','none',false);
      select set_config('test.actor_id','10000000-0000-4000-8000-000000000001',false);
      select set_config('test.can_edit_reviews','true',false);
      select set_config('test.can_approve_reviews','false',false);
      select set_config('test.can_manage_conversation_evaluations','false',false);
      select set_config('test.top_management','false',false);
    `);
  });
  it('accepts the published canonical invoice over an unconfirmed legacy suggestion, audits it, and retries idempotently', async () => {
    const moneyBefore = await db.query('select * from sales_invoices order by id');
    const first = await call();
    expect(first.rows[0]).toMatchObject({ result: { ok:true, idempotent:false } });
    const saved = await db.query(`select * from whatsapp_review_sources where id='${source}'`);
    expect(saved.rows[0]).toMatchObject({ matched_invoice_id:'50000000-0000-4000-8000-000000000002',invoice_link_confirmed:true,invoice_link_confirmed_invoice_id:target });
    expect(String((saved.rows[0] as Record<string, unknown>).invoice_link_confirmation_note)).toContain('canonical_candidate_selected_over_unconfirmed_legacy');
    expect((await call()).rows[0]).toMatchObject({ result: { ok:true,idempotent:true } });
    expect((await db.query(`select invoice_link_confirmed_at from whatsapp_review_sources where id='${source}'`)).rows[0]).toEqual({invoice_link_confirmed_at:(saved.rows[0] as Record<string, unknown>).invoice_link_confirmed_at});
    expect(await db.query('select * from sales_invoices order by id')).toEqual(moneyBefore);
  });
  it.each([
    "update sales_intelligence_cases set conversation_id='20000000-0000-4000-8000-000000000009'",
    'update sales_intelligence_cases set is_active=false',
    'update sales_intelligence_cases set deleted_at=now()',
    "update sales_intelligence_cases set published_analysis_id='70000000-0000-4000-8000-000000000009'",
    'update sales_intelligence_case_analyses set is_current=false',
    'update sales_intelligence_attributions set is_current_evaluation=false',
    "update sales_intelligence_attributions set selected_invoice_id='other-invoice'",
    "update sales_intelligence_attributions set selected_invoice_number='wrong-number'",
    "update sales_intelligence_attributions set identity_conflict='phone_vs_customer_id_conflict'",
    'update sales_intelligence_attributions set branch_conflict=true',
    "update sales_intelligence_case_analyses set identity_customer_id='40000000-0000-4000-8000-000000000009'",
  ])('refuses stale, foreign or conflicted canonical evidence: %s', async (change) => {
    await db.exec(change);
    await expect(call()).rejects.toThrow('matched_invoice_conflict');
    expect((await db.query(`select invoice_link_confirmed from whatsapp_review_sources where id='${source}'`)).rows[0]).toEqual({invoice_link_confirmed:false});
  });
  it('never replaces a previous different confirmation', async () => {
    await db.exec(`update whatsapp_review_sources set invoice_link_confirmed=true,invoice_link_confirmed_invoice_id='previous',invoice_link_confirmed_invoice_number='previous' where id='${source}'`);
    await expect(call()).rejects.toThrow('different_invoice_already_confirmed');
  });
  it('still requires verified permission and branch scope', async () => {
    await db.exec("select set_config('test.actor_id','',false)");
    await expect(call()).rejects.toThrow('verified_staff_session_required');
    await db.exec("select set_config('test.actor_id','10000000-0000-4000-8000-000000000001',false);select set_config('test.can_edit_reviews','false',false)");
    await expect(call()).rejects.toThrow('invoice_link_confirmation_not_authorized');
    await db.exec("select set_config('test.actor_id','10000000-0000-4000-8000-000000000002',false);select set_config('test.can_edit_reviews','true',false)");
    await expect(call()).rejects.toThrow('review_source_out_of_scope');
  });
  it('is an idempotent function-only migration and preserves grants', async () => {
    const before = await db.query("select pg_get_functiondef('dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure) def,proacl from pg_proc where oid='dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure");
    await db.exec(migration);
    expect(await db.query("select pg_get_functiondef('dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure) def,proacl from pg_proc where oid='dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure")).toEqual(before);
  });
});
