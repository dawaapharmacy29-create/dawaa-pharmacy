// Builds the per-function p_actor_id classification table (all functions, no counts-only summary).
const fs = require('fs');
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bind = {
  app_staff_role: 'shared gatekeeper', app_actor_is_team_dawaa: 'shared gatekeeper',
  dawaa_can_read_conversation_review_row_v2: 'reviews', dawaa_shortage_permission_allowed_v1: 'other (shortages)',
  dawaa_customer_service_queue_scope_v3: 'other (customer service)', dawaa_can_access_customer_intelligence_branch_v2: 'other (customer service)',
  dawaa_can_manage_customer_intelligence_v2: 'other (customer service)', customer_followup_performance_v1: 'other (customer service)',
  get_customer_followup_records_v1: 'other (customer service)', update_customer_welcome_message_status: 'other (customer service)',
  save_quick_reply_script: 'other (customer service)', get_weekly_manager_metrics_cached_v1: 'HR',
  get_weekly_manager_metrics_fast_v1: 'HR', list_weekly_manager_evaluation_subjects_v1: 'HR', dawaa_can_manage_branch_targets: 'sales targets',
};
const revoke = {
  calculate_customer_loyalty_cycle_internal_v1: 'other (customer points)', submit_customer_loyalty_approval_internal_v1: 'other (customer points)',
  review_customer_loyalty_approval_internal_v1: 'other (customer points)', set_branch_daily_task_status: 'other (branch ops)',
  save_branch_sales_target_v2: 'sales targets',
};
const delegate = new Set(['app_role_allowed', 'dawaa_assert_customer_intelligence_branch_v2', 'get_customer_points_daily20_v2',
  'get_customer_service_at_risk_completion_v1', 'get_customer_service_at_risk_daily_v2', 'get_customer_service_daily_queue_completion_v1',
  'get_customer_service_daily_vip7_v2', 'get_customer_service_first_purchase_save_v2', 'get_customer_service_plus500_v2',
  'get_customer_service_recent_top50_v2', 'get_customer_service_three_cycle_intelligence_v1', 'mark_customer_points_contacted_v2',
  'get_customer_service_cycle_cohorts', 'get_customer_service_watchlist_performance', 'fetch_customer_welcome_message_logs',
  'set_branch_sales_target']);
const loyaltyWrappers = new Set(['calculate_customer_loyalty_cycle', 'review_customer_loyalty_approval', 'run_due_customer_loyalty_cycles', 'submit_customer_loyalty_approval']);
const domain = (n) => /monthly|evaluation|performance_360|doctor_customer_service/.test(n) ? 'HR'
  : /sales_target/.test(n) ? 'sales targets' : /loyalty|points/.test(n) ? 'other (customer points)'
  : /followup|customer_service|customer_request|import_/.test(n) ? 'other (customer service)' : 'other';
const short = (c) => c.split(/[\\/]src[\\/]/).pop().split('\\').join('/');
const rows = a.map((o) => {
  const n = o.name; let cls; let how;
  if (bind[n]) { cls = 'NEEDS_BINDING'; how = 'public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded)'; }
  else if (revoke[n]) { cls = 'SHOULD_REVOKE_CLIENT_EXECUTE'; how = 'revoke anon/authenticated; only definer wrappers call it'; }
  else if (!o.anon && !o.auth) { cls = 'SERVER_ONLY'; how = 'not client-executable'; }
  else if (o.viaMonthly || o.viaFollowupActor) { cls = 'SAFE_ALREADY'; how = o.viaMonthly ? 'actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared' : 'dawaa_current_followup_actor_v2 requires claimed actor = session'; }
  else if (delegate.has(n)) { cls = 'SAFE_ALREADY (via bound gatekeeper)'; how = 'only forwards p_actor_id to a gatekeeper that is now bound'; }
  else if (loyaltyWrappers.has(n)) { cls = 'SAFE_ALREADY'; how = 'resolves dawaa_current_points_actor_v1() (session); p_actor_id unused'; }
  else if (!o.anon && o.auth) { cls = 'LEGACY_UNUSED'; how = 'authenticated-only while the app runs as anon; uses verified resolver'; }
  else if (o.usesSession && !o.direct && !o.coalesceOverride) { cls = 'SAFE_ALREADY'; how = 'actor from verified session; p_actor_id unused for authorization'; }
  else { cls = 'UNKNOWN'; how = 'needs review'; }
  return [n, bind[n] || revoke[n] || domain(n), [o.anon && 'anon', o.auth && 'authenticated'].filter(Boolean).join('+') || 'none', o.lang, cls, how,
    o.callers.length ? o.callers.map(short).join('; ') : 'none on main'];
});
rows.sort((x, y) => x[4].localeCompare(y[4]) || x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]));
const counts = {}; for (const r of rows) counts[r[4]] = (counts[r[4]] || 0) + 1;
const out = ['| Function | Domain | Client exec | Lang | Class | Binding / action | Browser callers on main |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => '| `' + r[0] + '` | ' + r.slice(1).join(' | ') + ' |')];
fs.writeFileSync(process.argv[3], out.join('\n') + '\n');
console.log(rows.length, 'functions', JSON.stringify(counts));
