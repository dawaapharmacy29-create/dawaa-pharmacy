-- عجز الأرصدة والأصناف المنتهية: القيمة الإجمالية لكل فرع في كل دورة (٢٦ → ٢٥)، بتتدخل يدوي من الإدارة
-- العليا. ده مصدر بند «العجز والإكسبير» في محفظة الخصومات (الحافز الشهري + تارجت المبيعات + حافز اللستة).
-- بيتسجل مين دخل القيمة وإمتى، وكل تعديل بيتحفظ في السجل؛ مفيش مسح.

create table if not exists public.branch_cycle_losses_v1 (
  cycle_start date not null check (extract(day from cycle_start) = 26),
  branch_key text not null check (branch_key in ('shokry', 'elshamy')),
  stock_shortage numeric(12, 2) not null default 0 check (stock_shortage >= 0),
  expired_value numeric(12, 2) not null default 0 check (expired_value >= 0),
  note text,
  entered_by uuid references public.staff_accounts(id),
  entered_at timestamptz not null default now(),
  primary key (cycle_start, branch_key)
);
alter table public.branch_cycle_losses_v1 enable row level security;

create table if not exists public.branch_cycle_losses_log_v1 (
  id bigint generated always as identity primary key,
  cycle_start date not null,
  branch_key text not null,
  stock_shortage numeric(12, 2) not null,
  expired_value numeric(12, 2) not null,
  note text,
  entered_by uuid references public.staff_accounts(id),
  entered_at timestamptz not null default now()
);
alter table public.branch_cycle_losses_log_v1 enable row level security;

create or replace function public.list_branch_cycle_losses_v1(p_from date)
returns table (cycle_start date, branch_key text, stock_shortage numeric, expired_value numeric, note text,
               entered_by_name text, entered_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select l.cycle_start, l.branch_key, l.stock_shortage, l.expired_value, l.note, sa.name, l.entered_at
    from public.branch_cycle_losses_v1 l
    left join public.staff_accounts sa on sa.id = l.entered_by
    where l.cycle_start >= p_from
    order by l.cycle_start desc, l.branch_key;
end;
$function$;

create or replace function public.set_branch_cycle_losses_v1(
  p_cycle_start date, p_branch_key text, p_stock_shortage numeric, p_expired_value numeric, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_actor is null or not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_cycle_start is null or extract(day from p_cycle_start) <> 26
     or p_cycle_start > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'invalid_cycle';
  end if;
  if p_branch_key not in ('shokry', 'elshamy') then raise exception 'invalid_branch'; end if;
  if coalesce(p_stock_shortage, -1) < 0 or coalesce(p_expired_value, -1) < 0 then
    raise exception 'invalid_amount';
  end if;

  insert into public.branch_cycle_losses_v1 as l
    (cycle_start, branch_key, stock_shortage, expired_value, note, entered_by, entered_at)
  values (p_cycle_start, p_branch_key, p_stock_shortage, p_expired_value, v_note, v_actor, now())
  on conflict (cycle_start, branch_key) do update
    set stock_shortage = excluded.stock_shortage, expired_value = excluded.expired_value,
        note = excluded.note, entered_by = excluded.entered_by, entered_at = excluded.entered_at;

  insert into public.branch_cycle_losses_log_v1 (cycle_start, branch_key, stock_shortage, expired_value, note, entered_by)
  values (p_cycle_start, p_branch_key, p_stock_shortage, p_expired_value, v_note, v_actor);
end;
$function$;

revoke all on function public.list_branch_cycle_losses_v1(date) from public;
revoke all on function public.set_branch_cycle_losses_v1(date, text, numeric, numeric, text) from public;
grant execute on function public.list_branch_cycle_losses_v1(date) to anon, authenticated;
grant execute on function public.set_branch_cycle_losses_v1(date, text, numeric, numeric, text) to anon, authenticated;
