SET LOCAL lock_timeout='2s';
ALTER TABLE public.bills_trip_stops SET (autovacuum_vacuum_scale_factor=0.08, autovacuum_analyze_scale_factor=0.05);
ALTER TABLE public.biometric_attendance_logs SET (autovacuum_vacuum_scale_factor=0.08, autovacuum_analyze_scale_factor=0.05);
ALTER TABLE public.staff_attendance_logs SET (autovacuum_vacuum_scale_factor=0.08, autovacuum_analyze_scale_factor=0.05);
ALTER TABLE public.attendance_impact_ledger SET (autovacuum_vacuum_scale_factor=0.08, autovacuum_analyze_scale_factor=0.05);
