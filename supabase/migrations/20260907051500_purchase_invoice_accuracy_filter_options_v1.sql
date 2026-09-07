-- Lightweight filter metadata and canonical filtered querying for the purchase invoice accuracy page.
-- Keeps report/history tabs independent and makes filters authoritative across the full dataset.

create or replace function public.get_purchase_invoice_accuracy_filter_options_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb;
begin
  perform public.assert_purchase_invoice_accuracy_access_v1();

  select jsonb_build_object(
    'staff', coalesce((
      select jsonb_agg(name order by name)
      from (
        select distinct staff_name as name
        from public.purchase_invoice_accuracy_reviews_v1
        where staff_name is not null and trim(staff_name) <> ''
        union
        select distinct coalesce(entered_by_staff_name, entered_by_raw) as name
        from public.purchase_invoice_accuracy_pending_v1
        where coalesce(entered_by_staff_name, entered_by_raw) is not null
          and trim(coalesce(entered_by_staff_name, entered_by_raw)) <> ''
      ) s
    ), '[]'::jsonb),
    'reviewers', coalesce((
      select jsonb_agg(reviewed_by_name order by reviewed_by_name)
      from (
        select distinct reviewed_by_name
        from public.purchase_invoice_accuracy_reviews_v1
        where reviewed_by_name is not null and trim(reviewed_by_name) <> ''
      ) r
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(branch order by branch)
      from (
        select distinct branch
        from public.purchase_invoice_accuracy_reviews_v1
        where branch is not null and trim(branch) <> ''
        union
        select distinct branch
        from public.purchase_invoice_accuracy_pending_v1
        where branch is not null and trim(branch) <> ''
      ) b
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_purchase_invoice_accuracy_filter_options_v1() from public, anon, authenticated;
grant execute on function public.get_purchase_invoice_accuracy_filter_options_v1() to anon, authenticated;

create or replace function public.query_purchase_invoice_accuracy_v1(
  p_query text default null,
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
  v_query text := lower(trim(coalesce(p_query, '')));
  v_has_query boolean := char_length(v_query) >= 2;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 300));
  v_result jsonb;
begin
  perform public.assert_purchase_invoice_accuracy_access_v1();

  with pending_matches as (
    select
      p.id,
      p.base44_id,
      p.system_invoice_number,
      p.branch,
      p.transaction_type,
      p.entered_by_raw,
      p.entered_by_staff_id,
      p.entered_by_staff_name,
      p.match_status,
      p.invoice_date,
      p.total_value
    from public.purchase_invoice_accuracy_pending_v1 p
    where (p_from_date is null or p.invoice_date >= p_from_date)
      and (p_to_date is null or p.invoice_date <= p_to_date)
      and (p_staff_name is null or coalesce(p.entered_by_staff_name, p.entered_by_raw) = p_staff_name)
      and (p_branch is null or p.branch = p_branch)
      and (
        not v_has_query
        or lower(coalesce(p.system_invoice_number, '')) like '%' || v_query || '%'
        or lower(coalesce(p.base44_id, '')) like '%' || v_query || '%'
        or lower(coalesce(p.entered_by_staff_name, '')) like '%' || v_query || '%'
        or lower(coalesce(p.entered_by_raw, '')) like '%' || v_query || '%'
      )
    order by p.invoice_date desc nulls last, p.synced_at desc
    limit v_limit
  ),
  review_matches as (
    select
      r.id,
      r.staff_id,
      r.staff_name,
      r.branch,
      r.invoice_reference,
      r.outcome,
      r.points,
      r.notes,
      r.review_date,
      r.reviewed_by_name
    from public.purchase_invoice_accuracy_reviews_v1 r
    where (p_from_date is null or r.review_date >= p_from_date)
      and (p_to_date is null or r.review_date <= p_to_date)
      and (p_staff_name is null or r.staff_name = p_staff_name)
      and (p_reviewer_name is null or r.reviewed_by_name = p_reviewer_name)
      and (p_branch is null or r.branch = p_branch)
      and (
        not v_has_query
        or lower(coalesce(r.invoice_reference, '')) like '%' || v_query || '%'
        or lower(coalesce(r.staff_name, '')) like '%' || v_query || '%'
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

revoke all on function public.query_purchase_invoice_accuracy_v1(text, date, date, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.query_purchase_invoice_accuracy_v1(text, date, date, text, text, text, integer)
  to anon, authenticated;
