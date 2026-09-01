-- نظام مزامنة فواتير الشراء من Base44 (تطبيق DawaaWael) — من دلوقتي وطالع، مش
-- بأثر رجعي. الأولوية إننا نطابق حقل "entered_by" (اسم حر) بموظف حقيقي عندنا،
-- ونسيب اللي مش متأكدين منه واضح "غير محدد" بدل ما نخمّن ونحاسب غلط.

create or replace function public.dawaa_normalize_staff_name_v1(p_name text)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v text;
begin
  v := trim(coalesce(p_name, ''));
  -- وحّد كل أشكال الألف (أ/إ/آ) لألف عادية، وكمان ة->ه، ي->ى، قبل شيل اللقب،
  -- عشان "ا هاجر" (بألف عادية زي ما بيتكتب فعليًا) يتشال منه اللقب صح.
  v := translate(v, 'أإآةي', 'اااهى');
  v := regexp_replace(v, '^(دكتور|د/|د\.|د|استاذ|ا/|ا\.|ا|مهندس|م/|م\.|م)\s*', '', 'i');
  v := trim(v);
  v := regexp_replace(v, '[.,،_-]', '', 'g');
  v := regexp_replace(v, '\s+', '', 'g');
  return lower(v);
end;
$function$;
revoke all on function public.dawaa_normalize_staff_name_v1(text) from public;

create or replace function public.dawaa_map_base44_branch_v1(p_branch text)
returns text
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select case trim(coalesce(p_branch, ''))
    when 'دواء شكري' then 'فرع شكري'
    when 'دواء الشامي' then 'فرع الشامي'
    else nullif(trim(p_branch), '')
  end
$function$;
revoke all on function public.dawaa_map_base44_branch_v1(text) from public;

create or replace function public.match_base44_entered_by_v1(p_raw_name text)
returns table (staff_id uuid, match_status text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_normalized text;
  v_staff_id uuid;
  v_count integer;
begin
  if p_raw_name is null or trim(p_raw_name) = '' then
    return query select null::uuid, 'empty'::text;
    return;
  end if;

  v_normalized := public.dawaa_normalize_staff_name_v1(p_raw_name);
  if v_normalized = '' then
    return query select null::uuid, 'empty'::text;
    return;
  end if;

  select a.staff_id into v_staff_id
  from public.staff_identity_aliases a
  where a.normalized_alias = v_normalized and a.active = true
  order by a.confidence desc
  limit 1;
  if v_staff_id is not null then
    return query select v_staff_id, 'matched'::text;
    return;
  end if;

  select count(*) into v_count
  from public.staff s
  where coalesce(s.active, true) and public.dawaa_normalize_staff_name_v1(s.name) = v_normalized;
  if v_count = 1 then
    select s.id into v_staff_id from public.staff s
    where coalesce(s.active, true) and public.dawaa_normalize_staff_name_v1(s.name) = v_normalized;
    return query select v_staff_id, 'matched'::text;
    return;
  elsif v_count > 1 then
    return query select null::uuid, 'ambiguous'::text;
    return;
  end if;

  -- مطابقة تقريبية بس لو الاسمين (بعد التطبيع) طولهم 3 حروف على الأقل، عشان
  -- نتجنب تطابقات وهمية من بقايا نص قصيرة جدًا.
  if length(v_normalized) >= 3 then
    select count(*) into v_count
    from public.staff s
    where coalesce(s.active, true)
      and length(public.dawaa_normalize_staff_name_v1(s.name)) >= 3
      and (public.dawaa_normalize_staff_name_v1(s.name) like '%' || v_normalized || '%'
           or v_normalized like '%' || public.dawaa_normalize_staff_name_v1(s.name) || '%');
    if v_count = 1 then
      select s.id into v_staff_id from public.staff s
      where coalesce(s.active, true)
        and length(public.dawaa_normalize_staff_name_v1(s.name)) >= 3
        and (public.dawaa_normalize_staff_name_v1(s.name) like '%' || v_normalized || '%'
             or v_normalized like '%' || public.dawaa_normalize_staff_name_v1(s.name) || '%');
      return query select v_staff_id, 'matched'::text;
      return;
    elsif v_count > 1 then
      return query select null::uuid, 'ambiguous'::text;
      return;
    end if;
  end if;

  return query select null::uuid, 'unmatched'::text;
end;
$function$;
revoke all on function public.match_base44_entered_by_v1(text) from public, anon, authenticated;
grant execute on function public.match_base44_entered_by_v1(text) to anon, authenticated;

create table if not exists public.base44_purchase_invoice_sync (
  id uuid primary key default gen_random_uuid(),
  base44_id text not null unique,
  system_invoice_number text,
  supplier_invoice_number text,
  branch text,
  transaction_type text,
  entered_by_raw text,
  entered_by_staff_id uuid references public.staff(id),
  match_status text not null check (match_status in ('matched', 'ambiguous', 'unmatched', 'empty')),
  invoice_date date,
  total_value numeric,
  base44_status text,
  review_id uuid references public.purchase_invoice_entry_reviews(id),
  synced_at timestamptz not null default now()
);
alter table public.base44_purchase_invoice_sync enable row level security;
revoke all on table public.base44_purchase_invoice_sync from public, anon, authenticated;
create index if not exists idx_base44_sync_match_status on public.base44_purchase_invoice_sync (match_status) where review_id is null;

create or replace function public.import_base44_purchase_invoices_v1(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_record jsonb;
  v_match record;
  v_matched int := 0;
  v_ambiguous int := 0;
  v_unmatched int := 0;
  v_empty int := 0;
  v_total int := 0;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;

  for v_record in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    v_total := v_total + 1;
    select * into v_match from public.match_base44_entered_by_v1(nullif(trim(v_record ->> 'entered_by'), ''));

    insert into public.base44_purchase_invoice_sync (
      base44_id, system_invoice_number, supplier_invoice_number, branch, transaction_type,
      entered_by_raw, entered_by_staff_id, match_status, invoice_date, total_value, base44_status
    ) values (
      v_record ->> 'id',
      nullif(v_record ->> 'system_invoice_number', ''),
      nullif(v_record ->> 'supplier_invoice_number', ''),
      public.dawaa_map_base44_branch_v1(v_record ->> 'branch'),
      nullif(v_record ->> 'transaction_type', ''),
      nullif(trim(v_record ->> 'entered_by'), ''),
      v_match.staff_id,
      v_match.match_status,
      nullif(v_record ->> 'invoice_date', '')::date,
      nullif(v_record ->> 'total_value', '')::numeric,
      nullif(v_record ->> 'status', '')
    )
    on conflict (base44_id) do update set
      system_invoice_number = excluded.system_invoice_number,
      supplier_invoice_number = excluded.supplier_invoice_number,
      branch = excluded.branch,
      transaction_type = excluded.transaction_type,
      entered_by_raw = excluded.entered_by_raw,
      entered_by_staff_id = case when public.base44_purchase_invoice_sync.review_id is null then excluded.entered_by_staff_id else public.base44_purchase_invoice_sync.entered_by_staff_id end,
      match_status = case when public.base44_purchase_invoice_sync.review_id is null then excluded.match_status else public.base44_purchase_invoice_sync.match_status end,
      invoice_date = excluded.invoice_date,
      total_value = excluded.total_value,
      base44_status = excluded.base44_status,
      synced_at = now();

    case v_match.match_status
      when 'matched' then v_matched := v_matched + 1;
      when 'ambiguous' then v_ambiguous := v_ambiguous + 1;
      when 'unmatched' then v_unmatched := v_unmatched + 1;
      else v_empty := v_empty + 1;
    end case;
  end loop;

  return jsonb_build_object(
    'total', v_total, 'matched', v_matched, 'ambiguous', v_ambiguous,
    'unmatched', v_unmatched, 'empty', v_empty
  );
end;
$function$;
revoke all on function public.import_base44_purchase_invoices_v1(jsonb) from public, anon, authenticated;
grant execute on function public.import_base44_purchase_invoices_v1(jsonb) to anon, authenticated;

create or replace function public.resolve_base44_entered_by_alias_v1(p_raw_name text, p_staff_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_normalized text;
  v_updated int;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;

  if not exists (select 1 from public.staff where id = p_staff_id and coalesce(active, false)) then
    raise exception using errcode = '22023', message = 'target staff member not found or inactive';
  end if;

  v_normalized := public.dawaa_normalize_staff_name_v1(p_raw_name);
  if v_normalized = '' then
    raise exception using errcode = '22023', message = 'invalid raw name';
  end if;

  insert into public.staff_identity_aliases (id, staff_id, alias_name, normalized_alias, source, confidence, active, created_by)
  values (gen_random_uuid(), p_staff_id, trim(p_raw_name), v_normalized, 'base44_purchase_invoice', 100, true,
    coalesce(nullif(trim(v_account.staff_name), ''), nullif(trim(v_account.name), ''), v_account.username))
  on conflict do nothing;

  update public.base44_purchase_invoice_sync
  set entered_by_staff_id = p_staff_id, match_status = 'matched'
  where review_id is null and public.dawaa_normalize_staff_name_v1(entered_by_raw) = v_normalized;
  get diagnostics v_updated = row_count;

  return v_updated;
end;
$function$;
revoke all on function public.resolve_base44_entered_by_alias_v1(text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_base44_entered_by_alias_v1(text, uuid) to anon, authenticated;

create or replace function public.list_base44_pending_invoice_reviews_v1(p_limit integer default 100)
returns table (
  id uuid, base44_id text, system_invoice_number text, branch text, transaction_type text,
  entered_by_raw text, entered_by_staff_id uuid, entered_by_staff_name text, match_status text,
  invoice_date date, total_value numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  return query
    select b.id, b.base44_id, b.system_invoice_number, b.branch, b.transaction_type,
           b.entered_by_raw, b.entered_by_staff_id, s.name, b.match_status, b.invoice_date, b.total_value
    from public.base44_purchase_invoice_sync b
    left join public.staff s on s.id = b.entered_by_staff_id
    where b.review_id is null
    order by b.invoice_date desc nulls last, b.synced_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$function$;
revoke all on function public.list_base44_pending_invoice_reviews_v1(integer) from public, anon, authenticated;
grant execute on function public.list_base44_pending_invoice_reviews_v1(integer) to anon, authenticated;

create or replace function public.log_base44_invoice_review_v1(
  p_sync_id uuid,
  p_staff_id uuid,
  p_outcome text,
  p_notes text default null
) returns public.purchase_invoice_entry_reviews
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_sync public.base44_purchase_invoice_sync%rowtype;
  v_row public.purchase_invoice_entry_reviews%rowtype;
begin
  select * into v_sync from public.base44_purchase_invoice_sync where id = p_sync_id;
  if not found then raise exception using errcode = '22023', message = 'synced invoice not found'; end if;
  if v_sync.review_id is not null then raise exception using errcode = '22023', message = 'already reviewed'; end if;

  v_row := public.log_purchase_invoice_entry_review_v1(
    p_staff_id, p_outcome, v_sync.branch, coalesce(v_sync.system_invoice_number, v_sync.base44_id), p_notes, coalesce(v_sync.invoice_date, current_date)
  );

  update public.base44_purchase_invoice_sync set review_id = v_row.id where id = p_sync_id;

  return v_row;
end;
$function$;
revoke all on function public.log_base44_invoice_review_v1(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_base44_invoice_review_v1(uuid, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
