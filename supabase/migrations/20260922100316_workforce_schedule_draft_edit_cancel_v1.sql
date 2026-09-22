create or replace function public.update_schedule_draft_v1(
  p_draft_id uuid,p_rows jsonb,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_draft public.workforce_schedule_drafts%rowtype;
  v_row jsonb;
  v_day text;
  v_sort integer:=0;
begin
  if p_draft_id is null or jsonb_typeof(p_rows)<>'array' then raise exception 'invalid_schedule_draft_update' using errcode='22023'; end if;

  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  select * into v_draft from public.workforce_schedule_drafts where id=p_draft_id for update;
  if not found then raise exception 'schedule_draft_not_found' using errcode='22023'; end if;
  if v_draft.status in ('published','cancelled') then raise exception 'schedule_draft_closed' using errcode='22023'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager','branch_manager') then raise exception 'not_authorized_for_schedule_write' using errcode='42501'; end if;
  if v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_draft.branch,'')) then raise exception 'branch_manager_cross_branch_schedule_write_blocked' using errcode='42501'; end if;

  delete from public.workforce_schedule_draft_rows where draft_id=p_draft_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_day:=nullif(trim(v_row->>'day_name'),'');
    if v_day is null then continue; end if;
    insert into public.workforce_schedule_draft_rows(
      draft_id,day_name,shift_start,shift_end,is_off,is_day_off,notes,sort_order
    ) values(
      p_draft_id,v_day,nullif(trim(v_row->>'shift_start'),''),nullif(trim(v_row->>'shift_end'),''),
      coalesce((v_row->>'is_off')::boolean,false),
      coalesce((v_row->>'is_day_off')::boolean,coalesce((v_row->>'is_off')::boolean,false)),
      nullif(trim(v_row->>'notes'),''),coalesce(nullif(v_row->>'sort_order','')::int,v_sort)
    );
    v_sort:=v_sort+1;
  end loop;

  update public.workforce_schedule_drafts
  set status='draft',
      note=coalesce(nullif(trim(coalesce(p_note,'')),''),note),
      validation='{"errors":[],"warnings":[]}'::jsonb,
      validated_by=null,validated_at=null,updated_at=now()
  where id=p_draft_id;

  return jsonb_build_object('success',true,'draft_id',p_draft_id,'status','draft');
end;
$function$;

create or replace function public.cancel_schedule_draft_v1(p_draft_id uuid,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_draft public.workforce_schedule_drafts%rowtype;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  select * into v_draft from public.workforce_schedule_drafts where id=p_draft_id for update;
  if not found then raise exception 'schedule_draft_not_found' using errcode='22023'; end if;
  if v_draft.status='published' then raise exception 'published_schedule_draft_cannot_cancel' using errcode='22023'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager','branch_manager') then raise exception 'not_authorized_for_schedule_write' using errcode='42501'; end if;
  if v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_draft.branch,'')) then raise exception 'branch_manager_cross_branch_schedule_write_blocked' using errcode='42501'; end if;

  update public.workforce_schedule_drafts
  set status='cancelled',
      note=concat_ws(' | ',nullif(note,''),nullif(trim(coalesce(p_note,'')),'تم إلغاء المسودة')),
      updated_at=now()
  where id=p_draft_id;

  return jsonb_build_object('success',true,'draft_id',p_draft_id,'status','cancelled');
end;
$function$;

revoke execute on function public.update_schedule_draft_v1(uuid,jsonb,text) from public;
revoke execute on function public.cancel_schedule_draft_v1(uuid,text) from public;
grant execute on function public.update_schedule_draft_v1(uuid,jsonb,text) to anon,authenticated,service_role;
grant execute on function public.cancel_schedule_draft_v1(uuid,text) to anon,authenticated,service_role;
