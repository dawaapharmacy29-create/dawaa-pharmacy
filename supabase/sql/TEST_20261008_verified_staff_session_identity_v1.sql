-- Identity security test suite (reference, not a migration).
-- Run as: begin; <migration 20261008120000 if not applied>; <this file>; rollback;
-- Everything, including the test session rows, exists only inside that transaction.
-- Batching: select set_config('idt.only', '01,02,03', true); limits the scenarios run (15 = server context).
-- Output: one row per scenario with passed/failed counts and the failing probes.

create temp table idt_results(scenario text, probe text, result text, expected text);
grant all on idt_results to anon, authenticated;

create temp table idt_probes(probe text primary key, ord int, sql text);
insert into idt_probes values
 ('strict', 1, 'select public.dawaa_current_staff_account_id_strict()::text'),
 ('request_staff_id', 2, 'select public.dawaa_request_staff_id()::text'),
 ('request_identifier', 3, 'select public.dawaa_request_staff_identifier()'),
 ('notification_id', 4, 'select public.dawaa_current_notification_account_id_v1()'),
 ('staff_id_v1', 5, 'select public.dawaa_current_staff_id_v1()'),
 ('has_app_session', 6, 'select public.dawaa_has_active_app_session()::text'),
 ('operating_actor', 7, 'select public.employee_operating_actor_id()'),
 ('queue_scope_self', 8, 'select public.dawaa_customer_service_queue_scope_v3(null)'),
 ('queue_scope_claim_gm', 9, $q$select public.dawaa_customer_service_queue_scope_v3('748fad73-5aab-4e61-bfd6-8be299af8aa9'::uuid)$q$),
 ('role_of_claimed_gm', 10, $q$select public.app_staff_role('748fad73-5aab-4e61-bfd6-8be299af8aa9')$q$),
 ('role_allowed_claim_gm', 11, $q$select public.app_role_allowed('748fad73-5aab-4e61-bfd6-8be299af8aa9', array['general_manager'])::text$q$),
 ('role_allowed_claim_username', 12, $q$select public.app_role_allowed('dr.moaz', array['general_manager'])::text$q$),
 ('ci_other_branch_claim_gm', 13, $q$select public.dawaa_can_access_customer_intelligence_branch_v2('فرع شكري','748fad73-5aab-4e61-bfd6-8be299af8aa9'::uuid)::text$q$),
 ('branch_targets_claim_gm', 14, $q$select public.dawaa_can_manage_branch_targets('748fad73-5aab-4e61-bfd6-8be299af8aa9'::uuid)::text$q$),
 ('sales_other_branch_staff', 15, $q$select coalesce(invoices,0)::text from public.get_staff_evaluation_sales_summary_v3('bb0baa75-498e-442e-bd53-432fd7ad0195'::uuid, current_date - 7, current_date)$q$),
 ('sales_shami_pharmacist', 16, $q$select coalesce(invoices,0)::text from public.get_staff_evaluation_sales_summary_v3('8601fb7f-c14c-43b8-b735-8761d8c12ace'::uuid, current_date - 7, current_date)$q$),
 ('can_view_reviews', 17, $q$select public.dawaa_current_actor_can(array['view_reviews'])::text$q$),
 ('rls_reviews_rows', 18, 'select count(*)::text from public.conversation_sales_reviews where is_current'),
 ('rls_reviews_shokry_rows', 19, $q$select count(*)::text from public.conversation_sales_reviews where is_current and branch like '%شكري%'$q$);

-- Expected results per identity profile. '*' = any non-error value, 'a|b' = either, 'ERR' = any error.
create temp table idt_expect(profile text, probe text, expected text, primary key(profile, probe));
insert into idt_expect
select 'deny', probe, case probe
  when 'has_app_session' then 'false'
  when 'role_allowed_claim_gm' then 'false' when 'role_allowed_claim_username' then 'false'
  when 'ci_other_branch_claim_gm' then 'false' when 'branch_targets_claim_gm' then 'false'
  when 'sales_other_branch_staff' then 'ERR|∅' when 'sales_shami_pharmacist' then 'ERR|∅'
  when 'can_view_reviews' then 'false|∅'
  when 'rls_reviews_rows' then '0' when 'rls_reviews_shokry_rows' then '0'
  else '∅' end
from idt_probes;
insert into idt_expect
select p.profile, x.probe, case x.probe
  when 'strict' then p.acct when 'request_staff_id' then p.acct when 'request_identifier' then p.acct
  when 'notification_id' then p.acct when 'operating_actor' then p.acct
  when 'staff_id_v1' then p.staff when 'has_app_session' then 'true'
  when 'queue_scope_self' then p.scope when 'queue_scope_claim_gm' then p.scope
  when 'role_of_claimed_gm' then p.role
  when 'role_allowed_claim_gm' then p.gm::text
  -- app_staff_role() has always resolved account ids only; a username never grants a role (unchanged behaviour).
  when 'role_allowed_claim_username' then 'false'
  when 'ci_other_branch_claim_gm' then p.gm::text when 'branch_targets_claim_gm' then p.targets::text
  when 'sales_other_branch_staff' then case when p.gm then '*' else 'ERR|∅' end
  when 'sales_shami_pharmacist' then '*'
  when 'can_view_reviews' then 'true'
  -- Row counts must equal the pre-migration baseline of the same account (no permission drift).
  when 'rls_reviews_rows' then p.reviews
  when 'rls_reviews_shokry_rows' then p.shokry_reviews
  else '*' end
from (values
  -- reviews / shokry_reviews: baseline measured on 2026-10-08 before the migration; '*' = any.
  ('pharmacist', '4f230808-80ca-484c-97a0-3d146bf5b9ed', '8601fb7f-c14c-43b8-b735-8761d8c12ace', 'pharmacist', 'فرع الشامي', false, false, '105', '27'),
  ('branch_manager', '6e7d3c6d-b643-4f95-94a6-c7e49ce0292b', '43c5a028-9fcc-419b-8453-2ae0b43a9707', 'branch_manager', 'فرع الشامي', false, true, '865', '0'),
  ('general_manager', '748fad73-5aab-4e61-bfd6-8be299af8aa9', '303f15a8-5161-4c99-8301-4df256215a25', 'general_manager', 'ALL', true, true, '1866', '*')
) p(profile, acct, staff, role, scope, gm, targets, reviews, shokry_reviews)
cross join idt_probes x;

-- Test-only sessions (rolled back with the transaction).
insert into public.staff_login_sessions(staff_account_id, token_hash, expires_at, revoked_at)
select a::uuid, encode(extensions.digest(t, 'sha256'), 'hex'), now() + e, r
from (values
  ('748fad73-5aab-4e61-bfd6-8be299af8aa9', 'idt-gm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', interval '1 hour', null::timestamptz),
  ('6e7d3c6d-b643-4f95-94a6-c7e49ce0292b', 'idt-bm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', interval '1 hour', null),
  ('4f230808-80ca-484c-97a0-3d146bf5b9ed', 'idt-ph-token-cccccccccccccccccccccccccccccccccccccccc', interval '1 hour', null),
  ('748fad73-5aab-4e61-bfd6-8be299af8aa9', 'idt-gx-token-dddddddddddddddddddddddddddddddddddddddd', interval '-1 minute', null),
  ('748fad73-5aab-4e61-bfd6-8be299af8aa9', 'idt-gr-token-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', interval '1 hour', now())
) s(a, t, e, r);

grant select on idt_probes, idt_expect to anon, authenticated;

create temp table idt_scenarios(name text primary key, db_role text, headers jsonb, profile text);
insert into idt_scenarios values
 ('01 unauthenticated, no identity headers', 'anon', '{}', 'deny'),
 ('02 forged x-dawaa-user-id = GM account id', 'anon', '{"x-dawaa-user-id":"748fad73-5aab-4e61-bfd6-8be299af8aa9"}', 'deny'),
 ('03 forged x-dawaa-user-id = GM username', 'anon', '{"x-dawaa-user-id":"dr.moaz"}', 'deny'),
 ('04 forged x-dawaa-user-id = GM staff_id', 'anon', '{"x-dawaa-user-id":"303f15a8-5161-4c99-8301-4df256215a25"}', 'deny'),
 ('05 random session token', 'anon', '{"x-dawaa-session-token":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}', 'deny'),
 ('06 expired GM session token', 'anon', '{"x-dawaa-session-token":"idt-gx-token-dddddddddddddddddddddddddddddddddddddddd"}', 'deny'),
 ('07 revoked GM session token', 'anon', '{"x-dawaa-session-token":"idt-gr-token-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}', 'deny'),
 ('08 authenticated role, no token, forged GM header', 'authenticated', '{"x-dawaa-user-id":"748fad73-5aab-4e61-bfd6-8be299af8aa9"}', 'deny'),
 ('09 pharmacist (normal staff) valid token', 'anon', '{"x-dawaa-session-token":"idt-ph-token-cccccccccccccccccccccccccccccccccccccccc"}', 'pharmacist'),
 ('10 pharmacist token + forged x-dawaa-user-id = GM', 'anon', '{"x-dawaa-session-token":"idt-ph-token-cccccccccccccccccccccccccccccccccccccccc","x-dawaa-user-id":"748fad73-5aab-4e61-bfd6-8be299af8aa9"}', 'pharmacist'),
 ('11 branch manager valid token', 'anon', '{"x-dawaa-session-token":"idt-bm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}', 'branch_manager'),
 ('12 branch manager token + forged x-dawaa-user-id = GM username', 'anon', '{"x-dawaa-session-token":"idt-bm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","x-dawaa-user-id":"dr.moaz"}', 'branch_manager'),
 ('13 general manager valid token', 'anon', '{"x-dawaa-session-token":"idt-gm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', 'general_manager'),
 ('14 general manager token + x-dawaa-user-id = pharmacist', 'anon', '{"x-dawaa-session-token":"idt-gm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","x-dawaa-user-id":"4f230808-80ca-484c-97a0-3d146bf5b9ed"}', 'general_manager');

do $$
declare s record; p record; v text;
begin
  -- Optional batching: set_config('idt.only', '01,02,...', true) before running this file.
  for s in select * from idt_scenarios
           where coalesce(current_setting('idt.only', true), '') = ''
              or split_part(name, ' ', 1) = any(string_to_array(current_setting('idt.only', true), ','))
           order by name loop
    perform set_config('request.headers', s.headers::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', s.db_role)::text, true);
    execute format('set local role %I', s.db_role);
    for p in select * from idt_probes order by ord loop
      begin
        execute p.sql into v;
        v := coalesce(v, '∅');
      exception when others then
        v := 'ERR:' || sqlstate;
      end;
      insert into idt_results
      select s.name, p.probe, v, e.expected from idt_expect e where e.profile = s.profile and e.probe = p.probe;
    end loop;
    reset role;
  end loop;

  -- Server context (cron / migrations / service jobs): no JWT claims, explicit actors pass through.
  if coalesce(current_setting('idt.only', true), '') <> '' and not ('15' = any(string_to_array(current_setting('idt.only', true), ','))) then
    return;
  end if;
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', '', true);
  insert into idt_results values
    ('15 server context, no JWT', 'is_client', public.dawaa_request_context_is_client_v1()::text, 'false'),
    ('15 server context, no JWT', 'bind_uuid_passthrough', public.dawaa_bind_actor_v1('748fad73-5aab-4e61-bfd6-8be299af8aa9'::uuid)::text, '748fad73-5aab-4e61-bfd6-8be299af8aa9'),
    ('15 server context, no JWT', 'bind_text_passthrough', public.dawaa_bind_actor_v1('dr.moaz'::text), 'dr.moaz');
end $$;

select scenario,
  count(*) filter (where ok) as passed,
  count(*) filter (where not ok) as failed,
  string_agg(case when not ok then probe || '=' || result || ' (expected ' || expected || ')' end, '; ') as failures
from (
  select r.*, (r.expected = '*' and r.result not like 'ERR:%')
           or exists (select 1 from unnest(string_to_array(r.expected, '|')) e
                      where r.result = e or (e = 'ERR' and r.result like 'ERR:%')) as ok
  from idt_results r
) x
group by scenario
order by scenario;
