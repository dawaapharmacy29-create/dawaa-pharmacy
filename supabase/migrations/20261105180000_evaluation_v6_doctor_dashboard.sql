-- Monthly evaluation (lab engine v6.8) on the doctor dashboard (2026-11-05).
-- The doctor-evaluation-v6 Edge Function computes the cycle with the service role and caches it
-- here; doctors receive only their own row from the function. Doctor levels (weight on a shared
-- hour) move from the general manager's browser to the database so the server scores with them.

create table if not exists public.evaluation_v6_score_cache (
  cycle_start date not null,
  cycle_end_exclusive date not null,
  version text not null,
  computed_at timestamptz not null default now(),
  scores jsonb not null,
  primary key (cycle_start, cycle_end_exclusive, version)
);
alter table public.evaluation_v6_score_cache enable row level security;
-- No policies: only the service role (the Edge Function) reads or writes the cache.
revoke all on public.evaluation_v6_score_cache from anon, authenticated;

create table if not exists public.evaluation_v6_doctor_levels (
  staff_id text primary key,
  level text not null check (level in ('primary', 'doctor', 'trainee')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.evaluation_v6_doctor_levels enable row level security;
revoke all on public.evaluation_v6_doctor_levels from anon, authenticated;
grant select on public.evaluation_v6_doctor_levels to anon, authenticated;
drop policy if exists evaluation_v6_doctor_levels_select on public.evaluation_v6_doctor_levels;
create policy evaluation_v6_doctor_levels_select on public.evaluation_v6_doctor_levels
  for select using ((select public.dawaa_actor_is_top_management_v1()));

create or replace function public.set_evaluation_v6_doctor_level_v1(p_staff_id text, p_level text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
begin
  if v_actor is null or not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_staff_id), '') is null then
    raise exception 'staff_required' using errcode = '22023';
  end if;
  if coalesce(p_level, '') not in ('primary', 'doctor', 'trainee') then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  insert into public.evaluation_v6_doctor_levels (staff_id, level, updated_by, updated_at)
    values (btrim(p_staff_id), p_level, v_actor, now())
  on conflict (staff_id) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.set_evaluation_v6_doctor_level_v1(text, text) from public;
grant execute on function public.set_evaluation_v6_doctor_level_v1(text, text) to anon, authenticated;
