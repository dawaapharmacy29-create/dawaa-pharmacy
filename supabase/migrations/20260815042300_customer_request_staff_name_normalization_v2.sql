create or replace function public.customer_request_resolve_staff_id_v1(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm text := trim(regexp_replace(replace(replace(replace(replace(lower(coalesce(p_name,'')),'أ','ا'),'إ','ا'),'آ','ا'),'ى','ي'), '[\s/\\._-]+', ' ', 'g'));
  v_ids uuid[];
begin
  if v_norm = '' then return null; end if;

  select array_agg(distinct staff_id) into v_ids
  from (
    select s.id as staff_id
    from public.staff s
    where coalesce(s.is_active,true)=true
      and trim(regexp_replace(replace(replace(replace(replace(lower(coalesce(s.name,'')),'أ','ا'),'إ','ا'),'آ','ا'),'ى','ي'), '[\s/\\._-]+', ' ', 'g')) = v_norm
    union
    select a.staff_id
    from public.staff_identity_aliases a
    join public.staff s on s.id=a.staff_id
    where coalesce(a.active,true)=true
      and coalesce(s.is_active,true)=true
      and trim(regexp_replace(replace(replace(replace(replace(lower(coalesce(a.alias_name,'')),'أ','ا'),'إ','ا'),'آ','ا'),'ى','ي'), '[\s/\\._-]+', ' ', 'g')) = v_norm
  ) q;

  if coalesce(array_length(v_ids,1),0)=1 then return v_ids[1]; end if;
  return null;
end;
$$;

update public.customer_requests
set source_payload=source_payload
where source_system='dawaawael' and source_entity='CustomerOrder';