-- Complete the atomic Customer Requests transition command so compatibility
-- callers cannot bypass the canonical lifecycle for sourcing/arrival/closure.

create or replace function public.advance_customer_request_v2(
  p_request_id uuid,
  p_action text,
  p_notes text default null,
  p_expected_arrival_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_actor_subject uuid;
  v_actor_name text;
  v_request public.customer_requests%rowtype;
  v_updated public.customer_requests%rowtype;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_current text;
  v_next text;
  v_event_action text;
  v_note text := nullif(trim(coalesce(p_notes,'')),'');
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then raise exception 'staff_context_required'; end if;

  v_actor_subject := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(nullif(trim(sa.staff_name),''),nullif(trim(sa.name),''),nullif(trim(sa.username),''),'موظف')
    into v_actor_name
  from public.staff_accounts sa
  where sa.id=v_account_id and coalesce(sa.active,false) and coalesce(sa.can_login,false);
  if v_actor_name is null then raise exception 'staff_context_required'; end if;

  select * into v_request
  from public.customer_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_request.branch) then
    raise exception 'customer_request_manage_forbidden';
  end if;

  v_current := lower(trim(coalesce(v_request.status,'new')));

  case v_action
    when 'start_review' then
      if v_current <> 'new' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'purchasing_review';
      v_event_action := 'استلام طلب العميل للمراجعة';
      v_note := coalesce(v_note,'تم استلام طلب العميل للمراجعة');

    when 'start_search' then
      if v_current <> 'purchasing_review' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'searching_suppliers';
      v_event_action := 'بدء البحث عن الصنف';
      v_note := coalesce(v_note,'بدأ البحث عن الصنف');

    when 'reopen_search' then
      if v_current <> 'not_available' then raise exception 'customer_request_transition_invalid'; end if;
      if v_note is null then raise exception 'customer_request_reason_required'; end if;
      v_next := 'searching_suppliers';
      v_event_action := 'إعادة فتح البحث عن الصنف أو البديل';

    when 'sourcing_needs_confirmation' then
      if v_current <> 'searching_suppliers' then raise exception 'customer_request_transition_invalid'; end if;
      if v_note is null then raise exception 'customer_request_sourcing_note_required'; end if;
      v_next := 'needs_customer_confirmation';
      v_event_action := 'التوفير يحتاج تأكيد العميل';

    when 'confirm_customer' then
      if v_current <> 'needs_customer_confirmation' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'customer_confirmed';
      v_event_action := 'تم تأكيد احتياج العميل';
      v_note := coalesce(v_note,'تم تأكيد احتياج العميل للطلب');

    when 'start_sourcing' then
      if v_current <> 'customer_confirmed' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'sourcing';
      v_event_action := 'بدء التوفير بعد تأكيد العميل';
      v_note := coalesce(v_note,'بدأ تنفيذ التوفير بعد تأكيد العميل');

    when 'sourcing_available' then
      if v_current not in ('searching_suppliers','customer_confirmed','sourcing') then
        raise exception 'customer_request_transition_invalid';
      end if;
      if v_note is null then raise exception 'customer_request_sourcing_note_required'; end if;
      v_next := 'available';
      v_event_action := 'تم توفير طلب العميل';

    when 'sourcing_not_available' then
      if v_current not in ('searching_suppliers','needs_customer_confirmation','customer_confirmed','sourcing') then
        raise exception 'customer_request_transition_invalid';
      end if;
      if v_note is null then raise exception 'customer_request_sourcing_note_required'; end if;
      v_next := 'not_available';
      v_event_action := 'الصنف غير متوفر حاليًا';

    when 'mark_arrived' then
      if v_current <> 'available' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'arrived';
      v_event_action := 'وصل الصنف للصيدلية';
      v_note := coalesce(v_note,'تم استلام الصنف ووصوله للصيدلية');

    when 'deliver' then
      if v_current <> 'customer_contacted' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'delivered';
      v_event_action := 'تم تسليم طلب العميل';
      v_note := coalesce(v_note,'تم تسليم الصنف للعميل / إتمام البيع');

    when 'close' then
      if v_current <> 'delivered' then raise exception 'customer_request_transition_invalid'; end if;
      v_next := 'closed';
      v_event_action := 'إغلاق طلب العميل';
      v_note := coalesce(v_note,'تم إغلاق الطلب بعد اكتمال التسليم');

    when 'cancel' then
      if v_current not in (
        'new','purchasing_review','searching_suppliers','needs_customer_confirmation',
        'customer_confirmed','sourcing','available','arrived','customer_contacted','not_available'
      ) then raise exception 'customer_request_transition_invalid'; end if;
      if v_note is null then raise exception 'customer_request_cancel_reason_required'; end if;
      v_next := 'cancelled';
      v_event_action := 'إلغاء طلب العميل';

    else
      raise exception 'customer_request_action_invalid';
  end case;

  update public.customer_requests
  set status=v_next,
      purchasing_assignee=case
        when v_action in ('start_review','start_search','reopen_search','start_sourcing')
          then coalesce(v_actor_name,purchasing_assignee)
        else purchasing_assignee end,
      purchasing_received_by_name=case
        when v_action='start_review' then v_actor_name
        else purchasing_received_by_name end,
      searching_by_name=case
        when v_action in ('start_search','reopen_search','start_sourcing') then v_actor_name
        else searching_by_name end,
      provided_by_name=case
        when v_action in ('sourcing_available','mark_arrived') then v_actor_name
        else provided_by_name end,
      delivered_by_name=case
        when v_action='deliver' then v_actor_name
        else delivered_by_name end,
      purchasing_notes=case
        when v_action in (
          'reopen_search','start_sourcing','sourcing_available',
          'sourcing_needs_confirmation','sourcing_not_available'
        ) then v_note
        else purchasing_notes end,
      customer_confirmation_status=case
        when v_action='sourcing_needs_confirmation' then 'pending'
        when v_action='confirm_customer' then 'confirmed'
        else customer_confirmation_status end,
      expected_arrival_date=case
        when v_action='sourcing_available' then p_expected_arrival_date
        else expected_arrival_date end,
      contact_summary=case
        when v_action='deliver' then coalesce(v_note,contact_summary,'تم التسليم')
        else contact_summary end,
      unavailable_since=case
        when v_action='sourcing_not_available' then now()
        when v_action='reopen_search' then null
        else unavailable_since end,
      closed_at=case
        when v_action in ('deliver','close','cancel') then now()
        when v_action='reopen_search' then null
        else closed_at end,
      next_action_at=case when v_action in ('deliver','close','cancel') then null else next_action_at end,
      due_date=case when v_action in ('deliver','close','cancel') then null else due_date end,
      last_action_at=now(),
      updated_at=now()
  where id=p_request_id
  returning * into v_updated;

  insert into public.customer_request_events(
    request_id,old_status,new_status,action,notes,created_by,created_by_name,created_at
  ) values (
    p_request_id,v_request.status,v_next,v_event_action,v_note,
    v_actor_subject::text,v_actor_name,now()
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.advance_customer_request_v2(uuid,text,text,date) from public;
grant execute on function public.advance_customer_request_v2(uuid,text,text,date)
  to anon, authenticated, service_role;

comment on function public.advance_customer_request_v2(uuid,text,text,date) is
  'Atomic branch-scoped Customer Request transition command covering the complete canonical lifecycle.';
