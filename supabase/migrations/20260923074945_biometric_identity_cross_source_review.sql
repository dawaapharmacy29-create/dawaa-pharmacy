-- A code can be seen by both direct bridges and the legacy feed. Show a
-- candidate from another source, but never assign it automatically: terminals
-- may reuse numeric codes for different people.
create or replace function public.biometric_cross_source_candidate_v1(
  p_provider text, p_biometric_user_id text
)
returns table(staff_id uuid, staff_name text, staff_branch text,
  staff_active boolean, source_providers text[], has_conflict boolean)
language plpgsql stable security definer set search_path=public,pg_catalog as $$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to review biometric mapping';
  end if;
  if trim(coalesce(p_provider,'')) not in
    ('fingerprint_vendor_primary','zk_shami_direct_bridge','zk_shokry_direct_bridge')
    or length(trim(coalesce(p_biometric_user_id,''))) not between 1 and 32 then
    raise exception 'invalid biometric source or code';
  end if;
  return query
  with matches as (
    select distinct m.staff_id,m.provider
    from public.biometric_staff_mapping m
    where m.active=true and m.staff_id is not null
      and m.biometric_user_id=trim(p_biometric_user_id)
      and m.provider in ('fingerprint_vendor_primary','zk_shami_direct_bridge','zk_shokry_direct_bridge')
  ), identities as (
    select count(distinct x.staff_id) > 1 as conflict from matches x
  )
  select s.id,s.name,s.branch,coalesce(s.active,false),
    array_agg(distinct x.provider order by x.provider),i.conflict
  from matches x join public.staff s on s.id=x.staff_id
  cross join identities i
  group by s.id,s.name,s.branch,s.active,i.conflict
  order by s.name limit 10;
end; $$;
revoke all on function public.biometric_cross_source_candidate_v1(text,text) from public;
grant execute on function public.biometric_cross_source_candidate_v1(text,text) to authenticated,service_role;

-- Confirmed identity correction. Keep the same canonical UUID and mappings.
do $$ declare v_staff_id uuid; begin
  if (select count(*) from public.staff s where s.name='يوسف ماهر' and coalesce(s.active,false)=true)>1 then
    raise exception 'Ambiguous Youssef Maher identity';
  end if;
  select s.id into v_staff_id from public.staff s
  where s.name='يوسف ماهر' and coalesce(s.active,false)=true;
  if v_staff_id is not null and exists (select 1 from public.staff s where s.name='يوسف زكي' and s.id<>v_staff_id) then
    raise exception 'Youssef Zaki already exists; review duplicate identity';
  end if;
  if v_staff_id is not null then
    update public.staff set name='يوسف زكي' where id=v_staff_id;
    update public.staff_accounts set name='يوسف زكي' where trim(staff_id)=v_staff_id::text;
  end if;
end $$;
