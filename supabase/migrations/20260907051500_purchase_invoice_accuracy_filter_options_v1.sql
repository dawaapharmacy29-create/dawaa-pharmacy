-- Lightweight filter metadata for the purchase invoice accuracy page.
-- Keeps report/history tabs independent so opening reports does not require loading review rows.

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
