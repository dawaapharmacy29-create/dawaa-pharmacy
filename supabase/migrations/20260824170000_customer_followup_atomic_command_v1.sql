begin;

create or replace function public.dawaa_execute_customer_followup_command_v1(
  p_followup_id text,
  p_command text,
  p_note text default null,
  p_next_followup_date timestamptz default null,
  p_contact_channel text default null,
  p_outcome text default null,
  p_purchase_value numeric default null
)
returns public.daily_followups
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor public.staff_accounts;
  v_before public.daily_followups%rowtype;
  v_after public.daily_followups%rowtype;
  v_command text := lower(trim(coalesce(p_command, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_role text;
  v_is_senior boolean;
  v_now timestamptz := now();
  v_next timestamptz;
begin
  v_actor := public.dawaa_require_customer_service_actor_v1(false);
  v_role := lower(trim(coalesce(v_actor.role, v_actor.staff_role, '')));
  v_is_senior := v_role in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager');

  select * into v_before from public.daily_followups where id::text = p_followup_id for update;
  if not found then raise exception 'المتابعة غير موجودة'; end if;

  if not v_is_senior
     and nullif(trim(coalesce(v_actor.branch, '')), '') is distinct from nullif(trim(coalesce(v_before.branch, '')), '') then
    raise exception 'هذه المتابعة خارج نطاق فرع الحساب';
  end if;
  if v_command not in ('message_sent','no_answer','replied','schedule','submit_review','approve','return_for_completion','escalate','assign_self') then
    raise exception 'أمر المتابعة غير مدعوم';
  end if;
  if v_command in ('approve','return_for_completion') and not v_is_senior then
    raise exception 'قرار المراجعة متاح للمدير المخول فقط';
  end if;
  if v_command in ('replied','submit_review','return_for_completion') and length(coalesce(v_note, '')) < 3 then
    raise exception 'اكتب نتيجة واضحة قبل الحفظ';
  end if;
  if p_purchase_value is not null and p_purchase_value < 0 then raise exception 'قيمة الشراء غير صحيحة'; end if;

  v_next := coalesce(p_next_followup_date, date_trunc('day', v_now at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '1 day');

  update public.daily_followups f set
    updated_at = v_now,
    updated_by = v_actor.id::text,
    last_attempt_at = case when v_command in ('message_sent','no_answer','replied') then v_now else f.last_attempt_at end,
    attempt_count = coalesce(f.attempt_count, 0) + case when v_command in ('message_sent','no_answer','replied') then 1 else 0 end,
    contacted_at = case when v_command in ('message_sent','no_answer') then coalesce(f.contacted_at, v_now) else f.contacted_at end,
    first_attempt_at = case when v_command in ('message_sent','no_answer') then coalesce(f.first_attempt_at, v_now) else f.first_attempt_at end,
    contact_status = case v_command when 'message_sent' then 'في انتظار الرد' when 'no_answer' then 'لم يرد' when 'replied' then 'تم الرد' when 'submit_review' then 'في انتظار المراجعة' when 'approve' then 'تم الاعتماد' when 'return_for_completion' then 'أُعيدت للاستكمال' else f.contact_status end,
    followup_status = case v_command when 'message_sent' then 'في انتظار الرد' when 'no_answer' then 'لم يرد' when 'replied' then 'جارٍ التواصل' when 'schedule' then 'scheduled' when 'submit_review' then 'pending_review' when 'approve' then 'completed' when 'return_for_completion' then 'returned_for_completion' when 'escalate' then coalesce(f.followup_status,'pending_review') else f.followup_status end,
    response_status = case v_command when 'message_sent' then 'waiting_reply' when 'no_answer' then 'no_answer' when 'replied' then 'replied' else f.response_status end,
    status = case v_command when 'message_sent' then 'في انتظار الرد' when 'no_answer' then 'لم يرد' when 'replied' then 'جارٍ التواصل' when 'schedule' then 'open' when 'submit_review' then 'pending_review' when 'approve' then 'completed' when 'return_for_completion' then 'open' else f.status end,
    next_followup_date = case when v_command in ('message_sent','no_answer','replied','schedule') then v_next when v_command='return_for_completion' then v_now else f.next_followup_date end,
    needs_next_followup = case when v_command in ('message_sent','no_answer','replied','schedule','return_for_completion') then true when v_command in ('submit_review','approve') then false else f.needs_next_followup end,
    followup_summary = case when v_command in ('replied','submit_review','return_for_completion','escalate') then coalesce(v_note,f.followup_summary) when v_note is not null then v_note else f.followup_summary end,
    followup_result = case when v_command in ('replied','submit_review') then v_note else f.followup_result end,
    needs_manager = case when v_command='escalate' or (v_command='submit_review' and p_outcome='issue') then true else f.needs_manager end,
    responsible_name = case when v_command='assign_self' then coalesce(v_actor.name,v_actor.username) else f.responsible_name end,
    assigned_to = case when v_command='assign_self' then coalesce(v_actor.name,v_actor.username) else f.assigned_to end,
    assigned_to_staff_id = case when v_command='assign_self' then v_actor.id::text else f.assigned_to_staff_id end,
    completed_at = case when v_command='approve' then v_now when v_command='return_for_completion' then null else f.completed_at end,
    completed_by = case when v_command='approve' then v_actor.id::text else f.completed_by end,
    is_hidden = case when v_command='approve' then true when v_command in ('submit_review','return_for_completion','escalate') then false else f.is_hidden end,
    hidden_at = case when v_command='approve' then v_now when v_command='return_for_completion' then null else f.hidden_at end,
    hidden_by = case when v_command='approve' then coalesce(v_actor.name,v_actor.username) when v_command='return_for_completion' then null else f.hidden_by end,
    hidden_reason = case when v_command='approve' then 'تم اعتماد المتابعة بعد المراجعة' when v_command='return_for_completion' then null else f.hidden_reason end
  where f.id::text = p_followup_id
  returning * into v_after;

  insert into public.customer_followup_audit_log(followup_id, customer_id, action, actor_staff_id, actor_name, branch, metadata)
  values(v_after.id::text, v_after.customer_id::text, v_command, v_actor.id::text, coalesce(v_actor.name,v_actor.username), v_after.branch,
    jsonb_strip_nulls(jsonb_build_object('note',v_note,'next_followup_date',v_after.next_followup_date,'contact_channel',nullif(trim(coalesce(p_contact_channel,'')),''),'outcome',nullif(trim(coalesce(p_outcome,'')),''),'purchase_value',p_purchase_value)));
  return v_after;
end;
$$;

revoke all on function public.dawaa_execute_customer_followup_command_v1(text,text,text,timestamptz,text,text,numeric) from public, anon;
grant execute on function public.dawaa_execute_customer_followup_command_v1(text,text,text,timestamptz,text,text,numeric) to authenticated;

commit;
