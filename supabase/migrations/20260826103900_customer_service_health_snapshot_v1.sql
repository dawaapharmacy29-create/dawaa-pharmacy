create or replace function public.dawaa_customer_service_health_v1(p_branch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $function$
declare
  a public.staff_accounts;
  v_role text;
  v_actor_branch text;
  v_branch text := nullif(trim(coalesce(p_branch,'')), '');
  v_global boolean;
  v_result jsonb;
begin
  a := public.dawaa_require_customer_service_actor_v1(false);
  v_role := lower(trim(coalesce(a.role,a.staff_role,'')));
  v_actor_branch := nullif(trim(coalesce(a.branch,'')), '');
  v_global := v_role in ('admin','owner','general_manager','executive_manager','branches_manager','manager');

  if v_branch in ('الكل','كل الفروع','__all__','all') then v_branch := null; end if;
  if v_branch is not null and v_branch not in ('فرع الشامي','فرع شكري') then
    raise exception 'الفرع المطلوب غير صحيح';
  end if;
  if not v_global then
    if v_actor_branch is null then raise exception 'حساب الموظف غير مربوط بفرع'; end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then
      raise exception 'لا يمكن عرض صحة نظام فرع آخر';
    end if;
    v_branch := v_actor_branch;
  end if;

  with scoped as (
    select d.*
    from public.daily_followups d
    where case
      when v_branch is not null then d.branch = v_branch
      when v_global then true
      else d.branch = v_actor_branch
    end
  ), open_rows as (
    select * from scoped
    where completed_at is null
      and cancelled_at is null
      and archived_at is null
      and coalesce(is_hidden,false)=false
      and duplicate_of is null
  ), duplicate_groups as (
    select identity_key, branch, coalesce(nullif(trim(request_type),''),'general') request_type, count(*) n
    from open_rows
    where identity_key is not null
    group by identity_key, branch, coalesce(nullif(trim(request_type),''),'general')
    having count(*) > 1
  ), event_health as (
    select count(*)::int orphan_events
    from public.customer_followup_events e
    where not exists (select 1 from public.daily_followups d where d.id::text=e.followup_id::text)
      and (v_global and v_branch is null or e.branch=v_branch or (not v_global and e.branch=v_actor_branch))
  )
  select jsonb_build_object(
    'scope_branch', coalesce(v_branch, case when v_global then 'كل الفروع' else v_actor_branch end),
    'open_total', (select count(*) from open_rows),
    'official_duplicate_groups', (select count(*) from duplicate_groups),
    'official_duplicate_rows', (select coalesce(sum(n),0) from duplicate_groups),
    'open_without_schedule', (select count(*) from open_rows where next_followup_date is null and postponed_until is null),
    'missing_identity', (select count(*) from open_rows where identity_key is null or nullif(trim(coalesce(customer_name,name,'')),'') is null),
    'invalid_branch_rows', (select count(*) from scoped where coalesce(branch,'') not in ('فرع الشامي','فرع شكري')),
    'completed_without_summary', (select count(*) from scoped where completed_at is not null and length(trim(coalesce(evaluation_summary,followup_summary,followup_notes,''))) < 10),
    'orphan_events', (select orphan_events from event_health),
    'generated_at', now(),
    'status', case
      when (select count(*) from duplicate_groups) > 0 or (select orphan_events from event_health) > 0 then 'critical'
      when (select count(*) from open_rows where next_followup_date is null and postponed_until is null) > 0
        or (select count(*) from open_rows where identity_key is null or nullif(trim(coalesce(customer_name,name,'')),'') is null) > 0
        or (select count(*) from scoped where coalesce(branch,'') not in ('فرع الشامي','فرع شكري')) > 0 then 'warning'
      else 'healthy'
    end
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.dawaa_customer_service_health_v1(text) from public;
grant execute on function public.dawaa_customer_service_health_v1(text) to anon, authenticated, service_role;
select pg_notify('pgrst','reload schema');