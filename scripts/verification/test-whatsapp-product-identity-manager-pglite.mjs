import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const db = new PGlite();
const uuid = {
  actor: '11111111-1111-4111-8111-111111111111',
  source: '22222222-2222-4222-8222-222222222222',
  analysis: '33333333-3333-4333-8333-333333333333',
  product: '44444444-4444-4444-8444-444444444444',
  line: '55555555-5555-4555-8555-555555555555',
};
const caseId = `${uuid.source}:interaction:0`;
const itemId = `${caseId}:basket:1:item:0`;
const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261027090000_whatsapp_product_identity_manager_review_v1.sql', import.meta.url)), 'utf8');

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema if not exists public;
    create table public.staff_accounts (id uuid primary key, staff_name text, name text, active boolean, can_login boolean);
    create table public.whatsapp_review_sources (id uuid primary key, invoice_link_confirmed boolean, invoice_link_confirmed_invoice_id text, source_hash text);
    create table public.products (id uuid primary key, product_code text, name text);
    create table public.sales_invoice_items_v21 (
      id uuid primary key, invoice_id text, product_id text, product_code text,
      quantity numeric, raw_data jsonb
    );
    create table public.sales_intelligence_current_case_analyses (case_id text primary key, analysis_id uuid, evidence_snapshot jsonb);
    create table public.sales_intelligence_current_attributions (case_id text primary key, analysis_id uuid, selected_invoice_id text);
    create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable as $$ select '${uuid.actor}'::uuid $$;
    create function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable as $$ select true $$;
    create function public.dawaa_current_actor_can(text[]) returns boolean language sql stable as $$ select true $$;
  `);
  await db.exec(migration);
  const snapshot = { caseIntelligence: { caseId, basket: { activeItems: [{
    itemId, sourceMessageId: 'message-1', productNameRaw: 'لبن هيرو بيبي 2',
    productId: uuid.product, productCode: '47797', quantity: 1, resolutionStatus: 'partially_proven',
  }] } } };
  await db.query('insert into public.staff_accounts values ($1,$2,$3,true,true)', [uuid.actor, 'دكتور معاذ', 'معاذ']);
  await db.query('insert into public.whatsapp_review_sources values ($1,true,$2,$3)', [uuid.source, 'invoice-1', 'immutable-source-hash']);
  await db.query('insert into public.products values ($1,$2,$3)', [uuid.product, '47797', 'HERO BABY MILK 2']);
  await db.query('insert into public.sales_invoice_items_v21 values ($1,$2,$3,$4,$5,$6)', [uuid.line, 'invoice-1', uuid.product, '47797', 1, JSON.stringify({ returned: 0 })]);
  await db.query('insert into public.sales_intelligence_current_case_analyses values ($1,$2,$3)', [caseId, uuid.analysis, JSON.stringify(snapshot)]);
  await db.query('insert into public.sales_intelligence_current_attributions values ($1,$2,$3)', [caseId, uuid.analysis, 'invoice-1']);

  const call = (note = 'راجعت الكود مع الصنف', overrideLine = uuid.line) => db.query(
    'select public.dawaa_confirm_whatsapp_product_identity_v1($1,$2,$3,$4,$5,$6) as result',
    [uuid.source, caseId, uuid.analysis, itemId, overrideLine, note]
  );
  async function expectFailure(label, action, expected) {
    try { await action(); } catch (error) {
      if (!String(error.message).includes(expected)) throw new Error(`${label}: unexpected ${error.message}`);
      return;
    }
    throw new Error(`${label}: unexpectedly succeeded`);
  }

  await expectFailure('missing note', () => call('قصير'), 'product_identity_review_note_required');
  await expectFailure('wrong line', () => call('راجعت كل الأدلة', '66666666-6666-4666-8666-666666666666'), 'product_identity_invoice_line_mismatch');
  await db.exec('update public.whatsapp_review_sources set invoice_link_confirmed = false');
  await expectFailure('unconfirmed invoice', () => call(), 'product_identity_invoice_unconfirmed');
  await db.exec('update public.whatsapp_review_sources set invoice_link_confirmed = true');
  await db.exec('update public.sales_invoice_items_v21 set quantity = 2');
  await expectFailure('quantity mismatch', () => call(), 'product_identity_quantity_mismatch');
  await db.exec('update public.sales_invoice_items_v21 set quantity = 1');
  await db.exec(`create or replace function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable as $$ select false $$`);
  await expectFailure('non-manager', () => call(), 'product_identity_review_not_authorized');
  await db.exec(`create or replace function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable as $$ select true $$`);
  const first = (await call()).rows[0].result;
  if (first.ok !== true || first.idempotent !== false) throw new Error('first decision not saved');
  const replay = (await call()).rows[0].result;
  if (replay.idempotent !== true || replay.review_id !== first.review_id) throw new Error('duplicate decision inserted');
  const history = await db.query('select public.dawaa_list_whatsapp_product_identity_reviews_v1($1) as result', [caseId]);
  if (history.rows[0].result.length !== 1 || history.rows[0].result[0].basketItemId !== itemId) {
    throw new Error('persisted decision history not readable');
  }
  await db.exec(`create or replace function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable as $$ select false $$`);
  await expectFailure('non-manager history', () => db.query('select public.dawaa_list_whatsapp_product_identity_reviews_v1($1)', [caseId]), 'product_identity_reviews_not_authorized');
  await db.exec(`create or replace function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable as $$ select true $$`);
  const count = await db.query('select count(*)::integer as count from public.whatsapp_product_identity_manager_reviews_v1');
  if (count.rows[0].count !== 1) throw new Error('wrong audit count');
  const acl = await db.query(`select has_table_privilege('anon','public.whatsapp_product_identity_manager_reviews_v1','insert') as insert_allowed,
    has_table_privilege('authenticated','public.whatsapp_product_identity_manager_reviews_v1','update') as update_allowed,
    has_table_privilege('anon','public.whatsapp_product_identity_manager_reviews_v1','select') as read_allowed`);
  if (Object.values(acl.rows[0]).some(Boolean)) throw new Error('public table privilege leaked');
  console.log('PASS: migration + manager decision + refusal + idempotency + restricted table ACL');
} finally {
  await db.close();
}
