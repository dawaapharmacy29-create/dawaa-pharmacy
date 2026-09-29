create or replace function public.notify_team_alpha_daily_queues_v1()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_track record;
  v_manager record;
  v_scope text;
  v_at_risk_count int;
  v_first_purchase_count int;
  v_checklist_count int;
  v_count int := 0;
  v_priority text;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_team_summary text;
  v_team_total int := 0;
  v_team_completed int := 0;
begin
  for v_track in select * from public.dawaa_team_alpha_track_for_date_v1(v_today) loop
    if v_track.track = 'purchasing' then
      select count(*) into v_checklist_count
      from public.staff_daily_checklist_items
      where role = 'فريق_ألفا_مشتريات' and active = true;

      v_priority := case when v_checklist_count > 0 then 'high' else 'normal' end;

      perform public.emit_system_notification_v2(
        p_recipient_staff_id => v_track.staff_id::text,
        p_notification_type => 'staff_task',
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
        p_dedupe_key => 'team-alpha-daily-reminder:' || v_track.staff_id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        p_requires_action => v_checklist_count > 0,
        p_sound_enabled => v_checklist_count > 0
      );
    else
      v_scope := lower(btrim(v_track.branch));
      select count(*) into v_at_risk_count from public.get_customer_service_at_risk_daily_core(v_today, v_scope);
      select count(*) into v_first_purchase_count from public.get_customer_service_first_purchase_save_core(v_today, v_scope);
      v_priority := case when coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0 then 'high' else 'normal' end;

      perform public.emit_system_notification_v2(
        p_recipient_staff_id => v_track.staff_id::text,
        p_branch => v_track.branch,
        p_notification_type => 'staff_task',
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
        p_dedupe_key => 'team-alpha-daily-reminder:' || v_track.staff_id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        p_requires_action => coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0,
        p_sound_enabled => coalesce(v_at_risk_count,0) + coalesce(v_first_purchase_count,0) > 0
      );
    end if;
    v_count := v_count + 1;
  end loop;

  select
    string_agg(
      format('%s: %s — %s/%s مهمة', staff_name, track_label, checklist_completed, checklist_total),
      ' | ' order by staff_name
    ),
    coalesce(sum(checklist_total),0)::int,
    coalesce(sum(checklist_completed),0)::int
  into v_team_summary, v_team_total, v_team_completed
  from public.dawaa_team_alpha_scoreboard_v1(v_today);

  if nullif(trim(coalesce(v_team_summary,'')), '') is not null then
    for v_manager in
      select sa.staff_id::text as staff_id
      from public.staff_accounts sa
      where sa.active = true
        and sa.can_login = true
        and sa.staff_id is not null
        and sa.role in ('general_manager','branches_manager')
    loop
      perform public.emit_system_notification_v2(
        p_recipient_staff_id => v_manager.staff_id,
        p_branch => 'كل الفروع',
        p_notification_type => 'manager_alert',
        p_title => 'فريق دواء ألفا — خطة وموقف اليوم',
        p_message => v_team_summary || format(' | إجمالي التنفيذ الحالي: %s/%s مهمة.', v_team_completed, v_team_total),
        p_entity_type => 'team_alpha_daily_management',
        p_entity_id => to_char(v_today, 'YYYY-MM-DD'),
        p_action_url => '/daily-command',
        p_priority => case when v_team_total > v_team_completed then 'high' else 'normal' end,
        p_metadata => jsonb_build_object(
          'schemaVersion',2,
          'canonicalType','manager_alert',
          'teamAlpha',true,
          'reportDate',v_today,
          'totalTasks',v_team_total,
          'completedTasks',v_team_completed,
          'requiresFollowup',v_team_total > v_team_completed
        ),
        p_dedupe_key => 'team-alpha-management-digest:' || v_manager.staff_id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        p_requires_action => v_team_total > v_team_completed,
        p_sound_enabled => false
      );
      v_count := v_count + 1;
    end loop;
  end if;

  return v_count;
end;
$function$;