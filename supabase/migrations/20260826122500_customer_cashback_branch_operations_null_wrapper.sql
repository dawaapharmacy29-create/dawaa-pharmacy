-- Keep the implementation private and expose a null-safe public wrapper.
alter function public.dawaa_customer_cashback_branch_operations_v1(text,date)
  rename to dawaa_customer_cashback_branch_operations_impl_v1;

create function public.dawaa_customer_cashback_branch_operations_v1(
  p_branch text,
  p_reference_date date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.dawaa_customer_cashback_branch_operations_impl_v1(
    p_branch,
    coalesce(p_reference_date, current_date)
  );
$function$;

revoke all on function public.dawaa_customer_cashback_branch_operations_v1(text,date) from public;
grant execute on function public.dawaa_customer_cashback_branch_operations_v1(text,date) to anon, authenticated;
revoke all on function public.dawaa_customer_cashback_branch_operations_impl_v1(text,date) from public, anon, authenticated;
