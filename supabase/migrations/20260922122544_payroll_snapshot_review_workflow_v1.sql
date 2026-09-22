
create table if not exists public.payroll_snapshot_reviews (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.payroll_final_snapshot_staging(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reviewer_id uuid,
  reviewer_name text not null,
  reviewer_role text,
  note text,
  comparison jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payroll_snapshot_reviews_snapshot_idx
  on public.payroll_snapshot_reviews(snapshot_id,created_at desc);

alter table public.payroll_snapshot_reviews enable row level security;
revoke all on table public.payroll_snapshot_reviews from public,anon,authenticated;
grant select,insert on table public.payroll_snapshot_reviews to service_role;

drop trigger if exists payroll_snapshot_reviews_immutable on public.payroll_snapshot_reviews;
create trigger payroll_snapshot_reviews_immutable
before update or delete on public.payroll_snapshot_reviews
for each row execute function public.dawaa_block_payroll_snapshot_mutation_v1();

create or replace function public.review_payroll_staged_snapshot_v1(
  p_snapshot_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_snapshot public.payroll_final_snapshot_staging%rowtype;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
  v_compare jsonb;
  v_review public.payroll_snapshot_reviews%rowtype;
begin
  if p_snapshot_id is null or v_decision not in ('approved','rejected') then
    raise exception 'invalid_payroll_snapshot_review_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found
     or coalesce(v_actor.role,'') not in ('general_manager','executive_manager','branches_manager')
     or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_snapshot_review' using errcode='42501';
  end if;

  select * into v_snapshot
  from public.payroll_final_snapshot_staging
  where id=p_snapshot_id;

  if not found then
    raise exception 'snapshot_not_found' using errcode='22023';
  end if;

  if v_snapshot.created_by is not null and v_snapshot.created_by=v_actor.id then
    raise exception 'snapshot_creator_cannot_review_own_snapshot' using errcode='42501';
  end if;

  v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);

  if v_decision='approved' then
    if coalesce(v_snapshot.finalization_ready,false) is not true then
      raise exception 'cannot_approve_blocked_snapshot' using errcode='22023';
    end if;
    if coalesce((v_compare->>'unchanged')::boolean,false) is not true then
      raise exception 'cannot_approve_changed_snapshot' using errcode='22023';
    end if;
    if coalesce((v_compare->>'current_ready')::boolean,false) is not true then
      raise exception 'cannot_approve_currently_blocked_snapshot' using errcode='22023';
    end if;
  end if;

  insert into public.payroll_snapshot_reviews(
    snapshot_id,decision,reviewer_id,reviewer_name,reviewer_role,note,comparison
  )
  values(
    p_snapshot_id,
    v_decision,
    v_actor.id,
    coalesce(v_actor.name,v_actor.username),
    v_actor.role,
    nullif(trim(coalesce(p_note,'')),''),
    v_compare
  )
  returning * into v_review;

  return jsonb_build_object(
    'success',true,
    'review',to_jsonb(v_review),
    'snapshot',to_jsonb(v_snapshot),
    'comparison',v_compare,
    'financial_effect','none',
    'finalized',false,
    'paid',false
  );
end;
$$;

create or replace function public.list_payroll_snapshot_reviews_v1(
  p_snapshot_id uuid,
  p_limit integer default 50
)
returns setof public.payroll_snapshot_reviews
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_snapshot public.payroll_final_snapshot_staging%rowtype;
  v_username text;
begin
  select * into v_snapshot
  from public.payroll_final_snapshot_staging
  where id=p_snapshot_id;

  if not found then
    raise exception 'snapshot_not_found' using errcode='22023';
  end if;

  select username into v_username
  from public.staff_accounts
  where staff_id=v_snapshot.staff_id::text
  order by coalesce(active,true) desc,created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_snapshot_reviews' using errcode='42501';
  end if;

  return query
  select *
  from public.payroll_snapshot_reviews r
  where r.snapshot_id=p_snapshot_id
  order by r.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$$;

revoke execute on function public.review_payroll_staged_snapshot_v1(uuid,text,text) from public,anon;
revoke execute on function public.list_payroll_snapshot_reviews_v1(uuid,integer) from public,anon;
grant execute on function public.review_payroll_staged_snapshot_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.list_payroll_snapshot_reviews_v1(uuid,integer) to authenticated,service_role;
