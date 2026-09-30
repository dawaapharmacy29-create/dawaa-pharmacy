create or replace function public.refresh_staff_login_session_v1(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session_id uuid;
begin
  if nullif(btrim(coalesce(p_session_token, '')), '') is null then
    return false;
  end if;

  select s.id
  into v_session_id
  from public.staff_login_sessions s
  join public.staff_accounts a on a.id = s.staff_account_id
  where s.token_hash = encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and coalesce(a.active, true) = true
    and coalesce(a.is_active, true) = true
    and coalesce(a.can_login, true) = true
    and coalesce(a.status, 'active') = 'active'
  limit 1;

  if v_session_id is null then
    return false;
  end if;

  update public.staff_login_sessions
  set
    last_used_at = now(),
    expires_at = now() + interval '12 hours'
  where id = v_session_id;

  return true;
end;
$$;

revoke all on function public.refresh_staff_login_session_v1(text) from public;
grant execute on function public.refresh_staff_login_session_v1(text) to anon, authenticated, service_role;
