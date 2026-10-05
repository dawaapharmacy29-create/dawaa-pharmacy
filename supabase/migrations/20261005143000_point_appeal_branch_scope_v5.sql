-- Point appeals V5: financial review permission is necessary but local managers
-- remain branch-scoped. Global management may review organization-wide.

create or replace function public.dawaa_can_review_point_appeal_v5(p_branch text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_account uuid:=public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_branch text;
begin
  if v_account is null
     or not public.dawaa_current_actor_can(array['approve_points','manage_points','manage_incentives']) then
    return false;
  end if;
  select lower(trim(coalesce(role,''))),nullif(trim(coalesce(branch,'')),'')
    into v_role,v_branch
  from public.staff_accounts
  where id=v_account and coalesce(active,false) and coalesce(can_login,false)
  limit 1;
  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  return p_branch is not null and v_branch is not null and trim(p_branch)=v_branch;
end;
$function$;

drop policy if exists point_appeals_self_read_v1 on public.point_appeals;
create policy point_appeals_self_read_v1
on public.point_appeals for select to anon,authenticated
using (
  subject_staff_id=(
    select sa.staff_id::text from public.staff_accounts sa
    where sa.id=public.dawaa_current_staff_account_id_strict() limit 1
  )
  or public.dawaa_can_review_point_appeal_v5(branch)
);

-- Replace reviewer RPC so a guessed appeal UUID cannot bypass branch scope.
create or replace function public.review_point_appeal_v1(
  p_appeal_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.point_appeals
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_appeal public.point_appeals%rowtype;
  v_original public.employee_transactions%rowtype;
  v_points numeric;
begin
  if p_decision not in ('upheld','overturned') then raise exception 'invalid point appeal decision'; end if;
  v_actor_id:=public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then raise exception 'not authorized to review point appeals'; end if;

  select * into v_appeal from public.point_appeals where id=p_appeal_id for update;
  if not found then raise exception 'point appeal not found'; end if;
  if not public.dawaa_can_review_point_appeal_v5(v_appeal.branch) then
    raise exception 'point_appeal_branch_scope_denied' using errcode='42501';
  end if;

  select coalesce(sa.staff_name,sa.name,sa.username,sa.id::text)
    into v_actor_name from public.staff_accounts sa where sa.id=v_actor_id;

  if v_appeal.status=p_decision then return v_appeal; end if;
  if v_appeal.status not in ('pending','under_review') then raise exception 'point appeal already finalized'; end if;

  if p_decision='overturned' then
    if coalesce(v_appeal.point_record_id,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then raise exception 'appeal has no canonical employee transaction'; end if;
    select * into v_original from public.employee_transactions
      where id=v_appeal.point_record_id::uuid for update;
    if not found or v_original.type not in ('penalty','deduction')
       or v_original.staff_id::text<>v_appeal.subject_staff_id
       or coalesce(trim(v_original.branch),'')<>coalesce(trim(v_appeal.branch),'') then
      raise exception 'appeal does not match its penalty transaction';
    end if;
    v_points:=abs(coalesce(nullif(v_original.points_delta,0),v_original.points,v_appeal.original_points_delta,0));
    if v_points<=0 then raise exception 'penalty has no reversible points'; end if;
    insert into public.employee_transactions(
      staff_id,employee_name,branch,type,points,points_delta,amount,reason,description,
      source,source_id,month_cycle,status,created_by,created_by_name,approved_by,
      approved_by_name,approved_at,metadata
    ) values (
      v_original.staff_id,coalesce(v_original.employee_name,v_appeal.subject_name),
      coalesce(v_original.branch,v_appeal.branch),'reward',v_points,v_points,0,
      'عكس خصم بعد قبول الاعتراض',nullif(btrim(p_review_note),''),
      'point_appeal_reversal',v_appeal.id,v_original.month_cycle,'active',
      v_actor_id::text,v_actor_name,v_actor_id::text,v_actor_name,now(),
      jsonb_build_object('appeal_id',v_appeal.id,'reverses_employee_transaction_id',v_original.id)
    )
    on conflict(source,source_id) where source='point_appeal_reversal' do nothing;
  end if;

  update public.point_appeals
  set status=p_decision,review_note=nullif(btrim(p_review_note),''),
      reviewed_by_staff_id=v_actor_id::text,reviewed_by_name=v_actor_name,reviewed_at=now()
  where id=p_appeal_id returning * into v_appeal;
  return v_appeal;
end;
$function$;

revoke all on function public.dawaa_can_review_point_appeal_v5(text) from public;
grant execute on function public.dawaa_can_review_point_appeal_v5(text) to anon,authenticated,service_role;
revoke all on function public.review_point_appeal_v1(uuid,text,text) from public;
grant execute on function public.review_point_appeal_v1(uuid,text,text) to anon,authenticated;

notify pgrst,'reload schema';
