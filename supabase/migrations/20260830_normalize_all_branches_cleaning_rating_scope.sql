create or replace function public.get_cleaning_daily_rating_cards_v1(
  p_rating_date date default current_date,
  p_branch text default null::text
)
returns table(
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  rating_id uuid,
  stars integer,
  score_pct numeric,
  points_delta numeric,
  manager_note text,
  rated_by_name text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_branch text := nullif(trim(coalesce(p_branch,'')), '');
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  if v_branch is not null and lower(v_branch) in ('كل الفروع','all','all branches','all_branches') then
    v_branch := null;
  end if;

  if not (v_global or v_role = 'branch_manager') then
    raise exception 'not_authorized';
  end if;

  if not v_global then
    if v_actor_branch is null then
      raise exception 'manager_branch_missing';
    end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then
      raise exception 'not_authorized_for_branch';
    end if;
    v_branch := v_actor_branch;
  end if;

  return query
  select
    s.id,
    s.name,
    s.role,
    s.branch,
    r.id,
    r.stars::integer,
    r.score_pct,
    r.points_delta,
    r.manager_note,
    r.rated_by_name,
    r.updated_at
  from public.staff s
  left join public.cleaning_daily_ratings r
    on r.staff_id = s.id
   and r.rating_date = coalesce(p_rating_date,current_date)
  where public.dawaa_is_cleaning_role_v1(s.role)
    and coalesce(s.active,s.is_active,true)
    and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
    and (v_branch is null or s.branch = v_branch)
  order by s.branch,s.name;
end;
$function$;
