begin;

drop function if exists public.get_staff_accounts_directory(text[], text);

create function public.get_staff_accounts_directory(
  p_roles text[] default null,
  p_branch text default null
)
returns table(
  account_id text,
  staff_id text,
  username text,
  name text,
  branch text,
  role text,
  active boolean,
  can_login boolean,
  status text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    sa.id::text as account_id,
    sa.staff_id,
    sa.username,
    coalesce(nullif(btrim(s.name),''), nullif(btrim(sa.username),'')) as name,
    coalesce(nullif(btrim(s.branch),''), nullif(btrim(sa.branch),'')) as branch,
    sa.role,
    coalesce(sa.active, true) as active,
    coalesce(sa.can_login, true) as can_login,
    sa.status
  from public.staff_accounts sa
  left join public.staff s on s.id::text = sa.staff_id
  where (p_roles is null or sa.role = any(p_roles))
    and (
      p_branch is null
      or coalesce(nullif(btrim(s.branch),''), nullif(btrim(sa.branch),'')) = p_branch
    );
$function$;

-- Preserve the existing authorization contract; this migration only changes
-- the read shape so callers can stop reading staff_accounts directly.
grant execute on function public.get_staff_accounts_directory(text[], text) to anon;
grant execute on function public.get_staff_accounts_directory(text[], text) to authenticated;
grant execute on function public.get_staff_accounts_directory(text[], text) to service_role;

commit;
