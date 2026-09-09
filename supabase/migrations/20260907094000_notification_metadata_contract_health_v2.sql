-- Contract health distinguishes historical unversioned data from new v2 producer violations.

create or replace view public.notification_metadata_contract_audit_v2
with (security_invoker = true)
as
with base as (
  select
    n.*,
    coalesce(n.metadata,n.details,'{}'::jsonb) as stored_metadata,
    public.normalize_notification_metadata_v2(
      coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system'),
      coalesce(n.metadata,n.details,'{}'::jsonb),
      coalesce(nullif(n.action_url,''),nullif(n.target_route,''),nullif(n.route,''),nullif(n.link,'')),
      n.branch,
      coalesce(nullif(n.recipient_staff_id,''),nullif(n.staff_id,''))
    ) as normalized_metadata,
    coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system') as raw_type,
    public.canonical_notification_type_v2(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system')) as canonical_type
  from public.notifications n
), audited as (
  select
    b.*,
    case
      when b.canonical_type='conversation_review' then array_remove(array[
        case when nullif(trim(coalesce(b.normalized_metadata->>'reviewId','')),'') is null then 'reviewId' end,
        case when not (b.normalized_metadata ? 'score') then 'score' end,
        case when nullif(trim(coalesce(b.normalized_metadata->>'staffName','')),'') is null then 'staffName' end
      ],null)
      when b.canonical_type='staff_task' then array_remove(array[
        case when nullif(trim(coalesce(b.normalized_metadata->>'taskTitle','')),'') is null then 'taskTitle' end,
        case when nullif(trim(coalesce(b.normalized_metadata->>'taskState','')),'') is null then 'taskState' end
      ],null)
      when b.canonical_type='vip_customer_silence' and b.raw_type <> 'daily_customer_attention_digest' then array_remove(array[
        case when nullif(trim(coalesce(b.normalized_metadata->>'customerCode','')),'') is null then 'customerCode' end
      ],null)
      when b.raw_type in ('sync_health','sync_health_alert') then array_remove(array[
        case when nullif(trim(coalesce(b.normalized_metadata->>'syncName','')),'') is null then 'syncName' end,
        case when nullif(trim(coalesce(b.normalized_metadata->>'severity','')),'') is null
                   and nullif(trim(coalesce(b.normalized_metadata->>'resolved_at',b.normalized_metadata->>'resolvedAt','')),'') is null
             then 'severity' end
      ],null)
      else array[]::text[]
    end as missing_keys
  from base b
)
select
  id,
  created_at,
  raw_type,
  canonical_type,
  missing_keys,
  normalized_metadata as metadata,
  case
    when coalesce(stored_metadata->>'schemaVersion','') <> '2' then 'legacy_unversioned'
    when cardinality(missing_keys)>0 then 'v2_invalid'
    else 'v2_valid'
  end as contract_state
from audited;

grant select on public.notification_metadata_contract_audit_v2 to authenticated;

create or replace function public.notification_metadata_contract_health_v2(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with scoped as (
    select *
    from public.notification_metadata_contract_audit_v2
    where created_at >= now() - make_interval(hours => greatest(1,least(coalesce(p_hours,24),720)))
  )
  select jsonb_build_object(
    'windowHours', greatest(1,least(coalesce(p_hours,24),720)),
    'total', count(*),
    'validV2', count(*) filter (where contract_state='v2_valid'),
    'invalidV2', count(*) filter (where contract_state='v2_invalid'),
    'legacyUnversioned', count(*) filter (where contract_state='legacy_unversioned'),
    'invalidByType', coalesce((
      select jsonb_object_agg(canonical_type,n)
      from (
        select canonical_type,count(*) n
        from scoped
        where contract_state='v2_invalid'
        group by canonical_type
      ) q
    ),'{}'::jsonb),
    'checkedAt', now()
  )
  from scoped;
$$;

revoke all on function public.notification_metadata_contract_health_v2(integer) from public, anon;
grant execute on function public.notification_metadata_contract_health_v2(integer) to authenticated, service_role;
