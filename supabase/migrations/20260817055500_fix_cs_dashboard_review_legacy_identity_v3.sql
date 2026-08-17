create or replace function public.get_cs_dashboard_reviews(
  p_branch text,
  p_staff_name text,
  p_cycle_start date,
  p_cycle_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_result jsonb;
  v_norm_name text := public.normalize_cs_name(p_staff_name);
  v_end date := least(p_cycle_end, current_date);
begin
  with staff_aliases as materialized (
    select sa.staff_id::text as staff_id, nullif(trim(sa.name), '') as canonical_name,
           public.normalize_cs_name(sa.name) as norm_name
    from public.staff_accounts sa
    where sa.staff_id is not null and nullif(trim(sa.name), '') is not null
    union all
    select sa.staff_id::text, nullif(trim(sa.name), ''), public.normalize_cs_name(sa.staff_name)
    from public.staff_accounts sa
    where sa.staff_id is not null and nullif(trim(sa.staff_name), '') is not null
  ),
  unique_name_map as materialized (
    select norm_name,
           max(staff_id) as staff_id,
           max(canonical_name) as canonical_name
    from staff_aliases
    where norm_name <> ''
    group by norm_name
    having count(distinct staff_id) = 1
  ),
  raw_reviews as materialized (
    select
      coalesce(csr.staff_id::text, csr.doctor_id::text) as raw_person_id,
      coalesce(nullif(trim(csr.staff_name), ''), nullif(trim(csr.doctor_name), '')) as raw_doctor_name,
      public.normalize_cs_name(coalesce(nullif(trim(csr.staff_name), ''), nullif(trim(csr.doctor_name), ''))) as norm_doctor_name,
      csr.reviewer_name,
      csr.final_score,
      csr.doctor_points_impact
    from public.conversation_sales_reviews csr
    where csr.branch = p_branch
      and csr.conversation_date >= p_cycle_start::timestamp
      and csr.conversation_date < (v_end + 1)::timestamp
  ),
  review_rows as materialized (
    select
      coalesce(rr.raw_person_id, unm.staff_id) as person_id,
      rr.raw_doctor_name,
      rr.norm_doctor_name,
      coalesce(unm.canonical_name, rr.raw_doctor_name) as canonical_name,
      rr.reviewer_name,
      rr.final_score,
      rr.doctor_points_impact
    from raw_reviews rr
    left join unique_name_map unm
      on rr.raw_person_id is null and unm.norm_name = rr.norm_doctor_name
  ),
  id_names as materialized (
    select person_id, max(canonical_name) as canonical_name
    from review_rows
    where person_id is not null
    group by person_id
  ),
  reviews_this_cycle as (
    select count(*) as review_count, round(avg(final_score), 1) as avg_score_given
    from review_rows
    where public.normalize_cs_name(reviewer_name) = v_norm_name
  ),
  doctor_ratings as (
    select
      coalesce(idn.canonical_name, min(rr.raw_doctor_name), 'غير محدد') as doctor_name,
      round(avg(rr.final_score), 1) as avg_score,
      count(*) as review_count,
      round(sum(coalesce(rr.doctor_points_impact, 0)), 1) as total_incentive_impact
    from review_rows rr
    left join id_names idn on idn.person_id = rr.person_id
    where coalesce(rr.raw_doctor_name, '') <> '' or rr.person_id is not null
    group by rr.person_id,
             case when rr.person_id is null then rr.norm_doctor_name else null end,
             idn.canonical_name
    order by avg_score desc, review_count desc
  ),
  branch_reviews as (
    select round(avg(final_score), 1) as branch_avg_score, count(*) as branch_review_count
    from review_rows
  ),
  team_ranking as (
    select public.normalize_cs_name(reviewer_name) as rep_name,
           count(*) as review_count,
           round(avg(final_score), 1) as avg_score_given
    from review_rows
    where coalesce(reviewer_name, '') <> ''
    group by public.normalize_cs_name(reviewer_name)
    order by review_count desc
  )
  select jsonb_build_object(
    'my_reviews_this_cycle', (select to_jsonb(x) from reviews_this_cycle x),
    'doctor_ratings', (select coalesce(jsonb_agg(x), '[]'::jsonb) from doctor_ratings x),
    'branch_reviews', (select to_jsonb(x) from branch_reviews x),
    'team_ranking', (select coalesce(jsonb_agg(x), '[]'::jsonb) from team_ranking x),
    'recovery_stats', public.get_followup_recovery_stats(p_branch, p_staff_name, p_cycle_start, v_end)
  ) into v_result;
  return v_result;
end;
$function$;

grant execute on function public.get_cs_dashboard_reviews(text,text,date,date) to anon, authenticated;
