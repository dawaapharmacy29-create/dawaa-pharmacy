-- Attendance biometric hardening v2
-- Goal: safer semantic punches, truthful per-branch sync health, and evidence-only overtime decisions.
-- This migration is intentionally backward-compatible with existing RPC names used by the attendance rebuild UI.

create or replace function public.attendance_sync_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_now timestamptz:=now();
  v_payload jsonb;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to view biometric sync health' using errcode='42501';
  end if;

  with log_stats as (
    select count(*) raw_events,
      count(*) filter(where staff_id is not null) mapped_events,
      count(*) filter(where staff_id is null) unmapped_events,
      count(*) filter(where ingested_at>=v_now-interval '24 hours') events_24h,
      count(*) filter(where staff_id is null and ingested_at>=v_now-interval '24 hours') unmapped_24h,
      max(ingested_at) last_ingested_at,
      max(public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)) last_punch_time
    from public.biometric_attendance_logs
  ), client_stats as (
    select max(last_seen_at) client_last_seen_at,
      max(last_request_at) endpoint_last_request_at,
      max(last_success_at) endpoint_last_success_at,
      sum(total_requests) total_requests,
      sum(total_received) total_received,
      sum(total_accepted) total_accepted,
      sum(total_duplicates) total_duplicates,
      sum(total_rejected) total_rejected,
      count(*) filter(where active) active_clients
    from public.biometric_api_clients
  ), latest_error as (
    select name client_name,last_error_at,last_error_code,last_error_message,last_http_status
    from public.biometric_api_clients
    where last_error_at is not null
    order by last_error_at desc limit 1
  ), watermark as (
    select max(complete_through) complete_through,max(reported_at) reported_at
    from public.biometric_sync_watermarks
  ), branch_watermarks as (
    select 'فرع الشامي'::text branch,
      max(complete_through) complete_through,
      max(reported_at) reported_at
    from public.biometric_sync_watermarks
    where provider='zk_shami_direct_bridge'
    union all
    select 'فرع شكري'::text branch,
      max(complete_through) complete_through,
      max(reported_at) reported_at
    from public.biometric_sync_watermarks
    where provider='zk_shokry_direct_bridge'
  ), branch_logs as (
    select coalesce(nullif(trim(branch),''),'غير محدد') branch,
      count(*) events,
      count(*) filter(where staff_id is not null) mapped,
      count(*) filter(where staff_id is null) unmapped,
      count(*) filter(where ingested_at>=v_now-interval '24 hours') events_24h,
      max(ingested_at) last_event_at
    from public.biometric_attendance_logs
    group by 1
  ), branch_scope as (
    select branch from branch_watermarks
    union
    select branch from branch_logs
  ), branch_data as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'branch',bs.branch,
      'events',coalesce(bl.events,0),
      'mapped',coalesce(bl.mapped,0),
      'unmapped',coalesce(bl.unmapped,0),
      'events_last_24h',coalesce(bl.events_24h,0),
      'last_event_at',bl.last_event_at,
      'watermark_complete_through',bw.complete_through,
      'watermark_reported_at',bw.reported_at,
      'branch_activity_at',greatest(bl.last_event_at,bw.reported_at),
      'branch_lag_minutes',case
        when greatest(bl.last_event_at,bw.reported_at) is null then null
        else round(extract(epoch from (v_now-greatest(bl.last_event_at,bw.reported_at)))/60,1)
      end,
      'branch_sync_status',case
        when bw.reported_at is null and bl.last_event_at is null then 'offline'
        when greatest(bl.last_event_at,bw.reported_at)>=v_now-interval '15 minutes' then 'healthy'
        when greatest(bl.last_event_at,bw.reported_at)>=v_now-interval '2 hours' then 'delayed'
        when greatest(bl.last_event_at,bw.reported_at)>=v_now-interval '24 hours' then 'stale'
        else 'offline'
      end
    ) order by bs.branch),'[]'::jsonb) value
    from branch_scope bs
    left join branch_logs bl on bl.branch=bs.branch
    left join branch_watermarks bw on bw.branch=bs.branch
  ), device_data as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'provider',provider,'device_id',device_id,'branch',branch,'events',events,
      'mapped',mapped,'unmapped',unmapped,'last_event_at',last_event_at,
      'status',case when last_event_at is null then 'never_seen'
                    when last_event_at>=v_now-interval '15 minutes' then 'healthy'
                    when last_event_at>=v_now-interval '2 hours' then 'delayed'
                    when last_event_at>=v_now-interval '24 hours' then 'stale'
                    else 'offline' end
    ) order by provider,device_id),'[]'::jsonb) value
    from (
      select provider,
        coalesce(nullif(device_id,''),nullif(raw_payload->>'external_device_id',''),
          nullif(raw_payload->>'device_id',''),nullif(raw_payload->>'terminal_id',''),
          nullif(raw_payload->>'machine_id',''),'غير محدد') device_id,
        coalesce(nullif(trim(branch),''),'غير محدد') branch,count(*) events,
        count(*) filter(where staff_id is not null) mapped,
        count(*) filter(where staff_id is null) unmapped,max(ingested_at) last_event_at
      from public.biometric_attendance_logs
      group by 1,2,3
    ) x
  )
  select jsonb_build_object(
    'sync_status',case
      when coalesce(cs.endpoint_last_success_at,cs.client_last_seen_at,ls.last_ingested_at) is null then 'never_connected'
      when coalesce(cs.endpoint_last_success_at,cs.client_last_seen_at,ls.last_ingested_at)>=v_now-interval '5 minutes' then 'healthy'
      when coalesce(cs.endpoint_last_success_at,cs.client_last_seen_at,ls.last_ingested_at)>=v_now-interval '30 minutes' then 'delayed'
      when coalesce(cs.endpoint_last_success_at,cs.client_last_seen_at,ls.last_ingested_at)>=v_now-interval '3 hours' then 'stale'
      else 'offline' end,
    'checked_at',v_now,
    'last_ingested_at',ls.last_ingested_at,
    'last_punch_time',ls.last_punch_time,
    'client_last_seen_at',cs.client_last_seen_at,
    'endpoint_last_request_at',cs.endpoint_last_request_at,
    'endpoint_last_success_at',cs.endpoint_last_success_at,
    'watermark_complete_through',w.complete_through,
    'watermark_reported_at',w.reported_at,
    'raw_events',coalesce(ls.raw_events,0),
    'mapped_events',coalesce(ls.mapped_events,0),
    'unmapped_events',coalesce(ls.unmapped_events,0),
    'mapped_ratio',case when coalesce(ls.raw_events,0)=0 then 0 else round(ls.mapped_events::numeric*100/ls.raw_events,1) end,
    'events_last_24h',coalesce(ls.events_24h,0),
    'unmapped_last_24h',coalesce(ls.unmapped_24h,0),
    'active_clients',coalesce(cs.active_clients,0),
    'total_requests',coalesce(cs.total_requests,0),
    'total_received',coalesce(cs.total_received,0),
    'total_accepted',coalesce(cs.total_accepted,0),
    'total_duplicates',coalesce(cs.total_duplicates,0),
    'total_rejected',coalesce(cs.total_rejected,0),
    'last_error',case when le.last_error_at is null then null else jsonb_build_object(
      'client',le.client_name,'at',le.last_error_at,'code',le.last_error_code,
      'message',le.last_error_message,'http_status',le.last_http_status) end,
    'branch_breakdown',bd.value,
    'device_breakdown',dd.value
  ) into v_payload
  from log_stats ls cross join client_stats cs cross join watermark w
  cross join branch_data bd cross join device_data dd
  left join latest_error le on true;

  return v_payload;
end;
$function$;

revoke execute on function public.attendance_sync_health_v2() from public,anon;
grant execute on function public.attendance_sync_health_v2() to authenticated,service_role;


create or replace function public.dawaa_biometric_semantic_decision_v1(
  p_staff_id uuid,
  p_event_time timestamptz,
  p_raw_type text,
  p_biometric_log_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_event_local timestamp;
  v_event_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_sched_date date;
  v_raw text:=case lower(trim(coalesce(p_raw_type,'')))
    when 'check_in' then 'check_in'
    when 'in' then 'check_in'
    when 'check_out' then 'check_out'
    when 'out' then 'check_out'
    else null end;
  v_type text;
  v_reason text;
  v_conf numeric:=0.50;
  v_dup uuid;
  v_duration interval;
  v_entry_cutoff timestamptz;
  v_exit_cutoff timestamptz;
begin
  if p_staff_id is null or p_event_time is null then
    return jsonb_build_object('decision','review','semantic_type',v_raw,'confidence',0.20,'reason','missing_staff_or_time');
  end if;

  -- A rapid repeated press is a confirmation, never a check-out.
  select l.biometric_source_log_id into v_dup
  from public.staff_attendance_logs l
  where l.staff_id=p_staff_id
    and l.biometric_method='fingerprint_terminal'
    and l.status='accepted'
    and l.biometric_source_log_id is not null
    and (l.recorded_at < p_event_time or (
      l.recorded_at=p_event_time
      and p_biometric_log_id is not null
      and l.biometric_source_log_id::text < p_biometric_log_id::text
    ))
    and p_event_time-l.recorded_at between interval '0 seconds' and interval '180 seconds'
  order by l.recorded_at desc,l.id desc
  limit 1;

  if v_dup is not null then
    return jsonb_build_object(
      'decision','duplicate',
      'semantic_type',null,
      'confidence',0.99,
      'reason','same_employee_within_180_seconds',
      'duplicate_of_log_id',v_dup
    );
  end if;

  v_event_local:=p_event_time at time zone 'Africa/Cairo';
  v_event_date:=v_event_local::date;

  -- Include previous and next schedule dates so overnight shifts remain attached to their real shift day.
  with candidate_dates as (
    select v_event_date d
    union all select v_event_date-1
    union all select v_event_date+1
  ), schedules as (
    select d.d schedule_date, ss.*,
      case when trim(coalesce(ss.shift_start,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
        then trim(ss.shift_start)::time else ss.start_time end st,
      case when trim(coalesce(ss.shift_end,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
        then trim(ss.shift_end)::time else ss.end_time end et
    from candidate_dates d
    join lateral (
      select x.* from public.shift_schedules x
      where x.staff_id=p_staff_id
        and (
          coalesce(x.shift_date,x.date)=d.d
          or (
            x.shift_date is null and x.date is null
            and trim(coalesce(x.day_name,''))=case extract(dow from d.d)::int
              when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
              when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end
          )
        )
      order by (coalesce(x.shift_date,x.date)=d.d) desc,
        coalesce(x.updated_at,x.created_at) desc nulls last,x.id desc
      limit 1
    ) ss on true
  ), windows as (
    select schedule_date,
      (schedule_date::timestamp+st) at time zone 'Africa/Cairo' s_at,
      (((schedule_date + case when et<=st then 1 else 0 end)::timestamp+et) at time zone 'Africa/Cairo') e_at
    from schedules
    where st is not null and et is not null
      and not coalesce(is_off,false)
      and not coalesce(is_day_off,false)
  )
  select schedule_date,s_at,e_at
    into v_sched_date,v_start,v_end
  from windows
  where p_event_time between s_at-interval '4 hours' and e_at+interval '6 hours'
  order by least(
    abs(extract(epoch from (p_event_time-s_at))),
    abs(extract(epoch from (p_event_time-e_at)))
  )
  limit 1;

  -- Without a matching schedule, preserve the raw event as evidence but do not promote it to final attendance.
  if v_start is null or v_end is null then
    return jsonb_build_object(
      'decision','review',
      'semantic_type',v_raw,
      'confidence',case when v_raw is null then 0.20 else 0.45 end,
      'reason','no_matching_schedule_review',
      'raw_type',v_raw
    );
  end if;

  v_duration:=v_end-v_start;
  if v_duration<=interval '0 minutes' or v_duration>interval '18 hours' then
    return jsonb_build_object(
      'decision','review',
      'semantic_type',v_raw,
      'confidence',0.20,
      'reason','invalid_schedule_duration',
      'schedule_date',v_sched_date,
      'scheduled_start_at',v_start,
      'scheduled_end_at',v_end,
      'raw_type',v_raw
    );
  end if;

  -- Strong zones deliberately leave a middle review band instead of guessing.
  v_entry_cutoff:=least(v_start+interval '3 hours',v_start+(v_duration*0.40));
  v_exit_cutoff:=greatest(v_end-interval '3 hours',v_start+(v_duration*0.60));

  if p_event_time<=v_entry_cutoff then
    v_type:='check_in';
    v_reason:='strong_schedule_start_zone';
    v_conf:=0.97;
  elsif p_event_time>=v_exit_cutoff then
    v_type:='check_out';
    v_reason:='strong_schedule_end_zone';
    v_conf:=0.97;
  else
    v_type:=case
      when abs(extract(epoch from (p_event_time-v_start)))<=abs(extract(epoch from (v_end-p_event_time)))
        then 'check_in'
      else 'check_out'
    end;
    return jsonb_build_object(
      'decision','review',
      'semantic_type',v_type,
      'confidence',0.60,
      'reason','ambiguous_middle_of_shift',
      'schedule_date',v_sched_date,
      'scheduled_start_at',v_start,
      'scheduled_end_at',v_end,
      'raw_type',v_raw
    );
  end if;

  return jsonb_build_object(
    'decision','accepted',
    'semantic_type',v_type,
    'confidence',v_conf,
    'reason',v_reason,
    'schedule_date',v_sched_date,
    'scheduled_start_at',v_start,
    'scheduled_end_at',v_end,
    'raw_type',v_raw
  );
end;
$function$;

revoke execute on function public.dawaa_biometric_semantic_decision_v1(uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.dawaa_biometric_semantic_decision_v1(uuid,timestamptz,text,uuid) to authenticated,service_role;


create or replace function public.attendance_overtime_context_v1(
  p_staff_id uuid,
  p_attendance_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_staff record;
  v_r jsonb;
  v_summary public.attendance_daily_summary%rowtype;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_colleagues jsonb;
  v_invoice_count int;
  v_invoice_total numeric;
  v_minutes int;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception using errcode='22023', message='الموظف غير موجود'; end if;

  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة';
  end if;

  select * into v_summary
  from public.attendance_daily_summary
  where staff_id=p_staff_id
    and attendance_date=p_attendance_date
    and status='approved'
    and coalesce(resolution_version,0)>=2
  limit 1;

  if v_summary.id is null then
    return jsonb_build_object(
      'ready',false,
      'reason','اليوم لم يتم تسويته واعتماده بعد'
    );
  end if;

  if coalesce(v_summary.review_required,false) then
    return jsonb_build_object(
      'ready',false,
      'reason','اليوم ما زال يحتاج مراجعة قبل الأوفرتايم'
    );
  end if;

  v_r:=coalesce(v_summary.resolution_snapshot,public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date));
  v_window_start:=coalesce(v_summary.scheduled_end_at,nullif(v_r->>'scheduled_end_at','')::timestamptz);
  v_window_end:=coalesce(v_summary.last_out,nullif(v_r->>'last_out','')::timestamptz);

  if v_window_start is null or v_window_end is null or v_window_end<=v_window_start then
    return jsonb_build_object(
      'ready',false,
      'reason','لا توجد فترة أوفرتايم مثبتة بعد نهاية الشيفت'
    );
  end if;

  v_minutes:=greatest(0,floor(extract(epoch from (v_window_end-v_window_start))/60)::int);

  -- Count only colleagues whose resolved attendance interval actually overlaps the overtime interval.
  with colleague_sessions as (
    select s2.id,s2.name staff_name,s2.role,
      min(sal.recorded_at) filter(where sal.attendance_type='check_in') first_in,
      max(sal.recorded_at) filter(where sal.attendance_type='check_out') last_out
    from public.staff s2
    join public.staff_attendance_logs sal on sal.staff_id=s2.id
    where s2.branch=v_staff.branch
      and s2.id<>p_staff_id
      and sal.status='accepted'
      and sal.shift_date=p_attendance_date
    group by s2.id,s2.name,s2.role
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_name',c.staff_name,
    'role',c.role,
    'first_in',c.first_in,
    'last_out',c.last_out
  ) order by c.staff_name),'[]'::jsonb)
  into v_colleagues
  from colleague_sessions c
  where c.first_in is not null
    and c.first_in<=v_window_end
    and coalesce(c.last_out,v_window_end)>=v_window_start;

  select count(*),
    coalesce(sum(coalesce(si.net_amount,si.net_total,si.amount,si.total_amount,0)),0)
  into v_invoice_count,v_invoice_total
  from public.sales_invoices si
  where si.branch=v_staff.branch
    and si.invoice_date>=v_window_start
    and si.invoice_date<=v_window_end;

  return jsonb_build_object(
    'ready',true,
    'staff_first_in',v_r->'first_in',
    'staff_last_out',v_r->'last_out',
    'scheduled_start_at',v_r->'scheduled_start_at',
    'scheduled_end_at',v_r->'scheduled_end_at',
    'window_start',v_window_start,
    'window_end',v_window_end,
    'overtime_minutes',v_minutes,
    'colleagues_working',v_colleagues,
    'colleagues_count',jsonb_array_length(v_colleagues),
    'invoices_count',v_invoice_count,
    'invoices_total_amount',v_invoice_total,
    'evidence_flags',jsonb_build_object(
      'sales_activity_present',v_invoice_count>0,
      'colleague_overlap_present',jsonb_array_length(v_colleagues)>0
    )
  );
end;
$function$;

revoke execute on function public.attendance_overtime_context_v1(uuid,date) from public,anon;
grant execute on function public.attendance_overtime_context_v1(uuid,date) to authenticated,service_role;


create or replace function public.attendance_unified_approval_decide_v1(
  p_item_type text,
  p_item_id uuid,
  p_decision text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_ot public.staff_overtime_approvals%rowtype;
  v_ctx jsonb;
begin
  if p_item_type in ('deduction','overtime')
     and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception using errcode='22023', message='سبب القرار إجباري للخصم والأوفرتايم';
  end if;

  if p_item_type='deduction' then
    return public.attendance_deduction_review_decide_v1(p_item_id,p_decision,p_note);
  elsif p_item_type='overtime' then
    if p_decision='approve' then
      select * into v_ot from public.staff_overtime_approvals where id=p_item_id limit 1;
      if v_ot.id is null then
        raise exception using errcode='22023', message='حالة الأوفرتايم غير موجودة';
      end if;
      v_ctx:=public.attendance_overtime_context_v1(v_ot.staff_id,v_ot.attendance_date);
      if not coalesce((v_ctx->>'ready')::boolean,false) then
        raise exception using errcode='22023', message=coalesce(v_ctx->>'reason','اليوم غير جاهز لاعتماد الأوفرتايم');
      end if;
    end if;

    perform public.decide_overtime_approval_v1(
      p_item_id,
      case when p_decision='approve' then 'approved' else 'rejected' end,
      p_note
    );
    return jsonb_build_object('id',p_item_id,'ok',true);
  elsif p_item_type='timeoff_branch' then
    return public.attendance_branch_review_time_off_v1(p_item_id,p_decision,p_note);
  elsif p_item_type='timeoff_gm' then
    return public.attendance_gm_review_time_off_v1(p_item_id,p_decision,p_note);
  else
    raise exception using errcode='22023', message='نوع عنصر غير معروف';
  end if;
end;
$function$;

revoke execute on function public.attendance_unified_approval_decide_v1(text,uuid,text,text) from public,anon;
grant execute on function public.attendance_unified_approval_decide_v1(text,uuid,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
