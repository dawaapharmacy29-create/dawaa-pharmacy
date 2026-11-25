SET LOCAL lock_timeout='2s';
CREATE INDEX IF NOT EXISTS idx_attendance_resolution_audit_resolution_id_v1 ON public.attendance_resolution_audit (resolution_id);
