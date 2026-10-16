-- get_cleaning_daily_rating_cards_v2: return the declared integer type for stars.
--
-- Production smoke (2026-10-16): /branch-checklist-review failed on every load with
-- "structure of query does not match function result type": the function declares stars integer, but
-- cleaning_daily_ratings.stars is smallint and PL/pgSQL RETURN QUERY does not coerce (the check fails even with
-- no rating rows). The function below is the exact Production definition (2026-10-16) with r.stars cast to
-- integer; authorization, scope, filters, ordering and every other column are unchanged.

do $guard$
begin
  if md5(btrim(regexp_replace(pg_get_functiondef(to_regprocedure('public.get_cleaning_daily_rating_cards_v2(date,text)')), '\s+', ' ', 'g')))
       not in ('8d8a6bf4af99ac503ecc1a8b77750686', 'f4ba9e914d7c8a7272c58e858aa8d5d1') then
    raise exception 'get_cleaning_daily_rating_cards_v2 differs from the reviewed definition; regenerate this migration';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.get_cleaning_daily_rating_cards_v2(p_rating_date date DEFAULT (timezone('Africa/Cairo'::text, now()))::date, p_branch text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, staff_name text, staff_role text, branch text, rating_date date, required_items integer, submitted_items integer, reviewed_items integer, approved_items integer, rejected_items integer, pending_items integer, max_stars integer, rating_ready boolean, rating_id uuid, stars integer, score_pct numeric, points_delta numeric, manager_note text, rated_by_name text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_role text:=lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text:=nullif(trim(coalesce(public.employee_operating_actor_branch(),'')),'');
  v_global boolean:=v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_date date:=coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  if not (v_global or v_role='branch_manager') then raise exception 'not_authorized'; end if;
  if not v_global then
    if v_actor_branch is null then raise exception 'manager_branch_missing'; end if;
    if v_branch is not null and public.dawaa_review_coverage_branch_key_v1(v_branch)<>
       public.dawaa_review_coverage_branch_key_v1(v_actor_branch) then raise exception 'not_authorized_for_branch'; end if;
    v_branch:=v_actor_branch;
  end if;

  return query
  with due as (
    select distinct a.staff_id,a.branch,a.item_id
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true and i.operation_category='cleaning'
    join public.staff st on st.id=a.staff_id and coalesce(st.active,true)=true
    where a.active=true
      and (v_branch is null or public.dawaa_review_coverage_branch_key_v1(a.branch)=public.dawaa_review_coverage_branch_key_v1(v_branch))
      and public.dawaa_staff_checklist_assignment_due_v1(
        a.staff_id,a.cadence,a.weekday,a.active_from,a.active_to,a.workdays_only,v_date
      )
  ), agg as (
    select d.staff_id,d.branch,count(*)::integer required_items,count(s.id)::integer submitted_items,
      count(s.id) filter(where s.review_status in ('approved','rejected'))::integer reviewed_items,
      count(s.id) filter(where s.review_status='approved')::integer approved_items,
      count(s.id) filter(where s.review_status='rejected')::integer rejected_items,
      count(s.id) filter(where s.review_status='pending')::integer pending_items
    from due d left join public.staff_daily_checklist_submissions s
      on s.staff_id=d.staff_id and s.item_id=d.item_id and s.submission_date=v_date and s.completed=true
    group by d.staff_id,d.branch
  ), capped as (
    select a.*,
      case when a.required_items<=0 then 0 when a.reviewed_items<a.required_items then 0 when a.approved_items>=a.required_items then 5
           when a.approved_items::numeric/a.required_items>=0.83 then 4
           when a.approved_items::numeric/a.required_items>=0.67 then 3
           when a.approved_items::numeric/a.required_items>=0.50 then 2 else 1 end::integer max_stars,
      (a.required_items>0 and a.submitted_items>=a.required_items and a.reviewed_items>=a.required_items and a.pending_items=0) rating_ready
    from agg a
  )
  select c.staff_id,st.name,st.role,c.branch,v_date,c.required_items,c.submitted_items,c.reviewed_items,
    c.approved_items,c.rejected_items,c.pending_items,c.max_stars,c.rating_ready,
    r.id,r.stars::integer,r.score_pct,r.points_delta,r.manager_note,r.rated_by_name,r.updated_at
  from capped c join public.staff st on st.id=c.staff_id
  left join public.cleaning_daily_ratings r on r.staff_id=c.staff_id and r.rating_date=v_date
  order by c.branch,st.name;
end;
$function$;

notify pgrst, 'reload schema';
