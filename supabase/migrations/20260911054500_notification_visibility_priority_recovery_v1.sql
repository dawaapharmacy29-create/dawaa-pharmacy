-- Recover important notification visibility without introducing a parallel notification path.
-- 1) Customer attention digest falls back to the active branch manager when no CS manager is active.
-- 2) Team Alpha daily queues use the canonical system producer and become high priority when work exists.

create or replace function public.notify_customers_needing_attention()
returns integer
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_count int := 0;
  v_branch record;
  v_recipient uuid;
  v_disappeared_vip int;
  v_disappeared_important int;
  v_strong_decline_vip int;
  v_strong_decline_important int;
  v_total_flagged int;
begin
  for v_branch in select unnest(array['فرع الشامي','فرع شكري']) as branch
  loop
    select
      count(*) filter (where customer_state = 'مختفي هذا الشهر' and previous_segment = 'مهم جدًا'),
      count(*) filter (where customer_state = 'مختفي هذا الشهر' and previous_segment = 'مهم'),
      count(*) filter (where customer_state = 'تراجع قوي' and previous_segment = 'مهم جدًا'),
      count(*) filter (where customer_state = 'تراجع قوي' and previous_segment = 'مهم')
    into v_disappeared_vip, v_disappeared_important, v_strong_decline_vip, v_strong_decline_important
    from public.calculate_customer_monthly_performance(
      v_branch.branch,
      (current_date - interval '13 days')::date, current_date,
      (current_date - interval '27 days')::date, (current_date - interval '14 days')::date
    );

    v_total_flagged := coalesce(v_disappeared_vip,0) + coalesce(v_disappeared_important,0)
                      + coalesce(v_strong_decline_vip,0) + coalesce(v_strong_decline_important,0);
    if v_total_flagged = 0 then continue; end if;

    select sa.staff_id::uuid into v_recipient
    from public.staff_accounts sa
    where sa.branch = v_branch.branch
      and sa.role = 'customer_service_manager'
      and sa.active = true
      and sa.can_login = true
      and sa.staff_id is not null
    limit 1;

    if v_recipient is null then
      select sa.staff_id::uuid into v_recipient
      from public.staff_accounts sa
      where sa.branch = v_branch.branch
        and sa.role = 'branch_manager'
        and sa.active = true
        and sa.can_login = true
        and sa.staff_id is not null
      order by sa.updated_at desc nulls last, sa.created_at desc nulls last
      limit 1;
    end if;

    if v_recipient is null then continue; end if;

    perform public.emit_system_notification_v2(
      p_recipient_staff_id => v_recipient::text,
      p_branch => v_branch.branch,
      p_notification_type => 'daily_customer_attention_digest',
      p_title => 'عملاء محتاجين متابعة النهاردة (' || v_branch.branch || ')',
      p_message =>
        coalesce(nullif(v_disappeared_vip,0)::text || ' عميل مهم جدًا اختفى تمامًا. ', '') ||
        coalesce(nullif(v_disappeared_important,0)::text || ' عميل مهم اختفى تمامًا. ', '') ||
        coalesce(nullif(v_strong_decline_vip,0)::text || ' عميل مهم جدًا تراجعت مشترياته بقوة (30%+). ', '') ||
        coalesce(nullif(v_strong_decline_important,0)::text || ' عميل مهم تراجعت مشترياته بقوة (30%+). ', '') ||
        'افتح متابعة العملاء لمراجعتهم قبل فقدهم.',
      p_entity_type => 'daily_customer_attention',
      p_entity_id => v_branch.branch,
      p_action_url => '/customer-service?quickFollowup=1',
      p_priority => case when coalesce(v_disappeared_vip,0) + coalesce(v_strong_decline_vip,0) > 0 then 'high' else 'normal' end,
      p_metadata => jsonb_build_object(
        'schemaVersion', 2,
        'canonicalType', 'customer_followup',
        'branch', v_branch.branch,
        'staffId', v_recipient::text,
        'disappearedVip', v_disappeared_vip,
        'disappearedImportant', v_disappeared_important,
        'strongDeclineVip', v_strong_decline_vip,
        'strongDeclineImportant', v_strong_decline_important,
        'requiresFollowup', true
      ),
      p_dedupe_key => 'daily-attention:' || v_branch.branch || ':' || to_char(current_date, 'YYYY-MM-DD'),
      p_requires_action => true,
      p_sound_enabled => true
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.notify_team_alpha_daily_queues_v1()
returns integer
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_track record;
  v_scope text;
  v_at_risk_count int;
  v_first_purchase_count int;
  v_checklist_count int;
  v_count int := 0;
  v_priority text;
begin
  for v_track in select * from public.dawaa_team_alpha_track_for_date_v1() loop
    if v_track.track = 'purchasing' then
      select count(*) into v_checklist_count
      from public.staff_daily_checklist_items
      where role = 'فريق_ألفا_مشتريات' and active = true;

      v_priority := case when v_checklist_count > 0 then 'high' else 'normal' end;

      perform public.emit_system_notification_v2(
        p_recipient_staff_id => v_track.staff_id::text,
        p_notification_type => 'daily_task_reminder',
        p_title => 'صباح الخير — مسارك النهاردة: المشتريات',
        p_message => 'عندك ' || v_checklist_count || ' مهمة في تشيك ليست المشتريات اليوم. ابدئي بمراجعة تقرير النواقص.',
        p_entity_type => 'team_alpha_track',
        p_entity_id => v_track.track,
        p_action_url => '/my-daily-checklist',
        p_priority => v_priority,
        p_metadata => jsonb_build_object(
          'schemaVersion',2,
          'canonicalType','staff_task',
          'staffId',v_track.staff_id::text,
          'teamAlpha',true,
          'taskCount',v_checklist_count,
          'requiresFollowup',v_checklist_count > 0
        ),
        p_dedupe_key => 'team-alpha-daily-reminder:' || v_track.staff_id || ':' || to_char(current_date, 'YYYY-MM-DD'),
        p_requires_action => v_checklist_count > 0,
        p_sound_enabled => v_checklist_count > 0
      );
    else
      v_scope := lower(btrim(v_track.branch));
      select count(*) into v_at_risk_count from public.get_customer_service_at_risk_daily_core(current_date, v_scope);
      select count(*) into v_first_purchase_count from public.get_customer_service_first_purchase_save_core(current_date, v_scope);
      v_priority := case when coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0 then 'high' else 'normal' end;

      perform public.emit_system_notification_v2(
        p_recipient_staff_id => v_track.staff_id::text,
        p_branch => v_track.branch,
        p_notification_type => 'daily_task_reminder',
        p_title => 'صباح الخير — مسارك النهاردة: ' || v_track.track_label,
        p_message => 'عندك ' || v_at_risk_count || ' عميل معرّض للخطر و' || v_first_purchase_count || ' عميل أول تجربة في قايمة اليوم. ابدئي بالمنتظمين المتراجعين الأول، وهتلاقيهم في تبويب "أولويات العملاء".',
        p_entity_type => 'team_alpha_track',
        p_entity_id => v_track.track,
        p_action_url => '/customer-service',
        p_priority => v_priority,
        p_metadata => jsonb_build_object(
          'schemaVersion',2,
          'canonicalType','staff_task',
          'branch',v_track.branch,
          'staffId',v_track.staff_id::text,
          'teamAlpha',true,
          'atRiskCount',v_at_risk_count,
          'firstPurchaseCount',v_first_purchase_count,
          'requiresFollowup',coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0
        ),
        p_dedupe_key => 'team-alpha-daily-reminder:' || v_track.staff_id || ':' || to_char(current_date, 'YYYY-MM-DD'),
        p_requires_action => coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0,
        p_sound_enabled => coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
