-- Payroll Contract V2: immutable finalization after reviewed, unchanged, ready snapshot.
-- Finalization is a data lock only. It does not mark payroll as paid and does not move money.

create table if not exists public.payroll_finalized_snapshots_v2 (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.payroll_final_snapshot_staging(id) on delete restrict,
  staff_id uuid not null,
  staff_username text not null,
  staff_name text not null,
  branch text,
  month_cycle text not null check (month_cycle ~ '^\d{4}-\d{2}$'),
  cycle_start date,
  cycle_end date,
  snapshot_fingerprint text not null,
  payload jsonb not null,
  finalized_by uuid not null,
  finalized_by_name text not null,
  finalized_at timestamptz not null default now(),
  state text not null default 'finalized' check (state='finalized'),
  unique(staff_id,month_cycle),
  unique(snapshot_id)
);

create index if not exists payroll_finalized_snapshots_v2_cycle_idx
  on public.payroll_finalized_snapshots_v2(month_cycle,branch,finalized_at desc);

alter table public.payroll_finalized_snapshots_v2 enable row level security;
revoke all on table public.payroll_finalized_snapshots_v2 from public,anon,authenticated;
grant select,insert on table public.payroll_finalized_snapshots_v2 to service_role;

drop trigger if exists payroll_finalized_snapshots_v2_immutable on public.payroll_finalized_snapshots_v2;
create trigger payroll_finalized_snapshots_v2_immutable
before update or delete on public.payroll_finalized_snapshots_v2
for each row execute function public.dawaa_block_payroll_snapshot_mutation_v1();

create or replace function public.finalize_payroll_snapshot_v2(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_snapshot public.payroll_final_snapshot_staging%rowtype;
  v_compare jsonb;
  v_review public.payroll_snapshot_reviews%rowtype;
  v_existing public.payroll_finalized_snapshots_v2%rowtype;
  v_final public.payroll_finalized_snapshots_v2%rowtype;
begin
  if p_snapshot_id is null then raise exception 'snapshot_id_required' using errcode='22023'; end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found
     or coalesce(v_actor.role,'') not in ('general_manager','executive_manager')
     or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_finalization' using errcode='42501';
  end if;

  select * into v_snapshot
  from public.payroll_final_snapshot_staging
  where id=p_snapshot_id;
  if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_manage_payroll_staff_v1(v_snapshot.staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select * into v_existing
  from public.payroll_finalized_snapshots_v2
  where staff_id=v_snapshot.staff_id and month_cycle=v_snapshot.month_cycle;

  if found then
    if v_existing.snapshot_fingerprint=v_snapshot.snapshot_fingerprint then
      return jsonb_build_object('success',true,'existing',true,'finalized',to_jsonb(v_existing),'paid',false,'financial_effect','none');
    end if;
    raise exception 'payroll_cycle_already_finalized_with_different_snapshot' using errcode='55000';
  end if;

  select * into v_review
  from public.payroll_snapshot_reviews
  where snapshot_id=p_snapshot_id
  order by created_at desc,id desc
  limit 1;

  if not found or v_review.decision<>'approved' then
    raise exception 'latest_snapshot_review_must_be_approved' using errcode='22023';
  end if;

  v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);

  if coalesce(v_snapshot.finalization_ready,false) is not true
     or coalesce((v_compare->>'unchanged')::boolean,false) is not true
     or coalesce((v_compare->>'current_ready')::boolean,false) is not true then
    raise exception 'snapshot_changed_or_blocked_before_finalization' using errcode='55000';
  end if;

  insert into public.payroll_finalized_snapshots_v2(
    snapshot_id,staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,
    snapshot_fingerprint,payload,finalized_by,finalized_by_name
  )
  values(
    v_snapshot.id,v_snapshot.staff_id,v_snapshot.staff_username,v_snapshot.staff_name,v_snapshot.branch,
    v_snapshot.month_cycle,v_snapshot.cycle_start,v_snapshot.cycle_end,v_snapshot.snapshot_fingerprint,
    v_snapshot.payload,v_actor.id,coalesce(v_actor.name,v_actor.username)
  )
  returning * into v_final;

  return jsonb_build_object(
    'success',true,
    'existing',false,
    'finalized',to_jsonb(v_final),
    'review',to_jsonb(v_review),
    'comparison',v_compare,
    'paid',false,
    'financial_effect','none'
  );
end;
$$;

create or replace function public.list_payroll_finalized_snapshots_v2(
  p_staff_id uuid default null,
  p_month_cycle text default null,
  p_limit integer default 100
)
returns setof public.payroll_finalized_snapshots_v2
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_finalized_payroll_list' using errcode='42501';
  end if;

  return query
  select f.*
  from public.payroll_finalized_snapshots_v2 f
  where (p_staff_id is null or f.staff_id=p_staff_id)
    and (p_month_cycle is null or trim(p_month_cycle)='' or f.month_cycle=p_month_cycle)
    and public.dawaa_can_manage_payroll_staff_v1(f.staff_username)
  order by f.finalized_at desc
  limit greatest(1,least(coalesce(p_limit,100),300));
end;
$$;

revoke execute on function public.finalize_payroll_snapshot_v2(uuid) from public,anon;
revoke execute on function public.list_payroll_finalized_snapshots_v2(uuid,text,integer) from public,anon;
grant execute on function public.finalize_payroll_snapshot_v2(uuid) to authenticated,service_role;
grant execute on function public.list_payroll_finalized_snapshots_v2(uuid,text,integer) to authenticated,service_role;
