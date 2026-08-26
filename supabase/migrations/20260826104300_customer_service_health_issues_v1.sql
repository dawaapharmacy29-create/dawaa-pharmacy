create or replace function public.dawaa_customer_service_health_issues_v1(
  p_branch text default null,
  p_issue text default 'unscheduled',
  p_limit integer default 50
)
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
  v_issue text := lower(trim(coalesce(p_issue,'unscheduled')));
  v_global boolean;
  v_limit integer := greatest(1, least(coalesce(p_limit,50),100));
  v_rows jsonb;
begin
  a := public.dawaa_require_customer_service_actor_v1(false);
  v_role := lower(trim(coalesce(a.role,a.staff_role,'')));
  v_actor_branch := nullif(trim(coalesce(a.branch,'')), '');
  v_global := v_role in ('admin','owner','general_manager','executive_manager','branches_manager','manager');

  if v_branch in ('الكل','كل الفروع','__all__','all') then v_branch := null; end if;
  if v_branch is not null and v_branch not in ('فرع الشامي','فرع شكري') then raise exception 'الفرع المطلوب غير صحيح'; end if;
  if v_issue not in ('unscheduled','missing_identity','invalid_branch','duplicate') then raise exception 'نوع فحص الصحة غير مدعوم'; end if;

  if not v_global then
    if v_actor_branch is null then raise exception 'حساب الموظف غير مربوط بفرع'; end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then raise exception 'لا يمكن عرض حالات فرع آخر'; end if;
    if v_issue = 'invalid_branch' then return jsonb_build_object('issue',v_issue,'scope_branch',v_actor_branch,'count',0,'rows','[]'::jsonb); end if;
    v_branch := v_actor_branch;
  end if;

  with scoped as (
    select d.* from public.daily_followups d
    where case
      when v_issue='invalid_branch' and v_global and v_branch is null then true
      when v_branch is not null then d.branch = v_branch
      when v_global then true
      else d.branch = v_actor_branch
    end
  ), open_rows as (
    select * from scoped
    where completed_at is null and cancelled_at is null and archived_at is null
      and coalesce(is_hidden,false)=false and duplicate_of is null
  ), matched as (
    select o.* from open_rows o
    where case v_issue
      when 'unscheduled' then o.next_followup_date is null and o.postponed_until is null
      when 'missing_identity' then o.identity_key is null or nullif(trim(coalesce(o.customer_name,o.name,'')),'') is null
      when 'invalid_branch' then coalesce(o.branch,'') not in ('فرع الشامي','فرع شكري')
      when 'duplicate' then o.identity_key is not null and exists (
        select 1 from open_rows x where x.id <> o.id and x.identity_key=o.identity_key
          and coalesce(x.branch,'')=coalesce(o.branch,'')
          and coalesce(nullif(trim(x.request_type),''),'general')=coalesce(nullif(trim(o.request_type),''),'general')
      ) else false end
  ), limited as (
    select * from matched order by coalesce(next_followup_date, followup_date, date) asc nulls first, created_at desc nulls last limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'customer_name',coalesce(nullif(trim(customer_name),''),nullif(trim(name),''),'عميل بدون اسم'),
    'customer_code',customer_code,'customer_phone',coalesce(nullif(trim(customer_phone),''),nullif(trim(phone),'')),
    'branch',branch,'request_type',request_type,'followup_reason',followup_reason,
    'responsible_name',coalesce(nullif(trim(responsible_name),''),nullif(trim(assigned_to),'')),
    'status',coalesce(followup_status,status),'next_followup_date',next_followup_date,'created_at',created_at
  ) order by coalesce(next_followup_date, followup_date, date) asc nulls first, created_at desc nulls last),'[]'::jsonb)
  into v_rows from limited;

  return jsonb_build_object('issue',v_issue,'scope_branch',coalesce(v_branch,case when v_global then 'كل الفروع' else v_actor_branch end),
    'count',(select count(*) from matched),'rows',v_rows,'limit',v_limit,'generated_at',now());
end
$function$;

revoke all on function public.dawaa_customer_service_health_issues_v1(text,text,integer) from public;
grant execute on function public.dawaa_customer_service_health_issues_v1(text,text,integer) to anon, authenticated, service_role;
select pg_notify('pgrst','reload schema');