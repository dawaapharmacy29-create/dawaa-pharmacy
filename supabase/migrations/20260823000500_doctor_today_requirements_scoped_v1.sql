create or replace function public.get_doctor_today_requirements_v1(
  p_staff_id text,
  p_doctor_name text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_staff_id, '')), '') as staff_id,
      lower(regexp_replace(translate(btrim(coalesce(p_doctor_name, '')), 'أإآةى', 'اااهي'), '^(دكتور|دكتوره|د|dr|doctor)[ /._-]*', '', 'i')) as doctor_name
  ), stagnant as (
    select to_jsonb(s) || jsonb_build_object('requirement_source', 'stagnant') as row_data
    from public.stagnant_medicines s
    cross join args a
    where coalesce(s.remaining_quantity, s.quantity_available, s.total_quantity, 0) > 0
      and (
        (a.staff_id is not null and (
          s.responsible_doctor_id::text = a.staff_id or
          nullif(btrim(coalesce(s.doctor_id, '')), '') = a.staff_id
        ))
        or
        (a.doctor_name <> '' and lower(regexp_replace(translate(btrim(coalesce(s.responsible_doctor_name, s.responsible_doctor, '')), 'أإآةى', 'اااهي'), '^(دكتور|دكتوره|د|dr|doctor)[ /._-]*', '', 'i')) = a.doctor_name)
      )
    order by coalesce(s.nearest_expiry_date, s.expiry_date) asc nulls last
    limit 60
  ), incentive as (
    select to_jsonb(i) || jsonb_build_object('requirement_source', 'incentive') as row_data
    from public.incentive_medicines i
    cross join args a
    where coalesce(i.active, true) = true
      and (
        (a.staff_id is not null and nullif(btrim(coalesce(i.doctor_id, '')), '') = a.staff_id)
        or
        (a.doctor_name <> '' and lower(regexp_replace(translate(btrim(coalesce(i.responsible_doctor, '')), 'أإآةى', 'اااهي'), '^(دكتور|دكتوره|د|dr|doctor)[ /._-]*', '', 'i')) = a.doctor_name)
      )
    order by i.expiry_date asc nulls last
    limit 60
  )
  select coalesce(jsonb_agg(row_data), '[]'::jsonb)
  from (
    select row_data from stagnant
    union all
    select row_data from incentive
  ) rows;
$$;

grant execute on function public.get_doctor_today_requirements_v1(text, text) to authenticated;
