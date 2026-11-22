-- Owner decision 2026-11-22: د اسلام فاروق is back at work since 21/11 (suspended since 31/10). His punches on the
-- Shokry device (code 176) since then came in but were not counted because his record was suspended. The record
-- is active again, and those punches are read again: each raw row is put back unchanged so the promotion trigger
-- that runs on insert counts it now.
update public.staff
set active = true, is_active = true, status = 'نشط',
    notes = coalesce(notes || E'\n', '') || 'رجع الشغل 21/11/2026 (قرار المالك 22/11)',
    updated_at = now()
where id = '3b2f682d-be41-4374-a0b8-25411ee6e8d3' and coalesce(active, false) = false;

create temporary table islam_farouk_punches_v1 on commit drop as
select * from public.biometric_attendance_logs b
where b.provider = 'zk_shokry_direct_bridge' and b.biometric_user_id = '176'
  and b.staff_id is null and b.punch_time >= timestamptz '2026-11-21 00:00:00+02'
  and not exists (select 1 from public.staff_attendance_logs l where l.biometric_source_log_id = b.id);

-- The device-clock trigger already ran for these rows when they first came in; it must not run twice.
alter table public.biometric_attendance_logs disable trigger trg_a_biometric_device_clock_v1;
delete from public.biometric_attendance_logs b using islam_farouk_punches_v1 t where b.id = t.id;
insert into public.biometric_attendance_logs select * from islam_farouk_punches_v1 order by punch_time;
alter table public.biometric_attendance_logs enable trigger trg_a_biometric_device_clock_v1;

-- His two days are read so they show for review (no schedule yet: 21/11 19:19 → 22/11 05:09, and 22/11 19:32).
select public.dawaa_materialize_attendance_day_internal_v3('3b2f682d-be41-4374-a0b8-25411ee6e8d3', date '2026-11-21');
select public.dawaa_materialize_attendance_day_internal_v3('3b2f682d-be41-4374-a0b8-25411ee6e8d3', date '2026-11-22');
