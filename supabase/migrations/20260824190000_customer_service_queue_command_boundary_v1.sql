begin;

create or replace function public.dawaa_replace_customer_service_daily_queue_v1(p_branch text,p_queue_date date,p_items jsonb,p_replace boolean default false)
returns setof public.customer_service_daily_queue_items language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; v_role text; v_branch text:=trim(coalesce(p_branch,'')); item jsonb;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false); v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  if v_branch not in ('فرع الشامي','فرع شكري') then raise exception 'الفرع غير صحيح'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager')
     and nullif(trim(coalesce(a.branch,'')),'') is distinct from v_branch then raise exception 'قائمة الفرع خارج نطاق الحساب'; end if;
  if p_queue_date is distinct from (now() at time zone 'Africa/Cairo')::date then raise exception 'لا يمكن تعديل إلا قائمة اليوم'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))>100 then raise exception 'حمولة القائمة غير صحيحة'; end if;
  if p_replace then delete from public.customer_service_daily_queue_items where queue_date=p_queue_date and branch=v_branch; end if;
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    if nullif(trim(coalesce(item->>'customer_key','')),'') is null or nullif(trim(coalesce(item->>'customer_name','')),'') is null then raise exception 'هوية واسم العميل مطلوبان'; end if;
    insert into public.customer_service_daily_queue_items(queue_date,branch,customer_key,customer_id,customer_code,customer_name,customer_phone,source,priority,reason,status,linked_followup_id,next_followup_date,created_by,created_by_name,metadata)
    values(p_queue_date,v_branch,trim(item->>'customer_key'),nullif(trim(coalesce(item->>'customer_id','')),''),nullif(trim(coalesce(item->>'customer_code','')),''),trim(item->>'customer_name'),nullif(trim(coalesce(item->>'customer_phone','')),''),coalesce(nullif(trim(coalesce(item->>'source','')),''),'important'),coalesce(nullif(trim(coalesce(item->>'priority','')),''),'مهم'),nullif(trim(coalesce(item->>'reason','')),''),'not_started',nullif(trim(coalesce(item->>'linked_followup_id','')),''),nullif(trim(coalesce(item->>'next_followup_date','')),'')::date,a.id::text,coalesce(a.name,a.username),coalesce(item->'metadata','{}'::jsonb))
    on conflict(queue_date,branch,customer_key) do update set customer_id=excluded.customer_id,customer_code=excluded.customer_code,customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,source=excluded.source,priority=excluded.priority,reason=excluded.reason,linked_followup_id=coalesce(excluded.linked_followup_id,customer_service_daily_queue_items.linked_followup_id),next_followup_date=excluded.next_followup_date,metadata=excluded.metadata;
  end loop;
  return query select * from public.customer_service_daily_queue_items where queue_date=p_queue_date and branch=v_branch order by created_at;
end $$;

create or replace function public.dawaa_update_customer_service_queue_item_v1(p_id uuid,p_status text default null,p_linked_followup_id text default null,p_set_linked boolean default false,p_next_followup_date date default null,p_set_next boolean default false,p_started boolean default false,p_completed boolean default false)
returns public.customer_service_daily_queue_items language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; q public.customer_service_daily_queue_items%rowtype; v_role text;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false); v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  select * into q from public.customer_service_daily_queue_items where id=p_id for update; if not found then raise exception 'عنصر القائمة غير موجود'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager') and nullif(trim(coalesce(a.branch,'')),'') is distinct from q.branch then raise exception 'عنصر القائمة خارج نطاق الفرع'; end if;
  update public.customer_service_daily_queue_items set status=coalesce(nullif(trim(coalesce(p_status,'')),''),status),linked_followup_id=case when p_set_linked then nullif(trim(coalesce(p_linked_followup_id,'')),'') else linked_followup_id end,next_followup_date=case when p_set_next then p_next_followup_date else next_followup_date end,started_at=case when p_started then coalesce(started_at,now()) else started_at end,completed_at=case when p_completed then now() else completed_at end,last_action_at=now() where id=p_id returning * into q; return q;
end $$;

create or replace function public.dawaa_append_customer_service_followup_event_v1(p_followup_id text default null,p_queue_item_id uuid default null,p_event_type text default null,p_event_status text default null,p_notes text default null,p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; v_role text; v_branch text; v_id uuid;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false); v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  if nullif(trim(coalesce(p_event_type,'')),'') is null then raise exception 'نوع الحدث مطلوب'; end if;
  if p_queue_item_id is not null then select branch into v_branch from public.customer_service_daily_queue_items where id=p_queue_item_id; end if;
  if v_branch is null and nullif(trim(coalesce(p_followup_id,'')),'') is not null then select branch into v_branch from public.daily_followups where id::text=p_followup_id; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager') and nullif(trim(coalesce(a.branch,'')),'') is distinct from nullif(trim(coalesce(v_branch,'')),'') then raise exception 'حدث المتابعة خارج نطاق الفرع'; end if;
  insert into public.customer_service_followup_events(followup_id,queue_item_id,event_type,event_status,actor_staff_id,actor_name,notes,metadata)
  values(nullif(trim(coalesce(p_followup_id,'')),''),p_queue_item_id,trim(p_event_type),nullif(trim(coalesce(p_event_status,'')),''),a.id::text,coalesce(a.name,a.username),nullif(trim(coalesce(p_notes,'')),''),coalesce(p_metadata,'{}'::jsonb)) returning id into v_id; return v_id;
end $$;

create or replace function public.dawaa_can_read_customer_service_branch_v1(p_branch text)
returns boolean language plpgsql stable security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; v_id uuid; v_role text;
begin
  v_id:=public.dawaa_current_staff_account_id_strict(); if v_id is null then return false; end if;
  select * into a from public.staff_accounts where id=v_id and coalesce(active,false) and coalesce(can_login,false); if not found then return false; end if;
  v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  return v_role in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager') or nullif(trim(coalesce(a.branch,'')),'') is not distinct from nullif(trim(coalesce(p_branch,'')),'');
end $$;

drop policy if exists customer_service_daily_queue_app_access on public.customer_service_daily_queue_items;
drop policy if exists customer_service_followup_events_app_access on public.customer_service_followup_events;
create policy customer_service_daily_queue_scoped_select on public.customer_service_daily_queue_items for select to anon,authenticated using(public.dawaa_can_read_customer_service_branch_v1(branch));
create policy customer_service_followup_events_scoped_select on public.customer_service_followup_events for select to anon,authenticated using(
  (queue_item_id is not null and exists(select 1 from public.customer_service_daily_queue_items q where q.id=queue_item_id and public.dawaa_can_read_customer_service_branch_v1(q.branch)))
  or (followup_id is not null and exists(select 1 from public.daily_followups f where f.id::text=followup_id and public.dawaa_can_read_customer_service_branch_v1(f.branch)))
);

revoke insert,update,delete on public.customer_service_daily_queue_items from anon,authenticated;
revoke insert,update,delete on public.customer_service_followup_events from anon,authenticated;
revoke all on function public.dawaa_can_read_customer_service_branch_v1(text) from public,anon;
revoke all on function public.dawaa_replace_customer_service_daily_queue_v1(text,date,jsonb,boolean) from public,anon;
revoke all on function public.dawaa_update_customer_service_queue_item_v1(uuid,text,text,boolean,date,boolean,boolean,boolean) from public,anon;
revoke all on function public.dawaa_append_customer_service_followup_event_v1(text,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.dawaa_replace_customer_service_daily_queue_v1(text,date,jsonb,boolean) to authenticated;
grant execute on function public.dawaa_update_customer_service_queue_item_v1(uuid,text,text,boolean,date,boolean,boolean,boolean) to authenticated;
grant execute on function public.dawaa_append_customer_service_followup_event_v1(text,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.dawaa_can_read_customer_service_branch_v1(text) to anon,authenticated;

commit;
