-- Automatic correction for fingerprint devices whose clock missed Egypt's official time change.
--
-- The ZK bridges send the device's local wall time (raw_payload.event_time). It is read with the
-- Africa/Cairo rules, so Egypt's official summer/winter changes apply on their own. What the rules
-- cannot fix is a device whose own clock was not moved: after 2026-10-30 the Shami device kept summer
-- time, so a 09:00 punch arrived as 10:00 (and the Shokry device did the same for one night).
--
-- A punch can never happen after the server received it, and the bridges upload every few minutes.
-- So each punch is compared with its arrival time:
--   * device time later than arrival (more than 5 minutes)  → the device is ahead; subtract the nearest whole hour.
--   * device time within 45 minutes before arrival           → the device is right.
--   * 45–80 minutes before arrival on three uploads in a row → the device is an hour behind (a missed
--     spring change); one late upload alone is only a slow bridge.
--   * older than that                                         → a late upload; keep the device's last state.
-- The per-punch offset is kept by event id, so a punch reads the same forever and the raw device time
-- stays untouched. This replaces the fixed «Shami from 2026-10-30 minus one hour» rule of
-- shami_winter_biometric_clock_correction_v1 and gives the same result for those punches.

create table if not exists public.biometric_device_clock_state_v1(
  provider text not null,
  device_key text not null,
  offset_minutes integer not null default 0,
  rule text,
  last_lead_minutes numeric,
  updated_at timestamptz not null default now(),
  primary key(provider, device_key)
);

create table if not exists public.biometric_punch_clock_offsets_v1(
  provider text not null,
  event_id text not null,
  device_key text not null,
  offset_minutes integer not null check (offset_minutes <> 0 and offset_minutes % 60 = 0),
  lead_minutes numeric,
  rule text not null,
  detected_at timestamptz not null default now(),
  primary key(provider, event_id)
);

alter table public.biometric_device_clock_state_v1 enable row level security;
alter table public.biometric_punch_clock_offsets_v1 enable row level security;
revoke all on public.biometric_device_clock_state_v1 from public, anon, authenticated;
revoke all on public.biometric_punch_clock_offsets_v1 from public, anon, authenticated;

-- Device wall time minus arrival, in minutes; null when the payload has no device time.
create or replace function public.dawaa_biometric_clock_lead_minutes_v1(p_raw_payload jsonb, p_arrived_at timestamptz)
returns numeric
language sql stable
set search_path = public, pg_catalog
as $$
  select case
    when p_arrived_at is not null
      and coalesce(p_raw_payload->>'event_time','') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$'
    then round((extract(epoch from ((p_raw_payload->>'event_time')::timestamp at time zone 'Africa/Cairo') - p_arrived_at) / 60.0)::numeric, 2)
  end;
$$;

create or replace function public.dawaa_biometric_device_key_v1(p_raw_payload jsonb)
returns text
language sql immutable
as $$
  select coalesce(nullif(p_raw_payload->>'external_device_id',''), nullif(p_raw_payload->>'device_id',''), '*');
$$;

-- The offset (minutes to subtract) for one punch given the device's current state.
create or replace function public.dawaa_biometric_clock_decide_v1(
  p_provider text, p_device_key text, p_event_id text, p_lead numeric, p_arrived_at timestamptz, p_state integer,
  out offset_minutes integer, out rule text)
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_behind integer;
  v_oldest timestamptz;
begin
  if p_lead > 5 then
    -- Nearest whole hour: a device clock also runs a few seconds fast, so 60.2 minutes is one hour.
    offset_minutes := greatest(1, round(p_lead / 60.0))::integer * 60;
    rule := 'device_ahead';
  elsif p_lead >= -45 then
    offset_minutes := 0;
    rule := 'in_sync';
  elsif p_lead >= -80 then
    if coalesce(p_state, 0) < 0 then
      offset_minutes := p_state;
      rule := 'device_behind_kept';
    else
      select count(*), min(p.created_at) into v_behind, v_oldest
      from (
        select l.created_at, public.dawaa_biometric_clock_lead_minutes_v1(l.raw_payload, l.created_at) as lead
        from public.biometric_attendance_logs l
        where l.provider = p_provider
          and public.dawaa_biometric_device_key_v1(l.raw_payload) = p_device_key
          and l.created_at < p_arrived_at
          and l.created_at >= p_arrived_at - interval '6 hours'
          and l.raw_payload->>'event_id' is distinct from p_event_id
        order by l.created_at desc
        limit 2
      ) p
      where p.lead between -80 and -45;
      if v_behind = 2 and v_oldest <= p_arrived_at - interval '20 minutes' then
        offset_minutes := -60;
        rule := 'device_behind';
      else
        offset_minutes := 0;
        rule := 'slow_upload';
      end if;
    end if;
  else
    offset_minutes := coalesce(p_state, 0);
    rule := 'late_upload_kept';
  end if;
end;
$$;

-- Effective punch time. ZK punches with a detected device offset read from the device time minus the
-- offset; every other punch keeps its stored time (the old vendor still reads its device time).
create or replace function public.dawaa_fingerprint_effective_time_v1(p_provider text, p_raw_payload jsonb, p_punch_time timestamptz)
returns timestamptz
language sql stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select ((p_raw_payload->>'event_time')::timestamp at time zone 'Africa/Cairo') - make_interval(mins => o.offset_minutes)
     from public.biometric_punch_clock_offsets_v1 o
     where o.provider = p_provider
       and o.event_id = p_raw_payload->>'event_id'
       and coalesce(p_raw_payload->>'event_time','') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$'),
    case
      when p_provider = 'fingerprint_vendor_primary'
        and coalesce(p_raw_payload->>'event_time','') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$'
      then (p_raw_payload->>'event_time')::timestamp at time zone 'Africa/Cairo'
      else p_punch_time
    end);
$$;

-- New punches: decide before the promotion trigger reads the effective time.
create or replace function public.dawaa_biometric_device_clock_on_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_event text := nullif(new.raw_payload->>'event_id','');
  v_device text := public.dawaa_biometric_device_key_v1(new.raw_payload);
  v_arrived timestamptz := coalesce(new.created_at, now());
  v_lead numeric := public.dawaa_biometric_clock_lead_minutes_v1(new.raw_payload, coalesce(new.created_at, now()));
  v_state integer;
  v_decision record;
begin
  if new.provider not like 'zk\_%' or v_event is null or v_lead is null then
    return new;
  end if;
  -- A resent event keeps whatever was decided the first time.
  if exists (select 1 from public.biometric_attendance_logs l
             where l.provider = new.provider and l.raw_payload->>'event_id' = v_event) then
    return new;
  end if;

  select s.offset_minutes into v_state from public.biometric_device_clock_state_v1 s
  where s.provider = new.provider and s.device_key = v_device for update;
  select * into v_decision from public.dawaa_biometric_clock_decide_v1(new.provider, v_device, v_event, v_lead, v_arrived, v_state);

  insert into public.biometric_device_clock_state_v1(provider, device_key, offset_minutes, rule, last_lead_minutes, updated_at)
  values (new.provider, v_device, v_decision.offset_minutes, v_decision.rule, v_lead, now())
  on conflict (provider, device_key) do update set
    offset_minutes = excluded.offset_minutes, rule = excluded.rule,
    last_lead_minutes = excluded.last_lead_minutes, updated_at = now();

  if v_decision.offset_minutes <> 0 then
    insert into public.biometric_punch_clock_offsets_v1(provider, event_id, device_key, offset_minutes, lead_minutes, rule)
    values (new.provider, v_event, v_device, v_decision.offset_minutes, v_lead, v_decision.rule)
    on conflict (provider, event_id) do nothing;
    new.punch_time := public.dawaa_fingerprint_effective_time_v1(new.provider, new.raw_payload, new.punch_time);
  end if;
  return new;
end;
$$;

revoke all on function public.dawaa_biometric_clock_lead_minutes_v1(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.dawaa_biometric_clock_decide_v1(text, text, text, numeric, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dawaa_biometric_device_clock_on_insert_v1() from public, anon, authenticated;

-- History: replay every ZK punch in arrival order, per device.
do $$
declare
  v_row record;
  v_state integer := 0;
  v_key text := null;
  v_decision record;
begin
  for v_row in
    select l.provider, public.dawaa_biometric_device_key_v1(l.raw_payload) as device_key,
      l.raw_payload->>'event_id' as event_id, l.created_at,
      public.dawaa_biometric_clock_lead_minutes_v1(l.raw_payload, l.created_at) as lead
    from public.biometric_attendance_logs l
    where l.provider like 'zk\_%'
      and nullif(l.raw_payload->>'event_id','') is not null
      and public.dawaa_biometric_clock_lead_minutes_v1(l.raw_payload, l.created_at) is not null
    order by l.provider, public.dawaa_biometric_device_key_v1(l.raw_payload), l.created_at, l.id
  loop
    if v_key is distinct from v_row.provider || '|' || v_row.device_key then
      if v_key is not null then
        insert into public.biometric_device_clock_state_v1(provider, device_key, offset_minutes, rule)
        values (split_part(v_key, '|', 1), split_part(v_key, '|', 2), v_state, 'history')
        on conflict (provider, device_key) do nothing;
      end if;
      v_key := v_row.provider || '|' || v_row.device_key;
      v_state := 0;
    end if;
    select * into v_decision from public.dawaa_biometric_clock_decide_v1(
      v_row.provider, v_row.device_key, v_row.event_id, v_row.lead, v_row.created_at, v_state);
    v_state := v_decision.offset_minutes;
    if v_decision.offset_minutes <> 0 then
      insert into public.biometric_punch_clock_offsets_v1(provider, event_id, device_key, offset_minutes, lead_minutes, rule)
      values (v_row.provider, v_row.event_id, v_row.device_key, v_decision.offset_minutes, v_row.lead, v_decision.rule)
      on conflict (provider, event_id) do nothing;
    end if;
  end loop;
  if v_key is not null then
    insert into public.biometric_device_clock_state_v1(provider, device_key, offset_minutes, rule)
    values (split_part(v_key, '|', 1), split_part(v_key, '|', 2), v_state, 'history')
    on conflict (provider, device_key) do nothing;
  end if;
end $$;

-- Punches already stored with the device's wrong hour: correct the stored time and the attendance log
-- built from it (that update queues the day for re-materialization). A day the system approved from the
-- wrong time is re-opened and resolved again; a day a manager approved is left for the manager.
do $$
declare
  v_day record;
begin
  create temporary table dawaa_clock_fixed_days_v1(staff_id uuid, attendance_date date) on commit drop;

  update public.biometric_attendance_logs l
  set punch_time = public.dawaa_fingerprint_effective_time_v1(l.provider, l.raw_payload, l.punch_time)
  from public.biometric_punch_clock_offsets_v1 o
  where o.provider = l.provider and o.event_id = l.raw_payload->>'event_id'
    and l.punch_time is distinct from public.dawaa_fingerprint_effective_time_v1(l.provider, l.raw_payload, l.punch_time);

  with fixed as (
    update public.staff_attendance_logs s
    set recorded_at = l.punch_time, updated_at = now()
    from public.biometric_attendance_logs l
    join public.biometric_punch_clock_offsets_v1 o on o.provider = l.provider and o.event_id = l.raw_payload->>'event_id'
    where s.biometric_source_log_id = l.id
      and s.recorded_at is distinct from l.punch_time
    returning s.staff_id, s.shift_date
  )
  insert into dawaa_clock_fixed_days_v1 select distinct staff_id, shift_date from fixed where staff_id is not null and shift_date is not null;

  for v_day in
    select d.staff_id, d.attendance_date from dawaa_clock_fixed_days_v1 d
    left join public.attendance_daily_summary a on a.staff_id = d.staff_id and a.attendance_date = d.attendance_date
    where a.status is distinct from 'approved' or a.approved_by like 'system:%'
  loop
    update public.attendance_daily_summary
    set status = 'pending_review', updated_at = now()
    where staff_id = v_day.staff_id and attendance_date = v_day.attendance_date
      and status = 'approved' and approved_by like 'system:%';
    perform public.dawaa_materialize_attendance_day_internal_v3(v_day.staff_id, v_day.attendance_date);
  end loop;
end $$;

drop trigger if exists trg_a_biometric_device_clock_v1 on public.biometric_attendance_logs;
create trigger trg_a_biometric_device_clock_v1
  before insert on public.biometric_attendance_logs
  for each row execute function public.dawaa_biometric_device_clock_on_insert_v1();
