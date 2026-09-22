
create table if not exists public.payroll_final_snapshot_staging (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_username text not null,
  staff_name text not null,
  branch text,
  month_cycle text not null check (month_cycle ~ '^\d{4}-\d{2}$'),
  cycle_start date,
  cycle_end date,
  snapshot_schema text not null default 'payroll_final_snapshot_v1',
  snapshot_mode text not null default 'staged' check (snapshot_mode='staged'),
  finalization_ready boolean not null default false,
  snapshot_fingerprint text not null,
  payload jsonb not null,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique(staff_id,month_cycle,snapshot_fingerprint)
);

create index if not exists payroll_final_snapshot_staging_staff_cycle_idx
  on public.payroll_final_snapshot_staging(staff_id,month_cycle,created_at desc);

alter table public.payroll_final_snapshot_staging enable row level security;
revoke all on table public.payroll_final_snapshot_staging from public,anon,authenticated;
grant select,insert on table public.payroll_final_snapshot_staging to service_role;

create table if not exists public.payroll_snapshot_audit (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references public.payroll_final_snapshot_staging(id) on delete restrict,
  action text not null check (action in ('staged','reused')),
  staff_id uuid not null,
  month_cycle text not null,
  snapshot_fingerprint text not null,
  actor_id uuid,
  actor_name text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payroll_snapshot_audit_staff_cycle_idx
  on public.payroll_snapshot_audit(staff_id,month_cycle,created_at desc);

alter table public.payroll_snapshot_audit enable row level security;
revoke all on table public.payroll_snapshot_audit from public,anon,authenticated;
grant select,insert on table public.payroll_snapshot_audit to service_role;

create or replace function public.dawaa_block_payroll_snapshot_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  raise exception 'payroll_snapshot_is_immutable' using errcode='55000';
end;
$$;

drop trigger if exists payroll_snapshot_staging_immutable on public.payroll_final_snapshot_staging;
create trigger payroll_snapshot_staging_immutable
before update or delete on public.payroll_final_snapshot_staging
for each row execute function public.dawaa_block_payroll_snapshot_mutation_v1();

drop trigger if exists payroll_snapshot_audit_immutable on public.payroll_snapshot_audit;
create trigger payroll_snapshot_audit_immutable
before update or delete on public.payroll_snapshot_audit
for each row execute function public.dawaa_block_payroll_snapshot_mutation_v1();

create or replace function public.stage_payroll_final_snapshot_v1(
  p_staff_id uuid,
  p_month_cycle text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_preview jsonb;
  v_row public.payroll_final_snapshot_staging%rowtype;
  v_existing boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_snapshot_stage_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found
     or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_snapshot_stage' using errcode='42501';
  end if;

  v_preview:=public.payroll_final_snapshot_preview_v1(p_staff_id,p_month_cycle);

  select * into v_row
  from public.payroll_final_snapshot_staging
  where staff_id=p_staff_id
    and month_cycle=p_month_cycle
    and snapshot_fingerprint=v_preview->>'snapshot_fingerprint'
  order by created_at desc
  limit 1;

  if found then
    v_existing:=true;
  else
    insert into public.payroll_final_snapshot_staging(
      staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,
      finalization_ready,snapshot_fingerprint,payload,note,created_by,created_by_name
    )
    values(
      p_staff_id,
      v_preview->>'staff_username',
      v_preview->>'staff_name',
      v_preview->>'branch',
      p_month_cycle,
      nullif(v_preview->>'cycle_start','')::date,
      nullif(v_preview->>'cycle_end','')::date,
      coalesce((v_preview->>'finalization_ready')::boolean,false),
      v_preview->>'snapshot_fingerprint',
      v_preview,
      nullif(trim(coalesce(p_note,'')),''),
      v_actor.id,
      coalesce(v_actor.name,v_actor.username)
    )
    returning * into v_row;
  end if;

  insert into public.payroll_snapshot_audit(
    snapshot_id,action,staff_id,month_cycle,snapshot_fingerprint,actor_id,actor_name,note,metadata
  )
  values(
    v_row.id,
    case when v_existing then 'reused' else 'staged' end,
    p_staff_id,
    p_month_cycle,
    v_row.snapshot_fingerprint,
    v_actor.id,
    coalesce(v_actor.name,v_actor.username),
    nullif(trim(coalesce(p_note,'')),''),
    jsonb_build_object(
      'finalization_ready',v_row.finalization_ready,
      'cycle_start',v_row.cycle_start,
      'cycle_end',v_row.cycle_end,
      'preview_generated_at',v_preview->>'generated_at'
    )
  );

  return jsonb_build_object(
    'success',true,
    'existing',v_existing,
    'snapshot',to_jsonb(v_row)
  );
end;
$$;

create or replace function public.list_payroll_final_snapshot_staging_v1(
  p_staff_id uuid,
  p_month_cycle text,
  p_limit integer default 20
)
returns setof public.payroll_final_snapshot_staging
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_username text;
begin
  select username into v_username
  from public.staff_accounts
  where staff_id=p_staff_id::text
  order by coalesce(active,true) desc,created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_snapshot_list' using errcode='42501';
  end if;

  return query
  select *
  from public.payroll_final_snapshot_staging s
  where s.staff_id=p_staff_id
    and s.month_cycle=p_month_cycle
  order by s.created_at desc
  limit greatest(1,least(coalesce(p_limit,20),100));
end;
$$;

create or replace function public.compare_payroll_final_snapshot_v1(
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_row public.payroll_final_snapshot_staging%rowtype;
  v_current jsonb;
begin
  select * into v_row
  from public.payroll_final_snapshot_staging
  where id=p_snapshot_id;

  if not found then
    raise exception 'snapshot_not_found' using errcode='22023';
  end if;

  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_snapshot_compare' using errcode='42501';
  end if;

  v_current:=public.payroll_final_snapshot_preview_v1(v_row.staff_id,v_row.month_cycle);

  return jsonb_build_object(
    'snapshot_id',v_row.id,
    'stored_fingerprint',v_row.snapshot_fingerprint,
    'current_fingerprint',v_current->>'snapshot_fingerprint',
    'unchanged',v_row.snapshot_fingerprint=(v_current->>'snapshot_fingerprint'),
    'stored_ready',v_row.finalization_ready,
    'current_ready',coalesce((v_current->>'finalization_ready')::boolean,false),
    'stored_created_at',v_row.created_at,
    'current_generated_at',v_current->>'generated_at',
    'stored_payload',v_row.payload,
    'current_payload',v_current
  );
end;
$$;

create or replace function public.list_payroll_snapshot_audit_v1(
  p_staff_id uuid,
  p_month_cycle text,
  p_limit integer default 50
)
returns setof public.payroll_snapshot_audit
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_snapshot_audit' using errcode='42501';
  end if;

  return query
  select *
  from public.payroll_snapshot_audit a
  where a.staff_id=p_staff_id
    and a.month_cycle=p_month_cycle
  order by a.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$$;

revoke execute on function public.dawaa_block_payroll_snapshot_mutation_v1() from public,anon,authenticated;
revoke execute on function public.stage_payroll_final_snapshot_v1(uuid,text,text) from public,anon;
revoke execute on function public.list_payroll_final_snapshot_staging_v1(uuid,text,integer) from public,anon;
revoke execute on function public.compare_payroll_final_snapshot_v1(uuid) from public,anon;
revoke execute on function public.list_payroll_snapshot_audit_v1(uuid,text,integer) from public,anon;

grant execute on function public.stage_payroll_final_snapshot_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.list_payroll_final_snapshot_staging_v1(uuid,text,integer) to authenticated,service_role;
grant execute on function public.compare_payroll_final_snapshot_v1(uuid) to authenticated,service_role;
grant execute on function public.list_payroll_snapshot_audit_v1(uuid,text,integer) to authenticated,service_role;
