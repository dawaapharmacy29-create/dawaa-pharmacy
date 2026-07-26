-- Repair duplicated open customer follow-ups and incorrect branch assignment.
-- Keeps one canonical open case per real customer, archives the rest, and uses
-- customer_metrics_summary as the source of truth for the displayed branch.

create or replace function public.normalize_customer_followup_branch(value text)
returns text
language sql
immutable
as $$
  select case
    when trim(regexp_replace(regexp_replace(lower(coalesce(value, '')), '^(الفرعية|الادارة|الإدارة)\s*', '', 'g'), '^فرع\s*', '', 'g')) in ('الشامي', 'شامي') then 'فرع الشامي'
    when trim(regexp_replace(regexp_replace(lower(coalesce(value, '')), '^(الفرعية|الادارة|الإدارة)\s*', '', 'g'), '^فرع\s*', '', 'g')) in ('شكري', 'شكرى') then 'فرع شكري'
    else nullif(trim(value), '')
  end;
$$;

create or replace function public.repair_customer_followup_duplicates_and_branches()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duplicates_archived integer := 0;
  v_branches_corrected integer := 0;
begin
  if to_regclass('public.daily_followups') is null then
    return jsonb_build_object('duplicates_archived', 0, 'branches_corrected', 0, 'reason', 'daily_followups_missing');
  end if;

  -- Choose one canonical open row for each real customer. Customer code is the
  -- primary identity because old imports sometimes created different customer_id values.
  with candidates as (
    select
      df.id,
      coalesce(
        nullif(trim(df.customer_code::text), ''),
        nullif(regexp_replace(coalesce(df.customer_phone, df.phone, ''), '\D', '', 'g'), ''),
        lower(nullif(trim(coalesce(df.customer_name, df.name)), '')),
        df.id::text
      ) as customer_key,
      public.normalize_customer_followup_branch(
        coalesce(nullif(cms.branch, ''), nullif(df.customer_metrics ->> 'branch', ''), df.branch)
      ) as canonical_branch,
      row_number() over (
        partition by coalesce(
          nullif(trim(df.customer_code::text), ''),
          nullif(regexp_replace(coalesce(df.customer_phone, df.phone, ''), '\D', '', 'g'), ''),
          lower(nullif(trim(coalesce(df.customer_name, df.name)), '')),
          df.id::text
        )
        order by
          case when public.normalize_customer_followup_branch(df.branch) = public.normalize_customer_followup_branch(coalesce(cms.branch, df.customer_metrics ->> 'branch')) then 0 else 1 end,
          coalesce(df.attempt_count, 0) desc,
          coalesce(df.last_attempt_at, df.contacted_at, df.updated_at, df.created_at) desc nulls last,
          df.created_at desc nulls last,
          df.id
      ) as rn,
      first_value(df.id) over (
        partition by coalesce(
          nullif(trim(df.customer_code::text), ''),
          nullif(regexp_replace(coalesce(df.customer_phone, df.phone, ''), '\D', '', 'g'), ''),
          lower(nullif(trim(coalesce(df.customer_name, df.name)), '')),
          df.id::text
        )
        order by
          case when public.normalize_customer_followup_branch(df.branch) = public.normalize_customer_followup_branch(coalesce(cms.branch, df.customer_metrics ->> 'branch')) then 0 else 1 end,
          coalesce(df.attempt_count, 0) desc,
          coalesce(df.last_attempt_at, df.contacted_at, df.updated_at, df.created_at) desc nulls last,
          df.created_at desc nulls last,
          df.id
      ) as keeper_id
    from public.daily_followups df
    left join public.customer_metrics_summary cms
      on nullif(trim(cms.customer_code::text), '') = nullif(trim(df.customer_code::text), '')
    where coalesce(df.is_hidden, false) = false
      and df.completed_at is null
      and df.cancelled_at is null
      and df.archived_at is null
      and df.duplicate_of is null
  ), duplicates as (
    select id, keeper_id
    from candidates
    where rn > 1
  )
  update public.daily_followups df
  set
    is_duplicate = true,
    duplicate_of = d.keeper_id,
    is_hidden = true,
    archived_at = coalesce(df.archived_at, now()),
    hidden_at = coalesce(df.hidden_at, now()),
    hidden_reason = coalesce(df.hidden_reason, 'تم دمج متابعة مكررة تلقائيًا مع المتابعة الأساسية'),
    updated_at = now()
  from duplicates d
  where df.id = d.id;

  get diagnostics v_duplicates_archived = row_count;

  -- Correct only the surviving open row after duplicates are archived, avoiding
  -- collisions with the unique open-case index.
  with canonical as (
    select distinct on (df.id)
      df.id,
      public.normalize_customer_followup_branch(
        coalesce(nullif(cms.branch, ''), nullif(df.customer_metrics ->> 'branch', ''), df.branch)
      ) as canonical_branch
    from public.daily_followups df
    left join public.customer_metrics_summary cms
      on nullif(trim(cms.customer_code::text), '') = nullif(trim(df.customer_code::text), '')
    where coalesce(df.is_hidden, false) = false
      and df.completed_at is null
      and df.cancelled_at is null
      and df.archived_at is null
      and coalesce(df.is_duplicate, false) = false
      and df.duplicate_of is null
    order by df.id, cms.last_purchase desc nulls last
  )
  update public.daily_followups df
  set
    branch = c.canonical_branch,
    customer_metrics = coalesce(df.customer_metrics, '{}'::jsonb) || jsonb_build_object('branch', c.canonical_branch),
    updated_at = now()
  from canonical c
  where df.id = c.id
    and c.canonical_branch is not null
    and public.normalize_customer_followup_branch(df.branch) is distinct from c.canonical_branch;

  get diagnostics v_branches_corrected = row_count;

  return jsonb_build_object(
    'duplicates_archived', v_duplicates_archived,
    'branches_corrected', v_branches_corrected
  );
end;
$$;

grant execute on function public.repair_customer_followup_duplicates_and_branches() to authenticated;

-- Run once during migration.
select public.repair_customer_followup_duplicates_and_branches();
