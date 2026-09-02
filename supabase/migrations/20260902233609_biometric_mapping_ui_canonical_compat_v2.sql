create or replace function public.list_biometric_mapping_staff_candidates_v1(p_search text default '',p_limit integer default 30)
returns table(staff_account_id uuid,staff_id uuid,staff_name text,branch text,role text)
language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare v_q text:=trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  return query
  select coalesce(a.id,s.id),s.id,s.name,s.branch,coalesce(nullif(s.role,''),a.role)
  from public.staff s
  left join lateral (
    select sa.* from public.staff_accounts sa
    where coalesce(sa.active,sa.is_active,true)=true and trim(coalesce(sa.staff_id,''))=s.id::text
    order by sa.updated_at desc nulls last,sa.id limit 1
  ) a on true
  where coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
    and (v_q='' or s.name ilike '%'||v_q||'%' or coalesce(a.staff_name,a.name,a.username,'') ilike '%'||v_q||'%' or s.branch ilike '%'||v_q||'%')
  order by case when v_q<>'' and lower(trim(s.name))=lower(v_q) then 0 else 1 end,s.name
  limit greatest(1,least(coalesce(p_limit,30),100));
end;$$;

create or replace function public.assign_biometric_staff_mapping_v1(p_provider text,p_biometric_user_id text,p_staff_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_staff_id uuid;
begin
  select trim(a.staff_id)::uuid into v_staff_id from public.staff_accounts a
  where a.id=p_staff_account_id and coalesce(a.active,a.is_active,true)=true
    and trim(coalesce(a.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  if v_staff_id is null then
    select s.id into v_staff_id from public.staff s where s.id=p_staff_account_id and coalesce(s.active,false)=true limit 1;
  end if;
  if v_staff_id is null then raise exception 'selected staff identity is not canonical'; end if;
  return public.assign_biometric_staff_mapping_v2(p_provider,p_biometric_user_id,v_staff_id);
end;$$;
revoke all on function public.assign_biometric_staff_mapping_v1(text,text,uuid) from public;
grant execute on function public.assign_biometric_staff_mapping_v1(text,text,uuid) to anon,authenticated,service_role;