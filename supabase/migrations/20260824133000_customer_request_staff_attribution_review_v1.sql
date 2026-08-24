-- Read-only review model for legacy Customer Request staff attribution.
-- It never writes doctor_id and never guesses across ambiguous staff matches.

create or replace function public.dawaa_customer_request_normalize_staff_label(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(p_value, '')), '[\/\\._-]+', ' ', 'g'),
          '(^|[[:space:]])(د|دكتور|دكتورة|ا|أ|استاذ|أستاذ)[[:space:]]+',
          ' ',
          'g'
        ),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create or replace function public.get_customer_request_staff_attribution_review_v1(
  p_branch text default null,
  p_limit integer default 100
)
returns table (
  source_label text,
  branch text,
  requests_count bigint,
  suggested_staff_id uuid,
  suggested_staff_name text,
  suggested_staff_role text,
  match_state text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with unresolved as (
    select
      nullif(trim(cr.source_assigned_employee), '') as source_label,
      cr.branch,
      count(*)::bigint as requests_count,
      public.dawaa_customer_request_normalize_staff_label(cr.source_assigned_employee) as normalized_label
    from public.customer_requests cr
    where cr.doctor_id is null
      and nullif(trim(coalesce(cr.source_assigned_employee, '')), '') is not null
      and (
        p_branch is null
        or trim(p_branch) = ''
        or lower(trim(p_branch)) = 'all'
        or cr.branch = p_branch
      )
    group by 1, 2, 4
  ), candidates as (
    select
      u.*,
      s.id as staff_id,
      s.name as staff_name,
      s.role as staff_role,
      count(s.id) over (partition by u.source_label, u.branch) as candidate_count
    from unresolved u
    left join public.staff s
      on public.dawaa_customer_request_normalize_staff_label(s.name) = u.normalized_label
     and coalesce(s.is_active, true) = true
     and coalesce(s.active, true) = true
     and (
       s.branch = u.branch
       or s.branch = 'كل الفروع'
     )
  )
  select
    c.source_label,
    c.branch,
    max(c.requests_count)::bigint,
    case when max(c.candidate_count) = 1 then max(c.staff_id) else null end,
    case when max(c.candidate_count) = 1 then max(c.staff_name) else null end,
    case when max(c.candidate_count) = 1 then max(c.staff_role) else null end,
    case
      when max(c.candidate_count) = 1 then 'unique_exact_normalized'
      when max(c.candidate_count) > 1 then 'ambiguous'
      else 'unmatched'
    end as match_state
  from candidates c
  where public.dawaa_customer_request_points_reader_allowed()
  group by c.source_label, c.branch
  order by max(c.requests_count) desc, c.source_label
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.get_customer_request_staff_attribution_review_v1(text, integer) from public;
grant execute on function public.get_customer_request_staff_attribution_review_v1(text, integer) to anon, authenticated, service_role;
