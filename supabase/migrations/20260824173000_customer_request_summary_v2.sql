-- One-round-trip operations summary for Customer Requests V2.
-- Extends the existing command-center summary with follow-up-due count inside the database.

create or replace function public.get_customer_requests_command_center_summary_v2(
  p_branch text default null
)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  with base as (
    select public.get_customer_requests_command_center_summary(p_branch) as payload
  ),
  followups as (
    select count(*)::int as followup_due
    from public.customer_requests cr
    where lower(trim(coalesce(cr.status,'new'))) not in ('closed','delivered','cancelled')
      and (
        cr.next_action_at <= now()
        or (
          cr.next_action_at is null
          and cr.due_date is not null
          and cr.due_date <= (now() at time zone 'Africa/Cairo')::date
        )
      )
      and (
        p_branch is null
        or trim(coalesce(p_branch,''))=''
        or lower(trim(p_branch))='all'
        or public.dawaa_customer_request_branch_key(cr.branch)=public.dawaa_customer_request_branch_key(p_branch)
      )
  )
  select coalesce(base.payload,'{}'::jsonb) || jsonb_build_object('followup_due',followups.followup_due)
  from base cross join followups;
$$;

revoke all on function public.get_customer_requests_command_center_summary_v2(text) from public;
grant execute on function public.get_customer_requests_command_center_summary_v2(text)
  to anon, authenticated, service_role;

comment on function public.get_customer_requests_command_center_summary_v2(text) is
  'Customer Requests V2 command summary including exact follow-up due count in one database round trip.';
