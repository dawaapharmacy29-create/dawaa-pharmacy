// Isolated PostgreSQL/WASM only. No Supabase URL, credentials, project or network connection.
// Install @electric-sql/pglite in scratch and pass its package entry via DAWAA_PGLITE_MODULE.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = process.env.DAWAA_PGLITE_MODULE;
if (!modulePath) throw new Error('Set DAWAA_PGLITE_MODULE to the scratch-installed pglite dist/index.js');
const moduleUrl = modulePath.startsWith('file:')
  ? modulePath
  : pathToFileURL(path.resolve(modulePath)).href;
const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
const { PGlite } = await import(moduleUrl);
const { pgcrypto } = await import(pathToFileURL(path.join(moduleDirectory, 'contrib/pgcrypto.js')).href);
const db = new PGlite({ extensions: { pgcrypto } });
try {
  const sql = (relative) => readFile(path.join(root, relative), 'utf8');
  await db.exec(await sql('supabase/tests/whatsapp_operation_attribution_session_v1.fixture.sql'));
  const customerFoundation = await sql('supabase/migrations/20260713123000_customer_data_foundation.sql');
  await db.exec(customerFoundation.slice(customerFoundation.indexOf('create or replace function'), customerFoundation.indexOf('create or replace function public.classify')));
  const originalGuard = await sql('supabase/migrations/20261005141000_whatsapp_action_truth_guard_v2.sql');
  await db.exec(originalGuard.slice(originalGuard.indexOf('create or replace function'), originalGuard.indexOf('-- Existing unmaterialized')));
  const originalResolver = await sql('supabase/migrations/20260917074500_whatsapp_followup_customer_identity_v1.sql');
  await db.exec(originalResolver.slice(0, originalResolver.indexOf('-- Backfill')));
  await db.exec(await sql('supabase/migrations/20261009130016_whatsapp_operation_attribution_session_v1.sql'));
  await db.exec((await sql('supabase/tests/whatsapp_operation_attribution_session_v1.test.sql')).replace(/rollback;\s*$/, ''));
  await verifyCanonicalWriter(db);
  await db.exec('rollback');
  console.log('PASS: actual canonical TypeScript writer + isolated PostgreSQL attribution transitions, real action guard, session/permission/scope denials, CAS retry, audit and legacy signal trigger.');
} finally { await db.close(); }

async function verifyCanonicalWriter(db) {
  // Load the actual canonical writer using the repository's TypeScript runtime discipline.
  const require = createRequire(path.join(root, 'package.json'));
  const Module = require('node:module');
  const ts = require('typescript');
  const fs = require('node:fs');
  const originalResolve = Module._resolveFilename;
  const originalTs = require.extensions['.ts'];
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  globalThis.__VITE_IMPORT_META_ENV__ = { DEV: false, PROD: true, MODE: 'test' };
  Module._resolveFilename = function(request, parent, isMain, options) {
    if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2));
    for (const ext of ['.ts', '.tsx']) if (fs.existsSync(request + ext)) return request + ext;
    return originalResolve.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function(module, filename) {
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', 'globalThis.__VITE_IMPORT_META_ENV__');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    module._compile(output, filename);
  };
  let client;
  let originalFrom;
  let originalRpc;
  try {
    globalThis.window = {};
    globalThis.localStorage = { getItem: () => 'synthetic-manager-session-token-000001' };
    client = require(path.join(root, 'src/lib/supabase.ts')).supabase;
    originalFrom = client.from; originalRpc = client.rpc;
    client.from = (table) => queryAdapter(db, table);
    client.rpc = async (fn, args) => {
      if (fn !== 'dawaa_correct_whatsapp_operation_attribution_session_v1') throw new Error('unexpected RPC');
      try {
        const values = [args.p_session_token,args.p_kind,args.p_row_id,args.p_expected_identity,
          args.p_expected_customer_id,JSON.stringify(args.p_attribution),args.p_source_id];
        const result = await db.query(`select public.${fn}($1,$2,$3,$4,$5,$6,$7) as result`, values);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    };
    const { parseWhatsAppExport, splitWhatsAppSessions } = require(path.join(root,'src/lib/whatsappConversationParser.ts'));
    const { syncWhatsAppOperationalActionsV6 } = require(path.join(root,'src/lib/whatsappOperationalIntelligenceV6.ts'));
    const { operationalActionFollowupIdentity } = require(path.join(root,'src/lib/whatsappFollowupIdentity.ts'));
    const raw = '[9/15/26, 6:00:00 AM] Customer: صباح الخير\n[9/15/26, 6:01:00 AM] Customer: عايز كونجستال\n[9/15/26, 6:02:00 AM] You: مش متوفر حاليا';
    const session = splitWhatsAppSessions(parseWhatsAppExport(raw), 120)[0];
    const evidence = [session.messages[1].id];
    const model = { customerRequests: [{ productName: 'كونجستال', unresolved: true, confidence: 90, quantity: 1,
      urgency: 'normal', evidenceMessageIds: evidence }], products: [], recommendations: [], operationalOutcome: 'open_request',
      followupPlan: { required: false, dueInDays: 1, reason: '', evidenceMessageIds: [] }, officialScoringEligible: true,
      evidence: { complaint: { messageIds: [] } } };
    const customerA = '00000000-0000-4000-8000-00000000000a';
    const customerB = '00000000-0000-4000-8000-00000000000b';
    const sourceA = '00000000-0000-4000-8000-000000000010';
    const sourceB = '00000000-0000-4000-8000-000000000011';
    await db.exec('delete from public.whatsapp_conversation_actions; alter table public.whatsapp_conversation_actions alter column id set default gen_random_uuid(); grant insert on public.whatsapp_conversation_actions to anon; create policy fixture_insert on public.whatsapp_conversation_actions for insert to anon with check(true);');
    await db.query('update public.whatsapp_review_sources set raw_text=$1', [raw]);
    const run = async (customerId, sourceId) => syncWhatsAppOperationalActionsV6(model, { sourceId, branch: 'A', customerId,
      customerCode: customerId ? customerId === customerA ? 'A' : 'B' : null,
      customerName: customerId ? customerId === customerA ? 'Customer A' : 'Customer B' : 'Customer',
      followupIdentity: { session, caseStartedAt: session.startedAt,
        legacy: { customer: customerId ? { status: 'resolved',customerId,normalizedPhone:null,customerCode:null } : null,
          caseAnchor: session.id } } });
    await db.exec('set local role anon');
    await run(customerA, sourceA);
    await db.exec('reset role');
    const original = (await db.query('select * from public.whatsapp_conversation_actions')).rows[0];
    await db.query("update public.whatsapp_conversation_actions set target_id='retained-target',target_table='customer_requests',work_status='assigned',payload=payload || '{\"unrelated\":\"preserved\"}'::jsonb where id=$1", [original.id]);
    for (const customer of [customerB, null, customerB, customerA, customerA]) {
      await db.query('update public.whatsapp_review_sources set customer_id=$1 where id=$2', [customer, sourceA]);
      await db.exec('set local role anon');
      await run(customer, sourceB);
      await db.exec('reset role');
      const rows = (await db.query('select * from public.whatsapp_conversation_actions')).rows;
      if (rows.length !== 1 || rows[0].id !== original.id || rows[0].followup_identity !== original.followup_identity ||
          rows[0].customer_id !== customer || rows[0].target_id !== 'retained-target' || rows[0].payload.unrelated !== 'preserved')
        throw new Error('canonical writer did not preserve row/identity/attribution/workflow');
    }
    // The same real writer must also find an old customer-key owner after A -> B -> NULL -> A.
    const oldKey = operationalActionFollowupIdentity({ session, caseStartedAt: session.startedAt,
      legacy: { customer: { status:'resolved',customerId:customerA,normalizedPhone:null,customerCode:null } } },
      { action_type:'customer_request',product_name:'كونجستال',evidence }).aliases[0].key;
    await db.query('update public.whatsapp_conversation_actions set followup_identity=$1 where id=$2', [oldKey, original.id]);
    for (const customer of [customerB, null, customerA]) {
      await db.query('update public.whatsapp_review_sources set customer_id=$1 where id=$2', [customer, sourceA]);
      await db.exec('set local role anon'); await run(customer, sourceB); await db.exec('reset role');
      const rows = (await db.query('select * from public.whatsapp_conversation_actions')).rows;
      if (rows.length !== 1 || rows[0].id !== original.id || rows[0].followup_identity !== oldKey || rows[0].customer_id !== customer)
        throw new Error('canonical historical correction did not converge');
    }
  } finally {
    if (client) { client.from = originalFrom; client.rpc = originalRpc; }
    Module._resolveFilename = originalResolve;
    require.extensions['.ts'] = originalTs;
    globalThis.window = oldWindow; globalThis.localStorage = oldStorage;
  }
}

function queryAdapter(db, table) {
  // Minimal PostgREST-to-SQL test adapter. PostgreSQL executes constraints, RLS, trigger and RPC;
  // no authorization, identity or mutation outcome is simulated here.
  if (!/^[a-z_]+$/.test(table)) throw new Error('invalid test table');
  let columns = '*'; let op = 'select'; let body; let conflict; let single = false; let limit;
  const clauses = []; const values = [];
  const parameter = (value) => { values.push(value); return `$${values.length}`; };
  const adapter = {
    select(value) { columns = value || '*'; return adapter; },
    eq(column,value) { clauses.push(`${column}=${parameter(value)}`); return adapter; },
    is(column,value) { if (value !== null) throw new Error('unsupported is'); clauses.push(`${column} is null`); return adapter; },
    in(column,list) { clauses.push(`${column} in (${list.map(parameter).join(',')})`); return adapter; },
    contains(column,value) { clauses.push(`${column} @> ${parameter(JSON.stringify(value))}::jsonb`); return adapter; },
    or(expression) { clauses.push('('+expression.split(',').map((part) => {
      const match = /^(\w+)\.like\.(.*)$/.exec(part); if (!match) throw new Error('unsupported OR');
      return `${match[1]} like ${parameter(match[2])}`;
    }).join(' or ')+')'); return adapter; },
    limit(value) { limit=value; return adapter; },
    single() { single=true; return adapter; },
    maybeSingle() { single=true; return adapter; },
    insert(value) { op='insert';body=value; return adapter; },
    update(value) { op='update';body=value; return adapter; },
    upsert(value,options) { op='upsert';body=value;conflict=options.onConflict; return adapter; },
    then(resolve,reject) { return execute().then(resolve,reject); },
  };
  async function execute() {
    try {
      const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';
      const rows = Array.isArray(body) ? body : [body];
      let statement;
      if (op === 'select') statement = `select ${columns} from public.${table}${where}${limit ? ` limit ${limit}` : ''}`;
      else if (op === 'update') statement = `update public.${table} set ${Object.entries(body).map(([key,value]) => `${key}=${parameter(['evidence','payload'].includes(key) ? JSON.stringify(value) : value)}`).join(',')}${where} returning ${columns}`;
      else {
        const keys = Object.keys(rows[0]);
        statement = `insert into public.${table}(${keys.join(',')}) values `+rows.map((row) => '('+keys.map((key) => parameter(['evidence','payload'].includes(key) ? JSON.stringify(row[key]) : row[key])).join(',')+')').join(',');
        if (op === 'upsert') statement += ` on conflict(${conflict}) do update set `+keys.filter((key) => key !== 'id').map((key) => `${key}=excluded.${key}`).join(',');
        statement += ` returning ${columns}`;
      }
      const result = await db.query(statement, values);
      return { data: single ? result.rows[0] || null : result.rows, error: null };
    } catch(error) { return { data: null, error }; }
  }
  return adapter;
}
