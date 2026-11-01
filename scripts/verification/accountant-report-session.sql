begin;
create temp table report_check(result jsonb);
do $test$
declare a record; token text; payload jsonb; denied boolean; checks jsonb := '[]';
begin
for a in select distinct on (role) id,role from public.staff_accounts where active and can_login and coalesce(is_active,true) and coalesce(status,'active')='active' and role in ('general_manager','executive_manager','admin','delivery') order by role,id
loop
token := encode(extensions.gen_random_bytes(32),'hex');
insert into public.staff_login_sessions(staff_account_id,token_hash,expires_at) values(a.id,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '5 minutes');
perform set_config('request.headers',jsonb_build_object('x-dawaa-session-token',token)::text,true);
execute 'set local role anon';
denied := false;
begin payload := public.get_accountant_report_v1(null);
exception when insufficient_privilege then denied:=true; end;
execute 'reset role';
if a.role='delivery' then
if not denied then raise exception 'unauthorized report access'; end if;
else
if denied or jsonb_array_length(payload->'vaults')<>3 then raise exception 'manager report failed'; end if;
end if;
checks := checks || jsonb_build_object('role',a.role,'denied',denied,'vaults',case when not denied then jsonb_array_length(payload->'vaults') end,'month',case when not denied then payload->>'month' end);
end loop;
perform set_config('request.headers','{}',true);
execute 'set local role anon';
denied:=false;
begin perform public.get_accountant_report_v1(null); exception when insufficient_privilege then denied:=true; end;
execute 'reset role';
if not denied then raise exception 'missing session allowed'; end if;
insert into report_check values (checks || jsonb_build_object('missing_session_denied',denied));
end $test$;
select result from report_check;
rollback;
