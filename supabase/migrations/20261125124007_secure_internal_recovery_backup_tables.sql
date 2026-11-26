SET LOCAL lock_timeout='2s';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['backup_attendance_null_hours_20261124','backup_shift_schedules_mohamed_omar_20261124','backup_sales_batch_20261118_1718'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',t);
    END IF;
  END LOOP;
END $$;
