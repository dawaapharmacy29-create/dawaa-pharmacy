-- Assertions after 20261009080000 (Base44 service actor) + 20261009081000 (verified session identity).
-- Identity, sessions, notifications identity, p_actor_id binding, the review-points command and the
-- Base44 purchase-invoice sync, through the real production identity chain (01b_identity_platform.sql).
\set ON_ERROR_STOP on
\set GM '''aaaaaaaa-0000-0000-0000-000000000001'''
\set SM '''aaaaaaaa-0000-0000-0000-000000000002'''
\set DIS '''aaaaaaaa-0000-0000-0000-000000000006'''

-- 1. Who is the caller?
select test_assert((test_request('anon', '{}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'no headers: no identity');
select test_assert((test_request('anon', '{"x-dawaa-user-id":"aaaaaaaa-0000-0000-0000-000000000001"}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'forged x-dawaa-user-id (GM account id) is ignored');
select test_assert((test_request('anon', '{"x-dawaa-user-id":"gm.user"}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'forged x-dawaa-user-id (GM username) is ignored');
select test_assert((test_request('authenticated', '{"x-dawaa-user-id":"aaaaaaaa-0000-0000-0000-000000000001"}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'authenticated role with a forged header and no token gets no identity');
select test_assert((test_request('anon', '{"x-dawaa-session-token":"ffffffffffffffffffffffffffffffffffffffffffffffffffff"}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'random session token is refused');
select test_assert((test_request('anon', '{"x-dawaa-session-token":"rehearsal-expired-gm-token-xxxxxxxxxxxxxxxxxxxxxxxx"}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'expired session is refused');
select test_assert((test_request('anon', '{"x-dawaa-session-token":"rehearsal-revoked-gm-token-xxxxxxxxxxxxxxxxxxxxxxxx"}', $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'revoked session is refused');
select test_assert((test_call(:DIS, $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$)) is null,
  'a live session of a disabled account is refused');
select test_assert((test_call(:SM, $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$))#>>'{}' = 'aaaaaaaa-0000-0000-0000-000000000002',
  'valid session resolves its own account');
select test_assert((test_request('anon', jsonb_build_object('x-dawaa-session-token', test_session_token(:SM), 'x-dawaa-user-id', 'aaaaaaaa-0000-0000-0000-000000000001'),
  $q$select to_jsonb(public.dawaa_current_staff_account_id_strict())$q$))#>>'{}' = 'aaaaaaaa-0000-0000-0000-000000000002',
  'valid session + forged GM header stays the session account (no escalation)');

-- 2. Sibling readers: sessions and notifications resolve the same verified account.
select test_assert((test_call(:SM, $q$select jsonb_build_object('notif', public.dawaa_current_notification_account_id_v1(), 'reqid', public.dawaa_request_staff_id(), 'ident', public.dawaa_request_staff_identifier(), 'staff', public.dawaa_current_staff_id_v1(), 'app', public.dawaa_has_active_app_session(), 'op', public.employee_operating_actor_id())$q$))
  = '{"notif":"aaaaaaaa-0000-0000-0000-000000000002","reqid":"aaaaaaaa-0000-0000-0000-000000000002","ident":"aaaaaaaa-0000-0000-0000-000000000002","staff":"22222222-0000-0000-0000-0000000000a2","app":true,"op":"aaaaaaaa-0000-0000-0000-000000000002"}'::jsonb,
  'notification account, request id, staff id, app-session flag and operating actor all come from the session');
select test_assert((test_request('anon', '{"x-dawaa-user-id":"aaaaaaaa-0000-0000-0000-000000000001"}', $q$select jsonb_build_object('notif', public.dawaa_current_notification_account_id_v1(), 'app', public.dawaa_has_active_app_session())$q$))
  = '{"notif":null,"app":false}'::jsonb,
  'a forged header no longer opens notifications or an app session');

-- 3. p_actor_id binding.
select test_assert((test_call(:SM, $q$select public.dawaa_can_manage_branch_targets('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$q$))#>>'{}' = 'aaaaaaaa-0000-0000-0000-000000000002',
  'plpgsql target: a claimed GM p_actor_id is bound to the caller');
select test_assert((test_call(:SM, $q$select public.app_staff_role('gm.user')$q$))#>>'{}' = 'aaaaaaaa-0000-0000-0000-000000000002',
  'sql target: a claimed GM username is bound to the caller');
select test_assert((test_call(:SM, $q$select public.app_staff_role('shami.manager')$q$))#>>'{}' = 'shami.manager',
  'the caller''s own username is kept');
select test_assert((test_call(null, $q$select public.dawaa_can_manage_branch_targets('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$q$)) is null,
  'no session: a claimed actor is bound to nobody');
select test_assert((test_request(null, '{}', $q$select public.dawaa_can_manage_branch_targets('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$q$))#>>'{}' = 'aaaaaaaa-0000-0000-0000-000000000001',
  'server context (cron, migrations): the explicit actor passes through');
select test_assert((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%dawaa_bind_actor_v1(p_actor_id)%') = 52,
  'all 52 actor functions are bound');
select test_assert(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%x-dawaa-user-id%'),
  'no function reads x-dawaa-user-id');

-- 4. Review points command: verified token in, verified token carried downstream, session refreshed.
update public.staff_login_sessions set expires_at = now() + interval '5 minutes'
where token_hash = encode(extensions.digest(test_session_token(:SM), 'sha256'), 'hex');
select test_assert((test_call(:SM, format($q$select public.record_conversation_review_points_v1(%L, 'cccccccc-0000-0000-0000-000000000001')$q$, test_session_token(:SM)))) @> '{"session_authorized":true}'::jsonb,
  'review author records points with a live session');
select test_assert((select strict_account = 'aaaaaaaa-0000-0000-0000-000000000002' and notification_account = 'aaaaaaaa-0000-0000-0000-000000000002'
                      and headers like '%x-dawaa-session-token%' and headers not like '%x-dawaa-user-id%'
                    from public.employee_points_test_log order by id desc limit 1),
  'the points writer sees the same verified account through the carried session token (no bare id header)');
select test_assert((select expires_at > now() + interval '11 hours' from public.staff_login_sessions
                    where token_hash = encode(extensions.digest(test_session_token(:SM), 'sha256'), 'hex')),
  'the review command refreshes the sliding session');
select test_assert((test_call(:SM, $q$select public.record_conversation_review_points_v1('rehearsal-revoked-gm-token-xxxxxxxxxxxxxxxxxxxxxxxx', 'cccccccc-0000-0000-0000-000000000001')$q$))->>'error' = '42501',
  'review command refuses a revoked session');
select test_assert((test_call(:SM, format($q$select public.record_conversation_review_points_v1(%L, 'cccccccc-0000-0000-0000-000000000002')$q$, test_session_token(:SM))))->>'message' = 'not_authorized_for_branch',
  'branch manager cannot record points on another branch''s review');

-- 5. Base44 purchase-invoice sync.
select test_assert((test_request('service_role', '{}', $q$select public.import_base44_purchase_invoices_v1('[{"id":"b44-1","entered_by":"x","branch":"فرع الشامي","total_value":"100"}]')$q$)) @> '{"total":1}'::jsonb,
  'Base44 sync with the service_role client works without any staff header');
select test_assert((select count(*) from public.base44_purchase_invoice_sync where base44_id = 'b44-1') = 1, 'the synced invoice is stored');
select test_assert((test_request('anon', '{}', $q$select public.import_base44_purchase_invoices_v1('[]')$q$))->>'message' = 'active staff actor required',
  'Base44 import from the browser without a session is refused');
select test_assert((test_request('anon', '{"x-dawaa-user-id":"aaaaaaaa-0000-0000-0000-000000000001"}', $q$select public.import_base44_purchase_invoices_v1('[]')$q$))->>'message' = 'active staff actor required',
  'the old anon + forged GM header sync path is closed');
select test_assert((test_call(:GM, $q$select public.import_base44_purchase_invoices_v1('[{"id":"b44-2"}]')$q$)) @> '{"total":1}'::jsonb,
  'a general manager with a live session can still sync from the app');
select test_assert((test_call(:SM, $q$select public.import_base44_purchase_invoices_v1('[]')$q$))->>'message' = 'purchase invoice sync permission required',
  'a branch manager session without the evaluator role is refused');
