-- DB/RLS timeout hardening v1
--
-- Goal:
--   * Preserve the exact authorization model.
--   * Force request-context helpers to be evaluated once per SQL statement (InitPlan)
--     instead of once per candidate row.
--   * Add focused indexes for the correlated notification lookups that are executed
--     by notification_events_v2 / dawaa_notification_inbox_visible_v3.
--
-- This migration intentionally does NOT increase statement_timeout and does NOT
-- weaken RLS. It removes repeated work at the source.

-- ---------------------------------------------------------------------------
-- 1) Sales Intelligence read-path RLS: cache request identity / management checks
-- ---------------------------------------------------------------------------

drop policy if exists sales_intelligence_cases_select_v1 on public.sales_intelligence_cases;
create policy sales_intelligence_cases_select_v1
on public.sales_intelligence_cases
for select
to public
using (
  (select public.dawaa_actor_is_top_management_v1())
  or exists (
    select 1
    from public.staff_accounts me
    where me.id = (select public.dawaa_current_staff_account_id_strict())
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(sales_intelligence_cases.branch_name_raw)
        )
      )
  )
);

drop policy if exists sales_intelligence_case_analyses_select_v1 on public.sales_intelligence_case_analyses;
create policy sales_intelligence_case_analyses_select_v1
on public.sales_intelligence_case_analyses
for select
to public
using (
  (select public.dawaa_actor_is_top_management_v1())
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_case_analyses.case_id
    where me.id = (select public.dawaa_current_staff_account_id_strict())
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(c.branch_name_raw)
        )
      )
  )
);

drop policy if exists sales_intelligence_attributions_select_v1 on public.sales_intelligence_attributions;
create policy sales_intelligence_attributions_select_v1
on public.sales_intelligence_attributions
for select
to public
using (
  (select public.dawaa_actor_is_top_management_v1())
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_attributions.case_id
    where me.id = (select public.dawaa_current_staff_account_id_strict())
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(c.branch_name_raw)
        )
      )
  )
);

drop policy if exists sales_intelligence_bim_select_v1 on public.sales_intelligence_basket_invoice_matches;
create policy sales_intelligence_bim_select_v1
on public.sales_intelligence_basket_invoice_matches
for select
to public
using (
  (select public.dawaa_actor_is_top_management_v1())
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_basket_invoice_matches.case_id
    where me.id = (select public.dawaa_current_staff_account_id_strict())
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(c.branch_name_raw)
        )
      )
  )
);

drop policy if exists sales_intelligence_policy_evaluations_select_v1 on public.sales_intelligence_policy_evaluations;
create policy sales_intelligence_policy_evaluations_select_v1
on public.sales_intelligence_policy_evaluations
for select
to public
using (
  (select public.dawaa_actor_is_top_management_v1())
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_policy_evaluations.case_id
    where me.id = (select public.dawaa_current_staff_account_id_strict())
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(c.branch_name_raw)
        )
      )
  )
);

drop policy if exists sales_intelligence_policy_config_select_v1 on public.sales_intelligence_policy_config;
create policy sales_intelligence_policy_config_select_v1
on public.sales_intelligence_policy_config
for select
to public
using (
  (select public.dawaa_actor_is_top_management_v1())
  or exists (
    select 1
    from public.staff_accounts me
    where me.id = (select public.dawaa_current_staff_account_id_strict())
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
  )
);

drop policy if exists sales_intelligence_policy_config_insert_v1 on public.sales_intelligence_policy_config;
create policy sales_intelligence_policy_config_insert_v1
on public.sales_intelligence_policy_config
for insert
to public
with check ((select public.dawaa_actor_is_top_management_v1()));

-- ---------------------------------------------------------------------------
-- 2) WhatsApp review/source RLS used by the SI views
-- ---------------------------------------------------------------------------

drop policy if exists whatsapp_review_sources_select_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_select_v1
on public.whatsapp_review_sources
for select
to public
using (
  (select public.dawaa_current_actor_can(array['view_reviews','view_conversation_reviews','manage_conversation_evaluations']))
  and (
    (select public.dawaa_actor_is_top_management_v1())
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = (select public.dawaa_current_staff_account_id_strict())
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or me.staff_id = whatsapp_review_sources.staff_id::text
          or (
            lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
            and public.dawaa_customer_request_branch_key(me.branch) is not null
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
);

drop policy if exists whatsapp_review_sources_insert_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_insert_v1
on public.whatsapp_review_sources
for insert
to public
with check (
  (select public.dawaa_current_actor_can(array['add_reviews','reviews.action.create','manage_conversation_evaluations']))
  and (
    (select public.dawaa_actor_is_top_management_v1())
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = (select public.dawaa_current_staff_account_id_strict())
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or (
            whatsapp_review_sources.branch is not null
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
);

drop policy if exists whatsapp_review_sources_update_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_update_v1
on public.whatsapp_review_sources
for update
to public
using (
  (select public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations']))
  and (
    (select public.dawaa_actor_is_top_management_v1())
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = (select public.dawaa_current_staff_account_id_strict())
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or me.staff_id = whatsapp_review_sources.staff_id::text
          or (
            lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
)
with check (
  (select public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations']))
  and (
    (select public.dawaa_actor_is_top_management_v1())
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = (select public.dawaa_current_staff_account_id_strict())
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or me.staff_id = whatsapp_review_sources.staff_id::text
          or (
            lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
);

drop policy if exists whatsapp_sales_opportunities_v17_select on public.whatsapp_sales_opportunities_v17;
create policy whatsapp_sales_opportunities_v17_select
on public.whatsapp_sales_opportunities_v17
for select
to public
using (
  exists (
    select 1
    from public.whatsapp_review_sources s
    where s.id = whatsapp_sales_opportunities_v17.root_source_id
      and public.dawaa_can_read_conversation_review_row_v2(
        (select public.dawaa_current_staff_account_id_strict()),
        s.staff_id,
        null::uuid,
        s.branch,
        null::uuid
      )
  )
);

drop policy if exists whatsapp_sales_opportunities_v17_insert on public.whatsapp_sales_opportunities_v17;
create policy whatsapp_sales_opportunities_v17_insert
on public.whatsapp_sales_opportunities_v17
for insert
to public
with check (
  (select public.dawaa_current_actor_can(array['add_reviews','reviews.action.create','manage_conversation_evaluations']))
  and exists (
    select 1
    from public.whatsapp_review_sources s
    where s.id = whatsapp_sales_opportunities_v17.root_source_id
      and public.dawaa_can_read_conversation_review_row_v2(
        (select public.dawaa_current_staff_account_id_strict()),
        s.staff_id,
        null::uuid,
        s.branch,
        null::uuid
      )
  )
);

drop policy if exists whatsapp_sales_opportunities_v17_update on public.whatsapp_sales_opportunities_v17;
create policy whatsapp_sales_opportunities_v17_update
on public.whatsapp_sales_opportunities_v17
for update
to public
using ((select public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations'])))
with check ((select public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations'])));

-- ---------------------------------------------------------------------------
-- 3) Notifications: remove repeated current-user lookups from the SELECT policy
-- ---------------------------------------------------------------------------

-- The first half below is an inlined, equivalent form of
-- dawaa_notification_visible_to_current_user_v2(). Request context helpers are
-- scalar subqueries so Postgres can evaluate them once per statement.
drop policy if exists notifications_select_visible_v2 on public.notifications;
create policy notifications_select_visible_v2
on public.notifications
for select
to public
using (
  (
    case
      when (select public.dawaa_current_notification_account_id_v1()) is null then false
      when nullif(trim(coalesce((select public.dawaa_current_notification_role_v1()),'')),'') in ('general_manager','executive_manager','branches_manager') then true
      when nullif(trim(coalesce(recipient_user_id,'')),'') is null
       and nullif(trim(coalesce(user_id::text,'')),'') is null
       and nullif(trim(coalesce(recipient_staff_id,staff_id,'')),'') is null
       and nullif(lower(trim(coalesce(recipient_role,''))),'') is null
       and nullif(lower(trim(coalesce(branch,''))),'') is null then false
      else
        (nullif(trim(coalesce(recipient_user_id,'')),'') is null
          or nullif(trim(coalesce(recipient_user_id,'')),'') = (select public.dawaa_current_notification_account_id_v1()))
        and (nullif(trim(coalesce(user_id::text,'')),'') is null
          or nullif(trim(coalesce(user_id::text,'')),'') = (select public.dawaa_current_notification_account_id_v1()))
        and (nullif(trim(coalesce(recipient_staff_id,staff_id,'')),'') is null
          or nullif(trim(coalesce(recipient_staff_id,staff_id,'')),'') = nullif(trim(coalesce((select public.dawaa_current_staff_id_v1()),'')),''))
        and (nullif(lower(trim(coalesce(recipient_role,''))),'') is null
          or nullif(lower(trim(coalesce(recipient_role,''))),'') = nullif(trim(coalesce((select public.dawaa_current_notification_role_v1()),'')),''))
        and (nullif(lower(trim(coalesce(branch,''))),'') is null
          or nullif(lower(trim(coalesce(branch,''))),'') = nullif(trim(coalesce((select public.dawaa_current_notification_branch_v1()),'')),''))
    end
  )
  and public.dawaa_notification_inbox_visible_v3(
    (select public.dawaa_current_notification_role_v1()),
    (select public.dawaa_current_notification_account_id_v1()),
    (select public.dawaa_current_staff_id_v1()),
    id::text,
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    coalesce(notification_type,type),
    priority,
    target_type,
    title,
    branch,
    created_at,
    metadata
  )
);

-- Focused indexes for the correlated EXISTS lookups used by the notification
-- inbox/view. All are partial on live (non-archived) notifications.
create index if not exists notifications_inbox_title_branch_latest_v3_idx
  on public.notifications (title, branch, created_at desc, id)
  where archived_at is null;

create index if not exists notifications_sla_source_stage_open_v3_idx
  on public.notifications (
    (coalesce(metadata->>'sourceNotificationId','')),
    (lower(coalesce(metadata->>'slaStage','')))
  )
  where archived_at is null
    and lower(coalesce(metadata->>'slaGenerated','false')) = 'true';

create index if not exists notifications_vip_dedupe_open_v3_idx
  on public.notifications (
    (lower(coalesce(target_type,entity_type,''))),
    (coalesce(target_id,entity_id,'')),
    title,
    branch,
    created_at desc
  )
  where archived_at is null;

create index if not exists notifications_recipient_dedupe_open_v3_idx
  on public.notifications (
    title,
    branch,
    (coalesce(recipient_staff_id,staff_id,recipient_role,'')),
    created_at desc
  )
  where archived_at is null;
