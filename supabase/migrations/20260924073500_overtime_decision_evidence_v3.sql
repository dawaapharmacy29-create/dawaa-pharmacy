-- Overtime Decision Evidence V3
-- Role-aware staffing + invoice evidence for human overtime decisions.
-- Informational only: no automatic entitlement verdict.

create or replace function public.hr_staff_role_group_v3(p_role text, p_name text default null)
returns text language plpgsql immutable set search_path to 'public','pg_catalog' as $$
declare v_role text:=lower(trim(coalesce(p_role,''))); v_name text:=lower(trim(coalesce(p_name,'')));
begin
  if v_role ~ '(توصيل|دليفري|delivery|rider|courier)' then return 'delivery'; end if;
  if v_role ~ '(مساعد|assistant)' then return 'assistant'; end if;
  if v_role ~ '(صيد|دكتور|doctor|pharmacist)' or v_name ~ '^\s*د\s*[/\\.]?\s*' then return 'doctor'; end if;
  return 'other';
end; $$;

create or replace function public.hr_branch_key_v3(p_value text)
returns text language sql immutable set search_path to 'public','pg_catalog' as $$
  select trim(regexp_replace(
    replace(replace(replace(lower(coalesce(p_value,'')),'أ','ا'),'إ','ا'),'آ','ا'),
    '^\s*فرع\s+','','i'
  ))
$$;

create or replace function public.hr_person_name_key_v3(p_value text)
returns text language sql immutable set search_path to 'public','pg_catalog' as $$
  select regexp_replace(
    regexp_replace(
      replace(replace(replace(replace(replace(lower(trim(coalesce(p_value,''))),'أ','ا'),'إ','ا'),'آ','ا'),'ى','ي'),'ة','ه'),
      '^(الدكتور|دكتوره|دكتور|dr\.?|د\s*[/\\.]?)\s*','','i'
    ),
    '\s+',' ','g'
  )
$$;

create or replace function public.overtime_decision_evidence_v3(p_overtime_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_ot public.staff_overtime_approvals%rowtype;
  v_staff public.staff%rowtype;
  v_att public.attendance_daily_summary%rowtype;
  v_role_group text;
  v_ot_start timestamptz;
  v_ot_end timestamptz;
  v_last_hour_start timestamptz;
  v_raw_extra_minutes integer;
  v_presence jsonb;
  v_sales jsonb;
  v_employee_attribution boolean;
  v_employee_attribution_method text;
  v_warnings jsonb:='[]'::jsonb;
begin
  if p_overtime_id is null then raise exception 'overtime_id_required' using errcode='22023'; end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','manage_payroll']) then
    raise exception 'not_authorized_for_overtime_evidence' using errcode='42501';
  end if;

  select * into v_ot from public.staff_overtime_approvals where id=p_overtime_id;
  if not found then raise exception 'overtime_not_found' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=v_ot.staff_id;
  if not found then raise exception 'overtime_staff_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,coalesce(v_ot.branch,v_staff.branch)) then
    raise exception 'not_authorized_for_overtime_staff' using errcode='42501';
  end if;

  if v_ot.source_resolution_id is not null then
    select * into v_att from public.attendance_daily_summary where id=v_ot.source_resolution_id;
  end if;
  if v_att.id is null then
    select * into v_att from public.attendance_daily_summary
    where staff_id=v_ot.staff_id and attendance_date=v_ot.attendance_date
    order by (status='approved') desc,coalesce(resolution_version,0) desc,updated_at desc nulls last,created_at desc
    limit 1;
  end if;

  v_role_group:=public.hr_staff_role_group_v3(v_staff.role,v_staff.name);
  v_employee_attribution:=v_role_group in ('doctor','delivery');
  v_employee_attribution_method:=case when v_role_group='doctor' then 'seller' when v_role_group='delivery' then 'delivery_staff' else 'not_applicable' end;

  if v_att.id is null or v_att.scheduled_start_at is null or v_att.scheduled_end_at is null or v_att.last_out is null then
    return jsonb_build_object(
      'evidence_available',false,'overtime_id',v_ot.id,'staff_id',v_ot.staff_id,'staff_name',v_ot.staff_name,
      'branch',v_ot.branch,'role',v_staff.role,'role_group',v_role_group,
      'reason','attendance_truth_missing_schedule_or_checkout',
      'warnings',jsonb_build_array('لا توجد Attendance Truth كاملة تحتوي بداية/نهاية الجدول والخروج الفعلي لهذا السجل.'),
      'generated_at',now()
    );
  end if;

  v_ot_start:=v_att.scheduled_end_at;
  v_ot_end:=v_att.last_out;
  if v_ot_end<=v_ot_start then
    return jsonb_build_object(
      'evidence_available',false,'overtime_id',v_ot.id,'staff_id',v_ot.staff_id,'staff_name',v_ot.staff_name,
      'branch',v_ot.branch,'role',v_staff.role,'role_group',v_role_group,
      'reason','no_actual_post_shift_presence','warnings',jsonb_build_array('الخروج الفعلي لا يتجاوز نهاية الجدول.'),
      'generated_at',now()
    );
  end if;

  v_raw_extra_minutes:=greatest(0,floor(extract(epoch from(v_ot_end-v_ot_start))/60)::int);
  v_last_hour_start:=greatest(v_att.scheduled_start_at,v_att.scheduled_end_at-interval '1 hour');

  with peers as (
    select s.id,s.name,s.role,a.first_in,a.last_out,
      floor(extract(epoch from(least(a.last_out,v_ot_end)-greatest(a.first_in,v_ot_start)))/60)::int overlap_minutes,
      (a.first_in<=v_ot_start and a.last_out>=v_ot_end) covers_full_window
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between (v_ot_start at time zone 'Africa/Cairo')::date-1 and (v_ot_end at time zone 'Africa/Cairo')::date+1
      and a.status='approved'
      and a.first_in is not null and a.last_out is not null
      and a.first_in<v_ot_end and a.last_out>v_ot_start
      and public.hr_branch_key_v3(coalesce(a.branch,s.branch))=public.hr_branch_key_v3(coalesce(v_ot.branch,v_staff.branch))
      and public.hr_staff_role_group_v3(s.role,s.name)=v_role_group
  )
  select jsonb_build_object(
    'same_role_total_present_any',(select count(*) from peers),
    'same_role_others_present_any',(select count(*) from peers where id<>v_ot.staff_id),
    'same_role_others_cover_full_window',(select count(*) from peers where id<>v_ot.staff_id and covers_full_window),
    'people',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',id,'name',name,'role',role,'is_current_employee',id=v_ot.staff_id,
        'overlap_minutes',overlap_minutes,'covers_full_window',covers_full_window,
        'first_in',first_in,'last_out',last_out
      ) order by (id=v_ot.staff_id) desc,covers_full_window desc,overlap_minutes desc,name)
      from peers
    ),'[]'::jsonb)
  ) into v_presence;

  with invoice_base as (
    select i.id,coalesce(i.close_datetime,i.analysis_datetime,i.invoice_datetime) event_at,
      coalesce(i.net_amount,i.net_total,i.discounted_amount,i.total_amount,i.amount,i.gross_amount,i.gross_total,0)::numeric invoice_amount,
      i.staff_id,i.seller_name,i.normalized_seller_name,i.staff_name invoice_staff_name,i.delivery_staff,i.invoice_type,i.save_status
    from public.sales_invoices i
    where public.hr_branch_key_v3(coalesce(i.branch,i.branch_name))=public.hr_branch_key_v3(coalesce(v_ot.branch,v_staff.branch))
      and coalesce(i.close_datetime,i.analysis_datetime,i.invoice_datetime) is not null
      and coalesce(i.close_datetime,i.analysis_datetime,i.invoice_datetime)>=v_att.scheduled_start_at
      and coalesce(i.close_datetime,i.analysis_datetime,i.invoice_datetime)<v_ot_end
      and lower(coalesce(i.invoice_type,'')) !~ '(return|refund|cancel|مرتجع|الغاء|إلغاء|ملغي)'
      and lower(coalesce(i.save_status,'')) !~ '(cancel|invalid|failed|error|ملغي|الغاء|إلغاء|فشل|خطأ)'
  ),
  marked as (
    select b.*,
      case
        when v_role_group='doctor' then (
          nullif(trim(coalesce(b.staff_id,'')),'')=v_ot.staff_id::text
          or (
            nullif(trim(coalesce(b.staff_id,'')),'') is null
            and public.hr_person_name_key_v3(coalesce(b.normalized_seller_name,b.invoice_staff_name,b.seller_name))
              =public.hr_person_name_key_v3(v_staff.name)
          )
        )
        when v_role_group='delivery' then public.hr_person_name_key_v3(b.delivery_staff)=public.hr_person_name_key_v3(v_staff.name)
        else false
      end employee_owned
    from invoice_base b
  ),
  stats as (
    select
      count(*) filter(where event_at>=v_ot_start and event_at<v_ot_end)::int branch_ot_count,
      round(coalesce(sum(invoice_amount) filter(where event_at>=v_ot_start and event_at<v_ot_end),0),2) branch_ot_value,
      count(*) filter(where employee_owned and event_at>=v_att.scheduled_start_at and event_at<v_att.scheduled_end_at)::int employee_shift_count,
      round(coalesce(sum(invoice_amount) filter(where employee_owned and event_at>=v_att.scheduled_start_at and event_at<v_att.scheduled_end_at),0),2) employee_shift_value,
      count(*) filter(where employee_owned and event_at>=v_last_hour_start and event_at<v_att.scheduled_end_at)::int employee_last_hour_count,
      round(coalesce(sum(invoice_amount) filter(where employee_owned and event_at>=v_last_hour_start and event_at<v_att.scheduled_end_at),0),2) employee_last_hour_value,
      count(*) filter(where employee_owned and event_at>=v_ot_start and event_at<v_ot_end)::int employee_ot_count,
      round(coalesce(sum(invoice_amount) filter(where employee_owned and event_at>=v_ot_start and event_at<v_ot_end),0),2) employee_ot_value
    from marked
  )
  select jsonb_build_object(
    'timestamp_source','close_datetime → analysis_datetime → invoice_datetime',
    'employee_attribution_available',v_employee_attribution,
    'employee_attribution_method',v_employee_attribution_method,
    'branch_overtime',jsonb_build_object('start_at',v_ot_start,'end_at',v_ot_end,'invoice_count',branch_ot_count,'invoice_value',branch_ot_value),
    'employee_shift',jsonb_build_object('start_at',v_att.scheduled_start_at,'end_at',v_att.scheduled_end_at,
      'invoice_count',case when v_employee_attribution then employee_shift_count else null end,
      'invoice_value',case when v_employee_attribution then employee_shift_value else null end),
    'employee_last_hour',jsonb_build_object('start_at',v_last_hour_start,'end_at',v_att.scheduled_end_at,
      'invoice_count',case when v_employee_attribution then employee_last_hour_count else null end,
      'invoice_value',case when v_employee_attribution then employee_last_hour_value else null end),
    'employee_overtime',jsonb_build_object('start_at',v_ot_start,'end_at',v_ot_end,
      'invoice_count',case when v_employee_attribution then employee_ot_count else null end,
      'invoice_value',case when v_employee_attribution then employee_ot_value else null end)
  ) into v_sales from stats;

  if not v_employee_attribution then
    v_warnings:=v_warnings||jsonb_build_array('لا يوجد ربط مبيعات فردي موثوق لهذا النوع الوظيفي؛ يتم عرض مبيعات الفرع والتغطية البشرية فقط.');
  end if;
  if v_role_group='delivery' then
    v_warnings:=v_warnings||jsonb_build_array('مبيعات الدليفري تُنسب من حقل delivery_staff عندما يكون الاسم مربوطًا بوضوح على الفاتورة.');
  end if;

  return jsonb_build_object(
    'evidence_available',true,'overtime_id',v_ot.id,'staff_id',v_ot.staff_id,'staff_name',v_ot.staff_name,
    'branch',coalesce(v_ot.branch,v_staff.branch),'role',v_staff.role,'role_group',v_role_group,
    'attendance_truth',jsonb_build_object(
      'resolution_id',v_att.id,'resolution_status',v_att.resolution_status,'status',v_att.status,
      'scheduled_start_at',v_att.scheduled_start_at,'scheduled_end_at',v_att.scheduled_end_at,
      'first_in',v_att.first_in,'last_out',v_att.last_out,'raw_post_shift_minutes',v_raw_extra_minutes,
      'overtime_candidate_hours',v_ot.overtime_hours,'late_minutes',coalesce(v_att.late_minutes,0)
    ),
    'staffing',v_presence,'sales',v_sales,'warnings',v_warnings,
    'decision_note','هذه بيانات مساعدة للقرار البشري وليست حكمًا آليًا على استحقاق الأوفر تايم.',
    'generated_at',now()
  );
end; $$;

alter table public.staff_overtime_approvals
  add column if not exists decision_evidence_snapshot jsonb,
  add column if not exists decision_evidence_version text;

create or replace function public.decide_overtime_approval_v3(p_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_ot public.staff_overtime_approvals%rowtype;
  v_resolution public.attendance_daily_summary%rowtype;
  v_fingerprint text;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
  v_evidence jsonb;
begin
  if v_decision not in ('approved','rejected') then raise exception 'invalid_overtime_decision' using errcode='22023'; end if;

  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_overtime_decision' using errcode='42501';
  end if;

  select * into v_ot from public.staff_overtime_approvals where id=p_id for update;
  if not found or v_ot.status<>'pending' then raise exception 'overtime_not_found_or_already_decided' using errcode='22023'; end if;

  select * into v_resolution from public.attendance_daily_summary a
  where a.staff_id=v_ot.staff_id and a.attendance_date=v_ot.attendance_date
  order by (a.status='approved') desc,coalesce(a.resolution_version,0) desc,a.updated_at desc nulls last,a.created_at desc
  limit 1;

  if v_decision='approved' then
    if not found or v_resolution.status<>'approved' or coalesce(v_resolution.resolution_version,0)<2
       or coalesce(v_resolution.resolution_status,'') not in ('on_time','late','very_late','on_time_with_permission','worked_on_off') then
      raise exception 'overtime_requires_approved_attendance_truth' using errcode='55000';
    end if;

    v_fingerprint:=public.attendance_resolution_fingerprint_v2(v_resolution.id);
    if v_ot.source_resolution_id is not null and v_ot.source_resolution_id<>v_resolution.id then
      raise exception 'overtime_source_resolution_changed' using errcode='55000';
    end if;
    if v_ot.source_resolution_fingerprint is not null and v_ot.source_resolution_fingerprint<>v_fingerprint then
      raise exception 'overtime_source_resolution_drifted' using errcode='55000';
    end if;
  end if;

  begin
    v_evidence:=public.overtime_decision_evidence_v3(p_id);
  exception when others then
    v_evidence:=jsonb_build_object('evidence_available',false,'reason','evidence_snapshot_failed','error',sqlerrm,'generated_at',now());
  end;

  if v_decision='approved' then
    update public.staff_overtime_approvals
    set source_resolution_id=v_resolution.id,source_resolution_fingerprint=v_fingerprint,
        source_resolution_linked_at=coalesce(source_resolution_linked_at,now()),status='approved',
        decided_at=now(),decided_by=v_actor.id::text,decided_by_name=coalesce(v_actor.name,v_actor.username),
        decision_note=nullif(trim(coalesce(p_note,'')),''),
        decision_evidence_snapshot=v_evidence,decision_evidence_version='overtime_evidence_v3',updated_at=now()
    where id=p_id;
  else
    update public.staff_overtime_approvals
    set status='rejected',decided_at=now(),decided_by=v_actor.id::text,decided_by_name=coalesce(v_actor.name,v_actor.username),
        decision_note=nullif(trim(coalesce(p_note,'')),''),
        decision_evidence_snapshot=v_evidence,decision_evidence_version='overtime_evidence_v3',updated_at=now()
    where id=p_id;
  end if;

  return jsonb_build_object(
    'success',true,'id',p_id,'status',v_decision,
    'attendance_resolution_id',case when v_decision='approved' then v_resolution.id else v_ot.source_resolution_id end,
    'truth_validated',v_decision='approved','evidence_version','overtime_evidence_v3',
    'evidence_available',coalesce((v_evidence->>'evidence_available')::boolean,false)
  );
end; $$;

revoke execute on function public.hr_staff_role_group_v3(text,text) from public;
revoke execute on function public.hr_branch_key_v3(text) from public;
revoke execute on function public.hr_person_name_key_v3(text) from public;
revoke execute on function public.overtime_decision_evidence_v3(uuid) from public;
revoke execute on function public.decide_overtime_approval_v3(uuid,text,text) from public,anon;

grant execute on function public.hr_staff_role_group_v3(text,text) to anon,authenticated,service_role;
grant execute on function public.hr_branch_key_v3(text) to anon,authenticated,service_role;
grant execute on function public.hr_person_name_key_v3(text) to anon,authenticated,service_role;
grant execute on function public.overtime_decision_evidence_v3(uuid) to authenticated,service_role;
grant execute on function public.decide_overtime_approval_v3(uuid,text,text) to authenticated,service_role;
