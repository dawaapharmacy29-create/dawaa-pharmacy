# Security-first identity hardening — isolated rehearsal (x-dawaa-user-id and p_actor_id)

Date: 2026-10-17.

**Production was not modified.** Every Production call was a read-only SELECT on the catalog: schema, bodies, grants and policies. No rows were read or written apart from synthetic rows inside the isolated clones.
- Not done: migrations applied to Production, pushes to `main`, deploys, commits.
- Business rows changed: **0**.

Candidate files are uncommitted in the isolated worktree `scratchpad/wtm`, detached at `main` = `fdb53454`.

## 0. How the rehearsal was isolated

| Item | What |
|---|---|
| Clone | Two dedicated databases inside the local Docker Supabase Postgres 17.6 container (same major/minor as Production 17.6): `dawaa_sec_rehearsal` (fix applied) and `dawaa_sec_baseline` (left at the pre-fix Production state). The stack's own `postgres` database was not touched. |
| Fidelity | Built from Production catalog DDL: 55+ tables (columns and PKs, no rows), every function in the security closure, the policies on those tables and the table grants. **All 163 cloned function bodies are byte-identical to Production (md5(prosrc) 163/163).** 76/77 policies loaded; the missing one is a staff-checklist submission policy whose helper is out of scope. |
| Data | Synthetic seed only: GM (شكري), branch manager (شكري), 2 pharmacists (شكري / الشامي), customer-service manager, live session tokens (sha256 stored), and one payroll statement, compensation row, event and checklist row per staff member. |
| Request emulation | Each test is one transaction doing exactly what PostgREST does: `request.jwt.claims` + `request.headers` GUCs, `SET LOCAL ROLE anon` (or `service_role`), one statement, then **ROLLBACK**. |

---

## 1. Full exposure inventory (Production, verified by the live contract)

Running `supabase/tests/identity_contract_live_v1.sql` read-only against **Production** returns exactly **48 violations**: R1 3, R2 15, R3 20, R4 7, R5 3. The pre-fix clone returns the same 48, and the fixed clone returns **0**.

### 1.1 Identity functions that trust `x-dawaa-user-id` (R1)

| Object | Type | Current auth source | Current client caller | Write | Read | Tables touched | Severity | Replacement auth source |
|---|---|---|---|---|---|---|---|---|
| `dawaa_current_staff_id_v1()` | SECDEF sql, anon-exec | `request.headers ->> 'x-dawaa-user-id'`, else `auth.uid()` | Indirect: 10 RLS policies + 9 functions (notification visibility, tasks, cleaning summaries, `get_employee_workspace_dashboard_v3`, `get_my_official_whatsapp_sales_v1`) | via `manager_daily_checklist` policy | staff, payroll statements, compensation, events, weekly evaluations, rules, cleaning ratings, notifications | `staff_accounts` | **CRITICAL** | `dawaa_session_account_id_v1()` (verified token), else `auth.uid()` |
| `dawaa_current_notification_account_id_v1()` | SECDEF sql, anon-exec | header, else `auth.uid()` | Indirect: `notifications` policy + 13 functions (inbox visibility v1/v2/v3, push register/touch/disable/bootstrap/health, overdue incidents, notification role/branch/name) | push subscriptions, overdue incidents | notifications, SLA/action events | `staff_accounts` | **HIGH** | same |
| `dawaa_has_active_app_session()` | SECDEF sql, anon-exec | header, else `auth.uid()` | Indirect: warehouse-dispatch policies, `search_products_catalog`, `create_product_catalog_item`, `record_warehouse_shortage_dispatch` | product catalog insert, shortage dispatch | warehouse dispatches and items, product catalog | `staff_accounts` | **HIGH** | same |
| `dawaa_current_user_id()` | **repo-only** (`20260705_…`, never applied to Production) | header, else `app.current_user_id` / JWT sub | Policies in that file (fresh replays only) | — | staff accounts, notifications (fresh DBs) | `staff_accounts` | MEDIUM (fresh/staging DBs only) | session, else JWT sub (conditional neutralizer in 090000) |

### 1.2 RLS policies that reference `x-dawaa-user-id`

**15 read the header inline** (R2). The earlier count of "10" was an undercount, corrected here. **13 more reach it only through the 3 functions above**; they are fixed by fixing the functions.

| Object (table.policy) | Cmd | Roles | Current auth source | Table grants (anon) | Write capability (pre-fix) | Read capability (pre-fix) | Severity | Replacement |
|---|---|---|---|---|---|---|---|---|
| `employee_compensation_profiles.employee_compensation_read_v2` | SELECT | anon, auth | own `staff_id = dawaa_current_staff_id_v1()` OR header→role ∈ {GM, EM, BrM} | S | — | victim's compensation | **CRITICAL** | strict caller (`auth.uid` kept) |
| `employee_compensation_profiles.employee_compensation_admin_insert_v2` / `_update_v2` / `_delete_v2` | I/U/D | anon, auth | header→role ∈ {GM, EM} | S only (writes blocked by grants) | inert today (no grant) | — | HIGH (latent) | strict caller |
| `employee_monthly_statements.employee_statements_read_v2` | SELECT | anon, auth | own OR header→role ∈ {GM, EM, BrM} | SIUD | — | victim's payroll statement | **CRITICAL** | strict caller |
| `employee_monthly_statements.employee_statements_admin_insert_v2` / `_update_v2` / `_delete_v2` | I/U/D | anon, auth | header→role ∈ {GM, EM} | SIUD | **reachable** if the victim is GM/EM *and* staff_accounts is readable (blocked today by staff_accounts RLS for anon) | — | **CRITICAL** | strict caller |
| `employee_events.employee_events_self_read_v1` | SELECT | anon, auth | own OR header→manager | SIUD | — | victim's HR events | HIGH | strict caller |
| `employee_events.employee_events_insert_v1` | INSERT | anon, auth | `actor_user_id = header` | SIUD | forge actor attribution | — | MEDIUM | `actor_user_id` = strict caller |
| `manager_daily_checklist.manager_daily_checklist_self_v1` | ALL | anon, auth | own OR header→manager | SIUD | **victim's checklist (proven: 1 row updated as GM)** | victim's checklist | **CRITICAL** | strict caller |
| `manager_weekly_evaluations.manager_weekly_evaluations_read_v2` | SELECT | anon, auth | subject/evaluator = current staff OR header→manager | SIUD | — | victim's evaluations | HIGH | strict caller |
| `manager_weekly_evaluations.…_admin_insert_v2` / `_update_v2` / `_delete_v2` | I/U/D | anon, auth | header→role ∈ {GM, EM, BrM} | SIUD | reachable under the same condition as statements | — | HIGH | strict caller |
| Via functions (13): `staff.staff_actor_read_v6`, `deduction_rules.…_actor_read_v10`, `reward_rules.…_actor_read_v10`, `cleaning_daily_ratings.…_read_v1`, `notifications.notifications_select_visible_v2`, `notification_action_events.…_select_visible_v1`, `notification_sla_events.…_anon_visible_v1` / `…_visible_v1`, `tasks.tasks_select_scoped_v1` / `_update_scoped_v1` / `_insert_managers_v1`, `warehouse_shortage_dispatches_read`, `warehouse_shortage_dispatch_items_read` | various | — | via `dawaa_current_staff_id_v1` / notification / app-session functions | S or SIU | tasks update/insert as victim | **staff directory (proven: 5/5 rows)**, notifications, tasks | HIGH | fixed by §1.1 (no policy change needed) |

**Proven pre-fix impact on the clone, with a forged header and no session:** the attacker became any chosen employee. They obtained that employee's identity, payroll statement, compensation, events and weekly evaluation, the full staff directory, and could update the victim's checklist.

The inline manager clause did **not** widen access to all rows for anon, because its `EXISTS` on `staff_accounts` is itself RLS-filtered. The leak is therefore per-victim, not all rows. It is still critical: anyone can impersonate the account of any employee they choose.

### 1.3 `p_actor_id` functions

70 functions take `p_actor_id`; ~56 are anon-executable. Per-function classification is in §5. Only **20** actually authorize through it (R3), and **7** internal writers are client-executable (R4).

| Object | Type | Current auth source | Client caller (main) | Write | Read | Tables | Severity | Replacement |
|---|---|---|---|---|---|---|---|---|
| `set_branch_sales_target` → `dawaa_can_manage_branch_targets(p_actor_id)` | SECDEF | `coalesce(p_actor_id, session)` | `BranchTargetEditor.tsx` | **branch sales targets (proven: pharmacist and no-session set target as GM)** | — | `branch_sales_targets` (+ its insert/update policies) | **CRITICAL** | `dawaa_bind_actor_v1` |
| `save_branch_sales_target_v2` | SECDEF | `p_actor_id` only | none | branch sales targets (proven, no session) | — | `branch_sales_targets` | **CRITICAL** | revoke client EXECUTE |
| `set_branch_daily_task_status` | SECDEF | **no authorization** | none | approve or complete any branch task (proven, no session) | — | `branch_daily_tasks` | **CRITICAL** | revoke client EXECUTE |
| `calculate_/submit_/review_customer_loyalty_approval_internal_v1` | SECDEF | `app_role_allowed(p_actor_id)` | none (definer wrappers only) | customer points requests and ledger | — | `customer_points_*`, `customer_loyalty_settings` | **CRITICAL** | revoke client EXECUTE |
| `insert_customer_points_ledger_internal_v1`, `upsert_customer_loyalty_setting_internal_v1` | SECDEF | payload `created_by` → `app_role_allowed` | none (definer wrappers only) | **points ledger row and loyalty setting inserted by anon with no session (proven, rolled back)** | — | `customer_points_ledger`, `customer_loyalty_settings` | **CRITICAL** | revoke client EXECUTE |
| `app_staff_role`, `app_actor_is_team_dawaa` (and `app_role_allowed`, which delegates) | SECDEF gatekeepers | `p_actor_id` | via welcome messages, quick replies, loyalty, product catalog import, customer-request auto-link | gate the writers above | role of any account (oracle) | `staff_accounts` | HIGH | bind |
| `dawaa_customer_service_queue_scope_v3` | SECDEF gatekeeper | `coalesce(p_actor_id, session)` | 12 CS RPCs (`CustomerDailyPriorityQueues`, `DailyCommand`, `CustomerServiceDoctorWorkbookCenter`, `mark_customer_points_contacted_v2` write) | contacted flags, top-50 cache | other branches' CS queues | customers, points, CS caches | HIGH | bind |
| `dawaa_can_access_customer_intelligence_branch_v2`, `dawaa_can_manage_customer_intelligence_v2` | SECDEF gatekeepers | `coalesce(p_actor_id, session)` | cohorts and watchlist (`customerCohortIntelligenceService`) | intelligence cache | cross-branch customer intelligence | intelligence cache | HIGH | bind |
| `customer_followup_performance_v1`, `get_customer_followup_records_v1` | SECDEF | `where id/staff_id/username = p_actor_id` | `CustomerFollowupPerformancePanel`, `CustomerFollowupRecordsAndPerformance` | — | another staff member's scope | `daily_followups` | HIGH | bind |
| `update_customer_welcome_message_status`, `save_quick_reply_script` | SECDEF | `app_*`(p_actor_id); `sent_by`/`created_by` = p_actor_id | `customerEngagement.ts`, `quickReplyScripts.ts` | welcome logs, scripts (forged attribution) | — | `customer_welcome_message_logs`, `quick_reply_scripts` | MEDIUM | bind |
| `get_weekly_manager_metrics_cached_v1` / `_fast_v1`, `list_weekly_manager_evaluation_subjects_v1` | SECDEF | `where a.id = p_actor_id` | `managerEvaluationService.ts` | metrics cache | any manager's subject list and metrics | weekly evaluation caches | HIGH | bind |
| `dawaa_can_read_conversation_review_row_v2`, `dawaa_shortage_permission_allowed_v1` | SECDEF gatekeepers (used in 26 RLS policies / definer RPCs, always with the strict id) | `p_actor_id` | none directly | — | boolean oracle for any actor | — | LOW | bind (no-op for policies) |

### 1.4 Pages and workflows that depend on these objects

- **HR / payroll:** employee 360, monthly statements, compensation, events, monthly evaluation (`StaffMonthlyEvaluationGeneral`, `MonthlyPerformanceReport360`), weekly manager evaluations, daily checklist, cleaning ratings.
- **Notifications:** bell/inbox, push registration, SLA and action events, tasks.
- **Sales targets:** dashboard `BranchTargetEditor`.
- **Customer service:** daily priority queues, `DailyCommand`, doctor workbook, cohorts/watchlist, follow-up records/performance, welcome messages, quick replies (`QuickReplies`, `CustomerServiceScriptEditor`, `WelcomeMessages`).
- **Points / loyalty:** `customerEngagement.ts` (all through session-based wrappers).
- **Warehouse / products:** shortage dispatch, product catalog search/create.
- **Login and session renewal** (`staff_account_login_v2`, `refresh_staff_login_session_v1`, `revoke_…`) depend on **none** of the changed objects (verified).
- Public routes: only `/login` and `*`.

**Additional finding, client side.** `CustomerServiceScriptEditor:146` and `QuickReplies:116` pass the draft's `created_by` as `p_actor_id` when editing. That is the **original author**, so before the fix authorization used the author's role (privilege confusion). After binding it authorizes the logged-in editor.

**Systemic root cause.** Production's `public` default privileges grant EXECUTE on every new function to `anon` and `authenticated`. `20260825233000_harden_customer_points_domain_v1` revoked the loyalty internals, and a later DROP/CREATE silently re-granted them. The upgraded gate now requires explicit revokes on new SECURITY DEFINER functions.

---

## 2. Canonical verified identity (reused; nothing invented)

| Role | Canonical object (already live in Production) |
|---|---|
| Session token / header | `x-dawaa-session-token` (opaque; sha256 matched against `staff_login_sessions`, not expired, not revoked, account active). Login refuses to proceed without it (`useAuth.ts:451`), and a lifecycle check signs out invalid sessions. |
| Current verified staff account | `dawaa_session_account_id_v1()` → `dawaa_request_staff_identifier()` → **`dawaa_current_staff_account_id_strict()`** (also maps Supabase Auth through `auth_user_id` / `user_profiles`) |
| Current staff id | `dawaa_current_actor_staff_id_v1()` (uuid); `dawaa_current_staff_id_v1()` (text) is fixed to the session in this candidate |
| Permission checker | `dawaa_current_actor_can(text[])` (GM/admin, or `get_user_permissions` of the strict account) |
| Branch scope | `dawaa_customer_request_branch_key()`, `dawaa_customer_service_branch_scope_v1()`, `employee_operating_actor_branch()`, `dawaa_current_customer_core_scope_v2()` |
| Manager / GM role | `dawaa_actor_is_top_management_v1()`, `employee_operating_actor_role()` |

All of these are byte-identical in the clone and were already session-based. The candidate only adds the reviewed binding primitives `dawaa_request_context_is_client_v1()` and `dawaa_bind_actor_v1(uuid|text)`, with bodies taken from `20261008120000`.

## 3. Corrected identity migration (not `20261008120000` as-is)

`supabase/migrations/20261017090000_security_verified_identity_readers_v1.sql`:
- **Drift guards** require exact Production md5s for the canonical chain and for the 3 functions it replaces (either the Production body or its own body, so a re-run is accepted).
- Creates `dawaa_request_context_is_client_v1` and `dawaa_bind_actor_v1(uuid/text)`.
- Rewrites only the 3 header readers. Signature, SECURITY DEFINER, Production `search_path`, owner and grants are unchanged, and the `auth.uid()` fallback is kept.
- **Conditional** neutralizer for the repo-only legacy `dawaa_current_user_id()`. It is a no-op in Production.
- Post-condition: no `public` function reads `x-dawaa-user-id`.
- It does not touch `record_conversation_review_points_v1` or any 2026-10-13 / Production-only body. That is the anchor that made `20261008120000` abort.

## 4. RLS policy hardening

`supabase/migrations/20261017090100_security_identity_rls_policies_v1.sql`:
- Uses **`ALTER POLICY`**, never DROP/CREATE. Names, command, roles and permissive mode are identical, so there is no window without a policy and no additional permissive policy can remain alongside the old one.
- Replaces only the exact fragment `COALESCE(<x-dawaa-user-id header>, auth.uid()::text)` with `COALESCE((SELECT dawaa_current_staff_account_id_strict())::text, (SELECT auth.uid())::text)`.
- **Drift guards:** the affected set must be a subset of the reviewed 15 (an extra header policy → abort), and any header reference outside the exact fragment → abort.
- Post-condition: **no policy in the whole database** reads `x-dawaa-user-id` or `request.headers`. Production has exactly these 15 header-reading policies (verified), so this holds there.
- **Permissive-OR review:** each table's other permissive policies were inspected. None reads the header, and no permissive policy wider than the fixed one exists on these tables. Proven by "unauthorized must fail" tests on every table.

| Policy | Old condition | New condition | Authorized passes? | Unauthorized fails? | Branch leak? | Write leak? |
|---|---|---|---|---|---|---|
| `employee_compensation_read_v2` | own OR header→{GM, EM, BrM} | own OR strict→{GM, EM, BrM} | YES (GM 5/5, staff own 1) | YES (forged 0, no session 0) | NO (PH Shamy 0 Shokry rows) | n/a |
| `employee_compensation_admin_insert/update/delete_v2` | header→{GM, EM} | strict→{GM, EM} | YES (role path) | YES | NO | NO (also no anon grant) |
| `employee_statements_read_v2` | own OR header→{GM, EM, BrM} | own OR strict→{GM, EM, BrM} | YES (GM 5, staff 1) | YES (forged `<none>`; PH2 + forged GM header returns only PH2's own row) | NO | n/a |
| `employee_statements_admin_insert/update/delete_v2` | header→{GM, EM} | strict→{GM, EM} | YES (GM insert = 1) | YES (forged / staff / no session → RLS error) | NO | NO |
| `employee_events_self_read_v1` | own OR header→managers | own OR strict→managers | YES (GM 5, staff 1) | YES (forged 0) | NO | n/a |
| `employee_events_insert_v1` | `actor_user_id` null OR = header | null OR = strict | YES | YES (cannot claim another actor) | NO | NO |
| `manager_daily_checklist_self_v1` | own OR header→managers | own OR strict→managers | YES (staff own 1, GM 5) | YES (forged update 0) | NO (BM cannot update PH2) | NO |
| `manager_weekly_evaluations_read_v2` | subject/evaluator OR header→{GM, EM, BrM} | … OR strict→… | YES (GM 2, PH1 1) | YES (forged 0) | NO | n/a |
| `manager_weekly_evaluations_admin_insert/update/delete_v2` | header→{GM, EM, BrM} | strict→{GM, EM, BrM} | YES (role path) | YES (forged delete 0; BM cross-branch insert → RLS error) | NO | NO |
| 13 function-based policies | via the 3 header functions | unchanged text; the functions are now session-based | YES (150/150 identical flows) | YES (forged staff directory 0) | NO | NO |

## 5. `p_actor_id` hardening, classified and grouped

Migrations by risk/domain. Each one rewrites the **current live body in place** and aborts unless md5 = the reviewed Production body. This rules out regressing a newer function to an older repo body.

| Migration | Domain | Functions | Action |
|---|---|---|---|
| `20261017090200_security_actor_binding_shared_gatekeepers_v1` | shared + reviews + shortages | `app_staff_role`, `app_actor_is_team_dawaa`, `dawaa_can_read_conversation_review_row_v2`, `dawaa_shortage_permission_allowed_v1` | bind |
| `20261017090300_security_actor_binding_customer_service_v1` | customer service | queue scope v3, 2 customer-intelligence gatekeepers, follow-up performance/records, welcome status, quick reply | bind |
| `20261017090400_security_actor_binding_hr_weekly_evaluations_v1` | HR | weekly metrics cached/fast, weekly subjects | bind |
| `20261017090500_security_actor_binding_sales_targets_v1` | sales targets | `dawaa_can_manage_branch_targets` | bind |
| `20261017090600_security_revoke_client_internal_actor_writers_v1` | customer points + branch ops + sales targets | 3 loyalty internals, points-ledger internal, loyalty-setting internal, `set_branch_daily_task_status`, `save_branch_sales_target_v2` | revoke anon/authenticated (aborts if any SECURITY INVOKER function or RLS policy calls them) |

**How binding works.** In client requests, a `p_actor_id` naming the verified caller is kept, and anything else becomes the verified caller (NULL without a session). Cron, migrations and `service_role` pass through.
- plpgsql: `p_actor_id := public.dawaa_bind_actor_v1(p_actor_id);` runs before the original block, which becomes an unchanged nested block. Its DECLARE initializers, such as `coalesce(p_actor_id, …)`, therefore see the verified caller.
- SQL functions: `p_actor_id` → `(select public.dawaa_bind_actor_v1(p_actor_id))`, evaluated once per call (InitPlan).
- Nothing is deleted. Unused functions are left in place.

**Classification counts:**

| Class | Count |
|---|---|
| NEEDS_BINDING | 15 |
| SHOULD_REVOKE_CLIENT_EXECUTE | 5, plus 2 payload-actor internals |
| SAFE_ALREADY | 26 |
| SAFE_ALREADY (via a now-bound gatekeeper) | 16 |
| SERVER_ONLY | 8 |
| LEGACY_UNUSED | 0 |
| UNKNOWN | 0 |

Full per-function table:

| Function | Domain | Client exec | Lang | Class | Binding / action | Browser callers on main |
|---|---|---|---|---|---|---|
| `get_weekly_manager_metrics_cached_v1` | HR | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | lib/evaluations/managerEvaluationService.ts |
| `get_weekly_manager_metrics_fast_v1` | HR | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | lib/evaluations/managerEvaluationService.ts |
| `list_weekly_manager_evaluation_subjects_v1` | HR | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | lib/evaluations/managerEvaluationService.ts |
| `customer_followup_performance_v1` | other (customer service) | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | components/customerService/CustomerFollowupPerformancePanel.tsx |
| `dawaa_can_access_customer_intelligence_branch_v2` | other (customer service) | anon+authenticated | sql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `dawaa_can_manage_customer_intelligence_v2` | other (customer service) | anon+authenticated | sql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `dawaa_customer_service_queue_scope_v3` | other (customer service) | anon+authenticated | sql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `get_customer_followup_records_v1` | other (customer service) | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | components/customerService/CustomerFollowupRecordsAndPerformance.tsx |
| `save_quick_reply_script` | other (customer service) | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | lib/quickReplyScripts.ts |
| `update_customer_welcome_message_status` | other (customer service) | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | lib/customerEngagement.ts |
| `dawaa_shortage_permission_allowed_v1` | other (shortages) | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `dawaa_can_read_conversation_review_row_v2` | reviews | anon+authenticated | sql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `dawaa_can_manage_branch_targets` | sales targets | anon+authenticated | plpgsql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `app_actor_is_team_dawaa` | shared gatekeeper | anon+authenticated | sql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `app_staff_role` | shared gatekeeper | anon+authenticated | sql | NEEDS_BINDING | public.dawaa_bind_actor_v1(p_actor_id) inserted into the live body (md5-guarded) | none on main |
| `can_view_monthly_performance_360_safe` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | lib/reports/monthlyPerformance360ScopedService.ts |
| `get_doctor_customer_service_evaluation_safe` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/CustomerServiceDoctorEvaluation.tsx |
| `get_staff_monthly_evaluation_audit_v5` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | components/evaluations/MonthlyEvaluationAuditTrailV5.tsx |
| `get_staff_monthly_evaluation_employee_response_v5` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/StaffMonthlyEvaluationGeneral.tsx |
| `get_staff_monthly_evaluation_evidence_drift_v5` | HR | authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | none on main |
| `get_staff_monthly_evaluation_safe` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | lib/reports/monthlyPerformance360Service.ts |
| `get_staff_monthly_evaluation_v5` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | lib/evaluations/doctorDecisionDataService.ts; pages/StaffMonthlyEvaluationGeneral.tsx |
| `list_doctors_for_customer_service_evaluation_safe` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/CustomerServiceDoctorEvaluation.tsx |
| `list_staff_for_monthly_evaluation_safe` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | none on main |
| `list_staff_for_monthly_evaluation_v5` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/StaffMonthlyEvaluationGeneral.tsx |
| `list_staff_for_monthly_performance_360_safe` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/MonthlyPerformanceReport360.tsx |
| `list_staff_monthly_evaluation_response_status_v5` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/StaffMonthlyEvaluationGeneral.tsx |
| `monthly_eval_actor` | HR | anon+authenticated | sql | SAFE_ALREADY | actor from verified session; p_actor_id unused for authorization | none on main |
| `respond_staff_monthly_evaluation_v5` | HR | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/StaffMonthlyEvaluationGeneral.tsx |
| `save_doctor_customer_service_evaluation_safe` | HR | authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/CustomerServiceDoctorEvaluation.tsx |
| `save_staff_monthly_evaluation_v5` | HR | authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | pages/StaffMonthlyEvaluationGeneral.tsx |
| `calculate_customer_loyalty_cycle` | other (customer points) | anon+authenticated | plpgsql | SAFE_ALREADY | resolves dawaa_current_points_actor_v1() (session); p_actor_id unused | lib/customerEngagement.ts |
| `review_customer_loyalty_approval` | other (customer points) | anon+authenticated | plpgsql | SAFE_ALREADY | resolves dawaa_current_points_actor_v1() (session); p_actor_id unused | none on main |
| `run_due_customer_loyalty_cycles` | other (customer points) | anon+authenticated | plpgsql | SAFE_ALREADY | resolves dawaa_current_points_actor_v1() (session); p_actor_id unused | lib/customerEngagement.ts |
| `submit_customer_loyalty_approval` | other (customer points) | anon+authenticated | plpgsql | SAFE_ALREADY | resolves dawaa_current_points_actor_v1() (session); p_actor_id unused | none on main |
| `dawaa_cancel_customer_followup_v1` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY | actor from verified session; p_actor_id unused for authorization | lib/api/customerServiceCommandCenter.ts; lib/api/customerServiceSecureActions.ts |
| `dawaa_complete_customer_followup_v1` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY | actor from verified session; p_actor_id unused for authorization | lib/api/customerServiceSecureActions.ts |
| `dawaa_log_customer_followup_event_v1` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY | actor from verified session; p_actor_id unused for authorization | none on main |
| `import_customer_followup_results_v1` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY | dawaa_current_followup_actor_v2 requires claimed actor = session | components/customerService/FollowupResultsExcelImportModal.tsx |
| `import_customer_service_queue_results_v4` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY | dawaa_current_followup_actor_v2 requires claimed actor = session | components/customerService/CustomerServiceDoctorWorkbookCenter.tsx; components/customerService/SmartQueueExcelImportModal.tsx |
| `save_branch_sales_target_safe` | sales targets | anon+authenticated | plpgsql | SAFE_ALREADY | actor = monthly_eval_actor() = verified session; p_actor_id ignored or compared | none on main |
| `app_role_allowed` | other | anon+authenticated | sql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | none on main |
| `dawaa_assert_customer_intelligence_branch_v2` | other | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | none on main |
| `fetch_customer_welcome_message_logs` | other | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | lib/customerEngagement.ts |
| `get_customer_points_daily20_v2` | other (customer points) | anon+authenticated | sql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx; components/customerService/CustomerServiceDoctorWorkbookCenter.tsx |
| `mark_customer_points_contacted_v2` | other (customer points) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx |
| `get_customer_service_at_risk_completion_v1` | other (customer service) | anon+authenticated | sql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx; pages/DailyCommand.tsx |
| `get_customer_service_at_risk_daily_v2` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx |
| `get_customer_service_cycle_cohorts` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | lib/customerService/customerCohortIntelligenceService.ts |
| `get_customer_service_daily_queue_completion_v1` | other (customer service) | anon+authenticated | sql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx |
| `get_customer_service_daily_vip7_v2` | other (customer service) | anon+authenticated | sql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx; components/customerService/CustomerServiceDoctorWorkbookCenter.tsx |
| `get_customer_service_first_purchase_save_v2` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx |
| `get_customer_service_plus500_v2` | other (customer service) | anon+authenticated | sql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx; components/customerService/CustomerServiceDoctorWorkbookCenter.tsx |
| `get_customer_service_recent_top50_v2` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx; components/customerService/CustomerServiceDoctorWorkbookCenter.tsx |
| `get_customer_service_three_cycle_intelligence_v1` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/customerService/CustomerDailyPriorityQueues.tsx; components/customerService/CustomerServiceDoctorWorkbookCenter.tsx |
| `get_customer_service_watchlist_performance` | other (customer service) | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | lib/customerService/customerCohortIntelligenceService.ts |
| `set_branch_sales_target` | sales targets | anon+authenticated | plpgsql | SAFE_ALREADY (via bound gatekeeper) | only forwards p_actor_id to a gatekeeper that is now bound | components/dashboard/BranchTargetEditor.tsx |
| `save_staff_monthly_evaluation_safe` | HR | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `dawaa_can_access_review_coverage_branch_v1` | other | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `run_due_customer_loyalty_cycles_internal_v1` | other (customer points) | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `dawaa_customer_request_permission_allowed` | other (customer service) | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `import_customer_followup_results_legacy_v1` | other (customer service) | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `import_customer_service_queue_results_legacy_v4` | other (customer service) | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `import_customer_service_queue_results_v2` | other (customer service) | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `import_customer_service_queue_results_v3` | other (customer service) | none | plpgsql | SERVER_ONLY | not client-executable | none on main |
| `set_branch_daily_task_status` | other (branch ops) | anon+authenticated | plpgsql | SHOULD_REVOKE_CLIENT_EXECUTE | revoke anon/authenticated; only definer wrappers call it | none on main |
| `calculate_customer_loyalty_cycle_internal_v1` | other (customer points) | anon+authenticated | plpgsql | SHOULD_REVOKE_CLIENT_EXECUTE | revoke anon/authenticated; only definer wrappers call it | none on main |
| `review_customer_loyalty_approval_internal_v1` | other (customer points) | anon+authenticated | plpgsql | SHOULD_REVOKE_CLIENT_EXECUTE | revoke anon/authenticated; only definer wrappers call it | none on main |
| `submit_customer_loyalty_approval_internal_v1` | other (customer points) | anon+authenticated | plpgsql | SHOULD_REVOKE_CLIENT_EXECUTE | revoke anon/authenticated; only definer wrappers call it | none on main |
| `save_branch_sales_target_v2` | sales targets | anon+authenticated | plpgsql | SHOULD_REVOKE_CLIENT_EXECUTE | revoke anon/authenticated; only definer wrappers call it | none on main |

## 6. Isolated rehearsal results

| Test set | Pre-fix (baseline = Production behaviour) | Post-fix |
|---|---|---|
| Security suite (58 cases: A–F + server) | 58/58 expectations match the **vulnerable** behaviour (exposure reproduced) | **58/58 pass** (`results_post.json`); 58/58 again after rollback + re-apply |
| Differential legitimate flows (5 accounts × 30 calls = 150, with the real client headers) | — | **150/150 identical** to baseline. The 11 errors are legitimate business refusals, identical on both sides. |
| Live contract (`identity_contract_live_v1.sql`) | 48 violations (same 48 as Production) | **0** |
| Idempotency (re-apply all 7) | — | function and policy catalog hashes unchanged; bindings report `already_bound`; policies report "already applied" |
| Drift guards (on baseline, rolled back) | — | D1 identity body drift → abort; D2 extra header policy → abort; D3 newer target body → abort (no stale overwrite); D4 binding before primitives → abort; D5 revoke target with a SECURITY INVOKER caller → abort; D6 control: full chain applies |
| Rollback (`supabase/sql/ROLLBACK_20261017_security_identity_hardening_v1.sql`) | — | applied to the rehearsal: every function body, config and SECURITY DEFINER flag plus all 76 policies identical to baseline. ACLs carry the same grants, only array order differs. |
| Legacy neutralizer | — | repo-only `dawaa_current_user_id()` with a forged header → NULL after 090000 |

| Requirement | Result |
|---|---|
| A) Valid manager | GM identity from the session; reads 5/5 statements, compensation and evaluations; inserts a statement; sets the sales target (with own id and with NULL); queue scope `ALL` |
| B) Valid staff | own statement, compensation and evaluation only (1); cannot insert a statement; cannot set a target; updates only own checklist |
| C) No session | 0 protected rows; writes refused; `has_active_app_session` false |
| D) Forged `x-dawaa-user-id` | identity NULL; victim payroll / compensation / events / evaluations / staff directory 0; checklist update 0; delete 0; a real PH2 session plus a forged GM header returns PH2 only |
| E) Forged `p_actor_id` | sales target refused (with session and without); `save_branch_sales_target_v2`, `set_branch_daily_task_status`, loyalty and points internals → permission denied; `app_staff_role(GM)` NULL; queue scope stays the caller's own; weekly subjects as GM = 0 |
| F) Wrong branch | PH Shamy reads 0 Shokry statements; BM cannot update PH2's checklist; BM cross-branch weekly insert refused; PH2 queue scope = الشامي only |
| G) Existing flows | login and session RPCs untouched (verified); HR, payroll, attendance-adjacent, review, CS and sales-target reads/writes 150/150 identical; definer wrappers still reach revoked internals (GM loyalty call reaches the internal's own "setting not found") |

Repo gates on the candidate tree:

| Gate | Result |
|---|---|
| Upgraded identity check | PASS |
| Generated-API parity | PASS after regeneration |
| Timezone gate | PASS (Golden Case #1 identical in 4 zones) |
| `run-tests` | **1048 passed, 0 failed** (+1 new header test) |
| TypeScript | PASS |
| Header unit test | 6/6 |

## 7. Regression protection

1. **Live contract** `supabase/tests/identity_contract_live_v1.sql` (read-only; any DB). It checks the catalog as it actually is:
   - R1: no function reads the header;
   - R2: no policy reads the header or `request.headers`;
   - R3: no client-executable SECURITY DEFINER function uses `p_actor_id` without binding or a verified resolver;
   - R4: the reviewed internal writers are not client-executable;
   - R5: the canonical primitives exist and are session-derived.

   It catches Production-only edits, drift and default-privilege re-grants. It is not a single-file regex.
2. **`scripts/check-verified-session-identity.cjs` (rewritten; already in `quality-gate.yml` and `integration-final-runtime-gate.yml`).**
   - The old version only checked that one migration *file* had the right clauses, and passed while Production was exposed.
   - The new version replays **every migration** in order, honoring CREATE / ALTER / DROP of functions and policies, and fails if any object's **effective last definition** trusts the header unless the security migrations neutralize it.
   - **Forward rules** apply to every migration after `090600`:
     - no header;
     - no `coalesce(p_actor_id, …)`;
     - any function using `p_actor_id` must bind it, use a verified resolver, or revoke client EXECUTE;
     - every new SECURITY DEFINER function needs an explicit revoke (default-privilege trap);
     - no re-grant of the revoked writers;
     - no unbound redefinition of a bound function.
   - **Client:** no `src` file may reference `x-dawaa-user-id`; only `src/lib/supabase.ts` may set identity headers; every `p_actor_id:` value in the browser must be a reviewed logged-in-user expression.
   - **Proven:** 7 planted violations (N1–N7) all fail the check; one legitimate bound+revoked function (P1) passes; the real tree passes.
3. **Unit test:** `requestIdentityHeaders.test.ts` asserts that the client never adds `x-dawaa-user-id`, even with a stored user record.

## 8. Production effect preview (nothing applied)

**OBJECTS_CHANGED**
- 3 functions created;
- 3 header readers replaced;
- 15 functions rewritten in place (binding);
- 15 policies altered;
- grants on 7 functions;
- 0 tables;
- 1 conditional repo-only function (no-op in Production).

**FUNCTIONS_REPLACED**
- New body: `dawaa_current_staff_id_v1`, `dawaa_current_notification_account_id_v1`, `dawaa_has_active_app_session`.
- In-place binding:
  - shared: `app_staff_role`, `app_actor_is_team_dawaa`, `dawaa_can_read_conversation_review_row_v2`, `dawaa_shortage_permission_allowed_v1`;
  - customer service: `dawaa_customer_service_queue_scope_v3`, `dawaa_can_access_customer_intelligence_branch_v2`, `dawaa_can_manage_customer_intelligence_v2`, `customer_followup_performance_v1`, `get_customer_followup_records_v1`, `update_customer_welcome_message_status`, `save_quick_reply_script`;
  - HR: `get_weekly_manager_metrics_cached_v1`, `get_weekly_manager_metrics_fast_v1`, `list_weekly_manager_evaluation_subjects_v1`;
  - sales targets: `dawaa_can_manage_branch_targets`.
- New: `dawaa_request_context_is_client_v1()`, `dawaa_bind_actor_v1(uuid)`, `dawaa_bind_actor_v1(text)`.

**POLICIES_DROPPED:** none (ALTER only).

**POLICIES_CREATED:** none.

**POLICIES_ALTERED (15):**
- compensation: read / admin insert / update / delete;
- statements: read / admin insert / update / delete;
- events: read / insert;
- `manager_daily_checklist_self_v1`;
- weekly evaluations: read / admin insert / update / delete.

**GRANTS_CHANGED**
- REVOKE EXECUTE FROM public, anon, authenticated (+ GRANT `service_role`) on: `calculate_customer_loyalty_cycle_internal_v1`, `submit_customer_loyalty_approval_internal_v1`, `review_customer_loyalty_approval_internal_v1`, `insert_customer_points_ledger_internal_v1`, `upsert_customer_loyalty_setting_internal_v1`, `set_branch_daily_task_status`, `save_branch_sales_target_v2`.
- GRANT EXECUTE to anon, authenticated, `service_role` on the 3 new primitives.

**BUSINESS_ROWS_CHANGED:** 0. There is no top-level DML; the only writes are catalog DDL.

**EXPECTED_CLIENT_BREAKAGE**
- None for logged-in users (150/150 identical calls).
- Intended refusals:
  1. a request with no valid session that relied on the header alone;
  2. editing a quick-reply script whose *author* is authorized when the *editor* is not;
  3. any caller passing another person's `p_actor_id` to the bound functions.
- Test infrastructure: `scripts/staging/run-fresh-staging.mjs` simulates identity with `x-dawaa-user-id` and must move to session tokens (follow-up; not in this round).
- **Deploy order:** DB migrations first (the old client's hint becomes harmless), then the client change (hint removed).

**ROLLBACK_STRATEGY**
- Forward-fix is preferred. The emergency `ROLLBACK_20261017_security_identity_hardening_v1.sql` restores exact Production bodies, policies and grants in one transaction; rehearsed to baseline equality. It **re-opens** the exposure, so use it only for a confirmed outage.
- Each migration is atomic per file. Any guard failure aborts with no partial state.

**FAILURE_MODES**
1. **Drift:** a guard aborts because Production changed after capture (safe; re-capture and re-review).
2. **Performance:** `dawaa_can_read_conversation_review_row_v2` is evaluated per row inside WhatsApp RLS policies, and binding adds one session lookup per call. The tables are small today (113 sources, 239 actions), but run EXPLAIN ANALYZE at Production volume first.
3. **Missed objects:** a future SECURITY DEFINER function created without explicit revokes. The default privileges remain systemic, so the gate and the live contract catch it, but the default ACL itself is unchanged in this round.
4. **Logged-out clients:** clients with an expired session lose header-only identity, by design.
5. **Sessionless server paths:** none found. Every server path uses `service_role`, which passes through.

## 9. Not mixed in (security only)

Untouched this round:
- Source Gate;
- Golden source contamination;
- the Doctor Eye legacy KPI;
- the 11 WhatsApp / SI / review / follow-up migrations;
- follow-up migrations;
- invoice confirmation;
- old SI data.

The only SI-adjacent file is the **regenerated** `api/sales-intelligence-refresh-source.js`. It inlines `src/lib/supabase.ts`, and the diff is exactly the 19 removed hint lines; parity check passes.

## 10. Final verdict

| Item | Verdict |
|---|---|
| SECURITY_EXPOSURE_FULLY_INVENTORIED | **YES** (live contract on Production = the same 48 objects; plus 1 repo-only legacy reader) |
| CANONICAL_VERIFIED_IDENTITY_REUSED | **YES** (`dawaa_session_account_id_v1` / `dawaa_current_staff_account_id_strict` / `dawaa_current_actor_can`; reviewed bind primitives from `20261008120000`) |
| X_DAWAA_USER_ID_TRUST_REMOVED_IN_REHEARSAL | **YES** (R1 = R2 = 0) |
| P_ACTOR_ID_IMPERSONATION_BLOCKED_IN_REHEARSAL | **YES** (R3 = R4 = 0; E-tests pass) |
| RLS_POLICIES_HARDENED_IN_REHEARSAL | **YES** (15 altered; no permissive leftovers; post-condition is database-wide) |
| VALID_MANAGER_FLOW_PASS | **YES** |
| VALID_STAFF_FLOW_PASS | **YES** |
| NO_SESSION_PASS | **YES** |
| FORGED_HEADER_TEST_PASS | **YES** |
| FORGED_ACTOR_ID_TEST_PASS | **YES** |
| CROSS_BRANCH_TEST_PASS | **YES** |
| BUSINESS_ROWS_CHANGED | **0** |
| PRODUCTION_APPLY_READY | **NO** |

Why PRODUCTION_APPLY_READY is NO:
- **Pending:**
  - human security review of the 7 candidates;
  - commit to a branch, PR and CI;
  - Production-volume EXPLAIN of the per-row binding inside WhatsApp RLS;
  - a fresh md5 re-capture right before apply (the guards enforce it);
  - explicit approval.
- **Known limits of the rehearsal:**
  - SQL-level PostgREST emulation, not HTTP through PostgREST;
  - a subset clone (163 functions, 76/77 policies);
  - UI pages not driven in a browser.

**EXACT_FILES_CREATED_OR_CHANGED** (isolated worktree `scratchpad/wtm`, uncommitted, base `fdb53454`):

| Status | File | sha256 (first 16 hex) |
|---|---|---|
| new | `supabase/migrations/20261017090000_security_verified_identity_readers_v1.sql` | `c6e3f6bb62326e76` |
| new | `supabase/migrations/20261017090100_security_identity_rls_policies_v1.sql` | `04a4e2c741b62948` |
| new | `supabase/migrations/20261017090200_security_actor_binding_shared_gatekeepers_v1.sql` | `fea57ec279b79755` |
| new | `supabase/migrations/20261017090300_security_actor_binding_customer_service_v1.sql` | `da34da593fba1652` |
| new | `supabase/migrations/20261017090400_security_actor_binding_hr_weekly_evaluations_v1.sql` | `d247750bd46a5281` |
| new | `supabase/migrations/20261017090500_security_actor_binding_sales_targets_v1.sql` | `d9b887523cbae9a4` |
| new | `supabase/migrations/20261017090600_security_revoke_client_internal_actor_writers_v1.sql` | `183c109fabe0b53b` |
| new | `supabase/sql/ROLLBACK_20261017_security_identity_hardening_v1.sql` | `9162c31790d41eab` |
| new | `supabase/tests/identity_contract_live_v1.sql` | `0074bedcc0d0ddae` |
| modified | `scripts/check-verified-session-identity.cjs` | — |
| modified | `src/lib/supabase.ts` (hint header removed) | — |
| modified | `src/lib/auth/__tests__/requestIdentityHeaders.test.ts` | — |
| regenerated | `api/sales-intelligence-refresh-source.js` | — |

Rehearsal artifacts live in `scratchpad/sec/`: clone DDL, seed, runners, and results `results_pre.json`, `results_post.json`, `results_flows.json`. The two local Docker databases `dawaa_sec_rehearsal` and `dawaa_sec_baseline` are kept for review.

**NEXT_SINGLE_ACTION:** human security review of the 7 candidate migrations plus the upgraded gate. After that, commit them on a dedicated `security/identity-hardening-v1` branch and open a PR so CI runs; this round neither commits nor applies.
