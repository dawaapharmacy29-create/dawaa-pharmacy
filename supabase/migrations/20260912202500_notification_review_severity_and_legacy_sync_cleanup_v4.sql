create or replace function public.notification_presentation_priority_v1(
  p_type text,
  p_priority text,
  p_title text,
  p_message text,
  p_target_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_priority text := lower(trim(coalesce(p_priority,'normal')));
  v_text text := lower(coalesce(p_title,'') || ' ' || coalesce(p_message,''));
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_type text := public.canonical_notification_type_v2(coalesce(p_type,'system'));
  v_sla boolean := lower(coalesce(v_meta->>'slaGenerated','false'))='true';
  v_stage text := lower(coalesce(v_meta->>'slaStage',''));
  v_original_priority text := lower(coalesce(v_meta->>'originalPriority','normal'));
  v_is_digest boolean := lower(coalesce(v_meta->>'isDigest','false'))='true'
    or lower(coalesce(p_target_type,'')) in ('daily_customer_attention','vip_customer_health','vip_customer_digest','branch_operational_digest')
    or v_text like '%تقرير حركة عملاء vip%'
    or v_text like '%ملخص تشغيل الفرع%';
  v_recovery boolean := v_text like '%تمت استعادة مزامنة%'
    or v_text like '%عادت مزامنة%الحالة الطبيعية%'
    or v_text like '%تمت استعادة الاتصال%';
  v_score numeric;
  v_points numeric;
  v_critical boolean := false;
begin
  if v_sla then
    if v_stage='resolution' and v_original_priority in ('urgent','critical') then return 'urgent'; end if;
    return 'normal';
  end if;
  if v_recovery then return 'low'; end if;
  if v_is_digest then return 'normal'; end if;

  if v_type='conversation_review' then
    begin v_score := nullif(v_meta->>'score','')::numeric; exception when others then v_score := null; end;
    begin
      v_points := coalesce(
        nullif(v_meta->>'pointsImpact','')::numeric,
        nullif(v_meta->>'points_impact','')::numeric
      );
    exception when others then v_points := null; end;
    v_critical := lower(coalesce(v_meta->>'hasCriticalError',v_meta->>'has_critical_error',v_meta->>'critical','false'))='true';

    if v_critical or (v_score is not null and v_score < 70) then return 'urgent'; end if;
    if (v_score is not null and v_score < 90) or coalesce(v_points,0) < 0 then return 'high'; end if;
    if v_score is not null and v_score >= 90 and coalesce(v_points,0) >= 0 then return 'normal'; end if;
  end if;

  if v_priority not in ('low','normal','high','urgent','critical') then return 'normal'; end if;
  return v_priority;
end;
$$;

update public.notifications n
set archived_at = coalesce(n.archived_at, now())
where n.archived_at is null
  and lower(coalesce(n.type,n.notification_type,''))='sync_health_alert'
  and coalesce(n.metadata,'{}'::jsonb)='{}'::jsonb
  and (
    (lower(coalesce(n.title,'')) like '%البصمة%'
      and exists (
        select 1 from public.notifications nx
        where nx.created_at > n.created_at
          and lower(coalesce(nx.metadata->>'syncName',nx.metadata->>'sync_name',''))='biometrics'
      ))
    or
    (lower(coalesce(n.title,'')) like '%طلبات العملاء%'
      and exists (
        select 1 from public.notifications nx
        where nx.created_at > n.created_at
          and lower(coalesce(nx.metadata->>'syncName',nx.metadata->>'sync_name',''))='customer_orders'
      ))
  );
