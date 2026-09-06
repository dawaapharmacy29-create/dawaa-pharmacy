create or replace function public.search_purchase_invoice_accuracy_v1(
  p_query text,
  p_from_date date default null,
  p_to_date date default null,
  p_staff_name text default null,
  p_reviewer_name text default null,
  p_branch text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_query text := lower(trim(coalesce(p_query, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 300));
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

  if char_length(v_query) < 2 then
    return jsonb_build_object('pending', '[]'::jsonb, 'reviews', '[]'::jsonb);
  end if;

  with pending_matches as (
    select
      b.id,
      b.base44_id,
      b.system_invoice_number,
      b.branch,
      b.transaction_type,
      b.entered_by_raw,
      b.entered_by_staff_id,
      s.name as entered_by_staff_name,
      b.match_status,
      b.invoice_date,
      b.total_value
    from public.base44_purchase_invoice_sync b
    left join public.staff s on s.id = b.entered_by_staff_id
    where b.review_id is null
      and (p_from_date is null or b.invoice_date >= p_from_date)
      and (p_to_date is null or b.invoice_date <= p_to_date)
      and (p_staff_name is null or coalesce(s.name, b.entered_by_raw) = p_staff_name)
      and (p_branch is null or b.branch = p_branch)
      and (
        lower(coalesce(b.system_invoice_number, '')) like '%' || v_query || '%'
        or lower(coalesce(b.base44_id, '')) like '%' || v_query || '%'
        or lower(coalesce(s.name, '')) like '%' || v_query || '%'
        or lower(coalesce(b.entered_by_raw, '')) like '%' || v_query || '%'
      )
    order by b.invoice_date desc nulls last, b.synced_at desc
    limit v_limit
  ),
  review_matches as (
    select
      r.id,
      r.staff_id,
      s.name as staff_name,
      r.branch,
      r.invoice_reference,
      r.outcome,
      r.points,
      r.notes,
      r.review_date,
      r.reviewed_by_name
    from public.purchase_invoice_entry_reviews r
    join public.staff s on s.id = r.staff_id
    where (p_from_date is null or r.review_date >= p_from_date)
      and (p_to_date is null or r.review_date <= p_to_date)
      and (p_staff_name is null or s.name = p_staff_name)
      and (p_reviewer_name is null or r.reviewed_by_name = p_reviewer_name)
      and (p_branch is null or r.branch = p_branch)
      and (
        lower(coalesce(r.invoice_reference, '')) like '%' || v_query || '%'
        or lower(coalesce(s.name, '')) like '%' || v_query || '%'
        or lower(coalesce(r.reviewed_by_name, '')) like '%' || v_query || '%'
        or lower(coalesce(r.notes, '')) like '%' || v_query || '%'
      )
    order by r.review_date desc, r.created_at desc
    limit v_limit
  )
  select jsonb_build_object(
    'pending', coalesce((select jsonb_agg(to_jsonb(p)) from pending_matches p), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r)) from review_matches r), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.search_purchase_invoice_accuracy_v1(text, date, date, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_purchase_invoice_accuracy_v1(text, date, date, text, text, text, integer)
  to anon, authenticated;

create or replace function public.get_purchase_invoice_accuracy_staff_detail_v1(
  p_staff_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_limit integer default 150
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 150), 300));
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

  with staff_row as (
    select s.id, s.name, s.branch
    from public.staff s
    where s.id = p_staff_id
  ),
  reviews as (
    select
      r.id,
      r.invoice_reference,
      r.outcome,
      r.points,
      r.notes,
      r.review_date,
      r.reviewed_by_name,
      r.branch
    from public.purchase_invoice_entry_reviews r
    where r.staff_id = p_staff_id
      and (p_from_date is null or r.review_date >= p_from_date)
      and (p_to_date is null or r.review_date <= p_to_date)
    order by r.review_date desc, r.created_at desc
    limit v_limit
  ),
  summary as (
    select jsonb_build_object(
      'reviewed_count', count(*),
      'correct_count', count(*) filter (where outcome = 'correct'),
      'mixup_count', count(*) filter (where outcome = 'mixup_unregistered'),
      'negligence_count', count(*) filter (where outcome = 'negligence'),
      'customer_problem_count', count(*) filter (where outcome = 'customer_problem'),
      'total_points', coalesce(sum(points), 0),
      'accuracy_rate', coalesce(round(100.0 * count(*) filter (where outcome = 'correct') / nullif(count(*), 0), 1), 0),
      'avg_points', coalesce(round(avg(points), 2), 0)
    ) as value
    from reviews
  )
  select jsonb_build_object(
    'staff', coalesce((select to_jsonb(s) from staff_row s), '{}'::jsonb),
    'summary', coalesce((select value from summary), '{}'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r)) from reviews r), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_purchase_invoice_accuracy_staff_detail_v1(uuid, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.get_purchase_invoice_accuracy_staff_detail_v1(uuid, date, date, integer)
  to anon, authenticated;
