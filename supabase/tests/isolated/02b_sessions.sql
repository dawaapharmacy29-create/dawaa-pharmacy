-- Isolated rehearsal — staff login sessions and the request helpers every assertion file uses.
-- A request is simulated exactly as PostgREST sends it: role anon (or service_role), request.jwt.claims
-- with that role, and request.headers carrying the opaque x-dawaa-session-token. The token of a fixture
-- account is test_session_token(account id); only its sha256 is stored, like production.
set client_min_messages = warning;

create function public.test_session_token(p_account uuid) returns text language sql immutable
as $$ select 'rehearsal-session-token-' || p_account::text $$;

update public.staff_accounts set username = 'gm.user' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.staff_accounts set username = 'shami.manager', staff_id = '22222222-0000-0000-0000-0000000000a2' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- A disabled account that still holds a live session row: must never resolve.
insert into public.staff_accounts (id, role, branch, active, can_login, staff_id, username)
values ('aaaaaaaa-0000-0000-0000-000000000006', 'general_manager', 'فرع الشامي', false, true, null, 'disabled.gm');

insert into public.staff_login_sessions (staff_account_id, token_hash, expires_at, revoked_at)
select a.id, encode(extensions.digest(public.test_session_token(a.id), 'sha256'), 'hex'), now() + interval '1 hour', null
from public.staff_accounts a;
insert into public.staff_login_sessions (staff_account_id, token_hash, expires_at, revoked_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', encode(extensions.digest('rehearsal-expired-gm-token-xxxxxxxxxxxxxxxxxxxxxxxx', 'sha256'), 'hex'), now() - interval '1 minute', null),
  ('aaaaaaaa-0000-0000-0000-000000000001', encode(extensions.digest('rehearsal-revoked-gm-token-xxxxxxxxxxxxxxxxxxxxxxxx', 'sha256'), 'hex'), now() + interval '1 hour', now());

-- Reviews used by record_conversation_review_points_v1 (reviewer = الشامي manager).
insert into public.conversation_sales_reviews (id, reviewer_id, staff_id, branch, doctor_points_impact, impact_status, final_score, month_cycle) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'فرع الشامي', 5, 'approved', 90, '2026-09'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'فرع شكري', 5, 'approved', 80, '2026-09');

create function public.test_assert(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERT FAILED: %', what; end if; raise notice 'PASS: %', what; end $$;
grant execute on function public.test_assert(boolean, text) to anon;

-- Runs p_sql as p_role with the given request headers; returns its jsonb result, or the SQLSTATE and message.
create function public.test_request(p_role text, p_headers jsonb, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.headers', coalesce(p_headers, '{}'::jsonb)::text, true);
  perform set_config('request.jwt.claims', case when p_role is null then '' else jsonb_build_object('role', p_role)::text end, true);
  if p_role is not null then execute format('set local role %I', p_role); end if;
  begin
    execute p_sql into v;
  exception when others then
    execute 'reset role';
    return jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  return v;
end $$;

-- Browser request of a fixture account (null = no session at all).
create function public.test_call(p_actor uuid, p_sql text) returns jsonb language sql as $$
  select public.test_request('anon',
    case when p_actor is null then '{}'::jsonb else jsonb_build_object('x-dawaa-session-token', public.test_session_token(p_actor)) end,
    p_sql)
$$;
