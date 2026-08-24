begin;

drop function if exists public.dawaa_execute_customer_followup_command_v1(text,text,text,timestamptz,text,text,numeric);

create or replace function public.dawaa_execute_customer_followup_command_v1(
  p_followup_id text,
  p_command text,
  p_note text default null,
  p_next_followup_date timestamptz default null,
  p_contact_channel text default null,
  p_outcome text default null,
  p_purchase_value numeric default null,
  p_target_branch text default null,
  p_attempt_type text default null,
  p_needs_next_followup boolean default null,
  p_result text default null,
  p_followup_notes text default null
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
  v_result text := nullif(trim(coalesce(p_result, '')), '');
  v_role text;
  v_is_senior boolean;
  v_now timestamptz := now();
  v_next timestamptz;
  v_attempt_label text;
begin
  v_actor := public.dawaa_require_customer_service_actor_v1(false);
  v_role := lower(trim(coalesce(v_actor.role, v_actor.staff_role, '')));
  v_is_senior := v_role in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager');
  select * into v_before from public.daily_followups where id::text = p_followup_id for update;
  if not found then raise exception 'المتابعة غير موجودة'; end if;

  if v_command not in ('message_sent','no_answer','replied','schedule','submit_review','approve','return_for_completion','escalate','assign_self','continue','edit_result','reopen','assign_branch','record_attempt') then
    raise exception 'أمر المتابعة غير مدعوم';
  end if;
  if v_command <> 'assign_branch' and not v_is_senior
     and nullif(trim(coalesce(v_actor.branch, '')), '') is distinct from nullif(trim(coalesce(v_before.branch, '')), '') then
    raise exception 'هذه المتابعة خارج نطاق فرع الحساب';
  end if;
  if v_command in ('approve','return_for_completion','reopen','assign_branch') and not v_is_senior then
    raise exception 'هذا القرار متاح للمدير المخول فقط';
  end if;
  if v_command='assign_branch' and trim(coalesce(p_target_branch,'')) not in ('فرع الشامي','فرع شكري') then raise exception 'الفرع الجديد غير صحيح'; end if;
  if v_command in ('replied','submit_review','return_for_completion','continue','edit_result') and length(coalesce(v_note,v_result,'')) < 3 then raise exception 'اكتب نتيجة واضحة قبل الحفظ'; end if;
  if p_purchase_value is not null and p_purchase_value < 0 then raise exception 'قيمة الشراء غير صحيحة'; end if;

  v_next := coalesce(p_next_followup_date, date_trunc('day', v_now at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' + interval '1 day');
  v_attempt_label := case lower(trim(coalesce(p_attempt_type,'')))
    when 'call_no_answer' then 'اتصال ولم يرد' when 'whatsapp_sent' then 'تم إرسال واتساب'
    when 'phone_off' then 'الهاتف مغلق' when 'invalid_number' then 'الرقم غير صحيح'
    when 'callback_requested' then 'طلب التواصل لاحقًا' when 'connected' then 'تم التواصل بنجاح' else null end;
  if v_command='record_attempt' and v_attempt_label is null then raise exception 'نوع محاولة التواصل غير صحيح'; end if;

  update public.daily_followups f set
    updated_at=v_now, updated_by=v_actor.id::text,
    branch=case when v_command='assign_branch' then trim(p_target_branch) else f.branch end,
    last_attempt_at=case when v_command in ('message_sent','no_answer','replied','record_attempt','continue') then v_now else f.last_attempt_at end,
    attempt_count=coalesce(f.attempt_count,0)+case when v_command in ('message_sent','no_answer','replied','record_attempt','continue') then 1 else 0 end,
    contacted_at=case when v_command in ('message_sent','no_answer','continue') then coalesce(f.contacted_at,v_now) else f.contacted_at end,
    first_attempt_at=case when v_command in ('message_sent','no_answer','record_attempt','continue') then coalesce(f.first_attempt_at,v_now) else f.first_attempt_at end,
    contact_method=case when v_command='continue' then nullif(trim(coalesce(p_contact_channel,'')),'') else f.contact_method end,
    contact_result=case when v_command='continue' then v_result else f.contact_result end,
    contact_status=case v_command when 'message_sent' then 'في انتظار الرد' when 'no_answer' then 'لم يرد' when 'replied' then 'تم الرد' when 'submit_review' then 'في انتظار المراجعة' when 'approve' then 'تم الاعتماد' when 'return_for_completion' then 'أُعيدت للاستكمال' when 'reopen' then 'متابعة مطلوبة' when 'edit_result' then case when coalesce(p_needs_next_followup,false) then 'متابعة مطلوبة' else 'تم الرد' end when 'continue' then case when v_result in ('لم يرد','طلب التواصل لاحقًا') then v_result else 'تم الرد' end else f.contact_status end,
    followup_status=case v_command when 'message_sent' then 'في انتظار الرد' when 'no_answer' then 'لم يرد' when 'replied' then 'جارٍ التواصل' when 'schedule' then 'scheduled' when 'submit_review' then 'pending_review' when 'approve' then 'completed' when 'return_for_completion' then 'returned_for_completion' when 'reopen' then 'متابعة مفتوحة' when 'edit_result' then case when coalesce(p_needs_next_followup,false) then 'متابعة مفتوحة' else 'مكتمل' end when 'continue' then case when v_result='لم يرد' then 'لم يرد' when v_result='طلب التواصل لاحقًا' then 'مؤجل' when v_result='يحتاج متابعة مدير' then 'يحتاج مدير' else 'تم' end else f.followup_status end,
    response_status=case v_command when 'message_sent' then 'waiting_reply' when 'no_answer' then 'no_answer' when 'replied' then 'replied' when 'reopen' then 'pending' when 'edit_result' then case when coalesce(p_needs_next_followup,false) then 'pending' else 'replied' end else f.response_status end,
    status=case v_command when 'message_sent' then 'في انتظار الرد' when 'no_answer' then 'لم يرد' when 'replied' then 'جارٍ التواصل' when 'schedule' then 'open' when 'submit_review' then 'pending_review' when 'approve' then 'completed' when 'return_for_completion' then 'open' when 'reopen' then 'متابعة مفتوحة' when 'edit_result' then case when coalesce(p_needs_next_followup,false) then 'متابعة مفتوحة' else 'مكتمل' end when 'continue' then case when v_result='لم يرد' then 'لم يرد' when v_result='طلب التواصل لاحقًا' then 'مؤجل' when v_result='يحتاج متابعة مدير' then 'يحتاج مدير' else 'تم' end else f.status end,
    next_followup_date=case when v_command in ('message_sent','no_answer','replied','schedule') then v_next when v_command in ('return_for_completion','reopen') then v_now when v_command in ('continue','edit_result') then case when coalesce(p_needs_next_followup,false) or v_result in ('لم يرد','طلب التواصل لاحقًا') then p_next_followup_date else null end else f.next_followup_date end,
    needs_next_followup=case when v_command in ('message_sent','no_answer','replied','schedule','return_for_completion','reopen') then true when v_command in ('submit_review','approve') then false when v_command in ('continue','edit_result') then coalesce(p_needs_next_followup, v_result in ('لم يرد','طلب التواصل لاحقًا')) else f.needs_next_followup end,
    followup_summary=case when v_command in ('replied','submit_review','return_for_completion','escalate','continue','edit_result') then coalesce(v_note,v_result,f.followup_summary) else f.followup_summary end,
    followup_result=case when v_command in ('replied','submit_review','continue','edit_result') then coalesce(v_result,v_note) else f.followup_result end,
    followup_notes=case when v_command='continue' then nullif(trim(coalesce(p_followup_notes,'')),'') else f.followup_notes end,
    notes=case when v_command in ('continue','edit_result') then nullif(trim(coalesce(p_followup_notes,'')),'') when v_command='reopen' then concat_ws(' — ',nullif(trim(coalesce(f.notes,'')),''),v_note) else f.notes end,
    purchase_after_followup=case when v_command='continue' then p_purchase_value is not null else f.purchase_after_followup end,
    purchase_amount=case when v_command='continue' then p_purchase_value else f.purchase_amount end,
    needs_manager=case when v_command='escalate' or (v_command='submit_review' and p_outcome='issue') or (v_command='continue' and v_result='يحتاج متابعة مدير') then true else f.needs_manager end,
    responsible_name=case when v_command='assign_self' then coalesce(v_actor.name,v_actor.username) else f.responsible_name end,
    assigned_to=case when v_command='assign_self' then coalesce(v_actor.name,v_actor.username) else f.assigned_to end,
    assigned_to_staff_id=case when v_command='assign_self' then v_actor.id::text else f.assigned_to_staff_id end,
    completed_at=case when v_command='approve' then v_now when v_command in ('return_for_completion','reopen') then null when v_command in ('continue','edit_result') then case when coalesce(p_needs_next_followup,false) or v_result in ('لم يرد','طلب التواصل لاحقًا') then null else coalesce(f.completed_at,v_now) end else f.completed_at end,
    closed_at=case when v_command='reopen' then null when v_command='edit_result' then case when coalesce(p_needs_next_followup,false) then null else coalesce(f.closed_at,v_now) end else f.closed_at end,
    completed_by=case when v_command='approve' then v_actor.id::text else f.completed_by end,
    is_hidden=case when v_command='approve' then true when v_command in ('submit_review','return_for_completion','escalate','reopen') then false else f.is_hidden end,
    hidden_at=case when v_command='approve' then v_now when v_command in ('return_for_completion','reopen') then null else f.hidden_at end,
    hidden_by=case when v_command='approve' then coalesce(v_actor.name,v_actor.username) when v_command in ('return_for_completion','reopen') then null else f.hidden_by end,
    hidden_reason=case when v_command='approve' then 'تم اعتماد المتابعة بعد المراجعة' when v_command in ('return_for_completion','reopen') then null else f.hidden_reason end
  where f.id::text=p_followup_id returning * into v_after;

  insert into public.customer_followup_audit_log(followup_id,customer_id,action,actor_staff_id,actor_name,branch,metadata)
  values(v_after.id::text,v_after.customer_id::text,v_command,v_actor.id::text,coalesce(v_actor.name,v_actor.username),v_after.branch,
    jsonb_strip_nulls(jsonb_build_object('note',v_note,'result',v_result,'old_branch',v_before.branch,'new_branch',v_after.branch,'next_followup_date',v_after.next_followup_date,'contact_channel',nullif(trim(coalesce(p_contact_channel,'')),''),'outcome',nullif(trim(coalesce(p_outcome,'')),''),'purchase_value',p_purchase_value,'attempt_type',nullif(trim(coalesce(p_attempt_type,'')),''),'attempt_label',v_attempt_label,'attempt_number',v_after.attempt_count)));
  if v_command='record_attempt' then
    insert into public.customer_followup_events(followup_id,customer_id,customer_code,event_type,old_status,new_status,event_note,event_payload,branch,actor_id,actor_name)
    values(v_after.id::text,v_after.customer_id::text,v_after.customer_code,'contact_attempt',coalesce(v_before.followup_status,v_before.status),coalesce(v_after.followup_status,v_after.status),coalesce(v_note,v_attempt_label),jsonb_build_object('attempt_type',p_attempt_type,'attempt_label',v_attempt_label,'attempt_number',v_after.attempt_count),v_after.branch,v_actor.id::text,coalesce(v_actor.name,v_actor.username));
  end if;
  return v_after;
end;
$$;

revoke all on function public.dawaa_execute_customer_followup_command_v1(text,text,text,timestamptz,text,text,numeric,text,text,boolean,text,text) from public,anon;
grant execute on function public.dawaa_execute_customer_followup_command_v1(text,text,text,timestamptz,text,text,numeric,text,text,boolean,text,text) to authenticated;

commit;
