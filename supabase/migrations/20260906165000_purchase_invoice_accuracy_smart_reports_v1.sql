create or replace function public.get_purchase_invoice_accuracy_report_v1(
  p_from_date date default null,
  p_to_date date default null,
  p_staff_name text default null,
  p_reviewer_name text default null,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_result jsonb;
begin
  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if not public.dawaa_is_customer_service_evaluator_v1(
    public.dawaa_current_staff_subject_uuid_v1(),
    lower(trim(coalesce(v_account.role, '')))
  ) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  with filtered_reviews as (
    select
      r.id,
      r.staff_id,
      s.name as staff_name,
      r.branch,
      r.outcome,
      r.points,
      r.review_date,
      r.reviewed_by_name
    from public.purchase_invoice_entry_reviews r
    join public.staff s on s.id = r.staff_id
    where (p_from_date is null or r.review_date >= p_from_date)
      and (p_to_date is null or r.review_date <= p_to_date)
      and (p_staff_name is null or s.name = p_staff_name)
      and (p_reviewer_name is null or r.reviewed_by_name = p_reviewer_name)
      and (p_branch is null or r.branch = p_branch)
  ),
  filtered_pending as (
    select
      b.id,
      b.branch,
      b.invoice_date,
      b.entered_by_raw,
      b.entered_by_staff_id,
      s.name as staff_name,
      b.match_status
    from public.base44_purchase_invoice_sync b
    left join public.staff s on s.id = b.entered_by_staff_id
    where b.review_id is null
      and (p_from_date is null or b.invoice_date >= p_from_date)
      and (p_to_date is null or b.invoice_date <= p_to_date)
      and (p_staff_name is null or coalesce(s.name, b.entered_by_raw) = p_staff_name)
      and (p_branch is null or b.branch = p_branch)
  ),
  summary as (
    select jsonb_build_object(
      'reviewed_count', (select count(*) from filtered_reviews),
      'pending_count', (select count(*) from filtered_pending),
      'correct_count', (select count(*) from filtered_reviews where outcome = 'correct'),
      'mixup_count', (select count(*) from filtered_reviews where outcome = 'mixup_unregistered'),
      'negligence_count', (select count(*) from filtered_reviews where outcome = 'negligence'),
      'customer_problem_count', (select count(*) from filtered_reviews where outcome = 'customer_problem'),
      'unknown_staff_count', (
        select count(*)
        from filtered_pending
        where entered_by_staff_id is null
           or match_status in ('ambiguous', 'unmatched', 'empty')
      ),
      'total_points', coalesce((select sum(points) from filtered_reviews), 0),
      'accuracy_rate', coalesce((
        select round(100.0 * count(*) filter (where outcome = 'correct') / nullif(count(*), 0), 1)
        from filtered_reviews
      ), 0)
    ) as value
  ),
  staff_rows as (
    select jsonb_agg(
      jsonb_build_object(
        'staff_id', x.staff_id,
        'staff_name', x.staff_name,
        'branch', x.branch,
        'reviewed_count', x.reviewed_count,
        'correct_count', x.correct_count,
        'mixup_count', x.mixup_count,
        'negligence_count', x.negligence_count,
        'customer_problem_count', x.customer_problem_count,
        'total_points', x.total_points,
        'accuracy_rate', x.accuracy_rate,
        'avg_points', x.avg_points
      )
      order by x.accuracy_rate desc, x.reviewed_count desc, x.staff_name
    ) as value
    from (
      select
        staff_id,
        max(staff_name) as staff_name,
        max(branch) as branch,
        count(*)::int as reviewed_count,
        count(*) filter (where outcome = 'correct')::int as correct_count,
        count(*) filter (where outcome = 'mixup_unregistered')::int as mixup_count,
        count(*) filter (where outcome = 'negligence')::int as negligence_count,
        count(*) filter (where outcome = 'customer_problem')::int as customer_problem_count,
        coalesce(sum(points), 0)::numeric as total_points,
        coalesce(round(100.0 * count(*) filter (where outcome = 'correct') / nullif(count(*), 0), 1), 0)::numeric as accuracy_rate,
        coalesce(round(avg(points), 2), 0)::numeric as avg_points
      from filtered_reviews
      group by staff_id
    ) x
  ),
  branch_names as (
    select branch from filtered_reviews where branch is not null
    union
    select branch from filtered_pending where branch is not null
  ),
  branch_rows as (
    select jsonb_agg(
      jsonb_build_object(
        'branch', b.branch,
        'reviewed_count', coalesce(r.reviewed_count, 0),
        'pending_count', coalesce(p.pending_count, 0),
        'correct_count', coalesce(r.correct_count, 0),
        'negligence_count', coalesce(r.negligence_count, 0),
        'customer_problem_count', coalesce(r.customer_problem_count, 0),
        'total_points', coalesce(r.total_points, 0),
        'accuracy_rate', coalesce(r.accuracy_rate, 0)
      )
      order by coalesce(r.accuracy_rate, 0) desc, b.branch
    ) as value
    from branch_names b
    left join (
      select
        branch,
        count(*)::int as reviewed_count,
        count(*) filter (where outcome = 'correct')::int as correct_count,
        count(*) filter (where outcome = 'negligence')::int as negligence_count,
        count(*) filter (where outcome = 'customer_problem')::int as customer_problem_count,
        coalesce(sum(points), 0)::numeric as total_points,
        coalesce(round(100.0 * count(*) filter (where outcome = 'correct') / nullif(count(*), 0), 1), 0)::numeric as accuracy_rate
      from filtered_reviews
      where branch is not null
      group by branch
    ) r on r.branch = b.branch
    left join (
      select branch, count(*)::int as pending_count
      from filtered_pending
      where branch is not null
      group by branch
    ) p on p.branch = b.branch
  ),
  daily_rows as (
    select jsonb_agg(
      jsonb_build_object(
        'report_date', x.report_date,
        'reviewed_count', x.reviewed_count,
        'correct_count', x.correct_count,
        'total_points', x.total_points,
        'accuracy_rate', x.accuracy_rate
      )
      order by x.report_date
    ) as value
    from (
      select
        review_date as report_date,
        count(*)::int as reviewed_count,
        count(*) filter (where outcome = 'correct')::int as correct_count,
        coalesce(sum(points), 0)::numeric as total_points,
        coalesce(round(100.0 * count(*) filter (where outcome = 'correct') / nullif(count(*), 0), 1), 0)::numeric as accuracy_rate
      from filtered_reviews
      group by review_date
      order by review_date
    ) x
  )
  select jsonb_build_object(
    'summary', coalesce((select value from summary), '{}'::jsonb),
    'staff', coalesce((select value from staff_rows), '[]'::jsonb),
    'branches', coalesce((select value from branch_rows), '[]'::jsonb),
    'daily', coalesce((select value from daily_rows), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_purchase_invoice_accuracy_report_v1(date, date, text, text, text) from public, anon, authenticated;
grant execute on function public.get_purchase_invoice_accuracy_report_v1(date, date, text, text, text) to anon, authenticated;
