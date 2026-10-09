-- Keep a single canonical dirty-queue trigger on staff_attendance_logs.
-- The newer trg_dawaa_mark_attendance_dirty_v1 owns queue upserts.
drop trigger if exists trg_dawaa_enqueue_attendance_materialization_v1
on public.staff_attendance_logs;
