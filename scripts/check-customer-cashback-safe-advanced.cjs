const fs = require('node:fs');

const wrapper = fs.readFileSync('src/pages/CustomerCashback.tsx', 'utf8');
const safe = fs.readFileSync('src/pages/CustomerCashbackAdvancedSafe.tsx', 'utf8');
const legacy = fs.readFileSync('src/pages/CustomerCashbackBase.tsx', 'utf8');

const fail = (message) => { console.error(`[cashback-safe-advanced] ${message}`); process.exit(1); };

if (!wrapper.includes("import('@/pages/CustomerCashbackAdvancedSafe')")) fail('Advanced mode is not routed to CustomerCashbackAdvancedSafe.');
if (wrapper.includes("import('@/pages/CustomerCashbackBase')")) fail('Legacy advanced page is still reachable from the primary cashback route.');

for (const rpc of [
  'dawaa_customer_cashback_account_action_v1',
  'dawaa_customer_cashback_action_v1',
  'dawaa_customer_cashback_manual_upsert_v1',
  'dawaa_customer_cashback_import_batch_v1',
]) {
  if (!safe.includes(rpc)) fail(`Safe advanced page is missing ${rpc}.`);
}

for (const directMutation of [
  ".from('customer_cashback_cycles').update",
  ".from('customer_cashback_cycles').upsert",
  ".from('customer_cashback_accounts').upsert",
  ".from('customer_cashback_events').insert",
]) {
  if (safe.includes(directMutation)) fail(`Direct mutation found in safe advanced page: ${directMutation}`);
}

if (!legacy.includes("onConflict: 'customer_code'")) {
  console.warn('[cashback-safe-advanced] Legacy page no longer uses customer_code conflict; consider removing compatibility comments.');
}

console.log('[cashback-safe-advanced] OK: advanced cashback route uses guarded RPC commands only.');
