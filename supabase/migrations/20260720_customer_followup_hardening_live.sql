begin;

alter table if exists public.daily_followups
  add column if not exists identity_key text,
  add column if not exists canonical_followup_id uuid,
  add column if not exists duplicate_of uuid,
  add column if not exists data_quality_status text,
  add column if not exists data_issues text[] default '{}'::text[],
  add column if not exists requested_by_staff_id uuid,
  add column if not exists request_source text,
  add column if not exists open_case boolean default true;

create or replace function public.normalize_egyptian_mobile(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when regexp_replace(coalesce(p_value, ''), '\D', '', 'g') like '0020%'
      then substring(regexp_replace(coalesce(p_value, ''), '\D', '', 'g') from 5)
    when regexp_replace(coalesce(p_value, ''), '\D', '', 'g') like '20%'
      then substring(regexp_replace(coalesce(p_value, ''), '\D', '', 'g') from 3)
    when length(regexp_replace(coalesce(p_value, ''), '\D', '', 'g')) = 10
      and regexp_replace(coalesce(p_value, ''), '\D', '', 'g') like '1%'
      then '0' || regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
    else regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
  end;
$$;

create or replace function public.customer_followup_identity(
  p_customer_id uuid,
  p_customer_code text,
  p_phone text,
  p_name text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_customer_id is not null then 'id:' || p_customer_id::text
    when nullif(trim(coalesce(p_customer_code, '')), '') is not null
      then 'code:' || trim(p_customer_code)
    when public.normalize_egyptian_mobile(p_phone) ~ '^(010|011|012|015)[0-9]{8}$'
      then 'phone:' || public.normalize_egyptian_mobile(p_phone)
    when nullif(trim(coalesce(p_name, '')), '') is not null
      then 'name:' || lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'))
    else null
  end;
$$;

create or replace function public.daily_followups_harden_before_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(new.status, new.followup_status, 'open')));
  v_result text := trim(coalesce(new.followup_result, new.contact_result, ''));
  v_existing uuid;
  v_phone text;
  v_issues text[] := '{}'::text[];
begin
  v_phone := public.normalize_egyptian_mobile(coalesce(new.customer_phone, new.phone));
  new.customer_phone := nullif(v_phone, '');
  new.phone := coalesce(new.phone, new.customer_phone);
  new.identity_key := public.customer_followup_identity(
    new.customer_id,
    new.customer_code,
    coalesce(new.customer_phone, new.phone),
    coalesce(new.customer_name, new.name)
  );

  new.open_case := not (
    v_status in ('completed', 'closed', 'cancelled', 'archived', 'merged_duplicate', 'تم')
    or new.completed_at is not null
    or new.cancelled_at is not null
    or coalesce(new.is_hidden, false)
  );

  if new.open_case and coalesce(v_phone, '') !~ '^(010|011|012|015)[0-9]{8}$' then
    v_issues := array_append(v_issues, 'رقم الهاتف غير صالح أو مفقود');
  end if;
  if new.open_case and nullif(trim(coalesce(new.next_followup_date::text, new.followup_datetime::text, new.followup_date::text)), '') is null then
    new.next_followup_date := (current_date + 1)::timestamptz;
    v_issues := array_append(v_issues, 'تم تعيين موعد تلقائي لعدم وجود موعد');
  end if;
  if new.open_case and (new.branch is null or trim(new.branch) = '' or new.branch in ('غير محدد', 'متعدد الفروع')) then
    v_issues := array_append(v_issues, 'الفرع يحتاج مراجعة');
  end if;
  if new.open_case and (new.created_by_name is null or trim(new.created_by_name) = '') then
    v_issues := array_append(v_issues, 'مقدم الطلب غير محدد');
  end if;
  if (not new.open_case) and v_status in ('completed', 'closed', 'تم') and v_result = '' then
    raise exception 'لا يمكن إغلاق المتابعة بدون نتيجة رسمية واضحة';
  end if;

  if new.open_case and new.identity_key is not null then
    select id into v_existing
    from public.daily_followups
    where id is distinct from new.id
      and coalesce(open_case, true)
      and not coalesce(is_hidden, false)
      and identity_key = new.identity_key
      and coalesce(branch, '') = coalesce(new.branch, '')
    order by created_at asc nulls last, id
    limit 1;

    if v_existing is not null then
      new.duplicate_of := v_existing;
      new.canonical_followup_id := v_existing;
      new.is_hidden := true;
      new.hidden_at := coalesce(new.hidden_at, now());
      new.hidden_reason := coalesce(new.hidden_reason, 'linked_duplicate_open_followup');
      new.open_case := false;
      new.status := 'merged_duplicate';
      new.followup_status := 'merged_duplicate';
      v_issues := array_append(v_issues, 'تم ربط الطلب بمتابعة مفتوحة موجودة');
    else
      new.canonical_followup_id := coalesce(new.canonical_followup_id, new.id);
    end if;
  end if;

  new.data_issues := coalesce(new.data_issues, '{}'::text[]) || v_issues;
  new.data_quality_status := case
    when cardinality(new.data_issues) = 0 then 'complete'
    when exists(select 1 from unnest(new.data_issues) issue where issue like '%غير صالح%' or issue like '%بدون نتيجة%') then 'critical'
    else 'warning'
  end;
  return new;
end;
$$;

drop trigger if exists trg_daily_followups_harden_before_write on public.daily_followups;
create trigger trg_daily_followups_harden_before_write
before insert or update on public.daily_followups
for each row execute function public.daily_followups_harden_before_write();

with ranked as (
  select id,
         first_value(id) over (
           partition by public.customer_followup_identity(customer_id, customer_code, coalesce(customer_phone, phone), coalesce(customer_name, name)), coalesce(branch, '')
           order by created_at asc nulls last, id
         ) as canonical_id,
         row_number() over (
           partition by public.customer_followup_identity(customer_id, customer_code, coalesce(customer_phone, phone), coalesce(customer_name, name)), coalesce(branch, '')
           order by created_at asc nulls last, id
         ) as rn
  from public.daily_followups
  where coalesce(is_hidden, false) = false
    and lower(trim(coalesce(status, followup_status, 'open'))) not in ('completed','closed','cancelled','archived','merged_duplicate','تم')
    and completed_at is null
    and cancelled_at is null
), merged as (
  update public.daily_followups d
  set duplicate_of = r.canonical_id,
      canonical_followup_id = r.canonical_id,
      is_hidden = true,
      hidden_at = coalesce(d.hidden_at, now()),
      hidden_reason = coalesce(d.hidden_reason, 'cleanup_duplicate_open_followup'),
      status = 'merged_duplicate',
      followup_status = 'merged_duplicate',
      open_case = false,
      updated_at = now()
  from ranked r
  where d.id = r.id and r.rn > 1
  returning d.id
)
update public.daily_followups d
set identity_key = public.customer_followup_identity(d.customer_id, d.customer_code, coalesce(d.customer_phone, d.phone), coalesce(d.customer_name, d.name)),
    canonical_followup_id = coalesce(d.canonical_followup_id, d.id),
    open_case = case
      when lower(trim(coalesce(d.status, d.followup_status, 'open'))) in ('completed','closed','cancelled','archived','merged_duplicate','تم')
        or d.completed_at is not null or d.cancelled_at is not null or coalesce(d.is_hidden, false)
      then false else true end,
    next_followup_date = case
      when lower(trim(coalesce(d.status, d.followup_status, 'open'))) not in ('completed','closed','cancelled','archived','merged_duplicate','تم')
        and d.completed_at is null and d.cancelled_at is null and not coalesce(d.is_hidden, false)
        and d.next_followup_date is null
      then (current_date + 1 + (abs(hashtext(coalesce(d.id::text, ''))) % 5))::timestamptz
      else d.next_followup_date end,
    updated_at = now();

create unique index if not exists daily_followups_one_open_case_per_customer_branch_uidx
on public.daily_followups(identity_key, coalesce(branch, ''))
where open_case and not coalesce(is_hidden, false) and identity_key is not null;

create or replace function public.create_or_link_customer_followup(p_payload jsonb)
returns public.daily_followups
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.daily_followups;
begin
  insert into public.daily_followups
  select * from jsonb_populate_record(null::public.daily_followups, p_payload)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_or_link_customer_followup(jsonb) from public;
grant execute on function public.create_or_link_customer_followup(jsonb) to authenticated;

commit;
