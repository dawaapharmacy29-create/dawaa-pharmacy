-- Architecture Hardening V5
-- Optimize high-traffic RLS policies so request/auth context is initialized once per statement
-- instead of being re-evaluated for every row. Semantics and role scopes are intentionally preserved.

-- employee_events
alter policy employee_events_insert_v1 on public.employee_events
  with check (
    actor_user_id is null
    or actor_user_id = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
  );

alter policy employee_events_self_read_v1 on public.employee_events
  using (
    subject_staff_id = dawaa_current_staff_id_v1()
    or exists (
      select 1
      from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  );

-- employee_compensation_profiles
alter policy employee_compensation_admin_write_v1 on public.employee_compensation_profiles
  using (
    exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager']::text[])
    )
  )
  with check (
    exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager']::text[])
    )
  );

alter policy employee_compensation_self_read_v1 on public.employee_compensation_profiles
  using (
    staff_id = dawaa_current_staff_id_v1()
    or exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  );

-- employee_monthly_statements
alter policy employee_statements_admin_write_v1 on public.employee_monthly_statements
  using (
    exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager']::text[])
    )
  )
  with check (
    exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager']::text[])
    )
  );

alter policy employee_statements_self_read_v1 on public.employee_monthly_statements
  using (
    staff_id = dawaa_current_staff_id_v1()
    or exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  );

-- manager_weekly_evaluations
alter policy manager_weekly_evaluations_read_v1 on public.manager_weekly_evaluations
  using (
    subject_staff_id::text = dawaa_current_staff_id_v1()
    or evaluator_staff_id::text = dawaa_current_staff_id_v1()
    or exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  );

alter policy manager_weekly_evaluations_write_v1 on public.manager_weekly_evaluations
  using (
    exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  )
  with check (
    exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  );

-- manager_daily_checklist
alter policy manager_daily_checklist_self_v1 on public.manager_daily_checklist
  using (
    staff_id::text = dawaa_current_staff_id_v1()
    or exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  )
  with check (
    staff_id::text = dawaa_current_staff_id_v1()
    or exists (
      select 1 from public.staff_accounts sa
      where sa.id::text = coalesce(
        ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
        ((select auth.uid()))::text
      )
      and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
    )
  );

-- CRM tenant policies
alter policy "Users can only access their company's CRM requests" on public.crm_requests
  using (((select auth.jwt()) ->> 'company_id') = company_id::text);

alter policy "Users can only access their company's CRM timeline" on public.crm_timeline
  using (((select auth.jwt()) ->> 'company_id') = company_id::text);

-- customer welcome logs
alter policy customer_welcome_message_logs_insert on public.customer_welcome_message_logs
  with check ((select auth.role()) = 'authenticated');

alter policy customer_welcome_message_logs_select on public.customer_welcome_message_logs
  using ((select auth.role()) = 'authenticated');

alter policy customer_welcome_message_logs_update on public.customer_welcome_message_logs
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');
