-- Repo-only. NOT APPLIED. Do not apply to a live database without a separate activation review.
-- Forward-only: no earlier migration is edited.
--
-- One branch contract for follow-ups that come from a WhatsApp conversation:
--   A follow-up with conversation lineage (the existing dawaa_followup_has_conversation_lineage_v1
--   relation: action target, original whatsapp-action client key, or created/request_linked event)
--   takes its branch from the conversation source (whatsapp_review_sources.branch). Its branch may
--   only be set to that single source branch. Every other branch change is refused, by every writer.
--
-- Enforcement:
--   * one predicate:  dawaa_followup_branch_change_allowed_v1(followup_id, new_branch)
--   * one backstop:   zzz_* BEFORE UPDATE triggers on daily_followups and linked queue items
--   * the three legacy writers (transfer, correction, repair) and the duplicate merge wrapper skip
--     or refuse conversation follow-ups explicitly instead of failing on the backstop by accident;
--   * the transfer wrapper answers a same-branch request as a no-op, so a retry is idempotent.
--
-- Depends on: 20261005131000 (bound wrappers, *_legacy_v1 bodies) and 20261009103000 (lineage).
--
-- Not changed: identity keys, action rows, target_table/target_id, sale/follow-up proof, lineage,
-- customer attribution, the unique open-case index, and manual (non-conversation) follow-up behavior.
begin;

do $guard$
begin
  if to_regprocedure('public.dawaa_followup_has_conversation_lineage_v1(text)') is null
     or to_regprocedure('public.dawaa_customer_request_branch_key(text)') is null
     or to_regprocedure('public.dawaa_current_followup_actor_v2(text)') is null
     or to_regprocedure('public.transfer_customer_followup_branch_legacy_v1(text,text,text,text,text)') is null
     or to_regprocedure('public.correct_customer_followup_data_legacy_v1(text,text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.merge_open_followup_duplicates_legacy_v1(text,text[],text,text,text)') is null
     or to_regprocedure('public.repair_customer_followup_duplicates_and_branches()') is null
     or to_regprocedure('public.normalize_customer_followup_branch(text)') is null then
    raise exception 'followup_branch_provenance_prerequisites_missing';
  end if;
end;
$guard$;

-- -----------------------------------------------------------------------------
-- Lineage: one definition. The existing predicate now delegates to the source relation,
-- with exactly the same three paths and the same "source must exist" rule.
-- -----------------------------------------------------------------------------
create or replace function public.dawaa_followup_conversation_sources_v1(p_followup_id text)
returns table(source_id uuid, source_branch text)
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select distinct s.id, s.branch
  from (
    select a.source_id
    from public.whatsapp_conversation_actions a
    where a.target_table = 'daily_followups' and a.target_id = p_followup_id
    union all
    select a.source_id
    from public.daily_followups f
    join public.whatsapp_conversation_actions a on a.id = case
      when f.client_request_id ~ '^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(f.client_request_id from 17)::uuid else null end
    where f.id = p_followup_id
    union all
    select a.source_id
    from public.customer_service_followup_events e
    join public.whatsapp_conversation_actions a on a.id = case
      when e.metadata->>'client_request_id' ~ '^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(e.metadata->>'client_request_id' from 17)::uuid else null end
    where e.followup_id = p_followup_id and e.event_type in ('created', 'request_linked')
  ) lineage
  join public.whatsapp_review_sources s on s.id = lineage.source_id;
$function$;
revoke all on function public.dawaa_followup_conversation_sources_v1(text) from public, anon, authenticated;
grant execute on function public.dawaa_followup_conversation_sources_v1(text) to service_role;

create or replace function public.dawaa_followup_has_conversation_lineage_v1(p_followup_id text)
returns boolean
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (select 1 from public.dawaa_followup_conversation_sources_v1(p_followup_id));
$function$;
revoke all on function public.dawaa_followup_has_conversation_lineage_v1(text) from public, anon, authenticated;
grant execute on function public.dawaa_followup_has_conversation_lineage_v1(text) to service_role;

-- The single branch rule. Manual follow-ups: any branch. Conversation follow-ups: only their one
-- known source branch. Unknown, blank or conflicting source branches allow no change (fail closed).
create or replace function public.dawaa_followup_branch_change_allowed_v1(p_followup_id text, p_new_branch text)
returns boolean
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  with source_keys as (
    select distinct public.dawaa_customer_request_branch_key(source_branch) as branch_key
    from public.dawaa_followup_conversation_sources_v1(p_followup_id)
  )
  select case
    when not exists (select 1 from source_keys) then true
    when (select count(*) from source_keys) <> 1 then false
    else coalesce(
      (select branch_key from source_keys) = public.dawaa_customer_request_branch_key(p_new_branch),
      false)
  end;
$function$;
revoke all on function public.dawaa_followup_branch_change_allowed_v1(text, text) from public, anon, authenticated;
grant execute on function public.dawaa_followup_branch_change_allowed_v1(text, text) to service_role;

-- Backstop for every writer, including ones whose bodies live only in Production.
-- SECURITY DEFINER so that RLS can never hide lineage from the check. VOLATILE (default) so the
-- check takes a fresh snapshot and sees lineage committed after the writing statement began.
create or replace function public.dawaa_guard_followup_conversation_branch_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_followup_id text := nullif(btrim(to_jsonb(old) ->> tg_argv[0]), '');
begin
  if v_followup_id is null
     or public.dawaa_customer_request_branch_key(new.branch)
        is not distinct from public.dawaa_customer_request_branch_key(old.branch) then
    return new;
  end if;
  if not public.dawaa_followup_branch_change_allowed_v1(v_followup_id, new.branch) then
    raise exception 'conversation_followup_branch_is_source_owned'
      using errcode = '42501',
            detail = format('followup %s: %s -> %s', v_followup_id, coalesce(old.branch, '∅'), coalesce(new.branch, '∅')),
            hint = 'فرع متابعة المحادثة يتبع فرع مصدر المحادثة ولا يتغير من مسار جانبي';
  end if;
  return new;
end;
$function$;
revoke all on function public.dawaa_guard_followup_conversation_branch_v1() from public, anon, authenticated;
grant execute on function public.dawaa_guard_followup_conversation_branch_v1() to service_role;

-- zzz_: BEFORE triggers fire alphabetically, so this sees the branch any earlier trigger produced.
drop trigger if exists zzz_daily_followups_conversation_branch_guard_v1 on public.daily_followups;
create trigger zzz_daily_followups_conversation_branch_guard_v1
before update on public.daily_followups
for each row
when (old.branch is distinct from new.branch)
execute function public.dawaa_guard_followup_conversation_branch_v1('id');

drop trigger if exists zzz_queue_items_conversation_branch_guard_v1 on public.customer_service_daily_queue_items;
create trigger zzz_queue_items_conversation_branch_guard_v1
before update on public.customer_service_daily_queue_items
for each row
when (old.branch is distinct from new.branch and old.linked_followup_id is not null)
execute function public.dawaa_guard_followup_conversation_branch_v1('linked_followup_id');

-- -----------------------------------------------------------------------------
-- transfer_customer_followup_branch_legacy_v1 (service-only body behind the bound wrapper).
--   * same-branch request is an idempotent no-op (a retry after a lost response does not fail);
--   * a conversation follow-up is never moved as a customer transfer; the only accepted change is
--     a realignment to its own source branch, on that row and its linked queue items only;
--   * a manual transfer leaves the customer's conversation follow-ups where their source put them.
-- -----------------------------------------------------------------------------
create or replace function public.transfer_customer_followup_branch_legacy_v1(
  p_followup_id text,
  p_target_branch text,
  p_actor_staff_id text default null,
  p_actor_name text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_row public.daily_followups%rowtype;
  v_source_branch text;
  v_target_branch text;
  v_followups_updated integer := 0;
  v_queue_updated integer := 0;
  v_preserved integer := 0;
  v_override_id uuid;
  v_code text;
  v_phone text;
  v_customer_id text;
  v_actor text := nullif(trim(coalesce(p_actor_staff_id, '')), '');
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
begin
  select * into v_row
  from public.daily_followups
  where id::text = trim(p_followup_id)
  limit 1
  for update;

  if not found then
    raise exception 'المتابعة غير موجودة';
  end if;

  v_target_branch := case
    when trim(coalesce(p_target_branch, '')) in ('فرع الشامي', 'الشامي') then 'فرع الشامي'
    when trim(coalesce(p_target_branch, '')) in ('فرع شكري', 'شكري') then 'فرع شكري'
    else null
  end;
  if v_target_branch is null then
    raise exception 'الفرع المطلوب غير صحيح';
  end if;

  v_source_branch := coalesce(nullif(trim(v_row.branch), ''), 'غير محدد');
  if v_source_branch = v_target_branch then
    return jsonb_build_object(
      'ok', true, 'noop', true, 'already_in_target_branch', true,
      'from_branch', v_source_branch, 'to_branch', v_target_branch,
      'followups_updated', 0, 'queue_items_updated', 0, 'override_id', null
    );
  end if;

  if public.dawaa_followup_has_conversation_lineage_v1(v_row.id::text) then
    if not public.dawaa_followup_branch_change_allowed_v1(v_row.id::text, v_target_branch) then
      raise exception 'conversation_followup_branch_is_source_owned'
        using errcode = '42501',
              hint = 'فرع متابعة المحادثة يتبع فرع مصدر المحادثة ولا يتغير من مسار جانبي';
    end if;

    update public.daily_followups
    set branch = v_target_branch, updated_at = now(), updated_by = v_actor
    where id = v_row.id;
    get diagnostics v_followups_updated = row_count;

    update public.customer_service_daily_queue_items q
    set branch = v_target_branch,
        updated_at = now(),
        metadata = coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object(
          'branchRealignedToSourceAt', now(),
          'branchTransferredBy', v_actor_name,
          'previousBranch', v_source_branch,
          'targetBranch', v_target_branch
        )
    where q.completed_at is null
      and q.linked_followup_id::text = v_row.id::text;
    get diagnostics v_queue_updated = row_count;

    insert into public.customer_followup_audit_log(
      followup_id, customer_id, action, actor_staff_id, actor_name, branch, metadata
    ) values (
      v_row.id::text, nullif(trim(v_row.customer_id), ''), 'branch_realigned_to_source',
      v_actor, v_actor_name, v_target_branch,
      jsonb_build_object(
        'from_branch', v_source_branch,
        'to_branch', v_target_branch,
        'reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'إرجاع المتابعة لفرع مصدر المحادثة'),
        'conversation_lineage', true,
        'followups_updated', v_followups_updated,
        'queue_items_updated', v_queue_updated
      )
    );

    return jsonb_build_object(
      'ok', true, 'realigned_to_source', true,
      'from_branch', v_source_branch, 'to_branch', v_target_branch,
      'followups_updated', v_followups_updated, 'queue_items_updated', v_queue_updated,
      'override_id', null
    );
  end if;

  v_code := nullif(trim(v_row.customer_code), '');
  v_phone := nullif(regexp_replace(coalesce(v_row.customer_phone, v_row.phone, ''), '\D', '', 'g'), '');
  v_customer_id := nullif(trim(v_row.customer_id), '');

  select count(*) into v_preserved
  from public.daily_followups f
  where coalesce(f.is_hidden, false) = false
    and f.completed_at is null
    and f.id::text <> v_row.id::text
    and (
      (v_code is not null and trim(coalesce(f.customer_code, '')) = v_code)
      or (v_customer_id is not null and trim(coalesce(f.customer_id, '')) = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(f.customer_phone, f.phone, ''), '\D', '', 'g') = v_phone)
    )
    and public.dawaa_followup_has_conversation_lineage_v1(f.id::text);

  update public.daily_followups f
  set branch = v_target_branch,
      updated_at = now(),
      updated_by = v_actor
  where coalesce(f.is_hidden, false) = false
    and f.completed_at is null
    and (
      f.id::text = v_row.id::text
      or (v_code is not null and trim(coalesce(f.customer_code, '')) = v_code)
      or (v_customer_id is not null and trim(coalesce(f.customer_id, '')) = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(f.customer_phone, f.phone, ''), '\D', '', 'g') = v_phone)
    )
    and not public.dawaa_followup_has_conversation_lineage_v1(f.id::text);
  get diagnostics v_followups_updated = row_count;

  update public.customer_service_daily_queue_items q
  set branch = v_target_branch,
      updated_at = now(),
      metadata = coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object(
        'branchTransferredAt', now(),
        'branchTransferredBy', v_actor_name,
        'previousBranch', v_source_branch,
        'targetBranch', v_target_branch
      )
  where q.completed_at is null
    and (
      q.linked_followup_id::text = v_row.id::text
      or (v_code is not null and trim(coalesce(q.customer_code, '')) = v_code)
      or (v_customer_id is not null and trim(coalesce(q.customer_id, '')) = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g') = v_phone)
    )
    and (q.linked_followup_id is null
         or not public.dawaa_followup_has_conversation_lineage_v1(q.linked_followup_id::text));
  get diagnostics v_queue_updated = row_count;

  update public.customer_branch_overrides
  set active = false
  where active = true
    and (
      (v_code is not null and customer_code = v_code)
      or (v_customer_id is not null and customer_id = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g') = v_phone)
    );

  insert into public.customer_branch_overrides(
    customer_code, customer_id, customer_phone, customer_name,
    old_branch, new_branch, suggested_branch, reason,
    created_by, created_by_name, active
  ) values (
    v_code, v_customer_id, v_phone,
    coalesce(v_row.customer_name, v_row.name),
    v_source_branch, v_target_branch, v_target_branch,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'تحويل يدوي من صفحة متابعة العملاء'),
    v_actor, v_actor_name, true
  ) returning id into v_override_id;

  insert into public.customer_followup_audit_log(
    followup_id, customer_id, action, actor_staff_id, actor_name, branch, metadata
  ) values (
    v_row.id::text, v_customer_id, 'branch_transferred', v_actor, v_actor_name, v_target_branch,
    jsonb_build_object(
      'from_branch', v_source_branch,
      'to_branch', v_target_branch,
      'reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'تحويل يدوي'),
      'followups_updated', v_followups_updated,
      'queue_items_updated', v_queue_updated,
      'conversation_followups_preserved', v_preserved,
      'override_id', v_override_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'from_branch', v_source_branch,
    'to_branch', v_target_branch,
    'followups_updated', v_followups_updated,
    'queue_items_updated', v_queue_updated,
    'conversation_followups_preserved', v_preserved,
    'override_id', v_override_id
  );
end;
$function$;

-- -----------------------------------------------------------------------------
-- correct_customer_followup_data_legacy_v1: customer data correction never moves a conversation
-- follow-up. An explicit branch request on a conversation follow-up that is not its source branch
-- is refused (no silent partial correction); conversation siblings keep their branch.
-- -----------------------------------------------------------------------------
create or replace function public.correct_customer_followup_data_legacy_v1(
  p_followup_id text,
  p_customer_name text,
  p_customer_code text,
  p_customer_phone text,
  p_branch text,
  p_actor_staff_id text,
  p_actor_name text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_staff record;
  v_row public.daily_followups%rowtype;
  v_phone text;
  v_branch text := nullif(trim(p_branch), '');
  v_updated_followups integer := 0;
  v_updated_customers integer := 0;
  v_preserved integer := 0;
begin
  select * into v_staff
  from public.resolve_staff_account_safe(p_actor_staff_id)
  limit 1;

  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;
  if coalesce(v_staff.role, '') not in (
    'customer_service', 'customer_service_manager', 'general_manager', 'branch_manager', 'branches_manager', 'admin'
  ) then
    raise exception 'customer_correction_permission_denied';
  end if;

  select * into v_row
  from public.daily_followups
  where id::text = p_followup_id
  limit 1
  for update;

  if v_row.id is null then
    raise exception 'followup_not_found';
  end if;

  if v_branch is not null
     and public.dawaa_customer_request_branch_key(v_branch)
         is distinct from public.dawaa_customer_request_branch_key(v_row.branch)
     and not public.dawaa_followup_branch_change_allowed_v1(v_row.id::text, v_branch) then
    raise exception 'conversation_followup_branch_is_source_owned'
      using errcode = '42501',
            hint = 'فرع متابعة المحادثة يتبع فرع مصدر المحادثة ولا يتغير من تصحيح بيانات العميل';
  end if;

  v_phone := public.dawaa_normalize_egyptian_mobile_v1(
    coalesce(p_customer_phone, v_row.customer_phone, v_row.phone)
  );

  if v_branch is not null and v_row.customer_id is not null then
    select count(*) into v_preserved
    from public.daily_followups
    where id <> v_row.id
      and customer_id = v_row.customer_id
      and completed_at is null
      and cancelled_at is null
      and archived_at is null
      and public.dawaa_customer_request_branch_key(branch)
          is distinct from public.dawaa_customer_request_branch_key(v_branch)
      and not public.dawaa_followup_branch_change_allowed_v1(id::text, v_branch);
  end if;

  update public.daily_followups
  set customer_name = coalesce(nullif(trim(p_customer_name), ''), customer_name),
      name = coalesce(nullif(trim(p_customer_name), ''), name),
      customer_code = coalesce(nullif(trim(p_customer_code), ''), customer_code),
      customer_phone = coalesce(nullif(trim(v_phone), ''), customer_phone),
      phone = coalesce(nullif(trim(v_phone), ''), phone),
      branch = case
        when v_branch is null then branch
        when public.dawaa_customer_request_branch_key(branch)
             is not distinct from public.dawaa_customer_request_branch_key(v_branch) then branch
        when public.dawaa_followup_branch_change_allowed_v1(id::text, v_branch) then v_branch
        else branch
      end,
      data_quality_status = 'reviewed',
      data_issues = '{}'::text[],
      updated_by = p_actor_staff_id,
      updated_at = now()
  where id = v_row.id
     or (
       v_row.customer_id is not null
       and customer_id = v_row.customer_id
       and completed_at is null
       and cancelled_at is null
       and archived_at is null
     );
  get diagnostics v_updated_followups = row_count;

  if v_row.customer_id is not null then
    update public.customers
    set name = coalesce(nullif(trim(p_customer_name), ''), name),
        customer_code = coalesce(nullif(trim(p_customer_code), ''), customer_code),
        phone = coalesce(nullif(trim(v_phone), ''), phone),
        mobile = coalesce(nullif(trim(v_phone), ''), mobile),
        branch = coalesce(v_branch, branch)
    where id::text = v_row.customer_id::text;
    get diagnostics v_updated_customers = row_count;
  end if;

  insert into public.customer_service_followup_events(
    followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
  ) values (
    v_row.id::text,
    'customer_data_corrected',
    'open',
    p_actor_staff_id,
    p_actor_name,
    p_note,
    jsonb_build_object(
      'name', p_customer_name,
      'code', p_customer_code,
      'phone', v_phone,
      'branch', p_branch,
      'conversation_followups_branch_preserved', v_preserved
    )
  );

  return jsonb_build_object(
    'followups_updated', v_updated_followups,
    'customers_updated', v_updated_customers,
    'conversation_followups_branch_preserved', v_preserved
  );
end;
$function$;

-- -----------------------------------------------------------------------------
-- repair_customer_followup_duplicates_and_branches (service-only maintenance, no app caller).
-- Conversation follow-ups are neither archived as duplicates, nor chosen as keepers, nor
-- re-branched from customer metrics. Manual follow-up behavior is unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.repair_customer_followup_duplicates_and_branches()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_duplicates_archived integer := 0;
  v_branches_corrected integer := 0;
begin
  if to_regclass('public.daily_followups') is null then
    return jsonb_build_object('duplicates_archived', 0, 'branches_corrected', 0, 'reason', 'daily_followups_missing');
  end if;

  with candidates as (
    select
      df.id,
      row_number() over w as rn,
      first_value(df.id) over w as keeper_id
    from public.daily_followups df
    left join public.customer_metrics_summary cms
      on nullif(trim(cms.customer_code::text), '') = nullif(trim(df.customer_code::text), '')
    where coalesce(df.is_hidden, false) = false
      and df.completed_at is null
      and df.cancelled_at is null
      and df.archived_at is null
      and df.duplicate_of is null
      and not public.dawaa_followup_has_conversation_lineage_v1(df.id::text)
    window w as (
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
    )
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
      and not public.dawaa_followup_has_conversation_lineage_v1(df.id::text)
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
$function$;
revoke all on function public.repair_customer_followup_duplicates_and_branches() from public, anon, authenticated;
grant execute on function public.repair_customer_followup_duplicates_and_branches() to service_role;

-- -----------------------------------------------------------------------------
-- merge_open_followup_duplicates_v1 (bound wrapper from 20261005131000, unchanged except one rule):
-- a conversation follow-up may survive a merge as the canonical row, but is never hidden as a
-- "duplicate" of another row. Two conversation operations are therefore never merged.
-- -----------------------------------------------------------------------------
create or replace function public.merge_open_followup_duplicates_v1(
  p_canonical_id text,
  p_duplicate_ids text[],
  p_actor_staff_id text,
  p_actor_name text,
  p_reason text default 'دمج يدوي بعد المراجعة'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_branch text;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_staff_id) limit 1;
  if v_actor.role not in ('customer_service_manager','general_manager','executive_manager','branch_manager','branches_manager','admin','owner') then
    raise exception 'duplicate_merge_permission_denied' using errcode='42501';
  end if;

  select branch into v_branch from public.daily_followups where id::text=trim(p_canonical_id) limit 1;
  if v_branch is null then raise exception 'canonical_open_followup_not_found'; end if;
  if v_actor.role not in ('general_manager','executive_manager','branches_manager','admin','owner')
     and public.dawaa_customer_request_branch_key(v_branch)
         is distinct from public.dawaa_customer_request_branch_key(v_actor.branch) then
    raise exception 'followup_branch_scope_denied' using errcode='42501';
  end if;

  if exists (
    select 1 from public.daily_followups d
    where d.id::text=any(coalesce(p_duplicate_ids,'{}'::text[]))
      and public.dawaa_customer_request_branch_key(d.branch)
          is distinct from public.dawaa_customer_request_branch_key(v_branch)
  ) then
    raise exception 'cross_branch_duplicate_merge_denied' using errcode='42501';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_duplicate_ids,'{}'::text[])) as d(id)
    where trim(d.id) <> trim(p_canonical_id)
      and public.dawaa_followup_has_conversation_lineage_v1(trim(d.id))
  ) then
    raise exception 'conversation_followup_cannot_be_merged_away' using errcode='42501';
  end if;

  return public.merge_open_followup_duplicates_legacy_v1(
    p_canonical_id,p_duplicate_ids,v_actor.account_id::text,v_actor.actor_name,p_reason
  );
end;
$function$;
revoke all on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text) from public;
grant execute on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text)
  to anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- transfer_customer_followup_branch_v1 (bound wrapper from 20261005131000). One change: a request
-- for the branch the row is already in is a no-op answered before the branch-scope check, so a
-- branch-scoped actor's retry after a lost response does not fail. It writes nothing.
-- -----------------------------------------------------------------------------
create or replace function public.transfer_customer_followup_branch_v1(
  p_followup_id text,
  p_target_branch text,
  p_actor_staff_id text default null,
  p_actor_name text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_source_branch text;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_staff_id) limit 1;
  if v_actor.role not in (
    'customer_service','customer_service_manager','pharmacist',
    'shift_supervisor_morning','shift_supervisor_evening','shift_supervisor_night',
    'branch_manager','general_manager','executive_manager','branches_manager','admin','owner'
  ) then
    raise exception 'followup_transfer_permission_denied' using errcode='42501';
  end if;

  select branch into v_source_branch from public.daily_followups where id::text=trim(p_followup_id) limit 1;
  if v_source_branch is null then raise exception 'followup_not_found'; end if;

  if public.dawaa_customer_request_branch_key(v_source_branch)
     = public.dawaa_customer_request_branch_key(p_target_branch) then
    return jsonb_build_object(
      'ok', true, 'noop', true, 'already_in_target_branch', true,
      'from_branch', v_source_branch, 'to_branch', v_source_branch,
      'followups_updated', 0, 'queue_items_updated', 0, 'override_id', null
    );
  end if;

  if v_actor.role not in ('general_manager','executive_manager','branches_manager','admin','owner')
     and public.dawaa_customer_request_branch_key(v_source_branch)
         is distinct from public.dawaa_customer_request_branch_key(v_actor.branch) then
    raise exception 'followup_branch_scope_denied' using errcode='42501';
  end if;

  return public.transfer_customer_followup_branch_legacy_v1(
    p_followup_id,p_target_branch,v_actor.account_id::text,v_actor.actor_name,p_reason
  );
end;
$function$;
revoke all on function public.transfer_customer_followup_branch_v1(text,text,text,text,text) from public;
grant execute on function public.transfer_customer_followup_branch_v1(text,text,text,text,text)
  to anon,authenticated,service_role;

comment on function public.dawaa_followup_branch_change_allowed_v1(text, text) is
  'The single follow-up branch rule: manual follow-ups any branch; conversation follow-ups only their single source branch.';
comment on function public.dawaa_guard_followup_conversation_branch_v1() is
  'Backstop: refuses a branch change on a conversation follow-up (or its linked queue item) that is not its source branch.';

commit;
